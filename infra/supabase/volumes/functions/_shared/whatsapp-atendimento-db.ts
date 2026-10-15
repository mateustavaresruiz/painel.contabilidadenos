// Implementação da regra de atendimento sobre o Supabase (service role).
// Separada de `whatsapp-atendimento.ts` para a regra poder ser testada sem
// variáveis de ambiente nem banco.

import { supabaseAdmin, TENANT_ID } from "./supabase.ts";
import type { AtendimentoDb, AtendimentoStatus } from "./whatsapp-atendimento.ts";

export const atendimentoDb: AtendimentoDb = {
  async lerChat(sessaoId, chatId) {
    const { data, error } = await supabaseAdmin
      .from("WhatsappChat")
      .select("id, responsavelId, atendimentoStatus")
      .eq("tenantId", TENANT_ID)
      .eq("sessaoId", sessaoId)
      .eq("chatId", chatId)
      .maybeSingle();
    if (error) throw new Error(`ler atendimento: ${error.message}`);
    return data
      ? {
        id: data.id as string,
        responsavelId: (data.responsavelId as string | null) ?? null,
        atendimentoStatus: data.atendimentoStatus as AtendimentoStatus,
      }
      : null;
  },

  async aplicar(a) {
    const { data, error } = await supabaseAdmin.rpc("atendimento_aplicar", {
      p_chat: a.chatRowId,
      p_por: a.porId,
      p_evento: a.evento,
      p_motivo: a.motivo,
      p_esperado_resp: a.esperadoResp,
      p_esperado_status: a.esperadoStatus,
      p_novo_resp: a.novoResp,
      p_novo_status: "em_atendimento",
    });
    if (error) throw new Error(`atendimento_aplicar: ${error.message}`);
    const r = data as {
      ok: boolean;
      motivo?: string;
      responsavelId?: string | null;
      status?: AtendimentoStatus;
    };
    if (r.ok) return { ok: true };
    return {
      ok: false,
      responsavelId: r.responsavelId ?? null,
      status: r.motivo === "sem_conversa" ? null : (r.status ?? null),
    };
  },

  async nomeColaborador(id) {
    const { data } = await supabaseAdmin
      .from("Colaborador")
      .select("nome")
      .eq("tenantId", TENANT_ID)
      .eq("id", id)
      .maybeSingle();
    return (data?.nome as string | undefined) ?? null;
  },
};
