import { CalendarClock, Loader2, Search, ShieldCheck, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { ClienteSelect } from "@/components/features/clientes/cliente-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { confirmar } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QueryError } from "@/components/ui/query-error";
import { ListaSkeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ErroDaApi } from "@/lib/api";
import { useEu, usePermissao } from "@/lib/colaborador";
import { msgErro } from "@/lib/erro";
import { formatBRL, formatData, formatDataHora, formatDoc } from "@/lib/format";
import { useConsultarSerpro, useSerproStatus } from "@/lib/queries/denos";
import {
  type AgendamentoSerpro,
  CUSTO_SERVICO,
  type LinhaResumo,
  ROTULO_SERVICO,
  SERVICOS_SERPRO,
  type ServicoSerpro,
  type SituacaoResumo,
  useAgendamentosSerpro,
  useCustosSerpro,
  useResumoFiscal,
  useSalvarAgendamento,
  useUltimasDoCliente,
  situacaoDe,
} from "@/lib/queries/serpro";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const SITUACAO: Record<SituacaoResumo, { rotulo: string; tom: "success" | "destructive" | "warning" | "secondary" | "default" }> = {
  regular: { rotulo: "Regular", tom: "success" },
  com_pendencia: { rotulo: "Com pendência", tom: "destructive" },
  parcelado: { rotulo: "Parcelado", tom: "warning" },
  erro: { rotulo: "Erro na consulta", tom: "default" },
  nunca: { rotulo: "Nunca consultado", tom: "secondary" },
};

const nomeDe = (l: LinhaResumo) => l.cliente.nomeFantasia || l.cliente.nome;

/** Mensagem amigável do erro de uma consulta. */
export function erroDeConsulta(err: unknown, faltando?: string[]): string {
  if (err instanceof ErroDaApi && (err.status === 404 || err.status === 0)) return "A consulta ao Serpro ainda não está disponível no servidor.";
  const d = err instanceof ErroDaApi ? err.dados : null;
  const cod = String(d?.erro ?? d?.codigo ?? d?.code ?? "").toUpperCase();
  const naoConfigurado =
    err instanceof ErroDaApi && (err.status === 503 || (err.status === 424 && (cod === "CONFIGURACAO" || /configur/i.test(err.message))));
  if (naoConfigurado) {
    return faltando?.length
      ? `Serpro ainda não configurado: faltam ${faltando.join(", ")}.`
      : "Serpro ainda não configurado: veja o cartão no topo de Pendências fiscais para o que falta.";
  }
  return "Consulta não realizada: " + msgErro(err);
}

/** Aviso único "falta configurar" para as abas que gastam. */
function AvisoNaoConfigurado() {
  const { data, isLoading } = useSerproStatus();
  if (isLoading || data?.configurado) return null;
  return (
    <p role="status" className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
      Falta configurar o gateway Integra Contador: as consultas não vão rodar até lá.
      {data?.faltando?.length ? ` Faltam: ${data.faltando.map((f) => f.replace(/\.+$/, "")).join("; ")}.` : ""} O que falta aparece no cartão
      "Integração com o Serpro" acima.
    </p>
  );
}

// ---------------------------------------------------------------------------
// Painel resumo
// ---------------------------------------------------------------------------

export function PainelResumoSerpro() {
  const { data = [], isLoading, error, refetch } = useResumoFiscal();
  const [filtro, setFiltro] = useState<SituacaoResumo | "todos">("todos");
  const [busca, setBusca] = useState("");
  const contagem = useMemo(() => {
    const c: Record<SituacaoResumo, number> = { regular: 0, com_pendencia: 0, parcelado: 0, erro: 0, nunca: 0 };
    for (const l of data) c[l.situacao]++;
    return c;
  }, [data]);
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const d = q.replace(/\D/g, "");
    return data.filter(
      (l) =>
        (filtro === "todos" || l.situacao === filtro) &&
        (!q || nomeDe(l).toLowerCase().includes(q) || l.cliente.nome.toLowerCase().includes(q) || (d && (l.cliente.cpfCnpj ?? "").includes(d))),
    );
  }, [data, filtro, busca]);

  if (isLoading) return <ListaSkeleton linhas={5} />;
  if (error && data.length === 0) return <QueryError oque="o resumo fiscal" error={error} onRetry={refetch} />;
  if (data.length === 0) return <EmptyState icon={ShieldCheck} title="Nenhum cliente ativo" description="Cadastre clientes para acompanhar a situação fiscal." />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {(Object.keys(SITUACAO) as SituacaoResumo[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFiltro(filtro === s ? "todos" : s)}
            className={cn(
              "rounded-card border bg-card p-3 text-left transition-colors hover:bg-accent/40",
              filtro === s && "ring-2 ring-primary",
            )}
          >
            <p className={cn("text-2xl font-semibold tabular-nums", s === "com_pendencia" && contagem[s] > 0 && "text-destructive")}>{contagem[s]}</p>
            <p className="text-xs text-muted-foreground">{SITUACAO[s].rotulo}</p>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Buscar cliente ou CNPJ" value={busca} onChange={(e) => setBusca(e.target.value)} />
        {filtro !== "todos" && (
          <Button variant="ghost" size="sm" onClick={() => setFiltro("todos")}>
            Limpar filtro
          </Button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">{visiveis.length} cliente(s)</span>
      </div>
      <div className="overflow-x-auto rounded-card border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Cliente</th>
              <th className="px-3 py-2 text-left font-medium">Situação</th>
              <th className="px-3 py-2 text-left font-medium hidden md:table-cell">Caixa postal</th>
              <th className="px-3 py-2 text-left font-medium hidden md:table-cell">Procuração</th>
              <th className="px-3 py-2 text-left font-medium">Última consulta</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {visiveis.slice(0, 500).map((l) => (
              <tr key={l.cliente.id} className="hover:bg-accent/30">
                <td className="px-3 py-2">
                  <Link to={`/clientes/${l.cliente.id}?tab=fiscal`} className="font-medium hover:underline max-lg:py-3">
                    {nomeDe(l)}
                  </Link>
                  <p className="text-2xs text-muted-foreground">{formatDoc(l.cliente.cpfCnpj) || "sem CPF/CNPJ"}</p>
                </td>
                <td className="px-3 py-2">
                  <Badge variant={SITUACAO[l.situacao].tom}>{SITUACAO[l.situacao].rotulo}</Badge>
                  {l.parcelamentosAtivos > 0 && <p className="text-2xs text-muted-foreground mt-0.5">{l.parcelamentosAtivos} parcelamento(s) ativo(s)</p>}
                </td>
                <td className="px-3 py-2 hidden md:table-cell">
                  {!l.caixa ? (
                    <span className="text-xs text-muted-foreground">sem consulta</span>
                  ) : l.caixaImportantes > 0 ? (
                    <span className="inline-flex items-center gap-1 text-xs">
                      <span className="grid size-5 place-items-center rounded-full bg-destructive text-[10px] font-bold text-white">{l.caixaImportantes}</span>
                      importante(s)
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">nada importante</span>
                  )}
                </td>
                <td className="px-3 py-2 hidden md:table-cell">
                  <ProcuracaoBadge status={l.procuracaoStatus} />
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{l.ultimaEm ? formatData(l.ultimaEm) : "nunca"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProcuracaoBadge({ status }: { status: LinhaResumo["procuracaoStatus"] }) {
  if (status === "ativa") return <Badge variant="success">Ativa</Badge>;
  if (status === "sem_procuracao") return <Badge variant="destructive">Sem procuração</Badge>;
  if (status === "erro") return <Badge variant="default">Erro</Badge>;
  return <Badge variant="secondary">Não verificada</Badge>;
}

// ---------------------------------------------------------------------------
// Consultar (um cliente, qualquer serviço)
// ---------------------------------------------------------------------------

export function ConsultarServicoCard({ clienteId, setClienteId }: { clienteId: string | null; setClienteId: (id: string | null) => void }) {
  const [servico, setServico] = useState<ServicoSerpro>("SITFIS");
  const consultar = useConsultarSerpro();
  const status = useSerproStatus();
  const naoConfigurado = !!status.data && !status.data.configurado;
  const def = SERVICOS_SERPRO.find((s) => s.valor === servico)!;
  async function rodar() {
    if (!clienteId || naoConfigurado) return;
    try {
      await consultar.mutateAsync({ clienteId, servico });
      toast.info("Consulta feita. O resultado está no histórico abaixo.");
    } catch (err) {
      toast.error(erroDeConsulta(err, status.data?.faltando));
    }
  }
  return (
    <Card>
      <CardContent className="p-4 sm:p-6 space-y-3">
        <h2 className="text-title-md">Consultar um cliente</h2>
        <AvisoNaoConfigurado />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_16rem_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label>Cliente</Label>
            <ClienteSelect value={clienteId} onChange={setClienteId} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="servico-serpro">Serviço</Label>
            <select
              id="servico-serpro"
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={servico}
              onChange={(e) => setServico(e.target.value as ServicoSerpro)}
            >
              {SERVICOS_SERPRO.map((s) => (
                <option key={s.valor} value={s.valor}>
                  {s.rotulo}
                </option>
              ))}
            </select>
          </div>
          <Button
            onClick={() => void rodar()}
            disabled={!clienteId || consultar.isPending || naoConfigurado}
            title={naoConfigurado ? "Serpro ainda não configurado" : clienteId ? undefined : "Escolha um cliente"}
          >
            {consultar.isPending ? <Loader2 className="animate-spin" /> : <Search />}
            Consultar
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {def.descricao} Custo estimado: {formatBRL(def.custo)} por consulta (tabela do contrato, faixa 1).
        </p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Procurações
// ---------------------------------------------------------------------------

export function ProcuracoesPainel() {
  const { data = [], isLoading, error, refetch } = useResumoFiscal();
  const consultar = useConsultarSerpro();
  const status = useSerproStatus();
  const pode = usePermissao("serpro.consultar");
  const [filtro, setFiltro] = useState<LinhaResumo["procuracaoStatus"] | "todos">("todos");
  const [lote, setLote] = useState<{ feito: number; total: number } | null>(null);
  const comDoc = data.filter((l) => l.cliente.cpfCnpj);
  const cont = { ativa: 0, sem_procuracao: 0, erro: 0, nunca: 0 };
  for (const l of comDoc) cont[l.procuracaoStatus]++;
  const visiveis = comDoc.filter((l) => filtro === "todos" || l.procuracaoStatus === filtro);

  async function verificar(quais: LinhaResumo[]) {
    if (!quais.length) return;
    const ok = await confirmar({
      titulo: `Verificar ${quais.length} procuração(ões)?`,
      descricao: `Uma consulta por cliente, uma de cada vez. Custo estimado: ${formatBRL(quais.length * CUSTO_SERVICO.PROCURACAO!)}.`,
      confirmLabel: "Verificar",
    });
    if (!ok) return;
    setLote({ feito: 0, total: quais.length });
    let falhas = 0;
    for (const [i, l] of quais.entries()) {
      try {
        await consultar.mutateAsync({ clienteId: l.cliente.id, servico: "PROCURACAO" });
      } catch (err) {
        falhas++;
        // Problema do sistema (não configurado, limite, sem rede): para o lote.
        if (err instanceof ErroDaApi && [0, 404, 429, 503].includes(err.status)) {
          toast.error(erroDeConsulta(err, status.data?.faltando));
          break;
        }
      }
      setLote({ feito: i + 1, total: quais.length });
      await new Promise((r) => setTimeout(r, 2500));
    }
    setLote(null);
    toast.info(`Verificação encerrada${falhas ? `, ${falhas} com erro` : ""}.`);
  }

  if (isLoading) return <ListaSkeleton linhas={4} />;
  if (error && data.length === 0) return <QueryError oque="as procurações" error={error} onRetry={refetch} />;
  return (
    <div className="space-y-4">
      <AvisoNaoConfigurado />
      <p className="text-sm text-muted-foreground">
        Sem procuração eletrônica no e-CAC o Serpro recusa todas as consultas daquele cliente. A verificação usa o serviço
        OBTERPROCURACAO41 ({formatBRL(CUSTO_SERVICO.PROCURACAO!)} por cliente).
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            ["ativa", "Com procuração", "text-success"],
            ["sem_procuracao", "Sem procuração", "text-destructive"],
            ["erro", "Erro na verificação", ""],
            ["nunca", "Não verificadas", "text-muted-foreground"],
          ] as const
        ).map(([k, rot, cor]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFiltro(filtro === k ? "todos" : k)}
            className={cn("rounded-card border bg-card p-3 text-left hover:bg-accent/40", filtro === k && "ring-2 ring-primary")}
          >
            <p className={cn("text-2xl font-semibold tabular-nums", cor)}>{cont[k]}</p>
            <p className="text-xs text-muted-foreground">{rot}</p>
          </button>
        ))}
      </div>
      {pode && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void verificar(comDoc.filter((l) => l.procuracaoStatus !== "ativa"))} disabled={!!lote}>
            {lote ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
            {lote ? `Verificando ${lote.feito} de ${lote.total}…` : `Verificar as que faltam (${comDoc.length - cont.ativa})`}
          </Button>
          <Button variant="outline" onClick={() => void verificar(comDoc)} disabled={!!lote}>
            Verificar todas ({comDoc.length})
          </Button>
        </div>
      )}
      <ul className="divide-y rounded-card border bg-card">
        {visiveis.slice(0, 500).map((l) => (
          <li key={l.cliente.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <Link to={`/clientes/${l.cliente.id}?tab=fiscal`} className="text-sm font-medium hover:underline max-lg:py-3">
                {nomeDe(l)}
              </Link>
              <p className="truncate text-2xs text-muted-foreground">
                {formatDoc(l.cliente.cpfCnpj)}
                {l.procuracao ? ` · ${l.procuracao.resumo ?? ""} · ${formatData(l.procuracao.criadoEm)}` : ""}
              </p>
            </div>
            <ProcuracaoBadge status={l.procuracaoStatus} />
          </li>
        ))}
        {visiveis.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum cliente neste filtro.</li>}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agendamentos
// ---------------------------------------------------------------------------

function CartaoAgendamento({ ag, elegiveis }: { ag: AgendamentoSerpro; elegiveis: number }) {
  const salvar = useSalvarAgendamento();
  const { euId } = useEu();
  const pode = usePermissao("serpro.agendar");
  const [dia, setDia] = useState(ag.diaMes);
  const [todos, setTodos] = useState(ag.todosAtivos);
  const [lista, setLista] = useState<string[]>(ag.clienteIds);
  const [novo, setNovo] = useState<string | null>(null);
  const { data: resumo = [] } = useResumoFiscal();
  const nomes = new Map(resumo.map((l) => [l.cliente.id, nomeDe(l)]));
  const qtd = todos ? elegiveis : lista.length;
  const custo = qtd * (CUSTO_SERVICO[ag.servico] ?? 0.24);
  const mudou = dia !== ag.diaMes || todos !== ag.todosAtivos || lista.join() !== ag.clienteIds.join();

  async function gravar(ativo: boolean) {
    if (ativo && (!ag.ativo || mudou)) {
      const ok = await confirmar({
        titulo: `Ligar ${ROTULO_SERVICO[ag.servico]} todo dia ${dia}?`,
        descricao: `Entram ${qtd} cliente(s). Custo estimado por mês: ${formatBRL(custo)} (cada consulta é cobrada pelo Serpro).`,
        confirmLabel: "Ligar",
      });
      if (!ok) return;
    }
    salvar.mutate(
      { id: ag.id, diaMes: dia, ativo, todosAtivos: todos, clienteIds: todos ? [] : lista, alteradoPorId: euId },
      { onSuccess: () => toast.success(ativo ? "Agendamento salvo." : "Agendamento desligado."), onError: (e) => toast.error(msgErro(e)) },
    );
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">{ROTULO_SERVICO[ag.servico]}</h3>
            <p className="text-xs text-muted-foreground">{SERVICOS_SERPRO.find((s) => s.valor === ag.servico)?.descricao}</p>
          </div>
          <Switch checked={ag.ativo} onCheckedChange={(v) => void gravar(v)} disabled={!pode || salvar.isPending} aria-label="Ligado" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`dia-${ag.id}`}>Dia do mês</Label>
            <select
              id={`dia-${ag.id}`}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={dia}
              disabled={!pode}
              onChange={(e) => setDia(Number(e.target.value))}
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  Todo dia {d}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`cli-${ag.id}`}>Clientes</Label>
            <select
              id={`cli-${ag.id}`}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={todos ? "todos" : "lista"}
              disabled={!pode}
              onChange={(e) => setTodos(e.target.value === "todos")}
            >
              <option value="todos">Todos os ativos ({elegiveis})</option>
              <option value="lista">Só os escolhidos ({lista.length})</option>
            </select>
          </div>
        </div>
        {!todos && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="flex-1">
                <ClienteSelect value={novo} onChange={setNovo} />
              </div>
              <Button
                variant="outline"
                disabled={!novo || lista.includes(novo ?? "")}
                onClick={() => {
                  if (novo) setLista([...lista, novo]);
                  setNovo(null);
                }}
              >
                Adicionar
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {lista.map((id) => (
                <button key={id} type="button" onClick={() => setLista(lista.filter((x) => x !== id))} className="rounded-full border px-2 py-0.5 text-2xs hover:bg-destructive/10" title="Tirar">
                  {nomes.get(id) ?? id} ×
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          {qtd} consulta(s) por ciclo · custo estimado {formatBRL(custo)}/mês.
          {ag.servico === "PARCELAMENTOS" && " Só entram clientes do Simples Nacional ou MEI."}
        </p>
        <div className="rounded-md bg-muted px-3 py-2 text-2xs text-muted-foreground space-y-0.5">
          <p>
            {ag.ativo ? "Ligado." : "Desligado."}{" "}
            {!ag.cicloConcluido && ag.cicloEm ? `Ciclo de ${formatData(ag.cicloEm)} em andamento: ${ag.cicloConsultas} consulta(s), ${formatBRL(Number(ag.cicloCusto))}.` : ""}
          </p>
          <p>Última execução: {ag.ultimaExecucao ? formatDataHora(ag.ultimaExecucao) : "nunca"}</p>
          {ag.ultimoResultado && <p>{ag.ultimoResultado}</p>}
          {ag.ultimoErro && <p className="text-warning">{ag.ultimoErro}</p>}
        </div>
        {pode && mudou && (
          <div className="flex justify-end">
            <Button size="sm" onClick={() => void gravar(ag.ativo)} disabled={salvar.isPending}>
              Salvar alterações
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AgendamentosSerpro() {
  const { data = [], isLoading, error, refetch } = useAgendamentosSerpro();
  const { data: resumo = [] } = useResumoFiscal();
  const pode = usePermissao("serpro.agendar");
  const comDoc = resumo.filter((l) => (l.cliente.cpfCnpj ?? "").length >= 11);
  const elegiveis = (s: string) =>
    s === "PARCELAMENTOS"
      ? comDoc.filter((l) => (l.cliente.cpfCnpj ?? "").length === 14 && ["MEI", "Simples Nacional"].includes(l.cliente.regimeTributario ?? "")).length
      : comDoc.length;
  const totalMes = data.filter((a) => a.ativo).reduce((s, a) => s + (a.todosAtivos ? elegiveis(a.servico) : a.clienteIds.length) * (CUSTO_SERVICO[a.servico] ?? 0.24), 0);
  if (isLoading) return <ListaSkeleton linhas={3} />;
  if (error && data.length === 0) return <QueryError oque="os agendamentos" error={error} onRetry={refetch} />;
  return (
    <div className="space-y-4">
      <AvisoNaoConfigurado />
      <p className="text-sm text-muted-foreground">
        No dia escolhido o servidor consulta cada cliente, um por vez, das 08h às 20h, respeitando o limite do gateway. Só
        consultas de leitura: nada que emita guia ou peça PIN. Tudo fica no histórico com a marca "agendamento".
        {!pode && " Seu cargo só vê os agendamentos (alterar pede a permissão Agendar consultas)."}
      </p>
      <p className="text-sm">
        Custo estimado do que está ligado: <strong>{formatBRL(totalMes)}/mês</strong>
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {data.map((a) => (
          <CartaoAgendamento key={`${a.id}-${a.diaMes}-${a.todosAtivos}-${a.clienteIds.join()}`} ag={a} elegiveis={elegiveis(a.servico)} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custos
// ---------------------------------------------------------------------------

export function CustosSerpro() {
  const { data, isLoading, error, refetch } = useCustosSerpro();
  if (isLoading) return <ListaSkeleton linhas={3} />;
  if (error && !data) return <QueryError oque="os custos" error={error} onRetry={refetch} />;
  const mesAtual = data?.meses[0];
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Estimativa pela tabela do contrato (faixa 1: Consultar {formatBRL(0.24)}, Emitir {formatBRL(0.32)}; o relatório de
        situação fiscal é Emitir). Quando o gateway informa o custo, vale o dele. A fatura do Serpro é a que vale: com mais
        volume a faixa cai para todas as chamadas do mês.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <Wallet className="size-5 text-muted-foreground" />
            <p className="mt-2 text-2xl font-semibold tabular-nums">{formatBRL(mesAtual?.custo ?? 0)}</p>
            <p className="text-xs text-muted-foreground">Este mês</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <Search className="size-5 text-muted-foreground" />
            <p className="mt-2 text-2xl font-semibold tabular-nums">{mesAtual?.consultas ?? 0}</p>
            <p className="text-xs text-muted-foreground">Consultas este mês</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <CalendarClock className="size-5 text-muted-foreground" />
            <p className="mt-2 text-2xl font-semibold tabular-nums">{mesAtual?.agendadas ?? 0}</p>
            <p className="text-xs text-muted-foreground">Delas, por agendamento</p>
          </CardContent>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Este mês, por serviço</h3>
          <ul className="divide-y rounded-card border bg-card text-sm">
            {(data?.porServico ?? []).map((s) => (
              <li key={s.servico} className="flex justify-between px-4 py-2">
                <span>{ROTULO_SERVICO[s.servico] ?? s.servico}</span>
                <span className="tabular-nums text-muted-foreground">
                  {s.consultas} · {formatBRL(s.custo)}
                </span>
              </li>
            ))}
            {!data?.porServico.length && <li className="px-4 py-6 text-center text-muted-foreground">Nenhuma consulta este mês.</li>}
          </ul>
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Por mês</h3>
          <ul className="divide-y rounded-card border bg-card text-sm">
            {(data?.meses ?? []).map((m) => (
              <li key={m.mes} className="flex justify-between px-4 py-2">
                <span>{m.mes.split("-").reverse().join("/")}</span>
                <span className="tabular-nums text-muted-foreground">
                  {m.consultas} consulta(s) · {formatBRL(m.custo)}
                </span>
              </li>
            ))}
            {!data?.meses.length && <li className="px-4 py-6 text-center text-muted-foreground">Sem histórico.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Ficha do cliente: situação de cada serviço
// ---------------------------------------------------------------------------

export function ResumoFiscalCliente({ clienteId }: { clienteId: string }) {
  const { data = [] } = useUltimasDoCliente(clienteId);
  const m = new Map(data.map((u) => [u.servico, u]));
  const situacao = situacaoDe(m.get("SITFIS"), m.get("PARCELAMENTOS"));
  return (
    <div className="rounded-card border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">Situação</span>
        <Badge variant={SITUACAO[situacao].tom}>{SITUACAO[situacao].rotulo}</Badge>
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {(["SITFIS", "CAIXAPOSTAL", "PARCELAMENTOS", "PROCURACAO"] as const).map((s) => {
          const u = m.get(s);
          return (
            <li key={s} className="rounded-md border p-2.5">
              <p className="text-xs font-medium">{ROTULO_SERVICO[s]}</p>
              <p className="text-2xs text-muted-foreground line-clamp-2">{u ? `${formatData(u.criadoEm)} · ${u.resumo ?? ""}` : "Nunca consultado"}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
