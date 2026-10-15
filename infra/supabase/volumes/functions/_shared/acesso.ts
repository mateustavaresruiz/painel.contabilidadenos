// Quem pode chamar as functions do painel, enquanto não há login.
//
// 🔴 O GATEWAY NÃO EXIGE A CHAVE NAS FUNCTIONS. A rota `/functions/v1/` do
// Envoy (`volumes/api/envoy/lds.template.yaml`) libera tudo, e o router
// `main` roda com VERIFY_JWT=false. Sem a conferência abaixo, qualquer um que
// soubesse a URL mandaria mensagem pelo WhatsApp do escritório. Então cada
// function de uso da tela confere aqui a chave `apikey` (anon ou service).
//
// O webhook do WAHA e o cron NÃO passam por aqui: cada um tem o seu segredo
// (`WAHA_WEBHOOK_SECRET`, `CRON_SECRET`), comparado em tempo constante.
//
// Quando o login entrar, este é o arquivo que troca: a chave vira o JWT do
// usuário e `x-colaborador-id` vira o colaborador amarrado ao `auth.uid()`.

import { forbidden, unauthorized } from "./response.ts";
import { supabaseAdmin, TENANT_ID } from "./supabase.ts";

/** Comparação timing-safe pra reduzir risco de side-channel no header. */
export function timingSafeEqual(a: string, b: string): boolean {
  // Se tamanhos diferem, ainda compara byte a byte com a string MAIS LONGA
  // pra não vazar comprimento via timing.
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ba.length, bb.length);
  let diff = ba.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

const CHAVES_ACEITAS = [
  Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  ...Object.values(parseJsonObj(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"))),
  ...Object.values(parseJsonObj(Deno.env.get("SUPABASE_SECRET_KEYS"))),
].filter((k) => typeof k === "string" && k.length > 0) as string[];

function parseJsonObj(raw: string | undefined): Record<string, unknown> {
  try {
    const o = JSON.parse(raw ?? "{}");
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

/**
 * A chave vem no header `apikey` (o que o supabase-js manda) ou como Bearer.
 * Devolve uma Response 401 pra cortar cedo, ou null se pode seguir.
 */
export function exigirApikey(req: Request): Response | null {
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const candidatos = [req.headers.get("apikey") ?? "", bearer].filter(Boolean);
  for (const c of candidatos) {
    if (CHAVES_ACEITAS.some((k) => timingSafeEqual(c, k))) return null;
  }
  return unauthorized("Chave de API ausente ou inválida (header apikey).");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Colaborador = { id: string; nome: string };

/**
 * O colaborador que está operando a tela, pelo header `x-colaborador-id`.
 * Opcional: sem header devolve `{ colaborador: null }`. Com header, ele
 * tem de existir e estar ativo — colaborador desativado não envia (no adv3 o
 * membro desativado continuava mandando mensagem, defeito 55 do guia).
 */
export async function colaboradorDoRequest(
  req: Request,
): Promise<{ colaborador: Colaborador | null; erro: Response | null }> {
  const raw = (req.headers.get("x-colaborador-id") ?? "").trim();
  if (!raw) return { colaborador: null, erro: null };
  if (!UUID_RE.test(raw)) {
    return { colaborador: null, erro: forbidden("x-colaborador-id inválido.") };
  }
  const { data, error } = await supabaseAdmin
    .from("Colaborador")
    .select("id, nome, ativo")
    .eq("tenantId", TENANT_ID)
    .eq("id", raw)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    return { colaborador: null, erro: forbidden("Colaborador não encontrado.") };
  }
  if (!data.ativo) {
    return { colaborador: null, erro: forbidden("Colaborador desativado.") };
  }
  return { colaborador: { id: data.id, nome: data.nome }, erro: null };
}
