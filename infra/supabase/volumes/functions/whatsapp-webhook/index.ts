// Edge Function: whatsapp-webhook
// URL: https://painel-supabase.at63vf.easypanel.host/functions/v1/whatsapp-webhook
//
// Recebe eventos do servidor WAHA e persiste no banco. Pública (o WAHA não
// tem chave do Supabase) mas EXIGE o header X-Waha-Secret igual ao
// WAHA_WEBHOOK_SECRET, comparado em tempo constante. Sem o segredo
// configurado, rejeita tudo com 503.
//
// Eventos tratados:
//   session.status          → atualiza WhatsappSessao
//   message                 → nova msg recebida (insere + atualiza chat)
//   message.any             → toda msg incl. enviadas via outro device
//   message.ack             → atualiza ack (só pra frente)
//   message.reaction        → upsert na lista de reactions
//   poll.vote               → atualiza a contagem de votos da enquete
//   presence.update         → presença do contato (digitando/online) no chat
//   message.revoked         → marca apagadoEm
//   message.edited          → atualiza texto + editadoEm
//   group.v2.update         → atualiza nome do grupo + permissão de envio
//   group.v2.participants   → recalcula permissão de envio
//   group.v2.leave          → marca o grupo como "removido"
//
// Mídia: se a mensagem tem media URL, baixa do WAHA e salva no Storage.
//
// ===========================================================================
// 🔴 200 x 500 — A SEMÂNTICA QUE NÃO PODE SE PERDER
// ===========================================================================
// O WAHA reentrega o que não for 2xx (`retries: attempts 3`). Então:
//   • 200 pro que NUNCA vai dar certo: envelope inválido, sessão desconhecida
//     (zumbi no WAHA), evento sem payload. Reentregar só gastaria.
//   • 500 pro que PODE dar certo na próxima: banco fora, WAHA lento pra
//     resolver um @lid, erro ao gravar a mensagem. No adv3 o erro de banco ao
//     gravar mensagem era ignorado e a resposta era 200 — a mensagem se
//     perdia sem aviso (defeito 28 do guia). Aqui toda escrita essencial
//     confere `.error` e estoura.
// Reentregar é seguro: a mensagem é deduplicada pela chave única
// (tenantId, sessaoId, wamId).
//
// Os formatos de payload abaixo são os REAIS do GOWS, levantados no log de
// produção do adv3 (capítulo 04 do guia, seção 6). Vários handlers do adv3
// liam campos que o GOWS nunca manda (reação, revogação, grupo, nome do
// autor) e por isso nunca gravavam nada (defeitos 21, 24 e 49).

import { handleCors } from "../_shared/cors.ts";
import { badRequest, json, mensagemErroInterno, novoErroId, unauthorized } from "../_shared/response.ts";
import { serve } from "../_shared/serve.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import * as waha from "../_shared/waha.ts";
import { ensureSessaoAvatar, refreshChatProfile } from "../_shared/whatsapp-avatar.ts";
import { ensureContato } from "../_shared/whatsapp-contato.ts";
import { persistMediaIfAny } from "../_shared/whatsapp-media.ts";
import {
  applyGroupSendPermission,
  refreshGroupSendPermission,
} from "../_shared/whatsapp-group-perms.ts";
import { recordError } from "../_shared/error-log.ts";
import { timingSafeEqual } from "../_shared/acesso.ts";
import { runAfterResponse } from "../_shared/background.ts";
import { garantirChat } from "../_shared/whatsapp-envio.ts";

const WEBHOOK_SECRET = Deno.env.get("WAHA_WEBHOOK_SECRET") ?? "";

if (!WEBHOOK_SECRET) {
  // Log alto antes de qualquer request chegar. NÃO derruba o Deno.serve; em
  // vez disso o handler rejeita TODA request com 503 enquanto estiver vazio.
  console.error(
    "[whatsapp-webhook] FATAL: WAHA_WEBHOOK_SECRET não configurado. " +
      "Webhook fica rejeitando 503 até ser setado no env do serviço supabase.",
  );
}

/** Perfil (nome/sobre/foto) é re-perguntado ao WAHA no máximo a cada 7 dias. */
const PERFIL_VALIDADE_MS = 7 * 24 * 60 * 60 * 1000;

type WahaWebhookEvent = {
  event: string;
  session: string;
  payload: Record<string, unknown>;
  me?: { id?: string; pushName?: string } | null;
  timestamp?: number;
};

/**
 * Tira o `_data` do payload antes de gravar em `WhatsappEventoLog`.
 *
 * `_data` é o dump interno do engine do WhatsApp, e sozinho era **76% da
 * tabela** no adv3. Fica de fora só o log; o processamento recebe o payload
 * íntegro. Tira também o `_data` aninhado em `after` (revogação) e
 * `replyTo` (toda mensagem citada), que no adv3 iam inteiros pro log.
 */
function semDataCru(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    // Evento sem payload de objeto continua sendo gravado como veio: é
    // justamente o caso estranho que se quer poder investigar depois.
    return (payload ?? {}) as Record<string, unknown>;
  }
  const { _data: _descartado, ...resto } = payload as Record<string, unknown>;
  for (const k of ["after", "before", "replyTo"]) {
    const v = resto[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const { _data: _x, ...semData } = v as Record<string, unknown>;
      resto[k] = semData;
    }
  }
  return resto;
}

/**
 * Lookup local da sessão pelo nome WAHA (`denos_<numero>`). Em vez de
 * parsear o nome, SELECT direto no banco.
 *
 * **Propaga erro de banco** (não engole): o caller precisa distinguir
 * "sessão genuinamente desconhecida" (data null) de "falha transitória
 * no banco" (throw).
 */
async function lookupSessao(
  sessionName: string,
): Promise<{ id: string; tenantId: string; numero: string | null } | null> {
  const { data, error } = await supabaseAdmin
    .from("WhatsappSessao")
    .select("id, tenantId, numero")
    .eq("nome", sessionName)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ===========================================================================
// Helpers de leitura do payload
// ===========================================================================

/** `_data.Info` do GOWS (whatsmeow). */
function gowsInfo(msg: Record<string, unknown>): Record<string, unknown> {
  const d = msg._data as { Info?: Record<string, unknown> } | undefined;
  return (d?.Info ?? {}) as Record<string, unknown>;
}

/**
 * Resolve o JID real do remetente DENTRO de uma mensagem de grupo.
 *
 * Em grupos, `payload.from` é o CHAT (o grupo) — quem mandou está em outro
 * campo. No GOWS é `participant` (em geral `@lid`) e `_data.Info.Sender`;
 * WEBJS usa `author`. Ignora qualquer valor igual ao chatId do grupo.
 */
function extractRemetenteId(
  msg: Record<string, unknown>,
  chatId: string,
): string | null {
  const info = gowsInfo(msg);
  const candidatos: Array<unknown> = [
    msg.participant,
    msg.author,
    msg.participantPn,
    info.SenderAlt, // GOWS: às vezes o @c.us quando Sender é @lid
    info.Sender,
    info.SenderJID,
  ];
  for (const c of candidatos) {
    if (typeof c === "string" && c.length > 0 && c !== chatId) {
      // whatsmeow pode mandar "5511...:12@s.whatsapp.net" (com device)
      return normalizarJid(c);
    }
  }
  return null;
}

/** "5511...:12@s.whatsapp.net" → "5511...@c.us"; demais ficam como vieram. */
function normalizarJid(jid: string): string {
  const m = jid.match(/^(\d+)(?::\d+)?@s\.whatsapp\.net$/);
  if (m) return `${m[1]}@c.us`;
  return jid.replace(/:\d+@/, "@");
}

/**
 * pushName do remetente. 🔴 No GOWS o nome mora em `_data.Info.PushName` —
 * no adv3 a função procurava `msg.Info.PushName` (no topo, que não existe) e
 * nenhuma mensagem de grupo teve nome do autor em 30 dias (defeito 49).
 */
function extractRemetenteNome(msg: Record<string, unknown>): string | null {
  const info = gowsInfo(msg);
  const d = (msg._data ?? {}) as Record<string, unknown>;
  const candidatos: Array<unknown> = [
    info.PushName,
    msg.notifyName,
    msg.pushName,
    d.notifyName,
    d.pushName,
  ];
  for (const c of candidatos) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return null;
}

/**
 * Detecta o tipo da mensagem cobrindo as engines do WAHA:
 *   - WEBJS/NOWEB: `msg.type` direto ("image", "sticker", "ptt"…)
 *   - GOWS (whatsmeow): `msg.type` é null; tipo fica em
 *     `msg._data.Info.Type` ("media" ou "text") + `msg._data.Info.MediaType`.
 */
function inferTipo(msg: Record<string, unknown>): string {
  let type = msg.type as string | undefined;

  if (!type) {
    const info = gowsInfo(msg) as { Type?: string; MediaType?: string };
    if (info?.Type === "media" && info?.MediaType) {
      type = info.MediaType;
    } else if (info?.Type) {
      type = info.Type;
    }
  }

  // GOWS: tipos ricos vêm em `_data.Message.*` mesmo quando Info.Type é
  // "text". Detecta pelo conteúdo ANTES dos cases de texto.
  const gm = gowsMessage(msg);
  // Mensagem NÃO-descriptografável: o whatsmeow entrega só um
  // `placeholderMessage` quando não consegue abrir o ciphertext. Marca como
  // "placeholder" pra a UI rotular em vez de mostrar um balão em branco.
  if (
    gm.placeholderMessage &&
    !msg.body &&
    !msg.caption &&
    !gm.conversation &&
    !gm.extendedTextMessage &&
    !gm.imageMessage &&
    !gm.videoMessage &&
    !gm.audioMessage &&
    !gm.documentMessage &&
    !gm.stickerMessage
  ) {
    return "placeholder";
  }
  if (gm.pollCreationMessageV3 || gm.pollCreationMessage || gm.pollCreationMessageV2) {
    return "poll";
  }
  if (gm.locationMessage) return "location";
  if (gm.contactMessage || gm.contactsArrayMessage) return "contact";
  if (gm.buttonsResponseMessage || gm.templateButtonReplyMessage || gm.listResponseMessage) {
    return "buttons";
  }
  if (type === "buttons_response" || type === "list_response" || type === "interactive") {
    return "buttons";
  }

  if (type === "chat" || type === "text") return "text";
  if (type === "image") return "image";
  // GIF do WhatsApp é um MP4 — trata como vídeo pra baixar e tocar.
  if (type === "video" || type === "gif") return "video";
  if (type === "audio" || type === "ptt") return "audio";
  if (type === "document") return "document";
  if (type === "sticker") return "sticker";
  if (type === "location") return "location";
  if (type === "vcard" || type === "contact") return "contact";
  if (type === "poll" || type === "poll_creation") return "poll";
  // Álbum: o WhatsApp manda uma mensagem vazia "collection" antes das fotos.
  if (type === "collection" || gm.albumMessage) return "album";
  return type ?? "text";
}

/** Wrappers do proto que só EMBRULHAM outra mensagem. */
const WRAPPERS_PROTO = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "deviceSentMessage",
  "documentWithCaptionMessage",
  "editedMessage",
] as const;

/**
 * Sub-objeto `_data.Message` do GOWS / `_data.message` do NOWEB — onde mora o
 * conteúdo rico. Desembrulha os wrappers em cadeia, com limite de
 * profundidade (o proto é entrada externa).
 */
// deno-lint-ignore no-explicit-any
function gowsMessage(msg: Record<string, unknown>): Record<string, any> {
  const d = msg._data as
    | { Message?: Record<string, unknown>; message?: Record<string, unknown> }
    | undefined;
  // deno-lint-ignore no-explicit-any
  let m = (d?.Message ?? d?.message ?? {}) as Record<string, any>;
  for (let i = 0; i < 5; i++) {
    const w = WRAPPERS_PROTO.find((k) => m[k] && typeof m[k] === "object" && m[k].message);
    if (!w) break;
    // deno-lint-ignore no-explicit-any
    m = m[w].message as Record<string, any>;
  }
  return m;
}

/**
 * Texto legível das mensagens da **API oficial** (template/menu/botão), que
 * chegam sem `conversation`: o `body` vem vazio e o balão ficaria em branco.
 */
// deno-lint-ignore no-explicit-any
function textoDeOficial(m: Record<string, any>): string | null {
  const partes: Array<string | undefined> = [];
  const tpl = m.templateMessage;
  const hyd = tpl?.hydratedTemplate ?? tpl?.hydratedFourRowTemplate ?? tpl?.fourRowTemplate;
  if (hyd) {
    partes.push(hyd.hydratedTitleText, hyd.hydratedContentText, hyd.hydratedFooterText);
    partes.push(hyd.imageMessage?.caption, hyd.videoMessage?.caption, hyd.documentMessage?.fileName);
  }
  const im = m.interactiveMessage;
  if (im) partes.push(im.header?.title, im.body?.text, im.footer?.text);
  const irm = m.interactiveResponseMessage;
  if (irm) partes.push(irm.body?.text, irm.nativeFlowResponseMessage?.name);
  const bm = m.buttonsMessage;
  if (bm) partes.push(bm.text, bm.contentText, bm.footerText);
  const lm = m.listMessage;
  if (lm) partes.push(lm.title, lm.description, lm.footerText);
  if (m.highlyStructuredMessage) {
    partes.push(m.highlyStructuredMessage.hydratedHsm?.hydratedTemplate?.hydratedContentText);
    partes.push(m.highlyStructuredMessage.fallbackLg);
  }
  if (m.productMessage) partes.push(m.productMessage.product?.title);
  if (m.orderMessage) partes.push(m.orderMessage.message);
  const texto = partes
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
  return texto || null;
}

/** Texto legível de um `quotedMessage` (proto NOWEB/GOWS). */
function textoDeQuoted(q: unknown): string | null {
  if (!q || typeof q !== "object") return null;
  // deno-lint-ignore no-explicit-any
  const m = q as Record<string, any>;
  const texto = m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    m.documentMessage?.fileName ??
    null;
  if (texto) return texto;
  const oficial = textoDeOficial(m);
  if (oficial) return oficial;
  // Mídia citada SEM legenda não tem texto: sem um rótulo, a citação sumiria.
  if (m.imageMessage) return "📷 Foto";
  if (m.videoMessage) return "🎬 Vídeo";
  if (m.audioMessage) return "🎤 Áudio";
  if (m.documentMessage) return "📄 Documento";
  if (m.stickerMessage) return "Sticker";
  if (m.locationMessage) return "📍 Localização";
  if (m.contactMessage || m.contactsArrayMessage) return "👤 Contato";
  return null;
}

/** Tipo da mensagem citada a partir do `quotedMessage` (proto). */
function tipoDeQuoted(q: unknown): string | null {
  if (!q || typeof q !== "object") return null;
  // deno-lint-ignore no-explicit-any
  const m = q as Record<string, any>;
  if (m.imageMessage) return "image";
  if (m.videoMessage) return "video";
  if (m.audioMessage) return "audio";
  if (m.documentMessage) return "document";
  if (m.stickerMessage) return "sticker";
  if (m.locationMessage) return "location";
  if (m.contactMessage || m.contactsArrayMessage) return "contact";
  if (m.conversation || m.extendedTextMessage) return "text";
  return null;
}

/**
 * Converte o `jpegThumbnail` do proto num data URI pronto pra `<img src>`.
 * No GOWS os bytes chegam como base64 string; no NOWEB como Buffer. Null se
 * vazio ou implausivelmente grande (o thumb real tem ~2-15KB).
 */
function thumbParaDataUri(raw: unknown): string | null {
  if (!raw) return null;
  let b64: string | null = null;
  if (typeof raw === "string") {
    if (raw.startsWith("data:")) return raw.length > 300_000 ? null : raw;
    b64 = raw;
  } else if (typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const arr = Array.isArray(raw) ? (raw as number[]) : Array.isArray(o.data) ? (o.data as number[]) : null;
    if (arr) {
      if (arr.length > 225_000) return null;
      try {
        let bin = "";
        for (let i = 0; i < arr.length; i += 0x8000) {
          bin += String.fromCharCode(...arr.slice(i, i + 0x8000));
        }
        b64 = btoa(bin);
      } catch {
        return null;
      }
    }
  }
  if (!b64) return null;
  if (b64.length > 300_000) return null;
  return `data:image/jpeg;base64,${b64}`;
}

function thumbDeQuoted(q: unknown): string | null {
  if (!q || typeof q !== "object") return null;
  // deno-lint-ignore no-explicit-any
  const m = q as Record<string, any>;
  return thumbParaDataUri(
    m.imageMessage?.jpegThumbnail ?? m.videoMessage?.jpegThumbnail ?? m.documentMessage?.jpegThumbnail ?? null,
  );
}

/** Acha o `quotedMessage` bruto varrendo o `contextInfo` das sub-mensagens. */
function acharQuotedProto(
  msg: Record<string, unknown>,
): { stanzaId: string | null; quotedMessage: unknown } | null {
  // deno-lint-ignore no-explicit-any
  const d = (msg._data ?? {}) as Record<string, any>;
  // deno-lint-ignore no-explicit-any
  const containers = [d.message, d.Message].filter((c): c is Record<string, any> => !!c && typeof c === "object");
  for (const container of containers) {
    for (const sub of Object.values(container)) {
      // deno-lint-ignore no-explicit-any
      const ci = (sub as any)?.contextInfo;
      if (ci && typeof ci === "object" && (ci.stanzaId || ci.stanzaID || ci.quotedMessage)) {
        return { stanzaId: (ci.stanzaId ?? ci.stanzaID ?? null) as string | null, quotedMessage: ci.quotedMessage };
      }
    }
  }
  return null;
}

/**
 * Extrai a citação (reply) de uma msg RECEBIDA. Fontes, em ordem:
 *  1) `msg.replyTo` — campo NORMALIZADO do WAHA (`{ id, participant, body }`).
 *  2) WEBJS cru: `_data.quotedMsg` + `_data.quotedStanzaID`.
 *  3) NOWEB/GOWS cru: `contextInfo` em qualquer sub-mensagem.
 * O id que vem aqui é muitas vezes o CURTO (`3EB0…`) — ver `resolverReplyWamId`.
 */
function extractReply(msg: Record<string, unknown>): {
  wamId: string | null;
  texto: string | null;
  thumb: string | null;
  tipo: string | null;
} {
  const proto = acharQuotedProto(msg);
  const thumb = proto ? thumbDeQuoted(proto.quotedMessage) : null;
  const tipo = proto ? tipoDeQuoted(proto.quotedMessage) : null;

  const rt = msg.replyTo as { id?: string; body?: string } | null | undefined;
  let wamIdNorm: string | null = null;
  if (rt && typeof rt === "object" && (rt.id || rt.body)) {
    if (rt.body) return { wamId: rt.id ?? null, texto: rt.body, thumb, tipo };
    wamIdNorm = rt.id ?? null;
  }

  // deno-lint-ignore no-explicit-any
  const d = (msg._data ?? {}) as Record<string, any>;
  const qm = d.quotedMsg as { id?: unknown; body?: string } | undefined;
  if (qm && typeof qm === "object") {
    const id = d.quotedStanzaID ??
      // deno-lint-ignore no-explicit-any
      (typeof qm.id === "string" ? qm.id : (qm.id as any)?._serialized) ??
      null;
    return { wamId: ((id as string) ?? wamIdNorm) ?? null, texto: qm.body ?? null, thumb, tipo };
  }

  if (proto) {
    return {
      wamId: (proto.stanzaId ?? wamIdNorm ?? null) as string | null,
      texto: textoDeQuoted(proto.quotedMessage),
      thumb,
      tipo,
    };
  }
  return { wamId: wamIdNorm, texto: null, thumb, tipo };
}

/**
 * O webhook recebe o id CURTO da mensagem citada (`3EB0…`), e as mensagens
 * guardam o LONGO (`false_<chat>_3EB0…`). No adv3 nenhuma citação de fora
 * casava com a original (defeito 48 do guia). Aqui procuramos a original na
 * mesma conversa e guardamos o id longo; sem achar, fica o curto.
 */
async function resolverReplyWamId(
  ctx: Ctx,
  chatId: string,
  id: string | null,
): Promise<string | null> {
  if (!id || id.includes("_")) return id;
  if (!/^[0-9A-Za-z]{8,}$/.test(id)) return id;
  const { data } = await supabaseAdmin
    .from("WhatsappMensagem")
    .select("wamId")
    .eq("tenantId", ctx.tenantId)
    .eq("sessaoId", ctx.sessaoId)
    .eq("chatId", chatId)
    .like("wamId", `%_${id}%`)
    .limit(1)
    .maybeSingle();
  return (data?.wamId as string | undefined) ?? id;
}

/** lat/long cobrindo WAHA normalizado e GOWS. */
function extractLatLng(msg: Record<string, unknown>): { lat: number | null; lng: number | null } {
  const loc = msg.location as { latitude?: number; longitude?: number } | null | undefined;
  if (loc && (loc.latitude != null || loc.longitude != null)) {
    return { lat: loc.latitude ?? null, lng: loc.longitude ?? null };
  }
  const lm = gowsMessage(msg).locationMessage as { degreesLatitude?: number; degreesLongitude?: number } | undefined;
  if (lm) return { lat: lm.degreesLatitude ?? null, lng: lm.degreesLongitude ?? null };
  return { lat: null, lng: null };
}

function vcardField(vcard: string | null, field: string): string | null {
  if (!vcard) return null;
  const m = vcard.match(new RegExp(`^${field}[^:]*:(.+)$`, "im"));
  return m ? m[1].trim() : null;
}

/**
 * Dados estruturados (coluna `payload`) conforme o tipo da msg. Null pros
 * tipos que não usam payload.
 */
function extractPayload(msg: Record<string, unknown>, tipo: string): Record<string, unknown> | null {
  const m = gowsMessage(msg);

  if (tipo === "poll") {
    const pcm = m.pollCreationMessageV3 || m.pollCreationMessage || m.pollCreationMessageV2 ||
      (msg.poll as Record<string, unknown> | undefined);
    if (!pcm) return null;
    const rawOpts = (pcm.options ?? []) as unknown[];
    const options = (Array.isArray(rawOpts) ? rawOpts : [])
      .map((o) =>
        typeof o === "string"
          ? o
          : ((o as { optionName?: string; name?: string })?.optionName ?? (o as { name?: string })?.name ?? "")
      )
      .filter(Boolean);
    return {
      name: (pcm.name as string) ?? (msg.body as string) ?? "Enquete",
      options,
      multipleAnswers: Number(pcm.selectableOptionsCount ?? pcm.selectableCount ?? 0) > 1 ||
        Number(pcm.selectableOptionsCount ?? 1) === 0,
      votes: {},
    };
  }

  if (tipo === "contact") {
    const contatos: Array<{ nome: string | null; telefone: string | null; vcard: string | null }> = [];
    // Dedupe: a mesma entrada vem em `msg.vCards` E em `contactMessage`.
    const vistos = new Set<string>();
    const push = (vcard: string | null, nome?: string | null) => {
      const telefone = vcardField(vcard, "TEL");
      const chave = (telefone?.replace(/\D/g, "") || vcard || nome || "").trim();
      if (chave && vistos.has(chave)) return;
      if (chave) vistos.add(chave);
      contatos.push({ nome: nome ?? vcardField(vcard, "FN"), telefone, vcard });
    };
    const vCards = msg.vCards as string[] | undefined;
    if (Array.isArray(vCards)) vCards.forEach((v) => push(v));
    const cm = m.contactMessage as { displayName?: string; vcard?: string } | undefined;
    if (cm?.vcard) push(cm.vcard, cm.displayName);
    const cam = m.contactsArrayMessage as { contacts?: Array<{ displayName?: string; vcard?: string }> } | undefined;
    if (cam?.contacts) cam.contacts.forEach((c) => push(c.vcard ?? null, c.displayName));
    if (contatos.length === 0 && typeof msg.body === "string" && msg.body.includes("BEGIN:VCARD")) {
      push(msg.body);
    }
    return contatos.length ? { contatos } : null;
  }

  if (tipo === "buttons") {
    // deno-lint-ignore no-explicit-any
    const br = (m.buttonsResponseMessage || m.templateButtonReplyMessage || m.listResponseMessage) as Record<string, any> | undefined;
    const selectedText = br?.selectedDisplayText ?? br?.title ?? br?.singleSelectReply?.selectedRowId ??
      (msg.body as string | undefined) ?? null;
    const selectedId = br?.selectedButtonId ?? br?.selectedRowId ?? br?.singleSelectReply?.selectedRowId ?? null;
    return { selectedId, selectedText };
  }

  return null;
}

/** Prévia da lista — rótulo amigável pros tipos sem texto. */
function snippetDe(texto: string | null, tipo: string, payloadRico: Record<string, unknown> | null): string {
  if (texto) return texto.slice(0, 200);
  switch (tipo) {
    case "poll":
      return `📊 ${(payloadRico?.name as string | undefined) ?? "Enquete"}`;
    case "location":
      return "📍 Localização";
    case "contact":
      return "👤 Contato";
    case "buttons":
      return `☑️ ${(payloadRico?.selectedText as string | undefined) ?? "Resposta"}`;
    case "image":
      return "📷 Imagem";
    case "video":
      return "🎥 Vídeo";
    case "audio":
      return "🎤 Áudio";
    case "document":
      return "📎 Documento";
    case "sticker":
      return "Figurinha";
    case "album":
      return "📷 Álbum";
    case "placeholder":
      return "⏳ Mensagem não exibida";
    case "nao_suportado":
      return "Mensagem não suportada";
    default:
      return `[${tipo}]`;
  }
}

// ===========================================================================
// Processadores por evento
// ===========================================================================

type Ctx = {
  tenantId: string;
  sessaoId: string;
  sessionName: string;
  /** Número conectado (dígitos) — pra calcular permissão de grupo. */
  numero: string | null;
};

async function handleSessionStatus(ev: WahaWebhookEvent, ctx: Ctx) {
  const payload = ev.payload as {
    status?: string;
    me?: { id?: string; pushName?: string };
  };
  // No GOWS o `me` vem no ENVELOPE, não no payload (capítulo 04, 6.1).
  const me = payload.me ?? ev.me ?? null;
  const status = payload.status;
  if (!status) return; // sem status não dá pra afirmar nada — não grava STOPPED
  // 🔴 `numero` e `pushName` só são ESCRITOS quando o evento traz o valor.
  // `me` só vem preenchido com a sessão de pé, e gravar null por cima do
  // número declarado apagava a identidade da instância. Com número já
  // declarado, o evento também não o sobrescreve: quem confere "conectou o
  // número certo?" é o `syncSessaoComWaha` da function `whatsapp`.
  const numeroConectado = waha.phoneDigitsFromJid(me?.id);
  const patch: Record<string, unknown> = {
    status,
    conectadoEm: status === "WORKING" ? new Date().toISOString() : null,
    atualizadoEm: new Date().toISOString(),
  };
  if (status === "WORKING") {
    patch.qrCodeBase64 = null;
    patch.ultimoErro = null;
  }
  if (!ctx.numero && numeroConectado) patch.numero = numeroConectado;
  if (me?.pushName) patch.pushName = me.pushName;

  const { error } = await supabaseAdmin.from("WhatsappSessao").update(patch).eq("id", ctx.sessaoId);
  if (error) throw new Error(`update WhatsappSessao: ${error.message}`);

  // Ao conectar, busca a foto de perfil da conta (best-effort, idempotente).
  if (status === "WORKING") {
    runAfterResponse(
      ensureSessaoAvatar({ tenantId: ctx.tenantId, sessaoId: ctx.sessaoId, sessionName: ctx.sessionName }),
      "webhook:avatar-sessao",
    );
  }
}

async function handleMessage(ev: WahaWebhookEvent, ctx: Ctx) {
  const { tenantId, sessaoId, sessionName } = ctx;
  const msg = ev.payload as Record<string, unknown>;
  const wamId = msg.id as string | undefined;
  const fromMe = (msg.fromMe as boolean) ?? false;
  // 🔴 No GOWS `from` é sempre a CONVERSA, nas duas direções (capítulo 04,
  // seção 6). `chatId` não vem no GOWS, mas outras engines mandam.
  const rawChatId = (msg.chatId as string | undefined) ?? (msg.from as string | undefined);
  if (!wamId || !rawChatId) return;

  // Id que não é conversa (canal, broadcast, status) sai AQUI, antes de
  // qualquer escrita (no adv3 só a conversa era barrada, defeito 20).
  if (!waha.classifyChat(rawChatId)) return;

  // WAHA também dispara `message.any` pra edições — payload tem
  // editedMessageId. Desvia pro handleEdited pra não virar duplicata.
  if (msg.editedMessageId) {
    await handleEdited(ev, ctx);
    return;
  }

  // Dedupe ANTES de resolver LID: a mesma mensagem chega 2x (`message` e
  // `message.any`). A 2ª cópia sai aqui sem pagar a resolução de LID.
  const { data: existing, error: dedupeErr } = await supabaseAdmin
    .from("WhatsappMensagem")
    .select("id")
    .eq("tenantId", tenantId)
    .eq("sessaoId", sessaoId)
    .eq("wamId", wamId)
    .maybeSingle();
  if (dedupeErr) throw new Error(`dedupe: ${dedupeErr.message}`);
  if (existing) return;

  // SEMPRE converte @lid → @c.us ANTES de persistir. Sem isso o mesmo
  // contato gera 2 chats.
  //
  // 🔴 Os dois "não" da resolução têm destinos DIFERENTES:
  //   - WAHA respondeu 404 ("não conheço esse LID") → **descarta**. A próxima
  //     do mesmo contato chega resolvível segundos depois.
  //   - Não deu pra perguntar (timeout, rede) → ESTOURA, o handler devolve
  //     500 e o WAHA reentrega. Descartar aqui perderia o "oi" de um lead.
  let chatId = rawChatId;
  if (rawChatId.endsWith("@lid")) {
    const { data: conhecido } = await supabaseAdmin
      .from("WhatsappContato")
      .select("contatoId")
      .eq("tenantId", tenantId)
      .eq("lidId", rawChatId)
      .like("contatoId", "%@c.us")
      .limit(1)
      .maybeSingle();
    const resolved = (conhecido?.contatoId as string | undefined) ??
      await waha.getPhoneFromLid({ session: sessionName, lid: rawChatId });
    if (!resolved) {
      console.warn(
        `[handleMessage] LID ${rawChatId} não resolvido (WAHA sem mapping) — ` +
          `descartando msg ${wamId}. Próxima do mesmo contato deve resolver.`,
      );
      return;
    }
    chatId = resolved;
    // Guarda o par LID → telefone: a próxima mensagem não pergunta ao WAHA.
    if (!conhecido) {
      await supabaseAdmin
        .from("WhatsappContato")
        .upsert(
          {
            tenantId,
            contatoId: resolved,
            lidId: rawChatId,
            numero: resolved.replace("@c.us", ""),
            atualizadoEm: new Date().toISOString(),
          },
          { onConflict: "tenantId,contatoId" },
        );
    }
  }

  const tipo = inferTipo(msg);

  // fromMe = mensagem enviada PELA CONTA (por qualquer dispositivo). O eco do
  // que saiu pelo painel casa com a linha provisória gravada ANTES de chamar
  // o WAHA (`_shared/whatsapp-envio.ts`) — a RPC consome atômico (SKIP
  // LOCKED) e reconcilia o wamId. Sem casar, é envio pelo celular/WhatsApp
  // Web e a msg é gravada como 'externo'.
  let ehExterno = false;
  if (fromMe) {
    const matchTexto = (msg.body as string | undefined) || (msg.caption as string | undefined) || null;
    const { data: consumido, error: ecoErr } = await supabaseAdmin.rpc("consumir_eco_fromme", {
      p_tenant: tenantId,
      p_sessao: sessaoId,
      p_chat: chatId,
      p_wamid: wamId,
      p_ack: (msg.ack as number) ?? 1,
      p_texto: matchTexto,
      p_tipo: tipo,
    });
    if (ecoErr) throw new Error(`consumir_eco_fromme: ${ecoErr.message}`);
    if (consumido === true) return; // eco de envio nosso — reconciliado
    ehExterno = true;
  }

  const chat = await garantirChat({ tenantId, sessaoId, chatId });
  if (!chat) return;

  const media = await persistMediaIfAny({
    tenantId,
    sessaoId,
    sessionName,
    chatId,
    wamId,
    msg,
    msgType: tipo,
    // Na chegada o WAHA muitas vezes ainda nem baixou o documento. Não
    // bloqueia o webhook esperando — timeout curto e o arquivo carrega
    // depois, via refetch sob demanda (abertura do chat).
    fallbackTimeoutMs: 8_000,
  });

  // Em grupo: resolve @lid do remetente → @c.us, faz upsert do
  // WhatsappContato e dispara fetch da foto em background.
  const ehGrupo = chatId.endsWith("@g.us");
  const remetenteNome = extractRemetenteNome(msg);
  const remetenteIdRaw = ehGrupo ? extractRemetenteId(msg, chatId) : (fromMe ? null : chatId);
  let remetenteJid = remetenteIdRaw;
  if (ehGrupo && remetenteIdRaw && !fromMe) {
    try {
      remetenteJid = await ensureContato({
        tenantId,
        sessionName,
        contatoId: remetenteIdRaw,
        pushName: remetenteNome,
      });
    } catch (err) {
      console.warn("[handleMessage] ensureContato falhou", err instanceof Error ? err.message : String(err));
    }
  }

  let texto = (msg.body as string | undefined) || (msg.caption as string | undefined) ||
    textoDeOficial(gowsMessage(msg)) || null;

  // Rede de segurança: tipo textual SEM texto vira balão em branco. Rotula e
  // loga só os NOMES dos campos do proto, nunca o conteúdo.
  let tipoFinal = tipo;
  if (!texto?.trim() && (tipo === "text" || tipo === "chat")) {
    const chaves = Object.keys(gowsMessage(msg));
    console.warn(`[handleMessage] msg ${wamId} sem texto legível; proto: ${chaves.join(",") || "(vazio)"}`);
    tipoFinal = "nao_suportado";
    texto = null;
  }

  const payloadRico = extractPayload(msg, tipo);
  const { lat, lng } = extractLatLng(msg);
  const reply = extractReply(msg);
  const replyWamId = await resolverReplyWamId(ctx, chatId, reply.wamId);

  const timestamp = msg.timestamp
    ? new Date((msg.timestamp as number) * 1000).toISOString()
    : new Date().toISOString();

  // Upsert dedup-safe: o UNIQUE (tenantId, sessaoId, wamId) garante que a
  // corrida `message` x `message.any` caia no ON CONFLICT DO NOTHING.
  // `.select()` devolve a linha só quando ela foi de fato INSERIDA — usamos
  // isso pra contar não-lidas uma vez só por mensagem.
  const { data: msgInserida, error: insErr } = await supabaseAdmin
    .from("WhatsappMensagem")
    .upsert(
      {
        tenantId,
        sessaoId,
        chatId,
        wamId,
        tipo: tipoFinal,
        texto,
        mediaPath: media.mediaPath,
        mediaMime: media.mediaMime,
        mediaNomeArquivo: media.mediaNomeArquivo,
        mediaTamanho: media.mediaTamanho,
        latitude: lat,
        longitude: lng,
        payload: payloadRico,
        replyToWamId: replyWamId,
        replyToTexto: reply.texto,
        replyToThumb: reply.thumb,
        replyToTipo: reply.tipo,
        ack: (msg.ack as number) ?? 0,
        fromMe,
        // Só fromMe sem match com envio do painel vira 'externo'.
        origem: ehExterno ? "externo" : null,
        remetenteJid,
        remetenteNome: fromMe ? null : remetenteNome,
        timestamp,
      },
      { onConflict: "tenantId,sessaoId,wamId", ignoreDuplicates: true },
    )
    .select("id");
  if (insErr) throw new Error(`upsert WhatsappMensagem: ${insErr.message}`);
  const mensagemNova = (msgInserida?.length ?? 0) > 0;
  if (!mensagemNova) return;

  // Prévia + não lidas numa escrita atômica, e a prévia só ANDA PRA FRENTE
  // (mensagem antiga reentregue não sobrescreve a mais nova — defeito 5).
  // Atendimento (migration 007): a MESMA RPC devolve para a fila ("aberto", sem
  // responsável, divisor "Voltou para a fila") a conversa FINALIZADA que recebe
  // mensagem do cliente (!fromMe). Em atendimento, só atualiza prévia/não lidas.
  const { error: chatErr } = await supabaseAdmin.rpc("whatsapp_chat_nova_mensagem", {
    p_chat_id: chat.id,
    p_texto: snippetDe(texto, tipoFinal, payloadRico),
    p_em: timestamp,
    p_from_me: fromMe,
    p_incrementar: !fromMe,
  });
  if (chatErr) throw new Error(`whatsapp_chat_nova_mensagem: ${chatErr.message}`);

  // Nome da conversa INDIVIDUAL: o pushName da pessoa chega em toda
  // mensagem, e no adv3 812 de 1.120 conversas apareciam só como telefone
  // (defeito 27). Só preenche quando vazio, só em individual (em grupo o
  // pushName é o remetente, não o grupo) e só de mensagem DELA.
  if (!ehGrupo && !fromMe && remetenteNome && !chat.nome) {
    await supabaseAdmin
      .from("WhatsappChat")
      .update({ nome: remetenteNome })
      .eq("id", chat.id)
      .is("nome", null);
  }

  // Enriquecimento em background quando faltam dados: foto, nome, ou o
  // perfil nunca buscado / velho. `perfilBuscadoEm` impede que toda mensagem
  // refaça a consulta (defeitos 12 e 26).
  const perfilVelho = !chat.perfilBuscadoEm ||
    Date.now() - Date.parse(chat.perfilBuscadoEm) > PERFIL_VALIDADE_MS;
  if (!chat.fotoPath || (!chat.nome && ehGrupo) || perfilVelho) {
    runAfterResponse(
      refreshChatProfile({
        tenantId,
        sessaoId,
        sessionName,
        chatId,
        fotoPathAtual: chat.fotoPath,
        ehGrupo,
      }),
      "webhook:perfil",
    );
  }
}

async function handleAck(ev: WahaWebhookEvent, ctx: Ctx) {
  const payload = ev.payload as { id?: string; ack?: number };
  if (!payload.id || typeof payload.ack !== "number") return;
  // Só pra frente: um ack 2 atrasado não apaga um 3 já gravado (defeito 4).
  // ack -1 (erro) só vale enquanto não houve entrega.
  let q = supabaseAdmin
    .from("WhatsappMensagem")
    .update({ ack: payload.ack })
    .eq("tenantId", ctx.tenantId)
    .eq("sessaoId", ctx.sessaoId)
    .eq("wamId", payload.id);
  q = payload.ack < 0 ? q.lt("ack", 2) : q.lt("ack", payload.ack);
  const { error } = await q;
  if (error) throw new Error(`ack: ${error.message}`);
}

/**
 * poll.vote — o WAHA manda votos de TODAS as enquetes. Guardamos a escolha
 * POR votante (`voters`) — re-voto substitui — e recalculamos `votes`.
 * Em grupo o votante é `vote.participant` (o `from` pode ser o grupo).
 */
async function handlePollVote(ev: WahaWebhookEvent, ctx: Ctx) {
  const payload = ev.payload as {
    vote?: { from?: string; participant?: string | null; fromMe?: boolean; selectedOptions?: unknown };
    poll?: { id?: string };
  };
  const pollId = payload.poll?.id;
  const voter = payload.vote?.fromMe ? "me" : (payload.vote?.participant || payload.vote?.from);
  const selected = Array.isArray(payload.vote?.selectedOptions)
    ? (payload.vote!.selectedOptions as unknown[]).filter((s): s is string => typeof s === "string")
    : [];
  if (!pollId || !voter) return;

  let { data: msg } = await supabaseAdmin
    .from("WhatsappMensagem")
    .select("id, payload")
    .eq("tenantId", ctx.tenantId)
    .eq("sessaoId", ctx.sessaoId)
    .eq("wamId", pollId)
    .maybeSingle();
  if (!msg) {
    const core = pollId.split("_").find((s) => /^[0-9A-F]{12,}$/i.test(s));
    if (core) {
      const r = await supabaseAdmin
        .from("WhatsappMensagem")
        .select("id, payload")
        .eq("tenantId", ctx.tenantId)
        .eq("sessaoId", ctx.sessaoId)
        .eq("tipo", "poll")
        .like("wamId", `%${core}%`)
        .limit(1)
        .maybeSingle();
      msg = r.data;
    }
  }
  if (!msg) return;

  const p = (msg.payload ?? {}) as { voters?: Record<string, string[]>; [k: string]: unknown };
  const voters: Record<string, string[]> = { ...(p.voters ?? {}) };
  if (selected.length === 0) delete voters[voter];
  else voters[voter] = selected;
  const votes: Record<string, number> = {};
  for (const sel of Object.values(voters)) {
    for (const opt of sel) votes[opt] = (votes[opt] ?? 0) + 1;
  }
  const { error } = await supabaseAdmin
    .from("WhatsappMensagem")
    .update({ payload: { ...p, voters, votes } })
    .eq("id", msg.id);
  if (error) throw new Error(`poll.vote: ${error.message}`);
}

/**
 * message.reaction. Payload real do GOWS:
 *   { id, from, fromMe, participant, reaction: { text, messageId } }
 * `text` ausente/vazio = reação retirada. O AUTOR é `participant` em grupo
 * (o `from` é o grupo) e `from` em individual; reação nossa vira "me".
 */
async function handleReaction(ev: WahaWebhookEvent, ctx: Ctx) {
  const payload = ev.payload as {
    from?: string;
    fromMe?: boolean;
    participant?: string | null;
    reaction?: { text?: string | null; messageId?: string };
    // engines antigas
    msgId?: string;
    emoji?: string;
  };
  const alvo = payload.reaction?.messageId ?? payload.msgId;
  if (!alvo) return;
  const emoji = payload.reaction ? (payload.reaction.text ?? "") : (payload.emoji ?? "");
  const autor = payload.fromMe
    ? "me"
    : (payload.from?.endsWith("@g.us") ? payload.participant : payload.from) ?? payload.participant ?? "";

  const { data: msg } = await supabaseAdmin
    .from("WhatsappMensagem")
    .select("id, reactions")
    .eq("tenantId", ctx.tenantId)
    .eq("sessaoId", ctx.sessaoId)
    .eq("wamId", alvo)
    .maybeSingle();
  if (!msg) return;

  const current = (msg.reactions as Array<{ emoji: string; from: string }>) ?? [];
  const filtered = current.filter((r) => r.from !== autor);
  if (emoji) filtered.push({ emoji, from: autor ?? "" });
  const { error } = await supabaseAdmin.from("WhatsappMensagem").update({ reactions: filtered }).eq("id", msg.id);
  if (error) throw new Error(`reaction: ${error.message}`);
}

/** `lastKnownPresence` do WAHA → os 4 estados que a UI usa. */
function normalizePresence(raw: string): "online" | "offline" | "typing" | "recording" | null {
  switch (raw) {
    case "typing":
    case "composing":
      return "typing";
    case "recording":
      return "recording";
    case "online":
    case "available":
    case "paused":
      return "online";
    case "offline":
    case "unavailable":
      return "offline";
    default:
      return null;
  }
}

/**
 * presence.update — `{ id: <chatId>, presences: [{ participant,
 * lastKnownPresence, lastSeen }] }`. SÓ chats individuais. NÃO cria chat.
 *
 * 🔴 No GOWS o `id` chega por `@lid` (quase toda conversa individual é @lid),
 * e no adv3 a guarda `endsWith("@c.us")` descartava tudo: nenhuma conversa
 * teve presença gravada (defeito 50). Aqui o @lid é traduzido pelo par
 * guardado em WhatsappContato (sem chamar o WAHA: presença é ruidosa).
 */
async function handlePresence(ev: WahaWebhookEvent, ctx: Ctx) {
  const payload = ev.payload as {
    id?: string;
    presences?: Array<{ participant?: string; lastKnownPresence?: string; lastSeen?: number | null }>;
  };
  let chatId = payload.id;
  if (!chatId || chatId.endsWith("@g.us")) return;
  if (chatId.endsWith("@lid")) {
    const { data: c } = await supabaseAdmin
      .from("WhatsappContato")
      .select("contatoId")
      .eq("tenantId", ctx.tenantId)
      .eq("lidId", chatId)
      .limit(1)
      .maybeSingle();
    if (!c?.contatoId) return;
    chatId = c.contatoId as string;
  }
  if (!chatId.endsWith("@c.us")) return;
  const p = payload.presences?.[0];
  const estado = p?.lastKnownPresence ? normalizePresence(p.lastKnownPresence) : null;
  if (!estado) return;

  const { data: chat } = await supabaseAdmin
    .from("WhatsappChat")
    .select("id, presenceEstado")
    .eq("tenantId", ctx.tenantId)
    .eq("sessaoId", ctx.sessaoId)
    .eq("chatId", chatId)
    .maybeSingle();
  if (!chat) return;

  const patch: Record<string, unknown> = { presenceEstado: estado, presenceEm: new Date().toISOString() };
  // "visto por último" só quando o WhatsApp expõe. Sem lastSeen, não
  // inventamos um horário.
  if (estado === "offline" && p?.lastSeen) {
    patch.ultimoVistoEm = new Date(p.lastSeen * 1000).toISOString();
  }
  // Anti-churn: estados estáveis repetidos não escrevem; os efêmeros
  // (typing/recording) sempre escrevem pra renovar presenceEm.
  const efemero = estado === "typing" || estado === "recording";
  if (!efemero && chat.presenceEstado === estado && !patch.ultimoVistoEm) return;
  await supabaseAdmin.from("WhatsappChat").update(patch).eq("id", chat.id);
}

/**
 * message.revoked. Payload real: `{ revokedMessageId: "<id curto>", before:
 * null, after: { id: <id da msg de PROTOCOLO>, ... } }`. Não há `id` no
 * topo — no adv3 nada era marcado (defeito 24). A original é achada como na
 * edição, por `LIKE '%_<id curto>%'`.
 */
/**
 * Id curto de mensagem vindo do CONTATO (edição/apagar). Vai para um LIKE: sem
 * esta checagem, um id "%" (cliente modificado) casaria todas as mensagens da
 * sessão e reescreveria ou apagaria o histórico inteiro.
 */
export function idCurtoValido(id: unknown): id is string {
  return typeof id === "string" && /^[0-9A-Za-z]{8,64}$/.test(id);
}

async function handleRevoked(ev: WahaWebhookEvent, ctx: Ctx) {
  const payload = ev.payload as { revokedMessageId?: string; id?: string };
  const curto = idCurtoValido(payload.revokedMessageId) ? payload.revokedMessageId : undefined;
  const agora = new Date().toISOString();
  if (curto) {
    const { error } = await supabaseAdmin
      .from("WhatsappMensagem")
      .update({ apagadoEm: agora })
      .eq("tenantId", ctx.tenantId)
      .eq("sessaoId", ctx.sessaoId)
      .is("apagadoEm", null)
      .like("wamId", `%_${curto}%`);
    if (error) throw new Error(`revoked: ${error.message}`);
    return;
  }
  if (payload.id) {
    await supabaseAdmin
      .from("WhatsappMensagem")
      .update({ apagadoEm: agora })
      .eq("tenantId", ctx.tenantId)
      .eq("sessaoId", ctx.sessaoId)
      .eq("wamId", payload.id);
  }
}

async function handleEdited(ev: WahaWebhookEvent, ctx: Ctx) {
  // payload.id              → wamId da AÇÃO de edição (NÃO da msg original)
  // payload.editedMessageId → id curto da msg original (sem chatId)
  // payload.body            → texto novo
  const payload = ev.payload as { id?: string; editedMessageId?: string; body?: string; caption?: string };
  if (!payload.id && !payload.editedMessageId) return;
  const novo = payload.body ?? payload.caption;
  // Edição sem texto (formato que não previmos) não apaga o texto atual.
  if (typeof novo !== "string") return;
  const patch = { texto: novo, editadoEm: new Date().toISOString() };

  let updated = 0;
  if (idCurtoValido(payload.editedMessageId)) {
    const { count, error } = await supabaseAdmin
      .from("WhatsappMensagem")
      .update(patch, { count: "exact" })
      .eq("tenantId", ctx.tenantId)
      .eq("sessaoId", ctx.sessaoId)
      .like("wamId", `%_${payload.editedMessageId}%`);
    if (error) throw new Error(`edited: ${error.message}`);
    updated = count ?? 0;
  }
  if (updated === 0 && payload.id) {
    await supabaseAdmin
      .from("WhatsappMensagem")
      .update(patch)
      .eq("tenantId", ctx.tenantId)
      .eq("sessaoId", ctx.sessaoId)
      .eq("wamId", payload.id);
  }
}

/** Extrai o id do grupo dos formatos conhecidos (`group.id` no GOWS). */
function groupIdDoPayload(payload: Record<string, unknown>): string | null {
  const g = payload.group as { id?: string } | string | undefined;
  const id = (typeof g === "string" ? g : g?.id) ??
    (payload.groupId as string | undefined) ??
    (payload.chatId as string | undefined) ??
    (payload.id as string | undefined);
  return typeof id === "string" && id.endsWith("@g.us") ? id : null;
}

/**
 * group.v2.update. Payload do GOWS: `{ group: { id, subject?, description?,
 * membersCanSendMessages? }, timestamp }` — no adv3 o handler procurava
 * `payload.chatId`/`payload.id` e saía sempre (defeito 24).
 */
async function handleGroupUpdate(ev: WahaWebhookEvent, ctx: Ctx) {
  const payload = ev.payload as Record<string, unknown>;
  const chatId = groupIdDoPayload(payload);
  if (!chatId) return;
  const g = (typeof payload.group === "object" ? payload.group : {}) as { subject?: string; name?: string };
  const subject = g.subject ?? g.name ?? (payload.subject as string | undefined) ?? null;

  // Não logar o payload inteiro: vaza telefones de participantes.
  console.log(`[handleGroupUpdate] ${chatId} subject=${JSON.stringify(subject)}`);

  // Só sobrescreve o nome se o evento trouxe um.
  if (subject) {
    await supabaseAdmin
      .from("WhatsappChat")
      .update({ nome: subject, atualizadoEm: new Date().toISOString() })
      .eq("tenantId", ctx.tenantId)
      .eq("sessaoId", ctx.sessaoId)
      .eq("chatId", chatId);
  }
  // Também cobre o toggle de "só admins enviam" — recalcula a permissão.
  await recomputeGroupPerm(chatId, ctx);
}

/** Recalcula+persiste permissão de envio do grupo, engolindo erro. */
async function recomputeGroupPerm(groupId: string, ctx: Ctx): Promise<void> {
  try {
    await refreshGroupSendPermission({
      tenantId: ctx.tenantId,
      sessaoId: ctx.sessaoId,
      session: ctx.sessionName,
      groupId,
      meNumero: ctx.numero,
    });
  } catch (err) {
    console.warn(`[groupPerm] recompute falhou ${groupId}:`, err instanceof Error ? err.message : String(err));
  }
}

/** Entrada/saída/promoção/rebaixamento — recalcula a permissão de envio. */
async function handleGroupParticipants(ev: WahaWebhookEvent, ctx: Ctx): Promise<void> {
  const groupId = groupIdDoPayload(ev.payload);
  if (!groupId) return;
  await recomputeGroupPerm(groupId, ctx);
}

/** Saída do próprio número do grupo — marca "removido" sem getGroup. */
async function handleGroupLeave(ev: WahaWebhookEvent, ctx: Ctx): Promise<void> {
  const groupId = groupIdDoPayload(ev.payload);
  if (!groupId) return;
  await applyGroupSendPermission({
    tenantId: ctx.tenantId,
    sessaoId: ctx.sessaoId,
    chatId: groupId,
    perm: { podeEnviar: false, motivo: "removido" },
  });
}

// ===========================================================================
// Handler principal
// ===========================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") return handleCors(req);
  if (req.method !== "POST") return badRequest("Use POST");

  // Sem o secret configurado, NUNCA aceitamos request — fica 503 até setar.
  // "Se configurado, valida; senão aceita tudo" transformaria o webhook em
  // endpoint público.
  if (!WEBHOOK_SECRET) {
    console.error("[webhook] WAHA_WEBHOOK_SECRET não configurado");
    return json({ ok: false, error: "Serviço indisponível" }, { status: 503 });
  }
  const provided = req.headers.get("x-waha-secret") ?? "";
  if (!timingSafeEqual(provided, WEBHOOK_SECRET)) {
    return unauthorized("Webhook secret inválido");
  }

  let cru: unknown;
  try {
    cru = await req.json();
  } catch {
    return badRequest("JSON inválido");
  }

  // ENVELOPE do evento — e só o envelope. 🔴 Validação DELIBERADAMENTE
  // frouxa: o WAHA muda o `payload` por evento, engine e versão. Envelope sem
  // `event`/`session` não é roteável e NUNCA vai ser: 200 encerra o retry.
  const env = cru as Record<string, unknown> | null;
  if (
    !env || typeof env !== "object" ||
    typeof env.event !== "string" || !env.event || env.event.length > 200 ||
    typeof env.session !== "string" || !env.session || env.session.length > 300
  ) {
    console.warn("[webhook] envelope inválido IGNORADO");
    return json({ ok: true, ignored: "envelope-invalido" });
  }
  const body = env as unknown as WahaWebhookEvent;

  const sessionName = body.session;
  let sessaoInfo: Awaited<ReturnType<typeof lookupSessao>>;
  try {
    sessaoInfo = await lookupSessao(sessionName);
  } catch (err) {
    // Falha transitória no banco (NÃO é "sessão desconhecida"): 500 pra o
    // WAHA reentregar mais tarde.
    console.error("[webhook] lookupSessao falhou", err);
    return json({ ok: false, error: "lookup falhou" }, { status: 500 });
  }
  if (!sessaoInfo) {
    // Sessão genuinamente desconhecida — quase sempre ZUMBI no WAHA (criada
    // e nunca removida) apontando pra cá. 200 encerra o retry; o nome vai pro
    // log pra limpeza manual (DELETE /api/sessions/{nome} no WAHA).
    console.warn(
      `[webhook] evento de sessão desconhecida IGNORADO (provável zumbi no WAHA): ` +
        `session=${JSON.stringify(sessionName)} event=${JSON.stringify(body.event)}`,
    );
    return json({ ok: true, ignored: "unknown-session", session: sessionName });
  }
  const ctx: Ctx = {
    tenantId: sessaoInfo.tenantId,
    sessaoId: sessaoInfo.id,
    sessionName,
    numero: sessaoInfo.numero,
  };

  // Log bruto pra debug — falha silenciosa. Fora do log:
  //  - `presence.update` — muda toda hora, valor ~zero.
  //  - `message` — é subconjunto EXATO de `message.any` (medido no adv3).
  //    🔴 Isto NÃO é dedupe de processamento: o `case "message"` continua
  //    chamando handleMessage. Quem dedupa é a chave única lá dentro.
  const EVENTOS_SEM_LOG = new Set(["presence.update", "message"]);
  let logId: number | null = null;
  if (!EVENTOS_SEM_LOG.has(body.event)) {
    const { data: log, error } = await supabaseAdmin
      .from("WhatsappEventoLog")
      .insert({
        tenantId: ctx.tenantId,
        sessaoId: ctx.sessaoId,
        evento: body.event,
        payload: semDataCru(body.payload),
        // Nasce processado; só o catch lá embaixo marca false + erro.
        processado: true,
      })
      .select("id")
      .single();
    if (error) console.warn("[webhook] log falhou", error.message);
    logId = (log?.id as number | undefined) ?? null;
  }

  // Evento SEM payload de objeto: fica no log cru e para por aqui.
  // 🔴 Não substituir por `payload ?? {}`: `session.status` sem payload seria
  // lido como status ausente.
  if (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) {
    console.warn(`[webhook] evento sem payload IGNORADO: event=${body.event}`);
    return json({ ok: true, ignored: "sem-payload" });
  }

  try {
    switch (body.event) {
      case "session.status":
        await handleSessionStatus(body, ctx);
        break;
      case "message":
      case "message.any":
        await handleMessage(body, ctx);
        break;
      case "message.ack":
        await handleAck(body, ctx);
        break;
      case "message.reaction":
        await handleReaction(body, ctx);
        break;
      case "poll.vote":
        await handlePollVote(body, ctx);
        break;
      case "presence.update":
        await handlePresence(body, ctx);
        break;
      case "message.revoked":
        await handleRevoked(body, ctx);
        break;
      case "message.edited":
        await handleEdited(body, ctx);
        break;
      case "group.v2.update":
        await handleGroupUpdate(body, ctx);
        break;
      case "group.v2.participants":
        await handleGroupParticipants(body, ctx);
        break;
      case "group.v2.leave":
        await handleGroupLeave(body, ctx);
        break;
      default:
        // Não tratado mas logado — útil pra ver o que mais o WAHA manda
        break;
    }
    return json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[webhook]", body.event, msg);
    // Um registro só no ErrorLog (no adv3 todo erro do webhook ia duas vezes:
    // aqui e no wrapper do 5xx, defeito 65). O `serve` não loga de novo
    // porque a resposta abaixo leva o cabeçalho de "já registrado".
    const refId = novoErroId();
    await recordError({
      origem: "webhook",
      mensagem: `${body.event}: ${msg} (ref ${refId})`,
      stack: err instanceof Error ? err.stack : null,
      contexto: { evento: body.event, sessionName: ctx.sessionName },
    });
    if (logId) {
      await supabaseAdmin.from("WhatsappEventoLog").update({ processado: false, erro: msg.slice(0, 2000) }).eq("id", logId);
    }
    return json({ ok: false, error: mensagemErroInterno(refId) }, { status: 500, headers: { "x-erro-registrado": "1" } });
  }
});
