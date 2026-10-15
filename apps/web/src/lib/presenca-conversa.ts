// "Quem está na conversa": presença do Supabase Realtime no canal público
// `chat:<id da linha do WhatsappChat>`. Cada aba que abre a conversa anuncia
// { colaboradorId, nome, cor, desde } e escuta os outros. Nada vai para o
// banco: a presença some sozinha quando a pessoa troca de conversa, fecha a
// aba ou perde a conexão (o Realtime derruba a entrada).

import { useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";

export type PresencaConversa = {
  colaboradorId: string;
  nome: string;
  cor: string;
  desde: string;
};

/** Junta as abas da mesma pessoa numa entrada só (a mais antiga) e tira a minha. */
export function outrosNaConversa(
  estado: Record<string, PresencaConversa[]>,
  euId: string | null | undefined,
): PresencaConversa[] {
  const porPessoa = new Map<string, PresencaConversa>();
  for (const lista of Object.values(estado)) {
    for (const p of lista) {
      if (!p?.colaboradorId || p.colaboradorId === euId) continue;
      const atual = porPessoa.get(p.colaboradorId);
      if (!atual || p.desde < atual.desde) porPessoa.set(p.colaboradorId, p);
    }
  }
  return [...porPessoa.values()].sort((a, b) => a.desde.localeCompare(b.desde));
}

export function usePresencaConversa(
  chatRowId: string | undefined,
  eu: { id: string; nome: string; cor: string } | null | undefined,
): PresencaConversa[] {
  const [estado, setEstado] = useState<Record<string, PresencaConversa[]>>({});
  const euId = eu?.id;
  const euNome = eu?.nome;
  const euCor = eu?.cor;
  // "Desde" é fixo por abertura da conversa, não por re-render.
  const desdeRef = useRef<string>(new Date().toISOString());

  useEffect(() => {
    if (!chatRowId || !euId) {
      setEstado({});
      return;
    }
    desdeRef.current = new Date().toISOString();
    const channel = supabase.channel(`chat:${chatRowId}`, {
      config: { presence: { key: `${euId}:${crypto.randomUUID()}` } },
    });
    const sync = () =>
      setEstado(channel.presenceState<PresencaConversa>() as unknown as Record<string, PresencaConversa[]>);
    channel
      .on("presence", { event: "sync" }, sync)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.track({
            colaboradorId: euId,
            nome: euNome ?? "Alguém",
            cor: euCor ?? "#64748b",
            desde: desdeRef.current,
          } satisfies PresencaConversa);
        }
      });
    return () => {
      setEstado({});
      void channel.untrack().finally(() => void supabase.removeChannel(channel));
    };
  }, [chatRowId, euId, euNome, euCor]);

  return useMemo(() => outrosNaConversa(estado, euId), [estado, euId]);
}
