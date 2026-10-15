// Regra de atendimento no estilo Blip, aplicada no SERVIDOR antes de qualquer
// envio (texto, mídia, encaminhar, reagir, editar, apagar, enquete).
//
//   Na fila (sem responsável) ──enviar/assumir──▶ Em atendimento (responsável)
//   Em atendimento ──finalizar──▶ Finalizado ──enviar──▶ Em atendimento (quem enviou)
//   Finalizado ──mensagem do cliente──▶ Na fila (webhook, ver migration 007)
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
  | { acao: "bloquear"; responsavelId: string };

/**
 * O que fazer quando `eu` quer mexer (enviar/reagir/editar/apagar) numa conversa.
 *  - sem conversa ainda ........ assumir (a conversa nasce já com o remetente)
 *  - finalizada ................ reabrir em nome de quem enviou (novo ticket)
 *  - sem responsável ........... assumir
 *  - responsável sou eu ........ só enviar
 *  - responsável é outra pessoa  com `assumir_de_outros`: toma a conversa (e
 *                                 registra); sem a permissão: bloqueia.
 */
export function decidirEnvio(
  chat: ChatAtendimento | null,
  eu: Eu,
  podeAssumirDeOutros: boolean,
): Decisao {
  if (!chat) return { acao: "assumir", evento: "assumiu" };
  if (chat.atendimentoStatus === "finalizado") return { acao: "reabrir", evento: "reabriu" };
  if (!chat.responsavelId) return { acao: "assumir", evento: "assumiu" };
  if (chat.responsavelId === eu.id) return { acao: "enviar" };
  if (podeAssumirDeOutros) return { acao: "tomar", evento: "tomou", deId: chat.responsavelId };
  return { acao: "bloquear", responsavelId: chat.responsavelId };
}

/** Corpo do 409 que a tela entende (`motivo: "em_atendimento"`). */
export type ConflitoAtendimento = {
  error: string;
  motivo: "em_atendimento";
  responsavel: { id: string; nome: string };
};

export type ResultadoAtendimento =
  | { ok: true; decisao: Decisao["acao"] | "ignorado" }
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

export async function garantirAtendimento(
  db: AtendimentoDb,
  args: { sessaoId: string; chatId: string; eu: Eu; podeAssumirDeOutros: boolean },
): Promise<ResultadoAtendimento> {
  if (ehGrupo(args.chatId)) return { ok: true, decisao: "ignorado" };

  let chat = await db.lerChat(args.sessaoId, args.chatId);
  // Conversa que ainda não existe no banco: quem cria é o próprio envio
  // (/chats/novo já a cria antes). Sem linha não há o que travar.
  if (!chat) return { ok: true, decisao: "ignorado" };

  // 2 tentativas: se alguém assumiu entre a leitura e a escrita, decide de novo
  // com o estado novo (a segunda decisão costuma virar "bloquear").
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const d = decidirEnvio(chat, args.eu, args.podeAssumirDeOutros);
    if (d.acao === "enviar") return { ok: true, decisao: "enviar" };
    if (d.acao === "bloquear") {
      const nome = (await db.nomeColaborador(d.responsavelId)) ?? "outra pessoa";
      return {
        ok: false,
        conflito: {
          error: `Conversa em atendimento por ${nome}`,
          motivo: "em_atendimento",
          responsavel: { id: d.responsavelId, nome },
        },
      };
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
  // Disputa que não assentou em 2 voltas: trata como ocupada, o usuário tenta de novo.
  const resp = chat.responsavelId;
  if (resp && resp !== args.eu.id) {
    const nome = (await db.nomeColaborador(resp)) ?? "outra pessoa";
    return {
      ok: false,
      conflito: {
        error: `Conversa em atendimento por ${nome}`,
        motivo: "em_atendimento",
        responsavel: { id: resp, nome },
      },
    };
  }
  return { ok: true, decisao: "enviar" };
}
