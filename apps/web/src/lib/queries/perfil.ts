// Perfil de uma pessoa da equipe (/equipe/:id), migration 016.
//
// Tudo passa por RPC security definer que confere o acesso no banco:
// `auditoria.ver` vê qualquer perfil; sem ela, só o próprio. As RPCs agregam no
// SQL (nada de baixar milhares de linhas para contar no navegador). Só leitura,
// fora "Encerrar sessões" (equipe.gerenciar), que fica na auditoria.

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  ACAO_LABEL,
  descreverAlteracoes,
  MODULO_LABEL,
  ORIGEM_LABEL,
  type AuditoriaEvento,
} from "@/lib/queries/auditoria";
import { parsePgTimestamp } from "@/lib/format";
import { supabase } from "@/lib/supabase";

export type PerfilColaborador = {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  cor: string | null;
  ativo: boolean;
  cargo: string | null;
  cargoSistema: boolean;
  criadoEm: string;
  temLogin: boolean;
  ultimoLogin: string | null;
  ultimoSignIn: string | null;
  ultimaAtividade: string | null;
  /** null quando quem vê não é administrador. */
  sessoesAtivas: number | null;
  proprio: boolean;
  verTudo: boolean;
  podeEncerrarSessoes: boolean;
};

export type PerfilKpis = {
  conversasAgora: number;
  assumidas: number;
  recebidas: number;
  transferidas: number;
  devolvidas: number;
  finalizadas: number;
  mensagensEnviadas: number;
  primeiraResposta: { mediaMin: number | null; medianaMin: number | null; respondidas: number };
  chamadosAbertosPorEle: number;
  chamadosResponsavel: { abertos: number; atrasados: number; concluidos: number };
  clientesCadastrados: number;
  clientesEditados: number;
  consultasSerpro: number;
  logins: number;
  eventos: number;
};

export type PeriodoPerfil = "hoje" | "7d" | "30d" | "mes" | "personalizado";

export const PERIODOS_PERFIL: { valor: PeriodoPerfil; rotulo: string }[] = [
  { valor: "hoje", rotulo: "Hoje" },
  { valor: "7d", rotulo: "7 dias" },
  { valor: "30d", rotulo: "30 dias" },
  { valor: "mes", rotulo: "Mês atual" },
  { valor: "personalizado", rotulo: "Personalizado" },
];

/** AAAA-MM-DD → meia-noite local. */
function diaLocal(iso: string, maisDias = 0): Date {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a!, m! - 1, d! + maisDias);
}

/** Intervalo [de, ate) no horário local. Personalizado: as duas datas inclusive. */
export function intervaloPerfil(
  p: PeriodoPerfil,
  personalizado: { de: string; ate: string },
  agora = new Date(),
): { de: Date; ate: Date } | null {
  const inicioHoje = new Date(agora);
  inicioHoje.setHours(0, 0, 0, 0);
  const amanha = new Date(inicioHoje.getTime() + 86_400_000);
  switch (p) {
    case "hoje":
      return { de: inicioHoje, ate: amanha };
    case "7d":
      return { de: new Date(inicioHoje.getTime() - 6 * 86_400_000), ate: amanha };
    case "30d":
      return { de: new Date(inicioHoje.getTime() - 29 * 86_400_000), ate: amanha };
    case "mes":
      return { de: new Date(agora.getFullYear(), agora.getMonth(), 1), ate: amanha };
    case "personalizado": {
      if (!personalizado.de || !personalizado.ate) return null;
      const de = diaLocal(personalizado.de);
      const ate = diaLocal(personalizado.ate, 1);
      return ate > de ? { de, ate } : null;
    }
  }
}

/** Erro "sem acesso" (42501 → 403) e "não existe" (P0002 → 404) do PostgREST. */
export function erroSemAcesso(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "42501";
}
export function erroNaoEncontrado(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "P0002";
}

/** Sem acesso não é falha de rede: não repete. */
const repetir = (n: number, e: unknown) => !erroSemAcesso(e) && !erroNaoEncontrado(e) && n < 1;

export function usePerfil(id: string | undefined) {
  return useQuery({
    queryKey: ["perfil", id],
    enabled: !!id,
    retry: repetir,
    // A página mostra o erro (ou "Sem acesso") no lugar; sem toast global.
    meta: { silencioso: true },
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("perfil_colaborador", { p_colab: id });
      if (error) throw error;
      return data as PerfilColaborador;
    },
  });
}

export function usePerfilKpis(id: string, intervalo: { de: Date; ate: Date } | null, enabled = true) {
  return useQuery({
    queryKey: ["perfil-kpis", id, intervalo?.de.toISOString(), intervalo?.ate.toISOString()],
    enabled: enabled && !!intervalo,
    retry: repetir,
    // A página mostra o erro (ou "Sem acesso") no lugar; sem toast global.
    meta: { silencioso: true },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("perfil_kpis", {
        p_colab: id,
        p_de: intervalo!.de.toISOString(),
        p_ate: intervalo!.ate.toISOString(),
      });
      if (error) throw error;
      return data as PerfilKpis;
    },
  });
}

// ---------------------------------------------------------------------------
// Atividade (auditoria em que a pessoa é o ator)
// ---------------------------------------------------------------------------

export type FiltrosAtividade = { de?: string; ate?: string; modulo?: string; acao?: string };

export const PAGINA_ATIVIDADE = 50;

async function paginaAtividade(id: string, f: FiltrosAtividade, limite: number, antes: number | null) {
  const { data, error } = await supabase.rpc("perfil_atividade", {
    p_colab: id,
    p_de: f.de ? diaLocal(f.de).toISOString() : null,
    p_ate: f.ate ? diaLocal(f.ate, 1).toISOString() : null,
    p_modulo: f.modulo ?? null,
    p_acao: f.acao ?? null,
    p_limite: limite,
    p_antes: antes,
  });
  if (error) throw error;
  return (data ?? []) as AuditoriaEvento[];
}

export function usePerfilAtividade(id: string, f: FiltrosAtividade, enabled = true) {
  return useInfiniteQuery({
    queryKey: ["perfil-atividade", id, f],
    enabled,
    retry: repetir,
    // A página mostra o erro (ou "Sem acesso") no lugar; sem toast global.
    meta: { silencioso: true },
    placeholderData: keepPreviousData,
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => paginaAtividade(id, f, PAGINA_ATIVIDADE, pageParam),
    getNextPageParam: (ultima) => (ultima.length >= PAGINA_ATIVIDADE ? ultima[ultima.length - 1]!.id : undefined),
  });
}

const LIMITE_CSV = 20_000;

function celulaCsv(v: string): string {
  const seguro = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${seguro.replace(/"/g, '""')}"`;
}

/** Baixa a atividade filtrada em CSV (páginas de 1000, até 20 mil linhas). */
export async function exportarAtividadeCsv(
  id: string,
  nome: string,
  f: FiltrosAtividade,
): Promise<{ linhas: number; cortado: boolean }> {
  const linhas: AuditoriaEvento[] = [];
  let cursor: number | null = null;
  let cortado = false;
  for (;;) {
    const pagina = await paginaAtividade(id, f, 1000, cursor);
    linhas.push(...pagina);
    if (pagina.length < 1000) break;
    if (linhas.length >= LIMITE_CSV) {
      cortado = true;
      break;
    }
    cursor = pagina[pagina.length - 1]!.id;
  }
  const cab = ["Data e hora", "Módulo", "Ação", "O que aconteceu", "Detalhes", "Origem"];
  const corpo = linhas.map((e) => {
    const d = parsePgTimestamp(e.criadoEm);
    return [
      d ? d.toLocaleString("pt-BR") : e.criadoEm,
      MODULO_LABEL[e.modulo] ?? e.modulo,
      ACAO_LABEL[e.acao] ?? e.acao,
      `${e.atorNome ?? nome} ${e.resumo}`,
      descreverAlteracoes(e.detalhes),
      ORIGEM_LABEL[e.origem] ?? e.origem,
    ]
      .map(celulaCsv)
      .join(";");
  });
  const csv = "﻿" + [cab.map(celulaCsv).join(";"), ...corpo].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  const slug = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  a.download = `atividade-${slug || "pessoa"}${f.de ? `-${f.de}` : ""}${f.ate ? `-a-${f.ate}` : ""}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { linhas: linhas.length, cortado };
}

// ---------------------------------------------------------------------------
// Atendimentos
// ---------------------------------------------------------------------------

export type ConversaAgora = {
  id: string;
  sessaoId: string;
  chatId: string;
  tipo: string | null;
  nome: string | null;
  cliente: string | null;
  conexao: string | null;
  desde: string | null;
  ultimaMensagemEm: string | null;
  ultimaMensagemFromMe: boolean | null;
  naoLidas: number | null;
};

export type EventoAtendimento = {
  id: string;
  em: string;
  evento: "assumiu" | "tomou" | "transferiu" | "devolveu" | "finalizou" | "reabriu" | "fila" | string;
  chatRowId: string;
  sessaoId: string | null;
  chatId: string | null;
  conversa: string;
  porId: string | null;
  por: string | null;
  deId: string | null;
  de: string | null;
  paraId: string | null;
  para: string | null;
  motivo: string | null;
};

const PAGINA_ATENDIMENTOS = 50;

export function usePerfilAtendimentos(id: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: ["perfil-atendimentos", id],
    enabled,
    retry: repetir,
    // A página mostra o erro (ou "Sem acesso") no lugar; sem toast global.
    meta: { silencioso: true },
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc("perfil_atendimentos", {
        p_colab: id,
        p_limite: PAGINA_ATENDIMENTOS,
        p_antes: pageParam,
      });
      if (error) throw error;
      return data as { agora: ConversaAgora[]; historico: EventoAtendimento[] };
    },
    getNextPageParam: (ultima) =>
      ultima.historico.length >= PAGINA_ATENDIMENTOS ? ultima.historico[ultima.historico.length - 1]!.em : undefined,
  });
}

// ---------------------------------------------------------------------------
// Chamados
// ---------------------------------------------------------------------------

export type ChamadoPerfil = {
  id: string;
  tipo: string;
  cliente: string | null;
  descricao: string | null;
  status: "aberta" | "em_andamento" | "concluida" | "cancelada";
  prazo: string | null;
  criadoEm: string;
  concluidaEm: string | null;
  origem: string | null;
  criadoPorId: string | null;
  criadoPor: string | null;
  responsavelId: string | null;
  responsavel: string | null;
  atrasado: boolean;
  criou: boolean;
  responsavelEle: boolean;
};

export function usePerfilChamados(id: string, enabled = true) {
  return useQuery({
    queryKey: ["perfil-chamados", id],
    enabled,
    retry: repetir,
    // A página mostra o erro (ou "Sem acesso") no lugar; sem toast global.
    meta: { silencioso: true },
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("perfil_chamados", { p_colab: id });
      if (error) throw error;
      return (data ?? []) as ChamadoPerfil[];
    },
  });
}

// ---------------------------------------------------------------------------
// Mensagens (só leitura)
// ---------------------------------------------------------------------------

export type MensagemPerfil = {
  id: string;
  tipo: string | null;
  texto: string | null;
  arquivo: string | null;
  em: string;
  apagada: boolean;
  chatRowId: string | null;
  sessaoId: string;
  chatId: string;
  conversa: string;
};

export type MensagensPerfil = {
  porDia: { dia: string; total: number }[];
  ultimas: MensagemPerfil[];
  /** true = só as conversas que quem vê ainda enxerga. */
  restrito: boolean;
};

export function usePerfilMensagens(id: string, intervalo: { de: Date; ate: Date } | null, enabled = true) {
  return useQuery({
    queryKey: ["perfil-mensagens", id, intervalo?.de.toISOString(), intervalo?.ate.toISOString()],
    enabled: enabled && !!intervalo,
    retry: repetir,
    // A página mostra o erro (ou "Sem acesso") no lugar; sem toast global.
    meta: { silencioso: true },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("perfil_mensagens", {
        p_colab: id,
        p_de: intervalo!.de.toISOString(),
        p_ate: intervalo!.ate.toISOString(),
        p_limite: 50,
      });
      if (error) throw error;
      return data as MensagensPerfil;
    },
  });
}

// ---------------------------------------------------------------------------
// Acessos
// ---------------------------------------------------------------------------

export type SessaoAberta = {
  criadaEm: string;
  atividadeEm: string | null;
  navegador: string | null;
  ip: string | null;
  aal: string | null;
};

export function usePerfilSessoes(id: string, enabled = true) {
  return useQuery({
    queryKey: ["perfil-sessoes", id],
    enabled,
    retry: repetir,
    // A página mostra o erro (ou "Sem acesso") no lugar; sem toast global.
    meta: { silencioso: true },
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("perfil_sessoes", { p_colab: id });
      if (error) throw error;
      return (data ?? []) as SessaoAberta[];
    },
  });
}

export function useEncerrarSessoes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("perfil_encerrar_sessoes", { p_colab: id });
      if (error) throw error;
      return (data ?? 0) as number;
    },
    onSuccess: (_n, id) => {
      void qc.invalidateQueries({ queryKey: ["perfil", id] });
      void qc.invalidateQueries({ queryKey: ["perfil-sessoes", id] });
      void qc.invalidateQueries({ queryKey: ["perfil-atividade"] });
    },
  });
}

/** "Chrome no Windows" a partir do user agent (só para leitura humana). */
export function descreverNavegador(ua: string | null | undefined): string {
  if (!ua) return "Navegador desconhecido";
  const nav = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : /^node|undici|deno|curl/i.test(ua)
              ? "Programa (sem navegador)"
              : "Navegador";
  const so = /iPhone|iPad/.test(ua)
    ? "iPhone/iPad"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(ua)
          ? "Mac"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return so ? `${nav} no ${so}` : nav;
}

/** Login (auditoria 'acesso'): como entrou e de qual IP. */
export function comoEntrou(ev: AuditoriaEvento): { como: string; ip: string | null } {
  const info = ev.detalhes?.info ?? [];
  const como = info.find((i) => i.rotulo === "Como")?.valor ?? (/google/i.test(ev.resumo) ? "Conta Google" : "Não informado");
  const ip = info.find((i) => i.rotulo === "IP")?.valor ?? null;
  return { como, ip };
}
