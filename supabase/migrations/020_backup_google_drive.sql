-- 020 — Backup diário no Google Drive do escritório (OAuth)
--
-- O serviço "backup" (infra/backup) já faz o backup local às 03:00. Esta
-- migração guarda a conexão com o Google Drive que a pessoa autoriza em
-- Configurações > Sistema > Backup ("Conectar Google Drive"): depois do backup
-- local, o mesmo serviço manda um arquivo cifrado por dia para uma pasta desse
-- Drive e apaga os mais antigos que os últimos 30.
--
--  1. "BackupGoogleDrive": uma linha só (id = 1) com o que NÃO é segredo:
--     conta conectada, pasta, quantos manter, Client ID do OAuth. O Client
--     Secret e o refresh token ficam no Vault (google_drive_client_secret,
--     google_drive_refresh_token). RLS ligada e sem política: a tela lê pela
--     RPC painel_drive_status (configuracoes.gerenciar) e a function
--     google-drive escreve pelas RPCs drive_* (só service_role).
--  2. "BackupGoogleDriveEstado": o "state" do OAuth (hash, uso único, 10 min),
--     amarrado a quem clicou em Conectar.
--  3. BackupExecucao aceita a etapa 'drive'.
--  4. painel_backup_status_dados passa a devolver também a conexão do Drive.
--
-- Não destrutiva e idempotente (a troca do CHECK só amplia os valores aceitos).

create table if not exists public."BackupGoogleDrive" (
  id               smallint primary key default 1 check (id = 1),
  "clientId"       text,
  conta            text,
  "pastaId"        text,
  "pastaNome"      text,
  manter           integer not null default 30 check (manter between 1 and 365),
  "conectadoEm"    timestamptz,
  "conectadoPorId" uuid references public."Colaborador"(id) on delete set null,
  "atualizadoEm"   timestamptz not null default now()
);
alter table public."BackupGoogleDrive" enable row level security;
revoke all on table public."BackupGoogleDrive" from public, anon, authenticated;
insert into public."BackupGoogleDrive" (id) values (1) on conflict (id) do nothing;

create table if not exists public."BackupGoogleDriveEstado" (
  "stateHash"     text primary key,
  "colaboradorId" uuid not null references public."Colaborador"(id) on delete cascade,
  "criadoEm"      timestamptz not null default now()
);
alter table public."BackupGoogleDriveEstado" enable row level security;
revoke all on table public."BackupGoogleDriveEstado" from public, anon, authenticated;

alter table public."BackupExecucao" drop constraint if exists "BackupExecucao_tipo_check";
alter table public."BackupExecucao" add constraint "BackupExecucao_tipo_check"
  check (tipo in ('db', 'volumes', 'retencao', 'offsite', 'restore-test', 'drive'));

-- ---------------------------------------------------------------------------
-- Vault: grava/atualiza/apaga um segredo pelo nome (uso interno das RPCs).
-- ---------------------------------------------------------------------------
create or replace function public.drive_vault_definir(p_nome text, p_valor text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = p_nome;
  if p_valor is null or p_valor = '' then
    if v_id is not null then delete from vault.secrets where id = v_id; end if;
  elsif v_id is null then
    perform vault.create_secret(p_valor, p_nome, 'Backup no Google Drive (020)');
  else
    perform vault.update_secret(v_id, p_valor);
  end if;
end $$;
revoke all on function public.drive_vault_definir(text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RPCs da function google-drive (service_role). Nenhuma devolve segredo à tela.
-- ---------------------------------------------------------------------------

/** Client ID + Client Secret do OAuth (Google Cloud). Trocar o cliente desconecta. */
create or replace function public.drive_salvar_cliente(p_client_id text, p_client_secret text, p_ator uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.drive_vault_definir('google_drive_client_secret', p_client_secret);
  perform public.drive_vault_definir('google_drive_refresh_token', null);
  update public."BackupGoogleDrive"
     set "clientId" = nullif(trim(p_client_id), ''), conta = null, "pastaId" = null, "pastaNome" = null,
         "conectadoEm" = null, "conectadoPorId" = null, "atualizadoEm" = now()
   where id = 1;
  perform public.auditoria_registrar('configuracoes', 'integracao', 'google-drive', 'editar',
    'salvou o acesso OAuth do Google Drive (backup)', null, 'painel', null, null, null, p_ator);
end $$;

/** Cria o state do OAuth (o hash chega pronto; o valor puro só vai na URL). */
create or replace function public.drive_criar_estado(p_state_hash text, p_ator uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public."BackupGoogleDriveEstado" where "criadoEm" < now() - interval '1 hour';
  insert into public."BackupGoogleDriveEstado" ("stateHash", "colaboradorId") values (p_state_hash, p_ator);
end $$;

/** Consome o state (uso único, 10 min). Devolve quem clicou em Conectar, ou null. */
create or replace function public.drive_consumir_estado(p_state_hash text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_ator uuid;
begin
  delete from public."BackupGoogleDriveEstado"
   where "stateHash" = p_state_hash and "criadoEm" > now() - interval '10 minutes'
  returning "colaboradorId" into v_ator;
  return v_ator;
end $$;

/** Conexão concluída: conta, pasta e refresh token. */
create or replace function public.drive_salvar_conexao(
  p_conta text, p_pasta_id text, p_pasta_nome text, p_refresh_token text, p_ator uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_refresh_token is not null and p_refresh_token <> '' then
    perform public.drive_vault_definir('google_drive_refresh_token', p_refresh_token);
  end if;
  update public."BackupGoogleDrive"
     set conta = p_conta, "pastaId" = p_pasta_id, "pastaNome" = p_pasta_nome,
         "conectadoEm" = now(), "conectadoPorId" = p_ator, "atualizadoEm" = now()
   where id = 1;
  perform public.auditoria_registrar('configuracoes', 'integracao', 'google-drive', 'editar',
    'conectou o Google Drive ao backup diário',
    jsonb_build_object('info', jsonb_build_array(
      jsonb_build_object('rotulo', 'Conta', 'valor', p_conta),
      jsonb_build_object('rotulo', 'Pasta', 'valor', p_pasta_nome))),
    'painel', null, null, null, p_ator);
end $$;

/** Desconecta (o Client ID/Secret continuam salvos, para reconectar com um clique). */
create or replace function public.drive_desconectar(p_ator uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.drive_vault_definir('google_drive_refresh_token', null);
  update public."BackupGoogleDrive"
     set conta = null, "pastaId" = null, "pastaNome" = null, "conectadoEm" = null,
         "conectadoPorId" = null, "atualizadoEm" = now()
   where id = 1;
  perform public.auditoria_registrar('configuracoes', 'integracao', 'google-drive', 'excluir',
    'desconectou o Google Drive do backup diário', null, 'painel', null, null, null, p_ator);
end $$;

/**
 * Tudo o que o upload precisa, segredos incluídos. Só service_role (function
 * google-drive) e o serviço de backup (entra como supabase_admin).
 */
create or replace function public.drive_credenciais()
returns table ("clientId" text, "clientSecret" text, "refreshToken" text, "pastaId" text,
               "pastaNome" text, conta text, manter integer)
language sql stable security definer set search_path = public, vault as $$
  select d."clientId",
         (select decrypted_secret from vault.decrypted_secrets where name = 'google_drive_client_secret' limit 1),
         (select decrypted_secret from vault.decrypted_secrets where name = 'google_drive_refresh_token' limit 1),
         d."pastaId", d."pastaNome", d.conta, d.manter
    from public."BackupGoogleDrive" d where d.id = 1
$$;

revoke all on function public.drive_salvar_cliente(text, text, uuid) from public, anon, authenticated;
revoke all on function public.drive_criar_estado(text, uuid) from public, anon, authenticated;
revoke all on function public.drive_consumir_estado(text) from public, anon, authenticated;
revoke all on function public.drive_salvar_conexao(text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.drive_desconectar(uuid) from public, anon, authenticated;
revoke all on function public.drive_credenciais() from public, anon, authenticated;
grant execute on function public.drive_salvar_cliente(text, text, uuid) to service_role;
grant execute on function public.drive_criar_estado(text, uuid) to service_role;
grant execute on function public.drive_consumir_estado(text) to service_role;
grant execute on function public.drive_salvar_conexao(text, text, text, text, uuid) to service_role;
grant execute on function public.drive_desconectar(uuid) to service_role;
grant execute on function public.drive_credenciais() to service_role;

-- ---------------------------------------------------------------------------
-- Status para a tela (sem segredo): o que já existia + a conexão do Drive.
-- ---------------------------------------------------------------------------
create or replace function public.painel_backup_status_dados()
returns jsonb language sql stable security definer set search_path = public, vault as $$
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
                from public."BackupExecucao" b order by b.inicio desc limit 20) h), '[]'::jsonb),
    'drive', (
      select jsonb_build_object(
        'clientId', d."clientId",
        'clienteConfigurado', d."clientId" is not null
          and exists (select 1 from vault.secrets where name = 'google_drive_client_secret'),
        'conectado', d."pastaId" is not null
          and exists (select 1 from vault.secrets where name = 'google_drive_refresh_token'),
        'conta', d.conta,
        'pastaId', d."pastaId",
        'pastaNome', d."pastaNome",
        'manter', d.manter,
        'conectadoEm', d."conectadoEm",
        'conectadoPor', (select c.nome from public."Colaborador" c where c.id = d."conectadoPorId"))
        from public."BackupGoogleDrive" d where d.id = 1)
  )
$$;
revoke all on function public.painel_backup_status_dados() from public, anon, authenticated;
