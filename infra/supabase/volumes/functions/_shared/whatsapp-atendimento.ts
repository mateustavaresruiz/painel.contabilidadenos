// Regra de atendimento no estilo Blip, aplicada no SERVIDOR antes de qualquer
// envio (texto, mídia, encaminhar, reagir, editar, apagar, enquete).
//
//   Na fila (sem responsável) ──enviar/assumir──▶ Em atendimento (responsável)
//   Em atendimento ──finalizar──▶ Finalizado ──enviar──▶ Em atendimento (quem enviou)
//   Finalizado ──mensagem do cliente──▶ Na fila (webhook, ver migration 007)
//
// Enviar só assume (ou reabre) para quem tem `whatsapp.assumir` ou
// `whatsapp.transferir` (ou `assumir_de_outros`). Decisão do dono: "quem não
// tem a permissão de assumir não assume só por responder".
//
// `decidirEnvio` é PURA (só olha a conversa e quem chama) e tem teste em
// `whatsapp-atendimento_test.ts`. `garantirAtendimento` aplica a decisão com
// checagem otimista no banco (RPC `atendimento_aplicar`, que trava a linha) e
// repete a decisão uma vez se alguém mexeu no meio. Grupos ficam de fora: a
// tela não tem como assumir/finalizar grupo, então não há dono.

export type AtendimentoStatus = "aberto" | "em_atendimento" | "finalizado";

export type ChatAtendimento = {
  id: string;
  responsavelId: string | null;
  atendimentoStatus: AtendimentoStatus;
};

export type Eu = { id: string; nome: string };

export type EventoAtendimento = "assumiu" | "tomou" | "reabriu";

export type Decisao =
  | { acao: "enviar" }
  | { acao: "assumir"; evento: "assumiu" }
  | { acao: "reabrir"; evento: "reabriu" }
  | { acao: "tomar"; evento: "tomou"; deId: string }
  | { acao: "bloquear"; responsavelId: string }
  | { acao: "sem_permissao" };

/** O que o cargo de quem chama permite (vem das permissões do colaborador). */
export type PermissoesAtendimento = {
  /** `whatsapp.assumir` ou `whatsapp.transferir`: fica com conversa livre ou finalizada. */
  podeAssumir: boolean;
  /** `whatsapp.assumir_de_outros`: toma conversa de outra pessoa (implica `podeAssumir`). */
  podeAssumirDeOutros: boolean;
};

/**
 * O que fazer quando `eu` quer mexer (enviar/reagir/editar/apagar) numa conversa.
 *  - responsável sou eu ........ só enviar
 *  - sem conversa, sem responsável ou finalizada:
 *      pode assumir ............ assumir (finalizada: reabrir em nome de quem envia)
 *      não pode ................ sem_permissao (o envio não assume por tabela)
 *  - responsável é outra pessoa  com `assumir_de_outros`: toma a conversa (e
 *                                 registra); sem a permissão: bloqueia.
 */
export function decidirEnvio(
  chat: ChatAtendimento | null,
  eu: Eu,
  p: PermissoesAtendimento,
): Decisao {
  const podeAssumir = p.podeAssumir || p.podeAssumirDeOutros;
  if (chat && chat.atendimentoStatus !== "finalizado" && chat.responsavelId === eu.id) {
    return { acao: "enviar" };
  }
  if (!chat || !chat.responsavelId || chat.atendimentoStatus === "finalizado") {
    if (!podeAssumir) return { acao: "sem_permissao" };
    return chat?.atendimentoStatus === "finalizado"
      ? { acao: "reabrir", evento: "reabriu" }
      : { acao: "assumir", evento: "assumiu" };
  }
  if (p.podeAssumirDeOutros) return { acao: "tomar", evento: "tomou", deId: chat.responsavelId };
  return { acao: "bloquear", responsavelId: chat.responsavelId };
}

export const MSG_SEM_PERMISSAO_ASSUMIR =
  "Seu cargo não assume conversas. Peça para alguém assumir ou transferir esta conversa para você.";
export const MSG_DISPUTA = "A conversa acabou de mudar; tente de novo.";

/**
 * Corpo do erro que a tela entende (`motivo`):
 *  - `em_atendimento` (409): está com outra pessoa (vem o nome);
 *  - `sem_permissao_assumir` (403): o cargo não assume conversa livre/finalizada;
 *  - `disputa` (409): a conversa mudou no meio do envio; tentar de novo.
 */
export type ConflitoAtendimento =
  | { error: string; motivo: "em_atendimento"; responsavel: { id: string; nome: string } }
  | { error: string; motivo: "sem_permissao_assumir" }
  | { error: string; motivo: "disputa" };

/** Status HTTP de cada motivo. */
export function statusDoConflito(c: ConflitoAtendimento): 403 | 409 {
  return c.motivo === "sem_permissao_assumir" ? 403 : 409;
}

export type ResultadoAtendimento =
  | { ok: true; decisao: "enviar" | "assumir" | "reabrir" | "tomar" | "ignorado" }
  | { ok: false; conflito: ConflitoAtendimento };

/** O que a regra precisa do banco (trocável nos testes). */
export interface AtendimentoDb {
  lerChat(sessaoId: string, chatId: string): Promise<ChatAtendimento | null>;
  aplicar(a: {
    chatRowId: string;
    porId: string;
    evento: EventoAtendimento;
    motivo: string | null;
    esperadoResp: string | null;
    esperadoStatus: AtendimentoStatus;
    novoResp: string;
  }): Promise<
    { ok: true } | { ok: false; responsavelId: string | null; status: AtendimentoStatus | null }
  >;
  nomeColaborador(id: string): Promise<string | null>;
}

export function ehGrupo(chatId: string): boolean {
  return chatId.endsWith("@g.us");
}

async function emAtendimentoPor(db: AtendimentoDb, id: string): Promise<ResultadoAtendimento> {
  const nome = (await db.nomeColaborador(id)) ?? "outra pessoa";
  return {
    ok: false,
    conflito: { error: `Conversa em atendimento por ${nome}`, motivo: "em_atendimento", responsavel: { id, nome } },
  };
}

export async function garantirAtendimento(
  db: AtendimentoDb,
  args: { sessaoId: string; chatId: string; eu: Eu } & PermissoesAtendimento,
): Promise<ResultadoAtendimento> {
  if (ehGrupo(args.chatId)) return { ok: true, decisao: "ignorado" };

  let chat = await db.lerChat(args.sessaoId, args.chatId);
  // Conversa que ainda não existe no banco: quem cria é o próprio envio
  // (/chats/novo já a cria antes). Sem linha não há o que travar.
  if (!chat) return { ok: true, decisao: "ignorado" };

  const perms = { podeAssumir: args.podeAssumir, podeAssumirDeOutros: args.podeAssumirDeOutros };
  // 2 tentativas: se alguém assumiu entre a leitura e a escrita, decide de novo
  // com o estado novo (a segunda decisão costuma virar "bloquear").
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const d = decidirEnvio(chat, args.eu, perms);
    if (d.acao === "enviar") return { ok: true, decisao: "enviar" };
    if (d.acao === "bloquear") return emAtendimentoPor(db, d.responsavelId);
    if (d.acao === "sem_permissao") {
      return { ok: false, conflito: { error: MSG_SEM_PERMISSAO_ASSUMIR, motivo: "sem_permissao_assumir" } };
    }
    const r = await db.aplicar({
      chatRowId: chat.id,
      porId: args.eu.id,
      evento: d.evento,
      motivo: d.acao === "tomar" ? `Assumida por ${args.eu.nome}` : null,
      esperadoResp: chat.responsavelId,
      esperadoStatus: chat.atendimentoStatus,
      novoResp: args.eu.id,
    });
    if (r.ok) return { ok: true, decisao: d.acao };
    if (r.status === null) return { ok: true, decisao: "ignorado" }; // conversa sumiu
    chat = { id: chat.id, responsavelId: r.responsavelId, atendimentoStatus: r.status };
  }
  // Disputa que não assentou em 2 voltas. Só segue se a conversa ficou comigo e
  // em atendimento; com outra pessoa, o 409 de sempre; em qualquer outro estado
  // (livre, finalizada) pede para tentar de novo: nunca envia sem dono garantido.
  if (chat.responsavelId === args.eu.id && chat.atendimentoStatus === "em_atendimento") {
    return { ok: true, decisao: "enviar" };
  }
  if (chat.responsavelId && chat.atendimentoStatus === "em_atendimento") {
    return emAtendimentoPor(db, chat.responsavelId);
  }
  return { ok: false, conflito: { error: MSG_DISPUTA, motivo: "disputa" } };
}
