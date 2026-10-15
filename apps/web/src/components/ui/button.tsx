import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

// Botões do DESIGN.md. Sem sombra, sem gradiente; status nunca vira botão.
//  default     = primário: acento, texto branco, pílula, 15px/400
//  outline     = secundário: transparente, borda e texto no acento, pílula
//  secondary   = pearl: ação neutra em cartão, raio 11px
//  utility     = utilitário: tinta escura, texto branco, raio 8px, 13px
//  ghost       = só texto (ações de ícone em listas)
//  destructive = ação que apaga: texto em vermelho, sem preenchimento
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-normal relative transition-[color,background-color,border-color,transform,opacity] duration-150 ease-brand active:scale-[.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "rounded-full bg-primary text-primary-foreground hover:bg-primary/90",
        outline: "rounded-full border border-primary text-primary bg-transparent hover:bg-primary/5",
        secondary: "rounded-pearl border border-divider bg-secondary text-secondary-foreground hover:bg-accent",
        utility: "rounded-md bg-foreground text-background text-xs hover:bg-foreground/90",
        ghost: "rounded-md text-foreground hover:bg-accent",
        destructive: "rounded-full border border-destructive/40 text-destructive bg-transparent hover:bg-destructive/5",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-[18px]",
        sm: "h-8 px-3.5 text-xs",
        lg: "h-11 px-6",
        icon: "size-9 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Mostra um spinner à esquerda, desabilita o botão e marca aria-busy.
   *  Ignorado com asChild (o Slot espera um único filho). */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    const isLoading = loading && !asChild;
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        disabled={disabled || isLoading}
        aria-busy={isLoading || undefined}
        {...props}
      >
        {isLoading ? (
          // Spinner por cima do conteúdo invisível: o botão não muda de
          // largura enquanto espera (nada pula na linha).
          <>
            <span className="invisible inline-flex items-center gap-2">{children}</span>
            <span className="absolute inset-0 grid place-items-center">
              <Loader2 className="animate-spin" />
            </span>
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
