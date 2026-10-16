import { corsHeadersFor } from "./cors.ts";
import { registrarErroInterno } from "./request-context.ts";

/**
 * Resposta JSON com CORS embutido. Os headers de CORS são dinâmicos por
 * request (lê origem via AsyncLocalStorage do request-context).
 */
export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      ...corsHeadersFor(),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

/** Resposta de erro estruturada: sempre `{ error }`, que o front mostra. */
export function errorResponse(message: string, status = 400): Response {
  return json({ error: message }, { status });
}

export const badRequest = (m: string) => errorResponse(m, 400);
export const unauthorized = (m = "Não autenticado") => errorResponse(m, 401);
export const forbidden = (m = "Sem permissão") => errorResponse(m, 403);
export const notFound = (m = "Não encontrado") => errorResponse(m, 404);
export const conflict = (m: string) => errorResponse(m, 409);
/** Id curto (8 hex) que o cliente vê no 5xx e que acha a linha no ErrorLog. */
export function novoErroId(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 8);
}

/** O único texto que um 5xx mostra ao cliente: nada de mensagem do Postgres ou de stack. */
export function mensagemErroInterno(id: string): string {
  return `Erro interno (ref ${id})`;
}

/**
 * 500 sem vazar detalhe: o cliente recebe "Erro interno (ref xxxxxxxx)"; o
 * `detalhe` vai pro console e pro ErrorLog (via `serve`). `registrado: true`
 * quando o handler já gravou o erro no ErrorLog (evita linha dupla).
 */
export function internalError(
  detalhe?: string,
  opts: { id?: string; registrado?: boolean } = {},
): Response {
  const id = opts.id ?? novoErroId();
  if (detalhe) console.error(`[erro ${id}]`, detalhe);
  registrarErroInterno(id, detalhe ?? "");
  return json(
    { error: mensagemErroInterno(id) },
    { status: 500, headers: opts.registrado ? { "x-erro-registrado": "1" } : {} },
  );
}
export const notImplemented = (m: string) => errorResponse(m, 501);
/**
 * Falha do serviço de fora (WAHA, Serpro): 424 Failed Dependency.
 *
 * 🔴 NÃO 502/504. O proxy do Easypanel troca o corpo de toda resposta 502 pela
 * página HTML "Service is not reachable", e a tela perdia o `{ error }` (e o
 * `id` da mensagem que falhou). Conferido no deploy de 14/10/2026.
 */
export const STATUS_DEPENDENCIA = 424;
export const badGateway = (m: string) => errorResponse(m, STATUS_DEPENDENCIA);
export const serviceUnavailable = (m: string) => errorResponse(m, 503);
export const gatewayTimeout = (m: string) => errorResponse(m, STATUS_DEPENDENCIA);
