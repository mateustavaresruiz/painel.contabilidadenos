# Login e permissões do painel

**Fonte única** sobre como se entra no painel, quem entra, quanto tempo a sessão dura,
o que ligar e desligar e o que fazer quando der errado. Não há senha nem cadastro
público: só entra quem um administrador cadastrou em **Equipe**, e cada pessoa tem um
**cargo** que diz o que ela pode fazer (migration `005_login.sql`).

## Formas de entrar

| Forma | Estado hoje (18/10/2026) | Quem decide se entra |
|---|---|---|
| **Entrar com Google** | Pronta, **desligada** até o dono criar as credenciais (`GOOGLE_ENABLED=false`). Ver [Login com Google](#login-com-google). | O Auth: conta Google com o mesmo e-mail (verificado) de alguém da Equipe. |
| **Link ou código por e-mail** | Pronta, **sem e-mail saindo** até configurar o SMTP do Google Workspace (`SMTP_HOST` vazio). Ver [E-mail pelo Google Workspace](#e-mail-pelo-google-workspace-smtp). | O Auth: o e-mail tem de existir; o link/código prova que a pessoa abriu a caixa. |
| **Link de acesso** gerado em Equipe | Funciona hoje. O administrador gera e manda por WhatsApp. | Quem tem o link (uso único, 15 min). |
| **Entrar só com o e-mail** (provisório) | **Ligada** (Configurações > Módulos). | Ninguém confere a caixa: quem souber o e-mail de alguém da equipe entra como ele. 🔴 Desligar assim que o Google ou o SMTP funcionar ([O que desligar e quando](#o-que-desligar-e-quando)). |

### Link ou código por e-mail

1. A pessoa digita o e-mail em **Entrar no painel** (com a verificação anti-robô ALTCHA).
2. O Auth (GoTrue) manda um e-mail com **um link e um código de 6 números**.
3. Ela clica no link **ou** digita o código na mesma tela. Os dois valem **15 minutos** e
   **uma vez só**; pedir de novo invalida o anterior. O "Reenviar" fica travado por 60 s.

A tela responde sempre a mesma coisa ("se este e-mail tiver acesso, enviamos..."),
exista o e-mail ou não. Sem SMTP o Auth finge que mandou: por isso, enquanto o e-mail
não estiver configurado, quem entra usa o link de acesso ou o "só com o e-mail".

O supabase-js está em PKCE (`detectSessionInUrl: false`), mas isso não muda o e-mail: o
link continua caindo em `/auth/callback?token_hash=...&type=...` e a página troca o token
com `verifyOtp` (o código digitado usa `verifyOtp({ email, token, type: 'email' })`).

### Entrar só com o e-mail (provisório)

Decisão do dono (15/10/2026) enquanto não havia e-mail: com a chave **Entrar só com o
e-mail (provisório)** ligada em Configurações > Módulos, a tela de entrada pede só o
e-mail e entra direto. Peça: function `entrar` (`POST /entrar { email, altcha }` devolve
um `token_hash` que a tela troca por sessão, o mesmo caminho do link). Só aceita e-mail
de Colaborador **ativo** e amarrado ao Auth; ALTCHA de uso único; freio de 10 tentativas
por IP e 60 no total a cada 5 minutos. Com a chave desligada, a mesma tela cai sozinha no
fluxo de link/código por e-mail.

### Sessão (quanto tempo fica logado)

- A sessão fica no navegador e se renova sozinha: o token de acesso vale **1 hora**
  (`JWT_EXPIRY=3600`) e é trocado em silêncio pelo token de renovação, que **gira a cada
  uso** (rotação ligada, tolerância de 10 s entre abas). Na prática a pessoa só volta à tela
  de entrada se sair, limpar o navegador ou tiver a sessão revogada.
- **Sair** (menu da conta: rodapé da barra lateral; no celular, o avatar no topo) encerra
  **só este navegador** (`signOut({ scope: 'local' })`); o celular e outros computadores
  continuam logados.
- Se a API responder 401 (sessão revogada), o painel volta para a tela de entrada.
- **Desativar** a pessoa em Equipe derruba **todas** as sessões dela na hora (banimento no
  Auth + `revogar_sessoes`), e a RLS passa a negar tudo mesmo com um token ainda válido.
- Entrou, mas o Colaborador está inativo ou sem cadastro: tela "Acesso não liberado" com
  o botão Sair.

### Peças

- Front: `apps/web/src/routes/auth/login.tsx`, `routes/auth/callback.tsx`,
  `components/auth-gate.tsx`, `lib/colaborador.tsx` (sessão + colaborador + permissões),
  `lib/login-google.ts`.
- O link do e-mail e o link de acesso caem em `/auth/callback?token_hash=...&type=...`, e
  é a página que troca o token pela sessão (um antivírus que "abre" o link não gasta o token).
- Functions: `equipe` (pessoas, links, diagnóstico do e-mail), `entrar` (só com o e-mail e
  `/entrar/config`).
- Modelos de e-mail: `apps/web/public/email/*.html` (ver [Modelos de e-mail](#modelos-de-e-mail)).

## Pessoas: liberar, mudar, tirar

Equipe > **Pessoas** > **Convidar**: nome, e-mail, cargo (telefone e cor opcionais).
A function `equipe` cria o usuário no Auth (sem senha, e-mail confirmado) e o
Colaborador ligado a ele.

- **Com SMTP configurado**: a pessoa recebe o e-mail de acesso.
- **Sem SMTP** (situação de hoje): o painel mostra um **link de acesso** de uso único
  para copiar e mandar por outro meio (WhatsApp, por exemplo).
- Com o Google ligado, a pessoa também pode clicar em "Entrar com Google" com a conta do
  mesmo e-mail.

Em cada pessoa: **Gerar link de acesso** (uso único, 15 min), **Enviar acesso** (só com
SMTP), **Desativar/Reativar**, editar e excluir.

- **Tirar o acesso**: prefira **Desativar** (bloqueia o login no Auth, derruba as sessões
  abertas, a RLS nega tudo na hora e o histórico continua com o nome). **Excluir** apaga o
  Colaborador e o usuário do Auth; a auditoria guarda o nome que estava no evento.
- Trocar o e-mail troca também o login (o Auth primeiro; se recusar, nada muda).
- Ninguém desativa nem exclui a si mesmo, e sempre sobra um Administrador ativo.
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

### "Entrou no painel"

Um evento por entrada (módulo `acesso`, ação `login`), no máximo um por pessoa a cada 2 minutos,
com "Como" e o IP:

| Como | Quem grava |
|---|---|
| Link de acesso / Código por e-mail | **O servidor** (migration `017_auditoria_login_servidor.sql`): gatilho `auditoria_login_sessao` em `auth.mfa_amr_claims`, a linha que o Auth cria para toda sessão nova. Grava "Link ou código por e-mail" com o IP da sessão; o GoTrue registra os dois como `otp` e não guarda qual foi. Logo depois a tela chama `registrar_login('link'/'codigo')`, que só **troca o "Como"** desse evento (e só se o JWT da sessão é de token do e-mail). Se a tela falhar, a entrada fica registrada assim mesmo. |
| Só com o e-mail (sem verificação) | A function `entrar`, antes de devolver o token. O gatilho vê o evento recente e não duplica. |
| Conta Google | A RPC `registrar_login_google()` (migration 015), chamada pelo `/auth/callback`; o gatilho ignora sessões `oauth`. |
| Senha | O gatilho (o painel não usa senha; só aparece se alguém usar a API do Auth com senha). |

O gatilho nunca impede a entrada: qualquer erro vira só um aviso no log do banco.

## Link de emergência (sem e-mail, sem ninguém logado)

Quando ninguém consegue entrar (SMTP fora do ar e nenhum administrador logado):

```sh
SUPABASE_URL=https://painel-supabase.at63vf.easypanel.host \
SUPABASE_SERVICE_ROLE_KEY=<service role do env do serviço supabase> \
node scripts/link-acesso.mjs email-do-administrador@exemplo.com.br
```

Imprime um link de uso único (15 min). Abra no navegador e pronto. Quem tiver o link
entra como a pessoa: não cole em grupo nem em chamado.

## E-mail pelo Google Workspace (SMTP)

O escritório já usa o Google para e-mail (MX do `contabilidadenos.com.br` no Google), então
o painel manda o e-mail de acesso **pelo próprio Google Workspace**. Hoje está **dormente**:
`SMTP_HOST` vazio, o Auth não manda nada. Quem envia é o serviço `auth` (GoTrue v2.196),
que lê `GOTRUE_SMTP_HOST/PORT/USER/PASS/ADMIN_EMAIL/SENDER_NAME`; o compose
(`infra/supabase/docker-compose.yml`) preenche esses nomes a partir de `SMTP_*` do
ambiente do serviço `supabase` no Easypanel. A function `equipe` recebe `SMTP_HOST/PORT/USER/
ADMIN_EMAIL/SENDER_NAME` só para o diagnóstico; a senha **não** vai para ela (só
`SMTP_PASS_DEFINIDA=sim` quando está preenchida).

### Opção A (recomendada): smtp.gmail.com com senha de app

1. No Admin Console, crie (ou escolha) uma conta só para o painel, ex.:
   `painel@contabilidadenos.com.br`. Usuário comum; ninguém precisa ler a caixa.
2. Entre nessa conta, ligue a **verificação em 2 etapas** e gere uma **senha de app**
   (myaccount.google.com/apppasswords, nome "Painel Denos"). São 16 letras: guarde **sem os
   espaços**. Se a opção não aparecer, o administrador do Workspace precisa permitir a
   verificação em 2 etapas (Segurança > Autenticação > Verificação em duas etapas).
3. **Easypanel > painel > supabase > Ambiente**, e depois **Implantar**:

   | Variável | Valor |
   |---|---|
   | `SMTP_HOST` | `smtp.gmail.com` |
   | `SMTP_PORT` | `587` (STARTTLS; 465 com TLS direto também funciona) |
   | `SMTP_USER` | `painel@contabilidadenos.com.br` |
   | `SMTP_PASS` | a senha de app (16 letras, sem espaços) |
   | `SMTP_ADMIN_EMAIL` | `painel@contabilidadenos.com.br` (o **mesmo** endereço do usuário) |
   | `SMTP_SENDER_NAME` | `Contabilidade Denos` |

   O Gmail troca o remetente pela conta que autenticou se `SMTP_ADMIN_EMAIL` for outro
   endereço (a não ser que seja um alias "Enviar como" dessa conta): use o mesmo.
   Limite do Workspace: 2.000 e-mails por dia por conta, longe do que o painel usa.

### Opção B: relay do Workspace (smtp-relay.gmail.com)

Sem senha de app; precisa de um administrador do Workspace.

1. Admin Console > Apps > Google Workspace > Gmail > **Roteamento** > **Serviço de
   redirecionamento SMTP** > Configurar: "Remetentes permitidos: apenas endereços nos meus
   domínios"; autenticação "Aceitar e-mails só dos endereços IP especificados" com
   `187.127.26.230` (IP da VPS); marcar "Exigir criptografia TLS".
2. Ambiente do serviço `supabase`: `SMTP_HOST=smtp-relay.gmail.com`, `SMTP_PORT=587`,
   `SMTP_USER` e `SMTP_PASS` **vazios**, `SMTP_ADMIN_EMAIL=painel@contabilidadenos.com.br`
   (precisa ser de um domínio do Workspace; a caixa nem precisa existir),
   `SMTP_SENDER_NAME=Contabilidade Denos`. Implantar.
3. Variante: em vez da lista de IPs, marcar "Exigir autenticação SMTP" e usar usuário +
   senha de app como na opção A.

O GoTrue se apresenta (EHLO) com o nome público do Auth, não com `localhost`, então o relay
não recusa pelo EHLO.

### Conferir

Configurações > Integrações > **E-mail (login)** > Verificar. A function `equipe`
(`GET /equipe/email`) abre a porta, lê a saudação, manda EHLO e confere se o servidor
oferece STARTTLS (ou se o TLS abre, na 465), sem autenticar nem enviar. O cartão mostra
servidor, provedor ("Google Workspace (Gmail)"), "Servidor responde", criptografia, se o
usuário e a senha estão preenchidos, o remetente e avisos de configuração (ex.: remetente
diferente do usuário no Gmail, senha vazia, relay sem a lista de IPs). Depois clique em
**Enviar e-mail de teste** (`POST /equipe/email/teste`): manda um e-mail de acesso de verdade
para quem clicou. Se o Google recusar (senha errada, remetente não permitido, IP fora do
relay), o Auth responde só "Error sending ... email"; a tela explica o que conferir e o
motivo exato aparece no log do serviço `supabase` (container `auth`) no Easypanel.

Conferido em 18/10/2026 de fora: `smtp.gmail.com:587` e `smtp-relay.gmail.com:587` saúdam e
oferecem STARTTLS; `smtp.gmail.com:465` abre TLS e anuncia AUTH.

### O servidor próprio (Stalwart)

O app `email` do projeto `painel` (Stalwart, admin em https://painel-email.at63vf.easypanel.host)
foi criado quando a ideia era um servidor próprio. Com o Google Workspace ele **não é mais
necessário** (dispensa DKIM/PTR/porta 25 da Hostinger). Não foi removido: pode ser apagado do
Easypanel depois que o Google estiver enviando. O cartão só mostra "Rede interna
(painel_email)" e "Abrir o Stalwart" se o `SMTP_HOST` apontar para ele.

## Modelos de e-mail

Em `apps/web/public/email/`, servidos pelo próprio painel e apontados no ambiente do serviço
`supabase` (o GoTrue baixa e guarda por até 10 minutos):

| Variável | Arquivo | Assunto (`MAILER_SUBJECTS_*`, padrão no compose) |
|---|---|---|
| `MAILER_TEMPLATES_MAGIC_LINK` | `magic-link.html` | Seu acesso ao Painel Denos |
| `MAILER_TEMPLATES_CONFIRMATION` | `confirmacao.html` | Seu acesso ao Painel Denos |
| `MAILER_TEMPLATES_INVITE` | `convite.html` | Você foi convidado para o Painel Denos |
| `MAILER_TEMPLATES_EMAIL_CHANGE` | `troca-email.html` | Confirme seu novo e-mail no Painel Denos |
| `MAILER_TEMPLATES_REAUTHENTICATION` | `reautenticacao.html` | Código de confirmação do Painel Denos |
| `MAILER_TEMPLATES_RECOVERY` | `recuperacao.html` | Seu acesso ao Painel Denos |

URL de cada um: `https://painel-web.at63vf.easypanel.host/email/<arquivo>`. O e-mail de
login de quem já existe é o `magic-link` (o painel nunca cria usuário pelo e-mail).

Todos têm: faixa marinho com a logo NÓS em branco (URL absoluta
`https://painel-web.at63vf.easypanel.host/logo-branco.png`, igual no claro e no escuro), o
**código de 6 números** `{{ .Token }}` em destaque, o botão que cai em
`{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=...` (e o mesmo link em texto
para copiar), "vale 15 minutos e uma vez só" e o aviso "Se não foi você, ignore este e-mail".
Layout em tabela com estilo inline (Gmail/Outlook), largura máxima 520 px, ajuste para
celular e `prefers-color-scheme: dark` para os clientes que suportam. Conferidos no Chrome
sem interface a 600 px e 360 px, claro e escuro, sem rolagem horizontal.

Mudou um modelo? Publique o painel (`painel/web`); o Auth pega a versão nova em até 10 min.

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

## O que desligar e quando

| Quando | O que fazer |
|---|---|
| O **SMTP** funcionou ("Enviar e-mail de teste" chegou) **ou** o **Google** está ligado e todos já entraram por ele | Configurações > Módulos: desligar **Entrar só com o e-mail (provisório)**. A tela volta a pedir link/código (ou Google). Não espere os dois: basta um deles funcionando. |
| O SMTP funcionou | Parar de mandar link de acesso por WhatsApp: use **Enviar acesso** em Equipe. O app `email` (Stalwart) pode ser removido do Easypanel. |
| O Google está ligado | Nada mais a desligar: link/código por e-mail continua como reserva (conta Google com problema, pessoa sem Google). |
| Alguém saiu da equipe | **Desativar** em Equipe (derruba as sessões na hora). |
| Suspeita de que alguém entrou como outra pessoa | Desativar e reativar a pessoa (derruba todas as sessões dela) e olhar Configurações > Auditoria, filtro "acesso". |

🔴 Nunca religar `ENABLE_EMAIL_AUTOCONFIRM=true` (ver Login com Google).

## Testar o login (scripts/testar-login.mjs)

```sh
SUPABASE_URL=https://painel-supabase.at63vf.easypanel.host \
SUPABASE_SERVICE_ROLE_KEY=<service role> SUPABASE_ANON_KEY=<anon> \
node scripts/testar-login.mjs
```

Cria um administrador de teste e três pessoas "TESTE QA ..." (`qa-login-*@teste.invalid`,
convidadas pela function `equipe`) e confere: convite, link de uso único (e que não vale de
novo), código de 6 números (e código errado recusado), auditoria do servidor com o refino da
tela, entrada só com o e-mail resolvendo o ALTCHA como o navegador (se ligada), sair com
`scope=local` sem derrubar a outra sessão, pessoa desativada bloqueada (sessão, link, token,
só e-mail) e e-mail desconhecido recusado. No fim apaga as pessoas de teste (Equipe e Auth) e
confere que não sobrou nada. Imprime só PASSOU/FALHOU, nunca token ou link. Não manda e-mail
(usa o token direto do Auth) e não toca em ninguém da equipe de verdade. Os eventos "entrou no
painel" das pessoas de teste ficam na auditoria (ela não apaga nada), com o nome "TESTE QA".

Rodado em produção em 18/10/2026, antes e depois de publicar: 23 de 23 passaram (inclui o diagnóstico do e-mail em `GET /equipe/email`).

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| "Se este e-mail tiver acesso, enviamos..." e o e-mail nunca chega | `SMTP_HOST` vazio (hoje), e-mail sem cadastro em Equipe, ou na caixa de spam | Cartão E-mail em Integrações; confira o e-mail em Equipe; use **Gerar link de acesso**. |
| "Enviar e-mail de teste": "o Auth não conseguiu enviar pelo SMTP" | Senha de app errada/revogada, `SMTP_USER` ≠ conta, relay sem o IP liberado | Log do container `auth` (procure `smtp`/`535`/`550`). `535 5.7.8` = usuário/senha; `550 5.7.0 ... relay` = IP/domínio fora do relay. |
| Cartão diz "A porta não abriu" | Host errado, ou saída da VPS bloqueada para a porta | Use 587; teste 465. A Hostinger não bloqueia 587/465. |
| "Muitas tentativas seguidas" | Freios do Auth (contam pelo gateway, ou seja, para o escritório todo) | Esperar alguns minutos. Ver [Freios contra abuso](#freios-contra-abuso). |
| "O link expirou ou já foi usado" | Passou de 15 min, já usado, ou pediu outro depois (só o último vale) | Pedir um novo; o código do e-mail mais recente vale. |
| "Acesso não liberado" | Colaborador inativo ou o e-mail do Auth não bate com o de Equipe | Reativar / corrigir o e-mail em Equipe. |
| Ninguém consegue entrar | E-mail fora e nenhum administrador logado | [Link de emergência](#link-de-emergência-sem-e-mail-sem-ninguém-logado). |
| Entrada não aparece na auditoria | Gatilho `auditoria_login_sessao` ausente | `select tgname from pg_trigger where tgname = 'auditoria_login_sessao'`; reaplicar a 017. |
