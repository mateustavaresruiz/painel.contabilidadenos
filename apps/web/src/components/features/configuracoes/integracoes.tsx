import { ArrowRight, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { EstadoBadge } from "@/components/features/configuracoes/estado-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { msgErro } from "@/lib/erro";
import { formatData, formatDataHora } from "@/lib/format";
import { useModulos } from "@/lib/modulos";
import { useSerproStatus, useTestarLoginSerpro } from "@/lib/queries/denos";
import {
  agendaEmPortugues,
  CRON_DESCRICAO,
  estadoSerpro,
  usePainelSaude,
  useWhatsappStatus,
  type Estado,
} from "@/lib/queries/saude";
import { useWhatsappSessoes } from "@/lib/queries/whatsapp";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const STATUS_SESSAO: Record<string, { rotulo: string; estado: Estado }> = {
  WORKING: { rotulo: "Online", estado: "ok" },
  STARTING: { rotulo: "Iniciando", estado: "carregando" },
  SCAN_QR_CODE: { rotulo: "Aguardando QR", estado: "atencao" },
  STOPPED: { rotulo: "Parada", estado: "atencao" },
  FAILED: { rotulo: "Falhou", estado: "erro" },
};

export function ConfigIntegracoes() {
  const { ativo } = useModulos();
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <CardBanco />
      {ativo("whatsapp") && <CardWhatsapp />}
      {ativo("pendenciasFiscais") && <CardSerpro />}
      <CardCrons />
    </div>
  );
}

function CardIntegracao({
  titulo,
  estado,
  rotulo,
  verificadoEm,
  onVerificar,
  verificando,
  children,
  className,
}: {
  titulo: string;
  estado: Estado;
  rotulo?: string;
  verificadoEm?: number;
  onVerificar: () => void;
  verificando: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-title-md">{titulo}</h2>
              <EstadoBadge estado={estado} rotulo={rotulo} />
            </div>
            <p className="text-2xs text-muted-foreground mt-1">
              {verificadoEm ? `Verificado em ${formatDataHora(new Date(verificadoEm).toISOString())}` : "Ainda não verificado"}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onVerificar} disabled={verificando}>
            <RefreshCw className={cn(verificando && "animate-spin")} />
            Verificar
          </Button>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="text-right min-w-0 break-words">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------

function CardBanco() {
  const q = usePainelSaude();
  const d = q.data;
  const estado: Estado = q.isLoading ? "carregando" : q.error ? "erro" : (d?.erros24h ?? 0) > 0 ? "atencao" : "ok";
  return (
    <CardIntegracao
      titulo="Banco de dados (Supabase)"
      estado={estado}
      verificadoEm={q.dataUpdatedAt || q.errorUpdatedAt || undefined}
      onVerificar={() => void q.refetch()}
      verificando={q.isFetching}
    >
      {q.isLoading ? (
        <Skeleton className="h-28 w-full" />
      ) : q.error ? (
        <p className="text-sm text-destructive">Sem resposta do banco: {msgErro(q.error)}</p>
      ) : d ? (
        <>
          <dl className="divide-y divide-divider">
            <Linha rotulo="Tempo de resposta">{q.data?.latenciaMs} ms</Linha>
            <Linha rotulo="Erros nas últimas 24h">{d.erros24h}</Linha>
            <Linha rotulo="Migrações aplicadas">
              {d.migracoes.length} (última: {d.migracoes.at(-1)?.nome ?? "nenhuma"})
            </Linha>
          </dl>
          <details className="text-sm">
            <summary className="cursor-pointer text-primary text-xs">Tabelas e migrações</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <ul className="space-y-1 text-xs">
                {Object.entries(d.tabelas).map(([t, n]) => (
                  <li key={t} className="flex justify-between gap-2">
                    <span className="font-mono">{t}</span>
                    <span className="nums">{n.toLocaleString("pt-BR")}</span>
                  </li>
                ))}
              </ul>
              <ul className="space-y-1 text-xs">
                {d.migracoes.map((m) => (
                  <li key={m.nome} className="flex justify-between gap-2">
                    <span className="font-mono truncate">{m.nome}</span>
                    <span className="text-muted-foreground shrink-0">{formatData(m.aplicadaEm)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        </>
      ) : null}
    </CardIntegracao>
  );
}

// ---------------------------------------------------------------------------

function CardWhatsapp() {
  const st = useWhatsappStatus();
  const { data: sessoes = [], isLoading: carregandoSessoes, refetch } = useWhatsappSessoes();
  const online = sessoes.filter((s) => s.status === "WORKING").length;
  const estado: Estado = st.isLoading
    ? "carregando"
    : st.error
      ? "erro"
      : !st.data?.wahaConfigurado || sessoes.length === 0 || online < sessoes.length
        ? "atencao"
        : "ok";
  return (
    <CardIntegracao
      titulo="WhatsApp (WAHA)"
      estado={estado}
      verificadoEm={st.dataUpdatedAt || st.errorUpdatedAt || undefined}
      onVerificar={() => {
        void st.refetch();
        void refetch();
      }}
      verificando={st.isFetching}
    >
      {st.error ? (
        <p className="text-sm text-destructive">A função whatsapp não respondeu: {msgErro(st.error)}</p>
      ) : st.isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : (
        <dl className="divide-y divide-divider">
          <Linha rotulo="WAHA configurado">{st.data?.wahaConfigurado ? "Sim" : "Não (WAHA_URL / WAHA_API_KEY)"}</Linha>
          <Linha rotulo="Segredo do webhook">{st.data?.webhookSecretConfigurado ? "Configurado" : "Não configurado"}</Linha>
          <Linha rotulo="Webhook">
            <span className="font-mono text-xs">{st.data?.webhookUrl}</span>
          </Linha>
        </dl>
      )}
      <div className="space-y-2">
        <p className="eyebrow">Números</p>
        {carregandoSessoes ? (
          <Skeleton className="h-10 w-full" />
        ) : sessoes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum número cadastrado ainda.</p>
        ) : (
          <ul className="divide-y divide-divider">
            {sessoes.map((s) => {
              const info = STATUS_SESSAO[s.status] ?? { rotulo: s.status, estado: "atencao" as Estado };
              return (
                <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="flex-1 min-w-0 truncate">
                    {s.apelido || s.pushName || s.nome}
                    {s.numero && <span className="text-muted-foreground"> · {s.numero}</span>}
                  </span>
                  <EstadoBadge estado={info.estado} rotulo={info.rotulo} />
                </li>
              );
            })}
          </ul>
        )}
        <Button asChild variant="outline" size="sm">
          <Link to="/configuracoes?tab=conexoes">
            Gerenciar conexões
            <ArrowRight />
          </Link>
        </Button>
      </div>
    </CardIntegracao>
  );
}

// ---------------------------------------------------------------------------

const VARIAVEIS_GATEWAY = [
  "SERPRO_CONSUMER_KEY",
  "SERPRO_CONSUMER_SECRET",
  "SERPRO_CONTRATANTE_CNPJ",
  "SERPRO_CERT_BASE64",
  "SERPRO_CERT_PASSWORD",
];

function CardSerpro() {
  const q = useSerproStatus();
  const testar = useTestarLoginSerpro();
  const d = q.data;
  const { estado, detalhe } = q.isLoading ? { estado: "carregando" as Estado, detalhe: "" } : estadoSerpro(d, q.error);

  async function testarLogin() {
    try {
      const r = await testar.mutateAsync();
      if (r.ok) toast.success(r.mensagem ?? "Login no Serpro OK.");
      else toast.error(r.error ?? "Login no Serpro falhou.");
    } catch (err) {
      toast.error(msgErro(err));
    }
  }

  return (
    <CardIntegracao
      titulo="Serpro (Integra Contador)"
      estado={estado}
      rotulo={estado === "ok" ? "Pronto" : detalhe || undefined}
      verificadoEm={q.dataUpdatedAt || q.errorUpdatedAt || undefined}
      onVerificar={() => void q.refetch()}
      verificando={q.isFetching}
      className="xl:col-span-2"
    >
      {q.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : q.error ? (
        <p className="text-sm text-destructive">A função serpro não respondeu: {msgErro(q.error)}</p>
      ) : d ? (
        <>
          {d.mensagem && <p className="text-sm text-muted-foreground">{d.mensagem}</p>}
          <dl className="divide-y divide-divider">
            <Linha rotulo="Gateway">{d.gatewayAlcancavel === false ? "Inalcançável" : "Respondendo"}</Linha>
            <Linha rotulo="Chamadas ao Serpro">{d.pausado ? "Pausadas no gateway" : "Liberadas"}</Linha>
            {d.contratante && <Linha rotulo="Contratante">{d.contratante}</Linha>}
            {d.certificado && (
              <Linha rotulo="Certificado A1">
                {d.certificado.ok ? (
                  <>
                    {d.certificado.titular ?? "Titular não informado"}
                    {d.certificado.validade && (
                      <span className="block text-xs text-muted-foreground">
                        Válido até {formatData(d.certificado.validade)}
                        {d.certificado.diasParaVencer != null && ` (${d.certificado.diasParaVencer} dias)`}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-destructive">{d.certificado.erro}</span>
                )}
              </Linha>
            )}
            <Linha rotulo="Confirmação por PIN">{d.pinConfirmacao ? "Ativa" : "Não configurada"}</Linha>
          </dl>
          {Array.isArray(d.faltando) && d.faltando.length > 0 && (
            <div className="rounded-md bg-muted px-3 py-2 text-xs space-y-1">
              <p className="text-muted-foreground">Falta:</p>
              <ul className="list-disc pl-5">
                {d.faltando.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}
          {Array.isArray(d.avisos) && d.avisos.length > 0 && (
            <ul className="text-xs text-warning list-disc pl-5">
              {d.avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
        </>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => void testarLogin()} disabled={testar.isPending || !!q.error}>
          {testar.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
          Testar login
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to="/pendencias-fiscais">
            Pendências fiscais
            <ArrowRight />
          </Link>
        </Button>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-primary text-xs">Como configurar no Easypanel</summary>
        <ol className="mt-3 list-decimal pl-5 space-y-1.5 text-xs text-muted-foreground">
          <li>
            Abra o Easypanel, projeto <span className="font-mono text-foreground">painel</span>, serviço{" "}
            <span className="font-mono text-foreground">integra-contador</span>, aba Environment.
          </li>
          <li>
            Preencha:{" "}
            {VARIAVEIS_GATEWAY.map((v, i) => (
              <span key={v}>
                <span className="font-mono text-foreground">{v}</span>
                {i < VARIAVEIS_GATEWAY.length - 1 ? ", " : "."}
              </span>
            ))}{" "}
            O certificado é o A1 (.pfx) do CNPJ do escritório convertido em base64.
          </li>
          <li>Salve e clique em Deploy. Depois volte aqui, clique em Verificar e em Testar login.</li>
          <li>
            Cada cliente precisa ter dado procuração eletrônica ao escritório no e-CAC; sem ela a consulta daquele
            cliente volta recusada.
          </li>
        </ol>
      </details>
    </CardIntegracao>
  );
}

// ---------------------------------------------------------------------------

function CardCrons() {
  const q = usePainelSaude();
  const crons = q.data?.crons ?? [];
  const falhas = crons.filter((c) => c.status === "failed" || c.falhas24h > 0).length;
  const estado: Estado = q.isLoading ? "carregando" : q.error ? "erro" : falhas > 0 ? "atencao" : "ok";
  return (
    <CardIntegracao
      titulo="Tarefas agendadas"
      estado={estado}
      verificadoEm={q.dataUpdatedAt || q.errorUpdatedAt || undefined}
      onVerificar={() => void q.refetch()}
      verificando={q.isFetching}
    >
      {q.isLoading ? (
        <Skeleton className="h-28 w-full" />
      ) : q.error ? (
        <p className="text-sm text-destructive">{msgErro(q.error)}</p>
      ) : crons.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma tarefa agendada no banco.</p>
      ) : (
        <ul className="divide-y divide-divider">
          {crons.map((c) => {
            const e: Estado = !c.ativo ? "atencao" : c.status === "failed" ? "erro" : c.status ? "ok" : "carregando";
            const rotulo = !c.ativo ? "Desativada" : c.status === "failed" ? "Falhou" : c.status ? "OK" : "Ainda não rodou";
            return (
              <li key={c.nome} className="py-3 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 text-sm font-semibold truncate">{c.nome}</span>
                  <EstadoBadge estado={e} rotulo={rotulo} />
                </div>
                <p className="text-xs text-muted-foreground">{CRON_DESCRICAO[c.nome] ?? "Tarefa do banco"}</p>
                <p className="text-xs text-muted-foreground">
                  {agendaEmPortugues(c.agenda)}
                  {c.ultimaExecucao ? ` · última vez ${formatDataHora(c.ultimaExecucao)}` : ""}
                  {c.falhas24h > 0 ? ` · ${c.falhas24h} falha(s) em 24h` : ""}
                </p>
                {c.status === "failed" && c.mensagem && (
                  <p className="text-xs text-destructive font-mono break-words">{c.mensagem}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-2xs text-muted-foreground">
        O status diz se o banco disparou a tarefa. O que a função respondeu aparece no log de erros (Sistema).
      </p>
    </CardIntegracao>
  );
}
