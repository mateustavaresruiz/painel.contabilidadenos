import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
};

/** Interruptor liga/desliga (role="switch"). Ligado = acento; desligado = cinza. */
export const Switch = forwardRef<HTMLButtonElement, Props>(
  ({ checked, onCheckedChange, className, disabled, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 after:absolute after:-inset-x-1 after:-inset-y-2.5 after:content-[''] items-center rounded-full transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none",
        checked ? "bg-primary" : "bg-foreground/20",
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "inline-block size-5 rounded-full bg-white transition-transform duration-150 ease-brand",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  ),
);
Switch.displayName = "Switch";
