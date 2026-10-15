import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { cn } from "@/lib/utils";

/**
 * Painel deslizante ancorado a uma borda da tela. É o mesmo Radix Dialog do
 * `dialog.tsx` — muda só de onde ele entra e como ocupa a viewport.
 *
 * `side="bottom"` é o formato de mobile: nasce na zona do polegar (um modal
 * centrado, não), e por isso é o invólucro de filtro/ação em tela estreita.
 * `side="left"` é o menu de navegação. Este arquivo existe porque os dois
 * layouts (app e admin) tinham a MESMA gaveta copiada à mão em Radix cru.
 */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetPortal = DialogPrimitive.Portal;

export const SheetOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
SheetOverlay.displayName = DialogPrimitive.Overlay.displayName;

type SheetSide = "top" | "bottom" | "left" | "right";

const SIDE_CLASSES: Record<SheetSide, string> = {
  top: "inset-x-0 top-0 border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
  // 85dvh: sobra tela suficiente atrás pra pessoa entender que é uma camada
  // (e ter onde tocar pra fechar). dvh, não vh — a barra do navegador móvel
  // some e volta, e vh não acompanha.
  bottom:
    "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl border-t pb-safe-b data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
  left: "inset-y-0 left-0 w-72 max-w-[85vw] border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left",
  right:
    "inset-y-0 right-0 w-full max-w-md border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
};

/** Arrasto (em px) a partir do qual soltar fecha a folha. */
const LIMITE_ARRASTO = 88;

export const SheetContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    side?: SheetSide;
    /** Alça de arrastar + fechar por gesto. Só faz sentido em `bottom`. */
    showHandle?: boolean;
    showCloseButton?: boolean;
    /** Classe do véu. Serve pro `md:hidden` de folha que só existe no mobile:
        sem ele, girar/redimensionar pro desktop com a folha aberta deixa um
        véu cobrindo o app inteiro. */
    overlayClassName?: string;
  }
>(
  (
    {
      className,
      children,
      side = "bottom",
      showHandle = true,
      showCloseButton = false,
      overlayClassName,
      ...props
    },
    ref,
  ) => {
    const arrastavel = side === "bottom" && showHandle;
    const painelRef = useRef<HTMLDivElement | null>(null);
    const inicioY = useRef<number | null>(null);
    const [arrastando, setArrastando] = useState(false);

    /* Arrastar pra baixo pra fechar. Escrito à mão (e não com a `vaul`)
       porque o gesto vive só na alça: 40 linhas contra uma dependência.
       O deslocamento vai em style inline — com a transição desligada
       durante o gesto, senão o dedo "puxa" um painel atrasado. */
    const aoPressionar = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
      inicioY.current = e.clientY;
      setArrastando(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }, []);

    const aoMover = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
      if (inicioY.current === null || !painelRef.current) return;
      // Só pra baixo: puxar pra cima não estica a folha.
      const delta = Math.max(0, e.clientY - inicioY.current);
      painelRef.current.style.transform = `translateY(${delta}px)`;
    }, []);

    const aoSoltar = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
      const painel = painelRef.current;
      if (inicioY.current === null || !painel) return;
      const delta = e.clientY - inicioY.current;
      inicioY.current = null;
      setArrastando(false);
      painel.style.transform = "";
      if (delta > LIMITE_ARRASTO) {
        // Fecha pelo botão escondido: mantém o ciclo do Radix (foco volta
        // pro gatilho, onOpenChange dispara) em vez de sumir com o nó.
        painel
          .querySelector<HTMLButtonElement>("[data-sheet-close-gesto]")
          ?.click();
      }
    }, []);

    return (
      <SheetPortal>
        <SheetOverlay className={overlayClassName} />
        <DialogPrimitive.Content
          ref={(node) => {
            painelRef.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
          }}
          className={cn(
            // `[&>*]:min-w-0` pelo mesmo motivo do dialog.tsx: filho com
            // truncate + texto longo estouraria a largura do painel.
            //
            // 🔴 E sem `backdrop-blur` pelo mesmo motivo do dialog.tsx: a
            // superfície é 95% opaca sobre um overlay que já borra, então o
            // blur de 40px não muda o que se vê. Aqui saía mais caro que lá,
            // porque este painel é ARRASTÁVEL: cada quadro do arraste obrigava
            // o compositor a refazer o passe de blur, no aparelho mais fraco.
            "fixed z-50 flex flex-col overflow-hidden outline-none border-border/60 bg-background/95 shadow-2xl [&>*]:min-w-0 data-[state=open]:animate-in data-[state=closed]:animate-out duration-300 ease-brand",
            SIDE_CLASSES[side],
            arrastando && "transition-none duration-0",
            className,
          )}
          // O foco entra no próprio painel, não no primeiro botão (que ficava com anel de foco ao abrir).
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            painelRef.current?.focus();
          }}
          {...props}
        >
          {arrastavel && (
            <div
              onPointerDown={aoPressionar}
              onPointerMove={aoMover}
              onPointerUp={aoSoltar}
              onPointerCancel={aoSoltar}
              // touch-none: sem isso o navegador rola a página em vez de
              // deixar o gesto chegar no pointermove.
              className="shrink-0 touch-none cursor-grab active:cursor-grabbing pt-3 pb-1 grid place-items-center"
              aria-hidden
            >
              <div className="h-1 w-10 rounded-full bg-border" />
            </div>
          )}
          <DialogPrimitive.Close data-sheet-close-gesto className="hidden" />
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close
              className="absolute right-3 top-3 grid place-items-center size-8 rounded-md hover:bg-accent/60 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-label="Fechar"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </SheetPortal>
    );
  },
);
SheetContent.displayName = "SheetContent";

export function SheetHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "shrink-0 flex flex-col gap-1 px-4 pt-3 pb-3 border-b border-border/60",
        className,
      )}
      {...props}
    />
  );
}

/** Miolo rolável. O painel não rola inteiro — cabeçalho e rodapé ficam. */
export function SheetBody({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4",
        className,
      )}
      {...props}
    />
  );
}

export function SheetFooter({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "shrink-0 flex gap-2 px-4 py-3 border-t border-border/60",
        className,
      )}
      {...props}
    />
  );
}

export const SheetTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-base font-semibold tracking-tight", className)}
    {...props}
  />
));
SheetTitle.displayName = DialogPrimitive.Title.displayName;

export const SheetDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
SheetDescription.displayName = DialogPrimitive.Description.displayName;
