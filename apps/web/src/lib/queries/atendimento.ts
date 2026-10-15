// Atendimento (novo no painel Denos): responsável por conversa, assumir,
// finalizar e transferir. Quem muda o responsável é a RPC
// `transferir_atendimento`, que troca e registra numa transação só.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
    if (!data) continue;
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

/** Muda só o status (finalizar / reabrir). Escrita direta: a RLS libera a coluna. */
export function useMudarStatusAtendimento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { chatRowId: string; status: AtendimentoStatus }) => {
      const agora = new Date().toISOString();
      const { error } = await supabase
        .from("WhatsappChat")
        .update({ atendimentoStatus: args.status, atendimentoEm: agora, atualizadoEm: agora })
        .eq("id", args.chatRowId);
      if (error) throw error;
    },
    onMutate: async (args) => {
      await qc.cancelQueries({ queryKey: ["whatsapp-chats"] });
      await qc.cancelQueries({ queryKey: ["whatsapp-chat"] });
      const snaps = patchConversa(qc, args.chatRowId, {
        atendimentoStatus: args.status,
        atendimentoEm: new Date().toISOString(),
      });
      return { snaps };
    },
    onError: (_e, _a, ctx) => restaurar(qc, ctx?.snaps),
    onSettled: (_d, _e, args) => invalidarConversa(qc, args.chatRowId),
  });
}

export type AtendimentoTransferencia = {
  id: string;
  chatId: string;
  deId: string | null;
  paraId: string | null;
  porId: string | null;
  motivo: string | null;
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
  aberto: "Aberto",
  em_atendimento: "Em atendimento",
  finalizado: "Finalizado",
};
