-- 016 · Perfil de cada pessoa da equipe (Equipe > pessoa, rota /equipe/:id)
--
-- Idempotente e não destrutiva: só cria índices (`if not exists`), funções
-- (`create or replace`) e um gatilho que COMPLETA o evento de login com o IP.
-- Nenhuma linha existente é alterada ou apagada.
--
-- Quem vê o quê (a regra mora aqui, não na tela):
--   - quem tem `auditoria.ver` (Administrador) vê o perfil de qualquer pessoa,
--     com tudo: atividade, atendimentos, chamados, mensagens enviadas, acessos
--     e as sessões abertas;
--   - qualquer pessoa ativa vê o PRÓPRIO perfil: os números, a própria
--     atividade, os atendimentos e chamados dela, a contagem de mensagens e os
--     próprios logins. As mensagens listadas são só as das conversas que ela
--     ainda enxerga (mesma regra da RLS de WhatsappMensagem); as sessões
--     abertas (aparelho e IP de cada uma) ficam só para o administrador;
--   - o resto recebe 42501 (o PostgREST responde 403) em toda RPC.
--   - "Encerrar sessões" de alguém: `equipe.gerenciar`, nunca em si mesmo.
--
--  1. Índices para as contas por pessoa (auditoria, mensagens, atendimento,
--     chamados, consultas fiscais).
--  2. IP no evento "entrou no painel" que vem do navegador (registrar_login e
--     registrar_login_google): gatilho BEFORE INSERT só em acesso/login, com a
--     mesma regra de IP confiável das Edge Functions (_shared/client-ip.ts).
--  3. RPCs (security definer, conferem o acesso por dentro):
--     perfil_colaborador, perfil_kpis, perfil_atividade, perfil_atendimentos,
--     perfil_chamados, perfil_mensagens, perfil_sessoes, perfil_encerrar_sessoes.

-- ---------------------------------------------------------------------------
-- 1. Índices
-- ---------------------------------------------------------------------------
create index if not exists "AuditoriaEvento_ator_criadoEm_idx"
  on public."AuditoriaEvento"("atorId", "criadoEm" desc) where "atorId" is not null;
create index if not exists "AuditoriaEvento_ator_modulo_idx"
  on public."AuditoriaEvento"("atorId", modulo, acao, "criadoEm" desc) where "atorId" is not null;
create index if not exists "WhatsappMensagem_enviadoPor_ts_idx"
  on public."WhatsappMensagem"("enviadoPorUserId", "timestamp" desc) where "enviadoPorUserId" is not null;
create index if not exists "AtendimentoTransferencia_porId_criadoEm_idx"
  on public."AtendimentoTransferencia"("porId", "criadoEm" desc);
create index if not exists "AtendimentoTransferencia_paraId_criadoEm_idx"
  on public."AtendimentoTransferencia"("paraId", "criadoEm" desc);
create index if not exists "AtendimentoTransferencia_deId_criadoEm_idx"
  on public."AtendimentoTransferencia"("deId", "criadoEm" desc);
create index if not exists "Solicitacao_responsavelId_idx"
  on public."Solicitacao"("responsavelId", status);
create index if not exists "Solicitacao_criadoPorId_idx"
  on public."Solicitacao"("criadoPorId", "criadoEm" desc);
create index if not exists "ConsultaFiscal_porId_criadoEm_idx"
  on public."ConsultaFiscal"("porId", "criadoEm" desc) where "porId" is not null;

-- ---------------------------------------------------------------------------
-- 2. IP no login feito pelo navegador
-- ---------------------------------------------------------------------------
-- O X-Forwarded-For é uma lista que cada proxy acrescenta no fim; o começo é o
-- que o cliente mandou (forjável). Cadeia: navegador → Traefik → api-gw →
-- PostgREST, então o IP confiável é o PENÚLTIMO (igual a _shared/client-ip.ts).
-- O login só com e-mail (function `entrar`) já grava o IP: aqui não mexe.
create or replace function public.trg_auditoria_login_ip() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_xff text;
  v_partes text[];
  v_n integer;
  v_ip text;
begin
  begin
    if new.modulo <> 'acesso' or new.acao <> 'login' then return new; end if;
    if coalesce(auth.role(), '') <> 'authenticated' then return new; end if;
    if exists (select 1 from jsonb_array_elements(coalesce(new.detalhes -> 'info', '[]'::jsonb)) i
                where i ->> 'rotulo' = 'IP') then
      return new;
    end if;
    v_xff := current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for';
    v_partes := array(select trim(x) from unnest(string_to_array(coalesce(v_xff, ''), ',')) x where trim(x) <> '');
    v_n := coalesce(array_length(v_partes, 1), 0);
    if v_n = 0 then return new; end if;
    v_ip := left(v_partes[greatest(v_n - 1, 1)], 64);
    new.detalhes := jsonb_set(coalesce(new.detalhes, '{}'::jsonb), '{info}',
      coalesce(new.detalhes -> 'info', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('rotulo', 'IP', 'valor', v_ip)));
  exception when others then
    raise warning 'trg_auditoria_login_ip: %', sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.trg_auditoria_login_ip() from public, anon, authenticated;
drop trigger if exists trg_auditoria_login_ip on public."AuditoriaEvento";
create trigger trg_auditoria_login_ip before insert on public."AuditoriaEvento"
  for each row when (new.modulo = 'acesso') execute function public.trg_auditoria_login_ip();

-- ---------------------------------------------------------------------------
-- 3. RPCs do perfil
-- ---------------------------------------------------------------------------

/** Barra quem não pode ver o perfil. Não conta a quem não é admin se a pessoa existe. */
create or replace function public.perfil_exigir(p_colab uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  v_eu uuid := public.eu_colaborador_id();
begin
  if v_eu is null then
    raise exception 'Acesso não liberado.' using errcode = '42501';
  end if;
  if p_colab is distinct from v_eu and not public.tem_permissao('auditoria.ver') then
    raise exception 'Sem acesso ao perfil desta pessoa.' using errcode = '42501';
  end if;
  if not exists (select 1 from public."Colaborador" where id = p_colab) then
    raise exception 'Pessoa não encontrada.' using errcode = 'P0002';
  end if;
end $$;
revoke all on function public.perfil_exigir(uuid) from public, anon, authenticated;

/** Evento de atendimento (linhas antigas sem `evento`: deduz pelo de/para). */
create or replace function public.perfil_evento_atendimento(
  p_evento text, p_de uuid, p_para uuid, p_por uuid) returns text
language sql immutable as $$
  select coalesce(p_evento, case
    when p_para is null then 'devolveu'
    when p_para = p_por and p_de is null then 'assumiu'
    when p_para = p_por then 'tomou'
    else 'transferiu' end) $$;
revoke all on function public.perfil_evento_atendimento(text, uuid, uuid, uuid) from public, anon, authenticated;

/** Cabeçalho do perfil: quem é, cargo, desde quando, último acesso, sessões. */
create or replace function public.perfil_colaborador(p_colab uuid)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare
  v_eu uuid := public.eu_colaborador_id();
  v_admin boolean;
  v_c public."Colaborador";
  v_cargo public."Cargo";
  v_sign timestamptz;
  v_login timestamptz;
  v_evento timestamptz;
  v_msg timestamptz;
  v_sessao timestamptz;
  v_sessoes integer;
begin
  perform public.perfil_exigir(p_colab);
  v_admin := public.tem_permissao('auditoria.ver');
  select * into v_c from public."Colaborador" where id = p_colab;
  select * into v_cargo from public."Cargo" where id = v_c."cargoId";

  select "criadoEm" into v_login from public."AuditoriaEvento"
   where "atorId" = p_colab and modulo = 'acesso' and acao = 'login'
   order by "criadoEm" desc limit 1;
  select "criadoEm" into v_evento from public."AuditoriaEvento"
   where "atorId" = p_colab order by "criadoEm" desc limit 1;
  select "timestamp" into v_msg from public."WhatsappMensagem"
   where "enviadoPorUserId" = p_colab order by "timestamp" desc limit 1;
  if v_c."userId" is not null then
    select last_sign_in_at into v_sign from auth.users where id = v_c."userId";
    select max(s.updated_at), count(*) into v_sessao, v_sessoes
      from auth.sessions s
     where s.user_id = v_c."userId" and (s.not_after is null or s.not_after > now());
  end if;

  return jsonb_build_object(
    'id', v_c.id,
    'nome', v_c.nome,
    'email', v_c.email,
    'telefone', v_c.telefone,
    'cor', v_c.cor,
    'ativo', v_c.ativo,
    'cargo', v_cargo.nome,
    'cargoSistema', coalesce(v_cargo.sistema, false),
    'criadoEm', v_c."criadoEm",
    'temLogin', v_c."userId" is not null,
    'ultimoLogin', v_login,
    'ultimoSignIn', v_sign,
    -- Última coisa que a pessoa fez: evento, mensagem enviada ou sessão renovada.
    'ultimaAtividade', greatest(v_evento, v_msg, v_sessao),
    'sessoesAtivas', case when v_admin then coalesce(v_sessoes, 0) end,
    'proprio', v_c.id = v_eu,
    'verTudo', v_admin,
    'podeEncerrarSessoes', public.tem_permissao('equipe.gerenciar') and v_c.id <> v_eu and v_c."userId" is not null);
end $$;

/** Números do período [p_de, p_ate). Conversas e chamados "agora" ignoram o período. */
create or replace function public.perfil_kpis(p_colab uuid, p_de timestamptz, p_ate timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_r jsonb;
begin
  perform public.perfil_exigir(p_colab);
  if p_de is null or p_ate is null or p_ate <= p_de then
    raise exception 'Período inválido.' using errcode = 'P0001';
  end if;
  if p_ate - p_de > interval '400 days' then
    raise exception 'Período longo demais (máximo de 400 dias).' using errcode = 'P0001';
  end if;

  with atend as (
    select public.perfil_evento_atendimento(t.evento, t."deId", t."paraId", t."porId") as ev,
           t."porId", t."paraId"
      from public."AtendimentoTransferencia" t
     where t."criadoEm" >= p_de and t."criadoEm" < p_ate
       and (t."porId" = p_colab or t."paraId" = p_colab)
  ),
  -- Conversas em que a pessoa respondeu no período (e o dia seguinte, para a resposta que cruza a meia-noite).
  conversas as (
    select distinct m."tenantId", m."sessaoId", m."chatId"
      from public."WhatsappMensagem" m
     where m."enviadoPorUserId" = p_colab and m."fromMe"
       and m."timestamp" >= p_de and m."timestamp" < p_ate + interval '24 hours'
  ),
  -- 1ª resposta (aproximada, a mesma conta do Início): por conversa e por dia,
  -- a 1ª mensagem do cliente e a 1ª nossa depois dela (até 24 h). Conta para a
  -- pessoa quando essa 1ª resposta foi dela.
  primeira as (
    select distinct on (m."sessaoId", m."chatId", (m."timestamp" at time zone 'America/Sao_Paulo')::date)
           m."tenantId", m."sessaoId", m."chatId", m."timestamp" as em
      from public."WhatsappMensagem" m
      join conversas c on c."tenantId" = m."tenantId" and c."sessaoId" = m."sessaoId" and c."chatId" = m."chatId"
     where not m."fromMe" and m."timestamp" >= p_de and m."timestamp" < p_ate
     order by m."sessaoId", m."chatId", (m."timestamp" at time zone 'America/Sao_Paulo')::date, m."timestamp"
  ),
  respostas as (
    select extract(epoch from r.em - p.em) as seg
      from primeira p
      join lateral (
        select x."timestamp" as em, x."enviadoPorUserId" as por
          from public."WhatsappMensagem" x
         where x."tenantId" = p."tenantId" and x."sessaoId" = p."sessaoId" and x."chatId" = p."chatId"
           and x."fromMe" and x."timestamp" > p.em and x."timestamp" < p.em + interval '24 hours'
           and coalesce(x.origem, 'humano') <> 'sistema'
         order by x."timestamp" limit 1) r on true
     where r.por = p_colab
  )
  select jsonb_build_object(
    'conversasAgora', (select count(*) from public."WhatsappChat" c
                        where c."responsavelId" = p_colab and c."atendimentoStatus" = 'em_atendimento'
                          and c."apagadoEm" is null),
    'assumidas', (select count(*) from atend where "porId" = p_colab and ev in ('assumiu', 'tomou', 'reabriu')),
    'recebidas', (select count(*) from atend where ev = 'transferiu' and "paraId" = p_colab and "porId" is distinct from p_colab),
    'transferidas', (select count(*) from atend where "porId" = p_colab and ev = 'transferiu'),
    'devolvidas', (select count(*) from atend where "porId" = p_colab and ev = 'devolveu'),
    'finalizadas', (select count(*) from atend where "porId" = p_colab and ev = 'finalizou'),
    'mensagensEnviadas', (select count(*) from public."WhatsappMensagem" m
                           where m."enviadoPorUserId" = p_colab and m."fromMe"
                             and m."timestamp" >= p_de and m."timestamp" < p_ate),
    'primeiraResposta', (select jsonb_build_object(
                           'mediaMin', round((avg(seg) / 60)::numeric, 1),
                           'medianaMin', round((percentile_cont(0.5) within group (order by seg) / 60)::numeric, 1),
                           'respondidas', count(*))
                           from respostas),
    'chamadosAbertosPorEle', (select count(*) from public."Solicitacao" s
                               where s."criadoPorId" = p_colab and s."criadoEm" >= p_de and s."criadoEm" < p_ate),
    'chamadosResponsavel', (select jsonb_build_object(
                              'abertos', count(*) filter (where s.status in ('aberta', 'em_andamento')),
                              'atrasados', count(*) filter (where s.status in ('aberta', 'em_andamento') and s.prazo < v_hoje),
                              'concluidos', count(*) filter (where s.status = 'concluida'
                                                               and s."concluidaEm" >= p_de and s."concluidaEm" < p_ate))
                              from public."Solicitacao" s where s."responsavelId" = p_colab),
    'clientesCadastrados', (select count(*) from public."AuditoriaEvento" e
                             where e."atorId" = p_colab and e.modulo = 'clientes' and e.entidade = 'cliente'
                               and e.acao = 'criado' and e."criadoEm" >= p_de and e."criadoEm" < p_ate),
    'clientesEditados', (select count(distinct e."entidadeId") from public."AuditoriaEvento" e
                          where e."atorId" = p_colab and e.modulo = 'clientes'
                            and e.acao in ('editado', 'provisorio_completado', 'ativado', 'desativado')
                            and e."criadoEm" >= p_de and e."criadoEm" < p_ate),
    'consultasSerpro', (select count(*) from public."ConsultaFiscal" f
                         where f."porId" = p_colab and f.origem is distinct from 'agendamento'
                           and f."criadoEm" >= p_de and f."criadoEm" < p_ate),
    'logins', (select count(*) from public."AuditoriaEvento" e
                where e."atorId" = p_colab and e.modulo = 'acesso' and e.acao = 'login'
                  and e."criadoEm" >= p_de and e."criadoEm" < p_ate),
    'eventos', (select count(*) from public."AuditoriaEvento" e
                 where e."atorId" = p_colab and e."criadoEm" >= p_de and e."criadoEm" < p_ate)
  ) into v_r;
  return v_r;
end $$;

/** Tudo o que a pessoa fez (auditoria em que ela é o ator), mais novo primeiro. */
create or replace function public.perfil_atividade(
  p_colab uuid, p_de timestamptz default null, p_ate timestamptz default null,
  p_modulo text default null, p_acao text default null,
  p_limite integer default 50, p_antes bigint default null)
returns table (
  id bigint, "criadoEm" timestamptz, "atorId" uuid, "atorNome" text, modulo text,
  entidade text, "entidadeId" text, acao text, resumo text, detalhes jsonb, origem text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_lim integer := least(greatest(coalesce(p_limite, 50), 1), 1000);
begin
  perform public.perfil_exigir(p_colab);
  return query
    select e.id, e."criadoEm", e."atorId", e."atorNome", e.modulo, e.entidade, e."entidadeId",
           e.acao, e.resumo, e.detalhes, e.origem
      from public."AuditoriaEvento" e
     where e."atorId" = p_colab
       and (p_antes is null or e.id < p_antes)
       and (p_de is null or e."criadoEm" >= p_de)
       and (p_ate is null or e."criadoEm" < p_ate)
       and (p_modulo is null or e.modulo = p_modulo)
       and (p_acao is null or e.acao = p_acao)
     order by e.id desc
     limit v_lim;
end $$;

/** Conversas com a pessoa agora + histórico de assumir/transferir/finalizar em que ela aparece. */
create or replace function public.perfil_atendimentos(
  p_colab uuid, p_limite integer default 50, p_antes timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_lim integer := least(greatest(coalesce(p_limite, 50), 1), 200);
begin
  perform public.perfil_exigir(p_colab);
  return jsonb_build_object(
    'agora', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'sessaoId', c."sessaoId", 'chatId', c."chatId", 'tipo', c.tipo,
               'nome', public.auditoria_chat_nome(c.id),
               'cliente', public.auditoria_cliente_nome(c."clienteId"),
               'conexao', public.auditoria_sessao_nome(c."sessaoId"),
               'desde', c."atendimentoEm",
               'ultimaMensagemEm', c."ultimaMensagemEm",
               'ultimaMensagemFromMe', c."ultimaMensagemFromMe",
               'naoLidas', c."naoLidas")
             order by c."ultimaMensagemEm" desc nulls last)
        from public."WhatsappChat" c
       where c."responsavelId" = p_colab and c."atendimentoStatus" = 'em_atendimento' and c."apagadoEm" is null),
      '[]'::jsonb),
    'historico', coalesce((
      select jsonb_agg(x.h order by x.em desc)
        from (
          select jsonb_build_object(
                   'id', t.id, 'em', t."criadoEm",
                   'evento', public.perfil_evento_atendimento(t.evento, t."deId", t."paraId", t."porId"),
                   'chatRowId', t."chatId", 'sessaoId', c."sessaoId", 'chatId', c."chatId",
                   'conversa', coalesce(public.auditoria_chat_nome(t."chatId"), 'conversa apagada'),
                   'porId', t."porId", 'por', public.auditoria_colab_nome(t."porId"),
                   'deId', t."deId", 'de', public.auditoria_colab_nome(t."deId"),
                   'paraId', t."paraId", 'para', public.auditoria_colab_nome(t."paraId"),
                   'motivo', t.motivo) as h, t."criadoEm" as em
            from public."AtendimentoTransferencia" t
            left join public."WhatsappChat" c on c.id = t."chatId"
           where (t."porId" = p_colab or t."deId" = p_colab or t."paraId" = p_colab)
             and (p_antes is null or t."criadoEm" < p_antes)
           order by t."criadoEm" desc
           limit v_lim) x),
      '[]'::jsonb));
end $$;

/** Chamados que a pessoa abriu ou dos quais é responsável (os em aberto primeiro). */
create or replace function public.perfil_chamados(p_colab uuid, p_limite integer default 200)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_lim integer := least(greatest(coalesce(p_limite, 200), 1), 500);
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  perform public.perfil_exigir(p_colab);
  return coalesce((
    select jsonb_agg(x.j order by x.aberto desc, x."criadoEm" desc)
      from (
        select s."criadoEm", s.status in ('aberta', 'em_andamento') as aberto,
               jsonb_build_object(
                 'id', s.id, 'tipo', coalesce(tp.nome, 'Chamado'),
                 'cliente', public.auditoria_cliente_nome(s."clienteId"),
                 'descricao', left(s.descricao, 200), 'status', s.status, 'prazo', s.prazo,
                 'criadoEm', s."criadoEm", 'concluidaEm', s."concluidaEm", 'origem', s.origem,
                 'criadoPorId', s."criadoPorId", 'criadoPor', public.auditoria_colab_nome(s."criadoPorId"),
                 'responsavelId', s."responsavelId", 'responsavel', public.auditoria_colab_nome(s."responsavelId"),
                 'atrasado', s.status in ('aberta', 'em_andamento') and s.prazo < v_hoje,
                 'criou', s."criadoPorId" = p_colab,
                 'responsavelEle', s."responsavelId" = p_colab) as j
          from public."Solicitacao" s
          left join public."SolicitacaoTipo" tp on tp.id = s."tipoId"
         where s."criadoPorId" = p_colab or s."responsavelId" = p_colab
         order by (s.status in ('aberta', 'em_andamento')) desc, s."criadoEm" desc
         limit v_lim) x),
    '[]'::jsonb);
end $$;

/**
 * Mensagens que a pessoa enviou: total por dia do período e as últimas (só
 * leitura). Texto de conversa alheia só para quem tem auditoria.ver ou
 * whatsapp.ver_todas; no próprio perfil, sem essas, só as conversas que a
 * pessoa ainda enxerga (sem responsável ou dela).
 */
create or replace function public.perfil_mensagens(
  p_colab uuid, p_de timestamptz, p_ate timestamptz, p_limite integer default 50)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_eu uuid := public.eu_colaborador_id();
  v_lim integer := least(greatest(coalesce(p_limite, 50), 1), 200);
  v_todas boolean;
  v_tz text := 'America/Sao_Paulo';
begin
  perform public.perfil_exigir(p_colab);
  if p_de is null or p_ate is null or p_ate <= p_de or p_ate - p_de > interval '400 days' then
    raise exception 'Período inválido.' using errcode = 'P0001';
  end if;
  v_todas := public.tem_alguma(array['auditoria.ver', 'whatsapp.ver_todas']);

  return jsonb_build_object(
    'porDia', (
      select coalesce(jsonb_agg(jsonb_build_object('dia', d.dia, 'total', coalesce(n.total, 0)) order by d.dia), '[]'::jsonb)
        from (select g::date as dia
                from generate_series((p_de at time zone v_tz)::date, ((p_ate - interval '1 second') at time zone v_tz)::date,
                                     interval '1 day') g) d
        left join (
          select (m."timestamp" at time zone v_tz)::date as dia, count(*) as total
            from public."WhatsappMensagem" m
           where m."enviadoPorUserId" = p_colab and m."fromMe"
             and m."timestamp" >= p_de and m."timestamp" < p_ate
           group by 1) n on n.dia = d.dia),
    'ultimas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'tipo', m.tipo, 'texto', left(m.texto, 280),
               'arquivo', m."mediaNomeArquivo", 'em', m."timestamp", 'apagada', m."apagadoEm" is not null,
               'chatRowId', c.id, 'sessaoId', m."sessaoId", 'chatId', m."chatId",
               'conversa', coalesce(public.auditoria_chat_nome(c.id), 'conversa apagada'))
             order by m."timestamp" desc)
        from (
          select m.* from public."WhatsappMensagem" m
           where m."enviadoPorUserId" = p_colab and m."fromMe"
             and m."timestamp" >= p_de and m."timestamp" < p_ate
             and (v_todas or exists (
                   select 1 from public."WhatsappChat" c2
                    where c2."tenantId" = m."tenantId" and c2."sessaoId" = m."sessaoId" and c2."chatId" = m."chatId"
                      and public.tem_permissao('whatsapp.ver')
                      and (c2."responsavelId" is null or c2."responsavelId" = v_eu)))
           order by m."timestamp" desc
           limit v_lim) m
        left join public."WhatsappChat" c
          on c."tenantId" = m."tenantId" and c."sessaoId" = m."sessaoId" and c."chatId" = m."chatId"),
      '[]'::jsonb),
    'restrito', not v_todas);
end $$;

/** Sessões abertas no Auth (aparelho, IP, última atividade). Só administrador. */
create or replace function public.perfil_sessoes(p_colab uuid)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare
  v_user uuid;
begin
  perform public.perfil_exigir(p_colab);
  if not public.tem_permissao('auditoria.ver') then
    raise exception 'Sem permissão (auditoria.ver).' using errcode = '42501';
  end if;
  select "userId" into v_user from public."Colaborador" where id = p_colab;
  if v_user is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'criadaEm', s.created_at, 'atividadeEm', s.updated_at,
             'navegador', left(s.user_agent, 300), 'ip', host(s.ip), 'aal', s.aal::text)
           order by s.updated_at desc nulls last)
      from auth.sessions s
     where s.user_id = v_user and (s.not_after is null or s.not_after > now())),
    '[]'::jsonb);
end $$;

/**
 * Encerra as sessões da pessoa (todos os aparelhos precisam entrar de novo).
 * Mesma peça que a desativação usa (revogar_sessoes). O acesso já emitido
 * vale até expirar (até 1 h); depois disso não renova. Fica na auditoria.
 */
create or replace function public.perfil_encerrar_sessoes(p_colab uuid)
returns integer language plpgsql security definer set search_path = public, auth as $$
declare
  v_eu uuid := public.eu_colaborador_id();
  v_c public."Colaborador";
  v_n integer;
begin
  if v_eu is null then
    raise exception 'Acesso não liberado.' using errcode = '42501';
  end if;
  if not public.tem_permissao('equipe.gerenciar') then
    raise exception 'Sem permissão (equipe.gerenciar).' using errcode = '42501';
  end if;
  if p_colab = v_eu then
    raise exception 'Para sair dos seus aparelhos, use Sair em cada um.' using errcode = 'P0001';
  end if;
  select * into v_c from public."Colaborador" where id = p_colab;
  if not found then
    raise exception 'Pessoa não encontrada.' using errcode = 'P0002';
  end if;
  if v_c."userId" is null then
    raise exception 'Esta pessoa não tem login.' using errcode = 'P0001';
  end if;
  v_n := public.revogar_sessoes(v_c."userId");
  perform public.auditoria_registrar('equipe', 'colaborador', v_c.id::text, 'sessoes_encerradas',
    'encerrou as sessões de ' || v_c.nome,
    jsonb_build_object('info', public.auditoria_info('Sessões encerradas', v_n::text)),
    'painel', null, null, null, v_eu);
  return v_n;
end $$;

revoke all on function public.perfil_colaborador(uuid) from public, anon;
revoke all on function public.perfil_kpis(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.perfil_atividade(uuid, timestamptz, timestamptz, text, text, integer, bigint) from public, anon;
revoke all on function public.perfil_atendimentos(uuid, integer, timestamptz) from public, anon;
revoke all on function public.perfil_chamados(uuid, integer) from public, anon;
revoke all on function public.perfil_mensagens(uuid, timestamptz, timestamptz, integer) from public, anon;
revoke all on function public.perfil_sessoes(uuid) from public, anon;
revoke all on function public.perfil_encerrar_sessoes(uuid) from public, anon;
grant execute on function public.perfil_colaborador(uuid) to authenticated;
grant execute on function public.perfil_kpis(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.perfil_atividade(uuid, timestamptz, timestamptz, text, text, integer, bigint) to authenticated;
grant execute on function public.perfil_atendimentos(uuid, integer, timestamptz) to authenticated;
grant execute on function public.perfil_chamados(uuid, integer) to authenticated;
grant execute on function public.perfil_mensagens(uuid, timestamptz, timestamptz, integer) to authenticated;
grant execute on function public.perfil_sessoes(uuid) to authenticated;
grant execute on function public.perfil_encerrar_sessoes(uuid) to authenticated;
