import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  FileDown,
  Loader2,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api, ErroDaApi } from "@/lib/api";
import { msgErro } from "@/lib/erro";
import { formatDataHora, formatDoc } from "@/lib/format";
import {
  STATUS_CONSULTA_LABEL,
  useConsultarSerpro,
  useConsultasFiscais,
  useRetomarConsulta,
  useSerproStatus,
  type ConsultaFiscal,
  type SerproStatus,
} from "@/lib/queries/denos";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

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

/** Cartão de status do Serpro: pronto, faltando itens, ou rota fora do ar. */
export function SerproStatusCard() {
  const { data, isLoading, error, refetch, isFetching } = useSerproStatus();
  const foraDoAr = !!error;
  const rotaInexistente = error instanceof ErroDaApi && (error.status === 404 || error.status === 0);

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "size-10 rounded-xl grid place-items-center shrink-0",
              data?.configurado ? "bg-success/10 text-success" : "bg-warning/10 text-warning",
            )}
          >
            {isLoading ? (
              <Loader2 className="size-5 animate-spin" />
            ) : data?.configurado ? (
              <CheckCircle2 className="size-5" />
            ) : (
              <AlertTriangle className="size-5" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base">
              {isLoading
                ? "Verificando a integração…"
                : data?.configurado
                  ? "Integração com o Serpro pronta"
                  : foraDoAr
                    ? "Integração ainda não disponível"
                    : "Integração com o Serpro não configurada"}
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {foraDoAr
                ? rotaInexistente
                  ? "A função do servidor (serpro) ainda não foi publicada. A tela já está pronta: quando ela entrar no ar, o status aparece aqui."
                  : `Não foi possível falar com o servidor: ${msgErro(error)}`
                : "A consulta de situação fiscal usa o Integra Contador (Serpro / Receita Federal). Veja abaixo o que precisa estar pronto."}
              {data?.ambiente ? ` Ambiente: ${String(data.ambiente)}.` : ""}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={cn(isFetching && "animate-spin")} />
            <span className="hidden sm:inline">Verificar</span>
          </Button>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {REQUISITOS.map((r) => {
            const st = situacaoRequisito(data, r);
            const Icon = st === "ok" ? CheckCircle2 : st === "falta" ? XCircle : CircleDashed;
            return (
              <li key={r.chave} className="rounded-lg border p-3 flex gap-2.5">
                <Icon
                  className={cn(
                    "size-4 mt-0.5 shrink-0",
                    st === "ok" && "text-success",
                    st === "falta" && "text-destructive",
                    st === "desconhecido" && "text-muted-foreground",
                  )}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{r.titulo}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{r.texto}</p>
                </div>
              </li>
            );
          })}
        </ul>
        {data && Array.isArray(data.faltando) && data.faltando.length > 0 && (
          <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground space-y-1">
            <p>
              Variáveis que faltam definir nas funções do servidor (Easypanel → serviço das
              funções → Environment):
            </p>
            <ul className="list-disc pl-5 font-mono text-[11px] text-foreground">
              {data.faltando.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
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
  async function rodar() {
    try {
      await consultar.mutateAsync({ clienteId, servico: "SITFIS" });
      toast.info("Consulta enviada. O resultado aparece no histórico.");
    } catch (err) {
      const naoPublicada = err instanceof ErroDaApi && (err.status === 404 || err.status === 0);
      const naoConfigurada = err instanceof ErroDaApi && err.status === 503;
      toast.error(
        naoPublicada
          ? "A consulta ao Serpro ainda não está disponível no servidor."
          : naoConfigurada
            ? "A integração com o Serpro ainda não foi configurada (veja Pendências fiscais)."
            : "Consulta não realizada: " + msgErro(err),
      );
    }
  }
  return (
    <Button size={size} variant="outline" onClick={rodar} disabled={consultar.isPending}>
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

/** SITFIS é assíncrono: "Retomar" busca o relatório pronto; PDF quando houver. */
function AcoesConsulta({ consulta }: { consulta: ConsultaFiscal }) {
  const retomar = useRetomarConsulta();
  const [abrindo, setAbrindo] = useState(false);
  const temPdf = !!(consulta.resultado as { pdfPath?: string } | null)?.pdfPath;
  if (consulta.status !== "pendente" && !temPdf) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {consulta.status === "pendente" && (
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
  const { data = [], isLoading } = useConsultasFiscais(clienteId);
  const [aberta, setAberta] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="py-8 grid place-items-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (data.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
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
                  {c.servico}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {formatDataHora(c.criadoEm)}
                  {mostrarCliente && c.cliente?.cpfCnpj ? ` · ${formatDoc(c.cliente.cpfCnpj)}` : ""}
                  {c.resumo ? ` · ${c.resumo}` : ""}
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
                  <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-2xs leading-relaxed whitespace-pre-wrap break-all">
                    {JSON.stringify(c.resultado, null, 2)}
                  </pre>
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

