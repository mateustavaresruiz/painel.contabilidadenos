import { ChevronLeft } from "lucide-react";
import { Link } from "react-router-dom";

import { ClienteForm } from "@/components/features/clientes/cliente-form";

export function NovoClientePage() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 lg:space-y-8">
      <header className="space-y-2">
        <Link
          to="/clientes"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="size-4" />
          Voltar
        </Link>
        <h1 className="text-title-lg font-semibold">Novo cliente</h1>
        <p className="text-sm text-muted-foreground">
          Cadastre uma empresa (PJ) ou pessoa física (PF).
        </p>
      </header>
      <ClienteForm mode="create" />
    </div>
  );
}
