#!/bin/sh
# Teste de restauração (roda no docker-compose.restore-test.yml, descartável).
#
#  1. senha errada NÃO abre o repositório; a certa abre
#  2. restic check --read-data: todo o conteúdo cifrado é lido e decifrado
#  3. último snapshot "db": pg_restore --list + restauração completa num banco
#     novo (restore_test) num Postgres DESCARTÁVEL (supabase/postgres igual ao de produção)
#  4. contagem de linhas de todas as tabelas de public (e auth.users,
#     storage.objects) restauradas x produção agora
#  5. último snapshot "volumes": restaura e confere arquivos e bytes por volume
#
# Produção só é LIDA (contagens), mais uma linha em BackupExecucao (tipo restore-test).
set -u
export LC_ALL=C
. /scripts/lib.sh
exigir_senha || exit 1

: "${SCRATCH_HOST:=restore-scratch-db}"
inicio=$(agora_iso)
R=/tmp/restore
rm -rf "$R" && mkdir -p "$R"
export RESTIC_CACHE_DIR=/tmp/restic-cache
REPO="$BACKUP_REPO"
problemas=""
anota() { problemas="$problemas$*; "; log "PROBLEMA: $*"; }

pg_scratch() {
  PGPASSWORD="$POSTGRES_PASSWORD" psql -h "$SCRATCH_HOST" -p 5432 -U supabase_admin -X -q -A -t "$@"
}

log "== 1. senha"
if RESTIC_PASSWORD="senha-errada-$$" restic -r "$REPO" snapshots --no-lock >/dev/null 2>&1; then
  anota "senha errada abriu o repositório"
else
  log "senha errada: recusada (ok)"
fi
restic -r "$REPO" snapshots --no-lock || anota "senha certa não abriu"

log "== 2. restic check --read-data"
if restic -r "$REPO" check --no-lock --read-data >/tmp/check.log 2>&1; then
  log "check --read-data: $(tail -1 /tmp/check.log)"
else
  anota "check --read-data falhou: $(tail -c 400 /tmp/check.log)"
fi

log "== 3. restaurar o banco"
restic -r "$REPO" restore latest --no-lock --host "$BACKUP_HOST" --tag db --target "$R/db" >/dev/null \
  || anota "restic restore db falhou"
DUMP=$(find "$R/db" -name postgres.dump | head -1)
ROLES=$(find "$R/db" -name roles.sql | head -1)
[ -n "$DUMP" ] || { anota "postgres.dump não está no snapshot"; DUMP=/dev/null; }
log "dump: $(stat -c %s "$DUMP" 2>/dev/null) bytes; itens no índice: $(pg_restore --list "$DUMP" | grep -vc '^;')"

log "aguardando o Postgres descartável ($SCRATCH_HOST)"
i=0
until pg_scratch -d postgres -c 'select 1' >/dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -lt 90 ] || { anota "Postgres descartável não subiu"; break; }
  sleep 2
done
sleep 5  # o supabase/postgres reinicia uma vez no fim do init

# Trava de segurança: o alvo tem que ser um banco vazio, nunca produção.
if [ "$(pg_scratch -d postgres -c "select to_regclass('public.\"Cliente\"') is null")" != "t" ]; then
  log "ABORTADO: $SCRATCH_HOST tem tabela Cliente — não é o Postgres descartável"
  exit 2
fi

[ -z "$ROLES" ] || pg_scratch -d postgres -f "$ROLES" >/tmp/roles.log 2>&1
log "papéis aplicados ($(grep -c 'ERROR' /tmp/roles.log 2>/dev/null || echo 0) avisos de 'já existe' esperados)"
pg_scratch -d postgres -c 'drop database if exists restore_test' -c 'create database restore_test' >/dev/null
PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -h "$SCRATCH_HOST" -U supabase_admin -d restore_test \
  --no-comments "$DUMP" >/tmp/pg_restore.log 2>&1
errs=$(grep -c '^pg_restore: error' /tmp/pg_restore.log || true)
log "pg_restore terminou com $errs erro(s)"
if [ "$errs" -gt 0 ]; then
  log "erros (resumo):"
  grep '^pg_restore: error' /tmp/pg_restore.log | sed 's/^pg_restore: error: //' | cut -c1-220 | sort | uniq -c | sort -rn | head -25
fi

log "== 4. contagens restaurado x produção"
SQL_TAB="select format('select %L as t, count(*) as n from %I.%I', n.nspname || '.' || c.relname, n.nspname, c.relname)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r','p') order by 1"
pg_scratch -d restore_test -c "$SQL_TAB" >/tmp/q.sql
{ cat /tmp/q.sql; echo "select 'auth.users', count(*) from auth.users"; echo "select 'storage.objects', count(*) from storage.objects"; } \
  | sed 's/$/;/' >/tmp/q2.sql
pg_scratch -d restore_test -v ON_ERROR_STOP=0 -F '|' -f /tmp/q2.sql 2>/dev/null | sort >/tmp/rest.txt
pg_prod -v ON_ERROR_STOP=0 -F '|' -f /tmp/q2.sql 2>/dev/null | sort >/tmp/prod.txt
printf '%-34s %12s %12s\n' tabela restaurado producao
awk -F'|' 'NR == FNR { r[$1] = $2; next }
  { a = ($1 in r) ? r[$1] : "-"; printf "%-34s %12s %12s%s\n", $1, a, $2, (a == $2 ? "" : "   <-- difere") }' \
  /tmp/rest.txt /tmp/prod.txt | tee /tmp/cmp.txt
for t in Cliente Colaborador _migracao; do
  l=$(grep "^public\.$t " /tmp/cmp.txt || true)
  [ -n "$l" ] || { anota "tabela $t não veio no restore"; continue; }
  echo "$l" | grep -q 'difere' && anota "contagem de $t difere"
done
iguais=$(grep -vc 'difere' /tmp/cmp.txt || true); diferentes=$(grep -c 'difere' /tmp/cmp.txt || true)

log "== 5. restaurar volumes"
restic -r "$REPO" restore latest --no-lock --host "$BACKUP_HOST" --tag volumes --target "$R/vol" >/dev/null 2>/tmp/rv.err \
  || anota "restic restore volumes falhou: $(tail -c 300 /tmp/rv.err)"
vols=$(for d in "$R"/vol/origem/*; do
  [ -d "$d" ] || continue
  printf '%s\t%s\t%s\n' "$(basename "$d")" "$(find "$d" -type f | wc -l)" "$(du -sb "$d" | cut -f1)"
done)
printf '%s\n' "$vols" | while IFS="$(printf '\t')" read -r v n b; do log "volume $v: $n arquivos, $b bytes"; done
volj=$(printf '%s\n' "$vols" | jq -Rn '[inputs | select(length>0) | split("\t") | {(.[0]): {arquivos:(.[1]|tonumber), bytes:(.[2]|tonumber)}}] | add // {}')

ok=true; [ -z "$problemas" ] || ok=false
key() { grep "^$1 " /tmp/cmp.txt | awk '{print $2"/"$3}'; }
det=$(jq -cn --argjson errs "$errs" --argjson iguais "${iguais:-0}" --argjson dif "${diferentes:-0}" \
  --arg cliente "$(key public.Cliente)" --arg colab "$(key public.Colaborador)" \
  --arg msg "$(key public.WhatsappMensagem)" --arg mig "$(key public._migracao)" \
  --argjson vol "$volj" --arg problemas "$problemas" \
  '{errosPgRestore:$errs, tabelasIguais:$iguais, tabelasDiferentes:$dif,
    "Cliente":$cliente, "Colaborador":$colab, "WhatsappMensagem":$msg, "_migracao":$mig,
    volumes:$vol, problemas:$problemas}')
registrar restore-test "$inicio" "$ok" "$(stat -c %s "$DUMP" 2>/dev/null)" "teste descartável" "$problemas" "$det"
log "RESULTADO: ok=$ok — $det"
