import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type HTMLAttributes,
} from "react";

import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

export const DialogOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/30 dark:bg-black/50 duration-150 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

export const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    showCloseButton?: boolean;
  }
>(({ className, children, showCloseButton = true, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    {/* `[&>*]:min-w-0`: itens de grid (e flex) NÃO encolhem abaixo do
        min-content por padrão. Sem isso, qualquer descendente com
        truncate/nowrap + conteúdo longo (nome/descrição grande) estoura a
        largura do popup → scroll horizontal e corte. Liberar os filhos diretos
        a encolher conserta o overflow na raiz (é no-op quando não há overflow).
        Antes era corrigido caso a caso (ex.: min-w-0 no Tabs de um dialog com abas). */}
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // max-h + overflow: um diálogo mais alto que a viewport (formulário
        // longo no mobile) rola dentro de si em vez de vazar/cortar. 100dvh
        // respeita a barra do navegador móvel. No-op quando o conteúdo cabe.
        // 🔴 SEM `backdrop-blur` aqui, e não é descuido de estilo. A superfície
        // é `bg-background/95`: 95% opaca, então só 5% do pixel vem de trás — e
        // esse 5% JÁ chega borrado pelo `backdrop-blur-sm` do overlay logo
        // abaixo. O `backdrop-blur-2xl` que existia aqui era um blur de 40px
        // para produzir diferença que ninguém enxerga, e cobrava caro: todo
        // quadro de animação de qualquer coisa que abra por cima (o popup de um
        // <Select>, um <Popover>) obriga o compositor a refazer o passe de blur
        // do tamanho do diálogo inteiro. O sintoma era dropdown "lagado" dentro
        // de diálogo, com meia dúzia de itens na lista.
        "fixed left-[50%] top-[50%] z-50 grid max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto [&>*]:min-w-0 translate-x-[-50%] translate-y-[-50%] gap-4 border border-border bg-card p-6 shadow-flutuante duration-150 ease-brand data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-[.98] data-[state=open]:zoom-in-[.98] data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-1/2 data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-1/2 sm:rounded-card",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close className="absolute right-4 top-4 grid size-8 place-items-center rounded-full bg-chip text-muted-foreground transition-[color,transform] duration-150 hover:text-foreground active:scale-[.97] disabled:pointer-events-none">
          <X className="h-4 w-4" />
          <span className="sr-only">Fechar</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

export function DialogHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col space-y-1.5 text-center sm:text-left",
        className,
      )}
      {...props}
    />
  );
}

export function DialogFooter({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

export const DialogTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-title-md font-semibold pr-8", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

export const DialogDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;
