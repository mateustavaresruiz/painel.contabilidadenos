// Atendimento no estilo Blip (migration 007): Na fila → Em atendimento →
// Finalizado. Quem muda o responsável é a RPC `transferir_atendimento` (assumir,
// tomar, transferir, devolver, reabrir) e quem finaliza é `finalizar_atendimento`;
// as duas conferem as regras no banco e gravam o histórico. Enviar numa conversa
// livre assume no servidor (Edge Function whatsapp), então aqui não há cálculo.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ErroDaApi } from "@/lib/api";
import { useRealtimeInvalidate } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";
import type { AtendimentoStatus, WhatsappChat } from "@/lib/queries/whatsapp";

const CHAT_SELECT = [
  "id", "sessaoId", "chatId", "tipo", "nome", "sobre", "fotoPath", "clienteId",
  "ultimaMensagemTexto", "ultimaMensagemEm", "ultimaMensagemFromMe", "naoLidas",
  "arquivado", "fixado", "podeEnviar", "motivoBloqueio",
  "presenceEstado", "presenceEm", "ultimoVistoEm", "responsavelId", "atendimentoStatus",
  "atendimentoEm", "apagadoEm", "atualizadoEm",
].join(",");

/**
 * A conversa ABERTA, buscada pelo par sessão + chatId — independente da lista.
 * No adv3 ela era procurada entre as 50 primeiras não arquivadas, e abrir uma
 * arquivada ou um resultado de busca ficava sem registro (defeito 6).
 */
export function useWhatsappChatAberto(sessaoId: string | undefined, chatId: string | undefined) {
  const ligado = !!sessaoId && !!chatId;
  useRealtimeInvalidate(
    "WhatsappChat",
    [["whatsapp-chat", sessaoId ?? "", chatId ?? ""]],
    { column: "tenantId", value: "denos" },
    ligado,
  );
  return useQuery({
    queryKey: ["whatsapp-chat", sessaoId ?? "", chatId ?? ""],
    enabled: ligado,
    staleTime: 5_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("WhatsappChat")
        .select(CHAT_SELECT)
        .eq("sessaoId", sessaoId!)
        .eq("chatId", chatId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as WhatsappChat | null;
    },
  });
}

/** Aplica um patch otimista na conversa em TODAS as caches (lista e aberta). */
function patchConversa(
  qc: ReturnType<typeof useQueryClient>,
  chatRowId: string,
  patch: Partial<WhatsappChat>,
) {
  const listas = qc.getQueriesData<WhatsappChat[]>({ queryKey: ["whatsapp-chats"] });
  for (const [key, data] of listas) {
    if (!Array.isArray(data)) continue;
    qc.setQueryData<WhatsappChat[]>(
      key,
      data.map((c) => (c.id === chatRowId ? { ...c, ...patch } : c)),
    );
  }
  const abertas = qc.getQueriesData<WhatsappChat | null>({ queryKey: ["whatsapp-chat"] });
  for (const [key, data] of abertas) {
    if (data && data.id === chatRowId) qc.setQueryData(key, { ...data, ...patch });
  }
  return [...listas, ...abertas] as Array<[readonly unknown[], unknown]>;
}

function restaurar(
  qc: ReturnType<typeof useQueryClient>,
  snaps: Array<[readonly unknown[], unknown]> | undefined,
) {
  for (const [key, data] of snaps ?? []) qc.setQueryData(key, data);
}

function invalidarConversa(qc: ReturnType<typeof useQueryClient>, chatRowId: string) {
  qc.invalidateQueries({ queryKey: ["whatsapp-chats"] });
  qc.invalidateQueries({ queryKey: ["whatsapp-chat"] });
  qc.invalidateQueries({ queryKey: ["atendimento-transferencias", chatRowId] });
  qc.invalidateQueries({ queryKey: ["inicio"] });
}

/**
 * Transfere (ou assume, quando `paraId === porId`) o atendimento.
 * `paraId: null` devolve a conversa para a fila (sem responsável).
 */
export function useTransferirAtendimento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      chatRowId: string;
      paraId: string | null;
      porId: string | null;
      motivo?: string | null;
    }) => {
      const { error } = await supabase.rpc("transferir_atendimento", {
        p_chat: args.chatRowId,
        p_para: args.paraId,
        p_por: args.porId,
        p_motivo: args.motivo ?? null,
      });
      if (error) throw error;
    },
    onMutate: async (args) => {
      await qc.cancelQueries({ queryKey: ["whatsapp-chats"] });
      await qc.cancelQueries({ queryKey: ["whatsapp-chat"] });
      const snaps = patchConversa(qc, args.chatRowId, {
        responsavelId: args.paraId,
        atendimentoStatus: args.paraId ? "em_atendimento" : "aberto",
        atendimentoEm: new Date().toISOString(),
      });
      return { snaps };
    },
    onError: (_e, _a, ctx) => restaurar(qc, ctx?.snaps),
    onSettled: (_d, _e, args) => invalidarConversa(qc, args.chatRowId),
  });
}

/** Finalizar: só quem está com a conversa (ou supervisor) — a RPC confere e grava o histórico. */
export function useFinalizarAtendimento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { chatRowId: string; motivo?: string | null }) => {
      const { error } = await supabase.rpc("finalizar_atendimento", {
        p_chat: args.chatRowId,
        p_por: null,
        p_motivo: args.motivo ?? null,
      });
      if (error) throw error;
    },
    onMutate: async (args) => {
      await qc.cancelQueries({ queryKey: ["whatsapp-chats"] });
      await qc.cancelQueries({ queryKey: ["whatsapp-chat"] });
      const snaps = patchConversa(qc, args.chatRowId, {
        atendimentoStatus: "finalizado",
        atendimentoEm: new Date().toISOString(),
      });
      return { snaps };
    },
    onError: (_e, _a, ctx) => restaurar(qc, ctx?.snaps),
    onSettled: (_d, _e, args) => invalidarConversa(qc, args.chatRowId),
  });
}

/**
 * 409 do servidor: a conversa está em atendimento por outra pessoa. A tela
 * mostra um aviso amigável e recarrega a conversa (o banner de bloqueio
 * aparece sozinho com o responsável novo).
 */
export function ehConflitoAtendimento(err: unknown): err is ErroDaApi {
  return err instanceof ErroDaApi && err.status === 409 && err.dados?.motivo === "em_atendimento";
}

export function conflitoAtendimentoMsg(err: ErroDaApi): string {
  const nome = (err.dados?.responsavel as { nome?: string } | undefined)?.nome;
  return nome
    ? `Esta conversa está em atendimento por ${nome}. Só ela(e) pode responder.`
    : "Esta conversa está em atendimento por outra pessoa.";
}

export function tratarConflitoAtendimento(qc: ReturnType<typeof useQueryClient>, err: ErroDaApi) {
  qc.invalidateQueries({ queryKey: ["whatsapp-chat"] });
  qc.invalidateQueries({ queryKey: ["whatsapp-chats"] });
  qc.invalidateQueries({ queryKey: ["atendimento-transferencias"] });
  return conflitoAtendimentoMsg(err);
}

export type EventoAtendimento =
  | "assumiu"
  | "tomou"
  | "transferiu"
  | "devolveu"
  | "finalizou"
  | "reabriu"
  | "fila";

export type AtendimentoTransferencia = {
  id: string;
  chatId: string;
  deId: string | null;
  paraId: string | null;
  porId: string | null;
  motivo: string | null;
  /** Tipo do registro (migration 007). Linhas antigas vêm nulas. */
  evento: EventoAtendimento | null;
  criadoEm: string;
};

/** Histórico de transferências da conversa (mais antiga primeiro). */
export function useTransferencias(chatRowId: string | undefined) {
  // Toda transferência muda a linha do WhatsappChat (responsável), que está
  // na publicação do Realtime — é por ela que o histórico se atualiza para
  // quem está com a conversa aberta em outro computador.
  useRealtimeInvalidate(
    "WhatsappChat",
    [["atendimento-transferencias", chatRowId ?? ""]],
    { column: "tenantId", value: "denos" },
    !!chatRowId,
  );
  return useQuery({
    queryKey: ["atendimento-transferencias", chatRowId ?? ""],
    enabled: !!chatRowId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("AtendimentoTransferencia")
        .select("*")
        .eq("chatId", chatRowId!)
        .order("criadoEm", { ascending: true })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as AtendimentoTransferencia[];
    },
  });
}

export const ATENDIMENTO_LABEL: Record<AtendimentoStatus, string> = {
  aberto: "Na fila",
  em_atendimento: "Em atendimento",
  finalizado: "Finalizado",
};
