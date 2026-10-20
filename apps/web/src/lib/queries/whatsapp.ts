// Queries e mutations do módulo Chat (WhatsApp via WAHA).
//
// Padrão:
//   - Leituras (sessões, chats, mensagens) → supabase direto, com
//     realtime subscription para invalidar cache.
//   - Escritas (enviar texto/mídia, iniciar/parar sessão, reagir,
//     apagar) → Edge Function `whatsapp`.
//
// Suporta múltiplas instâncias por escritório (1 número = 1 sessão).
// Toda chat/mensagem é filtrada por sessaoId. O front passa sessaoId
// no corpo ou na URL.

import {
  keepPreviousData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { api, ErroDaApi } from "@/lib/api";
import { orIlike } from "@/lib/queries/helpers";
import { parsePgTimestamp } from "@/lib/format";
import { useRealtimeInvalidate } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";

// ===========================================================================
// Tipos
// ===========================================================================

export type WhatsappSessao = {
  id: string;
  tenantId: string;
  nome: string;
  apelido: string | null;
  status: "STOPPED" | "STARTING" | "SCAN_QR_CODE" | "WORKING" | "FAILED";
  numero: string | null;
  pushName: string | null;
  /** Foto de perfil da conta conectada (path no bucket; "__none__" = sem foto). */
  fotoPath: string | null;
  /** true = imagem que o dono subiu, visível SÓ no adv3 (o WhatsApp não muda). */
  fotoPersonalizada: boolean;
  ultimoErro: string | null;
  conectadoEm: string | null;
  criadoEm: string;
  atualizadoEm: string;
};

export type AtendimentoStatus = "aberto" | "em_atendimento" | "finalizado";

export type WhatsappChat = {
  id: string;
  sessaoId: string;
  chatId: string;
  tipo: "individual" | "group";
  nome: string | null;
  /** "About" do contato no WhatsApp (texto curto no perfil). */
  sobre: string | null;
  fotoPath: string | null;
  clienteId: string | null;
  ultimaMensagemTexto: string | null;
  ultimaMensagemEm: string | null;
  ultimaMensagemFromMe: boolean;
  naoLidas: number;
  arquivado: boolean;
  fixado: boolean;
  /** Em grupo: false quando "só admins enviam" e não sou admin, ou fui
   *  removido. Default true (individuais e grupos normais). */
  podeEnviar: boolean;
  /** Motivo do bloqueio quando podeEnviar=false: 'so_admins' | 'removido'. */
  motivoBloqueio: string | null;
  /** Atendimento (painel Denos): quem cuida da conversa agora. */
  responsavelId: string | null;
  atendimentoStatus: AtendimentoStatus;
  atendimentoEm: string | null;
  apagadoEm: string | null;
  atualizadoEm: string;
};

// A lista da inbox chega de novo a cada evento do Realtime. Declarar as colunas
// evita enviar campos internos (payloads, ids de sincronismo etc.) em até 200
// linhas sempre que uma conversa recebe mensagem.
const CHAT_LIST_SELECT = [
  "id", "sessaoId", "chatId", "tipo", "nome", "sobre", "fotoPath", "clienteId",
  "ultimaMensagemTexto", "ultimaMensagemEm", "ultimaMensagemFromMe", "naoLidas",
  "arquivado", "fixado", "podeEnviar", "motivoBloqueio",
  "responsavelId", "atendimentoStatus",
  "atendimentoEm", "apagadoEm", "atualizadoEm",
].join(",");

/** Dados estruturados de mensagens ricas (coluna `payload` jsonb). */
export type WhatsappPayloadEnquete = {
  name: string;
  options: string[];
  multipleAnswers: boolean;
  /** Contagem por opção (o que a UI renderiza). */
  votes?: Record<string, number>;
  /** Escolha por votante (id → opções) — base para recalcular `votes`. */
  voters?: Record<string, string[]>;
};
export type WhatsappPayloadContato = {
  contatos: Array<{
    nome: string | null;
    telefone: string | null;
    vcard: string | null;
  }>;
};
export type WhatsappPayloadBotao = {
  selectedId: string | null;
  selectedText: string | null;
};
export type WhatsappPayload =
  | WhatsappPayloadEnquete
  | WhatsappPayloadContato
  | WhatsappPayloadBotao
  | null;

export type WhatsappMensagem = {
  id: string;
  sessaoId: string;
  chatId: string;
  wamId: string | null;
  tipo:
    | "text"
    | "image"
    | "video"
    // "gif" é legado (registros antigos); o webhook agora normaliza gif→video.
    // Mantido na união pro frontend renderizar registros não migrados como vídeo.
    | "gif"
    | "audio"
    | "document"
    | "sticker"
    | "location"
    | "contact"
    | "poll"
    // Envelope de ÁLBUM: o WhatsApp manda um "collection" vazio e, logo
    // atrás, cada foto como mensagem própria. Estava fora da união e o
    // balão exibia "[collection]" cru (25/08/2026).
    | "collection"
    | "buttons"
    | "reaction"
    | "system"
    // Mensagem que o WhatsApp/whatsmeow não conseguiu descriptografar — chega
    // só como `placeholderMessage`, sem conteúdo. Renderiza um aviso no lugar
    // de um balão vazio (vide whatsapp-webhook inferTipo).
    | "placeholder"
    // Formato que não sabemos ler (template/menu da API oficial que escapou
    // do extrator, tipo novo do WhatsApp). Rotula em vez de balão em branco.
    | "nao_suportado";
  texto: string | null;
  mediaPath: string | null;
  mediaMime: string | null;
  mediaNomeArquivo: string | null;
  mediaTamanho: number | null;
  latitude: number | null;
  longitude: number | null;
  /** Dados ricos por tipo (enquete/contato/botão). */
  payload: WhatsappPayload;
  replyToWamId: string | null;
  replyToTexto: string | null;
  /** Miniatura (data URI) da mídia citada, capturada na ingestão a partir do
   *  jpegThumbnail do proto. Fallback instantâneo para citação quando a
   *  mensagem original está fora da janela carregada (ou já expirou no WAHA). */
  replyToThumb: string | null;
  /** Tipo da mensagem citada (image|video|audio|document|sticker|…). */
  replyToTipo: string | null;
  reactions: Array<{ emoji: string; from: string }>;
  ack: number;
  fromMe: boolean;
  /** JID de quem mandou (em grupo, o participante). */
  remetenteJid: string | null;
  remetenteNome: string | null;
  /** Autoria da mensagem enviada (fromMe): 'humano' = enviada pelo painel,
   *  'externo' = por fora (celular/terceiro), 'sistema' = aviso automático
   *  (ex.: certificado vencendo). */
  origem: "humano" | "ia" | "externo" | "sistema" | null;
  /** Colaborador que disparou (só em fromMe). No adv3 apontava para User. */
  enviadoPorUserId: string | null;
  /** Dados do Colaborador para exibir iniciais coloridas + nome na bubble (join). */
  enviadoPor: {
    id: string;
    nome: string;
    cor: string;
  } | null;
  timestamp: string;
  editadoEm: string | null;
  apagadoEm: string | null;
  criadoEm: string;
  /** Só no cache otimista: mensagem recém-enviada ainda sem eco do servidor.
   *  Mantém ela ANCORADA no fim da lista (na ordem de envio) até a linha do
   *  banco chegar — evita o "pulo" (sobe e desce) entre o timestamp do
   *  cliente e o do servidor. Some quando o realtime refaz a query. */
  _pendente?: boolean;
  /** Só no cache otimista: o envio falhou. A bolha fica na tela com aviso
   *  e botão de reenviar, em vez de sumir calada (defeito 33 do adv3). */
  _erro?: string;
};

// ===========================================================================
// Sessões (N por tenant)
// ===========================================================================

/** Lista TODAS as sessões do tenant (owner vê todas). */
export function useWhatsappSessoes() {
  useRealtimeInvalidate("WhatsappSessao", [["whatsapp-sessoes"]]);
  return useQuery({
    queryKey: ["whatsapp-sessoes"],
    queryFn: async () => {
      // Colunas explícitas: o QR (`qrCodeBase64`) não é legível pela tela
      // (grant por coluna, migração 023) e vem só pela rota /qr.
      const { data, error } = await supabase
        .from("WhatsappSessao")
        .select(
          'id, tenantId, nome, apelido, numero, status, pushName, ultimoErro, fotoPath, fotoPersonalizada, conectadoEm, criadoEm, atualizadoEm',
        )
        .order("criadoEm", { ascending: true });
      if (error) throw error;
      return (data ?? []) as WhatsappSessao[];
    },
    refetchInterval: (q) => {
      // Quando alguma sessão tá em transição, polla agressivo
      const list = (q.state.data as WhatsappSessao[] | undefined) ?? [];
      const transicao = list.some(
        (s) => s.status === "STARTING" || s.status === "SCAN_QR_CODE",
      );
      return transicao ? 3000 : 30_000;
    },
  });
}

/** Janela de carência para segurar o WORKING antes de mostrar uma queda. */
const STATUS_GRACE_MS = 8000;

/**
 * Suaviza o status das sessões para UI do Chat. O WAHA emite eventos
 * `session.status` transitórios — uma sessão WORKING pode piscar
 * STOPPED/STARTING/FAILED por 1-2s numa reconexão do celular e voltar
 * logo (o webhook grava cada um na hora, e o realtime reflete na UI).
 * Sem tratar, o pulse/label do header "desconecta e volta", assustando
 * o usuário (bug reportado).
 *
 * Regra: segura o último WORKING por STATUS_GRACE_MS. Só refletimos uma
 * queda se ela PERSISTIR além da carência. Subir para WORKING é sempre
 * instantâneo, e sessão que nunca esteve WORKING (QR inicial etc.)
 * mostra o status real direto.
 *
 * Aplicado SÓ no Chat. A página de Canais usa o status cru de
 * `useWhatsappSessoes` — lá a reconexão real precisa aparecer na hora.
 */
export function useStableSessaoStatus(
  sessoes: WhatsappSessao[],
): WhatsappSessao[] {
  // sessaoId → epoch (ms) do último status WORKING observado.
  const ultimoWorkingRef = useRef<Map<string, number>>(new Map());
  const [tick, setTick] = useState(0);

  const agora = Date.now();
  let segurando = false;

  const estaveis = sessoes.map((s) => {
    const mapa = ultimoWorkingRef.current;
    if (s.status === "WORKING") {
      mapa.set(s.id, agora);
      return s;
    }
    const visto = mapa.get(s.id);
    if (visto !== undefined && agora - visto < STATUS_GRACE_MS) {
      segurando = true;
      return { ...s, status: "WORKING" as const };
    }
    return s;
  });

  // Comita a queda ao fim da carência mesmo sem novos dados do
  // realtime/polling. `tick` nas deps re-arma o timer a cada ciclo
  // enquanto ainda houver sessão segurada.
  useEffect(() => {
    if (!segurando) return;
    const t = setTimeout(() => setTick((n) => n + 1), STATUS_GRACE_MS + 200);
    return () => clearTimeout(t);
  }, [segurando, sessoes, tick]);

  return estaveis;
}

/**
 * Uma passada de sincronização com o WAHA, ao ABRIR a tela de Conexões.
 *
 * 🔴 Existe porque a lista (`useWhatsappSessoes`) vem do BANCO, por
 * supabase-js, e não da Edge Function. Quem fala com o WAHA é o
 * `syncSessaoComWaha`, que só roda dentro de `GET /whatsapp/sessoes` — sem
 * esta chamada, nada na tela dispara a conferência: status que mudou por
 * fora, e o número da instância que o WAHA conhece e o banco não, só
 * apareciam para quem clicasse em "Atualizar status" instância por instância.
 *
 * Uma requisição cobre TODAS as sessões do escritório (o handler consulta o
 * WAHA em paralelo). O gatilho é abrir a tela, não um relógio: `staleTime`
 * de 1 min evita repetir a passada em remontagens seguidas, e não há
 * refetch por foco nem intervalo.
 */
export function useSincronizarSessoesComWaha(habilitado = true) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["whatsapp-sessoes-sync"],
    queryFn: () =>
      api<{ sessoes: WhatsappSessao[] }>("/whatsapp/sessoes", {
        method: "GET",
      }),
    enabled: habilitado,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  // O que a passada corrigiu está no BANCO, e a lista da tela lê de lá:
  // sem invalidar, a correção só apareceria no próximo F5.
  const { isSuccess, dataUpdatedAt } = query;
  useEffect(() => {
    if (!isSuccess) return;
    qc.invalidateQueries({ queryKey: ["whatsapp-sessoes"] });
  }, [isSuccess, dataUpdatedAt, qc]);

  return query;
}

/** Sessão específica (refetch via GET /sessoes/:id atualiza status real). */
export function useSyncWhatsappSessao(sessaoId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!sessaoId) throw new Error("sessaoId obrigatório");
      return api<{ sessao: WhatsappSessao }>(
        `/whatsapp/sessoes/${encodeURIComponent(sessaoId)}`,
        { method: "GET" },
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp-sessoes"] }),
  });
}

/**
 * Cria nova instância WhatsApp pro escritório. Tanto `apelido` (nome
 * amigável) quanto `numero` (formato 5511XXXXXXXXX, 13 dígitos) são
 * obrigatórios — o número é validado contra o WhatsApp que vai
 * conectar, e tem unicidade global (um número por instância na
 * plataforma inteira). Veja `useChecarNumeroSessao` para a checagem
 * antecipada no form.
 */
export function useCriarSessao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { apelido: string; numero: string }) =>
      api<{ sessaoId: string; nome: string }>("/whatsapp/sessoes", {
        method: "POST",
        body: args,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp-sessoes"] }),
  });
}

export type ChecagemNumero =
  | { disponivel: true }
  | { disponivel: false; motivo: "formato" }
  | { disponivel: false; motivo: "mesmo-tenant"; apelido: string | null }
  | { disponivel: false; motivo: "outra-conta" };

/**
 * Checa, JÁ na digitação, se um número de WhatsApp está livre para conectar.
 * Unicidade é global (uma instância por número na plataforma inteira).
 * Só dispara quando `numero` está completo (13 dígitos com o nono, 12 sem
 * ele) — passe o número já com debounce para não bater a cada tecla.
 */
export function useChecarNumeroSessao(numero: string) {
  const digits = numero.replace(/\D/g, "");
  const valido =
    (digits.length === 12 || digits.length === 13) && digits.startsWith("55");
  return useQuery({
    queryKey: ["whatsapp-check-numero", digits],
    queryFn: () =>
      api<ChecagemNumero>(
        `/whatsapp/sessoes/check-numero?numero=${encodeURIComponent(digits)}`,
      ),
    enabled: valido,
    staleTime: 30_000,
    retry: false,
  });
}

export function useStartWhatsappSessao(sessaoId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!sessaoId) throw new Error("sessaoId obrigatório");
      return api<{ ok: true }>(
        `/whatsapp/sessoes/${encodeURIComponent(sessaoId)}/start`,
        { method: "POST" },
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp-sessoes"] }),
  });
}

export function useStopWhatsappSessao(sessaoId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!sessaoId) throw new Error("sessaoId obrigatório");
      return api<{ ok: true }>(
        `/whatsapp/sessoes/${encodeURIComponent(sessaoId)}/stop`,
        { method: "POST" },
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp-sessoes"] }),
  });
}

export function useRestartWhatsappSessao(sessaoId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!sessaoId) throw new Error("sessaoId obrigatório");
      return api<{ ok: true }>(
        `/whatsapp/sessoes/${encodeURIComponent(sessaoId)}/restart`,
        { method: "POST" },
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp-sessoes"] }),
  });
}

export function useLogoutWhatsappSessao(sessaoId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!sessaoId) throw new Error("sessaoId obrigatório");
      return api<{ ok: true }>(
        `/whatsapp/sessoes/${encodeURIComponent(sessaoId)}/logout`,
        { method: "POST" },
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp-sessoes"] }),
  });
}

/**
 * Limpa TODAS as conversas da instância (mensagens, chats, contatos e mídia),
 * MANTENDO a instância conectada. Owner-only no backend. Útil para começar do
 * zero depois de reconectar/trocar o número, sem ver as conversas antigas.
 */
export function useLimparConversasWhatsapp(sessaoId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!sessaoId) throw new Error("sessaoId obrigatório");
      return api<{
        ok: true;
        mensagens: number;
        chats: number;
        blobsRemovidos: number;
      }>(
        `/whatsapp/sessoes/${encodeURIComponent(sessaoId)}/limpar-conversas`,
        { method: "POST" },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp-sessoes"] });
      qc.invalidateQueries({ queryKey: ["whatsapp-chats"] });
          },
  });
}

/**
 * Apaga sessão (cascade para chats/mensagens). Owner-only no backend.
 *
 * Retorna `wahaError` quando o WAHA server falha em remover a sessão
 * (e.g., engine travada, rede). A sessão é apagada do nosso banco
 * mesmo nesses casos — o usuário precisa limpar manualmente no painel
 * do WAHA para liberar o slot.
 */
export function useDeleteWhatsappSessao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sessaoId: string) =>
      api<{ ok: true; wahaError: string | null }>(
        `/whatsapp/sessoes/${encodeURIComponent(sessaoId)}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp-sessoes"] });
      qc.invalidateQueries({ queryKey: ["whatsapp-chats"] });
          },
  });
}

/**
 * Troca a foto da instância. Owner-only no backend.
 *
 * 🔴 É foto INTERNA: vale só dentro do adv3 (seletor de instância, Canais).
 * O perfil do WhatsApp que os clientes do escritório veem NÃO é alterado —
 * não existe chamada ao WAHA para definir foto, e não deve passar a existir.
 */
export function useTrocarFotoSessao(sessaoId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dataUrl: string) => {
      if (!sessaoId) throw new Error("sessaoId obrigatório");
      return api<{ ok: true; fotoPath: string }>(
        `/whatsapp/sessoes/${encodeURIComponent(sessaoId)}/foto`,
        { method: "PUT", body: { dataUrl } },
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp-sessoes"] }),
  });
}

/** Descarta a foto interna e volta para foto real do WhatsApp. Owner-only. */
export function useRemoverFotoSessao(sessaoId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!sessaoId) throw new Error("sessaoId obrigatório");
      return api<{ ok: true; fotoPath: string | null }>(
        `/whatsapp/sessoes/${encodeURIComponent(sessaoId)}/foto`,
        { method: "DELETE" },
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp-sessoes"] }),
  });
}

export function useFetchQrCode(sessaoId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!sessaoId) throw new Error("sessaoId obrigatório");
      return api<{ qr: string }>(
        `/whatsapp/sessoes/${encodeURIComponent(sessaoId)}/qr`,
        { method: "GET" },
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp-sessoes"] }),
  });
}

/**
 * Código de pareamento (alternativa ao QR): o WhatsApp manda um código de 8
 * caracteres para digitar no celular em Aparelhos conectados → Conectar com
 * número de telefone. Serve quando o painel está aberto no próprio celular
 * que vai conectar (não dá para escanear a própria tela).
 */
export function usePedirCodigoPareamento(sessaoId: string | undefined) {
  return useMutation({
    mutationFn: async (telefone: string) => {
      if (!sessaoId) throw new Error("sessaoId obrigatório");
      return api<{ code: string }>(
        `/whatsapp/sessoes/${encodeURIComponent(sessaoId)}/pairing-code`,
        { method: "POST", body: { telefone } },
      );
    },
  });
}

/**
 * Re-registra o webhook no servidor WAHA. Útil quando a sessão está
 * WORKING mas mensagens novas não chegam em tempo real.
 */
export function useRefreshWebhook(sessaoId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!sessaoId) throw new Error("sessaoId obrigatório");
      return api<{ ok: true }>(
        `/whatsapp/sessoes/${encodeURIComponent(sessaoId)}/refresh-webhook`,
        { method: "POST" },
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp-sessoes"] }),
  });
}

// ===========================================================================
// Chats — sempre filtrados por sessaoId
// ===========================================================================

/**
 * Aceita string (1 sessão), string[] (multi-instância) ou undefined.
 * Multi-instância: passa array — usa `.in("sessaoId", ...)`.
 * Filtros extras: `tipo` (grupo/individual), `vinculo` (com/sem cliente).
 */
/**
 * Quantas conversas a lista pede por vez. Era um teto FIXO de 200 sem "carregar
 * mais": o escritório com 258 conversas ativas simplesmente não via 58 delas na
 * lista (só achava pela busca, que vai ao banco). Agora o teto cresce a pedido.
 */
export const PAGINA_CHATS = 50;

/**
 * Teto da BUSCA. Buscar não pagina de propósito (decisão do dono): o termo vai
 * ao banco e volta o que casar, inclusive conversa que a lista ainda não
 * carregou — que é justamente o caso de quem tem centenas.
 */
const BUSCA_LIMITE = 50;

export function useWhatsappChats(
  sessaoId: string | string[] | undefined,
  filtros?: {
    q?: string;
    arquivados?: boolean;
    tipo?: "individual" | "group";
    vinculo?: "com" | "sem";
    /** Colaborador responsável (uuid) ou "sem" = conversas sem responsável. */
    responsavel?: string;
    atendimentoStatus?: AtendimentoStatus;
  },
  limite: number = PAGINA_CHATS,
) {
  // Normaliza para array — facilita o resto da lógica.
  const sessoes = Array.isArray(sessaoId)
    ? sessaoId
    : sessaoId
      ? [sessaoId]
      : [];
  const sessoesKey = [...sessoes].sort().join(",");

  // Busca não pagina; o resto respeita o teto pedido pela tela.
  const buscando = !!filtros?.q?.trim();
  const teto = buscando ? BUSCA_LIMITE : limite;

  // 🔴 FILTRO DE TENANT NO CANAL, e ele existe por CUSTO, não por segurança.
  //
  // A RLS já impede um escritório de RECEBER linha de outro. O que ela não
  // impede é o Realtime AVALIAR: sem `filter`, o canal assina a tabela inteira
  // e o `postgres_changes` roda a RLS do assinante contra cada registro do WAL,
  // uma vez por assinatura. O custo é escritas x clientes conectados, e quase
  // todo ele é gasto para concluir que a linha não é daquele assinante.
  //
  // `WhatsappChat` é o canal que vale filtrar: concentra ~90% das escritas de
  // todos os canais juntos (um UPDATE por mensagem recebida).
  //
  // ⚠️ Por que só aqui, e não nos outros seis: o payload de DELETE do Realtime
  // só traz a chave primária, então um filtro por `tenantId` faz o evento de
  // exclusão ser descartado. O apagamento normal daqui é SOFT (`apagadoEm`, e o
  // webhook ressuscita a linha ao chegar mensagem nova), que viaja como UPDATE
  // e passa pelo filtro.
  //
  // 🔴 EXISTE UM DELETE FÍSICO, e a primeira versão deste comentário dizia que
  // não: `POST /sessoes/:id/limpar-conversas` (whatsapp/index.ts:1119) apaga as
  // linhas de verdade. O efeito de perder esse evento é limitado e conhecido:
  // quem executa a ação já recebe `invalidateQueries(["whatsapp-chats"])` na
  // própria mutation (linha 438), e para um COLEGA com a tela aberta a lista
  // fica velha até a próxima mensagem recebida — que chega como INSERT/UPDATE,
  // passa pelo filtro e invalida. É uma ação rara, owner-only, e o preço é
  // atraso de uma tela, não dado errado.
  //
  // Nos outros seis canais não vale o mesmo raciocínio, e por isso eles ficam
  // sem filtro.
  //
  // 🔴 SEM TENANT, ASSINA SEM FILTRO — nunca com um valor que não existe.
  //
  // A primeira versão usava `meuTenant?.id ?? "__none__"`, tratando "ainda não
  // sei o tenant" como "filtre por algo impossível". Isso funciona enquanto a
  // query resolve, mas se ela FALHAR (rede, RLS, sessão expirando) o canal fica
  // assinado num filtro que não casa com nada, para sempre, e o chat para de
  // atualizar sozinho sem erro nenhum na tela — falha silenciosa, que é o modo
  // de falha que este arquivo mais evita.
  //
  // Cair no comportamento ANTERIOR (sem filtro) é o degradar certo: custa o que
  // custava antes desta otimização e continua correto. O filtro é ganho de
  // custo, não requisito de correção, então ele pode faltar.
  //
  // 🔴 FILTRO AUSENTE E ASSINATURA LIGADA SÃO DOIS EIXOS, e só um deles é
  // defeito. Esta linha é literalmente a forma que o `realtime.ts` chama de
  // armadilha (`id ? {…} : undefined`), e aqui ela está certa. A diferença:
  //
  //   `useMensagens`, sem `chatId`: a query está DESLIGADA. Assinar a tabela
  //   inteira paga RLS por registro do WAL para invalidar coisa nenhuma. É o
  //   defeito, e saiu em 11/09/2026.
  //
  //   AQUI, sem `tenantId` mas com sessão: a query está LIGADA e a pessoa está
  //   olhando a lista de conversas. Sem filtro, a lista continua subindo, que é
  //   a razão de a assinatura existir. Paga-se mais, com motivo.
  //
  // ⚠️ Quem "uniformizar" isto trocando o filtro condicional pelo sentinela
  // reintroduz a falha silenciosa descrita acima; quem apagar o `enabled`
  // reintroduz o assinante sem filtro em `WhatsappChat`, que é a tabela de
  // MAIOR escrita da publicação (68,9% do que é publicado, medido em
  // 11/09/2026). São consertos opostos, e os dois pioram.
  //
  // O `enabled` abaixo é o MESMO da query: sem sessão carregada não há lista, e
  // sem lista não há o que invalidar.
  // Escritório único: o filtro por tenant é constante.
  useRealtimeInvalidate(
    "WhatsappChat",
    [["whatsapp-chats", sessoesKey], ["whatsapp-chat"]],
    { column: "tenantId", value: "denos" },
    sessoes.length > 0,
  );
  return useQuery({
    queryKey: ["whatsapp-chats", sessoesKey, filtros, teto],
    enabled: sessoes.length > 0,
    queryFn: async () => {
      let q = supabase
        .from("WhatsappChat")
        .select(CHAT_LIST_SELECT)
        .in("sessaoId", sessoes)
        .eq("arquivado", filtros?.arquivados ?? false)
        // Esconde soft-deleted. Quando o contato voltar a escrever, o
        // webhook ressurge limpando apagadoEm.
        .is("apagadoEm", null)
        .order("fixado", { ascending: false })
        .order("ultimaMensagemEm", { ascending: false, nullsFirst: false })
        .limit(teto);
      if (filtros?.tipo) q = q.eq("tipo", filtros.tipo);
      if (filtros?.vinculo === "com") q = q.not("clienteId", "is", null);
      if (filtros?.vinculo === "sem") q = q.is("clienteId", null);
      if (filtros?.responsavel === "sem") q = q.is("responsavelId", null);
      else if (filtros?.responsavel) q = q.eq("responsavelId", filtros.responsavel);
      if (filtros?.atendimentoStatus) q = q.eq("atendimentoStatus", filtros.atendimentoStatus);
      if (filtros?.q?.trim()) {
        const term = filtros.q.trim();
        q = q.or(orIlike(["nome", "chatId"], term));
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as WhatsappChat[];
    },
    // Sem isto, cada "carregar mais" (que muda a queryKey) esvaziaria a lista
    // e piscaria o spinner por cima do que a pessoa está lendo.
    placeholderData: keepPreviousData,
    staleTime: 5_000,
  });
}

/**
 * Ordena a lista igual ao servidor: fixadas primeiro, depois pela última
 * mensagem (mais recente no topo; sem mensagem vai pro fim). Usado nos
 * updates otimistas para refletir reordenação na hora.
 */
function ordenarChats(list: WhatsappChat[]): WhatsappChat[] {
  return [...list].sort((a, b) => {
    if (a.fixado !== b.fixado) return a.fixado ? -1 : 1;
    // parsePgTimestamp, não Date.parse: misturar hora com e sem fuso deixava
    // a conversa enviada atrás das recebidas nas últimas 3 h (defeito 34).
    const ta = parsePgTimestamp(a.ultimaMensagemEm)?.getTime() ?? -Infinity;
    const tb = parsePgTimestamp(b.ultimaMensagemEm)?.getTime() ?? -Infinity;
    return tb - ta;
  });
}

/**
 * Aplica um patch otimista a uma conversa em TODAS as queries de lista
 * (`whatsapp-chats`, qualquer filtro), reordenando em seguida. Devolve os
 * snapshots para rollback em caso de erro.
 */
function patchChatsCache(
  qc: ReturnType<typeof useQueryClient>,
  match: (c: WhatsappChat) => boolean,
  patch: (c: WhatsappChat) => WhatsappChat,
) {
  const snapshots = qc.getQueriesData<WhatsappChat[]>({
    queryKey: ["whatsapp-chats"],
  });
  for (const [key, data] of snapshots) {
    if (!Array.isArray(data)) continue;
    qc.setQueryData<WhatsappChat[]>(
      key,
      ordenarChats(data.map((c) => (match(c) ? patch(c) : c))),
    );
  }
  return snapshots;
}

function restaurarChatsSnapshots(
  qc: ReturnType<typeof useQueryClient>,
  snapshots: ReturnType<typeof patchChatsCache>,
) {
  for (const [key, data] of snapshots) qc.setQueryData(key, data);
}

export function useSyncChats(sessaoId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!sessaoId) throw new Error("sessaoId obrigatório");
      return api<{ count: number }>(
        `/whatsapp/sessoes/${encodeURIComponent(sessaoId)}/chats/sync`,
        { method: "POST" },
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp-chats"] }),
  });
}

export function useMarcarChatLido(sessaoId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (chatId: string) => {
      if (!sessaoId) throw new Error("sessaoId obrigatório");
      return api<{ ok: true }>(
        `/whatsapp/sessoes/${encodeURIComponent(sessaoId)}/chats/${encodeURIComponent(chatId)}/read`,
        { method: "POST" },
      );
    },
    // Otimista: zera a bolinha de não-lida NA HORA, sem esperar o servidor
    // nem um refetch. Antes a contagem só sumia depois do round-trip +
    // invalidate (~1-2s), o que dava a sensação de "travado".
    onMutate: async (chatId) => {
      await qc.cancelQueries({ queryKey: ["whatsapp-chats"] });
      const snapshots = qc.getQueriesData<WhatsappChat[]>({
        queryKey: ["whatsapp-chats"],
      });
      for (const [key, data] of snapshots) {
        if (!Array.isArray(data)) continue;
        qc.setQueryData<WhatsappChat[]>(
          key,
          data.map((c) =>
            c.sessaoId === sessaoId && c.chatId === chatId ? { ...c, naoLidas: 0 } : c,
          ),
        );
      }
      // A conversa aberta tem cache próprio (buscada por id).
      qc.setQueryData<WhatsappChat | null>(
        ["whatsapp-chat", sessaoId ?? "", chatId],
        (old) => (old ? { ...old, naoLidas: 0 } : old),
      );
      return { snapshots };
    },
    onError: (_err, _chatId, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) {
        qc.setQueryData(key, data);
      }
    },
    // Não invalidamos no sucesso: o valor otimista (0) já está correto e um
    // refetch só causaria flicker. O realtime do WhatsappChat reconcilia se
    // chegar mensagem nova.
  });
}

/**
 * Atualiza, em lote, os grupos com nome=null de uma sessão. Chama
 * o endpoint dedicado `/grupos/refresh-nomes` que:
 *   1. Força WAHA a re-sincronizar a lista de grupos do servidor
 *      (`POST /api/{session}/groups/refresh`)
 *   2. Lista todos os grupos via `GET /api/{session}/groups`
 *   3. Atualiza no banco apenas os que estão com nome=null
 *
 * Muito mais eficiente que N chamadas /refresh-profile separadas.
 * `sessaoId` é passado no `mutate(id)` para suportar várias sessões.
 */
export function useRefreshGruposSemNome() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sessaoId: string) =>
      api<{
        ok: true;
        atualizados: number;
        total: number;
        gruposNoWaha: number;
      }>(
        `/whatsapp/sessoes/${encodeURIComponent(sessaoId)}/grupos/refresh-nomes`,
        { method: "POST" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp-chats"] });
    },
  });
}

/**
 * Atualiza nome + foto + "sobre" do contato/grupo direto do WAHA.
 * Útil para refletir mudanças que o contato fez no perfil dele.
 */
export function useRefreshContact(sessaoId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (chatId: string) => {
      if (!sessaoId) throw new Error("sessaoId obrigatório");
      return api<{
        ok: true;
        foto: string | null;
        nome: string | null;
        sobre: string | null;
      }>(
        `/whatsapp/sessoes/${encodeURIComponent(sessaoId)}/chats/${encodeURIComponent(chatId)}/refresh-profile`,
        { method: "POST" },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp-chats"] });
    },
  });
}

/**
 * Fixa ou desafixa uma conversa. Estado é puramente local (campo
 * `fixado` em WhatsappChat) — não sincroniza com o WhatsApp do
 * dispositivo. Sidebar joga fixadas pro topo automaticamente.
 *
 * Edit direto via supabase + RLS — não precisa de Edge Function.
 */
export function useFixarChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { chatRowId: string; fixado: boolean }) => {
      const { error } = await supabase
        .from("WhatsappChat")
        .update({
          fixado: args.fixado,
          atualizadoEm: new Date().toISOString(),
        })
        .eq("id", args.chatRowId);
      if (error) throw error;
      return { ok: true as const };
    },
    // Otimista: move a conversa pro topo das fixadas (ou de volta) NA HORA,
    // sem esperar o round-trip + refetch. Antes parecia travado/sem efeito.
    onMutate: async (args) => {
      await qc.cancelQueries({ queryKey: ["whatsapp-chats"] });
      const snapshots = patchChatsCache(
        qc,
        (c) => c.id === args.chatRowId,
        (c) => ({ ...c, fixado: args.fixado }),
      );
      return { snapshots };
    },
    onError: (_err, _args, ctx) => {
      if (ctx?.snapshots) restaurarChatsSnapshots(qc, ctx.snapshots);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["whatsapp-chats"] }),
  });
}

/**
 * Arquiva/desarquiva uma conversa. Estado puramente local (coluna
 * `arquivado`), não sincroniza com o WhatsApp. Conversas arquivadas
 * somem da lista padrão e aparecem só no filtro "Arquivadas". Se o
 * contato mandar nova mensagem, o webhook NÃO desarquiva sozinho — fica
 * a critério do usuário (igual fixar).
 *
 * Edit direto via supabase + RLS — não precisa de Edge Function.
 */
export function useArquivarChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { chatRowId: string; arquivado: boolean }) => {
      const { error } = await supabase
        .from("WhatsappChat")
        .update({
          arquivado: args.arquivado,
          atualizadoEm: new Date().toISOString(),
        })
        .eq("id", args.chatRowId);
      if (error) throw error;
      return { ok: true as const };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp-chats"] }),
  });
}

/** Limpa mensagens do chat (otimista). */
export function useLimparChat(sessaoId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (chatId: string) => {
      if (!sessaoId) throw new Error("sessaoId obrigatório");
      return api<{ ok: true }>(
        `/whatsapp/sessoes/${encodeURIComponent(sessaoId)}/chats/${encodeURIComponent(chatId)}/clear`,
        { method: "POST" },
      );
    },
    onMutate: async (chatId) => {
      await qc.cancelQueries({ queryKey: ["whatsapp-mensagens", sessaoId ?? "", chatId] });
      const prev = qc.getQueryData(["whatsapp-mensagens", sessaoId ?? "", chatId]);
      qc.setQueryData(["whatsapp-mensagens", sessaoId ?? "", chatId], {
        pages: [[]],
        pageParams: [null],
      });
      return { prev };
    },
    onError: (_err, chatId, ctx) => {
      qc.setQueryData(["whatsapp-mensagens", sessaoId ?? "", chatId], ctx?.prev);
    },
    onSettled: (_, __, chatId) => {
      qc.invalidateQueries({ queryKey: ["whatsapp-chats"] });
      qc.invalidateQueries({ queryKey: ["whatsapp-mensagens", sessaoId ?? "", chatId] });
    },
  });
}

/** Apaga chat (otimista — some da lista imediato). */
export function useApagarChat(sessaoId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (chatId: string) => {
      if (!sessaoId) throw new Error("sessaoId obrigatório");
      return api<{ ok: true }>(
        `/whatsapp/sessoes/${encodeURIComponent(sessaoId)}/chats/${encodeURIComponent(chatId)}`,
        { method: "DELETE" },
      );
    },
    onMutate: async (chatId) => {
      await qc.cancelQueries({ queryKey: ["whatsapp-chats"] });
      const snapshots = qc.getQueriesData<WhatsappChat[]>({
        queryKey: ["whatsapp-chats"],
      });
      for (const [key, data] of snapshots) {
        if (!Array.isArray(data)) continue;
        qc.setQueryData<WhatsappChat[]>(
          key,
          data.filter((c) => !(c.sessaoId === sessaoId && c.chatId === chatId)),
        );
      }
      return { snapshots };
    },
    onError: (_err, _chatId, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) {
        qc.setQueryData(key, data);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp-chats"] });
          },
  });
}

/**
 * Apaga VÁRIAS conversas de uma vez (modo seleção do sidebar). Otimista —
 * todas somem da lista na hora. Cada conversa pode ser de uma instância
 * diferente (multi-sessão), então recebemos pares {sessaoId, chatId}.
 * Dispara os DELETEs em paralelo e reporta quantos falharam pro caller.
 */
export function useApagarChatsEmLote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (alvos: { sessaoId: string; chatId: string }[]) => {
      const resultados = await Promise.allSettled(
        alvos.map((a) =>
          api<{ ok: true }>(
            `/whatsapp/sessoes/${encodeURIComponent(a.sessaoId)}/chats/${encodeURIComponent(a.chatId)}`,
            { method: "DELETE" },
          ),
        ),
      );
      const falhas = resultados.filter((r) => r.status === "rejected").length;
      return { total: alvos.length, falhas };
    },
    onMutate: async (alvos) => {
      await qc.cancelQueries({ queryKey: ["whatsapp-chats"] });
      const chaves = new Set(alvos.map((a) => `${a.sessaoId}:${a.chatId}`));
      const snapshots = qc.getQueriesData<WhatsappChat[]>({
        queryKey: ["whatsapp-chats"],
      });
      for (const [key, data] of snapshots) {
        if (!Array.isArray(data)) continue;
        qc.setQueryData<WhatsappChat[]>(
          key,
          data.filter((c) => !chaves.has(`${c.sessaoId}:${c.chatId}`)),
        );
      }
      return { snapshots };
    },
    onError: (_err, _alvos, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) {
        qc.setQueryData(key, data);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp-chats"] });
          },
  });
}

/** Sai de um grupo no WhatsApp e remove da inbox local. */
export function useSairDoGrupo(sessaoId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (chatId: string) => {
      if (!sessaoId) throw new Error("sessaoId obrigatório");
      return api<{ ok: true }>(
        `/whatsapp/sessoes/${encodeURIComponent(sessaoId)}/chats/${encodeURIComponent(chatId)}/leave`,
        { method: "POST" },
      );
    },
    onMutate: async (chatId) => {
      await qc.cancelQueries({ queryKey: ["whatsapp-chats"] });
      const snapshots = qc.getQueriesData<WhatsappChat[]>({
        queryKey: ["whatsapp-chats"],
      });
      for (const [key, data] of snapshots) {
        if (!Array.isArray(data)) continue;
        qc.setQueryData<WhatsappChat[]>(
          key,
          data.filter((c) => !(c.sessaoId === sessaoId && c.chatId === chatId)),
        );
      }
      return { snapshots };
    },
    onError: (_err, _chatId, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) {
        qc.setQueryData(key, data);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp-chats"] });
          },
  });
}

/** Vincula/desvincula chat a um cliente. */
export function useVincularChatCliente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { chatRowId: string; clienteId: string | null }) => {
      const { error } = await supabase
        .from("WhatsappChat")
        .update({
          clienteId: args.clienteId,
          clienteVinculoManual: true,
          atualizadoEm: new Date().toISOString(),
        })
        .eq("id", args.chatRowId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp-chats"] });
      qc.invalidateQueries({ queryKey: ["whatsapp-chat"] });
      qc.invalidateQueries({ queryKey: ["conversas-do-cliente"] });
    },
  });
}

/**
 * Abre (ou reabre) uma conversa a partir de um telefone — "Parabenizar no
 * WhatsApp" quando o cliente ainda não tem conversa. Devolve o chatId.
 */
export async function abrirConversaPorTelefone(sessaoId: string, telefone: string) {
  return api<{ ok: true; chatId: string; id: string; clienteId: string | null }>(
    `/whatsapp/sessoes/${encodeURIComponent(sessaoId)}/chats/novo`,
    { method: "POST", body: { telefone } },
  );
}

// ===========================================================================
// Mensagens — sempre filtradas por sessaoId + chatId
// ===========================================================================

const PAGE_SIZE = 50;

/**
 * Cursor da página seguinte: a última mensagem da página anterior (a mais
 * antiga dela). `null` = primeira página.
 *
 * Por offset (`range`), uma mensagem nova chegando entre uma página e outra
 * empurrava tudo uma posição: a página seguinte repetia a última mensagem já
 * vista, e apagar uma fazia pular outra. Com cursor a página seguinte começa
 * exatamente depois da última vista. O `id` desempata mensagens com o mesmo
 * timestamp (o WhatsApp dá precisão de segundos).
 */
export type CursorMensagens = { ts: string; id: string } | null;

/** Uma página de mensagens (mais nova primeiro). Serve à query e à pré-carga. */
async function buscarPaginaMensagens(sessaoId: string, chatId: string, cursor: CursorMensagens) {
  let q = supabase
    .from("WhatsappMensagem")
    // Join no User para exibir avatar+nome do membro que enviou
    // ("enviadoPor" só vem preenchido em mensagens fromMe
    // enviadas pelo nosso app — recebidas e antigas ficam null).
    .select(
      "*, enviadoPor:Colaborador!WhatsappMensagem_enviadoPorUserId_fkey(id, nome, cor)",
    )
    .eq("sessaoId", sessaoId)
    .eq("chatId", chatId);
  if (cursor) {
    // Aspas: o timestamp tem ":" e "+", que o filtro `or` trataria como sintaxe.
    q = q.or(
      `timestamp.lt."${cursor.ts}",and(timestamp.eq."${cursor.ts}",id.lt."${cursor.id}")`,
    );
  }
  const { data, error } = await q
    .order("timestamp", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE);
  if (error) throw error;
  return (data ?? []) as WhatsappMensagem[];
}

function proximoCursor(pagina: WhatsappMensagem[]): CursorMensagens | undefined {
  if (pagina.length < PAGE_SIZE) return undefined;
  // A mais antiga que veio do BANCO (fantasma não tem posição no banco).
  for (let i = pagina.length - 1; i >= 0; i--) {
    const m = pagina[i];
    if (!m._pendente && !m.id.startsWith("temp-")) return { ts: m.timestamp, id: m.id };
  }
  return undefined;
}

/**
 * Pré-carrega a primeira página de mensagens de uma conversa (hover na lista):
 * ao clicar, a conversa já abre com as mensagens, sem skeleton.
 */
export function preCarregarMensagens(qc: QueryClient, sessaoId: string, chatId: string) {
  return qc.prefetchInfiniteQuery({
    queryKey: ["whatsapp-mensagens", sessaoId, chatId],
    initialPageParam: null as CursorMensagens,
    queryFn: ({ pageParam }) => buscarPaginaMensagens(sessaoId, chatId, pageParam),
    getNextPageParam: proximoCursor,
    staleTime: 30_000,
  });
}

export function useMensagens(
  sessaoId: string | undefined,
  chatId: string | undefined,
) {
  // 🔴 O `enabled` do fim é o MESMO da query logo abaixo, e não é simetria
  // bonita: sem ele, o instante em que não há conversa aberta (a lista de
  // chats, que é onde se fica) trocava o filtro por `undefined` e assinava
  // `WhatsappMensagem` INTEIRA. A RLS roda por registro do WAL e por
  // assinante, então cada mensagem de cada conversa do escritório era avaliada
  // contra um assinante cuja query estava desligada e que não tinha o que
  // invalidar. Isto se lê no código e não depende de medição: com `chatId`
  // `undefined`, o terceiro argumento é `undefined`, e `undefined` quer dizer
  // a tabela toda.
  useRealtimeInvalidate(
    "WhatsappMensagem",
    [["whatsapp-mensagens", sessaoId ?? "", chatId ?? ""]],
    chatId ? { column: "chatId", value: chatId } : undefined,
    !!sessaoId && !!chatId,
  );
  return useInfiniteQuery({
    queryKey: ["whatsapp-mensagens", sessaoId ?? "", chatId ?? ""],
    enabled: !!sessaoId && !!chatId,
    initialPageParam: null as CursorMensagens,
    queryFn: ({ pageParam }) => buscarPaginaMensagens(sessaoId!, chatId!, pageParam),
    getNextPageParam: proximoCursor,
    staleTime: 5_000,
  });
}

/**
 * Resolve as mensagens CITADAS (alvo de um reply) que NÃO estão na janela de
 * mensagens carregada — busca por `wamId` direto no banco. É o que faz a
 * miniatura real da citação aparecer mesmo quando a imagem original está numa
 * página antiga (não paginada). Retorna um Map wamId → mensagem.
 *
 * Chave de cache inclui os wamIds ordenados, então a query só refaz quando o
 * conjunto de citações pendentes muda. RLS por tenant garante o escopo.
 */
export function useQuotedMensagens(
  sessaoId: string | undefined,
  wamIds: string[],
) {
  const chave = [...wamIds].sort().join(",");
  return useQuery({
    queryKey: ["whatsapp-quoted", sessaoId ?? "", chave],
    enabled: !!sessaoId && wamIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("WhatsappMensagem")
        .select("*")
        .eq("sessaoId", sessaoId!)
        .in("wamId", wamIds);
      if (error) throw error;
      const map = new Map<string, WhatsappMensagem>();
      for (const m of (data ?? []) as WhatsappMensagem[]) {
        if (m.wamId) map.set(m.wamId, m);
      }
      return map;
    },
  });
}

/**
 * Cria uma "mensagem fantasma" para otimismo — vai pro topo da lista
 * (primeira page) enquanto a chamada ao backend roda. Tipo pendente,
 * ack=0 (sem confirmação), com id `temp-...` para identificar/remover.
 */
function fantasmaTexto(args: {
  sessaoId: string;
  chatId: string;
  texto: string;
  replyTo?: string;
  replyToTexto?: string;
  colaborador?: { id: string; nome: string; cor: string } | null;
}): WhatsappMensagem {
  return {
    id: `temp-${crypto.randomUUID()}`,
    sessaoId: args.sessaoId,
    chatId: args.chatId,
    wamId: null,
    tipo: "text",
    texto: args.texto,
    mediaPath: null,
    mediaMime: null,
    mediaNomeArquivo: null,
    mediaTamanho: null,
    latitude: null,
    longitude: null,
    payload: null,
    replyToWamId: args.replyTo ?? null,
    replyToTexto: args.replyToTexto ?? null,
    replyToThumb: null,
    replyToTipo: null,
    reactions: [],
    ack: 0,
    fromMe: true,
    remetenteJid: null,
    remetenteNome: null,
    origem: "humano",
    enviadoPorUserId: args.colaborador?.id ?? null,
    enviadoPor: args.colaborador ?? null,
    timestamp: new Date().toISOString(),
    editadoEm: null,
    apagadoEm: null,
    criadoEm: new Date().toISOString(),
    _pendente: true,
  };
}

type MensagensCache = { pages: WhatsappMensagem[][]; pageParams: CursorMensagens[] };

function prependFantasma(
  qc: ReturnType<typeof useQueryClient>,
  sessaoId: string,
  chatId: string,
  msg: WhatsappMensagem,
) {
  qc.setQueryData<MensagensCache>(
    ["whatsapp-mensagens", sessaoId, chatId],
    (old) => {
      if (!old) return { pages: [[msg]], pageParams: [null] };
      // primeira page é a mais recente (order desc); prepend no início
      const [first = [], ...rest] = old.pages;
      return { ...old, pages: [[msg, ...first], ...rest] };
    },
  );
}

export function removerFantasma(
  qc: ReturnType<typeof useQueryClient>,
  sessaoId: string,
  chatId: string,
  tempId: string,
) {
  qc.setQueryData<MensagensCache>(
    ["whatsapp-mensagens", sessaoId, chatId],
    (old) => {
      if (!old) return old;
      const pages = old.pages.map((p) => p.filter((m) => m.id !== tempId));
      return { ...old, pages };
    },
  );
}

/** Marca a fantasma como falha: ela fica na tela com o aviso e o botão de
 *  reenviar. No adv3 ela sumia sem aviso e a pessoa achava que tinha ido. */
function marcarFantasmaComErro(
  qc: ReturnType<typeof useQueryClient>,
  sessaoId: string,
  chatId: string,
  tempId: string,
  erro: string,
) {
  qc.setQueryData<MensagensCache>(
    ["whatsapp-mensagens", sessaoId, chatId],
    (old) => {
      if (!old) return old;
      const pages = old.pages.map((p) =>
        p.map((m) => (m.id === tempId ? { ...m, _erro: erro } : m)),
      );
      return { ...old, pages };
    },
  );
}

/**
 * Promove a fantasma a definitiva no sucesso do envio: troca o id `temp-`
 * pelo id REAL do banco e marca ack=1 (enviada). A bubble fica visível e na
 * MESMA posição até o realtime refazer a query — aí a linha do banco (mesmo
 * id) substitui sem piscar nem pular. Antes a gente REMOVIA a fantasma no
 * retorno do HTTP e a msg sumia da tela até o eco do realtime chegar (uns
 * instantes depois) — era o "some e depois desce".
 */
function confirmarFantasma(
  qc: ReturnType<typeof useQueryClient>,
  sessaoId: string,
  chatId: string,
  tempId: string,
  realId: string,
  ack = 1,
) {
  qc.setQueryData<MensagensCache>(
    ["whatsapp-mensagens", sessaoId, chatId],
    (old) => {
      if (!old) return old;
      const pages = old.pages.map((p) =>
        p.map((m) => (m.id === tempId ? { ...m, id: realId, ack } : m)),
      );
      return { ...old, pages };
    },
  );
}

export function useEnviarTexto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      sessaoId: string;
      chatId: string;
      texto: string;
      replyTo?: string;
      /** Preview da citação — preenche a fantasma E persiste no backend, para
       *  que o reply não suma quando o realtime substitui a fantasma pela
       *  linha do banco (o webhook não deriva preview de mídia sem legenda). */
      replyToTexto?: string;
      /** Só para fantasma (iniciais na bolha); não vai no corpo. */
      colaborador?: { id: string; nome: string; cor: string } | null;
      /** Reenvio: id da fantasma com erro que esta tentativa substitui. */
      reenviarDe?: string;
    }) => {
      const { colaborador: _c, reenviarDe: _r, ...body } = args;
      return api<{ id: string }>("/whatsapp/messages/send-text", {
        method: "POST",
        body,
      });
    },
    onMutate: async (args) => {
      // Cancela qualquer refetch em voo para não sobrescrever nosso
      // update otimista.
      await qc.cancelQueries({
        queryKey: ["whatsapp-mensagens", args.sessaoId, args.chatId],
      });
      await qc.cancelQueries({ queryKey: ["whatsapp-chats"] });
      if (args.reenviarDe) removerFantasma(qc, args.sessaoId, args.chatId, args.reenviarDe);
      const msg = fantasmaTexto(args);
      prependFantasma(qc, args.sessaoId, args.chatId, msg);
      // Bumpa a conversa pro topo da lista NA HORA (última mensagem = agora),
      // sem esperar o refetch do onSettled. Antes a conversa que estava lá
      // embaixo demorava para subir após enviar.
      const snapshots = patchChatsCache(
        qc,
        (c) => c.sessaoId === args.sessaoId && c.chatId === args.chatId,
        (c) => ({
          ...c,
          ultimaMensagemEm: msg.timestamp,
          ultimaMensagemTexto: args.texto,
          ultimaMensagemFromMe: true,
        }),
      );
      return { tempId: msg.id, snapshots };
    },
    onSuccess: (res, args, ctx) => {
      // NÃO remover a fantasma — promovê-la a definitiva (id real + ack=1).
      // Assim ela nunca some da tela; quando o realtime invalidar e refazer
      // a query, a linha do banco (mesmo id) substitui de forma estável.
      if (ctx?.tempId && res?.id) {
        confirmarFantasma(qc, args.sessaoId, args.chatId, ctx.tempId, res.id);
      }
    },
    onError: (err, args, ctx) => {
      if (ctx?.tempId) {
        const msg = err instanceof Error ? err.message : "Falha ao enviar";
        const idGravado =
          err instanceof ErroDaApi && typeof err.dados?.id === "string" ? err.dados.id : null;
        if (idGravado) {
          // 424: o servidor gravou a linha com ack -1. Promove a fantasma
          // para esse id (senão a linha chegaria duplicada pelo realtime).
          confirmarFantasma(qc, args.sessaoId, args.chatId, ctx.tempId, idGravado, -1);
        }
        marcarFantasmaComErro(qc, args.sessaoId, args.chatId, idGravado ?? ctx.tempId, msg);
      }
      if (ctx?.snapshots) restaurarChatsSnapshots(qc, ctx.snapshots);
    },
    // Não invalidamos a lista aqui: o bump otimista já deixou a conversa no
    // topo com o preview certo. Um refetch imediato traria a ordem ANTIGA (o
    // servidor só atualiza `ultimaMensagemEm` quando o webhook ecoa), jogando
    // a conversa de volta para baixo até o eco chegar. O realtime do
    // WhatsappChat reconcilia quando a linha muda de verdade.
  });
}

export type EnviarMidiaArgs = {
  sessaoId: string;
  chatId: string;
  /** "image" → sendImage; "voice" → sendVoice; "video" → sendVideo; "file" → sendFile */
  kind: "image" | "voice" | "video" | "file";
  file: File;
  caption?: string;
  replyTo?: string;
  /** Preview da citação ("📷 Foto", "🎤 Áudio"…) — persistido no backend para
   *  o reply de mídia aparecer (webhook não deriva preview sem legenda). */
  replyToTexto?: string;
};

export function useEnviarMidia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: EnviarMidiaArgs) => {
      const ext = args.file.name.includes(".")
        ? "." + args.file.name.split(".").pop()
        : "";
      // A política do bucket só aceita upload do navegador em `denos/uploads/`.
      const path = `denos/uploads/${crypto.randomUUID()}${ext}`;
      const { error: upErr } = await supabase.storage
        .from("whatsapp-media")
        .upload(path, args.file, {
          contentType: args.file.type || "application/octet-stream",
        });
      if (upErr) throw upErr;

      return api<{ id: string }>("/whatsapp/messages/send-media", {
        method: "POST",
        body: {
          sessaoId: args.sessaoId,
          chatId: args.chatId,
          kind: args.kind,
          mediaPath: path,
          mimetype: args.file.type || undefined,
          filename: args.file.name,
          caption: args.caption,
          replyTo: args.replyTo,
          replyToTexto: args.replyToTexto,
        },
      });
    },
    // Bumpa a conversa pro topo enquanto envia a mídia (mesma UX do texto).
    onMutate: async (args) => {
      await qc.cancelQueries({ queryKey: ["whatsapp-chats"] });
      const rotulo =
        args.caption?.trim() ||
        (args.kind === "image"
          ? "📷 Foto"
          : args.kind === "voice"
            ? "🎤 Áudio"
            : args.kind === "video"
              ? "🎥 Vídeo"
              : "📄 Documento");
      const snapshots = patchChatsCache(
        qc,
        (c) => c.sessaoId === args.sessaoId && c.chatId === args.chatId,
        (c) => ({
          ...c,
          ultimaMensagemEm: new Date().toISOString(),
          ultimaMensagemTexto: rotulo,
          ultimaMensagemFromMe: true,
        }),
      );
      return { snapshots };
    },
    onError: (_err, args, ctx) => {
      if (ctx?.snapshots) restaurarChatsSnapshots(qc, ctx.snapshots);
      // 424: a linha foi gravada com ack -1 — recarrega para mostrar a falha.
      qc.invalidateQueries({ queryKey: ["whatsapp-mensagens", args.sessaoId, args.chatId] });
    },
    onSuccess: (_, args) => {
      qc.invalidateQueries({
        queryKey: ["whatsapp-mensagens", args.sessaoId, args.chatId],
      });
      // Não invalida a lista (mesmo motivo do texto): o bump otimista segura
      // a conversa no topo; o realtime reconcilia quando a linha muda.
    },
  });
}

export function useReagirMensagem() {
  return useMutation({
    mutationFn: async (args: {
      sessaoId: string;
      messageId: string;
      reaction: string;
    }) =>
      api<{ ok: true }>("/whatsapp/messages/react", {
        method: "POST",
        body: args,
      }),
  });
}

/** Encaminha uma mensagem (por wamId) para um ou mais chats da mesma sessão.
 *  A msg encaminhada aparece no destino via webhook/realtime. */
/** Resultado de cada destino do encaminhar (na ordem pedida). */
export type ResultadoEncaminhar = { chatId: string; ok: boolean; id?: string; motivo?: string; erro?: string };

export function useEncaminharMensagem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      sessaoId: string;
      messageId: string;
      toChatIds: string[];
    }) =>
      api<{ ok: boolean; enviados: number; falhas: number; resultados: ResultadoEncaminhar[] }>(
        "/whatsapp/messages/forward",
        { method: "POST", body: args },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp-chats"] });
    },
  });
}

/** Vota numa enquete recebida (best-effort — depende da engine do WAHA). */
export function useVotarEnquete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      sessaoId: string;
      chatId: string;
      pollMessageId: string;
      votes: string[];
    }) =>
      api<{ ok: boolean }>("/whatsapp/messages/poll-vote", {
        method: "POST",
        body: args,
      }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({
        queryKey: ["whatsapp-mensagens", v.sessaoId, v.chatId],
      });
    },
  });
}

export function useSendTyping() {
  return useMutation({
    mutationFn: async (args: {
      sessaoId: string;
      chatId: string;
      state: "typing" | "paused";
    }) =>
      api<{ ok: true }>("/whatsapp/messages/typing", {
        method: "POST",
        body: args,
      }),
  });
}

/**
 * Assina a presença do contato (individual) no WAHA para receber
 * "online/digitando/gravando". Auto-disparado ao abrir a conversa; sem isso
 * a engine GOWS não emite presence.update pro contato. O resultado aparece
 * no header por `usePresencaContato` (tabela WhatsappPresenca).
 */
export function useSubscribePresence() {
  return useMutation({
    mutationFn: (args: { sessaoId: string; chatId: string }) =>
      api<{ ok: true }>(
        `/whatsapp/sessoes/${encodeURIComponent(args.sessaoId)}/chats/${encodeURIComponent(args.chatId)}/presence-subscribe`,
        { method: "POST", body: {} },
      ),
  });
}

export type PresencaContato = {
  estado: "online" | "offline" | "typing" | "recording";
  /** Quando o estado foi observado — usado para expirar typing/online. */
  estadoEm: string;
  /** "Visto por último", quando o WhatsApp do contato expõe. */
  ultimoVistoEm: string | null;
};

/**
 * Presença do contato (online, digitando, gravando, visto por último) da
 * conversa ABERTA. Fica numa tabela própria, e não em WhatsappChat: cada
 * "digitando" do contato é uma escrita, e na WhatsappChat isso fazia a lista
 * de conversas de todas as abas abertas buscar tudo de novo. Aqui a
 * assinatura é só da linha desta conversa.
 */
export function usePresencaContato(chatRowId: string | undefined, enabled = true) {
  const ligado = enabled && !!chatRowId;
  useRealtimeInvalidate(
    "WhatsappPresenca",
    [["whatsapp-presenca", chatRowId ?? ""]],
    { column: "conversaId", value: chatRowId ?? "__none__" },
    ligado,
  );
  return useQuery({
    queryKey: ["whatsapp-presenca", chatRowId ?? ""],
    enabled: ligado,
    staleTime: 5_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("WhatsappPresenca")
        .select("estado, estadoEm, ultimoVistoEm")
        .eq("conversaId", chatRowId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as PresencaContato | null;
    },
  });
}

// ===========================================================================
// Mídia — signed URL para exibir no front
// ===========================================================================

/**
 * URL assinada da mídia, com CACHE em memória por caminho.
 *
 * 🔴 Sem o cache era uma ida ao Storage por AVATAR e por MÍDIA renderizada —
 * e a lista de conversas é virtualizada, então cada rolagem que devolve a
 * linha à tela remonta o avatar e pede a URL DE NOVO. Com 267 dos 322 chats
 * de produção tendo foto, abrir o chat e rolar rende centenas de
 * `createSignedUrl` para assinar sempre os mesmos caminhos.
 *
 * Três guardas que o cache sozinho não dá:
 *  • `emVoo` junta os pedidos simultâneos do MESMO caminho num só (a lista
 *    monta 50 avatares no mesmo tique — sem isto seriam 50 requisições antes
 *    de a primeira responder, e o cache não teria o que devolver);
 *  • o micro-lote (logo abaixo) junta os pedidos de caminhos DIFERENTES que
 *    caem no mesmo tique numa requisição só — é o que segura abrir conversa;
 *  • a validade guardada corta um minuto da assinatura, para nunca entregar
 *    uma URL que expira no caminho entre o cache e o <img>.
 */
const urlsAssinadas = new Map<string, { url: string; expiraEm: number }>();
const emVoo = new Map<string, Promise<string | null>>();
/** Teto de memória: caminho é string curta, mas a sessão fica aberta o dia todo. */
const MAX_URLS_CACHE = 500;

/**
 * 🔴 TERCEIRA GUARDA: os pedidos do MESMO tique viram UMA requisição.
 *
 * O cache e o `emVoo` resolvem repetição — a mesma foto pedida duas vezes. Não
 * resolviam o caso que dói de verdade, que é a PRIMEIRA vez: abrir uma conversa
 * monta uma página de 50 mensagens de uma vez, e cada bolha de mídia pedia a
 * própria URL no seu `useEffect`. Eram até 50 requisições ao Storage no mesmo
 * tique, todas para caminhos diferentes, então nenhuma das duas guardas
 * anteriores tinha o que juntar. O mesmo valia para as fotos de perfil da lista
 * de conversas.
 *
 * ⚠️ E `loading="lazy"` no `<img>` NÃO cobria isso. Ele adia o download dos
 * BYTES da imagem até ela chegar perto da tela; a assinatura da URL acontece
 * antes, no efeito, para toda mídia da página — inclusive a que ninguém vai
 * rolar até ver.
 *
 * Aqui os pedidos que chegam no mesmo tique são enfileirados e despachados num
 * `createSignedUrls` (plural), que assina a lista inteira de uma vez. O
 * `queueMicrotask` é o que junta a leva: o React roda os efeitos de um commit
 * em bloco síncrono, então a microtarefa só dispara depois que os 50 já
 * entraram na fila, e sem custar um quadro de atraso.
 */
type PedidoDeUrl = { path: string; resolve: (url: string | null) => void };
/** Filas por validade — a API assina o lote inteiro com UM prazo só. */
const filasPorValidade = new Map<number, PedidoDeUrl[]>();
let despachoAgendado = false;
/** Teto por requisição: lista gigante viraria um corpo enorme e um tempo só. */
const MAX_POR_LOTE = 100;

function guardarUrl(chave: string, url: string, expiresIn: number): void {
  if (urlsAssinadas.size >= MAX_URLS_CACHE) {
    // Descarta a mais antiga (Map preserva ordem de inserção).
    const primeira = urlsAssinadas.keys().next();
    if (!primeira.done) urlsAssinadas.delete(primeira.value);
  }
  urlsAssinadas.set(chave, {
    url,
    // Corta um minuto da assinatura, para nunca entregar uma URL que expira no
    // caminho entre o cache e o <img>.
    expiraEm: Date.now() + Math.max(expiresIn - 60, 30) * 1000,
  });
}

async function assinarLote(expiresIn: number, itens: PedidoDeUrl[]): Promise<void> {
  const paths = itens.map((i) => i.path);
  try {
    const { data, error } = await supabase.storage
      .from("whatsapp-media")
      .createSignedUrls(paths, expiresIn);
    if (error || !data) {
      itens.forEach((i) => i.resolve(null));
      return;
    }
    // Casa pelo caminho, com o índice como rede: a API devolve na mesma ordem
    // da entrada, mas depender só disso quebraria calado se ela mudasse.
    const porPath = new Map<string, string | null>();
    data.forEach((d) => {
      if (d?.path) porPath.set(d.path, d.signedUrl ?? null);
    });
    itens.forEach((item, idx) => {
      const url = porPath.get(item.path) ?? data[idx]?.signedUrl ?? null;
      if (url) guardarUrl(`${item.path}|${expiresIn}`, url, expiresIn);
      item.resolve(url);
    });
  } catch {
    // Nunca rejeita: quem chamou espera `null` para mostrar o placeholder, e uma
    // promessa rejeitada aqui viraria erro não tratado em 50 bolhas de uma vez.
    itens.forEach((i) => i.resolve(null));
  }
}

function agendarDespacho(): void {
  if (despachoAgendado) return;
  despachoAgendado = true;
  queueMicrotask(() => {
    despachoAgendado = false;
    const filas = [...filasPorValidade.entries()];
    filasPorValidade.clear();
    for (const [expiresIn, itens] of filas) {
      for (let i = 0; i < itens.length; i += MAX_POR_LOTE) {
        void assinarLote(expiresIn, itens.slice(i, i + MAX_POR_LOTE));
      }
    }
  });
}

export async function mediaSignedUrl(
  path: string,
  expiresIn = 60 * 30,
): Promise<string | null> {
  const chave = `${path}|${expiresIn}`;
  const guardada = urlsAssinadas.get(chave);
  if (guardada && guardada.expiraEm > Date.now()) return guardada.url;
  const pedido = emVoo.get(chave);
  if (pedido) return pedido;

  const promessa = new Promise<string | null>((resolve) => {
    const fila = filasPorValidade.get(expiresIn);
    if (fila) fila.push({ path, resolve });
    else filasPorValidade.set(expiresIn, [{ path, resolve }]);
    agendarDespacho();
  }).finally(() => emVoo.delete(chave));

  emVoo.set(chave, promessa);
  return promessa;
}

// ===========================================================================
// Contatos (participantes de grupo) — nome + foto cacheados via webhook
// ===========================================================================

export type WhatsappContato = {
  contatoId: string;
  lidId: string | null;
  nome: string | null;
  pushName: string | null;
  numero: string | null;
  fotoPath: string | null;
};

/**
 * Sync em batch: itera todos os chats com fotoPath=null da sessão e
 * tenta baixar foto de cada. Cap 40 por chamada no backend, paralelo 4.
 * Auto-disparado quando o usuário entra no módulo /app/chat — 1x por
 * sessão (controle no componente via sessionStorage ou ref).
 */
export function useSyncFotosPendentes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessaoId: string) =>
      api<{ ok: boolean; total: number; baixadas: number }>(
        `/whatsapp/sessoes/${encodeURIComponent(sessaoId)}/sync-fotos-pendentes`,
        { method: "POST", body: {} },
      ),
    onSuccess: (res) => {
      if (res.baixadas > 0) {
        qc.invalidateQueries({ queryKey: ["whatsapp-chats"] });
      }
    },
  });
}

/**
 * Força re-busca de fotos: chat (avatar do grupo) + cada participante
 * que apareceu em msgs deste chat. Limpa marcadores `__none__` antigos
 * antes de tentar. Auto-disparado ao abrir conversa de grupo.
 */
export function useRefreshFotos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { sessaoId: string; chatId: string }) =>
      api<{ ok: boolean; fotosBaixadas: number; contatos: number }>(
        `/whatsapp/sessoes/${encodeURIComponent(args.sessaoId)}/chats/${encodeURIComponent(args.chatId)}/refresh-fotos`,
        { method: "POST", body: {} },
      ),
    onSuccess: (res) => {
      if (res.fotosBaixadas > 0) {
        qc.invalidateQueries({ queryKey: ["whatsapp-chats"] });
        qc.invalidateQueries({ queryKey: ["whatsapp-contatos"] });
      }
    },
  });
}

/**
 * Recalcula a permissão de envio de um grupo (announce + admin, ou
 * removido) e persiste em WhatsappChat. Auto-disparado ao abrir uma
 * conversa de grupo — self-heal caso um evento group.v2.* tenha sido
 * perdido. Realtime de WhatsappChat atualiza a UI quando muda.
 */
export function useRefreshGrupoPermissao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { sessaoId: string; chatId: string }) =>
      api<{ ok: boolean; podeEnviar: boolean; motivo: string | null }>(
        `/whatsapp/sessoes/${encodeURIComponent(args.sessaoId)}/chats/${encodeURIComponent(args.chatId)}/refresh-group-permission`,
        { method: "POST", body: {} },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp-chats"] });
    },
  });
}

/**
 * Bulk refetch: tenta baixar mídia (image/video/audio/sticker/document)
 * de todas as msgs do chat com mediaPath=null. Auto-disparado pelo
 * frontend ao abrir conversa. Cap 30 msgs/chamada no backend.
 */
export function useRefetchMedias() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { sessaoId: string; chatId: string }) =>
      api<{ ok: boolean; total: number; baixadas: number }>(
        `/whatsapp/sessoes/${encodeURIComponent(args.sessaoId)}/chats/${encodeURIComponent(args.chatId)}/refetch-medias`,
        { method: "POST", body: {} },
      ),
    onSuccess: (res) => {
      if (res.baixadas > 0) {
        qc.invalidateQueries({ queryKey: ["whatsapp-mensagens"] });
      }
    },
  });
}

/**
 * Backfill: resolve @lid → @c.us para mensagens antigas de um grupo
 * (caso típico de grupos que vinham anônimos antes do fix do webhook).
 * Auto-disparado ao abrir conversa de grupo via chat-conversa.
 */
export function useBackfillParticipantes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { sessaoId: string; chatId: string }) =>
      api<{
        ok: boolean;
        lidsUnicos: number;
        resolvidos: number;
        mensagensAtualizadas: number;
      }>(
        `/whatsapp/sessoes/${encodeURIComponent(args.sessaoId)}/chats/${encodeURIComponent(args.chatId)}/backfill-participantes`,
        { method: "POST", body: {} },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp-mensagens"] });
      qc.invalidateQueries({ queryKey: ["whatsapp-contatos"] });
    },
  });
}

/**
 * Busca metadata (nome + foto) dos participantes de um grupo. O webhook
 * popula `WhatsappContato` a cada msg recebida — aqui só lê. Retorna
 * Map por contatoId pro lookup rápido na bubble.
 */
/**
 * Resultado da query: mapa por `contatoId` e por `lidId`. O segundo
 * é populado quando o contato foi resolvido a partir de um @lid e
 * guarda o LID original — assim o render de menções
 * (`@<lid_digits>` no texto) acha o nome direto.
 */
export type WhatsappContatosMap = {
  porContatoId: Map<string, WhatsappContato>;
  porLidId: Map<string, WhatsappContato>;
};

export function useWhatsappContatos(contatoIds: string[]) {
  // Ordem fixa para estabilizar queryKey
  const sortedIds = [...new Set(contatoIds)].sort();
  return useQuery({
    queryKey: ["whatsapp-contatos", sortedIds.join(",")],
    enabled: sortedIds.length > 0,
    queryFn: async (): Promise<WhatsappContatosMap> => {
      // Busca por contatoId OU por lidId — cobre tanto remetentes
      // já resolvidos (@c.us) quanto menções cruas que carregam LID.
      const orFilter = [
        `contatoId.in.(${sortedIds.map((s) => `"${s}"`).join(",")})`,
        `lidId.in.(${sortedIds.map((s) => `"${s}"`).join(",")})`,
      ].join(",");
      const { data, error } = await supabase
        .from("WhatsappContato")
        .select("contatoId, lidId, nome, pushName, numero, fotoPath")
        .or(orFilter);
      if (error) throw error;
      const porContatoId = new Map<string, WhatsappContato>();
      const porLidId = new Map<string, WhatsappContato>();
      for (const c of (data ?? []) as WhatsappContato[]) {
        porContatoId.set(c.contatoId, c);
        if (c.lidId) porLidId.set(c.lidId, c);
      }
      return { porContatoId, porLidId };
    },
    staleTime: 60_000,
  });
}

/**
 * Re-busca a mídia de uma mensagem cujo download falhou no webhook
 * (mediaPath ainda null). Útil para figurinhas/imagens que vieram sem
 * `media.url` em algumas engines do WAHA.
 */
export function useRefetchMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mensagemId: string) =>
      api<{ ok: boolean; mediaPath?: string }>(
        `/whatsapp/messages/refetch-media`,
        { method: "POST", body: { mensagemId } },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp-mensagens"] });
    },
  });
}

/**
 * Apaga uma mensagem própria no WhatsApp (delete-for-everyone). Marca
 * `apagadoEm` no banco — a bubble re-renderiza como "Mensagem apagada"
 * automaticamente. Só funciona em `fromMe`; o backend rejeita o resto.
 */
export function useApagarMensagem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mensagemId: string) =>
      api<{ ok: boolean }>(
        `/whatsapp/messages/${encodeURIComponent(mensagemId)}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp-mensagens"] });
    },
  });
}

/**
 * Edita o texto de uma mensagem própria. Manda a edição pro WhatsApp via
 * WAHA (PATCH) e atualiza texto/editadoEm no banco. Só funciona para msg de
 * texto enviada por você e dentro da janela de edição do WhatsApp (~15min).
 */
export function useEditarMensagem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ mensagemId, text }: { mensagemId: string; text: string }) =>
      api<{ ok: boolean }>(
        `/whatsapp/messages/${encodeURIComponent(mensagemId)}`,
        { method: "PATCH", body: { text } },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp-mensagens"] });
    },
  });
}

