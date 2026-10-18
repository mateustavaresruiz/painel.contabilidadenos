# Funções comuns do backup. Carregado com ". /scripts/lib.sh".
# Nenhuma função imprime senha: elas só vão por variável de ambiente.

# O crond do busybox não repassa o ambiente do container para o job;
# o entrypoint salva o ambiente em /run/backup.env (0600) e cada script carrega.
if [ -f /run/backup.env ]; then
  # shellcheck disable=SC1091
  . /run/backup.env
fi

: "${POSTGRES_HOST:=supabase-db}"
: "${POSTGRES_PORT:=5432}"
: "${POSTGRES_USER:=supabase_admin}"
: "${POSTGRES_DB:=postgres}"
: "${BACKUP_REPO:=/backups/restic}"
: "${BACKUP_HOST:=painel}"
: "${KEEP_DAILY:=7}"
: "${KEEP_WEEKLY:=4}"
: "${KEEP_MONTHLY:=6}"
: "${OFFSITE_ENABLED:=false}"
: "${OFFSITE_REMOTE:=offsite}"
: "${OFFSITE_PATH:=painel-backups}"
: "${RESTIC_CACHE_DIR:=/backups/.cache}"
export RESTIC_CACHE_DIR

log() { printf '%s [backup] %s\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "$*"; }

exigir_senha() {
  if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
    log "ERRO: BACKUP_PASSPHRASE não definida no Easypanel"
    return 1
  fi
  RESTIC_PASSWORD="$BACKUP_PASSPHRASE"
  export RESTIC_PASSWORD
}

# psql no banco de produção (só leitura de dados ou escrita de status).
pg_prod() {
  PGPASSWORD="$POSTGRES_PASSWORD" PGCONNECT_TIMEOUT=10 \
    psql -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -X -q -A -t -v ON_ERROR_STOP=1 "$@"
}

# JSON-escape de um texto qualquer (para o campo detalhe/erro).
json_str() { printf '%s' "$1" | jq -Rs .; }

# Grava uma linha em BackupExecucao e, se falhou, em ErrorLog (origem 'backup').
# Usa SET ROLE backup_monitor (migração 014): só INSERT nessas duas tabelas.
#   registrar <tipo> <inicioISO> <ok:true|false> <tamanhoBytes|""> <destino> <erro|""> <detalheJSON>
# Nunca derruba o script: se o banco estiver fora, só registra no log.
registrar() {
  _tipo=$1 _inicio=$2 _ok=$3 _tam=$4 _dest=$5 _erro=$6 _det=${7:-'{}'}
  [ -n "$_tam" ] || _tam=""
  if ! printf '%s\n' \
    "set role backup_monitor;" \
    "insert into public.\"BackupExecucao\" (tipo, inicio, fim, ok, \"tamanhoBytes\", destino, erro, detalhe)" \
    "values (:'tipo', :'inicio'::timestamptz, now(), :'ok'::boolean, nullif(:'tam','')::bigint, :'dest', nullif(:'erro',''), :'det'::jsonb);" \
    "insert into public.\"ErrorLog\" (origem, nivel, mensagem, rota, contexto)" \
    "select 'backup', 'error', 'Backup falhou: ' || :'tipo' || ' — ' || left(:'erro', 500), 'backup/' || :'tipo', :'det'::jsonb" \
    " where not :'ok'::boolean;" \
    | pg_prod -v tipo="$_tipo" -v inicio="$_inicio" -v ok="$_ok" -v tam="$_tam" \
        -v dest="$_dest" -v erro="$_erro" -v det="$_det" >/dev/null 2>/tmp/registrar.err; then
    log "aviso: não consegui gravar o status no banco ($(tail -c 300 /tmp/registrar.err))"
  fi
}

agora_iso() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
