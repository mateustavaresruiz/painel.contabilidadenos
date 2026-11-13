// Central de alertas fiscais (aba "Alertas" de Pendências fiscais).
// Regras em lib/alertas-fiscais.ts; dados em useAlertasFiscais (só banco,
// nunca o Serpro). Nada é enviado ao cliente: o WhatsApp abre com o texto
// pronto para a pessoa revisar.

import {
  AlarmClock,
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Download,
  FileText,
  FileWarning,
  History,
  KeyRound,
  Mail,
  MessageCircle,
  Receipt,
  ShieldCheck,
  ShieldOff,
  TriangleAlert,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { QueryError } from "@/components/ui/query-error";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-media-query";
import {
  type Alerta,
  type ChaveAlerta,
  type Gravidade,
  type SituacaoFiscal,
  cobertura,
  csvDoAlerta,
  montarAlertas,
  resumirAlertas,
} from "@/lib/alertas-fiscais";
import { useChartTokens } from "@/lib/chart-tokens";
import { corModulo } from "@/lib/cores-modulo";
import { formatDataHora, formatDoc, linkWaMe } from "@/lib/format";
import { useAlertasFiscais } from "@/lib/queries/serpro";
import { normalizarBusca, plural } from "@/lib/texto";
import { cn } from "@/lib/utils";

const ICONE: Record<ChaveAlerta, LucideIcon> = {
  sitfis_pendencia: FileWarning,
  sem_procuracao: ShieldOff,
  caixa_importante: Mail,
  pgdas: FileText,
  dctfweb: Receipt,
  procuracao_vencendo: CalendarClock,
  certificado_vencendo: BadgeCheck,
  consulta_erro: TriangleAlert,
  aguardando_pin: KeyRound,
  parcelamentos: Wallet,
  sitfis_desatualizada: History,
  nunca_consultada: CircleDashed,
};

/** Cor por gravidade (token semântico; DESIGN.md: status só em indicador). */
const TOM: Record<Gravidade, { cor: string; rotulo: string }> = {
  alta: { cor: "var(--destructive)", rotulo: "Grave" },
  media: { cor: "var(--warning)", rotulo: "Atenção" },
  baixa: { cor: "var(--muted-foreground)", rotulo: "Acompanhar" },
};

const SITUACAO: Record<SituacaoFiscal, string> = {
  regular: "Regular",
  com_pendencia: "Com pendência",
  parcelado: "Parcelado",
  erro: "Erro na consulta",
  nunca: "Nunca consultado",
};

const passo = (i: number): CSSProperties => ({ animationDelay: `${Math.min(i, 12) * 40}ms` });
const reduzMovimento = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Número que conta até o valor (respeita reduced-motion). */
function Contagem({ valor, className }: { valor: number; className?: string }) {
  const [v, setV] = useState(0);
  const de = useRef(0);
  useEffect(() => {
    if (reduzMovimento()) {
      setV(valor);
      de.current = valor;
      return;
    }
    const inicio = performance.now();
    const origem = de.current;
    let id = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - inicio) / 700);
      const atual = Math.round(origem + (valor - origem) * (1 - Math.pow(1 - p, 3)));
      setV(atual);
      de.current = atual;
      if (p < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [valor]);
  return <span className={cn("nums tabular-nums", className)}>{v.toLocaleString("pt-BR")}</span>;
}

export function CentralAlertas({ irParaConsultar }: { irParaConsultar?: () => void }) {
  const { data, isLoading, error, refetch, isFetching } = useAlertasFiscais();
  const [aberto, setAberto] = useState<ChaveAlerta | null>(null);

  const alertas = useMemo(() => (data ? montarAlertas(data.empresas) : []), [data]);
  const resumo = useMemo(() => resumirAlertas(alertas), [alertas]);
  const cob = useMemo(() => (data ? cobertura(data.empresas) : null), [data]);
  const atual = alertas.find((a) => a.chave === aberto) ?? null;

  if (isLoading) return <CentralSkeleton />;
  if (error && !data) return <QueryError oque="os alertas fiscais" error={error} onRetry={refetch} />;
  if (!data || data.empresas.length === 0) {
    return <EmptyState icon={ShieldCheck} title="Nenhum cliente ativo" description="Cadastre clientes para acompanhar os alertas fiscais." />;
  }
  if (!data.ultimaConsulta) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Ainda não há consultas"
        description="Os alertas aparecem aqui assim que as primeiras consultas ao Serpro forem feitas. Comece por um cliente."
        action={irParaConsultar && <Button onClick={irParaConsultar}>Fazer a primeira consulta</Button>}
      />
    );
  }

  const comProblema = resumo.empresasComProblema;
  const porGravidade = (g: Gravidade) => alertas.filter((a) => a.gravidade === g);

  return (
    <div className="space-y-6" style={corModulo("fiscal")}>
      {/* Faixa do topo */}
      <section className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div
          className={cn(
            "animate-rise relative overflow-hidden rounded-card border p-5 sm:p-6 shadow-card",
            comProblema > 0
              ? "border-[color:color-mix(in_srgb,var(--mc)_22%,transparent)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--mc)_12%,var(--card)),var(--card)_65%)]"
              : "border-[color:color-mix(in_srgb,var(--success)_22%,transparent)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--success)_12%,var(--card)),var(--card)_65%)]",
          )}
        >
          <div className="flex items-start gap-4">
            <span
              className={cn("grid size-12 shrink-0 place-items-center rounded-2xl", comProblema > 0 ? "chip-mod" : "bg-success/15 text-success")}
              aria-hidden
            >
              {comProblema > 0 ? <AlarmClock className="size-6" /> : <CheckCircle2 className="size-6" />}
            </span>
            <div className="min-w-0 space-y-1">
              {comProblema > 0 ? (
                <h2 className="text-xl sm:text-2xl font-semibold tracking-tight">
                  <Contagem valor={comProblema} className="texto-mod" /> {comProblema === 1 ? "empresa precisa" : "empresas precisam"} de atenção
                </h2>
              ) : (
                <h2 className="text-xl sm:text-2xl font-semibold tracking-tight">Tudo em dia por aqui</h2>
              )}
              <p className="text-sm text-muted-foreground">
                {resumo.empresasGraves > 0 && <>{plural(resumo.empresasGraves, "com problema grave", "com problema grave")}. </>}
                Última consulta em {formatDataHora(data.ultimaConsulta)}.
              </p>
            </div>
            <Button variant="ghost" size="sm" className="ml-auto shrink-0" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? "Atualizando…" : "Atualizar"}
            </Button>
          </div>
          {resumo.ativos.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {resumo.ativos.map((a) => {
                const Icon = ICONE[a.chave];
                return (
                  <button
                    key={a.chave}
                    type="button"
                    onClick={() => setAberto(a.chave)}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full border bg-card/80 px-3 py-1 text-xs font-medium transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Icon className="size-3.5" style={{ color: TOM[a.gravidade].cor }} aria-hidden />
                    {a.titulo}
                    <span className="nums rounded-full bg-muted px-1.5 text-2xs text-muted-foreground">{a.itens.length}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {cob && <GraficoCobertura c={cob} total={data.empresas.length} />}
      </section>

      {/* Cartões por gravidade */}
      {(["alta", "media", "baixa"] as Gravidade[]).map((g) => (
        <section key={g} className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <span className="size-2 rounded-full" style={{ background: TOM[g].cor }} aria-hidden />
            {TOM[g].rotulo}
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {porGravidade(g).map((a, i) => (
              <CartaoAlerta key={a.chave} a={a} i={i} onAbrir={() => setAberto(a.chave)} />
            ))}
          </div>
        </section>
      ))}

      {!data.temCertificados && (
        <p className="text-xs text-muted-foreground">O alerta de certificado digital usa o módulo Certificados, que o seu acesso não mostra.</p>
      )}

      <ListaDoAlerta alerta={atual} onFechar={() => setAberto(null)} />
    </div>
  );
}

function CartaoAlerta({ a, i, onAbrir }: { a: Alerta; i: number; onAbrir: () => void }) {
  const Icon = ICONE[a.chave];
  const n = a.itens.length;
  const tom = TOM[a.gravidade];
  if (n === 0) {
    return (
      <div className="animate-rise flex items-center gap-3 rounded-card border border-dashed bg-card/60 p-4" style={passo(i)}>
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-success/10 text-success" aria-hidden>
          <CheckCircle2 className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">{a.titulo}</p>
          <p className="text-xs text-muted-foreground">{a.vazio}</p>
        </div>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onAbrir}
      style={passo(i)}
      className="cartao-vivo animate-rise group relative flex min-w-0 flex-col gap-3 overflow-hidden rounded-card border bg-card p-4 pl-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: tom.cor }} aria-hidden />
      <div className="flex items-start gap-3">
        <span
          className="grid size-10 shrink-0 place-items-center rounded-xl"
          style={{ background: `color-mix(in srgb, ${tom.cor} 12%, transparent)`, color: tom.cor }}
          aria-hidden
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-tight">{a.titulo}</p>
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{a.descricao}</p>
        </div>
        <Contagem valor={n} className="text-3xl font-semibold leading-none" />
      </div>
      <p className="truncate text-xs text-muted-foreground">
        {a.itens
          .slice(0, 3)
          .map((x) => x.nome)
          .join(", ")}
        {n > 3 ? ` e mais ${n - 3}` : ""}
      </p>
      <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
        Ver {n === 1 ? "qual é" : "quem são"}
        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </button>
  );
}

function GraficoCobertura({ c, total }: { c: Record<SituacaoFiscal, number>; total: number }) {
  const t = useChartTokens();
  const cores: Record<SituacaoFiscal, string> = {
    regular: t.success,
    com_pendencia: t.danger,
    parcelado: t.warning,
    erro: t.bronze,
    nunca: t.border,
  };
  const dados = (Object.keys(SITUACAO) as SituacaoFiscal[]).map((s) => ({ s, nome: SITUACAO[s], valor: c[s] })).filter((d) => d.valor > 0);
  const consultadas = total - c.nunca;
  const pct = total ? Math.round((consultadas / total) * 100) : 0;
  return (
    <div className="animate-rise rounded-card border bg-card p-4 shadow-card" style={passo(1)}>
      <p className="text-sm font-semibold">Situação fiscal da carteira</p>
      <div className="mt-2 flex items-center gap-4">
        <div className="relative size-32 shrink-0" role="img" aria-label={`Situação fiscal: ${dados.map((d) => `${d.valor} ${d.nome}`).join(", ")}`}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={dados} dataKey="valor" nameKey="nome" innerRadius="68%" outerRadius="100%" paddingAngle={dados.length > 1 ? 2 : 0} stroke="none" isAnimationActive={!reduzMovimento()}>
                {dados.map((d) => (
                  <Cell key={d.s} fill={cores[d.s]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: t.popover, color: t.popoverFg, border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 12 }}
                itemStyle={{ color: t.popoverFg }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="nums text-xl font-semibold leading-none">{pct}%</p>
              <p className="text-2xs text-muted-foreground">consultadas</p>
            </div>
          </div>
        </div>
        <ul className="min-w-0 space-y-1 text-xs">
          {(Object.keys(SITUACAO) as SituacaoFiscal[]).map((s) => (
            <li key={s} className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: cores[s] }} aria-hidden />
              <span className="truncate text-muted-foreground">{SITUACAO[s]}</span>
              <span className="nums ml-auto pl-2 font-medium">{c[s]}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const POR_PAGINA = 50;

function ListaDoAlerta({ alerta, onFechar }: { alerta: Alerta | null; onFechar: () => void }) {
  const mobile = useIsMobile();
  const [busca, setBusca] = useState("");
  const [limite, setLimite] = useState(POR_PAGINA);
  const chave = alerta?.chave;
  useEffect(() => {
    setBusca("");
    setLimite(POR_PAGINA);
  }, [chave]);

  const itens = useMemo(() => {
    if (!alerta) return [];
    const q = normalizarBusca(busca);
    const d = busca.replace(/\D/g, "");
    if (!q) return alerta.itens;
    return alerta.itens.filter((i) => normalizarBusca(i.nome).includes(q) || (d.length > 0 && (i.cpfCnpj ?? "").includes(d)));
  }, [alerta, busca]);

  function baixarCsv() {
    if (!alerta) return;
    const blob = new Blob([csvDoAlerta(alerta)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `alerta-${alerta.chave.replace(/_/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Sheet open={!!alerta} onOpenChange={(o) => !o && onFechar()}>
      <SheetContent side={mobile ? "bottom" : "right"} showCloseButton className={cn(!mobile && "sm:max-w-xl")}>
        {alerta && (
          <>
            <SheetHeader className="pr-12">
              <SheetTitle className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ background: TOM[alerta.gravidade].cor }} aria-hidden />
                {alerta.titulo}
              </SheetTitle>
              <SheetDescription>
                {plural(alerta.itens.length, "empresa", "empresas")}. {alerta.descricao}
              </SheetDescription>
              <div className="mt-2 flex gap-2">
                <Input placeholder="Buscar empresa ou CNPJ" value={busca} onChange={(e) => setBusca(e.target.value)} className="h-9" />
                <Button variant="outline" size="sm" onClick={baixarCsv} className="shrink-0">
                  <Download className="size-4" aria-hidden />
                  CSV
                </Button>
              </div>
            </SheetHeader>
            <SheetBody className="px-0 py-0">
              {itens.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhuma empresa encontrada.</p>
              ) : (
                <ul className="divide-y">
                  {itens.slice(0, limite).map((i) => {
                    const wa = alerta.mensagem ? linkWaMe(i.telefone, alerta.mensagem(i.nome)) : null;
                    return (
                      <li key={i.clienteId} className="flex items-start gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <Link to={`/clientes/${i.clienteId}?tab=fiscal`} className="font-medium hover:underline">
                            {i.nome}
                          </Link>
                          <p className="text-2xs text-muted-foreground">{i.cpfCnpj ? formatDoc(i.cpfCnpj) : "sem CPF/CNPJ"}</p>
                          <p className="mt-1 text-xs">{i.detalhe}</p>
                        </div>
                        {wa && (
                          <Button asChild variant="ghost" size="sm" className="shrink-0" title="Abre o WhatsApp com a mensagem pronta para revisar">
                            <a href={wa} target="_blank" rel="noreferrer">
                              <MessageCircle className="size-4" aria-hidden />
                              <span className="max-sm:sr-only">WhatsApp</span>
                            </a>
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {itens.length > limite && (
                <div className="p-4">
                  <Button variant="outline" className="w-full" onClick={() => setLimite((l) => l + POR_PAGINA)}>
                    Mostrar mais {Math.min(POR_PAGINA, itens.length - limite)}
                  </Button>
                </div>
              )}
            </SheetBody>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function CentralSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <Skeleton className="h-36 rounded-card" />
        <Skeleton className="h-36 rounded-card" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-32 rounded-card" />
        ))}
      </div>
    </div>
  );
}
