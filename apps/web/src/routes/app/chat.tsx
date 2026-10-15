import { MessageSquare } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { CanalSemConfigurar } from "@/components/features/inbox/canal-sem-configurar";
import { InboxLoading } from "@/components/features/inbox/inbox-loading";
import { ChatConversa } from "@/components/features/whatsapp/chat-conversa";
import { ChatSidebar } from "@/components/features/whatsapp/chat-sidebar";
import { InstanceFilterBar } from "@/components/features/whatsapp/instance-filter-bar";
import { ResizableAside } from "@/components/ui/resizable-aside";
import { usePageTitle } from "@/hooks/use-page-title";
import {
  useStableSessaoStatus,
  useSyncFotosPendentes,
  useWhatsappSessoes,
} from "@/lib/queries/whatsapp";
import { cn } from "@/lib/utils";

/**
 * /whatsapp — o WhatsApp do escritório (inbox do adv3). Várias instâncias.
 *
 * Querystring:
 *   ?instancias=id1,id2     — filtro multi-select (ausente = todas)
 *   ?instancia=<sessaoId>   — instância da conversa ABERTA
 *   ?chat=<chatId>          — conversa aberta
 *   ?texto=...              — texto pré-preenchido no campo (Aniversários)
 */
export function ChatPage() {
  usePageTitle("WhatsApp");
  const { data: sessoes = [], isLoading } = useWhatsappSessoes();
  // Status suavizado pra exibição (evita o pisca "Desconectado" em quedas
  // de 1-2 s do WAHA). Ids/filtros seguem o cru.
  const sessoesUI = useStableSessaoStatus(sessoes);
  const [params, setParams] = useSearchParams();

  const instanciasFiltro = useMemo<string[]>(() => {
    const raw = params.get("instancias");
    return raw ? raw.split(",").filter(Boolean) : [];
  }, [params]);

  const sessoesIdsValidas = useMemo(() => {
    const ids = new Set(sessoes.map((s) => s.id));
    return instanciasFiltro.filter((id) => ids.has(id));
  }, [instanciasFiltro, sessoes]);

  // 🔴 Memoizado: um array novo a cada render zerava o "carregar mais" da
  // lista (defeito 7 do adv3).
  const todasIds = useMemo(() => sessoes.map((s) => s.id), [sessoes]);
  const sessoesParaQuery = sessoesIdsValidas.length === 0 ? todasIds : sessoesIdsValidas;

  function aplicarFiltroInstancias(novas: string[]) {
    const next = new URLSearchParams(params);
    if (novas.length === 0 || novas.length === sessoes.length) next.delete("instancias");
    else next.set("instancias", novas.join(","));
    setParams(next, { replace: true });
  }

  const chatIdSelecionado = params.get("chat") ?? undefined;
  const sessaoIdSelecionada = params.get("instancia") ?? undefined;
  const textoInicial = params.get("texto") ?? undefined;

  const selecionarChat = useCallback(
    (sessaoId: string, chatId: string) => {
      setParams(
        (curr) => {
          const next = new URLSearchParams(curr);
          next.set("chat", chatId);
          next.set("instancia", sessaoId);
          next.delete("texto");
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // Fechar a conversa limpa ?chat — no mobile o "Voltar" do adv3 não limpava,
  // e tocar de novo na mesma conversa não abria (defeito 8).
  const fecharConversa = useCallback(() => {
    setParams(
      (curr) => {
        const next = new URLSearchParams(curr);
        next.delete("chat");
        next.delete("instancia");
        next.delete("texto");
        return next;
      },
      { replace: true },
    );
  }, [setParams]);

  const aoApagarConversa = useCallback(
    (chatId: string) => {
      if (chatId === chatIdSelecionado) fecharConversa();
    },
    [chatIdSelecionado, fecharConversa],
  );

  const mobileView: "lista" | "conversa" = chatIdSelecionado ? "conversa" : "lista";

  // Fotos que faltam: uma passada por instância, no máximo 1x por hora.
  const syncFotos = useSyncFotosPendentes();
  const syncDisparadoRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const agora = Date.now();
    for (const s of sessoes) {
      if (syncDisparadoRef.current.has(s.id) || s.status !== "WORKING") continue;
      syncDisparadoRef.current.add(s.id);
      const chave = `sync-fotos-last:${s.id}`;
      let ultimo = 0;
      try {
        ultimo = Number.parseInt(localStorage.getItem(chave) ?? "0", 10);
      } catch {
        /* sem storage */
      }
      if (agora - ultimo < 60 * 60 * 1000) continue;
      try {
        localStorage.setItem(chave, String(agora));
      } catch {
        /* sem storage */
      }
      syncFotos.mutate(s.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessoes.length]);

  // Anti-flash: sessão em transição pode virar WORKING em segundos.
  const algumaConectada = sessoesUI.some((s) => s.status === "WORKING");
  const algumaEmTransicao = sessoesUI.some(
    (s) => s.status === "STARTING" || s.status === "SCAN_QR_CODE",
  );
  const [aguardandoStatus, setAguardandoStatus] = useState(true);
  useEffect(() => {
    if (algumaConectada || !algumaEmTransicao) {
      setAguardandoStatus(false);
      return;
    }
    setAguardandoStatus(true);
    const t = setTimeout(() => setAguardandoStatus(false), 1500);
    return () => clearTimeout(t);
  }, [algumaConectada, algumaEmTransicao]);

  if (isLoading) return <InboxLoading variant="conversa" />;

  if (sessoes.length === 0) {
    return <CanalSemConfigurar icone={MessageSquare} canal="WhatsApp" motivo="sem-instancia" />;
  }
  if (!algumaConectada) {
    if (aguardandoStatus) return <InboxLoading variant="conversa" />;
    return <CanalSemConfigurar icone={MessageSquare} canal="WhatsApp" motivo="desconectada" />;
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 overflow-hidden">
      <ResizableAside
        storageKey="whatsapp-chat-sidebar"
        defaultWidth={360}
        minWidth={300}
        maxWidth={560}
        className={cn(mobileView === "conversa" ? "hidden md:flex" : "flex")}
      >
        <InstanceFilterBar
          sessoes={sessoesUI}
          selecionadas={sessoesIdsValidas}
          onChange={aplicarFiltroInstancias}
        />
        <ChatSidebar
          sessoesIds={sessoesParaQuery}
          sessoes={sessoesUI}
          chatIdSelecionado={chatIdSelecionado}
          sessaoIdSelecionada={sessaoIdSelecionada}
          onSelecionar={selecionarChat}
          onApagado={aoApagarConversa}
        />
      </ResizableAside>

      <div
        className={cn(
          "flex-1 min-w-0 min-h-0 flex-col",
          mobileView === "lista" ? "hidden md:flex" : "flex",
        )}
      >
        <ChatConversa
          sessaoId={sessaoIdSelecionada}
          chatId={chatIdSelecionado}
          sessoes={sessoesUI}
          onVoltar={fecharConversa}
          textoInicial={textoInicial}
        />
      </div>
    </div>
  );
}
