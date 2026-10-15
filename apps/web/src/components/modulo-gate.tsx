import { PowerOff } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { MODULOS_PRINCIPAIS, useEhAdmin, useModulos, type ModuloChave } from "@/lib/modulos";

/** Página de um módulo desligado em Configurações vira um estado vazio. */
export function ModuloGate({ modulo, children }: { modulo: ModuloChave; children: ReactNode }) {
  const { ativo } = useModulos();
  const ehAdmin = useEhAdmin();
  if (ativo(modulo)) return <>{children}</>;
  const nome = MODULOS_PRINCIPAIS.find((m) => m.chave === modulo)?.nome ?? "Este módulo";
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <EmptyState
        icon={PowerOff}
        title={`${nome}: módulo desativado`}
        description={
          ehAdmin
            ? "O módulo foi desligado em Configurações. Ligue de novo para ele voltar ao menu."
            : "O módulo foi desligado pela administração do escritório."
        }
        action={
          ehAdmin ? (
            <Button asChild variant="outline">
              <Link to="/configuracoes?tab=modulos">Abrir Configurações</Link>
            </Button>
          ) : (
            <Button asChild variant="outline">
              <Link to="/">Voltar ao início</Link>
            </Button>
          )
        }
      />
    </div>
  );
}
