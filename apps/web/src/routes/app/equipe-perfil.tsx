import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ClipboardCheck,
  ClipboardList,
  ClipboardPlus,
  Clock,
  Hand,
  Landmark,
  LogIn,
  Mail,
  MessageSquare,
  MonitorSmartphone,
  PenLine,
  Phone,
  Send,
  ShieldOff,
  Timer,
  UserPlus,
  UserRoundSearch,
  type LucideIcon,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";

import { ColaboradorAvatar } from "@/components/colaborador-avatar";
import { TempoRelativo } from "@/components/features/auditoria/linha-do-tempo";
import {
  AbaAcessos,
  AbaAtendimentos,
  AbaAtividade,
  AbaChamados,
  AbaMensagens,
  BotaoEncerrarSessoes,
} from "@/components/features/perfil/perfil-abas";
import { MarcaDagua } from "@/components/marca-hexagono";
import { PageContainer } from "@/components/page-container";
import { FAIXA_TOPO } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Chips } from "@/components/ui/chips";
import { DatePicker } from "@/components/ui/date-picker";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryError } from "@/components/ui/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { usePageTitle } from "@/hooks/use-page-title";
import { useEu } from "@/lib/colaborador";
import { corModulo, type CorModulo } from "@/lib/cores-modulo";
import { formatData, formatTelefone, hojeISO } from "@/lib/format";
import { useOnlineAgora } from "@/lib/presenca-painel";
import {
  erroNaoEncontrado,
  erroSemAcesso,
  intervaloPerfil,
  PERIODOS_PERFIL,
  usePerfil,
  usePerfilKpis,
  type PerfilColaborador,
  type PerfilKpis,
  type PeriodoPerfil,
} from "@/lib/queries/perfil";
import { cn } from "@/lib/utils";

const ABAS = ["atividade", "atendimentos", "chamados", "mensagens", "acessos"] as const;
type Aba = (typeof ABAS)[number];

/**
 * Perfil de uma pessoa da equipe: quem é, o que fez e o que está com ela.
 * Administrador (auditoria.ver) vê qualquer pessoa; os demais, só o próprio
 * perfil. A regra mora nas RPCs da migration 016 (a tela só reflete).
 */
export function PerfilColaboradorPage() {
  const { id } = useParams<{ id: string }>();
  const q = usePerfil(id);
  usePageTitle(q.data ? q.data.nome : "Perfil");

  if (!id) return <Navigate to="/equipe" replace />;
  if (q.isLoading) return <PerfilSkeleton />;
  if (q.isError) {
    if (erroSemAcesso(q.error)) return <SemAcesso />;
    if (erroNaoEncontrado(q.error)) return <NaoEncontrado />;
    return (
      <PageContainer>
        <QueryError oque="o perfil" error={q.error} onRetry={q.refetch} />
      </PageContainer>
    );
  }
  if (!q.data) return <NaoEncontrado />;
  return <Perfil p={q.data} />;
}

function Voltar() {
  const { tem } = useEu();
  const equipe = tem("equipe.ver") || tem("equipe.gerenciar");
  return (
    <Link
      to={equipe ? "/equipe" : "/"}
      className="relative inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground max-lg:-my-2.5 max-lg:py-2.5"
    >
      <ChevronLeft className="size-4" />
      {equipe ? "Equipe" : "Início"}
    </Link>
  );
}

function SemAcesso() {
  const { euId } = useEu();
  return (
    <PageContainer className="space-y-4">
      <Voltar />
      <EmptyState
        icon={ShieldOff}
        cor="equipe"
        title="Sem acesso"
        description="Só administradores veem o perfil de outras pessoas da equipe. O seu perfil você sempre pode abrir."
        action={
          euId ? (
            <Link to={`/equipe/${euId}`} className="text-sm font-semibold text-primary hover:underline">
              Abrir o meu perfil
            </Link>
          ) : undefined
        }
      />
    </PageContainer>
  );
}

function NaoEncontrado() {
  return (
    <PageContainer className="space-y-4">
      <Voltar />
      <EmptyState
        icon={UserRoundSearch}
        cor="equipe"
        title="Pessoa não encontrada"
        description="Ela pode ter sido excluída da equipe. O histórico do que fez continua na auditoria."
      />
    </PageContainer>
  );
}

function PerfilSkeleton() {
  return (
    <PageContainer className="space-y-6" aria-busy="true">
      <div className="flex items-center gap-4">
        <Skeleton className="size-16 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-7 w-56 max-w-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-card" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-card" />
    </PageContainer>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

function Perfil({ p }: { p: PerfilColaborador }) {
  const [params, setParams] = useSearchParams();
  const abaParam = params.get("aba") as Aba | null;
  const aba: Aba = abaParam && ABAS.includes(abaParam) ? abaParam : "atividade";

  const periodoParam = params.get("periodo") as PeriodoPerfil | null;
  const periodo: PeriodoPerfil = PERIODOS_PERFIL.some((x) => x.valor === periodoParam) ? periodoParam! : "7d";
  const de = params.get("de") ?? "";
  const ate = params.get("ate") ?? "";
  const intervalo = useMemo(() => intervaloPerfil(periodo, { de, ate }), [periodo, de, ate]);

  function mudar(muda: (n: URLSearchParams) => void) {
    setParams(
      (atual) => {
        const n = new URLSearchParams(atual);
        muda(n);
        return n;
      },
      { replace: true },
    );
  }

  function escolherPeriodo(v: PeriodoPerfil) {
    mudar((n) => {
      if (v === "7d") n.delete("periodo");
      else n.set("periodo", v);
      if (v === "personalizado") {
        if (!n.get("de")) n.set("de", hojeISO(-6));
        if (!n.get("ate")) n.set("ate", hojeISO());
      } else {
        n.delete("de");
        n.delete("ate");
      }
    });
  }

  return (
    <PageContainer className="space-y-6">
      <Cabecalho p={p} />

      <section aria-labelledby="perfil-numeros" className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <h2 id="perfil-numeros" className="text-title-md font-semibold">
            O que {p.proprio ? "você fez" : "fez"} no período
          </h2>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <Chips rotulo="Período" opcoes={PERIODOS_PERFIL} valor={periodo} onChange={escolherPeriodo} />
            {periodo === "personalizado" && (
              <div className="grid grid-cols-2 gap-2 sm:w-80">
                <DatePicker value={de} onChange={(v) => mudar((n) => n.set("de", v))} placeholder="De" aria-label="De" />
                <DatePicker value={ate} onChange={(v) => mudar((n) => n.set("ate", v))} placeholder="Até" aria-label="Até" />
              </div>
            )}
          </div>
        </div>
        {periodo === "personalizado" && !intervalo ? (
          <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
            Escolha as duas datas, com a primeira antes da segunda.
          </p>
        ) : (
          <Kpis id={p.id} proprio={p.proprio} intervalo={intervalo} />
        )}
      </section>

      <Tabs value={aba} onValueChange={(v) => mudar((n) => (v === "atividade" ? n.delete("aba") : n.set("aba", v)))}>
        <TabsList aria-label="Seções do perfil">
          <TabsTrigger value="atividade">
            <Activity />
            Atividade
          </TabsTrigger>
          <TabsTrigger value="atendimentos">
            <MessageSquare />
            Atendimentos
          </TabsTrigger>
          <TabsTrigger value="chamados">
            <ClipboardList />
            Chamados
          </TabsTrigger>
          <TabsTrigger value="mensagens">
            <Send />
            Mensagens
          </TabsTrigger>
          <TabsTrigger value="acessos">
            <LogIn />
            Acessos
          </TabsTrigger>
        </TabsList>
        <TabsContent value="atividade" className="mt-4">
          <AbaAtividade p={p} />
        </TabsContent>
        <TabsContent value="atendimentos" className="mt-4">
          <AbaAtendimentos p={p} />
        </TabsContent>
        <TabsContent value="chamados" className="mt-4">
          <AbaChamados p={p} />
        </TabsContent>
        <TabsContent value="mensagens" className="mt-4">
          <AbaMensagens p={p} intervalo={intervalo} />
        </TabsContent>
        <TabsContent value="acessos" className="mt-4">
          <AbaAcessos p={p} />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}

// ---------------------------------------------------------------------------
// Cabeçalho
// ---------------------------------------------------------------------------

function Cabecalho({ p }: { p: PerfilColaborador }) {
  const onlineDesde = useOnlineAgora(p.id);
  return (
    <header className={cn(FAIXA_TOPO, "space-y-3")} style={corModulo("equipe")}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,transparent_55%,color-mix(in_srgb,var(--mc)_7%,transparent))]"
      />
      <MarcaDagua />
      <Voltar />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span className="relative shrink-0">
            <ColaboradorAvatar nome={p.nome} cor={p.cor} size="lg" className="size-16 text-lg" />
            {onlineDesde && (
              <span
                className="absolute bottom-0.5 right-0.5 size-3.5 rounded-full border-2 border-background bg-success"
                aria-hidden
              />
            )}
          </span>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[22px] font-bold leading-tight tracking-[-0.015em] sm:text-[28px]">{p.nome}</h1>
              {p.proprio && <Badge variant="secondary">você</Badge>}
              {p.ativo ? <Badge variant="success">Ativo</Badge> : <Badge variant="outline">Inativo</Badge>}
            </div>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {p.cargo && <span className="font-medium text-foreground">{p.cargo}</span>}
              {p.email && (
                <a href={`mailto:${p.email}`} className="inline-flex min-w-0 items-center gap-1.5 hover:text-foreground">
                  <Mail className="size-3.5 shrink-0" />
                  <span className="truncate">{p.email}</span>
                </a>
              )}
              {p.telefone && (
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="size-3.5 shrink-0" />
                  {formatTelefone(p.telefone)}
                </span>
              )}
            </p>
          </div>
        </div>
        {p.podeEncerrarSessoes && (p.sessoesAtivas ?? 0) > 0 && (
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            <BotaoEncerrarSessoes p={p} />
          </div>
        )}
      </div>
      <dl className="relative grid grid-cols-2 gap-x-4 gap-y-3 pt-1 text-sm sm:flex sm:flex-wrap sm:gap-x-8">
        <Fato icon={onlineDesde ? Activity : Clock} rotulo={onlineDesde ? "Agora" : "Última atividade"}>
          {onlineDesde ? (
            <span className="font-semibold text-success">Online no painel</span>
          ) : p.ultimaAtividade ? (
            <TempoRelativo iso={p.ultimaAtividade} />
          ) : (
            "Nenhuma ainda"
          )}
        </Fato>
        <Fato icon={LogIn} rotulo="Último acesso">
          {p.ultimoLogin || p.ultimoSignIn ? (
            <TempoRelativo iso={maisRecente(p.ultimoLogin, p.ultimoSignIn)!} />
          ) : p.temLogin ? (
            "Nunca entrou"
          ) : (
            "Sem login"
          )}
        </Fato>
        <Fato icon={CalendarDays} rotulo="Na equipe desde">
          {formatData(p.criadoEm)}
        </Fato>
        {p.sessoesAtivas !== null && (
          <Fato icon={MonitorSmartphone} rotulo="Sessões abertas">
            {p.sessoesAtivas.toLocaleString("pt-BR")}
          </Fato>
        )}
      </dl>
    </header>
  );
}

function maisRecente(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a) > new Date(b) ? a : b;
}

function Fato({ icon: Icon, rotulo, children }: { icon: LucideIcon; rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5" aria-hidden />
        {rotulo}
      </dt>
      <dd className="mt-0.5 truncate">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Números
// ---------------------------------------------------------------------------

function minutos(m: number | null | undefined): string {
  if (m === null || m === undefined) return "-";
  if (m < 1) return `${Math.round(m * 60)} s`;
  if (m < 60) return `${m.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} min`;
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return r ? `${h} h ${String(r).padStart(2, "0")} min` : `${h} h`;
}

const n = (v: number) => v.toLocaleString("pt-BR");

type Tile = {
  chave: string;
  icon: LucideIcon;
  cor: CorModulo;
  rotulo: string;
  valor: string;
  sub?: string;
  alerta?: boolean;
  dica?: string;
};

function tilesDe(k: PerfilKpis, proprio: boolean): Tile[] {
  const r = k.chamadosResponsavel;
  return [
    { chave: "agora", icon: MessageSquare, cor: "whatsapp", rotulo: "Em atendimento agora", valor: n(k.conversasAgora) },
    { chave: "assumidas", icon: Hand, cor: "whatsapp", rotulo: "Conversas assumidas", valor: n(k.assumidas), sub: k.recebidas ? `+${n(k.recebidas)} recebidas por transferência` : undefined },
    { chave: "finalizadas", icon: CheckCircle2, cor: "whatsapp", rotulo: "Finalizadas", valor: n(k.finalizadas) },
    { chave: "transferidas", icon: ArrowLeftRight, cor: "whatsapp", rotulo: "Transferidas", valor: n(k.transferidas), sub: k.devolvidas ? `${n(k.devolvidas)} devolvidas à fila` : undefined },
    { chave: "mensagens", icon: Send, cor: "whatsapp", rotulo: "Mensagens enviadas", valor: n(k.mensagensEnviadas) },
    {
      chave: "resposta",
      icon: Timer,
      cor: "whatsapp",
      rotulo: "1ª resposta (aprox.)",
      valor: minutos(k.primeiraResposta.mediaMin),
      sub: k.primeiraResposta.respondidas
        ? `mediana ${minutos(k.primeiraResposta.medianaMin)} · ${n(k.primeiraResposta.respondidas)} conversa(s)`
        : "sem respostas no período",
      dica: "Aproximado: por conversa e por dia, o tempo entre a 1ª mensagem do cliente e a 1ª resposta, quando essa resposta foi desta pessoa. Esperas acima de 24 h não entram.",
    },
    { chave: "chAbertos", icon: ClipboardPlus, cor: "chamados", rotulo: proprio ? "Chamados abertos por você" : "Chamados abertos pela pessoa", valor: n(k.chamadosAbertosPorEle) },
    { chave: "chResp", icon: ClipboardList, cor: "chamados", rotulo: "Sob responsabilidade", valor: n(r.abertos), sub: "em aberto agora" },
    { chave: "chAtrasados", icon: AlertTriangle, cor: "chamados", rotulo: "Atrasados", valor: n(r.atrasados), sub: "prazo vencido, agora", alerta: r.atrasados > 0 },
    { chave: "chConcluidos", icon: ClipboardCheck, cor: "chamados", rotulo: "Chamados concluídos", valor: n(r.concluidos) },
    { chave: "cliNovos", icon: UserPlus, cor: "clientes", rotulo: "Clientes cadastrados", valor: n(k.clientesCadastrados) },
    { chave: "cliEditados", icon: PenLine, cor: "clientes", rotulo: "Clientes editados", valor: n(k.clientesEditados) },
    { chave: "serpro", icon: Landmark, cor: "fiscal", rotulo: "Consultas Serpro", valor: n(k.consultasSerpro), sub: "feitas pela pessoa (sem as agendadas)" },
    { chave: "logins", icon: LogIn, cor: "equipe", rotulo: "Entradas no painel", valor: n(k.logins) },
    { chave: "eventos", icon: Activity, cor: "equipe", rotulo: "Ações registradas", valor: n(k.eventos), sub: "tudo o que entrou na auditoria" },
  ];
}

function Kpis({ id, proprio, intervalo }: { id: string; proprio: boolean; intervalo: { de: Date; ate: Date } | null }) {
  const q = usePerfilKpis(id, intervalo);
  if (q.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" aria-busy="true">
        {Array.from({ length: 15 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-card" />
        ))}
      </div>
    );
  }
  if (q.isError && !q.data) return <QueryError oque="os números" error={q.error} onRetry={q.refetch} />;
  if (!q.data) return null;
  return (
    <ul
      className={cn(
        "grid grid-cols-2 gap-2 transition-opacity sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5",
        q.isPlaceholderData && "opacity-60",
      )}
    >
      {tilesDe(q.data, proprio).map((t, i) => (
        <li
          key={t.chave}
          style={{ ...corModulo(t.cor), animationDelay: `${i * 30}ms` }}
          className={cn(
            "animate-page-enter flex min-w-0 flex-col gap-2 rounded-card border bg-card p-3 shadow-card sm:p-4",
            t.alerta && "border-warning/40 bg-warning/5",
          )}
        >
          <div className="flex items-center gap-2">
            <span className="chip-mod grid size-7 shrink-0 place-items-center rounded-lg">
              <t.icon className="size-3.5" aria-hidden />
            </span>
            <span className="min-w-0 text-xs leading-tight text-muted-foreground [text-wrap:balance]">{t.rotulo}</span>
          </div>
          {t.dica ? (
            <Tooltip label={<span className="block max-w-64 text-xs">{t.dica}</span>}>
              <p tabIndex={0} className={cn("nums w-fit cursor-help text-2xl font-bold leading-none", t.alerta ? "text-warning" : "texto-mod")}>
                {t.valor}
              </p>
            </Tooltip>
          ) : (
            <p className={cn("nums text-2xl font-bold leading-none", t.alerta ? "text-warning" : "texto-mod")}>{t.valor}</p>
          )}
          {t.sub && <p className="text-2xs leading-snug text-muted-foreground">{t.sub}</p>}
        </li>
      ))}
    </ul>
  );
}
