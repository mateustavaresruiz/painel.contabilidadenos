// Sessão (login por e-mail, docs/LOGIN.md) e o colaborador logado.
//
// Quem é a pessoa sai do Auth: o usuário logado (auth.uid()) é amarrado ao
// Colaborador por "userId". O que ela pode fazer vem do CARGO dele
// (lib/permissoes.ts). Esconder botão aqui é conforto; quem barra de verdade
// é a RLS do banco e as Edge Functions.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { TODAS_PERMISSOES } from "@/lib/permissoes";
import { useRealtimeInvalidate } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";

export type Colaborador = {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  cor: string;
  cargoId: string;
  /** Nome do cargo (vem do join com Cargo). */
  cargo: string | null;
  ativo: boolean;
  userId: string | null;
  criadoEm: string;
  atualizadoEm: string;
};

export type Cargo = {
  id: string;
  nome: string;
  descricao: string | null;
  permissoes: string[];
  /** Administrador: todas as permissões, não se edita nem se apaga. */
  sistema: boolean;
};

type ColaboradorDoBanco = Omit<Colaborador, "cargo"> & { Cargo: { nome: string } | null };

function doBanco(c: ColaboradorDoBanco): Colaborador {
  const { Cargo: cargo, ...resto } = c;
  return { ...resto, cargo: cargo?.nome ?? null };
}

/** Todos os colaboradores (ativos e inativos), por nome. */
export function useColaboradores() {
  return useQuery({
    queryKey: ["colaboradores"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Colaborador")
        .select("*, Cargo(nome)")
        .order("nome", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as ColaboradorDoBanco[]).map(doBanco);
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
  /** undefined = ainda lendo a sessão guardada; null = sem login. */
  sessao: Session | null | undefined;
  /** Colaborador do usuário logado (null = sem acesso liberado ou carregando). */
  eu: Colaborador | null;
  euId: string | null;
  cargo: Cargo | null;
  /** Lendo sessão ou colaborador. */
  carregando: boolean;
  /** A leitura do colaborador falhou (rede/5xx): não é "sem acesso". */
  erroSessao: boolean;
  tentarSessaoDeNovo: () => void;
  permissoes: ReadonlySet<string>;
  tem: (p: string) => boolean;
  sair: () => Promise<void>;
};

const ColaboradorContext = createContext<Ctx | null>(null);

export function ColaboradorProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [sessao, setSessao] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    let vivo = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (vivo) setSessao(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((evento, s) => {
      setSessao(s);
      // Outra pessoa pode entrar no mesmo navegador: nada do cache anterior fica.
      if (evento === "SIGNED_OUT") qc.clear();
    });
    return () => {
      vivo = false;
      sub.subscription.unsubscribe();
    };
  }, [qc]);

  const userId = sessao?.user.id ?? null;
  const euQuery = useQuery({
    queryKey: ["eu", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Colaborador")
        .select("*, Cargo(id, nome, descricao, permissoes, sistema)")
        .eq("userId", userId!)
        .maybeSingle();
      if (error) throw error;
      if (!data || !data.ativo) return null;
      const { Cargo: cargo, ...resto } = data as Omit<Colaborador, "cargo"> & { Cargo: Cargo | null };
      return { eu: { ...resto, cargo: cargo?.nome ?? null } as Colaborador, cargo };
    },
    staleTime: 5 * 60_000,
    meta: { silencioso: true },
  });

  // Troca de cargo ou desativação vale na hora, sem recarregar.
  useRealtimeInvalidate("Colaborador", [["eu"], ["colaboradores"]], undefined, !!euQuery.data);
  useRealtimeInvalidate("Cargo", [["eu"], ["cargos"], ["colaboradores"]], undefined, !!euQuery.data);

  const cargo = euQuery.data?.cargo ?? null;
  const permissoes = useMemo<ReadonlySet<string>>(
    () => new Set(cargo?.sistema ? TODAS_PERMISSOES : (cargo?.permissoes ?? [])),
    [cargo],
  );
  const tem = useCallback((p: string) => permissoes.has(p), [permissoes]);

  // "Sair" encerra só ESTE navegador (scope local). O padrão do supabase-js é
  // global e derrubaria a pessoa no celular e em qualquer outro computador.
  const sair = useCallback(async () => {
    await supabase.auth.signOut({ scope: "local" });
    qc.clear();
  }, [qc]);

  const eu = euQuery.data?.eu ?? null;
  const carregando = sessao === undefined || (!!userId && euQuery.isLoading);
  const erroSessao = !!userId && euQuery.isError && !euQuery.data;
  const refetchEu = euQuery.refetch;
  const tentarSessaoDeNovo = useCallback(() => void refetchEu(), [refetchEu]);
  const valor = useMemo<Ctx>(
    () => ({ sessao, eu, euId: eu?.id ?? null, cargo, carregando, erroSessao, tentarSessaoDeNovo, permissoes, tem, sair }),
    [sessao, eu, cargo, carregando, erroSessao, tentarSessaoDeNovo, permissoes, tem, sair],
  );

  return <ColaboradorContext.Provider value={valor}>{children}</ColaboradorContext.Provider>;
}

export function useEu(): Ctx {
  const ctx = useContext(ColaboradorContext);
  if (!ctx) throw new Error("useEu fora do ColaboradorProvider");
  return ctx;
}

/**
 * O colaborador logado tem a permissão? (Administrador tem todas.) Esconde
 * menu, botão e ação; a regra de verdade está na RLS e nas functions.
 */
export function usePermissao(p: string): boolean {
  return useEu().tem(p);
}

/** Pelo menos uma da lista. */
export function useAlgumaPermissao(ps: string[]): boolean {
  const { tem } = useEu();
  return ps.some((p) => tem(p));
}

/** Paleta das cores de colaborador (avatar de iniciais). */
export const CORES_COLABORADOR = [
  "#1D3B6F", "#2563eb", "#0891b2", "#059669", "#65a30d",
  "#CE9350", "#d97706", "#dc2626", "#db2777", "#7c3aed",
];
