import { useEffect } from "react";

/**
 * Teclado virtual sem esconder o campo de mensagem.
 *
 * Android (Chrome): o viewport declara `interactive-widget=resizes-content`,
 * então o teclado encolhe a página e o `100dvh` da casca encolhe junto. Aqui
 * não há nada a fazer (innerHeight e visualViewport.height andam juntos).
 *
 * iOS (Safari): o teclado NÃO encolhe a página; ele só reduz a "janela
 * visível" (visualViewport) e às vezes a desloca para cima (offsetTop). Com a
 * casca em 100dvh o composer ficava atrás do teclado. Este hook escreve no
 * <html>:
 *   --teclado      altura do teclado (px)
 *   --vv-altura    altura visível (px)  → altura da casca
 *   --vv-topo      deslocamento (px)    → a casca acompanha a janela visível
 * Só enquanto o teclado está aberto; fechado, as variáveis somem e valem os
 * padrões (100dvh, 0). Zoom de pinça (scale > 1) não conta como teclado.
 */
export function useTecladoVirtual() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const raiz = document.documentElement;
    let quadro = 0;

    function medir() {
      quadro = 0;
      if (!vv) return;
      const teclado = Math.round(window.innerHeight - vv.height - vv.offsetTop);
      const aberto = vv.scale <= 1.01 && window.innerHeight - vv.height > 80;
      if (aberto) {
        raiz.style.setProperty("--teclado", `${Math.max(0, teclado)}px`);
        raiz.style.setProperty("--vv-altura", `${Math.round(vv.height)}px`);
        raiz.style.setProperty("--vv-topo", `${Math.round(vv.offsetTop)}px`);
        raiz.dataset.teclado = "1";
      } else if (raiz.dataset.teclado) {
        raiz.style.removeProperty("--teclado");
        raiz.style.removeProperty("--vv-altura");
        raiz.style.removeProperty("--vv-topo");
        delete raiz.dataset.teclado;
      }
    }
    function agendar() {
      if (!quadro) quadro = requestAnimationFrame(medir);
    }

    vv.addEventListener("resize", agendar);
    vv.addEventListener("scroll", agendar);
    medir();
    return () => {
      vv.removeEventListener("resize", agendar);
      vv.removeEventListener("scroll", agendar);
      if (quadro) cancelAnimationFrame(quadro);
      raiz.style.removeProperty("--teclado");
      raiz.style.removeProperty("--vv-altura");
      raiz.style.removeProperty("--vv-topo");
      delete raiz.dataset.teclado;
    };
  }, []);
}
