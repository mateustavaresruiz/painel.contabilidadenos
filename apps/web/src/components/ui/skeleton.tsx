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
        // Tinta a 6%: aparece tanto no canvas (cartão) quanto no parchment
        // (fundo da página). O bg-muted sumia no fundo, que já é parchment.
        "animate-skeleton rounded-md bg-foreground/[0.06]",
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
 * Página ainda baixando (chunk): cabeçalho padrão, barra de filtros e uma
 * lista, no mesmo ritmo das páginas de verdade (p-4 sm:p-6 lg:p-8, gap 24).
 */
export function PaginaSkeleton() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6" aria-busy="true" aria-label="Carregando">
      <div className="flex items-center gap-4">
        <Skeleton className="size-7 rounded-full" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
      </div>
      <Skeleton className="h-14 w-full rounded-card" />
      <div className="rounded-card border border-border bg-card divide-y divide-divider">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-6 py-4">
            <SkeletonAvatar size={32} />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Skeleton padrão pra telas de detalhe (cliente, processo). Ocupa o
 * espaço típico: header, dados, e dois blocos de conteúdo.
 */
export function DetalheSkeleton() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-8 max-w-5xl">
      <Skeleton className="h-4 w-20" />
      <div className="space-y-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-card border bg-card p-6 space-y-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-5 w-3/4" />
            <SkeletonText lines={2} />
          </div>
        ))}
      </div>
      <Skeleton className="h-48 w-full rounded-card" />
    </div>
  );
}

/** Lista dentro de cartão (linhas separadas por divider), com ou sem avatar. */
export function ListaSkeleton({
  linhas = 4,
  avatar = false,
  className,
}: {
  linhas?: number;
  avatar?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn("rounded-card border border-border bg-card divide-y divide-divider", className)}
      aria-busy="true"
      aria-label="Carregando"
    >
      {Array.from({ length: linhas }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-4">
          {avatar && <SkeletonAvatar size={32} />}
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5" style={{ width: `${45 - (i % 3) * 8}%` }} />
            <Skeleton className="h-3" style={{ width: `${30 + (i % 2) * 15}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Lista de conversas do WhatsApp: avatar redondo + nome + prévia. */
export function ConversasSkeleton({ linhas = 8 }: { linhas?: number }) {
  return (
    <div aria-busy="true" aria-label="Carregando conversas">
      {Array.from({ length: linhas }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-3">
          <SkeletonAvatar size={44} />
          <div className="flex-1 space-y-2">
            <div className="flex justify-between gap-3">
              <Skeleton className="h-3.5" style={{ width: `${40 + (i % 3) * 10}%` }} />
              <Skeleton className="h-3 w-8" />
            </div>
            <Skeleton className="h-3" style={{ width: `${55 + (i % 2) * 20}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Mensagens de uma conversa: balões alternando lados. */
export function MensagensSkeleton() {
  const baloes = [
    { meu: false, w: 52 },
    { meu: false, w: 34 },
    { meu: true, w: 46 },
    { meu: false, w: 60 },
    { meu: true, w: 28 },
    { meu: true, w: 50 },
  ];
  return (
    <div className="flex flex-col gap-2 px-4 py-6" aria-busy="true" aria-label="Carregando mensagens">
      {baloes.map((b, i) => (
        <Skeleton
          key={i}
          className={cn("h-10 rounded-card", b.meu ? "self-end" : "self-start")}
          style={{ width: `${b.w}%` }}
        />
      ))}
    </div>
  );
}
