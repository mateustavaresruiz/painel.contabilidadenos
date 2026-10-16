import { useCallback, useEffect, useRef } from "react";

/**
 * Para barras de abas que rolam na horizontal: marca `data-fade` ("fim",
 * "inicio" ou "ambos") conforme ainda haja conteúdo escondido, e o CSS
 * esmaece a borda (a aba não parece cortada no meio da palavra). Também
 * rola a aba ativa para dentro da vista ao montar e a cada troca.
 */
export function useFadeRolagem<T extends HTMLElement>(dep?: unknown) {
  const el = useRef<T | null>(null);

  const atualizar = useCallback(() => {
    const n = el.current;
    if (!n) return;
    const resto = n.scrollWidth - n.clientWidth;
    const noInicio = n.scrollLeft <= 1;
    const noFim = n.scrollLeft >= resto - 1;
    if (resto <= 1) delete n.dataset.fade;
    else n.dataset.fade = noInicio ? "fim" : noFim ? "inicio" : "ambos";
  }, []);

  const ref = useCallback(
    (n: T | null) => {
      el.current = n;
      if (n) atualizar();
    },
    [atualizar],
  );

  useEffect(() => {
    const n = el.current;
    if (!n) return;
    const ativa = n.querySelector<HTMLElement>("[data-state=active],[aria-current=page]");
    if (ativa) {
      const alvo = ativa.offsetLeft - (n.clientWidth - ativa.offsetWidth) / 2;
      n.scrollLeft = Math.max(0, alvo);
    }
    atualizar();
    n.addEventListener("scroll", atualizar, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(atualizar) : null;
    ro?.observe(n);
    return () => {
      n.removeEventListener("scroll", atualizar);
      ro?.disconnect();
    };
  }, [atualizar, dep]);

  return ref;
}
