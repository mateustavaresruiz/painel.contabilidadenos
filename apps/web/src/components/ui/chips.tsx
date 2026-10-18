import { useFadeRolagem } from "@/hooks/use-fade-rolagem";
import { cn } from "@/lib/utils";

/**
 * Chips de filtro (DESIGN.md): pílula com borda hairline; o selecionado ganha
 * a borda de 2px no azul de foco. A borda grossa é um anel interno, então
 * trocar a seleção não mexe na largura (nada pula na linha). No celular a
 * fileira rola de lado em vez de quebrar: a borda esmaece onde ainda há chip
 * escondido e o selecionado rola para dentro da vista.
 */
export function Chips<T extends string>({
  opcoes,
  valor,
  onChange,
  rotulo,
  className,
}: {
  opcoes: readonly { valor: T; rotulo: string }[];
  valor: T;
  onChange: (v: T) => void;
  /** Nome do grupo para leitor de tela (ex.: "Período"). */
  rotulo: string;
  className?: string;
}) {
  const fade = useFadeRolagem<HTMLDivElement>(valor);
  return (
    <div
      ref={fade}
      role="radiogroup"
      aria-label={rotulo}
      className={cn("flex max-w-full gap-2 overflow-x-auto scrollbar-none -mx-1 px-1 py-0.5", className)}
    >
      {opcoes.map((o) => {
        const ativo = o.valor === valor;
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={ativo}
            onClick={() => onChange(o.valor)}
            className={cn(
              "h-8 max-lg:h-10 toque:h-11 shrink-0 whitespace-nowrap rounded-full border bg-card px-3.5 text-xs",
              "transition-[color,box-shadow,border-color,transform] duration-150 ease-brand active:scale-[.97]",
              ativo
                ? "border-transparent font-semibold text-foreground shadow-[inset_0_0_0_2px_var(--primary-focus)]"
                : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/20",
            )}
          >
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}
