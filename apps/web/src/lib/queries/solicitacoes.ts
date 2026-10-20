// Chamados (novo no painel Denos): pedidos que o cliente faz pelo
// WhatsApp (nota fiscal, guia, certidão…), registrados a partir da conversa.

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useRealtimeInvalidate } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";

export type SolicitacaoStatus = "aberta" | "em_andamento" | "concluida" | "cancelada";

// Os valores do banco ficam no feminino ("solicitação"); na tela é "chamado",
// então os rótulos vão no masculino.
export const STATUS_SOLICITACAO: { value: SolicitacaoStatus; label: string }[] = [
  { value: "aberta", label: "Aberto" },
  { value: "em_andamento", label: "Em andamento" },
  { value: "concluida", label: "Concluído" },
  { value: "cancelada", label: "Cancelado" },
];

export const STATUS_SOLICITACAO_LABEL: Record<SolicitacaoStatus, string> = {
  aberta: "Aberto",
  em_andamento: "Em andamento",
  concluida: "Concluído",
  cancelada: "Cancelado",
};

/** Prazo vencido e ainda em aberto. */
export function chamadoAtrasado(s: Pick<Solicitacao, "prazo" | "status">, hoje: string): boolean {
  return !!s.prazo && s.prazo < hoje && (s.status === "aberta" || s.status === "em_andamento");
}

/** Selo do prazo na lista e na gaveta. */
export type SituacaoPrazo = "atrasado" | "hoje" | "amanha";

/**
 * Prazo vencido, vencendo hoje ou amanhã, só para chamado aberto ou em
 * andamento (`hoje` = AAAA-MM-DD local). Fora disso (ou sem prazo), null.
 */
export function situacaoPrazo(s: Pick<Solicitacao, "prazo" | "status">, hoje: string): SituacaoPrazo | null {
  if (!s.prazo || (s.status !== "aberta" && s.status !== "em_andamento")) return null;
  if (s.prazo < hoje) return "atrasado";
  if (s.prazo === hoje) return "hoje";
  if (s.prazo === diaSeguinte(hoje)) return "amanha";
  return null;
}

/** AAAA-MM-DD do dia seguinte, no calendário local (vira mês e ano sozinho). */
function diaSeguinte(d: string): string {
  const [a, m, dia] = d.split("-").map(Number);
  const x = new Date(a!, m! - 1, dia! + 1);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

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
  /** De onde nasceu: painel, WhatsApp ou o portal do cliente. */
  origem?: "painel" | "whatsapp" | "portal";
  responsavelId: string | null;
  prazo: string | null;
  concluidaEm: string | null;
  criadoEm: string;
  atualizadoEm: string;
  tipo?: { id: string; nome: string } | null;
  cliente?: {
    id: string;
    nome: string;
    nomeFantasia: string | null;
    telefone: string | null;
    provisorio: boolean;
  } | null;
  chat?: { id: string; sessaoId: string; chatId: string; nome: string | null } | null;
};

const SELECT_SOLICITACAO =
  "*, tipo:SolicitacaoTipo(id, nome), cliente:Cliente(id, nome, nomeFantasia, telefone, provisorio), chat:WhatsappChat(id, sessaoId, chatId, nome)";

/**
 * Quem pediu o chamado, para a lista: o cliente (nome + telefone) ou, sem
 * cliente, o contato da conversa (nome + número do JID @c.us).
 */
export function contatoDoChamado(s: Pick<Solicitacao, "cliente" | "chat">): {
  nome: string | null;
  telefone: string | null;
  provisorio: boolean;
} {
  if (s.cliente) {
    return {
      nome: s.cliente.nomeFantasia || s.cliente.nome,
      telefone: s.cliente.telefone,
      provisorio: !!s.cliente.provisorio,
    };
  }
  if (s.chat) {
    const numero = s.chat.chatId.endsWith("@c.us") ? s.chat.chatId.split("@")[0]! : null;
    return { nome: s.chat.nome, telefone: numero, provisorio: false };
  }
  return { nome: null, telefone: null, provisorio: false };
}

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
  /** "atrasadas": em aberto com o prazo vencido (`hoje` = AAAA-MM-DD local). */
  status?: SolicitacaoStatus | "abertas" | "atrasadas" | "";
  hoje?: string;
  tipoId?: string;
  responsavelId?: string;
  clienteId?: string;
  chatRowId?: string;
  /** AAAA-MM-DD inclusive. */
  de?: string;
  ate?: string;
  /** "recentes" (padrão): data de abertura, o mais novo primeiro. "prazo": o mais urgente primeiro. */
  ordem?: OrdemSolicitacoes;
};

export type OrdemSolicitacoes = "recentes" | "prazo";

/** Teto da lista de chamados: chegou nele, a tela avisa que mostra só os primeiros. */
export const LIMITE_SOLICITACOES = 500;

export function useSolicitacoes(filtros: SolicitacoesFiltros, enabled = true) {
  useRealtimeInvalidate("Solicitacao", [["solicitacoes"], ["contador", "chamados"]], undefined, enabled);
  return useQuery({
    queryKey: ["solicitacoes", filtros],
    placeholderData: keepPreviousData,
    enabled,
    queryFn: async () => {
      let q = supabase.from("Solicitacao").select(SELECT_SOLICITACAO);
      // Por prazo: vence antes, aparece antes; sem prazo vai para o fim. Empate: o mais novo.
      if (filtros.ordem === "prazo") q = q.order("prazo", { ascending: true, nullsFirst: false });
      q = q.order("criadoEm", { ascending: false }).limit(LIMITE_SOLICITACOES);
      if (filtros.status === "abertas") q = q.in("status", ["aberta", "em_andamento"]);
      else if (filtros.status === "atrasadas")
        q = q.in("status", ["aberta", "em_andamento"]).lt("prazo", filtros.hoje ?? new Date().toISOString().slice(0, 10));
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

/** Um chamado pelo id (gaveta de detalhes). Entra no prefixo "solicitacoes": mudou algo, refaz. */
export function useSolicitacao(id: string | null) {
  useRealtimeInvalidate("Solicitacao", [["solicitacoes", "um", id], ["historico", "chamado", id]], { column: "id", value: id ?? "__none__" }, !!id);
  return useQuery({
    queryKey: ["solicitacoes", "um", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("Solicitacao").select(SELECT_SOLICITACAO).eq("id", id!).maybeSingle();
      if (error) throw error;
      return (data ?? null) as Solicitacao | null;
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
      qc.invalidateQueries({ queryKey: ["contador", "chamados"] });
      qc.invalidateQueries({ queryKey: ["historico"] });
    },
  });
}

export function useAtualizarSolicitacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      patch: Partial<Pick<Solicitacao, "status" | "responsavelId" | "prazo" | "descricao" | "tipoId" | "clienteId">>;
      /** Só para a tela (otimista): o tipo/cliente embutidos que combinam com o patch. */
      exibir?: Partial<Pick<Solicitacao, "tipo" | "cliente">>;
    }) => {
      // "concluidaEm" não vai daqui: o banco calcula pela mudança de status (migration 011).
      const { error } = await supabase.from("Solicitacao").update(args.patch).eq("id", args.id);
      if (error) throw error;
    },
    onMutate: async (args) => {
      await qc.cancelQueries({ queryKey: ["solicitacoes"] });
      const snaps = qc.getQueriesData<Solicitacao[] | Solicitacao | null>({ queryKey: ["solicitacoes"] });
      const novo = { ...args.patch, ...args.exibir };
      for (const [key, data] of snaps) {
        if (Array.isArray(data)) {
          qc.setQueryData<Solicitacao[]>(key, data.map((s) => (s.id === args.id ? { ...s, ...novo } : s)));
        } else if (data && data.id === args.id) {
          // A gaveta ("solicitacoes", "um", id) também muda na hora.
          qc.setQueryData<Solicitacao>(key, { ...data, ...novo });
        }
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
      qc.invalidateQueries({ queryKey: ["contador", "chamados"] });
      qc.invalidateQueries({ queryKey: ["historico"] });
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
      qc.invalidateQueries({ queryKey: ["contador", "chamados"] });
      qc.invalidateQueries({ queryKey: ["historico"] });
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
