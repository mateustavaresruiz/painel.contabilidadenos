import { useEffect } from "react";

const SUFIXO = "Painel NÓS";

/** Título da aba: "<página> · Painel NÓS". */
export function usePageTitle(titulo?: string | null) {
  useEffect(() => {
    document.title = titulo ? `${titulo} · ${SUFIXO}` : SUFIXO;
  }, [titulo]);
}
