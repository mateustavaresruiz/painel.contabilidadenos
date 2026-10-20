// Consultas pequenas do painel Denos: aniversários, Serpro e o resumo da
// tela Início. Equipe e cargos: lib/queries/equipe.ts.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { parsePgDate } from "@/lib/format";
import { supabase } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Aniversários (view "Aniversario": empresas, pessoas e sócios)
// ---------------------------------------------------------------------------

export type Aniversario = {
  origem: "empresa" | "pessoa" | "socio";
  clienteId: string;
  socioId: string | null;
  nome: string;
  clienteNome: string;
  data: string;
  telefone: string | null;
};

export type AniversarioCalculado = Aniversario & {
  /** Próxima ocorrência (hoje conta como 0 dias). */
  proxima: Date;
  diasAte: number;
  /** Idade (pessoa/sócio) ou anos de empresa que completa na próxima data. */
  anos: number;
};

export function useAniversarios() {
  return useQuery({
    queryKey: ["aniversarios"],
    queryFn: async () => {
      // O PostgREST corta em 1000 linhas por pedido (PGRST_DB_MAX_ROWS): pagina
      // até acabar. A view não tem id; origem + cliente + sócio é único e dá
      // ordem estável entre as páginas.
      const lista: Aniversario[] = [];
      for (let de = 0; ; de += 1000) {
        const { data, error } = await supabase
          .from("Aniversario")
          .select("*")
          .order("origem")
          .order("clienteId")
          .order("socioId", { nullsFirst: true })
          .range(de, de + 999);
        if (error) throw error;
        lista.push(...((data ?? []) as Aniversario[]));
        if (!data || data.length < 1000) break;
      }
      return calcularAniversarios(lista);
    },
    staleTime: 5 * 60_000,
  });
}

export function calcularAniversarios(lista: Aniversario[]): AniversarioCalculado[] {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const out: AniversarioCalculado[] = [];
  for (const a of lista) {
    const nasc = parsePgDate(a.data);
    if (!nasc) continue;
    let proxima = ocorrencia(nasc, hoje.getFullYear());
    if (proxima < hoje) proxima = ocorrencia(nasc, hoje.getFullYear() + 1);
    const diasAte = Math.round((proxima.getTime() - hoje.getTime()) / 86_400_000);
    out.push({ ...a, proxima, diasAte, anos: proxima.getFullYear() - nasc.getFullYear() });
  }
  return out.sort((x, y) => x.diasAte - y.diasAte || x.nome.localeCompare(y.nome));
}

/** Data no ano dado; 29/02 vira 28/02 em ano não bissexto. */
function ocorrencia(nasc: Date, ano: number): Date {
  const d = new Date(ano, nasc.getMonth(), nasc.getDate());
  if (d.getMonth() !== nasc.getMonth()) return new Date(ano, nasc.getMonth() + 1, 0);
  return d;
}

// ---------------------------------------------------------------------------
// Serpro (Integra Contador)
// ---------------------------------------------------------------------------

export type SerproStatus = {
  configurado: boolean;
  ambiente?: string | null;
  /** Itens que faltam (texto livre do servidor ou chaves conhecidas). */
  faltando?: string[];
  /** Campos do gateway Integra Contador (função serpro, commit 8d19df7). */
  gatewayAlcancavel?: boolean;
  pausado?: boolean;
  avisos?: string[];
  contratante?: string | null;
  certificado?:
    | { ok: true; titular: string | null; cnpj: string | null; validade: string | null; diasParaVencer: number | null }
    | { ok: false; erro: string };
  pinConfirmacao?: boolean;
  mensagem?: string;
  [k: string]: unknown;
};

/** GET /serpro/status. Falha (rota fora do ar) vira erro tratado na tela. */
export function useSerproStatus() {
  return useQuery({
    queryKey: ["serpro-status"],
    queryFn: () => api<SerproStatus>("/serpro/status"),
    retry: false,
    meta: { silencioso: true },
    staleTime: 60_000,
  });
}

export type ConsultaFiscal = {
  id: string;
  clienteId: string;
  servico: string;
  status: "pendente" | "ok" | "com_pendencia" | "erro";
  resumo: string | null;
  resultado: unknown;
  erro: string | null;
  porId: string | null;
  criadoEm: string;
  cliente?: { id: string; nome: string; nomeFantasia: string | null; cpfCnpj: string | null } | null;
};

export function useConsultasFiscais(clienteId?: string) {
  return useQuery({
    queryKey: ["consultas-fiscais", clienteId ?? "todas"],
    queryFn: async () => {
      let q = supabase
        .from("ConsultaFiscal")
        .select("*, cliente:Cliente(id, nome, nomeFantasia, cpfCnpj)")
        .order("criadoEm", { ascending: false })
        .limit(300);
      if (clienteId) q = q.eq("clienteId", clienteId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ConsultaFiscal[];
    },
  });
}

export function useConsultarSerpro() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { clienteId: string; servico: string }) =>
      api<unknown>("/serpro/consultar", { method: "POST", body: args }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["consultas-fiscais"] });
      qc.invalidateQueries({ queryKey: ["serpro-resumo"] });
      qc.invalidateQueries({ queryKey: ["serpro-custos"] });
    },
  });
}

/** SITFIS em processamento: pede ao servidor para continuar e buscar o relatório. */
export function useRetomarConsulta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<unknown>(`/serpro/consultas/${encodeURIComponent(id)}/retomar`, { method: "POST", body: {} }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["consultas-fiscais"] });
      qc.invalidateQueries({ queryKey: ["serpro-resumo"] });
      qc.invalidateQueries({ queryKey: ["serpro-custos"] });
    },
  });
}

/** Consulta que o gateway segurou pedindo PIN: confirma com o PIN de quem autoriza. */
export function useConfirmarConsulta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; pin: string }) =>
      api<{ consulta: ConsultaFiscal }>(`/serpro/consultas/${encodeURIComponent(args.id)}/confirmar`, {
        method: "POST",
        body: { pin: args.pin },
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["consultas-fiscais"] });
      qc.invalidateQueries({ queryKey: ["serpro-resumo"] });
      qc.invalidateQueries({ queryKey: ["serpro-custos"] });
    },
  });
}

export function useCancelarConsulta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ consulta: ConsultaFiscal }>(`/serpro/consultas/${encodeURIComponent(id)}/cancelar`, {
        method: "POST",
        body: {},
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["consultas-fiscais"] });
      qc.invalidateQueries({ queryKey: ["serpro-resumo"] });
      qc.invalidateQueries({ queryKey: ["serpro-custos"] });
    },
  });
}

/** POST /serpro/testar-autenticacao: o gateway faz o login no Serpro. */
export function useTestarLoginSerpro() {
  return useMutation({
    mutationFn: () =>
      api<{ ok: boolean; mensagem?: string; error?: string }>("/serpro/testar-autenticacao", {
        method: "POST",
        body: {},
      }),
  });
}

export const STATUS_CONSULTA_LABEL: Record<ConsultaFiscal["status"], string> = {
  pendente: "Pendente",
  ok: "Regular",
  com_pendencia: "Com pendência",
  erro: "Erro",
};

// ---------------------------------------------------------------------------
// Início (contagens)
// ---------------------------------------------------------------------------

export function useResumoInicio(euId: string | null) {
  return useQuery({
    queryKey: ["inicio", euId],
    queryFn: async () => {
      const hoje = new Date();
      const em30 = new Date(hoje.getTime() + 30 * 86_400_000);
      const iso = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const [semResp, minhas, solic, certs] = await Promise.all([
        supabase
          .from("WhatsappChat")
          .select("id", { count: "exact", head: true })
          .is("responsavelId", null)
          .is("apagadoEm", null)
          .eq("arquivado", false)
          .eq("tipo", "individual")
          .neq("atendimentoStatus", "finalizado"),
        euId
          ? supabase
              .from("WhatsappChat")
              .select("id", { count: "exact", head: true })
              .eq("responsavelId", euId)
              .eq("atendimentoStatus", "em_atendimento")
              .is("apagadoEm", null)
          : Promise.resolve({ count: 0, error: null }),
        supabase
          .from("Solicitacao")
          .select("id", { count: "exact", head: true })
          .in("status", ["aberta", "em_andamento"]),
        supabase
          .from("CertificadoDigital")
          .select("id", { count: "exact", head: true })
          .gte("validoAte", iso(hoje))
          .lte("validoAte", iso(em30)),
      ]);
      for (const r of [semResp, minhas, solic, certs]) if (r.error) throw r.error;
      return {
        semResponsavel: semResp.count ?? 0,
        minhasEmAtendimento: minhas.count ?? 0,
        solicitacoesAbertas: solic.count ?? 0,
        certificadosVencendo: certs.count ?? 0,
      };
    },
    staleTime: 30_000,
  });
}
