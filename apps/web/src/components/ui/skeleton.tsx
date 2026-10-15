import { cn } from "@/lib/utils";

/**
 * Placeholder de conteúdo enquanto carrega. Use no lugar de "Carregando…"
 * pra dar sensação de velocidade — a tela já tem o formato certo antes
 * dos dados chegarem.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-muted/60",
        className,
      )}
      {...props}
    />
  );
}

/** Skeleton de linha de texto. */
export function SkeletonText({
  lines = 1,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn("h-3.5", i === lines - 1 && lines > 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </div>
  );
}

/** Skeleton circular pra avatares. */
export function SkeletonAvatar({
  size = 40,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Skeleton
      className={cn("rounded-full shrink-0", className)}
      style={{ width: size, height: size }}
    />
  );
}

/** Skeleton de linha de tabela (várias células). */
export function SkeletonTableRow({ cols = 4 }: { cols?: number }) {
  return (
    <tr className="border-b border-border/60">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-3 py-2.5">
          <Skeleton className="h-4 w-full max-w-[180px]" />
        </td>
      ))}
    </tr>
  );
}

/**
 * Skeleton padrão pra telas de detalhe (cliente, processo). Ocupa o
 * espaço típico: header, dados, e dois blocos de conteúdo.
 */
export function DetalheSkeleton() {
  return (
    <div className="p-8 space-y-8 max-w-5xl animate-fade-up">
      <Skeleton className="h-4 w-20" />
      <div className="space-y-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-4 space-y-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-5 w-3/4" />
            <SkeletonText lines={2} />
          </div>
        ))}
      </div>
      <Skeleton className="h-48 w-full rounded-lg" />
    </div>
  );
}
