import { PageContainer } from "@/components/page-container";
import {
  BadgeCheck,
  BellRing,
  FlaskConical,
  History,
  Loader2,
  Pencil,
  RefreshCcw,
  Plus,
  Save,
  Search,
  Settings2,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { CertificadoDialog } from "@/components/features/certificados/certificado-dialog";
import { CertificadoStatusBadge } from "@/components/features/certificados/certificado-status";
import { ImportarPlanilhaBotao } from "@/components/features/importar/importar-planilha-dialog";
import { BotaoExportar } from "@/components/features/configuracoes/importar-exportar";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ItemCard, ItemCardSkeleton, ListaResponsiva } from "@/components/ui/lista-responsiva";
import { confirmar } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FiltrosResponsivos, type FiltroAtivo } from "@/components/ui/filtros-responsivos";
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
import { Textarea } from "@/components/ui/textarea";
import { QueryError } from "@/components/ui/query-error";
import { Skeleton, SkeletonTableRow } from "@/components/ui/skeleton";
import { usePageTitle } from "@/hooks/use-page-title";
import { ErroDaApi } from "@/lib/api";
import { CAMPOS_MODELO, modeloEfetivo } from "@/lib/aviso-certificado";
import { msgErro } from "@/lib/erro";
import { formatData, formatDataHora, formatTelefone } from "@/lib/format";
import {
  aplicarModelo,
  CONFIG_MARCOS,
  CONFIG_MODELO,
  CONFIG_SESSAO,
  diasRestantes,
  extrairListaSimulacao,
  STATUS_AVISO_LABEL,
  statusCertificado,
  TIPOS_CERTIFICADO,
  useAvisosCertificado,
  useCertificados,
  useConfig,
  useExcluirCertificado,
  useSalvarConfig,
  useModeloPadraoAviso,
  useSimularAvisos,
  type Certificado,
} from "@/lib/queries/certificados";
import { nomeExibicao, razaoSocialDeApoio } from "@/lib/queries/clientes";
import { normalizarBusca, plural } from "@/lib/texto";
import { useWhatsappSessoes } from "@/lib/queries/whatsapp";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { usePermissao } from "@/lib/colaborador";

const TODOS = "__todos__";

export function CertificadosPage() {
  usePageTitle("Certificados digitais");
  const [params, setParams] = useSearchParams();
  const { data = [], isLoading, isError, error, refetch } = useCertificados();
  const excluir = useExcluirCertificado();
  const podeEditar = usePermissao("certificados.editar");
  const podeAvisos = usePermissao("certificados.configurar_avisos");
  const [busca, setBusca] = useState("");
  // ?status=vencido|vencendo|ok ou ?vence=30 (links do Início) já abre filtrado.
  const [status, setStatus] = useState<string>(() => {
    const s = params.get("status");
    if (params.get("vence") === "30") return "vencendo";
    return s === "vencido" || s === "vencendo" || s === "ok" ? s : TODOS;
  });
  const [configAberta, setConfigAberta] = useState(false);
  const [tipo, setTipo] = useState<string>(TODOS);
  const [editando, setEditando] = useState<Certificado | "novo" | null>(null);
  // Renovar: abre um cadastro novo com os dados deste; ao salvar, este sai dos
  // avisos e dos vencidos (renovadoPorId).
  const [renovando, setRenovando] = useState<Certificado | null>(null);
  const [historico, setHistorico] = useState<string | null>(null);
  // ?novo=<clienteId> (link do painel da conversa) abre o cadastro direto.
  const novoPara = params.get("novo");
  useEffect(() => {
    if (novoPara && podeEditar) setEditando("novo");
  }, [novoPara, podeEditar]);

  const filtrados = useMemo(() => {
    const t = normalizarBusca(busca);
    return data.filter((c) => {
      // Renovado (já substituído por outro) não conta como vencido nem vencendo.
      if (status !== TODOS && (c.renovadoPorId || statusCertificado(c.validoAte) !== status)) return false;
      if (tipo !== TODOS && c.tipo !== tipo) return false;
      if (!t) return true;
      return [c.cliente?.nome, c.cliente?.nomeFantasia, c.titular, c.emissora, c.documento]
        .filter(Boolean)
        .some((v) => normalizarBusca(String(v)).includes(t));
    });
  }, [data, busca, status, tipo]);

  const contagem = useMemo(() => {
    const r = { vencido: 0, vencendo: 0, ok: 0 };
    for (const c of data) if (!c.renovadoPorId) r[statusCertificado(c.validoAte)]++;
    return r;
  }, [data]);

  // Chips do celular (o status também liga pelos cartões de contagem).
  const ROTULO_STATUS: Record<string, string> = { vencido: "Vencidos", vencendo: "Vencem em 30 dias", ok: "Em dia" };
  const ativos: FiltroAtivo[] = [];
  if (status !== TODOS) ativos.push({ id: "status", rotulo: ROTULO_STATUS[status] ?? status, onRemover: () => setStatus(TODOS) });
  if (tipo !== TODOS) ativos.push({ id: "tipo", rotulo: tipo, onRemover: () => setTipo(TODOS) });

  return (
    <PageContainer>
      <PageHeader
        icon={BadgeCheck}
        title="Certificados digitais"
        description="Validade dos certificados dos clientes e aviso automático pelo WhatsApp."
        actions={
          podeEditar || podeAvisos ? (
            <div className="flex flex-wrap gap-2">
              {podeAvisos && (
                <Button variant="outline" onClick={() => setConfigAberta(true)}>
                  <Settings2 />
                  Configurar avisos
                </Button>
              )}
              <BotaoExportar incluir={["certificados"]} rotulo="Exportar" />
              {podeEditar && <ImportarPlanilhaBotao alvo="certificados" />}
              {podeEditar && (
              <Button onClick={() => setEditando("novo")}>
                <Plus />
                Novo certificado
              </Button>
              )}
            </div>
          ) : undefined
        }
      />

      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        {(
          [
            ["vencido", "Vencidos", "Vencidos", "destructive"],
            ["vencendo", "Vencem em 30 dias", "Em 30 dias", "warning"],
            ["ok", "Em dia", "Em dia", "success"],
          ] as const
        ).map(([k, label, curto, variante]) => (
          <button
            key={k}
            type="button"
            onClick={() => setStatus(status === k ? TODOS : k)}
            className={cn(
              "flex min-w-0 flex-col items-start rounded-card border bg-card p-3 sm:p-5 text-left transition-[background-color,box-shadow,transform] duration-150 ease-brand hover:bg-accent/40 active:scale-[.98]",
              status === k && "border-transparent shadow-[inset_0_0_0_2px_var(--primary-focus)]",
            )}
            aria-pressed={status === k}
          >
            <p className="text-title-lg sm:text-title-xl font-semibold tabular-nums">{contagem[k]}</p>
            <Badge variant={variante} className="mt-1.5 max-w-full whitespace-nowrap">
              <span className="sm:hidden">{curto}</span>
              <span className="max-sm:hidden">{label}</span>
            </Badge>
          </button>
        ))}
      </div>

      <FiltrosResponsivos
        className="flex flex-col gap-2 rounded-xl border bg-card p-3 sm:flex-row"
        ativos={ativos}
        onLimpar={() => {
          setStatus(TODOS);
          setTipo(TODOS);
        }}
        antes={
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar certificado"
            aria-label="Buscar por cliente, titular ou emissora"
            className="pl-8 text-base fino:text-sm"
          />
        </div>
        }
      >
        <div className="grid grid-cols-1 gap-2 min-[440px]:grid-cols-2 sm:flex">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="sm:w-[200px] sm:shrink-0" aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os status</SelectItem>
              <SelectItem value="vencido">Vencidos</SelectItem>
              <SelectItem value="vencendo">Vencem em ≤30 dias</SelectItem>
              <SelectItem value="ok">Em dia</SelectItem>
            </SelectContent>
          </Select>
          <Select value={tipo} onValueChange={setTipo}>
            <SelectTrigger className="sm:w-[160px] sm:shrink-0" aria-label="Tipo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os tipos</SelectItem>
              {TIPOS_CERTIFICADO.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </FiltrosResponsivos>

      {isLoading ? (
        // Mesma moldura e altura de linha da lista: nada pula quando ela chega.
        <ListaResponsiva
          corte="xl"
          tabela={
            <Table>
              <TableBody>
                {Array.from({ length: 8 }).map((_, i) => (
                  <SkeletonTableRow key={i} cols={7} alta />
                ))}
              </TableBody>
            </Table>
          }
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <ItemCardSkeleton key={i} />
          ))}
        </ListaResponsiva>
      ) : isError && data.length === 0 ? (
        <QueryError oque="os certificados" error={error} onRetry={refetch} />
      ) : filtrados.length === 0 ? (
        <EmptyState
          icon={BadgeCheck}
          title={data.length === 0 ? "Nenhum certificado cadastrado" : "Nada com esses filtros"}
          description={
            data.length === 0
              ? "Cadastre os certificados dos clientes para acompanhar a validade e avisar antes de vencer."
              : undefined
          }
        />
      ) : (
        <ListaResponsiva
          corte="xl"
          tabela={
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Cliente</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Titular / emissora</TableHead>
                  <TableHead>Válido até</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Aviso</TableHead>
                  <TableHead className="w-36" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtrados.map((c) => (
                  <FragmentLinha
                    key={c.id}
                    c={c}
                    aberto={historico === c.id}
                    onHistorico={() => setHistorico(historico === c.id ? null : c.id)}
                    onEditar={podeEditar ? () => setEditando(c) : undefined}
                    onRenovar={podeEditar && !c.renovadoPorId ? () => setRenovando(c) : undefined}
                    onExcluir={async () => {
                      if (!(await confirmar({ titulo: "Excluir certificado?", descricao: "O histórico de avisos vai junto.", confirmLabel: "Excluir", destructive: true }))) return;
                      excluir.mutate(c.id, { onError: (e) => toast.error(msgErro(e)) });
                    }}
                  />
                ))}
              </TableBody>
            </Table>
          }
        >
          {filtrados.map((c) => (
            <CardCertificado
              key={c.id}
              c={c}
              aberto={historico === c.id}
              onHistorico={() => setHistorico(historico === c.id ? null : c.id)}
              onEditar={podeEditar ? () => setEditando(c) : undefined}
              onRenovar={podeEditar && !c.renovadoPorId ? () => setRenovando(c) : undefined}
              onExcluir={async () => {
                if (!(await confirmar({ titulo: "Excluir certificado?", descricao: "O histórico de avisos vai junto.", confirmLabel: "Excluir", destructive: true }))) return;
                excluir.mutate(c.id, { onError: (e) => toast.error(msgErro(e)) });
              }}
            />
          ))}
        </ListaResponsiva>
      )}

      {podeAvisos && <ConfigAvisosDialog open={configAberta} onOpenChange={setConfigAberta} />}

      <CertificadoDialog
        open={editando !== null}
        onOpenChange={(o) => {
          if (!o) {
            setEditando(null);
            if (novoPara) setParams((p) => { const n = new URLSearchParams(p); n.delete("novo"); return n; }, { replace: true });
          }
        }}
        certificado={editando === "novo" ? null : editando}
        clienteIdFixo={editando === "novo" && novoPara !== "1" ? novoPara : null}
      />
      <CertificadoDialog
        open={renovando !== null}
        onOpenChange={(o) => {
          if (!o) setRenovando(null);
        }}
        renovarDe={renovando}
      />
    </PageContainer>
  );
}

/** O mesmo registro da linha da tabela, em card (celular). */
function CardCertificado({ c, aberto, onHistorico, onEditar, onRenovar, onExcluir }: Parameters<typeof FragmentLinha>[0]) {
  return (
    <>
      <ItemCard
        titulo={c.cliente ? nomeExibicao(c.cliente) : "-"}
        subtitulo={[c.tipo, c.titular, c.emissora].filter(Boolean).join(" · ")}
        selo={c.renovadoPorId ? <Badge variant="secondary">Renovado</Badge> : <CertificadoStatusBadge validoAte={c.validoAte} />}
        meta={[
          { texto: `Válido até ${formatData(c.validoAte)}` },
          {
            icone: c.avisarWhatsapp ? BellRing : undefined,
            texto: c.avisarWhatsapp ? formatTelefone(c.telefoneAviso || c.cliente?.telefone) : "Aviso desligado",
          },
        ]}
        acoes={
          <>
            <Button size="sm" variant="ghost" onClick={onHistorico} aria-expanded={aberto} className="mr-auto">
              <History />
              Histórico
            </Button>
            {onRenovar && (
              <Button size="sm" variant="ghost" onClick={onRenovar} title="Cadastrar o certificado novo no lugar deste">
                <RefreshCcw />
                Renovar
              </Button>
            )}
            {onEditar && (
              <>
                <Button size="icon" variant="ghost" onClick={onEditar} title="Editar" aria-label="Editar certificado">
                  <Pencil />
                </Button>
                <Button size="icon" variant="ghost" onClick={onExcluir} title="Excluir" aria-label="Excluir certificado">
                  <Trash2 />
                </Button>
              </>
            )}
          </>
        }
      />
      {aberto && (
        <li className="col-span-full rounded-xl border border-border/60 bg-muted/40 p-3">
          <HistoricoAvisos certificadoId={c.id} />
        </li>
      )}
    </>
  );
}

function FragmentLinha({
  c,
  aberto,
  onHistorico,
  onEditar,
  onRenovar,
  onExcluir,
}: {
  c: Certificado;
  aberto: boolean;
  onHistorico: () => void;
  /** Sem permissão de editar, editar, renovar e excluir somem. */
  onEditar?: () => void;
  /** Só para quem ainda não foi renovado. */
  onRenovar?: () => void;
  onExcluir: () => void;
}) {
  return (
    <>
      <TableRow>
        <TableCell className="font-medium">
          {c.cliente ? (
            <div className="min-w-0 max-w-[280px]">
              <Link to={`/clientes/${c.clienteId}?aba=certificados`} className="block truncate hover:underline" title={nomeExibicao(c.cliente)}>
                {nomeExibicao(c.cliente)}
              </Link>
              {razaoSocialDeApoio(c.cliente) && (
                <span className="block truncate text-2xs font-normal text-muted-foreground" title={c.cliente.nome}>
                  {c.cliente.nome}
                </span>
              )}
            </div>
          ) : (
            "-"
          )}
        </TableCell>
        <TableCell className="text-sm whitespace-nowrap">{c.tipo}</TableCell>
        <TableCell className="text-sm">
          <span className="block">{c.titular ?? "-"}</span>
          {c.emissora && <span className="block text-xs text-muted-foreground">{c.emissora}</span>}
        </TableCell>
        <TableCell className="text-sm whitespace-nowrap tabular-nums">{formatData(c.validoAte)}</TableCell>
        <TableCell>
          {c.renovadoPorId ? <Badge variant="secondary">Renovado</Badge> : <CertificadoStatusBadge validoAte={c.validoAte} />}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {c.avisarWhatsapp ? (
            <span className="inline-flex items-center gap-1">
              <BellRing className="size-3" />
              {formatTelefone(c.telefoneAviso || c.cliente?.telefone)}
            </span>
          ) : (
            "Desligado"
          )}
        </TableCell>
        <TableCell>
          <div className="flex justify-end gap-0.5">
            <Button size="icon" variant="ghost" onClick={onHistorico} title="Histórico de avisos" aria-label="Histórico de avisos" aria-expanded={aberto}>
              <History />
            </Button>
            {onRenovar && (
              <Button size="icon" variant="ghost" onClick={onRenovar} title="Renovar (cadastrar o novo no lugar deste)" aria-label="Renovar certificado">
                <RefreshCcw />
              </Button>
            )}
            {onEditar && (
              <>
                <Button size="icon" variant="ghost" onClick={onEditar} title="Editar" aria-label="Editar certificado">
                  <Pencil />
                </Button>
                <Button size="icon" variant="ghost" onClick={onExcluir} title="Excluir" aria-label="Excluir certificado">
                  <Trash2 />
                </Button>
              </>
            )}
          </div>
        </TableCell>
      </TableRow>
      {aberto && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={7} className="bg-muted/40">
            <HistoricoAvisos certificadoId={c.id} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function HistoricoAvisos({ certificadoId }: { certificadoId: string }) {
  const { data = [], isLoading } = useAvisosCertificado(certificadoId);
  if (isLoading) return <Loader2 className="size-4 animate-spin text-muted-foreground" />;
  if (data.length === 0) return <p className="text-xs text-muted-foreground">Nenhum aviso enviado ainda.</p>;
  return (
    <ul className="space-y-1">
      {data.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant={a.status === "enviado" ? "success" : a.status === "falhou" ? "destructive" : "warning"}>
            {STATUS_AVISO_LABEL[a.status]}
          </Badge>
          <span>
            Marco de {a.marco} {a.marco === 1 ? "dia" : "dias"}
          </span>
          <span className="text-muted-foreground">· {formatDataHora(a.criadoEm)}</span>
          {a.telefone && <span className="text-muted-foreground">· {formatTelefone(a.telefone)}</span>}
          {a.erro && <span className="text-destructive">· {a.erro}</span>}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Configuração do aviso automático (diálogo aberto pelo cabeçalho)
// ---------------------------------------------------------------------------

function ConfigAvisosDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden max-sm:content-stretch">
        <DialogHeader>
          <DialogTitle>Aviso automático pelo WhatsApp</DialogTitle>
          <DialogDescription>Marcos, número de envio e mensagem do aviso de vencimento.</DialogDescription>
        </DialogHeader>
        {open && <ConfigAvisos onSalvo={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ConfigAvisos({ onSalvo }: { onSalvo: () => void }) {
  const marcosQ = useConfig<number[]>(CONFIG_MARCOS, [30, 15, 7, 1, 0]);
  const sessaoQ = useConfig<string | null>(CONFIG_SESSAO, null);
  const modeloQ = useConfig<string | null>(CONFIG_MODELO, null);
  const padraoQ = useModeloPadraoAviso();
  const { data: sessoes = [] } = useWhatsappSessoes();
  const salvar = useSalvarConfig();
  const simular = useSimularAvisos();
  const [marcos, setMarcos] = useState("");
  const [sessaoId, setSessaoId] = useState<string>("__nenhuma__");
  const [modelo, setModelo] = useState("");
  const [carregado, setCarregado] = useState(false);
  const padrao = modeloEfetivo(null, padraoQ.data);

  useEffect(() => {
    if (carregado || marcosQ.isLoading || sessaoQ.isLoading || modeloQ.isLoading || padraoQ.isLoading) return;
    setMarcos((marcosQ.data ?? []).join(", "));
    setSessaoId(sessaoQ.data ?? "__nenhuma__");
    setModelo(modeloEfetivo(modeloQ.data, padraoQ.data));
    setCarregado(true);
  }, [carregado, marcosQ.isLoading, sessaoQ.isLoading, modeloQ.isLoading, padraoQ.isLoading, marcosQ.data, sessaoQ.data, modeloQ.data, padraoQ.data]);

  // Cada item tem de ser um inteiro de 0 a 365; o que não for é apontado, não descartado em silêncio.
  const marcosTokens = marcos.split(/[,;\s]+/).filter(Boolean);
  const marcosInvalidos = marcosTokens.filter((m) => !/^\d{1,3}$/.test(m) || Number(m) > 365);
  const marcosLista = marcosTokens.filter((m) => !marcosInvalidos.includes(m)).map(Number);
  const erroMarcos =
    marcosTokens.length === 0
      ? "Informe ao menos um marco (dias antes do vencimento)."
      : marcosInvalidos.length > 0
        ? `Valor inválido: ${marcosInvalidos.join(", ")}. Use números inteiros de 0 a 365, separados por vírgula.`
        : null;
  const placeholdersDesconhecidos = [
    ...new Set((modelo.match(/\{[^{}\s]*\}/g) ?? []).filter((p) => !(CAMPOS_MODELO as readonly string[]).includes(p))),
  ];
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const mostrarErroMarcos = !!erroMarcos && (tentouSalvar || marcosInvalidos.length > 0);
  const exemploData = new Date(Date.now() + 15 * 86_400_000);
  const exemplo = aplicarModelo(modelo.trim() ? modelo : padrao, {
    cliente: "Padaria Bom Pão",
    tipo: "e-CNPJ A1",
    validoAte: `${exemploData.getFullYear()}-${String(exemploData.getMonth() + 1).padStart(2, "0")}-${String(exemploData.getDate()).padStart(2, "0")}`,
  });
  const sessaoEscolhida = sessoes.find((s) => s.id === sessaoId);

  async function gravar() {
    setTentouSalvar(true);
    if (erroMarcos) return;
    try {
      await salvar.mutateAsync([
        { chave: CONFIG_MARCOS, valor: [...new Set(marcosLista)].sort((a, b) => b - a) },
        { chave: CONFIG_SESSAO, valor: sessaoId === "__nenhuma__" ? null : sessaoId },
        // Igual ao padrão (ou vazio) grava null: o aviso segue o modelo padrão,
        // e uma troca futura do padrão chega a ele. Gravar o texto congelava.
        { chave: CONFIG_MODELO, valor: !modelo.trim() || modelo.trim() === padrao.trim() ? null : modelo },
      ]);
      toast.success("Avisos salvos");
      onSalvo();
    } catch (err) {
      toast.error(msgErro(err));
    }
  }

  async function rodarSimulacao() {
    try {
      await simular.mutateAsync();
    } catch {
      /* mostrado abaixo */
    }
  }

  const lista = simular.data !== undefined ? extrairListaSimulacao(simular.data) : null;
  const erroSim = simular.error;
  const naoPublicada = erroSim instanceof ErroDaApi && (erroSim.status === 404 || erroSim.status === 0);

  return (
    <>
      <div className="-mx-6 min-h-0 space-y-4 overflow-y-auto px-6 max-sm:-mx-4 max-sm:px-4">
        {!carregado ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {sessaoEscolhida
                ? `Envio pela conexão ${sessaoEscolhida.apelido ?? sessaoEscolhida.numero ?? sessaoEscolhida.nome}${sessaoEscolhida.status !== "WORKING" ? " (desconectada agora)" : ""}.`
                : "Avisos desligados: escolha a conexão de envio."}
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cfg-marcos">Marcos (dias antes do vencimento)</Label>
                <Input
                  id="cfg-marcos"
                  value={marcos}
                  onChange={(e) => setMarcos(e.target.value)}
                  placeholder="30, 15, 7, 1, 0"
                  aria-invalid={mostrarErroMarcos || undefined}
                  className={cn("text-base fino:text-sm", mostrarErroMarcos && "border-destructive")}
                />
                {mostrarErroMarcos ? (
                  <p role="alert" className="text-xs text-destructive">{erroMarcos}</p>
                ) : (
                  <p className="text-2xs text-muted-foreground">
                    Um aviso por marco por certificado. 0 = no dia do vencimento.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cfg-sessao">Enviar pela conexão</Label>
                <Select value={sessaoId} onValueChange={setSessaoId}>
                  <SelectTrigger id="cfg-sessao">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__nenhuma__">Nenhuma (avisos desligados)</SelectItem>
                    {sessoes.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.apelido ?? s.numero ?? s.nome}
                        {s.status !== "WORKING" ? " (desconectada)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-end justify-between gap-2">
                <Label htmlFor="cfg-modelo">Modelo da mensagem</Label>
                {modelo.trim() !== padrao && (
                  <button type="button" onClick={() => setModelo(padrao)} className="text-2xs font-semibold text-primary hover:underline">
                    Voltar ao padrão
                  </button>
                )}
              </div>
              <Textarea id="cfg-modelo" rows={3} value={modelo} onChange={(e) => setModelo(e.target.value)} className="text-base fino:text-sm" />
              <p className="text-2xs text-muted-foreground">
                Use <code>{"{cliente}"}</code> <code>{"{tipo}"}</code> <code>{"{data}"}</code> <code>{"{dias}"}</code>.
              </p>
              {placeholdersDesconhecidos.length > 0 && (
                <p role="alert" className="text-xs font-semibold text-warning">
                  Campo desconhecido no modelo: {placeholdersDesconhecidos.join(", ")}. Vai como texto, sem ser trocado.
                </p>
              )}
              <div className="rounded-lg bg-muted px-3 py-2 text-xs" data-testid="previa-aviso">
                <span className="eyebrow block mb-1">Prévia</span>
                {exemplo}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={rodarSimulacao} disabled={simular.isPending}>
                {simular.isPending ? <Loader2 className="animate-spin" /> : <FlaskConical />}
                Simular avisos de hoje
              </Button>
              <span className="text-2xs text-muted-foreground">A simulação usa a configuração salva e não envia nada.</span>
            </div>
            {erroSim ? (
              <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs">
                {naoPublicada
                  ? "A rotina de avisos ainda não está publicada no servidor. Quando estiver, a simulação mostra aqui quem receberia aviso hoje."
                  : `A simulação falhou: ${msgErro(erroSim)}`}
              </p>
            ) : simular.data !== undefined ? (
              lista ? (
                <div className="space-y-2">
                  <SessaoSimulacao res={simular.data} escolhida={!!sessaoQ.data} />
                  {lista.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhum aviso seria enviado hoje.</p>
                  ) : (
                    <ul className="divide-y rounded-md border text-xs" data-testid="simulacao-avisos">
                      {lista.map((item, i) => (
                        <li key={item.certificadoId ?? i} className="px-3 py-2 space-y-0.5">
                          <p className="font-medium">
                            {item.cliente ?? "Cliente"} · {item.tipo ?? ""}{" "}
                            {item.marco != null ? `· marco ${item.marco}` : ""}
                            {item.telefone ? ` · ${formatTelefone(item.telefone)}` : ""}
                          </p>
                          {(item.texto ?? item.mensagem) && (
                            <p className="text-muted-foreground">{item.texto ?? item.mensagem}</p>
                          )}
                          {item.status === "sem_telefone" && <p className="text-warning">Sem telefone para avisar.</p>}
                          {item.motivo && <p className="text-warning">{item.motivo}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <pre className="max-h-60 overflow-auto rounded-md bg-muted p-3 text-2xs whitespace-pre-wrap">
                  {JSON.stringify(simular.data, null, 2)}
                </pre>
              )
            ) : null}
            <ProximosVencimentos />
          </>
        )}
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="ghost">Cancelar</Button>
        </DialogClose>
        <Button onClick={gravar} disabled={salvar.isPending || !carregado}>
          {salvar.isPending ? <Loader2 className="animate-spin" /> : <Save />}
          Salvar
        </Button>
      </DialogFooter>
    </>
  );
}

/** Por qual número a rotina mandaria (ou por que não mandaria). */
function SessaoSimulacao({ res, escolhida }: { res: unknown; escolhida: boolean }) {
  const r = (res ?? {}) as { sessao?: { nome?: string } | null; wahaConfigurado?: boolean; motivo?: string };
  if (r.wahaConfigurado === false)
    return <p className="text-xs text-warning">O WhatsApp (WAHA) não está configurado no servidor: nada seria enviado.</p>;
  if (r.sessao === null)
    return (
      <p className="text-xs text-warning">
        {escolhida
          ? "A conexão escolhida não está conectada agora: nada seria enviado."
          : "Avisos desligados: escolha a conexão de envio."}
      </p>
    );
  if (r.sessao?.nome) return <p className="text-xs text-muted-foreground">Envio pela conexão {r.sessao.nome}.</p>;
  if (r.motivo) return <p className="text-xs text-muted-foreground">{r.motivo}</p>;
  return null;
}

/** Lista local dos que entram em marco hoje (pela config salva), útil mesmo sem o cron. */
function ProximosVencimentos() {
  const { data = [] } = useCertificados();
  const marcosQ = useConfig<number[]>(CONFIG_MARCOS, [30, 15, 7, 1, 0]);
  const hoje = data.filter((c) => c.avisarWhatsapp && (marcosQ.data ?? []).includes(diasRestantes(c.validoAte)));
  if (hoje.length === 0) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Pela configuração salva, {plural(hoje.length, "certificado está", "certificados estão")} num marco hoje:{" "}
      {hoje.map((c) => nomeExibicao(c.cliente)).join(", ")}.
    </p>
  );
}
