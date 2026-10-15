// O que a tela mostra e libera para cada situação de atendimento (estilo Blip).
// É só conforto de interface: quem barra de verdade é o servidor (Edge Function
// whatsapp → 409) e o banco (RPCs de atendimento). Mantém a mesma regra de
// `decidirEnvio` (_shared/whatsapp-atendimento.ts).

import type { WhatsappChat } from "@/lib/queries/whatsapp";

export type FaseAtendimento = "fila" | "em_atendimento" | "finalizado";

export type EstadoAtendimento = {
  fase: FaseAtendimento;
  /** Sou o responsável. */
  meu: boolean;
  /** Em atendimento por OUTRA pessoa. */
  deOutro: boolean;
  /** Pode enviar mensagem/reagir/editar/apagar/encaminhar agora (o envio assume ou reabre). */
  podeEnviar: boolean;
  /** Bloqueada para mim: só leitura + banner. */
  bloqueada: boolean;
  /** O envio vai assumir/reabrir a conversa (mostra a dica no campo). */
  enviarAssume: boolean;
  enviarReabre: boolean;
  /** Ação principal do cabeçalho. */
  principal: "assumir" | "tomar" | "finalizar" | "reabrir" | null;
  podeTransferir: boolean;
  podeFinalizar: boolean;
  podeTomar: boolean;
};

export function estadoAtendimento(
  chat: Pick<WhatsappChat, "responsavelId" | "atendimentoStatus"> | undefined,
  euId: string | null | undefined,
  tem: (p: string) => boolean,
  opts: { transferenciaAtiva?: boolean } = {},
): EstadoAtendimento {
  const finalizado = chat?.atendimentoStatus === "finalizado";
  const resp = chat?.responsavelId ?? null;
  const fase: FaseAtendimento = finalizado ? "finalizado" : resp ? "em_atendimento" : "fila";
  const meu = !!euId && resp === euId && !finalizado;
  const deOutro = !!resp && resp !== euId && !finalizado;
  const responder = tem("whatsapp.responder");
  const supervisor = tem("whatsapp.assumir_de_outros");
  const podeTomar = deOutro && supervisor && responder;
  // Supervisor também fica com o campo travado até tomar a conversa: enviar tomaria
  // (o servidor faz isso), mas a tela pede o clique explícito em "Assumir conversa".
  const podeEnviar = responder && !deOutro;
  // O botão chama a RPC, que exige assumir ou transferir (enviar assume sem isso).
  const podeAssumirLivre = responder && (tem("whatsapp.assumir") || tem("whatsapp.transferir"));

  let principal: EstadoAtendimento["principal"] = null;
  if (fase === "fila" && podeAssumirLivre) principal = "assumir";
  else if (fase === "finalizado" && podeAssumirLivre) principal = "reabrir";
  else if (meu) principal = "finalizar";
  else if (podeTomar) principal = "tomar";

  const transferenciaAtiva = opts.transferenciaAtiva ?? true;
  return {
    fase,
    meu,
    deOutro,
    podeEnviar,
    bloqueada: deOutro,
    enviarAssume: responder && fase === "fila",
    enviarReabre: responder && fase === "finalizado",
    principal,
    podeTransferir:
      transferenciaAtiva && tem("whatsapp.transferir") && fase !== "finalizado" && (fase === "fila" || meu || supervisor),
    podeFinalizar: fase !== "finalizado" && (meu || (supervisor && deOutro) || (fase === "fila" && responder)),
    podeTomar,
  };
}
