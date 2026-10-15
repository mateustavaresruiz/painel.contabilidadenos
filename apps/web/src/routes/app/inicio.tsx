import { ArrowRight, Cake } from "lucide-react";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { EstadoBadge } from "@/components/features/configuracoes/estado-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Chips } from "@/components/ui/chips";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageTitle } from "@/hooks/use-page-title";
import { useEu, usePermissao } from "@/lib/colaborador";
import { msgErro } from "@/lib/erro";
import { useEhAdmin, useModulos } from "@/lib/modulos";
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

function periodoSalvo(): Periodo {
  try {
    const v = localStorage.getItem(CHAVE_PERIODO);
    if (v === "hoje" || v === "7d" || v === "30d" || v === "mes") return v;
  } catch {
    /* sem storage */
  }
  return "7d";
}

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
  const rotuloPeriodo = PERIODOS.find((p) => p.valor === periodo)?.rotulo.toLowerCase() ?? "";

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">
            {new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <h1 className="text-title-lg mt-1">
            {saudacao}, {eu?.nome.split(" ")[0]}
          </h1>
        </div>
        {verNumeros && (
          <Chips opcoes={PERIODOS} valor={periodo} onChange={escolher} rotulo="Período" className="sm:justify-end" />
        )}
      </header>

      {verSaude && <FaixaSaude />}

      {!verNumeros ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Use o menu ao lado para abrir o que você precisa. Os números do escritório aparecem aqui para quem tem
            essa permissão no cargo.
          </CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            Não foi possível carregar a visão geral: {msgErro(error)}
          </CardContent>
        </Card>
      ) : (
        <div className={cn("space-y-6 transition-opacity", isFetching && !isLoading && "opacity-70")}>
          {ativo("whatsapp") && <SecaoAtendimento d={data} carregando={isLoading} rotulo={rotuloPeriodo} />}
          <div className="grid gap-6 xl:grid-cols-2">
            {ativo("chamados") && <SecaoChamados d={data} carregando={isLoading} rotulo={rotuloPeriodo} />}
            {ativo("clientes") && <SecaoClientes d={data} carregando={isLoading} rotulo={rotuloPeriodo} />}
            {ativo("certificados") && <SecaoCertificados d={data} carregando={isLoading} rotulo={rotuloPeriodo} />}
            {ativo("clientes") && <SecaoAniversarios d={data} carregando={isLoading} />}
            {ativo("pendenciasFiscais") && <SecaoFiscal d={data} carregando={isLoading} rotulo={rotuloPeriodo} />}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Peças
// ---------------------------------------------------------------------------

type SecaoProps = { d: Dashboard | undefined; carregando: boolean; rotulo: string };

function Secao({
  titulo,
  link,
  children,
  className,
}: {
  titulo: string;
  link?: { to: string; texto: string };
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="p-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-title-md">{titulo}</h2>
          {link && (
            <Link to={link.to} className="text-xs text-primary hover:underline inline-flex items-center gap-1">
              {link.texto}
              <ArrowRight className="size-3.5" />
            </Link>
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function Numero({
  rotulo,
  valor,
  carregando,
  to,
  detalhe,
  badge,
}: {
  rotulo: string;
  valor: ReactNode;
  carregando: boolean;
  to?: string;
  detalhe?: string;
  badge?: ReactNode;
}) {
  const corpo = (
    <>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      {carregando ? (
        <Skeleton className="h-9 w-16 mt-1" />
      ) : (
        <p className="text-title-xl font-semibold nums mt-0.5 flex items-center gap-2">
          {valor}
          {badge}
        </p>
      )}
      {detalhe && <p className="text-2xs text-muted-foreground mt-0.5">{detalhe}</p>}
    </>
  );
  return to ? (
    <Link to={to} className="block rounded-pearl -m-2 p-2 transition-[background-color,transform] duration-150 hover:bg-accent/60 active:scale-[.98]">
      {corpo}
    </Link>
  ) : (
    <div>{corpo}</div>
  );
}

function Vazio({ children }: { children: ReactNode }) {
  // Vazio com a forma do bloco (parchment dentro do cartão), não texto solto.
  return (
    <p className="rounded-pearl bg-background px-4 py-6 text-center text-xs text-muted-foreground [text-wrap:pretty]">
      {children}
    </p>
  );
}

function SkeletonGrafico({ altura = "h-40" }: { altura?: string }) {
  return <Skeleton className={cn("w-full", altura)} />;
}

function Barras({ dados, rotulo, vazio }: { dados: { nome: string; total: number }[]; rotulo: string; vazio: string }) {
  if (dados.length === 0) return <Vazio>{vazio}</Vazio>;
  return (
    <Suspense fallback={<SkeletonGrafico altura="h-24" />}>
      <GraficoBarras dados={dados} rotulo={rotulo} />
    </Suspense>
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
      className="block rounded-card border bg-card px-5 py-3 hover:bg-accent/40 transition-colors"
      aria-label="Saúde das integrações: abrir Configurações, Integrações"
    >
      {conteudo}
    </Link>
  ) : (
    <div className="rounded-card border bg-card px-5 py-3">{conteudo}</div>
  );
}

// ---------------------------------------------------------------------------
// Seções
// ---------------------------------------------------------------------------

function SecaoAtendimento({ d, carregando, rotulo }: SecaoProps) {
  const a = d?.atendimento;
  const { ativo } = useModulos();
  const pr = a?.primeiraResposta;
  return (
    <Secao titulo="Atendimento" link={{ to: "/whatsapp", texto: "Conversas" }}>
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        <Numero rotulo="Conversas ativas" valor={a?.conversasAtivas ?? 0} carregando={carregando} to="/whatsapp" />
        <Numero
          rotulo="Sem responsável"
          valor={a?.semResponsavel ?? 0}
          carregando={carregando}
          to="/whatsapp"
          badge={a && a.semResponsavel > 0 ? <Badge variant="warning">aguardando</Badge> : undefined}
        />
        <Numero
          rotulo={`Mensagens (${rotulo})`}
          valor={(a?.recebidas ?? 0) + (a?.enviadas ?? 0)}
          carregando={carregando}
          detalhe={a ? `${a.recebidas} recebidas · ${a.enviadas} enviadas` : undefined}
        />
        <Numero
          rotulo="1ª resposta (mediana)"
          valor={minutos(pr?.medianaMin ?? null)}
          carregando={carregando}
          detalhe={
            pr
              ? `Aproximado · média ${minutos(pr.mediaMin)} · ${pr.respondidas} respondidas${pr.semResposta ? `, ${pr.semResposta} sem resposta em 24h` : ""}`
              : "Aproximado"
          }
        />
        <Numero
          rotulo="Conexões online"
          valor={a ? `${a.conexoes.online}/${a.conexoes.total}` : "0/0"}
          carregando={carregando}
          to={ativo("whatsapp") ? "/configuracoes?tab=conexoes" : undefined}
          badge={
            a && a.conexoes.total > 0 && a.conexoes.online < a.conexoes.total ? (
              <Badge variant="warning">offline</Badge>
            ) : undefined
          }
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-2">
          <p className="eyebrow">Mensagens por dia</p>
          {carregando ? (
            <SkeletonGrafico altura="h-56" />
          ) : !a || a.recebidas + a.enviadas === 0 ? (
            <Vazio>Nenhuma mensagem no período.</Vazio>
          ) : (
            <Suspense fallback={<SkeletonGrafico altura="h-56" />}>
              <GraficoMensagens dados={a.mensagensPorDia} />
            </Suspense>
          )}
        </div>
        <div className="space-y-2">
          <p className="eyebrow">Em atendimento por pessoa</p>
          {carregando ? (
            <SkeletonGrafico />
          ) : (
            <Barras
              dados={a?.emAtendimentoPorColaborador ?? []}
              rotulo="Conversas em atendimento por colaborador"
              vazio="Ninguém com conversa em atendimento agora."
            />
          )}
        </div>
      </div>
    </Secao>
  );
}

function SecaoChamados({ d, carregando, rotulo }: SecaoProps) {
  const c = d?.chamados;
  return (
    <Secao titulo="Chamados" link={{ to: "/chamados", texto: "Ver chamados" }}>
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
        <Numero rotulo="Abertos" valor={c?.abertos ?? 0} carregando={carregando} to="/chamados" />
        <Numero rotulo="Em andamento" valor={c?.emAndamento ?? 0} carregando={carregando} to="/chamados" />
        <Numero
          rotulo={`Concluídos (${rotulo})`}
          valor={c?.concluidosNoPeriodo ?? 0}
          carregando={carregando}
          detalhe={c ? `${c.criadosNoPeriodo} criados no período` : undefined}
        />
        <Numero
          rotulo="Atrasados"
          valor={c?.atrasados ?? 0}
          carregando={carregando}
          to="/chamados"
          badge={c && c.atrasados > 0 ? <Badge variant="destructive">prazo vencido</Badge> : undefined}
        />
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="eyebrow">Mais pedidos ({rotulo})</p>
          {carregando ? (
            <SkeletonGrafico />
          ) : (
            <Barras dados={c?.topTipos ?? []} rotulo="Tipos de chamado mais pedidos" vazio="Nenhum chamado no período." />
          )}
        </div>
        <div className="space-y-2">
          <p className="eyebrow">Em aberto por responsável</p>
          {carregando ? (
            <SkeletonGrafico />
          ) : (
            <Barras
              dados={c?.porResponsavel ?? []}
              rotulo="Chamados em aberto por responsável"
              vazio="Nenhum chamado em aberto."
            />
          )}
        </div>
      </div>
    </Secao>
  );
}

function SecaoClientes({ d, carregando, rotulo }: SecaoProps) {
  const c = d?.clientes;
  return (
    <Secao titulo="Clientes" link={{ to: "/clientes", texto: "Ver clientes" }}>
      <div className="grid gap-4 grid-cols-2">
        <Numero rotulo="Ativos" valor={c?.ativos ?? 0} carregando={carregando} to="/clientes" />
        <Numero rotulo={`Novos (${rotulo})`} valor={c?.novosNoPeriodo ?? 0} carregando={carregando} />
      </div>
      <div className="space-y-2">
        <p className="eyebrow">Por regime tributário</p>
        {carregando ? (
          <SkeletonGrafico />
        ) : (
          <Barras
            dados={(c?.porRegime ?? []).map((r) => ({ nome: r.regime, total: r.total }))}
            rotulo="Clientes ativos por regime tributário"
            vazio="Nenhum cliente cadastrado ainda."
          />
        )}
      </div>
    </Secao>
  );
}

function SecaoCertificados({ d, carregando, rotulo }: SecaoProps) {
  const c = d?.certificados;
  const { ativo } = useModulos();
  return (
    <Secao titulo="Certificados digitais" link={{ to: "/certificados", texto: "Ver certificados" }}>
      {!carregando && c?.total === 0 ? (
        <Vazio>Nenhum certificado cadastrado. Cadastre em Certificados digitais para acompanhar a validade.</Vazio>
      ) : (
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
          <Numero
            rotulo="Vencidos"
            valor={c?.vencidos ?? 0}
            carregando={carregando}
            to="/certificados?status=vencido"
            badge={c && c.vencidos > 0 ? <Badge variant="destructive">vencido</Badge> : undefined}
          />
          <Numero rotulo="Vencem em 7 dias" valor={c?.vencem7 ?? 0} carregando={carregando} to="/certificados?status=vencendo" />
          <Numero rotulo="Vencem em 30 dias" valor={c?.vencem30 ?? 0} carregando={carregando} to="/certificados?status=vencendo" />
          <Numero
            rotulo={`Avisos (${rotulo})`}
            valor={c?.avisos.enviados ?? 0}
            carregando={carregando}
            detalhe={
              !ativo("certificadosAvisos")
                ? "Avisos automáticos desligados"
                : c && c.avisos.falharam > 0
                  ? `${c.avisos.falharam} não enviados`
                  : "enviados pelo WhatsApp"
            }
            badge={c && c.avisos.falharam > 0 ? <Badge variant="warning">falhas</Badge> : undefined}
          />
        </div>
      )}
    </Secao>
  );
}

function SecaoAniversarios({ d, carregando }: Omit<SecaoProps, "rotulo">) {
  const lista = d?.aniversarios ?? [];
  const hoje = lista.filter((a) => a.diasAte === 0);
  const semana = lista.filter((a) => a.diasAte > 0);
  const item = (a: Dashboard["aniversarios"][number]) => (
    <li key={`${a.origem}:${a.socioId ?? a.clienteId}`} className="flex items-center gap-2 py-2 text-sm">
      <Cake className="size-4 text-muted-foreground shrink-0" />
      <span className="flex-1 min-w-0 truncate">
        <span className="font-semibold">{a.nome}</span>
        <span className="text-muted-foreground">
          {" · "}
          {a.origem === "empresa" ? `${a.anos} anos de empresa` : `${a.anos} anos`}
          {a.origem === "socio" ? ` · sócio de ${a.clienteNome}` : ""}
        </span>
      </span>
      {a.diasAte === 0 ? (
        <Badge>hoje</Badge>
      ) : (
        <span className="text-2xs text-muted-foreground shrink-0">
          {a.diasAte === 1 ? "amanhã" : `em ${a.diasAte} dias`}
        </span>
      )}
    </li>
  );
  return (
    <Secao titulo="Aniversários" link={{ to: "/clientes/aniversarios", texto: "Ver todos" }}>
      {carregando ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      ) : lista.length === 0 ? (
        <Vazio>Ninguém faz aniversário nos próximos 7 dias.</Vazio>
      ) : (
        <div className="space-y-3">
          {hoje.length > 0 && <ul className="divide-y divide-divider">{hoje.map(item)}</ul>}
          {semana.length > 0 && (
            <div>
              <p className="eyebrow">Esta semana</p>
              <ul className="divide-y divide-divider">{semana.slice(0, 8).map(item)}</ul>
            </div>
          )}
        </div>
      )}
    </Secao>
  );
}

function SecaoFiscal({ d, carregando, rotulo }: SecaoProps) {
  const f = d?.fiscal;
  const u = f?.ultimaPorStatus;
  return (
    <Secao titulo="Pendências fiscais" link={{ to: "/pendencias-fiscais", texto: "Consultar" }}>
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
        <Numero rotulo={`Consultas (${rotulo})`} valor={f?.consultasNoPeriodo ?? 0} carregando={carregando} />
        <Numero
          rotulo="Regulares"
          valor={u?.ok ?? 0}
          carregando={carregando}
          detalhe="última consulta de cada cliente"
        />
        <Numero
          rotulo="Com pendência"
          valor={u?.com_pendencia ?? 0}
          carregando={carregando}
          to="/pendencias-fiscais"
          badge={u && u.com_pendencia > 0 ? <Badge variant="warning">pendência</Badge> : undefined}
        />
        <Numero
          rotulo="Com erro"
          valor={u?.erro ?? 0}
          carregando={carregando}
          detalhe={u && u.pendente > 0 ? `${u.pendente} aguardando` : undefined}
        />
      </div>
    </Secao>
  );
}
