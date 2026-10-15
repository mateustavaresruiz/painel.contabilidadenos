import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/**
 * Contêiner único das páginas do painel: fluido até 1600px, centralizado,
 * com o respiro padrão (16 celular / 24 tablet / 32 desktop). Toda página
 * usa este componente em vez de definir max-w/padding por conta própria.
 */
export function PageContainer({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mx-auto w-full max-w-[1600px] min-w-0 p-4 sm:p-6 lg:p-8 space-y-6", className)} {...props} />;
}
