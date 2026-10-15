// O FREIO DAS EDGE FUNCTIONS — "quantas vezes isto pode acontecer por janela?"
//
// Conta hits por janela na tabela public."RateLimit" via `rate_limit_hit`
// (migration 001). Do ponto de vista do banco a chave é só uma string: é ela
// que define o EIXO do limite. No painel Denos o eixo é o escritório
// (`t:denos`): o recurso em risco é o número de WhatsApp dele.
//
// ===========================================================================
// 🔴 FAIL-OPEN. É DE PROPÓSITO. NÃO "CONSERTE".
// ===========================================================================
// Se o limiter não responder um "estourou" LIMPO — erro de rede, timeout, a
// função ainda não existe neste banco, permissão negada, formato estranho — a
// requisição PASSA. O freio existe pra conter abuso, não pra virar ponto único
// de falha: um soluço do banco derrubando o envio de WhatsApp de todo mundo é
// um estrago muito maior do que o abuso que ele evita.
//
// A tabela não cresce sem fim: o job SQL `purga-diaria` (migration 003) apaga
// as linhas com `window_start` de mais de 7 dias.
import { errorResponse } from "./response.ts";
import { supabaseAdmin } from "./supabase.ts";

export const sujeitoTenant = (tenantId: string): string => `t:${tenantId}`;

/** A chave do balde. ⚠️ action e sujeito nunca saem do corpo da requisição. */
export function chaveRateLimit(action: string, sujeito: string): string {
  return `${action}:${sujeito}`;
}

export type LimiteOpts = {
  /** Rótulo da ação (compõe a chave e o log), ex.: "whatsapp:envio". */
  action: string;
  max: number;
  windowSecs: number;
  sujeito: string;
};

/** `false` = estourou o limite. Nunca lança e nunca rejeita. */
export async function dentroDoLimite(opts: LimiteOpts): Promise<boolean> {
  const chave = chaveRateLimit(opts.action, opts.sujeito);
  try {
    const { data, error } = await supabaseAdmin.rpc("rate_limit_hit", {
      p_key: chave,
      p_max: opts.max,
      p_window_secs: opts.windowSecs,
    });
    if (error) {
      console.warn(
        `[rate-limit] rate_limit_hit() falhou (code=${error.code ?? "?"}) — PASSANDO por fail-open.`,
        error.message,
      );
      return true;
    }
    // PostgREST devolve escalar direto; algumas versões embrulham em array.
    const bruto = Array.isArray(data) ? data[0] : data;
    if (bruto === false) {
      console.warn(`[rate-limit] freou ${chave} (max=${opts.max}/${opts.windowSecs}s)`);
      return false;
    }
    return true;
  } catch (err) {
    // Falha de fetch/DNS ESTOURA no supabase-js. Sem este catch, o fail-open
    // viraria um 500 — que barra do mesmo jeito, só que com cara de bug.
    console.warn("[rate-limit] rate_limit_hit() não respondeu — PASSANDO.", err);
    return true;
  }
}

export const MENSAGEM_LIMITE =
  "Muitas tentativas. Aguarde alguns instantes e tente de novo.";

/** Aplica o freio. Retorna 429 se estourou, ou `null` se pode seguir. */
export async function enforceRateLimit(
  opts: LimiteOpts & { mensagem?: string },
): Promise<Response | null> {
  if (await dentroDoLimite(opts)) return null;
  return errorResponse(opts.mensagem?.trim() || MENSAGEM_LIMITE, 429);
}
