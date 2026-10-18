# Login e permissões do painel

Desde a migration `005_login.sql` o painel tem login por e-mail, **sem senha**, e
cada pessoa tem um **cargo** que diz o que ela pode fazer. Não existe cadastro
público: só entra quem um administrador convidou em **Equipe**.

## Como a pessoa entra

1. Abre o painel e digita o e-mail em **Entrar no painel**.
2. O Supabase Auth (GoTrue) manda um e-mail com **um link e um código de 6 números**.
3. Ela clica no link **ou** digita o código na mesma tela. Os dois valem 15 minutos e
   só uma vez. O botão "Reenviar" fica travado por 60 s.
4. A sessão fica guardada no navegador e renova sozinha. "Sair" fica no menu da conta
   (rodapé da barra lateral; no celular, o avatar no topo).

A tela responde sempre a mesma coisa ("se este e-mail tiver acesso, enviamos..."),
exista o e-mail ou não. Se a pessoa entrou mas não está ativa na equipe, vê
"Acesso não liberado" com o botão Sair.

Peças:
- Front: `apps/web/src/routes/auth/login.tsx`, `routes/auth/callback.tsx`,
  `components/auth-gate.tsx`, `lib/colaborador.tsx` (sessão + colaborador + permissões).
- O link do e-mail e o link de acesso caem em `/auth/callback?token_hash=...&type=...`,
  e é a página que troca o token pela sessão (um antivírus que "abre" o link do e-mail
  não gasta o token).
- Modelos de e-mail em português: `apps/web/public/email/*.html`, servidos pelo
  próprio painel (`https://painel-web.at63vf.easypanel.host/email/magic-link.html`)
  e apontados no env `MAILER_TEMPLATES_*` do serviço supabase.

## Como liberar alguém (convite)

Equipe > **Pessoas** > **Convidar**: nome, e-mail, cargo (telefone e cor opcionais).
A function `equipe` cria o usuário no Auth (sem senha, e-mail confirmado) e o
Colaborador ligado a ele.

- **Com SMTP configurado**: a pessoa recebe o e-mail de acesso.
- **Sem SMTP** (situação de hoje): o painel mostra um **link de acesso** de uso único
  para copiar e mandar por outro meio (WhatsApp, por exemplo).

Em cada pessoa: **Gerar link de acesso** (uso único, 15 min), **Enviar acesso** (só com
SMTP), **Desativar/Reativar**, editar e excluir.

- Desativar bloqueia o login (banimento no Auth), apaga as sessões abertas e a RLS
  passa a negar tudo na hora.
- Trocar o e-mail troca também o login.
- 🔴 Link e e-mail usam o MESMO token: gerar um link invalida o último e-mail de acesso,
  e pedir um código novo invalida o link gerado.

## Cargos e permissões

Equipe > **Cargos**: criar, editar e apagar cargos marcando permissões por módulo
("marcar tudo do módulo" no cabeçalho de cada grupo). Cargo com pessoas não se apaga
(mova as pessoas antes). O cargo **Administrador** é de sistema: tem todas as
permissões, não se edita nem se apaga, e sempre precisa haver pelo menos uma pessoa
ativa nele.

O catálogo está em `apps/web/src/lib/permissoes.ts` e na tabela `Permissao` (a do banco
é a que vale para validar os cargos). Permissão nova = migration nova + o front.

Onde cada permissão é aplicada:

| Camada | Como |
|---|---|
| Banco (RLS) | `tem_permissao('x')` / `tem_alguma(...)` nas políticas de cada tabela, RPCs e Storage (migration 005). Ex.: sem `whatsapp.ver_todas`, conversas e mensagens só as sem responsável ou as suas. |
| Edge Functions | `_shared/acesso.ts` valida o JWT no Auth, acha o Colaborador e as permissões do cargo; cada rota confere a sua (`permissaoDaRota` no whatsapp, mapa no serpro, `equipe.gerenciar` na equipe). |
| Front | `usePermissao('x')`, `PermissaoGate` nas rotas (mostra "Sem acesso"), menu e botões somem. |

Só na tela (sem barreira própria no banco): `whatsapp.exportar` (exportar é ler o que
já se pode ler), `equipe.ver` (a lista de pessoas é necessária em todo o painel para
mostrar responsáveis) e `aniversarios.ver` (a view usa as permissões de Cliente/Sócio).

### Matriz padrão (editável, exceto Administrador)

| Permissão | Administrador | Contador | Atendente | Estagiário |
|---|:-:|:-:|:-:|:-:|
| whatsapp.ver | x | x | x | x |
| whatsapp.ver_todas | x | x | | |
| whatsapp.responder | x | x | x | x |
| whatsapp.assumir | x | x | x | |
| whatsapp.transferir | x | x | x | |
| whatsapp.apagar_mensagens | x | | | |
| whatsapp.exportar | x | x | | |
| whatsapp.conexoes | x | | | |
| chamados.ver | x | x | x | x |
| chamados.criar | x | x | x | x |
| chamados.gerenciar | x | x | | |
| chamados.tipos | x | x | | |
| chamados.relatorio | x | x | | |
| clientes.ver | x | x | x | x |
| clientes.editar | x | x | | |
| clientes.excluir | x | | | |
| aniversarios.ver | x | x | x | x |
| certificados.ver | x | x | x | x |
| certificados.editar | x | x | | |
| certificados.configurar_avisos | x | x | | |
| serpro.consultar | x | x | | |
| serpro.confirmar_pin | x | x | | |
| dashboard.ver | x | x | x | |
| equipe.ver | x | x | x | |
| equipe.gerenciar | x | | | |
| configuracoes.gerenciar | x | | | |
| auditoria.ver | x | | | |

## Auditoria (quem fez o quê)

A migration `009_auditoria.sql` grava um evento (quem, o quê, quando, antes e depois) para tudo
que importa: chamados, clientes, sócios, certificados, equipe, cargos, ajustes, atendimento e
etiquetas do WhatsApp, consultas fiscais, agendamentos, conexões dos números e entradas no
painel. Só gatilhos do banco escrevem; o navegador nunca grava. Mensagens do WhatsApp, "visto"
e presença ficam de fora (volume). Sem expurgo automático.

- **Quem vê tudo**: `auditoria.ver` (só o Administrador), em Configurações > Auditoria (filtros,
  50 por página, CSV).
- **Quem vê o histórico de uma coisa**: quem já enxerga a coisa (chamado, conversa, cliente), pela
  RPC `historico_entidade`: gaveta do chamado, aba Histórico da conversa e da ficha do cliente.
- **Quem agiu**: o login (`auth.uid()`); nas Edge Functions, o header `x-painel-ator`, que o banco só
  aceita do papel `service_role`. Sem ator aparece "Sistema".

## Link de emergência (sem e-mail, sem ninguém logado)

Quando ninguém consegue entrar (SMTP fora do ar e nenhum administrador logado):

```sh
SUPABASE_URL=https://painel-supabase.at63vf.easypanel.host \
SUPABASE_SERVICE_ROLE_KEY=<service role do env do serviço supabase> \
node scripts/link-acesso.mjs email-do-administrador@exemplo.com.br
```

Imprime um link de uso único (15 min). Abra no navegador e pronto. Quem tiver o link
entra como a pessoa: não cole em grupo nem em chamado.

## Configurar o e-mail (quando o Stalwart estiver pronto)

O Stalwart é o app `email` do projeto `painel` no Easypanel (admin em
https://painel-email.at63vf.easypanel.host). Hoje o `SMTP_HOST` está **vazio**: o Auth
não manda e-mail nenhum (finge que mandou) e o login funciona só pelo link de acesso.

1. **Stalwart**: criar o domínio `contabilidadenos.com.br`, gerar a chave DKIM e criar
   uma conta só para o painel (ex.: `painel@contabilidadenos.com.br`, senha forte).
2. **DNS do domínio**:
   - `MX` apontando para o nome do servidor de e-mail (ex.: `mail.contabilidadenos.com.br`,
     com um `A` para o IP da VPS);
   - `SPF`: `TXT v=spf1 mx -all` (ou incluindo o relay, se usar um);
   - `DKIM`: o `TXT` que o Stalwart mostra;
   - `DMARC`: `TXT _dmarc` com `v=DMARC1; p=quarantine; rua=mailto:...`.
3. **Hostinger (VPS)**: configurar o DNS reverso (PTR) do IP para o mesmo nome do
   servidor. A Hostinger pode bloquear a **porta 25 de saída**; sem ela o Stalwart
   não entrega para Gmail/Outlook. Peça a liberação ou configure um relay no Stalwart.
4. **Easypanel > painel > supabase > Ambiente**, preencher e reimplantar:

   | Variável | Valor |
   |---|---|
   | `SMTP_HOST` | ver abaixo |
   | `SMTP_PORT` | `587` (submissão com STARTTLS) |
   | `SMTP_USER` | `painel@contabilidadenos.com.br` |
   | `SMTP_PASS` | a senha dessa conta |
   | `SMTP_ADMIN_EMAIL` | `painel@contabilidadenos.com.br` (remetente; já preenchido) |
   | `SMTP_SENDER_NAME` | `Contabilidade Denos` (já preenchido) |

   **SMTP_HOST**: Configurações > Integrações > E-mail mostra se o painel enxerga
   `painel_email` pela rede interna. Se aparecer "Alcançável", use `painel_email`
   (nome do serviço Docker do app `email`); senão, use o nome público do servidor de
   e-mail (ex.: `mail.contabilidadenos.com.br`) ou o IP da VPS, com a porta 587
   publicada no app `email`.
5. Depois do deploy: Configurações > Integrações > E-mail deve mostrar o servidor e
   "Servidor responde: Sim". Use **Enviar e-mail de teste** (manda um e-mail de acesso
   para quem clicou).

## Login com Google

Botão **Entrar com Google** na tela de entrada. Está pronto, mas **desligado** até o dono criar
as credenciais no Google Cloud (`GOOGLE_ENABLED=false`): enquanto isso o botão não aparece e o
login funciona exatamente como antes. Configurações > Integrações > **Login com Google** mostra
"Configurado" ou "Não configurado" e repete os passos abaixo.

### Passo a passo (dono, uma vez)

1. Abra **console.cloud.google.com** com a conta Google do escritório. Crie um projeto
   (ex.: "Painel Denos") ou use o mesmo do backup.
2. **APIs e serviços > Tela de consentimento OAuth** (na versão nova: "Google Auth Platform >
   Branding / Público"):
   - **Tipo de usuário**:
     - *Interno* só deixa entrar contas do Workspace do escritório. Não serve hoje:
       `mateustavaresruiz@gmail.com` (e qualquer Gmail pessoal) ficaria de fora.
     - *Externo + Em teste*: o Google só deixa passar até 100 "usuários de teste" cadastrados
       à mão no console (cada pessoa nova da equipe teria de entrar lá também) e mostra um
       aviso de "app não verificado". Serve para experimentar, não para o dia a dia.
     - *Externo + Em produção* (**recomendado**): qualquer conta Google pode chegar à tela
       do Google, mas **só entra no painel quem está cadastrado em Equipe** (quem decide é o
       nosso Auth, não o Google). Com só os escopos básicos (`openid`, `email`, `profile`)
       o Google **não pede verificação** do app; aparece só o nome do app e o e-mail de suporte.
   - Nome do app "Painel Denos", e-mail de suporte do escritório, domínio autorizado
     `easypanel.host` se o console pedir. Escopos: só `openid`, `.../auth/userinfo.email` e
     `.../auth/userinfo.profile`. Clique em **Publicar app**.
3. **Credenciais > Criar credenciais > ID do cliente OAuth > Aplicativo da Web**:
   - Origens JavaScript autorizadas: `https://painel-web.at63vf.easypanel.host`
   - URIs de redirecionamento autorizados: `https://painel-supabase.at63vf.easypanel.host/auth/v1/callback`
4. Copie o **ID do cliente** e a **Chave secreta do cliente** e mande para quem cuida do
   painel por um canal privado (nunca em grupo ou chamado). Ou faça o passo 5 você mesmo.
5. **Easypanel > painel > supabase > Ambiente**, e depois **Implantar**:

   | Variável | Valor |
   |---|---|
   | `GOOGLE_CLIENT_ID` | o ID do cliente (`....apps.googleusercontent.com`) |
   | `GOOGLE_SECRET` | a chave secreta do cliente |
   | `GOOGLE_ENABLED` | `true` |

   Não mexa em `DISABLE_SIGNUP` (fica `true`) nem em `ENABLE_EMAIL_AUTOCONFIRM` (fica `false`, ver abaixo).
6. Configurações > Integrações > Login com Google > **Verificar**: deve dizer "Configurado"
   (a function `entrar` guarda a resposta por 1 minuto). Teste com a sua conta.
7. Depois que todos entrarem pelo Google, desligue **Entrar só com o e-mail (provisório)** em
   Configurações > Módulos (a tela mostra a recomendação quando o Google está ligado).

🔴 Quando o painel ganhar o domínio próprio, troque no Google Cloud a origem e o URI de
redirecionamento pelos endereços novos (e o `API_EXTERNAL_URL`/`SITE_URL` do Supabase), senão o
Google recusa com `redirect_uri_mismatch`.

### Como funciona

- O compose passa ao serviço `auth` `GOTRUE_EXTERNAL_GOOGLE_ENABLED/CLIENT_ID/SECRET` a partir
  de `GOOGLE_ENABLED/GOOGLE_CLIENT_ID/GOOGLE_SECRET`, e
  `GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI = ${API_EXTERNAL_URL}/callback`
  (= `https://painel-supabase.at63vf.easypanel.host/auth/v1/callback`).
- A tela pergunta `GET /functions/v1/entrar/config` → `{ google, soEmail }` (público; `google`
  vem do próprio Auth em `/auth/v1/settings`, nada mais é exposto).
- O botão chama `signInWithOAuth({ provider: 'google', redirectTo: origem + '/auth/callback?via=google',
  queryParams: { prompt: 'select_account' } })`. O cliente do supabase-js está em **PKCE**: a
  volta é `/auth/callback?via=google&code=...` e a página troca o código pela sessão
  (`exchangeCodeForSession`), que só funciona no mesmo navegador que começou o login.
- `SITE_URL` é o painel e `ADDITIONAL_REDIRECT_URLS` já tem
  `https://painel-web.at63vf.easypanel.host/**,http://localhost:5173/**` (dev).
- Auditoria: depois da troca, a página chama a RPC `registrar_login_google()` (migration 015),
  que só grava "entrou no painel (Google)" se o JWT diz que a sessão veio de OAuth
  (`amr.method = 'oauth'`) e o usuário tem identidade `google` no Auth.

### O que o Auth (GoTrue v2.196.0) faz com cada conta

Conferido no código da versão em uso (`internal/models/linking.go`,
`internal/api/external.go`):

| Conta Google | Resultado |
|---|---|
| Mesmo e-mail de alguém da Equipe, **verificado** no Google | Ligação automática: o Auth cria uma identidade `google` no **mesmo usuário** (mesmo `auth.uid()`), então o Colaborador e as permissões são os de sempre. Nas próximas vezes ele acha a identidade direto. |
| E-mail que não existe no Auth | Recusa: `error=access_denied`, `error_code=signup_disabled`, "Signups not allowed for this instance" (porque `DISABLE_SIGNUP=true`). A tela mostra "Esta conta Google não tem acesso ao painel. Peça a um administrador para cadastrar seu e-mail em Equipe." |
| Pessoa desativada em Equipe (banida no Auth) | Recusa: `error_code=user_banned` → "Acesso não liberado". Se por acaso não estiver banida mas o Colaborador estiver inativo, entra e cai na tela "Acesso não liberado" de sempre. |
| E-mail **não verificado** no Google | Tratado como e-mail desconhecido → `signup_disabled` (não liga a conta de ninguém). |
| Pessoa cancela na tela do Google | `error=access_denied` → "O login com o Google foi cancelado." |

🔴 **`ENABLE_EMAIL_AUTOCONFIRM=false` é obrigatório com o Google ligado.** No GoTrue, com
autoconfirm `true`, qualquer e-mail vindo do provedor conta como verificado
(`email.Verified || config.Mailer.Autoconfirm`): uma conta Google com e-mail não verificado
seria ligada ao usuário da equipe com aquele e-mail. Foi desligado em 18/10/2026 (os usuários
do painel são criados já confirmados pela function `equipe`, então nada muda para eles). Efeito
colateral bom: com autoconfirm `false` o `GOTRUE_RATE_LIMIT_EMAIL_SENT` passa a valer (com
`true` o GoTrue pulava esse limite).

Ainda não testado de verdade: a ida e volta real ao Google (depende das credenciais). Ao ligar,
testar: (1) conta da equipe entra e cai no próprio perfil; (2) Gmail não cadastrado recebe a
mensagem de sem acesso; (3) pessoa desativada recebe "Acesso não liberado"; (4) o evento
"entrou no painel (Google)" aparece em Configurações > Auditoria.

## Freios contra abuso

- **GoTrue** (env do serviço `auth` no compose): `GOTRUE_RATE_LIMIT_EMAIL_SENT=30`
  (e-mails por hora, no total), `GOTRUE_RATE_LIMIT_OTP=15`, `GOTRUE_RATE_LIMIT_VERIFY=30`,
  `GOTRUE_RATE_LIMIT_TOKEN_REFRESH=150` (por 5 minutos), `GOTRUE_SMTP_MAX_FREQUENCY=60s`
  (um e-mail por pessoa por minuto), OTP de 6 dígitos por 15 min, rotação de refresh
  token ligada. Cadastro público desligado (`DISABLE_SIGNUP=true`); o login por e-mail
  continua valendo para quem já existe (`ENABLE_EMAIL_SIGNUP=true` é o que liga o
  provedor de e-mail, não o cadastro).
- Sem `GOTRUE_RATE_LIMIT_HEADER`, o GoTrue conta pelo IP de quem conecta nele, que é o
  gateway: os limites "por IP" valem para o painel inteiro. Com ~10 pessoas não aperta
  ninguém e torna inviável tentar códigos em massa. O lado ruim: alguém insistindo pode
  travar o login de todos por alguns minutos. Pôr `X-Forwarded-For` no header daria
  limite por pessoa, mas o valor pode ser forjado se o proxy repassar o que o cliente
  manda; não foi ligado sem um teste que prove o contrário.
- **Gateway (Envoy)**: não foi mexido. O `local_ratelimit` do Envoy é um balde por rota
  (não por IP sem descritores dinâmicos) e um erro de configuração derruba o painel
  inteiro; o freio do GoTrue cobre o mesmo caso.
- **Function equipe**: 60 ações por minuto por pessoa.
- Resíduo conhecido: chamando a API do Auth direto (fora da tela), a resposta para um
  e-mail sem acesso é diferente da de um com acesso. Os limites acima tornam a
  varredura lenta; a tela não mostra a diferença.
