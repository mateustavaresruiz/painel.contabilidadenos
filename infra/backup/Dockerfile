# Imagem do serviço de backup do Painel Denos (Easypanel: painel/backup).
#
# - pg_dump/psql 17.6: mesma versão do servidor (supabase/postgres:17.6.1.136).
# - restic: cifra (AES-256), deduplica e aplica a retenção 7/4/6.
# - rclone: leva o repositório para fora do servidor (Google Drive, R2, B2).
#
# Tudo fixado por tag exata + digest. Para atualizar, troque tag e digest juntos.

FROM restic/restic:0.18.1@sha256:39d9072fb5651c80d75c7a811612eb60b4c06b32ffe87c2e9f3c7222e1797e76 AS restic
FROM rclone/rclone:1.71.1@sha256:d5971950c2b370fb04dd3292541b5bda6d9103143fd7e345aeb435a399388afc AS rclone

FROM postgres:17.6-alpine3.22@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94

RUN apk add --no-cache tzdata jq ca-certificates

COPY --from=restic /usr/bin/restic /usr/local/bin/restic
COPY --from=rclone /usr/local/bin/rclone /usr/local/bin/rclone

COPY scripts/ /scripts/
RUN chmod 0755 /scripts/*.sh && restic version && rclone version | head -1 && pg_dump --version

ENV TZ=America/Sao_Paulo \
    BACKUP_REPO=/backups/restic \
    RESTIC_CACHE_DIR=/backups/.cache

ENTRYPOINT ["/scripts/entrypoint.sh"]
CMD ["cron"]
