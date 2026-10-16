// Auditoria: histórico de tudo o que acontece no painel (migration 009).
//
// Duas portas, de propósito:
//   - linha do tempo de um chamado, conversa ou cliente: RPC `historico_entidade`,
//     que confere se quem pede já enxerga a entidade (a tabela não é aberta);
//   - feed do administrador (Configurações > Auditoria): leitura direta da tabela,
//     que só responde a quem tem `auditoria.ver` (RLS).
// Nenhuma escrita sai daqui; só os gatilhos do banco gravam. Exceções: comentar
// em chamado e "entrou no painel", que passam por RPC.

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { parsePgDate, parsePgTimestamp } from "@/lib/format";
import { supabase } from "@/lib/supabase";

export type OrigemEvento = "painel" | "sistema" | "whatsapp" | "cron";

export type AlteracaoEvento = {
  campo: string;
  rotulo: string;
  de: unknown;
  para: unknown;
};

/** O que a tela sabe desenhar. O banco nunca grava segredo aqui. */
export type DetalhesEvento = {
  alteracoes?: AlteracaoEvento[];
  info?: { rotulo: string; valor: string }[];
  texto?: string;
};

export type AuditoriaEvento = {
  id: number;
  criadoEm: string;
  atorId: string | null;
  atorNome: string | null;
  modulo: string;
  entidade: string;
  entidadeId: string | null;
  acao: string;
  resumo: string;
  detalhes: DetalhesEvento | null;
  origem: OrigemEvento;
};

export const MODULO_LABEL: Record<string, string> = {
  chamados: "Chamados",
  clientes: "Clientes",
  certificados: "Certificados",
  pendencias: "Pendências fiscais",
  whatsapp: "WhatsApp",
  equipe: "Equipe",
  configuracoes: "Configurações",
  acesso: "Acesso",
  portal: "Portal do cliente",
};

export const MODULOS_AUDITORIA = Object.entries(MODULO_LABEL).map(([valor, rotulo]) => ({ valor, rotulo }));

/** Ação (código do banco) → texto para filtro e etiqueta. */
export const ACAO_LABEL: Record<string, string> = {
  criado: "Criado",
  link_gerado: "Gerou o link do portal",
  link_revogado: "Revogou o link do portal",
  senha_regenerada: "Gerou senha nova do portal",
  cliente_acessou: "Cliente acessou o portal",
  chamado_aberto: "Chamado aberto pelo portal",
  config: "Mudou configuração do portal",
  editado: "Editado",
  excluido: "Excluído",
  status: "Mudou o status",
  responsavel: "Mudou o responsável",
  prazo: "Mudou o prazo",
  descricao: "Editou a descrição",
  tipo: "Mudou o tipo",
  cliente: "Mudou o cliente",
  comentario: "Comentário",
  assumiu: "Assumiu a conversa",
  tomou: "Assumiu de outra pessoa",
  transferiu: "Transferiu a conversa",
  devolveu: "Devolveu para a fila",
  finalizou: "Finalizou o atendimento",
  reabriu: "Reabriu o atendimento",
  fila: "Voltou para a fila",
  vinculado: "Vinculou a um cliente",
  desvinculado: "Desvinculou do cliente",
  apagada: "Apagado",
  etiqueta_aplicada: "Aplicou etiqueta",
  etiqueta_removida: "Tirou etiqueta",
  etiqueta_criada: "Criou etiqueta",
  etiqueta_editada: "Editou etiqueta",
  etiqueta_excluida: "Excluiu etiqueta",
  provisorio_completado: "Completou cadastro provisório",
  ativado: "Ativado",
  desativado: "Desativado",
  validade: "Mudou a validade",
  aviso: "Aviso de vencimento",
  convidado: "Convidou para a equipe",
  cargo: "Mudou o cargo",
  permissoes: "Mudou permissões",
  modulos: "Mudou módulos",
  ajuste: "Mudou um ajuste",
  consulta: "Fez uma consulta",
  resultado: "Resultado de consulta",
  pin_confirmado: "Confirmou com PIN",
  agendamento_ligado: "Ligou agendamento",
  agendamento_desligado: "Desligou agendamento",
  agendamento_editado: "Mudou agendamento",
  conectou: "Conectou o número",
  desconectou: "Desconectou o número",
  criada: "Criou conexão",
  renomeada: "Renomeou conexão",
  login: "Entrou no painel",
};

export const ACOES_AUDITORIA = Object.entries(ACAO_LABEL)
  .map(([valor, rotulo]) => ({ valor, rotulo }))
  .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));

export const ORIGEM_LABEL: Record<OrigemEvento, string> = {
  painel: "Painel",
  sistema: "Sistema",
  whatsapp: "WhatsApp",
  cron: "Rotina automática",
};

/** Valor de um campo antes/depois, em português. */
export function formatarValor(v: unknown): string {
  if (v === null || v === undefined || v === "") return "vazio";
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return parsePgDate(v)?.toLocaleDateString("pt-BR") ?? v;
    return v;
  }
  return JSON.stringify(v);
}

/** Há conteúdo para o "ver detalhes" (comentário aparece direto, sem expandir). */
export function temDetalhes(d: DetalhesEvento | null): boolean {
  return !!d && ((d.alteracoes?.length ?? 0) > 0 || (d.info?.length ?? 0) > 0);
}

// ---------------------------------------------------------------------------
// Linha do tempo de uma entidade
// ---------------------------------------------------------------------------

export type EntidadeHistorico = "chamado" | "conversa" | "cliente";

const PAGINA_HISTORICO = 30;

export function useHistorico(entidade: EntidadeHistorico, id: string | null | undefined, enabled = true) {
  return useInfiniteQuery({
    queryKey: ["historico", entidade, id],
    enabled: enabled && !!id,
    staleTime: 5_000,
    refetchOnMount: "always",
    initialPageParam: null as number | null,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc("historico_entidade", {
        p_entidade: entidade,
        p_id: id,
        p_limite: PAGINA_HISTORICO,
        p_antes: pageParam,
      });
      if (error) throw error;
      return (data ?? []) as AuditoriaEvento[];
    },
    getNextPageParam: (ultima) =>
      ultima.length >= PAGINA_HISTORICO ? ultima[ultima.length - 1]!.id : undefined,
  });
}

/** Comentário no chamado (vai para a linha do tempo e para a auditoria). */
export function useComentarChamado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; texto: string }) => {
      const { error } = await supabase.rpc("comentar_chamado", { p_id: args.id, p_texto: args.texto });
      if (error) throw error;
    },
    onSuccess: (_d, args) => {
      void qc.invalidateQueries({ queryKey: ["historico", "chamado", args.id] });
    },
  });
}

/** "Entrou no painel" (link ou código). Nunca atrapalha a entrada. */
export async function registrarLogin(metodo: "link" | "codigo"): Promise<void> {
  try {
    await supabase.rpc("registrar_login", { p_metodo: metodo });
  } catch {
    /* auditoria é acessório: a entrada vale mesmo sem ela */
  }
}

// ---------------------------------------------------------------------------
// Feed do administrador
// ---------------------------------------------------------------------------

export type FiltrosAuditoria = {
  /** AAAA-MM-DD, inclusive. */
  de?: string;
  ate?: string;
  /** id do colaborador, ou "sistema" (sem pessoa). */
  atorId?: string;
  modulo?: string;
  acao?: string;
  busca?: string;
};

export const PAGINA_FEED = 50;

const COLUNAS: string =
  'id, "criadoEm", "atorId", "atorNome", modulo, entidade, "entidadeId", acao, resumo, detalhes, origem';

function inicioDoDia(d: string): string {
  const [a, m, dia] = d.split("-").map(Number);
  return new Date(a!, m! - 1, dia!).toISOString();
}

function inicioDoDiaSeguinte(d: string): string {
  const [a, m, dia] = d.split("-").map(Number);
  return new Date(a!, m! - 1, dia! + 1).toISOString();
}

/** Uma página do feed (mais novo primeiro), a partir do cursor "id menor que". */
async function buscarPagina(f: FiltrosAuditoria, limite: number, antes: number | null): Promise<AuditoriaEvento[]> {
  let q = supabase.from("AuditoriaEvento").select(COLUNAS).order("id", { ascending: false }).limit(limite);
  if (antes !== null) q = q.lt("id", antes);
  if (f.de) q = q.gte("criadoEm", inicioDoDia(f.de));
  if (f.ate) q = q.lt("criadoEm", inicioDoDiaSeguinte(f.ate));
  if (f.atorId === "sistema") q = q.is("atorId", null);
  else if (f.atorId) q = q.eq("atorId", f.atorId);
  if (f.modulo) q = q.eq("modulo", f.modulo);
  if (f.acao) q = q.eq("acao", f.acao);
  // Vírgula, parêntese, aspas e curinga têm sentido no filtro `or` do PostgREST.
  const b = (f.busca ?? "").replace(/[%,()*\\"]/g, " ").trim();
  if (b) q = q.or(`resumo.ilike.*${b}*,atorNome.ilike.*${b}*`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as AuditoriaEvento[];
}

export function useAuditoriaFeed(filtros: FiltrosAuditoria) {
  return useInfiniteQuery({
    queryKey: ["auditoria-feed", filtros],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => buscarPagina(filtros, PAGINA_FEED, pageParam),
    getNextPageParam: (ultima) => (ultima.length >= PAGINA_FEED ? ultima[ultima.length - 1]!.id : undefined),
  });
}

// ---------------------------------------------------------------------------
// Exportar CSV (do período/filtros que estão na tela)
// ---------------------------------------------------------------------------

/** Teto de linhas por exportação: protege o navegador e o banco. */
export const LIMITE_EXPORTACAO = 20_000;

function celulaCsv(v: string): string {
  // Planilha interpreta =, +, -, @ no começo como fórmula: neutraliza.
  const seguro = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${seguro.replace(/"/g, '""')}"`;
}

export function descreverAlteracoes(d: DetalhesEvento | null): string {
  if (!d) return "";
  const partes: string[] = [];
  for (const a of d.alteracoes ?? []) partes.push(`${a.rotulo}: ${formatarValor(a.de)} → ${formatarValor(a.para)}`);
  for (const i of d.info ?? []) partes.push(`${i.rotulo}: ${i.valor}`);
  if (d.texto) partes.push(`Texto: ${d.texto}`);
  return partes.join(" | ");
}

/** Busca tudo que bate com o filtro (em páginas de 1000) e baixa como CSV. Devolve a contagem. */
export async function exportarAuditoriaCsv(filtros: FiltrosAuditoria): Promise<{ linhas: number; cortado: boolean }> {
  const linhas: AuditoriaEvento[] = [];
  let cursor: number | null = null;
  let cortado = false;
  for (;;) {
    const pagina = await buscarPagina(filtros, 1000, cursor);
    linhas.push(...pagina);
    if (pagina.length < 1000) break;
    if (linhas.length >= LIMITE_EXPORTACAO) {
      cortado = true;
      break;
    }
    cursor = pagina[pagina.length - 1]!.id;
  }

  const cab = ["Data e hora", "Pessoa", "Módulo", "Ação", "O que aconteceu", "Detalhes", "Origem"];
  const corpo = linhas.map((e) => {
    const d = parsePgTimestamp(e.criadoEm);
    return [
      d ? d.toLocaleString("pt-BR") : e.criadoEm,
      e.atorNome ?? "Sistema",
      MODULO_LABEL[e.modulo] ?? e.modulo,
      ACAO_LABEL[e.acao] ?? e.acao,
      `${e.atorNome ?? "Sistema"} ${e.resumo}`,
      descreverAlteracoes(e.detalhes),
      ORIGEM_LABEL[e.origem] ?? e.origem,
    ].map(celulaCsv).join(";");
  });
  // BOM + ponto e vírgula: o Excel em português abre com acento e colunas certas.
  const csv = "﻿" + [cab.map(celulaCsv).join(";"), ...corpo].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  // auditoria-AAAA-MM-DD-a-AAAA-MM-DD.csv: sem filtro de data, vale do evento mais antigo exportado até hoje.
  const dia = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const hoje = dia(new Date().toISOString());
  const maisAntigo = linhas.length ? dia(linhas.reduce((m, l) => (l.criadoEm < m ? l.criadoEm : m), linhas[0].criadoEm)) : hoje;
  a.download = `auditoria-${filtros.de ?? maisAntigo}-a-${filtros.ate ?? hoje}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { linhas: linhas.length, cortado };
}
