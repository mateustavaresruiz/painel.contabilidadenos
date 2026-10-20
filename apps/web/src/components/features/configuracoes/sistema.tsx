import { DatabaseBackup, ExternalLink, RefreshCw, ScrollText } from "lucide-react";

import { BackupDriveCard } from "@/components/features/configuracoes/backup-drive";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { msgErro } from "@/lib/erro";
import { formatBytes, formatDataHora, parsePgTimestamp } from "@/lib/format";
import {
  BACKUP_LIMITE_HORAS,
  useBackupStatus,
  useErrosRecentes,
  type BackupExecucao,
  type BackupStatus,
  type BackupTipo,
} from "@/lib/queries/saude";
import { SUPABASE_URL } from "@/lib/supabase";
import { cn } from "@/lib/utils";

const LINKS = [
  {
    nome: "Supabase Studio",
    url: "https://painel-supabase.at63vf.easypanel.host",
    texto: "Banco, tabelas, storage e SQL. Tem senha própria.",
  },
  {
    nome: "Painel do WAHA",
    url: "https://painel-waha.at63vf.easypanel.host/dashboard",
    texto: "Sessões do WhatsApp direto no servidor.",
  },
  {
    nome: "Easypanel",
    url: "http://187.127.26.230:3000",
    texto: "Serviços, variáveis de ambiente e deploy.",
  },
];

export function ConfigSistema() {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 sm:p-6 space-y-4">
          <h2 className="text-title-md">Versão</h2>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Commit publicado</dt>
              <dd className="font-mono">{__APP_COMMIT__}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Build</dt>
              <dd>{__APP_BUILD_EM__ ? formatDataHora(__APP_BUILD_EM__) : "desconhecido"}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Supabase</dt>
              <dd className="font-mono text-xs truncate">{SUPABASE_URL}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <BackupCard />

      <BackupDriveCard />

      <Card>
        <CardContent className="p-4 sm:p-6 space-y-3">
          <h2 className="text-title-md">Ferramentas</h2>
          <ul className="divide-y divide-divider">
            {LINKS.map((l) => (
              <li key={l.nome}>
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-3 py-3 hover:text-primary"
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold">{l.nome}</span>
                    <span className="block text-xs text-muted-foreground">{l.texto}</span>
                    <span className="block text-2xs text-muted-foreground font-mono truncate">{l.url}</span>
                  </span>
                  <ExternalLink className="size-4 text-muted-foreground group-hover:text-primary" />
                </a>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <ErrosRecentes />
    </div>
  );
}

function ErrosRecentes() {
  const { data = [], isLoading, error, refetch, isFetching } = useErrosRecentes();
  return (
    <Card>
      <CardContent className="p-4 sm:p-6 space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <h2 className="text-title-md">Log de erros</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Os 50 mais recentes das funções do servidor e das tarefas agendadas. Só leitura.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={cn(isFetching && "animate-spin")} />
            Atualizar
          </Button>
        </div>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">Não foi possível ler o log: {msgErro(error)}</p>
        ) : data.length === 0 ? (
          <EmptyState
            variant="plain"
            icon={ScrollText}
            title="Nenhum erro registrado"
            description="Quando uma função falhar, o erro aparece aqui com a rota e o horário."
          />
        ) : (
          <ul className="divide-y divide-divider">
            {data.map((e) => (
              <li key={e.id} className="py-3">
                <details>
                  <summary className="cursor-pointer list-none flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant={e.nivel === "error" ? "destructive" : "warning"}>
                      {e.nivel === "error" ? "erro" : "aviso"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{formatDataHora(e.criadoEm)}</span>
                    <span className="text-xs font-mono text-muted-foreground">
                      {e.origem}
                      {e.rota ? ` ${e.rota}` : ""}
                      {e.status ? ` · ${e.status}` : ""}
                    </span>
                    <span className="basis-full break-words">{e.mensagem}</span>
                  </summary>
                  <div className="mt-2 space-y-2">
                    {e.stack && (
                      <pre className="text-2xs bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap">{e.stack}</pre>
                    )}
                    {e.contexto && Object.keys(e.contexto).length > 0 && (
                      <pre className="text-2xs bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
                        {JSON.stringify(e.contexto, null, 2)}
                      </pre>
                    )}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const BACKUP_ETAPAS: { tipo: BackupTipo; nome: string; texto: string }[] = [
  { tipo: "db", nome: "Banco de dados", texto: "Todas as tabelas, logins e configurações do Supabase." },
  {
    tipo: "volumes",
    nome: "Arquivos",
    texto: "Anexos do WhatsApp, marca, sessões do WAHA, gateway Serpro, e-mail e blog.",
  },
  { tipo: "offsite", nome: "Cópia completa fora do servidor", texto: "Repositório restic em R2/B2, se ligado no Easypanel." },
  { tipo: "restore-test", nome: "Teste de restauração", texto: "Último teste restaurando o banco num servidor descartável." },
];

function horasDesde(iso: string | null | undefined, agora: Date): number | null {
  const d = parsePgTimestamp(iso);
  return d ? (agora.getTime() - d.getTime()) / 3_600_000 : null;
}

function textoHoras(h: number): string {
  if (h < 1) return "há menos de 1 h";
  if (h < 48) return `há ${Math.floor(h)} h`;
  return `há ${Math.floor(h / 24)} dias`;
}

/** Banco ou arquivos sem sucesso dentro do limite = backup atrasado. */
function backupAtrasado(s: BackupStatus | undefined): { atrasado: boolean; horas: number | null } {
  if (!s) return { atrasado: false, horas: null };
  const agora = parsePgTimestamp(s.agora) ?? new Date();
  const hs = (["db", "volumes"] as const).map((t) => horasDesde(s.ultimoSucesso[t], agora));
  if (hs.some((h) => h == null)) return { atrasado: true, horas: null };
  const pior = Math.max(...(hs as number[]));
  return { atrasado: pior > BACKUP_LIMITE_HORAS, horas: pior };
}

function BackupCard() {
  const { data, isLoading, error, refetch, isFetching } = useBackupStatus();
  const agora = parsePgTimestamp(data?.agora) ?? new Date();
  const { atrasado, horas } = backupAtrasado(data);

  return (
    <Card>
      <CardContent className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <h2 className="text-title-md">Backup</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Todo dia às 03:00, cifrado. Guarda 7 dias, 4 semanas e 6 meses.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={cn(isFetching && "animate-spin")} />
            Atualizar
          </Button>
        </div>

        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : error ? (
          <p className="text-sm text-destructive">Não foi possível ler o status do backup: {msgErro(error)}</p>
        ) : (
          <>
            {atrasado && (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              >
                {horas == null
                  ? "Ainda não há backup completo bem-sucedido (banco e arquivos)."
                  : `O último backup completo bem-sucedido foi ${textoHoras(horas)}, mais de ${BACKUP_LIMITE_HORAS} h. Confira o serviço "backup" no Easypanel.`}
              </div>
            )}
            <ul className="divide-y divide-divider">
              {BACKUP_ETAPAS.map((e) => (
                <BackupLinha
                  key={e.tipo}
                  nome={e.nome}
                  texto={e.texto}
                  tipo={e.tipo}
                  ultimo={data?.ultimos[e.tipo]}
                  ultimoSucesso={data?.ultimoSucesso[e.tipo]}
                  agora={agora}
                />
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function BackupLinha({
  nome,
  texto,
  tipo,
  ultimo,
  ultimoSucesso,
  agora,
}: {
  nome: string;
  texto: string;
  tipo: BackupTipo;
  ultimo: BackupExecucao | undefined;
  ultimoSucesso: string | undefined;
  agora: Date;
}) {
  const h = horasDesde(ultimo?.fim ?? ultimo?.inicio, agora);
  // A cópia remota só roda com OFFSITE_ENABLED=true; sem linha recente = desligada.
  const offsiteDesligado = tipo === "offsite" && (h == null || h > BACKUP_LIMITE_HORAS);
  const hSucesso = horasDesde(ultimoSucesso, agora);
  const velho = tipo !== "restore-test" && tipo !== "offsite" && (hSucesso == null || hSucesso > BACKUP_LIMITE_HORAS);

  let badge: { v: "success" | "destructive" | "secondary"; t: string };
  if (offsiteDesligado) badge = { v: "secondary", t: "desligado" };
  else if (!ultimo) badge = { v: "destructive", t: "nunca rodou" };
  else if (!ultimo.ok) badge = { v: "destructive", t: "falhou" };
  else badge = { v: velho ? "destructive" : "success", t: velho ? "atrasado" : "ok" };

  return (
    <li className="flex items-start gap-3 py-3">
      <DatabaseBackup className="size-4 mt-0.5 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{nome}</span>
          <Badge variant={badge.v}>{badge.t}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">{texto}</p>
        {ultimo && !offsiteDesligado && (
          <p className={cn("text-xs mt-1", velho || !ultimo.ok ? "text-destructive" : "text-muted-foreground")}>
            {formatDataHora(ultimo.fim ?? ultimo.inicio)}
            {h != null ? ` (${textoHoras(h)})` : ""}
            {ultimo.tamanhoBytes != null ? ` · ${formatBytes(ultimo.tamanhoBytes)}` : ""}
            {ultimo.destino ? ` · ${ultimo.destino}` : ""}
          </p>
        )}
        {ultimo && !ultimo.ok && ultimo.erro && (
          <p className="text-xs text-destructive break-words mt-1">{ultimo.erro}</p>
        )}
        {ultimo && !ultimo.ok && ultimoSucesso && (
          <p className="text-xs text-muted-foreground mt-1">Último sucesso: {formatDataHora(ultimoSucesso)}</p>
        )}
      </div>
    </li>
  );
}
