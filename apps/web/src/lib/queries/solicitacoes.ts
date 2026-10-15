// Chamados (novo no painel Denos): pedidos que o cliente faz pelo
// WhatsApp (nota fiscal, guia, certidão…), registrados a partir da conversa.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useRealtimeInvalidate } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";

export type SolicitacaoStatus = "aberta" | "em_andamento" | "concluida" | "cancelada";

export const STATUS_SOLICITACAO: { value: SolicitacaoStatus; label: string }[] = [
  { value: "aberta", label: "Aberta" },
  { value: "em_andamento", label: "Em andamento" },
  { value: "concluida", label: "Concluída" },
  { value: "cancelada", label: "Cancelada" },
];

export const STATUS_SOLICITACAO_LABEL: Record<SolicitacaoStatus, string> = {
  aberta: "Aberta",
  em_andamento: "Em andamento",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

export type SolicitacaoTipo = {
  id: string;
  nome: string;
  descricao: string | null;
  ordem: number;
  ativo: boolean;
  criadoEm: string;
};

export type Solicitacao = {
  id: string;
  tipoId: string;
  clienteId: string | null;
  chatId: string | null;
  mensagemId: string | null;
  descricao: string | null;
  status: SolicitacaoStatus;
  criadoPorId: string | null;
  responsavelId: string | null;
  prazo: string | null;
  concluidaEm: string | null;
  criadoEm: string;
  atualizadoEm: string;
  tipo?: { id: string; nome: string } | null;
  cliente?: { id: string; nome: string; nomeFantasia: string | null } | null;
  chat?: { id: string; sessaoId: string; chatId: string; nome: string | null } | null;
};

const SELECT_SOLICITACAO =
  "*, tipo:SolicitacaoTipo(id, nome), cliente:Cliente(id, nome, nomeFantasia), chat:WhatsappChat(id, sessaoId, chatId, nome)";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export function useSolicitacaoTipos(opts?: { somenteAtivos?: boolean }) {
  return useQuery({
    queryKey: ["solicitacao-tipos", !!opts?.somenteAtivos],
    queryFn: async () => {
      let q = supabase
        .from("SolicitacaoTipo")
        .select("*")
        .order("ordem", { ascending: true })
        .order("nome", { ascending: true });
      if (opts?.somenteAtivos) q = q.eq("ativo", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as SolicitacaoTipo[];
    },
    staleTime: 60_000,
  });
}

export function useSalvarSolicitacaoTipo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id?: string;
      nome: string;
      descricao?: string | null;
      ordem: number;
      ativo: boolean;
    }) => {
      const payload = {
        nome: args.nome.trim(),
        descricao: args.descricao?.trim() || null,
        ordem: args.ordem,
        ativo: args.ativo,
      };
      const { error } = args.id
        ? await supabase.from("SolicitacaoTipo").update(payload).eq("id", args.id)
        : await supabase.from("SolicitacaoTipo").insert(payload);
      if (error) {
        if (error.code === "23505") throw new Error("Já existe um tipo com esse nome.");
        throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["solicitacao-tipos"] }),
  });
}

export function useExcluirSolicitacaoTipo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("SolicitacaoTipo").delete().eq("id", id);
      if (error) {
        // Tipo já usado: a FK impede apagar — desative em vez disso.
        if (error.code === "23503")
          throw new Error("Este tipo já tem chamados. Desative-o em vez de excluir.");
        throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["solicitacao-tipos"] }),
  });
}

// ---------------------------------------------------------------------------
// Chamados
// ---------------------------------------------------------------------------

export type SolicitacoesFiltros = {
  status?: SolicitacaoStatus | "abertas" | "";
  tipoId?: string;
  responsavelId?: string;
  clienteId?: string;
  chatRowId?: string;
  /** AAAA-MM-DD inclusive. */
  de?: string;
  ate?: string;
};

export function useSolicitacoes(filtros: SolicitacoesFiltros, enabled = true) {
  useRealtimeInvalidate("Solicitacao", [["solicitacoes"]], undefined, enabled);
  return useQuery({
    queryKey: ["solicitacoes", filtros],
    enabled,
    queryFn: async () => {
      let q = supabase
        .from("Solicitacao")
        .select(SELECT_SOLICITACAO)
        .order("criadoEm", { ascending: false })
        .limit(500);
      if (filtros.status === "abertas") q = q.in("status", ["aberta", "em_andamento"]);
      else if (filtros.status) q = q.eq("status", filtros.status);
      if (filtros.tipoId) q = q.eq("tipoId", filtros.tipoId);
      if (filtros.responsavelId === "sem") q = q.is("responsavelId", null);
      else if (filtros.responsavelId) q = q.eq("responsavelId", filtros.responsavelId);
      if (filtros.clienteId) q = q.eq("clienteId", filtros.clienteId);
      if (filtros.chatRowId) q = q.eq("chatId", filtros.chatRowId);
      if (filtros.de) q = q.gte("criadoEm", inicioDoDia(filtros.de));
      if (filtros.ate) q = q.lt("criadoEm", inicioDoDiaSeguinte(filtros.ate));
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Solicitacao[];
    },
  });
}

export type NovaSolicitacao = {
  tipoId: string;
  descricao?: string | null;
  responsavelId?: string | null;
  prazo?: string | null;
  clienteId?: string | null;
  chatId?: string | null;
  mensagemId?: string | null;
  criadoPorId?: string | null;
};

export function useCriarSolicitacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NovaSolicitacao) => {
      const { data, error } = await supabase
        .from("Solicitacao")
        .insert({
          tipoId: input.tipoId,
          descricao: input.descricao?.trim() || null,
          responsavelId: input.responsavelId || null,
          prazo: input.prazo || null,
          clienteId: input.clienteId || null,
          chatId: input.chatId || null,
          // Fantasma otimista (temp-…) não existe no banco: não referencia.
          mensagemId:
            input.mensagemId && !input.mensagemId.startsWith("temp-") ? input.mensagemId : null,
          criadoPorId: input.criadoPorId || null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data as { id: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["solicitacoes"] });
      qc.invalidateQueries({ queryKey: ["relatorio-solicitacoes"] });
      qc.invalidateQueries({ queryKey: ["inicio"] });
    },
  });
}

export function useAtualizarSolicitacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      patch: Partial<Pick<Solicitacao, "status" | "responsavelId" | "prazo" | "descricao" | "tipoId">>;
    }) => {
      const patch: Record<string, unknown> = { ...args.patch };
      if (args.patch.status) {
        patch.concluidaEm = args.patch.status === "concluida" ? new Date().toISOString() : null;
      }
      const { error } = await supabase.from("Solicitacao").update(patch).eq("id", args.id);
      if (error) throw error;
    },
    onMutate: async (args) => {
      await qc.cancelQueries({ queryKey: ["solicitacoes"] });
      const snaps = qc.getQueriesData<Solicitacao[]>({ queryKey: ["solicitacoes"] });
      for (const [key, data] of snaps) {
        if (!data) continue;
        qc.setQueryData<Solicitacao[]>(
          key,
          data.map((s) => (s.id === args.id ? { ...s, ...args.patch } : s)),
        );
      }
      return { snaps };
    },
    onError: (_e, _a, ctx) => {
      for (const [key, data] of ctx?.snaps ?? []) qc.setQueryData(key, data);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["solicitacoes"] });
      qc.invalidateQueries({ queryKey: ["relatorio-solicitacoes"] });
      qc.invalidateQueries({ queryKey: ["inicio"] });
    },
  });
}

export function useExcluirSolicitacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("Solicitacao").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["solicitacoes"] });
      qc.invalidateQueries({ queryKey: ["relatorio-solicitacoes"] });
      qc.invalidateQueries({ queryKey: ["inicio"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------

export type LinhaRelatorio = {
  tipoId: string;
  nome: string;
  total: number;
  abertas: number;
  concluidas: number;
};

/** Ranking dos tipos mais pedidos no período [de, ate] (datas AAAA-MM-DD). */
export function useRelatorioSolicitacoes(de: string, ate: string) {
  return useQuery({
    queryKey: ["relatorio-solicitacoes", de, ate],
    enabled: !!de && !!ate,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("relatorio_solicitacoes", {
        p_de: inicioDoDia(de),
        p_ate: inicioDoDiaSeguinte(ate),
      });
      if (error) throw error;
      // bigint chega como número ou string conforme o tamanho: normaliza.
      return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        tipoId: String(r.tipoId),
        nome: String(r.nome),
        total: Number(r.total ?? 0),
        abertas: Number(r.abertas ?? 0),
        concluidas: Number(r.concluidas ?? 0),
      })) as LinhaRelatorio[];
    },
  });
}

/** Meia-noite LOCAL do dia (AAAA-MM-DD) em ISO — o período é no fuso de quem vê. */
function inicioDoDia(d: string): string {
  const [a, m, dia] = d.split("-").map(Number);
  return new Date(a!, m! - 1, dia!).toISOString();
}

function inicioDoDiaSeguinte(d: string): string {
  const [a, m, dia] = d.split("-").map(Number);
  return new Date(a!, m! - 1, dia! + 1).toISOString();
}
