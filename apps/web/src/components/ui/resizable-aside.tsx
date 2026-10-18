import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type Props = {
  /** Largura inicial em px se não há valor salvo. */
  defaultWidth?: number;
  /** Limites para não deixar o usuário esconder ou ocupar a tela toda. */
  minWidth?: number;
  maxWidth?: number;
  /** Chave de localStorage para persistir a largura entre sessões. */
  storageKey: string;
  className?: string;
  /** Aceito por compatibilidade — o recurso de recolher foi removido. */
  collapsible?: boolean;
  children: ReactNode;
};

/**
 * Sidebar lateral redimensionável por arraste na borda direita. Em
 * desktop (`md+`) a largura é controlada por px e o usuário pode
 * arrastar; em mobile cai para `w-full` (a aside ocupa a tela toda
 * via classes mobile do caller). Persiste a largura em localStorage
 * para não perder o ajuste entre sessões.
 *
 * Uso:
 *   <ResizableAside storageKey="chat-sidebar" defaultWidth={320}>
 *     ...conteúdo...
 *   </ResizableAside>
 */
export function ResizableAside({
  defaultWidth = 320,
  minWidth = 220,
  maxWidth = 560,
  storageKey,
  className,
  children,
}: Props) {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window === "undefined") return defaultWidth;
    const saved = window.localStorage.getItem(`aside-w:${storageKey}`);
    const parsed = saved ? Number.parseInt(saved, 10) : defaultWidth;
    if (Number.isNaN(parsed)) return defaultWidth;
    return Math.min(maxWidth, Math.max(minWidth, parsed));
  });
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { startX: e.clientX, startW: width };
      document.body.style.cursor = "col-resize";
      // Desabilita seleção de texto durante o drag — caso contrário o
      // browser tenta selecionar o conteúdo enquanto o usuário arrasta.
      document.body.style.userSelect = "none";
    },
    [width],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      const delta = e.clientX - dragRef.current.startX;
      const next = Math.min(
        maxWidth,
        Math.max(minWidth, dragRef.current.startW + delta),
      );
      setWidth(next);
    },
    [minWidth, maxWidth],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      e.currentTarget.releasePointerCapture(e.pointerId);
      // Salva ao soltar (não a cada move) — menos escrita no localStorage.
      try {
        window.localStorage.setItem(`aside-w:${storageKey}`, String(width));
      } catch {
        /* localStorage cheio / bloqueado — silencioso */
      }
    },
    [storageKey, width],
  );

  // Garante que se outro tab mudar a largura, esse atualiza junto.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== `aside-w:${storageKey}`) return;
      const next = e.newValue ? Number.parseInt(e.newValue, 10) : defaultWidth;
      if (!Number.isNaN(next)) {
        setWidth(Math.min(maxWidth, Math.max(minWidth, next)));
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [storageKey, defaultWidth, minWidth, maxWidth]);


  return (
    <aside
      className={cn(
        // Largura via variável CSS + md: — no adv3 lia window.innerWidth uma
        // vez só e não acompanhava girar o tablet/redimensionar a janela.
        "group/aside relative w-full md:w-[var(--aside-w)] md:shrink-0 border-r flex-col min-h-0",
        className,
      )}
      style={{ ["--aside-w" as string]: `${width}px` } as CSSProperties}
    >
      <div className="flex flex-col min-h-0 flex-1">{children}</div>

      {/* Handle de resize — invisível, fica em cima da border-r. Some no
          mobile (a aside ocupa a tela toda e arrastar não faz sentido). */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={cn(
          "hidden md:block absolute top-0 right-0 bottom-0 w-1 -mr-0.5",
          "cursor-col-resize select-none touch-none",
          // Feedback visual no hover/active — barra fica visível
          "hover:bg-bronze/60 active:bg-bronze transition-colors",
        )}
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionar painel"
        title="Arraste para redimensionar"
      />
    </aside>
  );
}
