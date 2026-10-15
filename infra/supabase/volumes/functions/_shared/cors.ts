/**
 * Headers CORS pras Edge Functions do painel Denos. Whitelist explícita:
 * o domínio do painel + o Vite local. Origens fora da lista recebem o
 * domínio do painel, o que faz o browser bloquear o response — efeito
 * prático: site malicioso não consegue ler dados via fetch().
 *
 * A origem do request é lida via `request-context.ts` (AsyncLocalStorage)
 * — evita refatorar todos os callers de `json()`, `badRequest()` etc.
 *
 * Webhooks server-to-server (WAHA, pg_cron) não mandam `Origin` e caem no
 * default. CORS não os afeta de qualquer jeito — segurança lá vem do
 * `WAHA_WEBHOOK_SECRET` / `CRON_SECRET`.
 *
 * Origens extras (outro domínio do painel, staging) entram por
 * `CORS_ORIGINS`, separadas por vírgula, sem redeploy de código.
 */

import { currentRequest } from "./request-context.ts";

const DEFAULT_ORIGIN = "https://painel-web.at63vf.easypanel.host";

const ALLOWED_ORIGINS = new Set<string>([
  DEFAULT_ORIGIN,
  // Dev local. O CORS não é a fronteira de segurança (o JWT do usuário é
  // exigido em `exigirColaborador`), então liberar o Vite não abre nada.
  "http://localhost:5173",
  "http://localhost:4173",
]);
for (const o of (Deno.env.get("CORS_ORIGINS") ?? "").split(",")) {
  const t = o.trim().replace(/\/+$/, "");
  if (t) ALLOWED_ORIGINS.add(t);
}

function pickOrigin(req: Request | null): string {
  if (!req) return DEFAULT_ORIGIN;
  const origin = req.headers.get("origin");
  if (origin && ALLOWED_ORIGINS.has(origin)) return origin;
  return DEFAULT_ORIGIN;
}

/**
 * Headers CORS pro Request atual. Quando chamado fora de um handler
 * com `withRequestContext`, cai pro default — comportamento seguro.
 */
export function corsHeadersFor(
  req: Request | null = currentRequest(),
): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": pickOrigin(req),
    // `Vary: Origin` impede que cache do navegador/CDN sirva o header
    // de uma origem pra outra.
    Vary: "Origin",
    // x-colaborador-id: header antigo do "Quem é você?", ignorado desde o
    // login. Fica na lista só para uma aba aberta antes do deploy não falhar
    // no preflight até recarregar.
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-cron-secret, x-colaborador-id",
    // PUT entra de propósito: a foto interna da instância é `PUT
    // /sessoes/:id/foto` e no adv3 ela falhava no navegador porque a lista
    // parava no PATCH (defeito 2 do guia).
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "600",
  };
}

/**
 * Resposta padrão pra preflight OPTIONS. Toda function chama isso no início:
 *
 *   if (req.method === "OPTIONS") return handleCors(req);
 */
export function handleCors(req?: Request): Response {
  return new Response(null, { status: 204, headers: corsHeadersFor(req) });
}
