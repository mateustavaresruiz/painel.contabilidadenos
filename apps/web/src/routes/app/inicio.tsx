import { ArrowRight, BadgeCheck, Cake, ClipboardList, Headset, Inbox, Loader2, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { CertificadoStatusBadge } from "@/components/features/certificados/certificado-status";
import { Card, CardContent } from "@/components/ui/card";
import { usePageTitle } from "@/hooks/use-page-title";
import { useEu } from "@/lib/colaborador";
import { formatData } from "@/lib/format";
import { diasRestantes, useCertificados } from "@/lib/queries/certificados";
import { useAniversarios, useResumoInicio } from "@/lib/queries/denos";
import { cn } from "@/lib/utils";

export function InicioPage() {
  usePageTitle("Início");
  const { eu, euId } = useEu();
  const { data: resumo, isLoading } = useResumoInicio(euId);
  const { data: aniversarios = [] } = useAniversarios();
  const { data: certs = [] } = useCertificados();
  const hoje = aniversarios.filter((a) => a.diasAte === 0);
  const vencendo = certs
    .filter((c) => {
      const d = diasRestantes(c.validoAte);
      return d >= 0 && d <= 30;
    })
    .slice(0, 6);
  const saudacao = (() => {
    const h = new Date().getHours();
    return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  })();

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <header>
        <p className="eyebrow">{new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}</p>
        <h1 className="text-title-xl mt-1">
          {saudacao}, {eu?.nome.split(" ")[0]}
        </h1>
      </header>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <Indicador
          icone={Inbox}
          rotulo="Conversas sem responsável"
          valor={resumo?.semResponsavel}
          carregando={isLoading}
          to="/whatsapp"
          destaque={!!resumo?.semResponsavel}
        />
        <Indicador
          icone={Headset}
          rotulo="Minhas em atendimento"
          valor={resumo?.minhasEmAtendimento}
          carregando={isLoading}
          to="/whatsapp"
        />
        <Indicador
          icone={ClipboardList}
          rotulo="Chamados em aberto"
          valor={resumo?.solicitacoesAbertas}
          carregando={isLoading}
          to="/chamados"
        />
        <Indicador
          icone={BadgeCheck}
          rotulo="Certificados vencendo (30 dias)"
          valor={resumo?.certificadosVencendo}
          carregando={isLoading}
          to="/certificados"
          destaque={!!resumo?.certificadosVencendo}
        />
        <Indicador icone={Cake} rotulo="Aniversários hoje" valor={hoje.length} to="/clientes/aniversarios" className="col-span-2 lg:col-span-1" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base">Aniversários de hoje</h2>
              <Link to="/clientes/aniversarios" className="text-xs text-primary hover:underline">
                Ver todos
              </Link>
            </div>
            {hoje.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ninguém faz aniversário hoje.</p>
            ) : (
              <ul className="space-y-2">
                {hoje.map((a) => (
                  <li key={`${a.origem}:${a.socioId ?? a.clienteId}`} className="flex items-center gap-2 text-sm">
                    <Cake className="size-4 text-bronze shrink-0" />
                    <span className="flex-1 min-w-0 truncate">
                      <span className="font-medium">{a.nome}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {a.origem === "empresa" ? `${a.anos} anos de empresa` : `${a.anos} anos`}
                        {a.origem === "socio" ? ` · sócio de ${a.clienteNome}` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base">Certificados vencendo</h2>
              <Link to="/certificados" className="text-xs text-primary hover:underline">
                Ver todos
              </Link>
            </div>
            {vencendo.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum vence nos próximos 30 dias.</p>
            ) : (
              <ul className="space-y-2">
                {vencendo.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 min-w-0 truncate">
                      <span className="font-medium">{c.cliente?.nomeFantasia || c.cliente?.nome}</span>
                      <span className="text-muted-foreground"> · {c.tipo} · {formatData(c.validoAte)}</span>
                    </span>
                    <CertificadoStatusBadge validoAte={c.validoAte} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Indicador({
  icone: Icon,
  rotulo,
  valor,
  carregando,
  to,
  destaque,
  className,
}: {
  icone: LucideIcon;
  rotulo: string;
  valor: number | undefined;
  carregando?: boolean;
  to: string;
  destaque?: boolean;
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "group rounded-xl border bg-card p-4 transition-colors hover:bg-accent/40",
        destaque && "border-bronze/40",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cn("size-9 rounded-lg grid place-items-center", destaque ? "bg-bronze/15 text-bronze" : "bg-primary/10 text-primary")}>
          <Icon className="size-4" />
        </span>
        <ArrowRight className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <p className="mt-3 text-3xl font-semibold tabular-nums font-heading">
        {carregando ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : (valor ?? "-")}
      </p>
      <p className="text-xs text-muted-foreground mt-0.5">{rotulo}</p>
    </Link>
  );
}
