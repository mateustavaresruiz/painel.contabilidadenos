import { useEffect, useState } from "react";

function casa(query: string): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(query).matches;
}

/**
 * Reage a uma media query CSS. Começa já com o valor real (o app é só
 * cliente): começar em `false` desenhava o layout de desktop por um quadro no
 * celular e depois trocava. Usa `matchMedia` com listener moderno.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => casa(query));

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, [query]);

  return matches;
}

/** `true` em telas estreitas (< breakpoint `md` do Tailwind, 768px). */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}

/**
 * Celular em pé OU deitado. Deitado (ex.: 844x390) passa do `md`, mas tem
 * altura de celular: lista e conversa lado a lado não cabem. Espelha a
 * variante `compacto:` do tailwind.config.ts.
 */
export const TELA_COMPACTA = "(max-width: 767px), (max-height: 500px) and (pointer: coarse)";
export function useTelaCompacta(): boolean {
  return useMediaQuery(TELA_COMPACTA);
}

/** Dedo como ponteiro principal (celular, tablet). Espelha a variante `toque:`. */
export function useToque(): boolean {
  return useMediaQuery("(pointer: coarse)");
}

/** Leitura pontual (fora de componente / em handler). */
export function ehToque(): boolean {
  return casa("(pointer: coarse)");
}
