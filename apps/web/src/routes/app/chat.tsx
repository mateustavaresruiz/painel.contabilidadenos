import { MessageSquare } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ChatConversa } from "@/components/features/whatsapp/chat-conversa";
import { ChatSidebar } from "@/components/features/whatsapp/chat-sidebar";
import { InstanceFilterBar } from "@/components/features/whatsapp/instance-filter-bar";
import { CanalSemConfigurar } from "@/components/features/inbox/canal-sem-configurar";
import { InboxLoading } from "@/components/features/inbox/inbox-loading";
import { ResizableAside } from "@/components/ui/resizable-aside";
import { usePageTitle } from "@/hooks/use-page-title";
import { usePermissao } from "@/lib/colaborador";
import { cn } from "@/lib/utils";
import {
  useStableSessaoStatus,
  useSyncFotosPendentes,
  useWhatsappSessoes,
} from "@/lib/queries/whatsapp";

/**
 * Página /whatsapp — WhatsApp embutido. Suporta múltiplas instâncias.
 *
 * Querystring:
 *   ?instancias=id1,id2     — filtro multi-select (ausente = todas)
 *   ?instancia=<sessaoId>   — instância do chat ATIVO (qual conversa abriu)
 *   ?chat=<chatId>          — conversa aberta
 *
 * Default:
 *   - 0 sessões → redireciona pra Canais
 *   - 1 sessão  → usa essa, sem filtro
 *   - 2+ sessões → filtro "todas" (vazio) por padrão
 */
export function ChatPage() {
  usePageTitle("WhatsApp");
  // adv3: role === "owner". Aqui: quem gerencia os números.
  const ehDono = usePermissao("whatsapp.conexoes");
  const { data: sessoes = [], isLoading } = useWhatsappSessoes();
  // Status suavizado pra exibição — evita o pisca-pisca "Desconectado"
  // em quedas transitórias do WAHA. Filtros/ids seguem usando `sessoes`
  // cru (identidade não muda, só o status).
  const sessoesUI = useStableSessaoStatus(sessoes);
  const [params, setParams] = useSearchParams();

  // --- Filtro de instâncias (multi-select) ---------------------------
  // Lê do querystring "instancias=id1,id2"; vazio = todas.
  const instanciasFiltro = useMemo<string[]>(() => {
    const raw = params.get("instancias");
    if (!raw) return [];
    return raw.split(",").filter(Boolean);
  }, [params]);

  // Resolve sessões realmente ativas pro filtro (descarta IDs órfãos)
  const sessoesIdsValidas = useMemo(() => {
    const ids = new Set(sessoes.map((s) => s.id));
    return instanciasFiltro.filter((id) => ids.has(id));
  }, [instanciasFiltro, sessoes]);

  // O que mandar pro hook: lista vazia (= todas) ou ids selecionados
  // Memoizado: um array novo a cada render zerava o "carregar mais".
  const todasIds = useMemo(() => sessoes.map((s) => s.id), [sessoes]);
  const sessoesParaQuery = sessoesIdsValidas.length === 0
    ? todasIds // todas
    : sessoesIdsValidas;

  function aplicarFiltroInstancias(novas: string[]) {
    const next = new URLSearchParams(params);
    if (novas.length === 0 || novas.length === sessoes.length) {
      next.delete("instancias");
    } else {
      next.set("instancias", novas.join(","));
    }
    setParams(next, { replace: true });
  }

  // --- Chat selecionado (par sessaoId + chatId) ----------------------
  const chatIdSelecionado = params.get("chat") ?? undefined;
  const sessaoIdSelecionada = params.get("instancia") ?? undefined;
  // ?texto=... — texto pré-preenchido no campo (vem de Aniversários).
  const textoInicial = params.get("texto") ?? undefined;

  const selecionarChat = useCallback(
    (sessaoId: string, chatId: string) => {
      const next = new URLSearchParams(params);
      next.set("chat", chatId);
      next.set("instancia", sessaoId);
      next.delete("texto");
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  // Quando uma conversa é apagada pelo menu do sidebar, se ela
  // estava aberta à direita, limpa `?chat=` da URL pro painel
  // fechar — senão fica mostrando uma conversa que não existe mais.
  const aoApagarConversa = useCallback(
    (chatId: string) => {
      if (chatId !== chatIdSelecionado) return;
      const next = new URLSearchParams(params);
      next.delete("chat");
      next.delete("instancia");
      setParams(next, { replace: true });
    },
    [chatIdSelecionado, params, setParams],
  );

  // "← Voltar" (mobile) também limpa ?chat — senão tocar de novo na mesma
  // conversa não reabria.
  const fecharConversa = useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete("chat");
    next.delete("instancia");
    next.delete("texto");
    setParams(next, { replace: true });
  }, [params, setParams]);

  // --- Mobile (alterna lista/conversa) -------------------------------
  const [mobileView, setMobileView] = useState<"lista" | "conversa">("lista");
  useEffect(() => {
    setMobileView(chatIdSelecionado ? "conversa" : "lista");
  }, [chatIdSelecionado]);

  // Sync das fotos pendentes em background. Throttle de 1h via
  // localStorage — entra no chat 10x na mesma hora, só dispara uma vez.
  // Backend já é eficiente (query `WHERE fotoPath IS NULL` antes de
  // chamar WAHA — retorna rápido se não tem nada pendente), mas o
  // roundtrip ainda custa, e o throttle elimina mesmo isso.
  //
  // Quando o user passa de 1h sem entrar no chat, refaz pra pegar fotos
  // de chats novos que chegaram nesse meio tempo.
  const syncFotos = useSyncFotosPendentes();
  const syncDisparadoRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const AGORA = Date.now();
    const THROTTLE_MS = 60 * 60 * 1000; // 1h
    for (const s of sessoes) {
      if (syncDisparadoRef.current.has(s.id)) continue;
      if (s.status !== "WORKING") continue;
      const chaveLs = `sync-fotos-last:${s.id}`;
      const ultimo = Number.parseInt(
        localStorage.getItem(chaveLs) ?? "0",
        10,
      );
      if (AGORA - ultimo < THROTTLE_MS) {
        // Já rodou há menos de 1h — marca como disparado nessa sessão
        // pra não checar o localStorage de novo a cada re-render.
        syncDisparadoRef.current.add(s.id);
        continue;
      }
      syncDisparadoRef.current.add(s.id);
      localStorage.setItem(chaveLs, String(AGORA));
      syncFotos.mutate(s.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessoes.length]);

  // Anti-flash da tela de conectar: ao carregar, o status gravado de uma
  // sessão que ESTÁ conectando pode chegar momentaneamente ≠ WORKING e o
  // realtime/polling corrige logo em seguida. Só vale segurar uma janela
  // curta nesse caso — quando alguma sessão está em transição
  // (STARTING/SCAN_QR_CODE), que pode virar WORKING em segundos.
  //
  // Se todas as sessões estão paradas (ex.: STOPPED/FAILED), NÃO há o que
  // esperar: STOPPED não vira WORKING sozinho. Antes, a janela fixa de
  // 3,5s fazia QUALQUER um sem sessão ativa encarar 3,5s de spinner ao
  // abrir o /whatsapp. Agora cai direto na tela de canais.
  // Usa o status ESTABILIZADO (sessoesUI) pro gate da página — assim um
  // pisca transitório (ex.: restart do WAHA) não derruba a tela inteira
  // pra "conectar" e volta. `sessoes` cru fica só pra contagem/identidade.
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

  // Sem sessões — manda pra Canais. Owner cria nova.
  if (sessoes.length === 0) {
    return (
      <CanalSemConfigurar
        icone={MessageSquare}
        canal="WhatsApp"
        ehDono={ehDono}
      />
    );
  }

  // Pelo menos 1 sessão configurada — mas nenhuma conectada?
  // Pode ser só status defasado no carregamento (o valor gravado ainda
  // não propagou pra WORKING) — `aguardandoStatus` segura uma janela
  // curta enquanto o realtime/polling corrige, evitando o "flash" da
  // tela de conectar pra quem já está conectado. Esgotada a janela sem
  // nenhuma WORKING, aí sim mostra Canais (QR / status detalhado).
  if (!algumaConectada) {
    if (aguardandoStatus) return <InboxLoading variant="conversa" />;
    return (
      <CanalSemConfigurar
        icone={MessageSquare}
        canal="WhatsApp"
        ehDono={ehDono}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 overflow-hidden">
      <ResizableAside
        storageKey="whatsapp-chat-sidebar"
        defaultWidth={340}
        minWidth={300}
        maxWidth={560}
        collapsible
        className={cn(mobileView === "conversa" ? "hidden md:flex" : "flex")}
      >
        <InstanceFilterBar
          sessoes={sessoesUI}
          selecionadas={sessoesIdsValidas}
          onChange={aplicarFiltroInstancias}
          ehDono={ehDono}
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
        {chatIdSelecionado && (
          <button
            onClick={() => {
              setMobileView("lista");
              fecharConversa();
            }}
            className="md:hidden text-xs text-primary px-3 py-2 border-b text-left"
          >
            ← Voltar
          </button>
        )}
        <ChatConversa
          sessaoId={sessaoIdSelecionada}
          chatId={chatIdSelecionado}
          sessoes={sessoesUI}
          textoInicial={textoInicial}
        />
      </div>
    </div>
  );
}
