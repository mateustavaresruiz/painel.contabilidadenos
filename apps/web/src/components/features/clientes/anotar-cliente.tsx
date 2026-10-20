import { NotebookPen } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { msgErro } from "@/lib/erro";
import { useComentarCliente } from "@/lib/queries/auditoria";
import { toast } from "@/lib/toast";

/** O mesmo teto da RPC comentar_cliente (migration 025). */
const MAX_ANOTACAO = 2000;

/**
 * Caixa "Anotar" da aba Histórico da ficha: grava uma anotação com autor e
 * data, que entra na linha do tempo do cliente logo abaixo. Mesmo molde do
 * "Comentar" da gaveta de chamado.
 */
export function AnotarCliente({ clienteId }: { clienteId: string }) {
  const [texto, setTexto] = useState("");
  const anotar = useComentarCliente();
  const limpo = texto.trim();

  function enviar() {
    if (!limpo || anotar.isPending) return;
    anotar.mutate(
      { clienteId, texto: limpo },
      {
        onSuccess: () => {
          setTexto("");
          toast.success("Anotação salva");
        },
        onError: (e) => toast.error(msgErro(e)),
      },
    );
  }

  return (
    <section aria-label="Anotar" className="space-y-2">
      <h3 className="text-sm font-semibold">Anotar</h3>
      <Textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value.slice(0, MAX_ANOTACAO))}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            enviar();
          }
        }}
        placeholder="Ligação, combinado, recado. Fica no histórico com seu nome e a data."
        rows={3}
        aria-label="Anotação"
        className="text-base fino:text-sm"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-2xs text-muted-foreground">
          <span className="toque:hidden">Ctrl + Enter salva · </span>
          {texto.length}/{MAX_ANOTACAO}
        </span>
        <Button size="sm" onClick={enviar} disabled={!limpo} loading={anotar.isPending}>
          <NotebookPen />
          Anotar
        </Button>
      </div>
    </section>
  );
}
