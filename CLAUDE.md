# Painel Denos (NÓS Contabilidade)

Painel interno do escritório: WhatsApp da equipe (WAHA), chamados, clientes,
aniversários, certificados digitais e pendências fiscais (Serpro pelo gateway
`integra-contador-serpro`). Frontend Vite + React em `apps/web`; Supabase
self-hosted no Easypanel (`infra/supabase`), migrações em `supabase/migrations`.
Design em `docs/DESIGN.md`, login em `docs/LOGIN.md`.

## Autorização permanente de publicação (dono, 15/10/2026)

"Publica sempre, sempre atualiza, não precisa ficar perguntando."

Neste repositório o agente está autorizado, sem pedir confirmação a cada vez, a:

- commitar e fazer push na `main`;
- aplicar migrações **não destrutivas** no banco de produção (`node scripts/migrar.mjs`);
- publicar no Easypanel o painel (`painel/web`) e o Supabase com as funções (`painel/supabase`);
- instalar dependência nova quando a tarefa pedir (versão fixa);
- alterar o `apps/web/Dockerfile` e o `nginx.conf` do painel quando a tarefa pedir (autorizado em 18/10/2026, depois da inclusão do `ARG GIT_SHA`).

Continua pedindo confirmação, sempre:

- migração destrutiva (apagar tabela/coluna/dados) e qualquer apagamento de dados de produção;
- force-push, reescrever histórico, `reset --hard` em coisa publicada;
- mexer no serviço `waha` ou no gateway `integra-contador` (configurados pelo dono);
- enviar mensagem de WhatsApp ou abrir conversa real pelo painel (abrir marca como lida e manda confirmação de leitura ao contato).

Antes de publicar: `npm run build` completo e `npm run lint` sem erros em `apps/web`;
`deno check` nas funções alteradas. Migração antes do frontend que depende dela.
