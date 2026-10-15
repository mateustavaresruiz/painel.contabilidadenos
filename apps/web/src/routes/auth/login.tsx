import { ArrowLeft, ArrowRight, BadgeCheck, ClipboardList, Loader2, MessageCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";

import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePageTitle } from "@/hooks/use-page-title";
import { useEu } from "@/lib/colaborador";
import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase";

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

type Resposta =
  | { tipo: "token"; tokenHash: string }
  | { tipo: "desligado" }
  | { tipo: "erro"; mensagem: string };

/**
 * Entrada só com o e-mail (Edge Function `entrar`), enquanto o e-mail do
 * painel não funciona. Desligada em Configurações > Módulos, a função responde
 * 403 "desligada" e a tela cai no fluxo normal de link + código por e-mail.
 */
async function entrarDireto(email: string): Promise<Resposta> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/entrar`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  }).catch(() => null);
  if (!r) return { tipo: "erro", mensagem: "Sem conexão com o servidor. Tente de novo." };
  const j = (await r.json().catch(() => ({}))) as { token_hash?: string; error?: string };
  if (r.ok && j.token_hash) return { tipo: "token", tokenHash: j.token_hash };
  if (r.status === 403 && /desligada/i.test(j.error ?? "")) return { tipo: "desligado" };
  if (r.status === 429) return { tipo: "erro", mensagem: "Muitas tentativas. Espere alguns minutos." };
  if (r.status === 403) return { tipo: "erro", mensagem: "Este e-mail não tem acesso ao painel. Fale com um administrador." };
  return { tipo: "erro", mensagem: j.error ?? "Não deu para entrar agora. Tente de novo." };
}

const DESTAQUES = [
  { icone: MessageCircle, texto: "WhatsApp da equipe com responsável e transferência" },
  { icone: ClipboardList, texto: "Chamados abertos direto da conversa" },
  { icone: BadgeCheck, texto: "Certificados e pendências fiscais sob controle" },
];

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

  /** Fluxo por e-mail: o Auth manda link + código. */
  async function pedirPorEmail(alvo: string) {
    const { error } = await supabase.auth.signInWithOtp({
      email: alvo,
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (ehLimite(error)) {
      setErro("Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.");
      setEspera(ESPERA_REENVIO_S);
      return;
    }
    // Qualquer outra resposta (inclusive "e-mail não cadastrado") segue igual.
    setEtapa("codigo");
    setCodigo("");
    setEspera(ESPERA_REENVIO_S);
  }

  async function entrar(e?: React.FormEvent) {
    e?.preventDefault();
    const alvo = email.trim().toLowerCase();
    if (!EMAIL_RE.test(alvo)) {
      setErro("Digite um e-mail válido.");
      return;
    }
    setErro(null);
    setEnviando(true);
    setEmail(alvo);
    try {
      const r = await entrarDireto(alvo);
      if (r.tipo === "token") {
        const { error } = await supabase.auth.verifyOtp({ token_hash: r.tokenHash, type: "magiclink" });
        if (error) setErro("Não deu para entrar agora. Tente de novo.");
        // Com sucesso, a sessão nova dispara o Navigate acima.
      } else if (r.tipo === "desligado") {
        await pedirPorEmail(alvo);
      } else {
        setErro(r.mensagem);
      }
    } finally {
      setEnviando(false);
    }
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
  }

  return (
    <div className="min-h-dvh grid lg:grid-cols-[1.05fr_1fr] bg-background">
      {/* Lado da marca (só no desktop) */}
      <aside className="hidden lg:flex flex-col justify-between bg-muted px-14 py-12 border-r border-border">
        <Logo className="h-11" />
        <div className="max-w-md space-y-8 animate-fade-up">
          <h2 className="text-title-xl text-foreground">
            O escritório inteiro
            <br />
            num lugar só.
          </h2>
          <ul className="space-y-4">
            {DESTAQUES.map(({ icone: Icone, texto }) => (
              <li key={texto} className="flex items-center gap-3 text-[15px] text-muted-foreground">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-card border border-border">
                  <Icone className="size-4 text-primary" strokeWidth={1.5} />
                </span>
                {texto}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-2xs text-muted-foreground">NÓS Contabilidade · Painel interno</p>
      </aside>

      {/* Formulário */}
      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[360px] space-y-8 animate-fade-up">
          <Logo className="h-11 lg:hidden" />

          {etapa === "email" ? (
            <form onSubmit={entrar} className="space-y-6" noValidate>
              <div className="space-y-2">
                <h1 className="text-title-lg">Entrar</h1>
                <p className="text-[15px] text-muted-foreground">Use o e-mail cadastrado pela sua equipe.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-email">E-mail</Label>
                <Input
                  id="login-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (erro) setErro(null);
                  }}
                  placeholder="voce@contabilidadenos.com.br"
                  className="h-11 text-[15px]"
                  aria-invalid={!!erro}
                  aria-describedby={erro ? "login-erro" : undefined}
                />
                {erro && (
                  <p id="login-erro" role="alert" className="text-sm text-destructive">
                    {erro}
                  </p>
                )}
              </div>
              <Button type="submit" className="w-full h-11 text-[15px]" disabled={enviando || espera > 0}>
                {enviando ? (
                  <Loader2 className="animate-spin" />
                ) : espera > 0 ? null : (
                  <ArrowRight />
                )}
                {espera > 0 ? `Aguarde ${espera} s` : enviando ? "Entrando" : "Entrar"}
              </Button>
            </form>
          ) : (
            <form onSubmit={verificar} className="space-y-6" noValidate>
              <div className="space-y-2">
                <h1 className="text-title-lg">Confira seu e-mail</h1>
                <p className="text-[15px] text-muted-foreground">
                  Se <span className="text-foreground font-semibold">{email}</span> tiver acesso, enviamos um link e um
                  código. Vale por 15 minutos.
                </p>
              </div>
              <div className="space-y-2">
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
                  className="h-12 text-center text-title-md tracking-[0.5em] tabular-nums"
                />
                {erro && (
                  <p role="alert" className="text-sm text-destructive">
                    {erro}
                  </p>
                )}
              </div>
              <Button type="submit" className="w-full h-11 text-[15px]" disabled={verificando}>
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
                  onClick={() => void pedirPorEmail(email)}
                >
                  {espera > 0 ? `Reenviar em ${espera} s` : "Reenviar"}
                </Button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
