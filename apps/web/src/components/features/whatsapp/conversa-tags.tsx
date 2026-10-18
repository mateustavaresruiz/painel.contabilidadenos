// Etiquetas da conversa (CRM-lite). Chip no header abre um popover pra aplicar/
// remover etiquetas e criar novas. Quem tem whatsapp.responder etiqueta,
// cria e apaga etiquetas.

import { Check, Loader2, Plus, Tag as TagIcon, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "@/lib/toast";

import { Button } from "@/components/ui/button";
import { confirmar } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { msgErro } from "@/lib/erro";
import {
  type TagCor,
  TAG_CLASSES,
  TAG_CORES,
  TAG_DOT,
  useChatTagLinks,
  useCriarTag,
  useExcluirTag,
  useTags,
  useToggleChatTag,
} from "@/lib/queries/tags";
import { cn } from "@/lib/utils";

/** Etiquetas aplicadas numa conversa, como chips só-leitura (lista/coluna). */
export function TagsDaConversa({ chatId, className }: { chatId: string; className?: string }) {
  const { data: tags } = useTags();
  const { data: links } = useChatTagLinks();
  const doChat = (links ?? []).filter((l) => l.chatId === chatId);
  if (!doChat.length || !tags?.length) return null;
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {doChat.map((l) => {
        const t = tags.find((x) => x.id === l.tagId);
        if (!t) return null;
        return (
          <span
            key={t.id}
            className={cn("rounded border px-1.5 py-0.5 text-[11px] font-medium leading-none", TAG_CLASSES[t.cor])}
          >
            {t.label}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Aplica/remove etiquetas e cria novas. `variante="item"` é a linha rotulada
 * do menu ⋮ do cabeçalho; o padrão é o botão de ícone.
 */
export function ConversaTagsBotao({
  chatId,
  variante = "icone",
}: {
  chatId: string;
  variante?: "icone" | "item";
}) {
  const { data: tags } = useTags();
  const { data: links } = useChatTagLinks();
  const toggle = useToggleChatTag();
  const criar = useCriarTag();
  const excluir = useExcluirTag();
  const [aberto, setAberto] = useState(false);
  const [novo, setNovo] = useState("");
  const [cor, setCor] = useState<TagCor>("primary");

  const aplicadas = new Set((links ?? []).filter((l) => l.chatId === chatId).map((l) => l.tagId));

  const onToggle = async (tagId: string) => {
    try {
      await toggle.mutateAsync({ chatId, tagId, aplicar: !aplicadas.has(tagId) });
    } catch (e) {
      toast.error(msgErro(e));
    }
  };

  const onCriar = async () => {
    const label = novo.trim();
    if (!label) return;
    try {
      await criar.mutateAsync({ label, cor });
      setNovo("");
      toast.success("Etiqueta criada.");
    } catch (e) {
      toast.error(msgErro(e));
    }
  };

  const onExcluir = async (id: string, label: string) => {
    const ok = await confirmar({
      titulo: `Excluir "${label}"?`,
      descricao: "A etiqueta sai de todas as conversas que a usam.",
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    try {
      await excluir.mutateAsync(id);
      toast.success("Etiqueta removida.");
    } catch (e) {
      toast.error(msgErro(e));
    }
  };

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        {variante === "item" ? (
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent toque:min-h-11"
          >
            <TagIcon className={cn("size-4", aplicadas.size > 0 ? "text-primary" : "text-muted-foreground")} />
            <span className="flex-1">Etiquetas</span>
            {aplicadas.size > 0 && <span className="text-2xs text-muted-foreground">{aplicadas.size}</span>}
          </button>
        ) : (
          <Button variant="ghost" size="icon" className="size-9" title="Etiquetas" aria-label="Etiquetas da conversa">
            <TagIcon className={cn("size-4", aplicadas.size > 0 && "text-primary")} />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3">
        <div className="space-y-3">
          <div className="text-xs font-medium">Etiquetas desta conversa</div>

          {tags?.length ? (
            <div className="max-h-52 space-y-0.5 overflow-y-auto">
              {tags.map((t) => {
                const on = aplicadas.has(t.id);
                return (
                  <div key={t.id} className="group flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onToggle(t.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-muted/50"
                    >
                      <span className={cn("size-2 shrink-0 rounded-full", TAG_DOT[t.cor])} />
                      <span className="min-w-0 flex-1 truncate text-xs">{t.label}</span>
                      {on ? <Check className="size-3.5 shrink-0 text-primary" /> : null}
                    </button>
                    <button
                      type="button"
                      onClick={() => onExcluir(t.id, t.label)}
                      className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      title="Excluir etiqueta"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-2xs text-muted-foreground">Nenhuma etiqueta ainda. Crie a primeira abaixo.</p>
          )}

          <div className="space-y-2 border-t border-border/60 pt-2">
            <div className="flex gap-1">
              {TAG_CORES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCor(c)}
                  className={cn(
                    "size-4 rounded-full border-2 transition-transform",
                    TAG_DOT[c],
                    cor === c ? "scale-110 border-foreground" : "border-transparent",
                  )}
                  title={c}
                />
              ))}
            </div>
            <div className="flex gap-1">
              <Input
                value={novo}
                onChange={(e) => setNovo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onCriar();
                  }
                }}
                placeholder="Nova etiqueta"
                className="h-8 text-xs"
              />
              <Button size="icon" aria-label="Criar etiqueta" className="size-8 shrink-0" onClick={onCriar} disabled={criar.isPending || !novo.trim()}>
                {criar.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Criar e excluir etiqueta é do responsável e dos advogados.</p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
