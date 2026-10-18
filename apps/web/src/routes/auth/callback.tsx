import type { EmailOtpType } from "@supabase/supabase-js";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/use-page-title";
import { useEu } from "@/lib/colaborador";
import { erroDoOAuth, registrarLoginGoogle } from "@/lib/login-google";
import { registrarLogin } from "@/lib/queries/auditoria";
import { supabase } from "@/lib/supabase";

const TIPOS: EmailOtpType[] = ["magiclink", "email", "invite", "signup", "email_change", "recovery"];

const DICA_LINK = "Cada link funciona uma vez e por 15 minutos. Peça um novo na tela de entrada.";

type Falha = { titulo: string; mensagem: string };

const linkVencido = (motivo = "O link expirou ou já foi usado."): Falha => ({
  titulo: "Não deu para entrar",
  mensagem: `${motivo} ${DICA_LINK}`,
});

/**
 * Token e código só valem uma vez, e o StrictMode roda o efeito duas vezes
 * em desenvolvimento. Guardado fora do componente para não trocar 2x.
 */
const emAndamento = new Map<string, Promise<Falha | null>>();

function umaVez(chave: string, fazer: () => Promise<Falha | null>): Promise<Falha | null> {
  let p = emAndamento.get(chave);
  if (!p) {
    p = fazer();
    emAndamento.set(chave, p);
  }
  return p;
}

function verificarToken(tokenHash: string, tipo: EmailOtpType): Promise<Falha | null> {
  return umaVez(`otp:${tokenHash}`, async () => {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: tipo });
    if (error) return linkVencido();
    await registrarLogin("link");
    return null;
  });
}

/** Volta do Google (PKCE): troca o ?code= pela sessão neste navegador. */
function trocarCodigo(codigo: string, viaGoogle: boolean): Promise<Falha | null> {
  return umaVez(`code:${codigo}`, async () => {
    const { error } = await supabase.auth.exchangeCodeForSession(codigo);
    if (!error) {
      // Um link de e-mail no formato PKCE também volta com ?code=.
      await (viaGoogle ? registrarLoginGoogle() : registrarLogin("link"));
      return null;
    }
    if (!viaGoogle) return linkVencido();
    // Sem o verificador: o login começou em outro navegador ou aba anônima.
    if (/code verifier|verifier/i.test(error.message) || error.name === "AuthPKCECodeVerifierMissingError") {
      return {
        titulo: "Não deu para entrar",
        mensagem: "Comece o login com o Google neste mesmo navegador, pela tela de entrada.",
      };
    }
    return {
      titulo: "Não deu para entrar",
      mensagem: "O login com o Google expirou ou já foi usado. Tente de novo pela tela de entrada.",
    };
  });
}

/**
 * Destino de três caminhos:
 *  - link do e-mail e link de acesso gerado em Equipe:
 *    /auth/callback?token_hash=...&type=magiclink. O token vira sessão AQUI (e
 *    não num GET do Auth), assim um antivírus que "abre" o link do e-mail não
 *    gasta o token antes da pessoa;
 *  - "Entrar com Google": /auth/callback?via=google&code=... (PKCE), ou com
 *    error/error_code/error_description quando o Auth recusou;
 *  - link antigo do próprio Auth: #access_token=...&refresh_token=...
 */
export function AuthCallbackPage() {
  usePageTitle("Entrando");
  const { sessao } = useEu();
  const [falha, setFalha] = useState<Falha | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const viaGoogle = q.get("via") === "google";
    // O Auth põe o erro na query e repete no fragmento.
    const comErro = q.get("error") || q.get("error_code") || q.get("error_description") ? q : hash;
    if (comErro.get("error") || comErro.get("error_code") || comErro.get("error_description")) {
      setFalha(viaGoogle ? erroDoOAuth(comErro) : linkVencido());
      return;
    }

    const codigo = q.get("code");
    if (codigo) {
      void trocarCodigo(codigo, viaGoogle).then(setFalha);
      return;
    }

    const tokenHash = q.get("token_hash");
    if (tokenHash) {
      const tipo = (q.get("type") ?? "magiclink") as EmailOtpType;
      if (!TIPOS.includes(tipo)) {
        setFalha(linkVencido("Link inválido."));
        return;
      }
      void verificarToken(tokenHash, tipo).then(setFalha);
      return;
    }

    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    if (accessToken && refreshToken) {
      void umaVez(`hash:${accessToken.slice(-16)}`, async () => {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (error) return linkVencido();
        window.history.replaceState(null, "", window.location.pathname);
        await registrarLogin("link");
        return null;
      }).then(setFalha);
      return;
    }

    setFalha(linkVencido("Link incompleto."));
  }, []);

  if (sessao) return <Navigate to="/" replace />;

  return (
    <div className="min-h-dvh grid place-items-center bg-background p-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 sm:p-8 space-y-5">
        <Logo className="h-12" />
        {falha ? (
          <>
            <div className="space-y-1">
              <h1 className="text-title-md">{falha.titulo}</h1>
              <p className="text-sm text-muted-foreground">{falha.mensagem}</p>
            </div>
            <Button asChild>
              <Link to="/login">Ir para a entrada</Link>
            </Button>
          </>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Entrando...
          </p>
        )}
      </div>
    </div>
  );
}
