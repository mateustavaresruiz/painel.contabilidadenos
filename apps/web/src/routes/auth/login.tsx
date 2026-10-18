import "altcha";
import { ArrowLeft, ArrowRight, Loader2, Lock, Mail } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePageTitle } from "@/hooks/use-page-title";
import googleG from "@/assets/google-g.svg?raw";
import { useEu } from "@/lib/colaborador";
import { entrarComGoogle, useLoginConfig } from "@/lib/login-google";
import { registrarLogin } from "@/lib/queries/auditoria";
import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase";
import { cn } from "@/lib/utils";

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
async function entrarDireto(email: string, altcha: string): Promise<Resposta> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/entrar`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, altcha }),
  }).catch(() => null);
  if (!r) return { tipo: "erro", mensagem: "Sem conexão com o servidor. Tente de novo." };
  const j = (await r.json().catch(() => ({}))) as { token_hash?: string; error?: string };
  if (r.ok && j.token_hash) return { tipo: "token", tokenHash: j.token_hash };
  if (r.status === 403 && /desligada/i.test(j.error ?? "")) return { tipo: "desligado" };
  if (r.status === 429) return { tipo: "erro", mensagem: "Muitas tentativas. Espere alguns minutos." };
  if (r.status === 403 && /anti-rob/i.test(j.error ?? "")) return { tipo: "erro", mensagem: j.error ?? "Verificação anti-robô falhou." };
  if (r.status === 403) return { tipo: "erro", mensagem: "Este e-mail não tem acesso ao painel. Fale com um administrador." };
  return { tipo: "erro", mensagem: j.error ?? "Não deu para entrar agora. Tente de novo." };
}

/** Mensagens que se revezam sobre a foto. Curtas, sem prometer recurso. */
const MENSAGENS = [
  "Organização é o que transforma números em tranquilidade.",
  "Cada cliente bem atendido começa por aqui.",
  "Menos papel, mais conversa.",
  "O escritório inteiro no mesmo ritmo.",
];
const TROCA_MS = 6000;

/** Textos do widget anti-robô (ALTCHA) em português. */
const ALTCHA_TEXTOS = JSON.stringify({
  label: "Não sou um robô",
  verifying: "Verificando...",
  verified: "Verificado",
  error: "Falhou. Tente de novo.",
  expired: "Expirou. Tente de novo.",
  waitAlert: "Verificando, aguarde...",
  ariaLinkLabel: "ALTCHA",
});

type WidgetAltcha = HTMLElement & { reset: () => void; verify: () => Promise<void> };

function saudacao(): string {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

/**
 * Botão "Entrar com Google" pelas regras de marca do Google: fundo branco,
 * borda #747775, texto #1F1F1F, logo "G" oficial (src/assets/google-g.svg,
 * do kit "Sign in with Google") à esquerda. Fica branco também no tema
 * escuro (as regras aceitam o botão claro sobre fundo escuro).
 */
function BotaoGoogle({ onErro }: { onErro: (msg: string) => void }) {
  const [indo, setIndo] = useState(false);
  return (
    <button
      type="button"
      disabled={indo}
      onClick={async () => {
        setIndo(true);
        const erro = await entrarComGoogle();
        // Com sucesso o navegador já está indo para o Google.
        if (erro) {
          onErro(erro);
          setIndo(false);
        }
      }}
      className={cn(
        "login-botao flex h-12 w-full items-center justify-center gap-3 rounded-full border border-[#747775] bg-white px-4",
        "text-[15px] font-medium text-[#1F1F1F] transition-[transform,background-color] hover:bg-[#F8F9FA]",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15 disabled:opacity-60",
      )}
    >
      {indo ? (
        <Loader2 className="size-5 animate-spin text-[#1F1F1F]" />
      ) : (
        <span className="inline-flex size-5 shrink-0" dangerouslySetInnerHTML={{ __html: googleG }} />
      )}
      Entrar com Google
    </button>
  );
}

/** Atraso em cascata para a entrada dos blocos. */
const cascata = (n: number) => ({ animationDelay: `${120 + n * 70}ms` });

/**
 * Efeitos desta tela (só ela usa, por isso não estão no index.css).
 * Tudo para com prefers-reduced-motion.
 */
const ESTILO = `
@keyframes login-zoom { from { transform: scale(1.08); } to { transform: scale(1); } }
@keyframes login-sobe { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes login-msg {
  0% { opacity: 0; transform: translateY(8px); }
  10%, 88% { opacity: 1; transform: none; }
  100% { opacity: 0; transform: translateY(-6px); }
}
.login-foto { animation: login-zoom 24s cubic-bezier(.16,1,.3,1) both; }
.login-sobe { animation: login-sobe .6s cubic-bezier(.16,1,.3,1) both; }
.login-msg { animation: login-msg ${TROCA_MS}ms ease-in-out both; }
.login-seta { transition: transform .2s cubic-bezier(.16,1,.3,1); }
.login-botao:hover .login-seta { transform: translateX(3px); }
.login-botao:active { transform: scale(.97); }
.login-altcha altcha-widget {
  --altcha-max-width: 100%;
  --altcha-border-width: 1px;
  --altcha-border-radius: 18px;
  --altcha-color-base: var(--card);
  --altcha-color-border: var(--border);
  --altcha-color-text: var(--foreground);
  --altcha-color-border-focus: var(--primary);
  --altcha-color-active: var(--primary);
  --altcha-color-error-text: var(--destructive);
  font-size: 14px;
}
@media (prefers-reduced-motion: reduce) {
  .login-foto, .login-sobe, .login-msg { animation: none; }
}
`;

function useMensagem(): number {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % MENSAGENS.length), TROCA_MS);
    return () => clearInterval(t);
  }, []);
  return i;
}

/** Metade esquerda: foto do prédio, logo em branco e mensagem que se reveza. */
function PainelFoto() {
  const i = useMensagem();
  return (
    <aside className="relative hidden lg:block overflow-hidden bg-[#0b1a2b]">
      <img
        src="/login-predio.jpg"
        alt=""
        aria-hidden
        className="login-foto absolute inset-0 h-full w-full object-cover"
      />
      {/* Véu para o texto ler bem sobre a foto (funcional, não decoração). */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-black/25" aria-hidden />
      <div className="relative z-10 flex h-full flex-col justify-between p-12">
        <img src="/logo-branco.png" alt="NÓS Contabilidade" className="h-14 w-auto self-start" />
        <div className="max-w-md space-y-5">
          <p key={i} className="login-msg text-title-xl font-semibold text-white">
            {MENSAGENS[i]}
          </p>
          <div className="flex gap-1.5" aria-hidden>
            {MENSAGENS.map((m, n) => (
              <span
                key={m}
                className={cn(
                  "h-[3px] rounded-full transition-all duration-500",
                  n === i ? "w-8 bg-white" : "w-3 bg-white/40",
                )}
              />
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

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
  const altchaRef = useRef<WidgetAltcha>(null);
  const [altcha, setAltcha] = useState("");
  // Sem resposta (ou Google desligado no Auth), o botão simplesmente não aparece.
  const google = useLoginConfig().data?.google === true;

  // O widget avisa quando resolveu o desafio (prova de trabalho no navegador).
  useEffect(() => {
    const el = altchaRef.current;
    if (!el) return;
    const ouvir = (ev: Event) => {
      const d = (ev as CustomEvent<{ state: string; payload?: string }>).detail;
      setAltcha(d.state === "verified" && d.payload ? d.payload : "");
    };
    el.addEventListener("statechange", ouvir);
    return () => el.removeEventListener("statechange", ouvir);
  }, [etapa]);

  /** Cada desafio vale uma vez: depois de tentar, pede outro. */
  function novoDesafio() {
    setAltcha("");
    const el = altchaRef.current;
    if (!el) return;
    el.reset();
    void el.verify();
  }

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
    if (!altcha) {
      setErro("Aguarde a verificação anti-robô terminar.");
      return;
    }
    setErro(null);
    setEnviando(true);
    setEmail(alvo);
    try {
      const r = await entrarDireto(alvo, altcha);
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
      novoDesafio();
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
    } else {
      void registrarLogin("codigo");
    }
  }

  return (
    <div className="min-h-dvh grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] bg-background">
      <style>{ESTILO}</style>
      <PainelFoto />

      <main className="flex flex-col px-6 pb-8 pt-10 max-lg:pt-0 sm:px-10">
        <div className="flex flex-1 items-start justify-center lg:items-center">
          <div className="w-full max-w-[380px]">
            {/* Celular: a foto vira uma faixa no topo, com a logo em branco. */}
            <div className="lg:hidden -mx-6 mb-9 sm:-mx-10 relative h-60 overflow-hidden rounded-b-[28px] bg-[#0b1a2b]">
              <img src="/login-predio.jpg" alt="" aria-hidden className="login-foto absolute inset-0 h-full w-full object-cover object-[50%_35%]" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-black/20" aria-hidden />
              <img src="/logo-branco.png" alt="NÓS Contabilidade" className="login-sobe absolute bottom-6 left-6 h-12 w-auto" style={cascata(0)} />
            </div>

            {etapa === "email" ? (
              <form onSubmit={entrar} className="space-y-7" noValidate>
                <div className="space-y-2">
                  <p className="login-sobe text-[15px] text-muted-foreground" style={cascata(0)}>
                    {saudacao()}
                  </p>
                  <h1 className="login-sobe text-title-xl" style={cascata(1)}>
                    Entrar no painel
                  </h1>
                </div>

                <div className="login-sobe space-y-2" style={cascata(2)}>
                  <Label htmlFor="login-email">E-mail</Label>
                  <div className="relative">
                    <Mail
                      className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground"
                      strokeWidth={1.5}
                      aria-hidden
                    />
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
                      className={cn(
                        "h-12 rounded-full pl-11 pr-4 text-[15px] toque:text-base transition-shadow",
                        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15 focus-visible:border-primary",
                        erro && "border-destructive focus-visible:ring-destructive/15 focus-visible:border-destructive",
                      )}
                      aria-invalid={!!erro}
                      aria-describedby={erro ? "login-erro" : undefined}
                    />
                  </div>
                  {erro && (
                    <p id="login-erro" role="alert" className="login-sobe pl-4 text-sm text-destructive">
                      {erro}
                    </p>
                  )}
                </div>

                <div className="login-sobe login-altcha" style={cascata(3)}>
                  <altcha-widget
                    ref={altchaRef}
                    challengeurl={SUPABASE_URL + "/functions/v1/entrar"}
                    auto="onload"
                    hidefooter
                    hidelogo
                    strings={ALTCHA_TEXTOS}
                  />
                </div>

                <div className="login-sobe" style={cascata(4)}>
                  <Button
                    type="submit"
                    className="login-botao h-12 w-full rounded-full text-[15px] transition-transform"
                    disabled={enviando || espera > 0 || !altcha}
                  >
                    {enviando ? <Loader2 className="animate-spin" /> : null}
                    {espera > 0 ? `Aguarde ${espera} s` : enviando ? "Entrando" : "Entrar"}
                    {!enviando && espera === 0 && <ArrowRight className="login-seta" />}
                  </Button>
                </div>

                {google && (
                  <div className="login-sobe space-y-4" style={cascata(5)}>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
                      <span className="h-px flex-1 bg-border" />
                      ou
                      <span className="h-px flex-1 bg-border" />
                    </div>
                    <BotaoGoogle onErro={setErro} />
                  </div>
                )}
              </form>
            ) : (
              <form onSubmit={verificar} className="space-y-7" noValidate>
                <div className="space-y-2">
                  <h1 className="login-sobe text-title-xl" style={cascata(0)}>
                    Confira seu e-mail
                  </h1>
                  <p className="login-sobe text-[15px] text-muted-foreground" style={cascata(1)}>
                    Se <span className="font-semibold text-foreground">{email}</span> tiver acesso, enviamos um link e
                    um código. Vale por 15 minutos.
                  </p>
                </div>
                <div className="login-sobe space-y-2" style={cascata(2)}>
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
                    className="h-14 rounded-[18px] text-center text-title-md tracking-[0.5em] tabular-nums focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15"
                  />
                  {erro && (
                    <p role="alert" className="text-sm text-destructive">
                      {erro}
                    </p>
                  )}
                </div>
                <div className="login-sobe space-y-3" style={cascata(3)}>
                  <Button
                    type="submit"
                    className="login-botao h-12 w-full rounded-full text-[15px] transition-transform"
                    disabled={verificando}
                  >
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
                </div>
              </form>
            )}
          </div>
        </div>

        <p
          className="login-sobe flex items-center justify-center gap-1.5 text-2xs text-muted-foreground"
          style={cascata(5)}
        >
          <Lock className="size-3" strokeWidth={1.5} aria-hidden />
          Acesso restrito à equipe da NÓS Contabilidade
        </p>
      </main>
    </div>
  );
}
