// "Quem está na conversa": presença do Supabase Realtime no canal público
// `chat:<id da linha do WhatsappChat>`. Cada aba que abre a conversa anuncia
// { colaboradorId, nome, cor, desde } e escuta os outros. Nada vai para o
// banco: a presença some sozinha quando a pessoa troca de conversa, fecha a
// aba ou perde a conexão (o Realtime derruba a entrada).

import { useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";

/**
 * Saída em curso por tópico. O tópico da presença PRECISA ser o mesmo para
 * todos (é por ele que um vê o outro), e o supabase-js devolve o canal
 * existente para o mesmo tópico, inclusive um que ainda está saindo: voltar
 * para a conversa antes de a saída terminar reassinava um canal morto, sem
 * erro e sem presença. A entrada nova espera a saída anterior acabar.
 */
const saindo = new Map<string, Promise<void>>();

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
    const topico = `chat:${chatRowId}`;
    let cancelado = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    void (saindo.get(topico) ?? Promise.resolve()).then(() => {
      if (cancelado) return;
      const c = supabase.channel(topico, {
        config: { presence: { key: `${euId}:${crypto.randomUUID()}` } },
      });
      channel = c;
      const sync = () =>
        setEstado(c.presenceState<PresencaConversa>() as unknown as Record<string, PresencaConversa[]>);
      c.on("presence", { event: "sync" }, sync).subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void c.track({
            colaboradorId: euId,
            nome: euNome ?? "Alguém",
            cor: euCor ?? "#64748b",
            desde: desdeRef.current,
          } satisfies PresencaConversa);
        }
      });
    });
    return () => {
      cancelado = true;
      setEstado({});
      const c = channel;
      if (!c) return;
      const saida: Promise<void> = c
        .untrack()
        .catch(() => undefined)
        .then(() => supabase.removeChannel(c))
        .then(
          () => undefined,
          () => undefined,
        )
        .finally(() => {
          if (saindo.get(topico) === saida) saindo.delete(topico);
        });
      saindo.set(topico, saida);
    };
  }, [chatRowId, euId, euNome, euCor]);

  return useMemo(() => outrosNaConversa(estado, euId), [estado, euId]);
}
