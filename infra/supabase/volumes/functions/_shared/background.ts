/**
 * Dispara uma promise em background sem bloquear a resposta HTTP.
 *
 * `EdgeRuntime.waitUntil` é a API oficial do Supabase Edge (Deno Deploy) pra
 * manter o worker vivo até a promise resolver. Em ambiente local (`deno run`
 * direto / `supabase functions serve`) cai pro fire-and-forget com `.catch`,
 * que não trava o processo.
 *
 * `label` aparece no console.error se a promise rejeitar — passe o nome da
 * function pra facilitar o debug.
 */
export function runAfterResponse(
  promise: Promise<unknown>,
  label = "runAfterResponse",
): void {
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt && typeof rt.waitUntil === "function") {
    rt.waitUntil(promise.catch((err: unknown) => console.error(`[${label}]`, err)));
    return;
  }
  void promise.catch((err) => console.error(`[${label}]`, err));
}
