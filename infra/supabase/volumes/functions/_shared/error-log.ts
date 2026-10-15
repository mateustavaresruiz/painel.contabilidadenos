// Registra um erro de Edge Function no log central (tabela ErrorLog,
// migration 002). Best-effort e SILENCIOSO: o log de erro nunca pode quebrar
// o fluxo que o chamou. Use nos catch dos handlers, junto do console.error.
//
// No self-hosted do Easypanel a API de logs não funciona, então esta tabela
// é o único lugar onde um 500 de madrugada deixa rastro legível.

import { supabaseAdmin, TENANT_ID } from "./supabase.ts";

const cap = (s: string | null | undefined, n: number): string | null =>
  typeof s === "string" ? s.slice(0, n) : null;

// Nomes de campo cujo VALOR é segredo e nunca deve ir pro log central. Só
// SEGREDOS (chave WAHA/Serpro, tokens, senhas, certificado) — NÃO PII do
// cliente. Casa por substring, case-insensitive.
const SEGREDO_RE =
  /(api[_-]?key|senha|password|secret|token|authorization|bearer|access[_-]?key|x-api-key|signature|cert|pem|pfx|private)/i;

/** Mascara recursivamente valores de campos sensíveis. Defensivo contra ciclos. */
export function redactSecrets(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return "[ciclo]";
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, seen, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SEGREDO_RE.test(k) && v != null && v !== "" ? "[REDACTED]" : redactSecrets(v, seen, depth + 1);
  }
  return out;
}

/** O que o supabase-js devolve em `.error` (PostgrestError, estruturalmente). */
export type DbErro = { message: string; code?: string | null } | null | undefined;

/**
 * Loga um erro de query que NÃO deve derrubar o fluxo, e devolve se houve erro.
 *
 * Existe por causa de uma pegadinha cara: supabase-js **não rejeita** a promise
 * em erro do banco — ele RESOLVE com `{ data, error }`. Então `try/catch` em
 * volta de uma query é teatro: o erro de verdade chega em `.error` e é
 * descartado pelo caminho de SUCESSO.
 */
export function logDbErro(error: DbErro, oQue: string, ctx: Record<string, unknown> = {}): boolean {
  if (!error) return false;
  console.error(`[db] ${oQue}`, {
    ...(redactSecrets(ctx) as Record<string, unknown>),
    code: error.code ?? null,
    erro: error.message,
  });
  return true;
}

export async function recordError(e: {
  /** edge | webhook | cron | serpro */
  origem: string;
  mensagem: string;
  stack?: string | null;
  nivel?: "error" | "warn";
  contexto?: Record<string, unknown>;
  rota?: string | null;
  status?: number | null;
  duracaoMs?: number | null;
}): Promise<void> {
  try {
    await supabaseAdmin.from("ErrorLog").insert({
      tenantId: TENANT_ID,
      origem: cap(e.origem, 20) ?? "edge",
      nivel: e.nivel === "warn" ? "warn" : "error",
      mensagem: cap(e.mensagem, 2000) ?? "(sem mensagem)",
      stack: cap(e.stack, 8000),
      contexto: redactSecrets(e.contexto ?? {}) as Record<string, unknown>,
      rota: cap(e.rota, 200),
      status: e.status ?? null,
      duracaoMs: e.duracaoMs ?? null,
    });
  } catch {
    // Nunca propaga — observabilidade não pode derrubar o handler.
  }
}
