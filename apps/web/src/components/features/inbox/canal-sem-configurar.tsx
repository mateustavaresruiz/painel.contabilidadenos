import { Plug, WifiOff, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Tela do Atendimento quando não dá pra abrir as conversas. São dois casos
 * diferentes, com textos diferentes (o adv3 dizia "não configurado" até para
 * instância que só estava desconectada, defeito 10):
 *  - `sem-instancia`: nenhum número cadastrado ainda;
 *  - `desconectada`: há número, mas nenhum está conectado agora.
 */
export function CanalSemConfigurar({
  icone: Icon,
  canal,
  motivo,
}: {
  icone: LucideIcon;
  canal: string;
  motivo: "sem-instancia" | "desconectada";
}) {
  return (
    <div className="flex-1 grid place-items-center p-4 sm:p-8">
      {motivo === "sem-instancia" ? (
        <EmptyState
          icon={Icon}
          title={`${canal} ainda não conectado`}
          description="Cadastre o número do escritório em Conexões e escaneie o QR Code com o celular. Depois disso as conversas chegam aqui em tempo real."
          action={
            <Button asChild>
              <Link to="/configuracoes?tab=conexoes">
                <Plug />
                Ir para Conexões
              </Link>
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={WifiOff}
          title={`${canal} desconectado`}
          description="O número está cadastrado, mas não está conectado agora. Em Conexões dá pra ver o status, reconectar ou ler o QR Code de novo."
          action={
            <Button asChild>
              <Link to="/configuracoes?tab=conexoes">
                <Plug />
                Ver conexões
              </Link>
            </Button>
          }
        />
      )}
    </div>
  );
}
