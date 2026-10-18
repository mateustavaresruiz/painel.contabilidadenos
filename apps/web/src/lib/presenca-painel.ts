// "Online agora" no perfil da equipe: presença do Supabase Realtime num canal
// só, `painel:online`. Cada aba aberta do painel anuncia { colaboradorId, desde }
// (sem nome, e-mail ou página) e escuta os outros. Nada vai para o banco: a
// entrada some quando a aba fecha ou a conexão cai.
//
// Um canal por aba, criado uma vez e nunca refeito: o supabase-js devolve o
// MESMO canal para o mesmo tópico enquanto o anterior ainda está saindo, e
// registrar presença num canal já inscrito dá erro (o StrictMode monta duas
// vezes). Trocar de pessoa ou sair só troca o que a aba anuncia.

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useSyncExternalStore } from "react";

import { supabase } from "@/lib/supabase";

type Entrada = { colaboradorId: string; desde: string };

let online = new Map<string, string>();
const ouvintes = new Set<() => void>();

let canal: RealtimeChannel | null = null;
let inscrito = false;
let anuncio: Entrada | null = null;
/** "Desde" da aba: não muda quando o efeito remonta para a mesma pessoa. */
let desdeDe: Entrada | null = null;

function publicar(estado: Record<string, Entrada[]>) {
  const m = new Map<string, string>();
  for (const lista of Object.values(estado)) {
    for (const p of lista) {
      if (!p?.colaboradorId) continue;
      const atual = m.get(p.colaboradorId);
      if (!atual || p.desde < atual) m.set(p.colaboradorId, p.desde);
    }
  }
  online = m;
  ouvintes.forEach((f) => f());
}

function garantirCanal(): RealtimeChannel {
  if (canal) return canal;
  const c = supabase.channel("painel:online", { config: { presence: { key: crypto.randomUUID() } } });
  canal = c;
  c.on("presence", { event: "sync" }, () => publicar(c.presenceState<Entrada>() as unknown as Record<string, Entrada[]>)).subscribe(
    (status) => {
      inscrito = status === "SUBSCRIBED";
      // Inscreveu (ou reconectou): anuncia de novo.
      if (inscrito && anuncio) void c.track(anuncio);
    },
  );
  return c;
}

/** Anuncia a pessoa logada enquanto o painel estiver aberto. Chamar uma vez (AppLayout). */
export function useAnunciarPresencaPainel(euId: string | null | undefined) {
  useEffect(() => {
    if (!euId) return;
    const c = garantirCanal();
    if (desdeDe?.colaboradorId !== euId) desdeDe = { colaboradorId: euId, desde: new Date().toISOString() };
    anuncio = desdeDe;
    if (inscrito) void c.track(anuncio);
    // Saiu do painel (logout desmonta o layout) ou trocou de pessoa: para de anunciar.
    return () => {
      anuncio = null;
      if (inscrito) void c.untrack();
    };
  }, [euId]);
}

function assinar(f: () => void) {
  ouvintes.add(f);
  return () => {
    ouvintes.delete(f);
  };
}

/** Desde quando a pessoa está com o painel aberto (ISO), ou null se não está. */
export function useOnlineAgora(colaboradorId: string | null | undefined): string | null {
  return useSyncExternalStore(assinar, () => (colaboradorId ? (online.get(colaboradorId) ?? null) : null));
}
