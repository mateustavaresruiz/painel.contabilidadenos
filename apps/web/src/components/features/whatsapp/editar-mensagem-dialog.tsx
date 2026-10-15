import { Loader2, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "@/lib/toast";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { msgErro } from "@/lib/erro";
import { ehConflitoAtendimento } from "@/lib/queries/atendimento";
import { useEditarMensagem } from "@/lib/queries/whatsapp";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** id local da mensagem (WhatsappMensagem.id). */
  mensagemId: string;
  /** Texto atual — pré-preenche o campo. */
  textoAtual: string;
};

/**
 * Dialog pra editar o texto de uma mensagem enviada. A edição vai pro
 * WhatsApp via WAHA e o balão atualiza com o selo "editada" (mesma UX de
 * quando a edição chega de fora, pelo webhook).
 */
export function EditarMensagemDialog({
  open,
  onOpenChange,
  mensagemId,
  textoAtual,
}: Props) {
  const [texto, setTexto] = useState(textoAtual);
  const editar = useEditarMensagem();

  // Reseta o campo pro texto atual toda vez que (re)abre.
  useEffect(() => {
    if (open) setTexto(textoAtual);
  }, [open, textoAtual]);

  async function salvar() {
    const t = texto.trim();
    if (!t) return;
    // Sem mudança real: só fecha, não chama o WAHA à toa.
    if (t === textoAtual.trim()) {
      onOpenChange(false);
      return;
    }
    try {
      await editar.mutateAsync({ mensagemId, text: t });
      toast.success("Mensagem editada.");
      onOpenChange(false);
    } catch (err) {
      if (ehConflitoAtendimento(err)) return; // aviso e recarga: main.tsx
      toast.error(msgErro(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar mensagem</DialogTitle>
          <DialogDescription>
            A alteração é enviada ao WhatsApp. Só dá pra editar até ~15 minutos
            depois do envio (limite do próprio WhatsApp).
          </DialogDescription>
        </DialogHeader>

        <Textarea
          autoFocus
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={4}
          maxLength={4096}
          placeholder="Texto da mensagem…"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void salvar();
            }
          }}
        />

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={editar.isPending}
          >
            Cancelar
          </Button>
          <Button
            onClick={salvar}
            disabled={!texto.trim() || editar.isPending}
          >
            {editar.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Pencil className="size-4" />
            )}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
