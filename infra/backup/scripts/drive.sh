# Etapa "drive" do backup: um arquivo cifrado por dia no Google Drive do
# escritório, conectado em Configurações > Sistema > Backup (migração 020).
# Carregado pelo backup.sh com ". /scripts/drive.sh" (usa log, registrar, pg_prod).
#
#   painel-backup-AAAA-MM-DD.tar.gpg  =  tar com
#     banco/postgres.dump + banco/roles.sql   (pg_dump do dia, o mesmo da etapa db)
#     chave-do-banco/                         (volume supabase-db-config: abre o Vault)
#     arquivos-storage/                       (anexos do Storage, se couber no limite)
#     LEIA-ME.txt
#   cifrado com gpg (AES-256) e a senha BACKUP_PASSPHRASE.
#
# Retenção: ficam os últimos N (padrão 30, coluna "manter"); os mais antigos
# são apagados. O app só enxerga o que ele mesmo criou (escopo drive.file).
#
# Segredos (refresh token, client secret, token de acesso, senha) só passam por
# arquivo 0600 em $DRV_TMP — nunca pela linha de comando, que aparece no ps.

: "${DRIVE_LIMITE_STORAGE_MB:=300}"
DRV_TMP=/tmp/drive
: "${DRV_API:=https://www.googleapis.com/drive/v3}"
: "${DRV_UPLOAD:=https://www.googleapis.com/upload/drive/v3}"
: "${DRV_TOKEN_URL:=https://oauth2.googleapis.com/token}"

drv_limpar() { rm -rf "$DRV_TMP" "$WORK/drive"; }

# drv_falha <inicio> <destino> <mensagem> [precisaReconectar]
drv_falha() {
  falhas=$((falhas + 1))
  log "ERRO em drive: $3"
  registrar drive "$1" false "" "$2" "$3" "$(jq -cn --argjson r "${4:-false}" '{precisaReconectar:$r}')"
  drv_limpar
}

# curl com o token de acesso no cabeçalho (lido de arquivo).
drv_curl() { curl -sS -m 120 --retry 2 --retry-delay 5 -H "@$DRV_TMP/auth.hdr" "$@"; }

# Mensagem curta de um JSON de erro do Google.
drv_erro() {
  jq -r 'if (.error | type) == "object" then (.error.message // "erro")
         elif .error then .error + (if .error_description then ": " + .error_description else "" end)
         else "resposta inesperada" end' "$1" 2>/dev/null | head -c 300
}

etapa_drive() {
  (umask 077; mkdir -p "$DRV_TMP")
  if ! pg_prod -c "select row_to_json(c) from public.drive_credenciais() c" >"$DRV_TMP/cred.json" 2>"$ERR"; then
    # Banco sem a migração 020 (ou fora do ar): não é falha do Drive.
    log "drive: não consegui ler a conexão ($(tail -c 200 "$ERR")); pulando"
    drv_limpar; return
  fi
  if [ "$(jq -r 'if .refreshToken and .pastaId and .clientId and .clientSecret then "sim" else "nao" end' "$DRV_TMP/cred.json" 2>/dev/null)" != sim ]; then
    log "drive: não conectado; pulando"
    drv_limpar; return
  fi

  inicio=$(agora_iso)
  conta=$(jq -r '.conta // "?"' "$DRV_TMP/cred.json")
  pasta=$(jq -r '.pastaId' "$DRV_TMP/cred.json")
  manter=$(jq -r '.manter // 30' "$DRV_TMP/cred.json")
  dest="Google Drive ($conta)"
  jq -j '.refreshToken' "$DRV_TMP/cred.json" >"$DRV_TMP/refresh"
  jq -j '.clientId' "$DRV_TMP/cred.json" >"$DRV_TMP/client_id"
  jq -j '.clientSecret' "$DRV_TMP/cred.json" >"$DRV_TMP/client_secret"
  rm -f "$DRV_TMP/cred.json"

  if [ ! -f "$WORK/db.ok" ] || [ ! -s "$WORK/db/postgres.dump" ] || [ ! -s "$WORK/db/roles.sql" ]; then
    drv_falha "$inicio" "$dest" "o dump do banco de hoje não está disponível ou não passou na conferência (a etapa do banco falhou)"; return
  fi

  # 1. Token de acesso.
  code=$(curl -sS -m 30 -o "$DRV_TMP/token.json" -w '%{http_code}' "$DRV_TOKEN_URL" \
    --data grant_type=refresh_token \
    --data-urlencode "refresh_token@$DRV_TMP/refresh" \
    --data-urlencode "client_id@$DRV_TMP/client_id" \
    --data-urlencode "client_secret@$DRV_TMP/client_secret" 2>"$ERR") || code=000
  if [ "$code" != 200 ]; then
    if [ "$code" = 000 ]; then
      drv_falha "$inicio" "$dest" "sem resposta do Google: $(tail -c 300 "$ERR")"
    else
      msg=$(drv_erro "$DRV_TMP/token.json")
      case "$msg" in
        # Client ID/Secret errados ou apagados no Google Cloud: reconectar não resolve.
        *invalid_client*|*unauthorized_client*)
          drv_falha "$inicio" "$dest" "o Google recusou o Client ID/Secret ($msg). Confira as credenciais em Configurações > Sistema > Acesso OAuth do Google Cloud." ;;
        *invalid_grant*|*expired*|*revoked*)
          drv_falha "$inicio" "$dest" "o Google não aceita mais o acesso ($msg). Conecte o Drive de novo em Configurações > Sistema." true ;;
        *)
          drv_falha "$inicio" "$dest" "o Google recusou o acesso ($code: $msg). Tenta de novo na próxima execução." ;;
      esac
    fi
    return
  fi
  printf 'Authorization: Bearer %s\n' "$(jq -r '.access_token' "$DRV_TMP/token.json")" >"$DRV_TMP/auth.hdr"
  rm -f "$DRV_TMP/token.json" "$DRV_TMP/refresh" "$DRV_TMP/client_secret"

  # 2. A pasta ainda existe?
  code=$(drv_curl -o "$DRV_TMP/pasta.json" -w '%{http_code}' "$DRV_API/files/$pasta?fields=id,trashed" 2>"$ERR") || code=000
  # Só 404 ou lixeira é "pasta sumiu" (reconectar recria). Rede, 5xx, 429...
  # são passageiros: pedir reconexão aí criaria outra pasta e deixaria os
  # backups antigos fora da retenção.
  if [ "$code" = 404 ] || { [ "$code" = 200 ] && [ "$(jq -r '.trashed' "$DRV_TMP/pasta.json")" = true ]; }; then
    drv_falha "$inicio" "$dest" "a pasta do backup não existe mais no Drive (apagada ou na lixeira). Conecte o Drive de novo para recriar." true
    return
  fi
  if [ "$code" != 200 ]; then
    drv_falha "$inicio" "$dest" "o Drive não respondeu à conferência da pasta ($code): $(drv_erro "$DRV_TMP/pasta.json" 2>/dev/null) $(tail -c 200 "$ERR")"
    return
  fi

  # 3. Pacote: banco + chave do Vault + Storage (se couber) + LEIA-ME.
  dia=$(date '+%Y-%m-%d')
  nome="painel-backup-$dia.tar.gpg"
  pac="$WORK/drive/pacote"
  rm -rf "$WORK/drive" && mkdir -p "$pac"
  ln -s "$WORK/db" "$pac/banco"
  [ -d /origem/supabase-db-config ] && ln -s /origem/supabase-db-config "$pac/chave-do-banco"
  storage_mb=0
  sem_storage=false
  if [ -d /origem/supabase-storage ]; then
    storage_mb=$(( $(du -sb /origem/supabase-storage | cut -f1) / 1048576 ))
    if [ "$storage_mb" -le "$DRIVE_LIMITE_STORAGE_MB" ]; then
      ln -s /origem/supabase-storage "$pac/arquivos-storage"
    else
      sem_storage=true
      log "drive: Storage com ${storage_mb} MB passa do limite de ${DRIVE_LIMITE_STORAGE_MB} MB; vai só o banco"
    fi
  fi
  cat >"$pac/LEIA-ME.txt" <<EOF
Backup do Painel NÓS — $dia (gerado em $(date '+%d/%m/%Y %H:%M %Z'))

Este arquivo está cifrado (AES-256). A senha é a "senha do backup"
(BACKUP_PASSPHRASE), guardada no gerenciador de senhas do responsável pelo painel.

1. Abrir:  gpg --decrypt $nome > backup.tar   (Windows: Gpg4win, gpg4win.org)
2. Extrair: tar -xf backup.tar
3. Conteúdo:
   banco/postgres.dump    banco inteiro (pg_dump -Fc do Postgres 17)
   banco/roles.sql        papéis do Postgres
   chave-do-banco/        chave do Vault (sem ela os segredos do banco não abrem)
   arquivos-storage/      anexos do Storage$( [ "$sem_storage" = true ] && printf ' (FORA deste arquivo: passou de %s MB)' "$DRIVE_LIMITE_STORAGE_MB")
4. Restaurar: siga docs/BACKUP.md, seção "Restaurar", do repositório do painel.
EOF

  printf '%s' "$BACKUP_PASSPHRASE" >"$DRV_TMP/senha"
  export GNUPGHOME="$DRV_TMP/gnupg"
  mkdir -p "$GNUPGHOME"
  arq="$WORK/drive/$nome"
  # O sh não tem pipefail: o código do tar vai para um arquivo. GNU tar: 1 =
  # algum arquivo mudou durante a leitura (serviço no ar, só aviso); 2+ = falhou.
  { tar -chf - -C "$pac" . 2>"$ERR.tar"; echo $? >"$DRV_TMP/rc.tar"; } | gpg --batch --yes --quiet --pinentry-mode loopback \
        --passphrase-file "$DRV_TMP/senha" --symmetric --cipher-algo AES256 \
        --s2k-digest-algo SHA512 --s2k-count 65011712 --compress-algo zlib -o "$arq" 2>"$ERR"
  rc_gpg=$?
  rc_tar=$(cat "$DRV_TMP/rc.tar" 2>/dev/null || echo 99)
  rm -f "$DRV_TMP/senha"
  if [ "$rc_gpg" -ne 0 ] || [ "$rc_tar" -ge 2 ]; then
    drv_falha "$inicio" "$dest" "não consegui montar o arquivo (tar $rc_tar, gpg $rc_gpg): $(tail -c 300 "$ERR") $(tail -c 200 "$ERR.tar")"; return
  fi
  [ "$rc_tar" -eq 1 ] && log "drive: aviso: arquivos mudaram durante a cópia: $(tail -c 300 "$ERR.tar")"
  # O arquivo tem que abrir com a senha (confere a cifra antes de mandar).
  { printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 0 \
        --decrypt "$arq" 2>"$ERR"; echo $? >"$DRV_TMP/rc.dec"; } | tar -tf - >"$DRV_TMP/lista" 2>>"$ERR"
  rc_lista=$?
  if [ "$(cat "$DRV_TMP/rc.dec" 2>/dev/null || echo 99)" -ne 0 ] || [ "$rc_lista" -ne 0 ]; then
    drv_falha "$inicio" "$dest" "o arquivo cifrado não abriu na conferência: $(tail -c 300 "$ERR")"; return
  fi
  grep -q 'banco/postgres.dump' "$DRV_TMP/lista" || { drv_falha "$inicio" "$dest" "o arquivo saiu sem o dump do banco"; return; }
  tam=$(stat -c %s "$arq")

  # 4. Envio (upload retomável: serve para qualquer tamanho).
  jq -cn --arg n "$nome" --arg p "$pasta" --arg d "Backup diário do Painel NÓS ($dia). Cifrado; veja o LEIA-ME dentro." \
    '{name:$n, parents:[$p], description:$d, mimeType:"application/octet-stream"}' >"$DRV_TMP/meta.json"
  code=$(drv_curl -o "$DRV_TMP/sessao.json" -D "$DRV_TMP/sessao.hdr" -w '%{http_code}' -X POST \
    -H 'Content-Type: application/json; charset=UTF-8' \
    -H 'X-Upload-Content-Type: application/octet-stream' \
    -H "X-Upload-Content-Length: $tam" \
    --data-binary "@$DRV_TMP/meta.json" \
    "$DRV_UPLOAD/files?uploadType=resumable&fields=id,name,size" 2>"$ERR") || code=000
  local_url=$(grep -i '^location:' "$DRV_TMP/sessao.hdr" 2>/dev/null | head -1 | cut -d' ' -f2- | tr -d '\r\n')
  if [ "$code" != 200 ] || [ -z "$local_url" ]; then
    drv_falha "$inicio" "$dest" "o Drive recusou o envio ($code): $(drv_erro "$DRV_TMP/sessao.json") $(tail -c 200 "$ERR")"; return
  fi
  code=$(curl -sS -m 3600 -o "$DRV_TMP/enviado.json" -w '%{http_code}' -X PUT -H "@$DRV_TMP/auth.hdr" \
    -H 'Content-Type: application/octet-stream' --upload-file "$arq" "$local_url" 2>"$ERR") || code=000
  if [ "$code" != 200 ] && [ "$code" != 201 ]; then
    msg=$(drv_erro "$DRV_TMP/enviado.json")
    case "$msg" in *torage*uota*|*quota*) msg="o Drive está sem espaço ($msg)" ;; esac
    drv_falha "$inicio" "$dest" "falhou o envio do arquivo ($code): $msg $(tail -c 200 "$ERR")"; return
  fi
  enviado_id=$(jq -r '.id // ""' "$DRV_TMP/enviado.json")
  enviado_tam=$(jq -r '.size // "0"' "$DRV_TMP/enviado.json")
  if [ -z "$enviado_id" ] || [ "$enviado_tam" != "$tam" ]; then
    drv_falha "$inicio" "$dest" "o Drive confirmou $enviado_tam bytes, o arquivo tem $tam"; return
  fi

  # 5. Retenção: um por dia (o mais novo de cada nome) e só os últimos $manter.
  q="'$pasta' in parents and trashed = false and name contains 'painel-backup-'"
  code=$(drv_curl -G -o "$DRV_TMP/lista.json" -w '%{http_code}' "$DRV_API/files" \
    --data-urlencode "q=$q" --data-urlencode 'orderBy=createdTime desc' \
    --data-urlencode 'pageSize=1000' --data-urlencode 'fields=files(id,name,createdTime)' 2>"$ERR") || code=000
  if [ "$code" != 200 ]; then
    drv_falha "$inicio" "$dest" "enviado, mas não consegui listar a pasta para apagar os antigos: $(drv_erro "$DRV_TMP/lista.json")"; return
  fi
  # Ordem: mais novo primeiro. Repetidos do mesmo dia saem; depois, o que passar de $manter.
  jq -r --argjson m "$manter" '
    .files as $f
    | ($f | reduce .[] as $x ({vistos:{}, fica:[], sai:[]};
        if .vistos[$x.name] then .sai += [$x.id] else .vistos[$x.name] = true | .fica += [$x.id] end)) as $r
    | ($r.sai + $r.fica[$m:])[]' "$DRV_TMP/lista.json" >"$DRV_TMP/apagar"
  total=$(jq '.files | length' "$DRV_TMP/lista.json")
  apagados=0
  erros_apagar=0
  while read -r id; do
    [ -n "$id" ] || continue
    code=$(drv_curl -o /dev/null -w '%{http_code}' -X DELETE "$DRV_API/files/$id" 2>/dev/null) || code=000
    if [ "$code" = 204 ] || [ "$code" = 404 ]; then apagados=$((apagados + 1)); else erros_apagar=$((erros_apagar + 1)); fi
  done <"$DRV_TMP/apagar"
  ficaram=$((total - apagados))

  det=$(jq -cn --arg arq "$nome" --arg conta "$conta" --argjson manter "$manter" --argjson ficaram "$ficaram" \
        --argjson apagados "$apagados" --argjson semStorage "$sem_storage" --argjson storageMb "$storage_mb" \
        '{arquivo:$arq, conta:$conta, manter:$manter, naPasta:$ficaram, apagados:$apagados,
          semStorage:$semStorage, storageMb:$storageMb, precisaReconectar:false}')
  if [ "$erros_apagar" -gt 0 ]; then
    falhas=$((falhas + 1))
    registrar drive "$inicio" false "$tam" "$dest" "enviado, mas $erros_apagar backup(s) antigo(s) não foram apagados" "$det"
    log "drive: enviado $nome, mas $erros_apagar antigo(s) não foram apagados"
  else
    registrar drive "$inicio" true "$tam" "$dest" "" "$det"
    log "drive: ok — $nome ($tam bytes), $ficaram na pasta, $apagados antigo(s) apagado(s)"
  fi
  drv_limpar
}
