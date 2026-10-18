// Pequenas regras de texto usadas em todo o painel.

/**
 * Singular ou plural pelo número, com o número na frente:
 *   plural(1, "chamado", "chamados") → "1 chamado"
 *   plural(3, "linha", "linhas")     → "3 linhas"
 * `semNumero` devolve só a palavra (para frases como "N vencem").
 */
export function plural(n: number, singular: string, pluralForma: string, opts?: { semNumero?: boolean }): string {
  const palavra = Math.abs(n) === 1 ? singular : pluralForma;
  return opts?.semNumero ? palavra : `${n.toLocaleString("pt-BR")} ${palavra}`;
}

/** Minúsculas e sem acento: "São João" → "sao joao". Mesma regra da busca no banco (normalizar_busca). */
export function normalizarBusca(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

const COLLATOR = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

/** Ordem alfabética do português (acento não pesa, "2" antes de "10"). */
export function compararTexto(a: string | null | undefined, b: string | null | undefined): number {
  return COLLATOR.compare(a ?? "", b ?? "");
}
