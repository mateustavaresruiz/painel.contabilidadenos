// Contexto por request — armazena a Request atual num AsyncLocalStorage
// pra que helpers como `json()`, `badRequest()` etc consigam ler o
// header `Origin` sem que cada caller precise passar `req` adiante.
//
// Custo: 1 wrap de `Deno.serve(req => withRequestContext(req, () => …))`
// no início de cada Edge Function. Em troca, `cors.ts` consegue
// devolver `Access-Control-Allow-Origin` dinâmico (whitelist) sem
// refator massivo.

import { AsyncLocalStorage } from "node:async_hooks";

type Ctx = { req: Request };

const storage = new AsyncLocalStorage<Ctx>();

/**
 * Wrap o handler do `Deno.serve` pra disponibilizar o Request via
 * `currentRequest()` em qualquer ponto da árvore de chamadas.
 *
 *   Deno.serve((req) => withRequestContext(req, async () => {
 *     // resto do handler igual; `json()` etc agora veem o origin
 *   }));
 */
export function withRequestContext<T>(
  req: Request,
  fn: () => Promise<T> | T,
): Promise<T> {
  return Promise.resolve(storage.run({ req }, fn));
}

/**
 * Devolve o Request atual ou null se chamado fora de `withRequestContext`
 * (ex.: testes unitários). Null implica fallback nos helpers de CORS.
 */
export function currentRequest(): Request | null {
  return storage.getStore()?.req ?? null;
}
