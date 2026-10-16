import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  setMonth,
  setYear,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

const DIAS_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];

const MESES = Array.from({ length: 12 }, (_, i) => {
  const nome = format(new Date(2024, i, 1), "LLLL", { locale: ptBR });
  return nome.charAt(0).toUpperCase() + nome.slice(1);
});
const ANO_MIN = 1900;
const ANO_MAX = 2100;
const ANOS = Array.from({ length: ANO_MAX - ANO_MIN + 1 }, (_, i) => ANO_MIN + i);
const SELECT_CLS =
  "h-9 cursor-pointer rounded-md border border-transparent bg-transparent px-1 text-sm font-semibold hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary [&>option]:bg-card [&>option]:text-foreground";

type Props = {
  /** Data selecionada (ou nenhuma). */
  value?: Date;
  /** Disparado ao clicar num dia. */
  onSelect?: (date: Date) => void;
  /** Atalho "Hoje" (some se não vier). */
  onHoje?: () => void;
  /** Atalho "Limpar" (some se não vier: campo obrigatório). */
  onLimpar?: () => void;
  /** Mês inicial; padrão = mês da seleção ou hoje. */
  defaultMonth?: Date;
  className?: string;
};

/**
 * Calendário do painel: mês a mês, semana começando no domingo, dias fora do
 * mês apagados, hoje com anel azul e o selecionado preenchido de azul.
 * Sem dependência além do date-fns.
 */
export function Calendar({ value, onSelect, onHoje, onLimpar, defaultMonth, className }: Props) {
  const [mesAtual, setMesAtual] = useState<Date>(() => startOfMonth(defaultMonth ?? value ?? new Date()));

  const inicio = startOfWeek(startOfMonth(mesAtual), { weekStartsOn: 0 });
  const fim = endOfWeek(endOfMonth(mesAtual), { weekStartsOn: 0 });
  const dias = eachDayOfInterval({ start: inicio, end: fim });

  return (
    <div className={cn("w-[296px] max-w-[calc(100vw-2rem)] p-3", className)}>
      <div className="flex items-center justify-between pb-2">
        <button
          type="button"
          onClick={() => setMesAtual((m) => addMonths(m, -1))}
          className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Mês anterior"
        >
          <ChevronLeft className="size-4" />
        </button>
        <div className="flex items-center gap-1">
          <select
            aria-label="Mês"
            value={mesAtual.getMonth()}
            onChange={(e) => setMesAtual((m) => setMonth(m, Number(e.target.value)))}
            className={SELECT_CLS}
          >
            {MESES.map((nome, i) => (
              <option key={nome} value={i}>
                {nome}
              </option>
            ))}
          </select>
          <select
            aria-label="Ano"
            value={mesAtual.getFullYear()}
            onChange={(e) => setMesAtual((m) => setYear(m, Number(e.target.value)))}
            className={SELECT_CLS}
          >
            {ANOS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => setMesAtual((m) => addMonths(m, 1))}
          className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Próximo mês"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="mb-1 grid grid-cols-7">
        {DIAS_SEMANA.map((d, i) => (
          <div key={i} className="py-1 text-center text-2xs font-semibold uppercase text-muted-foreground">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-y-0.5">
        {dias.map((dia) => {
          const noMes = isSameMonth(dia, mesAtual);
          const ehHoje = isToday(dia);
          const selecionado = value ? isSameDay(dia, value) : false;
          return (
            <button
              key={dia.toISOString()}
              type="button"
              onClick={() => onSelect?.(dia)}
              className={cn(
                "mx-auto grid size-10 place-items-center rounded-full text-sm tabular-nums transition-colors sm:size-9",
                "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                !noMes && "text-muted-foreground/40",
                ehHoje && !selecionado && "font-semibold text-primary ring-1 ring-primary/50",
                selecionado && "bg-primary font-semibold text-primary-foreground hover:bg-primary",
              )}
            >
              {dia.getDate()}
            </button>
          );
        })}
      </div>

      {(onHoje || onLimpar) && (
        <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-sm font-semibold">
          {onLimpar ? (
            <button type="button" onClick={onLimpar} className="rounded-md px-2 py-1.5 text-muted-foreground hover:bg-accent">
              Limpar
            </button>
          ) : (
            <span />
          )}
          {onHoje && (
            <button type="button" onClick={onHoje} className="rounded-md px-2 py-1.5 text-primary hover:bg-accent">
              Hoje
            </button>
          )}
        </div>
      )}
    </div>
  );
}
