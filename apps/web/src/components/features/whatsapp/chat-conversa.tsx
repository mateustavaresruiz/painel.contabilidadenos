import { format, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertCircle,
  Download,
  Eraser,
  Loader2,
  Lock,
  LogOut,
  MessageSquare,
  MoreVertical,
  PanelRight,
  Trash2,
  Users,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "@/lib/toast";

import { Button } from "@/components/ui/button";
import { confirmar } from "@/components/ui/confirm-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { openMediaViewer } from "@/components/ui/media-viewer";
import { ConversaTagsBotao } from "@/components/features/whatsapp/conversa-tags";
import {
  AtendimentoAcoes,
  DivisorTransferencia,
} from "@/components/features/atendimento/atendimento-acoes";
import { ClientContextPanel } from "@/components/features/inbox/client-context-panel";
import {
  NovaSolicitacaoDialog,
  SolicitacaoBotaoSeAtivo,
  type OrigemSolicitacao,
} from "@/components/features/solicitacoes/solicitacao-ui";
import { useColaboradoresMap, useEu } from "@/lib/colaborador";
import { msgErro } from "@/lib/erro";
import { formatTelefone, parsePgTimestamp } from "@/lib/format";
import { useTransferencias, useWhatsappChatAberto } from "@/lib/queries/atendimento";
import { AvatarIniciais } from "@/components/avatar-iniciais";
import { avatarFicticio } from "@/lib/avatar-ficticio";
import { iniciaisDeContato } from "@/lib/iniciais";
import { cn } from "@/lib/utils";
import {
  mediaSignedUrl,
  useApagarChat,
  useBackfillParticipantes,
  useLimparChat,
  useMarcarChatLido,
  useMensagens,
  useQuotedMensagens,
  useRefetchMedias,
  useRefreshContact,
  useRefreshFotos,
  useRefreshGrupoPermissao,
  useSairDoGrupo,
  useSubscribePresence,
  useVincularChatCliente,
  useWhatsappContatos,
  type WhatsappChat,
  type WhatsappMensagem,
  type WhatsappSessao,
} from "@/lib/queries/whatsapp";

import { Composer } from "./composer";
import { DownloadConversaDialog } from "./download-conversa-dialog";
import { MessageBubble } from "./message-bubble";

type Props = {
  /** Sessão da conversa aberta — pode estar undefined no estado inicial. */
  sessaoId: string | undefined;
  chatId: string | undefined;
  /** Todas as sessões (pra mostrar "via X" no header). */
  sessoes: WhatsappSessao[];
  /** Texto pré-preenchido no campo (ex.: "Parabenizar no WhatsApp"). */
  textoInicial?: string;
};

// Sincronizações de background (marcar lido, refresh de perfil/fotos,
// backfill, refetch de mídia, permissão de grupo) são ADIADAS por esse
// tempo ao abrir um chat, e canceladas se o usuário trocar de conversa
// antes. Assim, passar o olho rápido por várias conversas não dispara uma
// enxurrada de requests (o "alagamento" + travada ao transitar).
const SYNC_DIFERIDO_MS = 600;

export function ChatConversa({ sessaoId, chatId, sessoes, textoInicial }: Props) {
  const sessao = sessoes.find((s) => s.id === sessaoId);
  // A conversa aberta vem por id, não da lista (defeito 6 do adv3).
  const { data: chatAberto } = useWhatsappChatAberto(sessaoId, chatId);
  const chat = chatAberto ?? undefined;
  const colaboradores = useColaboradoresMap();
  const { data: transferencias = [] } = useTransferencias(chat?.id);
  // "Abrir chamado a partir desta mensagem"
  const [solicitacaoDaMsg, setSolicitacaoDaMsg] = useState<OrigemSolicitacao | null>(null);

  const {
    data,
    isLoading,
    isError,
    refetch,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useMensagens(sessaoId, chatId);

  const marcarLido = useMarcarChatLido(sessaoId);
  const limpar = useLimparChat(sessaoId);
  const apagar = useApagarChat(sessaoId);
  const vincular = useVincularChatCliente();
  const { tem } = useEu();
  const sairGrupo = useSairDoGrupo(sessaoId);
  const refresh = useRefreshContact(sessaoId);
  const backfill = useBackfillParticipantes();
  const refetchMedias = useRefetchMedias();
  const refreshFotos = useRefreshFotos();
  const refreshGrupoPermissao = useRefreshGrupoPermissao();
  const subscribePresence = useSubscribePresence();
  const [, setSearchParams] = useSearchParams();
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const ultimoMsgRef = useRef<string | null>(null);
  // "Grudar no fim": enquanto ligado, qualquer crescimento de altura do
  // conteúdo (imagens/áudios carregando depois do paint) re-ancora no fim.
  // Liga ao abrir a conversa e ao enviar; desliga quando o usuário rola pra
  // cima. É o que garante "abrir sempre lá embaixo, no limite".
  const grudarFimRef = useRef(true);
  // Timestamp (ms) até quando estamos "ancorando no fim": dentro dessa janela
  // o handleScroll ignora scrolls programáticos (pin/ResizeObserver) pra não
  // soltar o grudar cedo demais. Ver scrollParaFim/handleScroll.
  const ancorandoAteRef = useRef(0);
  // Ancoragem ao carregar mensagens antigas (prepend no topo): guarda a
  // métrica de scroll ANTES de buscar e restaura depois — senão a lista
  // "pula" pra cima quando as antigas entram no topo.
  const carregandoAntigasRef = useRef(false);
  const prevScrollHeightRef = useRef(0);
  const prevScrollTopRef = useRef(0);
  // Painel do cliente começa FECHADO — abre como overlay sobre a conversa
  // pelo botão do header (não encolhe mais a conversa).
  const [painelAberto, setPainelAberto] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);

  async function handleLimpar() {
    if (!chatId) return;
    setMenuOpen(false);
    if (
      !(await confirmar({
        titulo: "Limpar mensagens?",
        descricao:
          "Apaga todas as mensagens desta conversa do banco e tenta limpar no WhatsApp também. A conversa permanece na lista. Esta ação não pode ser desfeita.",
        destructive: true,
        confirmLabel: "Limpar mensagens",
      }))
    ) {
      return;
    }
    try {
      await limpar.mutateAsync(chatId);
      toast.success("Mensagens apagadas.");
    } catch (err) {
      toast.error(msgErro(err));
    }
  }

  async function handleApagar() {
    if (!chatId) return;
    setMenuOpen(false);
    if (
      !(await confirmar({
        titulo: "Apagar conversa?",
        descricao:
          "Remove a conversa, todas as mensagens e o vínculo com cliente. Tenta apagar também no WhatsApp do número conectado. Esta ação não pode ser desfeita.",
        destructive: true,
        confirmLabel: "Apagar conversa",
      }))
    ) {
      return;
    }
    try {
      await apagar.mutateAsync(chatId);
      toast.success("Conversa apagada.");
      // Limpa ?chat=... pra voltar pro estado "nenhuma conversa aberta"
      setSearchParams(
        (curr) => {
          const next = new URLSearchParams(curr);
          next.delete("chat");
          next.delete("instancia");
          return next;
        },
        { replace: true },
      );
    } catch (err) {
      toast.error(msgErro(err));
    }
  }

  async function handleSairGrupo() {
    if (!chatId) return;
    setMenuOpen(false);
    if (
      !(await confirmar({
        titulo: "Sair do grupo?",
        descricao:
          "O número conectado deixa o grupo no WhatsApp e a conversa é removida da inbox. Para voltar, alguém precisa te adicionar de novo.",
        destructive: true,
        confirmLabel: "Sair do grupo",
      }))
    ) {
      return;
    }
    try {
      await sairGrupo.mutateAsync(chatId);
      toast.success("Você saiu do grupo.");
      setSearchParams(
        (curr) => {
          const next = new URLSearchParams(curr);
          next.delete("chat");
          next.delete("instancia");
          return next;
        },
        { replace: true },
      );
    } catch (err) {
      toast.error(msgErro(err));
    }
  }

  // Achata páginas (vêm em ordem desc → inverte pra exibir asc).
  // parsePgTimestamp no sort é OBRIGATÓRIO: o banco manda timestamp naive
  // (UTC sem Z → new Date lê como local, +3h no BR) e a msg otimista usa
  // ISO com Z (epoch correto). Misturar os dois com new Date() cru fazia a
  // msg recém-enviada ordenar ~3h "no passado", aparecendo acima das
  // recebidas — parsePgTimestamp normaliza ambos pro epoch UTC real.
  const mensagens = useMemo(() => {
    const flat = (data?.pages ?? []).flat() as WhatsappMensagem[];
    return [...flat].sort((a, b) => {
      // Mensagens otimistas (recém-enviadas, ainda sem eco do servidor) ficam
      // SEMPRE no fim, na ordem de envio. Sem isso, o timestamp do relógio do
      // CLIENTE da fantasma competia com o do SERVIDOR das já confirmadas e,
      // com o skew sub-segundo, a 2ª msg "pulava" pra cima da 1ª e depois
      // voltava quando o realtime trocava pela linha do banco.
      const pa = a._pendente ? 1 : 0;
      const pb = b._pendente ? 1 : 0;
      if (pa !== pb) return pa - pb;
      const ta = parsePgTimestamp(a.timestamp)?.getTime() ?? 0;
      const tb = parsePgTimestamp(b.timestamp)?.getTime() ?? 0;
      if (ta !== tb) return ta - tb;
      // Mesmo timestamp (WhatsApp dá precisão de SEGUNDOS): desempata pela
      // ordem de criação (monotônica) e, por fim, pelo id — ordenação estável
      // que não "treme" entre re-renders.
      const ca = parsePgTimestamp(a.criadoEm)?.getTime() ?? 0;
      const cb = parsePgTimestamp(b.criadoEm)?.getTime() ?? 0;
      if (ca !== cb) return ca - cb;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }, [data]);

  // Coleta IDs únicos pra buscar nome+foto de cada um (WhatsappContato
  // cacheado pelo webhook):
  //   - Em grupo: remetentes das mensagens visíveis
  //   - Em qualquer chat: menções `@<digits>` no texto (tenta tanto
  //     <digits>@c.us quanto <digits>@lid, porque a menção crua não
  //     diz qual sufixo o WhatsApp usou)
  const contatoIds = useMemo(() => {
    const ids = new Set<string>();
    if (chat?.tipo === "group") {
      for (const m of mensagens) {
        if (!m.fromMe && m.remetenteJid) ids.add(m.remetenteJid);
      }
    }
    // Menções tanto no corpo quanto na citação do reply — a citação também
    // precisa converter `@<lid>` pra nome/telefone.
    for (const m of mensagens) {
      for (const fonte of [m.texto, m.replyToTexto]) {
        if (!fonte) continue;
        for (const match of fonte.matchAll(/@(\d{6,})/g)) {
          const digits = match[1]!;
          ids.add(`${digits}@c.us`);
          ids.add(`${digits}@lid`);
        }
      }
    }
    return [...ids];
  }, [mensagens, chat?.tipo]);
  const { data: contatosMap } = useWhatsappContatos(contatoIds);

  const resolveMencao = useCallback(
    (digits: string) => {
      if (!contatosMap) return null;
      // Menção pode carregar tanto LID quanto telefone — tenta os dois
      // formatos contra ambos os índices.
      const c =
        contatosMap.porLidId.get(`${digits}@lid`) ??
        contatosMap.porContatoId.get(`${digits}@c.us`) ??
        contatosMap.porContatoId.get(`${digits}@lid`);
      if (!c) return null;
      // Hierarquia: Cliente vinculado > pushName do WhatsApp > telefone
      // formatado. Cair pro telefone é bem melhor que mostrar o LID cru
      // pro usuário — pelo menos ele consegue identificar quem é.
      const nomeLegivel = c.nome?.trim() || c.pushName?.trim();
      const label = nomeLegivel
        ? nomeLegivel
        : c.numero
          ? formatTelefoneMencao(c.numero)
          : null;
      if (!label) return null;
      // contatoId fica preenchido só quando temos um @c.us — é o que
      // permite clicar e abrir a conversa direta. Contato ainda em @lid
      // (mapping não resolveu) vira label sem link.
      const contatoId = c.contatoId.endsWith("@c.us") ? c.contatoId : null;
      return { label, contatoId };
    },
    [contatosMap],
  );

  // Click na menção troca o chat aberto no sidebar, na mesma sessão
  // da mensagem clicada. Se o chat ainda não existe na lista (contato
  // nunca conversou direto com a gente), o painel fica vazio até a
  // primeira mensagem — mesmo comportamento do WhatsApp ao iniciar
  // contato novo via menção.
  const handleMencaoClick = useCallback(
    (contatoId: string) => {
      if (!sessaoId) return;
      setSearchParams(
        (curr) => {
          const next = new URLSearchParams(curr);
          next.set("instancia", sessaoId);
          next.set("chat", contatoId);
          return next;
        },
        { replace: true },
      );
    },
    [sessaoId, setSearchParams],
  );

  // Reply (citação) selecionado pelo usuário — preenche o composer.
  const [replyTo, setReplyTo] = useState<{ wamId: string; texto: string } | null>(
    null,
  );
  const handleReply = useCallback(
    (reply: { wamId: string; texto: string }) => setReplyTo(reply),
    [],
  );
  const chatRowId = chat?.id;
  const chatClienteId = chat?.clienteId ?? null;
  const handleCriarSolicitacao = useCallback(
    (m: WhatsappMensagem) =>
      setSolicitacaoDaMsg({
        chatRowId: chatRowId ?? null,
        clienteId: chatClienteId,
        mensagemId: m.id,
        descricao: m.texto ?? null,
      }),
    [chatRowId, chatClienteId],
  );
  // Trocar de chat limpa a citação pendente (não vaza pro próximo chat).
  useEffect(() => {
    setReplyTo(null);
  }, [chatId]);

  // Quando entra num chat com unread, marca como lido IMEDIATAMENTE — a
  // mutation é otimista (zera a bolinha na hora), então não há motivo pra
  // adiar. Entrar num chat é sempre um clique deliberado (a rota muda), não
  // um "passar o olho", então não há risco de marcar em trânsito.
  useEffect(() => {
    if (!chatId || !chat || chat.naoLidas <= 0) return;
    marcarLido.mutate(chatId);
    // O marcar-lido otimista mexe na lista; a conversa aberta zera aqui.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, chat?.naoLidas]);

  // Refresh do perfil quando entra num chat que tá faltando dados
  // básicos. Caso típico: grupo recém-criado no banco com nome=null,
  // OU grupo marcado __none__ antes do PR #162 (que adicionou
  // getGroupPicture). __none__ é truthy, então o teste anterior
  // `!chat.fotoPath` falhava — agora trata explicitamente.
  const refreshDisparadoRef = useRef<string | null>(null);
  useEffect(() => {
    if (!chatId || !chat || !sessaoId) return;
    if (refreshDisparadoRef.current === chatId) return; // já disparei neste chatId
    const semFoto = !chat.fotoPath || chat.fotoPath === "__none__";
    const faltaInfo = !chat.nome || (chat.tipo === "group" && semFoto);
    if (!faltaInfo) return;
    const t = setTimeout(() => {
      refreshDisparadoRef.current = chatId;
      refresh.mutate(chatId);
    }, SYNC_DIFERIDO_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, sessaoId, chat?.nome, chat?.fotoPath, chat?.tipo]);

  // Backfill de participantes ao abrir um grupo: resolve @lid → @c.us
  // pra mensagens antigas (antes do fix do webhook). Dispara 1x por
  // grupo, em background — usuário vê os nomes aparecendo conforme o
  // backend atualiza + invalida a query de mensagens.
  const backfillDisparadoRef = useRef<string | null>(null);
  useEffect(() => {
    if (!chatId || !sessaoId || chat?.tipo !== "group") return;
    if (backfillDisparadoRef.current === chatId) return;
    const t = setTimeout(() => {
      backfillDisparadoRef.current = chatId;
      backfill.mutate({ sessaoId, chatId });
    }, SYNC_DIFERIDO_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, sessaoId, chat?.tipo]);

  // Bulk refetch de mídia (figurinhas/imagens/etc) que falharam de
  // baixar no webhook. Dispara 1x por chat ao abrir — mais robusto
  // que esperar cada bubble disparar refetch individual via realtime.
  const refetchMediasDisparadoRef = useRef<string | null>(null);
  useEffect(() => {
    if (!chatId || !sessaoId) return;
    if (refetchMediasDisparadoRef.current === chatId) return;
    const t = setTimeout(() => {
      refetchMediasDisparadoRef.current = chatId;
      refetchMedias.mutate({ sessaoId, chatId });
    }, SYNC_DIFERIDO_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, sessaoId]);

  // Force-refresh de fotos (chat + participantes). Limpa __none__
  // antigos e re-baixa via endpoints dedicados do WAHA (groups/{id}/picture
  // pro grupo, contacts/profile-picture pra cada membro). 1x por chatId.
  const refreshFotosDisparadoRef = useRef<string | null>(null);
  useEffect(() => {
    if (!chatId || !sessaoId) return;
    if (refreshFotosDisparadoRef.current === chatId) return;
    const t = setTimeout(() => {
      refreshFotosDisparadoRef.current = chatId;
      refreshFotos.mutate({ sessaoId, chatId });
    }, SYNC_DIFERIDO_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, sessaoId]);

  // Permissão de envio do grupo (announce/admin ou removido). 1x por
  // chatId de grupo — self-heal caso um evento group.v2.* tenha sido
  // perdido. Realtime de WhatsappChat reflete o resultado na UI.
  const permGrupoDisparadoRef = useRef<string | null>(null);
  useEffect(() => {
    if (!chatId || !sessaoId || chat?.tipo !== "group") return;
    if (permGrupoDisparadoRef.current === chatId) return;
    const t = setTimeout(() => {
      permGrupoDisparadoRef.current = chatId;
      refreshGrupoPermissao.mutate({ sessaoId, chatId });
    }, SYNC_DIFERIDO_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, sessaoId, chat?.tipo]);

  // Assina a presença do contato individual ao abrir — sem isso a engine
  // GOWS não emite presence.update. Deferido + 1x por chatId. O header
  // mostra "digitando…/online" via realtime do WhatsappChat.
  const presencaDisparadaRef = useRef<string | null>(null);
  useEffect(() => {
    if (!chatId || !sessaoId || chat?.tipo !== "individual") return;
    if (presencaDisparadaRef.current === chatId) return;
    const t = setTimeout(() => {
      presencaDisparadaRef.current = chatId;
      subscribePresence.mutate({ sessaoId, chatId });
    }, SYNC_DIFERIDO_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, sessaoId, chat?.tipo]);

  // Lista NÃO virtualizada de propósito: a paginação (PAGE_SIZE) limita o
  // DOM e o MessageBubble é memoizado, então renderizar em fluxo natural é
  // barato — e MUITO mais estável que virtualizar com medição dinâmica
  // (que reposicionava as bubbles via translateY ao medir, causando o
  // "pisca/trava/volta" ao abrir/trocar de conversa).

  // --- Scroll pro fim ------------------------------------------------
  // Ancora no fim só em momentos intencionais (abrir conversa / msg nova
  // estando perto do fim), NUNCA a cada render — senão o usuário fica
  // preso embaixo e não consegue rolar pra cima.
  //
  // Re-tenta por alguns frames (rAF) pra absorver a medição das bubbles:
  // elas têm altura variável (imagem, áudio, texto longo) e só são
  // medidas pelo DOM depois de renderizar, então um único scroll pararia
  // "um pouco acima" da última msg. Aborta se o usuário rolar pra longe
  // no meio do caminho (exceto envio próprio, que sempre desce).
  const scrollParaFim = useCallback((forcar = false) => {
    // Janela de ancoragem: por ~1.2s qualquer crescimento de altura
    // (imagens/áudios/thumbs de citação carregando depois do paint) re-ancora
    // no fim, e o handleScroll IGNORA os scrolls programáticos do pin. Sem
    // isso, o onContent disparado pelo próprio pin soltava o "grudar no fim"
    // cedo demais e a conversa abria parada no meio.
    ancorandoAteRef.current = Date.now() + 1200;
    // Pin SÍNCRONO imediato (frame 0): chamado de useLayoutEffect, ancora no
    // fim ANTES do paint — mata o flash "começa no topo e pula pro fim" ao
    // abrir/trocar de conversa. O loop de rAF abaixo só absorve a medição.
    {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
    let frames = 0;
    const passo = () => {
      const el = scrollRef.current;
      if (!el) return;
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (!forcar && frames > 0 && dist > 400) return; // usuário rolou
      el.scrollTop = el.scrollHeight;
      if (frames++ < 8) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  }, []);

  // Ao trocar de chat, marca pra ancorar no fim assim que as mensagens
  // chegarem (efeito declarado ANTES do de mensagens pra rodar primeiro).
  const ancorarRef = useRef(false);
  useLayoutEffect(() => {
    ancorarRef.current = true;
    ultimoMsgRef.current = null;
  }, [chatId]);

  // Decide o scroll quando as mensagens mudam: primeira leva do chat
  // ancora no fim; msg nova só desce se eu enviei OU já estava no fim.
  // Quem está lendo histórico não é arrancado de lá.
  useLayoutEffect(() => {
    const ultima = mensagens[mensagens.length - 1];
    if (!ultima) return;

    if (ancorarRef.current) {
      ancorarRef.current = false;
      ultimoMsgRef.current = ultima.id;
      grudarFimRef.current = true;
      scrollParaFim(true);
      return;
    }

    if (ultima.id !== ultimoMsgRef.current) {
      ultimoMsgRef.current = ultima.id;
      const el = scrollRef.current;
      const pertoDoFim = el
        ? el.scrollHeight - el.scrollTop - el.clientHeight < 160
        : false;
      if (ultima.fromMe || pertoDoFim) {
        grudarFimRef.current = true;
        scrollParaFim(ultima.fromMe);
      }
    }
  }, [mensagens, scrollParaFim]);

  // Atualiza o "grudar no fim" conforme o usuário rola: perto do fim → mantém
  // ancorado; rolou pra cima → solta (não arranca quem lê o histórico).
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Durante a janela de ancoragem (logo após abrir/descer), os scrolls são
    // programáticos (pin + ResizeObserver) — não solta o "grudar no fim".
    if (Date.now() < ancorandoAteRef.current) return;
    grudarFimRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  // Índice wamId → mensagem, pra resolver a mídia/preview da citação e
  // permitir "pular" pra mensagem original ao clicar no reply.
  const msgPorWamId = useMemo(() => {
    const m = new Map<string, WhatsappMensagem>();
    for (const msg of mensagens) if (msg.wamId) m.set(msg.wamId, msg);
    return m;
  }, [mensagens]);

  // Citações cujo alvo NÃO está na janela carregada — resolvidas por wamId
  // direto no banco. É o que faz a miniatura REAL da citação aparecer (e o
  // clique abrir a imagem) mesmo respondendo a uma foto de uma página antiga,
  // sem depender de paginar tudo até ela.
  const wamIdsCitadosFaltando = useMemo(() => {
    const faltando = new Set<string>();
    for (const msg of mensagens) {
      if (msg.replyToWamId && !msgPorWamId.has(msg.replyToWamId)) {
        faltando.add(msg.replyToWamId);
      }
    }
    return [...faltando];
  }, [mensagens, msgPorWamId]);
  const { data: quotedExtra } = useQuotedMensagens(
    sessaoId,
    wamIdsCitadosFaltando,
  );

  // Resolve a mensagem citada por wamId: primeiro na janela carregada; senão
  // no fetch dedicado acima.
  const resolverCitada = useCallback(
    (wamId: string): WhatsappMensagem | null =>
      msgPorWamId.get(wamId) ?? quotedExtra?.get(wamId) ?? null,
    [msgPorWamId, quotedExtra],
  );

  // Click na citação: leva à mensagem original. Em ordem:
  //  1) já carregada → rola e CENTRALIZA, com realce breve;
  //  2) fora da janela e é mídia visual → abre a imagem/vídeo direto no
  //     visualizador (1 clique "leva à imagem", sem paginar);
  //  3) fora da janela e é texto → pagina as antigas até a original entrar no
  //     DOM (com teto), então rola/realça.
  const irParaMensagem = useCallback(
    async (wamId: string) => {
      const root = scrollRef.current;
      if (!root) return;
      const achar = () =>
        root.querySelector(
          `[data-wamid="${CSS.escape(wamId)}"]`,
        ) as HTMLElement | null;
      const realcar = (el: HTMLElement) => {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add(
          "ring-2",
          "ring-primary",
          "rounded-lg",
          "transition-shadow",
        );
        window.setTimeout(() => {
          el.classList.remove(
            "ring-2",
            "ring-primary",
            "rounded-lg",
            "transition-shadow",
          );
        }, 1600);
      };

      // 1) Já no DOM.
      let el = achar();
      if (el) {
        realcar(el);
        return;
      }

      // 2) Fora da janela e mídia visual com arquivo → abre no visualizador.
      const alvo = resolverCitada(wamId);
      if (
        alvo?.mediaPath &&
        (alvo.tipo === "image" ||
          alvo.tipo === "video" ||
          alvo.tipo === "gif" ||
          alvo.tipo === "sticker")
      ) {
        const url = await mediaSignedUrl(alvo.mediaPath);
        if (url) {
          openMediaViewer([
            {
              url,
              name: alvo.mediaNomeArquivo ?? undefined,
              mimeType: alvo.mediaMime ?? undefined,
              size: alvo.mediaTamanho ?? undefined,
            },
          ]);
          return;
        }
      }

      // 3) Pagina as antigas até a original aparecer. Saímos do "grudar no
      //    fim" (estamos navegando pra cima) e preservamos a posição de
      //    leitura a cada prepend via carregandoAntigasRef.
      grudarFimRef.current = false;
      const esperarPaint = () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      let tentativas = 0;
      while (!el && hasNextPage && tentativas < 20) {
        const sc = scrollRef.current;
        if (sc) {
          prevScrollHeightRef.current = sc.scrollHeight;
          prevScrollTopRef.current = sc.scrollTop;
          carregandoAntigasRef.current = true;
        }
        await fetchNextPage();
        await esperarPaint();
        el = achar();
        tentativas++;
      }
      if (el) {
        realcar(el);
      } else {
        toast.info("Mensagem original não está mais carregada.");
      }
    },
    [resolverCitada, hasNextPage, fetchNextPage],
  );

  // Imagens/áudios têm altura ASSÍNCRONA: o pin inicial roda antes de medir,
  // então a conversa abria "um pouco acima" do fim. O ResizeObserver re-ancora
  // a cada crescimento do conteúdo enquanto estamos grudados no fim.
  useEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const ro = new ResizeObserver(() => {
      if (grudarFimRef.current && !carregandoAntigasRef.current) {
        scroller.scrollTop = scroller.scrollHeight;
      }
    });
    ro.observe(content);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, mensagens.length === 0]);

  // Carregar mensagens antigas: captura a métrica de scroll ANTES de buscar
  // (o useLayoutEffect abaixo restaura a posição depois do prepend).
  const carregarAntigas = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      prevScrollHeightRef.current = el.scrollHeight;
      prevScrollTopRef.current = el.scrollTop;
      carregandoAntigasRef.current = true;
    }
    fetchNextPage();
  }, [fetchNextPage]);

  // Restaura a posição de leitura após o prepend das antigas: soma o quanto
  // a lista cresceu no topo ao scrollTop anterior, mantendo na tela a mesma
  // mensagem que o usuário estava lendo (sem o "pulo" pra cima).
  useLayoutEffect(() => {
    if (!carregandoAntigasRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop =
      prevScrollTopRef.current +
      (el.scrollHeight - prevScrollHeightRef.current);
    carregandoAntigasRef.current = false;
  }, [mensagens]);

  if (!chatId) {
    return (
      <div className="flex-1 grid place-items-center bg-muted/30">
        <div className="text-center max-w-[280px] px-6">
          <div className="mx-auto mb-5 size-16 rounded-full bg-card border border-border grid place-items-center shadow-sm">
            <MessageSquare className="size-7 text-primary" />
          </div>
          <p className="text-lg font-medium text-foreground mb-1.5">
            Suas conversas
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Selecione uma conversa à esquerda pra abrir.
            Mensagens chegam em tempo real conforme o WhatsApp recebe.
          </p>
        </div>
      </div>
    );
  }

  const grupo = chat?.tipo === "group" || chatId.endsWith("@g.us");
  const ehLid = chatId.endsWith("@lid");
  const numero = ehLid ? null : chatId.replace("@c.us", "").replace("@g.us", "");
  // Header da conversa: mesmo fallback do sidebar — usa os últimos
  // 5 chars do chatId (sem o "@g.us") porque todo grupo começa com
  // o prefixo comum "120363...". @lid não é telefone: não mostra o JID cru.
  const nome =
    chat?.nome ??
    (grupo
      ? `Grupo · ${chatId.replace("@g.us", "").slice(-5)}`
      : ehLid
        ? "Contato do WhatsApp"
        : formatTelefone(numero));


  return (
    <div className="flex-1 flex min-w-0 h-full min-h-0 overflow-hidden relative">
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {/* Header — gradient sutil pra dar profundidade
            visual sem cair em "WhatsApp-clone". */}
        <div
          className={cn(
            "shrink-0 border-b flex items-center gap-3 px-4 py-2.5",
            "bg-gradient-to-r from-foreground/[0.04] via-card/40 to-card/30",
          )}
        >
          <ConversaAvatar
            semente={chat?.chatId ?? nome}
            nome={chat?.nome}
            grupo={grupo}
            fotoPath={chat?.fotoPath}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <p className="font-medium text-sm truncate leading-tight">
                {nome}
              </p>
              {chat?.clienteId ? (
                <span className="inline-flex items-center gap-1 text-[9.5px] font-medium bg-muted text-foreground rounded-full px-1.5 py-0.5 leading-none shrink-0">
                  <span className="size-1 rounded-full bg-foreground" aria-hidden />
                  Cliente
                </span>
              ) : null}
            </div>
            <LinhaPresenca chat={chat} />
            {/* Linha "via {instância}" — sempre visível pra deixar claro
                por qual número essa conversa está rodando. Importante
                principalmente em escritórios com 2+ instâncias. */}
            {sessao && (
              <div className="flex items-center gap-1.5 mt-1 text-2xs text-muted-foreground/80">
                <span
                  className={cn(
                    "size-1.5 rounded-full shrink-0",
                    sessao.status === "WORKING" &&
                      "bg-foreground ring-2 ring-foreground/25",
                    sessao.status === "STARTING" && "bg-foreground/60 animate-pulse",
                    sessao.status === "FAILED" && "bg-destructive",
                    sessao.status === "STOPPED" && "bg-muted-foreground/40",
                  )}
                  aria-hidden
                />
                <span className="truncate">
                  via{" "}
                  <span className="font-medium text-foreground/70">
                    {sessao.apelido ??
                      formatHeaderNumero(sessao.numero) ??
                      "WhatsApp"}
                  </span>
                  {sessao.status === "WORKING" && (
                    <span className="text-muted-foreground"> · Online</span>
                  )}
                </span>
              </div>
            )}
          </div>
          {chat && !grupo ? <AtendimentoAcoes chat={chat} /> : null}
          {chat ? (
            <SolicitacaoBotaoSeAtivo origem={{ chatRowId: chat.id, clienteId: chat.clienteId }} />
          ) : null}
          {chat ? <ConversaTagsBotao chatId={chat.id} /> : null}
          {/* Botão do painel lateral só aparece em contato individual —
              em grupo não faz sentido (sem cliente vinculado). */}
          {!grupo && (
            <Tooltip
              label={painelAberto ? "Esconder painel" : "Mostrar painel do cliente"}
              side="bottom"
            >
              <button
                type="button"
                onClick={() => setPainelAberto((v) => !v)}
                className={cn(
                  "hidden md:grid place-items-center size-9 rounded-md transition-colors",
                  painelAberto
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
                aria-label="Alternar painel do cliente"
                aria-pressed={painelAberto}
              >
                <PanelRight className="size-4" />
              </button>
            </Tooltip>
          )}

          {/* Menu de ações destrutivas (limpar / apagar) */}
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="grid place-items-center size-9 rounded-md text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-colors"
                aria-label="Mais ações"
              >
                <MoreVertical className="size-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-1">
              {tem("whatsapp.exportar") && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setDownloadOpen(true);
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-accent text-left"
              >
                <Download className="size-4 text-muted-foreground" />
                Baixar conversa
              </button>
              )}
              {tem("whatsapp.apagar_mensagens") && (<>
              <div className="my-1 h-px bg-border/60" />
              <button
                type="button"
                onClick={handleLimpar}
                disabled={limpar.isPending}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-accent text-left disabled:opacity-50"
              >
                <Eraser className="size-4 text-muted-foreground" />
                Limpar mensagens
              </button>
              </>)}
              {chat?.tipo === "group" && tem("whatsapp.conexoes") ? (
                <button
                  type="button"
                  onClick={handleSairGrupo}
                  disabled={sairGrupo.isPending}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-destructive/10 text-destructive text-left disabled:opacity-50"
                >
                  <LogOut className="size-4" />
                  Sair do grupo
                </button>
              ) : null}
              {tem("whatsapp.apagar_mensagens") && (
              <button
                type="button"
                onClick={handleApagar}
                disabled={apagar.isPending}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-destructive/10 text-destructive text-left disabled:opacity-50"
              >
                <Trash2 className="size-4" />
                Apagar conversa
              </button>
              )}
            </PopoverContent>
          </Popover>
        </div>

      {/* Mensagens — scroll dedicado da conversa. Fundo limpo (cinza
          bem claro), sem ornamentos, no espírito minimalista/claro. */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className={cn(
          "flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain relative",
          "bg-muted/30",
        )}
      >
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : isError && mensagens.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
            <AlertCircle className="size-5 text-destructive" />
            Não foi possível carregar as mensagens.
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              Tentar de novo
            </Button>
          </div>
        ) : mensagens.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">
            Nenhuma mensagem ainda.
          </p>
        ) : (
          <div ref={contentRef} className="flex flex-col px-4 py-2">
            {hasNextPage && (
              <div className="text-center py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={carregarAntigas}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage ? (
                    <Loader2 className="size-3.5 animate-spin mr-1" />
                  ) : null}
                  Carregar mais antigas
                </Button>
              </div>
            )}
            {mensagens.map((m, i) => {
              const prev = mensagens[i - 1];
              // Transferências que aconteceram entre a mensagem anterior e
              // esta viram um divisor de sistema na linha do tempo.
              const tsM = parsePgTimestamp(m.timestamp)?.getTime() ?? 0;
              const tsPrev = prev ? (parsePgTimestamp(prev.timestamp)?.getTime() ?? 0) : -Infinity;
              const divisores = transferencias.filter((t) => {
                const tt = parsePgTimestamp(t.criadoEm)?.getTime() ?? 0;
                return tt > tsPrev && tt <= tsM && !m._pendente;
              });
              const dataM = parsePgTimestamp(m.timestamp) ?? new Date();
              const dataPrev = prev ? parsePgTimestamp(prev.timestamp) : null;
              const novoDia = !dataPrev || !isSameDay(dataPrev, dataM);
              // Agrupa por remetente estilo WhatsApp: mensagens seguidas da
              // mesma pessoa ficam coladas; troca de remetente ganha um
              // respiro em cima. Novo dia já é separado pelo divisor.
              const remetenteAtual = m.fromMe ? "me" : (m.remetenteJid ?? "outro");
              const remetenteAnterior = prev
                ? prev.fromMe
                  ? "me"
                  : (prev.remetenteJid ?? "outro")
                : null;
              const trocouRemetente =
                remetenteAnterior !== null &&
                remetenteAtual !== remetenteAnterior;
              // Animação de entrada só pra mensagens RECENTES (enviadas/
              // recebidas agora) — o histórico ao abrir a conversa não anima.
              // CSS animation roda uma vez no mount; re-renders não repetem.
              const recente =
                Date.now() - (parsePgTimestamp(m.timestamp)?.getTime() ?? 0) <
                6000;
              return (
                <Fragment key={m.id}>
                {divisores.map((t) => (
                  <DivisorTransferencia key={t.id} t={t} mapa={colaboradores} />
                ))}
                <div
                  data-wamid={m.wamId ?? undefined}
                  className={cn(
                    "pb-0.5",
                    !novoDia && trocouRemetente && "pt-2.5",
                    recente &&
                      "animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-out",
                  )}
                >
                  {novoDia && (
                    <div className="text-center my-3">
                      <span className="inline-block bg-card border rounded-full px-3 py-0.5 text-2xs uppercase tracking-wide text-muted-foreground">
                        {format(dataM, "d 'de' MMMM", { locale: ptBR })}
                      </span>
                    </div>
                  )}
                  <MessageBubble
                    msg={m}
                    ehGrupo={grupo}
                    mostrarRemetente={
                      grupo && shouldShowRemetente(m, mensagens, i)
                    }
                    contato={
                      grupo && m.remetenteJid
                        ? (contatosMap?.porContatoId.get(m.remetenteJid) ??
                          contatosMap?.porLidId.get(m.remetenteJid) ??
                          null)
                        : null
                    }
                    resolveMencao={resolveMencao}
                    onMencaoClick={handleMencaoClick}
                    onReply={handleReply}
                    quotedMsg={
                      m.replyToWamId ? resolverCitada(m.replyToWamId) : null
                    }
                    onQuotedClick={irParaMensagem}
                    onCriarSolicitacao={handleCriarSolicitacao}
                  />
                </div>
                </Fragment>
              );
            })}
            {/* Transferências depois da última mensagem. */}
            {transferencias
              .filter((t) => {
                const ultima = mensagens[mensagens.length - 1];
                const tu = ultima ? (parsePgTimestamp(ultima.timestamp)?.getTime() ?? 0) : -Infinity;
                return (parsePgTimestamp(t.criadoEm)?.getTime() ?? 0) > tu;
              })
              .map((t) => (
                <DivisorTransferencia key={t.id} t={t} mapa={colaboradores} />
              ))}
          </div>
        )}
      </div>

        {sessaoId && chatId &&
          (!tem("whatsapp.responder") ? (
            <p className="border-t barra-fixa px-4 py-3 text-xs text-muted-foreground text-center">
              Seu cargo pode ler as conversas, mas não responder.
            </p>
          ) : chat?.podeEnviar === false ? (
            <ComposerBloqueado motivo={chat.motivoBloqueio} />
          ) : (
            <Composer
              // key: rascunho/anexo/gravação não vazam para a próxima conversa.
              key={`${sessaoId}:${chatId}`}
              sessaoId={sessaoId}
              chatId={chatId}
              replyTo={replyTo ?? undefined}
              onCancelReply={() => setReplyTo(null)}
              textoInicial={textoInicial}
            />
          ))}
      </div>

      {/* Painel do cliente — overlay flutuante sobre a direita da conversa
          (desktop). Não encolhe a conversa: desliza por cima com sombra,
          a conversa segue visível atrás. Fecha no X. */}
      {painelAberto && !grupo && (
        <div
          className={cn(
            "absolute inset-y-0 right-0 z-30 hidden md:block bg-card shadow-2xl",
            "animate-in slide-in-from-right-8 fade-in-0 duration-200",
          )}
        >
          <ClientContextPanel
            clienteId={chat?.clienteId ?? null}
            canal="whatsapp"
            fotoPath={chat?.fotoPath ?? null}
            conversaId={chatId}
            sugestao={numero}
            nomeSugerido={chat?.nome ?? null}
            chat={chat}
            vinculando={vincular.isPending}
            onVincular={(clienteId) => {
              if (!chat) return Promise.resolve();
              return vincular.mutateAsync({
                chatRowId: chat.id,
                clienteId,
              });
            }}
            onClose={() => setPainelAberto(false)}
          />
        </div>
      )}

      {chatId && sessaoId && (
        <DownloadConversaDialog
          open={downloadOpen}
          onOpenChange={setDownloadOpen}
          sessaoId={sessaoId}
          chatId={chatId}
          chatNome={nome}
          numero={numero ?? null}
        />
      )}

      <NovaSolicitacaoDialog
        open={!!solicitacaoDaMsg}
        onOpenChange={(o) => !o && setSolicitacaoDaMsg(null)}
        origem={solicitacaoDaMsg ?? {}}
      />
    </div>
  );
}

/**
 * Barra read-only no lugar do composer quando não dá pra enviar no
 * grupo — "só admins enviam" ou número removido. Estilo discreto,
 * igual ao banner cinza do WhatsApp.
 */
function ComposerBloqueado({ motivo }: { motivo: string | null }) {
  const texto =
    motivo === "removido"
      ? "Você não está mais neste grupo."
      : "Só administradores podem enviar mensagens neste grupo.";
  return (
    <div className="border-t bg-muted/40 px-4 py-3 flex items-center justify-center gap-2 text-sm text-muted-foreground">
      <Lock className="size-4 shrink-0" />
      <span>{texto}</span>
    </div>
  );
}

/**
 * Decide se mostra o nome do remetente acima da bubble. Lógica
 * inspirada no WhatsApp: agrupa mensagens consecutivas do mesmo
 * remetente (se as 2 últimas vieram da mesma pessoa, só a primeira
 * mostra o nome). Mostra de novo se trocou o dia.
 */
function shouldShowRemetente(
  m: WhatsappMensagem,
  todas: WhatsappMensagem[],
  i: number,
): boolean {
  // Mensagens próprias nunca mostram nome (é sempre você).
  if (m.fromMe) return false;
  const anterior = todas[i - 1];
  if (!anterior) return true;
  if (anterior.fromMe) return true;
  // Trocou remetente
  if ((anterior.remetenteJid ?? null) !== (m.remetenteJid ?? null)) return true;
  // Mesmo remetente mas em dia diferente — re-mostra o nome
  const dataA = parsePgTimestamp(anterior.timestamp);
  const dataM = parsePgTimestamp(m.timestamp);
  if (dataA && dataM && dataA.toDateString() !== dataM.toDateString()) {
    return true;
  }
  return false;
}

// "digitando…/gravando…" obsoleto após esta janela (caso falte o evento de
// saída); "online" obsoleto um pouco depois. Aí cai pra "visto por último".
const PRESENCA_TYPING_TTL_MS = 18_000;
const PRESENCA_ONLINE_TTL_MS = 90_000;

/** Deriva o texto de presença do chat, respeitando a validade (TTL). */
function presencaTexto(
  chat: WhatsappChat | undefined,
): { texto: string; ativo: boolean } | null {
  if (!chat || chat.tipo !== "individual" || !chat.presenceEstado) return null;
  const em = chat.presenceEm
    ? parsePgTimestamp(chat.presenceEm)?.getTime() ?? 0
    : 0;
  const idade = Date.now() - em;
  const est = chat.presenceEstado;
  if (
    (est === "typing" || est === "recording") &&
    idade < PRESENCA_TYPING_TTL_MS
  ) {
    return {
      texto: est === "recording" ? "gravando áudio…" : "digitando…",
      ativo: true,
    };
  }
  if (est === "online" && idade < PRESENCA_ONLINE_TTL_MS) {
    return { texto: "online", ativo: true };
  }
  const visto = chat.ultimoVistoEm ? parsePgTimestamp(chat.ultimoVistoEm) : null;
  if (visto) {
    const quando = isSameDay(visto, new Date())
      ? `às ${format(visto, "HH:mm")}`
      : `em ${format(visto, "dd/MM 'às' HH:mm", { locale: ptBR })}`;
    return { texto: `visto por último ${quando}`, ativo: false };
  }
  return null;
}

/**
 * Segunda linha do header: presença do contato ("digitando…/online/visto
 * por último") quando há sinal recente; senão cai pro "sobre"/vínculo
 * (comportamento anterior). Isolado com tick próprio pra expirar o
 * indicador sem re-renderizar a conversa inteira.
 */
function LinhaPresenca({ chat }: { chat: WhatsappChat | undefined }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 8_000);
    return () => clearInterval(id);
  }, []);

  const pres = presencaTexto(chat);
  if (pres) {
    return (
      <p
        className={cn(
          "text-2xs truncate mt-0.5 flex items-center gap-1.5",
          pres.ativo
            ? "text-foreground font-medium"
            : "text-muted-foreground",
        )}
      >
        {pres.ativo && (
          <span
            className="size-1.5 rounded-full bg-foreground animate-pulse shrink-0"
            aria-hidden
          />
        )}
        <span className="truncate">{pres.texto}</span>
      </p>
    );
  }
  return (
    <p className="text-2xs text-muted-foreground truncate italic mt-0.5">
      {chat?.sobre ??
        (chat?.clienteId ? "Cliente vinculado" : "Sem cliente vinculado")}
    </p>
  );
}

/**
 * Formata um número (só dígitos) pra mostrar em menções `@<num>`.
 * Brasil em DDD+celular vira "(11) 99785-3643"; outros formatos
 * pegam só `+<digits>` pra ficar legível. Usado como fallback do
 * `resolveMencao` quando o contato não tem nome nem pushName.
 */

function formatTelefoneMencao(numero: string): string {
  const d = numero.replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) {
    return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  }
  if (d.length === 12 && d.startsWith("55")) {
    return `(${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  }
  return `+${d}`;
}

function formatHeaderNumero(numero: string | null): string | null {
  if (!numero) return null;
  const d = numero.replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) {
    return `+55 ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  }
  if (d.length === 12 && d.startsWith("55")) {
    return `+55 ${d.slice(2, 4)} ${d.slice(4, 8)}-${d.slice(8)}`;
  }
  return numero;
}

/**
 * Avatar do header da conversa — versão um pouco maior do que o
 * usado na sidebar (`size-9` vs `size-10`). Carrega `fotoPath` via
 * signed URL e cai pras iniciais quando não tem foto ou quando o
 * load falha.
 */
function ConversaAvatar({
  semente,
  nome,
  grupo,
  fotoPath,
}: {
  /** Identificador do chat (JID). É a semente do desenho, NUNCA o nome. */
  semente: string;
  nome?: string | null;
  grupo: boolean;
  fotoPath?: string | null;
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
        "inline-flex shrink-0 items-center justify-center size-9 rounded-full text-sm font-medium overflow-hidden",
        grupo ? "bg-foreground/[0.06] text-foreground" : "bg-primary/15 text-primary",
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
      ) : iniciaisDeContato(nome) ? (
        <AvatarIniciais nome={nome} semente={semente} className="size-full text-xs" />
      ) : (
        // Mesmo desenho da lista, mesma semente: o rosto não muda ao abrir a
        // conversa.
        <img src={avatarFicticio(semente)} alt="" className="size-full" loading="lazy" />
      )}
    </span>
  );
}
