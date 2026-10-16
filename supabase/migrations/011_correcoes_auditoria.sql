-- 011 · Correções da auditoria do backend
--
-- Idempotente e não destrutiva: só cria/substitui funções, gatilhos, uma tabela
-- de apoio e uma restrição; revoga permissões que ninguém deveria ter. Nenhuma
-- linha existente é alterada ou apagada (a restrição de A3 foi conferida:
-- 0 violações em produção).
--
--  A1. `_migracao` fechada (RLS + sem acesso do navegador) e TRUNCATE/TRIGGER/
--      REFERENCES fora do anon e do authenticated em todas as tabelas.
--  A2. Auditoria do aviso de certificado grava o RESULTADO (enviado, sem_telefone,
--      sem_conexao, falhou), não o estado transitório "em andamento".
--  A3. Colaborador desativado/excluído devolve conversas à fila e solta chamados
--      abertos; CHECK impede "em atendimento" sem responsável.
--  A4. Falhas HTTP dos crons viram linha no ErrorLog (cron_registrar_falhas, a
--      cada 10 min); a saúde mostra o último status HTTP de cada job.
--  M2. Mensagem recebida reabre conversa finalizada medindo contra o relógio do
--      servidor (com tolerância); reentrega de histórico antigo não reabre nem
--      acende "não lidas".
--  M3. Guarda do último administrador serializada por advisory lock.
--  M5. Chamado: `concluidaEm` calculado pelo banco; criadoEm/criadoPorId/origem/
--      chatId/tenantId congelados contra o navegador.
--  B3. serpro_custos_mensais fora do anon.

-- ---------------------------------------------------------------------------
-- A1. _migracao e privilégios excessivos
-- ---------------------------------------------------------------------------
create table if not exists public._migracao (
  nome text primary key, "aplicadaEm" timestamptz not null default now());
alter table public._migracao enable row level security;
revoke all on public._migracao from public, anon, authenticated;

revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke truncate, trigger, references on tables from anon, authenticated;
do $$
begin
  alter default privileges for role supabase_admin in schema public
    revoke truncate, trigger, references on tables from anon, authenticated;
exception when others then
  raise notice 'default privileges de supabase_admin não alterados: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- B3. Custos do Serpro: só quem está logado
-- ---------------------------------------------------------------------------
revoke execute on function public.serpro_custos_mensais(integer) from public, anon;
grant execute on function public.serpro_custos_mensais(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- A2. Auditoria do aviso de certificado: só o resultado final
--     A linha nasce como falhou/"em andamento" (a trava do cron) e depois é
--     atualizada com o desfecho. Só o desfecho é auditado.
-- ---------------------------------------------------------------------------
create or replace function public.trg_auditoria_certificado_aviso() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cert public."CertificadoDigital";
  v_cli text;
begin
  begin
    if new.erro is not distinct from 'em andamento' then return null; end if;   -- trava transitória
    if tg_op = 'UPDATE' and old.erro is distinct from 'em andamento'
       and new.status is not distinct from old.status then
      return null;                                                              -- regravação sem mudança
    end if;
    select * into v_cert from public."CertificadoDigital" where id = new."certificadoId";
    v_cli := public.auditoria_cliente_nome(v_cert."clienteId");
    perform public.auditoria_registrar('certificados', 'certificado', new."certificadoId", 'aviso',
      case new.status
        when 'enviado' then 'enviou o aviso de vencimento (' || new.marco || ' dias) do certificado ' || coalesce(v_cert.tipo, '') || coalesce(' de ' || v_cli, '')
        when 'falhou' then 'não conseguiu enviar o aviso de vencimento (' || new.marco || ' dias) do certificado ' || coalesce(v_cert.tipo, '') || coalesce(' de ' || v_cli, '')
        when 'sem_telefone' then 'não enviou o aviso de vencimento do certificado ' || coalesce(v_cert.tipo, '') || coalesce(' de ' || v_cli, '') || ': sem telefone'
        else 'não enviou o aviso de vencimento do certificado ' || coalesce(v_cert.tipo, '') || coalesce(' de ' || v_cli, '') || ': sem conexão do WhatsApp'
      end,
      jsonb_build_object('info', public.auditoria_info('Marco', new.marco || ' dias', 'Telefone', new.telefone, 'Erro', left(new.erro, 300))),
      'cron', v_cert."clienteId");
  exception when others then
    raise warning 'trg_auditoria_certificado_aviso: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists trg_auditoria on public."CertificadoAviso";
create trigger trg_auditoria after insert or update of status on public."CertificadoAviso"
  for each row execute function public.trg_auditoria_certificado_aviso();
revoke all on function public.trg_auditoria_certificado_aviso() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A3. Colaborador desativado ou excluído devolve o trabalho
-- ---------------------------------------------------------------------------
-- Os gatilhos de guarda abaixo deixam passar a devolução automática (o gatilho
-- de devolução liga `painel.devolvendo` só dentro da própria transação).
create or replace function public.whatsapp_chat_responsavel_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_eu uuid;
begin
  if current_setting('painel.devolvendo', true) = '1' then return new; end if;
  if coalesce(auth.role(), '') <> 'authenticated' then return new; end if;
  if new."responsavelId" is not distinct from old."responsavelId" then return new; end if;
  v_eu := public.eu_colaborador_id();
  if new."responsavelId" = v_eu and (old."responsavelId" is null or old."atendimentoStatus" = 'finalizado') then
    if not (public.tem_permissao('whatsapp.assumir') or public.tem_permissao('whatsapp.transferir')) then
      raise exception 'Sem permissão para assumir conversas.' using errcode = '42501';
    end if;
  elsif new."responsavelId" = v_eu and public.tem_permissao('whatsapp.assumir_de_outros') then
    null;
  elsif not public.tem_permissao('whatsapp.transferir') then
    raise exception 'Sem permissão para transferir conversas.' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.solicitacao_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('painel.devolvendo', true) = '1' then return new; end if;
  if coalesce(auth.role(), '') <> 'authenticated' then return new; end if;
  if public.tem_permissao('chamados.gerenciar') then return new; end if;
  if new."responsavelId" is distinct from old."responsavelId"
     or new."tipoId" is distinct from old."tipoId"
     or new."clienteId" is distinct from old."clienteId"
     or new.prazo is distinct from old.prazo then
    raise exception 'Sem permissão para mudar responsável, tipo, cliente ou prazo do chamado.' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.colaborador_devolver_trabalho() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := old.id;
  v_motivo text := case when tg_op = 'DELETE' then 'devolvida: colaborador excluído'
                        else 'devolvida: colaborador desativado' end;
  r record;
begin
  perform set_config('painel.devolvendo', '1', true);
  -- Conversas dele que ainda não terminaram voltam para a fila.
  for r in
    select id from public."WhatsappChat"
     where "responsavelId" = v_id and "atendimentoStatus" in ('aberto', 'em_atendimento')
     for update
  loop
    update public."WhatsappChat"
       set "responsavelId" = null, "atendimentoStatus" = 'aberto',
           "atendimentoEm" = now(), "atualizadoEm" = now()
     where id = r.id;
    insert into public."AtendimentoTransferencia" ("chatId", "deId", "paraId", "porId", motivo, evento)
    values (r.id, v_id, null, null, v_motivo, 'devolveu');
  end loop;
  -- Chamados em aberto ficam sem responsável (a auditoria do chamado registra).
  update public."Solicitacao" set "responsavelId" = null
   where "responsavelId" = v_id and status in ('aberta', 'em_andamento');
  perform set_config('painel.devolvendo', '', true);
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function public.colaborador_devolver_trabalho() from public, anon, authenticated;

drop trigger if exists trg_colaborador_devolver_desativado on public."Colaborador";
create trigger trg_colaborador_devolver_desativado after update of ativo on public."Colaborador"
  for each row when (old.ativo and not new.ativo)
  execute function public.colaborador_devolver_trabalho();
drop trigger if exists trg_colaborador_devolver_excluido on public."Colaborador";
create trigger trg_colaborador_devolver_excluido before delete on public."Colaborador"
  for each row execute function public.colaborador_devolver_trabalho();

-- Em atendimento exige responsável. NOT VALID primeiro (não trava a tabela) e
-- VALIDATE depois; em produção havia 0 violações.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'WhatsappChat_em_atendimento_responsavel_check') then
    alter table public."WhatsappChat"
      add constraint "WhatsappChat_em_atendimento_responsavel_check"
      check ("atendimentoStatus" <> 'em_atendimento' or "responsavelId" is not null) not valid;
  end if;
end $$;
alter table public."WhatsappChat" validate constraint "WhatsappChat_em_atendimento_responsavel_check";

-- ---------------------------------------------------------------------------
-- M3. Último administrador: serializa demissões/desativações concorrentes
-- ---------------------------------------------------------------------------
create or replace function public.colaborador_admin_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_admin uuid := (select id from public."Cargo" where sistema limit 1);
begin
  -- Sem o lock, dois administradores rebaixados ao mesmo tempo enxergam um ao
  -- outro como "o outro ainda ativo" e os dois passam, deixando a equipe sem admin.
  perform pg_advisory_xact_lock(hashtext('painel.colaborador_admin_guard'));
  if old."cargoId" = v_admin and old.ativo
     and (tg_op = 'DELETE' or new."cargoId" <> v_admin or not new.ativo)
     and not exists (
       select 1 from public."Colaborador"
        where "cargoId" = v_admin and ativo and id <> old.id) then
    raise exception 'Precisa haver pelo menos um administrador ativo na equipe.' using errcode = 'P0001';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- ---------------------------------------------------------------------------
-- M5. Chamado: conclusão calculada pelo banco e campos de origem congelados
-- ---------------------------------------------------------------------------
create or replace function public.solicitacao_conclusao() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_logado boolean := coalesce(auth.role(), '') = 'authenticated';
begin
  if tg_op = 'INSERT' then
    new."concluidaEm" := case when new.status = 'concluida' then coalesce(new."concluidaEm", now()) else null end;
    return new;
  end if;

  -- concluidaEm segue o status: vira concluída = agora; sai de concluída = limpa.
  if new.status is distinct from old.status then
    new."concluidaEm" := case when new.status = 'concluida' then now() else null end;
  elsif v_logado then
    new."concluidaEm" := old."concluidaEm";
  end if;

  -- Quem veio do navegador não reescreve a origem do chamado. Dentro de outro
  -- gatilho (ex.: a FK `on delete set null` ao apagar conversa ou colaborador)
  -- a troca para NULL continua valendo.
  if v_logado and pg_trigger_depth() <= 1 then
    if new."criadoEm" is distinct from old."criadoEm"
       or new."tenantId" is distinct from old."tenantId"
       or new.origem is distinct from old.origem
       or new."criadoPorId" is distinct from old."criadoPorId"
       or new."chatId" is distinct from old."chatId" then
      raise exception 'Origem do chamado (criação, autor, origem, conversa) não pode ser alterada.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.solicitacao_conclusao() from public, anon, authenticated;
drop trigger if exists trg_solicitacao_conclusao on public."Solicitacao";
create trigger trg_solicitacao_conclusao before insert or update on public."Solicitacao"
  for each row execute function public.solicitacao_conclusao();

-- ---------------------------------------------------------------------------
-- M2. Mensagem recebida em conversa finalizada
--     Reabre se a mensagem não é mais velha que 10 min ANTES da finalização
--     (tolerância para relógio do aparelho/atraso de entrega). Reentrega de
--     histórico mais antigo que isso não reabre nem conta como não lida.
-- ---------------------------------------------------------------------------
create or replace function public.whatsapp_chat_nova_mensagem(
  p_chat_id text, p_texto text, p_em timestamptz, p_from_me boolean, p_incrementar boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_resp uuid;
  v_em timestamptz;
  v_tolerancia constant interval := interval '10 minutes';
  v_antiga boolean;
begin
  select "atendimentoStatus", "responsavelId", "atendimentoEm" into v_status, v_resp, v_em
    from public."WhatsappChat" where id = p_chat_id for update;

  -- Recebida, conversa finalizada e a mensagem é mais velha que a finalização
  -- (além da tolerância): é histórico reentregue.
  v_antiga := not p_from_me and v_status = 'finalizado' and v_em is not null and p_em < v_em - v_tolerancia;

  update public."WhatsappChat" c set
    "ultimaMensagemTexto"  = case when c."ultimaMensagemEm" is null or p_em >= c."ultimaMensagemEm"
                                  then left(p_texto, 200) else c."ultimaMensagemTexto" end,
    "ultimaMensagemFromMe" = case when c."ultimaMensagemEm" is null or p_em >= c."ultimaMensagemEm"
                                  then p_from_me else c."ultimaMensagemFromMe" end,
    "ultimaMensagemEm"     = greatest(coalesce(c."ultimaMensagemEm", p_em), p_em),
    "naoLidas"             = c."naoLidas" + case when p_incrementar and not v_antiga then 1 else 0 end,
    "atualizadoEm"         = now()
  where c.id = p_chat_id;

  if not p_from_me and v_status = 'finalizado' and not v_antiga then
    update public."WhatsappChat"
       set "atendimentoStatus" = 'aberto', "responsavelId" = null, "atendimentoEm" = now()
     where id = p_chat_id;
    insert into public."AtendimentoTransferencia" ("chatId", "deId", "paraId", "porId", motivo, evento)
    values (p_chat_id, v_resp, null, null, 'Voltou para a fila', 'fila');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- A4. Falhas de cron visíveis
--     pg_net só guarda a resposta HTTP por algumas horas e não diz de qual job
--     ela é. "CronChamada" liga o id do pedido ao job; `cron_registrar_falhas`
--     (a cada 10 min) lê a resposta, guarda o status e, se não for 2xx, grava
--     uma linha no ErrorLog (origem 'cron').
-- ---------------------------------------------------------------------------
create table if not exists public."CronChamada" (
  "requestId"    bigint primary key,
  job            text not null,
  "criadoEm"     timestamptz not null default now(),
  "verificadoEm" timestamptz,
  "statusHttp"   integer,
  falhou         boolean not null default false
);
create index if not exists "CronChamada_job_criadoEm_idx" on public."CronChamada"(job, "criadoEm" desc);
alter table public."CronChamada" enable row level security;
revoke all on public."CronChamada" from public, anon, authenticated;

create or replace function public.cron_chamar(p_job text)
returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare
  v_secret text;
  v_req bigint;
begin
  if p_job !~ '^[a-z0-9-]+$' then
    raise exception 'job inválido: %', p_job;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1;
  if v_secret is null or v_secret = '' then
    insert into public."ErrorLog" ("tenantId", origem, nivel, mensagem, rota)
    values ('denos', 'cron', 'warn', 'cron_secret ausente no Vault: job não chamado', p_job);
    return null;
  end if;
  select net.http_post(
    url := 'http://functions:9000/crons/' || p_job,
    headers := jsonb_build_object('x-cron-secret', v_secret, 'content-type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 145000
  ) into v_req;
  insert into public."CronChamada" ("requestId", job) values (v_req, p_job) on conflict do nothing;
  return v_req;
end $$;
revoke all on function public.cron_chamar(text) from public, anon, authenticated;

create or replace function public.cron_registrar_falhas() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_falhas integer := 0;
  r record;
  v_ruim boolean;
begin
  for r in
    select c."requestId", c.job, x.status_code, x.timed_out, x.error_msg, left(x.content, 300) as corpo
      from public."CronChamada" c
      join net._http_response x on x.id = c."requestId"
     where c."verificadoEm" is null
     for update of c skip locked
  loop
    v_ruim := r.status_code is null or r.status_code not between 200 and 299;
    update public."CronChamada"
       set "verificadoEm" = now(), "statusHttp" = r.status_code, falhou = v_ruim
     where "requestId" = r."requestId";
    if v_ruim then
      insert into public."ErrorLog" ("tenantId", origem, nivel, mensagem, rota, status, contexto)
      values ('denos', 'cron', 'error',
        'cron ' || r.job || ': ' || case
          when r.timed_out then 'sem resposta no prazo (timeout)'
          when r.status_code is null then coalesce(r.error_msg, 'sem resposta')
          else 'HTTP ' || r.status_code end,
        r.job, r.status_code,
        jsonb_build_object('requestId', r."requestId", 'corpo', r.corpo, 'erro', r.error_msg));
      v_falhas := v_falhas + 1;
    end if;
  end loop;
  -- Pedido sem resposta há mais de 1 h: o pg_net já descartou. Fecha sem alarme.
  update public."CronChamada" set "verificadoEm" = now()
   where "verificadoEm" is null and "criadoEm" < now() - interval '1 hour';
  return v_falhas;
end $$;
revoke all on function public.cron_registrar_falhas() from public, anon, authenticated;

select cron.schedule('cron-registrar-falhas', '*/10 * * * *', $$select public.cron_registrar_falhas()$$);

-- Purga: acrescenta a tabela de chamadas (7 dias).
create or replace function public.purga_diaria()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ev int; v_rl int; v_er int; v_cc int;
begin
  delete from public."WhatsappEventoLog" where "criadoEm" < now() - interval '30 days';
  get diagnostics v_ev = row_count;
  delete from public."RateLimit" where window_start < now() - interval '7 days';
  get diagnostics v_rl = row_count;
  delete from public."ErrorLog" where "criadoEm" < now() - interval '90 days';
  get diagnostics v_er = row_count;
  delete from public."CronChamada" where "criadoEm" < now() - interval '7 days';
  get diagnostics v_cc = row_count;
  return jsonb_build_object('eventoLog', v_ev, 'rateLimit', v_rl, 'errorLog', v_er, 'cronChamada', v_cc);
end $$;
revoke all on function public.purga_diaria() from public, anon, authenticated;

-- Saúde: cada cron ganha o último status HTTP que a função respondeu.
create or replace function public.painel_saude_dados()
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
                                and f.start_time > now() - interval '24 hours'),
               'httpStatus', h."statusHttp", 'httpEm', h."criadoEm", 'httpFalhou', h.falhou,
               'httpFalhas24h', (select count(*) from public."CronChamada" f
                                  where f.job = j.jobname and f.falhou
                                    and f."criadoEm" > now() - interval '24 hours'))
             order by j.jobname)
        from cron.job j
        left join lateral (
          select d.start_time, d.end_time, d.status, d.return_message
            from cron.job_run_details d where d.jobid = j.jobid
           order by d.start_time desc limit 1) r on true
        left join lateral (
          select c."statusHttp", c."criadoEm", c.falhou
            from public."CronChamada" c
           where c.job = j.jobname and c."verificadoEm" is not null
           order by c."criadoEm" desc limit 1) h on true), '[]'::jsonb)
  )
$$;
revoke execute on function public.painel_saude_dados() from public, anon, authenticated;
