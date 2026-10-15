-- ===========================================================================
-- 003: agendamentos (pg_cron + pg_net).
--
-- As functions são chamadas DIRETO no container de edge runtime, pela rede do
-- compose: http://functions:9000/crons/<job> (o router `main` resolve o nome
-- da function pelo 1º segmento do caminho). Não passa pelo gateway nem pela
-- internet.
--
-- 🔴 O CRON_SECRET NÃO ESTÁ AQUI. Ele mora no Vault, com o nome
-- 'cron_secret', e é inserido À PARTE (nunca em arquivo do repositório):
--
--   node scripts/migrar.mjs --sql "select vault.create_secret('<CRON_SECRET>', 'cron_secret', 'x-cron-secret das functions')"
--
-- (trocar depois: select vault.update_secret(id, '<novo>') from vault.secrets where name = 'cron_secret')
-- O valor tem de ser o mesmo do env CRON_SECRET do serviço supabase.
-- Sem o segredo no Vault, `cron_chamar` não chama nada e registra o motivo.
--
-- Horários em UTC (o pg_cron do banco roda em UTC). São Paulo = UTC-3.
-- ===========================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Chama uma rota da function `crons`. Security definer: lê o Vault, que o
-- papel do cron (postgres) alcança, e ninguém mais executa.
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
  return v_req;
end $$;
revoke all on function public.cron_chamar(text) from public, anon, authenticated;

-- Purga diária, SQL puro: log de eventos do webhook (30 dias), freio (7 dias)
-- e log de erro (90 dias).
create or replace function public.purga_diaria()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ev int; v_rl int; v_er int;
begin
  delete from public."WhatsappEventoLog" where "criadoEm" < now() - interval '30 days';
  get diagnostics v_ev = row_count;
  delete from public."RateLimit" where window_start < now() - interval '7 days';
  get diagnostics v_rl = row_count;
  delete from public."ErrorLog" where "criadoEm" < now() - interval '90 days';
  get diagnostics v_er = row_count;
  return jsonb_build_object('eventoLog', v_ev, 'rateLimit', v_rl, 'errorLog', v_er);
end $$;
revoke all on function public.purga_diaria() from public, anon, authenticated;

-- cron.schedule(nome, ...) substitui o job de mesmo nome: reaplicar é seguro.
select cron.schedule('whatsapp-keepalive', '*/5 * * * *', $$select public.cron_chamar('whatsapp-keepalive')$$);
select cron.schedule('whatsapp-fotos-pendentes', '17 * * * *', $$select public.cron_chamar('whatsapp-fotos-pendentes')$$);
-- 09:00 em São Paulo.
select cron.schedule('certificados-avisos', '0 12 * * *', $$select public.cron_chamar('certificados-avisos')$$);
-- 03:30 em São Paulo.
select cron.schedule('purga-diaria', '30 6 * * *', $$select public.purga_diaria()$$);
