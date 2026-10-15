import { Info, Loader2, Mail, Pencil, Phone, Trash2, UserPlus, UsersRound } from "lucide-react";
import { useState } from "react";

import { ColaboradorAvatar } from "@/components/colaborador-avatar";
import { ColaboradorForm } from "@/components/colaborador-form";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { confirmar } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePageTitle } from "@/hooks/use-page-title";
import { useColaboradores, useEu, type Colaborador } from "@/lib/colaborador";
import { msgErro } from "@/lib/erro";
import { formatTelefone } from "@/lib/format";
import { useExcluirColaborador } from "@/lib/queries/denos";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

export function EquipePage() {
  usePageTitle("Equipe");
  const { data = [], isLoading } = useColaboradores();
  const { euId } = useEu();
  const excluir = useExcluirColaborador();
  const [editando, setEditando] = useState<Colaborador | "novo" | null>(null);

  async function remover(c: Colaborador) {
    const ok = await confirmar({
      titulo: `Excluir ${c.nome}?`,
      descricao:
        "As conversas e chamados dele ficam sem responsável, e as mensagens enviadas perdem o autor. Para só tirar das listas, desative em vez de excluir.",
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    excluir.mutate(c.id, { onError: (e) => toast.error(msgErro(e)) });
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <PageHeader
        icon={UsersRound}
        title="Equipe"
        description="Quem atende pelo painel. A cor identifica a pessoa nas conversas e chamados."
        actions={
          <Button onClick={() => setEditando("novo")}>
            <UserPlus />
            Convidar
          </Button>
        }
      />
      {isLoading ? (
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((c) => (
            <li
              key={c.id}
              className={cn("rounded-xl border bg-card p-4 flex items-start gap-3", !c.ativo && "opacity-60")}
            >
              <ColaboradorAvatar nome={c.nome} cor={c.cor} size="md" />
              <div className="flex-1 min-w-0 space-y-0.5">
                <p className="text-sm font-semibold truncate">
                  {c.nome}
                  {c.id === euId && <Badge variant="secondary" className="ml-2">você</Badge>}
                  {!c.ativo && <Badge variant="outline" className="ml-2">inativo</Badge>}
                </p>
                {c.cargo && <p className="text-xs text-muted-foreground">{c.cargo}</p>}
                {c.email && (
                  <p className="text-xs text-muted-foreground truncate inline-flex items-center gap-1">
                    <Mail className="size-3" />
                    {c.email}
                  </p>
                )}
                {c.telefone && (
                  <p className="text-xs text-muted-foreground inline-flex items-center gap-1 ml-2">
                    <Phone className="size-3" />
                    {formatTelefone(c.telefone)}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-0.5">
                <Button size="icon" variant="ghost" onClick={() => setEditando(c)} aria-label="Editar">
                  <Pencil />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => void remover(c)}
                  disabled={c.id === euId}
                  title={c.id === euId ? "Troque de pessoa no \"Quem é você?\" antes de excluir você mesmo" : "Excluir"}
                  aria-label="Excluir"
                >
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={editando !== null} onOpenChange={(o) => !o && setEditando(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editando === "novo" ? "Convidar para a equipe" : "Editar pessoa da equipe"}</DialogTitle>
            <DialogDescription>
              A pessoa entra na lista do "Quem é você?" e pode ser responsável por conversas e chamados.
            </DialogDescription>
          </DialogHeader>
          {editando === "novo" && (
            <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              <Info className="size-3.5 mt-0.5 shrink-0" />
              Por enquanto o convite só cadastra a pessoa: o acesso com login entra numa próxima etapa.
            </p>
          )}
          {editando !== null && (
            <ColaboradorForm
              key={editando === "novo" ? "novo" : editando.id}
              inicial={editando === "novo" ? null : editando}
              onSalvo={() => setEditando(null)}
              onCancelar={() => setEditando(null)}
              textoBotao={editando === "novo" ? "Convidar" : undefined}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
