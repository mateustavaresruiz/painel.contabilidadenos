import { format, isValid, parse, parseISO } from "date-fns";
import { CalendarDays, X } from "lucide-react";
import { forwardRef, useEffect, useRef, useState } from "react";

import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  /** Avisa o formulário quando o texto digitado não é uma data válida (para barrar o envio). */
  onErroChange?: (erro: string | null) => void;
};

const ANO_MIN = 1900;
const ANO_MAX = 2100;

/** "dd/mm/aaaa" real (31/02 não vale, ano fora de 1900–2100 não vale) -> "AAAA-MM-DD". */
export function brParaIso(texto: string): string | null {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(texto)) return null;
  const d = parse(texto, "dd/MM/yyyy", new Date());
  if (!isValid(d) || d.getFullYear() < ANO_MIN || d.getFullYear() > ANO_MAX) return null;
  return format(d, "yyyy-MM-dd");
}

function isoParaBr(iso?: string): string {
  if (!iso) return "";
  const d = parseISO(iso);
  return isValid(d) ? format(d, "dd/MM/yyyy") : "";
}

function maskData(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 8);
  return d.replace(/^(\d{2})(\d)/, "$1/$2").replace(/^(\d{2})\/(\d{2})(\d)/, "$1/$2/$3");
}

/**
 * Campo de data do painel. Dá para DIGITAR dd/mm/aaaa (máscara, valida data
 * real) ou abrir o calendário (com mês e ano em lista, p. ex. aniversários).
 * Fala "AAAA-MM-DD" com o resto do código, então troca direto o
 * `<Input type="date">`. Funciona dentro de diálogo.
 */
export const DatePicker = forwardRef<HTMLInputElement, Props>(
  ({ value, onChange, placeholder = "dd/mm/aaaa", id, disabled, limpavel, className, onErroChange, ...resto }, ref) => {
    const [open, setOpen] = useState(false);
    const [texto, setTexto] = useState(() => isoParaBr(value));
    const [erro, setErro] = useState<string | null>(null);
    // Último valor que ESTE campo emitiu: se o pai mandar outro, é mudança externa.
    const emitido = useRef(value ?? "");

    useEffect(() => {
      if ((value ?? "") !== emitido.current) {
        emitido.current = value ?? "";
        setTexto(isoParaBr(value));
        setErro(null);
      }
    }, [value]);

    useEffect(() => {
      onErroChange?.(erro);
      return () => onErroChange?.(null);
    }, [erro, onErroChange]);

    function emitir(iso: string) {
      emitido.current = iso;
      onChange(iso);
    }

    function digitar(bruto: string) {
      const t = maskData(bruto);
      setTexto(t);
      if (t === "") {
        setErro(null);
        emitir("");
        return;
      }
      if (t.length < 10) {
        setErro(null);
        emitir("");
        return;
      }
      const iso = brParaIso(t);
      if (iso) {
        setErro(null);
        emitir(iso);
      } else {
        setErro("Data inválida");
        emitir("");
      }
    }

    const data = value ? parseISO(value) : undefined;
    const valida = !!data && isValid(data);
    const invalido = !!erro;

    return (
      <div>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverAnchor asChild>
            <div className="relative">
              <input
                ref={ref}
                id={id}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                disabled={disabled}
                placeholder={placeholder}
                value={texto}
                maxLength={10}
                aria-label={resto["aria-label"]}
                aria-invalid={invalido || undefined}
                onChange={(e) => digitar(e.target.value)}
                onBlur={() => {
                  if (texto !== "" && texto.length < 10) setErro("Data incompleta (dd/mm/aaaa)");
                }}
                className={cn(
                  "flex h-10 max-sm:h-11 w-full rounded-md border border-input bg-card py-1 pl-3 text-base tabular-nums md:text-sm",
                  "transition-colors placeholder:text-muted-foreground hover:border-foreground/20 disabled:cursor-not-allowed disabled:opacity-50",
                  valida && limpavel ? "pr-16" : "pr-10",
                  invalido && "border-destructive",
                  className,
                )}
              />
              <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                {(texto !== "" || valida) && limpavel && !disabled && (
                  <button
                    type="button"
                    onClick={() => {
                      setTexto("");
                      setErro(null);
                      emitir("");
                    }}
                    aria-label="Limpar data"
                    className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label="Abrir calendário"
                    className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                  >
                    <CalendarDays className="size-4" strokeWidth={1.5} />
                  </button>
                </PopoverTrigger>
              </div>
            </div>
          </PopoverAnchor>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              value={valida ? data : undefined}
              onSelect={(d) => {
                const iso = format(d, "yyyy-MM-dd");
                setTexto(isoParaBr(iso));
                setErro(null);
                emitir(iso);
                setOpen(false);
              }}
              onHoje={() => {
                const iso = format(new Date(), "yyyy-MM-dd");
                setTexto(isoParaBr(iso));
                setErro(null);
                emitir(iso);
                setOpen(false);
              }}
              onLimpar={
                limpavel
                  ? () => {
                      setTexto("");
                      setErro(null);
                      emitir("");
                      setOpen(false);
                    }
                  : undefined
              }
            />
          </PopoverContent>
        </Popover>
        {erro && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {erro}
          </p>
        )}
      </div>
    );
  },
);
DatePicker.displayName = "DatePicker";
