import { forwardRef, type InputHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        className={cn(
          // DESIGN.md: canvas, borda 1px hairline, raio 8px, altura 40px; foco
          // = outline 2px no azul de foco (vem do :focus-visible global).
          // text-base no mobile evita o auto-zoom do Safari iOS.
          "flex h-10 max-sm:h-11 w-full rounded-md border border-input bg-card px-3 py-1 text-base md:text-sm transition-colors hover:border-foreground/20 placeholder:text-muted-foreground file:border-0 file:bg-transparent file:text-sm file:font-semibold disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
