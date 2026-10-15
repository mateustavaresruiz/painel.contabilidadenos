import { type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Estado vazio padrão. Use quando uma lista volta sem itens — em vez de
 * "Nenhum X aqui." em texto cru. Aceita um ícone, título, descrição
 * curta e CTA opcional. Visual alinhado ao tema claro/minimalista
 * (borda dashed sutil, ícone verde, título sans).
 */
type Props = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** Variante "card" usa borda dashed; "plain" só centraliza o conteúdo. */
  variant?: "card" | "plain";
  className?: string;
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  variant = "card",
  className,
}: Props) {
  return (
    <div
      className={cn(
        "text-center space-y-4 relative overflow-hidden",
        variant === "card"
          ? "rounded-card border border-border bg-card py-14 px-6"
          : "py-8",
        className,
      )}
    >
      {Icon ? (
        <Icon className="mx-auto size-8 text-muted-foreground" />
      ) : null}

      <div className="relative space-y-1.5">
        <h3 className="text-title-md">{title}</h3>
        {description ? (
          <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
            {description}
          </p>
        ) : null}
      </div>

      {action ? <div className="relative pt-2">{action}</div> : null}
    </div>
  );
}
