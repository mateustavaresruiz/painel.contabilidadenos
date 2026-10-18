import { SlidersHorizontal, X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useFadeRolagem } from "@/hooks/use-fade-rolagem";
import { useTelaCompacta } from "@/hooks/use-media-query";

export type FiltroAtivo = {
  /** Identificador estável (chave da lista). */
  id: string;
  /** O que aparece no chip (ex.: "Status: Concluído"). */
  rotulo: string;
  /** Tira só este filtro. */
  onRemover: () => void;
};

/**
 * Filtros de lista que não roubam a primeira tela do celular.
 *
 * Desktop/tablet: os campos ficam onde sempre ficaram (`antes` e `children`
 * dentro de `className`). Celular (em pé ou deitado): uma linha só com o botão
 * "Filtros" (abre os mesmos campos numa folha de baixo) e um chip por filtro
 * ativo, que tira aquele filtro no toque. `antes` fica sempre à vista (ex.: a
 * busca), acima dessa linha.
 */
export function FiltrosResponsivos({
  children,
  ativos,
  onLimpar,
  className,
  antes,
  depois,
  titulo = "Filtros",
}: {
  children: ReactNode;
  ativos: FiltroAtivo[];
  onLimpar?: () => void;
  /** Classe do contêiner dos campos no desktop. */
  className?: string;
  /** Sempre à vista, também no celular (ex.: campo de busca). */
  antes?: ReactNode;
  /** Sempre à vista, depois dos campos (ex.: contagem e exportar). */
  depois?: ReactNode;
  titulo?: string;
}) {
  const compacta = useTelaCompacta();
  const [aberto, setAberto] = useState(false);
  const fade = useFadeRolagem<HTMLDivElement>(ativos.length);

  if (!compacta) {
    return (
      <div className={className}>
        {antes}
        {children}
        {depois}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {antes}
      <div ref={fade} className="-mx-1 flex items-center gap-2 overflow-x-auto scrollbar-none px-1 py-0.5">
        <Button
          type="button"
          variant="outline"
          onClick={() => setAberto(true)}
          className="h-11 shrink-0 gap-2 rounded-full px-4"
          aria-haspopup="dialog"
        >
          <SlidersHorizontal className="size-4" />
          {titulo}
          {ativos.length > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-2xs font-bold text-primary-foreground">
              {ativos.length}
            </span>
          )}
        </Button>
        {ativos.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={a.onRemover}
            className="inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-primary/30 bg-primary/5 pl-3.5 pr-2.5 text-xs font-medium text-foreground transition-colors active:bg-primary/10"
            aria-label={`Tirar filtro ${a.rotulo}`}
          >
            {a.rotulo}
            <X className="size-3.5 text-muted-foreground" />
          </button>
        ))}
      </div>

      {depois}

      <Sheet open={aberto} onOpenChange={setAberto}>
        <SheetContent side="bottom" className="bg-card">
          <SheetHeader className="pt-1">
            <SheetTitle>{titulo}</SheetTitle>
            <SheetDescription className="sr-only">Escolha os filtros da lista.</SheetDescription>
          </SheetHeader>
          <SheetBody>
            <div className="grid grid-cols-1 gap-3">{children}</div>
          </SheetBody>
          <SheetFooter>
            {onLimpar && (
              <Button
                type="button"
                variant="outline"
                className="h-11"
                disabled={ativos.length === 0}
                onClick={onLimpar}
              >
                Limpar
              </Button>
            )}
            <Button type="button" className="h-11 flex-1" onClick={() => setAberto(false)}>
              Ver resultados
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
