// Aba "Portal" da ficha do cliente: gera e gerencia o link público (com senha)
// que o escritório envia ao cliente. Porta do portal-acesso do adv3, com a
// regra mais dura que o nosso portal pede: link e senha aparecem UMA vez, na
// geração, e depois só existe o hash no banco (nada fica no navegador).

import {
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Link2Off,
  Loader2,
  MessageCircle,
  Phone,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chips } from "@/components/ui/chips";
import { confirmar } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { caminhoDaConversa, localizarConversaDoCliente } from "@/lib/conversa-cliente";
import { msgErro } from "@/lib/erro";
import { formatData, formatDataHora, linkWaMe } from "@/lib/format";
import { useModulos } from "@/lib/modulos";
import {
  mensagemLinkPortal,
  situacaoDoLink,
  useConfigPortal,
  useGerarPortal,
  usePortalDoCliente,
  useRegenerarSenhaPortal,
  useRevogarPortal,
  type PortalLink,
  type SituacaoLink,
  type ValidadePortal,
} from "@/lib/queries/portal";
import { useWhatsappSessoes } from "@/lib/queries/whatsapp";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const VALIDADES: readonly { valor: string; rotulo: string }[] = [
  { valor: "7", rotulo: "7 dias" },
  { valor: "30", rotulo: "30 dias" },
  { valor: "90", rotulo: "90 dias" },
  { valor: "sem", rotulo: "Sem expiração" },
];

const ROTULO_SITUACAO: Record<SituacaoLink, { texto: string; variante: "success" | "warning" | "destructive" | "secondary" }> = {
  ativo: { texto: "Link ativo", variante: "success" },
  expirado: { texto: "Link expirado", variante: "warning" },
  revogado: { texto: "Link revogado", variante: "secondary" },
  bloqueado: { texto: "Bloqueado por tentativas de senha", variante: "destructive" },
  nenhum: { texto: "Sem link", variante: "secondary" },
};

type Credencial = { link: string | null; senha: string; expiresAt: string | null; novoLink: boolean };

export function PortalClienteAba({ clienteId, nome, telefone }: { clienteId: string; nome: string; telefone: string | null }) {
  const { data, isLoading, error } = usePortalDoCliente(clienteId);
  const gerar = useGerarPortal(clienteId);
  const novaSenha = useRegenerarSenhaPortal(clienteId);
  const revogar = useRevogarPortal(clienteId);
  const config = useConfigPortal(clienteId);
  const [validade, setValidade] = useState<string>("30");
  const [cred, setCred] = useState<Credencial | null>(null);

  if (isLoading) return <Skeleton className="h-64 w-full max-w-3xl rounded-card" />;
  if (error || !data) {
    return <p className="text-sm text-destructive">Não foi possível carregar o portal deste cliente: {msgErro(error)}</p>;
  }

  const atual = data.tokens.find((t) => !t.revogadoEm) ?? data.tokens[0];
  const situacao = situacaoDoLink(atual);
  const temLinkVivo = situacao === "ativo" || situacao === "bloqueado";
  const anteriores = data.tokens.filter((t) => t.id !== atual?.id).slice(0, 5);

  async function aoGerar() {
    if (
      temLinkVivo &&
      !(await confirmar({
        titulo: "Gerar um link novo?",
        descricao: "O link atual para de funcionar na hora. Quem estiver com ele precisará do link e da senha novos.",
        confirmLabel: "Gerar novo link",
      }))
    ) {
      return;
    }
    try {
      const dias: ValidadePortal = validade === "sem" ? null : (Number(validade) as 7 | 30 | 90);
      const r = await gerar.mutateAsync(dias);
      setCred({ link: r.link, senha: r.senha, expiresAt: r.expiresAt, novoLink: true });
    } catch (e) {
      toast.error(msgErro(e));
    }
  }

  async function aoNovaSenha() {
    if (
      !(await confirmar({
        titulo: "Gerar uma senha nova?",
        descricao: "A senha atual deixa de funcionar agora. O link continua o mesmo.",
        confirmLabel: "Gerar nova senha",
      }))
    ) {
      return;
    }
    try {
      const r = await novaSenha.mutateAsync();
      setCred({ link: null, senha: r.senha, expiresAt: atual?.expiresAt ?? null, novoLink: false });
    } catch (e) {
      toast.error(msgErro(e));
    }
  }

  async function aoRevogar() {
    if (
      !(await confirmar({
        titulo: "Revogar o acesso?",
        descricao: "O cliente perde o acesso ao portal imediatamente. Você pode gerar um link novo depois.",
        confirmLabel: "Revogar",
        destructive: true,
      }))
    ) {
      return;
    }
    try {
      await revogar.mutateAsync();
    } catch (e) {
      toast.error(msgErro(e));
    }
  }

  const rot = ROTULO_SITUACAO[situacao];

  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-sm text-muted-foreground">
        O portal é um endereço privado, com senha, onde o cliente vê os chamados, os certificados digitais e pede coisas à equipe. Você envia o link e a senha por
        mensagens separadas.
      </p>

      <section className="rounded-card border bg-card p-4 shadow-card sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <ShieldCheck className="size-5 text-primary" aria-hidden />
          <h3 className="text-base font-semibold">Acesso do cliente</h3>
          <Badge variant={rot.variante}>{rot.texto}</Badge>
        </div>

        {atual && situacao !== "nenhum" ? <Detalhes link={atual} situacao={situacao} /> : (
          <p className="mt-3 text-sm text-muted-foreground">Nenhum link gerado ainda. Escolha por quanto tempo ele vale e gere o primeiro.</p>
        )}

        <div className="mt-4 space-y-3 border-t pt-4">
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">{temLinkVivo ? "Validade do próximo link" : "Validade do link"}</p>
            <Chips opcoes={VALIDADES} valor={validade} onChange={setValidade} rotulo="Validade do link" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={aoGerar} loading={gerar.isPending}>
              {temLinkVivo ? <RefreshCw /> : <KeyRound />}
              {temLinkVivo ? "Gerar novo link" : "Gerar link"}
            </Button>
            {temLinkVivo && (
              <Button variant="outline" onClick={aoNovaSenha} loading={novaSenha.isPending}>
                <KeyRound />
                Regenerar senha
              </Button>
            )}
            {temLinkVivo && (
              <Button variant="destructive" onClick={aoRevogar} loading={revogar.isPending}>
                <Link2Off />
                Revogar
              </Button>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-card border bg-card p-4 shadow-card sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold">Mostrar situação fiscal no portal</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              O cliente vê só se a última consulta ao Serpro deu &ldquo;regular&rdquo; ou &ldquo;com pendência&rdquo;, sem detalhes. Fica desligado até você ligar.
            </p>
          </div>
          <Switch
            checked={data.mostrarSituacaoFiscal}
            disabled={config.isPending}
            onCheckedChange={(v) => config.mutate(v, { onError: (e) => toast.error(msgErro(e)) })}
            aria-label="Mostrar situação fiscal no portal"
          />
        </div>
      </section>

      {anteriores.length > 0 && (
        <section className="rounded-card border bg-card p-4 sm:p-5">
          <h3 className="text-sm font-semibold">Links anteriores</h3>
          <ul className="mt-2 divide-y text-sm">
            {anteriores.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 py-2 text-muted-foreground">
                <span>Criado em {formatData(t.criadoEm)}</span>
                <span>
                  {t.revogadoEm ? `revogado em ${formatData(t.revogadoEm)}` : "expirado"} · {t.acessos} {t.acessos === 1 ? "acesso" : "acessos"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <CredencialDialog cred={cred} onClose={() => setCred(null)} clienteId={clienteId} nome={nome} telefone={telefone} />
    </div>
  );
}

function Detalhes({ link, situacao }: { link: PortalLink; situacao: SituacaoLink }) {
  const itens: { rotulo: string; valor: string }[] = [
    { rotulo: "Criado em", valor: `${formatDataHora(link.criadoEm)}${link.criadoPorNome ? ` por ${link.criadoPorNome.split(" ")[0]}` : ""}` },
    {
      rotulo: link.revogadoEm ? "Revogado em" : situacao === "expirado" ? "Expirou em" : "Expira em",
      valor: link.revogadoEm ? formatDataHora(link.revogadoEm) : link.expiresAt ? formatData(link.expiresAt) : "Sem expiração",
    },
    { rotulo: "Último acesso", valor: link.ultimoAcessoEm ? formatDataHora(link.ultimoAcessoEm) : "Ainda não acessou" },
    { rotulo: "Acessos", valor: String(link.acessos) },
  ];
  return (
    <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {itens.map((i) => (
        <div key={i.rotulo}>
          <dt className="text-xs text-muted-foreground">{i.rotulo}</dt>
          <dd className="text-sm font-medium">{i.valor}</dd>
        </div>
      ))}
      {situacao === "bloqueado" && link.bloqueadoAte ? (
        <p className="flex items-center gap-1.5 text-sm text-destructive sm:col-span-2">
          <TriangleAlert className="size-4" aria-hidden />
          Muitas senhas erradas. Liberado às {formatDataHora(link.bloqueadoAte)}. Se foi engano do cliente, gere uma senha nova.
        </p>
      ) : null}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Link + senha (aparecem uma vez)
// ---------------------------------------------------------------------------
function CredencialDialog({
  cred,
  onClose,
  clienteId,
  nome,
  telefone,
}: {
  cred: Credencial | null;
  onClose: () => void;
  clienteId: string;
  nome: string;
  telefone: string | null;
}) {
  const [verSenha, setVerSenha] = useState(false);
  return (
    <Dialog
      open={!!cred}
      onOpenChange={(o) => {
        if (!o) {
          setVerSenha(false);
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-lg">
        {cred && (
          <>
            <DialogHeader>
              <DialogTitle>{cred.novoLink ? "Link e senha do portal" : "Senha nova do portal"}</DialogTitle>
              <DialogDescription className="flex items-start gap-1.5 text-warning">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                Copie agora. Por segurança, esta janela é a única vez em que o {cred.novoLink ? "link e a senha aparecem" : "valor aparece"}; depois só dá para gerar de novo.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {cred.link && <Campo rotulo="Link" valor={cred.link} abrir />}
              <Campo rotulo="Senha" valor={cred.senha} mono oculto={!verSenha} extra={
                <button
                  type="button"
                  onClick={() => setVerSenha((v) => !v)}
                  aria-label={verSenha ? "Esconder a senha" : "Mostrar a senha"}
                  className="grid size-9 place-items-center rounded-md text-muted-foreground hover:text-foreground"
                >
                  {verSenha ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              } />
              {cred.expiresAt ? (
                <p className="text-xs text-muted-foreground">O link vale até {formatData(cred.expiresAt)}.</p>
              ) : cred.novoLink ? (
                <p className="text-xs text-muted-foreground">O link não tem data para expirar.</p>
              ) : null}
              {cred.link && <EnviarWhatsApp clienteId={clienteId} nome={nome} telefone={telefone} link={cred.link} />}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Concluir
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Campo({ rotulo, valor, mono, oculto, abrir, extra }: { rotulo: string; valor: string; mono?: boolean; oculto?: boolean; abrir?: boolean; extra?: React.ReactNode }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error("Não foi possível copiar. Selecione o texto e copie à mão.");
    }
  }
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{rotulo}</p>
      <div className="flex items-center gap-1.5">
        <Input
          readOnly
          value={valor}
          type={oculto ? "password" : "text"}
          onFocus={(e) => e.currentTarget.select()}
          className={cn("min-w-0 flex-1", mono && "font-mono tracking-wide")}
          aria-label={rotulo}
        />
        {extra}
        <Button type="button" variant="secondary" size="sm" onClick={copiar} aria-label={`Copiar ${rotulo.toLowerCase()}`}>
          {copiado ? <Check /> : <Copy />}
          {copiado ? "Copiado" : "Copiar"}
        </Button>
        {abrir && (
          <a
            href={valor}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Abrir o portal em outra aba"
            className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:text-foreground max-sm:size-11"
          >
            <ExternalLink className="size-4" />
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * Abre a conversa do cliente no Atendimento com a mensagem (link + aviso de que a
 * senha vai separada) JÁ ESCRITA NO CAMPO. Não envia nada: a equipe revisa e aperta enviar.
 *
 * Abre em OUTRA ABA: esta janela (com a senha, que só aparece uma vez) continua
 * aberta aqui. Sem telefone no cadastro, diz por quê e leva ao cadastro (também
 * em outra aba, pelo mesmo motivo).
 */
function EnviarWhatsApp({ clienteId, nome, telefone, link }: { clienteId: string; nome: string; telefone: string | null; link: string }) {
  const { ativo } = useModulos();
  const { data: sessoes = [] } = useWhatsappSessoes();
  const [abrindo, setAbrindo] = useState(false);
  if (!ativo("whatsapp")) return null;
  const texto = mensagemLinkPortal(nome, link);

  async function abrir() {
    setAbrindo(true);
    // A aba nasce no clique (senão o navegador bloqueia como pop-up) e recebe o endereço depois.
    const aba = window.open("about:blank", "_blank");
    try {
      const alvo = await localizarConversaDoCliente({
        clienteId,
        telefone,
        sessaoConectadaId: sessoes.find((s) => s.status === "WORKING")?.id ?? null,
      });
      const destino = alvo ? caminhoDaConversa(alvo, texto) : linkWaMe(telefone, texto);
      if (!destino) {
        aba?.close();
        toast.warning("Este cliente não tem telefone cadastrado.");
        return;
      }
      if (aba) {
        aba.opener = null;
        aba.location.href = destino;
      } else {
        window.open(destino, "_blank", "noopener,noreferrer");
      }
      toast.info("Conversa aberta em outra aba. A senha continua aqui até você concluir.");
    } catch (e) {
      aba?.close();
      toast.error(msgErro(e));
    } finally {
      setAbrindo(false);
    }
  }

  return (
    <div className="rounded-xl border bg-muted/40 p-3">
      {telefone ? (
        <>
          <Button onClick={abrir} disabled={abrindo} className="w-full sm:w-auto">
            {abrindo ? <Loader2 className="animate-spin" /> : <MessageCircle />}
            Enviar o link pelo WhatsApp
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Abre a conversa em outra aba com a mensagem pronta no campo, sem enviar. Revise e aperte enviar. A senha não vai na
            mensagem: copie aqui e mande separado.
          </p>
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">Este cliente não tem telefone no cadastro</strong>, então não dá para abrir a
            conversa do WhatsApp. Copie o link acima e envie por outro meio, ou cadastre o telefone.
          </p>
          <Button asChild size="sm" variant="outline">
            <a href={`/clientes/${clienteId}/editar`} target="_blank" rel="noopener noreferrer">
              <Phone />
              Cadastrar telefone
            </a>
          </Button>
        </div>
      )}
    </div>
  );
}
