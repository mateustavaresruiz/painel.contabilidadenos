// Visão geral: uma chamada à RPC painel_dashboard (migration 004), que
// agrega tudo no banco e devolve um jsonb só.

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";

export type Periodo = "hoje" | "7d" | "30d" | "mes";

export const PERIODOS: { valor: Periodo; rotulo: string }[] = [
  { valor: "hoje", rotulo: "Hoje" },
  { valor: "7d", rotulo: "7 dias" },
  { valor: "30d", rotulo: "30 dias" },
  { valor: "mes", rotulo: "Mês atual" },
];

/** Intervalo [de, ate) no horário local; "7 dias" = hoje e os 6 anteriores. */
export function intervaloDoPeriodo(p: Periodo, agora = new Date()): { de: Date; ate: Date } {
  const inicioHoje = new Date(agora);
  inicioHoje.setHours(0, 0, 0, 0);
  const ate = new Date(inicioHoje.getTime() + 86_400_000);
  if (p === "hoje") return { de: inicioHoje, ate };
  if (p === "7d") return { de: new Date(inicioHoje.getTime() - 6 * 86_400_000), ate };
  if (p === "30d") return { de: new Date(inicioHoje.getTime() - 29 * 86_400_000), ate };
  return { de: new Date(agora.getFullYear(), agora.getMonth(), 1), ate };
}

type Contagem = { id: string | null; nome: string; cor?: string | null; total: number };

export type Dashboard = {
  de: string;
  ate: string;
  hoje: string;
  atendimento: {
    conversasAtivas: number;
    conversasNoPeriodo: number;
    semResponsavel: number;
    emAtendimentoPorColaborador: Contagem[];
    mensagensPorDia: { dia: string; recebidas: number; enviadas: number }[];
    recebidas: number;
    enviadas: number;
    primeiraResposta: { mediaMin: number | null; medianaMin: number | null; respondidas: number; semResposta: number };
    conexoes: { total: number; online: number };
  };
  chamados: {
    criadosNoPeriodo: number;
    abertos: number;
    emAndamento: number;
    concluidosNoPeriodo: number;
    atrasados: number;
    topTipos: Contagem[];
    porResponsavel: Contagem[];
  };
  clientes: { ativos: number; novosNoPeriodo: number; porRegime: { regime: string; total: number }[] };
  certificados: {
    vencidos: number;
    vencem7: number;
    vencem30: number;
    total: number;
    avisos: { enviados: number; falharam: number };
  };
  aniversarios: {
    origem: "empresa" | "pessoa" | "socio";
    clienteId: string;
    socioId: string | null;
    nome: string;
    clienteNome: string;
    diasAte: number;
    anos: number;
  }[];
  fiscal: {
    consultasNoPeriodo: number;
    ultimaPorStatus: { ok: number; com_pendencia: number; erro: number; pendente: number };
  };
};

export function useDashboard(periodo: Periodo, enabled = true) {
  return useQuery({
    enabled,
    queryKey: ["dashboard", periodo],
    queryFn: async () => {
      const { de, ate } = intervaloDoPeriodo(periodo);
      const { data, error } = await supabase.rpc("painel_dashboard", {
        p_de: de.toISOString(),
        p_ate: ate.toISOString(),
      });
      if (error) throw error;
      return data as Dashboard;
    },
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}
