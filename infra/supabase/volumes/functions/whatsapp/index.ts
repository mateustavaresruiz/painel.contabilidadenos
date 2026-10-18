// Edge Function: whatsapp
// URL: https://painel-supabase.at63vf.easypanel.host/functions/v1/whatsapp
//
// Proxy entre o painel e o servidor WAHA. Suporta múltiplas instâncias
// WhatsApp (1 número = 1 linha em WhatsappSessao). O nome no WAHA é
// `denos_<numero>` (ver `sessionNameFor`), único globalmente, e é por ele que
// o webhook acha a sessão.
//
// Toda chamada exige o JWT do usuário logado (`Authorization: Bearer`) com
// Colaborador ativo — o gateway NÃO confere nas functions, a conferência é
// `exigirColaborador` aqui dentro (_shared/acesso.ts). O colaborador do
// token vira o `enviadoPorUserId` das mensagens enviadas. Cada rota exige
// uma permissão do cargo (`permissaoDaRota`), e quem não tem
// whatsapp.ver_todas só mexe em conversa sem responsável ou sua.
//
// Rotas (depois de /whatsapp):
//
//   GET    /status                      → WAHA/webhook configurados?
//
//   Sessões:
//     GET    /sessoes                     → lista (sincroniza status com o WAHA)
//     GET    /sessoes/check-numero?numero=
//     POST   /sessoes                     → cria { apelido, numero }
//     GET    /sessoes/:id                 → status (sincroniza)
//     DELETE /sessoes/:id                 → apaga (cascade pra chats/msgs)
//     POST   /sessoes/:id/start           → ensure WAHA + start
//     POST   /sessoes/:id/stop
//     POST   /sessoes/:id/restart
//     POST   /sessoes/:id/logout
//     GET    /sessoes/:id/qr
//     POST   /sessoes/:id/refresh-webhook → para → PUT config → inicia
//     POST   /sessoes/:id/limpar-conversas
//     PUT    /sessoes/:id/foto            → foto INTERNA { dataUrl }
//     DELETE /sessoes/:id/foto            → volta pra foto real do WhatsApp
//
//   🔴 A foto da instância é SÓ DO PAINEL. Ela identifica o número aqui dentro
//   e NÃO toca no perfil do WhatsApp — nenhum cliente do escritório vê
//   diferença. `_shared/waha.ts` só tem getMyProfile (leitura); não adicione
//   um "set profile picture" aqui.
//
//   Chats (escopo: 1 sessão):
//     POST   /sessoes/:id/chats/novo                    → { telefone } abre conversa
//     POST   /sessoes/:id/chats/sync                    → puxa overview do WAHA
//     POST   /sessoes/:id/grupos/refresh-nomes
//     POST   /sessoes/:id/sync-fotos-pendentes
//     POST   /sessoes/:id/chats/:chatId/refresh-profile
//     POST   /sessoes/:id/chats/:chatId/refresh-fotos
//     POST   /sessoes/:id/chats/:chatId/refresh-group-permission
//     POST   /sessoes/:id/chats/:chatId/presence-subscribe
//     POST   /sessoes/:id/chats/:chatId/refetch-medias
//     POST   /sessoes/:id/chats/:chatId/backfill-participantes
//     POST   /sessoes/:id/chats/:chatId/leave
//     POST   /sessoes/:id/chats/:chatId/read            → marca como lido
//     POST   /sessoes/:id/chats/:chatId/clear           → apaga mensagens
//     DELETE /sessoes/:id/chats/:chatId                 → apaga chat
//     GET    /sessoes/:id/chats/:chatId/history?limit=N → puxa do WAHA
//
//   Mensagens (sessaoId vai no body):
//     POST   /messages/send-text     { sessaoId, chatId, texto, replyTo?, replyToTexto? }
//     POST   /messages/send-media    { sessaoId, chatId, kind, mediaPath, ... }
//     POST   /messages/forward       { sessaoId, messageId, toChatIds[] }
//     POST   /messages/poll-vote     { sessaoId, chatId, pollMessageId, votes[] }
//     POST   /messages/react         { sessaoId, messageId, reaction }
//   (envio, reação, edição, apagar e enquete passam por exigirAtendimento: 409 se a
//    conversa está com outra pessoa; livre → quem mexe assume. _shared/whatsapp-atendimento.ts)
//   (todas as de envio/reação/edição/apagar passam por exigirAtendimento: 409 se a
//    conversa está com outra pessoa; livre → quem mexe assume. Ver _shared/whatsapp-atendimento.ts)
//     POST   /messages/refetch-media { mensagemId }
//     POST   /messages/typing        { sessaoId, chatId, state }
//     PATCH  /messages/:id           { text }  → edita (até 15 min)
//     DELETE /messages/:id                     → apaga pra todos
//     POST   /messages/transcrever | /messages/descrever → 501 (IA fora do painel)

import { handleCors } from "../_shared/cors.ts";
import {
  badGateway,
  badRequest,
  conflict,
  forbidden,
  gatewayTimeout,
  internalError,
  novoErroId,
  json,
  notFound,
  notImplemented,
  serviceUnavailable,
} from "../_shared/response.ts";
import { serve } from "../_shared/serve.ts";
import { supabaseAdmin, TENANT_ID } from "../_shared/supabase.ts";
import * as waha from "../_shared/waha.ts";
import {
  ensureChatPicture,
  ensureContatoPicture,
  ensureSessaoAvatar,
  refreshChatProfile,
} from "../_shared/whatsapp-avatar.ts";
import { clientePorTelefone, ensureContato } from "../_shared/whatsapp-contato.ts";
import { persistMediaIfAny } from "../_shared/whatsapp-media.ts";
import { refreshGroupSendPermission } from "../_shared/whatsapp-group-perms.ts";
import { recordError } from "../_shared/error-log.ts";
import { enforceRateLimit, sujeitoTenant } from "../_shared/rate-limit.ts";
import { chatSafe, removerPorPrefixo } from "../_shared/storage-purge.ts";
import { runAfterResponse } from "../_shared/background.ts";
import { type Colaborador, exigirColaborador, semPermissao, tem } from "../_shared/acesso.ts";
import { PUBLIC_BASE_URL } from "../_shared/env.ts";
import { garantirAtendimento, statusDoConflito } from "../_shared/whatsapp-atendimento.ts";
import { mapaComLimite } from "../_shared/concorrencia.ts";
import { atendimentoDb } from "../_shared/whatsapp-atendimento-db.ts";
import {
  criarLinhaProvisoria,
  enviarTexto,
  garantirChat,
  marcarFalha,
  reconciliarEnvio,
  subirConversa,
  wamIdDe,
} from "../_shared/whatsapp-envio.ts";
import {
  mesmoNumeroWhatsapp,
  numeroWhatsappValido,
  onlyDigits,
  variantesNumeroWhatsapp,
} from "../_shared/phone-utils.ts";

const WEBHOOK_SECRET = Deno.env.get("WAHA_WEBHOOK_SECRET") ?? "";
const BUCKET = "whatsapp-media";
const tenantId = TENANT_ID;

// ===========================================================================
// Helpers
// ===========================================================================

function sessionNameFor(numero: string): string {
  // WAHA aceita [a-zA-Z0-9_-] e limita o nome a 54 chars.
  //
  // Formato: <tenantId>_<numero>, o mesmo do adv3 (ver o capítulo 18 do guia:
  // o comentário de lá que falava em `tenant_<tenantId>_<sessaoId>` estava
  // errado; o código sempre usou este).
  //   tenantId = "denos"
  //   numero   = 12 ou 13 dígitos (ex. "5544997018057")
  //
  // Por que usar `numero` em vez do sessaoId?
  //   - Legível: olhando o painel WAHA dá pra associar nome → conta
  //   - Único: garantido pelo índice único global em WhatsappSessao(numero)
  //   - Estável: numero não muda; sessaoId é UUID arbitrário
  const t = tenantId.replace(/[^a-zA-Z0-9]/g, "");
  const n = numero.replace(/\D/g, "");
  return `${t}_${n}`;
}

type Sessao = {
  id: string;
  nome: string;
  status: string;
  numero: string | null;
  /** Avatar da instância no bucket. "__none__" = o WhatsApp não tem foto. */
  fotoPath: string | null;
  /** true = imagem que o escritório subiu, visível só aqui dentro. */
  fotoPersonalizada: boolean;
};

const MOTIVO_MSG: Record<string, string> = {
  so_admins: "Só administradores podem enviar mensagens neste grupo.",
  removido: "Você não está mais neste grupo.",
};

/**
 * Bloqueia envio quando o chat (grupo) está marcado `podeEnviar=false`.
 * Retorna uma Response 409 pra cortar cedo, ou null se pode seguir.
 * Lê só a flag persistida (barato) — o cálculo/refresh acontece via
 * webhook e no refresh on-open.
 *
 * Todo caminho de envio passa por aqui: texto, mídia, encaminhar e votar
 * (no adv3 o voto escapava, defeito 38 do guia).
 */
async function bloqueioEnvio(
  sessaoId: string,
  chatId: string,
): Promise<Response | null> {
  const { data } = await supabaseAdmin
    .from("WhatsappChat")
    .select("podeEnviar, motivoBloqueio")
    .eq("tenantId", tenantId)
    .eq("sessaoId", sessaoId)
    .eq("chatId", chatId)
    .maybeSingle();
  if (data && data.podeEnviar === false) {
    const motivo = (data.motivoBloqueio as string | null) ?? "so_admins";
    return json(
      { error: MOTIVO_MSG[motivo] ?? MOTIVO_MSG.so_admins, motivo },
      { status: 409 },
    );
  }
  return null;
}

/**
 * Atendimento no estilo Blip (regra em _shared/whatsapp-atendimento.ts):
 * conversa livre → quem mexe assume (se o cargo tem assumir ou transferir;
 * sem isso → 403 `sem_permissao_assumir`); conversa de outra pessoa → 409, a
 * menos que tenha `whatsapp.assumir_de_outros` (aí toma a conversa e registra);
 * finalizada → reabre em nome de quem enviou (mesma exigência de assumir).
 * Roda ANTES de falar com o WAHA, em todo caminho que sai pelo número (texto,
 * mídia, encaminhar, enquete, reação, edição, apagar). Retorna a Response
 * 403/409 ou null se pode seguir.
 */
async function exigirAtendimento(
  c: Colaborador,
  sessaoId: string,
  chatId: string,
): Promise<Response | null> {
  const r = await garantirAtendimento(atendimentoDb, {
    sessaoId,
    chatId,
    eu: { id: c.id, nome: c.nome },
    podeAssumir: tem(c, "whatsapp.assumir") || tem(c, "whatsapp.transferir"),
    podeAssumirDeOutros: tem(c, "whatsapp.assumir_de_outros"),
  });
  return r.ok ? null : json(r.conflito, { status: statusDoConflito(r.conflito) });
}

async function getSessaoOrFail(sessaoId: string): Promise<Sessao | null> {
  const { data, error } = await supabaseAdmin
    .from("WhatsappSessao")
    .select("id, nome, status, numero, fotoPath, fotoPersonalizada")
    .eq("id", sessaoId)
    .eq("tenantId", tenantId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function webhookUrl(): string {
  return `${PUBLIC_BASE_URL}/functions/v1/whatsapp-webhook`;
}

function wahaParams(sessao: { id: string; nome: string }) {
  return {
    name: sessao.nome,
    webhookUrl: webhookUrl(),
    webhookSecret: WEBHOOK_SECRET || undefined,
    metadata: { tenantId, sessaoId: sessao.id },
  };
}

/**
 * Sincroniza UMA sessão com o WAHA — consulta o estado real, aplica
 * em banco se diferente. Usado tanto pelo GET /sessoes (lista, em
 * paralelo) quanto pelo GET /sessoes/:id (individual). Centraliza
 * também a regra de "número conectado tem que bater com declarado".
 *
 * Não throw — falhas do WAHA (404, timeout, 5xx) só geram log; mantém
 * o que tá no banco.
 *
 * 🔴 NÃO reaplica a config do webhook. No adv3 o GET reaplicava (PUT) em
 * toda sessão WORKING, e PUT numa sessão GOWS a reinicia: abrir a tela de
 * Conexões derrubava os números por um instante (defeito 31 do guia). Quem
 * religa eventos é o POST /refresh-webhook, explícito.
 */
async function syncSessaoComWaha(sessao: Sessao): Promise<boolean> {
  if (!waha.wahaIsConfigured()) return true;
  let info: waha.WahaSessionInfo;
  try {
    info = await waha.getSession(sessao.nome);
  } catch {
    // 404 / timeout / 5xx — mantém o que tá no banco
    return true;
  }

  const numeroConectado = waha.phoneDigitsFromJid(info.me?.id);
  const conectouNoNumeroErrado =
    info.status === "WORKING" &&
    numeroConectado !== null &&
    sessao.numero !== null &&
    !mesmoNumeroWhatsapp(sessao.numero, numeroConectado);

  if (conectouNoNumeroErrado) {
    const erro =
      `Você conectou o número ${numeroConectado} mas essa instância ` +
      `foi criada pra ${sessao.numero}. Faça logout no celular e ` +
      `escaneie o QR de novo com o WhatsApp correto.`;
    // Desconecta no WAHA pra não deixar sessão errada ativa.
    try {
      await waha.logoutSession(sessao.nome);
    } catch (err) {
      console.warn("[sync] logout pós-mismatch", err);
    }
    await supabaseAdmin
      .from("WhatsappSessao")
      .update({
        status: "FAILED",
        ultimoErro: erro,
        conectadoEm: null,
        atualizadoEm: new Date().toISOString(),
      })
      .eq("id", sessao.id);
    sessao.status = "FAILED";
    return false;
  }

  // Se está esperando QR, busca direto do WAHA — mantém o `qrCodeBase64`
  // do banco sempre fresco. WAHA expira o QR a cada ~30s.
  let qrCodeBase64: string | null | undefined = undefined;
  if (info.status === "SCAN_QR_CODE") {
    try {
      qrCodeBase64 = await waha.getQr(sessao.nome);
    } catch (err) {
      // QR pode expirar entre a leitura do status e a busca do QR. Mantém o
      // que tá no banco — o front pode retentar via /sessoes/:id/qr.
      console.warn("[sync] getQr", err);
    }
  } else if (info.status === "WORKING" || info.status === "STOPPED") {
    // Conectou ou parou — QR antigo perde sentido, zera.
    qrCodeBase64 = null;
  }

  // Instância sem número declarado recebe aqui o que o WAHA está reportando.
  // ⚠️ Em UPDATE SEPARADO por causa do índice único GLOBAL em `numero`: se o
  // mesmo número já estiver em outra instância, este write falha com 23505 —
  // e, no mesmo patch, levaria o status junto.
  if (!sessao.numero && numeroConectado) {
    const { error } = await supabaseAdmin
      .from("WhatsappSessao")
      .update({ numero: numeroConectado })
      .eq("id", sessao.id)
      .is("numero", null);
    if (error) console.warn("[sync] backfill do número", error.message);
    else sessao.numero = numeroConectado;
  }

  // Update normal — não sobrescreve `numero` (declarado pelo escritório).
  const statusMudou = info.status !== sessao.status;
  if (statusMudou || info.me?.pushName || qrCodeBase64 !== undefined) {
    const patch: Record<string, unknown> = {
      status: info.status,
      atualizadoEm: new Date().toISOString(),
    };
    // Só escreve o nome de perfil quando o WAHA manda um.
    if (info.me?.pushName) patch.pushName = info.me.pushName;
    if (info.status === "WORKING") {
      patch.ultimoErro = null;
      if (statusMudou) patch.conectadoEm = new Date().toISOString();
    } else {
      patch.conectadoEm = null;
    }
    if (qrCodeBase64 !== undefined) {
      patch.qrCodeBase64 = qrCodeBase64;
    }
    await supabaseAdmin
      .from("WhatsappSessao")
      .update(patch)
      .eq("id", sessao.id);
    sessao.status = info.status;
  }

  if (info.status === "WORKING" && !sessao.fotoPath) {
    runAfterResponse(
      ensureSessaoAvatar({ tenantId, sessaoId: sessao.id, sessionName: sessao.nome }),
      "sync:avatar",
    );
  }

  return true;
}

/**
 * Classifica um erro lançado pelo helper waha.ts e retorna a resposta
 * HTTP apropriada com mensagem útil. As mensagens já vêm formatadas no
 * formato "WAHA <status> <path>: <body>" pelo cliente.
 */
function wahaErrorResponse(err: unknown, ctx: string): Response {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[whatsapp]", ctx, msg);
  if (msg.startsWith("WAHA timeout")) {
    return gatewayTimeout(`Servidor WAHA não respondeu a tempo (${ctx}).`);
  }
  if (msg.includes("WAHA não configurado")) {
    return serviceUnavailable(msg);
  }
  if (msg.startsWith("WAHA ")) {
    return badGateway(`Servidor WAHA recusou (${ctx}): ${msg.slice(5)}`);
  }
  return internalError(`Erro em ${ctx}: ${msg}`);
}

/** Rotas que não precisam do WAHA (leem/escrevem só o banco). */
function rotaSemWaha(method: string, sub: string[]): boolean {
  const acao = sub[0] ?? "";
  if (acao === "status") return true;
  if (acao === "sessoes") {
    if (method === "GET" && sub.length <= 2) return true; // lista, check-numero, detalhe
    if (method === "DELETE" && sub.length === 2) return true; // apagar instância
    if (sub[2] === "foto" && method === "PUT") return true;
    if (sub[2] === "limpar-conversas") return true;
    if (method === "POST" && sub[2] === "chats" && ["read", "clear"].includes(sub[4] ?? "")) {
      return true;
    }
    if (method === "DELETE" && sub[2] === "chats" && sub.length === 4) return true;
  }
  return false;
}

// ===========================================================================
// FREIO (rate limit) — só nas rotas que GASTAM o número
// ===========================================================================
// Eixo: o ESCRITÓRIO. Enviar rápido demais é o vetor clássico de ban do
// número, e o WhatsApp olha a saída total dele, não o endpoint.
//
// FORA daqui, e por quê:
//   • typing — dispara a cada pausa de digitação, por desenho.
//   • react, DELETE de mensagem — uma ação por mensagem que a pessoa já
//     está vendo na tela.
//   • leituras (chats/sync, history, refresh-fotos, backfill…) — puxam do
//     WAHA mas não sujam o número perante o WhatsApp.
type LimiteRota = { acao: string; max: number; janelaS: number; mensagem: string };

function limiteDaRota(method: string, sub: string[]): LimiteRota | null {
  if (sub[0] !== "messages") return null;

  // Envio: 120/min. Um atendente rápido manda ~20 por minuto; o escritório
  // inteiro em pico não passa de umas 60. Editar entra no mesmo balde (no
  // adv3 a edição pulava o freio, defeito 51 do guia).
  if (
    (method === "POST" && ["send-text", "send-media", "poll-vote"].includes(sub[1] ?? "")) ||
    (method === "PATCH" && sub.length === 2)
  ) {
    return {
      acao: "whatsapp:envio",
      max: 120,
      janelaS: 60,
      mensagem: "Muitas mensagens enviadas em pouco tempo. Aguarde alguns instantes — enviar rápido demais é o que faz o WhatsApp bloquear o número.",
    };
  }

  // Encaminhar tem balde PRÓPRIO e menor: uma chamada vira N envios (teto de
  // 50 destinos na rota). ⚠️ 20 × 50 ainda passa dos 120/min do balde de
  // envio — o teto contém o caso patológico, não faz o forward respeitar a
  // saída total. Decisão consciente: encaminhar em massa é ato deliberado.
  if (method === "POST" && sub[1] === "forward") {
    return {
      acao: "whatsapp:forward",
      max: 20,
      janelaS: 60,
      mensagem: "Muitos encaminhamentos seguidos. Aguarde alguns instantes antes de encaminhar de novo.",
    };
  }
  return null;
}

/** Rótulo pt-BR da prévia pra mídia sem legenda (espelha o webhook). */
function rotuloMidia(kind: string): string {
  return kind === "image"
    ? "📷 Imagem"
    : kind === "voice"
    ? "🎤 Áudio"
    : kind === "video"
    ? "🎥 Vídeo"
    : "📎 Documento";
}

// ===========================================================================
// Permissões (cargo do colaborador logado)
// ===========================================================================

/**
 * A permissão que cada rota exige. Padrão: whatsapp.ver (leitura e
 * sincronização). Conexões = whatsapp.conexoes; enviar = whatsapp.responder;
 * apagar/limpar = whatsapp.apagar_mensagens.
 */
function permissaoDaRota(method: string, sub: string[]): string {
  const [a, , b, , d] = sub;
  if (a === "sessoes") {
    if (sub.length === 1) return method === "POST" ? "whatsapp.conexoes" : "whatsapp.ver";
    if (sub.length === 2) return method === "DELETE" ? "whatsapp.conexoes" : "whatsapp.ver";
    if (sub.length === 3 && ["start", "stop", "restart", "logout", "refresh-webhook", "qr", "foto"].includes(b ?? "")) {
      return "whatsapp.conexoes";
    }
    if (b === "limpar-conversas") return "whatsapp.apagar_mensagens";
    if (b === "chats") {
      if (sub[3] === "novo") return "whatsapp.responder";
      if (sub.length === 4 && method === "DELETE") return "whatsapp.apagar_mensagens";
      if (d === "clear") return "whatsapp.apagar_mensagens";
      if (d === "leave") return "whatsapp.conexoes";
    }
    return "whatsapp.ver";
  }
  if (a === "messages") {
    if (sub.length === 2 && method === "DELETE") return "whatsapp.apagar_mensagens";
    if (sub.length === 2 && method === "PATCH") return "whatsapp.responder";
    if (["send-text", "send-media", "forward", "poll-vote", "react", "typing"].includes(sub[1] ?? "")) {
      return "whatsapp.responder";
    }
  }
  return "whatsapp.ver";
}

/**
 * Sem whatsapp.ver_todas, só conversa sem responsável ou do próprio
 * colaborador (a mesma regra da RLS de WhatsappChat). Conversa que ainda não
 * existe no banco (primeira mensagem) passa.
 */
async function podeMexerNaConversa(c: Colaborador, sessaoId: string, chatId: string): Promise<boolean> {
  if (tem(c, "whatsapp.ver_todas")) return true;
  const { data } = await supabaseAdmin
    .from("WhatsappChat")
    .select("responsavelId")
    .eq("tenantId", tenantId)
    .eq("sessaoId", sessaoId)
    .eq("chatId", chatId)
    .maybeSingle();
  return !data || !data.responsavelId || data.responsavelId === c.id;
}

// ===========================================================================
// Handler principal
// ===========================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") return handleCors(req);

  const colaborador = await exigirColaborador(req);
  if (colaborador instanceof Response) return colaborador;

  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const sub = parts.slice(1); // depois de "whatsapp"
  const action = sub[0] ?? "";

  // GET /status — o que a tela de Conexões precisa pra explicar "por que não
  // conecta" sem ninguém abrir log.
  if (action === "status" && req.method === "GET") {
    // Mostra a URL do webhook e o estado do WAHA: só para quem vê o WhatsApp ou gerencia as conexões.
    if (!tem(colaborador, "whatsapp.ver") && !tem(colaborador, "whatsapp.conexoes")) {
      return semPermissao("whatsapp.ver ou whatsapp.conexoes");
    }
    return json({
      wahaConfigurado: waha.wahaIsConfigured(),
      webhookSecretConfigurado: !!WEBHOOK_SECRET,
      webhookUrl: webhookUrl(),
    });
  }

  if (!waha.wahaIsConfigured() && !rotaSemWaha(req.method, sub)) {
    return serviceUnavailable(waha.WAHA_NAO_CONFIGURADO);
  }

  // Freio (fail-open) — antes de tocar no WAHA.
  const limite = limiteDaRota(req.method, sub);
  if (limite) {
    const freio = await enforceRateLimit({
      action: limite.acao,
      sujeito: sujeitoTenant(tenantId),
      max: limite.max,
      windowSecs: limite.janelaS,
      mensagem: limite.mensagem,
    });
    if (freio) return freio;
  }

  try {
    // Permissão do cargo para a rota (catálogo em migrations/005).
    const permissao = permissaoDaRota(req.method, sub);
    if (!tem(colaborador, permissao)) return semPermissao(permissao);

    // -----------------------------------------------------------------
    // SESSÕES
    // -----------------------------------------------------------------

    // GET /sessoes — lista. Sincroniza com o WAHA antes de devolver (em
    // paralelo). Se o WAHA falhar pra alguma, mantém o que tá no banco.
    if (action === "sessoes" && sub.length === 1 && req.method === "GET") {
      const { data: sessoesIniciais, error } = await supabaseAdmin
        .from("WhatsappSessao")
        .select("id, nome, status, numero, fotoPath, fotoPersonalizada")
        .eq("tenantId", tenantId)
        .order("criadoEm", { ascending: true });
      if (error) throw error;

      if (sessoesIniciais && sessoesIniciais.length > 0) {
        await Promise.allSettled(
          sessoesIniciais.map((s) => syncSessaoComWaha(s as Sessao)),
        );
      }

      // Re-fetch após o sync pra devolver as colunas completas.
      const { data } = await supabaseAdmin
        .from("WhatsappSessao")
        .select("*")
        .eq("tenantId", tenantId)
        .order("criadoEm", { ascending: true });
      return json({ sessoes: data ?? [], wahaConfigurado: waha.wahaIsConfigured() });
    }

    // GET /sessoes/check-numero?numero=... — disponibilidade do número pra
    // validar JÁ na digitação do form. Resposta:
    //   { disponivel: true }
    //   { disponivel: false, motivo: "formato" }
    //   { disponivel: false, motivo: "em-uso", apelido }
    if (
      action === "sessoes" &&
      sub[1] === "check-numero" &&
      req.method === "GET"
    ) {
      const numero = onlyDigits(url.searchParams.get("numero"));
      if (!numeroWhatsappValido(numero)) {
        return json({ disponivel: false, motivo: "formato" });
      }
      // Busca pelas duas grafias (com e sem o nono dígito): o mesmo aparelho
      // escrito de dois jeitos é um número só.
      const { data: existente } = await supabaseAdmin
        .from("WhatsappSessao")
        .select("apelido")
        .in("numero", variantesNumeroWhatsapp(numero))
        .limit(1)
        .maybeSingle();
      if (existente) {
        return json({ disponivel: false, motivo: "em-uso", apelido: existente.apelido ?? null });
      }
      return json({ disponivel: true });
    }

    // POST /sessoes — cria nova. Body: { apelido: string, numero: string }
    // - apelido: nome amigável (ex.: "Atendimento")
    // - numero: WhatsApp que vai conectar, 55 + DDD + 8 ou 9 dígitos.
    //   Usado pra confirmar que a conexão é no número certo.
    if (action === "sessoes" && sub.length === 1 && req.method === "POST") {
      const body = (await req.json().catch(() => null)) ?? {};
      const apelido = (body.apelido as string | undefined)?.trim() ?? "";
      const numero = onlyDigits(body.numero as string | undefined);

      if (apelido.length < 2) {
        return badRequest("Apelido é obrigatório (mínimo 2 caracteres).");
      }
      if (!numeroWhatsappValido(numero)) {
        return badRequest(
          "Número precisa vir no formato 55 + DDD + o número, com 8 ou 9 " +
            "dígitos (ex.: 5544997018057 ou 554430301234).",
        );
      }
      const { data: existente } = await supabaseAdmin
        .from("WhatsappSessao")
        .select("id, apelido")
        .in("numero", variantesNumeroWhatsapp(numero))
        .limit(1)
        .maybeSingle();
      if (existente) {
        return badRequest(
          `Já existe uma instância nesse número (${existente.apelido ?? "sem apelido"}). ` +
            "Apague ou edite a existente.",
        );
      }

      // Nome do WAHA é determinístico (numero já validado) e NÃO depende do
      // id da row — então inserimos já com ele num INSERT único, sem
      // placeholder (no adv3 um "pendente" órfão travava a criação).
      const nome = sessionNameFor(numero);
      const { data: inserted, error } = await supabaseAdmin
        .from("WhatsappSessao")
        .insert({ tenantId, nome, apelido, numero, status: "STOPPED" })
        .select("id")
        .single();
      if (error || !inserted) {
        if (error?.code === "23505") return conflict("Já existe uma instância com esse número.");
        return internalError(error?.message ?? "Falha ao criar sessão");
      }

      // Cria a sessão NO WAHA agora — com `start: false`, fica STOPPED mas já
      // com webhook + config aplicados. Quando clicar "Conectar", o /start
      // dispara e o QR aparece.
      const createParams = { ...wahaParams({ id: inserted.id, nome }), start: false };
      try {
        await waha.createSession(createParams);
      } catch (err) {
        // Um reset do banco não apaga a sessão no servidor WAHA — sobra uma
        // órfã com esse mesmo nome, e o create responde 422 "already exists".
        // Auto-curável: apaga a órfã e recria do zero.
        const msg = err instanceof Error ? err.message : String(err);
        const jaExiste = msg.includes("WAHA 422") && msg.includes("already exists");
        if (jaExiste) {
          try {
            await waha.deleteSession(nome);
            await waha.createSession(createParams);
          } catch (retryErr) {
            await supabaseAdmin.from("WhatsappSessao").delete().eq("id", inserted.id);
            return wahaErrorResponse(retryErr, "criar/recriar-orfa");
          }
        } else {
          // Rollback: a sessão fantasma no banco causaria confusão na UI.
          await supabaseAdmin.from("WhatsappSessao").delete().eq("id", inserted.id);
          return wahaErrorResponse(err, "criar/createSession");
        }
      }

      return json({ sessaoId: inserted.id, nome });
    }

    // Pra rotas /sessoes/:id/... daqui pra baixo precisamos da sessão
    const sessaoId = action === "sessoes" ? sub[1] : undefined;
    const sessao = sessaoId ? await getSessaoOrFail(sessaoId) : null;
    if (action === "sessoes" && sub.length >= 2 && !sessao) {
      return notFound("Sessão não encontrada");
    }
    const chatIdDaRota = action === "sessoes" && sub[2] === "chats" && sub[3]
      ? decodeURIComponent(sub[3])
      : "";
    if (sessao && chatIdDaRota && !["novo", "sync"].includes(sub[3] ?? "") &&
        !(await podeMexerNaConversa(colaborador, sessao.id, chatIdDaRota))) {
      return forbidden("Esta conversa está com outra pessoa da equipe.");
    }

    // GET /sessoes/:id — status (sincroniza com WAHA antes)
    if (action === "sessoes" && sub.length === 2 && req.method === "GET" && sessao) {
      await syncSessaoComWaha(sessao);
      const { data } = await supabaseAdmin
        .from("WhatsappSessao")
        .select("*")
        .eq("id", sessao.id)
        .single();
      return json({ sessao: data });
    }

    // POST /sessoes/:id/start
    if (action === "sessoes" && sub.length === 3 && sub[2] === "start" && req.method === "POST" && sessao) {
      const params = wahaParams(sessao);
      // 1) Inspeciona o estado atual no WAHA (404 = não existe ainda).
      let existingInfo: waha.WahaSessionInfo | null = null;
      try {
        existingInfo = await waha.getSession(sessao.nome);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // 404 é esperado; qualquer outro código sobe — retry sem saber o
        // estado real é arriscado.
        if (!msg.includes("WAHA 404")) {
          return wahaErrorResponse(err, "start/getSession");
        }
      }

      try {
        if (existingInfo?.status === "WORKING") {
          // Já está conectada. Nada a fazer (a config de webhook se religa
          // pelo /refresh-webhook, que sabe parar antes).
        } else if (existingInfo?.status === "STOPPED") {
          await waha.startSession(sessao.nome);
        } else if (existingInfo) {
          // Estado intermediário (STARTING/SCAN_QR_CODE/FAILED) — restart
          // mantém credenciais salvas, ao invés de delete+create.
          try {
            await waha.restartSession(sessao.nome);
          } catch (restartErr) {
            console.warn("[start] restart falhou, vai recriar do zero", restartErr);
            try {
              await waha.deleteSession(sessao.nome);
            } catch (delErr) {
              console.warn("[start] deleteSession falhou (ignorado)", delErr);
            }
            await waha.createSession(params);
          }
        } else {
          // Não existe no WAHA — cria do zero (já iniciando).
          await waha.createSession(params);
        }
      } catch (err) {
        return wahaErrorResponse(err, "start");
      }
      if (existingInfo?.status !== "WORKING") {
        await supabaseAdmin
          .from("WhatsappSessao")
          .update({ status: "STARTING", ultimoErro: null, atualizadoEm: new Date().toISOString() })
          .eq("id", sessao.id);
      }
      return json({ ok: true });
    }

    // POST /sessoes/:id/stop
    if (action === "sessoes" && sub.length === 3 && sub[2] === "stop" && req.method === "POST" && sessao) {
      try {
        await waha.stopSession(sessao.nome);
      } catch (err) {
        console.warn("[stop] WAHA falhou", err);
      }
      await supabaseAdmin
        .from("WhatsappSessao")
        .update({ status: "STOPPED", qrCodeBase64: null, conectadoEm: null, atualizadoEm: new Date().toISOString() })
        .eq("id", sessao.id);
      return json({ ok: true });
    }

    // POST /sessoes/:id/restart
    if (action === "sessoes" && sub.length === 3 && sub[2] === "restart" && req.method === "POST" && sessao) {
      try {
        await waha.restartSession(sessao.nome);
      } catch (err) {
        return wahaErrorResponse(err, "restart");
      }
      await supabaseAdmin
        .from("WhatsappSessao")
        .update({ status: "STARTING", atualizadoEm: new Date().toISOString() })
        .eq("id", sessao.id);
      return json({ ok: true });
    }

    // POST /sessoes/:id/logout
    if (action === "sessoes" && sub.length === 3 && sub[2] === "logout" && req.method === "POST" && sessao) {
      try {
        await waha.logoutSession(sessao.nome);
      } catch (err) {
        console.warn("[logout] WAHA falhou", err);
      }
      // 🔴 `numero` SOBREVIVE ao logout. Ele não é "o número que está
      // conectado agora" e sim qual número esta instância representa: o nome
      // da sessão no WAHA deriva dele e é contra ele que a reconexão é
      // conferida.
      await supabaseAdmin
        .from("WhatsappSessao")
        .update({
          status: "STOPPED",
          pushName: null,
          qrCodeBase64: null,
          conectadoEm: null,
          atualizadoEm: new Date().toISOString(),
        })
        .eq("id", sessao.id);
      return json({ ok: true });
    }

    // POST /sessoes/:id/refresh-webhook
    // Re-sincroniza a ASSINATURA de eventos do webhook numa sessão que já
    // existe. Um PUT sozinho numa sessão WORKING não re-vincula os eventos
    // no WAHA. Pra aplicar de verdade: para → atualiza a config → sobe de
    // novo. O login do WhatsApp é preservado em stop/start.
    if (action === "sessoes" && sub.length === 3 && sub[2] === "refresh-webhook" && req.method === "POST" && sessao) {
      const params = wahaParams(sessao);
      let estavaWorking = false;
      try {
        const info = await waha.getSession(sessao.nome);
        estavaWorking = info?.status === "WORKING";
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("WAHA 404")) {
          return wahaErrorResponse(err, "refresh-webhook/getSession");
        }
      }
      try {
        if (estavaWorking) await waha.stopSession(sessao.nome);
        await waha.setWebhook(params);
      } catch (err) {
        if (estavaWorking) {
          await waha.startSession(sessao.nome).catch((e) =>
            console.warn("[refresh-webhook] start pós-erro", e)
          );
        }
        return wahaErrorResponse(err, "refresh-webhook");
      }
      if (estavaWorking) {
        await waha.startSession(sessao.nome).catch((e) => console.warn("[refresh-webhook] start", e));
      }
      return json({ ok: true, webhookUrl: webhookUrl() });
    }

    // DELETE /sessoes/:id
    if (action === "sessoes" && sub.length === 2 && req.method === "DELETE" && sessao) {
      // DELETE /api/sessions/:name é idempotente e JÁ inclui stop + logout.
      // NÃO paramos antes de propósito (race de async-lock na engine). Em vez
      // de confiar no 200, VERIFICAMOS: depois do delete, getSession tem que
      // dar 404. Se ainda existir, tenta de novo.
      let wahaError: string | null = null;
      if (waha.wahaIsConfigured()) {
        const aindaExiste = async (): Promise<boolean> => {
          try {
            await waha.getSession(sessao.nome);
            return true;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (/WAHA 404/i.test(msg)) return false;
            throw err;
          }
        };
        try {
          await waha.deleteSession(sessao.nome);
          if (await aindaExiste()) {
            await waha.deleteSession(sessao.nome);
            if (await aindaExiste()) {
              wahaError =
                `A sessão "${sessao.nome}" continua no servidor WAHA após ` +
                `duas tentativas de exclusão. Apague manualmente no painel do WAHA.`;
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!/WAHA 404/i.test(msg)) wahaError = msg;
        }
      } else {
        wahaError = waha.WAHA_NAO_CONFIGURADO;
      }
      // Mesmo se o WAHA falhar, apaga do banco. FK on delete cascade limpa
      // chats/mensagens; a mídia sai pelo prefixo da instância.
      const { error } = await supabaseAdmin.from("WhatsappSessao").delete().eq("id", sessao.id);
      if (error) throw error;
      runAfterResponse(
        removerPorPrefixo(BUCKET, `${tenantId}/whatsapp/${sessao.id}/`),
        "sessoes/delete:storage",
      );
      return json({ ok: true, wahaError });
    }

    // POST /sessoes/:id/limpar-conversas
    // Apaga TODAS as conversas DESTA instância (mensagens, chats, log de
    // eventos dela) + a mídia dela no Storage, MANTENDO a instância
    // conectada. Contatos (WhatsappContato) são do escritório inteiro e
    // ficam: no adv3 esta rota limpava o catálogo e a mídia de todas as
    // instâncias (defeito 13 do guia).
    if (action === "sessoes" && sub.length === 3 && sub[2] === "limpar-conversas" && req.method === "POST" && sessao) {
      const { count: mensagens, error: eMsg } = await supabaseAdmin
        .from("WhatsappMensagem")
        .delete({ count: "exact" })
        .eq("tenantId", tenantId)
        .eq("sessaoId", sessao.id);
      if (eMsg) throw eMsg;
      const { count: chats, error: eChat } = await supabaseAdmin
        .from("WhatsappChat")
        .delete({ count: "exact" })
        .eq("tenantId", tenantId)
        .eq("sessaoId", sessao.id);
      if (eChat) throw eChat;
      await supabaseAdmin.from("WhatsappEventoLog").delete().eq("sessaoId", sessao.id);
      const blobsRemovidos = await removerPorPrefixo(BUCKET, `${tenantId}/whatsapp/${sessao.id}/`);
      return json({ ok: true, mensagens: mensagens ?? 0, chats: chats ?? 0, blobsRemovidos });
    }

    // GET /sessoes/:id/qr
    if (action === "sessoes" && sub.length === 3 && sub[2] === "qr" && req.method === "GET" && sessao) {
      try {
        const dataUrl = await waha.getQr(sessao.nome);
        await supabaseAdmin
          .from("WhatsappSessao")
          .update({ qrCodeBase64: dataUrl, status: "SCAN_QR_CODE", atualizadoEm: new Date().toISOString() })
          .eq("id", sessao.id);
        return json({ qr: dataUrl });
      } catch (err) {
        return wahaErrorResponse(err, "qr");
      }
    }

    // PUT /sessoes/:id/foto  { dataUrl }
    // Foto INTERNA da instância — identifica o número dentro do painel.
    // 🔴 Nada disso viaja pro WhatsApp.
    if (action === "sessoes" && sub.length === 3 && sub[2] === "foto" && req.method === "PUT" && sessao) {
      // O corpo é lido UMA vez, como objeto. No adv3 o front fazia
      // JSON.stringify duas vezes e esta rota respondia sempre 400 (defeito
      // 29); aceitamos também a string JSON por tolerância.
      let body = await req.json().catch(() => null);
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch { /* fica string */ }
      }
      const dataUrl = typeof body?.dataUrl === "string" ? body.dataUrl : "";
      const m = dataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (!m) return badRequest("Envie uma imagem JPG, PNG ou WEBP.");
      const contentType = m[1]!;
      let bytes: Uint8Array;
      try {
        bytes = Uint8Array.from(atob(m[2]!), (c) => c.charCodeAt(0));
      } catch {
        return badRequest("Imagem inválida.");
      }
      if (bytes.byteLength > 2 * 1024 * 1024) {
        return badRequest("A imagem precisa ter no máximo 2 MB.");
      }
      // Sufixo aleatório: o path anterior é conhecido, e a policy do bucket
      // deixa a tela escrever em `uploads/`; aqui o path é novo a cada troca.
      const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
      const path = `${tenantId}/avatars/sessao_${sessao.id}_${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType, upsert: true });
      if (upErr) return internalError(upErr.message);

      const anterior = sessao.fotoPersonalizada ? sessao.fotoPath : null;
      const { error } = await supabaseAdmin
        .from("WhatsappSessao")
        .update({ fotoPath: path, fotoPersonalizada: true, atualizadoEm: new Date().toISOString() })
        .eq("id", sessao.id);
      if (error) return internalError(error.message);

      // Só depois de gravar: se a limpeza falhar, sobra um arquivo órfão —
      // apagar antes deixaria a instância sem foto nenhuma.
      if (anterior && anterior !== path) {
        await supabaseAdmin.storage.from(BUCKET).remove([anterior]).catch(() => {});
      }
      return json({ ok: true, fotoPath: path });
    }

    // DELETE /sessoes/:id/foto — descarta a foto interna e volta pra do WhatsApp.
    if (action === "sessoes" && sub.length === 3 && sub[2] === "foto" && req.method === "DELETE" && sessao) {
      if (sessao.fotoPersonalizada && sessao.fotoPath) {
        await supabaseAdmin.storage.from(BUCKET).remove([sessao.fotoPath]).catch(() => {});
      }
      const { error } = await supabaseAdmin
        .from("WhatsappSessao")
        .update({ fotoPath: null, fotoPersonalizada: false, atualizadoEm: new Date().toISOString() })
        .eq("id", sessao.id);
      if (error) return internalError(error.message);
      // Rebaixa a foto real na hora — sem isto o avatar ficaria nas iniciais
      // até o próximo `session.status`.
      await ensureSessaoAvatar({ tenantId, sessaoId: sessao.id, sessionName: sessao.nome });
      const { data } = await supabaseAdmin
        .from("WhatsappSessao")
        .select("fotoPath")
        .eq("id", sessao.id)
        .maybeSingle();
      return json({ ok: true, fotoPath: data?.fotoPath ?? null });
    }

    // -----------------------------------------------------------------
    // CHATS (escopo: 1 sessão)
    // -----------------------------------------------------------------

    // POST /sessoes/:id/chats/novo  { telefone }
    // Abre (ou reabre) uma conversa a partir de um telefone — o "nova
    // conversa" da tela e o botão WhatsApp do cadastro do cliente. Confere no
    // WAHA se o número tem WhatsApp e usa o chatId que ELE devolve (resolve o
    // 9º dígito; o adv3 montava `wa.me` sem o 55, defeito 62 do guia).
    if (action === "sessoes" && sub[2] === "chats" && sub[3] === "novo" && sub.length === 4 && req.method === "POST" && sessao) {
      const body = await req.json().catch(() => null);
      let tel = onlyDigits(body?.telefone as string | undefined);
      if (tel.length === 10 || tel.length === 11) tel = `55${tel}`;
      if (tel.length < 12) return badRequest("Telefone inválido. Use DDD + número.");
      let chatId = `${tel}@c.us`;
      try {
        const r = await waha.checkNumberExists(sessao.nome, tel);
        if (r?.numberExists === false) {
          return badRequest("Esse número não tem WhatsApp.");
        }
        if (r?.chatId) chatId = r.chatId;
      } catch (err) {
        return wahaErrorResponse(err, "chats/novo");
      }
      const chat = await garantirChat({ tenantId, sessaoId: sessao.id, chatId });
      if (!chat) return badRequest("Conversa inválida.");
      runAfterResponse(
        refreshChatProfile({
          tenantId,
          sessaoId: sessao.id,
          sessionName: sessao.nome,
          chatId,
          fotoPathAtual: chat.fotoPath,
          ehGrupo: false,
        }),
        "chats/novo:perfil",
      );
      return json({ ok: true, chatId, id: chat.id, clienteId: chat.clienteId });
    }

    // POST /sessoes/:id/chats/sync
    // Puxa o overview do WAHA e cria as conversas que faltam. Mesmas regras
    // do webhook (no adv3 esta rota não resolvia @lid, sobrescrevia o nome
    // com o que viesse — inclusive nulo — e ressuscitava conversa apagada sem
    // mensagem nova; defeito 11 do guia):
    //   - @lid é resolvido; sem resolver, a conversa fica de fora;
    //   - `nome` só é preenchido quando está vazio;
    //   - a prévia só anda pra frente (timestamp maior);
    //   - conversa apagada só volta se a última mensagem é posterior à exclusão.
    if (action === "sessoes" && sub[2] === "chats" && sub[3] === "sync" && req.method === "POST" && sessao) {
      let overview: Awaited<ReturnType<typeof waha.getChatsOverview>>;
      try {
        overview = await waha.getChatsOverview(sessao.nome, 200);
      } catch (err) {
        return wahaErrorResponse(err, "chats/sync");
      }
      let count = 0;
      let ignorados = 0;
      for (const c of overview) {
        let chatId = c.id;
        if (chatId.endsWith("@lid")) {
          const pn = await waha.getPhoneFromLid({ session: sessao.nome, lid: chatId }).catch(() => null);
          if (!pn) {
            ignorados++;
            continue;
          }
          chatId = pn;
        }
        const tipo = waha.classifyChat(chatId);
        if (!tipo) continue;

        const ultimaMsg = c.lastMessage;
        const ultimaEm = ultimaMsg?.timestamp ? new Date(ultimaMsg.timestamp * 1000).toISOString() : null;
        const ultimaTexto = typeof ultimaMsg?.body === "string" && ultimaMsg.body
          ? ultimaMsg.body.slice(0, 200)
          : null;

        const { data: existente } = await supabaseAdmin
          .from("WhatsappChat")
          .select("id, nome, fotoPath, ultimaMensagemEm, apagadoEm")
          .eq("tenantId", tenantId)
          .eq("sessaoId", sessao.id)
          .eq("chatId", chatId)
          .maybeSingle();

        if (!existente) {
          const { error } = await supabaseAdmin.from("WhatsappChat").insert({
            tenantId,
            sessaoId: sessao.id,
            chatId,
            tipo,
            nome: c.name || null,
            ultimaMensagemTexto: ultimaTexto,
            ultimaMensagemEm: ultimaEm,
            ultimaMensagemFromMe: ultimaMsg?.fromMe ?? false,
          });
          if (error && error.code !== "23505") {
            console.warn("[chats/sync] insert", error.message);
            continue;
          }
          // Vínculo automático (só preenche quando vazio).
          if (tipo === "individual" && chatId.endsWith("@c.us")) {
            const cli = await clientePorTelefone(chatId.replace("@c.us", ""));
            if (cli) {
              await supabaseAdmin
                .from("WhatsappChat")
                .update({ clienteId: cli.id })
                .eq("tenantId", tenantId)
                .eq("sessaoId", sessao.id)
                .eq("chatId", chatId)
                .is("clienteId", null)
                .eq("clienteVinculoManual", false);
            }
          }
        } else {
          const patch: Record<string, unknown> = {};
          if (!existente.nome && c.name) patch.nome = c.name;
          const maisNova = ultimaEm &&
            (!existente.ultimaMensagemEm || Date.parse(ultimaEm) > Date.parse(existente.ultimaMensagemEm));
          if (maisNova) {
            patch.ultimaMensagemEm = ultimaEm;
            patch.ultimaMensagemFromMe = ultimaMsg?.fromMe ?? false;
            if (ultimaTexto) patch.ultimaMensagemTexto = ultimaTexto;
          }
          if (existente.apagadoEm && ultimaEm && Date.parse(ultimaEm) > Date.parse(existente.apagadoEm)) {
            patch.apagadoEm = null;
          }
          if (Object.keys(patch).length) {
            patch.atualizadoEm = new Date().toISOString();
            await supabaseAdmin.from("WhatsappChat").update(patch).eq("id", existente.id);
          }
        }
        count++;

        if (!existente?.fotoPath) {
          runAfterResponse(
            ensureChatPicture({
              tenantId,
              sessaoId: sessao.id,
              sessionName: sessao.nome,
              chatId,
              fotoPathAtual: null,
            }),
            "chats/sync:foto",
          );
        }
      }
      return json({ count, ignorados });
    }

    // POST /sessoes/:id/chats/:chatId/refresh-profile
    // Força re-busca do nome, foto e "sobre" do contato direto do WAHA.
    if (action === "sessoes" && sub[2] === "chats" && sub[4] === "refresh-profile" && req.method === "POST" && sessao) {
      try {
        const result = await refreshChatProfile({
          tenantId,
          sessaoId: sessao.id,
          sessionName: sessao.nome,
          chatId: chatIdDaRota,
          // null força refetch da foto (não pula com cache)
          fotoPathAtual: null,
          ehGrupo: chatIdDaRota.endsWith("@g.us"),
        });
        return json({ ok: true, ...result });
      } catch (err) {
        return wahaErrorResponse(err, "chats/refresh-profile");
      }
    }

    // POST /sessoes/:id/chats/:chatId/leave
    // Sai de um grupo no WhatsApp e marca o chat como apagado localmente.
    if (action === "sessoes" && sub[2] === "chats" && sub[4] === "leave" && req.method === "POST" && sessao) {
      if (!chatIdDaRota.endsWith("@g.us")) return badRequest("Só é possível sair de grupos.");
      try {
        await waha.leaveGroup(sessao.nome, chatIdDaRota);
        await supabaseAdmin
          .from("WhatsappChat")
          .update({ apagadoEm: new Date().toISOString(), atualizadoEm: new Date().toISOString() })
          .eq("tenantId", tenantId)
          .eq("sessaoId", sessao.id)
          .eq("chatId", chatIdDaRota);
        return json({ ok: true });
      } catch (err) {
        return wahaErrorResponse(err, "chats/leave");
      }
    }

    // POST /sessoes/:id/grupos/refresh-nomes
    // Batch — re-sincroniza grupos no WAHA e atualiza nome de TODOS os
    // grupos sem nome nessa sessão (1 `groups/refresh` + 1 `listGroups`).
    if (action === "sessoes" && sub[2] === "grupos" && sub[3] === "refresh-nomes" && req.method === "POST" && sessao) {
      try {
        try {
          await waha.refreshGroupsFromServer(sessao.nome);
        } catch (err) {
          console.warn("[grupos/refresh-nomes] refreshGroupsFromServer falhou:", err instanceof Error ? err.message : String(err));
        }
        const lista = await waha.listGroups(sessao.nome, { limit: 500, excludeParticipants: true });
        const porId = new Map<string, string>();
        for (const g of lista) {
          const id = waha.groupIdOf(g);
          const subject = waha.groupSubjectOf(g);
          if (id && subject) porId.set(id, subject);
        }
        const { data: grupos } = await supabaseAdmin
          .from("WhatsappChat")
          .select("id, chatId")
          .eq("tenantId", tenantId)
          .eq("sessaoId", sessao.id)
          .eq("tipo", "group")
          .is("nome", null)
          .is("apagadoEm", null)
          .limit(500);
        const candidatos = (grupos ?? []) as Array<{ id: string; chatId: string }>;
        let atualizados = 0;
        for (const c of candidatos) {
          const subject = porId.get(c.chatId);
          if (!subject) continue;
          const { error } = await supabaseAdmin
            .from("WhatsappChat")
            .update({ nome: subject, atualizadoEm: new Date().toISOString() })
            .eq("id", c.id);
          if (!error) atualizados++;
        }
        return json({ ok: true, atualizados, total: candidatos.length, gruposNoWaha: lista.length });
      } catch (err) {
        return wahaErrorResponse(err, "grupos/refresh-nomes");
      }
    }

    // POST /sessoes/:id/sync-fotos-pendentes
    // Busca a foto dos chats dessa sessão com fotoPath=null. Cap 40 por
    // chamada, paralelo 4 pra não martelar o WAHA.
    if (action === "sessoes" && sub[2] === "sync-fotos-pendentes" && req.method === "POST" && sessao) {
      const { data: pendentes } = await supabaseAdmin
        .from("WhatsappChat")
        .select("chatId")
        .eq("tenantId", tenantId)
        .eq("sessaoId", sessao.id)
        .is("fotoPath", null)
        .is("apagadoEm", null)
        .order("ultimaMensagemEm", { ascending: false, nullsFirst: false })
        .limit(40);
      const ids = (pendentes ?? []).map((r) => r.chatId as string);
      if (ids.length === 0) return json({ ok: true, total: 0, baixadas: 0 });
      let baixadas = 0;
      for (let i = 0; i < ids.length; i += 4) {
        const results = await Promise.allSettled(
          ids.slice(i, i + 4).map((chatId) =>
            ensureChatPicture({ tenantId, sessaoId: sessao.id, sessionName: sessao.nome, chatId, fotoPathAtual: null })
          ),
        );
        for (const r of results) if (r.status === "fulfilled" && r.value) baixadas++;
      }
      return json({ ok: true, total: ids.length, baixadas });
    }

    // POST /sessoes/:id/chats/:chatId/refresh-fotos
    // Força re-busca da foto do chat E dos participantes que apareceram em
    // msgs deste chat. Limpa marcadores __none__ antigos antes.
    if (action === "sessoes" && sub[2] === "chats" && sub[4] === "refresh-fotos" && req.method === "POST" && sessao) {
      const chatId = chatIdDaRota;
      await supabaseAdmin
        .from("WhatsappChat")
        .update({ fotoPath: null })
        .eq("tenantId", tenantId)
        .eq("sessaoId", sessao.id)
        .eq("chatId", chatId)
        .eq("fotoPath", "__none__");
      runAfterResponse(
        ensureChatPicture({ tenantId, sessaoId: sessao.id, sessionName: sessao.nome, chatId, fotoPathAtual: null }),
        "refresh-fotos:chat",
      );

      const { data: rems } = await supabaseAdmin
        .from("WhatsappMensagem")
        .select("remetenteJid")
        .eq("tenantId", tenantId)
        .eq("sessaoId", sessao.id)
        .eq("chatId", chatId)
        .not("remetenteJid", "is", null)
        .limit(2000);
      const contatoIds = [
        ...new Set((rems ?? []).map((r) => r.remetenteJid as string).filter((s) => typeof s === "string")),
      ].slice(0, 300);
      if (contatoIds.length === 0) return json({ ok: true, fotosBaixadas: 0, contatos: 0 });

      await supabaseAdmin
        .from("WhatsappContato")
        .update({ fotoPath: null })
        .eq("tenantId", tenantId)
        .in("contatoId", contatoIds)
        .eq("fotoPath", "__none__");

      let fotosBaixadas = 0;
      for (let i = 0; i < contatoIds.length; i += 4) {
        const results = await Promise.allSettled(
          contatoIds.slice(i, i + 4).map((cid) =>
            ensureContatoPicture({ tenantId, sessionName: sessao.nome, contatoId: cid, fotoPathAtual: null })
          ),
        );
        for (const r of results) if (r.status === "fulfilled" && r.value) fotosBaixadas++;
      }
      return json({ ok: true, fotosBaixadas, contatos: contatoIds.length });
    }

    // POST /sessoes/:id/chats/:chatId/refresh-group-permission
    // Recalcula se o número conectado pode enviar no grupo e persiste.
    // Auto-disparado pelo frontend ao abrir uma conversa de grupo.
    if (action === "sessoes" && sub[2] === "chats" && sub[4] === "refresh-group-permission" && req.method === "POST" && sessao) {
      if (!chatIdDaRota.endsWith("@g.us")) return json({ ok: true, podeEnviar: true, motivo: null });
      try {
        const perm = await refreshGroupSendPermission({
          tenantId,
          sessaoId: sessao.id,
          session: sessao.nome,
          groupId: chatIdDaRota,
          meNumero: sessao.numero,
        });
        return json({ ok: true, ...perm });
      } catch (err) {
        return wahaErrorResponse(err, "chats/refresh-group-permission");
      }
    }

    // POST /sessoes/:id/chats/:chatId/presence-subscribe
    // Assina a presença do contato no WAHA pra começar a receber
    // presence.update (online/digitando). Best-effort — só individual.
    if (action === "sessoes" && sub[2] === "chats" && sub[4] === "presence-subscribe" && req.method === "POST" && sessao) {
      if (chatIdDaRota.endsWith("@g.us")) return json({ ok: true });
      try {
        await waha.subscribePresence(sessao.nome, chatIdDaRota);
      } catch (err) {
        console.warn("[chats/presence-subscribe] WAHA falhou", err);
      }
      return json({ ok: true });
    }

    // POST /sessoes/:id/chats/:chatId/refetch-medias
    // Re-baixa mídia das msgs do chat com tipo de mídia mas mediaPath=null.
    // Cap 30 por chamada, paralelo 3. Auto-disparado ao abrir conversa.
    if (action === "sessoes" && sub[2] === "chats" && sub[4] === "refetch-medias" && req.method === "POST" && sessao) {
      const chatId = chatIdDaRota;
      const { data: pendentes } = await supabaseAdmin
        .from("WhatsappMensagem")
        .select("id, wamId, tipo")
        .eq("tenantId", tenantId)
        .eq("sessaoId", sessao.id)
        .eq("chatId", chatId)
        .is("mediaPath", null)
        .not("wamId", "is", null)
        .in("tipo", ["image", "video", "audio", "document", "sticker"])
        .order("timestamp", { ascending: false })
        .limit(30);
      const lista = pendentes ?? [];
      if (lista.length === 0) return json({ ok: true, total: 0, baixadas: 0 });
      let baixadas = 0;
      for (let i = 0; i < lista.length; i += 3) {
        await Promise.all(
          lista.slice(i, i + 3).map(async (m) => {
            try {
              const media = await persistMediaIfAny({
                tenantId,
                sessaoId: sessao.id,
                sessionName: sessao.nome,
                chatId,
                wamId: m.wamId as string,
                msgType: m.tipo as string,
                // Lote na abertura do chat: timeout moderado pra documentos
                // não segurarem a função. O refetch individual é paciente.
                fallbackTimeoutMs: 12_000,
              });
              if (media.mediaPath) {
                await supabaseAdmin
                  .from("WhatsappMensagem")
                  .update({
                    mediaPath: media.mediaPath,
                    mediaMime: media.mediaMime,
                    mediaNomeArquivo: media.mediaNomeArquivo,
                    mediaTamanho: media.mediaTamanho,
                  })
                  .eq("tenantId", tenantId)
                  .eq("id", m.id);
                baixadas++;
              }
            } catch (err) {
              console.warn("[refetch-medias] falha wamId=" + m.wamId, err instanceof Error ? err.message : String(err));
            }
          }),
        );
      }
      return json({ ok: true, total: lista.length, baixadas });
    }

    // POST /sessoes/:id/chats/:chatId/backfill-participantes
    // Resolve @lid → @c.us pra todas as msgs antigas do grupo que ainda têm
    // remetenteJid em @lid. Cria/atualiza WhatsappContato pra cada um.
    if (action === "sessoes" && sub[2] === "chats" && sub[4] === "backfill-participantes" && req.method === "POST" && sessao) {
      const chatId = chatIdDaRota;
      if (!chatId.endsWith("@g.us")) return badRequest("backfill-participantes só faz sentido em grupos");
      const { data: lidsData } = await supabaseAdmin
        .from("WhatsappMensagem")
        .select("remetenteJid, remetenteNome")
        .eq("tenantId", tenantId)
        .eq("sessaoId", sessao.id)
        .eq("chatId", chatId)
        .like("remetenteJid", "%@lid")
        .limit(2000);
      const lids = new Map<string, string | null>();
      for (const row of (lidsData ?? []) as Array<{ remetenteJid: string; remetenteNome: string | null }>) {
        if (!lids.has(row.remetenteJid)) lids.set(row.remetenteJid, row.remetenteNome);
      }

      // Menções `@<dígitos>` no texto. 🔴 Só vira contato o que o WAHA
      // CONFIRMAR como LID: no adv3 menção a telefone real era tratada como
      // LID e criava contatos lixo `5511…@lid` (defeito 15 do guia).
      const { data: textosData } = await supabaseAdmin
        .from("WhatsappMensagem")
        .select("texto")
        .eq("tenantId", tenantId)
        .eq("sessaoId", sessao.id)
        .eq("chatId", chatId)
        .like("texto", "%@%")
        .limit(2000);
      const mencoes = new Set<string>();
      for (const row of (textosData ?? []) as Array<{ texto: string | null }>) {
        for (const m of (row.texto ?? "").matchAll(/@(\d{6,})/g)) {
          const lid = `${m[1]}@lid`;
          if (!lids.has(lid)) mencoes.add(lid);
        }
      }
      for (const lid of [...mencoes].slice(0, 100)) {
        const pn = await waha.getPhoneFromLid({ session: sessao.nome, lid }).catch(() => null);
        if (pn) lids.set(lid, null);
      }

      if (lids.size === 0) return json({ ok: true, lidsUnicos: 0, resolvidos: 0, mensagensAtualizadas: 0 });

      const entries = [...lids.entries()];
      const resolvidos = new Map<string, string>();
      for (let i = 0; i < entries.length; i += 5) {
        const results = await Promise.allSettled(
          entries.slice(i, i + 5).map(([lid, pushName]) =>
            ensureContato({ tenantId, sessionName: sessao.nome, contatoId: lid, pushName })
              .then((resolved) => ({ lid, resolved }))
          ),
        );
        for (const r of results) {
          if (r.status === "fulfilled" && r.value.resolved !== r.value.lid) {
            resolvidos.set(r.value.lid, r.value.resolved);
          }
        }
      }

      let atualizados = 0;
      for (const [lid, phone] of resolvidos.entries()) {
        const { data: rows, error } = await supabaseAdmin
          .from("WhatsappMensagem")
          .update({ remetenteJid: phone })
          .eq("tenantId", tenantId)
          .eq("sessaoId", sessao.id)
          .eq("chatId", chatId)
          .eq("remetenteJid", lid)
          .select("id");
        if (!error && rows) atualizados += rows.length;
      }
      return json({ ok: true, lidsUnicos: lids.size, resolvidos: resolvidos.size, mensagensAtualizadas: atualizados });
    }

    // POST /sessoes/:id/chats/:chatId/read
    if (action === "sessoes" && sub[2] === "chats" && sub[4] === "read" && req.method === "POST" && sessao) {
      if (waha.wahaIsConfigured()) {
        runAfterResponse(waha.markChatRead(sessao.nome, chatIdDaRota), "chats/read:waha");
      }
      await supabaseAdmin
        .from("WhatsappChat")
        .update({ naoLidas: 0, atualizadoEm: new Date().toISOString() })
        .eq("tenantId", tenantId)
        .eq("sessaoId", sessao.id)
        .eq("chatId", chatIdDaRota);
      return json({ ok: true });
    }

    // POST /sessoes/:id/chats/:chatId/clear
    if (action === "sessoes" && sub[2] === "chats" && sub[4] === "clear" && req.method === "POST" && sessao) {
      const chatId = chatIdDaRota;
      const { error: errDel } = await supabaseAdmin
        .from("WhatsappMensagem")
        .delete()
        .eq("tenantId", tenantId)
        .eq("sessaoId", sessao.id)
        .eq("chatId", chatId);
      if (errDel) throw errDel;
      await supabaseAdmin
        .from("WhatsappChat")
        .update({
          ultimaMensagemTexto: null,
          ultimaMensagemEm: null,
          ultimaMensagemFromMe: false,
          naoLidas: 0,
          atualizadoEm: new Date().toISOString(),
        })
        .eq("tenantId", tenantId)
        .eq("sessaoId", sessao.id)
        .eq("chatId", chatId);
      runAfterResponse(
        removerPorPrefixo(BUCKET, `${tenantId}/whatsapp/${sessao.id}/${chatSafe(chatId)}/`),
        "chats/clear:storage",
      );
      if (waha.wahaIsConfigured()) {
        runAfterResponse(waha.clearChatMessages(sessao.nome, chatId), "chats/clear:waha");
      }
      return json({ ok: true });
    }

    // DELETE /sessoes/:id/chats/:chatId
    if (action === "sessoes" && sub[2] === "chats" && sub.length === 4 && req.method === "DELETE" && sessao) {
      const chatId = chatIdDaRota;
      // Soft-delete do chat (apagadoEm). Mensagens vão pra exclusão física
      // (não há FK entre mensagem e conversa: apagamos explicitamente) e a
      // mídia sai pelo prefixo da conversa. Se o contato voltar a escrever,
      // o webhook limpa o apagadoEm e o chat ressurge.
      const { error: errMsgs } = await supabaseAdmin
        .from("WhatsappMensagem")
        .delete()
        .eq("tenantId", tenantId)
        .eq("sessaoId", sessao.id)
        .eq("chatId", chatId);
      if (errMsgs) throw errMsgs;
      const { error: errChat } = await supabaseAdmin
        .from("WhatsappChat")
        .update({
          apagadoEm: new Date().toISOString(),
          ultimaMensagemTexto: null,
          naoLidas: 0,
          atualizadoEm: new Date().toISOString(),
        })
        .eq("tenantId", tenantId)
        .eq("sessaoId", sessao.id)
        .eq("chatId", chatId);
      if (errChat) throw errChat;
      runAfterResponse(
        removerPorPrefixo(BUCKET, `${tenantId}/whatsapp/${sessao.id}/${chatSafe(chatId)}/`),
        "chats/delete:storage",
      );
      if (waha.wahaIsConfigured()) {
        runAfterResponse(waha.deleteChat(sessao.nome, chatId), "chats/delete:waha");
      }
      return json({ ok: true });
    }

    // GET /sessoes/:id/chats/:chatId/history?limit=N
    if (action === "sessoes" && sub[2] === "chats" && sub[4] === "history" && req.method === "GET" && sessao) {
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50) || 50, 1), 200);
      try {
        const messages = await waha.getMessages(sessao.nome, chatIdDaRota, limit, false);
        return json({ messages });
      } catch (err) {
        return wahaErrorResponse(err, "chats/history");
      }
    }

    // -----------------------------------------------------------------
    // MENSAGENS (escopo: pegamos sessaoId do body)
    // -----------------------------------------------------------------

    // IA (transcrever áudio / descrever mídia) ficou fora do painel Denos.
    if (action === "messages" && ["transcrever", "descrever"].includes(sub[1] ?? "") && req.method === "POST") {
      return notImplemented("Leitura de mídia por IA não está disponível neste painel.");
    }

    // POST /messages/send-text
    if (action === "messages" && sub[1] === "send-text" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      const sessaoIdBody = body?.sessaoId as string | undefined;
      const chatId = body?.chatId as string | undefined;
      const texto = typeof body?.texto === "string" ? body.texto : "";
      const replyTo = (body?.replyTo as string | undefined) || null;
      const replyToTexto = (body?.replyToTexto as string | undefined) || null;
      if (!sessaoIdBody || !chatId || !texto.trim()) {
        return badRequest("sessaoId, chatId e texto obrigatórios");
      }
      if (!(await podeMexerNaConversa(colaborador, sessaoIdBody, chatId))) {
        return forbidden("Esta conversa está com outra pessoa da equipe.");
      }
      if (texto.length > 4096) return badRequest("Texto muito longo (máximo 4096 caracteres).");
      const sessaoMsg = await getSessaoOrFail(sessaoIdBody);
      if (!sessaoMsg) return notFound("Sessão não encontrada");

      const bloqueio = await bloqueioEnvio(sessaoMsg.id, chatId);
      if (bloqueio) return bloqueio;
      const emAtendimento = await exigirAtendimento(colaborador, sessaoMsg.id, chatId);
      if (emAtendimento) return emAtendimento;

      const r = await enviarTexto({
        tenantId,
        sessao: sessaoMsg,
        chatId,
        texto,
        replyTo,
        replyToTexto,
        origem: "humano",
        colaborador,
      });
      if (!r.ok) {
        // `id` volta junto: a tela troca a fantasma pela linha real (ack -1)
        // e mostra "não enviada" com o botão de reenviar (defeito 33).
        return json({ error: `Falha ao enviar: ${r.erro}`, id: r.mensagemId }, { status: 424 });
      }
      return json({ id: r.mensagemId, wamId: r.wamId });
    }

    // POST /messages/forward — "encaminha" RE-ENVIANDO o conteúdo da msg de
    // origem pra outro(s) chat(s) da mesma sessão. Não usa o forwardMessage do
    // WAHA (o GOWS falha em resolver a msg de origem com @lid). Cada destino
    // ganha linha provisória e autoria, como um envio normal.
    if (action === "messages" && sub[1] === "forward" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      const sessaoIdBody = body?.sessaoId as string | undefined;
      const messageId = body?.messageId as string | undefined; // wamId da origem
      const destinos = [...new Set((body?.toChatIds as string[] | undefined) ?? [])].filter(
        (d) => typeof d === "string" && d.length > 0,
      );
      if (!sessaoIdBody || !messageId || !destinos.length) {
        return badRequest("sessaoId, messageId e toChatIds obrigatórios");
      }
      // 🔴 TETO DE DESTINOS — é o que faz o balde de forward valer.
      if (destinos.length > 50) {
        return badRequest("Dá pra encaminhar para no máximo 50 conversas por vez.");
      }
      const sessaoMsg = await getSessaoOrFail(sessaoIdBody);
      if (!sessaoMsg) return notFound("Sessão não encontrada");

      const { data: orig } = await supabaseAdmin
        .from("WhatsappMensagem")
        .select("chatId, tipo, texto, mediaPath, mediaMime, mediaNomeArquivo, mediaTamanho")
        .eq("tenantId", tenantId)
        .eq("sessaoId", sessaoMsg.id)
        .eq("wamId", messageId)
        .maybeSingle();
      if (!orig) return notFound("Mensagem de origem não encontrada");
      // A origem também tem dono: sem isto, um wamId de conversa que a pessoa
      // não enxerga vazava o conteúdo para um destino dela.
      if (!(await podeMexerNaConversa(colaborador, sessaoMsg.id, orig.chatId as string))) {
        return forbidden("Esta conversa está com outra pessoa da equipe.");
      }

      const tiposMidia = ["image", "video", "audio", "ptt", "document", "sticker"];
      const ehMidia = !!orig.mediaPath && tiposMidia.includes(orig.tipo as string);
      const texto = (orig.texto as string | null)?.trim() || null;
      if (!ehMidia && !texto) {
        return badRequest("Só dá pra encaminhar mensagens de texto ou mídia já baixada.");
      }

      let signedUrl: string | null = null;
      if (ehMidia) {
        const { data: signed, error: signErr } = await supabaseAdmin.storage
          .from(BUCKET)
          .createSignedUrl(orig.mediaPath as string, 60 * 30);
        if (signErr || !signed?.signedUrl) {
          return internalError(`Falha ao gerar signed URL: ${signErr?.message}`);
        }
        signedUrl = publicarUrlAssinada(signed.signedUrl);
      }

      // Destinos: só conversas que JÁ existem nesta sessão (a tela lista as
      // conversas do banco) e que a pessoa pode mexer. Uma consulta só para os até 50.
      const { data: linhasDestino, error: destErr } = await supabaseAdmin
        .from("WhatsappChat")
        .select("chatId, responsavelId")
        .eq("tenantId", tenantId)
        .eq("sessaoId", sessaoMsg.id)
        .in("chatId", destinos);
      if (destErr) return internalError(`Falha ao ler as conversas de destino: ${destErr.message}`);
      const respPorChat = new Map<string, string | null>(
        (linhasDestino ?? []).map((l) => [l.chatId as string, (l.responsavelId as string | null) ?? null]),
      );
      const veTodas = tem(colaborador, "whatsapp.ver_todas");

      type ResultadoDestino = { chatId: string; ok: boolean; id?: string; motivo?: string; erro?: string };
      const encaminharPara = async (toChatId: string): Promise<ResultadoDestino> => {
        if (!respPorChat.has(toChatId)) {
          return { chatId: toChatId, ok: false, motivo: "conversa_inexistente", erro: "Conversa não encontrada nesta conexão." };
        }
        const resp = respPorChat.get(toChatId);
        if (!veTodas && resp && resp !== colaborador.id) {
          return { chatId: toChatId, ok: false, motivo: "sem_acesso", erro: "Esta conversa está com outra pessoa da equipe." };
        }
        const bloqueio = await bloqueioEnvio(sessaoMsg.id, toChatId);
        if (bloqueio) {
          const corpo = await bloqueio.json().catch(() => ({}));
          return { chatId: toChatId, ok: false, motivo: corpo.motivo, erro: corpo.error };
        }
        const ocupado = await exigirAtendimento(colaborador, sessaoMsg.id, toChatId);
        if (ocupado) {
          const corpo = await ocupado.json().catch(() => ({}));
          return { chatId: toChatId, ok: false, motivo: corpo.motivo, erro: corpo.error };
        }
        if (!ehMidia) {
          const r = await enviarTexto({
            tenantId,
            sessao: sessaoMsg,
            chatId: toChatId,
            texto: texto as string,
            origem: "humano",
            colaborador,
          });
          return r.ok ? { chatId: toChatId, ok: true, id: r.mensagemId } : { chatId: toChatId, ok: false, erro: r.erro };
        }
        const t = orig.tipo as string;
        const provisoriaId = await criarLinhaProvisoria({
          tenantId,
          sessaoId: sessaoMsg.id,
          chatId: toChatId,
          origem: "humano",
          colaborador,
          linha: {
            tipo: t === "ptt" ? "audio" : t,
            texto,
            mediaPath: orig.mediaPath as string,
            mediaMime: orig.mediaMime as string | null,
            mediaNomeArquivo: orig.mediaNomeArquivo as string | null,
            mediaTamanho: orig.mediaTamanho as number | null,
          },
        });
        await subirConversa({ tenantId, sessaoId: sessaoMsg.id, chatId: toChatId, snippet: texto ?? rotuloMidia(t === "image" ? "image" : t === "video" ? "video" : t === "audio" || t === "ptt" ? "voice" : "file") });
        try {
          const sendArgs = {
            session: sessaoMsg.nome,
            chatId: toChatId,
            url: signedUrl as string,
            mimetype: (orig.mediaMime as string | null) ?? undefined,
            // Nome e tipo do arquivo vão junto: no adv3 o contato recebia o
            // nome UUID do bucket (defeito 52 do guia).
            filename: (orig.mediaNomeArquivo as string | null) ?? undefined,
            caption: texto ?? undefined,
          };
          const sent = t === "image"
            ? await waha.sendImage(sendArgs)
            : t === "video"
            ? await waha.sendVideo(sendArgs)
            : t === "audio" || t === "ptt"
            ? await waha.sendVoice(sendArgs)
            : await waha.sendFile(sendArgs); // document/sticker
          const id = await reconciliarEnvio({
            tenantId,
            sessaoId: sessaoMsg.id,
            provisoriaId,
            wamId: wamIdDe(sent),
            ack: sent?.ack,
            origem: "humano",
            colaborador,
          });
          return { chatId: toChatId, ok: true, id };
        } catch (err) {
          await marcarFalha(provisoriaId);
          return { chatId: toChatId, ok: false, erro: err instanceof Error ? err.message : String(err) };
        }
      };
      // Até 5 destinos ao mesmo tempo; a lista volta na ordem pedida. Falha
      // inesperada de um destino vira erro DELE, não derruba os outros.
      const resultados = await mapaComLimite(destinos, 5, (toChatId) =>
        encaminharPara(toChatId).catch((err): ResultadoDestino => ({
          chatId: toChatId,
          ok: false,
          erro: err instanceof Error ? err.message : String(err),
        })));
      const enviados = resultados.filter((r) => r.ok).length;
      // Resultado parcial SEMPRE volta (no adv3 as falhas sumiam): 200 com a
      // lista; 424 só quando nenhum destino recebeu.
      return json(
        { ok: enviados > 0, enviados, falhas: resultados.length - enviados, resultados },
        { status: enviados > 0 ? 200 : 424 },
      );
    }

    // POST /messages/poll-vote — vota numa enquete recebida.
    // `votes` é a lista COMPLETA de opções escolhidas (em enquete de múltipla
    // escolha a tela manda todas as marcadas, não só a última).
    if (action === "messages" && sub[1] === "poll-vote" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      const sessaoIdBody = body?.sessaoId as string | undefined;
      const chatId = body?.chatId as string | undefined;
      const pollMessageId = body?.pollMessageId as string | undefined;
      const votes = ((body?.votes as string[] | undefined) ?? []).filter((v) => typeof v === "string" && v);
      if (!sessaoIdBody || !chatId || !pollMessageId || !votes.length) {
        return badRequest("sessaoId, chatId, pollMessageId e votes obrigatórios");
      }
      const sessaoMsg = await getSessaoOrFail(sessaoIdBody);
      if (!sessaoMsg) return notFound("Sessão não encontrada");
      const bloqueio = await bloqueioEnvio(sessaoMsg.id, chatId);
      if (bloqueio) return bloqueio;
      const emAtendimento = await exigirAtendimento(colaborador, sessaoMsg.id, chatId);
      if (emAtendimento) return emAtendimento;
      try {
        await waha.sendPollVote({ session: sessaoMsg.nome, chatId, pollMessageId, votes });
      } catch (err) {
        return wahaErrorResponse(err, "messages/poll-vote");
      }
      return json({ ok: true });
    }

    // POST /messages/send-media
    // Body: { sessaoId, chatId, kind: image|file|voice|video, mediaPath,
    //         mimetype?, filename?, caption?, tamanho?, replyTo?, replyToTexto? }
    // O arquivo já está no bucket (a tela sobe em `denos/uploads/...`).
    if (action === "messages" && sub[1] === "send-media" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      const sessaoIdBody = body?.sessaoId as string | undefined;
      const chatId = body?.chatId as string | undefined;
      const kind = body?.kind as "image" | "file" | "voice" | "video" | undefined;
      const mediaPath = body?.mediaPath as string | undefined;
      const mimetype = (body?.mimetype as string | undefined) || undefined;
      const filename = (body?.filename as string | undefined) || undefined;
      const caption = (body?.caption as string | undefined)?.trim() || undefined;
      const tamanho = Number(body?.tamanho) > 0 ? Number(body.tamanho) : null;
      const replyTo = (body?.replyTo as string | undefined) || undefined;
      const replyToTexto = (body?.replyToTexto as string | undefined) || null;
      if (!sessaoIdBody || !chatId || !kind || !mediaPath) {
        return badRequest("sessaoId, chatId, kind e mediaPath obrigatórios");
      }
      if (!(await podeMexerNaConversa(colaborador, sessaoIdBody, chatId))) {
        return forbidden("Esta conversa está com outra pessoa da equipe.");
      }
      if (!["image", "file", "voice", "video"].includes(kind)) {
        return badRequest("kind deve ser image, file, voice ou video");
      }
      const sessaoMsg = await getSessaoOrFail(sessaoIdBody);
      if (!sessaoMsg) return notFound("Sessão não encontrada");

      // O mediaPath vem do body e é assinado com a service role (fura a RLS
      // do bucket). Exige o prefixo do escritório e rejeita path traversal.
      if (!mediaPath.startsWith(`${tenantId}/`) || mediaPath.includes("..")) {
        return forbidden("Arquivo fora do escritório.");
      }
      if (tamanho && tamanho > waha.MAX_MEDIA_BYTES) {
        return badRequest("Arquivo maior que 25 MB.");
      }

      const bloqueioMidia = await bloqueioEnvio(sessaoMsg.id, chatId);
      if (bloqueioMidia) return bloqueioMidia;
      const emAtendimentoMidia = await exigirAtendimento(colaborador, sessaoMsg.id, chatId);
      if (emAtendimentoMidia) return emAtendimentoMidia;

      const { data: signed, error: signErr } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUrl(mediaPath, 60 * 30);
      if (signErr || !signed?.signedUrl) {
        return internalError(`Falha ao gerar signed URL: ${signErr?.message}`);
      }

      const tipo = kind === "voice" ? "audio" : kind === "file" ? "document" : kind;
      const provisoriaId = await criarLinhaProvisoria({
        tenantId,
        sessaoId: sessaoMsg.id,
        chatId,
        origem: "humano",
        colaborador,
        linha: {
          tipo,
          texto: caption ?? null,
          mediaPath,
          mediaMime: mimetype ?? null,
          mediaNomeArquivo: filename ?? null,
          // Sem tamanho a tela não sabe o peso do anexo (defeito 53 do guia).
          mediaTamanho: tamanho,
          replyToWamId: replyTo ?? null,
          replyToTexto,
        },
      });
      // Sobe a conversa ANTES do WAHA (mídia tem timeout 45s + retries).
      await subirConversa({ tenantId, sessaoId: sessaoMsg.id, chatId, snippet: caption ?? rotuloMidia(kind) });

      try {
        const sendArgs = {
          session: sessaoMsg.nome,
          chatId,
          url: publicarUrlAssinada(signed.signedUrl),
          mimetype,
          filename,
          caption,
          replyTo,
        };
        const sent = kind === "image"
          ? await waha.sendImage(sendArgs)
          : kind === "voice"
          ? await waha.sendVoice(sendArgs)
          : kind === "video"
          ? await waha.sendVideo(sendArgs)
          : await waha.sendFile(sendArgs);
        const id = await reconciliarEnvio({
          tenantId,
          sessaoId: sessaoMsg.id,
          provisoriaId,
          wamId: wamIdDe(sent),
          ack: sent?.ack,
          origem: "humano",
          colaborador,
        });
        return json({ id });
      } catch (err) {
        await marcarFalha(provisoriaId);
        const msg = err instanceof Error ? err.message : String(err);
        return json({ error: `Falha ao enviar mídia: ${msg}`, id: provisoriaId }, { status: 424 });
      }
    }

    // POST /messages/react — { sessaoId, messageId, reaction }  ("" remove)
    if (action === "messages" && sub[1] === "react" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      const sessaoIdBody = body?.sessaoId as string | undefined;
      const messageId = body?.messageId as string | undefined;
      const reaction = (body?.reaction as string | undefined) ?? "";
      if (!sessaoIdBody || !messageId) return badRequest("sessaoId e messageId obrigatórios");
      const sessaoMsg = await getSessaoOrFail(sessaoIdBody);
      if (!sessaoMsg) return notFound("Sessão não encontrada");
      // A reação chega só com o wamId: descobre a conversa pela mensagem.
      const { data: alvo } = await supabaseAdmin
        .from("WhatsappMensagem")
        .select("chatId")
        .eq("tenantId", tenantId)
        .eq("sessaoId", sessaoMsg.id)
        .eq("wamId", messageId)
        .maybeSingle();
      if (alvo?.chatId) {
        const emAtendimento = await exigirAtendimento(colaborador, sessaoMsg.id, alvo.chatId as string);
        if (emAtendimento) return emAtendimento;
      }
      try {
        await waha.reactToMessage({ session: sessaoMsg.nome, messageId, reaction });
      } catch (err) {
        return wahaErrorResponse(err, "messages/react");
      }
      return json({ ok: true });
    }

    // POST /messages/refetch-media — { mensagemId }
    // Re-busca a mídia de uma msg cujo download falhou no webhook.
    if (action === "messages" && sub[1] === "refetch-media" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      const mensagemId = body?.mensagemId as string | undefined;
      if (!mensagemId) return badRequest("mensagemId obrigatório");
      const { data: msgRow } = await supabaseAdmin
        .from("WhatsappMensagem")
        .select("id, sessaoId, chatId, wamId, tipo, mediaPath")
        .eq("tenantId", tenantId)
        .eq("id", mensagemId)
        .maybeSingle();
      if (!msgRow) return notFound("Mensagem não encontrada");
      if (msgRow.mediaPath) return json({ ok: true, mediaPath: msgRow.mediaPath, alreadyPresent: true });
      if (!msgRow.wamId) return badRequest("Mensagem sem wamId — não dá pra re-buscar");
      const sessaoMsg = await getSessaoOrFail(msgRow.sessaoId);
      if (!sessaoMsg) return notFound("Sessão da mensagem não encontrada");
      try {
        const media = await persistMediaIfAny({
          tenantId,
          sessaoId: msgRow.sessaoId,
          sessionName: sessaoMsg.nome,
          chatId: msgRow.chatId,
          wamId: msgRow.wamId,
          msgType: msgRow.tipo,
        });
        if (!media.mediaPath) return json({ ok: false, error: "Mídia indisponível no WAHA" }, { status: 424 });
        await supabaseAdmin
          .from("WhatsappMensagem")
          .update({
            mediaPath: media.mediaPath,
            mediaMime: media.mediaMime,
            mediaNomeArquivo: media.mediaNomeArquivo,
            mediaTamanho: media.mediaTamanho,
          })
          .eq("tenantId", tenantId)
          .eq("id", mensagemId);
        return json({ ok: true, mediaPath: media.mediaPath });
      } catch (err) {
        return wahaErrorResponse(err, "messages/refetch-media");
      }
    }

    // DELETE /messages/<mensagemId> — apaga uma mensagem própria pra todos
    // (WAHA + marca apagadoEm). WhatsApp só aceita apagar `fromMe`.
    if (action === "messages" && sub[1] && sub.length === 2 && req.method === "DELETE") {
      const mensagemId = sub[1];
      const { data: msgRow } = await supabaseAdmin
        .from("WhatsappMensagem")
        .select("id, sessaoId, chatId, wamId, fromMe, apagadoEm")
        .eq("tenantId", tenantId)
        .eq("id", mensagemId)
        .maybeSingle();
      if (!msgRow) return notFound("Mensagem não encontrada");
      if (!msgRow.fromMe) return badRequest("Só dá pra apagar mensagens enviadas pelo escritório.");
      if (msgRow.apagadoEm) return json({ ok: true, alreadyDeleted: true });
      if (!msgRow.wamId) return badRequest("Mensagem sem wamId — não dá pra apagar no WhatsApp.");
      const sessaoMsg = await getSessaoOrFail(msgRow.sessaoId);
      if (!sessaoMsg) return notFound("Sessão da mensagem não encontrada");
      const emAtendimento = await exigirAtendimento(colaborador, msgRow.sessaoId, msgRow.chatId);
      if (emAtendimento) return emAtendimento;
      try {
        await waha.deleteMessage({ session: sessaoMsg.nome, chatId: msgRow.chatId, messageId: msgRow.wamId });
      } catch (err) {
        return wahaErrorResponse(err, "messages/delete");
      }
      await supabaseAdmin
        .from("WhatsappMensagem")
        .update({ apagadoEm: new Date().toISOString() })
        .eq("tenantId", tenantId)
        .eq("id", mensagemId);
      return json({ ok: true });
    }

    // PATCH /messages/<mensagemId>  { text } — edita o TEXTO de uma mensagem
    // própria. O WhatsApp só deixa editar texto enviado pelo número e dentro
    // de 15 minutos — conferido AQUI também (no adv3 não era, defeito 51).
    if (action === "messages" && sub[1] && sub.length === 2 && req.method === "PATCH") {
      const mensagemId = sub[1];
      const body = await req.json().catch(() => null);
      const novoTexto = typeof body?.text === "string" ? body.text.trim() : "";
      if (!novoTexto) return badRequest("Texto não pode ser vazio.");
      if (novoTexto.length > 4096) return badRequest("Texto muito longo.");
      const { data: msgRow } = await supabaseAdmin
        .from("WhatsappMensagem")
        .select("id, sessaoId, chatId, wamId, fromMe, tipo, apagadoEm, timestamp")
        .eq("tenantId", tenantId)
        .eq("id", mensagemId)
        .maybeSingle();
      if (!msgRow) return notFound("Mensagem não encontrada");
      if (!msgRow.fromMe) return badRequest("Só dá pra editar mensagens enviadas pelo escritório.");
      if (msgRow.apagadoEm) return badRequest("Mensagem apagada não pode ser editada.");
      if (msgRow.tipo !== "text") return badRequest("Só dá pra editar mensagens de texto.");
      if (!msgRow.wamId) return badRequest("Mensagem sem wamId — não dá pra editar no WhatsApp.");
      if (Date.now() - Date.parse(msgRow.timestamp) > 15 * 60 * 1000) {
        return badRequest("O WhatsApp só permite editar até 15 minutos depois do envio.");
      }
      const bloqueio = await bloqueioEnvio(msgRow.sessaoId, msgRow.chatId);
      if (bloqueio) return bloqueio;
      const sessaoMsg = await getSessaoOrFail(msgRow.sessaoId);
      if (!sessaoMsg) return notFound("Sessão da mensagem não encontrada");
      const emAtendimento = await exigirAtendimento(colaborador, msgRow.sessaoId, msgRow.chatId);
      if (emAtendimento) return emAtendimento;
      try {
        await waha.editMessage({ session: sessaoMsg.nome, chatId: msgRow.chatId, messageId: msgRow.wamId, text: novoTexto });
      } catch (err) {
        return wahaErrorResponse(err, "messages/edit");
      }
      await supabaseAdmin
        .from("WhatsappMensagem")
        .update({ texto: novoTexto, editadoEm: new Date().toISOString() })
        .eq("tenantId", tenantId)
        .eq("id", mensagemId);
      // A prévia da lista acompanha, se esta for a última mensagem da conversa.
      const { data: ultima } = await supabaseAdmin
        .from("WhatsappMensagem")
        .select("id")
        .eq("tenantId", tenantId)
        .eq("sessaoId", msgRow.sessaoId)
        .eq("chatId", msgRow.chatId)
        .order("timestamp", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (ultima?.id === mensagemId) {
        await supabaseAdmin
          .from("WhatsappChat")
          .update({ ultimaMensagemTexto: novoTexto.slice(0, 200), atualizadoEm: new Date().toISOString() })
          .eq("tenantId", tenantId)
          .eq("sessaoId", msgRow.sessaoId)
          .eq("chatId", msgRow.chatId);
      }
      return json({ ok: true });
    }

    // POST /messages/typing — { sessaoId, chatId, state: typing|paused }
    if (action === "messages" && sub[1] === "typing" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      const sessaoIdBody = body?.sessaoId as string | undefined;
      const chatId = body?.chatId as string | undefined;
      const state = body?.state === "paused" ? "paused" : "typing";
      if (!sessaoIdBody || !chatId) return badRequest("sessaoId e chatId obrigatórios");
      const sessaoMsg = await getSessaoOrFail(sessaoIdBody);
      if (!sessaoMsg) return notFound("Sessão não encontrada");
      try {
        await waha.sendTyping({ session: sessaoMsg.nome, chatId, state });
      } catch (err) {
        return wahaErrorResponse(err, "messages/typing");
      }
      return json({ ok: true });
    }

    return notFound(`Rota ${req.method} /${sub.join("/")} não encontrada`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : (err as { message?: string })?.message ?? String(err);
    console.error("[whatsapp]", sub.join("/"), msg);
    const id = novoErroId();
    await recordError({
      origem: "edge",
      mensagem: `whatsapp ${req.method} /${sub[0] ?? ""}: ${msg} (ref ${id})`,
      stack: err instanceof Error ? err.stack : null,
    });
    return internalError(msg, { id, registrado: true });
  }
});

/**
 * A URL assinada que o Storage devolve usa o host INTERNO do compose
 * (http://api-gw:8000/storage/v1/...), porque é por ele que a function fala
 * com o Supabase. O WAHA baixa o anexo por essa URL e roda fora do compose:
 * trocamos a origem pela pública. O token da assinatura não depende do host.
 */
function publicarUrlAssinada(signed: string): string {
  try {
    const u = new URL(signed);
    const interno = new URL(Deno.env.get("SUPABASE_URL") ?? "http://api-gw:8000");
    if (u.origin === interno.origin) {
      return `${PUBLIC_BASE_URL}${u.pathname}${u.search}`;
    }
    return signed;
  } catch {
    return signed;
  }
}
