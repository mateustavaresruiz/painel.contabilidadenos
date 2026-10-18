#!/bin/sh
# Uma execução completa de backup:
#   1. banco  — pg_dump -Fc (todos os schemas: public, auth, storage, vault...) + papéis
#   2. volumes — storage do Supabase, sessões do WAHA, gateway Serpro, e-mail, blog
#   3. retenção local (7 diários, 4 semanais, 6 mensais) + verificação do repositório
#   4. fora do servidor (rclone), só se OFFSITE_ENABLED=true
# Cada etapa grava uma linha em BackupExecucao; falha também vira ErrorLog.
set -u
. /scripts/lib.sh

exec 9>/backups/.lock
if ! flock -n 9; then
  log "outra execução em andamento; saindo"
  exit 0
fi

exigir_senha || { registrar db "$(agora_iso)" false "" local "BACKUP_PASSPHRASE ausente" '{}'; exit 1; }

WORK=/backups/.work
ERR=/tmp/etapa.err
falhas=0

# Nome (sem segredo) do destino remoto, para o status.
destino_remoto() { printf '%s:%s (%s)' "$OFFSITE_REMOTE" "$OFFSITE_PATH" "${RCLONE_CONFIG_OFFSITE_TYPE:-?}"; }

garantir_repo_local() {
  mkdir -p "$BACKUP_REPO" "$RESTIC_CACHE_DIR"
  if ! restic -r "$BACKUP_REPO" cat config >/dev/null 2>&1; then
    log "criando repositório local em $BACKUP_REPO"
    restic -r "$BACKUP_REPO" init
  fi
}

# Lê o resumo do "restic backup --json" (última linha message_type=summary).
resumo() { grep '"message_type":"summary"' "$1" | tail -1; }

etapa_db() {
  inicio=$(agora_iso)
  log "banco: pg_dump de $POSTGRES_DB em $POSTGRES_HOST"
  rm -rf "$WORK/db" && mkdir -p "$WORK/db"
  export PGPASSWORD="$POSTGRES_PASSWORD"
  # -Z 0: sem compressão do pg_dump; o restic comprime (zstd) e deduplica entre dias.
  if ! pg_dump -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
        -Fc -Z 0 -f "$WORK/db/postgres.dump" 2>"$ERR"; then
    falha db "$inicio" local "pg_dump: $(tail -c 800 "$ERR")"; return
  fi
  # Papéis (com hash de senha) para recriar authenticator, supabase_* e os nossos.
  if ! pg_dumpall -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -l "$POSTGRES_DB" \
        --roles-only -f "$WORK/db/roles.sql" 2>"$ERR"; then
    falha db "$inicio" local "pg_dumpall --roles-only: $(tail -c 800 "$ERR")"; return
  fi
  unset PGPASSWORD
  # O arquivo precisa abrir: pg_restore --list lê o índice inteiro.
  if ! pg_restore --list "$WORK/db/postgres.dump" >/tmp/db.list 2>"$ERR"; then
    falha db "$inicio" local "dump ilegível: $(tail -c 800 "$ERR")"; return
  fi
  itens=$(grep -vc '^;' /tmp/db.list)
  tam=$(stat -c %s "$WORK/db/postgres.dump")
  contagens=$(pg_prod -c "select json_build_object(
      'Cliente', (select count(*) from public.\"Cliente\"),
      'Colaborador', (select count(*) from public.\"Colaborador\"),
      'WhatsappMensagem', (select count(*) from public.\"WhatsappMensagem\"),
      '_migracao', (select count(*) from public._migracao))" 2>/dev/null)
  [ -n "$contagens" ] || contagens='{}'
  if ! restic -r "$BACKUP_REPO" backup --host "$BACKUP_HOST" --tag db --json "$WORK/db" >/tmp/db.json 2>"$ERR"; then
    falha db "$inicio" local "restic backup: $(tail -c 800 "$ERR")"; return
  fi
  s=$(resumo /tmp/db.json)
  snap=$(printf '%s' "$s" | jq -r '.snapshot_id // ""' | cut -c1-8)
  add=$(printf '%s' "$s" | jq -r '.data_added // 0')
  det=$(jq -cn --arg snap "$snap" --argjson itens "$itens" --argjson add "$add" --argjson c "$contagens" \
        '{snapshot:$snap, itensDump:$itens, bytesNovosNoRepo:$add, contagens:$c}')
  registrar db "$inicio" true "$tam" local "" "$det"
  log "banco: ok — dump $tam bytes, $itens itens, snapshot $snap"
  rm -rf "$WORK/db"
}

etapa_volumes() {
  inicio=$(agora_iso)
  faltando=""
  for d in /origem/*; do
    [ -d "$d" ] || continue
    [ -n "$(ls -A "$d" 2>/dev/null)" ] || faltando="$faltando $(basename "$d")"
  done
  [ -z "$faltando" ] || log "aviso: volumes vazios:$faltando"
  log "volumes: $(ls /origem | tr '\n' ' ')"
  restic -r "$BACKUP_REPO" backup --host "$BACKUP_HOST" --tag volumes --json /origem >/tmp/vol.json 2>"$ERR"
  rc=$?
  # 3 = snapshot criado, mas algum arquivo mudou/sumiu durante a leitura (serviço no ar).
  if [ "$rc" -eq 3 ]; then
    log "aviso: alguns arquivos não foram lidos: $(tail -c 400 "$ERR")"
  elif [ "$rc" -ne 0 ]; then
    falha volumes "$inicio" local "restic backup ($rc): $(tail -c 800 "$ERR")"; return
  fi
  s=$(resumo /tmp/vol.json)
  snap=$(printf '%s' "$s" | jq -r '.snapshot_id // ""' | cut -c1-8)
  tot=$(printf '%s' "$s" | jq -r '.total_bytes_processed // 0')
  arq=$(printf '%s' "$s" | jq -r '.total_files_processed // 0')
  add=$(printf '%s' "$s" | jq -r '.data_added // 0')
  porvol=$(for d in /origem/*; do printf '%s\t%s\n' "$(basename "$d")" "$(du -sb "$d" | cut -f1)"; done \
           | jq -Rn '[inputs | split("\t") | {(.[0]): (.[1]|tonumber)}] | add // {}')
  det=$(jq -cn --arg snap "$snap" --argjson arq "$arq" --argjson add "$add" --argjson v "$porvol" \
        --arg vazios "$faltando" --argjson rc "$rc" \
        '{snapshot:$snap, arquivos:$arq, bytesNovosNoRepo:$add, porVolume:$v, vazios:$vazios, resticSaida:$rc}')
  registrar volumes "$inicio" true "$tot" local "" "$det"
  log "volumes: ok — $arq arquivos, $tot bytes, snapshot $snap"
}

politica() {
  echo --host "$BACKUP_HOST" --group-by host,tags \
    --keep-daily "$KEEP_DAILY" --keep-weekly "$KEEP_WEEKLY" --keep-monthly "$KEEP_MONTHLY"
}

etapa_retencao_local() {
  inicio=$(agora_iso)
  # shellcheck disable=SC2046
  if ! restic -r "$BACKUP_REPO" forget $(politica) --prune >/tmp/forget.log 2>"$ERR"; then
    falha retencao "$inicio" local "restic forget/prune: $(tail -c 800 "$ERR")"; return
  fi
  if ! restic -r "$BACKUP_REPO" check >/tmp/check.log 2>"$ERR"; then
    falha retencao "$inicio" local "restic check: $(tail -c 800 "$ERR")"; return
  fi
  log "retenção local: ok (repositório $(du -sh "$BACKUP_REPO" | cut -f1))"
}

etapa_offsite() {
  inicio=$(agora_iso)
  dest=$(destino_remoto)
  if [ -n "${OFFSITE_GDRIVE_SA_JSON_B64:-}" ]; then
    printf '%s' "$OFFSITE_GDRIVE_SA_JSON_B64" | base64 -d >/tmp/sa.json 2>/dev/null && chmod 600 /tmp/sa.json
    RCLONE_CONFIG_OFFSITE_SERVICE_ACCOUNT_FILE=/tmp/sa.json
    export RCLONE_CONFIG_OFFSITE_SERVICE_ACCOUNT_FILE
  fi
  remoto="rclone:${OFFSITE_REMOTE}:${OFFSITE_PATH}"
  export RESTIC_FROM_PASSWORD="$RESTIC_PASSWORD"
  log "fora do servidor: $dest"
  if ! restic -r "$remoto" cat config >/dev/null 2>"$ERR"; then
    if ! restic -r "$remoto" init --from-repo "$BACKUP_REPO" --copy-chunker-params >/dev/null 2>"$ERR"; then
      falha offsite "$inicio" "$dest" "init remoto: $(tail -c 800 "$ERR")"; return
    fi
  fi
  if ! restic -r "$remoto" copy --from-repo "$BACKUP_REPO" --host "$BACKUP_HOST" >/tmp/copy.log 2>"$ERR"; then
    falha offsite "$inicio" "$dest" "restic copy: $(tail -c 800 "$ERR")"; return
  fi
  # shellcheck disable=SC2046
  if ! restic -r "$remoto" forget $(politica) --prune >/dev/null 2>"$ERR"; then
    falha offsite "$inicio" "$dest" "forget remoto: $(tail -c 800 "$ERR")"; return
  fi
  stats=$(restic -r "$remoto" stats --mode raw-data --json 2>/dev/null | jq -r '.total_size // ""')
  n=$(restic -r "$remoto" snapshots --json 2>/dev/null | jq 'length' || echo null)
  registrar offsite "$inicio" true "$stats" "$dest" "" "$(jq -cn --argjson n "${n:-null}" '{snapshots:$n}')"
  log "fora do servidor: ok ($n snapshots)"
  rm -f /tmp/sa.json
}

falha() {
  # falha <tipo> <inicio> <destino> <mensagem>
  falhas=$((falhas + 1))
  log "ERRO em $1: $4"
  registrar "$1" "$2" false "" "$3" "$4" '{}'
}

log "início (retenção $KEEP_DAILY diários / $KEEP_WEEKLY semanais / $KEEP_MONTHLY mensais; fora do servidor: $OFFSITE_ENABLED)"
if ! garantir_repo_local 2>"$ERR"; then
  falha db "$(agora_iso)" local "repositório local: $(tail -c 800 "$ERR")"
  exit 1
fi
etapa_db
etapa_volumes
etapa_retencao_local
case "$OFFSITE_ENABLED" in
  true|1|sim) etapa_offsite ;;
esac
log "fim: $falhas falha(s)"
[ "$falhas" -eq 0 ]
