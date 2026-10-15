import { Loader2, Plus } from "lucide-react";
import { useState, type ReactNode } from "react";

import { ColaboradorAvatar } from "@/components/colaborador-avatar";
import { ColaboradorForm } from "@/components/colaborador-form";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useColaboradores, useEu } from "@/lib/colaborador";
import { cn } from "@/lib/utils";

/**
 * Porteiro do painel (substitui o login, decisão do dono): enquanto este
 * computador não disser quem é, mostra a escolha em tela cheia. Sem nenhum
 * colaborador cadastrado, pede o primeiro.
 */
export function QuemSouEuGate({ children }: { children: ReactNode }) {
  const { eu, carregando } = useEu();
  if (carregando) {
    return (
      <div className="h-dvh grid place-items-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (eu) return <>{children}</>;
  return (
    <div className="min-h-dvh grid place-items-center bg-background p-4">
      <div className="w-full max-w-lg rounded-2xl border bg-card p-6 sm:p-8 shadow-soft animate-fade-up">
        <Logo className="h-14 mb-6" />
        <EscolherColaborador />
      </div>
    </div>
  );
}

/** Trocar de colaborador (botão do cabeçalho/rodapé da sidebar). */
export function QuemSouEuDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Quem é você?</DialogTitle>
          <DialogDescription>
            O painel não tem login: escolha quem está usando este computador. Isso define as
            conversas "Minhas" e quem aparece como autor das mensagens e chamados.
          </DialogDescription>
        </DialogHeader>
        <EscolherColaborador semTitulo onEscolhido={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function EscolherColaborador({
  semTitulo,
  onEscolhido,
}: {
  semTitulo?: boolean;
  onEscolhido?: () => void;
}) {
  const { data: lista = [], isLoading } = useColaboradores();
  const { euId, escolher } = useEu();
  const ativos = lista.filter((c) => c.ativo);
  const [criando, setCriando] = useState(false);

  if (isLoading) {
    return (
      <div className="py-10 grid place-items-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (ativos.length === 0 || criando) {
    return (
      <div className="space-y-4">
        {!semTitulo || ativos.length === 0 ? (
          <div>
            <h1 className="text-xl">
              {ativos.length === 0 ? "Cadastre a primeira pessoa da equipe" : "Nova pessoa na equipe"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {ativos.length === 0
                ? "Ainda não há ninguém cadastrado. Comece por você; o restante da equipe entra depois em Equipe."
                : "Cadastro rápido. Os demais dados ficam em Equipe."}
            </p>
          </div>
        ) : null}
        <ColaboradorForm
          compacto
          textoBotao="Cadastrar e entrar"
          onCancelar={ativos.length > 0 ? () => setCriando(false) : undefined}
          onSalvo={(c) => {
            escolher(c.id);
            setCriando(false);
            onEscolhido?.();
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!semTitulo && (
        <div>
          <h1 className="text-xl">Quem é você?</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Escolha seu nome. Fica salvo neste computador e dá pra trocar depois pelo menu.
          </p>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2 max-h-[50vh] overflow-y-auto pr-1">
        {ativos.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              escolher(c.id);
              onEscolhido?.();
            }}
            className={cn(
              "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-accent/60",
              euId === c.id && "border-primary bg-primary/5",
            )}
          >
            <ColaboradorAvatar nome={c.nome} cor={c.cor} size="sm" />
            <span className="min-w-0">
              <span className="block text-sm font-medium truncate">{c.nome}</span>
              {c.cargo && (
                <span className="block text-2xs text-muted-foreground truncate">{c.cargo}</span>
              )}
            </span>
          </button>
        ))}
      </div>
      <Button variant="ghost" size="sm" onClick={() => setCriando(true)}>
        <Plus />
        Não estou na lista
      </Button>
    </div>
  );
}
