#!/bin/sh
# Restaura UM volume a partir do backup (docker-compose.restore-volume.yml).
#   ORIGEM      nome da pasta no snapshot: waha-sessions, supabase-storage, ...
#   SNAPSHOT    id do snapshot "volumes" (padrão: latest)
#   CONFIRMA    tem que ser "sim" — sem isso só mostra o que faria
#   LIMPAR      "sim" apaga o conteúdo atual do volume antes de copiar
# O serviço dono do volume deve estar PARADO no Easypanel durante a restauração.
set -u
export LC_ALL=C
. /scripts/lib.sh
exigir_senha || exit 1
export RESTIC_CACHE_DIR=/tmp/restic-cache
: "${ORIGEM:?defina ORIGEM (ex.: waha-sessions)}"
: "${SNAPSHOT:=latest}"

log "snapshots de volumes disponíveis:"
restic -r "$BACKUP_REPO" snapshots --no-lock --host "$BACKUP_HOST" --tag volumes
log "conteúdo de /origem/$ORIGEM no snapshot $SNAPSHOT:"
restic -r "$BACKUP_REPO" ls --no-lock --host "$BACKUP_HOST" --tag volumes "$SNAPSHOT" "/origem/$ORIGEM" | head -50
log "conteúdo atual do volume de destino (/alvo):"
ls -la /alvo | head -30

if [ "${CONFIRMA:-}" != "sim" ]; then
  log "CONFIRMA != sim: nada foi alterado."
  exit 0
fi
rm -rf /tmp/r && mkdir -p /tmp/r
restic -r "$BACKUP_REPO" restore --no-lock --host "$BACKUP_HOST" --tag volumes "$SNAPSHOT" \
  --include "/origem/$ORIGEM" --target /tmp/r || { log "ERRO no restic restore"; exit 1; }
[ -d "/tmp/r/origem/$ORIGEM" ] || { log "ERRO: /origem/$ORIGEM não está no snapshot"; exit 1; }
if [ "${LIMPAR:-}" = "sim" ]; then
  log "apagando o conteúdo atual de /alvo"
  find /alvo -mindepth 1 -delete
fi
cp -a "/tmp/r/origem/$ORIGEM/." /alvo/
log "restaurado: $(find /alvo -type f | wc -l) arquivos, $(du -sh /alvo | cut -f1). Pode religar o serviço."
