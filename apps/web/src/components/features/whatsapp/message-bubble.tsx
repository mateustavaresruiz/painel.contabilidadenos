import { format } from "date-fns";
import {
  AlertCircle,
  BarChart3,
  Check,
  CheckCheck,
  ClipboardPlus,
  Clock,
  Copy,
  CornerUpLeft,
  Download,
  ExternalLink,
  File as FileIcon,
  Forward,
  ImageOff,
  Loader2,
  MapPin,
  Maximize2,
  Images,
  MessageCircle,
  Mic,
  MoreVertical,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Trash2,
  User,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/lib/toast";

import { Button } from "@/components/ui/button";
import { confirmar } from "@/components/ui/confirm-dialog";
import { openMediaViewer } from "@/components/ui/media-viewer";
import { formatBytes, parsePgTimestamp } from "@/lib/format";
import { ColaboradorAvatar } from "@/components/colaborador-avatar";
import { useEu } from "@/lib/colaborador";
import { ehConflitoAtendimento } from "@/lib/queries/atendimento";
import { msgErro } from "@/lib/erro";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  renderMensagemTexto,
  renderTextoComLinks,
  type MencaoResolvida,
} from "@/lib/render-links";
import { cn } from "@/lib/utils";
import {
  mediaSignedUrl,
  removerFantasma,
  useApagarMensagem,
  useEnviarTexto,
  useReagirMensagem,
  useRefetchMedia,
  useVotarEnquete,
  type WhatsappContato,
  type WhatsappMensagem,
  type WhatsappPayloadBotao,
  type WhatsappPayloadContato,
  type WhatsappPayloadEnquete,
} from "@/lib/queries/whatsapp";

import { EditarMensagemDialog } from "./editar-mensagem-dialog";
import { EncaminharDialog } from "./encaminhar-dialog";

type MessageBubbleProps = {
  msg: WhatsappMensagem;
  /** True quando o chat é um grupo — habilita render do remetente em cima. */
  ehGrupo?: boolean;
  /** True quando esta msg deve mostrar o nome do remetente em cima
   *  (controle do parent para agrupar consecutivas — vide
   *  shouldShowRemetente em chat-conversa.tsx). */
  mostrarRemetente?: boolean;
  /** Metadata do remetente (nome canônico + foto) — só em grupo. */
  contato?: WhatsappContato | null;
  /** Resolve `@<digits>` no texto para { label, contatoId }. Null =
   *  contato não encontrado, mantém o token cru. */
  resolveMencao?: (digits: string) => MencaoResolvida | null;
  /** Click numa menção: parent troca o chat aberto. */
  onMencaoClick?: (contatoId: string) => void;
  /** Responder a esta mensagem (citação) — parent preenche o composer. */
  onReply?: (reply: { wamId: string; texto: string }) => void;
  /** Mensagem original citada (resolvida pelo parent via replyToWamId) —
   *  usada para renderizar a miniatura da mídia na citação. */
  quotedMsg?: WhatsappMensagem | null;
  /** Click na citação: parent rola/centraliza a mensagem original. */
  onQuotedClick?: (wamId: string) => void;
  /** Novo no painel Denos: "Abrir chamado a partir desta mensagem". */
  onCriarSolicitacao?: (msg: WhatsappMensagem) => void;
  /** Conversa em atendimento por outra pessoa: sem responder, reagir, editar,
   *  encaminhar nem apagar (o servidor também barra com 409). */
  somenteLeitura?: boolean;
};

/** Reações rápidas do menu da mensagem (o adv3 só exibia as recebidas). */
const REACOES_RAPIDAS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

/**
 * Acima deste tamanho (em caracteres) a mensagem colapsa num preview com
 * "Ler mais". Calibrado para mostrar algumas linhas sem chegar perto do fim
 * da tela — ajuste aqui se quiser preview mais curto/longo.
 */
const LIMITE_PREVIEW = 600;

/**
 * Resolve `@<digits>` (LID cru) para `@Nome`/`@(telefone)` num texto puro —
 * usado na citação do reply, que antes mostrava o LID cru. Menção sem
 * resolução fica como está.
 */
function resolverMencoesTexto(
  texto: string | null,
  resolveMencao?: (digits: string) => MencaoResolvida | null,
): string | null {
  if (!texto || !resolveMencao) return texto;
  return texto.replace(/@(\d{6,})/g, (full, digits: string) => {
    const r = resolveMencao(digits);
    return r ? `@${r.label}` : full;
  });
}

/** Preview curto da mensagem para exibir na citação do reply. */
function previewParaReply(msg: WhatsappMensagem): string {
  const t = msg.texto?.trim();
  if (t) return t;
  switch (msg.tipo) {
    case "image":
      return "📷 Foto";
    case "video":
    case "gif":
      return "🎬 Vídeo";
    case "audio":
      return "🎤 Áudio";
    case "document":
      return "📄 Documento";
    case "sticker":
      return "Sticker";
    case "location":
      return "📍 Localização";
    default:
      return "Mensagem";
  }
}

/**
 * Bubble de uma mensagem do WhatsApp. Mostra:
 *  - texto livre
 *  - mídia (imagem, vídeo, áudio, documento) com signed URL
 *  - reply citado
 *  - reactions agregadas
 *  - ack (✓ / ✓✓ / ✓✓ azul) para mensagens próprias
 *
 * Memoizada — pais (chat-conversa) passam handlers via useCallback,
 * então a comparação rasa default do React.memo evita re-render
 * em massa quando uma irmã muda (ack, reaction, etc).
 */
export const MessageBubble = memo(function MessageBubble({
  msg,
  ehGrupo,
  mostrarRemetente,
  contato,
  resolveMencao,
  onMencaoClick,
  onReply,
  quotedMsg,
  onQuotedClick,
  onCriarSolicitacao,
  somenteLeitura = false,
}: MessageBubbleProps) {
  const direita = msg.fromMe;
  const apagada = !!msg.apagadoEm;
  const [encaminharOpen, setEncaminharOpen] = useState(false);
  const [editarOpen, setEditarOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Mensagens muito longas colapsam num preview com "Ler mais" (estilo
  // WhatsApp), para não esticar o balão até o fim da tela.
  const [expandido, setExpandido] = useState(false);
  const apagar = useApagarMensagem();
  const reagir = useReagirMensagem();
  const { tem } = useEu();
  const pendente = !!msg._pendente || msg.id.startsWith("temp-");
  // WhatsApp só deixa apagar mensagens próprias.
  const podeApagar =
    !somenteLeitura && direita && !apagada && !pendente && tem("whatsapp.apagar_mensagens");
  // Encaminhar precisa do wamId real (msg já existente no WhatsApp) e
  // só faz sentido para conteúdo — não para reaction/system nem apagada.
  const podeEncaminhar =
    !somenteLeitura &&
    !!msg.wamId &&
    !apagada &&
    msg.tipo !== "reaction" &&
    msg.tipo !== "system" &&
    msg.tipo !== "placeholder" &&
    msg.tipo !== "nao_suportado";
  // Responder (citar) precisa do wamId real e não faz sentido para
  // reaction/system, placeholder (sem conteúdo) nem mensagem apagada.
  const podeResponder =
    !somenteLeitura &&
    !!onReply &&
    !!msg.wamId &&
    !apagada &&
    msg.tipo !== "reaction" &&
    msg.tipo !== "system" &&
    msg.tipo !== "placeholder" &&
    msg.tipo !== "nao_suportado";
  // Copiar: só faz sentido quando há texto (mensagem ou legenda de mídia).
  // Copiar: só quando há texto (mensagem ou legenda de mídia).
  const textoCopiavel = msg.texto?.trim() ?? "";
  const podeCopiar = !!textoCopiavel && !apagada;
  // Editar: só msg de texto PRÓPRIA, não apagada, com wamId real e dentro da
  // janela de edição do WhatsApp (~15min). Fora disso o WAHA recusaria —
  // escondemos para não oferecer uma ação que vai falhar.
  const tsEnvio = parsePgTimestamp(msg.timestamp);
  const idadeMin = tsEnvio
    ? (Date.now() - tsEnvio.getTime()) / 60_000
    : Infinity;
  const podeEditar =
    !somenteLeitura &&
    direita &&
    !apagada &&
    msg.tipo === "text" &&
    !!msg.wamId &&
    !!msg.texto?.trim() &&
    idadeMin < 15;
  const podeReagir = podeResponder;
  const podeCriarSolicitacao = !!onCriarSolicitacao && !apagada && !pendente;
  const temAcoes =
    podeResponder ||
    podeEditar ||
    podeCopiar ||
    podeEncaminhar ||
    podeApagar ||
    podeCriarSolicitacao;

  // Toque longo no iPhone: o Safari do iOS não dispara "contextmenu", e o
  // menu ficava inalcançável lá (defeito 41 do adv3).
  // Durante o toque o balão fica sem seleção de texto e sem o balão nativo do
  // iOS (copiar/salvar imagem), senão o Safari seleciona a palavra junto com o
  // nosso menu. Se o toque longo abriu o menu, o "click" que vem depois do
  // dedo sair é engolido: não abre a foto nem segue o link por baixo.
  const toqueRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toqueLongoRef = useRef(false);
  const [pressionando, setPressionando] = useState(false);
  function iniciarToque() {
    if (!temAcoes) return;
    toqueLongoRef.current = false;
    setPressionando(true);
    toqueRef.current = setTimeout(() => {
      toqueLongoRef.current = true;
      setMenuOpen(true);
      navigator.vibrate?.(10);
    }, 500);
  }
  function cancelarToque() {
    if (toqueRef.current) clearTimeout(toqueRef.current);
    toqueRef.current = null;
    setPressionando(false);
  }
  function soltarToque(e: React.TouchEvent) {
    cancelarToque();
    // Sem o click sintetizado depois do toque longo.
    if (toqueLongoRef.current && e.cancelable) e.preventDefault();
  }

  async function handleReagir(emoji: string) {
    if (!msg.wamId) return;
    setMenuOpen(false);
    try {
      await reagir.mutateAsync({ sessaoId: msg.sessaoId, messageId: msg.wamId, reaction: emoji });
    } catch (err) {
      if (ehConflitoAtendimento(err)) return; // aviso e recarga: main.tsx
      toast.error("Não foi possível reagir: " + msgErro(err));
    }
  }

  async function handleCopiar() {
    if (!textoCopiavel) return;
    try {
      await navigator.clipboard.writeText(textoCopiavel);
      toast.success("Mensagem copiada");
    } catch {
      toast.error("Não consegui copiar.");
    }
  }

  // Mídia visual (imagem/vídeo/sticker) SEM legenda renderiza "sem moldura":
  // o balão colorido em volta da foto vira uma borda grossa do acento (feia).
  // Aqui o balão fica transparente/sem padding e a foto aparece limpa, com o
  // horário discreto embaixo (estilo WhatsApp). Mantém a moldura quando há
  // legenda (imagem + texto) ou nome de remetente de grupo.
  const ehMidiaVisual =
    msg.tipo === "image" || msg.tipo === "video" || msg.tipo === "sticker";
  const molduraLivre =
    ehMidiaVisual &&
    !msg.texto &&
    !apagada &&
    !!msg.mediaPath &&
    !msg.replyToWamId &&
    !(ehGrupo && mostrarRemetente && !direita);

  // Preview de mensagem longa: corta num limite de caracteres (um pouco antes
  // de estourar a tela) e mostra "Ler mais"; expande in-place no clique. O
  // corte é por code point (`[...]`) para não partir emoji no meio.
  const textoCompleto = msg.texto ?? "";
  const textoLongo = textoCompleto.length > LIMITE_PREVIEW;
  const textoExibido =
    textoLongo && !expandido
      ? [...textoCompleto].slice(0, LIMITE_PREVIEW).join("").trimEnd() + "…"
      : textoCompleto;

  async function handleApagar() {
    if (
      !(await confirmar({
        titulo: "Apagar mensagem?",
        descricao:
          "Apaga para todos no WhatsApp. Quem recebeu vê \"Mensagem apagada\". Sem desfazer.",
        destructive: true,
        confirmLabel: "Excluir",
      }))
    ) {
      return;
    }
    try {
      await apagar.mutateAsync(msg.id);
      toast.success("Mensagem apagada");
    } catch (err) {
      if (ehConflitoAtendimento(err)) return;
      toast.error(err instanceof Error ? err.message : "Erro ao apagar");
    }
  }

  return (
    <div
      className={cn(
        "group flex flex-col max-w-[min(78%,640px)]",
        direita ? "ml-auto mr-3 items-end" : "ml-3 items-start",
      )}
    >
      <div
        onTouchStart={iniciarToque}
        onTouchEnd={soltarToque}
        onTouchMove={cancelarToque}
        onTouchCancel={cancelarToque}
        onClickCapture={(e) => {
          if (!toqueLongoRef.current) return;
          toqueLongoRef.current = false;
          e.preventDefault();
          e.stopPropagation();
        }}
        onContextMenu={(e) => {
          // Segurar no mobile / botão direito no desktop abre o menu de
          // ações (em vez do menu nativo do navegador).
          if (!temAcoes) return;
          e.preventDefault();
          setMenuOpen(true);
        }}
        className={cn(
          "relative rounded-2xl text-sm transition-colors toque:[-webkit-touch-callout:none]",
          pressionando && "select-none",
          molduraLivre
            ? // Mídia sem legenda: balão transparente, foto sem moldura.
              "bg-transparent p-0 shadow-none"
            : cn(
                "px-3.5 py-2 shadow-sm",
                // Mensagem própria: acento (LUZ no tema escuro) — balão claro.
                // Recebida: superfície ELEVADA (secondary) + borda de luz, para
                // destacar do fundo preto (bg-card sumia). Canto inferior reto.
                direita
                  ? "bg-primary text-primary-foreground rounded-br-sm shadow-primary/20"
                  : "bg-secondary border border-border rounded-bl-sm",
              ),
          apagada && "italic opacity-70",
        )}
      >
        {/* Nome + foto do remetente dentro da bubble (estilo WhatsApp) —
            só em grupo, recebidas, primeira de cada bloco consecutivo. */}
        {ehGrupo && mostrarRemetente && !direita && (
          <div className="flex items-center gap-1.5 mb-0.5 max-w-full">
            <ContatoAvatar contato={contato} fallbackId={msg.remetenteJid} />
            <span className="text-2xs font-semibold text-foreground truncate">
              {nomeRemetente(msg, contato)}
            </span>
          </div>
        )}

        {/* Citação (reply) — nested DENTRO do balão, estilo WhatsApp: barra
            de acento à esquerda, fundo esmaecido, ocupa a largura do balão e
            cola na mensagem (não mais uma pílula solta flutuando acima). */}
        {(msg.replyToTexto || quotedMsg || msg.replyToThumb) && !apagada && (
          <button
            type="button"
            onClick={() => {
              if (msg.replyToWamId) onQuotedClick?.(msg.replyToWamId);
            }}
            disabled={!onQuotedClick || !msg.replyToWamId}
            className={cn(
              "mt-1 mb-2.5 w-full text-left rounded-lg border-l-4 pl-3 pr-2.5 py-2.5 text-xs leading-snug max-w-full overflow-hidden flex items-stretch gap-2.5",
              onQuotedClick && msg.replyToWamId
                ? "cursor-pointer transition hover:brightness-95"
                : "cursor-default",
              direita
                ? "bg-primary-foreground/15 border-primary-foreground/60 text-primary-foreground/85"
                : "bg-foreground/[0.05] border-primary/60 text-muted-foreground",
            )}
          >
            <span className="flex-1 min-w-0 self-center block break-words line-clamp-3">
              {resolverMencoesTexto(
                msg.replyToTexto ??
                  (quotedMsg ? previewParaReply(quotedMsg) : null),
                resolveMencao,
              )}
            </span>
            {/* Miniatura da mídia citada: a real (signed URL) quando a original
                está resolvida; senão o thumbnail (jpegThumbnail) capturado na
                ingestão, que aparece na hora mesmo sem a original carregada. */}
            {quotedMsg ? (
              <QuotedThumb msg={quotedMsg} />
            ) : msg.replyToThumb ? (
              <img
                src={msg.replyToThumb}
                alt=""
                className="size-10 rounded object-cover shrink-0"
              />
            ) : null}
          </button>
        )}

        {apagada ? (
          <span>Mensagem apagada</span>
        ) : (
          <>
            <MediaContent msg={msg} onMencaoClick={onMencaoClick} />
            {msg.texto && (
              <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                {resolveMencao
                  ? renderMensagemTexto(
                      textoExibido,
                      resolveMencao,
                      onMencaoClick,
                      { dark: direita },
                    )
                  : renderTextoComLinks(textoExibido, { dark: direita })}
                {textoLongo && (
                  <button
                    type="button"
                    onClick={() => setExpandido((v) => !v)}
                    className={cn(
                      "ml-1 align-baseline text-xs font-medium underline underline-offset-2",
                      direita
                        ? "text-primary-foreground/80 hover:text-primary-foreground"
                        : "text-primary hover:text-primary/80",
                    )}
                  >
                    {expandido ? "Ler menos" : "Ler mais"}
                  </button>
                )}
              </p>
            )}
          </>
        )}

        <div
          className={cn(
            "flex items-center gap-1 mt-1 text-2xs",
            direita ? "justify-end" : "justify-start",
            molduraLivre || !direita
              ? "text-muted-foreground"
              : "text-primary-foreground/70",
          )}
        >
          {/* Em grupos, o nome do remetente vai para cima da bubble
              (via prop `mostrarRemetente`). Não duplica aqui no
              rodapé para economizar espaço.
              Em msgs próprias, mostra o membro do escritório que
              disparou — só visível internamente, convidado vê só
              "vocês" no app dele. */}
          {direita && msg.enviadoPor && (
            <EnviadoPorBadge usuario={msg.enviadoPor} />
          )}
          {direita && !msg.enviadoPor && msg.origem === "sistema" && (
            <span className="italic">aviso automático</span>
          )}
          <span>{format(parsePgTimestamp(msg.timestamp) ?? new Date(), "HH:mm")}</span>
          {msg.editadoEm && <span>· editada</span>}
          {direita && (
            <AckIcon
              ack={msg.ack}
              ownBubble={!molduraLivre}
              pendente={pendente && !msg._erro}
            />
          )}
        </div>
        {(msg._erro || (direita && msg.ack === -1)) && <FalhaEnvio msg={msg} />}

        {/* Menu de ações (estilo WhatsApp Web): três pontinhos no hover ao
            lado do balão; no mobile/touch abre no segurar (onContextMenu).
            Fica flutuante (absolute) para NÃO reservar espaço — a linha de
            botões antiga deixava o vão entre mensagens grande e esquisito. */}
        {temAcoes && (
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Ações da mensagem"
                className={cn(
                  "absolute top-1/2 -translate-y-1/2 z-10 grid place-items-center size-6 rounded-full",
                  "bg-card border border-border/70 text-muted-foreground shadow-sm",
                  "opacity-0 pointer-events-none transition-opacity",
                  "group-hover:opacity-100 group-hover:pointer-events-auto",
                  "data-[state=open]:opacity-100 data-[state=open]:pointer-events-auto",
                  "focus-visible:opacity-100 focus-visible:pointer-events-auto",
                  "hover:text-foreground hover:bg-accent",
                  // 🔴 ENCOSTADO no balão (-6 = a própria largura do botão),
                  // não a -7. O vão de 4px que existia caía FORA do `group`:
                  // ao mirar o botão, o hover morria no meio do caminho, o
                  // `pointer-events-none` voltava e o botão sumia antes do
                  // clique. Some ao passar o mouse era exatamente isto.
                  direita ? "-left-6" : "-right-6",
                  // Ponte invisível por baixo (`-z-10`), cobrindo a lateral e
                  // um pouco acima/abaixo: mesmo num movimento rápido, o
                  // ponteiro cai numa área que É o próprio botão, e o hover
                  // do `group` não se perde. Não muda nada visualmente.
                  "before:absolute before:-z-10 before:inset-y-[-8px]",
                  direita
                    ? "before:left-[-4px] before:right-[-10px]"
                    : "before:right-[-4px] before:left-[-10px]",
                )}
              >
                <MoreVertical className="size-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align={direita ? "end" : "start"}
              className="w-52 toque:w-64 p-1"
            >
              {podeReagir && (
                <div className="flex items-center justify-between px-1 pb-1 mb-1 border-b border-border/60">
                  {REACOES_RAPIDAS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => void handleReagir(e)}
                      disabled={reagir.isPending}
                      className="size-8 toque:size-10 grid place-items-center rounded-md text-lg hover:bg-accent disabled:opacity-50"
                      aria-label={"Reagir com " + e}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              )}
              {podeResponder && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onReply?.({ wamId: msg.wamId!, texto: previewParaReply(msg) });
                  }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 toque:min-h-11 rounded-md text-sm hover:bg-accent text-left"
                >
                  <CornerUpLeft className="size-4 text-muted-foreground" />
                  Responder
                </button>
              )}
              {podeEditar && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setEditarOpen(true);
                  }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 toque:min-h-11 rounded-md text-sm hover:bg-accent text-left"
                >
                  <Pencil className="size-4 text-muted-foreground" />
                  Editar
                </button>
              )}
              {podeCopiar && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    void handleCopiar();
                  }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 toque:min-h-11 rounded-md text-sm hover:bg-accent text-left"
                >
                  <Copy className="size-4 text-muted-foreground" />
                  Copiar mensagem
                </button>
              )}
              {podeEncaminhar && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setEncaminharOpen(true);
                  }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 toque:min-h-11 rounded-md text-sm hover:bg-accent text-left"
                >
                  <Forward className="size-4 text-muted-foreground" />
                  Encaminhar
                </button>
              )}
              {podeCriarSolicitacao && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onCriarSolicitacao?.(msg);
                  }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 toque:min-h-11 rounded-md text-sm hover:bg-accent text-left"
                >
                  <ClipboardPlus className="size-4 text-muted-foreground" />
                  Abrir chamado a partir desta mensagem
                </button>
              )}
              {podeApagar && (
                <>
                  {(podeEncaminhar || podeCriarSolicitacao) && (
                    <div className="my-1 h-px bg-border/60" />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      void handleApagar();
                    }}
                    disabled={apagar.isPending}
                    className="w-full flex items-center gap-2 px-2 py-1.5 toque:min-h-11 rounded-md text-sm hover:bg-destructive/10 text-destructive text-left disabled:opacity-50"
                  >
                    <Trash2 className="size-4" />
                    Apagar
                  </button>
                </>
              )}
            </PopoverContent>
          </Popover>
        )}
      </div>

      {podeEncaminhar && msg.wamId && (
        <EncaminharDialog
          open={encaminharOpen}
          onOpenChange={setEncaminharOpen}
          sessaoId={msg.sessaoId}
          messageId={msg.wamId}
        />
      )}

      {podeEditar && (
        <EditarMensagemDialog
          open={editarOpen}
          onOpenChange={setEditarOpen}
          mensagemId={msg.id}
          textoAtual={msg.texto ?? ""}
        />
      )}

      {msg.reactions && msg.reactions.length > 0 && (
        <div
          className={cn(
            "-mt-1 mr-1 ml-1 inline-flex bg-card border rounded-full px-1.5 py-0.5 text-xs",
            direita ? "self-end" : "self-start",
          )}
        >
          {Array.from(new Set(msg.reactions.map((r) => r.emoji))).map((e) => (
            <span key={e}>{e}</span>
          ))}
          {msg.reactions.length > 1 && (
            <span className="ml-1 text-muted-foreground">
              {msg.reactions.length}
            </span>
          )}
        </div>
      )}
    </div>
  );
});

/**
 * Resolve o melhor label pro remetente:
 *   1. `contato.nome` (vinculado a Cliente cadastrado — melhor caso)
 *   2. `contato.pushName` (nome que ele tem no WhatsApp)
 *   3. `msg.remetenteNome` (pushName extraído direto do payload)
 *   4. Telefone formatado quando `remetenteJid` é @c.us
 *   5. "Participante" como último recurso
 */
/**
 * Mini-badge clicável que aparece em mensagens próprias. Mostra a
 * inicial+primeiro nome do membro que disparou; clicar abre popover
 * com nome completo, e-mail, cargo e OAB — útil para desambiguar
 * quando há 2+ pessoas com mesmo primeiro nome no escritório.
 *
 * Só interno: convidado/cliente continua vendo só "vocês".
 */
function EnviadoPorBadge({
  usuario,
}: {
  usuario: { id: string; nome: string; cor: string };
}) {
  const primeiroNome = usuario.nome.split(" ")[0] ?? usuario.nome;
  return (
    <span
      title={"Enviado por " + usuario.nome}
      className="inline-flex items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2 leading-none bg-primary-foreground/10 max-w-[120px]"
    >
      <ColaboradorAvatar
        nome={usuario.nome}
        cor={usuario.cor}
        size="2xs"
        className="size-3.5 text-[7px]"
      />
      <span className="truncate font-medium leading-none">{primeiroNome}</span>
    </span>
  );
}

/** Aviso de envio que falhou, com reenviar/descartar (defeito 33 do adv3). */
function FalhaEnvio({ msg }: { msg: WhatsappMensagem }) {
  const qc = useQueryClient();
  const enviar = useEnviarTexto();
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-destructive/90 px-2 py-1 text-2xs text-destructive-foreground">
      <AlertCircle className="size-3 shrink-0" />
      <span className="font-medium">Não enviada</span>
      {msg._erro && (
        <span className="opacity-80 truncate max-w-[180px]" title={msg._erro}>{msg._erro}</span>
      )}
      <span className="flex-1" />
      {msg.tipo === "text" && msg.texto && (
        <button
          type="button"
          className="underline underline-offset-2 font-semibold"
          onClick={() =>
            enviar.mutate({
              sessaoId: msg.sessaoId,
              chatId: msg.chatId,
              texto: msg.texto ?? "",
              replyTo: msg.replyToWamId ?? undefined,
              replyToTexto: msg.replyToTexto ?? undefined,
              colaborador: msg.enviadoPor,
              // Só a fantasma some; a linha gravada (ack -1) fica como registro.
              reenviarDe: msg.id.startsWith("temp-") ? msg.id : undefined,
            })
          }
        >
          Reenviar
        </button>
      )}
      {msg.id.startsWith("temp-") && (
        <button
          type="button"
          className="underline underline-offset-2"
          onClick={() => removerFantasma(qc, msg.sessaoId, msg.chatId, msg.id)}
        >
          Descartar
        </button>
      )}
    </div>
  );
}

function nomeRemetente(
  msg: WhatsappMensagem,
  contato?: WhatsappContato | null,
): string {
  if (contato?.nome?.trim()) return contato.nome.trim();
  if (contato?.pushName?.trim()) return contato.pushName.trim();
  if (msg.remetenteNome?.trim()) return msg.remetenteNome.trim();
  const id = msg.remetenteJid;
  if (!id) return "Participante";
  if (id.endsWith("@c.us")) {
    const digits = id.replace("@c.us", "");
    if (digits.length === 13 && digits.startsWith("55")) {
      return `+55 ${digits.slice(2, 4)} ${digits.slice(4, 9)}-${digits.slice(9)}`;
    }
    if (digits.length === 12 && digits.startsWith("55")) {
      return `+55 ${digits.slice(2, 4)} ${digits.slice(4, 8)}-${digits.slice(8)}`;
    }
    return `+${digits}`;
  }
  return "Participante";
}

/** Avatar pequeno do remetente em bubble de grupo. Carrega signed URL
 *  do fotoPath se houver; senão mostra inicial do NOME (não do
 *  telefone — antes saía "5" porque o fallback era o primeiro char
 *  do "5511..@c.us"). Sem nome real, mostra ícone genérico. */
function ContatoAvatar({
  contato,
}: {
  contato?: WhatsappContato | null;
  fallbackId?: string | null;
}) {
  const fotoPath =
    contato?.fotoPath && contato.fotoPath !== "__none__"
      ? contato.fotoPath
      : null;
  const url = useSignedUrl(fotoPath);
  // Só usa inicial quando temos um nome legível — pushName ou Cliente
  // vinculado. Telefone cru (fallbackId) gera "5" como inicial, que
  // não diz nada.
  const nome = contato?.nome?.trim() || contato?.pushName?.trim() || null;
  const inicial = nome ? nome.charAt(0).toUpperCase() : null;
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className="size-4 rounded-full object-cover shrink-0"
        loading="lazy"
      />
    );
  }
  if (inicial) {
    return (
      <span className="size-4 rounded-full bg-foreground/10 text-foreground text-[8px] font-bold grid place-items-center shrink-0">
        {inicial}
      </span>
    );
  }
  return (
    <span className="size-4 rounded-full bg-muted text-muted-foreground grid place-items-center shrink-0">
      <User className="size-2.5" />
    </span>
  );
}

function AckIcon({
  ack,
  ownBubble,
  pendente,
}: {
  ack: number;
  ownBubble?: boolean;
  pendente?: boolean;
}) {
  // Ainda sem eco do servidor: relógio (o adv3 não mostrava nada).
  if (pendente && ack <= 0) return <Clock className="size-3" aria-label="Enviando" />;
  // Dentro de bubble própria (charcoal sólido), o ✓✓ "lida" usa um tom
  // claro para contrastar; fora de bubble própria (não usado hoje mas
  // defensive) usa charcoal.
  // Lida (3+) ganha cor própria; entregue (2) fica no tom do rodapé — no
  // adv3 os dois eram idênticos.
  if (ack >= 3) {
    return (
      <CheckCheck
        aria-label="Lida"
        className={cn(
          "size-3.5",
          ownBubble ? "text-primary-foreground/70" : "text-foreground",
        )}
      />
    );
  }
  if (ack >= 2) return <CheckCheck className="size-3.5" />;
  if (ack >= 1) return <Check className="size-3.5" />;
  return null;
}

function MediaContent({
  msg,
  onMencaoClick,
}: {
  msg: WhatsappMensagem;
  onMencaoClick?: (contatoId: string) => void;
}) {
  if (msg.tipo === "text") return null;
  const ehMidia =
    msg.tipo === "image" ||
    msg.tipo === "video" ||
    msg.tipo === "gif" ||
    msg.tipo === "audio" ||
    msg.tipo === "document" ||
    msg.tipo === "sticker";
  // Webhook não conseguiu baixar a mídia — oferece retry em vez de
  // skeleton pulsando para sempre. Mantém a feedback loop pro usuário.
  if (ehMidia && !msg.mediaPath) {
    return <MediaAutoRefetch msg={msg} sticker={msg.tipo === "sticker"} />;
  }
  if (msg.tipo === "image") return <ImagePreview msg={msg} />;
  if (msg.tipo === "video" || msg.tipo === "gif") return <VideoPreview msg={msg} />;
  if (msg.tipo === "audio") return <AudioPreview msg={msg} />;
  if (msg.tipo === "document") return <DocumentPreview msg={msg} />;
  if (msg.tipo === "sticker") return <ImagePreview msg={msg} sticker />;
  if (msg.tipo === "location") return <LocationBubble msg={msg} />;
  if (msg.tipo === "poll") return <PollBubble msg={msg} />;
  if (msg.tipo === "contact")
    return <ContatoBubble msg={msg} onMencaoClick={onMencaoClick} />;
  if (msg.tipo === "buttons") return <BotaoRespostaBubble msg={msg} />;
  // Mensagem não-descriptografável (placeholderMessage do whatsmeow): o
  // WhatsApp entregou o "envelope" mas não o conteúdo. Espelha o aviso
  // nativo do app em vez de um balão vazio.
  if (msg.tipo === "placeholder") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground italic">
        <MessageCircle className="size-3.5 shrink-0" />
        Mensagem recebida, mas não pôde ser exibida, peça para reenviar.
      </span>
    );
  }
  // Formato sem texto legível (template/menu da API oficial que escapou do
  // extrator do webhook). Mesma ideia: rótulo honesto no lugar de nada.
  if (msg.tipo === "nao_suportado") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground italic">
        <MessageCircle className="size-3.5 shrink-0" />
        Mensagem em um formato que não conseguimos exibir aqui.
      </span>
    );
  }
  // "collection" é o ENVELOPE de álbum do WhatsApp: chega sem texto e sem
  // arquivo, e as fotos vêm logo atrás como mensagens próprias. Sem rótulo, o
  // escritório via um "[collection]" cru no meio da conversa (12 deles só na
  // última semana) e parecia mídia quebrada.
  if (msg.tipo === "collection") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground italic">
        <Images className="size-3.5 shrink-0" />
        Álbum de fotos
      </span>
    );
  }
  // Tipo não tratado: se tem texto, deixa o texto renderizar (não polui
  // com "[tipo]"). Só mostra o marcador quando não há nada para exibir.
  if (msg.texto?.trim()) return null;
  return (
    <span className="text-xs text-muted-foreground italic">
      [{msg.tipo}]
    </span>
  );
}

/** Localização: card clicável que abre no Google Maps. */
function LocationBubble({ msg }: { msg: WhatsappMensagem }) {
  if (msg.latitude == null || msg.longitude == null) {
    return (
      <span className="text-xs text-muted-foreground italic">Localização</span>
    );
  }
  const href = `https://www.google.com/maps?q=${msg.latitude},${msg.longitude}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 mb-1 rounded-lg border bg-background/60 px-3 py-2 hover:bg-accent/40 transition-colors min-w-[min(200px,calc(78vw-4.5rem))]"
    >
      <span className="grid place-items-center size-9 rounded-full bg-foreground/[0.06] text-foreground shrink-0">
        <MapPin className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium">Localização</p>
        <p className="text-2xs text-muted-foreground tabular-nums">
          {msg.latitude.toFixed(5)}, {msg.longitude.toFixed(5)}
        </p>
      </div>
      <ExternalLink className="size-3.5 text-muted-foreground ml-auto shrink-0" />
    </a>
  );
}

/** Enquete: pergunta + opções com barra de votos. Toca numa opção para
 *  votar (só em enquetes recebidas — best-effort conforme a engine WAHA). */
function PollBubble({ msg }: { msg: WhatsappMensagem }) {
  const p = msg.payload as WhatsappPayloadEnquete | null;
  const votar = useVotarEnquete();
  const [votandoOpt, setVotandoOpt] = useState<string | null>(null);
  if (!p?.options) {
    return <span className="text-xs text-muted-foreground italic">Enquete</span>;
  }
  const votes = p.votes ?? {};
  const total = Object.values(votes).reduce((a, b) => a + (b ?? 0), 0);
  const podeVotar = !!msg.wamId && !msg.fromMe;

  async function vote(opt: string) {
    if (!podeVotar || !msg.wamId) return;
    setVotandoOpt(opt);
    try {
      await votar.mutateAsync({
        sessaoId: msg.sessaoId,
        chatId: msg.chatId,
        pollMessageId: msg.wamId,
        votes: [opt],
      });
      toast.success("Voto enviado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao votar");
    } finally {
      setVotandoOpt(null);
    }
  }

  // Cores adaptam ao balão: dentro da bubble própria (primary sólido) usamos
  // tons de `primary-foreground`; na recebida (card claro), tons neutros.
  const dark = msg.fromMe;
  const sub = dark ? "text-primary-foreground/70" : "text-muted-foreground";
  const optBox = dark
    ? "border-primary-foreground/20 bg-primary-foreground/[0.08]"
    : "border-border bg-foreground/[0.03]";
  const optHover = podeVotar
    ? dark
      ? "hover:bg-primary-foreground/20 hover:border-primary-foreground/40"
      : "hover:bg-accent/50 hover:border-foreground/40"
    : "";
  const track = dark ? "bg-primary-foreground/20" : "bg-muted";
  const fill = dark ? "bg-primary-foreground" : "bg-foreground";
  const ring = dark ? "border-primary-foreground/50" : "border-muted-foreground/40";

  return (
    <div className="mb-1 min-w-[min(230px,calc(78vw-4.5rem))] max-w-[320px] space-y-2.5">
      <div className={cn("flex items-center gap-1.5 text-2xs uppercase tracking-wide", sub)}>
        <BarChart3 className="size-3.5" />
        Enquete{p.multipleAnswers ? " · múltipla escolha" : ""}
      </div>
      <p className="text-sm font-semibold leading-snug break-words">{p.name}</p>
      <ul className="space-y-1.5">
        {p.options.map((opt, i) => {
          const v = votes[opt] ?? 0;
          const pct = total > 0 ? Math.round((v / total) * 100) : 0;
          const conteudo = (
            <>
              <div className="flex items-center gap-2 text-xs">
                {podeVotar ? (
                  <span
                    className={cn(
                      "grid size-4 shrink-0 place-items-center rounded-full border-2",
                      ring,
                    )}
                  >
                    {votandoOpt === opt ? (
                      <Loader2 className="size-2.5 animate-spin" />
                    ) : null}
                  </span>
                ) : null}
                <span className="flex-1 truncate font-medium">{opt}</span>
                {total > 0 ? (
                  <span className={cn("shrink-0 tabular-nums text-2xs", sub)}>
                    {pct}%
                  </span>
                ) : null}
              </div>
              {total > 0 ? (
                <div className={cn("mt-1.5 h-1.5 overflow-hidden rounded-full", track)}>
                  <div
                    className={cn("h-full rounded-full transition-all", fill)}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              ) : null}
            </>
          );
          return (
            <li key={`${opt}-${i}`}>
              {podeVotar ? (
                <button
                  type="button"
                  onClick={() => vote(opt)}
                  disabled={votar.isPending}
                  className={cn(
                    "w-full rounded-lg border px-2.5 py-2 text-left transition-colors disabled:opacity-60",
                    optBox,
                    optHover,
                  )}
                >
                  {conteudo}
                </button>
              ) : (
                <div className={cn("rounded-lg border px-2.5 py-2", optBox)}>
                  {conteudo}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className={cn("flex items-center gap-1 text-2xs", sub)}>
        {podeVotar
          ? "Toque numa opção para votar"
          : total > 0
            ? `${total} voto${total === 1 ? "" : "s"}`
            : "Nenhum voto ainda"}
      </p>
    </div>
  );
}

/** Contato (vCard): nome + telefone + atalho para abrir a conversa NO APP. */
function ContatoBubble({
  msg,
  onMencaoClick,
}: {
  msg: WhatsappMensagem;
  onMencaoClick?: (contatoId: string) => void;
}) {
  const p = msg.payload as WhatsappPayloadContato | null;
  const todos = p?.contatos ?? [];
  // Dedupe defensivo: payloads antigos (antes do fix do webhook) guardaram a
  // mesma entrada 2× porque o WAHA preenche vCards + contactMessage juntos.
  // Chave por telefone (dígitos) + nome.
  const vistos = new Set<string>();
  const contatos = todos.filter((c) => {
    const chave = `${(c.telefone ?? "").replace(/\D/g, "")}|${(c.nome ?? "").trim()}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
  if (!contatos.length) {
    return <span className="text-xs text-muted-foreground italic">Contato</span>;
  }
  return (
    <div className="mb-1 space-y-1.5 min-w-[min(210px,calc(78vw-4.5rem))]">
      {contatos.map((c, i) => {
        // Prefere o `waid` do vCard (jid exato do WhatsApp); cai pros dígitos
        // do TEL. É o id que abre a conversa certa no app.
        const waid = c.vcard?.match(/waid=(\d+)/i)?.[1];
        const digits = waid ?? c.telefone?.replace(/\D/g, "") ?? "";
        return (
          <div
            key={i}
            className="flex items-center gap-2 rounded-lg border bg-background/60 px-3 py-2"
          >
            <span className="grid place-items-center size-9 rounded-full bg-primary/10 text-primary shrink-0">
              <User className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">
                {c.nome ?? "Contato"}
              </p>
              {c.telefone ? (
                <p className="text-2xs text-muted-foreground truncate">
                  {c.telefone}
                </p>
              ) : null}
            </div>
            {digits && onMencaoClick ? (
              <button
                type="button"
                onClick={() => onMencaoClick(`${digits}@c.us`)}
                title="Abrir conversa no app"
                className="grid place-items-center size-7 rounded-full hover:bg-accent text-muted-foreground hover:text-primary shrink-0"
              >
                <MessageCircle className="size-3.5" />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Resposta de botão/lista: chip "Respondeu: <opção>". */
function BotaoRespostaBubble({ msg }: { msg: WhatsappMensagem }) {
  const p = msg.payload as WhatsappPayloadBotao | null;
  const txt = p?.selectedText ?? msg.texto ?? "Resposta";
  return (
    <div className="mb-1 inline-flex items-center gap-1.5 rounded-full border bg-background/60 px-2.5 py-1 text-xs">
      <CornerUpLeft className="size-3 text-muted-foreground shrink-0" />
      Respondeu: <span className="font-medium">{txt}</span>
    </div>
  );
}

/**
 * Quando o webhook falha em baixar a mídia, dispara refetch
 * automaticamente assim que a bubble renderiza. Sem botão — o usuário
 * só vê o skeleton pulsando, e a imagem aparece quando o backend
 * conseguir trazer do WAHA. Se 2 tentativas falharem, mostra um
 * placeholder discreto para parar o skeleton infinito.
 *
 * Refetch é deduplicado por msg.id num Set global (cada msg só
 * tenta 2x na vida do componente — evita loop infinito).
 */
const refetchAttempts = new Map<string, number>();

function MediaAutoRefetch({ msg, sticker }: { msg: WhatsappMensagem; sticker?: boolean }) {
  const refetch = useRefetchMedia();
  const [esgotou, setEsgotou] = useState(false);
  const [reintentando, setReintentando] = useState(false);

  useEffect(() => {
    const tentativas = refetchAttempts.get(msg.id) ?? 0;
    if (tentativas >= 2) {
      setEsgotou(true);
      return;
    }
    refetchAttempts.set(msg.id, tentativas + 1);
    refetch.mutate(msg.id, {
      onSettled: (res) => {
        if (!res?.ok) setEsgotou(true);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msg.id]);

  // Retry manual: zera o contador e tenta de novo. Útil porque o
  // download de mídia foi corrigido no backend depois das tentativas
  // automáticas — um toque pode recuperar o arquivo. Em sucesso, o
  // realtime atualiza mediaPath e o parent troca pro preview real.
  function tentarDeNovo() {
    setReintentando(true);
    refetchAttempts.set(msg.id, 0);
    refetch.mutate(msg.id, {
      onSettled: (res) => {
        setReintentando(false);
        if (res?.ok) setEsgotou(false);
      },
    });
  }

  if (esgotou) {
    const label =
      msg.tipo === "sticker"
        ? "Figurinha indisponível"
        : msg.tipo === "image"
          ? "Imagem indisponível"
          : msg.tipo === "video" || msg.tipo === "gif"
            ? "Vídeo indisponível"
            : msg.tipo === "audio"
              ? "Áudio indisponível"
              : "Arquivo indisponível";
    return (
      <div
        className={cn(
          "mb-1 px-2.5 py-2 rounded-md bg-background/30 border border-dashed border-border/60 text-xs text-muted-foreground/80",
          sticker
            ? "size-28 flex flex-col items-center justify-center text-center gap-1.5"
            : "inline-flex flex-col gap-1.5 min-w-[180px]",
        )}
      >
        <span className="inline-flex items-center gap-2">
          <ImageOff className="size-3.5 shrink-0" />
          <span>{label}</span>
        </span>
        <button
          type="button"
          onClick={tentarDeNovo}
          disabled={reintentando}
          className="inline-flex items-center gap-1 self-start text-2xs font-medium text-primary hover:underline disabled:opacity-60 disabled:no-underline"
        >
          {reintentando ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RefreshCw className="size-3" />
          )}
          {reintentando ? "Tentando…" : "Tentar de novo"}
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "bg-muted rounded-md animate-pulse mb-1",
        sticker ? "size-28" : "size-40",
      )}
    />
  );
}

function useSignedUrl(path: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    mediaSignedUrl(path).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [path]);
  return url;
}

/** Miniatura da mídia citada (foto/vídeo/sticker) exibida na citação do
 *  reply — espelha o WhatsApp, que mostra um thumbzinho ao lado do rótulo. */
function QuotedThumb({ msg }: { msg: WhatsappMensagem }) {
  const ehVisual =
    msg.tipo === "image" ||
    msg.tipo === "video" ||
    msg.tipo === "gif" ||
    msg.tipo === "sticker";
  const url = useSignedUrl(ehVisual ? msg.mediaPath : null);
  if (!ehVisual || !msg.mediaPath) return null;
  if (!url) {
    return <div className="size-10 rounded bg-muted animate-pulse shrink-0" />;
  }
  if (msg.tipo === "video" || msg.tipo === "gif") {
    return (
      <video
        src={url}
        muted
        preload="metadata"
        className="size-10 rounded object-cover shrink-0"
      />
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      className="size-10 rounded object-cover shrink-0"
    />
  );
}

/** Monta o MediaItem do visualizador a partir de uma mensagem de mídia. */
function msgMediaItem(msg: WhatsappMensagem, url: string) {
  return {
    url,
    name: msg.mediaNomeArquivo ?? undefined,
    mimeType: msg.mediaMime ?? undefined,
    size: msg.mediaTamanho ?? undefined,
  };
}

function ImagePreview({
  msg,
  sticker,
}: {
  msg: WhatsappMensagem;
  sticker?: boolean;
}) {
  const url = useSignedUrl(msg.mediaPath);

  if (!url) {
    return (
      <div className="size-40 bg-muted rounded-md animate-pulse mb-1" />
    );
  }
  return (
    <button
      type="button"
      onClick={() => openMediaViewer([msgMediaItem(msg, url)])}
      className="block mb-1 cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-primary rounded-md"
      aria-label="Ampliar imagem"
    >
      <img
        src={url}
        alt={msg.mediaNomeArquivo ?? ""}
        className={cn(
          "rounded-md object-cover",
          // Cap estilo WhatsApp. Usa LARGURA fixa (w-[330px]) + max-w-full em
          // vez de max-w-[min(330px,100%)]: o `100%` dentro do min() fazia o
          // navegador reservar a largura toda do balão no desktop, deixando a
          // foto encostada à esquerda num balão gigante vazio. Largura fixa
          // faz o balão abraçar a foto; max-w-full mantém responsivo no mobile.
          sticker ? "size-28" : "w-[330px] max-w-full h-auto max-h-72",
        )}
        loading="lazy"
      />
    </button>
  );
}

function VideoPreview({ msg }: { msg: WhatsappMensagem }) {
  const url = useSignedUrl(msg.mediaPath);
  if (!url) {
    return (
      <div className="size-40 bg-muted rounded-md animate-pulse mb-1 grid place-items-center">
        <Play className="size-6 text-muted-foreground" />
      </div>
    );
  }
  return (
    <div className="relative mb-1 w-fit group/video">
      <video
        src={url}
        controls
        className="rounded-md w-[330px] max-w-full h-auto max-h-72 block"
        preload="metadata"
      />
      <button
        type="button"
        onClick={() => openMediaViewer([msgMediaItem(msg, url)])}
        className="absolute top-1.5 right-1.5 grid place-items-center size-7 rounded-full bg-black/45 hover:bg-black/65 text-primary-foreground opacity-0 group-hover/video:opacity-100 focus:opacity-100 transition-opacity"
        aria-label="Abrir em tela cheia"
        title="Tela cheia"
      >
        <Maximize2 className="size-3.5" />
      </button>
    </div>
  );
}

// Gera alturas de barra "estáveis" (0.25..1) a partir do id da mensagem,
// para cada áudio ter um desenho de onda próprio e consistente entre renders.
const NUM_ONDAS = 34;
function gerarOndas(seed: string): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const ondas: number[] = [];
  for (let i = 0; i < NUM_ONDAS; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    ondas.push(0.25 + (h % 1000) / 1000 * 0.75);
  }
  return ondas;
}

function AudioPreview({ msg }: { msg: WhatsappMensagem }) {
  const url = useSignedUrl(msg.mediaPath);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [playing, setPlaying] = useState(false);
  const [duracao, setDuracao] = useState(0);
  const [posicao, setPosicao] = useState(0);
  const [velocidade, setVelocidade] = useState<1 | 1.5 | 2>(1);
  const ondas = useMemo(() => gerarOndas(msg.id), [msg.id]);

  // Própria (balão primary, texto claro) vs recebida (card branco). As cores
  // do player herdam disso para não brigar com o fundo — bronze fixo sobre o
  // primary ficava horrível.
  const direita = msg.fromMe;

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    // defaultPlaybackRate + playbackRate: alguns browsers resetam o
    // playbackRate pro default (1×) quando o áudio termina de carregar.
    // Setar os dois (e re-asseverar no onPlay/onLoadedMetadata abaixo)
    // garante que 1.5×/2× peguem de fato.
    a.defaultPlaybackRate = velocidade;
    a.playbackRate = velocidade;
  }, [velocidade, url]);

  if (!url) {
    return (
      <div className="flex items-center gap-2.5 mb-1 min-w-[min(220px,calc(78vw-4.5rem))] py-1.5 px-1">
        <div
          className={cn(
            "size-9 rounded-full grid place-items-center",
            direita ? "bg-primary-foreground/20" : "bg-primary/15",
          )}
        >
          <Mic
            className={cn(
              "size-4 animate-pulse",
              direita ? "text-primary-foreground" : "text-primary",
            )}
          />
        </div>
        <div
          className={cn(
            "flex-1 h-1 rounded animate-pulse",
            direita ? "bg-primary-foreground/25" : "bg-foreground/10",
          )}
        />
      </div>
    );
  }

  function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      void a.play();
    } else {
      a.pause();
    }
  }

  function ciclarVelocidade() {
    setVelocidade((v) => (v === 1 ? 1.5 : v === 1.5 ? 2 : 1));
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const a = audioRef.current;
    if (!a || !duracao) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    a.currentTime = Math.max(0, Math.min(duracao, pct * duracao));
  }

  const pct = duracao > 0 ? posicao / duracao : 0;

  return (
    <div className="flex items-center gap-3 mb-1 min-w-[min(240px,calc(78vw-4.5rem))] py-1 px-0.5">
      <button
        type="button"
        onClick={togglePlay}
        className={cn(
          "size-9 shrink-0 rounded-full grid place-items-center transition-colors shadow-sm",
          direita
            ? "bg-primary-foreground text-primary hover:bg-primary-foreground/90"
            : "bg-primary text-primary-foreground hover:bg-primary/90",
        )}
        aria-label={playing ? "Pausar" : "Reproduzir"}
      >
        {playing ? (
          <Pause className="size-4 fill-current" />
        ) : (
          <Play className="size-4 fill-current translate-x-[1px]" />
        )}
      </button>

      <div className="flex-1 min-w-0 space-y-1.5">
        {/* Waveform: barras estáticas que "acendem" conforme toca, estilo
            WhatsApp. Clicar busca a posição. A barra atual pulsa enquanto
            reproduz. */}
        <div
          className="flex items-center gap-[2px] h-6 cursor-pointer"
          onClick={seek}
          role="slider"
          aria-label="Posição do áudio"
          aria-valuenow={Math.round(pct * 100)}
        >
          {ondas.map((alt, i) => {
            // Estrito: com pct = 0 nenhuma barra acende (no adv3 a primeira
            // ficava sempre acesa).
            const tocada = pct > 0 && i / NUM_ONDAS < pct;
            const atual =
              playing &&
              Math.floor(pct * NUM_ONDAS) === i;
            return (
              <span
                key={i}
                className={cn(
                  "flex-1 rounded-full transition-colors duration-150",
                  tocada
                    ? direita
                      ? "bg-primary-foreground"
                      : "bg-primary"
                    : direita
                      ? "bg-primary-foreground/30"
                      : "bg-foreground/15",
                  atual && "animate-pulse",
                )}
                style={{ height: `${Math.round(alt * 100)}%` }}
              />
            );
          })}
        </div>
        <div
          className={cn(
            "flex items-center justify-between text-2xs tabular-nums leading-none",
            direita ? "text-primary-foreground/70" : "text-muted-foreground",
          )}
        >
          <span>{formatDuracao(posicao)}</span>
          <span>{formatDuracao(duracao)}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={ciclarVelocidade}
        className={cn(
          "shrink-0 text-2xs font-bold tabular-nums px-1.5 py-0.5 rounded transition-colors",
          direita
            ? "bg-primary-foreground/15 hover:bg-primary-foreground/25 text-primary-foreground/90"
            : "bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground",
        )}
        title="Mudar velocidade de reprodução"
        aria-label={`Velocidade: ${velocidade}x`}
      >
        {velocidade}×
      </button>

      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onPlay={(e) => {
          setPlaying(true);
          // Re-assevera a velocidade no play (o browser pode ter
          // resetado pro default ao carregar a mídia).
          (e.target as HTMLAudioElement).playbackRate = velocidade;
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPosicao(0);
        }}
        onLoadedMetadata={(e) => {
          const a = e.target as HTMLAudioElement;
          if (Number.isFinite(a.duration)) setDuracao(a.duration);
          a.playbackRate = velocidade;
        }}
        onTimeUpdate={(e) =>
          setPosicao((e.target as HTMLAudioElement).currentTime)
        }
        className="hidden"
      />
    </div>
  );
}

function formatDuracao(s: number): string {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const seg = Math.floor(s % 60);
  return `${m}:${String(seg).padStart(2, "0")}`;
}

function DocumentPreview({ msg }: { msg: WhatsappMensagem }) {
  const url = useSignedUrl(msg.mediaPath);
  return (
    <div className="flex items-center gap-2 mb-1 min-w-[min(200px,calc(78vw-4.5rem))] bg-background/60 rounded-md p-2 border">
      <button
        type="button"
        disabled={!url}
        onClick={() => url && openMediaViewer([msgMediaItem(msg, url)])}
        className="flex items-center gap-2 flex-1 min-w-0 text-left group/doc disabled:cursor-default"
        aria-label="Abrir documento"
      >
        <FileIcon className="size-5 text-muted-foreground shrink-0 group-hover/doc:text-foreground transition-colors" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium truncate group-hover/doc:underline">
            {msg.mediaNomeArquivo ?? "Arquivo"}
          </p>
          {msg.mediaTamanho && (
            <p className="text-2xs text-muted-foreground">
              {formatBytes(msg.mediaTamanho)}
            </p>
          )}
        </div>
      </button>
      {url && (
        <Button asChild size="icon" variant="ghost" className="size-7 shrink-0">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Baixar ${msg.mediaNomeArquivo ?? "arquivo"}`}
            download={msg.mediaNomeArquivo ?? undefined}
          >
            <Download className="size-3.5" />
          </a>
        </Button>
      )}
    </div>
  );
}
