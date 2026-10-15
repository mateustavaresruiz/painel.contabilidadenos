import {
  Archive,
  CheckCircle2,
  CircleDot,
  Headset,
  Inbox,
  UserCheck,
  UserRound,
  UserX,
  Users as UsersIcon,
} from "lucide-react";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

export type FiltroChip =
  | "todas"
  | "abertas"
  | "em_atendimento"
  | "finalizadas"
  | "clientes"
  | "grupos"
  | "arquivadas";

/** Filtro de responsável (novo no painel Denos: vários colaboradores). */
export type FiltroResponsavel = "minhas" | "sem" | "todas";

type Chip<T extends string> = {
  id: T;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

export const CHIPS_FILTRO: Chip<FiltroChip>[] = [
  { id: "todas", label: "Todas", icon: Inbox },
  { id: "abertas", label: "Abertas", icon: CircleDot },
  { id: "em_atendimento", label: "Em atendimento", icon: Headset },
  { id: "finalizadas", label: "Finalizadas", icon: CheckCircle2 },
  { id: "clientes", label: "Clientes", icon: UserCheck },
  { id: "grupos", label: "Grupos", icon: UsersIcon },
  { id: "arquivadas", label: "Arquivadas", icon: Archive },
];

export const CHIPS_RESPONSAVEL: Chip<FiltroResponsavel>[] = [
  { id: "minhas", label: "Minhas", icon: UserRound },
  { id: "sem", label: "Sem responsável", icon: UserX },
  { id: "todas", label: "Todas", icon: Inbox },
];

type Props<T extends string> = {
  chips: Chip<T>[];
  ativo: T;
  onChange: (filtro: T) => void;
  /** Contagem opcional por chip (ex.: quantas sem responsável). */
  contagens?: Partial<Record<T, number>>;
  className?: string;
};

/**
 * Linha horizontal de chips pra filtrar a lista de conversas.
 *
 * Comportamentos de rolagem:
 *   - Touch (mobile/tablet): swipe horizontal nativo do navegador.
 *   - Mouse wheel: converte rolagem vertical → horizontal pra não
 *     precisar do Shift+wheel.
 *   - Drag (mouse): clica e arrasta o container pra rolar — útil
 *     em desktop quando os chips extrapolam a largura.
 */
export function ChatFilterChips<T extends string>({
  chips,
  ativo,
  onChange,
  contagens,
  className,
}: Props<T>) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // --- Drag-to-scroll (mouse) -----------------------------------------
    let isDown = false;
    let startX = 0;
    let startScroll = 0;
    let movedPx = 0; // pra distinguir click de drag (evita disparar onClick após arrastar)
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
      // arrastar pra ver os chips dispararia a seleção do filtro.
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
        "flex items-center gap-2 px-3 py-2 overflow-x-auto cursor-grab select-none",
        className,
        // Esconde scrollbar visualmente — UX melhor em mobile (chips rolam)
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      )}
    >
      {chips.map((chip) => {
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
              "shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium",
              "transition-all border",
              isAtivo
                ? "bg-card border-2 border-ring text-foreground px-[11px] py-[5px]"
                : "bg-card border-border text-muted-foreground hover:text-foreground",
            )}
            aria-pressed={isAtivo}
          >
            <Icon className="size-3.5" />
            <span>{chip.label}</span>
            {contagens?.[chip.id] ? (
              <span
                className={cn(
                  "min-w-[16px] h-4 px-1 rounded-full text-[10px] leading-4 font-semibold tabular-nums",
                  isAtivo ? "bg-background/20" : "bg-primary/10 text-primary",
                )}
              >
                {contagens[chip.id]}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
