import {
  ArrowRight,
  BadgeCheck,
  Cake,
  CheckCircle2,
  ClipboardList,
  Heart,
  Landmark,
  MessageSquare,
  MessagesSquare,
  PartyPopper,
  Sparkles,
  Sun,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { AvatarIniciais } from "@/components/avatar-iniciais";
import { Logo } from "@/components/logo";
import { HexagonoMarca, MarcaDagua } from "@/components/marca-hexagono";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageTitle } from "@/hooks/use-page-title";
import { useEstilo, type Estilo } from "@/lib/aparencia";
import { useEu } from "@/lib/colaborador";
import { corModulo, type CorModulo } from "@/lib/cores-modulo";
import { msgErro } from "@/lib/erro";
import { useModulos, type ModuloChave } from "@/lib/modulos";
import { useDashboard, type Dashboard } from "@/lib/queries/dashboard";
import { cn } from "@/lib/utils";

/** Atraso da entrada escalonada: passos de 50ms. */
const passo = (i: number): CSSProperties => ({ animationDelay: `${i * 50}ms` });

const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

const reduzMovimento = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Número que conta de 0 até o valor (requestAnimationFrame, 700ms). */
function useContagem(alvo: number): number {
  const [v, setV] = useState(0);
  const de = useRef(0);
  useEffect(() => {
    if (reduzMovimento()) {
      setV(alvo);
      de.current = alvo;
      return;
    }
    const inicio = performance.now();
    const origem = de.current;
    let id = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - inicio) / 700);
      const e = 1 - Math.pow(1 - p, 3);
      const atual = Math.round(origem + (alvo - origem) * e);
      setV(atual);
      de.current = atual;
      if (p < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [alvo]);
  return v;
}

function Numero({ valor, className }: { valor: number; className?: string }) {
  const v = useContagem(valor);
  return <span className={cn("nums", className)}>{v.toLocaleString("pt-BR")}</span>;
}

// ---------------------------------------------------------------------------
// Dados da página (os dois estilos usam os mesmos)
// ---------------------------------------------------------------------------

type Atencao = {
  chave: string;
  cor: CorModulo;
  icon: LucideIcon;
  valor: number;
  titulo: string;
  vazio: string;
  extra?: string;
  to: string;
  acao: string;
};

type Atalho = { chave: string; cor: CorModulo; icon: LucideIcon; rotulo: string; to: string };

function useInicio() {
  const { eu, tem } = useEu();
  const { ativo } = useModulos();
  const verNumeros = tem("dashboard.ver");
  const q = useDashboard("7d", verNumeros);
  const d = q.data;

  const nivers = (d?.aniversarios ?? []).filter((a) => a.diasAte === 0).length;
  const certVencendo = (d?.certificados.vencidos ?? 0) + (d?.certificados.vencem30 ?? 0);
  const todosAtencao: (Atencao & { modulo: ModuloChave })[] = [
    {
      chave: "conversas",
      modulo: "whatsapp",
      cor: "whatsapp",
      icon: MessageSquare,
      valor: d?.atendimento.semResponsavel ?? 0,
      titulo: plural(d?.atendimento.semResponsavel ?? 0, "conversa esperando", "conversas esperando"),
      vazio: "Ninguém esperando resposta",
      to: "/whatsapp",
      acao: "Responder",
    },
    {
      chave: "chamados",
      modulo: "chamados",
      cor: "chamados",
      icon: ClipboardList,
      valor: d?.chamados.atrasados ?? 0,
      titulo: plural(d?.chamados.atrasados ?? 0, "chamado atrasado", "chamados atrasados"),
      vazio: "Nenhum chamado atrasado",
      to: "/chamados",
      acao: "Ver chamados",
    },
    {
      chave: "certificados",
      modulo: "certificados",
      cor: "certificados",
      icon: BadgeCheck,
      valor: certVencendo,
      titulo: plural(certVencendo, "certificado vencendo", "certificados vencendo"),
      vazio: "Certificados em dia",
      extra: d && d.certificados.vencidos > 0 ? `${d.certificados.vencidos} já ${plural(d.certificados.vencidos, "venceu", "venceram")}` : undefined,
      to: "/certificados?status=vencendo",
      acao: "Ver certificados",
    },
    {
      chave: "aniversarios",
      modulo: "clientes",
      cor: "clientes",
      icon: Cake,
      valor: nivers,
      titulo: plural(nivers, "aniversariante hoje", "aniversariantes hoje"),
      vazio: "Nenhum aniversário hoje",
      to: "/clientes/aniversarios",
      acao: "Dar parabéns",
    },
  ];
  const atencao = todosAtencao.filter((a) => ativo(a.modulo) && (a.chave !== "aniversarios" || tem("aniversarios.ver") || tem("clientes.ver")));

  const atalhos: Atalho[] = [
    ativo("whatsapp") && tem("whatsapp.ver") && { chave: "wa", cor: "whatsapp", icon: MessageSquare, rotulo: "Abrir WhatsApp", to: "/whatsapp" },
    ativo("clientes") && tem("clientes.editar") && { chave: "cli", cor: "clientes", icon: UserPlus, rotulo: "Novo cliente", to: "/clientes/novo" },
    ativo("chamados") && tem("chamados.criar") && { chave: "ch", cor: "chamados", icon: ClipboardList, rotulo: "Abrir chamado", to: "/chamados?novo=1" },
    ativo("certificados") && tem("certificados.editar") && { chave: "ce", cor: "certificados", icon: BadgeCheck, rotulo: "Cadastrar certificado", to: "/certificados?novo=1" },
  ].filter(Boolean) as Atalho[];

  const pendentes = atencao.filter((a) => a.valor > 0);
  const resumoFrase = !verNumeros
    ? "Tudo o que você precisa está no menu."
    : q.isLoading
      ? ""
      : pendentes.length === 0
        ? "Está tudo em dia por aqui. Bom trabalho!"
        : `Hoje tem ${pendentes.map((a) => `${a.valor} ${a.titulo}`).join(", ")}.`;

  const h = new Date().getHours();
  const saudacao = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  const nome = eu?.nome?.split(" ")[0];
  const hoje = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

  return { d, q, verNumeros, atencao, atalhos, resumoFrase, saudacao, nome, hoje, ativo };
}

type Inicio = ReturnType<typeof useInicio>;

/** Início: o que precisa de você hoje, atalhos e um resumo amigável. */
export function InicioPage() {
  usePageTitle("Início");
  const estilo = useEstilo();
  const dados = useInicio();
  return (
    <div className={"relative min-h-full"}>
      {estilo === "A" ? <InicioMarinho {...dados} /> : <InicioColorido {...dados} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estilo A: Marinho
// ---------------------------------------------------------------------------

function InicioMarinho(p: Inicio) {
  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 lg:space-y-8 mx-auto w-full max-w-[1600px]">
      <section
        className="relative overflow-hidden rounded-card text-white shadow-card animate-rise"
        style={{ backgroundImage: "url(/login-predio.jpg)", backgroundSize: "cover", backgroundPosition: "center 40%" }}
      >
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(110deg, color-mix(in srgb, var(--brand) 96%, transparent) 0%, color-mix(in srgb, var(--brand) 86%, transparent) 50%, color-mix(in srgb, var(--brand) 55%, transparent) 100%)",
          }}
        />
        {/* Hexágono da marca, grande e apagado, como marca d'água do banner. */}
        <HexagonoMarca className="absolute -right-16 -bottom-24 size-[360px] rotate-12 opacity-[0.13] brightness-0 invert" />
        <div className="relative px-5 py-6 sm:px-8 sm:py-9 lg:px-10 lg:py-10 flex flex-col gap-6 lg:gap-8">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <p className="text-xs font-medium text-white/70 first-letter:uppercase">{p.hoje}</p>
              <h1 className="text-[28px] sm:text-[38px] leading-[1.1] font-bold tracking-[-0.015em]">
                {p.saudacao}
                {p.nome ? `, ${p.nome}` : ""}!
              </h1>
              <p className="text-sm sm:text-base text-white/85 max-w-xl [text-wrap:pretty] min-h-6">
                {p.resumoFrase || <Skeleton className="h-4 w-64 bg-white/20" />}
              </p>
            </div>
            <Logo branca className="h-14 sm:h-[72px] shrink-0 hidden sm:inline-flex opacity-95" />
          </div>
          {p.atalhos.length > 0 && (
            <div className="grid grid-cols-2 lg:flex lg:flex-wrap gap-2.5 sm:gap-3">
              {p.atalhos.map((a, i) => (
                <Link
                  key={a.chave}
                  to={a.to}
                  style={{ ...corModulo(a.cor), ...passo(2 + i) }}
                  className="animate-rise group flex items-center gap-3 rounded-2xl bg-white/10 hover:bg-white/[0.18] border border-white/15 backdrop-blur-sm px-3.5 py-3 sm:pr-5 text-sm font-semibold transition-[background-color,transform] duration-200 hover:-translate-y-0.5 active:scale-[.98]"
                >
                  <span className="grid size-9 place-items-center rounded-xl bg-white text-[color:var(--mc)] shrink-0 shadow-card">
                    <a.icon className="size-[18px]" />
                  </span>
                  <span className="min-w-0 leading-tight">{a.rotulo}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {p.verNumeros && (
        <Conteudo p={p}>
          <section className="space-y-3 sm:space-y-4">
            <h2 className="text-title-md font-bold animate-rise" style={passo(3)}>
              O que precisa de você hoje
            </h2>
            <GradeAtencao n={p.atencao.length}>
              {p.atencao.map((a, i) => (
                <Link
                  key={a.chave}
                  to={a.to}
                  style={{
                    ...corModulo(a.cor),
                    ...passo(4 + i),
                    backgroundImage: "linear-gradient(150deg, color-mix(in srgb, var(--mc) 11%, var(--card)) 0%, var(--card) 62%)",
                  }}
                  className="cartao-vivo animate-rise group relative overflow-hidden rounded-card border bg-card p-4 sm:p-5 flex flex-col gap-3 sm:gap-4 min-w-0"
                >
                  <div className="flex items-center justify-between">
                    <span className="chip-mod grid size-11 place-items-center rounded-2xl">
                      <a.icon className="size-5" />
                    </span>
                    {a.valor > 0 && <span className="size-2.5 rounded-full bg-[var(--mc)] animate-pulse" aria-hidden />}
                  </div>
                  <div className="min-w-0">
                    {p.q.isLoading ? (
                      <Skeleton className="h-10 w-14" />
                    ) : (
                      <Numero valor={a.valor} className={cn("block text-[32px] sm:text-[40px] leading-none font-bold tracking-[-0.015em]", a.valor > 0 ? "texto-mod" : "text-foreground/35")} />
                    )}
                    <p className="text-xs sm:text-sm font-semibold mt-2 line-clamp-2 sm:truncate">{a.valor > 0 || p.q.isLoading ? a.titulo : a.vazio}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 min-h-[18px] truncate">{a.extra ?? (a.valor > 0 ? "" : "Tudo certo")}</p>
                  </div>
                  <span className="texto-mod text-xs font-semibold inline-flex items-center gap-1">
                    {a.acao}
                    <ArrowRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-1" />
                  </span>
                </Link>
              ))}
            </GradeAtencao>
          </section>
          <Resumos p={p} variante="A" />
        </Conteudo>
      )}
      {!p.verNumeros && <SemNumeros />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estilo B: Claro e colorido
// ---------------------------------------------------------------------------

function InicioColorido(p: Inicio) {
  const tudoEmDia = !p.q.isLoading && p.atencao.every((a) => a.valor === 0);
  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 lg:space-y-8 mx-auto w-full max-w-[1600px]">
      <header className="relative flex flex-col gap-1.5 animate-rise">
        <MarcaDagua className="-top-10 right-0" />
        <p className="text-xs font-semibold text-[color:var(--mod-inicio)] first-letter:uppercase">{p.hoje}</p>
        <h1 className="text-[30px] sm:text-[38px] leading-[1.1] font-bold tracking-[-0.015em]">
          {p.saudacao}
          {p.nome ? `, ${p.nome}` : ""}!{" "}
          <span className="inline-block" aria-hidden>
            <Sun className="inline size-8 -mt-1.5 text-[#f59e0b]" />
          </span>
        </h1>
        <p className="text-sm sm:text-base text-muted-foreground max-w-2xl min-h-6">
          {p.resumoFrase || <Skeleton className="h-4 w-64" />}
        </p>
      </header>

      {p.atalhos.length > 0 && (
        <div className={cn("grid gap-3 sm:gap-4 grid-cols-2", p.atalhos.length >= 3 && "lg:grid-cols-4")}>
          {p.atalhos.map((a, i) => (
            <Link
              key={a.chave}
              to={a.to}
              style={{ ...corModulo(a.cor), ...passo(1 + i), backgroundColor: "color-mix(in srgb, var(--mc) 8%, var(--card))" }}
              className="cartao-vivo animate-rise group rounded-card border border-[color:color-mix(in_srgb,var(--mc)_18%,transparent)] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3"
            >
              <span className="grid size-12 place-items-center rounded-full bg-[var(--mc)] text-white shrink-0 shadow-card transition-transform duration-300 ease-brand group-hover:scale-110 group-hover:-rotate-6">
                <a.icon className="size-[22px]" />
              </span>
              <span className="text-sm font-bold leading-tight">{a.rotulo}</span>
            </Link>
          ))}
        </div>
      )}

      {p.verNumeros && (
        <Conteudo p={p}>
          <section className="space-y-3 sm:space-y-4">
            <h2 className="text-title-md font-bold animate-rise" style={passo(3)}>
              O que precisa de você hoje
            </h2>
            {tudoEmDia ? (
              <div className="rounded-card border bg-card shadow-card p-6 sm:p-10 flex flex-col sm:flex-row items-center gap-6 sm:gap-10 animate-rise" style={passo(4)}>
                <Ilustracao principal={PartyPopper} cor="whatsapp" satelites={[{ icon: CheckCircle2, cor: "clientes" }, { icon: Sparkles, cor: "chamados" }, { icon: Heart, cor: "fiscal" }]} />
                <div className="text-center sm:text-left space-y-1.5">
                  <p className="text-title-md font-bold">Tudo em dia!</p>
                  <p className="text-sm text-muted-foreground max-w-md">
                    Ninguém esperando, nenhum chamado atrasado e nenhum certificado vencendo. Aproveite para adiantar o trabalho.
                  </p>
                </div>
              </div>
            ) : (
              <GradeAtencao n={p.atencao.length}>
                {p.atencao.map((a, i) => (
                  <Link
                    key={a.chave}
                    to={a.to}
                    style={{ ...corModulo(a.cor), ...passo(4 + i) }}
                    className="cartao-vivo animate-rise group relative overflow-hidden rounded-card border bg-card p-4 pt-5 sm:p-5 sm:pt-6 flex flex-col items-start gap-3 sm:gap-4 min-w-0"
                  >
                    <span aria-hidden className="absolute inset-x-0 top-0 h-1.5 bg-[var(--mc)]" />
                    <span
                      aria-hidden
                      className="absolute -right-8 -top-8 size-28 rounded-full opacity-60"
                      style={{ background: "color-mix(in srgb, var(--mc) 9%, transparent)" }}
                    />
                    <span className="relative grid size-14 place-items-center rounded-full bg-[var(--mc)] text-white shadow-card transition-transform duration-300 ease-brand group-hover:scale-110">
                      <a.icon className="size-6" />
                    </span>
                    <div className="relative min-w-0 w-full">
                      {p.q.isLoading ? (
                        <Skeleton className="h-10 w-14" />
                      ) : (
                        <Numero valor={a.valor} className={cn("block text-[32px] sm:text-[40px] leading-none font-bold tracking-[-0.015em]", a.valor === 0 && "text-foreground/30")} />
                      )}
                      <p className="text-xs sm:text-sm font-semibold mt-2 line-clamp-2 sm:truncate">{a.valor > 0 || p.q.isLoading ? a.titulo : a.vazio}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 min-h-[18px] truncate">{a.extra ?? ""}</p>
                    </div>
                    <span className="texto-mod text-xs font-bold inline-flex items-center gap-1">
                      {a.acao}
                      <ArrowRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-1" />
                    </span>
                  </Link>
                ))}
              </GradeAtencao>
            )}
          </section>
          <Resumos p={p} variante="B" />
        </Conteudo>
      )}
      {!p.verNumeros && <SemNumeros colorido />}
    </div>
  );
}

/** Ilustração feita de ícones em bolhas coloridas (sem desenho à mão). */
function Ilustracao({
  principal: Principal,
  cor,
  satelites: _satelites,
  pequena,
}: {
  principal: LucideIcon;
  cor: CorModulo;
  satelites: { icon: LucideIcon; cor: CorModulo }[];
  pequena?: boolean;
}) {
  return (
    <div className={cn("relative shrink-0", pequena ? "size-24" : "size-36")} aria-hidden>
      <span
        className="absolute inset-0 rounded-[42%_58%_55%_45%/48%_42%_58%_52%]"
        style={{ ...corModulo(cor), background: "color-mix(in srgb, var(--mc) 14%, transparent)" }}
      />
      <span
        className="absolute inset-[18%] grid place-items-center rounded-full bg-[var(--mc)] text-white shadow-card"
        style={corModulo(cor)}
      >
        <Principal className={pequena ? "size-7" : "size-10"} />
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Peças comuns
// ---------------------------------------------------------------------------

function Conteudo({ p, children }: { p: Inicio; children: ReactNode }) {
  if (p.q.error)
    return (
      <div className="rounded-card border bg-card p-6 text-sm text-destructive">
        Não foi possível carregar o resumo: {msgErro(p.q.error)}
      </div>
    );
  return <>{children}</>;
}

function GradeAtencao({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className={cn("grid gap-3 sm:gap-4 grid-cols-2", n >= 4 && "xl:grid-cols-4", n === 3 && "xl:grid-cols-3")}>
      {children}
    </div>
  );
}

function SemNumeros({ colorido }: { colorido?: boolean }) {
  return (
    <div className="rounded-card border bg-card shadow-card p-6 sm:p-10 flex flex-col sm:flex-row items-center gap-6 animate-rise" style={passo(3)}>
      {colorido ? (
        <Ilustracao pequena principal={Sparkles} cor="inicio" satelites={[{ icon: MessageSquare, cor: "whatsapp" }, { icon: Users, cor: "clientes" }]} />
      ) : (
        <span className="chip-mod grid size-14 place-items-center rounded-2xl" style={corModulo("inicio")}>
          <Sparkles className="size-6" />
        </span>
      )}
      <div className="text-center sm:text-left">
        <p className="text-title-sm font-bold">Bom trabalho hoje!</p>
        <p className="text-sm text-muted-foreground">Use os atalhos acima ou o menu ao lado para abrir o que precisar.</p>
      </div>
    </div>
  );
}

function CartaoResumo({
  titulo,
  cor,
  icon: Icon,
  link,
  children,
  variante,
  style,
  className,
}: {
  titulo: string;
  cor: CorModulo;
  icon: LucideIcon;
  link?: { to: string; texto: string };
  children: ReactNode;
  variante: Estilo;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <section
      style={{ ...corModulo(cor), ...style }}
      className={cn("animate-rise rounded-card border bg-card shadow-card p-5 sm:p-6 flex flex-col gap-4 min-w-0", className)}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "grid place-items-center shrink-0",
            variante === "A" ? "chip-mod size-9 rounded-xl" : "size-10 rounded-full bg-[var(--mc)] text-white",
          )}
        >
          <Icon className="size-[18px]" />
        </span>
        <h3 className="text-title-sm font-bold flex-1 min-w-0 truncate">{titulo}</h3>
        {link && (
          <Link to={link.to} className="texto-mod shrink-0 text-xs font-semibold inline-flex items-center gap-1 hover:underline underline-offset-4">
            {link.texto}
            <ArrowRight className="size-3.5" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function Stat({ rotulo, valor, cor, carregando }: { rotulo: string; valor: number; cor: CorModulo; carregando: boolean }) {
  return (
    <div className="rounded-2xl px-4 py-3.5 min-w-0" style={{ ...corModulo(cor), background: "color-mix(in srgb, var(--mc) 7%, transparent)" }}>
      {carregando ? <Skeleton className="h-8 w-12" /> : <Numero valor={valor} className="block text-[28px] leading-tight font-bold texto-mod" />}
      <p className="text-xs text-muted-foreground mt-0.5 [text-wrap:balance]">{rotulo}</p>
    </div>
  );
}

function Resumos({ p, variante }: { p: Inicio; variante: Estilo }) {
  const d: Dashboard | undefined = p.d;
  const c = p.q.isLoading;
  const semana: { rotulo: string; valor: number; cor: CorModulo }[] = [];
  if (p.ativo("whatsapp")) semana.push({ rotulo: "mensagens trocadas", valor: (d?.atendimento.recebidas ?? 0) + (d?.atendimento.enviadas ?? 0), cor: "whatsapp" });
  if (p.ativo("chamados")) semana.push({ rotulo: "chamados resolvidos", valor: d?.chamados.concluidosNoPeriodo ?? 0, cor: "chamados" });
  if (p.ativo("clientes")) semana.push({ rotulo: "clientes novos", valor: d?.clientes.novosNoPeriodo ?? 0, cor: "clientes" });
  const proximos = (d?.aniversarios ?? []).slice(0, 5);
  const fiscal = d?.fiscal.ultimaPorStatus;

  return (
    <section className="space-y-3 sm:space-y-4">
      <h2 className="text-title-md font-bold animate-rise" style={passo(8)}>
        Como foi a semana
      </h2>
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3 lg:items-start">
        {semana.length > 0 && (
          <CartaoResumo titulo="Últimos 7 dias" cor="inicio" icon={MessagesSquare} variante={variante} style={passo(9)} className="lg:col-span-2">
            <div className={cn("grid gap-3 grid-cols-2", semana.length === 3 && "sm:grid-cols-3")}>
              {semana.map((s) => (
                <Stat key={s.rotulo} {...s} carregando={c} />
              ))}
            </div>
            {p.ativo("clientes") && (
              <p className="text-xs text-muted-foreground">
                Hoje o escritório cuida de{" "}
                <strong className="text-foreground font-semibold">
                  {c ? "..." : `${(d?.clientes.ativos ?? 0).toLocaleString("pt-BR")} ${plural(d?.clientes.ativos ?? 0, "cliente", "clientes")}`}
                </strong>
                .
              </p>
            )}
          </CartaoResumo>
        )}

        <div className={cn("grid gap-4 sm:gap-6 content-start", semana.length === 0 && "lg:col-span-3 lg:grid-cols-2")}>
        {p.ativo("clientes") && (
          <CartaoResumo
            titulo="Aniversários"
            cor="clientes"
            icon={Cake}
            variante={variante}
            link={{ to: "/clientes/aniversarios", texto: "Ver todos" }}
            style={passo(10)}
          >
            {c ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : proximos.length === 0 ? (
              <div className="flex items-center gap-4 py-2">
                {variante === "B" ? (
                  <Ilustracao pequena principal={Cake} cor="clientes" satelites={[{ icon: PartyPopper, cor: "chamados" }, { icon: Heart, cor: "fiscal" }]} />
                ) : null}
                <p className="text-sm text-muted-foreground">Ninguém faz aniversário nos próximos 7 dias.</p>
              </div>
            ) : (
              <ul className="-my-1.5 divide-y divide-divider">
                {proximos.map((a) => (
                  <li key={`${a.origem}:${a.socioId ?? a.clienteId}`} className="flex items-center gap-3 py-2.5">
                    <AvatarIniciais nome={a.nome} size="md" empresa={a.origem === "empresa"} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{a.nome}</p>
                      <p className="text-2xs text-muted-foreground truncate">
                        {a.origem === "empresa" ? `${a.anos} anos de empresa` : `faz ${a.anos} anos`}
                      </p>
                    </div>
                    {a.diasAte === 0 ? (
                      <Badge>hoje</Badge>
                    ) : (
                      <span className="text-2xs text-muted-foreground shrink-0">{a.diasAte === 1 ? "amanhã" : `em ${a.diasAte} dias`}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CartaoResumo>
        )}

        {p.ativo("pendenciasFiscais") && (
          <CartaoResumo
            titulo="Situação fiscal"
            cor="fiscal"
            icon={Landmark}
            variante={variante}
            link={{ to: "/pendencias-fiscais", texto: "Abrir" }}
            style={passo(11)}
          >
            <div className="grid grid-cols-2 gap-3">
              <Stat rotulo={plural(fiscal?.com_pendencia ?? 0, "empresa com pendência", "empresas com pendência")} valor={fiscal?.com_pendencia ?? 0} cor="fiscal" carregando={c} />
              <Stat rotulo={plural(fiscal?.ok ?? 0, "empresa em dia", "empresas em dia")} valor={fiscal?.ok ?? 0} cor="whatsapp" carregando={c} />
            </div>
          </CartaoResumo>
        )}
        </div>
      </div>
    </section>
  );
}


// ---------------------------------------------------------------------------
// Troca de estilo (só configuracoes.gerenciar; vale para todos)
// ---------------------------------------------------------------------------

