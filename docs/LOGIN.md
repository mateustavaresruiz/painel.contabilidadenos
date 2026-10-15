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

## Link de emergência (sem e-mail, sem ninguém logado)

Quando ninguém consegue entrar (SMTP fora do ar e nenhum administrador logado):

```sh
SUPABASE_URL=https://painel-supabase.at63vf.easypanel.host \
SUPABASE_SERVICE_ROLE_KEY=<service role do env do serviço supabase> \
node scripts/link-acesso.mjs mateustavaresruiz@gmail.com
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
