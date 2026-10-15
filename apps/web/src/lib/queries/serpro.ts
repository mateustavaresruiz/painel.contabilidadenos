// Painel do Serpro: resumo por cliente, agendamentos e custos. As consultas
// em si e o status do gateway estão em lib/queries/denos.ts.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";

export const SERVICOS_SERPRO = [
  { valor: "SITFIS", rotulo: "Situação fiscal (SITFIS)", custo: 0.32, descricao: "Relatório de situação fiscal na Receita e PGFN." },
  { valor: "CAIXAPOSTAL", rotulo: "Caixa postal do e-CAC", custo: 0.24, descricao: "Mensagens da Receita; conta as importantes não lidas." },
  { valor: "PARCELAMENTOS", rotulo: "Parcelamentos", custo: 0.24, descricao: "Pedidos de parcelamento do Simples ou do MEI (pelo regime do cadastro)." },
  { valor: "PROCURACAO", rotulo: "Procuração", custo: 0.24, descricao: "Se o cliente deu procuração eletrônica ao escritório." },
  { valor: "PGDASD", rotulo: "PGDAS-D (última declaração)", custo: 0.24, descricao: "Declaração do Simples do mês anterior." },
  { valor: "DCTFWEB", rotulo: "DCTFWeb (recibo)", custo: 0.24, descricao: "Recibo da DCTFWeb do mês anterior." },
  { valor: "CCMEI", rotulo: "CCMEI (dados do MEI)", custo: 0.24, descricao: "Situação cadastral do MEI. O gateway pede PIN." },
] as const;
export type ServicoSerpro = (typeof SERVICOS_SERPRO)[number]["valor"];
export const ROTULO_SERVICO: Record<string, string> = Object.fromEntries(SERVICOS_SERPRO.map((s) => [s.valor, s.rotulo]));
export const CUSTO_SERVICO: Record<string, number> = Object.fromEntries(SERVICOS_SERPRO.map((s) => [s.valor, s.custo]));

export type UltimaConsulta = {
  id: string;
  clienteId: string;
  servico: string;
  status: "ok" | "com_pendencia" | "erro";
  resumo: string | null;
  resultado: Record<string, unknown> | null;
  erro: string | null;
  origem: string;
  custoEstimado: number | null;
  criadoEm: string;
};

export type ClienteFiscal = {
  id: string;
  nome: string;
  nomeFantasia: string | null;
  cpfCnpj: string | null;
  regimeTributario: string | null;
};

export type SituacaoResumo = "regular" | "com_pendencia" | "parcelado" | "erro" | "nunca";

export type LinhaResumo = {
  cliente: ClienteFiscal;
  situacao: SituacaoResumo;
  sitfis?: UltimaConsulta;
  caixa?: UltimaConsulta;
  parcel?: UltimaConsulta;
  procuracao?: UltimaConsulta;
  ultimaEm: string | null;
  parcelamentosAtivos: number;
  caixaImportantes: number;
  procuracaoStatus: "ativa" | "sem_procuracao" | "erro" | "nunca";
};

/**
 * Situação do cliente: erro (último SITFIS falhou) > parcelado (há
 * parcelamento ativo) > com pendência (SITFIS) > regular > nunca consultado.
 */
export function situacaoDe(sitfis?: UltimaConsulta, parcel?: UltimaConsulta): SituacaoResumo {
  const ativos = Number((parcel?.resultado as { ativos?: number } | null)?.ativos ?? 0);
  if (!sitfis && !parcel) return "nunca";
  if (sitfis?.status === "erro") return "erro";
  if (ativos > 0) return "parcelado";
  if (sitfis?.status === "com_pendencia") return "com_pendencia";
  if (sitfis?.status === "ok") return "regular";
  return parcel?.status === "erro" ? "erro" : "nunca";
}

export function useResumoFiscal() {
  return useQuery({
    queryKey: ["serpro-resumo"],
    queryFn: async () => {
      const [cli, ult] = await Promise.all([
        supabase.from("Cliente").select("id, nome, nomeFantasia, cpfCnpj, regimeTributario").eq("ativo", true).order("nome").limit(5000),
        supabase.from("ConsultaFiscalUltima").select("*").limit(20000),
      ]);
      if (cli.error) throw cli.error;
      if (ult.error) throw ult.error;
      const porCliente = new Map<string, Record<string, UltimaConsulta>>();
      for (const u of (ult.data ?? []) as UltimaConsulta[]) {
        const m = porCliente.get(u.clienteId) ?? {};
        m[u.servico] = u;
        porCliente.set(u.clienteId, m);
      }
      return ((cli.data ?? []) as ClienteFiscal[]).map((c): LinhaResumo => {
        const m = porCliente.get(c.id) ?? {};
        const datas = Object.values(m).map((x) => x.criadoEm).sort();
        const proc = m.PROCURACAO;
        const procStatus = (proc?.resultado as { procuracao?: string } | null)?.procuracao;
        return {
          cliente: c,
          situacao: situacaoDe(m.SITFIS, m.PARCELAMENTOS),
          sitfis: m.SITFIS,
          caixa: m.CAIXAPOSTAL,
          parcel: m.PARCELAMENTOS,
          procuracao: proc,
          ultimaEm: datas[datas.length - 1] ?? null,
          parcelamentosAtivos: Number((m.PARCELAMENTOS?.resultado as { ativos?: number } | null)?.ativos ?? 0),
          caixaImportantes: Number((m.CAIXAPOSTAL?.resultado as { caixaPostal?: { importantes?: number } } | null)?.caixaPostal?.importantes ?? 0),
          procuracaoStatus: !proc ? "nunca" : procStatus === "ativa" ? "ativa" : procStatus === "sem_procuracao" ? "sem_procuracao" : "erro",
        };
      });
    },
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Agendamentos
// ---------------------------------------------------------------------------

export type AgendamentoSerpro = {
  id: string;
  servico: "SITFIS" | "CAIXAPOSTAL" | "PARCELAMENTOS" | "PROCURACAO";
  diaMes: number;
  ativo: boolean;
  todosAtivos: boolean;
  clienteIds: string[];
  cicloEm: string | null;
  cicloConcluido: boolean;
  cursor: string | null;
  cicloConsultas: number;
  cicloCusto: number;
  ultimaExecucao: string | null;
  ultimoResultado: string | null;
  ultimoErro: string | null;
};

export function useAgendamentosSerpro() {
  return useQuery({
    queryKey: ["serpro-agendamentos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("AgendamentoSerpro").select("*").order("servico");
      if (error) throw error;
      return (data ?? []) as AgendamentoSerpro[];
    },
  });
}

export function useSalvarAgendamento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: Pick<AgendamentoSerpro, "id" | "diaMes" | "ativo" | "todosAtivos" | "clienteIds"> & { alteradoPorId: string | null }) => {
      const { id, ...campos } = a;
      const { error } = await supabase.from("AgendamentoSerpro").update(campos).eq("id", id);
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["serpro-agendamentos"] }),
  });
}

// ---------------------------------------------------------------------------
// Custos
// ---------------------------------------------------------------------------

export type CustoMes = { mes: string; consultas: number; agendadas: number; custo: number };

export function useCustosSerpro() {
  return useQuery({
    queryKey: ["serpro-custos"],
    queryFn: async () => {
      const inicioMes = new Date();
      inicioMes.setDate(1);
      inicioMes.setHours(0, 0, 0, 0);
      const [meses, doMes] = await Promise.all([
        supabase.rpc("serpro_custos_mensais", { p_meses: 12 }),
        supabase.from("ConsultaFiscal").select("servico, origem, custoEstimado").gte("criadoEm", inicioMes.toISOString()).limit(20000),
      ]);
      if (meses.error) throw meses.error;
      if (doMes.error) throw doMes.error;
      const porServico = new Map<string, { consultas: number; custo: number }>();
      for (const r of (doMes.data ?? []) as Array<{ servico: string; custoEstimado: number | null }>) {
        const x = porServico.get(r.servico) ?? { consultas: 0, custo: 0 };
        x.consultas++;
        x.custo += Number(r.custoEstimado ?? 0);
        porServico.set(r.servico, x);
      }
      return {
        meses: ((meses.data ?? []) as CustoMes[]).map((m) => ({ ...m, custo: Number(m.custo), consultas: Number(m.consultas), agendadas: Number(m.agendadas) })),
        porServico: [...porServico.entries()].map(([servico, v]) => ({ servico, ...v })).sort((a, b) => b.custo - a.custo),
      };
    },
  });
}

/** Última consulta de cada serviço de um cliente. */
export function useUltimasDoCliente(clienteId: string) {
  return useQuery({
    queryKey: ["serpro-resumo", "cliente", clienteId],
    queryFn: async () => {
      const { data, error } = await supabase.from("ConsultaFiscalUltima").select("*").eq("clienteId", clienteId);
      if (error) throw error;
      return (data ?? []) as UltimaConsulta[];
    },
  });
}
