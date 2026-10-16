// Portal do cliente: página PÚBLICA /portal/:token (fora do menu e do login do painel).
// O link é protegido por token + senha (Edge Function `portal`). Tudo que vem do
// servidor, inclusive texto digitado pelo cliente, é desenhado como TEXTO pelo React
// (nunca dangerouslySetInnerHTML), então HTML/script digitado vira texto inerte.

import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock,
  Eye,
  EyeOff,
  FileBadge2,
  LinkIcon,
  LockKeyhole,
  MapPin,
  MessageCircle,
  Send,
  ShieldCheck,
  ShieldOff,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useParams } from "react-router-dom";

import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { corModulo, type CorModulo } from "@/lib/cores-modulo";
import {
  chaveSenhaPortal,
  dataBR,
  numeroWhatsappLink,
  portalCarregar,
  portalSolicitar,
  portalVerificar,
  type CertificadoPortal,
  type ChamadoPortal,
  type DadosPortal,
} from "@/lib/portal-publico";
import { cn } from "@/lib/utils";

type Fase =
  | { t: "carregando" }
  | { t: "indisponivel" }
  | { t: "senha"; erro?: string }
  | { t: "limite"; mensagem: string }
  | { t: "falha"; mensagem: string }
  | { t: "ok"; dados: DadosPortal };

function lerSenhaSalva(token: string): string {
  try {
    return sessionStorage.getItem(chaveSenhaPortal(token)) ?? "";
  } catch {
    return "";
  }
}
function gravarSenha(token: string, senha: string | null) {
  try {
    if (senha) sessionStorage.setItem(chaveSenhaPortal(token), senha);
    else sessionStorage.removeItem(chaveSenhaPortal(token));
  } catch {
    /* navegador sem sessionStorage: a senha só vale até recarregar */
  }
}

/** Página sem robôs, sem Referer e com título próprio enquanto está aberta. */
function useCabecalhoPublico() {
  useEffect(() => {
    const titulo = document.title;
    document.title = "Portal do cliente · NÓS Contabilidade";
    const metas: HTMLMetaElement[] = [];
    for (const [name, content] of [
      ["robots", "noindex, nofollow, noarchive"],
      ["referrer", "no-referrer"],
    ] as const) {
      const m = document.createElement("meta");
      m.name = name;
      m.content = content;
      document.head.appendChild(m);
      metas.push(m);
    }
    return () => {
      document.title = titulo;
      metas.forEach((m) => m.remove());
    };
  }, []);
}

export function PortalPublicoPage() {
  const { token = "" } = useParams<{ token: string }>();
  useCabecalhoPublico();
  const [fase, setFase] = useState<Fase>({ t: "carregando" });
  const senhaRef = useRef<string>(lerSenhaSalva(token));

  const carregar = useCallback(
    async (senha: string, silencioso = false) => {
      if (!silencioso) setFase({ t: "carregando" });
      const r = await portalCarregar(token, senha || undefined);
      switch (r.tipo) {
        case "ok":
          senhaRef.current = senha;
          setFase({ t: "ok", dados: r.dados });
          break;
        case "senha":
          gravarSenha(token, null);
          senhaRef.current = "";
          setFase({ t: "senha", erro: senha ? r.mensagem : undefined });
          break;
        case "indisponivel":
          gravarSenha(token, null);
          setFase({ t: "indisponivel" });
          break;
        case "limite":
          setFase({ t: "limite", mensagem: r.mensagem });
          break;
        default:
          setFase({ t: "falha", mensagem: r.tipo === "falha" || r.tipo === "invalido" ? r.mensagem : "Não foi possível carregar." });
      }
    },
    [token],
  );

  useEffect(() => {
    void carregar(senhaRef.current);
  }, [carregar]);

  async function entrar(senha: string): Promise<string | null> {
    const v = await portalVerificar(token, senha);
    if (v.tipo === "ok") {
      gravarSenha(token, senha);
      await carregar(senha);
      return null;
    }
    if (v.tipo === "indisponivel") {
      setFase({ t: "indisponivel" });
      return null;
    }
    if (v.tipo === "limite") {
      setFase({ t: "limite", mensagem: v.mensagem });
      return null;
    }
    return v.tipo === "senha" || v.tipo === "falha" || v.tipo === "invalido" ? v.mensagem : "Não foi possível conferir a senha.";
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[360px] bg-[linear-gradient(180deg,var(--brand-soft),transparent)] opacity-80" />
      <div className="relative mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 pb-safe-b pt-safe-t sm:px-6">
        <Topo />
        <main className="flex flex-1 flex-col pb-10" id="conteudo">
          {fase.t === "carregando" && <Carregando />}
          {fase.t === "indisponivel" && <Indisponivel />}
          {fase.t === "limite" && <Aviso icone={ShieldOff} titulo="Acesso temporariamente bloqueado" texto={fase.mensagem} acao={<Button variant="outline" onClick={() => void carregar(senhaRef.current)}>Tentar de novo</Button>} />}
          {fase.t === "falha" && <Aviso icone={AlertTriangle} titulo="Não foi possível abrir" texto={fase.mensagem} acao={<Button onClick={() => void carregar(senhaRef.current)}>Tentar de novo</Button>} />}
          {fase.t === "senha" && <TelaSenha erroInicial={fase.erro} onEntrar={entrar} />}
          {fase.t === "ok" && <Painel dados={fase.dados} token={token} senha={senhaRef.current} recarregar={() => carregar(senhaRef.current, true)} />}
        </main>
        <Rodape dados={fase.t === "ok" ? fase.dados : null} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estrutura
// ---------------------------------------------------------------------------
function Topo() {
  return (
    <header className="flex items-center justify-between gap-3 py-4 sm:py-6">
      <Logo className="h-10 sm:h-12" />
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border bg-card/80 px-3 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur max-[380px]:hidden">
          <ShieldCheck className="size-3.5 text-success" aria-hidden />
          Acesso seguro
        </span>
        <ThemeToggle />
      </div>
    </header>
  );
}

function Rodape({ dados }: { dados: DadosPortal | null }) {
  return (
    <footer className="border-t py-6 text-center text-xs leading-relaxed text-muted-foreground">
      <p>{dados ? dados.escritorio.nome : "NÓS Contabilidade"} · Portal do cliente</p>
      {dados?.linkExpiraEm ? <p>Este link vale até {dataBR(dados.linkExpiraEm)}.</p> : null}
      <p className="mt-1">Não compartilhe este link nem a senha com outras pessoas.</p>
    </footer>
  );
}

function Carregando() {
  return (
    <div className="space-y-4 pt-2" role="status" aria-live="polite" aria-label="Carregando seu portal">
      <div className="h-44 animate-pulse rounded-card bg-muted" />
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-card bg-muted" />
        ))}
      </div>
      <div className="h-40 animate-pulse rounded-card bg-muted" />
    </div>
  );
}

function Aviso({ icone: Icone, titulo, texto, acao }: { icone: LucideIcon; titulo: string; texto: string; acao?: ReactNode }) {
  return (
    <div className="m-auto w-full max-w-md py-10 text-center">
      <div className="mx-auto mb-5 grid size-16 place-items-center rounded-full bg-brand-soft text-brand dark:text-primary">
        <Icone className="size-7" aria-hidden />
      </div>
      <h1 className="text-xl font-bold tracking-[-0.015em] sm:text-2xl">{titulo}</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground [text-wrap:pretty]">{texto}</p>
      {acao ? <div className="mt-6 flex justify-center">{acao}</div> : null}
    </div>
  );
}

/** Link inválido, vencido, revogado ou módulo desligado: a mesma tela para todos. */
function Indisponivel() {
  return (
    <Aviso
      icone={LinkIcon}
      titulo="Este link não está disponível"
      texto="O endereço pode ter expirado ou sido substituído. Peça um novo link ao seu contador na NÓS Contabilidade."
    />
  );
}

// ---------------------------------------------------------------------------
// Senha
// ---------------------------------------------------------------------------
function TelaSenha({ erroInicial, onEntrar }: { erroInicial?: string; onEntrar: (senha: string) => Promise<string | null> }) {
  const [senha, setSenha] = useState("");
  const [ver, setVer] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(erroInicial ?? null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const limpa = senha.trim();
    if (!limpa || enviando) return;
    setEnviando(true);
    setErro(null);
    const msg = await onEntrar(limpa);
    // Se entrou, o componente é desmontado; só volta aqui quando deu erro.
    setEnviando(false);
    if (msg) setErro(msg);
  }

  return (
    <div className="m-auto w-full max-w-md py-8">
      <form onSubmit={enviar} className="rounded-card border bg-card p-6 shadow-card sm:p-8" noValidate>
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-brand text-brand-foreground shadow-card">
          <LockKeyhole className="size-6" aria-hidden />
        </div>
        <h1 className="text-center text-xl font-bold tracking-[-0.015em] sm:text-2xl">Portal do cliente</h1>
        <p className="mx-auto mt-2 max-w-xs text-center text-sm leading-relaxed text-muted-foreground [text-wrap:pretty]">
          Digite a senha que a equipe da NÓS Contabilidade enviou para você. Ela chega em uma mensagem separada do link.
        </p>

        <label htmlFor="senha-portal" className="mt-6 block text-sm font-medium">
          Senha de acesso
        </label>
        <div className="relative mt-1.5">
          <Input
            id="senha-portal"
            type={ver ? "text" : "password"}
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={128}
            autoFocus
            aria-invalid={!!erro}
            aria-describedby={erro ? "erro-senha" : undefined}
            className="h-12 pr-12 text-base tracking-wide"
            placeholder="••••••••••••"
          />
          <button
            type="button"
            onClick={() => setVer((v) => !v)}
            aria-label={ver ? "Esconder a senha" : "Mostrar a senha"}
            aria-pressed={ver}
            className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:text-foreground"
          >
            {ver ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        {erro ? (
          <p id="erro-senha" role="alert" className="mt-2 flex items-start gap-1.5 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {erro}
          </p>
        ) : null}

        <Button type="submit" size="lg" className="mt-6 h-12 w-full text-base" loading={enviando} disabled={!senha.trim()}>
          Entrar
        </Button>
        <p className="mt-4 text-center text-xs text-muted-foreground">Não recebeu a senha? Fale com a equipe da NÓS Contabilidade.</p>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------
function Painel({ dados, token, senha, recarregar }: { dados: DadosPortal; token: string; senha: string; recarregar: () => Promise<void> }) {
  const { cliente, chamados, certificados, escritorio, situacaoFiscal } = dados;
  const abertos = chamados.filter((c) => c.status === "aberta" || c.status === "em_andamento").length;
  const concluidos = chamados.filter((c) => c.status === "concluida").length;
  const certAtencao = certificados.filter((c) => c.status !== "valido").length;
  const nomeExibido = cliente.nomeFantasia || cliente.nome;
  const [formAberto, setFormAberto] = useState(false);

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* Boas-vindas */}
      <section
        className="relative overflow-hidden rounded-card p-5 text-white shadow-card sm:p-8"
        style={{ background: "linear-gradient(135deg, var(--brand), color-mix(in srgb, var(--brand) 62%, var(--primary)))" }}
        aria-labelledby="titulo-cliente"
      >
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-white/10 blur-2xl" />
        <p className="relative text-xs font-medium uppercase tracking-[0.12em] text-white/70">Bem-vindo ao seu portal</p>
        <h1 id="titulo-cliente" className="relative mt-1.5 break-words text-2xl font-bold leading-tight tracking-[-0.015em] sm:text-3xl">
          {nomeExibido}
        </h1>
        <div className="relative mt-3 flex flex-wrap items-center gap-2 text-sm text-white/85">
          {cliente.documento ? <span className="rounded-full bg-white/15 px-3 py-1 tabular-nums">{cliente.documento}</span> : null}
          {cliente.regimeTributario ? <span className="rounded-full bg-white/15 px-3 py-1">{cliente.regimeTributario}</span> : null}
          {cliente.cidade ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1">
              <MapPin className="size-3.5" aria-hidden />
              {cliente.cidade}
              {cliente.estado ? `/${cliente.estado}` : ""}
            </span>
          ) : null}
        </div>
        {cliente.nomeFantasia && cliente.nome !== cliente.nomeFantasia ? <p className="relative mt-3 break-words text-sm text-white/70">{cliente.nome}</p> : null}
        <div className="relative mt-5 flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={() => {
              setFormAberto(true);
              requestAnimationFrame(() => document.getElementById("solicitar")?.scrollIntoView({ behavior: "smooth", block: "start" }));
            }}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-[#1b396d] transition-transform active:scale-[.97]"
          >
            <ClipboardList className="size-4" aria-hidden />
            Solicitar algo
          </button>
          {escritorio.whatsapp ? <BotaoWhatsApp dados={dados} variante="hero" /> : null}
        </div>
      </section>

      {/* Números */}
      <section aria-label="Resumo" className="grid grid-cols-3 gap-2.5 sm:gap-4">
        <Numero rotulo="Em andamento" valor={abertos} cor="chamados" icone={ClipboardList} />
        <Numero rotulo="Concluídas" valor={concluidos} cor="clientes" icone={CheckCircle2} />
        <Numero rotulo={certAtencao > 0 ? "Certificados a vencer" : "Certificados"} valor={certAtencao > 0 ? certAtencao : certificados.length} cor="certificados" icone={FileBadge2} />
      </section>

      {situacaoFiscal ? <SituacaoFiscal s={situacaoFiscal} /> : null}

      <Solicitar dados={dados} token={token} senha={senha} aberto={formAberto} setAberto={setFormAberto} recarregar={recarregar} />

      <Secao titulo="Suas solicitações" icone={ClipboardList} cor="chamados" contagem={chamados.length}>
        {chamados.length === 0 ? (
          <Vazio texto="Você ainda não tem solicitações. Quando pedir algo à equipe, o andamento aparece aqui." />
        ) : (
          <ul className="space-y-3">
            {chamados.map((c, i) => (
              <li key={`${c.criadoEm}-${i}`}>
                <CartaoChamado c={c} />
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Secao titulo="Certificados digitais" icone={FileBadge2} cor="certificados" contagem={certificados.length}>
        {certificados.length === 0 ? (
          <Vazio texto="Nenhum certificado digital cadastrado para você." />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {certificados.map((c, i) => (
              <li key={`${c.tipo}-${c.validoAte}-${i}`}>
                <CartaoCertificado c={c} />
              </li>
            ))}
          </ul>
        )}
      </Secao>

      {escritorio.whatsapp ? (
        <section className="flex flex-col items-start gap-4 rounded-card border bg-card p-5 shadow-card sm:flex-row sm:items-center sm:justify-between sm:p-6" style={corModulo("whatsapp")}>
          <div className="flex items-start gap-3">
            <span className="chip-mod grid size-11 shrink-0 place-items-center rounded-xl">
              <MessageCircle className="size-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-base font-semibold">Fale com a gente</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">Prefere conversar? Chame a equipe da NÓS Contabilidade pelo WhatsApp.</p>
            </div>
          </div>
          <BotaoWhatsApp dados={dados} variante="card" />
        </section>
      ) : null}
    </div>
  );
}

function BotaoWhatsApp({ dados, variante }: { dados: DadosPortal; variante: "hero" | "card" }) {
  const numero = dados.escritorio.whatsapp;
  if (!numero) return null;
  const texto = `Olá! Sou da ${dados.cliente.nomeFantasia || dados.cliente.nome} e estou no portal do cliente.`;
  return (
    <a
      href={numero ? numeroWhatsappLink(numero, texto) : undefined}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-transform active:scale-[.97]",
        variante === "hero" ? "border border-white/40 bg-white/10 text-white hover:bg-white/20" : "bg-[#16a34a] text-white hover:bg-[#15803d] max-sm:w-full",
      )}
    >
      <MessageCircle className="size-4" aria-hidden />
      Chamar no WhatsApp
    </a>
  );
}

function Numero({ rotulo, valor, cor, icone: Icone }: { rotulo: string; valor: number; cor: CorModulo; icone: LucideIcon }) {
  return (
    <div className="rounded-card border bg-card p-3 shadow-card sm:p-4" style={corModulo(cor)}>
      <span className="chip-mod grid size-8 place-items-center rounded-lg sm:size-9">
        <Icone className="size-4" aria-hidden />
      </span>
      <p className="texto-mod mt-2 text-2xl font-bold tabular-nums leading-none sm:text-3xl">{valor}</p>
      <p className="mt-1 text-[11px] leading-tight text-muted-foreground sm:text-xs">{rotulo}</p>
    </div>
  );
}

function Secao({ titulo, icone: Icone, cor, contagem, children }: { titulo: string; icone: LucideIcon; cor: CorModulo; contagem?: number; children: ReactNode }) {
  return (
    <section className="rounded-card border bg-card p-4 shadow-card sm:p-6" style={corModulo(cor)}>
      <header className="mb-4 flex items-center gap-3">
        <span className="chip-mod grid size-9 place-items-center rounded-xl">
          <Icone className="size-[18px]" aria-hidden />
        </span>
        <h2 className="text-base font-semibold tracking-[-0.01em] sm:text-lg">{titulo}</h2>
        {contagem ? <span className="ml-auto rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">{contagem}</span> : null}
      </header>
      {children}
    </section>
  );
}

function Vazio({ texto }: { texto: string }) {
  return <p className="rounded-xl bg-muted/50 px-4 py-6 text-center text-sm leading-relaxed text-muted-foreground [text-wrap:pretty]">{texto}</p>;
}

// ---------------------------------------------------------------------------
// Chamados
// ---------------------------------------------------------------------------
const COR_STATUS: Record<ChamadoPortal["status"], string> = {
  aberta: "bg-primary/10 text-primary",
  em_andamento: "bg-warning/15 text-warning",
  concluida: "bg-success/10 text-success",
  cancelada: "bg-muted text-muted-foreground",
};

function CartaoChamado({ c }: { c: ChamadoPortal }) {
  return (
    <article className="rounded-xl border bg-background/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <h3 className="min-w-0 break-words text-sm font-semibold leading-snug sm:text-base">{c.tipo}</h3>
        <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium", COR_STATUS[c.status])}>{c.statusRotulo}</span>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span>Pedido em {dataBR(c.criadoEm)}</span>
        {c.prazo && c.status !== "concluida" && c.status !== "cancelada" ? (
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="size-3.5" aria-hidden />
            Previsão {dataBR(c.prazo)}
          </span>
        ) : null}
      </p>
      {c.descricao ? <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-muted/60 px-3 py-2 text-sm leading-relaxed">{c.descricao}</p> : null}
      <ol className="mt-4 flex items-start" aria-label="Andamento">
        {c.etapas.map((e, i) => {
          const ultimo = i === c.etapas.length - 1;
          const cancelado = e.chave === "cancelado";
          return (
            <li key={e.chave} className={cn("relative flex-1", ultimo && "flex-none")} aria-current={e.atual ? "step" : undefined}>
              <div className="flex items-center">
                <span
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-full border-2 text-white",
                    e.feito ? (cancelado ? "border-muted-foreground bg-muted-foreground" : "border-success bg-success") : "border-border bg-card",
                    e.atual && !cancelado && "ring-4 ring-success/20",
                  )}
                >
                  {e.feito ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : null}
                </span>
                {!ultimo ? <span className={cn("mx-1 h-0.5 flex-1 rounded-full", c.etapas[i + 1]?.feito ? "bg-success" : "bg-border")} aria-hidden /> : null}
              </div>
              <p className={cn("mt-1.5 text-[11px] leading-tight sm:text-xs", e.feito ? "font-medium text-foreground" : "text-muted-foreground")}>{e.rotulo}</p>
              {e.em ? <p className="text-[10px] text-muted-foreground sm:text-[11px]">{dataBR(e.em)}</p> : null}
            </li>
          );
        })}
      </ol>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Certificados
// ---------------------------------------------------------------------------
function CartaoCertificado({ c }: { c: CertificadoPortal }) {
  const cor = c.status === "valido" ? "success" : c.status === "vencendo" ? "warning" : "destructive";
  const pct = Math.max(4, Math.min(100, Math.round((Math.max(c.diasRestantes, 0) / 365) * 100)));
  const frase = c.diasRestantes < 0 ? `Venceu há ${Math.abs(c.diasRestantes)} ${Math.abs(c.diasRestantes) === 1 ? "dia" : "dias"}` : c.diasRestantes === 0 ? "Vence hoje" : `Vence em ${c.diasRestantes} ${c.diasRestantes === 1 ? "dia" : "dias"}`;
  return (
    <article className="h-full rounded-xl border bg-background/60 p-4">
      <h3 className="break-words text-sm font-semibold sm:text-base">{c.tipo}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">Válido até {dataBR(c.validoAte)}</p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className={cn("h-full rounded-full", cor === "success" && "bg-success", cor === "warning" && "bg-warning", cor === "destructive" && "bg-destructive")} style={{ width: `${pct}%` }} />
      </div>
      <p className={cn("mt-2 text-sm font-medium", cor === "success" && "text-success", cor === "warning" && "text-warning", cor === "destructive" && "text-destructive")}>{frase}</p>
      {c.status !== "valido" ? <p className="mt-1 text-xs text-muted-foreground">Fale com a equipe para renovar e não ficar sem emitir notas e guias.</p> : null}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Situação fiscal
// ---------------------------------------------------------------------------
function SituacaoFiscal({ s }: { s: NonNullable<DadosPortal["situacaoFiscal"]> }) {
  const conf =
    s.situacao === "regular"
      ? { icone: CheckCircle2, titulo: "Situação fiscal regular", texto: "Na última consulta à Receita Federal, não encontramos pendências.", cls: "bg-success/10 text-success" }
      : s.situacao === "pendencias"
        ? { icone: AlertTriangle, titulo: "Há pendências na situação fiscal", texto: "A última consulta encontrou pontos de atenção. Nossa equipe vai orientar você sobre os próximos passos.", cls: "bg-warning/15 text-warning" }
        : { icone: Clock, titulo: "Situação fiscal em verificação", texto: "Ainda não temos uma consulta recente para mostrar aqui.", cls: "bg-muted text-muted-foreground" };
  const Icone = conf.icone;
  return (
    <section className="flex items-start gap-4 rounded-card border bg-card p-4 shadow-card sm:p-6" aria-label="Situação fiscal">
      <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl", conf.cls)}>
        <Icone className="size-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <h2 className="text-base font-semibold sm:text-lg">{conf.titulo}</h2>
        <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground [text-wrap:pretty]">{conf.texto}</p>
        {s.consultadoEm ? <p className="mt-1.5 text-xs text-muted-foreground">Consulta de {dataBR(s.consultadoEm)}</p> : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Solicitar algo
// ---------------------------------------------------------------------------
const MAX_DESC = 1000;

function Solicitar({
  dados,
  token,
  senha,
  aberto,
  setAberto,
  recarregar,
}: {
  dados: DadosPortal;
  token: string;
  senha: string;
  aberto: boolean;
  setAberto: (v: boolean) => void;
  recarregar: () => Promise<void>;
}) {
  const [tipoId, setTipoId] = useState("");
  const [descricao, setDescricao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  const podeEnviar = useMemo(() => !!tipoId && descricao.trim().length >= 5 && !enviando, [tipoId, descricao, enviando]);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!podeEnviar) return;
    setEnviando(true);
    setErro(null);
    const r = await portalSolicitar(token, senha, tipoId, descricao.trim());
    setEnviando(false);
    if (r.tipo === "ok") {
      setEnviado(true);
      setTipoId("");
      setDescricao("");
      void recarregar();
      return;
    }
    setErro(r.tipo === "indisponivel" ? "Este link não está mais disponível." : r.tipo === "senha" ? "Sua sessão terminou. Recarregue a página e entre de novo." : r.mensagem);
  }

  return (
    <section id="solicitar" className="scroll-mt-4 rounded-card border bg-card shadow-card" style={corModulo("chamados")}>
      <button
        type="button"
        onClick={() => {
          setAberto(!aberto);
          setEnviado(false);
        }}
        aria-expanded={aberto}
        aria-controls="form-solicitar"
        className="flex w-full items-center gap-3 p-4 text-left sm:p-6"
      >
        <span className="chip-mod grid size-9 shrink-0 place-items-center rounded-xl">
          <Send className="size-[18px]" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold sm:text-lg">Solicitar algo à equipe</span>
          <span className="block text-sm text-muted-foreground">Nota fiscal, guia, certidão, declaração e mais.</span>
        </span>
        <span className={cn("text-sm font-medium text-primary", aberto && "hidden")}>Abrir</span>
      </button>

      {aberto ? (
        <form id="form-solicitar" onSubmit={enviar} className="space-y-4 border-t px-4 pb-5 pt-4 sm:px-6">
          {enviado ? (
            <div role="status" className="flex items-start gap-3 rounded-xl bg-success/10 p-4 text-sm text-success">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
              <div>
                <p className="font-semibold">Pedido enviado!</p>
                <p className="mt-0.5 text-success/90">Nossa equipe já recebeu e você acompanha o andamento aqui, em &ldquo;Suas solicitações&rdquo;.</p>
              </div>
            </div>
          ) : null}
          <fieldset>
            <legend className="mb-2 text-sm font-medium">O que você precisa?</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup">
              {dados.tipos.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={tipoId === t.id}
                  onClick={() => setTipoId(t.id)}
                  className={cn(
                    "min-h-10 rounded-full border px-4 py-2 text-left text-sm transition-colors",
                    tipoId === t.id ? "border-primary bg-primary/10 font-semibold text-primary" : "bg-background hover:bg-accent",
                  )}
                >
                  {t.nome}
                </button>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="descricao-portal" className="mb-1.5 block text-sm font-medium">
              Conte com detalhes
            </label>
            <Textarea
              id="descricao-portal"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value.slice(0, MAX_DESC))}
              rows={4}
              maxLength={MAX_DESC}
              placeholder="Ex.: preciso emitir uma nota de R$ 1.500,00 para a empresa Fulano Ltda."
            />
            <p className="mt-1 text-right text-xs tabular-nums text-muted-foreground">
              {descricao.length}/{MAX_DESC}
            </p>
          </div>
          {erro ? (
            <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {erro}
            </p>
          ) : null}
          <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={!podeEnviar} loading={enviando}>
            <Send />
            Enviar pedido
          </Button>
        </form>
      ) : null}
    </section>
  );
}
