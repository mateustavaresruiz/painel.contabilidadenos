import { PageContainer } from "@/components/page-container";
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
      <PageContainer className="text-sm text-muted-foreground">Carregando…</PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer className="text-sm text-destructive">
        Erro ao carregar: {error instanceof Error ? error.message : "desconhecido"}
      </PageContainer>
    );
  }

  if (!cliente) return <Navigate to="/clientes" replace />;

  return (
    <PageContainer className="lg:space-y-8">
      <PageHeader
        icon={Pencil}
        title={`Editar ${cliente.nomeFantasia || cliente.nome}`}
        description={
          cliente.provisorio
            ? "Cadastro provisório criado pelo WhatsApp. Preencha o e-mail ou o CPF/CNPJ para completá-lo."
            : "Atualize os dados do cliente."
        }
        topo={
          <Link to={`/clientes/${cliente.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground max-lg:-my-2.5 max-lg:py-2.5">
            <ChevronLeft className="size-4" />
            Voltar
          </Link>
        }
      />
      <ClienteForm mode="edit" clienteId={cliente.id} defaults={cliente} />
    </PageContainer>
  );
}
