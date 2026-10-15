// Etiquetas de conversa do WhatsApp (CRM-lite). Diferente das tabelas do agente
// (blindadas via Edge/RPC), aqui o front fala DIRETO com o banco via supabase-js
// + RLS — é dado do escritório, não segredo. Ver migration 202.
//
// Quem tem whatsapp.responder cria, apaga e etiqueta (RLS, migration 005).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";

export type TagCor = "primary" | "success" | "warning" | "destructive" | "muted";

export type WhatsappTag = {
  id: string;
  label: string;
  cor: TagCor;
};

// Classes por cor — tokens do design, nunca hex cru (tema-safe).
// ⚠️ LITERAIS de propósito: o Tailwind só compila a classe que ele VÊ no fonte.
// Montar "bg-" + cor em runtime gera classe que não existe no CSS.
export const TAG_CLASSES: Record<TagCor, string> = {
  primary: "bg-primary/10 text-primary border-primary/20",
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/10 text-warning border-warning/20",
  destructive: "bg-destructive/10 text-destructive border-destructive/20",
  muted: "bg-muted text-muted-foreground border-border/60",
};

/** Bolinha sólida da cor (seletor/lista) — também literal, mesmo motivo. */
export const TAG_DOT: Record<TagCor, string> = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  muted: "bg-muted-foreground",
};

export const TAG_CORES: TagCor[] = ["primary", "success", "warning", "destructive", "muted"];

/** Etiquetas do escritório. */
export function useTags() {
  return useQuery({
    queryKey: ["whatsapp-tags"],
    queryFn: async (): Promise<WhatsappTag[]> => {
      const { data, error } = await supabase
        .from("WhatsappTag")
        .select("id,label,cor")
        .order("label");
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: String(r.id),
        label: String(r.label),
        cor: (r.cor as TagCor) ?? "primary",
      }));
    },
  });
}

/** Vínculos conversa↔etiqueta do escritório (1 query pra pintar a lista toda). */
export function useChatTagLinks() {
  return useQuery({
    queryKey: ["whatsapp-chat-tags"],
    queryFn: async (): Promise<{ chatId: string; tagId: string }[]> => {
      const { data, error } = await supabase.from("WhatsappChatTag").select("chatId,tagId");
      if (error) throw error;
      return (data ?? []).map((r) => ({ chatId: String(r.chatId), tagId: String(r.tagId) }));
    },
  });
}

/** Cria uma etiqueta (qualquer colaborador). */
export function useCriarTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { label: string; cor: TagCor }) => {
      const { error } = await supabase.from("WhatsappTag").insert({
        label: input.label,
        cor: input.cor,
      });
      // 23505 = unique (tenantId, lower(label)) — etiqueta repetida.
      if (error) {
        throw error.code === "23505" ? new Error("Já existe uma etiqueta com esse nome.") : error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["whatsapp-tags"] }),
  });
}

/** Apaga uma etiqueta (qualquer colaborador). Some das conversas via cascade. */
export function useExcluirTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("WhatsappTag").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp-tags"] });
      qc.invalidateQueries({ queryKey: ["whatsapp-chat-tags"] });
    },
  });
}

/** Aplica/remove uma etiqueta numa conversa (qualquer membro do escritório). */
export function useToggleChatTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { chatId: string; tagId: string; aplicar: boolean }) => {
      if (input.aplicar) {
        const { error } = await supabase.from("WhatsappChatTag").insert({
          chatId: input.chatId,
          tagId: input.tagId,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("WhatsappChatTag")
          .delete()
          .eq("chatId", input.chatId)
          .eq("tagId", input.tagId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["whatsapp-chat-tags"] });
      void qc.invalidateQueries({ queryKey: ["historico", "conversa"] });
    },
  });
}
