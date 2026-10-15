import { ArrowRightLeft, Loader2 } from "lucide-react";
import { useState } from "react";

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
import { confirmar } from "@/components/ui/confirm-dialog";
import { useColaboradoresMap, useEu, type Colaborador } from "@/lib/colaborador";
import { msgErro } from "@/lib/erro";
import {
  useFinalizarAtendimento,
  useTransferirAtendimento,
  type AtendimentoTransferencia,
} from "@/lib/queries/atendimento";
import type { WhatsappChat } from "@/lib/queries/whatsapp";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * Ações de atendimento da conversa (estilo Blip): assumir, tomar de outra
 * pessoa (supervisor), finalizar, reabrir e transferir. O cabeçalho
 * (conversa-cabecalho.tsx) só desenha; a lógica mora aqui.
 */
export function useAcoesAtendimento(chat: WhatsappChat | undefined) {
  const { eu } = useEu();
  const mapa = useColaboradoresMap();
  const transferir = useTransferirAtendimento();
  const finalizarMut = useFinalizarAtendimento();
  const [transferirAberto, setTransferirAberto] = useState(false);
  const responsavel = chat?.responsavelId ? mapa.get(chat.responsavelId) : undefined;

  async function assumir(rotuloErro = "assumir") {
    if (!eu || !chat) return;
    try {
      await transferir.mutateAsync({ chatRowId: chat.id, paraId: eu.id, porId: eu.id });
    } catch (err) {
      toast.error(`Não foi possível ${rotuloErro}: ` + msgErro(err));
    }
  }

  async function finalizar() {
    if (!chat) return;
    const ok = await confirmar({
      titulo: "Finalizar atendimento?",
      descricao:
        "A conversa fica como Finalizada. Se o cliente escrever de novo, ela volta para a fila.",
      confirmLabel: "Finalizar",
    });
    if (!ok) return;
    try {
      await finalizarMut.mutateAsync({ chatRowId: chat.id });
    } catch (err) {
      toast.error("Não foi possível finalizar: " + msgErro(err));
    }
  }

  return {
    responsavel,
    ocupado: transferir.isPending || finalizarMut.isPending,
    assumir: () => assumir("assumir"),
    tomar: () => assumir("assumir a conversa"),
    reabrir: () => assumir("reabrir"),
    finalizar,
    abrirTransferir: () => setTransferirAberto(true),
    dialogoTransferir: chat ? (
      <TransferirDialog
        open={transferirAberto}
        onOpenChange={setTransferirAberto}
        chat={chat}
        responsavel={responsavel}
      />
    ) : null,
  };
}

export function TransferirDialog({
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

/** Frase do registro de atendimento ("Ana transferiu para Bruno · motivo"). */
export function textoTransferencia(
  t: AtendimentoTransferencia,
  mapa: Map<string, Colaborador>,
): string {
  const nome = (id: string | null) => (id ? mapa.get(id)?.nome ?? "alguém" : null);
  const de = nome(t.deId);
  const para = nome(t.paraId);
  const por = nome(t.porId) ?? para ?? "Alguém";
  let base: string;
  switch (t.evento) {
    case "assumiu":
      return `${por} assumiu a conversa`;
    case "tomou":
      return `${por} assumiu a conversa de ${de ?? "outra pessoa"}`;
    case "transferiu":
      return `${nome(t.porId) ?? de ?? "Alguém"} transferiu para ${para ?? "alguém"}${t.motivo ? ` · ${t.motivo}` : ""}`;
    case "devolveu":
      return `${por} devolveu para a fila${t.motivo ? ` · ${t.motivo}` : ""}`;
    case "finalizou":
      return `${por} finalizou o atendimento${t.motivo ? ` · ${t.motivo}` : ""}`;
    case "reabriu":
      return `${por} reabriu o atendimento`;
    case "fila":
      return "Voltou para a fila";
    default:
      break;
  }
  // Registros anteriores à migration 007 (sem evento): deduz pelo de/para.
  if (!t.deId && t.paraId && t.porId === t.paraId) base = `${para} assumiu o atendimento`;
  else if (t.deId && t.paraId && t.porId === t.paraId) base = `${para} assumiu (antes com ${de})`;
  else if (!t.paraId) base = de ? `${de} devolveu para a fila` : "Devolvido para a fila";
  else if (!t.deId) base = `Atribuído a ${para}${nome(t.porId) ? ` por ${nome(t.porId)}` : ""}`;
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
  const hora = new Date(t.criadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className={cn("my-3 flex items-center gap-3 px-2 text-2xs text-muted-foreground", className)} role="note">
      <span className="h-px flex-1 bg-border/70" aria-hidden />
      <span className="max-w-[80%] text-center">
        {textoTransferencia(t, mapa)} · {hora}
      </span>
      <span className="h-px flex-1 bg-border/70" aria-hidden />
    </div>
  );
}
