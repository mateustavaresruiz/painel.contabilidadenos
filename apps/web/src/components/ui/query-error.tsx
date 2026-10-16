import { AlertTriangle, RefreshCw, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { msgErro } from "@/lib/erro";
import { cn } from "@/lib/utils";

type Props = {
  /** Erro do react-query (`error`). */
  error?: unknown;
  /** Normalmente o `refetch` da query. */
  onRetry?: () => unknown;
  /** O que não carregou, em minúsculas ("os chamados"). */
  oque?: string;
  /** Uma linha, do tamanho de um campo (selects de filtro/diálogo). */
  compacto?: boolean;
  className?: string;
};

/**
 * Erro de carregamento de lista/campo. Existe para a falha NÃO parecer lista
 * vazia: toda tela mostra isto no lugar do estado vazio quando a query falhou.
 */
export function QueryError({ error, onRetry, oque, compacto, className }: Props) {
  const offline = useOffline();
  const titulo = offline ? "Você está sem conexão" : oque ? `Não foi possível carregar ${oque}` : "Não foi possível carregar";
  const detalhe = error ? msgErro(error, "") : "";
  if (compacto) {
    return (
      <div
        role="alert"
        className={cn(
          "flex h-10 max-sm:h-11 w-full items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 text-sm",
          className,
        )}
      >
        <span className="min-w-0 truncate text-destructive">{titulo}</span>
        {onRetry && (
          <button
            type="button"
            onClick={() => void onRetry()}
            className="shrink-0 rounded px-1.5 py-0.5 font-semibold text-primary hover:bg-accent"
          >
            Tentar de novo
          </button>
        )}
      </div>
    );
  }
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-card border border-destructive/30 bg-destructive/5 px-6 py-10 text-center",
        className,
      )}
    >
      <span className="grid size-11 place-items-center rounded-full bg-destructive/10 text-destructive">
        {offline ? <WifiOff className="size-5" /> : <AlertTriangle className="size-5" />}
      </span>
      <div className="space-y-1">
        <p className="text-title-md font-semibold">{titulo}</p>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          {detalhe && detalhe !== "Algo deu errado. Tente novamente." ? detalhe : "Verifique a conexão e tente de novo."}
        </p>
      </div>
      {onRetry && (
        <Button variant="outline" onClick={() => void onRetry()}>
          <RefreshCw />
          Tentar de novo
        </Button>
      )}
    </div>
  );
}

/** true quando o navegador diz que está sem rede. */
export function useOffline(): boolean {
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);
  useEffect(() => {
    const off = () => setOffline(true);
    const on = () => setOffline(false);
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    return () => {
      window.removeEventListener("offline", off);
      window.removeEventListener("online", on);
    };
  }, []);
  return offline;
}

/** Faixa global discreta no topo do painel enquanto estiver sem rede. */
export function OfflineBanner() {
  const offline = useOffline();
  if (!offline) return null;
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-warning/15 px-3 py-1.5 text-center text-xs font-semibold text-foreground"
    >
      <WifiOff className="size-3.5 shrink-0" />
      Sem conexão. O que você vê pode estar desatualizado.
    </div>
  );
}
