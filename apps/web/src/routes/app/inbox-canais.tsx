import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Eraser,
  Loader2,
  LogOut,
  MessageSquare,
  QrCode,
  RefreshCw,
  RotateCw,
  Smartphone,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "@/lib/toast";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { confirmar } from "@/components/ui/confirm-dialog";
import {
  ConexaoCard,
  type ConexaoStatus,
} from "@/components/features/escritorio/conexao-card";
import { FotoInstancia } from "@/components/features/whatsapp/foto-instancia";
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
import { useDebounced } from "@/hooks/use-debounced";
import { formatInstanceNumber } from "@/components/features/whatsapp/instance-filter-bar";
import {
  useChecarNumeroSessao,
  useCriarSessao,
  useDeleteWhatsappSessao,
  useFetchQrCode,
  useLimparConversasWhatsapp,
  useLogoutWhatsappSessao,
  useRefreshWebhook,
  useRestartWhatsappSessao,
  useStartWhatsappSessao,
  useStopWhatsappSessao,
  useSincronizarSessoesComWaha,
  useSyncWhatsappSessao,
  useWhatsappSessoes,
  type WhatsappSessao,
} from "@/lib/queries/whatsapp";

type StatusUi = ConexaoStatus;

/**
 * Conexões — instâncias de WhatsApp do escritório (portado da tela Canais do
 * adv3). Sem login nem "só o dono": qualquer colaborador conecta, reconecta e
 * desconecta.
 */
export function InboxCanaisPage() {
  const ehDono = true;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 lg:space-y-8">
      <div className="space-y-2">
        <Link
          to="/whatsapp"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Conversas
        </Link>
        <h1 className="text-title-lg font-semibold">Conexões WhatsApp</h1>
        <p className="text-sm text-muted-foreground">
          {ehDono
            ? "Conecte as instâncias de WhatsApp. Você pode desconectar e reconectar a qualquer momento."
            : "Quem conecta os canais é a conta principal do escritório. Aqui você consegue ver o status atual de cada conexão."}
        </p>
      </div>

      <WhatsappInstanciasSection ehDono={ehDono} />
    </div>
  );
}

// ===========================================================================
// WhatsApp — N instâncias por escritório
// ===========================================================================

export function WhatsappInstanciasSection({ ehDono }: { ehDono: boolean }) {
  const { data: sessoes = [], isLoading } = useWhatsappSessoes();
  // Abrir a tela é o momento de conferir com o WAHA: status real e número
  // da instância. Sem isto, a lista mostra só o que o banco já sabia.
  useSincronizarSessoesComWaha();
  const [novoOpen, setNovoOpen] = useState(false);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          Instâncias de WhatsApp
        </h2>
        {ehDono ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setNovoOpen(true)}
          >
            <Smartphone className="size-3.5 mr-1.5" />
            Adicionar instância
          </Button>
        ) : null}
      </div>

      <NovaInstanciaDialog open={novoOpen} onOpenChange={setNovoOpen} />

      {isLoading ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Carregando…
          </CardContent>
        </Card>
      ) : sessoes.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {ehDono
              ? "Nenhuma instância configurada ainda. Clique em “Adicionar instância”."
              : "Nenhuma instância configurada. Peça pra conta principal adicionar."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {sessoes.map((s) => (
            <WhatsappCard key={s.id} sessao={s} ehDono={ehDono} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Dialog de criação de instância. Pede apelido (nome amigável que vai
 * aparecer na sidebar) e o número de WhatsApp que vai conectar — 13
 * dígitos no formato 5511XXXXXXXXX. O número é validado JÁ na digitação
 * (disponibilidade global — um número por instância na plataforma inteira)
 * e, depois que o usuário escaneia o QR, o backend confere se o número
 * que conectou bate com o que foi declarado aqui. Se conectar errado,
 * a sessão vai pra FAILED.
 */
function NovaInstanciaDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const criar = useCriarSessao();
  const qc = useQueryClient();
  const [apelido, setApelido] = useState("");
  const [numero, setNumero] = useState("");

  // Reset quando o dialog fecha pra não vazar estado entre criações.
  useEffect(() => {
    if (!open) {
      setApelido("");
      setNumero("");
    }
  }, [open]);

  const numeroNacional = numero.replace(/\D/g, "");
  // 11 dígitos = celular com o nono; 10 = celular antigo sem ele ou linha
  // fixa (o WhatsApp Business roda em fixo). Recusar o de 10 deixava esses
  // clientes sem caminho nenhum pra conectar.
  const numeroValido =
    numeroNacional.length === 10 || numeroNacional.length === 11;
  const digits = numeroValido ? `55${numeroNacional}` : numeroNacional;
  const apelidoValido = apelido.trim().length >= 2;

  // Checagem antecipada de disponibilidade do número (global, em qualquer
  // conta). Debounce evita bater a cada tecla; o hook só dispara quando o
  // número está completo (13 dígitos com o nono, 12 sem ele).
  const digitsDebounced = useDebounced(digits, 400);
  const checagem = useChecarNumeroSessao(digitsDebounced);
  const checandoNumero =
    numeroValido &&
    (checagem.isLoading || digits !== digitsDebounced);
  const indisponivel =
    numeroValido &&
    !checandoNumero &&
    checagem.data?.disponivel === false &&
    checagem.data.motivo !== "formato";

  const podeSubmeter =
    apelidoValido &&
    numeroValido &&
    !checandoNumero &&
    !indisponivel &&
    !criar.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!podeSubmeter) return;
    try {
      await criar.mutateAsync({ apelido: apelido.trim(), numero: digits });
      await qc.refetchQueries({ queryKey: ["whatsapp-sessoes"] });
      toast.success(
        "Instância criada. Clique em Conectar pra escanear o QR.",
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova instância de WhatsApp</DialogTitle>
          <DialogDescription>
            Dê um apelido pra identificar essa instância na sidebar e
            informe o número que você vai conectar pelo QR.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-muted/15 p-3.5">
            <div className="mb-3 flex items-center gap-2">
              <span className="grid size-6 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">1</span>
              <Label htmlFor="nova-apelido" className="font-semibold">Como sua equipe identifica este número?</Label>
            </div>
            <Input
              id="nova-apelido"
              value={apelido}
              onChange={(e) => setApelido(e.target.value)}
              placeholder="Ex.: Atendimento principal"
              required
              minLength={2}
              autoFocus
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              É apenas um apelido interno. Seus clientes não verão esse nome.
            </p>
          </div>

          <div className="rounded-xl border border-border/60 bg-muted/15 p-3.5">
            <div className="mb-3 flex items-center gap-2">
              <span className="grid size-6 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">2</span>
              <Label htmlFor="nova-numero" className="font-semibold">Qual número será conectado?</Label>
            </div>
            <div className="flex rounded-lg border border-input bg-background shadow-sm focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
              <span className="flex shrink-0 items-center gap-1.5 border-r border-input px-3 text-sm font-medium text-muted-foreground" aria-label="Código do Brasil">
                <span aria-hidden>🇧🇷</span> +55
              </span>
              <Input
                id="nova-numero"
                value={numero}
                onChange={(e) => setNumero(formatNumeroWhatsappNacional(e.target.value))}
                placeholder="(11) 99999-9999"
                inputMode="numeric"
                required
                aria-invalid={numero.length > 0 && !numeroValido}
                className="border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </div>
            {numero.length > 0 && !numeroValido ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
                <AlertCircle className="size-3 shrink-0" /> Informe o DDD e o número: 8 ou 9 dígitos.
              </p>
            ) : checandoNumero ? (
              <p className="mt-2 text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="size-3 animate-spin" />
                Verificando disponibilidade…
              </p>
            ) : indisponivel && checagem.data?.disponivel === false ? (
              <p className="mt-2 text-xs text-destructive flex items-center gap-1.5">
                <AlertCircle className="size-3 shrink-0" />
                {checagem.data.motivo === "mesmo-tenant"
                  ? `Você já tem uma instância nesse número${
                      checagem.data.apelido ? ` (${checagem.data.apelido})` : ""
                    }.`
                  : "Esse número já está conectado em outra conta. Cada número só pode ser usado em um lugar."}
              </p>
            ) : numeroValido && checagem.data?.disponivel === true ? (
              <p className="mt-2 text-xs text-success flex items-center gap-1.5">
                <CheckCircle2 className="size-3.5 shrink-0" />
                Número disponível.
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                Digite somente DDD + número. O +55 já está incluído. Depois, escaneie o QR com este mesmo WhatsApp.
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={criar.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!podeSubmeter}>
              {criar.isPending ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : null}
              Criar instância
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Formata só a parte nacional: "11950218830" → "(11) 95021-8830" e
 * "1153043084" → "(11) 5304-3084". Ao colar o formato internacional,
 * remove o 55 para não duplicá-lo.
 */
function formatNumeroWhatsappNacional(input: string): string {
  let d = input.replace(/\D/g, "");
  if (d.startsWith("55") && d.length > 11) d = d.slice(2);
  d = d.slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : "";
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  // Até 10 dígitos a quebra é 4+4 (fixo e celular antigo); no 11º ela vira
  // 5+4, que é o celular com o nono dígito.
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function WhatsappCard({
  sessao,
  ehDono,
}: {
  sessao: WhatsappSessao;
  ehDono: boolean;
}) {
  const start = useStartWhatsappSessao(sessao.id);
  const stop = useStopWhatsappSessao(sessao.id);
  const restart = useRestartWhatsappSessao(sessao.id);
  const logout = useLogoutWhatsappSessao(sessao.id);
  const limpar = useLimparConversasWhatsapp(sessao.id);
  const sync = useSyncWhatsappSessao(sessao.id);
  const refreshWebhook = useRefreshWebhook(sessao.id);
  const deletar = useDeleteWhatsappSessao();
  const [qrOpen, setQrOpen] = useState(false);

  // Lembra se a sessão já esteve conectada nesta tela. Um pisca
  // transitório WORKING→SCAN_QR_CODE (keepalive / blip do engine) NÃO
  // deve fazer o QR saltar sozinho numa instância que estava conectada.
  const esteveWorkingRef = useRef(false);
  useEffect(() => {
    if (sessao.status === "WORKING") esteveWorkingRef.current = true;
  }, [sessao.status]);

  // Reabre o popup se a sessão está mid-connect (ex.: usuário recarregou
  // a página durante o pareamento). Só auto-abre se a sessão NUNCA esteve
  // conectada aqui — senão um status transitório abriria o QR à toa.
  //
  // Skip se a exclusão tá em andamento — abrir o dialog reativava o
  // auto-start interno que disparava /start contra um sessao.id já
  // apagado (resultado: 404 no /start logo após apagar a instância).
  useEffect(() => {
    if (deletar.isPending || esteveWorkingRef.current) return;
    if (sessao.status === "STARTING" || sessao.status === "SCAN_QR_CODE") {
      setQrOpen(true);
    }
  }, [sessao.status, deletar.isPending]);

  const status: StatusUi = (() => {
    switch (sessao.status) {
      case "WORKING":
        return { label: "Conectado", tone: "online" };
      case "STARTING":
        return { label: "Iniciando…", tone: "warning" };
      case "SCAN_QR_CODE":
        return { label: "Aguardando QR code", tone: "warning" };
      case "FAILED":
        return { label: "Falhou", tone: "erro" };
      default:
        return { label: "Desconectado", tone: "offline" };
    }
  })();

  const conectado = sessao.status === "WORKING";
  const escaneando = sessao.status === "SCAN_QR_CODE";
  const transicao =
    sessao.status === "STARTING" || start.isPending || restart.isPending;

  const planoDeixaApagar = true;

  async function handle(
    name: string,
    mut: { mutateAsync: () => Promise<unknown> },
  ) {
    try {
      await mut.mutateAsync();
      toast.success(`${name} executado.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  // Re-sincroniza a assinatura de eventos do webhook. Necessário porque a
  // assinatura congela no estado da criação da sessão: eventos que o app
  // passou a usar depois (edição, reação, voto de enquete) não chegam até
  // a sessão ser re-registrada. O backend faz stop→reconfig→start, então a
  // conexão reinicia por alguns segundos — sem reler o QR.
  async function handleResync() {
    const ok = await confirmar({
      titulo: "Re-sincronizar eventos?",
      descricao:
        "Reaplica no servidor a assinatura de eventos (edição de mensagem, reação e voto de enquete). A conexão reinicia por alguns segundos, não precisa reler o QR code.",
      confirmLabel: "Re-sincronizar",
    });
    if (!ok) return;
    try {
      await refreshWebhook.mutateAsync();
      toast.success("Eventos re-sincronizados. A conexão volta em instantes.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleApagar() {
    // Fecha o popup ANTES de qualquer coisa pra garantir que o
    // auto-start interno do ConectarWhatsappDialog não dispare /start
    // contra um sessao.id que tá prestes a sumir (resultava em 404).
    setQrOpen(false);
    const ok = await confirmar({
      titulo: "Apagar instância?",
      descricao:
        "Remove a instância, todas as conversas e mensagens dela. A sessão é apagada também no servidor WAHA. Não pode ser desfeito.",
      destructive: true,
      confirmLabel: "Apagar instância",
    });
    if (!ok) return;
    try {
      const res = await deletar.mutateAsync(sessao.id);
      if (res.wahaError) {
        toast.warning("Instância apagada localmente.", {
          description: `WAHA não respondeu: ${res.wahaError}. Limpe a sessão "${sessao.nome}" manualmente no painel WAHA.`,
          duration: 10_000,
        });
      } else {
        toast.success("Instância apagada.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleLimparConversas() {
    const ok = await confirmar({
      titulo: "Limpar todas as conversas?",
      descricao:
        "Apaga do app todas as conversas, mensagens, contatos e mídias deste WhatsApp, sem desconectar o número. Bom pra começar do zero depois de reconectar. Não pode ser desfeito.",
      destructive: true,
      confirmLabel: "Limpar conversas",
    });
    if (!ok) return;
    try {
      const res = await limpar.mutateAsync();
      toast.success(
        `Conversas limpas, ${res.chats} conversa(s) e ${res.mensagens} mensagem(ns) apagadas.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  const titulo = sessao.apelido ?? "WhatsApp";
  const subtitulo = sessao.apelido
    ? null
    : "Sem apelido (renomeie depois)";

  return (
    <>
      <ConectarWhatsappDialog
        sessao={sessao}
        open={qrOpen}
        onOpenChange={setQrOpen}
      />
    <ConexaoCard
      icon={MessageSquare}
      iconTone="primary"
      avatar={<FotoInstancia sessao={sessao} ehDono={ehDono} />}
      titulo={titulo}
      subtitulo={subtitulo}
      status={status}
      // Sem isto a pessoa só vê o apelido que ela mesma escolheu, e não tem
      // como saber QUAL número está naquela instância — que é a pergunta do
      // suporte. O número é o declarado na criação, confirmado contra o que o
      // WAHA reporta ao conectar (`syncSessaoComWaha`).
      identidadeLabel={
        !sessao.numero
          ? "Conta conectada"
          : conectado
            ? "Número conectado"
            : "Número desta instância"
      }
      identidade={
        sessao.numero
          ? formatInstanceNumber(sessao.numero)
          : sessao.pushName ?? null
      }
      erro={sessao.ultimoErro ?? null}
    >
      {!ehDono ? (
        <SemPermissaoHint canal="WhatsApp" conectado={conectado} />
      ) : (
        <>
          {!conectado && !escaneando ? (
            <Button onClick={() => setQrOpen(true)} disabled={transicao}>
              {transicao ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : (
                <Smartphone className="size-4 mr-2" />
              )}
              Conectar
            </Button>
          ) : null}

          {escaneando ? (
            <>
              <Button onClick={() => setQrOpen(true)}>
                <QrCode className="size-4 mr-2" />
                Ver QR code
              </Button>
              <Button
                variant="ghost"
                onClick={() => handle("Cancelar", stop)}
                disabled={stop.isPending}
              >
                Cancelar
              </Button>
            </>
          ) : null}

          {conectado ? (
            <>
              <Button
                variant="outline"
                onClick={() => handle("Sincronizar", sync)}
                disabled={sync.isPending}
              >
                {sync.isPending ? (
                  <Loader2 className="size-4 animate-spin mr-2" />
                ) : (
                  <RefreshCw className="size-4 mr-2" />
                )}
                Atualizar status
              </Button>
              <Button
                variant="outline"
                onClick={handleResync}
                disabled={refreshWebhook.isPending}
                title="Reaplica a assinatura de eventos (edição, reação, voto), reinicia a conexão por alguns segundos, sem reler o QR"
              >
                {refreshWebhook.isPending ? (
                  <Loader2 className="size-4 animate-spin mr-2" />
                ) : (
                  <RotateCw className="size-4 mr-2" />
                )}
                Reiniciar
              </Button>
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => handle("Desconectar", logout)}
                disabled={logout.isPending}
              >
                {logout.isPending ? (
                  <Loader2 className="size-4 animate-spin mr-2" />
                ) : (
                  <LogOut className="size-4 mr-2" />
                )}
                Desconectar
              </Button>
            </>
          ) : null}

          {sessao.status === "FAILED" ? (
            <Button
              variant="outline"
              onClick={() => handle("Reiniciar", restart)}
              disabled={restart.isPending}
            >
              Tentar de novo
            </Button>
          ) : null}

          {/* Ações destrutivas — separadas das de operação, sempre à direita */}
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            {/* Limpar conversas — zera o histórico no app, mantém a conexão.
                Não aparece pra plano sem direito de apagar; "Apagar instância"
                fica, porque é a única saída pra trocar de número. */}
            {planoDeixaApagar ? (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={handleLimparConversas}
              disabled={limpar.isPending}
              title="Apaga todas as conversas e mensagens do app sem desconectar o número, pra começar do zero"
            >
              {limpar.isPending ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : (
                <Eraser className="size-4 mr-2" />
              )}
              Limpar conversas
            </Button>
            ) : null}

            {/* Apagar instância — disponível em qualquer estado */}
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={handleApagar}
              disabled={deletar.isPending}
              title="Remove a instância e apaga a sessão no servidor, precisa ler o QR de novo pra reconectar"
            >
              {deletar.isPending ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : (
                <Trash2 className="size-4 mr-2" />
              )}
              Apagar instância
            </Button>
          </div>
        </>
      )}
    </ConexaoCard>
    </>
  );
}

// ===========================================================================
// Popup do QR code — abre ao clicar "Conectar", fecha ao conectar.
// ===========================================================================

function ConectarWhatsappDialog({
  sessao,
  open,
  onOpenChange,
}: {
  sessao: WhatsappSessao;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const start = useStartWhatsappSessao(sessao.id);
  const stop = useStopWhatsappSessao(sessao.id);
  const fetchQr = useFetchQrCode(sessao.id);
  const startCalledRef = useRef(false);

  // Ao abrir com sessão STOPPED/FAILED, dispara o start uma única vez.
  useEffect(() => {
    if (!open) {
      startCalledRef.current = false;
      return;
    }
    if (startCalledRef.current) return;
    if (sessao.status === "STOPPED" || sessao.status === "FAILED") {
      startCalledRef.current = true;
      start.mutate(undefined, {
        onError: (err) => {
          const msg = err instanceof Error ? err.message : String(err);
          // 404 de sessão pode acontecer se a instância foi apagada
          // entre o auto-start ser disparado e a request chegar ao
          // backend — silencioso, o estado certo é "sumiu".
          if (/n[ãa]o encontrada/i.test(msg)) return;
          toast.error(msg);
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessao.status]);

  // Em SCAN_QR_CODE: busca QR imediato + re-busca a cada 25s (WAHA expira ~30s).
  useEffect(() => {
    if (!open || sessao.status !== "SCAN_QR_CODE") return;
    fetchQr.mutate();
    const id = setInterval(() => fetchQr.mutate(), 25_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessao.status]);

  // Auto-close ao conectar com sucesso.
  useEffect(() => {
    if (open && sessao.status === "WORKING") {
      toast.success("WhatsApp conectado!");
      onOpenChange(false);
    }
  }, [open, sessao.status, onOpenChange]);

  const status = sessao.status;
  const aguardandoQr = status === "SCAN_QR_CODE";
  const iniciando =
    status === "STARTING" ||
    ((status === "STOPPED" || status === "FAILED") && start.isPending);

  function handleCancelar() {
    stop.mutate(undefined, {
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : String(err)),
    });
    onOpenChange(false);
  }

  function handleTentarDeNovo() {
    startCalledRef.current = true;
    start.mutate(undefined, {
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : String(err)),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Conectar WhatsApp</DialogTitle>
          <DialogDescription>
            Use o WhatsApp do seu celular pra escanear o QR code abaixo e
            conectar esta instância.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          <div className="size-64 grid place-items-center bg-card rounded-md border">
            {aguardandoQr && sessao.qrCodeBase64 ? (
              <img
                src={sessao.qrCodeBase64}
                alt="QR code WhatsApp"
                className="size-60 object-contain"
              />
            ) : iniciando || (aguardandoQr && fetchQr.isPending) ? (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <Loader2 className="size-7 animate-spin" />
                <span className="text-xs">
                  {aguardandoQr ? "Gerando QR code…" : "Iniciando sessão…"}
                </span>
              </div>
            ) : status === "FAILED" ? (
              <div className="flex flex-col items-center gap-2 text-destructive px-3 text-center">
                <AlertCircle className="size-7" />
                <span className="text-xs">
                  {sessao.ultimoErro ?? "Falhou. Tente de novo."}
                </span>
              </div>
            ) : (
              <QrCode className="size-12 text-muted-foreground" />
            )}
          </div>

          {aguardandoQr ? (
            <ol className="text-xs text-muted-foreground text-left max-w-xs space-y-1">
              <li>1. Abra o WhatsApp no celular</li>
              <li>2. Toque em Mais opções › Aparelhos conectados</li>
              <li>3. Toque em &ldquo;Conectar um aparelho&rdquo;</li>
              <li>4. Aponte a câmera pra este QR code</li>
            </ol>
          ) : null}
        </div>

        <DialogFooter className="sm:justify-between gap-2">
          {aguardandoQr ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchQr.mutate()}
              disabled={fetchQr.isPending}
            >
              <RefreshCw className="size-3.5 mr-1" />
              Atualizar QR
            </Button>
          ) : (
            <span />
          )}
          {status === "FAILED" ? (
            <Button onClick={handleTentarDeNovo} disabled={start.isPending}>
              Tentar de novo
            </Button>
          ) : (
            <Button
              variant="ghost"
              onClick={handleCancelar}
              disabled={stop.isPending}
            >
              Cancelar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SemPermissaoHint({
  canal,
  conectado,
}: {
  canal: string;
  conectado: boolean | undefined;
}) {
  return (
    <p className="text-xs text-muted-foreground">
      {conectado
        ? `${canal} está conectado. Para desconectar ou trocar a conta, peça à conta principal do escritório.`
        : `Peça à conta principal do escritório pra conectar o ${canal}.`}
    </p>
  );
}

