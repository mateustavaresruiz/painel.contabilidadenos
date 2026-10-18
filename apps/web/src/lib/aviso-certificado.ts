// Regra ÚNICA do texto do aviso de vencimento de certificado.
//
// 🔴 Este arquivo existe em dois lugares, IGUAIS byte a byte:
//   apps/web/src/lib/aviso-certificado.ts                       (prévia da tela)
//   infra/supabase/volumes/functions/_shared/aviso-certificado.ts (rotina crons)
// O teste `crons/aviso-texto_test.ts` reprova se os dois divergirem. Mudou um,
// copie para o outro. Sem dependências: roda no Vite e no Deno.
//
// O modelo padrão mora na Config `certificado.modeloPadrao` (migration 018);
// `MODELO_RESERVA` só vale se a Config estiver vazia (instalação nova).

export const CHAVE_MODELO = "certificado.modelo";
export const CHAVE_MODELO_PADRAO = "certificado.modeloPadrao";

export const MODELO_RESERVA =
  "Olá, {cliente}! O certificado digital {tipo} vence em {data} ({dias}). Fale com a gente para renovar e não ficar sem emitir notas e guias. NÓS Contabilidade";

export const CAMPOS_MODELO = ["{cliente}", "{tipo}", "{data}", "{dias}"] as const;

/** O {dias} do modelo: "vence hoje", "em 1 dia", "em N dias". */
export function textoDias(dias: number): string {
  if (dias <= 0) return "vence hoje";
  if (dias === 1) return "em 1 dia";
  return `em ${dias} dias`;
}

/** Modelo que vale: o salvo; vazio, o padrão da Config; sem os dois, o de reserva. */
export function modeloEfetivo(salvo: unknown, padrao: unknown): string {
  if (typeof salvo === "string" && salvo.trim()) return salvo;
  if (typeof padrao === "string" && padrao.trim()) return padrao;
  return MODELO_RESERVA;
}

/**
 * Texto final. `validoAte` em AAAA-MM-DD (vira dd/mm/aaaa); `dias` = dias
 * corridos de hoje (São Paulo) até o vencimento.
 */
export function montarTextoAviso(
  modelo: string,
  v: { cliente: string; tipo: string; validoAte: string; dias: number },
): string {
  const [a, m, d] = v.validoAte.slice(0, 10).split("-");
  return modelo
    .replaceAll("{cliente}", v.cliente)
    .replaceAll("{tipo}", v.tipo)
    .replaceAll("{data}", `${d}/${m}/${a}`)
    .replaceAll("{dias}", textoDias(v.dias));
}
