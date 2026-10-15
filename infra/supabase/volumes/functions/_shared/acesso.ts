// Quem pode chamar as functions do painel: só quem está LOGADO e amarrado a
// um Colaborador ativo.
//
// 🔴 O GATEWAY NÃO EXIGE A CHAVE NAS FUNCTIONS. A rota `/functions/v1/` do
// Envoy libera tudo e o router `main` roda com VERIFY_JWT=false. Então cada
// function de uso da tela confere aqui o JWT do usuário:
//
//   Authorization: Bearer <access_token da sessão do supabase-js>
//
// O token é validado no próprio Auth (GET /auth/v1/user), o que também pega
// sessão revogada (desativar alguém apaga as sessões dele, ver `equipe`).
// Depois vem o Colaborador com "userId" = id do usuário; inativo → 403. As
// permissões são as do CARGO dele (Administrador = todas), as mesmas que a
// RLS usa (`tem_permissao` no banco).
//
// O header antigo `x-colaborador-id` (do "Quem é você?") NÃO vale mais: quem
// age é sempre o colaborador do token.
//
// O webhook do WAHA e o cron NÃO passam por aqui: cada um tem o seu segredo
// (`WAHA_WEBHOOK_SECRET`, `CRON_SECRET`), comparado em tempo constante.

import { definirAtor } from "./request-context.ts";
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

export type Colaborador = {
  id: string;
  nome: string;
  email: string | null;
  userId: string;
  cargoId: string;
  /** Cargo de sistema (Administrador): todas as permissões. */
  admin: boolean;
  permissoes: Set<string>;
};

/** O colaborador tem a permissão (Administrador tem todas). */
export function tem(c: Colaborador, p: string): boolean {
  return c.admin || c.permissoes.has(p);
}

/**
 * Cache curto token → colaborador. A tela do WhatsApp chama a function
 * várias vezes por minuto; sem isto, cada chamada seria uma ida ao Auth e
 * outra ao banco. 30 s é o atraso máximo para uma desativação valer aqui
 * (a RLS do banco já corta na hora).
 */
const CACHE_MS = 30_000;
const CACHE_MAX = 500;
const cache = new Map<string, { em: number; colaborador: Colaborador }>();

async function chaveDoToken(token: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Esquece o cache de um usuário (desativação, troca de papel). */
export function esquecerUsuario(userId: string): void {
  for (const [k, v] of cache) if (v.colaborador.userId === userId) cache.delete(k);
}

function tokenDoRequest(req: Request): string {
  return (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

/**
 * Exige usuário logado com Colaborador ativo. Devolve o colaborador ou uma
 * Response (401 sem/ com token inválido, 403 sem acesso liberado) para a
 * function devolver direto.
 *
 *   const eu = await exigirColaborador(req);
 *   if (eu instanceof Response) return eu;
 */
export async function exigirColaborador(
  req: Request,
  opts: { permissao?: string | string[] } = {},
): Promise<Colaborador | Response> {
  const token = tokenDoRequest(req);
  // Um JWT tem 3 partes. A chave anon também é JWT, mas não é de usuário: o
  // Auth recusa abaixo.
  if (!token || token.split(".").length !== 3) {
    return unauthorized("Faça login para continuar.");
  }

  const chave = await chaveDoToken(token);
  const emCache = cache.get(chave);
  let colaborador: Colaborador | null =
    emCache && Date.now() - emCache.em < CACHE_MS ? emCache.colaborador : null;

  if (!colaborador) {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) {
      return unauthorized("Sessão expirada. Entre de novo.");
    }
    const { data: c, error: e2 } = await supabaseAdmin
      .from("Colaborador")
      .select("id, nome, email, ativo, cargoId, Cargo(sistema, permissoes)")
      .eq("tenantId", TENANT_ID)
      .eq("userId", data.user.id)
      .maybeSingle();
    if (e2) throw e2;
    if (!c || !c.ativo) {
      return forbidden("Acesso não liberado para este usuário.");
    }
    const cargo = (Array.isArray(c.Cargo) ? c.Cargo[0] : c.Cargo) as
      | { sistema: boolean; permissoes: string[] | null }
      | null;
    colaborador = {
      id: c.id,
      nome: c.nome,
      email: c.email,
      userId: data.user.id,
      cargoId: c.cargoId,
      admin: !!cargo?.sistema,
      permissoes: new Set(cargo?.permissoes ?? []),
    };
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(chave, { em: Date.now(), colaborador });
  }

  // A auditoria do banco atribui o que esta function gravar a quem pediu.
  definirAtor(colaborador.id);

  if (opts.permissao) {
    const lista = Array.isArray(opts.permissao) ? opts.permissao : [opts.permissao];
    if (!lista.some((p) => tem(colaborador!, p))) return semPermissao(lista[0]!);
  }
  return colaborador;
}

/** O token do request (pra functions que repassam ao Auth). */
export function tokenDe(req: Request): string {
  return tokenDoRequest(req);
}

/** 403 padrão de permissão (a tela mostra a mensagem). */
export function semPermissao(p: string): Response {
  return forbidden(`Seu cargo não tem permissão para isso (${p}).`);
}
