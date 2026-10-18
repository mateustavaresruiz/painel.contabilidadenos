// Equipe e cargos. Pessoas passam pela function `equipe` (cria/atualiza o
// usuário do Auth junto, confere equipe.gerenciar); cargos são gravados
// direto na tabela, com a RLS conferindo a mesma permissão.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Cargo, Colaborador } from "@/lib/colaborador";
import { supabase } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Cargos
// ---------------------------------------------------------------------------

export function useCargos() {
  return useQuery({
    queryKey: ["cargos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Cargo")
        .select("id, nome, descricao, permissoes, sistema")
        .order("sistema", { ascending: false })
        .order("nome", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Cargo[];
    },
    staleTime: 5 * 60_000,
  });
}

export type CargoInput = { nome: string; descricao: string | null; permissoes: string[] };

export function useSalvarCargo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id?: string; input: CargoInput }) => {
      const payload = {
        nome: args.input.nome.trim(),
        descricao: args.input.descricao?.trim() || null,
        permissoes: args.input.permissoes,
      };
      const { error } = args.id
        ? await supabase.from("Cargo").update(payload).eq("id", args.id)
        : await supabase.from("Cargo").insert(payload);
      if (error) {
        if (error.code === "23505") throw new Error("Já existe um cargo com esse nome.");
        throw error;
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["cargos"] });
      void qc.invalidateQueries({ queryKey: ["eu"] });
    },
  });
}

export function useExcluirCargo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("Cargo").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cargos"] }),
  });
}

// ---------------------------------------------------------------------------
// Pessoas
// ---------------------------------------------------------------------------

export type ConviteInput = {
  nome: string;
  email: string;
  cargoId: string;
  telefone?: string | null;
  cor?: string;
};

export type ResultadoConvite = {
  colaborador: Colaborador;
  emailEnviado: boolean;
  erroEmail: string | null;
  /** Link de uso único (quando o e-mail não foi). */
  link: string | null;
};

export function useConvidar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConviteInput) =>
      api<ResultadoConvite>("/equipe/convidar", { method: "POST", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["colaboradores"] }),
  });
}

export type PessoaPatch = Partial<{
  nome: string;
  email: string;
  telefone: string | null;
  cor: string;
  cargoId: string;
  ativo: boolean;
}>;

export function useAtualizarPessoa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; patch: PessoaPatch }) =>
      api<{ colaborador: Colaborador }>(`/equipe/${args.id}`, { method: "PATCH", body: args.patch }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["colaboradores"] });
      void qc.invalidateQueries({ queryKey: ["eu"] });
    },
  });
}

export function useExcluirPessoa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/equipe/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["colaboradores"] }),
  });
}

/** Link de acesso de uso único (invalida o último enviado por e-mail). */
export function useGerarLinkAcesso() {
  return useMutation({
    mutationFn: (id: string) => api<{ link: string }>(`/equipe/${id}/link`, { method: "POST" }),
  });
}

export function useEnviarAcesso() {
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/equipe/${id}/enviar-acesso`, { method: "POST" }),
  });
}

// ---------------------------------------------------------------------------
// E-mail (SMTP)
// ---------------------------------------------------------------------------

export type EmailStatus = {
  configurado: boolean;
  host: string | null;
  porta: number;
  /** Deduzido do host (smtp.gmail.com = google). null sem host. */
  provedor?: "google" | "google-relay" | "stalwart" | "outro" | null;
  usuarioConfigurado: boolean;
  /** SMTP_PASS preenchido? null = o servidor ainda não informa. */
  senhaDefinida?: boolean | null;
  remetente: string | null;
  nomeRemetente: string | null;
  /** null = não testado (sem host). */
  portaAbre: boolean | null;
  /** Primeira linha da saudação do servidor (220 ...). */
  saudacao?: string | null;
  /** 587: oferece STARTTLS; 465: TLS direto abriu. null = não verificado. */
  tls?: boolean | null;
  erroConexao?: string | null;
  /** Problemas de configuração (frases prontas para a tela). */
  avisos?: string[];
  redeInterna: { painel_email: boolean };
};

export function useEmailStatus(enabled = true) {
  return useQuery({
    queryKey: ["equipe", "email"],
    queryFn: () => api<EmailStatus>("/equipe/email"),
    enabled,
    staleTime: 60_000,
    meta: { silencioso: true },
  });
}

export function useTestarEmail() {
  return useMutation({
    mutationFn: () => api<{ ok: true; para: string }>("/equipe/email/teste", { method: "POST" }),
  });
}
