import { ChevronLeft, UserPlus } from "lucide-react";
import { Link } from "react-router-dom";

import { ClienteForm } from "@/components/features/clientes/cliente-form";
import { PageHeader } from "@/components/page-header";

export function NovoClientePage() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 lg:space-y-8">
      <PageHeader
        icon={UserPlus}
        title="Novo cliente"
        description="Cadastre uma empresa (PJ) ou pessoa física (PF)."
        topo={
          <Link to="/clientes" className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ChevronLeft className="size-4" />
            Clientes
          </Link>
        }
      />
      <ClienteForm mode="create" />
    </div>
  );
}
