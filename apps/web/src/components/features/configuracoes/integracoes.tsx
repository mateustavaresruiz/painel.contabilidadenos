import { ArrowRight, ExternalLink, Loader2, Mail, RefreshCw, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { EstadoBadge } from "@/components/features/configuracoes/estado-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { msgErro } from "@/lib/erro";
import { formatData, formatDataHora } from "@/lib/format";
import { useLoginConfig } from "@/lib/login-google";
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
import { useEmailStatus, useTestarEmail, type EmailStatus } from "@/lib/queries/equipe";
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
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <CardBanco />
      <CardEmail />
      <CardGoogle />
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
      <CardContent className="p-4 sm:p-6 space-y-4">
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
      <dt className="shrink-0 text-muted-foreground">{rotulo}</dt>
      <dd className="text-right min-w-0 [overflow-wrap:anywhere]">{children}</dd>
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
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
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

/** Painel do servidor de e-mail próprio (Stalwart, app "email" no Easypanel). */
const STALWART_ADMIN = "https://painel-email.at63vf.easypanel.host";
/** Onde a conta do Google Workspace gera a senha de app (precisa da verificação em 2 etapas). */
const GOOGLE_SENHAS_DE_APP = "https://myaccount.google.com/apppasswords";

const PROVEDOR_EMAIL: Record<NonNullable<EmailStatus["provedor"]>, string> = {
  google: "Google Workspace (Gmail)",
  "google-relay": "Google Workspace (relay SMTP)",
  stalwart: "Servidor próprio (Stalwart)",
  outro: "Outro servidor",
};

function CardEmail() {
  const q = useEmailStatus();
  const testar = useTestarEmail();
  const d = q.data;
  const avisos = d?.avisos ?? [];
  const estado: Estado = q.isLoading
    ? "carregando"
    : q.error
      ? "erro"
      : !d?.configurado
        ? "atencao"
        : d.portaAbre === false
          ? "erro"
          : avisos.length > 0 || d.tls === false || d.erroConexao
            ? "atencao"
            : "ok";
  const rotulo = !q.isLoading && !q.error && !d?.configurado ? "Não configurado" : undefined;
  return (
    <CardIntegracao
      titulo="E-mail (login)"
      estado={estado}
      rotulo={rotulo}
      verificadoEm={q.dataUpdatedAt || q.errorUpdatedAt || undefined}
      onVerificar={() => void q.refetch()}
      verificando={q.isFetching}
    >
      {q.isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : q.error ? (
        <p className="text-sm text-destructive">A função equipe não respondeu: {msgErro(q.error)}</p>
      ) : d ? (
        <dl className="divide-y divide-divider">
          <Linha rotulo="SMTP">
            {d.configurado ? (
              <>
                {d.host}:{d.porta}
                {d.provedor && <span className="block text-xs text-muted-foreground">{PROVEDOR_EMAIL[d.provedor]}</span>}
              </>
            ) : (
              "Sem servidor (SMTP_HOST vazio)"
            )}
          </Linha>
          {d.configurado && (
            <Linha rotulo="Servidor responde">
              {d.portaAbre ? (d.erroConexao ? `Abre, mas: ${d.erroConexao}` : "Sim") : (d.erroConexao ?? "Não: a porta não abriu")}
            </Linha>
          )}
          {d.configurado && d.portaAbre && (
            <Linha rotulo="Criptografia">
              {d.tls == null ? "Não verificada" : d.tls ? (d.porta === 465 ? "TLS direto (465)" : "STARTTLS oferecido") : "Sem TLS: use a porta 587"}
            </Linha>
          )}
          <Linha rotulo="Usuário do SMTP">{d.usuarioConfigurado ? "Configurado" : "Não configurado"}</Linha>
          {d.senhaDefinida != null && (
            <Linha rotulo="Senha do SMTP">{d.senhaDefinida ? "Preenchida" : "Vazia"}</Linha>
          )}
          <Linha rotulo="Remetente">{d.remetente ? `${d.nomeRemetente ?? ""} <${d.remetente}>` : "Não definido"}</Linha>
          {d.provedor === "stalwart" && (
            <Linha rotulo="Rede interna (painel_email)">{d.redeInterna.painel_email ? "Alcançável" : "Não alcançável"}</Linha>
          )}
        </dl>
      ) : null}
      {avisos.length > 0 && (
        <ul className="rounded-md bg-muted px-3 py-2 text-xs text-warning list-disc pl-7 space-y-1">
          {avisos.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      {d && !d.configurado && (
        <p className="text-sm text-muted-foreground">
          Recomendado: mandar pelo <strong className="text-foreground">Google Workspace</strong> que o escritório já usa
          (passos abaixo). Enquanto isso, o login continua possível: em Equipe, "Gerar link de acesso" para cada pessoa.
        </p>
      )}
      <details className="text-sm" open={!!d && !d.configurado}>
        <summary className="cursor-pointer text-primary text-xs">Como configurar pelo Google Workspace (recomendado)</summary>
        <ol className="mt-3 list-decimal pl-5 space-y-1.5 text-xs text-muted-foreground">
          <li>
            Crie (ou escolha) uma conta do Workspace só para o painel, ex.: <Codigo>painel@contabilidadenos.com.br</Codigo>.
            Pode ser um usuário comum; não precisa de caixa de entrada vigiada.
          </li>
          <li>
            Nessa conta, ligue a verificação em 2 etapas e gere uma <strong className="text-foreground">senha de app</strong>{" "}
            (Conta Google &gt; Segurança &gt; Senhas de app, nome "Painel Denos"). São 16 letras; guarde sem os espaços.
          </li>
          <li>
            No Easypanel, projeto <Codigo>painel</Codigo>, serviço <Codigo>supabase</Codigo>, Ambiente:{" "}
            <Codigo>SMTP_HOST=smtp.gmail.com</Codigo>, <Codigo>SMTP_PORT=587</Codigo>,{" "}
            <Codigo>SMTP_USER</Codigo> e <Codigo>SMTP_ADMIN_EMAIL</Codigo> = a conta (o mesmo endereço),{" "}
            <Codigo>SMTP_PASS</Codigo> = a senha de app. Salve e reimplante.
          </li>
          <li>Volte aqui, clique em Verificar e em "Enviar e-mail de teste" (vai para o seu e-mail).</li>
          <li>
            Funcionou? Em Configurações &gt; Módulos, desligue "Entrar só com o e-mail".
          </li>
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">
          Alternativa sem senha de app: o relay do Workspace (<Codigo>smtp-relay.gmail.com</Codigo>, porta 587), liberado
          pelo administrador no Admin Console (Gmail &gt; Roteamento &gt; Serviço de redirecionamento SMTP) para o IP{" "}
          <Codigo>187.127.26.230</Codigo>, com <Codigo>SMTP_USER</Codigo> e <Codigo>SMTP_PASS</Codigo> vazios. Detalhes em
          docs/LOGIN.md.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          O servidor próprio (Stalwart, app <Codigo>email</Codigo> no Easypanel) deixa de ser necessário e pode ser removido
          depois que o Google estiver enviando.
        </p>
      </details>
      <div className="flex flex-wrap gap-2">
        {d?.configurado && (
          <Button
            size="sm"
            variant="outline"
            disabled={testar.isPending}
            onClick={() =>
              testar.mutate(undefined, {
                onSuccess: (r) => toast.success(`E-mail de teste enviado para ${r.para}. Confira a caixa de entrada.`),
                onError: (e) => toast.error(msgErro(e)),
              })
            }
          >
            {testar.isPending ? <Loader2 className="animate-spin" /> : <Mail />}
            Enviar e-mail de teste
          </Button>
        )}
        {(!d?.configurado || d.provedor === "google") && (
          <Button asChild size="sm" variant="secondary">
            <a href={GOOGLE_SENHAS_DE_APP} target="_blank" rel="noreferrer">
              <ExternalLink />
              Senhas de app do Google
            </a>
          </Button>
        )}
        {d?.provedor === "stalwart" && (
          <Button asChild size="sm" variant="secondary">
            <a href={STALWART_ADMIN} target="_blank" rel="noreferrer">
              <ExternalLink />
              Abrir o Stalwart
            </a>
          </Button>
        )}
      </div>
    </CardIntegracao>
  );
}

// ---------------------------------------------------------------------------

/** Endereços que o OAuth client do Google precisa ter (mudam com o domínio próprio). */
const GOOGLE_ORIGEM = "https://painel-web.at63vf.easypanel.host";
const GOOGLE_REDIRECT = "https://painel-supabase.at63vf.easypanel.host/auth/v1/callback";

function Codigo({ children }: { children: ReactNode }) {
  return <span className="font-mono text-foreground [overflow-wrap:anywhere]">{children}</span>;
}

/** "Entrar com Google": o estado vem do próprio Auth (function entrar, /entrar/config). */
function CardGoogle() {
  const q = useLoginConfig();
  const ligado = q.data?.google === true;
  const estado: Estado = q.isLoading ? "carregando" : q.error ? "erro" : ligado ? "ok" : "atencao";
  return (
    <CardIntegracao
      titulo="Login com Google"
      estado={estado}
      rotulo={q.isLoading || q.error ? undefined : ligado ? "Configurado" : "Não configurado"}
      verificadoEm={q.dataUpdatedAt || q.errorUpdatedAt || undefined}
      onVerificar={() => void q.refetch()}
      verificando={q.isFetching}
    >
      {q.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : q.error ? (
        <p className="text-sm text-destructive">A função entrar não respondeu: {msgErro(q.error)}</p>
      ) : ligado ? (
        <p className="text-sm text-muted-foreground">
          O botão "Entrar com Google" aparece na tela de entrada. Só entra quem está cadastrado em Equipe, com o
          mesmo e-mail da conta Google; desativar a pessoa bloqueia também o Google.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Desligado: o botão não aparece. Falta criar o acesso OAuth no Google Cloud e colocar as credenciais no
          servidor (passos abaixo).
        </p>
      )}
      <details className="text-sm" open={!q.isLoading && !ligado}>
        <summary className="cursor-pointer text-primary text-xs">Como configurar</summary>
        <ol className="mt-3 list-decimal pl-5 space-y-1.5 text-xs text-muted-foreground">
          <li>
            Entre em <Codigo>console.cloud.google.com</Codigo> com a conta Google do escritório e crie um projeto (ou
            use o mesmo do backup).
          </li>
          <li>
            APIs e serviços &gt; Tela de consentimento OAuth: tipo <Codigo>Externo</Codigo>, nome "Painel Denos",
            e-mail de suporte do escritório, só os escopos básicos (<Codigo>email</Codigo>, <Codigo>profile</Codigo>,{" "}
            <Codigo>openid</Codigo>). Publique o app ("Em produção"): com só esses escopos o Google não pede
            verificação. "Interno" só serve se todos da equipe tiverem conta no Workspace do escritório.
          </li>
          <li>
            Credenciais &gt; Criar credenciais &gt; ID do cliente OAuth &gt; Aplicativo da Web. Origem JavaScript
            autorizada: <Codigo>{GOOGLE_ORIGEM}</Codigo>. URI de redirecionamento autorizado:{" "}
            <Codigo>{GOOGLE_REDIRECT}</Codigo>.
          </li>
          <li>Copie o ID do cliente e a chave secreta e passe para quem cuida do painel (nunca por grupo).</li>
          <li>
            No Easypanel, projeto <Codigo>painel</Codigo>, serviço <Codigo>supabase</Codigo>, Ambiente: preencher{" "}
            <Codigo>GOOGLE_CLIENT_ID</Codigo>, <Codigo>GOOGLE_SECRET</Codigo> e <Codigo>GOOGLE_ENABLED=true</Codigo>, e
            reimplantar. Depois clique em Verificar aqui.
          </li>
          <li>Quando o painel ganhar o domínio próprio, troque os dois endereços acima no Google Cloud.</li>
        </ol>
      </details>
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
  const falhas = crons.filter((c) => c.status === "failed" || c.falhas24h > 0 || (c.httpFalhas24h ?? 0) > 0).length;
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
            const httpRuim = c.httpFalhou === true;
            const e: Estado = !c.ativo ? "atencao" : c.status === "failed" || httpRuim ? "erro" : c.status ? "ok" : "carregando";
            const rotulo = !c.ativo ? "Desativada" : c.status === "failed" ? "Falhou" : httpRuim ? "Função com erro" : c.status ? "OK" : "Ainda não rodou";
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
                  {c.httpStatus != null ? ` · função respondeu HTTP ${c.httpStatus}` : ""}
                  {(c.httpFalhas24h ?? 0) > 0 ? ` · ${c.httpFalhas24h} resposta(s) com erro em 24h` : ""}
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
        O status diz se o banco disparou a tarefa; "função respondeu" é o último HTTP que ela devolveu. Respostas com erro entram no log de erros (Sistema).
      </p>
    </CardIntegracao>
  );
}
