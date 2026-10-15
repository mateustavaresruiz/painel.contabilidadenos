import type { EmailOtpType } from "@supabase/supabase-js";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/use-page-title";
import { useEu } from "@/lib/colaborador";
import { supabase } from "@/lib/supabase";

const TIPOS: EmailOtpType[] = ["magiclink", "email", "invite", "signup", "email_change", "recovery"];

/**
 * O token só pode ser usado uma vez, e o StrictMode roda o efeito duas vezes
 * em desenvolvimento. Guardado fora do componente para não verificar 2x.
 */
const emAndamento = new Map<string, Promise<string | null>>();

function verificarUmaVez(tokenHash: string, tipo: EmailOtpType): Promise<string | null> {
  let p = emAndamento.get(tokenHash);
  if (!p) {
    p = supabase.auth
      .verifyOtp({ token_hash: tokenHash, type: tipo })
      .then(({ error }) => (error ? error.message : null));
    emAndamento.set(tokenHash, p);
  }
  return p;
}

/**
 * Destino do link do e-mail e do link de acesso gerado em Equipe:
 * /auth/callback?token_hash=...&type=magiclink. O token vira sessão AQUI (e
 * não num GET do Auth), assim um antivírus que "abre" o link do e-mail não
 * gasta o token antes da pessoa.
 */
export function AuthCallbackPage() {
  usePageTitle("Entrando");
  const { sessao } = useEu();
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (q.get("error_description") ?? hash.get("error_description")) {
      setErro("O link expirou ou já foi usado.");
      return;
    }
    const tokenHash = q.get("token_hash");
    const tipo = (q.get("type") ?? "magiclink") as EmailOtpType;
    if (!tokenHash) {
      // Link do próprio Auth (#access_token=...): o supabase-js lê sozinho.
      if (!hash.get("access_token")) setErro("Link incompleto.");
      return;
    }
    if (!TIPOS.includes(tipo)) {
      setErro("Link inválido.");
      return;
    }
    void verificarUmaVez(tokenHash, tipo).then((msg) => {
      if (msg) setErro("O link expirou ou já foi usado.");
    });
  }, []);

  if (sessao) return <Navigate to="/" replace />;

  return (
    <div className="min-h-dvh grid place-items-center bg-background p-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 sm:p-8 space-y-5">
        <Logo className="h-12" />
        {erro ? (
          <>
            <div className="space-y-1">
              <h1 className="text-title-md">Não deu para entrar</h1>
              <p className="text-sm text-muted-foreground">
                {erro} Cada link funciona uma vez e por 15 minutos. Peça um novo na tela de entrada.
              </p>
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
