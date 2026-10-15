import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, X } from "lucide-react";
import { forwardRef, useState } from "react";

import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type Props = {
  /** "AAAA-MM-DD" (formato do banco). Vazio = nenhuma data. */
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  /** Mostra o "x" para limpar o campo (use nos opcionais). */
  limpavel?: boolean;
  className?: string;
  "aria-label"?: string;
};

/**
 * Campo de data do painel. Mostra DD/MM/AAAA (nunca o formato do navegador) e
 * abre o calendário do painel. Fala "AAAA-MM-DD" com o resto do código, então
 * troca direto o `<Input type="date">`. Funciona dentro de diálogo.
 */
export const DatePicker = forwardRef<HTMLButtonElement, Props>(
  ({ value, onChange, placeholder = "dd/mm/aaaa", id, disabled, limpavel, className, ...resto }, ref) => {
    const [open, setOpen] = useState(false);
    const data = value ? parseISO(value) : undefined;
    const valida = !!data && !Number.isNaN(data.getTime());
    const rotulo = valida && data ? format(data, "dd/MM/yyyy", { locale: ptBR }) : placeholder;

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <div className="relative">
          <PopoverTrigger asChild>
            <button
              type="button"
              ref={ref}
              id={id}
              disabled={disabled}
              aria-label={resto["aria-label"]}
              className={cn(
                "flex h-10 max-sm:h-11 w-full items-center gap-2 rounded-md border border-input bg-card px-3 py-1 text-base md:text-sm",
                "transition-colors hover:border-foreground/20 disabled:cursor-not-allowed disabled:opacity-50",
                !valida && "text-muted-foreground",
                valida && limpavel && "pr-9",
                className,
              )}
            >
              <CalendarDays className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
              <span className="flex-1 truncate text-left tabular-nums">{rotulo}</span>
            </button>
          </PopoverTrigger>
          {valida && limpavel && !disabled && (
            <button
              type="button"
              onClick={() => onChange("")}
              aria-label="Limpar data"
              className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            value={valida ? data : undefined}
            onSelect={(d) => {
              onChange(format(d, "yyyy-MM-dd"));
              setOpen(false);
            }}
            onHoje={() => {
              onChange(format(new Date(), "yyyy-MM-dd"));
              setOpen(false);
            }}
            onLimpar={
              limpavel
                ? () => {
                    onChange("");
                    setOpen(false);
                  }
                : undefined
            }
          />
        </PopoverContent>
      </Popover>
    );
  },
);
DatePicker.displayName = "DatePicker";
