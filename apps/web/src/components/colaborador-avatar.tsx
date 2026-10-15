import { UserRound } from "lucide-react";
import type { CSSProperties } from "react";

import { iniciaisDeContato } from "@/lib/iniciais";
import { cn } from "@/lib/utils";

type Size = "2xs" | "xs" | "sm" | "md" | "lg";

const sizes: Record<Size, string> = {
  "2xs": "size-[18px] text-[8px]",
  xs: "size-6 text-[10px]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-14 text-base",
};

/**
 * Iniciais do colaborador no círculo da cor dele (suave: fundo claro, letra na cor). Substitui o UserAvatar do
 * adv3 (lá havia foto; aqui não há login nem upload de foto).
 */
export function ColaboradorAvatar({
  nome,
  cor,
  size = "sm",
  className,
  title,
}: {
  nome: string | null | undefined;
  cor: string | null | undefined;
  size?: Size;
  className?: string;
  title?: string;
}) {
  const ini = iniciaisDeContato(nome);
  return (
    <span
      className={cn(
        "avatar-cor inline-flex items-center justify-center rounded-full shrink-0 select-none font-semibold",
        sizes[size],
        className,
      )}
      style={{ "--av-c": cor || "#64748b" } as CSSProperties}
      title={title ?? nome ?? undefined}
      aria-label={nome ?? "Sem responsável"}
    >
      {ini ?? <UserRound className="size-[60%]" />}
    </span>
  );
}

/** Círculo tracejado = conversa sem responsável. */
export function SemResponsavelAvatar({
  size = "sm",
  className,
}: {
  size?: Size;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full shrink-0 border border-dashed border-muted-foreground/50 text-muted-foreground bg-card",
        sizes[size],
        className,
      )}
      title="Sem responsável"
      aria-label="Sem responsável"
    >
      <UserRound className="size-[60%]" />
    </span>
  );
}
