import { useEffect, useState } from "react";

/**
 * Reage a uma media query CSS. SSR-safe: começa `false` e sincroniza no
 * primeiro efeito (evita mismatch de hidratação). Usa `matchMedia` com
 * listener moderno (`addEventListener`), com fallback pra browsers antigos.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

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
