import { Skeleton, SkeletonAvatar, SkeletonText } from "@/components/ui/skeleton";

/**
 * Skeleton padronizado da Caixa de entrada. Usado enquanto a sessão
 * (WhatsApp) ou a conta (Gmail) estão sendo carregadas. Mostra o
 * formato esperado da tela — sidebar de threads/chats + área da
 * conversa — pra reduzir a sensação de "tela em branco".
 */
export function InboxLoading({
  variant = "conversa",
}: {
  variant?: "conversa" | "lista";
}) {
  return (
    <div className="flex h-full min-h-0 w-full animate-route-fade">
      {/* Sidebar lista */}
      <aside className="w-full md:w-80 md:shrink-0 border-r flex flex-col bg-card/30">
        <div className="p-3 border-b space-y-2">
          <Skeleton className="h-9 w-full" />
          <div className="flex gap-1">
            <Skeleton className="h-6 w-16 rounded-full" />
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="flex items-start gap-3 px-3 py-2.5 border-b border-border/40"
            >
              <SkeletonAvatar size={36} />
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-2.5 w-10" />
                </div>
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* Conversa */}
      {variant === "conversa" && (
        <div className="hidden md:flex flex-1 min-w-0 flex-col">
          <div className="h-14 shrink-0 border-b flex items-center gap-3 px-4 bg-card/40">
            <SkeletonAvatar size={36} />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-2.5 w-24" />
            </div>
          </div>
          <div className="flex-1 p-5 space-y-3 bg-muted/10">
            <SkeletonText lines={2} className="max-w-[60%]" />
            <SkeletonText lines={3} className="max-w-[70%] ml-auto" />
            <SkeletonText lines={2} className="max-w-[55%]" />
          </div>
        </div>
      )}
    </div>
  );
}
