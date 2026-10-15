import { AlertCircle, CheckCircle2, type LucideIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * UI compartilhado das seções de Conexões do Escritório (WhatsApp + E-mail).
 * Padroniza o card de cada conta/instância: tile de ícone, título, pill de
 * status, caixa de identidade, caixa de erro e linha de ações. Cada módulo
 * mantém suas diferenças (ícone, accent, ações e conteúdo expandido).
 */

export type ConexaoTone = "online" | "offline" | "warning" | "erro";

export type ConexaoStatus = {
  label: string;
  tone: ConexaoTone;
};

const ICON_TONE = {
  primary: "bg-primary/10 text-primary",
  bronze: "bg-foreground/[0.06] text-foreground",
} as const;

export function StatusPill({ status }: { status: ConexaoStatus }) {
  const toneClass = {
    online:
      "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 dark:text-emerald-400",
    offline: "bg-muted text-muted-foreground border-border",
    warning: "bg-muted text-foreground border-border",
    erro: "bg-destructive/15 text-destructive border-destructive/30",
  }[status.tone];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-medium shrink-0",
        toneClass,
      )}
    >
      {status.tone === "online" ? (
        <CheckCircle2 className="size-3" />
      ) : (
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            status.tone === "offline" && "bg-muted-foreground/50",
            status.tone === "warning" && "bg-foreground",
            status.tone === "erro" && "bg-destructive",
          )}
        />
      )}
      {status.label}
    </span>
  );
}

export function ConexaoCard({
  icon: Icon,
  iconTone = "primary",
  avatar,
  titulo,
  subtitulo,
  status,
  identidadeLabel = "Conta conectada",
  identidade,
  erro,
  children,
  expandido,
}: {
  icon: LucideIcon;
  iconTone?: keyof typeof ICON_TONE;
  /** Substitui o ícone (ex.: foto da instância de WhatsApp). */
  avatar?: React.ReactNode;
  titulo: string;
  subtitulo?: string | null;
  status: ConexaoStatus;
  identidadeLabel?: string;
  identidade?: string | null;
  erro?: string | null;
  /** Linha de ações (botões). */
  children?: React.ReactNode;
  /** Conteúdo expansível abaixo do card (ex.: formulário de edição). */
  expandido?: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div className="flex items-start gap-3 min-w-0">
          {avatar ?? (
            <div
              className={cn(
                "grid place-items-center size-10 rounded-lg shrink-0",
                ICON_TONE[iconTone],
              )}
            >
              <Icon className="size-5" />
            </div>
          )}
          <div className="min-w-0">
            <CardTitle className="text-base truncate">{titulo}</CardTitle>
            {subtitulo ? (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {subtitulo}
              </p>
            ) : null}
          </div>
        </div>
        <StatusPill status={status} />
      </CardHeader>

      <CardContent className="space-y-3">
        {identidade ? (
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <p className="text-2xs text-muted-foreground uppercase tracking-wide">
              {identidadeLabel}
            </p>
            <p className="font-medium mt-0.5 break-all">{identidade}</p>
          </div>
        ) : null}

        {erro ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive flex items-start gap-2">
            <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
            <span className="break-words">{erro}</span>
          </div>
        ) : null}

        {children ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">{children}</div>
        ) : null}

        {expandido ? (
          <div className="border-t -mx-6 px-6 pt-4 mt-1 bg-muted/20">
            {expandido}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
