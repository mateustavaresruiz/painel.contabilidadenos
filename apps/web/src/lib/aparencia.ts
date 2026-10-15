// Estilo visual do painel (Config 'aparencia.estilo'): "A" = Marinho (menu
// escuro), "B" = Claro e colorido. Vale para todo o escritório; só quem tem
// configuracoes.gerenciar grava (RLS). Sem a chave, vale "A".

import { useEffect } from "react";

import { useConfig, useSalvarConfig } from "@/lib/queries/certificados";

export type Estilo = "A" | "B";
export const CONFIG_ESTILO = "aparencia.estilo";

export function useEstilo(): Estilo {
  const { data } = useConfig<unknown>(CONFIG_ESTILO, "A");
  return data === "B" ? "B" : "A";
}

export function useSalvarEstilo() {
  const salvar = useSalvarConfig();
  return {
    salvar: (e: Estilo) => salvar.mutateAsync([{ chave: CONFIG_ESTILO, valor: e }]),
    pendente: salvar.isPending,
  };
}

/** Espelha o estilo em <html data-estilo> (os tokens do menu dependem dele). */
export function useAplicarEstilo() {
  const estilo = useEstilo();
  useEffect(() => {
    document.documentElement.dataset.estilo = estilo;
  }, [estilo]);
  return estilo;
}
