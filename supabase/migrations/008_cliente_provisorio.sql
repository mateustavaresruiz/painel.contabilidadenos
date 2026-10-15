-- 008 · Cliente provisório criado ao abrir chamado pelo WhatsApp
--
-- Idempotente e não destrutiva: só acrescenta coluna, índice, funções e
-- gatilho (`if not exists` / `create or replace` / `drop trigger if exists`).
-- Nenhuma linha é apagada; o backfill só preenche "clienteId" que está nulo.
--
--  1. "Cliente".provisorio: cadastro nascido do WhatsApp (nome + número), sem
--     e-mail nem CPF/CNPJ. A importação de planilha e o formulário completam.
--  2. Gatilho: preencheu e-mail ou CPF/CNPJ, o cadastro deixa de ser
--     provisório sozinho (e o aviso automático das observações sai).
--  3. garantir_cliente_da_conversa(p_chat): devolve o cliente da conversa;
--     sem cliente, vincula pelo telefone ou cria o provisório. Chamada pela
--     tela antes de gravar um chamado aberto a partir da conversa.
--  4. Backfill: chamados de conversa que ficaram sem cliente.

-- ---------------------------------------------------------------------------
-- 1. Coluna
-- ---------------------------------------------------------------------------
alter table public."Cliente" add column if not exists provisorio boolean not null default false;
create index if not exists "Cliente_provisorio_idx" on public."Cliente"("criadoEm" desc) where provisorio;

-- ---------------------------------------------------------------------------
-- 2. Sai de provisório quando o cadastro ganha e-mail ou CPF/CNPJ.
--    Roda depois de trg_cliente_normaliza (ordem alfabética), então o
--    "cpfCnpj" já chega só com dígitos (ou nulo).
-- ---------------------------------------------------------------------------
create or replace function public.cliente_provisorio_guard() returns trigger
language plpgsql as $$
begin
  if new.provisorio
     and (nullif(trim(coalesce(new.email, '')), '') is not null or new."cpfCnpj" is not null) then
    new.provisorio := false;
    -- O aviso automático ("Complete o cadastro") perde o sentido.
    if new.observacoes = 'Criado automaticamente ao abrir um chamado pelo WhatsApp. Complete o cadastro (e-mail, CPF/CNPJ).' then
      new.observacoes := null;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_cliente_provisorio on public."Cliente";
create trigger trg_cliente_provisorio before insert or update on public."Cliente"
  for each row execute function public.cliente_provisorio_guard();

-- ---------------------------------------------------------------------------
-- 3. Cliente da conversa (garante um)
--
--    *_dados = a lógica, sem conferência de permissão (usada pelo backfill
--    abaixo e pela função pública); sem grant para a tela.
--
--    - conversa já tem cliente → devolve;
--    - grupo, ou sem número conhecido → null (não inventa cadastro);
--    - número = dígitos do JID @c.us (ou WhatsappContato.numero quando @lid);
--    - cliente com o telefone (cliente_por_telefone, tolera o 9º dígito) →
--      vincula a conversa a ele. Se alguém DESVINCULOU à mão
--      ("clienteVinculoManual"), não volta para o cliente do telefone: cria o
--      provisório;
--    - senão, cria o provisório (PF, nome do WhatsApp, telefone formatado) e
--      vincula.
--    Concorrência: a linha da conversa fica travada (for update) e um lock
--    por número impede duas conversas do mesmo telefone (duas instâncias)
--    de criarem dois provisórios ao mesmo tempo.
-- ---------------------------------------------------------------------------
create or replace function public.garantir_cliente_da_conversa_dados(p_chat text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_chat     public."WhatsappChat"%rowtype;
  v_numero   text;
  v_push     text;
  v_cliente  text;
  v_local    text;
  v_tel      text;
  v_nome     text;
begin
  select * into v_chat from public."WhatsappChat" where id = p_chat for update;
  if not found then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;
  if v_chat."clienteId" is not null then
    return v_chat."clienteId";
  end if;
  if v_chat.tipo <> 'individual' or (v_chat."chatId" not like '%@c.us' and v_chat."chatId" not like '%@lid') then
    return null;
  end if;

  if v_chat."chatId" like '%@c.us' then
    v_numero := split_part(v_chat."chatId", '@', 1);
  else
    select ct.numero into v_numero
      from public."WhatsappContato" ct
     where ct."tenantId" = v_chat."tenantId"
       and (ct."lidId" = v_chat."chatId" or ct."contatoId" = v_chat."chatId")
       and ct.numero is not null
     order by (ct."contatoId" like '%@c.us') desc, ct."atualizadoEm" desc
     limit 1;
  end if;
  v_numero := nullif(regexp_replace(coalesce(v_numero, ''), '\D', '', 'g'), '');
  if v_numero is null or length(v_numero) < 10 then
    return null;
  end if;

  -- Uma criação por número de cada vez (vale até o fim da transação).
  perform pg_advisory_xact_lock(hashtext('cliente_provisorio:' || public.normalizar_telefone(v_numero)));

  if not v_chat."clienteVinculoManual" then
    select c.id into v_cliente
      from public.cliente_por_telefone(v_numero) c
     order by c.ativo desc, c."criadoEm"
     limit 1;
  end if;

  if v_cliente is null then
    select ct."pushName" into v_push
      from public."WhatsappContato" ct
     where ct."tenantId" = v_chat."tenantId"
       and (ct."contatoId" = v_chat."chatId" or ct."lidId" = v_chat."chatId"
            or ct."contatoId" = v_numero || '@c.us')
       and nullif(trim(ct."pushName"), '') is not null
     order by ct."atualizadoEm" desc
     limit 1;

    -- Telefone no formato do formulário ((DD) 9XXXX-XXXX): o form valida
    -- 10/11 dígitos e normalizar_telefone devolve o mesmo 55DD9XXXXXXXX.
    -- Número estrangeiro fica como +<dígitos>.
    v_local := case when v_numero like '55%' and length(v_numero) in (12, 13)
                    then substr(v_numero, 3) else null end;
    v_tel := case
      when length(v_local) = 11 then '(' || substr(v_local, 1, 2) || ') ' || substr(v_local, 3, 5) || '-' || substr(v_local, 8)
      when length(v_local) = 10 then '(' || substr(v_local, 1, 2) || ') ' || substr(v_local, 3, 4) || '-' || substr(v_local, 7)
      else '+' || v_numero
    end;
    v_nome := left(coalesce(nullif(trim(v_chat.nome), ''), nullif(trim(v_push), ''), v_tel), 200);
    if length(v_nome) < 2 then v_nome := v_tel; end if;

    insert into public."Cliente" ("tenantId", tipo, nome, telefone, provisorio, observacoes)
    values (v_chat."tenantId", 'PF', v_nome, v_tel, true,
            'Criado automaticamente ao abrir um chamado pelo WhatsApp. Complete o cadastro (e-mail, CPF/CNPJ).')
    returning id into v_cliente;
  end if;

  update public."WhatsappChat"
     set "clienteId" = v_cliente, "atualizadoEm" = now()
   where id = p_chat;
  return v_cliente;
end $$;

create or replace function public.garantir_cliente_da_conversa(p_chat text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.tem_permissao('chamados.criar') then
    raise exception 'Sem permissão para abrir chamados.' using errcode = '42501';
  end if;
  return public.garantir_cliente_da_conversa_dados(p_chat);
end $$;

revoke all on function public.garantir_cliente_da_conversa_dados(text) from public, anon, authenticated;
grant execute on function public.garantir_cliente_da_conversa_dados(text) to service_role;
revoke all on function public.garantir_cliente_da_conversa(text) from public, anon;
grant execute on function public.garantir_cliente_da_conversa(text) to authenticated, service_role;
revoke all on function public.cliente_provisorio_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Backfill: chamado de conversa sem cliente ganha o cliente da conversa.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v text;
begin
  for r in
    select s.id, s."chatId" from public."Solicitacao" s
     where s."chatId" is not null and s."clienteId" is null
     order by s."criadoEm"
  loop
    v := public.garantir_cliente_da_conversa_dados(r."chatId");
    if v is not null then
      update public."Solicitacao" set "clienteId" = v where id = r.id and "clienteId" is null;
    end if;
  end loop;
end $$;
