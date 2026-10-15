import { ChevronLeft } from "lucide-react";
import { Link, Navigate, useParams } from "react-router-dom";

import { ClienteForm } from "@/components/features/clientes/cliente-form";
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
      <header className="space-y-2">
        <Link
          to={`/clientes/${cliente.id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="size-4" />
          Voltar
        </Link>
        <h1 className="text-title-lg font-semibold">Editar {cliente.nomeFantasia || cliente.nome}</h1>
        <p className="text-sm text-muted-foreground">
          Atualize os dados do cliente.
        </p>
      </header>
      <ClienteForm mode="edit" clienteId={cliente.id} defaults={cliente} />
    </div>
  );
}
