// Cliente HTTP do servidor WAHA (https://waha.devlike.pro).
//
// Env vars (env do serviço `supabase` no Easypanel, repassadas pelo compose):
//   WAHA_BASE_URL          ex.: https://painel-waha.at63vf.easypanel.host
//                          (sem barra final)
//   WAHA_API_KEY           token. Enviado como `Authorization: Bearer` E
//                          `X-Api-Key` — WAHA Plus aceita os dois, WAHA
//                          Core prefere X-Api-Key. Mandar os dois cobre
//                          ambos sem branch.
//   WAHA_WEBHOOK_SECRET    segredo que o WAHA manda no header X-Waha-Secret
//                          (e usa como chave HMAC) pra o /whatsapp-webhook
//                          validar a origem.

const BASE_URL = (Deno.env.get("WAHA_BASE_URL") ?? "").replace(/\/$/, "");
const API_KEY = Deno.env.get("WAHA_API_KEY") ?? "";

export const WAHA_NAO_CONFIGURADO =
  "WAHA não configurado — defina WAHA_BASE_URL e WAHA_API_KEY no env do serviço supabase.";

export function wahaIsConfigured(): boolean {
  return !!BASE_URL && !!API_KEY;
}

function url(path: string): string {
  return `${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

type FetchOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  /** Timeout em ms. Default 10s. Override pra rotas conhecidamente lentas. */
  timeoutMs?: number;
  /**
   * Tentativas em 5xx transientes. Default 1 (sem retry). Endpoints de
   * envio de mídia setam 3.
   */
  retries?: number;
  /**
   * `false` = a chamada NÃO pode ser repetida às cegas (envio). Timeout e
   * erro de rede são ambíguos — o WhatsApp pode já ter recebido — e repetir
   * mandava a mesma foto duas ou três vezes (defeito 30 do guia). Nesse modo
   * só uma resposta 5xx explícita do WAHA é repetida. Default `true`.
   */
  idempotente?: boolean;
};

async function waha<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  if (!wahaIsConfigured()) {
    throw new Error(WAHA_NAO_CONFIGURADO);
  }
  const headers = new Headers(opts.headers);
  // Manda os dois cabeçalhos: WAHA Plus aceita Authorization, Core usa X-Api-Key.
  headers.set("Authorization", `Bearer ${API_KEY}`);
  headers.set("X-Api-Key", API_KEY);
  // Força JSON — sem isso /auth/qr volta image/png por content negotiation.
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (opts.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxAttempts = Math.max(1, opts.retries ?? 1);
  const idempotente = opts.idempotente ?? true;
  const { body: _b, timeoutMs: _t, retries: _r, idempotente: _i, ...init } = opts;

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url(path), {
        ...init,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        // Retry só em 5xx. 4xx é resposta definitiva (no adv3 um 4xx com
        // "UNKNOWN" no corpo também era repetido, ao contrário do comentário).
        const transient = res.status >= 500;
        if (transient && attempt < maxAttempts) {
          lastErr = new Error(`WAHA ${res.status} ${path}: ${text.slice(0, 300)}`);
          await sleep(attempt * 3000); // 3s, 6s, 9s
          continue;
        }
        throw new Error(`WAHA ${res.status} ${path}: ${text.slice(0, 500)}`);
      }
      if (res.status === 204) return undefined as T;
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) return (await res.json()) as T;
      return (await res.text()) as unknown as T;
    } catch (err) {
      // AbortError vira "WAHA timeout"; preserva mensagem útil
      if ((err as Error)?.name === "AbortError") {
        const timeoutErr = new Error(
          `WAHA timeout ${timeoutMs}ms ${path}`,
        );
        if (idempotente && attempt < maxAttempts) {
          lastErr = timeoutErr;
          await sleep(attempt * 3000);
          continue;
        }
        throw timeoutErr;
      }
      if (err instanceof Error && err.message.startsWith("WAHA ")) throw err;
      // Network error: tenta de novo se sobrar (só no que pode repetir)
      if (idempotente && attempt < maxAttempts) {
        lastErr = err;
        await sleep(attempt * 3000);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(tid);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("WAHA falha desconhecida");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ===========================================================================
// Sessions
// ===========================================================================

export type WahaSessionStatus =
  | "STOPPED"
  | "STARTING"
  | "SCAN_QR_CODE"
  | "WORKING"
  | "FAILED";

export type WahaSessionInfo = {
  name: string;
  status: WahaSessionStatus;
  me?: { id: string; pushName?: string } | null;
  config?: Record<string, unknown>;
};

export function getSessions() {
  return waha<WahaSessionInfo[]>("/api/sessions?all=true");
}

export function getSession(name: string) {
  return waha<WahaSessionInfo>(`/api/sessions/${encodeURIComponent(name)}`);
}

/**
 * Monta o objeto `config` que vai pro WAHA. Reutilizado por
 * createSession (POST) e setWebhook (PUT) pra garantir que a config
 * permanece idêntica nos dois caminhos — evita drift onde o create
 * está com 5 eventos mas o PUT está com config antiga só com webhook.
 */
function buildSessionConfig(args: {
  webhookUrl: string;
  webhookSecret?: string;
  /** Identificador opcional pra aparecer no WAHA admin (debug). */
  metadata?: Record<string, string>;
}): Record<string, unknown> {
  return {
    ...(args.metadata ? { metadata: args.metadata } : {}),
    // `ignore` filtra eventos na fonte (WAHA). Mais barato do que
    // ignorar depois no edge function — channels (newsletters) e
    // status/broadcast nem chegam pra processar. Grupos ficam pq
    // o app usa.
    ignore: {
      groups: false,
      channels: true,
      status: true,
      broadcast: true,
    },
    // GOWS-specific: controla o que o servidor mantém em memória.
    // messages: true é obrigatório pra `getMessageById` funcionar.
    gows: {
      storage: {
        messages: true,
        groups: true,
        chats: false,
        labels: false,
      },
    },
    webhooks: [
      {
        url: args.webhookUrl,
        // Eventos que realmente processamos no /whatsapp-webhook.
        // `group.v2.update` capta mudança de subject/foto do grupo —
        // sem ele, grupos novos ficam com nome=null (refresh-profile
        // tenta puxar mas algumas versões do WAHA retornam vazio).
        events: [
          "session.status",
          "message",
          "message.any",
          "message.ack",
          "message.revoked",
          // edição de mensagem → handleEdited atualiza texto + editadoEm
          "message.edited",
          // reação (emoji) → handleReaction faz upsert na lista de reactions
          "message.reaction",
          // voto em enquete → handlePollVote atualiza a contagem de votos
          "poll.vote",
          // presença do contato (online/digitando/gravando) → handlePresence
          // atualiza WhatsappChat pro header mostrar "digitando…/online".
          "presence.update",
          "group.v2.update",
          // Entrada/saída de participantes e saída do próprio número —
          // usados pra recalcular se ainda dá pra enviar no grupo
          // (announce/admin) e detectar remoção.
          "group.v2.participants",
          "group.v2.leave",
        ],
        retries: { delaySeconds: 2, attempts: 3, policy: "linear" },
        ...(args.webhookSecret
          ? {
              hmac: { key: args.webhookSecret },
              customHeaders: [
                { name: "X-Waha-Secret", value: args.webhookSecret },
              ],
            }
          : {}),
      },
    ],
  };
}

export function createSession(args: {
  name: string;
  webhookUrl: string;
  webhookSecret?: string;
  /** Map opcional pra rastrear no WAHA admin (ex.: tenantId). */
  metadata?: Record<string, string>;
  /**
   * `true` cria E inicia (gera QR de cara). `false` só registra a
   * sessão no WAHA, com config completa, deixando STOPPED — quem
   * dispara o start é o /start posterior. Default true (compat).
   */
  start?: boolean;
}) {
  return waha<WahaSessionInfo>("/api/sessions", {
    method: "POST",
    body: {
      name: args.name,
      start: args.start ?? true,
      // Força engine GOWS — a imagem do painel (`devlikeapro/waha:gows-*`)
      // já roda GOWS, mas pedir explícito evita drift caso o server seja
      // reconfigurado. GOWS é mais leve que WEBJS e suporta LID
      // resolution nativa (`/api/{session}/lids/{lid}`).
      engine: "GOWS",
      config: buildSessionConfig(args),
    },
    timeoutMs: 15_000,
  });
}

/**
 * Reconfigura a sessão existente — usado pra garantir que o webhook
 * está registrado quando a sessão já está WORKING mas eventos não
 * chegam. Resolve o sintoma "mensagem não atualiza em tempo real"
 * sem precisar derrubar e recriar a sessão.
 */
export function setWebhook(args: {
  name: string;
  webhookUrl: string;
  webhookSecret?: string;
  metadata?: Record<string, string>;
}) {
  return waha<WahaSessionInfo>(
    `/api/sessions/${encodeURIComponent(args.name)}`,
    {
      method: "PUT",
      body: { config: buildSessionConfig(args) },
      timeoutMs: 10_000,
    },
  );
}

export function startSession(name: string) {
  return waha<void>(`/api/sessions/${encodeURIComponent(name)}/start`, {
    method: "POST",
  });
}

export function stopSession(name: string) {
  return waha<void>(`/api/sessions/${encodeURIComponent(name)}/stop`, {
    method: "POST",
  });
}

export function restartSession(name: string) {
  return waha<void>(`/api/sessions/${encodeURIComponent(name)}/restart`, {
    method: "POST",
  });
}

export function logoutSession(name: string) {
  return waha<void>(`/api/sessions/${encodeURIComponent(name)}/logout`, {
    method: "POST",
  });
}

export function deleteSession(name: string) {
  return waha<void>(`/api/sessions/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

/** QR code em base64 (data URL: data:image/png;base64,...). */
export async function getQr(name: string): Promise<string> {
  const result = await waha<{ mimetype?: string; data?: string }>(
    `/api/${encodeURIComponent(name)}/auth/qr?format=image`,
    { timeoutMs: 15_000 },
  );
  if (typeof result === "string") return result;
  if (result?.data) {
    const mime = result.mimetype ?? "image/png";
    return `data:${mime};base64,${result.data}`;
  }
  throw new Error("Resposta inesperada do QR");
}

/**
 * Pareamento por código (alternativa ao QR): o WAHA pede ao WhatsApp um código
 * de 8 caracteres que a pessoa digita no celular em Aparelhos conectados →
 * Conectar com número de telefone. Só vale com a sessão em SCAN_QR_CODE.
 */
export async function requestPairingCode(name: string, phoneNumber: string): Promise<string> {
  const result = await waha<{ code?: string }>(
    `/api/${encodeURIComponent(name)}/auth/request-code`,
    { method: "POST", body: { phoneNumber }, timeoutMs: 20_000, idempotente: false },
  );
  const code = typeof result === "object" && result ? result.code : undefined;
  if (!code) throw new Error("Resposta inesperada do pareamento por código");
  return code;
}

// ===========================================================================
// Profile
// ===========================================================================

export function getMyProfile(session: string) {
  return waha<{ id: string; pushName: string; status?: string; picture?: string; name?: string }>(
    `/api/${encodeURIComponent(session)}/profile`,
  );
}

// ===========================================================================
// Contacts
// ===========================================================================

/**
 * Info básica do contato: pushName/name, isUser, isGroup, etc. Usa a
 * rota global (não por sessão) com query params — mesma assinatura do
 * resto da WAHA Plus.
 */
export function getContactInfo(args: { session: string; contactId: string }) {
  const qs = new URLSearchParams({
    contactId: args.contactId,
    session: args.session,
  });
  return waha<{
    id: string;
    name?: string;
    pushname?: string;
    shortName?: string;
    isMe?: boolean;
    isUser?: boolean;
    isGroup?: boolean;
    isBlocked?: boolean;
  }>(`/api/contacts?${qs.toString()}`);
}

/**
 * "Sobre" (About) do contato — texto curto que aparece no perfil
 * ("Disponível", "Em reunião", etc). Pode 403/404 se o contato
 * tiver privacidade restrita.
 */
export function getContactAbout(args: { session: string; contactId: string }) {
  const qs = new URLSearchParams({
    contactId: args.contactId,
    session: args.session,
  });
  return waha<{ about?: string | null }>(
    `/api/contacts/about?${qs.toString()}`,
  );
}

// ===========================================================================
// Groups
// ===========================================================================

/**
 * Info de um grupo do WhatsApp — `subject` é o nome que aparece no
 * cabeçalho da conversa. Quando o webhook recebe msg de chat tipo
 * `group`, esse endpoint dá o nome (msg.pushName traz só o nome do
 * remetente, não o do grupo).
 */
export function getGroup(session: string, groupId: string) {
  return waha<WahaGroup>(
    `/api/${encodeURIComponent(session)}/groups/${encodeURIComponent(groupId)}`,
  );
}

/**
 * Lista TODOS os grupos do WhatsApp daquela sessão. Endpoint confirmado
 * via Swagger oficial WAHA — retorna array de `GroupInfo` com `subject`
 * preenchido. Usado pra resolver o nome quando `getGroup(id)` vem com
 * subject vazio (acontece em algumas engines com cache desatualizado).
 *
 * `exclude=participants` corta payload — listas com 100+ grupos +
 * participantes ficam pesadas.
 */
/**
 * Engine GOWS (whatsmeow) retorna campos em camelCase (`JID`, `Name`)
 * enquanto WEBJS/NOWEB usam o padrão Swagger (`id`, `subject`). O type
 * cobre os dois e o caller normaliza via `groupIdOf()` / `groupSubjectOf()`.
 */
export type WahaGroupParticipant = {
  /** ID do membro em @c.us OU @lid. */
  id?: string;
  /** ID do membro em @c.us (phone number), quando o engine resolve. */
  pn?: string;
  role?: "left" | "participant" | "admin" | "superadmin" | string;
};

export type WahaGroup = {
  // GOWS
  JID?: string;
  Name?: string;
  Topic?: string;
  // WEBJS / NOWEB (Swagger padrão)
  id?: string;
  subject?: string;
  description?: string;
  /** `false` = só admins enviam (grupo announcement). GOWS pode omitir. */
  membersCanSendMessages?: boolean;
  participants?: WahaGroupParticipant[];
};

export function groupIdOf(g: WahaGroup): string | null {
  return g.JID ?? g.id ?? null;
}

export function groupSubjectOf(g: WahaGroup): string | null {
  return g.Name ?? g.subject ?? null;
}

/**
 * Normaliza o ID que o WAHA devolve em `session.me.id` pra só dígitos.
 *
 * Formatos típicos: "5511950218830@c.us", "5511950218830@s.whatsapp.net",
 * "5511950218830:1@c.us" (com device id). Coluna `WhatsappSessao.numero`
 * sempre deve ser só dígitos pra a comparação de "número conectado vs
 * número esperado" funcionar (vide GET /sessoes/:id no whatsapp/index.ts).
 */
export function phoneDigitsFromJid(
  id: string | null | undefined,
): string | null {
  if (!id) return null;
  const d = id.replace(/\D/g, "");
  return d || null;
}

export function listGroups(
  session: string,
  opts: { limit?: number; offset?: number; excludeParticipants?: boolean } = {},
) {
  const params = new URLSearchParams();
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.offset) params.set("offset", String(opts.offset));
  if (opts.excludeParticipants) params.set("exclude", "participants");
  const qs = params.toString();
  return waha<WahaGroup[]>(
    `/api/${encodeURIComponent(session)}/groups${qs ? `?${qs}` : ""}`,
  );
}

/**
 * Força o WAHA a re-sincronizar a lista de grupos do servidor do
 * WhatsApp. Sem isso, o cache local pode ficar com subject vazio pra
 * grupos antigos. Chama uma vez antes do batch refresh — barato e
 * resolve o caso típico de "Grupo · 12345" persistente.
 */
export function refreshGroupsFromServer(session: string): Promise<unknown> {
  return waha<unknown>(
    `/api/${encodeURIComponent(session)}/groups/refresh`,
    { method: "POST" },
  );
}

/**
 * Sai de um grupo. WAHA: POST /api/{session}/groups/{id}/leave.
 * Após sair, o número conectado deixa de receber mensagens do grupo.
 */
export function leaveGroup(session: string, groupId: string): Promise<unknown> {
  return waha<unknown>(
    `/api/${encodeURIComponent(session)}/groups/${encodeURIComponent(groupId)}/leave`,
    { method: "POST" },
  );
}

// ===========================================================================
// LIDs (Linked IDs → phone number resolution)
// ===========================================================================

/**
 * O WAHA respondeu que NÃO CONHECE o LID (404), em oposição a "não deu
 * pra perguntar" (timeout, rede, 5xx). Até 04/09/2026 os dois viravam o
 * mesmo `null`, e quem chamava tratava os dois como desconhecido.
 *
 * 🔴 A diferença decide se a primeira mensagem de um lead é DESCARTADA
 * ou REENTREGUE, e por isso mora numa função com nome e teste em vez de
 * numa condição solta dentro do `catch`: ali uma refatoração volta a
 * juntar os dois casos em silêncio, e o sintoma é o "oi" do lead sumindo
 * sem erro em lugar nenhum.
 */
export function wahaDisseQueNaoConhece(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("WAHA 404");
}

/**
 * Resolve um LID (Linked ID, formato "12345@lid") pro phone number real
 * (formato "5511...@c.us"). Usa engine GOWS pra resolução nativa.
 *
 * `null` quer dizer UMA coisa só: não há o que resolver (já é @c.us/@g.us)
 * ou o WAHA respondeu 404. Falha de infraestrutura ESTOURA, e quem chama
 * decide o que fazer — no webhook vira 500, o WAHA reentrega (`attempts: 3`)
 * e a segunda tentativa costuma resolver. Reentregar é seguro: o upsert de
 * mensagem ignora duplicata por `wamId`.
 *
 * ⚠️ O timeout é explícito e curto porque esta chamada está no caminho
 * SÍNCRONO do webhook. A partir do WAHA 2026.8.1 o `/lids/{lid}` consulta
 * o servidor do WhatsApp quando não conhece o LID (antes devolvia 404 na
 * hora), então o default de 10s do cliente virou tempo que o webhook
 * inteiro passa parado.
 */
export async function getPhoneFromLid(args: {
  session: string;
  lid: string;
}): Promise<string | null> {
  // Se já é @c.us ou @g.us, não precisa resolver — devolve null pra
  // sinalizar "nada a fazer".
  if (!args.lid.endsWith("@lid")) return null;
  try {
    const data = await waha<{ lid: string; pn?: string }>(
      `/api/${encodeURIComponent(args.session)}/lids/${encodeURIComponent(args.lid)}`,
      { timeoutMs: 6000 },
    );
    return data?.pn ?? null;
  } catch (err) {
    // 404 é resposta, não falha: acontece com contato que escreveu pela
    // primeira vez, antes de o GOWS conhecer o LID.
    if (wahaDisseQueNaoConhece(err)) return null;
    console.warn(
      "[getPhoneFromLid]",
      err instanceof Error ? err.message : String(err),
    );
    throw err;
  }
}

// ===========================================================================
// Chats
// ===========================================================================

export type WahaChat = {
  id: string;
  name?: string;
  isGroup?: boolean;
  picture?: string;
};

export function getChats(session: string, limit = 100, offset = 0) {
  return waha<WahaChat[]>(
    `/api/${encodeURIComponent(session)}/chats?limit=${limit}&offset=${offset}`,
  );
}

export function getChatsOverview(session: string, limit = 100) {
  return waha<
    Array<{
      id: string;
      name?: string;
      picture?: string;
      lastMessage?: WahaMessage;
    }>
  >(
    `/api/${encodeURIComponent(session)}/chats/overview?limit=${limit}`,
  );
}

export function getChatPicture(
  session: string,
  chatId: string,
  opts: { refresh?: boolean } = {},
) {
  const qs = opts.refresh ? "?refresh=true" : "";
  return waha<{ url?: string }>(
    `/api/${encodeURIComponent(session)}/chats/${encodeURIComponent(chatId)}/picture${qs}`,
  );
}

/**
 * `/api/{session}/groups/{id}/picture` — endpoint dedicado pra avatar
 * de grupo. Mais confiável que `chats/{chatId}/picture` em algumas
 * engines (NOWEB/GOWS) onde o endpoint genérico ignora `@g.us`.
 */
export function getGroupPicture(
  session: string,
  groupId: string,
  opts: { refresh?: boolean } = {},
) {
  const qs = opts.refresh ? "?refresh=true" : "";
  return waha<{ url?: string }>(
    `/api/${encodeURIComponent(session)}/groups/${encodeURIComponent(groupId)}/picture${qs}`,
  );
}

/**
 * `/api/contacts/profile-picture?contactId=...&session=...` — endpoint
 * dedicado pra avatar de contato individual. Mais confiável que o
 * genérico `/chats/{chatId}/picture` em engines novas (NOWEB/GOWS),
 * onde aquele só funcionava se o chat já estava cacheado.
 *
 * Resposta: string com a URL OU null (se privacy do WhatsApp bloqueia
 * ou o contato não tem foto). Em alguns deploys o WAHA retorna o
 * objeto `{ url }` em vez de string crua — cobrimos os dois casos.
 */
export async function getContactProfilePicture(
  session: string,
  contactId: string,
  opts: { refresh?: boolean } = {},
): Promise<string | null> {
  const params = new URLSearchParams({
    session,
    contactId,
    ...(opts.refresh ? { refresh: "true" } : {}),
  });
  try {
    const result = await waha<string | { url?: string } | null>(
      `/api/contacts/profile-picture?${params.toString()}`,
    );
    if (!result) return null;
    if (typeof result === "string") return result.length > 0 ? result : null;
    return result.url ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes(" 404")) return null;
    throw err;
  }
}

/**
 * Tipos de chat que o módulo aceita. Newsletter (canais do WhatsApp) e
 * broadcast (status / lista de transmissão) não fazem sentido pra um
 * escritório de contabilidade — são fontes de spam/ruído. `classifyChat()`
 * devolve `null` pra eles, sinalizando que quem chama deve pular.
 */
export type ChatKind = "individual" | "group";

export function classifyChat(chatId: string): ChatKind | null {
  if (chatId.endsWith("@g.us")) return "group";
  if (chatId.endsWith("@c.us")) return "individual";
  // @lid: Linked ID. Formato novo do WhatsApp pra identificadores
  // de privacidade — ex.: 59253519872216@lid. Conta como individual.
  // Pra obter o telefone real usar /api/{session}/lids/{lid} (já
  // exposto no waha-webhook quando precisar enriquecer o contato).
  if (chatId.endsWith("@lid")) return "individual";
  // @newsletter (canais), @broadcast (listas), status@broadcast (stories)
  // ficam de fora — não passam pela classificação.
  return null;
}

/**
 * Apaga o chat no WhatsApp (some pro dono do número). Em WAHA Core
 * pode não estar disponível — quem chama deve tolerar falha.
 */
export function deleteChat(session: string, chatId: string) {
  return waha<void>(
    `/api/${encodeURIComponent(session)}/chats/${encodeURIComponent(chatId)}`,
    { method: "DELETE" },
  );
}

/**
 * Limpa todas as mensagens do chat sem apagar o chat em si.
 * (No WhatsApp do dono do número equivale a "limpar conversa".)
 */
export function clearChatMessages(session: string, chatId: string) {
  return waha<void>(
    `/api/${encodeURIComponent(session)}/chats/${encodeURIComponent(chatId)}/messages`,
    { method: "DELETE" },
  );
}

// ===========================================================================
// Messages
// ===========================================================================

export type WahaMessage = {
  id: string;
  timestamp: number;
  from: string;
  fromMe: boolean;
  to?: string;
  body?: string;
  hasMedia?: boolean;
  // Com downloadMedia=true, a engine pode devolver `url` OU `data`
  // (base64 puro, sem prefixo data:). Cobrimos os dois.
  media?: {
    url?: string;
    mimetype?: string;
    filename?: string;
    data?: string;
    error?: string | null;
  };
  ack?: number;
  type?: string;
  // ... (WAHA tem mais campos; usamos só os essenciais)
  [key: string]: unknown;
};

export function getMessages(
  session: string,
  chatId: string,
  limit = 50,
  downloadMedia = false,
) {
  const params = new URLSearchParams({
    limit: String(limit),
    downloadMedia: String(downloadMedia),
  });
  return waha<WahaMessage[]>(
    `/api/${encodeURIComponent(session)}/chats/${encodeURIComponent(chatId)}/messages?${params}`,
  );
}

/**
 * Busca uma mensagem específica COM mídia anexada. Usado como fallback
 * quando o webhook chega com `media: {}` ou `media.url` ausente —
 * acontece com figurinhas/imagens em algumas combinações de engine.
 *
 * O retorno pode trazer `media.url` OU `media.data` (base64) — caller
 * deve cobrir os dois caminhos.
 *
 * Endpoint confirmado pela documentação do WAHA (anexa `?downloadMedia=true`):
 *   GET /api/{session}/chats/{chatId}/messages/{messageId}?downloadMedia=true
 */
export function getMessageWithMedia(
  session: string,
  chatId: string,
  messageId: string,
  // Documentos (PDF etc.) vêm inline em base64 e o WAHA precisa baixar +
  // empacotar antes de responder — costuma passar dos 10s padrão. Sem
  // timeout maior, TODA tentativa expira vazia e a mídia nunca baixa
  // (sintoma "documento não carrega"). Default generoso de 30s.
  timeoutMs = 30_000,
): Promise<WahaMessage> {
  return waha<WahaMessage>(
    `/api/${encodeURIComponent(session)}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}?downloadMedia=true`,
    { timeoutMs },
  );
}

/** Decodifica base64 (sem prefixo data:) pra Uint8Array em chunks
 *  pra não estourar memória com strings gigantes. */
export function base64ToBytes(b64: string): Uint8Array {
  // Remove prefix data:image/...;base64, se vier (defensive)
  const cleaned = b64.replace(/^data:[^;]+;base64,/, "");
  // O teto de mídia vale também pro base64 inline (no adv3 só valia pra
  // URL, defeito 35 do guia).
  const estimado = Math.floor((cleaned.length * 3) / 4);
  if (estimado > MAX_MEDIA_BYTES) {
    throw new MediaTooLargeError(estimado, "base64");
  }
  const binStr = atob(cleaned);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) {
    bytes[i] = binStr.charCodeAt(i);
  }
  return bytes;
}

export function sendText(args: {
  session: string;
  chatId: string;
  text: string;
  replyTo?: string;
}) {
  return waha<WahaMessage>("/api/sendText", {
    method: "POST",
    body: {
      session: args.session,
      chatId: args.chatId,
      text: args.text,
      ...(args.replyTo ? { reply_to: args.replyTo } : {}),
    },
    timeoutMs: 20_000,
    idempotente: false,
  });
}

/**
 * Confere se o telefone tem WhatsApp e devolve o chatId canônico que o
 * WhatsApp usa (resolve o 9º dígito). Usado pelo aviso de certificado, que
 * manda pra um telefone de cadastro e não pra uma conversa já existente.
 */
export function checkNumberExists(session: string, phone: string) {
  const qs = new URLSearchParams({ phone, session });
  return waha<{ numberExists?: boolean; chatId?: string | null }>(
    `/api/contacts/check-exists?${qs.toString()}`,
  );
}

/** Encaminha uma mensagem existente pra outro chat (mesma sessão). */
export function forwardMessage(args: {
  session: string;
  /** Chat de destino. */
  chatId: string;
  /** wamId da mensagem de origem. */
  messageId: string;
}) {
  return waha<WahaMessage>("/api/forwardMessage", {
    method: "POST",
    body: {
      session: args.session,
      chatId: args.chatId,
      messageId: args.messageId,
    },
  });
}

/** Vota numa enquete existente. `votes` = nomes das opções escolhidas. */
export function sendPollVote(args: {
  session: string;
  chatId: string;
  pollMessageId: string;
  votes: string[];
}) {
  return waha<WahaMessage>("/api/sendPollVote", {
    method: "POST",
    body: {
      session: args.session,
      chatId: args.chatId,
      pollMessageId: args.pollMessageId,
      pollServerId: null,
      votes: args.votes,
    },
    idempotente: false,
  });
}

// Opções comuns dos endpoints de envio de mídia: WAHA tem flakiness
// conhecida em sendImage/sendFile/sendVideo (500 com "connection
// reset"), então damos 3 tentativas e timeout maior. `idempotente: false`:
// timeout NÃO é repetido (a foto pode já ter saído), só o 5xx explícito.
const MEDIA_SEND_OPTS = { timeoutMs: 45_000, retries: 3, idempotente: false } as const;

export function sendImage(args: {
  session: string;
  chatId: string;
  /** URL pública OU data URL base64. */
  url?: string;
  base64?: string;
  mimetype?: string;
  filename?: string;
  caption?: string;
  replyTo?: string;
}) {
  return waha<WahaMessage>("/api/sendImage", {
    method: "POST",
    body: {
      session: args.session,
      chatId: args.chatId,
      file: args.url
        ? { url: args.url }
        : { mimetype: args.mimetype, filename: args.filename, data: args.base64 },
      caption: args.caption,
      ...(args.replyTo ? { reply_to: args.replyTo } : {}),
    },
    ...MEDIA_SEND_OPTS,
  });
}

export function sendFile(args: {
  session: string;
  chatId: string;
  url?: string;
  base64?: string;
  mimetype?: string;
  filename?: string;
  caption?: string;
  replyTo?: string;
}) {
  return waha<WahaMessage>("/api/sendFile", {
    method: "POST",
    body: {
      session: args.session,
      chatId: args.chatId,
      file: args.url
        ? { url: args.url }
        : { mimetype: args.mimetype, filename: args.filename, data: args.base64 },
      caption: args.caption,
      ...(args.replyTo ? { reply_to: args.replyTo } : {}),
    },
    ...MEDIA_SEND_OPTS,
  });
}

export function sendVoice(args: {
  session: string;
  chatId: string;
  url?: string;
  base64?: string;
  mimetype?: string;
  replyTo?: string;
}) {
  return waha<WahaMessage>("/api/sendVoice", {
    method: "POST",
    body: {
      session: args.session,
      chatId: args.chatId,
      file: args.url
        ? { url: args.url }
        : { mimetype: args.mimetype, data: args.base64 },
      // Força conversão pra opus se vier outro container (WhatsApp
      // só aceita opus em voice notes — sem isso o player do
      // destinatário nem mostra o áudio).
      convert: true,
      ...(args.replyTo ? { reply_to: args.replyTo } : {}),
    },
    ...MEDIA_SEND_OPTS,
  });
}

export function sendVideo(args: {
  session: string;
  chatId: string;
  url?: string;
  base64?: string;
  mimetype?: string;
  filename?: string;
  caption?: string;
  replyTo?: string;
}) {
  return waha<WahaMessage>("/api/sendVideo", {
    method: "POST",
    body: {
      session: args.session,
      chatId: args.chatId,
      file: args.url
        ? { url: args.url }
        : { mimetype: args.mimetype, filename: args.filename, data: args.base64 },
      caption: args.caption,
      // Força transcodificação pra H.264/AAC. Sem isso, vídeos com
      // codecs exóticos ficam "cinza" no app do destinatário (a UI
      // mostra o cartão mas o player não inicia).
      convert: true,
      ...(args.replyTo ? { reply_to: args.replyTo } : {}),
    },
    ...MEDIA_SEND_OPTS,
  });
}

export function reactToMessage(args: {
  session: string;
  messageId: string;
  reaction: string; // emoji ou "" pra remover
}) {
  return waha<void>("/api/reaction", {
    method: "PUT",
    body: {
      session: args.session,
      messageId: args.messageId,
      reaction: args.reaction,
    },
  });
}

export function markChatRead(session: string, chatId: string) {
  return waha<void>(
    `/api/${encodeURIComponent(session)}/chats/${encodeURIComponent(chatId)}/messages/read`,
    { method: "POST", body: {} },
  );
}

export function sendTyping(args: {
  session: string;
  chatId: string;
  /** "typing" | "paused" */
  state: "typing" | "paused";
}) {
  const path =
    args.state === "typing"
      ? `/api/startTyping`
      : `/api/stopTyping`;
  return waha<void>(path, {
    method: "POST",
    body: { session: args.session, chatId: args.chatId },
  });
}

// ===========================================================================
// Presence (presença do contato — online/digitando/gravando)
// ===========================================================================

/**
 * Assina a presença de um chat individual. SEM isso, a engine GOWS não
 * emite `presence.update` pra esse contato — presença é opt-in por contato
 * no WhatsApp. Chamado quando o usuário abre a conversa. Best-effort: pode
 * 404/erro se o contato restringiu presença na privacidade.
 */
export function subscribePresence(session: string, chatId: string) {
  return waha<void>(
    `/api/${encodeURIComponent(session)}/presence/${encodeURIComponent(chatId)}/subscribe`,
    { method: "POST" },
  );
}

export function deleteMessage(args: {
  session: string;
  chatId: string;
  messageId: string;
}) {
  return waha<void>(
    `/api/${encodeURIComponent(args.session)}/chats/${encodeURIComponent(args.chatId)}/messages/${encodeURIComponent(args.messageId)}`,
    { method: "DELETE" },
  );
}

export function editMessage(args: {
  session: string;
  chatId: string;
  messageId: string;
  text: string;
}) {
  return waha<void>(
    `/api/${encodeURIComponent(args.session)}/chats/${encodeURIComponent(args.chatId)}/messages/${encodeURIComponent(args.messageId)}`,
    { method: "PUT", body: { text: args.text } },
  );
}

// ===========================================================================
// Mídia — baixa um arquivo do servidor WAHA (URL relativa /api/files/...)
// ===========================================================================

/**
 * Tamanho máximo de mídia que aceitamos baixar do WAHA (25MB). Acima
 * disso o webhook descarta — protege a quota de storage do tenant
 * contra um único arquivo grande (foto/vídeo em alta resolução). O
 * limite vale pra todos os tipos (imagem, vídeo, áudio, documento).
 */
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

export class MediaTooLargeError extends Error {
  constructor(public readonly size: number, public readonly url: string) {
    super(`Mídia maior que ${MAX_MEDIA_BYTES} bytes (recebeu ${size})`);
    this.name = "MediaTooLargeError";
  }
}

/**
 * Baixa um asset (mídia) do servidor WAHA. Aceita tanto URLs absolutas
 * (https://waha.example.com/api/files/...) quanto relativas (/api/files/...).
 *
 * Tem cap de tamanho (`MAX_MEDIA_BYTES`):
 *   1. Tenta via HEAD pra ler Content-Length antes de baixar — economiza
 *      banda quando o servidor responde.
 *   2. Se HEAD falhar ou não vier Content-Length, baixa mas verifica
 *      o tamanho final do buffer.
 *   3. Em qualquer dos casos, ultrapassando o cap, lança MediaTooLargeError
 *      pra quem chamou decidir (geralmente o webhook salva a mensagem sem
 *      a mídia + flag indicando que excedeu).
 */
/**
 * Reescreve URLs internas do WAHA pra usar o `WAHA_BASE_URL` público.
 *
 * Quando o WAHA roda em container/servidor remoto, o `media.url` no
 * payload do webhook pode vir com referência INTERNA dele:
 *   - "http://localhost:3000/api/files/..."
 *   - "http://127.0.0.1:3000/api/files/..."
 *   - "http://waha:3000/api/files/..." (docker-compose service)
 *
 * Da nossa Edge Function, `localhost` é a própria Edge — fetch falha.
 * Reescrevemos pra extrair só o path (`/api/files/...`) e prefixar com
 * o `BASE_URL` configurado (URL pública do WAHA).
 *
 * Hardening anti-SSRF: depois do rewrite, validamos que a URL final
 * tem o mesmo `hostname:port` do `BASE_URL`. Se um WAHA comprometido
 * tentasse mandar `media.url = "https://internal.attacker.com/x"`
 * (hostname externo, com ponto), o rewrite acima não dispararia e a
 * URL passaria direto. A validação rejeita qualquer alvo que não
 * seja o WAHA configurado.
 */
function rewriteInternalMediaUrl(mediaUrl: string): string {
  try {
    const u = new URL(mediaUrl);
    const isInternal =
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname === "0.0.0.0" ||
      u.hostname === "host.docker.internal" ||
      // Hosts sem ponto = nome de serviço docker (ex.: "waha", "api")
      !u.hostname.includes(".");
    if (isInternal) {
      return `${BASE_URL}${u.pathname}${u.search}`;
    }
    return mediaUrl;
  } catch {
    // Não é URL absoluta válida — passa adiante (url() vai prefixar)
    return mediaUrl;
  }
}

/**
 * Bloqueia SSRF: depois do rewrite, garante que o target é um host
 * confiável. Aceita:
 *   1. O próprio `WAHA_BASE_URL` (WAHA proxia mídia em algumas engines)
 *   2. CDN do WhatsApp — engines novas (GOWS) retornam URLs diretas pro
 *      `pps.whatsapp.net` / `mmg.whatsapp.net` (profile picture e media).
 *      Não tem como o WAHA "comprometido" injetar nessa lista — o domínio
 *      é fixo e público do Meta. Defesa em profundidade mantida.
 */
function isHostAllowed(target: string): boolean {
  try {
    const wahaOrigin = new URL(BASE_URL).origin;
    const u = new URL(target);
    if (u.origin === wahaOrigin) return true;
    // *.whatsapp.net = CDN do WhatsApp (profile pics, media downloads)
    if (
      u.hostname === "whatsapp.net" ||
      u.hostname.endsWith(".whatsapp.net")
    ) {
      return u.protocol === "https:";
    }
    return false;
  } catch {
    return false;
  }
}

function assertSameOriginAsWaha(target: string): void {
  if (!isHostAllowed(target)) {
    let host = target;
    try {
      host = new URL(target).origin;
    } catch {/* noop */}
    throw new Error(
      `URL fora do WAHA configurado bloqueada: ${host}`,
    );
  }
}

export async function downloadMedia(
  mediaUrl: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const target = mediaUrl.startsWith("http")
    ? rewriteInternalMediaUrl(mediaUrl)
    : url(mediaUrl);
  // SSRF guard: só baixa de hosts confiáveis (WAHA configurado +
  // CDN do WhatsApp).
  assertSameOriginAsWaha(target);
  // Auth header só pro WAHA — CDN do WhatsApp é público, mandar header
  // estranho pode causar 400.
  const wahaOrigin = new URL(BASE_URL).origin;
  const targetOrigin = new URL(target).origin;
  const reqHeaders: Record<string, string> =
    targetOrigin === wahaOrigin
      ? { Authorization: `Bearer ${API_KEY}`, "X-Api-Key": API_KEY }
      : {};

  // Pre-flight HEAD: alguns servidores WAHA respondem 405 (Method Not
  // Allowed), o que é OK — caímos no fallback de checar pós-download.
  try {
    const headCtrl = new AbortController();
    const tid = setTimeout(() => headCtrl.abort(), 5_000);
    const head = await fetch(target, {
      method: "HEAD",
      headers: reqHeaders,
      signal: headCtrl.signal,
      redirect: "manual",
    });
    clearTimeout(tid);
    if (head.ok) {
      const len = Number(head.headers.get("content-length") ?? 0);
      if (len > MAX_MEDIA_BYTES) {
        throw new MediaTooLargeError(len, target);
      }
    }
  } catch (err) {
    if (err instanceof MediaTooLargeError) throw err;
    // HEAD falhou (405, timeout, etc) — segue pro GET, limite ainda
    // é checado no buffer.
  }

  // GET com timeout maior (mídia grande): 30s.
  //
  // 🔴 `redirect: "manual"`: seguir redirecionamento sozinho contornava a
  // allowlist acima (o host confiável responde 302 pra qualquer lugar,
  // defeito 35 do guia). Cada salto é conferido de novo, e a chave do WAHA
  // só vai pra origem do WAHA.
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 30_000);
  try {
    let atual = target;
    let headersAtuais = reqHeaders;
    let res: Response | null = null;
    for (let salto = 0; salto < 4; salto++) {
      res = await fetch(atual, {
        headers: headersAtuais,
        signal: controller.signal,
        redirect: "manual",
      });
      if (res.status < 300 || res.status >= 400) break;
      const loc = res.headers.get("location");
      await res.body?.cancel();
      if (!loc) throw new Error(`Download mídia ${res.status} sem Location`);
      atual = new URL(loc, atual).toString();
      assertSameOriginAsWaha(atual);
      headersAtuais = new URL(atual).origin === wahaOrigin ? reqHeaders : {};
      res = null;
    }
    if (!res) throw new Error("Download mídia: redirecionamentos demais");
    if (!res.ok) {
      throw new Error(`Download mídia ${res.status}: ${new URL(atual).origin}`);
    }
    // Teto conferido DURANTE a leitura, não só no fim: um servidor sem
    // Content-Length não consegue mais encher a memória da function.
    const reader = res.body?.getReader();
    const partes: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_MEDIA_BYTES) {
          await reader.cancel();
          throw new MediaTooLargeError(total, atual);
        }
        partes.push(value);
      }
    }
    const buf = new Uint8Array(total);
    let off = 0;
    for (const p of partes) {
      buf.set(p, off);
      off += p.byteLength;
    }
    return {
      bytes: buf,
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
    };
  } finally {
    clearTimeout(tid);
  }
}

// ===========================================================================
// ACK helpers
// ===========================================================================

/**
 * Converte o `ack` numérico do WAHA num status legível pra UI.
 *
 * WAHA usa convenção do Baileys:
 *   -1 → erro (mensagem rejeitada)
 *    0 → pendente (saiu da sua tela, mas o WhatsApp ainda não confirmou)
 *    1 → enviado (✓ — chegou no servidor do WhatsApp)
 *    2 → entregue (✓✓ cinza — celular do destinatário recebeu)
 *    3 → lido (✓✓ azul — destinatário abriu a conversa)
 *    4 → tocado (só áudio — o destinatário deu play)
 */
export type AckStatus =
  | "error"
  | "pending"
  | "sent"
  | "delivered"
  | "read"
  | "played";

export function ackToStatus(ack: number | null | undefined): AckStatus {
  switch (ack) {
    case -1:
      return "error";
    case 1:
      return "sent";
    case 2:
      return "delivered";
    case 3:
      return "read";
    case 4:
      return "played";
    default:
      return "pending";
  }
}
