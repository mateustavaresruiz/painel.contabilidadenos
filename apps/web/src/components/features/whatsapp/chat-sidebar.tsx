import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Archive,
  ArchiveRestore,
  CheckCheck,
  CheckSquare,
  Download,
  Eraser,
  FileText,
  Image as ImageIcon,
  Inbox,
  Loader2,
  Mic,
  MoreVertical,
  PinIcon,
  Search,
  Trash2,
  Users,
  Video,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/lib/toast";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { confirmar } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { ConversasSkeleton } from "@/components/ui/skeleton";
import { useDebounced } from "@/hooks/use-debounced";
import {
  ColaboradorAvatar,
  SemResponsavelAvatar,
} from "@/components/colaborador-avatar";
import { useColaboradoresMap, useEu, type Colaborador } from "@/lib/colaborador";
import { TagsDaConversa } from "@/components/features/whatsapp/conversa-tags";
import { msgErro } from "@/lib/erro";
import { parsePgTimestamp } from "@/lib/format";
import { avatarFicticio } from "@/lib/avatar-ficticio";
import { cn } from "@/lib/utils";
import {
  mediaSignedUrl,
  useApagarChat,
  useApagarChatsEmLote,
  preCarregarMensagens,
  useArquivarChat,
  useFixarChat,
  useLimparChat,
  PAGINA_CHATS,
  useWhatsappChats,
  useWhatsappContatos,
  type WhatsappChat,
  type WhatsappContatosMap,
  type WhatsappSessao,
} from "@/lib/queries/whatsapp";
import { coletarMencaoIds, substituirMencoes } from "@/lib/whatsapp-mencoes";

import {
  CHIPS_FILTRO,
  CHIPS_RESPONSAVEL,
  ChatFilterChips,
  type FiltroChip,
  type FiltroResponsavel,
} from "./chat-filter-chips";
import { DownloadConversaDialog } from "./download-conversa-dialog";

type Props = {
  /** Sessões filtradas — multi-instância. Array vazio = todas. */
  sessoesIds: string[];
  /** Mapa sessaoId → sessão (pra pills de instância nos itens). */
  sessoes: WhatsappSessao[];
  chatIdSelecionado: string | undefined;
  sessaoIdSelecionada: string | undefined;
  onSelecionar: (sessaoId: string, chatId: string) => void;
  /** Callback quando uma conversa é apagada via menu do sidebar.
   *  Parent usa pra fechar o painel da direita se a conversa
   *  apagada estava aberta. */
  onApagado?: (chatId: string) => void;
};

/**
 * Sidebar de conversas com busca e chips de filtro. Fixadas vão pro
 * topo; o resto fica numa lista única ordenada pelo backend (timestamp
 * desc). Quando o filtro de instância tem 2+ sessões, mostra pill da
 * instância em cada item pra deixar claro de onde veio.
 */
export function ChatSidebar({
  sessoesIds,
  sessoes,
  chatIdSelecionado,
  sessaoIdSelecionada,
  onSelecionar,
  onApagado,
}: Props) {
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<FiltroChip>("todas");
  const { euId } = useEu();
  const colaboradores = useColaboradoresMap();
  // Começa em "Todas": no primeiro dia ninguém tem conversa atribuída, e uma
  // caixa "Minhas" vazia pareceria defeito.
  const [filtroResp, setFiltroResp] = useState<FiltroResponsavel>("todas");
  // 300ms é o sweet spot: rápido o bastante pra parecer responsivo,
  // longo o bastante pra não disparar query a cada tecla.
  const buscaDebounced = useDebounced(busca, 200);

  // Traduz chip → filtros pro hook
  const filtros = useMemo(() => {
    return {
      q: buscaDebounced,
      tipo: filtro === "grupos" ? ("group" as const) : undefined,
      vinculo: filtro === "clientes" ? ("com" as const) : undefined,
      atendimentoStatus:
        filtro === "abertas"
          ? ("aberto" as const)
          : filtro === "em_atendimento"
            ? ("em_atendimento" as const)
            : filtro === "finalizadas"
              ? ("finalizado" as const)
              : undefined,
      responsavel:
        filtroResp === "sem"
          ? "sem"
          : filtroResp === "minhas"
            ? (euId ?? "00000000-0000-0000-0000-000000000000")
            : undefined,
      // A aba "Arquivadas" mostra só as arquivadas; as outras abas
      // mostram só as não-arquivadas (comportamento estilo WhatsApp).
      arquivados: filtro === "arquivadas",
    };
  }, [buscaDebounced, filtro, filtroResp, euId]);

  // Teto da lista, que cresce a pedido. Volta ao tamanho de uma página
  // sempre que o filtro ou a instância muda: senão trocar de aba já entraria
  // pedindo 300 conversas que ninguém vai rolar.
  // A dependência é a CHAVE ordenada das sessões, não o array: o array é novo
  // a cada render do pai e zerava o "carregar mais" (defeito 7 do adv3).
  const sessoesKey = [...sessoesIds].sort().join(",");
  const [limite, setLimite] = useState(PAGINA_CHATS);
  useEffect(() => {
    setLimite(PAGINA_CHATS);
  }, [filtros, sessoesKey]);

  const {
    data: chats = [],
    isLoading,
    isFetching,
  } = useWhatsappChats(sessoesIds, filtros, limite);

  // A busca não pagina (vai ao banco com o termo), então o botão só aparece
  // fora dela — e só quando a página veio cheia, que é o sinal de que há mais.
  const temMaisChats = !filtros.q?.trim() && chats.length >= limite;
  const carregarMaisChats = useCallback(
    () => setLimite((n) => n + PAGINA_CHATS),
    [],
  );

  // Modo seleção: selecionar várias conversas e apagar de uma vez. A chave é
  // composta (sessaoId:chatId) porque a mesma conversa pode existir em
  // instâncias diferentes (multi-sessão).
  const [modoSelecao, setModoSelecao] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const apagarLote = useApagarChatsEmLote();

  const sairSelecao = useCallback(() => {
    setModoSelecao(false);
    setSelecionados(new Set());
  }, []);

  // Seleção não sobrevive a troca de filtro/busca: senão dava pra apagar
  // conversa que já não estava na tela (defeito 60 do adv3).
  useEffect(() => {
    setSelecionados(new Set());
  }, [filtros, sessoesKey]);

  const toggleSelecao = useCallback((chave: string) => {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(chave)) next.delete(chave);
      else next.add(chave);
      return next;
    });
  }, []);

  async function apagarSelecionadas() {
    if (selecionados.size === 0) return;
    if (
      !(await confirmar({
        titulo: `Apagar ${selecionados.size} conversa(s)?`,
        descricao:
          "Remove as conversas selecionadas, todas as mensagens e os vínculos com clientes. Tenta apagar também no WhatsApp do número conectado. Sem desfazer.",
        destructive: true,
        confirmLabel: "Apagar selecionadas",
      }))
    )
      return;
    const alvos = [...selecionados].map((chave) => {
      const [sessaoId, ...resto] = chave.split(":");
      return { sessaoId, chatId: resto.join(":") };
    });
    // Se alguma conversa aberta estava no lote, fecha o painel da direita.
    for (const a of alvos) onApagado?.(a.chatId);
    sairSelecao();
    try {
      const { falhas, total } = await apagarLote.mutateAsync(alvos);
      if (falhas > 0) {
        toast.warning(
          `${total - falhas} apagada(s); ${falhas} falhou/falharam.`,
        );
      } else {
        toast.success(`${total} conversa(s) apagada(s).`);
      }
    } catch (err) {
      toast.error(msgErro(err));
    }
  }

  // Menções `@<lid>` nos previews → resolve pra nome/telefone (mesmo
  // mecanismo do balão). Coleta os ids só dos previews visíveis.
  const mencaoIds = useMemo(
    () => coletarMencaoIds(chats.map((c) => c.ultimaMensagemTexto)),
    [chats],
  );
  const { data: mencaoMap } = useWhatsappContatos(mencaoIds);

  // Mapa de sessão por id (pra pill de instância)
  const sessoesMap = useMemo(() => {
    const m = new Map<string, WhatsappSessao>();
    for (const s of sessoes) m.set(s.id, s);
    return m;
  }, [sessoes]);

  // Mostra pill de instância apenas quando lista mistura 2+ instâncias
  // — se filtrado pra 1 só, é redundante.
  const mostraPillInstancia = useMemo(() => {
    const set = new Set(chats.map((c) => c.sessaoId));
    return set.size > 1;
  }, [chats]);

  // Fixadas vão pro topo (quebram a ordem cronológica); o resto vem
  // do backend já ordenado por timestamp desc. Sem agrupamento por
  // data — fluxo único, estilo WhatsApp.
  const { fixadas, demais } = useMemo(() => {
    const fixadas: WhatsappChat[] = [];
    const demais: WhatsappChat[] = [];
    for (const c of chats) {
      if (c.fixado) fixadas.push(c);
      else demais.push(c);
    }
    return { fixadas, demais };
  }, [chats]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-card/30">
      {/* Header: busca + botão de selecionar */}
      <div className="px-3 pt-2 shrink-0 flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar conversa ou número…"
            className="pl-8 h-9 bg-card/80"
          />
        </div>
        {/* O modo seleção só existe pra apagar em lote: sem direito de apagar,
            ele não teria nenhuma ação no fim. */}
        {chats.length > 0 && (
          <Tooltip label="Selecionar conversas" side="bottom">
            <button
              type="button"
              onClick={() => setModoSelecao(true)}
              className={cn(
                "shrink-0 grid place-items-center size-9 rounded-md border border-border/60 bg-card/80 text-muted-foreground transition-colors hover:text-foreground hover:bg-accent",
                modoSelecao && "border-primary/40 bg-primary/10 text-primary",
              )}
              aria-label="Selecionar conversas"
              aria-pressed={modoSelecao}
            >
              <CheckSquare className="size-4" />
            </button>
          </Tooltip>
        )}
      </div>

      {/* Chips de filtro: responsável (novo) + status/tipo */}
      <div className="shrink-0">
        <ChatFilterChips
          chips={CHIPS_RESPONSAVEL}
          ativo={filtroResp}
          onChange={setFiltroResp}
          className="pb-0"
        />
        <ChatFilterChips chips={CHIPS_FILTRO} ativo={filtro} onChange={setFiltro} />
      </div>

      {/* Barra de ações do modo seleção */}
      {modoSelecao && (
        <div className="shrink-0 flex items-center gap-3 px-3 py-2 border-y border-border bg-primary/5">
          <button
            type="button"
            onClick={sairSelecao}
            className="grid place-items-center size-7 rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Cancelar seleção"
          >
            <X className="size-4" />
          </button>
          <span className="flex-1 text-sm font-medium">
            {selecionados.size > 0
              ? `${selecionados.size} selecionada${selecionados.size === 1 ? "" : "s"}`
              : "Selecionar conversas"}
          </span>
          <button
            type="button"
            onClick={apagarSelecionadas}
            disabled={selecionados.size === 0 || apagarLote.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {apagarLote.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
            Apagar
          </button>
        </div>
      )}

      {/* Lista de conversas — fixadas não virtualizadas (geralmente <10
          + sticky header), demais virtualizadas pra suportar 1000+
          conversas sem perder FPS no scroll. */}
      <ListaConversas
        isLoading={isLoading}
        chats={chats}
        fixadas={fixadas}
        demais={demais}
        sessoesMap={sessoesMap}
        colaboradores={colaboradores}
        mencaoMap={mencaoMap}
        mostraPillInstancia={mostraPillInstancia}
        chatIdSelecionado={chatIdSelecionado}
        sessaoIdSelecionada={sessaoIdSelecionada}
        onSelecionar={onSelecionar}
        onApagado={onApagado}
        busca={busca}
        filtro={filtro}
        modoSelecao={modoSelecao}
        selecionados={selecionados}
        onToggleSelecao={toggleSelecao}
        temMais={temMaisChats}
        carregandoMais={isFetching}
        onCarregarMais={carregarMaisChats}
      />
    </div>
  );
}

function ListaConversas({
  isLoading,
  chats,
  fixadas,
  demais,
  sessoesMap,
  colaboradores,
  mencaoMap,
  mostraPillInstancia,
  chatIdSelecionado,
  sessaoIdSelecionada,
  onSelecionar,
  onApagado,
  busca,
  filtro,
  modoSelecao,
  selecionados,
  onToggleSelecao,
  temMais,
  carregandoMais,
  onCarregarMais,
}: {
  isLoading: boolean;
  chats: WhatsappChat[];
  fixadas: WhatsappChat[];
  demais: WhatsappChat[];
  sessoesMap: Map<string, WhatsappSessao>;
  colaboradores: Map<string, Colaborador>;
  mencaoMap: WhatsappContatosMap | undefined;
  mostraPillInstancia: boolean;
  chatIdSelecionado: string | undefined;
  sessaoIdSelecionada: string | undefined;
  onSelecionar: (sessaoId: string, chatId: string) => void;
  onApagado?: (chatId: string) => void;
  busca: string;
  filtro: FiltroChip;
  modoSelecao: boolean;
  selecionados: Set<string>;
  onToggleSelecao: (chave: string) => void;
  temMais: boolean;
  carregandoMais: boolean;
  onCarregarMais: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // O bloco das fixadas fica FORA do virtualizador, então os itens virtuais
  // começam depois dele: sem o scrollMargin, com muitas fixadas as linhas
  // apareciam em branco ao rolar (defeito do adv3).
  const listaRef = useRef<HTMLDivElement>(null);
  const [margem, setMargem] = useState(0);
  useEffect(() => {
    setMargem(listaRef.current?.offsetTop ?? 0);
  }, [fixadas.length, isLoading]);
  const virtualizer = useVirtualizer({
    count: demais.length,
    getScrollElement: () => scrollRef.current,
    scrollMargin: margem,
    // Item de chat tem altura ~64-72px (avatar + 2 linhas + meta).
    estimateSize: () => 68,
    overscan: 6,
    getItemKey: (i) => {
      const c = demais[i];
      return c ? `${c.sessaoId}:${c.id}` : i;
    },
  });
  const itensVirtuais = virtualizer.getVirtualItems();

  return (
    <div
      ref={scrollRef}
      className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
    >
      {isLoading ? (
        <ConversasSkeleton />
      ) : chats.length === 0 ? (
        <EmptyState busca={busca} filtro={filtro} />
      ) : (
        <div className="pb-2" role="list">
          {fixadas.length > 0 && (
            <div className="px-3 pt-3 pb-1 sticky top-0 bg-card/70 backdrop-blur-sm z-[1]">
              <p className="text-[9.5px] uppercase tracking-[0.18em] font-semibold text-muted-foreground/70 flex items-center gap-1.5">
                <PinIcon className="size-2.5 text-bronze" />
                Fixadas
                <span className="text-muted-foreground/50 normal-case tracking-normal font-normal">
                  ({fixadas.length})
                </span>
              </p>
            </div>
          )}
          {fixadas.map((c) => (
            <ChatItem
              key={`${c.sessaoId}:${c.id}`}
              chat={c}
              sessao={sessoesMap.get(c.sessaoId)}
              responsavel={c.responsavelId ? colaboradores.get(c.responsavelId) : undefined}
              mencaoMap={mencaoMap}
              mostraPillInstancia={mostraPillInstancia}
              ativo={
                c.chatId === chatIdSelecionado &&
                c.sessaoId === sessaoIdSelecionada
              }
              onSelecionar={onSelecionar}
              onApagado={onApagado}
              modoSelecao={modoSelecao}
              selecionado={selecionados.has(`${c.sessaoId}:${c.chatId}`)}
              onToggleSelecao={onToggleSelecao}
            />
          ))}
          {/* Wrapper de altura total pros itens virtualizados */}
          <div
            ref={listaRef}
            style={{ height: virtualizer.getTotalSize(), position: "relative" }}
          >
            {itensVirtuais.map((vItem) => {
              const c = demais[vItem.index];
              if (!c) return null;
              return (
                <div
                  key={vItem.key}
                  data-index={vItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    transform: `translateY(${vItem.start - margem}px)`,
                  }}
                >
                  <ChatItem
                    chat={c}
                    sessao={sessoesMap.get(c.sessaoId)}
                    responsavel={c.responsavelId ? colaboradores.get(c.responsavelId) : undefined}
                    mencaoMap={mencaoMap}
                    mostraPillInstancia={mostraPillInstancia}
                    ativo={
                      c.chatId === chatIdSelecionado &&
                      c.sessaoId === sessaoIdSelecionada
                    }
                    onSelecionar={onSelecionar}
                    onApagado={onApagado}
                    modoSelecao={modoSelecao}
                    selecionado={selecionados.has(`${c.sessaoId}:${c.chatId}`)}
                    onToggleSelecao={onToggleSelecao}
                  />
                </div>
              );
            })}
          </div>
          {temMais && (
            <div className="px-3 py-3 text-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={onCarregarMais}
                disabled={carregandoMais}
                className="text-xs text-muted-foreground"
              >
                {carregandoMais ? (
                  <Loader2 className="size-3.5 animate-spin mr-1.5" />
                ) : null}
                Carregar mais conversas
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState({ busca, filtro }: { busca: string; filtro: FiltroChip }) {
  let titulo: string;
  let descricao: string;
  if (busca) {
    titulo = "Nada bate com a busca";
    descricao = "Tente outro nome ou número.";
  } else if (filtro === "grupos") {
    titulo = "Nenhum grupo";
    descricao = "Grupos do WhatsApp aparecem aqui quando recebem mensagens.";
  } else if (filtro === "clientes") {
    titulo = "Nenhuma conversa vinculada";
    descricao = "Vincule conversas a clientes pra organizar o atendimento.";
  } else if (filtro === "em_atendimento") {
    titulo = "Nada em atendimento";
    descricao = "Conversas assumidas por alguém aparecem aqui.";
  } else if (filtro === "finalizadas") {
    titulo = "Nenhuma finalizada";
    descricao = "Use \"Finalizar atendimento\" no topo da conversa.";
  } else if (filtro === "abertas") {
    titulo = "Nenhuma conversa aberta";
    descricao = "Conversas que ainda esperam alguém assumir aparecem aqui.";
  } else if (filtro === "arquivadas") {
    titulo = "Nenhuma conversa arquivada";
    descricao =
      "Arquive uma conversa pelo menu (⋮) pra tirá-la da lista sem apagar.";
  } else {
    titulo = "Caixa vazia";
    descricao = "As conversas aparecem assim que chegam mensagens.";
  }
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-16 text-muted-foreground">
      <div className="relative mb-4">
        <div className="size-14 rounded-full bg-bronze/10 grid place-items-center">
          {filtro === "arquivadas" ? (
            <Archive className="size-6 text-bronze/60" />
          ) : (
            <Inbox className="size-6 text-bronze/60" />
          )}
        </div>
      </div>
      <p className="text-sm font-medium text-foreground/80 font-serif">{titulo}</p>
      <p className="text-xs mt-1 max-w-[220px] leading-relaxed">
        {descricao}
      </p>
    </div>
  );
}

// Memoizado: callback é estável (useCallback no parent) e os fields
// que importam só mudam no refetch.
const ChatItem = memo(function ChatItemImpl({
  chat,
  sessao,
  responsavel,
  mencaoMap,
  mostraPillInstancia,
  ativo,
  onSelecionar,
  onApagado,
  modoSelecao,
  selecionado,
  onToggleSelecao,
}: {
  chat: WhatsappChat;
  sessao: WhatsappSessao | undefined;
  responsavel: Colaborador | undefined;
  mencaoMap: WhatsappContatosMap | undefined;
  mostraPillInstancia: boolean;
  ativo: boolean;
  onSelecionar: (sessaoId: string, chatId: string) => void;
  onApagado?: (chatId: string) => void;
  modoSelecao: boolean;
  selecionado: boolean;
  onToggleSelecao: (chave: string) => void;
}) {
  // No modo seleção, clicar na linha alterna o checkbox em vez de abrir.
  const onClick = useCallback(() => {
    if (modoSelecao) {
      onToggleSelecao(`${chat.sessaoId}:${chat.chatId}`);
      return;
    }
    onSelecionar(chat.sessaoId, chat.chatId);
  }, [modoSelecao, onToggleSelecao, onSelecionar, chat.sessaoId, chat.chatId]);
  // Pré-carga das mensagens com intenção de hover (120 ms parado em cima):
  // passar o mouse pela lista não dispara uma enxurrada de requests, mas a
  // conversa em que a pessoa vai clicar já abre pronta, sem skeleton.
  const qc = useQueryClient();
  const hoverRef = useRef<number | null>(null);
  const aoEntrar = useCallback(() => {
    if (modoSelecao) return;
    hoverRef.current = window.setTimeout(() => {
      void preCarregarMensagens(qc, chat.sessaoId, chat.chatId);
    }, 120);
  }, [qc, modoSelecao, chat.sessaoId, chat.chatId]);
  const aoSair = useCallback(() => {
    if (hoverRef.current) window.clearTimeout(hoverRef.current);
    hoverRef.current = null;
  }, []);
  useEffect(() => aoSair, [aoSair]);
  // Fallback do nome quando o grupo ainda não teve o subject capturado
  // pelo refresh-profile — mostra um sufixo do chatId pra diferenciar
  // grupos distintos. Usa os ÚLTIMOS 5 dígitos (não os primeiros)
  // porque todo chatId de grupo começa com "120363..." — prefixo
  // comum a todos, então slice(0,5) deixava todos iguais.
  const nome =
    chat.nome ??
    (chat.tipo === "group"
      ? `Grupo · ${chat.chatId.replace("@g.us", "").slice(-5)}`
      : formatPhone(chat.chatId.replace("@c.us", "")));
  const hora = chat.ultimaMensagemEm
    ? formatChatTime(chat.ultimaMensagemEm)
    : "";
  const preview = previewLimpo(
    substituirMencoes(chat.ultimaMensagemTexto, mencaoMap),
  );

  const limpar = useLimparChat(chat.sessaoId);
  const apagar = useApagarChat(chat.sessaoId);
  const fixar = useFixarChat();
  const arquivar = useArquivarChat();
  const [menuOpen, setMenuOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);

  async function handleFixar(e: React.MouseEvent) {
    e.stopPropagation();
    setMenuOpen(false);
    try {
      await fixar.mutateAsync({ chatRowId: chat.id, fixado: !chat.fixado });
      toast.success(chat.fixado ? "Conversa desafixada." : "Conversa fixada.");
    } catch (err) {
      toast.error(msgErro(err));
    }
  }

  async function handleArquivar(e: React.MouseEvent) {
    e.stopPropagation();
    setMenuOpen(false);
    try {
      await arquivar.mutateAsync({
        chatRowId: chat.id,
        arquivado: !chat.arquivado,
      });
      toast.success(
        chat.arquivado ? "Conversa desarquivada." : "Conversa arquivada.",
      );
      // Some da lista atual (arquivou → sai das abas normais; desarquivou
      // → sai da aba Arquivadas). Se estava aberta, fecha o painel.
      onApagado?.(chat.chatId);
    } catch (err) {
      toast.error(msgErro(err));
    }
  }

  async function handleLimpar(e: React.MouseEvent) {
    e.stopPropagation();
    setMenuOpen(false);
    if (
      !(await confirmar({
        titulo: "Limpar mensagens?",
        descricao:
          "Apaga as mensagens desta conversa do banco e tenta limpar no WhatsApp também. A conversa permanece na lista.",
        destructive: true,
        confirmLabel: "Limpar mensagens",
      }))
    )
      return;
    try {
      await limpar.mutateAsync(chat.chatId);
      toast.success("Mensagens apagadas.");
    } catch (err) {
      toast.error(msgErro(err));
    }
  }

  async function handleApagar(e: React.MouseEvent) {
    e.stopPropagation();
    setMenuOpen(false);
    if (
      !(await confirmar({
        titulo: "Apagar conversa?",
        descricao:
          "Remove a conversa, todas as mensagens e o vínculo com cliente. Tenta apagar também no WhatsApp do número conectado.",
        destructive: true,
        confirmLabel: "Apagar conversa",
      }))
    )
      return;
    try {
      await apagar.mutateAsync(chat.chatId);
      toast.success("Conversa apagada.");
      // Se a conversa apagada estava aberta à direita, avisa o parent
      // pra limpar `?chat=...` da URL — senão o painel fica mostrando
      // uma conversa fantasma até o usuário clicar em outra.
      onApagado?.(chat.chatId);
    } catch (err) {
      toast.error(msgErro(err));
    }
  }

  const temCliente = chat.clienteId !== null;
  const naoLidas = chat.naoLidas ?? 0;

  return (
    <div
      role="listitem"
      className={cn(
        "relative transition-colors mx-2 my-0.5 rounded-lg",
        selecionado
          ? "bg-primary/10 ring-1 ring-primary/30"
          : ativo
            ? "bg-accent shadow-sm"
            : "hover:bg-accent/40",
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onPointerEnter={aoEntrar}
        onPointerLeave={aoSair}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        className={cn(
          "w-full flex items-start gap-3 px-2.5 py-2.5 text-left cursor-pointer",
          modoSelecao ? "pr-3" : "pr-9",
        )}
      >
        {modoSelecao && (
          <Checkbox
            checked={selecionado}
            readOnly
            // O clique na linha já alterna; o checkbox é só visual/acessível.
            tabIndex={-1}
            className="self-center shrink-0 pointer-events-none size-[18px]"
          />
        )}
        <span className="relative shrink-0">
          <ChatAvatar
            semente={chat.chatId}
            grupo={chat.tipo === "group"}
            fotoPath={chat.fotoPath}
            ringCliente={temCliente}
          />
          {/* Responsável pelo atendimento, no canto do avatar. */}
          <span className="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-card">
            {responsavel ? (
              <ColaboradorAvatar
                nome={responsavel.nome}
                cor={responsavel.cor}
                size="2xs"
                title={"Responsável: " + responsavel.nome}
              />
            ) : chat.tipo !== "group" ? (
              <SemResponsavelAvatar size="2xs" />
            ) : null}
          </span>
        </span>
        <div className="flex-1 min-w-0">
          {/* Linha 1: nome + hora */}
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <p
                className={cn(
                  "text-sm truncate leading-tight",
                  naoLidas > 0 ? "font-semibold" : "font-medium",
                )}
              >
                {nome}
              </p>
              {chat.fixado && (
                <PinIcon className="size-3 text-bronze/80 shrink-0" />
              )}
            </div>
            {hora && (
              <span
                className={cn(
                  "text-2xs shrink-0 leading-tight",
                  naoLidas > 0
                    ? "text-primary font-semibold"
                    : "text-muted-foreground",
                )}
              >
                {hora}
              </span>
            )}
          </div>

          {/* Linha 2: preview com ícone de mídia + ack + badge unread */}
          <div className="flex items-center justify-between gap-2 mt-1">
            <div className="flex items-center gap-1 min-w-0 flex-1">
              <PreviewIcon texto={preview} />
              {chat.ultimaMensagemFromMe && (
                <CheckCheck className="size-3 text-muted-foreground/70 shrink-0" />
              )}
              <p className="text-[11.5px] text-muted-foreground truncate leading-tight">
                {preview ?? "Sem mensagens"}
              </p>
            </div>
            {naoLidas > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-2xs font-bold px-1.5 shrink-0">
                {naoLidas > 99 ? "99+" : naoLidas}
              </span>
            )}
          </div>

          {/* Linha 3b (opcional): etiquetas da conversa */}
          <TagsDaConversa chatId={chat.id} className="mt-1.5" />

          {/* Linha 3 (opcional): badges de status — cliente vinculado + instância */}
          {(temCliente || mostraPillInstancia || chat.atendimentoStatus === "finalizado") && (
            <div className="flex items-center gap-1 mt-1.5">
              {chat.atendimentoStatus === "finalizado" && (
                <span className="inline-flex items-center gap-1 text-[9.5px] font-medium bg-success/15 text-success rounded-full px-1.5 py-0.5 leading-none">
                  Finalizado
                </span>
              )}
              {temCliente && (
                <span className="inline-flex items-center gap-1 text-[9.5px] font-medium bg-bronze/15 text-bronze rounded-full px-1.5 py-0.5 leading-none">
                  Cliente
                </span>
              )}
              {mostraPillInstancia && sessao && (
                <Tooltip
                  label={`Via ${sessao.apelido ?? sessao.numero ?? "WhatsApp"}`}
                  side="top"
                >
                  <span className="inline-flex items-center gap-1 text-[9.5px] font-medium bg-primary/10 text-primary rounded-full px-1.5 py-0.5 leading-none max-w-[120px]">
                    <span className="truncate">
                      {sessao.apelido ?? formatPhone(sessao.numero ?? "")}
                    </span>
                  </span>
                </Tooltip>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Menu de ações — escondido no modo seleção (clicar marca/desmarca). */}
      {!modoSelecao && (
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "absolute right-1 top-2 grid place-items-center size-7 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-opacity opacity-50 hover:opacity-100",
              menuOpen && "opacity-100 bg-accent",
            )}
            aria-label="Mais ações"
          >
            <MoreVertical className="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 p-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(false);
              setDownloadOpen(true);
            }}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-accent text-left"
          >
            <Download className="size-4 text-muted-foreground" />
            Exportar conversa
          </button>
          <div className="my-1 h-px bg-border/60" />
          <button
            type="button"
            onClick={handleFixar}
            disabled={fixar.isPending}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-accent text-left disabled:opacity-50"
          >
            <PinIcon
              className={cn(
                "size-4",
                chat.fixado ? "text-bronze" : "text-muted-foreground",
              )}
            />
            {chat.fixado ? "Desafixar conversa" : "Fixar conversa"}
          </button>
          <button
            type="button"
            onClick={handleArquivar}
            disabled={arquivar.isPending}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-accent text-left disabled:opacity-50"
          >
            {chat.arquivado ? (
              <ArchiveRestore className="size-4 text-muted-foreground" />
            ) : (
              <Archive className="size-4 text-muted-foreground" />
            )}
            {chat.arquivado ? "Desarquivar conversa" : "Arquivar conversa"}
          </button>
          <button
            type="button"
            onClick={handleLimpar}
            disabled={limpar.isPending}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-accent text-left disabled:opacity-50"
          >
            <Eraser className="size-4 text-muted-foreground" />
            Limpar mensagens
          </button>
          <button
            type="button"
            onClick={handleApagar}
            disabled={apagar.isPending}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-destructive/10 text-destructive text-left disabled:opacity-50"
          >
            <Trash2 className="size-4" />
            Apagar conversa
          </button>
        </PopoverContent>
      </Popover>
      )}

      <DownloadConversaDialog
        open={downloadOpen}
        onOpenChange={setDownloadOpen}
        chatId={chat.chatId}
        chatNome={nome}
        sessaoId={chat.sessaoId}
        numero={chat.tipo === "group" ? null : chat.chatId.replace("@c.us", "")}
      />
    </div>
  );
});

/**
 * Detecta o tipo de mídia pelo texto da última mensagem e retorna um
 * ícone discreto que aparece antes do preview. Mensagens de mídia
 * costumam vir como "📷 Foto", "🎤 Mensagem de voz" etc. — tentamos
 * inferir o tipo por palavras-chave em pt-BR.
 */
function PreviewIcon({ texto }: { texto: string | null }) {
  if (!texto) return null;
  const t = texto.toLowerCase();
  let Icon: React.ComponentType<{ className?: string }> | null = null;
  if (/📷|imagem|foto/.test(t)) Icon = ImageIcon;
  else if (/🎤|áudio|audio|voz|voice/.test(t)) Icon = Mic;
  else if (/🎥|vídeo|video/.test(t)) Icon = Video;
  else if (/📎|documento|arquivo|pdf/.test(t)) Icon = FileText;
  if (!Icon) return null;
  return <Icon className="size-3 text-muted-foreground/70 shrink-0" />;
}

/** Placeholders crus que vazam do backend (ex.: doc enviado sem legenda)
 *  e seus rótulos pt-BR — rede de segurança pra dados antigos/engine. */
const ROTULO_MIDIA: Record<string, string> = {
  image: "Imagem",
  video: "Vídeo",
  gif: "Vídeo",
  audio: "Áudio",
  ptt: "Áudio",
  document: "Documento",
  sticker: "Figurinha",
  collection: "Álbum de fotos",
  location: "Localização",
  contact: "Contato",
  poll: "Enquete",
};

/** Limpa o preview: traduz placeholder "[document]" → rótulo pt-BR e
 *  remove emojis de mídia do início pra não duplicar com o ícone. */
function previewLimpo(texto: string | null): string | null {
  if (!texto) return null;
  const bracket = texto.trim().match(/^\[([a-z]+)\]$/i);
  if (bracket) return ROTULO_MIDIA[bracket[1].toLowerCase()] ?? "Mensagem";
  return texto.replace(/^(📷|🎤|🎥|📎|📄|🖼️)\s*/u, "").trim();
}

function ChatAvatar({
  semente,
  grupo,
  fotoPath,
  ringCliente,
}: {
  /** Identificador do chat (JID). É a semente do desenho, NUNCA o nome. */
  semente: string;
  grupo: boolean;
  fotoPath?: string | null;
  ringCliente: boolean;
}) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const temFoto = fotoPath && fotoPath !== "__none__";

  useEffect(() => {
    if (!temFoto) {
      setPhotoUrl(null);
      return;
    }
    let cancel = false;
    mediaSignedUrl(fotoPath!).then((url) => {
      if (!cancel) setPhotoUrl(url);
    });
    return () => {
      cancel = true;
    };
  }, [fotoPath, temFoto]);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center size-11 rounded-full text-sm font-medium overflow-hidden",
        grupo ? "bg-bronze/15 text-bronze" : "bg-primary/15 text-primary",
        // Ring bronze sutil quando o chat tem cliente vinculado — sinaliza
        // status com 1 olhada sem ocupar linha extra de texto.
        ringCliente && "ring-2 ring-bronze/40 ring-offset-1 ring-offset-card",
      )}
    >
      {photoUrl ? (
        <img
          src={photoUrl}
          alt=""
          className="size-full object-cover"
          loading="lazy"
          onError={() => setPhotoUrl(null)}
        />
      ) : grupo ? (
        <Users className="size-4" />
      ) : (
        // Sem foto do WhatsApp (privacidade do contato, que é a regra em quem
        // chega por anúncio): desenho fictício estável por número.
        <img src={avatarFicticio(semente)} alt="" className="size-full" loading="lazy" />
      )}
    </span>
  );
}

function formatPhone(numero: string): string {
  const limpo = numero.replace(/\D/g, "");
  if (limpo.length === 13 && limpo.startsWith("55")) {
    return `+55 ${limpo.slice(2, 4)} ${limpo.slice(4, 9)}-${limpo.slice(9)}`;
  }
  if (limpo.length === 12 && limpo.startsWith("55")) {
    return `+55 ${limpo.slice(2, 4)} ${limpo.slice(4, 8)}-${limpo.slice(8)}`;
  }
  return numero;
}

function formatChatTime(iso: string): string {
  const date = parsePgTimestamp(iso);
  if (!date) return "";
  if (isToday(date)) return format(date, "HH:mm");
  if (isYesterday(date)) return "Ontem";
  const diasAtras = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
  if (diasAtras < 7) return format(date, "EEE", { locale: ptBR });
  return format(date, "dd/MM");
}
