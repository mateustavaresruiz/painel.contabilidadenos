import { PageContainer } from "@/components/page-container";
import { ChevronLeft, UserPlus } from "lucide-react";
import { Link } from "react-router-dom";

import { ClienteForm } from "@/components/features/clientes/cliente-form";
import { PageHeader } from "@/components/page-header";

export function NovoClientePage() {
  return (
    <PageContainer className="lg:space-y-8">
      <PageHeader
        icon={UserPlus}
        title="Novo cliente"
        description="Cadastre uma empresa (PJ) ou pessoa física (PF)."
        topo={
          <Link to="/clientes" className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground max-lg:-my-2.5 max-lg:py-2.5">
            <ChevronLeft className="size-4" />
            Clientes
          </Link>
        }
      />
      <ClienteForm mode="create" />
    </PageContainer>
  );
}
