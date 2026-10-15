// O caminho de uma mensagem que SAI, num lugar só.
//
// Três chamadores mandam mensagem pelo WhatsApp do escritório: a tela
// (`whatsapp` → send-text/send-media/forward), e o aviso de certificado
// (`crons` → certificados-avisos). Os três precisam da MESMA sequência, e
// qualquer passo pulado vira defeito silencioso:
//
//   1. linha provisória em WhatsappMensagem (sem wamId, `pendenteEco`, ack 0)
//      ANTES de chamar o WAHA — é ela que o eco do webhook reconcilia;
//   2. a conversa sobe na lista ANTES do WAHA (que pode levar segundos):
//      senão qualquer refetch no meio a derruba de volta;
//   3. chama o WAHA;
//   4. grava wamId + ack (ou ack -1 se falhou) — e trata a corrida em que o
//      eco chegou primeiro e virou outra linha.
//
// No adv3 o encaminhar pulava o passo 1 e a mensagem encaminhada virava
// "mandada pelo celular", perdendo quem enviou (defeito 32 do guia).

import { supabaseAdmin } from "./supabase.ts";
import * as waha from "./waha.ts";
import { clientePorTelefone } from "./whatsapp-contato.ts";

export type OrigemEnvio = "humano" | "sistema";

export type ChatRow = {
  id: string;
  nome: string | null;
  fotoPath: string | null;
  sobre: string | null;
  perfilBuscadoEm: string | null;
  clienteId: string | null;
};

/**
 * Garante a conversa (upsert por `(tenantId, sessaoId, chatId)`) e devolve a
 * linha. `apagadoEm: null` ressurge conversa apagada — se o contato voltar a
 * escrever (ou se o escritório mandar algo), ela reaparece, como no
 * WhatsApp Web.
 *
 * 🔴 NÃO grava `nome` (em grupo, o pushName da mensagem é o REMETENTE e
 * sobrescrevia o nome do grupo) e NÃO grava `clienteId` no upsert: no adv3 o
 * upsert regravava o cliente achado pelo telefone (ou null) em TODA mensagem,
 * e o vínculo manual sumia na mensagem seguinte (defeito 1 do guia). Aqui o
 * cliente só é preenchido quando a conversa ainda não tem nenhum E ninguém
 * desvinculou à mão (`clienteVinculoManual`).
 *
 * Devolve null para id que não é conversa (canal, broadcast).
 * Erro de banco ESTOURA: no webhook vira 500 e o WAHA reentrega.
 */
export async function garantirChat(args: {
  tenantId: string;
  sessaoId: string;
  chatId: string;
}): Promise<ChatRow | null> {
  const tipo = waha.classifyChat(args.chatId);
  if (!tipo) return null;

  const { error: upErr } = await supabaseAdmin.from("WhatsappChat").upsert(
    {
      tenantId: args.tenantId,
      sessaoId: args.sessaoId,
      chatId: args.chatId,
      tipo,
      apagadoEm: null,
      atualizadoEm: new Date().toISOString(),
    },
    { onConflict: "tenantId,sessaoId,chatId", ignoreDuplicates: false },
  );
  if (upErr) throw new Error(`upsert WhatsappChat: ${upErr.message}`);

  const { data: row, error } = await supabaseAdmin
    .from("WhatsappChat")
    .select("id, nome, fotoPath, sobre, perfilBuscadoEm, clienteId, clienteVinculoManual")
    .eq("tenantId", args.tenantId)
    .eq("sessaoId", args.sessaoId)
    .eq("chatId", args.chatId)
    .single();
  if (error) throw new Error(`select WhatsappChat: ${error.message}`);

  // Vínculo automático por telefone — só @c.us (o @lid não carrega telefone).
  if (
    !row.clienteId && !row.clienteVinculoManual && tipo === "individual" &&
    args.chatId.endsWith("@c.us")
  ) {
    const cliente = await clientePorTelefone(args.chatId.replace("@c.us", ""));
    if (cliente) {
      const { error: vErr } = await supabaseAdmin
        .from("WhatsappChat")
        .update({ clienteId: cliente.id })
        .eq("id", row.id)
        .is("clienteId", null)
        .eq("clienteVinculoManual", false);
      if (!vErr) row.clienteId = cliente.id;
    }
  }
  return row as ChatRow;
}

/** Sobe a conversa na lista com a prévia da mensagem que está saindo. */
export async function subirConversa(args: {
  tenantId: string;
  sessaoId: string;
  chatId: string;
  snippet: string;
}): Promise<void> {
  const agora = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("WhatsappChat")
    .update({
      ultimaMensagemTexto: args.snippet.slice(0, 200),
      ultimaMensagemEm: agora,
      ultimaMensagemFromMe: true,
      atualizadoEm: agora,
    })
    .eq("tenantId", args.tenantId)
    .eq("sessaoId", args.sessaoId)
    .eq("chatId", args.chatId);
  if (error) console.warn("[subirConversa]", error.message);
}

export type LinhaProvisoria = {
  tipo: string;
  texto: string | null;
  mediaPath?: string | null;
  mediaMime?: string | null;
  mediaNomeArquivo?: string | null;
  mediaTamanho?: number | null;
  replyToWamId?: string | null;
  replyToTexto?: string | null;
};

/** Passo 1: a linha que o eco vai reconciliar. Erro de banco estoura. */
export async function criarLinhaProvisoria(args: {
  tenantId: string;
  sessaoId: string;
  chatId: string;
  origem: OrigemEnvio;
  colaborador: { id: string; nome: string } | null;
  linha: LinhaProvisoria;
}): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("WhatsappMensagem")
    .insert({
      tenantId: args.tenantId,
      sessaoId: args.sessaoId,
      chatId: args.chatId,
      ...args.linha,
      fromMe: true,
      origem: args.origem,
      // pendenteEco = casável pelo eco do webhook (consumir_eco_fromme).
      pendenteEco: true,
      ack: 0,
      timestamp: new Date().toISOString(),
      // Quem enviou: o colaborador (coluna própria, nunca misturada com o
      // JID de quem mandou mensagem recebida — defeito 19 do guia).
      enviadoPorUserId: args.colaborador?.id ?? null,
      remetenteNome: args.colaborador?.nome ??
        (args.origem === "sistema" ? "Aviso automático" : null),
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Falha ao registrar a mensagem: ${error?.message ?? "sem linha"}`);
  }
  return data.id as string;
}

/**
 * Passo 4: grava o wamId devolvido pelo WAHA na linha provisória.
 *
 * ⚠️ A CORRIDA: o eco (`message.any` fromMe) pode chegar ANTES desta escrita.
 * Na maioria das vezes o webhook o casa com a linha provisória pela RPC
 * `consumir_eco_fromme` e grava o mesmo wamId — aqui o update só repete o
 * valor. Se o eco não casou (texto normalizado diferente, mídia), ele virou
 * OUTRA linha com esse wamId, e o update daqui bate no índice único (23505).
 * Nesse caso a linha do eco é a que fica (ela tem o conteúdo como o WhatsApp
 * registrou): copiamos a autoria pra ela e apagamos a provisória.
 *
 * Devolve o id da linha que ficou.
 */
export async function reconciliarEnvio(args: {
  tenantId: string;
  sessaoId: string;
  provisoriaId: string;
  wamId: string | null | undefined;
  ack: number | null | undefined;
  origem: OrigemEnvio;
  colaborador: { id: string; nome: string } | null;
}): Promise<string> {
  if (!args.wamId) {
    // WAHA respondeu sem id (engine estranha): fica pendente de eco, que
    // casa por texto/tipo nos próximos 2 minutos.
    await supabaseAdmin
      .from("WhatsappMensagem")
      .update({ ack: Math.max(1, args.ack ?? 1) })
      .eq("id", args.provisoriaId);
    return args.provisoriaId;
  }
  const { error } = await supabaseAdmin
    .from("WhatsappMensagem")
    .update({ wamId: args.wamId, ack: Math.max(1, args.ack ?? 1), pendenteEco: false })
    .eq("id", args.provisoriaId);
  if (!error) return args.provisoriaId;
  if (error.code !== "23505") {
    console.error("[reconciliarEnvio] update wamId", error.message);
    return args.provisoriaId;
  }
  const { data: eco } = await supabaseAdmin
    .from("WhatsappMensagem")
    .select("id")
    .eq("tenantId", args.tenantId)
    .eq("sessaoId", args.sessaoId)
    .eq("wamId", args.wamId)
    .maybeSingle();
  if (!eco) return args.provisoriaId;
  await supabaseAdmin
    .from("WhatsappMensagem")
    .update({
      origem: args.origem,
      enviadoPorUserId: args.colaborador?.id ?? null,
      remetenteNome: args.colaborador?.nome ?? null,
      pendenteEco: false,
    })
    .eq("id", eco.id);
  await supabaseAdmin.from("WhatsappMensagem").delete().eq("id", args.provisoriaId);
  return eco.id as string;
}

/** Envio falhou: marca ack -1 (a tela mostra "não enviada" e deixa reenviar). */
export async function marcarFalha(provisoriaId: string): Promise<void> {
  await supabaseAdmin
    .from("WhatsappMensagem")
    .update({ ack: -1, pendenteEco: false })
    .eq("id", provisoriaId);
}

export type ResultadoEnvio =
  | { ok: true; mensagemId: string; wamId: string | null }
  | { ok: false; mensagemId: string; erro: string };

/**
 * Envio de TEXTO completo (passos 1 a 4). `garantirConversa` = criar a
 * conversa se ainda não existe (o aviso de certificado manda pra um telefone
 * de cadastro, que pode nunca ter conversado com o escritório).
 */
export async function enviarTexto(args: {
  tenantId: string;
  sessao: { id: string; nome: string };
  chatId: string;
  texto: string;
  replyTo?: string | null;
  replyToTexto?: string | null;
  origem: OrigemEnvio;
  colaborador: { id: string; nome: string } | null;
  garantirConversa?: boolean;
}): Promise<ResultadoEnvio> {
  if (args.garantirConversa) {
    await garantirChat({ tenantId: args.tenantId, sessaoId: args.sessao.id, chatId: args.chatId });
  }
  const provisoriaId = await criarLinhaProvisoria({
    tenantId: args.tenantId,
    sessaoId: args.sessao.id,
    chatId: args.chatId,
    origem: args.origem,
    colaborador: args.colaborador,
    linha: {
      tipo: "text",
      texto: args.texto,
      replyToWamId: args.replyTo ?? null,
      replyToTexto: args.replyToTexto ?? null,
    },
  });
  await subirConversa({
    tenantId: args.tenantId,
    sessaoId: args.sessao.id,
    chatId: args.chatId,
    snippet: args.texto,
  });
  try {
    const sent = await waha.sendText({
      session: args.sessao.nome,
      chatId: args.chatId,
      text: args.texto,
      replyTo: args.replyTo ?? undefined,
    });
    const mensagemId = await reconciliarEnvio({
      tenantId: args.tenantId,
      sessaoId: args.sessao.id,
      provisoriaId,
      wamId: wamIdDe(sent),
      ack: sent?.ack,
      origem: args.origem,
      colaborador: args.colaborador,
    });
    return { ok: true, mensagemId, wamId: wamIdDe(sent) };
  } catch (err) {
    await marcarFalha(provisoriaId);
    return {
      ok: false,
      mensagemId: provisoriaId,
      erro: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * O id que o WAHA devolve no envio. A maioria das engines manda `id` como
 * string serializada (`true_<chat>_<id>`); algumas mandam `{ _serialized }`.
 * Id CURTO (só o hex, sem chat) não serve: não bate com o wamId que o eco
 * traz e viraria duplicata. Nesse caso devolve null e a linha fica pendente
 * de eco, que casa por texto/tipo.
 */
export function wamIdDe(sent: unknown): string | null {
  if (!sent || typeof sent !== "object") return null;
  const s = sent as Record<string, unknown>;
  const id = typeof s.id === "string"
    ? s.id
    : (s.id as { _serialized?: unknown } | undefined)?._serialized;
  return typeof id === "string" && id.includes("_") ? id : null;
}
