import { Sparkles, type LucideIcon } from "lucide-react";
import { useLocation } from "react-router-dom";

import { corDoCaminho } from "@/components/page-header";
import { corModulo, type CorModulo } from "@/lib/cores-modulo";
import { cn } from "@/lib/utils";

/**
 * Estado vazio padrão do painel. Ilustração sempre no mesmo estilo: o ícone
 * do assunto num círculo tingido da cor do módulo, um halo mais claro em
 * volta e dois satélites pequenos (ícones lucide, sem desenho à mão). Texto
 * curto e simpático e, quando houver, a ação principal.
 */
type Props = {
  icon?: LucideIcon;
  /** Ícone(s) pequenos ao redor; padrão: brilho. */
  satelites?: LucideIcon[];
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** "card" tem moldura; "plain" só centraliza. */
  variant?: "card" | "plain";
  /** Cor do módulo; sem ela, sai do caminho da página. */
  cor?: CorModulo;
  className?: string;
};

export function EmptyState({ icon: Icon, satelites, title, description, action, variant = "card", cor, className }: Props) {
  const { pathname } = useLocation();
  const [S1, S2] = satelites?.length ? [satelites[0], satelites[1] ?? satelites[0]] : [Sparkles, Sparkles];
  return (
    <div
      className={cn(
        "relative overflow-hidden text-center",
        variant === "card" ? "rounded-card border border-border bg-card px-6 py-12 shadow-card" : "py-8",
        className,
      )}
      style={corModulo(cor ?? corDoCaminho(pathname))}
    >
      {Icon ? <IlustracaoVazia icon={Icon} s1={S1} s2={S2} /> : null}
      <div className="relative mt-5 space-y-1.5">
        <h3 className="text-title-md font-semibold">{title}</h3>
        {description ? (
          <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground [text-wrap:pretty]">{description}</p>
        ) : null}
      </div>
      {action ? <div className="relative pt-5">{action}</div> : null}
    </div>
  );
}

/** A ilustração sozinha (para estados vazios que não usam o cartão). */
export function IlustracaoVazia({
  icon: Icon,
  s1: S1 = Sparkles,
  s2: S2 = Sparkles,
  className,
}: {
  icon: LucideIcon;
  s1?: LucideIcon;
  s2?: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cn("relative mx-auto size-28", className)} aria-hidden>
      <span className="absolute inset-0 rounded-full bg-[color-mix(in_srgb,var(--mc)_7%,transparent)]" />
      <span className="absolute inset-3 grid place-items-center rounded-full bg-[color-mix(in_srgb,var(--mc)_14%,transparent)] text-[var(--mc)]">
        <Icon className="size-9" strokeWidth={1.75} />
      </span>
      <span className="absolute -right-1 top-2 grid size-8 place-items-center rounded-full border border-border bg-card text-[var(--mc)] shadow-card">
        <S1 className="size-4" />
      </span>
      <span className="absolute -left-2 bottom-3 grid size-7 place-items-center rounded-full border border-border bg-card text-[var(--mc)] shadow-card">
        <S2 className="size-3.5" />
      </span>
    </div>
  );
}
