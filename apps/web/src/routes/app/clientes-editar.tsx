import { ChevronLeft, Pencil } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";

import { ClienteForm } from "@/components/features/clientes/cliente-form";
import { PageHeader } from "@/components/page-header";
import { useCliente } from "@/lib/queries/clientes";

export function EditarClientePage() {
  const { id } = useParams<{ id: string }>();
  const { data: cliente, isLoading, error } = useCliente(id);

  if (!id) return <Navigate to="/clientes" replace />;

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 text-sm text-muted-foreground">Carregando…</div>
    );
  }

  if (error) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 text-sm text-destructive">
        Erro ao carregar: {error instanceof Error ? error.message : "desconhecido"}
      </div>
    );
  }

  if (!cliente) return <Navigate to="/clientes" replace />;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 lg:space-y-8">
      <PageHeader
        icon={Pencil}
        title={`Editar ${cliente.nomeFantasia || cliente.nome}`}
        description="Atualize os dados do cliente."
        topo={
          <Link to={`/clientes/${cliente.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ChevronLeft className="size-4" />
            Voltar
          </Link>
        }
      />
      <ClienteForm mode="edit" clienteId={cliente.id} defaults={cliente} />
    </div>
  );
}
