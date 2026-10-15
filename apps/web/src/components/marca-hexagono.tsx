import { cn } from "@/lib/utils";

/**
 * O hexágono da NÓS como elemento de identidade. É sempre a própria imagem da
 * marca (`/favicon.png`), nunca um desenho refeito: muda só tamanho, opacidade
 * e giro. `aria-hidden` porque é decoração.
 */
export function HexagonoMarca({ className }: { className?: string }) {
  return (
    <img
      src="/favicon.png"
      alt=""
      aria-hidden
      draggable={false}
      className={cn("pointer-events-none select-none object-contain", className)}
    />
  );
}

/** Marca d'água: hexágono grande e quase transparente no canto do bloco (o pai precisa de `relative overflow-hidden`). */
export function MarcaDagua({ className }: { className?: string }) {
  return (
    <HexagonoMarca
      className={cn(
        "absolute -right-10 -top-12 size-56 rotate-12 opacity-[0.06] dark:opacity-[0.09] dark:brightness-[2.2] dark:saturate-50",
        className,
      )}
    />
  );
}

/** Tela de carregamento: a marca pulsando. */
export function CarregandoMarca({ className, rotulo = "Carregando" }: { className?: string; rotulo?: string }) {
  return (
    <div className={cn("grid place-items-center", className)} role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3">
        <HexagonoMarca className="size-14 animate-marca-pulso motion-reduce:animate-none dark:brightness-[2.2] dark:saturate-50" />
        <span className="sr-only">{rotulo}</span>
      </div>
    </div>
  );
}
