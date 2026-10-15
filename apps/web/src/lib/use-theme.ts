import { useEffect, useState } from "react";

import { getStoredTheme, setTheme as applyAndStore, type Theme } from "./theme";

/**
 * Hook reativo do tema. Lê o tema atual e re-renderiza quando ele muda em
 * QUALQUER lugar (o `setTheme` dispara o evento `adv3:theme`), então vários
 * botões/áreas ficam em sincronia sem prop-drilling.
 */
export function useTheme() {
  const [theme, setLocal] = useState<Theme>(() => getStoredTheme());

  useEffect(() => {
    function onChange(e: Event) {
      setLocal((e as CustomEvent<Theme>).detail);
    }
    window.addEventListener("denos:theme", onChange as EventListener);
    return () =>
      window.removeEventListener("denos:theme", onChange as EventListener);
  }, []);

  function set(t: Theme) {
    applyAndStore(t);
    setLocal(t);
  }

  function toggle() {
    set(theme === "dark" ? "light" : "dark");
  }

  return { theme, setTheme: set, toggle };
}
