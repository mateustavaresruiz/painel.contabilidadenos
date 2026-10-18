import { Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { confirmar } from "@/components/ui/confirm-dialog";
import { msgErro } from "@/lib/erro";
import { useDeleteCliente } from "@/lib/queries/clientes";
import { toast } from "@/lib/toast";

/**
 * Excluir cliente. No banco, sócios, certificados e consultas fiscais caem
 * junto (cascade); conversas e chamados ficam, só sem o vínculo.
 */
export function DeleteClienteButton({
  clienteId,
  clienteNome,
}: {
  clienteId: string;
  clienteNome: string;
}) {
  const del = useDeleteCliente();
  const navigate = useNavigate();

  async function excluir() {
    const ok = await confirmar({
      titulo: "Excluir cliente?",
      descricao: `${clienteNome} sai do cadastro junto com sócios, certificados e consultas fiscais. Conversas e chamados ficam, só sem o vínculo. Não dá para desfazer, para só esconder, marque como inativo.`,
      confirmLabel: "Excluir",
      destructive: true,
    });
    if (!ok) return;
    try {
      await del.mutateAsync(clienteId);
      navigate("/clientes");
    } catch (err) {
      toast.error(msgErro(err));
    }
  }

  return (
    <Button variant="ghost" onClick={excluir} disabled={del.isPending} className="text-destructive hover:text-destructive">
      <Trash2 />
      Excluir
    </Button>
  );
}
