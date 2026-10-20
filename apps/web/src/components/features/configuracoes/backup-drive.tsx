import { Check, Cloud, Copy, ExternalLink, Loader2, RefreshCw, Unplug } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { confirmar } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { msgErro } from "@/lib/erro";
import { formatBytes, formatDataHora, parsePgTimestamp } from "@/lib/format";
import {
  BACKUP_LIMITE_HORAS,
  useBackupStatus,
  useConectarDrive,
  useDesconectarDrive,
  useDriveArquivos,
  useSalvarDriveCliente,
  type BackupDrive,
  type BackupExecucao,
} from "@/lib/queries/saude";
import { SUPABASE_URL } from "@/lib/supabase";
import { plural } from "@/lib/texto";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** Para onde o Google devolve depois da autorização (function google-drive). */
const DRIVE_REDIRECT = `${SUPABASE_URL}/functions/v1/google-drive/callback`;
const GOOGLE_CREDENCIAIS = "https://console.cloud.google.com/apis/credentials";
const GOOGLE_DRIVE_API = "https://console.cloud.google.com/apis/library/drive.googleapis.com";

/**
 * Cópia diária no Google Drive do escritório (migração 020, docs/BACKUP.md).
 * Três estados: falta o OAuth do Google Cloud → falta conectar → conectado.
 */
export function BackupDriveCard() {
  const { data, isLoading, error, refetch, isFetching } = useBackupStatus();
  const drive = data?.drive ?? null;
  useRetornoDoGoogle();

  return (
    <Card>
      <CardContent className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Cloud className="size-5 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <h2 className="text-title-md">Cópia diária no Google Drive</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Depois do backup das 03:00, um arquivo cifrado com o banco do dia vai para uma pasta do Drive. Ficam os
              últimos {drive?.manter ?? 30}; o mais antigo é apagado.
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
          <p className="text-sm text-destructive">Não foi possível ler o status: {msgErro(error)}</p>
        ) : !drive ? (
          <p className="text-sm text-muted-foreground">
            O banco ainda não tem a migração do backup no Drive (020). Fale com quem mantém o painel.
          </p>
        ) : drive.conectado ? (
          <DriveConectado drive={drive} ultimo={data?.ultimos.drive} ultimoSucesso={data?.ultimoSucesso.drive} agora={data?.agora} />
        ) : drive.clienteConfigurado ? (
          <DriveParaConectar drive={drive} />
        ) : (
          <DriveCredenciais />
        )}
      </CardContent>
    </Card>
  );
}

/** Códigos da volta do Google (function google-drive). Só códigos: texto da URL nunca vira aviso. */
const MSG_VOLTA: Record<string, string> = {
  negado: "Acesso negado na tela do Google.",
  incompleto: "A resposta do Google veio incompleta. Tente de novo.",
  expirou: "O link de conexão expirou. Clique em Conectar de novo.",
  sem_cliente: "Falta o Client ID/Secret do Google.",
  codigo_recusado: "O Google recusou a conexão. Confira o Client ID/Secret e o endereço de retorno no Google Cloud.",
  sem_escopo: "Marque a permissão do Google Drive na tela do Google e tente de novo.",
  sem_refresh:
    "O Google não liberou o acesso contínuo. Remova o app em myaccount.google.com/permissions e conecte de novo.",
  interno: "Erro interno ao concluir a conexão. Veja o Log de erros.",
};

/** A volta do Google cai em ?tab=sistema&drive=<código>: avisa e limpa a URL. */
function useRetornoDoGoogle() {
  const [params, setParams] = useSearchParams();
  const codigo = params.get("drive");
  useEffect(() => {
    if (!codigo) return;
    if (codigo === "ok") toast.success("Google Drive conectado");
    else toast.error(MSG_VOLTA[codigo] ?? "Não foi possível conectar o Google Drive");
    const p = new URLSearchParams(params);
    p.delete("drive");
    p.delete("msg");
    setParams(p, { replace: true });
  }, [codigo, params, setParams]);
}

function horasDesde(iso: string | null | undefined, agora: Date): number | null {
  const d = parsePgTimestamp(iso);
  return d ? (agora.getTime() - d.getTime()) / 3_600_000 : null;
}

function DriveConectado({
  drive,
  ultimo,
  ultimoSucesso,
  agora: agoraIso,
}: {
  drive: BackupDrive;
  ultimo: BackupExecucao | undefined;
  ultimoSucesso: string | undefined;
  agora: string | undefined;
}) {
  const conectar = useConectarDrive();
  const desconectar = useDesconectarDrive();
  const [verArquivos, setVerArquivos] = useState(false);
  const arquivos = useDriveArquivos(verArquivos);
  const agora = parsePgTimestamp(agoraIso) ?? new Date();
  const conectadoEm = parsePgTimestamp(drive.conectadoEm);
  // Último envio feito DEPOIS desta conexão (antes disso era outra conta).
  const envio = ultimo && conectadoEm && (parsePgTimestamp(ultimo.inicio)?.getTime() ?? 0) < conectadoEm.getTime() ? undefined : ultimo;
  const hSucesso = horasDesde(ultimoSucesso, agora);
  const hConexao = horasDesde(drive.conectadoEm, agora) ?? 0;
  const atrasado = hConexao > BACKUP_LIMITE_HORAS && (hSucesso == null || hSucesso > BACKUP_LIMITE_HORAS);
  const reconectar = envio && !envio.ok && envio.detalhe?.precisaReconectar === true;

  let badge: { v: "success" | "destructive" | "secondary" | "warning"; t: string };
  if (!envio) badge = { v: "secondary", t: "aguardando o 1º envio" };
  else if (!envio.ok) badge = { v: "destructive", t: reconectar ? "reconectar" : "falhou" };
  else badge = atrasado ? { v: "destructive", t: "atrasado" } : { v: "success", t: "ok" };

  async function sair() {
    const ok = await confirmar({
      titulo: "Desconectar o Google Drive?",
      descricao:
        "Os backups que já estão na pasta continuam lá, mas nenhum novo será enviado. O backup no servidor continua normalmente.",
      confirmLabel: "Desconectar",
      destructive: true,
    });
    if (!ok) return;
    desconectar.mutate(undefined, {
      onSuccess: () => toast.success("Google Drive desconectado"),
      onError: (e) => toast.error(msgErro(e)),
    });
  }

  return (
    <div className="space-y-4">
      {reconectar && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          O Google não aceita mais o acesso (senha trocada, acesso removido ou pasta apagada). Clique em "Conectar de
          novo" com a mesma conta.
        </div>
      )}
      <dl className="divide-y divide-divider text-sm">
        <Linha rotulo="Conta">{drive.conta ?? "—"}</Linha>
        <Linha rotulo="Pasta">
          {drive.pastaId ? (
            <a
              href={`https://drive.google.com/drive/folders/${drive.pastaId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              {drive.pastaNome ?? "Abrir pasta"}
              <ExternalLink className="size-3.5" />
            </a>
          ) : (
            "—"
          )}
        </Linha>
        <Linha rotulo="Conectado">
          {formatDataHora(drive.conectadoEm)}
          {drive.conectadoPor ? ` por ${drive.conectadoPor}` : ""}
        </Linha>
        <Linha rotulo="Último envio">
          <span className="inline-flex flex-wrap items-center justify-end gap-2">
            <Badge variant={badge.v}>{badge.t}</Badge>
            {envio && (
              <span className={cn(!envio.ok && "text-destructive")}>
                {formatDataHora(envio.fim ?? envio.inicio)}
                {envio.tamanhoBytes != null ? ` · ${formatBytes(envio.tamanhoBytes)}` : ""}
              </span>
            )}
          </span>
        </Linha>
      </dl>
      {!envio && (
        <p className="text-xs text-muted-foreground">O primeiro arquivo chega na próxima madrugada, às 03:00.</p>
      )}
      {envio && !envio.ok && envio.erro && <p className="text-xs text-destructive break-words">{envio.erro}</p>}
      {envio?.ok && envio.detalhe?.semStorage === true && (
        <p className="text-xs text-muted-foreground">
          Os anexos do Storage passaram do limite e ficaram fora do arquivo do Drive (continuam no backup do servidor).
        </p>
      )}

      <details className="text-sm" onToggle={(e) => setVerArquivos((e.target as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer text-primary text-xs">Arquivos na pasta</summary>
        <div className="mt-3">
          {arquivos.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : arquivos.error ? (
            <p className="text-xs text-destructive">{msgErro(arquivos.error)}</p>
          ) : arquivos.data ? (
            <>
              {arquivos.data.arquivos.length === 0 ? (
                <p className="text-xs text-muted-foreground">A pasta ainda está vazia.</p>
              ) : (
                <ul className="divide-y divide-divider text-xs">
                  {arquivos.data.arquivos.map((a) => (
                    <li key={a.id} className="flex justify-between gap-3 py-1.5">
                      <span className="font-mono truncate">{a.nome}</span>
                      <span className="shrink-0 text-muted-foreground nums">
                        {a.tamanhoBytes != null ? formatBytes(a.tamanhoBytes) : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-2xs text-muted-foreground">
                {plural(arquivos.data.arquivos.length, "arquivo", "arquivos")}
                {arquivos.data.espaco?.usadoBytes != null && arquivos.data.espaco.limiteBytes
                  ? ` · Drive com ${formatBytes(arquivos.data.espaco.usadoBytes)} de ${formatBytes(arquivos.data.espaco.limiteBytes)} usados`
                  : ""}
              </p>
            </>
          ) : null}
        </div>
      </details>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => conectar.mutate(undefined, { onError: (e) => toast.error(msgErro(e)) })} disabled={conectar.isPending}>
          {conectar.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Conectar de novo
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void sair()} disabled={desconectar.isPending}>
          {desconectar.isPending ? <Loader2 className="animate-spin" /> : <Unplug />}
          Desconectar
        </Button>
      </div>
      <TrocarCredenciais drive={drive} />
    </div>
  );
}

function DriveParaConectar({ drive }: { drive: BackupDrive }) {
  const conectar = useConectarDrive();
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Clique em conectar e entre com a conta Google do escritório. O Google vai pedir permissão para o painel criar
        a pasta <span className="font-semibold text-foreground">Backup Painel NÓS</span> e guardar arquivos nela. O
        painel só enxerga o que ele mesmo criou: não lê nem apaga mais nada do seu Drive.
      </p>
      <Button onClick={() => conectar.mutate(undefined, { onError: (e) => toast.error(msgErro(e)) })} disabled={conectar.isPending}>
        {conectar.isPending ? <Loader2 className="animate-spin" /> : <Cloud />}
        Conectar Google Drive
      </Button>
      <TrocarCredenciais drive={drive} />
    </div>
  );
}

function TrocarCredenciais({ drive }: { drive: BackupDrive }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-primary text-xs">Acesso OAuth do Google Cloud</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-muted-foreground">
          Client ID atual: <span className="font-mono text-foreground [overflow-wrap:anywhere]">{drive.clientId}</span>.
          Trocar as credenciais desconecta o Drive (é preciso conectar de novo).
        </p>
        <DriveCredenciais conectado={drive.conectado} />
      </div>
    </details>
  );
}

function DriveCredenciais({ conectado = false }: { conectado?: boolean }) {
  const salvar = useSalvarDriveCliente();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  return (
    <div className="space-y-4">
      <ol className="list-decimal pl-5 space-y-1.5 text-xs text-muted-foreground">
        <li>
          Em <Link href={GOOGLE_CREDENCIAIS}>console.cloud.google.com</Link>, com a conta Google do escritório, crie um
          projeto (ou use o mesmo do login com Google) e ative a <Link href={GOOGLE_DRIVE_API}>Google Drive API</Link>.
        </li>
        <li>
          Tela de consentimento OAuth: tipo <Codigo>Externo</Codigo>, nome "Painel NÓS", escopo{" "}
          <Codigo>.../auth/drive.file</Codigo>. Clique em <Codigo>Publicar app</Codigo> ("Em produção"). Com esse
          escopo o Google não exige verificação, e em "Teste" o acesso expira a cada 7 dias.
        </li>
        <li>
          Credenciais &gt; Criar &gt; ID do cliente OAuth &gt; Aplicativo da Web. URI de redirecionamento autorizado:
          <CopiarLinha valor={DRIVE_REDIRECT} />
        </li>
        <li>Cole aqui o ID do cliente e a chave secreta. A chave fica cifrada no banco e não aparece mais na tela.</li>
      </ol>
      <form
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            conectado &&
            !(await confirmar({
              titulo: "Trocar as credenciais do Google?",
              descricao:
                "O Drive conectado será desconectado e será preciso conectar de novo. Os backups que já estão na pasta continuam lá.",
              confirmLabel: "Trocar e desconectar",
              destructive: true,
            }))
          )
            return;
          salvar.mutate(
            { clientId: clientId.trim(), clientSecret: clientSecret.trim() },
            {
              onSuccess: () => {
                setClientId("");
                setClientSecret("");
                toast.success("Credenciais salvas");
              },
              onError: (err) => toast.error(msgErro(err)),
            },
          );
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="drive-client-id">Client ID</Label>
          <Input
            id="drive-client-id"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="0000-xxxx.apps.googleusercontent.com"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="drive-client-secret">Client Secret</Label>
          <Input
            id="drive-client-secret"
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="GOCSPX-..."
            autoComplete="new-password"
            spellCheck={false}
          />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={salvar.isPending || !clientId.trim() || !clientSecret.trim()}>
            {salvar.isPending && <Loader2 className="animate-spin" />}
            Salvar credenciais
          </Button>
        </div>
      </form>
    </div>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="shrink-0 text-muted-foreground">{rotulo}</dt>
      <dd className="text-right min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function Codigo({ children }: { children: ReactNode }) {
  return <span className="font-mono text-foreground [overflow-wrap:anywhere]">{children}</span>;
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
      {children}
    </a>
  );
}

function CopiarLinha({ valor }: { valor: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <span className="mt-1 flex items-center gap-2 rounded-md bg-muted px-2 py-1">
      <span className="flex-1 min-w-0 font-mono text-foreground [overflow-wrap:anywhere]">{valor}</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 shrink-0"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(valor);
            setCopiado(true);
            setTimeout(() => setCopiado(false), 2000);
          } catch {
            toast.error("Não consegui copiar; selecione o texto e copie");
          }
        }}
      >
        {copiado ? <Check /> : <Copy />}
        {copiado ? "Copiado" : "Copiar"}
      </Button>
    </span>
  );
}
