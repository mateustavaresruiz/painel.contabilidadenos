import { Component, type ErrorInfo, type ReactNode } from "react";

import { LogoMark } from "@/components/logo";

type State = { error: Error | null };

/** Pega erro de render não tratado e mostra uma tela de recuperação. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
    // Chunk velho em cache depois de um deploy: recarrega uma vez.
    const msg = error.message || "";
    if (
      msg.includes("Failed to fetch dynamically imported module") ||
      msg.includes("Importing a module script failed")
    ) {
      const KEY = "denos-chunk-reload-at";
      const last = Number(sessionStorage.getItem(KEY) ?? "0");
      if (!last || Date.now() - last >= 30_000) {
        sessionStorage.setItem(KEY, String(Date.now()));
        window.location.reload();
      }
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="min-h-screen grid place-items-center bg-background p-6">
        <div className="max-w-md w-full text-center space-y-5">
          <LogoMark className="size-12 mx-auto" />
          <h1 className="text-2xl">Algo deu errado nesta tela.</h1>
          <p className="text-sm text-muted-foreground">
            Recarregue a página. Se continuar, mande a mensagem abaixo para quem cuida do painel.
          </p>
          {error.message ? (
            <pre className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-md p-3 text-left overflow-auto max-h-40 whitespace-pre-wrap">
              {error.message}
            </pre>
          ) : null}
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              Recarregar
            </button>
            <button
              type="button"
              onClick={() => {
                this.setState({ error: null });
                window.location.assign("/");
              }}
              className="inline-flex h-9 items-center rounded-md border px-4 text-sm"
            >
              Ir para o início
            </button>
          </div>
        </div>
      </div>
    );
  }
}
