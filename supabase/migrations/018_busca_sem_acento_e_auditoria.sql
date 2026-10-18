-- 018 · Busca sem acento, ruído da auditoria, IP do portal e modelo padrão do aviso
--
-- Idempotente e não destrutiva: cria extensão, funções, índices e uma linha de
-- Config (só se não existir); substitui funções e um gatilho. Nenhuma linha
-- existente é alterada ou apagada (o modelo de aviso já salvo fica como está).
--
--  1. Busca sem acento: normalizar_busca(text) (minúsculas e sem acento) e três
--     RPCs SECURITY INVOKER (a RLS de quem pede vale como num select comum):
--       buscar_clientes(q)  → nome, fantasia, e-mail, CPF/CNPJ e telefone (por
--                             dígitos) e nome de sócio (devolve a empresa);
--       buscar_socios(q)    → sócios pelo nome (a busca global mostra a empresa);
--       buscar_chamados(q)  → chamados pela descrição, tipo ou cliente.
--     Índices trigrama nas expressões normalizadas.
--  2. Cargo: permissões comparadas como CONJUNTO (a ordem não conta) e salvar
--     sem mudar nada não grava auditoria nem mexe em "atualizadoEm".
--  3. Auditoria de Config: rótulo humano para o módulo "Portal do cliente" e
--     para o novo "certificado.modeloPadrao".
--  4. historico_entidade: sem auditoria.ver, o IP (e aparelho) dos detalhes some.
--  5. Config "certificado.modeloPadrao": o modelo padrão do aviso de certificado,
--     lido pela rotina de avisos (crons) e pela prévia da tela. Fonte única.

-- ---------------------------------------------------------------------------
-- 1. Busca sem acento
-- ---------------------------------------------------------------------------
create extension if not exists unaccent with schema extensions;

/** Minúsculas e sem acento. IMMUTABLE para poder virar índice (dicionário fixo). */
create or replace function public.normalizar_busca(p text) returns text
language sql immutable parallel safe as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(p, '')))
$$;

/** Padrão LIKE "%termo%" com %, _ e \ do termo escapados. */
create or replace function public.padrao_busca(p text) returns text
language sql immutable parallel safe as $$
  select '%' || replace(replace(replace(p, '\', '\\'), '%', '\%'), '_', '\_') || '%'
$$;

create index if not exists "Cliente_nome_busca_idx"
  on public."Cliente" using gin (public.normalizar_busca(nome) public.gin_trgm_ops);
create index if not exists "Cliente_fantasia_busca_idx"
  on public."Cliente" using gin (public.normalizar_busca("nomeFantasia") public.gin_trgm_ops);
create index if not exists "Socio_nome_busca_idx"
  on public."Socio" using gin (public.normalizar_busca(nome) public.gin_trgm_ops);

create or replace function public.buscar_clientes(p_q text)
returns setof public."Cliente"
language sql stable security invoker set search_path = public as $$
  with t as (
    select public.padrao_busca(public.normalizar_busca(trim(coalesce(p_q, '')))) as pat,
           regexp_replace(coalesce(p_q, ''), '\D', '', 'g') as dig
  )
  select c.*
    from public."Cliente" c, t
   where length(trim(coalesce(p_q, ''))) >= 1
     and (
          public.normalizar_busca(c.nome) like t.pat
       or public.normalizar_busca(c."nomeFantasia") like t.pat
       or lower(coalesce(c.email, '')) like t.pat
       or (length(t.dig) >= 3 and (
             coalesce(c."cpfCnpj", '') like '%' || t.dig || '%'
          or coalesce(c."telefoneNormalizado", '') like '%' || t.dig || '%'))
       or exists (
            select 1 from public."Socio" s
             where s."clienteId" = c.id
               and (public.normalizar_busca(s.nome) like t.pat
                    or (length(t.dig) >= 3 and coalesce(s.cpf, '') like '%' || t.dig || '%')))
     )
$$;

create or replace function public.buscar_socios(p_q text)
returns setof public."Socio"
language sql stable security invoker set search_path = public as $$
  select s.*
    from public."Socio" s
   where length(trim(coalesce(p_q, ''))) >= 2
     and public.normalizar_busca(s.nome) like public.padrao_busca(public.normalizar_busca(trim(p_q)))
$$;

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
$$;

revoke all on function public.buscar_clientes(text) from public, anon;
revoke all on function public.buscar_socios(text) from public, anon;
revoke all on function public.buscar_chamados(text) from public, anon;
grant execute on function public.buscar_clientes(text) to authenticated;
grant execute on function public.buscar_socios(text) to authenticated;
grant execute on function public.buscar_chamados(text) to authenticated;
grant execute on function public.normalizar_busca(text) to authenticated;
grant execute on function public.padrao_busca(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Cargo: sem auditoria nem "atualizadoEm" quando nada mudou
-- ---------------------------------------------------------------------------
create or replace function public.trg_auditoria_cargo() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_add text;
  v_rem text;
  v_alt jsonb;
begin
  begin
    if tg_op = 'INSERT' then
      perform public.auditoria_registrar('equipe', 'cargo', new.id::text, 'criado',
        'criou o cargo «' || new.nome || '»',
        jsonb_build_object('info', public.auditoria_info('Permissões', coalesce(array_length(new.permissoes, 1), 0)::text)));
    elsif tg_op = 'DELETE' then
      perform public.auditoria_registrar('equipe', 'cargo', old.id::text, 'excluido',
        'excluiu o cargo «' || old.nome || '»');
    else
      -- Conjunto, não lista: a mesma permissão em outra ordem não é mudança.
      if not (coalesce(new.permissoes, '{}') @> coalesce(old.permissoes, '{}')
              and coalesce(old.permissoes, '{}') @> coalesce(new.permissoes, '{}')) then
        select string_agg(p.rotulo, ', ' order by p.ordem) into v_add
          from public."Permissao" p
         where p.chave = any(new.permissoes) and not (p.chave = any(old.permissoes));
        select string_agg(p.rotulo, ', ' order by p.ordem) into v_rem
          from public."Permissao" p
         where p.chave = any(old.permissoes) and not (p.chave = any(new.permissoes));
        if v_add is not null or v_rem is not null then
          perform public.auditoria_registrar('equipe', 'cargo', new.id::text, 'permissoes',
            'alterou as permissões do cargo «' || new.nome || '»',
            jsonb_build_object('info', public.auditoria_info('Passou a poder', v_add, 'Deixou de poder', v_rem)));
        end if;
      end if;
      v_alt := public.auditoria_alteracoes(to_jsonb(old), to_jsonb(new), '{"nome":"Nome","descricao":"Descrição"}'::jsonb);
      if jsonb_array_length(v_alt) > 0 then
        perform public.auditoria_registrar('equipe', 'cargo', new.id::text, 'editado',
          'editou o cargo «' || new.nome || '» (' || public.auditoria_lista_campos(v_alt) || ')',
          jsonb_build_object('alteracoes', v_alt));
      end if;
    end if;
  exception when others then
    raise warning 'trg_auditoria_cargo: %', sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.trg_auditoria_cargo() from public, anon, authenticated;

-- "atualizadoEm" só anda quando algo mudou de fato. O WHEN de um gatilho BEFORE
-- vê o NEW já arrumado por trg_cargo_guard (que roda antes, pela ordem do nome).
drop trigger if exists trg_touch on public."Cargo";
create trigger trg_touch before update on public."Cargo" for each row
  when (old.nome is distinct from new.nome
        or old.descricao is distinct from new.descricao
        or old.sistema is distinct from new.sistema
        or not (coalesce(new.permissoes, '{}') @> coalesce(old.permissoes, '{}')
                and coalesce(old.permissoes, '{}') @> coalesce(new.permissoes, '{}')))
  execute function public.touch_atualizado_em();

-- ---------------------------------------------------------------------------
-- 3. Auditoria de Config: rótulos humanos
-- ---------------------------------------------------------------------------
create or replace function public.trg_auditoria_config() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_chave text;
  v_old jsonb;
  v_new jsonb;
  v_rot jsonb := '{"modulos":"Módulos","marca.logo":"Logo do escritório","aparencia.estilo":"Estilo do painel","certificado.marcos":"Marcos dos avisos de certificado","certificado.sessaoId":"Número que envia os avisos de certificado","certificado.modelo":"Mensagem do aviso de certificado","certificado.modeloPadrao":"Mensagem padrão do aviso de certificado","serpro.ambiente":"Ambiente do Serpro"}'::jsonb;
  v_mod jsonb := '{"whatsapp":"WhatsApp","chamados":"Chamados","clientes":"Clientes e aniversários","certificados":"Certificados digitais","pendenciasFiscais":"Pendências fiscais","equipe":"Equipe","certificadosAvisos":"Avisos automáticos de certificado","aniversarioParabens":"Botão de parabéns de aniversário","portalCliente":"Portal do cliente","chamadoNaConversa":"Abrir chamado na conversa","transferenciaAtendimento":"Transferência de atendimento","loginSemVerificacao":"Entrar só com o e-mail"}'::jsonb;
  v_nome text;
  v_alt jsonb;
  v_sens boolean;
  v_modulo text;
  v_de text;
  v_para text;
begin
  begin
    if tg_op = 'DELETE' then v_chave := old.chave; else v_chave := new.chave; end if;
    if tg_op <> 'INSERT' then v_old := old.valor; end if;
    if tg_op <> 'DELETE' then v_new := new.valor; end if;

    -- Gravou o mesmo valor: nada mudou.
    if tg_op = 'UPDATE' and v_old is not distinct from v_new then
      return null;
    end if;

    v_nome := coalesce(v_rot ->> v_chave, v_chave);
    v_modulo := case when v_chave like 'certificado.%' then 'certificados'
                     when v_chave like 'serpro.%' then 'pendencias'
                     else 'configuracoes' end;
    v_sens := v_chave ~* '(senha|token|secret|segredo|password|pin|api[_-]?key)';

    if v_chave = 'modulos' and tg_op = 'UPDATE'
       and jsonb_typeof(v_old) = 'object' and jsonb_typeof(v_new) = 'object' then
      select coalesce(jsonb_agg(jsonb_build_object(
               'campo', k, 'rotulo', coalesce(v_mod ->> k, k),
               'de', case v_old ->> k when 'true' then 'Ligado' when 'false' then 'Desligado' else coalesce(v_old ->> k, 'padrão') end,
               'para', case v_new ->> k when 'true' then 'Ligado' when 'false' then 'Desligado' else coalesce(v_new ->> k, 'padrão') end)
             order by k), '[]'::jsonb)
        into v_alt
        from (select jsonb_object_keys(v_old) k union select jsonb_object_keys(v_new)) s
       where (v_old -> k) is distinct from (v_new -> k);
      if jsonb_array_length(v_alt) > 0 then
        perform public.auditoria_registrar('configuracoes', 'config', v_chave, 'modulos',
          'mudou os módulos do painel (' || public.auditoria_lista_campos(v_alt) || ')',
          jsonb_build_object('alteracoes', v_alt));
      end if;
    elsif v_chave = 'marca.logo' then
      perform public.auditoria_registrar('configuracoes', 'config', v_chave, 'ajuste',
        case when tg_op = 'DELETE' then 'removeu a logo do escritório' else 'trocou a logo do escritório' end);
    else
      v_de := left(v_old #>> '{}', 500);
      v_para := left(v_new #>> '{}', 500);
      perform public.auditoria_registrar(v_modulo, 'config', v_chave, 'ajuste',
        case when tg_op = 'DELETE' then 'removeu o ajuste «' || v_nome || '»'
             else 'alterou o ajuste «' || v_nome || '»' end,
        case when v_sens or tg_op = 'DELETE' then null
             else jsonb_build_object('alteracoes', public.auditoria_alt(v_chave, v_nome, v_de, v_para)) end);
    end if;
  exception when others then
    raise warning 'trg_auditoria_config: %', sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.trg_auditoria_config() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. historico_entidade: IP só para quem tem auditoria.ver
-- ---------------------------------------------------------------------------
/** Tira dos detalhes os itens de informação internos (IP, aparelho, navegador). */
create or replace function public.auditoria_sem_ip(p jsonb) returns jsonb
language sql immutable as $$
  select case
    when p is null or jsonb_typeof(p -> 'info') is distinct from 'array' then p
    else jsonb_set(p, '{info}', coalesce((
           select jsonb_agg(i order by n)
             from jsonb_array_elements(p -> 'info') with ordinality as x(i, n)
            where coalesce(i ->> 'rotulo', '') not in ('IP', 'Aparelho', 'Navegador')), '[]'::jsonb))
  end
$$;

create or replace function public.historico_entidade(
  p_entidade text, p_id text, p_limite integer default 100, p_antes bigint default null)
returns table (
  id bigint, "criadoEm" timestamptz, "atorId" uuid, "atorNome" text, modulo text,
  entidade text, "entidadeId" text, acao text, resumo text, detalhes jsonb, origem text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_eu uuid := public.eu_colaborador_id();
  v_admin boolean := public.tem_permissao('auditoria.ver');
  v_ok boolean := false;
  v_resp uuid;
  v_cri uuid;
  v_existe boolean;
  v_lim integer := least(greatest(coalesce(p_limite, 100), 1), 500);
begin
  if v_eu is null then
    raise exception 'Acesso não liberado.' using errcode = '42501';
  end if;
  if p_entidade not in ('chamado', 'conversa', 'cliente') then
    raise exception 'Entidade inválida.' using errcode = 'P0001';
  end if;

  if p_entidade = 'chamado' then
    select "responsavelId", "criadoPorId", true into v_resp, v_cri, v_existe
      from public."Solicitacao" where "Solicitacao".id = p_id;
    v_ok := coalesce(v_existe, false) and (public.tem_permissao('chamados.ver') or v_resp = v_eu or v_cri = v_eu);
  elsif p_entidade = 'conversa' then
    select "responsavelId", true into v_resp, v_existe from public."WhatsappChat" where "WhatsappChat".id = p_id;
    v_ok := coalesce(v_existe, false) and public.tem_permissao('whatsapp.ver')
            and (public.tem_permissao('whatsapp.ver_todas') or v_resp is null or v_resp = v_eu);
  else
    v_ok := public.tem_permissao('clientes.ver');
  end if;
  if not (v_ok or v_admin) then
    raise exception 'Sem acesso a este histórico.' using errcode = '42501';
  end if;

  return query
    select e.id, e."criadoEm", e."atorId", e."atorNome", e.modulo, e.entidade, e."entidadeId",
           e.acao, e.resumo,
           case when v_admin then e.detalhes else public.auditoria_sem_ip(e.detalhes) end,
           e.origem
      from public."AuditoriaEvento" e
     where case p_entidade
             when 'chamado' then e."solicitacaoId" = p_id
             when 'conversa' then e."chatId" = p_id
             else e."clienteId" = p_id end
       and (p_antes is null or e.id < p_antes)
       and (p_entidade <> 'cliente' or v_admin or (
             case e.modulo
               when 'whatsapp' then public.tem_permissao('whatsapp.ver')
               when 'chamados' then public.tem_permissao('chamados.ver')
               when 'certificados' then public.tem_permissao('certificados.ver')
               when 'pendencias' then public.tem_alguma(array['serpro.consultar', 'clientes.ver'])
               else true end))
     order by e.id desc
     limit v_lim;
end $$;
revoke all on function public.historico_entidade(text,text,integer,bigint) from public, anon;
grant execute on function public.historico_entidade(text,text,integer,bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Modelo padrão do aviso de certificado (fonte única: crons e tela leem daqui)
-- ---------------------------------------------------------------------------
-- Sem passar pela auditoria: é semente do sistema, não ajuste de alguém.
alter table public."Config" disable trigger trg_auditoria;
insert into public."Config" (chave, valor) values
  ('certificado.modeloPadrao', to_jsonb('Olá, {cliente}! O certificado digital {tipo} vence em {data} ({dias}). Fale com a gente para renovar e não ficar sem emitir notas e guias. NÓS Contabilidade'::text))
on conflict (chave) do nothing;
alter table public."Config" enable trigger trg_auditoria;
