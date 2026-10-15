// Helpers compartilhados pra sincronizar o perfil de um chat do
// WhatsApp — foto + "Sobre" (about). Roda lazy: na primeira mensagem
// (ou via refresh manual) busca tudo do WAHA e persiste.
//
// ensureChatPicture: baixa avatar pro storage privado.
// refreshChatProfile: atualiza nome (pushName) + sobre + foto de uma vez.
//
// Tolerante a falha — WAHA retorna 404/403 quando o contato bloqueou
// ou tem privacidade restrita. Quando dá erro, marca placeholders no
// banco pra não bater no WAHA a cada mensagem nova.

import { supabaseAdmin } from "./supabase.ts";
import * as waha from "./waha.ts";

const BUCKET = "whatsapp-media";
// Marca "tentamos e o WhatsApp não tem foto" pra não bater no WAHA
// toda vez que chegar uma mensagem nova.
const NONE_SENTINEL = "__none__";

export async function ensureChatPicture(args: {
  tenantId: string;
  /** Chave do chat é (tenantId, sessaoId, chatId) — sem o sessaoId o
   *  UPDATE bateria em TODAS as instâncias do tenant com o mesmo chatId. */
  sessaoId: string;
  sessionName: string;
  chatId: string;
  /** Se já temos fotoPath, pula. Caller passa o valor atual. */
  fotoPathAtual: string | null;
}): Promise<string | null> {
  if (args.fotoPathAtual) {
    // Já tem (ou já marcamos sem foto) — não refaz.
    return args.fotoPathAtual === NONE_SENTINEL ? null : args.fotoPathAtual;
  }

  const ehGrupo = args.chatId.endsWith("@g.us");
  let url: string | null = null;
  try {
    if (ehGrupo) {
      // Grupo: endpoint dedicado (`/groups/{id}/picture`). O genérico
      // `/chats/{chatId}/picture` ignora `@g.us` em NOWEB/GOWS.
      const picture = await waha.getGroupPicture(
        args.sessionName,
        args.chatId,
        { refresh: true },
      );
      url = picture?.url ?? null;
    } else {
      // Individual: tenta `/contacts/profile-picture` primeiro
      // (mais confiável em NOWEB/GOWS). Fallback pro genérico
      // `/chats/{chatId}/picture` caso o primeiro venha vazio.
      url = await waha.getContactProfilePicture(
        args.sessionName,
        args.chatId,
        { refresh: true },
      );
      if (!url) {
        const picture = await waha.getChatPicture(
          args.sessionName,
          args.chatId,
          { refresh: true },
        );
        url = picture?.url ?? null;
      }
    }
    if (!url) {
      await markNoPicture(args.tenantId, args.sessaoId, args.chatId);
      return null;
    }
    const { bytes, contentType } = await waha.downloadMedia(url);
    const chatSafe = args.chatId.replace(/[@.:]/g, "_");
    const ext = contentType.includes("png") ? ".png" : ".jpg";
    const path = `${args.tenantId}/avatars/${chatSafe}${ext}`;
    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType, upsert: true });
    if (error) {
      console.warn("[ensureChatPicture] upload falhou", error.message);
      return null;
    }
    await supabaseAdmin
      .from("WhatsappChat")
      .update({
        fotoPath: path,
        atualizadoEm: new Date().toISOString(),
      })
      .eq("tenantId", args.tenantId)
      .eq("sessaoId", args.sessaoId)
      .eq("chatId", args.chatId);
    return path;
  } catch (err) {
    // 404 é normal — contato sem foto. Marca pra não tentar de novo.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes(" 404")) {
      await markNoPicture(args.tenantId, args.sessaoId, args.chatId);
    } else {
      console.warn("[ensureChatPicture] erro", msg);
    }
    return null;
  }
}

async function markNoPicture(
  tenantId: string,
  sessaoId: string,
  chatId: string,
): Promise<void> {
  await supabaseAdmin
    .from("WhatsappChat")
    .update({
      fotoPath: NONE_SENTINEL,
      atualizadoEm: new Date().toISOString(),
    })
    .eq("tenantId", tenantId)
    .eq("sessaoId", sessaoId)
    .eq("chatId", chatId);
}

/**
 * Foto de perfil da CONTA conectada (WAHA /profile) → bucket → WhatsappSessao.fotoPath.
 * Idempotente: lê o fotoPath atual e pula se já resolvido (real ou __none__).
 *
 * 🔴 Só LÊ o perfil do WhatsApp — nunca escreve. Quando o escritório sobe uma
 * foto própria (`fotoPersonalizada`), essa escolha vale só dentro do painel:
 * aqui saímos na hora pra não sobrescrever com a foto real.
 */
export async function ensureSessaoAvatar(args: {
  tenantId: string;
  sessaoId: string;
  sessionName: string;
}): Promise<void> {
  try {
    const { data: sess } = await supabaseAdmin
      .from("WhatsappSessao")
      .select("fotoPath, fotoPersonalizada")
      .eq("id", args.sessaoId)
      .maybeSingle();
    if (sess?.fotoPersonalizada) return; // foto do dono — não encosta
    if (sess?.fotoPath) return; // já resolvido

    const perfil = await waha.getMyProfile(args.sessionName).catch(() => null);
    const url = perfil?.picture ?? null;
    if (!url) {
      await supabaseAdmin
        .from("WhatsappSessao")
        .update({ fotoPath: NONE_SENTINEL, atualizadoEm: new Date().toISOString() })
        .eq("id", args.sessaoId);
      return;
    }

    const { bytes, contentType } = await waha.downloadMedia(url);
    const ext = contentType.includes("png") ? ".png" : ".jpg";
    const path = `${args.tenantId}/avatars/sessao_${args.sessaoId}${ext}`;
    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType, upsert: true });
    if (error) {
      console.warn("[ensureSessaoAvatar] upload falhou", error.message);
      return;
    }
    await supabaseAdmin
      .from("WhatsappSessao")
      .update({ fotoPath: path, atualizadoEm: new Date().toISOString() })
      .eq("id", args.sessaoId);
  } catch (err) {
    console.warn("[ensureSessaoAvatar]", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Versão da ensureChatPicture pra participantes individuais de grupo
 * (cache em WhatsappContato em vez de WhatsappChat). Path separado em
 * `tenantId/contatos/{contatoSafe}.ext` pra não colidir com avatars
 * de chat. Idempotente — pula se já tem fotoPath.
 *
 * Tenta 2 endpoints WAHA (versões/engines respondem diferente):
 *   1. `/api/contacts/profile-picture?contactId=...` — endpoint novo
 *   2. `/api/{session}/chats/{contactId}/picture` — fallback legacy
 *
 * Loga detalhes pra cada tentativa pra facilitar debug em prod.
 */
export async function ensureContatoPicture(args: {
  tenantId: string;
  sessionName: string;
  contatoId: string;
  fotoPathAtual: string | null;
}): Promise<string | null> {
  if (args.fotoPathAtual) {
    return args.fotoPathAtual === NONE_SENTINEL ? null : args.fotoPathAtual;
  }

  let url: string | null = null;
  try {
    url = await waha.getContactProfilePicture(
      args.sessionName,
      args.contatoId,
      { refresh: true },
    );
    console.log(
      `[ensureContatoPicture] contacts/profile-picture ${args.contatoId} → ${url ? "URL" : "null"}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[ensureContatoPicture] contacts/profile-picture ${args.contatoId} ERROR: ${msg}`,
    );
  }

  // Fallback: endpoint /chats/{id}/picture (legacy)
  if (!url) {
    try {
      const pic = await waha.getChatPicture(
        args.sessionName,
        args.contatoId,
        { refresh: true },
      );
      url = pic?.url ?? null;
      console.log(
        `[ensureContatoPicture] chats/picture (fallback) ${args.contatoId} → ${url ? "URL" : "null"}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[ensureContatoPicture] chats/picture ${args.contatoId} ERROR: ${msg}`,
      );
    }
  }

  if (!url) {
    await markContatoNoPicture(args.tenantId, args.contatoId);
    return null;
  }

  try {
    const { bytes, contentType } = await waha.downloadMedia(url);
    const safe = args.contatoId.replace(/[@.:]/g, "_");
    const ext = contentType.includes("png") ? ".png" : ".jpg";
    const path = `${args.tenantId}/contatos/${safe}${ext}`;
    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType, upsert: true });
    if (error) {
      console.warn(
        `[ensureContatoPicture] upload falhou ${args.contatoId}: ${error.message}`,
      );
      return null;
    }
    await supabaseAdmin
      .from("WhatsappContato")
      .update({
        fotoPath: path,
        atualizadoEm: new Date().toISOString(),
      })
      .eq("tenantId", args.tenantId)
      .eq("contatoId", args.contatoId);
    console.log(`[ensureContatoPicture] OK ${args.contatoId} → ${path}`);
    return path;
  } catch (err) {
    console.warn(
      `[ensureContatoPicture] download/upload falhou ${args.contatoId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

async function markContatoNoPicture(
  tenantId: string,
  contatoId: string,
): Promise<void> {
  await supabaseAdmin
    .from("WhatsappContato")
    .update({
      fotoPath: NONE_SENTINEL,
      atualizadoEm: new Date().toISOString(),
    })
    .eq("tenantId", tenantId)
    .eq("contatoId", contatoId);
}

/**
 * Refresca foto + nome + "Sobre" do contato em lote. Usado quando:
 * - O webhook recebe a primeira mensagem de um chat novo
 * - O usuário clica "atualizar perfil" no painel da conversa
 *
 * Cada chamada ao WAHA é independente (allSettled) — se uma falha
 * (privacidade, 404), as outras continuam. Grupos não tem `about`, então
 * a parte de sobre é pulada.
 */
export async function refreshChatProfile(args: {
  tenantId: string;
  /** Chave do chat é (tenantId, sessaoId, chatId). */
  sessaoId: string;
  sessionName: string;
  chatId: string;
  /** Pra evitar re-fetch desnecessário. Caller passa o estado atual. */
  fotoPathAtual?: string | null;
  /** true = grupo (sem "about"). Default infere pelo sufixo do chatId. */
  ehGrupo?: boolean;
}): Promise<{
  foto: string | null;
  nome: string | null;
  sobre: string | null;
}> {
  const ehGrupo = args.ehGrupo ?? args.chatId.endsWith("@g.us");

  // Grupos têm `subject` (nome do grupo) via /groups/{id}; contatos
  // individuais têm `name`/`pushname` via /contacts. Sem essa
  // diferenciação, grupos ficavam com nome=null (já que getContactInfo
  // retorna 404 pra @g.us) e o frontend mostrava só o ID numérico.
  const [fotoRes, nomeRes, aboutRes] = await Promise.allSettled([
    ensureChatPicture({
      tenantId: args.tenantId,
      sessaoId: args.sessaoId,
      sessionName: args.sessionName,
      chatId: args.chatId,
      // null força refetch quando o caller pede explicitamente
      fotoPathAtual: args.fotoPathAtual ?? null,
    }),
    ehGrupo
      ? resolveGroupName(args.sessionName, args.chatId)
      : waha
          .getContactInfo({
            session: args.sessionName,
            contactId: args.chatId,
          })
          .then((c) => ({
            name: c.name ?? c.pushname ?? c.shortName ?? null,
          })),
    ehGrupo
      ? Promise.resolve({ about: null })
      : waha.getContactAbout({
          session: args.sessionName,
          contactId: args.chatId,
        }),
  ]);

  const foto =
    fotoRes.status === "fulfilled" ? fotoRes.value : null;
  const nome =
    nomeRes.status === "fulfilled" ? nomeRes.value.name : null;
  const sobre =
    aboutRes.status === "fulfilled" ? aboutRes.value.about ?? null : null;

  // Atualiza nome/sobre no banco (foto já é atualizada pelo ensureChatPicture).
  //
  // 🔴 `perfilBuscadoEm` é gravado SEMPRE, mesmo sem nome nem "sobre": é a
  // marca de "já perguntei". No adv3 o "sobre" vinha vazio em todas as
  // conversas, e por isso quase toda mensagem recebida refazia nome, sobre e
  // foto no WAHA (defeitos 12 e 26 do guia). O `ensureChat` do webhook só
  // pede de novo depois de alguns dias.
  const patch: Record<string, unknown> = {
    perfilBuscadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
  };
  if (nome) patch.nome = nome;
  if (sobre) patch.sobre = sobre;
  await supabaseAdmin
    .from("WhatsappChat")
    .update(patch)
    .eq("tenantId", args.tenantId)
    .eq("sessaoId", args.sessaoId)
    .eq("chatId", args.chatId);

  return { foto, nome, sobre };
}

/**
 * Resolve o nome (subject) de um grupo via endpoints WAHA oficiais
 * (Swagger https://waha.devlike.pro/swagger/):
 *
 *   1. `POST /api/{session}/groups/refresh` (throttled, 60s/sessão)
 *      → força o WAHA a re-sincronizar o cache local com o servidor
 *      do WhatsApp. SEM isso, getGroup/listGroups podem retornar
 *      subject vazio pra grupos antigos.
 *   2. `GET /api/{session}/groups/{groupId}` → schema `GroupInfo`,
 *      campo `subject`.
 *   3. `GET /api/{session}/groups?limit=500` → lista completa, varre
 *      pelo id (fallback caso o getGroup ainda venha vazio).
 *
 * Retorna `{ name: null }` se todos falharem — caller mantém o nome
 * anterior (pode ser null).
 */

// Cache em memória do último `refreshGroupsFromServer` por sessão.
// Evita martelar o WAHA quando várias mensagens de grupo chegam em
// sequência. Edge Function pode ser reciclada, então o cache reseta
// — não é problema, só significa que vamos chamar 1x extra.
const ultimoRefreshGruposPorSessao = new Map<string, number>();
const REFRESH_GRUPOS_THROTTLE_MS = 60_000;

async function refreshGruposSeNecessario(session: string): Promise<void> {
  const last = ultimoRefreshGruposPorSessao.get(session) ?? 0;
  if (Date.now() - last < REFRESH_GRUPOS_THROTTLE_MS) return;
  ultimoRefreshGruposPorSessao.set(session, Date.now());
  try {
    await waha.refreshGroupsFromServer(session);
    console.log(`[refreshGruposSeNecessario] OK pra sessão ${session}`);
  } catch (err) {
    console.warn(
      `[refreshGruposSeNecessario] ${session} ERROR:`,
      err instanceof Error ? err.message : String(err),
    );
  }
}

async function resolveGroupName(
  session: string,
  chatId: string,
): Promise<{ name: string | null }> {
  // Força re-sync do cache do WAHA com o servidor do WhatsApp antes
  // de tentar ler. Throttled em 60s/sessão pra não bater toda hora.
  await refreshGruposSeNecessario(session);

  // 1. getGroup direto (rápido se o cache tiver). Engine GOWS retorna
  // `Name`/`JID`; outras engines `subject`/`id`. helper cobre os dois.
  try {
    const g = await waha.getGroup(session, chatId);
    const subject = waha.groupSubjectOf(g);
    if (subject) {
      console.log(`[resolveGroupName] getGroup ${chatId} → ${subject}`);
      return { name: subject };
    }
    console.log(
      `[resolveGroupName] getGroup ${chatId} subject vazio, payload=${JSON.stringify(g)}`,
    );
  } catch (err) {
    console.warn(
      `[resolveGroupName] getGroup ${chatId} ERROR:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  // 2. listGroups — varre lista completa. Engine GOWS (whatsmeow)
  // retorna `JID`/`Name`; WEBJS/NOWEB retornam `id`/`subject`.
  // groupIdOf/groupSubjectOf cobrem os dois.
  try {
    const lista = await waha.listGroups(session, {
      limit: 500,
      excludeParticipants: true,
    });
    const hit = lista.find((g) => waha.groupIdOf(g) === chatId);
    if (hit) {
      const subject = waha.groupSubjectOf(hit);
      if (subject) {
        console.log(`[resolveGroupName] listGroups ${chatId} → ${subject}`);
        return { name: subject };
      }
    }
    console.log(
      `[resolveGroupName] listGroups ${chatId} não achou (lista tinha ${lista.length})`,
    );
  } catch (err) {
    console.warn(
      `[resolveGroupName] listGroups ${chatId} ERROR:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  return { name: null };
}
