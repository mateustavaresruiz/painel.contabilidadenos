import { Download, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { msgErro } from "@/lib/erro";
import type { WhatsappMensagem } from "@/lib/queries/whatsapp";
import { supabase } from "@/lib/supabase";
import { toast } from "@/lib/toast";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessaoId: string;
  chatId: string;
  chatNome: string;
  numero?: string | null;
  /** Nome do cliente vinculado, se houver — vai no cabeçalho do PDF. */
  clienteNome?: string | null;
};

/**
 * Baixa a conversa inteira em PDF (todas as mensagens, não só as que estão na
 * tela). No adv3 havia também "salvar no Armazenamento"; o painel Denos não tem
 * módulo de documentos, então ficou só o download.
 */
export function DownloadConversaDialog({
  open,
  onOpenChange,
  sessaoId,
  chatId,
  chatNome,
  numero,
  clienteNome,
}: Props) {
  const [carregando, setCarregando] = useState(false);

  async function baixar() {
    setCarregando(true);
    try {
      const mensagens = await carregarTodasMensagens(sessaoId, chatId);
      if (mensagens.length === 0) {
        toast.error("Esta conversa não tem mensagens para salvar.");
        return;
      }
      // jsPDF só carrega quando alguém realmente exporta.
      const { gerarPdfConversa } = await import("@/lib/whatsapp-pdf");
      const doc = gerarPdfConversa(mensagens, {
        chatNome,
        numero,
        escritorio: "NÓS Contabilidade",
        clienteVinculado: clienteNome ?? null,
      });
      const stamp = new Date().toISOString().slice(0, 10);
      const safeNome = chatNome.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 60);
      doc.save(`conversa-${safeNome}-${stamp}.pdf`);
      toast.success("Conversa baixada");
      onOpenChange(false);
    } catch (err) {
      toast.error(msgErro(err));
    } finally {
      setCarregando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Baixar conversa</DialogTitle>
          <DialogDescription>
            Gera um PDF com todas as mensagens desta conversa.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
            <p className="font-medium truncate">{chatNome}</p>
            {numero && (
              <p className="text-xs text-muted-foreground tabular-nums">
                {numero}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={carregando}>
            Cancelar
          </Button>
          <Button type="button" onClick={baixar} disabled={carregando}>
            {carregando ? (
              <Loader2 className="size-4 animate-spin mr-2" />
            ) : (
              <Download className="size-4 mr-2" />
            )}
            Baixar PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Carrega TODAS as mensagens da conversa (paginando de 1000 em 1000, o teto
 * do PostgREST). Filtra por sessão também: o mesmo contato falando com dois
 * números são duas conversas.
 */
async function carregarTodasMensagens(
  sessaoId: string,
  chatId: string,
): Promise<WhatsappMensagem[]> {
  const PAGE = 1000;
  let from = 0;
  const todas: WhatsappMensagem[] = [];
  while (true) {
    const { data, error } = await supabase
      .from("WhatsappMensagem")
      .select(
        `id, sessaoId, chatId, wamId, tipo, texto, mediaPath, mediaMime,
         mediaNomeArquivo, mediaTamanho, latitude, longitude, replyToWamId,
         replyToTexto, reactions, ack, fromMe, remetenteJid, remetenteNome, origem,
         enviadoPorUserId, enviadoPor:Colaborador!WhatsappMensagem_enviadoPorUserId_fkey(id, nome, cor),
         timestamp, editadoEm, apagadoEm, criadoEm`,
      )
      .eq("sessaoId", sessaoId)
      .eq("chatId", chatId)
      .order("timestamp", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const lote = (data ?? []) as unknown as WhatsappMensagem[];
    todas.push(...lote);
    if (lote.length < PAGE) break;
    from += PAGE;
  }
  return todas;
}
