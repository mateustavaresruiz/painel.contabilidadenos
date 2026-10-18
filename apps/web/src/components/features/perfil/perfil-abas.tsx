import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  ClipboardList,
  Download,
  ExternalLink,
  Globe,
  Hand,
  KeyRound,
  Link2,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  MessageSquare,
  MonitorSmartphone,
  Paperclip,
  RotateCcw,
  Send,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { Link, useSearchParams } from "react-router-dom";

import { AvatarIniciais } from "@/components/avatar-iniciais";
import { EventosPorDia, TempoRelativo } from "@/components/features/auditoria/linha-do-tempo";
import { ChamadoDrawer } from "@/components/features/solicitacoes/chamado-drawer";
import { StatusSolicitacaoBadge } from "@/components/features/solicitacoes/solicitacao-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chips } from "@/components/ui/chips";
import { confirmar } from "@/components/ui/confirm-dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { EmptyState } from "@/components/ui/empty-state";
import { ItemCard, ListaResponsiva } from "@/components/ui/lista-responsiva";
import { QueryError } from "@/components/ui/query-error";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useChartTokens } from "@/lib/chart-tokens";
import { msgErro } from "@/lib/erro";
import { formatData, formatDataHora } from "@/lib/format";
import { ACOES_AUDITORIA, MODULOS_AUDITORIA } from "@/lib/queries/auditoria";
import {
  comoEntrou,
  descreverNavegador,
  exportarAtividadeCsv,
  PAGINA_ATIVIDADE,
  useEncerrarSessoes,
  usePerfilAtendimentos,
  usePerfilAtividade,
  usePerfilChamados,
  usePerfilMensagens,
  usePerfilSessoes,
  type ChamadoPerfil,
  type EventoAtendimento,
  type FiltrosAtividade,
  type PerfilColaborador,
} from "@/lib/queries/perfil";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { plural } from "@/lib/texto";

const TODOS = "__todos__";

/** Link do WhatsApp do painel para a conversa (abrir é ação de quem clica: marca como lida). */
function linkConversa(sessaoId: string | null, chatId: string | null): string | null {
  if (!sessaoId || !chatId) return null;
  return `/whatsapp?instancia=${encodeURIComponent(sessaoId)}&chat=${encodeURIComponent(chatId)}`;
}

function ListaCarregando({ linhas = 5 }: { linhas?: number }) {
  return (
    <div className="space-y-4 rounded-card border bg-card p-4" aria-busy="true">
      {Array.from({ length: linhas }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
      ))}
    </div>
  );
}

function CarregarMais({ visivel, carregando, onClick, rotulo }: { visivel: boolean; carregando: boolean; onClick: () => void; rotulo: string }) {
  if (!visivel) return null;
  return (
    <div className="flex justify-center pt-3">
      <Button variant="outline" onClick={onClick} disabled={carregando}>
        {carregando && <Loader2 className="animate-spin" />}
        {rotulo}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Atividade
// ---------------------------------------------------------------------------

export function AbaAtividade({ p }: { p: PerfilColaborador }) {
  const [f, setF] = useState<FiltrosAtividade>({});
  const [exportando, setExportando] = useState(false);
  const q = usePerfilAtividade(p.id, f);
  const eventos = q.data?.pages.flat() ?? [];
  const filtrando = !!(f.de || f.ate || f.modulo || f.acao);
  const set = (k: keyof FiltrosAtividade, v: string) => setF((a) => ({ ...a, [k]: v || undefined }));

  async function exportar() {
    setExportando(true);
    try {
      const r = await exportarAtividadeCsv(p.id, p.nome, f);
      (r.cortado ? toast.warning : toast.success)(
        r.cortado
          ? `Exportei os ${r.linhas.toLocaleString("pt-BR")} eventos mais recentes. Restrinja o período para ver o resto.`
          : `${plural(r.linhas, "evento exportado", "eventos exportados")}`,
      );
    } catch (e) {
      toast.error(msgErro(e));
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-card border bg-card p-3">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <DatePicker value={f.de ?? ""} onChange={(v) => set("de", v)} limpavel placeholder="De" aria-label="A partir de" />
          <DatePicker value={f.ate ?? ""} onChange={(v) => set("ate", v)} limpavel placeholder="Até" aria-label="Até" />
          <Select value={f.modulo ?? TODOS} onValueChange={(v) => set("modulo", v === TODOS ? "" : v)}>
            <SelectTrigger aria-label="Módulo" className="col-span-2 sm:col-span-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os módulos</SelectItem>
              {MODULOS_AUDITORIA.map((m) => (
                <SelectItem key={m.valor} value={m.valor}>
                  {m.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={f.acao ?? TODOS} onValueChange={(v) => set("acao", v === TODOS ? "" : v)}>
            <SelectTrigger aria-label="Ação" className="col-span-2 sm:col-span-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-80">
              <SelectItem value={TODOS}>Todas as ações</SelectItem>
              {ACOES_AUDITORIA.map((a) => (
                <SelectItem key={a.valor} value={a.valor}>
                  {a.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {q.isLoading
              ? "Carregando…"
              : `${eventos.length.toLocaleString("pt-BR")}${q.hasNextPage ? "+" : ""} ${plural(eventos.length, "evento", "eventos", { semNumero: true })} ${filtrando ? "com estes filtros" : "no histórico"}`}
          </p>
          <div className="flex items-center gap-2">
            {filtrando && (
              <Button variant="ghost" size="sm" onClick={() => setF({})}>
                <X />
                Limpar filtros
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => void exportar()} disabled={exportando || eventos.length === 0}>
              {exportando ? <Loader2 className="animate-spin" /> : <Download />}
              Exportar CSV
            </Button>
          </div>
        </div>
      </div>

      {q.isLoading ? (
        <ListaCarregando linhas={6} />
      ) : q.isError && eventos.length === 0 ? (
        <QueryError oque="a atividade" error={q.error} onRetry={q.refetch} />
      ) : eventos.length === 0 ? (
        <EmptyState
          icon={Activity}
          cor="equipe"
          title={filtrando ? "Nada com estes filtros" : "Nada registrado ainda"}
          description={
            filtrando
              ? "Troque o período, o módulo ou a ação."
              : "Chamados, clientes, atendimento do WhatsApp, certificados e ajustes aparecem aqui assim que a pessoa mexer."
          }
          action={
            filtrando ? (
              <Button variant="outline" onClick={() => setF({})}>
                Limpar filtros
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className={cn("rounded-card border bg-card px-4 pb-4 pt-2 transition-opacity", q.isPlaceholderData && "opacity-60")}>
          <EventosPorDia eventos={eventos} mostrarModulo semLinkAtor />
          <CarregarMais
            visivel={!!q.hasNextPage}
            carregando={q.isFetchingNextPage}
            onClick={() => void q.fetchNextPage()}
            rotulo={`Carregar mais ${PAGINA_ATIVIDADE}`}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Atendimentos
// ---------------------------------------------------------------------------

const EVENTO_ATENDIMENTO: Record<string, { icon: LucideIcon; tom: string }> = {
  assumiu: { icon: Hand, tom: "text-primary bg-primary/10" },
  tomou: { icon: Hand, tom: "text-warning bg-warning/10" },
  reabriu: { icon: RotateCcw, tom: "text-primary bg-primary/10" },
  transferiu: { icon: ArrowLeftRight, tom: "text-primary bg-primary/10" },
  devolveu: { icon: Undo2, tom: "text-muted-foreground bg-muted" },
  finalizou: { icon: CheckCircle2, tom: "text-success bg-success/10" },
  fila: { icon: Undo2, tom: "text-muted-foreground bg-muted" },
};

/** "Ana transferiu a conversa com X de Ana para Bruno". */
function fraseAtendimento(e: EventoAtendimento): string {
  const por = e.por ?? "Sistema";
  const c = e.conversa;
  switch (e.evento) {
    case "assumiu":
      return `${por} assumiu a conversa com ${c}`;
    case "tomou":
      return `${por} assumiu a conversa com ${c}${e.de ? ` que estava com ${e.de}` : ""}`;
    case "reabriu":
      return `${por} reabriu o atendimento de ${c}`;
    case "transferiu":
      return `${por} transferiu a conversa com ${c}${e.de ? ` de ${e.de}` : ""}${e.para ? ` para ${e.para}` : ""}`;
    case "devolveu":
      return `${por} devolveu a conversa com ${c} para a fila`;
    case "finalizou":
      return `${por} finalizou o atendimento de ${c}`;
    case "fila":
      return `A conversa com ${c} voltou para a fila (nova mensagem do cliente)`;
    default:
      return `${por} mudou o atendimento da conversa com ${c}`;
  }
}

export function AbaAtendimentos({ p }: { p: PerfilColaborador }) {
  const q = usePerfilAtendimentos(p.id);
  const agora = q.data?.pages[0]?.agora ?? [];
  const historico = q.data?.pages.flatMap((x) => x.historico) ?? [];

  if (q.isLoading) return <ListaCarregando />;
  if (q.isError && !q.data) return <QueryError oque="os atendimentos" error={q.error} onRetry={q.refetch} />;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <section aria-labelledby="atend-agora" className="space-y-3">
        <h3 id="atend-agora" className="text-sm font-semibold">
          Com {p.proprio ? "você" : p.nome.split(" ")[0]} agora{" "}
          <span className="font-normal text-muted-foreground">({agora.length})</span>
        </h3>
        {agora.length === 0 ? (
          <EmptyState icon={MessageSquare} cor="whatsapp" title="Nenhuma conversa em atendimento" description="Quando assumir ou receber uma conversa, ela aparece aqui." />
        ) : (
          <ul className="space-y-2">
            {agora.map((c) => {
              const href = linkConversa(c.sessaoId, c.chatId);
              return (
                <li key={c.id} className="flex items-center gap-3 rounded-card border bg-card p-3 shadow-card">
                  <AvatarIniciais nome={c.nome ?? "?"} semente={c.id} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-semibold">{c.nome ?? "Contato"}</span>
                      {!!c.naoLidas && <Badge variant="success">{plural(c.naoLidas, "não lida", "não lidas")}</Badge>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[c.cliente, c.conexao].filter(Boolean).join(" · ") || "Sem cliente vinculado"}
                    </p>
                    <p className="text-2xs text-muted-foreground">
                      {c.desde ? (
                        <>
                          Com a pessoa <TempoRelativo iso={c.desde} />
                        </>
                      ) : null}
                      {c.ultimaMensagemEm && (
                        <>
                          {" · "}última mensagem <TempoRelativo iso={c.ultimaMensagemEm} />
                          {c.ultimaMensagemFromMe === false ? " (do cliente)" : ""}
                        </>
                      )}
                    </p>
                  </div>
                  {href && (
                    <Button asChild size="sm" variant="ghost" className="shrink-0">
                      <Link to={href} title="Abre a conversa no WhatsApp do painel (marca como lida)">
                        <ExternalLink />
                        <span className="max-sm:sr-only">Abrir</span>
                      </Link>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="atend-hist" className="space-y-3">
        <h3 id="atend-hist" className="text-sm font-semibold">
          Histórico de atendimento
        </h3>
        {historico.length === 0 ? (
          <EmptyState icon={ArrowLeftRight} cor="whatsapp" title="Sem histórico ainda" description="Assumir, transferir e finalizar conversas fica registrado aqui." />
        ) : (
          <div className="rounded-card border bg-card px-4 py-1">
            <ul className="divide-y divide-border/60">
              {historico.map((e) => {
                const est = EVENTO_ATENDIMENTO[e.evento] ?? EVENTO_ATENDIMENTO.transferiu!;
                const href = linkConversa(e.sessaoId, e.chatId);
                return (
                  <li key={e.id} className="flex gap-3 py-3">
                    <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", est.tom)}>
                      <est.icon className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug [text-wrap:pretty]">{fraseAtendimento(e)}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <TempoRelativo iso={e.em} />
                        {e.motivo && <span className="min-w-0 break-words">· Motivo: {e.motivo}</span>}
                        {href && (
                          <Link to={href} className="text-primary hover:underline" title="Abre a conversa (marca como lida)">
                            Abrir conversa
                          </Link>
                        )}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="pb-3">
              <CarregarMais
                visivel={!!q.hasNextPage}
                carregando={q.isFetchingNextPage}
                onClick={() => void q.fetchNextPage()}
                rotulo="Ver mais antigos"
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chamados
// ---------------------------------------------------------------------------

type FiltroChamado = "todos" | "abertos" | "atrasados" | "criou" | "responsavel";

const FILTROS_CHAMADO: { valor: FiltroChamado; rotulo: string }[] = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "abertos", rotulo: "Em aberto" },
  { valor: "atrasados", rotulo: "Atrasados" },
  { valor: "responsavel", rotulo: "Sob responsabilidade" },
  { valor: "criou", rotulo: "Abertos pela pessoa" },
];

function papel(c: ChamadoPerfil): string {
  if (c.criou && c.responsavelEle) return "Abriu e é responsável";
  if (c.responsavelEle) return "Responsável";
  return c.responsavel ? `Abriu (com ${c.responsavel})` : "Abriu (sem responsável)";
}

export function AbaChamados({ p }: { p: PerfilColaborador }) {
  const q = usePerfilChamados(p.id);
  const [filtro, setFiltro] = useState<FiltroChamado>("todos");
  const [params, setParams] = useSearchParams();
  const lista = useMemo(() => {
    const todos = q.data ?? [];
    const aberto = (c: ChamadoPerfil) => c.status === "aberta" || c.status === "em_andamento";
    switch (filtro) {
      case "abertos":
        return todos.filter(aberto);
      case "atrasados":
        return todos.filter((c) => c.atrasado);
      case "criou":
        return todos.filter((c) => c.criou);
      case "responsavel":
        return todos.filter((c) => c.responsavelEle);
      default:
        return todos;
    }
  }, [q.data, filtro]);
  const atrasados = (q.data ?? []).filter((c) => c.atrasado).length;

  function abrir(id: string | null) {
    setParams(
      (a) => {
        const n = new URLSearchParams(a);
        if (id) n.set("chamado", id);
        else n.delete("chamado");
        return n;
      },
      { replace: true },
    );
  }

  if (q.isLoading) return <ListaCarregando />;
  if (q.isError && !q.data) return <QueryError oque="os chamados" error={q.error} onRetry={q.refetch} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Chips rotulo="Filtro dos chamados" opcoes={FILTROS_CHAMADO} valor={filtro} onChange={setFiltro} />
        {atrasados > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-warning">
            <AlertTriangle className="size-3.5" />
            {plural(atrasados, "atrasado", "atrasados")}
          </span>
        )}
      </div>
      {lista.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          cor="chamados"
          title={filtro === "todos" ? "Nenhum chamado" : "Nenhum chamado neste filtro"}
          description={filtro === "todos" ? "Chamados que a pessoa abrir ou receber aparecem aqui." : "Troque o filtro para ver os outros."}
        />
      ) : (
        <ListaResponsiva
          corte="lg"
          tabela={
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Chamado</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead>Aberto em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((c) => (
                  <TableRow
                    key={c.id}
                    className={cn("cursor-pointer", c.atrasado && "bg-warning/5")}
                    onClick={() => abrir(c.id)}
                    tabIndex={0}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), abrir(c.id))}
                  >
                    <TableCell className="max-w-80">
                      <p className="truncate text-sm font-medium">{c.tipo}</p>
                      <p className="truncate text-xs text-muted-foreground">{c.cliente ?? c.descricao ?? "Sem cliente"}</p>
                    </TableCell>
                    <TableCell>
                      <StatusSolicitacaoBadge status={c.status} />
                    </TableCell>
                    <TableCell className={cn("whitespace-nowrap text-sm", c.atrasado && "font-semibold text-warning")}>
                      {c.prazo ? formatData(c.prazo) : "-"}
                      {c.atrasado && " (atrasado)"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{papel(c)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDataHora(c.criadoEm)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          }
        >
          {lista.map((c) => (
            <ItemCard
              key={c.id}
              onClick={() => abrir(c.id)}
              titulo={c.tipo}
              subtitulo={c.cliente ?? c.descricao ?? "Sem cliente"}
              selo={<StatusSolicitacaoBadge status={c.status} />}
              meta={[
                c.prazo ? { texto: `Prazo ${formatData(c.prazo)}${c.atrasado ? " (atrasado)" : ""}`, alerta: c.atrasado } : null,
                { texto: papel(c) },
                { texto: `Aberto em ${formatData(c.criadoEm)}` },
              ]}
            />
          ))}
        </ListaResponsiva>
      )}
      <ChamadoDrawer id={params.get("chamado")} onClose={() => abrir(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mensagens (só leitura: nada aqui envia)
// ---------------------------------------------------------------------------

const TIPO_MIDIA: Record<string, string> = {
  image: "Imagem",
  video: "Vídeo",
  audio: "Áudio",
  ptt: "Áudio",
  voice: "Áudio",
  document: "Documento",
  gif: "GIF",
  sticker: "Figurinha",
  location: "Localização",
  vcard: "Contato",
};

function GraficoPorDia({ dados }: { dados: { dia: string; total: number }[] }) {
  const t = useChartTokens();
  const curto = (iso: string) => {
    const [, m, d] = iso.split("-");
    return `${d}/${m}`;
  };
  return (
    <div className="h-56" role="img" aria-label="Mensagens enviadas por dia">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} margin={{ top: 8, right: 4, bottom: 0, left: -24 }}>
          <CartesianGrid vertical={false} stroke={t.border} strokeDasharray="3 4" />
          <XAxis
            dataKey="dia"
            tickFormatter={curto}
            tick={{ fill: t.muted, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={16}
          />
          <YAxis allowDecimals={false} tick={{ fill: t.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
          <RTooltip
            cursor={{ fill: t.border, opacity: 0.3 }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <div className="rounded-pearl border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-flutuante">
                  <p className="font-semibold">
                    {new Date(`${String(label)}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" })}
                  </p>
                  <p className="nums">{plural(Number(payload[0]!.value), "mensagem", "mensagens")}</p>
                </div>
              ) : null
            }
          />
          <Bar dataKey="total" name="Enviadas" fill={t.primary} radius={[6, 6, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AbaMensagens({ p, intervalo }: { p: PerfilColaborador; intervalo: { de: Date; ate: Date } | null }) {
  const q = usePerfilMensagens(p.id, intervalo);
  if (!intervalo) {
    return <p className="text-sm text-muted-foreground">Escolha um período válido acima.</p>;
  }
  if (q.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-64 rounded-card" />
        <ListaCarregando linhas={4} />
      </div>
    );
  }
  if (q.isError && !q.data) return <QueryError oque="as mensagens" error={q.error} onRetry={q.refetch} />;
  const d = q.data!;
  const total = d.porDia.reduce((s, x) => s + x.total, 0);

  return (
    <div className={cn("space-y-4 transition-opacity", q.isPlaceholderData && "opacity-60")}>
      <section className="rounded-card border bg-card p-4 shadow-card">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Mensagens enviadas por dia</h3>
          <p className="nums text-xs text-muted-foreground">{total.toLocaleString("pt-BR")} no período (período escolhido acima)</p>
        </div>
        {total === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma mensagem enviada pelo painel neste período.</p>
        ) : (
          <GraficoPorDia dados={d.porDia} />
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Últimas mensagens enviadas</h3>
        {d.restrito && (
          <p className="text-xs text-muted-foreground">
            Aparecem só as mensagens das conversas que você ainda enxerga no WhatsApp.
          </p>
        )}
        {d.ultimas.length === 0 ? (
          <EmptyState icon={Send} cor="whatsapp" title="Nada para mostrar" description="As mensagens que a pessoa enviar pelo painel aparecem aqui (só leitura)." />
        ) : (
          <ul className="divide-y divide-border/60 rounded-card border bg-card px-4">
            {d.ultimas.map((m) => {
              const href = linkConversa(m.sessaoId, m.chatId);
              const midia = m.tipo && m.tipo !== "chat" && m.tipo !== "text" ? (TIPO_MIDIA[m.tipo] ?? "Arquivo") : null;
              return (
                <li key={m.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="min-w-0 truncate font-semibold text-foreground">{m.conversa}</span>
                    <span>·</span>
                    <TempoRelativo iso={m.em} />
                    {m.apagada && <Badge variant="secondary">apagada</Badge>}
                    {href && (
                      <Link to={href} className="ml-auto text-primary hover:underline" title="Abre a conversa (marca como lida)">
                        Abrir conversa
                      </Link>
                    )}
                  </div>
                  <p className={cn("mt-1 line-clamp-3 whitespace-pre-wrap break-words text-sm", m.apagada && "text-muted-foreground line-through")}>
                    {midia && (
                      <span className="mr-1.5 inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 align-middle text-2xs text-muted-foreground">
                        <Paperclip className="size-3" />
                        {midia}
                        {m.arquivo ? `: ${m.arquivo}` : ""}
                      </span>
                    )}
                    {m.texto || (midia ? "" : "(sem texto)")}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Acessos
// ---------------------------------------------------------------------------

function iconeComo(como: string): LucideIcon {
  if (/google/i.test(como)) return Globe;
  if (/código/i.test(como)) return KeyRound;
  if (/link/i.test(como)) return Link2;
  if (/e-mail/i.test(como)) return Mail;
  return LogIn;
}

export function BotaoEncerrarSessoes({ p }: { p: PerfilColaborador }) {
  const encerrar = useEncerrarSessoes();
  async function clicar() {
    const ok = await confirmar({
      titulo: `Encerrar as sessões de ${p.nome}?`,
      descricao:
        "Todos os aparelhos em que a pessoa está conectada vão pedir para entrar de novo. O acesso que já está aberto pode durar até 1 hora antes de cair. Não desativa a pessoa.",
      confirmLabel: "Encerrar sessões",
      destructive: true,
    });
    if (!ok) return;
    encerrar.mutate(p.id, {
      onSuccess: (n) => (n ? toast.success(plural(n, "sessão encerrada", "sessões encerradas")) : toast.info("Não havia sessão aberta")),
      onError: (e) => toast.error(msgErro(e)),
    });
  }
  return (
    <Button variant="outline" onClick={() => void clicar()} loading={encerrar.isPending} className="text-destructive hover:bg-destructive/5">
      <LogOut />
      Encerrar sessões
    </Button>
  );
}

export function AbaAcessos({ p }: { p: PerfilColaborador }) {
  const logins = usePerfilAtividade(p.id, { modulo: "acesso", acao: "login" });
  const sessoes = usePerfilSessoes(p.id, p.verTudo);
  const lista = logins.data?.pages.flat() ?? [];

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section aria-labelledby="acessos-logins" className="space-y-3">
        <h3 id="acessos-logins" className="text-sm font-semibold">
          Entradas no painel
        </h3>
        {logins.isLoading ? (
          <ListaCarregando />
        ) : logins.isError && lista.length === 0 ? (
          <QueryError oque="os acessos" error={logins.error} onRetry={logins.refetch} />
        ) : lista.length === 0 ? (
          <EmptyState icon={LogIn} cor="equipe" title="Nenhuma entrada registrada" description="Cada vez que a pessoa entra no painel fica registrado aqui: quando, como e de qual IP." />
        ) : (
          <div className="rounded-card border bg-card px-4 py-1">
            <ul className="divide-y divide-border/60">
              {lista.map((ev) => {
                const { como, ip } = comoEntrou(ev);
                const Icone = iconeComo(como);
                return (
                  <li key={ev.id} className="flex items-center gap-3 py-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                      <Icone className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{formatDataHora(ev.criadoEm)}</p>
                      <p className="text-xs text-muted-foreground">
                        {como}
                        {ip ? ` · IP ${ip}` : ""}
                      </p>
                    </div>
                    <TempoRelativo iso={ev.criadoEm} className="shrink-0 text-2xs text-muted-foreground" />
                  </li>
                );
              })}
            </ul>
            <div className="pb-3">
              <CarregarMais
                visivel={!!logins.hasNextPage}
                carregando={logins.isFetchingNextPage}
                onClick={() => void logins.fetchNextPage()}
                rotulo="Ver entradas mais antigas"
              />
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="acessos-sessoes" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="acessos-sessoes" className="text-sm font-semibold">
            Sessões abertas
          </h3>
          {p.podeEncerrarSessoes && (sessoes.data?.length ?? 0) > 0 && <BotaoEncerrarSessoes p={p} />}
        </div>
        {!p.verTudo ? (
          <p className="rounded-card border bg-card p-4 text-sm text-muted-foreground">
            Os aparelhos conectados aparecem só para administradores. Para sair de um aparelho, use Sair nele.
          </p>
        ) : sessoes.isLoading ? (
          <ListaCarregando linhas={3} />
        ) : sessoes.isError && !sessoes.data ? (
          <QueryError oque="as sessões" error={sessoes.error} onRetry={sessoes.refetch} />
        ) : (sessoes.data ?? []).length === 0 ? (
          <EmptyState icon={MonitorSmartphone} cor="equipe" title="Nenhuma sessão aberta" description={p.temLogin ? "A pessoa não está conectada em nenhum aparelho." : "Esta pessoa não tem login."} />
        ) : (
          <ul className="space-y-2">
            {sessoes.data!.map((s, i) => (
              <li key={`${s.criadaEm}-${i}`} className="flex items-start gap-3 rounded-card border bg-card p-3 shadow-card">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                  <MonitorSmartphone className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium" title={s.navegador ?? undefined}>
                    {descreverNavegador(s.navegador)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {s.ip ? `IP ${s.ip} · ` : ""}entrou em {formatDataHora(s.criadaEm)}
                  </p>
                  {s.atividadeEm && (
                    <p className="text-2xs text-muted-foreground">
                      Última renovação <TempoRelativo iso={s.atividadeEm} />
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {p.verTudo && (
          <p className="text-2xs leading-relaxed text-muted-foreground [text-wrap:pretty]">
            Sessão é cada aparelho ou navegador em que a pessoa entrou e não saiu. Sessões de programa (sem navegador)
            costumam ser testes ou integrações.
          </p>
        )}
      </section>
    </div>
  );
}
