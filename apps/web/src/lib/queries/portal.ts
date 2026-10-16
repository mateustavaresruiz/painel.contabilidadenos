// Portal do cliente, lado do ESCRITÓRIO: tudo passa pela Edge Function `portal`
// (JWT do colaborador + permissão portal.gerenciar). O navegador não lê a tabela
// de links; o link e a senha em claro só existem na resposta de "gerar" e de
// "regenerar senha", uma vez, e não são guardados em lugar nenhum.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";

export type PortalLink = {
  id: string;
  criadoEm: string;
  expiresAt: string | null;
  revogadoEm: string | null;
  ultimoAcessoEm: string | null;
  acessos: number;
  bloqueadoAte: string | null;
  criadoPorNome: string | null;
};

export type PortalDoCliente = { tokens: PortalLink[]; mostrarSituacaoFiscal: boolean };

export type SituacaoLink = "ativo" | "expirado" | "revogado" | "bloqueado" | "nenhum";

export function situacaoDoLink(l: PortalLink | undefined, agora = Date.now()): SituacaoLink {
  if (!l) return "nenhum";
  if (l.revogadoEm) return "revogado";
  if (l.expiresAt && new Date(l.expiresAt).getTime() <= agora) return "expirado";
  if (l.bloqueadoAte && new Date(l.bloqueadoAte).getTime() > agora) return "bloqueado";
  return "ativo";
}

const chave = (clienteId: string) => ["portal-cliente", clienteId] as const;

export function usePortalDoCliente(clienteId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: chave(clienteId ?? ""),
    enabled: !!clienteId && enabled,
    queryFn: () => api<PortalDoCliente>(`/portal/cliente/${clienteId}/tokens`),
    staleTime: 15_000,
  });
}

/** Validade do link: dias ou `null` (sem expiração). */
export type ValidadePortal = 7 | 30 | 90 | null;

export function useGerarPortal(clienteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (validadeDias: ValidadePortal) =>
      api<{ token: string; senha: string; link: string; expiresAt: string | null }>(`/portal/cliente/${clienteId}/gerar`, {
        method: "POST",
        body: { validadeDias },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: chave(clienteId) }),
  });
}

export function useRegenerarSenhaPortal(clienteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ senha: string }>(`/portal/cliente/${clienteId}/regenerar-senha`, { method: "POST", body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: chave(clienteId) }),
  });
}

export function useRevogarPortal(clienteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ ok: true }>(`/portal/cliente/${clienteId}/revogar`, { method: "POST", body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: chave(clienteId) }),
  });
}

export function useConfigPortal(clienteId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mostrarSituacaoFiscal: boolean) =>
      api<{ ok: true; mostrarSituacaoFiscal: boolean }>(`/portal/cliente/${clienteId}/config`, { method: "POST", body: { mostrarSituacaoFiscal } }),
    onMutate: async (valor) => {
      await qc.cancelQueries({ queryKey: chave(clienteId) });
      const anterior = qc.getQueryData<PortalDoCliente>(chave(clienteId));
      if (anterior) qc.setQueryData(chave(clienteId), { ...anterior, mostrarSituacaoFiscal: valor });
      return { anterior };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.anterior) qc.setQueryData(chave(clienteId), ctx.anterior);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: chave(clienteId) }),
  });
}

/** Mensagem do WhatsApp com o link. A senha NÃO vai junto: segue separada. */
export function mensagemLinkPortal(nome: string, link: string): string {
  const primeiro = nome.trim().split(/\s+/)[0] ?? nome;
  return [
    `Olá, ${primeiro}! Este é o link do seu Portal do Cliente da NÓS Contabilidade, onde você acompanha seus chamados e certificados e pode pedir qualquer coisa à nossa equipe:`,
    "",
    link,
    "",
    "Por segurança, a senha de acesso vai separada. Se ainda não recebeu, é só pedir por aqui.",
  ].join("\n");
}
