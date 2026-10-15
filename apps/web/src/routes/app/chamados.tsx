import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  ClipboardList,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Tags,
  Trash2,
} from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { ColaboradorAvatar } from "@/components/colaborador-avatar";
import { ClienteSelect } from "@/components/features/clientes/cliente-select";
import {
  NovaSolicitacaoDialog,
  StatusSolicitacaoSelect,
} from "@/components/features/solicitacoes/solicitacao-ui";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { confirmar } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { usePageTitle } from "@/hooks/use-page-title";
import { useColaboradoresMap } from "@/lib/colaborador";
import { msgErro } from "@/lib/erro";
import { formatData, formatDataHora, hojeISO } from "@/lib/format";
import {
  STATUS_SOLICITACAO,
  useAtualizarSolicitacao,
  useExcluirSolicitacao,
  useExcluirSolicitacaoTipo,
  useRelatorioSolicitacoes,
  useSalvarSolicitacaoTipo,
  useSolicitacaoTipos,
  useSolicitacoes,
  type SolicitacaoStatus,
  type SolicitacaoTipo,
} from "@/lib/queries/solicitacoes";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

// recharts só baixa quando alguém abre o Relatório.
const GraficoRelatorio = lazy(() =>
  import("@/components/features/solicitacoes/grafico-relatorio").then((m) => ({
    default: m.GraficoRelatorio,
  })),
);

const TODOS = "__todos__";

export function ChamadosPage() {
  usePageTitle("Chamados");
  const [params, setParams] = useSearchParams();
  const aba = params.get("aba") ?? "lista";
  const [nova, setNova] = useState(false);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <PageHeader
        icon={ClipboardList}
        title="Chamados"
        description="Pedidos dos clientes registrados a partir das conversas (e na mão)."
        actions={
          <Button onClick={() => setNova(true)}>
            <Plus />
            Abrir chamado
          </Button>
        }
      />
      <Tabs
        value={aba}
        onValueChange={(v) =>
          setParams(
            (c) => {
              const n = new URLSearchParams(c);
              if (v === "lista") n.delete("aba");
              else n.set("aba", v);
              return n;
            },
            { replace: true },
          )
        }
      >
        <TabsList>
          <TabsTrigger value="lista">
            <ClipboardList className="size-3.5 mr-1.5" />
            Chamados
          </TabsTrigger>
          <TabsTrigger value="relatorio">
            <BarChart3 className="size-3.5 mr-1.5" />
            Relatório
          </TabsTrigger>
          <TabsTrigger value="tipos">
            <Tags className="size-3.5 mr-1.5" />
            Tipos de chamado
          </TabsTrigger>
        </TabsList>
        <TabsContent value="lista" className="mt-5">
          <ListaAba />
        </TabsContent>
        <TabsContent value="relatorio" className="mt-5">
          <RelatorioAba />
        </TabsContent>
        <TabsContent value="tipos" className="mt-5">
          <TiposAba />
        </TabsContent>
      </Tabs>
      <NovaSolicitacaoDialog open={nova} onOpenChange={setNova} origem={{}} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------------

function ListaAba() {
  const [status, setStatus] = useState<SolicitacaoStatus | "abertas" | "">("abertas");
  const [tipoId, setTipoId] = useState("");
  const [responsavel, setResponsavel] = useState<string>("");
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const { data: tipos = [] } = useSolicitacaoTipos();
  const { data = [], isLoading } = useSolicitacoes({
    status,
    tipoId: tipoId || undefined,
    responsavelId: responsavel || undefined,
    clienteId: clienteId ?? undefined,
    de: de || undefined,
    ate: ate || undefined,
  });
  const atualizar = useAtualizarSolicitacao();
  const excluir = useExcluirSolicitacao();
  const mapa = useColaboradoresMap();

  return (
    <div className="space-y-4">
      <div className="grid gap-2 rounded-xl border bg-card p-3 sm:grid-cols-2 lg:grid-cols-6">
        <Select value={status || TODOS} onValueChange={(v) => setStatus(v === TODOS ? "" : (v as SolicitacaoStatus | "abertas"))}>
          <SelectTrigger aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="abertas">Em aberto</SelectItem>
            {STATUS_SOLICITACAO.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
            <SelectItem value={TODOS}>Todos os status</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tipoId || TODOS} onValueChange={(v) => setTipoId(v === TODOS ? "" : v)}>
          <SelectTrigger aria-label="Tipo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos os tipos</SelectItem>
            {tipos.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={responsavel || TODOS} onValueChange={(v) => setResponsavel(v === TODOS ? "" : v)}>
          <SelectTrigger aria-label="Responsável">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Qualquer responsável</SelectItem>
            <SelectItem value="sem">Sem responsável</SelectItem>
            {[...mapa.values()]
              .filter((c) => c.ativo)
              .map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <ClienteSelect value={clienteId} onChange={setClienteId} permitirTodos />
        <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} aria-label="De" title="Criadas a partir de" />
        <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} aria-label="Até" title="Criadas até" />
      </div>

      {isLoading ? (
        <div className="py-10 grid place-items-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : data.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Nenhum chamado"
          description="Abra pelo botão “Abrir chamado” no topo de uma conversa, ou pelo menu de uma mensagem."
        />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Chamado</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>Prazo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((s) => {
                  const resp = s.responsavelId ? mapa.get(s.responsavelId) : undefined;
                  const criador = s.criadoPorId ? mapa.get(s.criadoPorId) : undefined;
                  const atrasada =
                    !!s.prazo && s.prazo < hojeISO() && (s.status === "aberta" || s.status === "em_andamento");
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="min-w-[220px]">
                        <p className="font-medium">{s.tipo?.nome ?? "-"}</p>
                        {s.descricao && <p className="text-xs text-muted-foreground line-clamp-2 max-w-md">{s.descricao}</p>}
                        <p className="text-2xs text-muted-foreground mt-0.5">
                          {formatDataHora(s.criadoEm)}
                          {criador ? ` · por ${criador.nome.split(" ")[0]}` : ""}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm">
                        {s.cliente ? (
                          <Link to={`/clientes/${s.cliente.id}`} className="hover:underline">
                            {s.cliente.nomeFantasia || s.cliente.nome}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {resp ? (
                          <span className="inline-flex items-center gap-1.5 text-sm">
                            <ColaboradorAvatar nome={resp.nome} cor={resp.cor} size="2xs" />
                            {resp.nome.split(" ")[0]}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className={cn("text-sm whitespace-nowrap", atrasada && "text-destructive font-medium")}>
                        {s.prazo ? formatData(s.prazo) : "-"}
                        {atrasada && <Badge variant="destructive" className="ml-1.5">atrasada</Badge>}
                      </TableCell>
                      <TableCell>
                        <StatusSolicitacaoSelect
                          value={s.status}
                          onChange={(st) =>
                            atualizar.mutate({ id: s.id, patch: { status: st } }, { onError: (e) => toast.error(msgErro(e)) })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-0.5">
                          {s.chat && (
                            <Button asChild size="icon" variant="ghost" title="Abrir conversa">
                              <Link
                                to={`/whatsapp?instancia=${encodeURIComponent(s.chat.sessaoId)}&chat=${encodeURIComponent(s.chat.chatId)}`}
                              >
                                <MessageSquare />
                              </Link>
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Excluir"
                            onClick={async () => {
                              if (!(await confirmar({ titulo: "Excluir chamado?", descricao: "Some também do relatório.", confirmLabel: "Excluir", destructive: true })))
                                return;
                              excluir.mutate(s.id, { onError: (e) => toast.error(msgErro(e)) });
                            }}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
      {data.length > 0 && <p className="text-xs text-muted-foreground">{data.length} chamado(s)</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------

const PERIODOS = [
  { id: "mes", label: "Este mês" },
  { id: "mes-passado", label: "Mês passado" },
  { id: "30", label: "Últimos 30 dias" },
  { id: "90", label: "Últimos 90 dias" },
  { id: "ano", label: "Este ano" },
  { id: "custom", label: "Personalizado" },
] as const;

function periodo(id: string): { de: string; ate: string } {
  const h = new Date();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (id === "mes") return { de: iso(new Date(h.getFullYear(), h.getMonth(), 1)), ate: iso(h) };
  if (id === "mes-passado")
    return {
      de: iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)),
      ate: iso(new Date(h.getFullYear(), h.getMonth(), 0)),
    };
  if (id === "ano") return { de: iso(new Date(h.getFullYear(), 0, 1)), ate: iso(h) };
  const dias = id === "90" ? 89 : 29;
  return { de: hojeISO(-dias), ate: iso(h) };
}

function RelatorioAba() {
  const [p, setP] = useState<string>("mes");
  const [custom, setCustom] = useState(() => periodo("30"));
  const intervalo = p === "custom" ? custom : periodo(p);
  const { data = [], isLoading } = useRelatorioSolicitacoes(intervalo.de, intervalo.ate);
  const comPedido = useMemo(() => data.filter((l) => l.total > 0), [data]);
  const total = comPedido.reduce((s, l) => s + l.total, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label>Período</Label>
          <Select value={p} onValueChange={setP}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODOS.map((x) => (
                <SelectItem key={x.id} value={x.id}>
                  {x.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {p === "custom" && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="rel-de">De</Label>
              <Input id="rel-de" type="date" value={custom.de} onChange={(e) => setCustom((c) => ({ ...c, de: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rel-ate">Até</Label>
              <Input id="rel-ate" type="date" value={custom.ate} onChange={(e) => setCustom((c) => ({ ...c, ate: e.target.value }))} />
            </div>
          </>
        )}
        <p className="text-sm text-muted-foreground pb-2 sm:ml-auto">
          {formatData(intervalo.de)} a {formatData(intervalo.ate)} · <strong className="text-foreground">{total}</strong>{" "}
          chamado(s)
        </p>
      </div>

      {isLoading ? (
        <div className="py-10 grid place-items-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : comPedido.length === 0 ? (
        <EmptyState icon={BarChart3} title="Nada no período" description="Nenhum chamado aberto entre essas datas." />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardContent className="p-5">
              <h2 className="text-base mb-1">Mais pedidos</h2>
              <p className="text-xs text-muted-foreground mb-4">Tipos de chamado por quantidade no período.</p>
              <Suspense fallback={<div className="h-72 grid place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}>
                <GraficoRelatorio linhas={comPedido} />
              </Suspense>
            </CardContent>
          </Card>
          <Card>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Em aberto</TableHead>
                    <TableHead className="text-right">Concluídas</TableHead>
                    <TableHead className="text-right">%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comPedido.map((l, i) => (
                    <TableRow key={l.tipoId}>
                      <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
                      <TableCell className="font-medium">{l.nome}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{l.total}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.abertas}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.concluidas}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {total ? Math.round((l.total / total) * 100) : 0}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

function TiposAba() {
  const { data: tipos = [], isLoading } = useSolicitacaoTipos();
  const salvar = useSalvarSolicitacaoTipo();
  const excluir = useExcluirSolicitacaoTipo();
  const [editando, setEditando] = useState<SolicitacaoTipo | "novo" | null>(null);

  function mover(t: SolicitacaoTipo, dir: -1 | 1) {
    const i = tipos.findIndex((x) => x.id === t.id);
    const outro = tipos[i + dir];
    if (!outro) return;
    // Troca as ordens; se empatadas, abre espaço.
    const a = outro.ordem === t.ordem ? t.ordem + dir : outro.ordem;
    const b = t.ordem;
    salvar.mutate({ id: t.id, nome: t.nome, descricao: t.descricao, ordem: a, ativo: t.ativo });
    salvar.mutate({ id: outro.id, nome: outro.nome, descricao: outro.descricao, ordem: b, ativo: outro.ativo });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Os tipos ativos aparecem no botão “Abrir chamado” da conversa, nesta ordem.
        </p>
        <Button size="sm" onClick={() => setEditando("novo")}>
          <Plus />
          Tipo
        </Button>
      </div>
      {isLoading ? (
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {tipos.map((t, i) => (
            <li key={t.id} className={cn("flex items-center gap-2 px-4 py-2.5", !t.ativo && "opacity-60")}>
              <span className="w-10 text-2xs tabular-nums text-muted-foreground">{t.ordem}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{t.nome}</p>
                {t.descricao && <p className="text-xs text-muted-foreground truncate">{t.descricao}</p>}
              </div>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={t.ativo}
                  className="size-4 accent-[var(--primary)]"
                  onChange={(e) =>
                    salvar.mutate(
                      { id: t.id, nome: t.nome, descricao: t.descricao, ordem: t.ordem, ativo: e.target.checked },
                      { onError: (err) => toast.error(msgErro(err)) },
                    )
                  }
                />
                Ativo
              </label>
              <Button size="icon" variant="ghost" disabled={i === 0} onClick={() => mover(t, -1)} aria-label="Subir">
                <ArrowUp />
              </Button>
              <Button size="icon" variant="ghost" disabled={i === tipos.length - 1} onClick={() => mover(t, 1)} aria-label="Descer">
                <ArrowDown />
              </Button>
              <Button size="icon" variant="ghost" onClick={() => setEditando(t)} aria-label="Editar">
                <Pencil />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Excluir"
                onClick={async () => {
                  if (!(await confirmar({ titulo: `Excluir "${t.nome}"?`, confirmLabel: "Excluir", destructive: true }))) return;
                  excluir.mutate(t.id, { onError: (e) => toast.error(msgErro(e)) });
                }}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <TipoDialog
        tipo={editando === "novo" ? null : editando}
        open={editando !== null}
        onOpenChange={(o) => !o && setEditando(null)}
        proximaOrdem={(tipos.filter((t) => t.ordem < 1000).at(-1)?.ordem ?? 0) + 10}
      />
    </div>
  );
}

function TipoDialog({
  tipo,
  open,
  onOpenChange,
  proximaOrdem,
}: {
  tipo: SolicitacaoTipo | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  proximaOrdem: number;
}) {
  const salvar = useSalvarSolicitacaoTipo();
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [ordem, setOrdem] = useState("0");
  const [ativo, setAtivo] = useState(true);
  const [chave, setChave] = useState<string | null>(null);
  const atual = open ? (tipo?.id ?? "novo") : null;
  if (atual !== chave) {
    setChave(atual);
    if (atual) {
      setNome(tipo?.nome ?? "");
      setDescricao(tipo?.descricao ?? "");
      setOrdem(String(tipo?.ordem ?? proximaOrdem));
      setAtivo(tipo?.ativo ?? true);
    }
  }

  async function enviar() {
    if (nome.trim().length < 2) return toast.error("Informe o nome.");
    try {
      await salvar.mutateAsync({ id: tipo?.id, nome, descricao, ordem: Number(ordem) || 0, ativo });
      onOpenChange(false);
    } catch (err) {
      toast.error(msgErro(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tipo ? "Editar tipo" : "Novo tipo de chamado"}</DialogTitle>
          <DialogDescription>Ex.: Emissão de nota fiscal, Segunda via de guia.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="tp-nome">Nome *</Label>
            <Input id="tp-nome" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tp-desc">Descrição</Label>
            <Textarea id="tp-desc" rows={2} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3 items-end">
            <div className="space-y-1.5">
              <Label htmlFor="tp-ordem">Ordem</Label>
              <Input id="tp-ordem" inputMode="numeric" value={ordem} onChange={(e) => setOrdem(e.target.value.replace(/[^\d-]/g, ""))} />
            </div>
            <label className="flex items-center gap-2 text-sm pb-2">
              <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} className="size-4 accent-[var(--primary)]" />
              Ativo
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={salvar.isPending}>
            {salvar.isPending ? <Loader2 className="animate-spin" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

