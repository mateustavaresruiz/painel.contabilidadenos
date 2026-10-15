import type { LucideIcon } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { MarcaDagua } from "@/components/marca-hexagono";
import { corModulo, type CorModulo } from "@/lib/cores-modulo";

type Props = {
  /** Ícone do módulo, o mesmo do menu. Aceita qualquer componente com `className`. */
  icon: LucideIcon | ComponentType<{ className?: string }>;
  /** @deprecated não é mais renderizado. */
  eyebrow?: string;
  title: ReactNode;
  /** Uma linha curta abaixo do título. */
  description?: ReactNode;
  /** Ação principal (e secundárias) à direita; no celular desce para baixo do título. */
  actions?: ReactNode;
  /** Cor do módulo do ícone. Sem ela, sai do caminho da página. */
  cor?: CorModulo;
  /** Conteúdo acima do título (ex.: link "Voltar"). */
  topo?: ReactNode;
  /** Ícone traz a própria moldura (sem o quadrado colorido). */
  iconePlano?: boolean;
};

const POR_CAMINHO: [string, CorModulo][] = [
  ["/whatsapp", "whatsapp"],
  ["/chamados", "chamados"],
  ["/clientes", "clientes"],
  ["/certificados", "certificados"],
  ["/pendencias-fiscais", "fiscal"],
  ["/equipe", "equipe"],
  ["/configuracoes", "config"],
];

export function corDoCaminho(pathname: string): CorModulo {
  return POR_CAMINHO.find(([p]) => pathname === p || pathname.startsWith(p + "/"))?.[1] ?? "inicio";
}

/**
 * Cabeçalho padrão de toda página do painel: quadrado do ícone na cor do
 * módulo, título 28/700, descrição de uma linha, ação principal à direita e o
 * hexágono da marca bem apagado no canto. No celular empilha.
 */
export function PageHeader({ icon: Icon, title, description, actions, cor, topo, iconePlano = false }: Props) {
  const { pathname } = useLocation();
  const c = cor ?? corDoCaminho(pathname);
  return (
    <header
      className="relative -mx-4 -mt-4 overflow-hidden border-b border-border/70 px-4 pb-5 pt-4 sm:-mx-6 sm:-mt-6 sm:px-6 sm:pt-6 lg:-mx-8 lg:-mt-8 lg:px-8 lg:pt-8"
      style={corModulo(c)}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,transparent_55%,color-mix(in_srgb,var(--mc)_7%,transparent))]"
      />
      <MarcaDagua />
      <div className="relative space-y-2">
        {topo}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-3.5 sm:gap-4">
            {iconePlano ? (
              <Icon className="size-12 shrink-0" />
            ) : (
              <span className="chip-mod grid size-11 shrink-0 place-items-center rounded-xl sm:size-12">
                <Icon className="size-[22px]" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[22px] font-bold leading-tight tracking-[-0.015em] sm:text-[28px]">{title}</h1>
              {description ? (
                <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground sm:line-clamp-1">{description}</p>
              ) : null}
            </div>
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div> : null}
        </div>
      </div>
    </header>
  );
}
