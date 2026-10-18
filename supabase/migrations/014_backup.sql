-- 014 — Status do backup (serviço "backup" do Easypanel, infra/backup)
--
--  1. BackupExecucao: uma linha por etapa de cada execução (db, volumes,
--     retencao, offsite, restore-test). RLS ligada, sem política de leitura:
--     a tela lê pela RPC painel_backup_status.
--  2. Papel backup_monitor (NOLOGIN): o script entra como supabase_admin (precisa
--     ler tudo para o pg_dump) e faz SET ROLE backup_monitor para gravar o
--     status — esse papel só pode INSERIR em BackupExecucao e em ErrorLog
--     (origem 'backup').
--  3. painel_backup_status(): último resultado de cada etapa + último sucesso,
--     para Configurações > Sistema. Exige configuracoes.gerenciar.
--
-- Não destrutiva e idempotente.

create table if not exists public."BackupExecucao" (
  id             bigserial primary key,
  tipo           text not null check (tipo in ('db', 'volumes', 'retencao', 'offsite', 'restore-test')),
  inicio         timestamptz not null,
  fim            timestamptz,
  ok             boolean not null,
  "tamanhoBytes" bigint,
  destino        text not null default 'local',
  erro           text,
  detalhe        jsonb not null default '{}'::jsonb
);
create index if not exists "BackupExecucao_tipo_inicio_idx" on public."BackupExecucao" (tipo, inicio desc);
alter table public."BackupExecucao" enable row level security;
revoke all on table public."BackupExecucao" from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'backup_monitor') then
    create role backup_monitor nologin;
  end if;
end $$;

grant usage on schema public to backup_monitor;
grant insert on table public."BackupExecucao" to backup_monitor;
grant usage on sequence public."BackupExecucao_id_seq" to backup_monitor;
grant insert on table public."ErrorLog" to backup_monitor;
grant usage on sequence public."ErrorLog_id_seq" to backup_monitor;

drop policy if exists backup_monitor_insere on public."BackupExecucao";
create policy backup_monitor_insere on public."BackupExecucao"
  for insert to backup_monitor with check (true);
drop policy if exists backup_monitor_insere on public."ErrorLog";
create policy backup_monitor_insere on public."ErrorLog"
  for insert to backup_monitor with check (origem = 'backup');

create or replace function public.painel_backup_status_dados()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'agora', now(),
    'ultimos', coalesce((
      select jsonb_object_agg(t.tipo, to_jsonb(u))
        from (select distinct tipo from public."BackupExecucao") t
        cross join lateral (
          select b.id, b.tipo, b.inicio, b.fim, b.ok, b."tamanhoBytes", b.destino, b.erro, b.detalhe
            from public."BackupExecucao" b where b.tipo = t.tipo
           order by b.inicio desc limit 1) u), '{}'::jsonb),
    'ultimoSucesso', coalesce((
      select jsonb_object_agg(t.tipo, s.fim)
        from (select distinct tipo from public."BackupExecucao") t
        cross join lateral (
          select max(b.fim) as fim from public."BackupExecucao" b
           where b.tipo = t.tipo and b.ok) s
       where s.fim is not null), '{}'::jsonb),
    'historico', coalesce((
      select jsonb_agg(to_jsonb(h) order by h.inicio desc)
        from (select b.id, b.tipo, b.inicio, b.fim, b.ok, b."tamanhoBytes", b.destino, b.erro
                from public."BackupExecucao" b order by b.inicio desc limit 20) h), '[]'::jsonb)
  )
$$;
revoke all on function public.painel_backup_status_dados() from public, anon, authenticated;

create or replace function public.painel_backup_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.painel_exigir('configuracoes.gerenciar');
  return public.painel_backup_status_dados();
end $$;
revoke all on function public.painel_backup_status() from public, anon;
grant execute on function public.painel_backup_status() to authenticated;
