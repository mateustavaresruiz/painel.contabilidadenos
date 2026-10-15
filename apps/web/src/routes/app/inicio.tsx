import {
  ArrowRight,
  BadgeCheck,
  Cake,
  ClipboardList,
  Landmark,
  MessageSquare,
  Users,
  type LucideIcon,
} from "lucide-react";
import { lazy, Suspense, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { EstadoBadge } from "@/components/features/configuracoes/estado-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chips } from "@/components/ui/chips";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageTitle } from "@/hooks/use-page-title";
import { useAlgumaPermissao, useEu, usePermissao } from "@/lib/colaborador";
import { msgErro } from "@/lib/erro";
import { useEhAdmin, useModulos, type ModuloChave } from "@/lib/modulos";
import { PERIODOS, useDashboard, type Dashboard, type Periodo } from "@/lib/queries/dashboard";
import { useResumoSaude } from "@/lib/queries/saude";
import { cn } from "@/lib/utils";

// recharts só baixa quando o gráfico aparece.
const GraficoMensagens = lazy(() =>
  import("@/components/features/dashboard/graficos").then((m) => ({ default: m.GraficoMensagens })),
);
const GraficoBarras = lazy(() =>
  import("@/components/features/dashboard/graficos").then((m) => ({ default: m.GraficoBarras })),
);

const CHAVE_PERIODO = "denos:dashboard-periodo";

/** O período como complemento de frase: "3 novos nos últimos 7 dias". */
const NO_PERIODO: Record<Periodo, string> = {
  hoje: "hoje",
  "7d": "nos últimos 7 dias",
  "30d": "nos últimos 30 dias",
  mes: "neste mês",
};

function periodoSalvo(): Periodo {
  try {
    const v = localStorage.getItem(CHAVE_PERIODO);
    if (v === "hoje" || v === "7d" || v === "30d" || v === "mes") return v;
  } catch {
    /* sem storage */
  }
  return "7d";
}

/** Atraso da entrada escalonada: passos de 40ms. */
const passo = (i: number): CSSProperties => ({ animationDelay: `${i * 40}ms` });

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Visão geral: números do escritório no período, numa RPC só (painel_dashboard). */
export function InicioPage() {
  usePageTitle("Visão geral");
  const { eu } = useEu();
  const { ativo } = useModulos();
  const verNumeros = usePermissao("dashboard.ver");
  const verSaude = usePermissao("configuracoes.gerenciar");
  const [periodo, setPeriodo] = useState<Periodo>(periodoSalvo);
  const { data, isLoading, error, isFetching } = useDashboard(periodo, verNumeros);

  function escolher(p: Periodo) {
    setPeriodo(p);
    try {
      localStorage.setItem(CHAVE_PERIODO, p);
    } catch {
      /* sem storage */
    }
  }

  const saudacao = (() => {
    const h = new Date().getHours();
    return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  })();
  const hoje = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const rotuloPeriodo = NO_PERIODO[periodo];
  const props = { d: data, carregando: isLoading, rotulo: rotuloPeriodo };
  const temAtendimento = ativo("whatsapp");

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-[1440px]">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between animate-rise">
        <div className="min-w-0 space-y-1">
          <p className="eyebrow first-letter:uppercase">{hoje}</p>
          <h1 className="text-title-lg">
            {saudacao}
            {eu?.nome ? `, ${eu.nome.split(" ")[0]}` : ""}
          </h1>
          {verNumeros && <Contexto d={data} carregando={isLoading} />}
        </div>
        {verNumeros && (
          <Chips opcoes={PERIODOS} valor={periodo} onChange={escolher} rotulo="Período" className="lg:justify-end" />
        )}
      </header>

      {verSaude && (
        <div className="animate-rise" style={passo(1)}>
          <FaixaSaude />
        </div>
      )}

      {!verNumeros ? (
        <Bloco className="animate-rise" style={passo(2)}>
          <Vazio
            icon={ArrowRight}
            titulo="Tudo à mão no menu"
            texto="Use o menu ao lado para abrir o que você precisa. Os números do escritório aparecem aqui para quem tem essa permissão no cargo."
          />
        </Bloco>
      ) : error ? (
        <Bloco>
          <p className="text-sm text-destructive">Não foi possível carregar a visão geral: {msgErro(error)}</p>
        </Bloco>
      ) : (
        <div className={cn("space-y-6 transition-opacity duration-200", isFetching && !isLoading && "opacity-60")}>
          <Destaques {...props} />
          <div className="grid gap-4 sm:gap-6 lg:grid-cols-3 lg:items-start">
            {temAtendimento && (
              <SecaoAtendimento {...props} className="lg:col-span-2 animate-rise" style={passo(6)} />
            )}
            {ativo("chamados") && (
              <SecaoChamados
                {...props}
                className={cn("animate-rise", !temAtendimento && "lg:col-span-3")}
                style={passo(7)}
              />
            )}
            {ativo("clientes") && <SecaoClientes {...props} className="animate-rise" style={passo(8)} />}
            {ativo("clientes") && <SecaoAniversarios {...props} className="animate-rise" style={passo(9)} />}
            {(ativo("certificados") || ativo("pendenciasFiscais")) && (
              <div className="grid gap-4 sm:gap-6 content-start animate-rise" style={passo(10)}>
                {ativo("certificados") && <SecaoCertificados {...props} />}
                {ativo("pendenciasFiscais") && <SecaoFiscal {...props} />}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Peças
// ---------------------------------------------------------------------------

type SecaoProps = {
  d: Dashboard | undefined;
  carregando: boolean;
  rotulo: string;
  className?: string;
  style?: CSSProperties;
};

/** Cartão base: canvas, hairline, raio 18. */
function Bloco({ className, style, children }: { className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <section className={cn("rounded-card border bg-card text-card-foreground p-5 sm:p-6", className)} style={style}>
      {children}
    </section>
  );
}

function Secao({
  titulo,
  subtitulo,
  link,
  children,
  className,
  style,
}: {
  titulo: string;
  subtitulo?: string;
  link?: { to: string; texto: string };
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <Bloco className={cn("flex flex-col gap-5", className)} style={style}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-title-sm font-semibold">{titulo}</h2>
          {subtitulo && <p className="text-xs text-muted-foreground mt-0.5">{subtitulo}</p>}
        </div>
        {link && (
          <Link
            to={link.to}
            className="shrink-0 text-xs text-primary inline-flex items-center gap-1 rounded-full px-2.5 py-1 -mr-2 hover:bg-primary/[0.08] transition-colors"
          >
            {link.texto}
            <ArrowRight className="size-3.5" />
          </Link>
        )}
      </div>
      {children}
    </Bloco>
  );
}

/** Ícone num círculo do acento a 10%. */
function Icone({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span className={cn("grid place-items-center size-9 rounded-full bg-primary/10 text-primary shrink-0", className)}>
      <Icon className="size-[18px]" />
    </span>
  );
}

/** Vazio com a próxima ação: ícone, frase curta, botão. */
function Vazio({
  icon,
  titulo,
  texto,
  acao,
  compacto,
}: {
  icon: LucideIcon;
  titulo: string;
  texto?: string;
  acao?: { to: string; texto: string };
  compacto?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex-1 rounded-pearl bg-background flex flex-col items-center justify-center text-center gap-2 px-5",
        compacto ? "py-6" : "py-10",
      )}
    >
      <Icone icon={icon} />
      <p className="text-sm font-semibold mt-1">{titulo}</p>
      {texto && <p className="text-xs text-muted-foreground max-w-xs [text-wrap:pretty]">{texto}</p>}
      {acao && (
        <Button asChild size="sm" className="mt-2 rounded-full">
          <Link to={acao.to}>{acao.texto}</Link>
        </Button>
      )}
    </div>
  );
}

/** Número pequeno dentro de uma seção (12px rótulo, 21px valor). */
function Mini({
  rotulo,
  valor,
  carregando,
  to,
  badge,
}: {
  rotulo: string;
  valor: ReactNode;
  carregando: boolean;
  to?: string;
  badge?: ReactNode;
}) {
  const corpo = (
    <>
      <p className="text-2xs text-muted-foreground truncate">{rotulo}</p>
      {carregando ? (
        <Skeleton className="h-6 w-12 mt-1" />
      ) : (
        <p className="text-title-md font-semibold nums mt-0.5 flex items-center gap-2 flex-wrap">
          {valor}
          {badge}
        </p>
      )}
    </>
  );
  const base = "block rounded-pearl bg-background px-3.5 py-3 min-w-0";
  return to ? (
    <Link to={to} className={cn(base, "transition-[background-color,transform] duration-150 hover:bg-accent active:scale-[.98]")}>
      {corpo}
    </Link>
  ) : (
    <div className={base}>{corpo}</div>
  );
}

function Iniciais({ nome }: { nome: string }) {
  const p = nome.trim().split(/\s+/);
  const ini = ((p[0]?.[0] ?? "") + (p.length > 1 ? (p[p.length - 1][0] ?? "") : "")).toUpperCase();
  return (
    <span
      aria-hidden
      className="grid place-items-center size-8 rounded-full bg-primary/10 text-primary text-2xs font-semibold shrink-0"
    >
      {ini || "?"}
    </span>
  );
}

/** Ranking em lista: iniciais, nome, barra fina proporcional, total. */
function Ranking({ dados, avatar = true }: { dados: { nome: string; total: number }[]; avatar?: boolean }) {
  const max = Math.max(1, ...dados.map((d) => d.total));
  return (
    <ul className="space-y-3">
      {dados.slice(0, 6).map((d) => (
        <li key={d.nome} className="flex items-center gap-3">
          {avatar && <Iniciais nome={d.nome} />}
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate">{d.nome}</span>
              <span className="nums font-semibold">{d.total}</span>
            </div>
            <div className="h-1.5 rounded-full bg-foreground/[0.06] overflow-hidden">
              <div className="h-full rounded-full bg-primary" style={{ width: `${(d.total / max) * 100}%` }} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function SkeletonLista({ linhas = 3 }: { linhas?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: linhas }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-1.5 w-full rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function minutos(v: number | null): string {
  if (v == null) return "-";
  if (v < 1) return "< 1 min";
  if (v < 60) return `${Math.round(v)} min`;
  const h = Math.floor(v / 60);
  const m = Math.round(v % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

// ---------------------------------------------------------------------------
// Cabeçalho: linha de contexto
// ---------------------------------------------------------------------------

function Contexto({ d, carregando }: { d: Dashboard | undefined; carregando: boolean }) {
  const { ativo } = useModulos();
  if (carregando || !d) return <Skeleton className="h-4 w-56 mt-1" />;
  const partes: string[] = [];
  if (ativo("whatsapp") && d.atendimento.semResponsavel > 0)
    partes.push(plural(d.atendimento.semResponsavel, "conversa aguardando resposta", "conversas aguardando resposta"));
  if (ativo("chamados") && d.chamados.atrasados > 0)
    partes.push(plural(d.chamados.atrasados, "chamado atrasado", "chamados atrasados"));
  if (ativo("certificados") && d.certificados.vencidos > 0)
    partes.push(plural(d.certificados.vencidos, "certificado vencido", "certificados vencidos"));
  const niver = ativo("clientes") ? d.aniversarios.filter((a) => a.diasAte === 0).length : 0;
  if (niver > 0) partes.push(plural(niver, "aniversário hoje", "aniversários hoje"));
  return (
    <p className="text-sm text-muted-foreground pt-1">
      {partes.length ? partes.join(" · ") : "Nada pedindo sua atenção agora. Bom trabalho."}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Destaques: 4 números grandes, cada um leva à sua página
// ---------------------------------------------------------------------------

type Destaque = {
  modulo: ModuloChave;
  icon: LucideIcon;
  rotulo: string;
  valor: number;
  to: string;
  detalhe: ReactNode;
};

function Destaques({ d, carregando, rotulo }: SecaoProps) {
  const { ativo } = useModulos();
  const a = d?.atendimento;
  const ch = d?.chamados;
  const cl = d?.clientes;
  const ce = d?.certificados;
  const fi = d?.fiscal?.ultimaPorStatus;
  const todos: Destaque[] = [
    {
      modulo: "whatsapp",
      icon: MessageSquare,
      rotulo: "Conversas ativas",
      valor: a?.conversasAtivas ?? 0,
      to: "/whatsapp",
      detalhe:
        a && a.semResponsavel > 0 ? (
          <Badge variant="warning">{plural(a.semResponsavel, "sem responsável", "sem responsável")}</Badge>
        ) : (
          `${(a?.recebidas ?? 0) + (a?.enviadas ?? 0)} mensagens ${rotulo}`
        ),
    },
    {
      modulo: "chamados",
      icon: ClipboardList,
      rotulo: "Chamados em aberto",
      valor: (ch?.abertos ?? 0) + (ch?.emAndamento ?? 0),
      to: "/chamados",
      detalhe:
        ch && ch.atrasados > 0 ? (
          <Badge variant="destructive">{plural(ch.atrasados, "atrasado", "atrasados")}</Badge>
        ) : (
          `${ch?.concluidosNoPeriodo ?? 0} concluídos ${rotulo}`
        ),
    },
    {
      modulo: "clientes",
      icon: Users,
      rotulo: "Clientes ativos",
      valor: cl?.ativos ?? 0,
      to: "/clientes",
      detalhe: `${plural(cl?.novosNoPeriodo ?? 0, "novo", "novos")} ${rotulo}`,
    },
    {
      modulo: "certificados",
      icon: BadgeCheck,
      rotulo: "Certificados a vencer",
      valor: ce?.vencem30 ?? 0,
      to: "/certificados?status=vencendo",
      detalhe:
        ce && ce.vencidos > 0 ? (
          <Badge variant="destructive">{plural(ce.vencidos, "vencido", "vencidos")}</Badge>
        ) : (
          "nos próximos 30 dias"
        ),
    },
    {
      modulo: "pendenciasFiscais",
      icon: Landmark,
      rotulo: "Com pendência fiscal",
      valor: fi?.com_pendencia ?? 0,
      to: "/pendencias-fiscais",
      detalhe: `${fi?.ok ?? 0} regulares`,
    },
  ];
  const lista = todos.filter((t) => ativo(t.modulo)).slice(0, 4);
  if (lista.length === 0) return null;
  return (
    <div className={cn("grid gap-3 sm:gap-4 grid-cols-2", lista.length >= 3 && "lg:grid-cols-4", lista.length === 3 && "lg:grid-cols-3")}>
      {lista.map((t, i) => (
        <Link
          key={t.modulo}
          to={t.to}
          style={passo(2 + i)}
          className="animate-rise group rounded-card border bg-card p-4 sm:p-5 flex flex-col gap-3 sm:gap-4 min-w-0 transition-[border-color,transform] duration-150 hover:border-primary/40 active:scale-[.98]"
        >
          <div className="flex items-center justify-between gap-2">
            <Icone icon={t.icon} />
            <ArrowRight className="size-4 text-muted-foreground opacity-0 -translate-x-1 transition-all duration-150 group-hover:opacity-100 group-hover:translate-x-0" />
          </div>
          <div className="min-w-0">
            {carregando ? (
              <Skeleton className="h-[38px] w-16" />
            ) : (
              <p className="text-title-xl font-semibold nums">{t.valor}</p>
            )}
            <p className="text-sm mt-1 truncate">{t.rotulo}</p>
            <div className="text-2xs text-muted-foreground mt-1.5 min-h-5 flex items-center truncate">
              {carregando ? <Skeleton className="h-3 w-24" /> : t.detalhe}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Saúde (mesmas checagens de Configurações > Integrações)
// ---------------------------------------------------------------------------

function FaixaSaude() {
  const { ativo } = useModulos();
  const ehAdmin = useEhAdmin();
  const itens = useResumoSaude({ whatsapp: ativo("whatsapp"), serpro: ativo("pendenciasFiscais") });
  const conteudo = (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <span className="eyebrow">Saúde</span>
      {itens.map((i) => (
        <span key={i.chave} className="inline-flex items-center gap-2 text-xs">
          <span>{i.nome}</span>
          <EstadoBadge estado={i.estado} rotulo={i.detalhe} />
        </span>
      ))}
      {ehAdmin && <ArrowRight className="size-4 text-muted-foreground ml-auto hidden sm:block" />}
    </div>
  );
  return ehAdmin ? (
    <Link
      to="/configuracoes?tab=integracoes"
      className="block rounded-card border bg-card/60 px-5 py-3 hover:bg-card transition-colors"
      aria-label="Saúde das integrações: abrir Configurações, Integrações"
    >
      {conteudo}
    </Link>
  ) : (
    <div className="rounded-card border bg-card/60 px-5 py-3">{conteudo}</div>
  );
}

// ---------------------------------------------------------------------------
// Seções
// ---------------------------------------------------------------------------

function SecaoAtendimento({ d, carregando, rotulo, className, style }: SecaoProps) {
  const a = d?.atendimento;
  const pr = a?.primeiraResposta;
  const podeConectar = useAlgumaPermissao(["whatsapp.conexoes", "configuracoes.gerenciar"]);
  const semConexao = a && a.conexoes.total === 0;
  return (
    <Secao
      titulo="Atendimento"
      subtitulo={`Mensagens por dia ${rotulo}`}
      link={{ to: "/whatsapp", texto: "Conversas" }}
      className={className}
      style={style}
    >
      <div className="grid gap-2 sm:gap-3 grid-cols-2 md:grid-cols-4">
        <Mini rotulo="Recebidas" valor={a?.recebidas ?? 0} carregando={carregando} />
        <Mini rotulo="Enviadas" valor={a?.enviadas ?? 0} carregando={carregando} />
        <Mini rotulo="1ª resposta (mediana)" valor={minutos(pr?.medianaMin ?? null)} carregando={carregando} />
        <Mini
          rotulo="Conexões online"
          valor={a ? `${a.conexoes.online}/${a.conexoes.total}` : "0/0"}
          carregando={carregando}
          to={podeConectar ? "/configuracoes?tab=conexoes" : undefined}
          badge={
            a && a.conexoes.total > 0 && a.conexoes.online < a.conexoes.total ? (
              <Badge variant="warning">offline</Badge>
            ) : undefined
          }
        />
      </div>
      {carregando ? (
        <Skeleton className="h-[268px] w-full rounded-pearl" />
      ) : semConexao ? (
        <Vazio
          icon={MessageSquare}
          titulo="Nenhum WhatsApp conectado"
          texto="Conecte um número para as conversas dos clientes chegarem aqui."
          acao={podeConectar ? { to: "/configuracoes?tab=conexoes", texto: "Conectar WhatsApp" } : undefined}
        />
      ) : !a || a.recebidas + a.enviadas === 0 ? (
        <Vazio
          icon={MessageSquare}
          titulo="Sem mensagens no período"
          texto="Quando os clientes escreverem, o movimento de cada dia aparece aqui."
        />
      ) : (
        <Suspense fallback={<Skeleton className="h-[268px] w-full rounded-pearl" />}>
          <GraficoMensagens dados={a.mensagensPorDia} />
        </Suspense>
      )}
      {!carregando && a && a.emAtendimentoPorColaborador.length > 0 && (
        <div className="space-y-3 border-t border-divider pt-4">
          <p className="eyebrow">Em atendimento agora</p>
          <Ranking dados={a.emAtendimentoPorColaborador} />
        </div>
      )}
      {pr && pr.respondidas > 0 && (
        <p className="text-2xs text-muted-foreground -mt-1">
          1ª resposta aproximada: média {minutos(pr.mediaMin)} em {plural(pr.respondidas, "conversa", "conversas")}
          {pr.semResposta ? `, ${pr.semResposta} sem resposta em 24h` : ""}.
        </p>
      )}
    </Secao>
  );
}

function SecaoChamados({ d, carregando, rotulo, className, style }: SecaoProps) {
  const c = d?.chamados;
  const podeAbrir = useAlgumaPermissao(["chamados.criar", "chamados.gerenciar"]);
  return (
    <Secao titulo="Chamados" subtitulo={`Mais pedidos ${rotulo}`} link={{ to: "/chamados", texto: "Ver todos" }} className={className} style={style}>
      <div className="grid gap-2 sm:gap-3 grid-cols-3">
        <Mini rotulo="Abertos" valor={c?.abertos ?? 0} carregando={carregando} to="/chamados" />
        <Mini rotulo="Andamento" valor={c?.emAndamento ?? 0} carregando={carregando} to="/chamados" />
        <Mini rotulo="Concluídos" valor={c?.concluidosNoPeriodo ?? 0} carregando={carregando} />
      </div>
      {carregando ? (
        <SkeletonLista />
      ) : !c || c.topTipos.length === 0 ? (
        <Vazio
          compacto
          icon={ClipboardList}
          titulo="Nenhum chamado no período"
          texto="Os tipos mais pedidos aparecem aqui."
          acao={podeAbrir ? { to: "/chamados", texto: "Abrir chamado" } : undefined}
        />
      ) : (
        <Suspense fallback={<SkeletonLista />}>
          <GraficoBarras dados={c.topTipos.slice(0, 6)} rotulo="Tipos de chamado mais pedidos" larguraNome={120} />
        </Suspense>
      )}
      {!carregando && c && c.porResponsavel.length > 0 && (
        <div className="space-y-3 border-t border-divider pt-4">
          <p className="eyebrow">Em aberto por responsável</p>
          <Ranking dados={c.porResponsavel} />
        </div>
      )}
    </Secao>
  );
}

function SecaoClientes({ d, carregando, rotulo, className, style }: SecaoProps) {
  const c = d?.clientes;
  const podeCadastrar = usePermissao("clientes.editar");
  return (
    <Secao titulo="Clientes" subtitulo="Por regime tributário" link={{ to: "/clientes", texto: "Ver todos" }} className={className} style={style}>
      <div className="grid gap-2 sm:gap-3 grid-cols-2">
        <Mini rotulo="Ativos" valor={c?.ativos ?? 0} carregando={carregando} to="/clientes" />
        <Mini rotulo={`Novos ${rotulo}`} valor={c?.novosNoPeriodo ?? 0} carregando={carregando} />
      </div>
      {carregando ? (
        <SkeletonLista />
      ) : !c || c.porRegime.length === 0 ? (
        <Vazio
          compacto
          icon={Users}
          titulo="Nenhum cliente ainda"
          texto="Cadastre o primeiro para acompanhar regime, sócios e aniversários."
          acao={podeCadastrar ? { to: "/clientes/novo", texto: "Cadastrar cliente" } : undefined}
        />
      ) : (
        <Ranking avatar={false} dados={c.porRegime.map((r) => ({ nome: r.regime, total: r.total }))} />
      )}
    </Secao>
  );
}

function SecaoAniversarios({ d, carregando, className, style }: SecaoProps) {
  const lista = d?.aniversarios ?? [];
  return (
    <Secao
      titulo="Aniversários"
      subtitulo="Próximos 7 dias"
      link={{ to: "/clientes/aniversarios", texto: "Ver todos" }}
      className={className}
      style={style}
    >
      {carregando ? (
        <SkeletonLista linhas={4} />
      ) : lista.length === 0 ? (
        <Vazio compacto icon={Cake} titulo="Nenhum aniversário por perto" texto="Ninguém faz aniversário nos próximos 7 dias." />
      ) : (
        <ul className="-my-2 divide-y divide-divider">
          {lista.slice(0, 7).map((a) => (
            <li key={`${a.origem}:${a.socioId ?? a.clienteId}`} className="flex items-center gap-3 py-2.5">
              <Iniciais nome={a.nome} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{a.nome}</p>
                <p className="text-2xs text-muted-foreground truncate">
                  {a.origem === "empresa" ? `${a.anos} anos de empresa` : `${a.anos} anos`}
                  {a.origem === "socio" ? ` · sócio de ${a.clienteNome}` : ""}
                </p>
              </div>
              {a.diasAte === 0 ? (
                <Badge>hoje</Badge>
              ) : (
                <span className="text-2xs text-muted-foreground shrink-0">
                  {a.diasAte === 1 ? "amanhã" : `em ${a.diasAte} dias`}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Secao>
  );
}

/** Linha de status: rótulo, número, badge opcional. */
function Linha({ rotulo, valor, to, badge }: { rotulo: string; valor: number; to?: string; badge?: ReactNode }) {
  const corpo = (
    <>
      <span className="flex-1 text-sm truncate">{rotulo}</span>
      {badge}
      <span className="nums text-sm font-semibold w-8 text-right">{valor}</span>
    </>
  );
  const base = "flex items-center gap-2 py-2.5";
  return (
    <li>
      {to ? (
        <Link to={to} className={cn(base, "rounded-lg -mx-2 px-2 hover:bg-accent transition-colors")}>
          {corpo}
        </Link>
      ) : (
        <div className={base}>{corpo}</div>
      )}
    </li>
  );
}

function SkeletonLinhas({ n = 3 }: { n?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: n }).map((_, i) => (
        <Skeleton key={i} className="h-5 w-full" />
      ))}
    </div>
  );
}

function SecaoCertificados({ d, carregando, rotulo }: SecaoProps) {
  const c = d?.certificados;
  const { ativo } = useModulos();
  const podeCadastrar = usePermissao("certificados.editar");
  return (
    <Secao titulo="Certificados" link={{ to: "/certificados", texto: "Ver todos" }}>
      {carregando ? (
        <SkeletonLinhas />
      ) : !c || c.total === 0 ? (
        <Vazio
          compacto
          icon={BadgeCheck}
          titulo="Nenhum certificado"
          texto="Cadastre para receber aviso antes de vencer."
          acao={podeCadastrar ? { to: "/certificados", texto: "Cadastrar certificado" } : undefined}
        />
      ) : (
        <ul className="-my-2 divide-y divide-divider">
          <Linha
            rotulo="Vencidos"
            valor={c.vencidos}
            to="/certificados?status=vencido"
            badge={c.vencidos > 0 ? <Badge variant="destructive">vencido</Badge> : undefined}
          />
          <Linha rotulo="Vencem em 7 dias" valor={c.vencem7} to="/certificados?status=vencendo" />
          <Linha rotulo="Vencem em 30 dias" valor={c.vencem30} to="/certificados?status=vencendo" />
          {ativo("certificadosAvisos") && (
            <Linha
              rotulo={`Avisos ${rotulo}`}
              valor={c.avisos.enviados}
              badge={c.avisos.falharam > 0 ? <Badge variant="warning">{c.avisos.falharam} falharam</Badge> : undefined}
            />
          )}
        </ul>
      )}
    </Secao>
  );
}

function SecaoFiscal({ d, carregando, rotulo }: SecaoProps) {
  const f = d?.fiscal;
  const u = f?.ultimaPorStatus;
  return (
    <Secao titulo="Pendências fiscais" link={{ to: "/pendencias-fiscais", texto: "Consultar" }}>
      {carregando ? (
        <SkeletonLinhas />
      ) : (
        <ul className="-my-2 divide-y divide-divider">
          <Linha rotulo="Regulares" valor={u?.ok ?? 0} badge={u && u.ok > 0 ? <Badge variant="success">ok</Badge> : undefined} />
          <Linha
            rotulo="Com pendência"
            valor={u?.com_pendencia ?? 0}
            to="/pendencias-fiscais"
            badge={u && u.com_pendencia > 0 ? <Badge variant="warning">pendência</Badge> : undefined}
          />
          <Linha
            rotulo="Com erro"
            valor={u?.erro ?? 0}
            badge={u && u.pendente > 0 ? <Badge variant="secondary">{u.pendente} aguardando</Badge> : undefined}
          />
          <Linha rotulo={`Consultas ${rotulo}`} valor={f?.consultasNoPeriodo ?? 0} />
        </ul>
      )}
    </Secao>
  );
}
