import { ArrowRightLeft, CheckCircle2, Hand, Loader2, RotateCcw } from "lucide-react";
import { useState } from "react";

import { ColaboradorAvatar, SemResponsavelAvatar } from "@/components/colaborador-avatar";
import { ColaboradorSelect } from "@/components/colaborador-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { useColaboradoresMap, useEu, type Colaborador } from "@/lib/colaborador";
import { msgErro } from "@/lib/erro";
import { useModulos } from "@/lib/modulos";
import {
  useMudarStatusAtendimento,
  useTransferirAtendimento,
  type AtendimentoTransferencia,
} from "@/lib/queries/atendimento";
import type { WhatsappChat } from "@/lib/queries/whatsapp";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * Ações de atendimento no topo da conversa (novo no painel Denos):
 * responsável, Assumir, Finalizar/Reabrir e Transferir.
 */
export function AtendimentoAcoes({ chat }: { chat: WhatsappChat }) {
  const { eu, tem } = useEu();
  const mapa = useColaboradoresMap();
  const responsavel = chat.responsavelId ? mapa.get(chat.responsavelId) : undefined;
  const transferir = useTransferirAtendimento();
  const mudarStatus = useMudarStatusAtendimento();
  const [transferirAberto, setTransferirAberto] = useState(false);
  const podeTransferir = useModulos().ativo("transferenciaAtendimento") && tem("whatsapp.transferir");
  // Assumir conversa de outra pessoa é transferir; sem responsável basta assumir.
  const podeAssumir = chat.responsavelId
    ? tem("whatsapp.transferir")
    : tem("whatsapp.assumir") || tem("whatsapp.transferir");

  const souEu = !!eu && chat.responsavelId === eu.id;
  const finalizado = chat.atendimentoStatus === "finalizado";

  async function assumir() {
    if (!eu) return;
    try {
      await transferir.mutateAsync({ chatRowId: chat.id, paraId: eu.id, porId: eu.id });
    } catch (err) {
      toast.error("Não foi possível assumir: " + msgErro(err));
    }
  }

  async function mudar(status: "finalizado" | "em_atendimento" | "aberto") {
    try {
      await mudarStatus.mutateAsync({ chatRowId: chat.id, status });
    } catch (err) {
      toast.error(msgErro(err));
    }
  }

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <Tooltip
        label={
          responsavel
            ? `Responsável: ${responsavel.nome}${finalizado ? " (finalizado)" : ""}`
            : "Sem responsável"
        }
        side="bottom"
      >
        <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border bg-card px-1 py-0.5 pr-2 text-2xs font-medium max-w-[150px]">
          {responsavel ? (
            <ColaboradorAvatar nome={responsavel.nome} cor={responsavel.cor} size="2xs" />
          ) : (
            <SemResponsavelAvatar size="2xs" />
          )}
          <span className="truncate">
            {responsavel ? responsavel.nome.split(" ")[0] : "Sem responsável"}
          </span>
        </span>
      </Tooltip>

      {!souEu && !finalizado && podeAssumir && (
        <Button
          size="sm"
          onClick={assumir}
          disabled={transferir.isPending || !eu}
          className="h-8"
          title={responsavel ? `Assumir no lugar de ${responsavel.nome}` : "Assumir o atendimento"}
        >
          {transferir.isPending ? <Loader2 className="animate-spin" /> : <Hand />}
          <span className="hidden lg:inline">Assumir</span>
        </Button>
      )}

      {souEu && !finalizado && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void mudar("finalizado")}
          disabled={mudarStatus.isPending}
          className="h-8"
          title="Finalizar atendimento"
        >
          <CheckCircle2 />
          <span className="hidden lg:inline">Finalizar</span>
        </Button>
      )}

      {finalizado && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void mudar(chat.responsavelId ? "em_atendimento" : "aberto")}
          disabled={mudarStatus.isPending}
          className="h-8"
          title="Reabrir atendimento"
        >
          <RotateCcw />
          <span className="hidden lg:inline">Reabrir</span>
        </Button>
      )}

      {podeTransferir && (
      <Tooltip label="Transferir atendimento" side="bottom">
        <button
          type="button"
          onClick={() => setTransferirAberto(true)}
          className="grid place-items-center size-8 rounded-md text-muted-foreground hover:bg-accent/60 hover:text-foreground transition-colors"
          aria-label="Transferir atendimento"
        >
          <ArrowRightLeft className="size-4" />
        </button>
      </Tooltip>
      )}

      <TransferirDialog
        open={transferirAberto}
        onOpenChange={setTransferirAberto}
        chat={chat}
        responsavel={responsavel}
      />
    </div>
  );
}

function TransferirDialog({
  open,
  onOpenChange,
  chat,
  responsavel,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  chat: WhatsappChat;
  responsavel: Colaborador | undefined;
}) {
  const { eu } = useEu();
  const transferir = useTransferirAtendimento();
  const [para, setPara] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [escolheu, setEscolheu] = useState(false);

  async function confirmar() {
    if (!escolheu) {
      toast.error("Escolha para quem transferir.");
      return;
    }
    try {
      await transferir.mutateAsync({
        chatRowId: chat.id,
        paraId: para,
        porId: eu?.id ?? null,
        motivo: motivo.trim() || null,
      });
      onOpenChange(false);
      setPara(null);
      setMotivo("");
      setEscolheu(false);
    } catch (err) {
      toast.error("Não foi possível transferir: " + msgErro(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transferir atendimento</DialogTitle>
          <DialogDescription>
            {responsavel
              ? `Hoje com ${responsavel.nome}. Quem receber passa a ver a conversa em "Minhas".`
              : "A conversa está sem responsável."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tr-para">Para</Label>
            <ColaboradorSelect
              id="tr-para"
              value={escolheu ? para : null}
              onChange={(v) => {
                setPara(v);
                setEscolheu(true);
              }}
              excluirIds={chat.responsavelId ? [chat.responsavelId] : undefined}
              rotuloNenhum={escolheu || chat.responsavelId ? "Devolver para a fila (sem responsável)" : undefined}
              placeholder="Escolha o colaborador"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tr-motivo">Motivo (opcional)</Label>
            <Textarea
              id="tr-motivo"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex.: assunto de folha, é com o DP"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={transferir.isPending}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={transferir.isPending || !escolheu}>
            {transferir.isPending ? <Loader2 className="animate-spin" /> : <ArrowRightLeft />}
            Transferir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Frase de uma transferência ("Transferido de A para B · motivo"). */
export function textoTransferencia(
  t: AtendimentoTransferencia,
  mapa: Map<string, Colaborador>,
): string {
  const nome = (id: string | null) => (id ? mapa.get(id)?.nome ?? "alguém" : null);
  const de = nome(t.deId);
  const para = nome(t.paraId);
  const por = nome(t.porId);
  let base: string;
  if (!t.deId && t.paraId && t.porId === t.paraId) base = `${para} assumiu o atendimento`;
  else if (t.deId && t.paraId && t.porId === t.paraId) base = `${para} assumiu (antes com ${de})`;
  else if (!t.paraId) base = de ? `${de} devolveu para a fila` : "Devolvido para a fila";
  else if (!t.deId) base = `Atribuído a ${para}${por ? ` por ${por}` : ""}`;
  else base = `Transferido de ${de} para ${para}`;
  return t.motivo ? `${base} · ${t.motivo}` : base;
}

/** Divisor de sistema na linha do tempo da conversa. */
export function DivisorTransferencia({
  t,
  mapa,
  className,
}: {
  t: AtendimentoTransferencia;
  mapa: Map<string, Colaborador>;
  className?: string;
}) {
  return (
    <p className={cn("my-3 px-6 text-center text-2xs text-muted-foreground", className)} role="note">
      {textoTransferencia(t, mapa)} ·{" "}
      {new Date(t.criadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
    </p>
  );
}
