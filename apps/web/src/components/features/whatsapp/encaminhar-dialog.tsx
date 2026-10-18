import { Check, Loader2, Search, Send, User, Users } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { useDebounced } from "@/hooks/use-debounced";
import { msgErro } from "@/lib/erro";
import { ehConflitoAtendimento } from "@/lib/queries/atendimento";
import { iniciaisDeContato } from "@/lib/iniciais";
import { cn } from "@/lib/utils";
import { ErroDaApi } from "@/lib/api";
import {
  type ResultadoEncaminhar,
  useEncaminharMensagem,
  useWhatsappChats,
  type WhatsappChat,
} from "@/lib/queries/whatsapp";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sessão da mensagem de origem — encaminhar é dentro da mesma sessão. */
  sessaoId: string;
  /** wamId da mensagem a encaminhar. */
  messageId: string;
};

/**
 * Dialog para encaminhar uma mensagem do WhatsApp para uma ou mais conversas
 * da mesma instância. A mensagem chega no destino via webhook/realtime.
 */
export function EncaminharDialog({
  open,
  onOpenChange,
  sessaoId,
  messageId,
}: Props) {
  const [q, setQ] = useState("");
  const buscaDeb = useDebounced(q, 200);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const { data: chats = [], isLoading } = useWhatsappChats(sessaoId, {
    q: buscaDeb,
  });
  const encaminhar = useEncaminharMensagem();

  // Limpa seleção/busca toda vez que (re)abre.
  useEffect(() => {
    if (open) {
      setSelecionados([]);
      setQ("");
    }
  }, [open]);

  function toggle(chatId: string) {
    setSelecionados((s) =>
      s.includes(chatId) ? s.filter((x) => x !== chatId) : [...s, chatId],
    );
  }

  async function confirmar() {
    if (!selecionados.length) return;
    try {
      const r = await encaminhar.mutateAsync({
        sessaoId,
        messageId,
        toChatIds: selecionados,
      });
      if (r.falhas > 0) {
        // Resultado parcial: diz quantas não foram e o primeiro motivo.
        const motivo = r.resultados.find((x) => !x.ok)?.erro;
        toast.warning(
          `Encaminhada para ${r.enviados} conversa${r.enviados === 1 ? "" : "s"}; ${r.falhas} não recebeu.`,
          motivo ? { description: motivo } : undefined,
        );
      } else {
        toast.success(
          `Mensagem encaminhada para ${r.enviados} conversa${r.enviados === 1 ? "" : "s"}`,
        );
      }
      onOpenChange(false);
    } catch (err) {
      if (ehConflitoAtendimento(err)) return; // aviso e recarga: main.tsx
      // 424: nenhum destino recebeu; o corpo traz o motivo de cada um.
      const primeiro =
        err instanceof ErroDaApi && err.status === 424
          ? (err.dados?.resultados as ResultadoEncaminhar[] | undefined)?.find((x) => !x.ok)?.erro
          : undefined;
      toast.error(primeiro ? `Não foi possível encaminhar: ${primeiro}` : msgErro(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Encaminhar mensagem</DialogTitle>
          <DialogDescription>
            Escolha as conversas que vão receber esta mensagem.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar conversa…"
            className="pl-8"
          />
        </div>

        <div className="border rounded-md max-h-72 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : chats.length === 0 ? (
            <p className="py-8 px-3 text-center text-xs text-muted-foreground">
              {buscaDeb.trim()
                ? "Nenhuma conversa encontrada."
                : "Sem conversas nesta instância."}
            </p>
          ) : (
            <ul>
              {chats.map((c) => {
                const sel = selecionados.includes(c.chatId);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => toggle(c.chatId)}
                      className={cn(
                        "w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-accent/50 transition-colors border-b border-border/40 last:border-b-0",
                        sel && "bg-accent",
                      )}
                    >
                      <span className="grid place-items-center size-8 rounded-full bg-primary/15 text-primary text-xs font-medium shrink-0">
                        {iniciaisChat(c) ??
                          (c.tipo === "group"
                            ? <Users className="size-4" />
                            : <User className="size-4" />)}
                      </span>
                      <span className="min-w-0 flex-1 text-sm font-medium truncate">
                        {nomeChat(c)}
                      </span>
                      <span
                        className={cn(
                          "grid place-items-center size-5 rounded-full border shrink-0 transition-colors",
                          sel
                            ? "bg-primary border-primary text-primary-foreground"
                            : "border-muted-foreground/40",
                        )}
                      >
                        {sel ? <Check className="size-3" /> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={encaminhar.isPending}
          >
            Cancelar
          </Button>
          <Button
            onClick={confirmar}
            disabled={selecionados.length === 0 || encaminhar.isPending}
          >
            {encaminhar.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Encaminhar
            {selecionados.length > 0 ? ` (${selecionados.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Nome amigável do chat: nome salvo ou telefone/“Grupo” como fallback. */
function nomeChat(c: WhatsappChat): string {
  if (c.nome?.trim()) return c.nome.trim();
  if (c.tipo === "group") return `Grupo · ${c.chatId.replace("@g.us", "").slice(-5)}`;
  const digits = c.chatId.replace("@c.us", "").replace(/\D/g, "");
  if (digits.length >= 12 && digits.startsWith("55")) {
    const d = digits.slice(2);
    return `+55 ${d.slice(0, 2)} ${d.slice(2)}`;
  }
  return digits ? `+${digits}` : "Conversa";
}

/** Iniciais do chat, ou null quando não há letra nenhuma (contato só com
 *  telefone) - aí quem chama desenha o ícone. */
function iniciaisChat(c: WhatsappChat): string | null {
  return iniciaisDeContato(c.nome);
}
