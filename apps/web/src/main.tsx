import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App";
import { ErrorBoundary } from "./components/error-boundary";
import { ThemedToaster } from "./components/themed-toaster";
import { ConfirmDialogProvider } from "./components/ui/confirm-dialog";
import { MediaViewerProvider } from "./components/ui/media-viewer";
import { ColaboradorProvider } from "./lib/colaborador";
import { msgErro } from "./lib/erro";
import { bootTheme } from "./lib/theme";
import { toast } from "./lib/toast";
import "@fontsource-variable/plus-jakarta-sans";
import "./index.css";

bootTheme();

/**
 * Deploy novo renomeia os chunks: quem estava com a aba aberta tenta baixar
 * um chunk que não existe mais. Recarrega uma vez (com trava de 30 s pra não
 * entrar em loop se o chunk sumiu de verdade).
 */
const RELOAD_KEY = "denos-chunk-reload-at";
function reloadOnce() {
  const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? "0");
  if (last && Date.now() - last < 30_000) return;
  sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  window.location.reload();
}
window.addEventListener("vite:preloadError", () => reloadOnce());

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    // Sem isto, erro de carregamento parece lista vazia. Só avisa quando
    // ainda não há dado na tela, e queries com `meta.silencioso` tratam o
    // erro na própria página (ex.: rota do Serpro ainda não publicada).
    onError: (error, query) => {
      if (query.state.data !== undefined) return;
      if (query.meta?.silencioso) return;
      toast.error("Não foi possível carregar os dados.", {
        id: `query-error-${query.queryHash}`,
        description: msgErro(error).slice(0, 140),
        action: { label: "Tentar de novo", onClick: () => query.fetch() },
      });
    },
  }),
  defaultOptions: {
    queries: {
      retry: 1,
      // O Realtime invalida o que muda; o refetch na reconexão cobre os
      // eventos perdidos durante uma queda de rede.
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      staleTime: 60_000,
      gcTime: 15 * 60_000,
    },
    mutations: { retry: 0 },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ColaboradorProvider>
            <App />
          </ColaboradorProvider>
          <MediaViewerProvider />
          <ConfirmDialogProvider />
          <ThemedToaster />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
