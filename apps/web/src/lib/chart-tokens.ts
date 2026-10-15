import { useMemo } from "react";

import { useTheme } from "./use-theme";

/**
 * Cores dos gráficos (recharts) resolvidas a partir dos tokens CSS do tema.
 *
 * Recharts pinta SVG com strings de cor CONCRETAS — não lê `var(--x)` dentro de
 * stops de gradiente, `fill` de tick, etc. Então resolvemos os tokens uma vez
 * via `getComputedStyle`. Como o tema agora alterna em runtime (claro ⇄ escuro),
 * o hook depende de `theme`: ao trocar, o `.dark` já está aplicado no <html>
 * (applyTheme roda síncrono antes do re-render), então o re-cálculo lê a paleta
 * nova. SSR-safe: cai num fallback neutro sem `document`.
 *
 * Antes cada gráfico tinha cores oklch HARDCODED (tunadas pro tema claro
 * antigo) — no escuro o texto de eixo/rótulo (oklch ~0.22) sumia no card preto,
 * e o tooltip near-white sumia no creme do claro. Centralizar aqui conserta os
 * dois temas de uma vez.
 */
export function useChartTokens() {
  const { theme } = useTheme();
  return useMemo(() => {
    const fallback = {
      foreground: "oklch(0.22 0.015 60)",
      muted: "oklch(0.45 0.015 70)",
      border: "oklch(0.85 0.015 80)",
      popover: "oklch(0.97 0.008 85)",
      popoverFg: "oklch(0.22 0.015 60)",
      success: "oklch(0.42 0.10 150)",
      danger: "oklch(0.55 0.18 25)",
      primary: "#1d3b6f",
      bronze: "#b97d3a",
      warning: "#a8620f",
    };
    if (typeof document === "undefined") return fallback;
    const css = getComputedStyle(document.documentElement);
    const tok = (name: string, fb: string) =>
      css.getPropertyValue(name).trim() || fb;
    return {
      foreground: tok("--foreground", fallback.foreground),
      muted: tok("--muted-foreground", fallback.muted),
      border: tok("--border", fallback.border),
      popover: tok("--popover", fallback.popover),
      popoverFg: tok("--popover-foreground", fallback.popoverFg),
      success: tok("--success", fallback.success),
      danger: tok("--danger", fallback.danger),
      primary: tok("--primary", fallback.primary),
      bronze: tok("--bronze", fallback.bronze),
      warning: tok("--warning", fallback.warning),
    };
    // `theme` na deps força o re-cálculo na troca de tema.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);
}
