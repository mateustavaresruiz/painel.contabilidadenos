import { Building2, Loader2, MessageCircle, PartyPopper, User, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { ABAS_CLIENTES, ModuloAbas } from "@/components/modulo-abas";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
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
import { abrirConversaPorTelefone, useWhatsappSessoes } from "@/lib/queries/whatsapp";
import { useModulos } from "@/lib/modulos";
import { supabase } from "@/lib/supabase";
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
  const { data = [], isLoading } = useAniversarios();
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
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <PageHeader
        icon={Users}
        title="Clientes"
        description="Aniversários: abertura das empresas, nascimento das pessoas e dos sócios."
      />

      <ModuloAbas abas={ABAS_CLIENTES} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border bg-card p-0.5">
          {(
            [
              ["hoje", `Hoje${hoje ? ` (${hoje})` : ""}`],
              ["7", "Próximos 7 dias"],
              ["30", "Próximos 30 dias"],
              ["mes", "Por mês"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setPeriodo(id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                periodo === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {periodo === "mes" && (
          <Select value={String(mes)} onValueChange={(v) => setMes(Number(v))}>
            <SelectTrigger className="w-[150px]" aria-label="Mês">
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
          <SelectTrigger className="w-[170px]" aria-label="Quem">
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
        <div className="py-12 grid place-items-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
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
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ordenada.map((a) => (
            <AniversarioCard key={`${a.origem}:${a.socioId ?? a.clienteId}`} a={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function AniversarioCard({ a }: { a: AniversarioCalculado }) {
  const Icon = a.origem === "empresa" ? Building2 : a.origem === "socio" ? Users : User;
  const ehHoje = a.diasAte === 0;
  return (
    <Card className={cn(ehHoje && "border-bronze/50 bg-bronze/5")}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "size-11 rounded-xl grid place-items-center shrink-0 text-center leading-none",
              ehHoje ? "bg-bronze text-bronze-foreground" : "bg-primary/10 text-primary",
            )}
          >
            <div>
              <div className="text-base font-semibold tabular-nums">{a.proxima.getDate()}</div>
              <div className="text-[9px] uppercase tracking-wider">
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
              <Link to={`/clientes/${a.clienteId}`} className="text-xs text-muted-foreground hover:underline truncate block">
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
      const digitos = (a.telefone ?? "").replace(/\D/g, "");
      let chat: { sessaoId: string; chatId: string } | null = null;
      // Sócio tem telefone próprio: o vínculo por cliente levaria à empresa.
      if (a.origem !== "socio") {
        const { data, error } = await supabase
          .from("WhatsappChat")
          .select("sessaoId, chatId")
          .eq("clienteId", a.clienteId)
          .eq("tipo", "individual")
          .is("apagadoEm", null)
          .order("ultimaMensagemEm", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        chat = data;
      }
      if (!chat && digitos.length >= 10) {
        const comDdi = digitos.length <= 11 ? "55" + digitos : digitos;
        // Tolera o 9º dígito: procura as duas formas do número.
        const variantes = [comDdi];
        if (comDdi.length === 13) variantes.push(comDdi.slice(0, 4) + comDdi.slice(5));
        if (comDdi.length === 12) variantes.push(comDdi.slice(0, 4) + "9" + comDdi.slice(4));
        const { data, error } = await supabase
          .from("WhatsappChat")
          .select("sessaoId, chatId")
          .in(
            "chatId",
            variantes.map((v) => `${v}@c.us`),
          )
          .is("apagadoEm", null)
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        chat = data;
        if (!chat) {
          // Sem conversa: o servidor abre uma (POST /sessoes/:id/chats/novo).
          const sessao = sessoes.find((s) => s.status === "WORKING");
          if (sessao) {
            const nova = await abrirConversaPorTelefone(sessao.id, comDdi);
            chat = { sessaoId: sessao.id, chatId: nova.chatId };
          }
        }
      }
      if (chat) {
        const q = new URLSearchParams({ instancia: chat.sessaoId, chat: chat.chatId, texto });
        navigate(`/whatsapp?${q.toString()}`);
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
