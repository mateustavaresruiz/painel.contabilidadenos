import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { ComponentType, ReactNode } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Uma listagem, dois formatos: tabela no desktop, cards no celular.
 *
 * O `<Table>` deste app já rola na horizontal quando não cabe — e scroll
 * horizontal é o pior desfecho possível numa tela de 375px: some com metade
 * das colunas sem avisar que sumiram. Card de largura cheia mostra o que
 * importa e esconde o resto de propósito.
 *
 * Cards e NÃO grid de 2 colunas: num viewport de 375px, meia largura dá
 * ~170px por cartão — não cabe nome + documento + contato sem truncar os
 * três. Grid continua certo pra conteúdo visual (pasta, foto), não pra
 * registro de dado.
 *
 * O padrão é uma extração do que a tela de Equipe já fazia à mão desde
 * sempre; aqui ele vira uma peça só, com alvo de toque e seleção resolvidos
 * no mesmo lugar.
 */

/** Até qual largura mostrar cards. Tabela de 6+ colunas quer `lg`. */
type Corte = "md" | "lg";

/* Classes completas em literal: o Tailwind varre o texto do arquivo e não
   resolve `md:${x}` montado em runtime. */
const CORTE_CARDS: Record<Corte, string> = {
  md: "md:hidden",
  lg: "lg:hidden",
};
const CORTE_TABELA: Record<Corte, string> = {
  md: "hidden md:block",
  lg: "hidden lg:block",
};

export function ListaResponsiva({
  corte = "md",
  tabela,
  children,
  className,
  classeTabela = "rounded-2xl border border-border/60 bg-card",
  selecionarTodos,
}: {
  corte?: Corte;
  /** A tabela de hoje, intocada. Só deixa de aparecer abaixo do corte. */
  tabela: ReactNode;
  /** Os `<ItemCard>` — o que aparece no celular. */
  children: ReactNode;
  className?: string;
  /** Moldura da tabela. Existe pra cada tela manter a borda que já tinha —
      esta peça é sobre o celular, não é hora de repintar o desktop. */
  classeTabela?: string;
  /** Só pra lista com seleção: o "selecionar todos" mora no CABEÇALHO da
      tabela, que não existe no modo card. Sem isto, converter uma listagem
      tira do celular uma ação que o desktop tem. */
  selecionarTodos?: {
    marcados: boolean;
    parcial?: boolean;
    onToggle: () => void;
  };
}) {
  return (
    <div className={className}>
      <div className={CORTE_CARDS[corte]}>
        {selecionarTodos ? (
          <label className="mb-2 flex w-fit cursor-pointer items-center gap-2 py-1 text-xs text-muted-foreground">
            <Checkbox
              checked={selecionarTodos.marcados}
              indeterminate={selecionarTodos.parcial}
              onChange={selecionarTodos.onToggle}
            />
            Selecionar todos
          </label>
        ) : null}
        <ul className="space-y-2">{children}</ul>
      </div>
      <div className={cn(CORTE_TABELA[corte], "rounded-card border border-border bg-card", classeTabela)}>
        {tabela}
      </div>
    </div>
  );
}

export type ItemMeta = {
  icone?: ComponentType<{ className?: string }>;
  texto: ReactNode;
  /** Destaca (prazo estourado, valor negativo). */
  alerta?: boolean;
};

export function ItemCard({
  to,
  onClick,
  titulo,
  subtitulo,
  selo,
  meta,
  acoes,
  selecionado,
  onSelecionar,
  rotuloSelecao,
}: {
  /** Destino do toque no card. Use `onClick` quando não for navegação. */
  to?: string;
  onClick?: () => void;
  titulo: ReactNode;
  subtitulo?: ReactNode;
  /** Canto superior direito — status, tipo, valor. */
  selo?: ReactNode;
  /** Rodapé de contexto. Itens vazios são descartados. */
  meta?: (ItemMeta | null | false | undefined)[];
  /** Barra inferior de botões. Fica ACIMA do alvo do card. */
  acoes?: ReactNode;
  selecionado?: boolean;
  onSelecionar?: () => void;
  rotuloSelecao?: string;
}) {
  const metas = (meta ?? []).filter(Boolean) as ItemMeta[];

  /* "Stretched link": o alvo de toque é o card inteiro (via ::after), mas o
     elemento interativo continua sendo UM link só. Envolver o card todo num
     <a> aninharia o checkbox e os botões dentro dele — inválido, e no leitor
     de tela vira um alvo só, sem nome. Quem precisa continuar clicável sobe
     com `relative z-10`. */
  const alvo = cn(
    "min-w-0 flex-1 text-left",
    (to || onClick) &&
      "after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-1 focus-visible:after:ring-ring",
  );

  const miolo = (
    <>
      <p className="font-medium text-sm truncate">{titulo}</p>
      {subtitulo ? (
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {subtitulo}
        </p>
      ) : null}
    </>
  );

  return (
    <li
      className={cn(
        "relative rounded-xl border border-border/60 bg-card transition-colors",
        (to || onClick) && "active:bg-muted/40",
        selecionado && "border-primary/50 bg-primary/[0.04]",
      )}
    >
      <div className="flex items-start gap-3 p-3">
        {onSelecionar ? (
          <div className="relative z-10 pt-0.5">
            <Checkbox
              checked={!!selecionado}
              onChange={onSelecionar}
              aria-label={rotuloSelecao ?? "Selecionar item"}
            />
          </div>
        ) : null}

        {to ? (
          <Link to={to} className={alvo}>
            {miolo}
          </Link>
        ) : onClick ? (
          <button type="button" onClick={onClick} className={alvo}>
            {miolo}
          </button>
        ) : (
          <div className="min-w-0 flex-1">{miolo}</div>
        )}

        <div className="shrink-0 flex items-center gap-1.5">
          {selo}
          {to || onClick ? (
            <ChevronRight className="size-4 text-muted-foreground/50" />
          ) : null}
        </div>
      </div>

      {metas.length > 0 ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 px-3 pb-3 text-xs text-muted-foreground">
          {metas.map((m, i) => (
            <span
              key={i}
              className={cn(
                "inline-flex items-center gap-1 min-w-0",
                m.alerta && "text-foreground font-medium",
              )}
            >
              {m.icone ? <m.icone className="size-3 shrink-0" /> : null}
              <span className="truncate">{m.texto}</span>
            </span>
          ))}
        </div>
      ) : null}

      {acoes ? (
        <div className="relative z-10 flex items-center gap-1 border-t border-border/60 px-2 py-1.5">
          {acoes}
        </div>
      ) : null}
    </li>
  );
}

/** Esqueleto do card — o `SkeletonTableRow` vive dentro da tabela e por
 *  isso não aparece no celular, onde a tabela está escondida. */
export function ItemCardSkeleton() {
  return (
    <li className="rounded-xl border border-border/60 bg-card p-3 space-y-2">
      <Skeleton className="h-4 w-2/5" />
      <Skeleton className="h-3 w-3/5" />
      <Skeleton className="h-3 w-1/4" />
    </li>
  );
}
