#!/bin/sh
# cron         agenda backup.sh em BACKUP_CRON (padrão 03:00, America/Sao_Paulo)
# agora        roda um backup e sai
# restore-test roda o teste de restauração (docker-compose.restore-test.yml)
# <outro>      executa o comando (ex.: sh, restic snapshots)
set -eu

# O crond não repassa o ambiente; salva para os scripts (só o root lê).
umask 077
export -p | grep -v -E '^export (HOME|HOSTNAME|PWD|SHLVL|TERM|OLDPWD)=' >/run/backup.env
umask 022

case "${1:-cron}" in
  cron)
    : "${BACKUP_CRON:=0 3 * * *}"
    mkdir -p /etc/crontabs
    printf '%s /scripts/backup.sh >/proc/1/fd/1 2>/proc/1/fd/2\n' "$BACKUP_CRON" >/etc/crontabs/root
    echo "$(date '+%Y-%m-%d %H:%M:%S %Z') [backup] agenda: '$BACKUP_CRON' ($TZ)"
    case "${RUN_ON_START:-false}" in
      true|1|sim) echo "[backup] RUN_ON_START: rodando um backup agora"; /scripts/backup.sh & ;;
    esac
    exec crond -f -l 6
    ;;
  agora) exec /scripts/backup.sh ;;
  restore-test) exec /scripts/restore-test.sh ;;
  *) exec "$@" ;;
esac
