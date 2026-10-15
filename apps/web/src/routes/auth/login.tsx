import { ArrowLeft, Loader2, Mail } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";

import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePageTitle } from "@/hooks/use-page-title";
import { useEu } from "@/lib/colaborador";
import { supabase } from "@/lib/supabase";

/** Espera para pedir outro e-mail (o Auth também recusa antes de 60 s). */
const ESPERA_REENVIO_S = 60;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Só caminho interno (evita redirecionar para outro site pelo ?next=). */
function destinoSeguro(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

/** Erro de limite do Auth (429) tem mensagem própria; o resto é genérico. */
function ehLimite(e: { status?: number; message?: string } | null): boolean {
  return !!e && (e.status === 429 || /rate limit|security purposes|too many/i.test(e.message ?? ""));
}

/**
 * Entrada sem senha: e-mail, e o Auth manda um link e um código de 6 dígitos.
 * A resposta é a mesma exista o e-mail ou não (não revela quem é da equipe).
 * Só entra quem já foi cadastrado em Equipe (sem cadastro público).
 */
export function LoginPage() {
  usePageTitle("Entrar");
  const { sessao } = useEu();
  const [params] = useSearchParams();
  const destino = destinoSeguro(params.get("next"));
  const [email, setEmail] = useState("");
  const [etapa, setEtapa] = useState<"email" | "codigo">("email");
  const [codigo, setCodigo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [espera, setEspera] = useState(0);
  const codigoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  useEffect(() => {
    if (etapa === "codigo") codigoRef.current?.focus();
  }, [etapa]);

  if (sessao) return <Navigate to={destino} replace />;

  async function pedir(e?: React.FormEvent) {
    e?.preventDefault();
    const alvo = email.trim().toLowerCase();
    if (!EMAIL_RE.test(alvo)) {
      setErro("Digite um e-mail válido.");
      return;
    }
    setErro(null);
    setEnviando(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: alvo,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setEnviando(false);
    if (ehLimite(error)) {
      setErro("Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.");
      setEspera(ESPERA_REENVIO_S);
      return;
    }
    // Qualquer outra resposta (inclusive "e-mail não cadastrado") segue igual.
    setEmail(alvo);
    setEtapa("codigo");
    setCodigo("");
    setEspera(ESPERA_REENVIO_S);
  }

  async function verificar(e: React.FormEvent) {
    e.preventDefault();
    const token = codigo.replace(/\D/g, "");
    if (token.length !== 6) {
      setErro("O código tem 6 números.");
      return;
    }
    setErro(null);
    setVerificando(true);
    const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    setVerificando(false);
    if (error) {
      setErro(
        ehLimite(error)
          ? "Muitas tentativas seguidas. Aguarde alguns minutos."
          : "Código inválido ou expirado. Confira o último e-mail ou peça outro.",
      );
    }
    // Com sucesso, a sessão nova dispara o redirecionamento (Navigate acima).
  }

  return (
    <div className="min-h-dvh grid place-items-center bg-background p-4">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 sm:p-8 animate-fade-up space-y-6">
        <Logo className="h-12" />
        {etapa === "email" ? (
          <form onSubmit={pedir} className="space-y-4" noValidate>
            <div>
              <h1 className="text-title-md">Entrar no painel</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Sem senha: enviamos um link e um código para o seu e-mail.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="login-email">E-mail</Label>
              <Input
                id="login-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@contabilidadenos.com.br"
              />
            </div>
            {erro && <p className="text-sm text-destructive">{erro}</p>}
            <Button type="submit" className="w-full" disabled={enviando || espera > 0}>
              {enviando ? <Loader2 className="animate-spin" /> : <Mail />}
              {espera > 0 ? `Aguarde ${espera} s` : "Receber link e código"}
            </Button>
          </form>
        ) : (
          <form onSubmit={verificar} className="space-y-4" noValidate>
            <div>
              <h1 className="text-title-md">Confira seu e-mail</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Se <strong className="text-foreground">{email}</strong> tiver acesso ao painel, enviamos um link e
                um código. Clique no link ou digite o código abaixo. Vale por 15 minutos.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="login-codigo">Código de 6 números</Label>
              <Input
                id="login-codigo"
                ref={codigoRef}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                className="text-center text-lg tracking-[0.4em]"
              />
            </div>
            {erro && <p className="text-sm text-destructive">{erro}</p>}
            <Button type="submit" className="w-full" disabled={verificando}>
              {verificando && <Loader2 className="animate-spin" />}
              Entrar
            </Button>
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEtapa("email");
                  setErro(null);
                }}
              >
                <ArrowLeft />
                Outro e-mail
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={espera > 0 || enviando}
                onClick={() => void pedir()}
              >
                {espera > 0 ? `Reenviar em ${espera} s` : "Reenviar"}
              </Button>
            </div>
            <p className="text-2xs text-muted-foreground">
              Não chegou? Olhe o spam. Se ainda assim não vier, peça a um administrador um link de acesso em Equipe.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
