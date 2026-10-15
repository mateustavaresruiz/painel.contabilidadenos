// Certificados digitais dos clientes, histórico de avisos e configuração do
// aviso automático por WhatsApp (o envio em si é do cron no servidor).

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { parsePgDate } from "@/lib/format";
import { supabase } from "@/lib/supabase";

export const TIPOS_CERTIFICADO = [
  "e-CNPJ A1",
  "e-CNPJ A3",
  "e-CPF A1",
  "e-CPF A3",
  "NF-e",
  "Outro",
] as const;
export type TipoCertificado = (typeof TIPOS_CERTIFICADO)[number];

export type Certificado = {
  id: string;
  clienteId: string;
  tipo: TipoCertificado;
  titular: string | null;
  documento: string | null;
  emissora: string | null;
  emitidoEm: string | null;
  validoAte: string;
  telefoneAviso: string | null;
  avisarWhatsapp: boolean;
  observacoes: string | null;
  renovadoPorId: string | null;
  criadoEm: string;
  atualizadoEm: string;
  cliente?: { id: string; nome: string; nomeFantasia: string | null; telefone: string | null } | null;
};

export type CertificadoInput = {
  clienteId: string;
  tipo: TipoCertificado;
  titular?: string | null;
  documento?: string | null;
  emissora?: string | null;
  emitidoEm?: string | null;
  validoAte: string;
  telefoneAviso?: string | null;
  avisarWhatsapp: boolean;
  observacoes?: string | null;
};

export type StatusCertificado = "vencido" | "vencendo" | "ok";

/** Dias até o vencimento (negativo = vencido), contando em dias de calendário. */
export function diasRestantes(validoAte: string): number {
  const fim = parsePgDate(validoAte);
  if (!fim) return 0;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((fim.getTime() - hoje.getTime()) / 86_400_000);
}

export function statusCertificado(validoAte: string): StatusCertificado {
  const d = diasRestantes(validoAte);
  if (d < 0) return "vencido";
  if (d <= 30) return "vencendo";
  return "ok";
}

const SELECT = "*, cliente:Cliente(id, nome, nomeFantasia, telefone)";

export function useCertificados(filtros?: { clienteId?: string }) {
  return useQuery({
    queryKey: ["certificados", filtros ?? {}],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase
        .from("CertificadoDigital")
        .select(SELECT)
        .order("validoAte", { ascending: true })
        .limit(1000);
      if (filtros?.clienteId) q = q.eq("clienteId", filtros.clienteId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Certificado[];
    },
  });
}

function limpar(input: CertificadoInput) {
  return {
    clienteId: input.clienteId,
    tipo: input.tipo,
    titular: input.titular?.trim() || null,
    documento: input.documento ? input.documento.replace(/\D/g, "") || null : null,
    emissora: input.emissora?.trim() || null,
    emitidoEm: input.emitidoEm || null,
    validoAte: input.validoAte,
    telefoneAviso: input.telefoneAviso?.trim() || null,
    avisarWhatsapp: input.avisarWhatsapp,
    observacoes: input.observacoes?.trim() || null,
  };
}

export function useSalvarCertificado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id?: string; input: CertificadoInput }) => {
      const payload = limpar(args.input);
      if (args.id) {
        const { error } = await supabase.from("CertificadoDigital").update(payload).eq("id", args.id);
        if (error) throw error;
        return { id: args.id };
      }
      const { data, error } = await supabase
        .from("CertificadoDigital")
        .insert(payload)
        .select("id")
        .single();
      if (error) throw error;
      return data as { id: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["certificados"] });
      qc.invalidateQueries({ queryKey: ["inicio"] });
    },
  });
}

export function useExcluirCertificado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("CertificadoDigital").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["certificados"] });
      qc.invalidateQueries({ queryKey: ["inicio"] });
    },
  });
}

export type CertificadoAviso = {
  id: string;
  certificadoId: string;
  marco: number;
  telefone: string | null;
  status: "enviado" | "falhou" | "sem_telefone" | "sem_conexao";
  erro: string | null;
  mensagemId: string | null;
  criadoEm: string;
};

export const STATUS_AVISO_LABEL: Record<CertificadoAviso["status"], string> = {
  enviado: "Enviado",
  falhou: "Falhou",
  sem_telefone: "Sem telefone",
  sem_conexao: "Sem conexão",
};

export function useAvisosCertificado(certificadoId: string | undefined) {
  return useQuery({
    queryKey: ["certificado-avisos", certificadoId],
    enabled: !!certificadoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("CertificadoAviso")
        .select("*")
        .eq("certificadoId", certificadoId!)
        .order("criadoEm", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CertificadoAviso[];
    },
  });
}

// ---------------------------------------------------------------------------
// Config (chave/valor jsonb)
// ---------------------------------------------------------------------------

export const CONFIG_MARCOS = "certificado.marcos";
export const CONFIG_SESSAO = "certificado.sessaoId";
export const CONFIG_MODELO = "certificado.modelo";

export function useConfig<T>(chave: string, padrao: T) {
  return useQuery({
    queryKey: ["config", chave],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Config")
        .select("valor")
        .eq("chave", chave)
        .maybeSingle();
      if (error) throw error;
      return (data?.valor ?? padrao) as T;
    },
  });
}

export function useSalvarConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itens: Array<{ chave: string; valor: unknown }>) => {
      const agora = new Date().toISOString();
      const { error } = await supabase
        .from("Config")
        .upsert(itens.map((i) => ({ chave: i.chave, valor: i.valor, atualizadoEm: agora })));
      if (error) throw error;
    },
    onSuccess: (_d, itens) => {
      for (const i of itens) qc.invalidateQueries({ queryKey: ["config", i.chave] });
    },
  });
}

export type SimulacaoAviso = {
  certificadoId?: string;
  cliente?: string;
  tipo?: string;
  marco?: number;
  dias?: number;
  telefone?: string | null;
  mensagem?: string;
  /** Texto já montado com o modelo (nome usado pela função crons). */
  texto?: string;
  motivo?: string;
  status?: string;
  [k: string]: unknown;
};

/**
 * Pergunta ao cron o que ele mandaria HOJE, sem mandar (`dryRun=1`). A forma
 * da resposta depende da função no servidor, então a tela aceita uma lista em
 * `avisos`, `itens` ou `resultado`, ou mostra o JSON cru.
 */
export function useSimularAvisos() {
  return useMutation({
    mutationFn: async () =>
      api<unknown>("/crons/certificados-avisos?dryRun=1", { method: "POST", body: {} }),
  });
}

export function extrairListaSimulacao(res: unknown): SimulacaoAviso[] | null {
  if (Array.isArray(res)) return res as SimulacaoAviso[];
  if (res && typeof res === "object") {
    const r = res as Record<string, unknown>;
    for (const k of ["avisos", "itens", "resultado", "enviar", "items"]) {
      if (Array.isArray(r[k])) return r[k] as SimulacaoAviso[];
    }
  }
  return null;
}

/** Aplica o modelo de mensagem com os placeholders {cliente} {tipo} {data} {dias}. */
export function aplicarModelo(
  modelo: string,
  dados: { cliente: string; tipo: string; validoAte: string },
): string {
  const d = diasRestantes(dados.validoAte);
  const data = parsePgDate(dados.validoAte)?.toLocaleDateString("pt-BR") ?? dados.validoAte;
  const dias =
    d < 0 ? `venceu há ${-d} dia${d === -1 ? "" : "s"}` : d === 0 ? "vence hoje" : `faltam ${d} dia${d === 1 ? "" : "s"}`;
  return modelo
    .replaceAll("{cliente}", dados.cliente)
    .replaceAll("{tipo}", dados.tipo)
    .replaceAll("{data}", data)
    .replaceAll("{dias}", dias);
}
