// Wrapper de `Deno.serve` que ativa o `request-context` automático.
// Use no lugar de `Deno.serve(...)` em cada Edge Function:
//
//   import { serve } from "../_shared/serve.ts";
//
//   serve(async (req) => {
//     // resto do handler, igual.
//   });
//
// Ao envolver, helpers de resposta (`json()`, `badRequest()`, etc) e
// `corsHeadersFor()` conseguem ler o Request atual via AsyncLocalStorage
// e devolver `Access-Control-Allow-Origin` baseado em whitelist.
//
// É também o ponto por onde toda requisição passa, então é aqui que uma
// RESPOSTA 5xx vira linha no ErrorLog — não só a exceção. A function que
// captura o próprio erro e devolve um `internalError()` educado também deixa
// rastro. A escrita sai por `runAfterResponse`: ninguém espera pelo log.

import { withRequestContext } from "./request-context.ts";
import { internalError } from "./response.ts";
import { recordError } from "./error-log.ts";
import { runAfterResponse } from "./background.ts";

/** Teto do trecho de corpo guardado junto do erro 5xx. */
const MAX_CORPO = 500;

/** Troca ids (uuid, JID, números longos) por `:id` pra agrupar no log. */
function rotaNormalizada(path: string): string {
  return path
    .split("/")
    .map((s) =>
      /^[0-9a-f-]{20,}$/i.test(s) || /\d{6,}/.test(s) || s.includes("%40") || s.includes("@")
        ? ":id"
        : s
    )
    .join("/");
}

/**
 * Lê a mensagem que a function devolveu ao cliente, pra ela aparecer no log
 * em vez de um "500" mudo. `clone()` porque o corpo só pode ser lido uma vez.
 */
async function mensagemDaResposta(res: Response): Promise<string | null> {
  try {
    const texto = (await res.clone().text()).slice(0, MAX_CORPO);
    if (!texto) return null;
    try {
      const corpo = JSON.parse(texto) as { error?: unknown };
      return typeof corpo.error === "string" ? corpo.error : texto;
    } catch {
      return texto;
    }
  } catch {
    return null;
  }
}

export function serve(
  handler: (req: Request) => Promise<Response> | Response,
): void {
  Deno.serve((req) =>
    withRequestContext(req, async () => {
      const inicio = Date.now();
      let path = "";
      try {
        path = new URL(req.url).pathname;
      } catch { /* url inválida */ }

      try {
        const res = await handler(req);
        // `x-erro-registrado`: o handler já gravou o erro com mais contexto.
        if (res.status >= 500 && !res.headers.get("x-erro-registrado")) {
          const duracao = Date.now() - inicio;
          runAfterResponse(
            (async () => {
              const msg = await mensagemDaResposta(res);
              await recordError({
                origem: "edge",
                mensagem: `[${res.status}] ${rotaNormalizada(path)}${msg ? `: ${msg}` : ""}`,
                contexto: { method: req.method },
                rota: rotaNormalizada(path),
                status: res.status,
                duracaoMs: duracao,
              });
            })(),
            "serve:5xx",
          );
        }
        return res;
      } catch (err) {
        // Rede de segurança: erro NÃO tratado pelo handler vira um 500 limpo
        // e entra no ErrorLog com stack.
        const msg = err instanceof Error ? err.message : String(err);
        await recordError({
          origem: "edge",
          mensagem: `[uncaught] ${rotaNormalizada(path)}: ${msg}`,
          stack: err instanceof Error ? err.stack : null,
          contexto: { method: req.method },
          rota: rotaNormalizada(path),
          status: 500,
          duracaoMs: Date.now() - inicio,
        });
        return internalError(msg || "Erro interno");
      }
    }),
  );
}
