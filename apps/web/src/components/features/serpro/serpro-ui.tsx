import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  FileDown,
  KeyRound,
  Loader2,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QueryError } from "@/components/ui/query-error";
import { ListaSkeleton } from "@/components/ui/skeleton";
import { erroDeConsulta } from "@/components/features/serpro/serpro-painel";
import { api, ErroDaApi } from "@/lib/api";
import { usePermissao } from "@/lib/colaborador";
import { msgErro } from "@/lib/erro";
import { formatBRL, formatDataHora, formatDoc } from "@/lib/format";
import {
  STATUS_CONSULTA_LABEL,
  useCancelarConsulta,
  useConfirmarConsulta,
  useConsultarSerpro,
  useConsultasFiscais,
  useRetomarConsulta,
  useSerproStatus,
  type ConsultaFiscal,
  type SerproStatus,
} from "@/lib/queries/denos";
import { ROTULO_SERVICO } from "@/lib/queries/serpro";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { plural } from "@/lib/texto";

/** O que o Integra Contador exige, com a explicação curta de cada item. */
const REQUISITOS = [
  {
    chave: "contrato",
    palavras: ["contrato", "contratante", "integra"],
    titulo: "Contrato Integra Contador",
    texto:
      "Contratação do Integra Contador na Loja Serpro, no CNPJ do escritório. É o que libera as APIs da Receita para a contabilidade.",
  },
  {
    chave: "credenciais",
    palavras: ["consumer", "key", "secret", "credencia", "chave"],
    titulo: "Consumer key e secret",
    texto:
      "As duas chaves que a Loja Serpro gera para o contrato. Ficam só no servidor (variáveis da função), nunca no navegador.",
  },
  {
    chave: "certificado",
    palavras: ["certificado", "e-cnpj", "ecnpj", "pfx", "a1"],
    titulo: "Certificado e-CNPJ do escritório",
    texto:
      "O certificado A1 (arquivo .pfx e senha) do CNPJ do escritório, usado para autenticar no Serpro. Também fica só no servidor.",
  },
  {
    chave: "procuracao",
    palavras: ["procura"],
    titulo: "Procuração de cada cliente",
    texto:
      "Cada cliente precisa outorgar procuração eletrônica ao escritório no e-CAC (código do serviço Integra Contador). Sem ela, a consulta daquele cliente volta recusada.",
  },
] as const;

function situacaoRequisito(
  status: SerproStatus | undefined,
  req: (typeof REQUISITOS)[number],
): "ok" | "falta" | "desconhecido" {
  if (!status) return "desconhecido";
  const bruto = status as Record<string, unknown>;
  // Formato 1: { contrato: true, credenciais: false, ... }
  if (typeof bruto[req.chave] === "boolean") return bruto[req.chave] ? "ok" : "falta";
  // Formato 2: { faltando: ["consumer key", ...] }
  const faltando = Array.isArray(status.faltando) ? status.faltando.map(String) : null;
  if (faltando) {
    const bate = faltando.some((f) => req.palavras.some((p) => f.toLowerCase().includes(p)));
    if (bate) return "falta";
    if (req.chave === "procuracao") return "desconhecido"; // é por cliente
    return "ok";
  }
  if (status.configurado) return req.chave === "procuracao" ? "desconhecido" : "ok";
  return "desconhecido";
}

/**
 * Aviso da página de Pendências fiscais. Nada técnico aqui: pronto, some; não
 * configurado, uma frase e (para quem administra) o link para Configurações >
 * Integrações, onde ficam os requisitos e as variáveis do servidor.
 */
export function SerproStatusCard() {
  const { data, isLoading, error, refetch, isFetching } = useSerproStatus();
  // O link vai para Integrações, que é da área técnica.
  const admin = usePermissao("sistema.tecnico");
  if (isLoading || (data?.configurado && !error)) return null;
  const foraDoAr = !!error;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-start gap-3 p-4 sm:flex-nowrap sm:p-5">
        <div className="grid size-10 shrink-0 place-items-center rounded-pearl bg-warning/10 text-warning">
          <AlertTriangle className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-title-sm font-semibold">
            {foraDoAr ? "Consulta ao Serpro indisponível agora" : "Serpro ainda não configurado"}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {foraDoAr
              ? "Não foi possível falar com o servidor. Tente de novo em instantes."
              : "As consultas de situação fiscal, caixa postal e parcelamentos começam a funcionar quando a integração com a Receita (Integra Contador) estiver pronta."}
            {!admin && " Quem administra o painel cuida disso."}
          </p>
        </div>
        <div className="flex shrink-0 gap-2 max-sm:basis-full">
          <Button variant="ghost" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={cn(isFetching && "animate-spin")} />
            Verificar
          </Button>
          {admin && (
            <Button asChild size="sm" variant="outline">
              <Link to="/configuracoes?tab=integracoes">Abrir Integrações</Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * O que o Integra Contador exige e as variáveis que faltam no servidor. Mora
 * em Configurações > Integrações (cartão do Serpro), só para quem administra.
 */
export function RequisitosSerpro({ data }: { data: SerproStatus | undefined }) {
  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {REQUISITOS.map((r) => {
          const st = situacaoRequisito(data, r);
          const Icon = st === "ok" ? CheckCircle2 : st === "falta" ? XCircle : CircleDashed;
          return (
            <li key={r.chave} className="flex gap-2.5 rounded-lg border p-3">
              <Icon
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  st === "ok" && "text-success",
                  st === "falta" && "text-destructive",
                  st === "desconhecido" && "text-muted-foreground",
                )}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium">{r.titulo}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">{r.texto}</p>
              </div>
            </li>
          );
        })}
      </ul>
      {data && Array.isArray(data.faltando) && data.faltando.length > 0 && (
        <div className="space-y-1 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          <p>
            Variáveis que faltam nas funções do servidor (Easypanel, serviço das funções, Environment; o
            certificado A1 fica em /data/certs):
          </p>
          <ul className="list-disc pl-5 font-mono text-[11px] text-foreground">
            {data.faltando.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Botão "Consultar situação fiscal" (SITFIS) de um cliente. */
export function ConsultarSituacaoBotao({
  clienteId,
  size = "sm",
}: {
  clienteId: string;
  size?: "sm" | "default";
}) {
  const consultar = useConsultarSerpro();
  const status = useSerproStatus();
  const naoConfigurado = !!status.data && !status.data.configurado;
  const pode = usePermissao("serpro.consultar");
  if (!pode) return null;
  async function rodar() {
    try {
      await consultar.mutateAsync({ clienteId, servico: "SITFIS" });
      toast.info("Consulta enviada. O resultado aparece no histórico.");
    } catch (err) {
      toast.error(erroDeConsulta(err, status.data?.faltando));
    }
  }
  return (
    <Button
      size={size}
      variant="outline"
      onClick={rodar}
      disabled={consultar.isPending || naoConfigurado}
      title={naoConfigurado ? "Serpro ainda não configurado" : undefined}
    >
      {consultar.isPending ? <Loader2 className="animate-spin" /> : <Search />}
      Consultar situação fiscal
    </Button>
  );
}

const TOM: Record<ConsultaFiscal["status"], string> = {
  pendente: "bg-muted text-muted-foreground border-border",
  ok: "bg-success/10 text-success border-success/25",
  com_pendencia: "bg-warning/10 text-warning border-warning/30",
  erro: "bg-destructive/10 text-destructive border-destructive/25",
};

type ConfirmacaoPin = { id: string; resumo?: string; custoEstimado?: number | null; expiraEm?: string | null };

/** Consulta segurada pelo gateway pedindo PIN (`resultado.confirmacao`). */
function confirmacaoPendente(c: ConsultaFiscal): ConfirmacaoPin | null {
  if (c.status !== "pendente") return null;
  const conf = (c.resultado as { confirmacao?: ConfirmacaoPin } | null)?.confirmacao;
  return conf?.id ? conf : null;
}

/** SITFIS é assíncrono: "Retomar" busca o relatório pronto; PDF quando houver. */
function AcoesConsulta({ consulta }: { consulta: ConsultaFiscal }) {
  const retomar = useRetomarConsulta();
  const cancelar = useCancelarConsulta();
  const [abrindo, setAbrindo] = useState(false);
  const [pinAberto, setPinAberto] = useState(false);
  const temPdf = !!(consulta.resultado as { pdfPath?: string } | null)?.pdfPath;
  const podePin = usePermissao("serpro.confirmar_pin");
  const conf = confirmacaoPendente(consulta);
  if (consulta.status !== "pendente" && !temPdf) return null;
  async function cancelarConfirmacao() {
    const ok = await confirmar({
      titulo: "Cancelar esta consulta?",
      descricao: "A confirmação pendente no gateway é descartada e nada é cobrado.",
      confirmLabel: "Cancelar consulta",
      destructive: true,
    });
    if (!ok) return;
    cancelar.mutate(consulta.id, { onError: (e) => toast.error("Não foi possível cancelar: " + msgErro(e)) });
  }
  return (
    <div className="flex flex-wrap gap-2">
      {conf && (
        <>
          <Button size="sm" onClick={() => setPinAberto(true)} disabled={!podePin} title={podePin ? undefined : "Seu cargo não confirma com PIN"}>
            <KeyRound />
            Confirmar com PIN
          </Button>
          <Button size="sm" variant="ghost" disabled={cancelar.isPending} onClick={() => void cancelarConfirmacao()}>
            {cancelar.isPending ? <Loader2 className="animate-spin" /> : <XCircle />}
            Cancelar
          </Button>
          <ConfirmarPinDialog consultaId={consulta.id} conf={conf} open={pinAberto} onOpenChange={setPinAberto} />
        </>
      )}
      {consulta.status === "pendente" && !conf && (
        <Button
          size="sm"
          variant="outline"
          disabled={retomar.isPending}
          onClick={() =>
            retomar.mutate(consulta.id, { onError: (e) => toast.error("Não foi possível retomar: " + msgErro(e)) })
          }
        >
          {retomar.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Buscar resultado
        </Button>
      )}
      {temPdf && (
        <Button
          size="sm"
          variant="outline"
          disabled={abrindo}
          onClick={async () => {
            setAbrindo(true);
            try {
              const { url } = await api<{ url: string }>(`/serpro/consultas/${consulta.id}/pdf`);
              window.open(url, "_blank", "noopener");
            } catch (e) {
              toast.error(msgErro(e));
            } finally {
              setAbrindo(false);
            }
          }}
        >
          {abrindo ? <Loader2 className="animate-spin" /> : <FileDown />}
          Relatório em PDF
        </Button>
      )}
    </div>
  );
}

function ConfirmarPinDialog({
  consultaId,
  conf,
  open,
  onOpenChange,
}: {
  consultaId: string;
  conf: ConfirmacaoPin;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const confirmarPin = useConfirmarConsulta();
  const [pin, setPin] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!pin.trim()) return;
    setErro(null);
    try {
      await confirmarPin.mutateAsync({ id: consultaId, pin: pin.trim() });
      toast.success("Consulta confirmada");
      setPin("");
      onOpenChange(false);
    } catch (err) {
      // 400 = PIN errado: o diálogo fica aberto para tentar de novo.
      if (err instanceof ErroDaApi && err.status === 400) {
        setErro(msgErro(err) || "PIN inválido.");
        return;
      }
      toast.error("Confirmação não realizada: " + msgErro(err));
      onOpenChange(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirmar com PIN</DialogTitle>
          <DialogDescription>
            {conf.resumo ?? "O gateway pede confirmação antes de executar este serviço."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-4">
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Custo estimado</dt>
              <dd>{conf.custoEstimado != null ? formatBRL(conf.custoEstimado) : "não informado"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Expira em</dt>
              <dd>{conf.expiraEm ? formatDataHora(conf.expiraEm) : "não informado"}</dd>
            </div>
          </dl>
          <div className="space-y-1.5">
            <Label htmlFor="pin-serpro">PIN</Label>
            <Input
              id="pin-serpro"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
            {erro && <p className="text-xs text-destructive">{erro}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Voltar
            </Button>
            <Button type="submit" disabled={!pin.trim() || confirmarPin.isPending}>
              {confirmarPin.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}
              Confirmar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function StatusConsultaBadge({ status }: { status: ConsultaFiscal["status"] }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-medium whitespace-nowrap", TOM[status])}>
      {STATUS_CONSULTA_LABEL[status]}
    </span>
  );
}

/** Histórico de consultas fiscais, com o resultado expansível. */
export function ConsultasFiscaisLista({
  clienteId,
  mostrarCliente,
}: {
  clienteId?: string;
  mostrarCliente?: boolean;
}) {
  const { data = [], isLoading, error, refetch } = useConsultasFiscais(clienteId);
  const [aberta, setAberta] = useState<string | null>(null);

  if (isLoading) {
    return (
      <ListaSkeleton linhas={3} />
    );
  }
  if (error && data.length === 0) return <QueryError oque="as consultas" error={error} onRetry={refetch} />;
  if (data.length === 0) {
    return (
      <p className="rounded-card border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
        Nenhuma consulta feita ainda.
      </p>
    );
  }
  return (
    <ul className="divide-y rounded-lg border bg-card">
      {data.map((c) => {
        const expandida = aberta === c.id;
        return (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => setAberta(expandida ? null : c.id)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/40"
              aria-expanded={expandida}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {mostrarCliente && c.cliente
                    ? `${c.cliente.nomeFantasia || c.cliente.nome} · `
                    : ""}
                  {ROTULO_SERVICO[c.servico] ?? c.servico}
                  {(c as { origem?: string }).origem === "agendamento" && (
                    <span className="ml-1.5 text-2xs font-normal text-muted-foreground">· agendamento</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {formatDataHora(c.criadoEm)}
                  {mostrarCliente && c.cliente?.cpfCnpj ? ` · ${formatDoc(c.cliente.cpfCnpj)}` : ""}
                  {c.resumo ? ` · ${c.resumo}` : ""}
                  {(c as { custoEstimado?: number | null }).custoEstimado ? ` · ${formatBRL(Number((c as { custoEstimado?: number }).custoEstimado))}` : ""}
                </p>
              </div>
              <StatusConsultaBadge status={c.status} />
              <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", expandida && "rotate-180")} />
            </button>
            {expandida && (
              <div className="px-4 pb-4 space-y-2">
                <AcoesConsulta consulta={c} />
                {c.erro && (
                  <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{c.erro}</p>
                )}
                {c.resultado != null ? (
                  <>
                    <ResultadoLegivel consulta={c} />
                    <details>
                      <summary className="cursor-pointer text-2xs text-muted-foreground">Resposta completa</summary>
                      <pre className="mt-1 max-h-80 overflow-auto rounded-md bg-muted p-3 text-2xs leading-relaxed whitespace-pre-wrap break-all">
                        {JSON.stringify(c.resultado, null, 2)}
                      </pre>
                    </details>
                  </>
                ) : (
                  !c.erro && <p className="text-xs text-muted-foreground">Sem resultado detalhado.</p>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}


type MsgCaixa = { data: string; assunto: string; naoLida: boolean; importante: boolean };
type Parcel = { numero: string; situacao: string | null; status: string; dataPedido: unknown };

/** Leitura humana do resultado: caixa postal, parcelamentos e procuração. */
function ResultadoLegivel({ consulta }: { consulta: ConsultaFiscal }) {
  const r = (consulta.resultado ?? {}) as Record<string, unknown>;
  if (consulta.servico === "CAIXAPOSTAL" && r.caixaPostal) {
    const cx = r.caixaPostal as { total: number; naoLidas: number; importantes: number; mensagens: MsgCaixa[]; temMaisPaginas?: boolean };
    return (
      <div className="space-y-1.5">
        <p className="text-xs">
          {plural(cx.total, "mensagem", "mensagens")} · {plural(cx.naoLidas, "não lida", "não lidas")} · <strong className={cn(cx.importantes > 0 && "text-destructive")}>{plural(cx.importantes, "importante", "importantes")}</strong>
          {cx.temMaisPaginas ? " · só a primeira página" : ""}
        </p>
        <ul className="divide-y rounded-md border text-xs">
          {cx.mensagens.map((m, i) => (
            <li key={i} className={cn("flex gap-2 px-3 py-1.5", m.importante && "bg-destructive/5")}>
              <span className="text-muted-foreground tabular-nums shrink-0">{m.data}</span>
              <span className={cn("flex-1", m.naoLida && "font-medium")}>{m.assunto}</span>
              {m.importante && <span className="text-destructive text-2xs">importante</span>}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (consulta.servico === "PARCELAMENTOS" && Array.isArray(r.parcelamentos)) {
    const ps = r.parcelamentos as Parcel[];
    if (ps.length === 0) return <p className="text-xs text-muted-foreground">Nenhum pedido de parcelamento ({String(r.modalidade ?? "")}).</p>;
    return (
      <ul className="divide-y rounded-md border text-xs">
        {ps.map((p) => (
          <li key={p.numero} className="flex gap-2 px-3 py-1.5">
            <span className="font-medium">Nº {p.numero}</span>
            <span className="flex-1 text-muted-foreground">{p.situacao ?? ""}</span>
            <span className={cn(p.status === "ATIVO" ? "text-warning" : "text-muted-foreground")}>{p.status}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (consulta.servico === "PROCURACAO" && r.procuracao) {
    const ativa = r.procuracao === "ativa";
    return (
      <p className={cn("text-xs", ativa ? "text-success" : "text-destructive")}>
        {ativa ? "Procuração vigente" : "Sem procuração vigente para o escritório"}
        {r.validade ? ` até ${String(r.validade).split("-").reverse().join("/")}` : ""}
        {Array.isArray(r.sistemas) && r.sistemas.length ? ` · ${plural(r.sistemas.length, "sistema liberado", "sistemas liberados")}` : ""}
      </p>
    );
  }
  return null;
}
