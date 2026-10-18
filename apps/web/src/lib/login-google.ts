// "Entrar com Google" (docs/LOGIN.md > Login com Google).
//
// O Auth (GoTrue) faz o OAuth com o Google; o painel só pede o redirecionamento
// e, na volta (/auth/callback?code=...), troca o código pela sessão (PKCE).
// Só entra quem já existe no Auth: o cadastro público está desligado, então
// uma conta Google com e-mail desconhecido volta com erro, e uma com o mesmo
// e-mail de alguém da equipe é ligada ao usuário de sempre (mesmo id, mesmo
// Colaborador).

import { useQuery } from "@tanstack/react-query";

import { supabase, SUPABASE_URL } from "@/lib/supabase";

export type LoginConfig = {
  /** O Auth está com o provedor Google ligado (GOOGLE_ENABLED=true e credenciais). */
  google: boolean;
  /** "Entrar só com o e-mail (provisório)" ligado em Configurações > Módulos. */
  soEmail: boolean;
};

/** Pública (sem login): a tela de entrada decide se mostra o botão do Google. */
export function useLoginConfig() {
  return useQuery({
    queryKey: ["login", "config"],
    queryFn: async (): Promise<LoginConfig> => {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/entrar/config`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as Partial<LoginConfig>;
      return { google: j.google === true, soEmail: j.soEmail === true };
    },
    staleTime: 60_000,
    retry: 1,
    meta: { silencioso: true },
  });
}

/** Vai para o Google; a volta cai em /auth/callback. */
export async function entrarComGoogle(): Promise<string | null> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      // via=google: a página de volta sabe que erro e código vieram do OAuth.
      redirectTo: `${window.location.origin}/auth/callback?via=google`,
      // Sempre deixa escolher a conta (quem tem a pessoal e a do escritório).
      queryParams: { prompt: "select_account" },
    },
  });
  return error ? "Não deu para abrir o login do Google. Tente de novo." : null;
}

export const MSG_SEM_ACESSO_GOOGLE =
  "Esta conta Google não tem acesso ao painel. Peça a um administrador para cadastrar seu e-mail em Equipe.";

/**
 * Erro que o Auth devolve na URL depois do Google (query ou #fragmento) →
 * mensagem para a pessoa. `null` = não é erro do OAuth (link de e-mail).
 *   signup_disabled: e-mail que não existe no Auth (DISABLE_SIGNUP=true);
 *   user_banned: pessoa desativada em Equipe;
 *   provider_email_needs_verification: e-mail não verificado no Google.
 */
export function erroDoOAuth(params: URLSearchParams): { titulo: string; mensagem: string } | null {
  const codigo = params.get("error_code") ?? "";
  const erro = params.get("error") ?? "";
  const desc = params.get("error_description") ?? "";
  if (!codigo && !erro && !desc) return null;
  if (codigo === "signup_disabled" || /signups not allowed/i.test(desc)) {
    return { titulo: "Conta sem acesso", mensagem: MSG_SEM_ACESSO_GOOGLE };
  }
  if (codigo === "user_banned" || /banned/i.test(desc)) {
    return {
      titulo: "Acesso não liberado",
      mensagem: "Seu acesso ao painel está desativado. Fale com um administrador.",
    };
  }
  if (codigo === "provider_email_needs_verification" || /verif/i.test(desc)) {
    return {
      titulo: "E-mail não verificado",
      mensagem: "O Google não confirmou o e-mail desta conta. Use a conta do escritório ou entre pelo e-mail.",
    };
  }
  if (erro === "access_denied") {
    return { titulo: "Login cancelado", mensagem: "O login com o Google foi cancelado. Tente de novo se quiser." };
  }
  return { titulo: "Não deu para entrar", mensagem: "O login com o Google falhou. Tente de novo em instantes." };
}

/** "Entrou no painel (Google)". O banco confere no JWT que foi mesmo pelo Google. */
export async function registrarLoginGoogle(): Promise<void> {
  try {
    await supabase.rpc("registrar_login_google");
  } catch {
    /* auditoria é acessório: a entrada vale mesmo sem ela */
  }
}
