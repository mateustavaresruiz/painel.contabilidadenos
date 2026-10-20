import { Archive, Inbox, MessageSquareDot, Users as UsersIcon, UserCheck, UserRound, UserX } from "lucide-react";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

// "minhas" / "sem" (responsável) são do painel Denos: vários colaboradores.
// "naoLidas": só conversas com mensagem não lida (naoLidas > 0).
export type FiltroChip = "todas" | "naoLidas" | "minhas" | "sem" | "clientes" | "grupos" | "arquivadas";

type Props = {
  ativo: FiltroChip;
  onChange: (filtro: FiltroChip) => void;
};

const CHIPS: Array<{
  id: FiltroChip;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "todas", label: "Todas", icon: Inbox },
  { id: "naoLidas", label: "Não lidas", icon: MessageSquareDot },
  { id: "minhas", label: "Minhas", icon: UserRound },
  { id: "sem", label: "Sem responsável", icon: UserX },
  { id: "clientes", label: "Clientes", icon: UserCheck },
  { id: "grupos", label: "Grupos", icon: UsersIcon },
  { id: "arquivadas", label: "Arquivadas", icon: Archive },
];

/**
 * Linha horizontal de chips para filtrar a lista de conversas.
 *
 * Comportamentos de rolagem:
 *   - Touch (mobile/tablet): swipe horizontal nativo do navegador.
 *   - Mouse wheel: converte rolagem vertical → horizontal para não
 *     precisar do Shift+wheel.
 *   - Drag (mouse): clica e arrasta o container para rolar — útil
 *     em desktop quando os chips extrapolam a largura.
 */
export function ChatFilterChips({ ativo, onChange }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // --- Drag-to-scroll (mouse) -----------------------------------------
    let isDown = false;
    let startX = 0;
    let startScroll = 0;
    let movedPx = 0; // para distinguir click de drag (evita disparar onClick após arrastar)
    const DRAG_THRESHOLD = 5;

    function onPointerDown(e: PointerEvent) {
      // Só mouse — touch já tem swipe nativo do navegador
      if (e.pointerType !== "mouse") return;
      // Botões diferentes do esquerdo não arrastam
      if (e.button !== 0) return;
      isDown = true;
      startX = e.clientX;
      startScroll = el!.scrollLeft;
      movedPx = 0;
      el!.style.cursor = "grabbing";
    }

    function onPointerMove(e: PointerEvent) {
      if (!isDown) return;
      const dx = e.clientX - startX;
      movedPx = Math.max(movedPx, Math.abs(dx));
      el!.scrollLeft = startScroll - dx;
    }

    function onPointerUp() {
      isDown = false;
      el!.style.cursor = "";
    }

    function onClickCapture(e: MouseEvent) {
      // Engole o click se o usuário arrastou > threshold — senão
      // arrastar para ver os chips dispararia a seleção do filtro.
      if (movedPx > DRAG_THRESHOLD) {
        e.stopPropagation();
        e.preventDefault();
        movedPx = 0;
      }
    }

    // --- Mouse wheel: vertical → horizontal -----------------------------
    function onWheel(e: WheelEvent) {
      // Se o user já tá rolando horizontal (Shift+wheel ou trackpad),
      // não atrapalha — só converte quando deltaY > deltaX.
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      // Container tem rolagem real (mais largo que o visível)?
      if (el!.scrollWidth <= el!.clientWidth) return;
      e.preventDefault();
      el!.scrollLeft += e.deltaY;
    }

    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    el.addEventListener("click", onClickCapture, true);
    el.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("click", onClickCapture, true);
      el.removeEventListener("wheel", onWheel);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        // Quebra em duas linhas quando a coluna é estreita: antes os chips
        // saíam cortados ("Sem respon…") e só apareciam arrastando.
        "chips-conversa flex flex-wrap items-center gap-1.5 px-3 py-2.5 select-none",
      )}
    >
      {CHIPS.map((chip) => {
        const Icon = chip.icon;
        const isAtivo = ativo === chip.id;
        return (
          <button
            key={chip.id}
            type="button"
            onClick={() => onChange(chip.id)}
            // Não inicia drag em cima do botão — deixa o cursor default
            // (e o handler de drag-to-scroll continua no container pai).
            onPointerDown={(e) => e.stopPropagation()}
            className={cn(
              "shrink-0 flex items-center gap-1.5 px-2.5 py-1 toque:min-h-10 toque:px-3.5 rounded-full text-xs font-medium",
              "transition-all border",
              isAtivo
                ? "bg-foreground text-background border-foreground shadow-sm"
                : "bg-card border-border/60 text-muted-foreground hover:text-foreground hover:bg-accent/40",
            )}
            aria-pressed={isAtivo}
          >
            <Icon className="chip-ico size-3.5" />
            <span>{chip.label}</span>
          </button>
        );
      })}
    </div>
  );
}
