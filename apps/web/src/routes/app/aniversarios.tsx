import { PageContainer } from "@/components/page-container";
import { Building2, Loader2, MessageCircle, PartyPopper, User, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { ABAS_CLIENTES, ModuloAbas } from "@/components/modulo-abas";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Chips } from "@/components/ui/chips";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryError } from "@/components/ui/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePageTitle } from "@/hooks/use-page-title";
import { msgErro } from "@/lib/erro";
import { formatTelefone, linkWaMe } from "@/lib/format";
import { useAniversarios, type AniversarioCalculado } from "@/lib/queries/denos";
import { caminhoDaConversa, localizarConversaDoCliente } from "@/lib/conversa-cliente";
import { useWhatsappSessoes } from "@/lib/queries/whatsapp";
import { useModulos } from "@/lib/modulos";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type Periodo = "hoje" | "7" | "30" | "mes";
type Origem = "todos" | "empresa" | "pessoa" | "socio";

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const ORIGEM_LABEL: Record<AniversarioCalculado["origem"], string> = {
  empresa: "Empresa",
  pessoa: "Pessoa",
  socio: "Sócio",
};

export function AniversariosPage() {
  usePageTitle("Aniversários");
  const { data = [], isLoading, isError, error, refetch } = useAniversarios();
  const [periodo, setPeriodo] = useState<Periodo>("7");
  const [mes, setMes] = useState(new Date().getMonth());
  const [origem, setOrigem] = useState<Origem>("todos");

  const lista = useMemo(() => {
    return data.filter((a) => {
      if (origem !== "todos" && a.origem !== origem) return false;
      if (periodo === "hoje") return a.diasAte === 0;
      if (periodo === "7") return a.diasAte <= 7;
      if (periodo === "30") return a.diasAte <= 30;
      return a.proxima.getMonth() === mes;
    });
  }, [data, periodo, mes, origem]);

  // No modo "por mês" a lista segue o calendário do mês, não a distância.
  const ordenada = useMemo(
    () => (periodo === "mes" ? [...lista].sort((a, b) => a.proxima.getDate() - b.proxima.getDate()) : lista),
    [lista, periodo],
  );

  const hoje = data.filter((a) => a.diasAte === 0).length;

  return (
    <PageContainer>
      <PageHeader
        icon={Users}
        title="Clientes"
        description="Aniversários: abertura das empresas, nascimento das pessoas e dos sócios."
      />

      <ModuloAbas abas={ABAS_CLIENTES} />

      <div className="flex flex-wrap items-center gap-2">
        <Chips
          rotulo="Período"
          valor={periodo}
          onChange={setPeriodo}
          opcoes={[
            { valor: "hoje", rotulo: `Hoje${hoje ? ` (${hoje})` : ""}` },
            { valor: "7", rotulo: "Próximos 7 dias" },
            { valor: "30", rotulo: "Próximos 30 dias" },
            { valor: "mes", rotulo: "Por mês" },
          ]}
        />
        {periodo === "mes" && (
          <Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
            <SelectTrigger className="h-8 w-[150px] rounded-full px-3.5 text-xs md:text-xs" aria-label="Mês">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MESES.map((m, i) => (
                <SelectItem key={m} value={String(i)}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={origem} onValueChange={(v) => setOrigem(v as Origem)}>
          <SelectTrigger className="h-8 w-auto min-w-[200px] rounded-full px-3.5 text-xs md:text-xs" aria-label="Quem">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Empresas, pessoas e sócios</SelectItem>
            <SelectItem value="empresa">Só empresas</SelectItem>
            <SelectItem value="pessoa">Só pessoas</SelectItem>
            <SelectItem value="socio">Só sócios</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-card border bg-card p-5 flex items-start gap-3">
              <Skeleton className="size-11 rounded-pearl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-5 w-1/2 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      ) : isError && data.length === 0 ? (
        <QueryError oque="os aniversários" error={error} onRetry={refetch} />
      ) : ordenada.length === 0 ? (
        <EmptyState
          icon={PartyPopper}
          title="Nenhum aniversário no período"
          description={
            data.length === 0
              ? "Preencha a data de abertura (PJ), a data de nascimento (PF) e a dos sócios no cadastro de clientes."
              : "Tente outro período ou filtro."
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {ordenada.map((a) => (
            <AniversarioCard key={`${a.origem}:${a.socioId ?? a.clienteId}`} a={a} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}

function AniversarioCard({ a }: { a: AniversarioCalculado }) {
  const Icon = a.origem === "empresa" ? Building2 : a.origem === "socio" ? Users : User;
  const ehHoje = a.diasAte === 0;
  return (
    <Card className={cn(ehHoje && "border-bronze/50 bg-bronze/5")}>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "size-11 rounded-pearl grid place-items-center shrink-0 text-center leading-none",
              ehHoje ? "bg-bronze text-bronze-foreground" : "bg-primary/10 text-primary",
            )}
          >
            <div>
              <div className="text-base font-semibold tabular-nums">{a.proxima.getDate()}</div>
              <div className="text-[11px] uppercase tracking-wide">
                {a.proxima.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}
              </div>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">{a.nome}</p>
            {a.origem === "socio" ? (
              <p className="text-xs text-muted-foreground truncate">
                Sócio de{" "}
                <Link to={`/clientes/${a.clienteId}?aba=socios`} className="hover:underline">
                  {a.clienteNome}
                </Link>
              </p>
            ) : (
              <Link to={`/clientes/${a.clienteId}`} className="text-xs text-muted-foreground hover:underline truncate block max-lg:-my-3 max-lg:py-3">
                Ver cadastro
              </Link>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="gap-1">
                <Icon className="size-3" />
                {ORIGEM_LABEL[a.origem]}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {a.origem === "empresa"
                  ? `${a.anos} ${a.anos === 1 ? "ano" : "anos"} de empresa`
                  : `${a.anos} anos`}
              </span>
              <span className={cn("text-xs", ehHoje ? "text-bronze font-semibold" : "text-muted-foreground")}>
                · {ehHoje ? "hoje!" : a.diasAte === 1 ? "amanhã" : `em ${a.diasAte} dias`}
              </span>
            </div>
          </div>
        </div>
        <ParabenizarSeAtivo a={a} />
      </CardContent>
    </Card>
  );
}

function mensagemParabens(a: AniversarioCalculado): string {
  if (a.origem === "empresa") {
    return `Olá! Hoje a ${a.nome} completa ${a.anos} ${a.anos === 1 ? "ano" : "anos"} de história. Parabéns pela trajetória, é um prazer caminhar junto com vocês. Equipe NÓS Contabilidade 🎉`;
  }
  const primeiro = a.nome.split(" ")[0] ?? a.nome;
  return `Feliz aniversário, ${primeiro}! 🎂 Desejamos um novo ano cheio de saúde, conquistas e alegrias. Um abraço da equipe NÓS Contabilidade.`;
}

/** Configurações > Módulos pode desligar o botão de parabéns. */
function ParabenizarSeAtivo({ a }: { a: AniversarioCalculado }) {
  const { ativo } = useModulos();
  if (!ativo("aniversarioParabens") || !ativo("whatsapp")) return null;
  return <ParabenizarBotao a={a} />;
}

/**
 * Abre a conversa do aniversariante no Atendimento com a mensagem já escrita
 * no campo (quem envia é a pessoa, revisando antes). Procura a conversa pelo
 * cliente vinculado e, se não achar, pelo telefone; sem conversa, abre uma
 * nova no número conectado. Sem número conectado, cai no wa.me.
 */
function ParabenizarBotao({ a }: { a: AniversarioCalculado }) {
  const navigate = useNavigate();
  const { data: sessoes = [] } = useWhatsappSessoes();
  const [buscando, setBuscando] = useState(false);
  const texto = mensagemParabens(a);

  async function abrir() {
    setBuscando(true);
    try {
      // Sócio tem telefone próprio: o vínculo por cliente levaria à empresa.
      const chat = await localizarConversaDoCliente({
        clienteId: a.clienteId,
        telefone: a.telefone,
        porCliente: a.origem !== "socio",
        sessaoConectadaId: sessoes.find((s) => s.status === "WORKING")?.id ?? null,
      });
      if (chat) {
        navigate(caminhoDaConversa(chat, texto));
        return;
      }
      const wa = linkWaMe(a.telefone, texto);
      if (wa) {
        window.open(wa, "_blank", "noopener");
        return;
      }
      toast.warning("Sem telefone cadastrado para este aniversariante.");
    } catch (err) {
      toast.error(msgErro(err));
    } finally {
      setBuscando(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" className="flex-1" onClick={abrir} disabled={buscando || !a.telefone} title={a.telefone ? undefined : "Sem telefone"}>
        {buscando ? <Loader2 className="animate-spin" /> : <MessageCircle />}
        Parabenizar no WhatsApp
      </Button>
      {a.telefone && <span className="text-2xs text-muted-foreground tabular-nums">{formatTelefone(a.telefone)}</span>}
    </div>
  );
}
