// "Quem é você?" — substitui o login do adv3 (decisão do dono: sem login por
// enquanto). Cada computador escolhe um Colaborador da lista; o id fica no
// localStorage e vai em toda chamada às Edge Functions (`x-colaborador-id`).
//
// 🔴 Isto é IDENTIFICAÇÃO, não autenticação: quem abre o painel pode se dizer
// qualquer um. A proteção de acesso hoje é a senha do domínio no Easypanel.
// Quando o login vier, `Colaborador.userId` amarra a pessoa ao auth.users e
// este contexto passa a ler o colaborador do usuário logado.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { supabase } from "@/lib/supabase";

export type Colaborador = {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  cor: string;
  cargo: string | null;
  ativo: boolean;
  /** 'admin' vê Configurações (portão de tela, sem login: ver lib/modulos.ts). */
  papel: "admin" | "atendente";
  criadoEm: string;
  atualizadoEm: string;
};

const CHAVE = "denos:colaboradorId";

/** Lido pelo `api()` fora do React. Mantido em sincronia pelo provider. */
let colaboradorAtualId: string | null = lerSalvo();

function lerSalvo(): string | null {
  try {
    return localStorage.getItem(CHAVE);
  } catch {
    return null;
  }
}

export function getColaboradorAtualId(): string | null {
  return colaboradorAtualId;
}

/** Todos os colaboradores (ativos e inativos), por nome. */
export function useColaboradores() {
  return useQuery({
    queryKey: ["colaboradores"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Colaborador")
        .select("*")
        .order("nome", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Colaborador[];
    },
    staleTime: 60_000,
  });
}

/** Mapa id → colaborador, pra exibir responsável/autor sem join. */
export function useColaboradoresMap() {
  const { data } = useColaboradores();
  return useMemo(() => {
    const m = new Map<string, Colaborador>();
    for (const c of data ?? []) m.set(c.id, c);
    return m;
  }, [data]);
}

type Ctx = {
  /** Colaborador escolhido neste computador (null = ainda não escolheu). */
  eu: Colaborador | null;
  euId: string | null;
  carregando: boolean;
  escolher: (id: string | null) => void;
};

const ColaboradorContext = createContext<Ctx | null>(null);

export function ColaboradorProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data: lista, isLoading } = useColaboradores();
  const [euId, setEuId] = useState<string | null>(colaboradorAtualId);

  const escolher = useCallback(
    (id: string | null) => {
      colaboradorAtualId = id;
      try {
        if (id) localStorage.setItem(CHAVE, id);
        else localStorage.removeItem(CHAVE);
      } catch {
        /* navegador sem storage: vale só nesta aba */
      }
      setEuId(id);
      // Filtros "Minhas" e afins dependem de quem sou eu.
      void qc.invalidateQueries({ queryKey: ["whatsapp-chats"] });
    },
    [qc],
  );

  const eu = useMemo(
    () => (euId ? (lista ?? []).find((c) => c.id === euId) ?? null : null),
    [lista, euId],
  );

  // O colaborador salvo foi apagado ou desativado: pede de novo.
  useEffect(() => {
    if (isLoading || !lista || !euId) return;
    const achado = lista.find((c) => c.id === euId);
    if (!achado || !achado.ativo) escolher(null);
  }, [isLoading, lista, euId, escolher]);

  const valor = useMemo<Ctx>(
    () => ({ eu, euId: eu?.id ?? null, carregando: isLoading, escolher }),
    [eu, isLoading, escolher],
  );

  return (
    <ColaboradorContext.Provider value={valor}>{children}</ColaboradorContext.Provider>
  );
}

export function useEu(): Ctx {
  const ctx = useContext(ColaboradorContext);
  if (!ctx) throw new Error("useEu fora do ColaboradorProvider");
  return ctx;
}

/** Paleta das cores de colaborador (avatar de iniciais). */
export const CORES_COLABORADOR = [
  "#1D3B6F", "#2563eb", "#0891b2", "#059669", "#65a30d",
  "#CE9350", "#d97706", "#dc2626", "#db2777", "#7c3aed",
];
