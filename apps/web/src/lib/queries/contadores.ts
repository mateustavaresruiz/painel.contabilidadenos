import { useQuery } from "@tanstack/react-query";

import { useEu } from "@/lib/colaborador";
import { useRealtimeInvalidate } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";
import { hojeISO } from "@/lib/format";

/**
 * Contadores do menu lateral. Só `count` com `head: true` (nenhuma linha
 * trafega), cache de 60 s e sem polling: atualizam pelo Realtime (conversas)
 * ou pelas invalidações que as mutations de chamados já fazem em
 * ["solicitacoes"].
 */

/** Conversas com mensagem não lida que a pessoa enxerga (a RLS decide quais). */
export function useContadorWhatsapp(enabled: boolean) {
  // Mesmo canal (tabela + filtro) da lista de conversas: o Realtime compartilha.
  useRealtimeInvalidate("WhatsappChat", [["whatsapp-chats", "contador"]], { column: "tenantId", value: "denos" }, enabled);
  return useQuery({
    queryKey: ["whatsapp-chats", "contador"],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("WhatsappChat")
        .select("id", { count: "exact", head: true })
        .eq("arquivado", false)
        .is("apagadoEm", null)
        .gt("naoLidas", 0);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

/** Chamados abertos atribuídos a mim + chamados atrasados (prazo vencido). */
export function useContadorChamados(enabled: boolean) {
  const { euId } = useEu();
  return useQuery({
    queryKey: ["solicitacoes", "contador", euId],
    enabled: enabled && !!euId,
    staleTime: 60_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("Solicitacao")
        .select("id", { count: "exact", head: true })
        .in("status", ["aberta", "em_andamento"])
        .or(`responsavelId.eq.${euId},prazo.lt.${hojeISO()}`);
      if (error) throw error;
      return count ?? 0;
    },
  });
}
