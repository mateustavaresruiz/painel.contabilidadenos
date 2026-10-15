// Cor de cada módulo (tokens --mod-* em index.css, claro e escuro).
// Uso: style={corModulo("chamados")} + classes `chip-mod` / `texto-mod`,
// ou `var(--mc)` em qualquer estilo dentro do elemento.

import type { CSSProperties } from "react";

export type CorModulo =
  | "inicio"
  | "whatsapp"
  | "chamados"
  | "clientes"
  | "certificados"
  | "fiscal"
  | "equipe"
  | "config";

const VAR: Record<CorModulo, string> = {
  inicio: "--mod-inicio",
  whatsapp: "--mod-whatsapp",
  chamados: "--mod-chamados",
  clientes: "--mod-clientes",
  certificados: "--mod-certificados",
  fiscal: "--mod-fiscal",
  equipe: "--mod-equipe",
  config: "--mod-config",
};

/** Define `--mc` (cor do módulo) no elemento; os filhos usam `var(--mc)`. */
export function corModulo(cor: CorModulo): CSSProperties {
  return { "--mc": `var(${VAR[cor]})` } as CSSProperties;
}

/** A cor crua, para SVG/gráfico. */
export const varModulo = (cor: CorModulo) => `var(${VAR[cor]})`;
