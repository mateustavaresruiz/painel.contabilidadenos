-- 021 — Correções da revisão de 20/10/2026
--
--  1. cargo_guard: a trava do cargo Administrador nunca disparava. Dentro de uma
--     função SECURITY DEFINER o current_user é o DONO da função (postgres), então
--     "current_user not in ('postgres','supabase_admin')" era sempre falso. Agora
--     o teste é pelo papel do JWT: quem vem da tela (authenticated) não altera,
--     não apaga nem cria cargo de sistema, e não transforma um cargo comum em
--     cargo de sistema (o que daria todas as permissões).
--  2. Anexos do WhatsApp (bucket whatsapp-media): quem não tem whatsapp.ver_todas
--     só lê o arquivo de uma mensagem que ele enxerga (conversa livre ou dele),
--     a mesma regra da tabela WhatsappMensagem. Antes bastava whatsapp.ver para
--     listar e baixar a mídia de qualquer conversa.
--  3. Bucket "marca" sem SVG (SVG pode carregar script no domínio do Supabase).
--  4. buscar_chamados devolve os mais recentes primeiro (a busca global pega 5).
--  5. CertificadoAviso por VALIDADE: o histórico era por (certificado, marco).
--     Renovar editando a data deixava o marco 0 já registrado e nenhum aviso
--     saía no ano seguinte. Agora a trava é (certificado, validoAte, marco).
--  6. CNPJ alfanumérico (IN RFB 2.229/2024, a partir de julho/2026): o gatilho
--     do Cliente mantém as letras (maiúsculas) e só tira pontuação.
--
-- Não destrutiva: nenhuma linha apagada; a troca da unique só muda a chave da
-- trava (a coluna nova é preenchida com a validade atual de cada certificado).

-- ---------------------------------------------------------------------------
-- 1. Cargo de sistema
-- ---------------------------------------------------------------------------
create or replace function public.cargo_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_invalidas text[];
  -- Papel de quem pediu (JWT). Migração e SQL direto não têm JWT: ''.
  v_tela boolean := coalesce(auth.role(), '') in ('authenticated', 'anon');
begin
  if v_tela and tg_op in ('UPDATE','DELETE') and old.sistema then
    raise exception 'O cargo Administrador não pode ser alterado nem apagado.' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from public."Colaborador" where "cargoId" = old.id) then
      raise exception 'Há pessoas neste cargo. Mova-as para outro cargo antes de apagar.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if v_tela and new.sistema then
    raise exception 'Cargo de sistema não pode ser criado nem marcado pela tela.' using errcode = 'P0001';
  end if;
  new.nome := trim(new.nome);
  if length(new.nome) < 2 then
    raise exception 'Informe o nome do cargo.' using errcode = 'P0001';
  end if;
  select array_agg(p) into v_invalidas
    from unnest(new.permissoes) p
   where not exists (select 1 from public."Permissao" x where x.chave = p);
  if v_invalidas is not null then
    raise exception 'Permissão desconhecida: %', array_to_string(v_invalidas, ', ') using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct p order by p), '{}') into new.permissoes from unnest(new.permissoes) p;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Mídia do WhatsApp com a mesma regra das mensagens
-- ---------------------------------------------------------------------------
create index if not exists "WhatsappMensagem_mediaPath_idx"
  on public."WhatsappMensagem"("mediaPath") where "mediaPath" is not null;

-- Pode ler este arquivo do bucket? (security definer: a política do Storage
-- roda como o usuário, que não precisa enxergar a tabela inteira para isso).
create or replace function public.whatsapp_midia_visivel(p_nome text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.tem_permissao('whatsapp.ver') and (
         public.tem_permissao('whatsapp.ver_todas')
      -- Fotos de perfil: as mesmas para todos (aparecem na lista de conversas).
      or split_part(p_nome, '/', 2) = 'avatars'
      or exists (
           select 1
             from public."WhatsappMensagem" m
             join public."WhatsappChat" c
               on c."tenantId" = m."tenantId" and c."sessaoId" = m."sessaoId" and c."chatId" = m."chatId"
            where m."mediaPath" = p_nome
              and (c."responsavelId" is null or c."responsavelId" = public.eu_colaborador_id())))
$$;
revoke all on function public.whatsapp_midia_visivel(text) from public, anon;
grant execute on function public.whatsapp_midia_visivel(text) to authenticated;

drop policy if exists whatsapp_media_select on storage.objects;
create policy whatsapp_media_select on storage.objects for select to authenticated
  using (bucket_id = 'whatsapp-media'
         and (owner = auth.uid() or public.whatsapp_midia_visivel(name)));

-- ---------------------------------------------------------------------------
-- 3. Marca sem SVG
-- ---------------------------------------------------------------------------
update storage.buckets
   set allowed_mime_types = array_remove(allowed_mime_types, 'image/svg+xml')
 where id = 'marca' and 'image/svg+xml' = any(allowed_mime_types);

-- ---------------------------------------------------------------------------
-- 4. Busca de chamados: mais recentes primeiro
-- ---------------------------------------------------------------------------
create or replace function public.buscar_chamados(p_q text)
returns setof public."Solicitacao"
language sql stable security invoker set search_path = public as $$
  with t as (select public.padrao_busca(public.normalizar_busca(trim(coalesce(p_q, '')))) as pat)
  select s.*
    from public."Solicitacao" s
    cross join t
    left join public."SolicitacaoTipo" tp on tp.id = s."tipoId"
    left join public."Cliente" c on c.id = s."clienteId"
   where length(trim(coalesce(p_q, ''))) >= 2
     and (public.normalizar_busca(s.descricao) like t.pat
       or public.normalizar_busca(tp.nome) like t.pat
       or public.normalizar_busca(c.nome) like t.pat
       or public.normalizar_busca(c."nomeFantasia") like t.pat)
   order by s."criadoEm" desc
$$;

-- ---------------------------------------------------------------------------
-- 5. Aviso de certificado amarrado à validade
-- ---------------------------------------------------------------------------
alter table public."CertificadoAviso" add column if not exists "validoAte" date;
update public."CertificadoAviso" a
   set "validoAte" = c."validoAte"
  from public."CertificadoDigital" c
 where c.id = a."certificadoId" and a."validoAte" is null;

do $$
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'public."CertificadoAviso"'::regclass
                and conname = 'CertificadoAviso_certificadoId_marco_key') then
    alter table public."CertificadoAviso" drop constraint "CertificadoAviso_certificadoId_marco_key";
  end if;
end $$;
create unique index if not exists "CertificadoAviso_cert_validade_marco_key"
  on public."CertificadoAviso"("certificadoId", "validoAte", marco) nulls not distinct;

-- ---------------------------------------------------------------------------
-- 6. CNPJ alfanumérico
-- ---------------------------------------------------------------------------
create or replace function public.cliente_normaliza() returns trigger
language plpgsql as $$
begin
  new."telefoneNormalizado" := public.normalizar_telefone(new.telefone);
  -- CPF: só dígitos. CNPJ: 12 caracteres [0-9A-Z] + 2 dígitos (desde 07/2026).
  new."cpfCnpj" := nullif(regexp_replace(upper(coalesce(new."cpfCnpj", '')), '[^0-9A-Z]', '', 'g'), '');
  new."atualizadoEm" := now();
  return new;
end $$;
