// Contexto por request — armazena a Request atual num AsyncLocalStorage
// pra que helpers como `json()`, `badRequest()` etc consigam ler o
// header `Origin` sem que cada caller precise passar `req` adiante.
//
// Custo: 1 wrap de `Deno.serve(req => withRequestContext(req, () => …))`
// no início de cada Edge Function. Em troca, `cors.ts` consegue
// devolver `Access-Control-Allow-Origin` dinâmico (whitelist) sem
// refator massivo.

import { AsyncLocalStorage } from "node:async_hooks";

/** `ator`: Colaborador que fez o pedido (preenchido por `exigirColaborador`); vira o header
 *  `x-painel-ator` nas chamadas ao banco, e é assim que a auditoria sabe quem agiu. */
type Ctx = { req: Request; ator?: string };

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
  return Promise.resolve(storage.run({ req } as Ctx, fn));
}

/**
 * Devolve o Request atual ou null se chamado fora de `withRequestContext`
 * (ex.: testes unitários). Null implica fallback nos helpers de CORS.
 */
export function currentRequest(): Request | null {
  return storage.getStore()?.req ?? null;
}

/** Marca quem está agindo neste request (para a auditoria do banco). */
export function definirAtor(colaboradorId: string): void {
  const ctx = storage.getStore();
  if (ctx) ctx.ator = colaboradorId;
}

/** Quem está agindo neste request, se for um colaborador logado. */
export function atorAtual(): string | null {
  return storage.getStore()?.ator ?? null;
}
