import { Lock, Plug, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Tela mostrada quando o canal selecionado (WhatsApp ou E-mail) ainda
 * não foi configurado. Redireciona para Configurações → Conexões, onde o
 * dono cria/conecta tudo.
 *
 * Para usuários que não são donos, mostra só uma mensagem informativa —
 * eles não podem configurar canais.
 *
 * Usa o EmptyState padrão (mesmo do módulo de E-mail) num container
 * centralizado e responsivo, para manter os dois canais consistentes.
 */
export function CanalSemConfigurar({
  icone: Icon,
  canal,
  ehDono,
}: {
  icone: LucideIcon;
  canal: string;
  ehDono: boolean;
}) {
  return (
    <div className="flex-1 grid place-items-center p-4 sm:p-8">
      {ehDono ? (
        <EmptyState
          icon={Icon}
          title={`${canal} não configurado`}
          description="Configure em Configurações → Conexões para começar a enviar e receber mensagens dos seus clientes direto aqui."
          action={
            <Button asChild>
              <Link to="/configuracoes?tab=conexoes">
                <Plug className="size-4 mr-2" />
                Configurar em Conexões
              </Link>
            </Button>
          }
        />
      ) : (
        <EmptyState
          icon={Lock}
          title={`${canal} não configurado`}
          description="Quem configura os canais é quem gerencia os números do escritório. Peça para conectar; depois disso você vai poder ler e responder mensagens por aqui."
        />
      )}
    </div>
  );
}
