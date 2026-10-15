import { Check, Minus } from "lucide-react";
import {
  forwardRef,
  useEffect,
  useRef,
  type InputHTMLAttributes,
} from "react";

import { cn } from "@/lib/utils";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  /** Visual "—" usado em headers quando há seleção parcial. */
  indeterminate?: boolean;
};

/**
 * Checkbox nativo estilizado com Tailwind. Suporta `indeterminate`
 * (estado tri-state usado em headers de tabela). Mantém role=checkbox
 * pra integração com os seletores do <Table> (`[&:has([role=checkbox])]`).
 */
export const Checkbox = forwardRef<HTMLInputElement, Props>(
  ({ className, indeterminate, checked, ...props }, ref) => {
    const innerRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
      if (innerRef.current) {
        innerRef.current.indeterminate = !!indeterminate;
      }
    }, [indeterminate]);

    return (
      <span className="relative inline-flex items-center justify-center">
        <input
          ref={(node) => {
            innerRef.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
          }}
          type="checkbox"
          role="checkbox"
          checked={checked}
          className={cn(
            "peer appearance-none size-4 rounded border border-input bg-background",
            "transition-colors cursor-pointer",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "checked:bg-primary checked:border-primary",
            "indeterminate:bg-primary indeterminate:border-primary",
            className,
          )}
          {...props}
        />
        {indeterminate ? (
          <Minus
            className="pointer-events-none absolute size-3 text-primary-foreground"
            strokeWidth={3}
          />
        ) : checked ? (
          <Check
            className="pointer-events-none absolute size-3 text-primary-foreground"
            strokeWidth={3}
          />
        ) : null}
      </span>
    );
  },
);
Checkbox.displayName = "Checkbox";
