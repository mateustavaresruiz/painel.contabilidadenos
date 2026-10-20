# Backup do Painel Denos

Serviço Compose **`backup`** no projeto `painel` do Easypanel, com código em
`infra/backup` (este repositório, rootPath `/infra/backup`, arquivo `docker-compose.yml`).
Ele é separado do `supabase` para que publicar o backup não reinicie o banco.

## O que entra no backup

| Item | Origem (volume Docker real) | Observação |
|---|---|---|
| Banco `postgres` inteiro | `supabase-db` pela rede `painel_supabase_default` | `pg_dump -Fc` como `supabase_admin`: public, auth, storage, vault, cron... |
| Papéis do Postgres | idem | `pg_dumpall --roles-only` (com hash de senha) |
| Arquivos do Storage (WhatsApp, marca, consultas fiscais) | `painel_supabase_storage-data` | |
| Chave do banco (pgsodium/vault) | `painel_supabase_db-config` | sem ela, segredos do vault não se abrem |
| Sessões do WAHA | `painel_waha_sessions` | evita parear o WhatsApp de novo |
| Gateway Serpro | `painel_integra-contador_integra-contador-dados` | vazio em 18/10/2026 |
| E-mail (Stalwart) | `painel_email_stalwart-etc`, `painel_email_stalwart-data` | **vazios em 18/10/2026**: o Stalwart pode estar gravando fora desses volumes, confira |
| Blog Ghost (SQLite + imagens) | `site_blog_blog-content-2` | |

Todos os volumes entram **somente leitura** (`:ro`). Nenhum serviço é parado:
WAHA, Ghost e o resto são copiados com o serviço ligado. Um arquivo que muda
durante a cópia pode sair inconsistente; as sessões do WAHA são pequenas e o
risco é aceitável. Fica de fora o banco interno `_supabase` (métricas e pooler),
que o Supabase recria sozinho.

## Como funciona

- Imagem `infra/backup/Dockerfile`, fixada por tag e digest: `postgres:17.6-alpine3.22`
  (pg_dump 17.6, mesma versão do servidor), `restic 0.18.1`, `rclone 1.71.1`.
- **Quando:** todo dia às **03:00 (America/Sao_Paulo)**, no `crond` do container (`BACKUP_CRON`).
- **Onde:** repositório restic no volume `painel-backups` (`/backups/restic`), no próprio VPS.
- **Cifra:** restic (AES-256 + Poly1305) com a senha `BACKUP_PASSPHRASE`. Sem a
  senha, ninguém lê o backup, nem nós. **Ela fica no gerenciador de senhas do dono**
  e no env do serviço `backup` no Easypanel.
- **Retenção:** 7 diários + 4 semanais + 6 mensais (`KEEP_DAILY/WEEKLY/MONTHLY`),
  separados para banco (`tag db`) e arquivos (`tag volumes`). Depois do `forget --prune`
  roda um `restic check`.
- **Google Drive do escritório:** depois do backup local, um arquivo cifrado por dia
  (`painel-backup-AAAA-MM-DD.tar.gpg`) vai para a pasta "Backup Painel NÓS" do Drive
  conectado na tela. Ficam os **últimos 30**. Ver [Cópia diária no Google Drive](#cópia-diária-no-google-drive).
- **Fora do servidor (restic completo):** opcional, `restic copy` para R2/B2 via rclone,
  com a mesma retenção. **Desligado** (`OFFSITE_ENABLED=false`).
- **Status:** cada etapa (`db`, `volumes`, `retencao`, `drive`, `offsite`, `restore-test`) grava uma
  linha em `BackupExecucao` (migração 014). O script entra como `supabase_admin` e faz
  `SET ROLE backup_monitor`, que só pode INSERIR em `BackupExecucao` e em `ErrorLog`
  (`origem = 'backup'`). Falha vira linha em `ErrorLog` e aparece no "Log de erros".
- **Tela:** Configurações > Sistema > **Backup** mostra o último resultado de cada etapa
  (quando, tamanho, ok/falhou, cópia remota ligada/desligada) e fica **vermelho** quando o
  último backup completo bem-sucedido tem mais de 26 h.

### Variáveis do serviço `backup` (Easypanel > painel > backup > Environment)

| Variável | Valor |
|---|---|
| `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_USER` / `POSTGRES_DB` | `supabase-db` / `5432` / `supabase_admin` / `postgres` |
| `POSTGRES_PASSWORD` | a mesma do compose `supabase` |
| `BACKUP_PASSPHRASE` | senha do backup (gerenciador de senhas do dono) |
| `BACKUP_CRON` | `0 3 * * *` |
| `RUN_ON_START` | `false`; `true` + Deploy = roda um backup agora (volte para `false`) |
| `KEEP_DAILY` / `KEEP_WEEKLY` / `KEEP_MONTHLY` | `7` / `4` / `6` |
| `OFFSITE_ENABLED` | `false` até a credencial chegar |
| `OFFSITE_PATH` | pasta/bucket remoto (padrão `painel-backups`) |

Para rodar um backup na hora: `RUN_ON_START=true`, Deploy, conferir a tela, voltar para `false`.

## Cópia diária no Google Drive

Decisão do dono (20/10/2026): o backup vai para o **Drive da própria contadora**, conectado
por OAuth na tela, sem conta de serviço nem Drive compartilhado.

**Como funciona**

- Configurações > Sistema > **Cópia diária no Google Drive**. Três passos: colar o Client
  ID/Secret do Google Cloud (uma vez) → **Conectar Google Drive** (tela de consentimento do
  Google) → pronto. A function `google-drive` cria a pasta **Backup Painel NÓS** no Drive.
- Escopo `drive.file`: o painel só enxerga o que ele mesmo criou (a pasta e os backups).
  Não lê nem apaga nada mais do Drive, e o Google **não exige verificação** do app.
- O refresh token e o Client Secret ficam no **Vault** (`google_drive_refresh_token`,
  `google_drive_client_secret`); o resto em `BackupGoogleDrive` (migração 020). Nenhuma rota
  devolve segredo à tela.
- Às 03:00, depois do backup local, `scripts/drive.sh` (serviço `backup`) lê a conexão
  (`drive_credenciais()`), monta o tar, cifra com gpg (AES-256, senha `BACKUP_PASSPHRASE`),
  **confere que abre** com a senha, envia (upload retomável), apaga o repetido do mesmo dia e
  o que passar dos 30 mais novos. Resultado em `BackupExecucao` (`drive`), que aparece no card.
- Conteúdo: `banco/postgres.dump` + `banco/roles.sql`, `chave-do-banco/` (volume
  `supabase-db-config`, abre o Vault), `arquivos-storage/` (anexos do Storage, só se tiverem
  até `DRIVE_LIMITE_STORAGE_MB`, padrão 300 MB, para 30 cópias caberem no Drive gratuito) e
  `LEIA-ME.txt`. Sessões do WAHA, e-mail e blog ficam só no backup do servidor.
- Falhas viram linha vermelha no card e no Log de erros. Token revogado, senha da conta
  trocada ou pasta apagada → o card pede **Conectar de novo** (mesma conta reaproveita a pasta).

**Criar o acesso OAuth (uma vez, quem mantém o painel)**

1. console.cloud.google.com > projeto do escritório > ativar a **Google Drive API**.
2. Tela de consentimento OAuth: Externo, nome "Painel NÓS", escopo `.../auth/drive.file`.
   **Publicar o app** ("Em produção"). Em "Teste" o refresh token expira em 7 dias e o
   backup para; com só `drive.file` (escopo não sensível) não há verificação.
3. Credenciais > ID do cliente OAuth > Aplicativo da Web > URI de redirecionamento:
   `https://painel-supabase.at63vf.easypanel.host/functions/v1/google-drive/callback`
   (o card mostra o endereço com botão Copiar). Trocou o domínio do Supabase, troque aqui.
4. Colar Client ID e Secret no card e clicar em Conectar (com a conta Google dela).

**Restaurar a partir do Drive**

1. Baixe o `painel-backup-AAAA-MM-DD.tar.gpg` da pasta.
2. `gpg --decrypt painel-backup-AAAA-MM-DD.tar.gpg > backup.tar` (Windows: Gpg4win) com a
   senha do backup, e `tar -xf backup.tar`.
3. Siga [Banco inteiro (desastre)](#banco-inteiro-desastre) usando `banco/postgres.dump` e
   `banco/roles.sql`; se o volume do banco se perdeu, devolva antes `chave-do-banco/` ao
   volume `painel_supabase_db-config`.

**Rodar agora** (testar depois de conectar): `RUN_ON_START=true` no serviço `backup` >
Deploy > conferir o card > voltar para `false`.

## Cópia completa fora do servidor com conta de serviço (alternativa antiga)

Precisa de **conta de serviço** do Google Cloud. Conta de serviço não tem espaço próprio,
por isso o destino tem que ser um **Drive compartilhado** (Shared Drive). Hoje o caminho
usado é o da seção acima; este fica para um repositório restic completo em R2/B2.

1. Google Cloud > IAM > Contas de serviço > criar (ex.: `painel-backup`) > Chaves > JSON.
2. Ativar a **Google Drive API** no mesmo projeto.
3. No Google Drive, criar o Drive compartilhado (ex.: "Backup Painel") > Gerenciar membros >
   adicionar o e-mail da conta de serviço como **Administrador de conteúdo**.
4. O ID do Drive compartilhado é o final da URL `https://drive.google.com/drive/folders/<ID>`.
5. Converter o JSON em base64 numa linha (PowerShell):
   `[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\caminho\sa.json"))`
6. No env do serviço `backup`:

```
OFFSITE_ENABLED=true
OFFSITE_PATH=painel-backups
RCLONE_CONFIG_OFFSITE_TYPE=drive
RCLONE_CONFIG_OFFSITE_SCOPE=drive
RCLONE_CONFIG_OFFSITE_TEAM_DRIVE=<ID do Drive compartilhado>
OFFSITE_GDRIVE_SA_JSON_B64=<JSON da conta de serviço em base64>
```

7. `RUN_ON_START=true` > Deploy > em Configurações > Sistema, "Cópia fora do servidor"
   tem que ficar **ok**. Volte `RUN_ON_START=false`.

### Alternativa: Cloudflare R2 (ou outro S3)

Token do R2 com "Object Read & Write" só no bucket:

```
OFFSITE_ENABLED=true
OFFSITE_PATH=<bucket>/painel
RCLONE_CONFIG_OFFSITE_TYPE=s3
RCLONE_CONFIG_OFFSITE_PROVIDER=Cloudflare
RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID=<access key>
RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY=<secret>
RCLONE_CONFIG_OFFSITE_ENDPOINT=https://<account id>.r2.cloudflarestorage.com
RCLONE_CONFIG_OFFSITE_NO_CHECK_BUCKET=true
```

Backblaze B2: `RCLONE_CONFIG_OFFSITE_TYPE=b2`, `RCLONE_CONFIG_OFFSITE_ACCOUNT=<keyID>`,
`RCLONE_CONFIG_OFFSITE_KEY=<applicationKey>`, `OFFSITE_PATH=<bucket>/painel`.

Qualquer opção do rclone entra como `RCLONE_CONFIG_OFFSITE_<OPÇÃO>`. O repositório remoto
é criado na primeira cópia, com a mesma senha.

## Restaurar

Os comandos abaixo rodam no **Console** do container `painel-backup` (Easypanel >
painel > backup), que já tem a senha no ambiente: antes de tudo, `. /scripts/lib.sh && exigir_senha`.

```
restic -r /backups/restic snapshots                    # lista (tag db / volumes)
restic -r /backups/restic ls latest --tag volumes /origem/waha-sessions
```

Sem acesso ao servidor (VPS perdido): com o repositório remoto e a senha, em qualquer
máquina com restic + rclone configurado: `restic -r rclone:offsite:painel-backups snapshots`.

### Banco inteiro (desastre)

1. Pare o `web` e as funções (o painel fica fora do ar).
2. Extraia o dump: `restic -r /backups/restic restore latest --tag db --target /tmp/r`
   (arquivos em `/tmp/r/backups/.work/db/`: `postgres.dump` e `roles.sql`).
3. Se o volume `db-data` se perdeu: restaure **antes** o `supabase-db-config` (seção
   abaixo, `ORIGEM=supabase-db-config`, `ALVO_VOLUME=painel_supabase_db-config`) e só depois
   suba o `supabase` com o `db-data` novo, para o vault usar a mesma chave.
4. Papéis: `PGPASSWORD=$POSTGRES_PASSWORD psql -h supabase-db -U supabase_admin -d postgres -f /tmp/r/backups/.work/db/roles.sql`
   (erros "já existe" são normais).
5. Dados: `PGPASSWORD=$POSTGRES_PASSWORD pg_restore -h supabase-db -U supabase_admin -d postgres --clean --if-exists --no-comments /tmp/r/backups/.work/db/postgres.dump`
6. Confira `select count(*) from "Cliente"`, `_migracao`, religue o `web` e as funções.

### Só uma tabela ou alguns registros

Restaure o dump num banco à parte (`createdb -h supabase-db -U supabase_admin resgate` +
`pg_restore -d resgate ...`), copie o que precisa e apague o banco `resgate`.

### Um volume (ex.: sessões do WAHA)

O container de backup só tem os volumes em modo leitura, então a restauração usa um
serviço Compose temporário:

1. Pare o serviço dono do volume (ex.: `waha`) no Easypanel.
2. Crie o serviço Compose `backup-restaura` no projeto `painel`: Git deste repositório,
   rootPath `/infra/backup`, arquivo `docker-compose.restore-volume.yml`, env:
   ```
   BACKUP_PASSPHRASE=<a mesma do backup>
   ALVO_VOLUME=painel_waha_sessions
   ORIGEM=waha-sessions
   SNAPSHOT=latest
   CONFIRMA=sim
   LIMPAR=sim
   ```
   Sem `CONFIRMA=sim` ele só lista o snapshot e o destino, sem alterar nada.
3. Deploy, conferir o log ("restaurado: N arquivos"), **destruir** o `backup-restaura`.
4. Religue o `waha`. A sessão volta sem novo QR code se o backup for recente.

`ORIGEM` / `ALVO_VOLUME` dos outros: `supabase-storage` / `painel_supabase_storage-data`,
`integra-contador-dados` / `painel_integra-contador_integra-contador-dados`,
`stalwart-etc` / `painel_email_stalwart-etc`, `stalwart-data` / `painel_email_stalwart-data`,
`blog-content` / `site_blog_blog-content-2`, `supabase-db-config` / `painel_supabase_db-config`.

## Trocar a senha do backup

A senha do restic protege a chave-mestra. Trocar não recifra os dados.

```
. /scripts/lib.sh && exigir_senha
printf '%s' '<nova senha>' > /tmp/nova && chmod 600 /tmp/nova
restic -r /backups/restic key add --new-password-file /tmp/nova
restic -r /backups/restic key list            # anote o ID da chave antiga
restic -r /backups/restic key remove <ID antigo>
rm /tmp/nova
```

Repita no remoto (`-r rclone:offsite:<OFFSITE_PATH>`), troque `BACKUP_PASSPHRASE` no
Easypanel, faça Deploy e atualize o gerenciador de senhas. Se a senha antiga **vazou**
junto com uma cópia do repositório, crie um repositório novo (cópias antigas continuam
abríveis com a senha antiga).

## Teste de restauração

`docker-compose.restore-test.yml`: um Postgres descartável (mesma imagem de produção,
sem volume) e o `restore-test`, que:

1. confere que senha errada não abre o repositório;
2. roda `restic check --read-data` (lê e decifra todo o conteúdo);
3. restaura o último dump num banco novo `restore_test` (papéis + `pg_restore` completo);
4. compara a contagem de linhas de todas as tabelas de `public` (e `auth.users`,
   `storage.objects`) com produção;
5. restaura o último snapshot de volumes e conta arquivos/bytes por volume.

Grava o resultado em `BackupExecucao` (`restore-test`), que aparece na tela.
Para repetir: crie o Compose `backup-teste` (rootPath `/infra/backup`, arquivo
`docker-compose.restore-test.yml`, env `POSTGRES_PASSWORD` + `BACKUP_PASSPHRASE`), Deploy,
espere a linha na tela e **destrua o serviço**.

### Registro

**18/10/2026, 01:35 (BRT), ok.**
- Backups: banco 1,04 MB (1.225 itens no índice do dump); volumes 26,4 MB, 61 arquivos
  (blog 24,3 MB, WAHA 2,1 MB, storage 104 KB, db-config 67 KB; e-mail e gateway vazios).
  A segunda rodada acrescentou só 368 bytes nos volumes (deduplicação funcionando) e o
  repositório continuou lá depois que o serviço de teste foi destruído.
- Senha errada recusada; `restic check --read-data` sem erros.
- `pg_restore`: 18 erros, todos do pg_cron (`schema "cron" does not exist` e "can only
  create extension in database postgres"), esperados porque o teste restaura no banco
  `restore_test`. Num restauro de verdade (no banco `postgres`) o cron é recriado.
- Contagens: 28 tabelas iguais. Cliente 1/1, Colaborador 2/2, WhatsappMensagem 13/13,
  `_migracao` 14/14. Diferentes só `BackupExecucao` (2/5) e `CronChamada` (593/594), que
  cresceram depois do dump.
- Volumes restaurados: blog 30 arquivos, WAHA 10, storage 1, db-config 20.
- Teste local antes (Docker Desktop, banco fictício): backup, falha simulada gravando
  `ErrorLog`, cópia remota (rclone tipo `local`) e restauração passaram.

## Limites conhecidos

- O backup local fica no **mesmo disco** do servidor. A cópia de fora é a do Google Drive
  (banco + chave + Storage); sem ela conectada, um problema no VPS leva os dois.
- Os logs do Easypanel (Loki) estão desligados; o histórico fica em `BackupExecucao` e no
  log do container.
- O container tem um volume anônimo vazio (`/var/lib/postgresql/data`, declarado pela
  imagem `postgres`); não é usado.
