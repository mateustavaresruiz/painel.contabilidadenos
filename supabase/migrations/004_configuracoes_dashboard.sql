-- ===========================================================================
-- 004: Configurações (papel do colaborador, módulos, marca) e Visão geral
-- (RPCs agregadas do dashboard e da saúde do sistema).
--
-- 🔴 Continua SEM LOGIN (ver 001). O papel 'admin' é um portão de TELA, não
-- de segurança: quem abre o painel pode escolher qualquer colaborador no
-- "Quem é você?". A proteção de acesso segue sendo a senha do domínio.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Papel do colaborador
-- ---------------------------------------------------------------------------
alter table public."Colaborador"
  add column if not exists papel text not null default 'atendente';
do $$ begin
  alter table public."Colaborador"
    add constraint "Colaborador_papel_check" check (papel in ('admin','atendente'));
exception when duplicate_object then null; end $$;

-- Quem já existe: sem nenhum admin, o mais antigo ativo vira admin.
update public."Colaborador" set papel = 'admin'
 where id = (select id from public."Colaborador" where ativo order by "criadoEm" limit 1)
   and not exists (select 1 from public."Colaborador" where papel = 'admin' and ativo);

-- Primeiro colaborador cadastrado (ou o primeiro depois que não sobrou admin
-- ativo) vira admin sozinho: o "Quem é você?" do primeiro acesso não precisa
-- saber disso.
create or replace function public.colaborador_papel_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.ativo and not exists (
      select 1 from public."Colaborador" where papel = 'admin' and ativo
    ) then
      new.papel := 'admin';
    end if;
    return new;
  end if;

  -- UPDATE: não deixa o escritório sem nenhum admin ativo.
  if old.papel = 'admin' and old.ativo and (new.papel <> 'admin' or not new.ativo)
     and not exists (
       select 1 from public."Colaborador"
        where papel = 'admin' and ativo and id <> old.id
     ) then
    raise exception 'Precisa haver pelo menos um administrador ativo na equipe.'
      using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function public.colaborador_papel_guard_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.papel = 'admin' and old.ativo and not exists (
    select 1 from public."Colaborador" where papel = 'admin' and ativo and id <> old.id
  ) and exists (select 1 from public."Colaborador" where id <> old.id and ativo) then
    raise exception 'Precisa haver pelo menos um administrador ativo na equipe.'
      using errcode = 'P0001';
  end if;
  return old;
end $$;

drop trigger if exists trg_colaborador_papel on public."Colaborador";
create trigger trg_colaborador_papel before insert or update on public."Colaborador"
  for each row execute function public.colaborador_papel_guard();
drop trigger if exists trg_colaborador_papel_del on public."Colaborador";
create trigger trg_colaborador_papel_del before delete on public."Colaborador"
  for each row execute function public.colaborador_papel_guard_delete();

-- ---------------------------------------------------------------------------
-- Módulos (liga/desliga) e marca
-- ---------------------------------------------------------------------------
insert into public."Config" (chave, valor) values
  ('modulos', '{
     "whatsapp": true, "chamados": true, "clientes": true, "certificados": true,
     "pendenciasFiscais": true, "equipe": true,
     "certificadosAvisos": true, "aniversarioParabens": true,
     "chamadoNaConversa": true, "transferenciaAtendimento": true
   }'::jsonb),
  ('marca.logo', 'null'::jsonb)
on conflict (chave) do nothing;

-- Nome do escritório editável pela tela (só a coluna nome).
do $$ begin
  create policy painel_update on public."Tenant" for update to anon, authenticated
    using (true) with check (true);
exception when duplicate_object then null; end $$;
revoke update on public."Tenant" from anon, authenticated;
grant update (nome) on public."Tenant" to anon, authenticated;

-- Logo do escritório: bucket PÚBLICO (é a marca, aparece no menu).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marca', 'marca', true, 2097152, array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict (id) do nothing;

do $$ begin
  create policy marca_select on storage.objects for select to anon, authenticated
    using (bucket_id = 'marca');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy marca_insert on storage.objects for insert to anon, authenticated
    with check (bucket_id = 'marca');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy marca_update on storage.objects for update to anon, authenticated
    using (bucket_id = 'marca') with check (bucket_id = 'marca');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy marca_delete on storage.objects for delete to anon, authenticated
    using (bucket_id = 'marca');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Saúde do sistema (Configurações > Integrações / Sistema e faixa do dashboard).
-- Security definer porque lê _migracao, cron.* e ErrorLog, que a tela não
-- alcança. Não devolve segredo nenhum (o comando do job é omitido).
-- ---------------------------------------------------------------------------
create or replace function public.painel_saude()
returns jsonb language sql stable security definer set search_path = public, cron as $$
  select jsonb_build_object(
    'agora', now(),
    'migracoes', coalesce((
      select jsonb_agg(jsonb_build_object('nome', m.nome, 'aplicadaEm', m."aplicadaEm") order by m.nome)
        from public._migracao m), '[]'::jsonb),
    'tabelas', jsonb_build_object(
      'Colaborador',        (select count(*) from public."Colaborador"),
      'Cliente',            (select count(*) from public."Cliente"),
      'Socio',              (select count(*) from public."Socio"),
      'WhatsappSessao',     (select count(*) from public."WhatsappSessao"),
      'WhatsappChat',       (select count(*) from public."WhatsappChat"),
      'WhatsappMensagem',   (select count(*) from public."WhatsappMensagem"),
      'Solicitacao',        (select count(*) from public."Solicitacao"),
      'CertificadoDigital', (select count(*) from public."CertificadoDigital"),
      'ConsultaFiscal',     (select count(*) from public."ConsultaFiscal"),
      'ErrorLog',           (select count(*) from public."ErrorLog")
    ),
    'erros24h', (select count(*) from public."ErrorLog"
                  where nivel = 'error' and "criadoEm" > now() - interval '24 hours'),
    'crons', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nome', j.jobname, 'agenda', j.schedule, 'ativo', j.active,
               'ultimaExecucao', r.start_time, 'fimExecucao', r.end_time,
               'status', r.status, 'mensagem', left(r.return_message, 300),
               'falhas24h', (select count(*) from cron.job_run_details f
                              where f.jobid = j.jobid and f.status = 'failed'
                                and f.start_time > now() - interval '24 hours'))
             order by j.jobname)
        from cron.job j
        left join lateral (
          select d.start_time, d.end_time, d.status, d.return_message
            from cron.job_run_details d where d.jobid = j.jobid
           order by d.start_time desc limit 1) r on true), '[]'::jsonb)
  )
$$;
revoke all on function public.painel_saude() from public;
grant execute on function public.painel_saude() to anon, authenticated;

-- Últimos erros das functions (lista só-leitura em Configurações > Sistema).
-- O contexto já é gravado com os segredos mascarados (_shared/error-log.ts).
create or replace function public.painel_erros(p_limite integer default 50)
returns table (id bigint, origem text, nivel text, mensagem text, stack text,
               contexto jsonb, rota text, status integer, "duracaoMs" integer, "criadoEm" timestamptz)
language sql stable security definer set search_path = public as $$
  select e.id, e.origem, e.nivel, left(e.mensagem, 2000), left(e.stack, 4000),
         e.contexto, e.rota, e.status, e."duracaoMs", e."criadoEm"
    from public."ErrorLog" e
   order by e."criadoEm" desc
   limit least(greatest(coalesce(p_limite, 50), 1), 200)
$$;
revoke all on function public.painel_erros(integer) from public;
grant execute on function public.painel_erros(integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Visão geral: um jsonb com tudo que o dashboard mostra, agregado aqui.
-- Datas "do dia" no fuso de São Paulo.
-- ---------------------------------------------------------------------------
create index if not exists "WhatsappMensagem_timestamp_idx"
  on public."WhatsappMensagem"("timestamp");
create index if not exists "Solicitacao_concluidaEm_idx"
  on public."Solicitacao"("concluidaEm") where "concluidaEm" is not null;
create index if not exists "CertificadoAviso_criadoEm_idx"
  on public."CertificadoAviso"("criadoEm");
create index if not exists "ConsultaFiscal_criadoEm_idx"
  on public."ConsultaFiscal"("criadoEm");

create or replace function public.painel_dashboard(p_de timestamptz, p_ate timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_tz text := 'America/Sao_Paulo';
  v_atend jsonb;
  v_cham jsonb;
  v_cli jsonb;
  v_cert jsonb;
  v_aniv jsonb;
  v_fisc jsonb;
begin
  if p_de is null or p_ate is null or p_ate <= p_de then
    raise exception 'período inválido';
  end if;
  if p_ate - p_de > interval '400 days' then
    raise exception 'período longo demais (máx. 400 dias)';
  end if;

  -- ---------------- Atendimento ----------------
  with msgs as (
    select m."chatId", m."sessaoId", m."fromMe", m."timestamp",
           (m."timestamp" at time zone v_tz)::date as dia
      from public."WhatsappMensagem" m
     where m."timestamp" >= p_de and m."timestamp" < p_ate
       and m."apagadoEm" is null
       and m."chatId" not like '%@g.us'
       and m."chatId" not like '%@newsletter'
       and m."chatId" <> 'status@broadcast'
       and coalesce(m.origem, 'humano') <> 'sistema'
  ),
  dias as (
    select d::date as dia
      from generate_series((p_de at time zone v_tz)::date,
                           ((p_ate - interval '1 microsecond') at time zone v_tz)::date,
                           interval '1 day') d
  ),
  por_dia as (
    select d.dia,
           count(m.*) filter (where not m."fromMe") as recebidas,
           count(m.*) filter (where m."fromMe") as enviadas
      from dias d left join msgs m on m.dia = d.dia
     group by d.dia
  ),
  -- 1ª resposta (aproximada): por conversa e por dia, a 1ª mensagem do
  -- cliente e a 1ª nossa depois dela (até 24h). Sem resposta não entra na média.
  primeira as (
    select distinct on (m."sessaoId", m."chatId", m.dia)
           m."sessaoId", m."chatId", m.dia, m."timestamp" as em
      from msgs m where not m."fromMe"
     order by m."sessaoId", m."chatId", m.dia, m."timestamp"
  ),
  respostas as (
    select p.em, r.em as respondida
      from primeira p
      left join lateral (
        select x."timestamp" as em from public."WhatsappMensagem" x
         where x."sessaoId" = p."sessaoId" and x."chatId" = p."chatId"
           and x."fromMe" and x."timestamp" > p.em
           and x."timestamp" < p.em + interval '24 hours'
           and coalesce(x.origem, 'humano') <> 'sistema'
         order by x."timestamp" limit 1) r on true
  )
  select jsonb_build_object(
    'conversasAtivas', (select count(*) from public."WhatsappChat" c
                         where c.tipo = 'individual' and c."apagadoEm" is null and not c.arquivado
                           and c."atendimentoStatus" <> 'finalizado'
                           and c."ultimaMensagemEm" is not null),
    'conversasNoPeriodo', (select count(distinct ("sessaoId", "chatId")) from msgs),
    'semResponsavel', (select count(*) from public."WhatsappChat" c
                        where c.tipo = 'individual' and c."apagadoEm" is null and not c.arquivado
                          and c."responsavelId" is null and c."atendimentoStatus" <> 'finalizado'
                          and c."ultimaMensagemEm" is not null),
    'emAtendimentoPorColaborador', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'nome', x.nome, 'cor', x.cor, 'total', x.total)
                       order by x.total desc, x.nome)
        from (select co.id, co.nome, co.cor, count(*) as total
                from public."WhatsappChat" c join public."Colaborador" co on co.id = c."responsavelId"
               where c."apagadoEm" is null and c."atendimentoStatus" = 'em_atendimento'
               group by co.id, co.nome, co.cor) x), '[]'::jsonb),
    'mensagensPorDia', coalesce((
      select jsonb_agg(jsonb_build_object('dia', p.dia, 'recebidas', p.recebidas, 'enviadas', p.enviadas)
                       order by p.dia) from por_dia p), '[]'::jsonb),
    'recebidas', (select count(*) from msgs where not "fromMe"),
    'enviadas', (select count(*) from msgs where "fromMe"),
    'primeiraResposta', (
      select jsonb_build_object(
        'mediaMin', round((avg(extract(epoch from respondida - em)) / 60)::numeric, 1),
        'medianaMin', round((percentile_cont(0.5) within group (order by extract(epoch from respondida - em)) / 60)::numeric, 1),
        'respondidas', count(respondida),
        'semResposta', count(*) - count(respondida))
      from respostas),
    'conexoes', (select jsonb_build_object(
        'total', count(*), 'online', count(*) filter (where status = 'WORKING'))
      from public."WhatsappSessao")
  ) into v_atend;

  -- ---------------- Chamados ----------------
  select jsonb_build_object(
    'criadosNoPeriodo', (select count(*) from public."Solicitacao"
                          where "criadoEm" >= p_de and "criadoEm" < p_ate),
    'abertos', (select count(*) from public."Solicitacao" where status = 'aberta'),
    'emAndamento', (select count(*) from public."Solicitacao" where status = 'em_andamento'),
    'concluidosNoPeriodo', (select count(*) from public."Solicitacao"
                             where status = 'concluida' and "concluidaEm" >= p_de and "concluidaEm" < p_ate),
    'atrasados', (select count(*) from public."Solicitacao"
                   where status in ('aberta','em_andamento') and prazo < v_hoje),
    'topTipos', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'nome', x.nome, 'total', x.total) order by x.total desc, x.nome)
        from (select t.id, t.nome, count(*) as total
                from public."Solicitacao" s join public."SolicitacaoTipo" t on t.id = s."tipoId"
               where s."criadoEm" >= p_de and s."criadoEm" < p_ate
               group by t.id, t.nome order by count(*) desc, t.nome limit 5) x), '[]'::jsonb),
    'porResponsavel', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'nome', x.nome, 'cor', x.cor, 'total', x.total)
                       order by x.total desc, x.nome)
        from (select co.id, coalesce(co.nome, 'Sem responsável') as nome, co.cor, count(*) as total
                from public."Solicitacao" s left join public."Colaborador" co on co.id = s."responsavelId"
               where s.status in ('aberta','em_andamento')
               group by co.id, co.nome, co.cor) x), '[]'::jsonb)
  ) into v_cham;

  -- ---------------- Clientes ----------------
  select jsonb_build_object(
    'ativos', (select count(*) from public."Cliente" where ativo),
    'novosNoPeriodo', (select count(*) from public."Cliente" where "criadoEm" >= p_de and "criadoEm" < p_ate),
    'porRegime', coalesce((
      select jsonb_agg(jsonb_build_object('regime', x.regime, 'total', x.total) order by x.total desc, x.regime)
        from (select coalesce("regimeTributario", 'Não informado') as regime, count(*) as total
                from public."Cliente" where ativo group by 1) x), '[]'::jsonb)
  ) into v_cli;

  -- ---------------- Certificados (renovados ficam de fora) ----------------
  select jsonb_build_object(
    'vencidos', count(*) filter (where c."validoAte" < v_hoje),
    'vencem7', count(*) filter (where c."validoAte" between v_hoje and v_hoje + 7),
    'vencem30', count(*) filter (where c."validoAte" between v_hoje and v_hoje + 30),
    'total', count(*),
    'avisos', (select jsonb_build_object(
        'enviados', count(*) filter (where a.status = 'enviado'),
        'falharam', count(*) filter (where a.status <> 'enviado'))
      from public."CertificadoAviso" a where a."criadoEm" >= p_de and a."criadoEm" < p_ate)
  ) into v_cert
  from public."CertificadoDigital" c where c."renovadoPorId" is null;

  -- ---------------- Aniversários (hoje e próximos 7 dias) ----------------
  with a as (
    select an.*,
           (an.data + make_interval(years => (extract(year from v_hoje) - extract(year from an.data))::int))::date as neste
      from public."Aniversario" an
  ), b as (
    select a.*,
           case when a.neste < v_hoje
                then (a.data + make_interval(years => (extract(year from v_hoje) - extract(year from a.data))::int + 1))::date
                else a.neste end as proxima
      from a
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'origem', b.origem, 'clienteId', b."clienteId", 'socioId', b."socioId",
           'nome', b.nome, 'clienteNome', b."clienteNome",
           'diasAte', b.proxima - v_hoje,
           'anos', extract(year from b.proxima)::int - extract(year from b.data)::int)
         order by b.proxima, b.nome), '[]'::jsonb)
    into v_aniv
    from (select * from b where b.proxima - v_hoje between 0 and 6 order by b.proxima, b.nome limit 30) b;

  -- ---------------- Pendências fiscais ----------------
  select jsonb_build_object(
    'consultasNoPeriodo', (select count(*) from public."ConsultaFiscal"
                            where "criadoEm" >= p_de and "criadoEm" < p_ate),
    'ultimaPorStatus', (
      select jsonb_build_object(
        'ok', count(*) filter (where u.status = 'ok'),
        'com_pendencia', count(*) filter (where u.status = 'com_pendencia'),
        'erro', count(*) filter (where u.status = 'erro'),
        'pendente', count(*) filter (where u.status = 'pendente'))
      from (select distinct on ("clienteId") "clienteId", status
              from public."ConsultaFiscal" order by "clienteId", "criadoEm" desc) u)
  ) into v_fisc;

  return jsonb_build_object(
    'de', p_de, 'ate', p_ate, 'hoje', v_hoje,
    'atendimento', v_atend, 'chamados', v_cham, 'clientes', v_cli,
    'certificados', v_cert, 'aniversarios', v_aniv, 'fiscal', v_fisc);
end $$;
revoke all on function public.painel_dashboard(timestamptz, timestamptz) from public;
grant execute on function public.painel_dashboard(timestamptz, timestamptz) to anon, authenticated;
