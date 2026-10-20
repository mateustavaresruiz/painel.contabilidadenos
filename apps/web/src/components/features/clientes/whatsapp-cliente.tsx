import { MessageCircle } from "lucide-react";

import { useAbrirConversaDoCliente } from "@/components/features/clientes/use-abrir-conversa";
import { Button } from "@/components/ui/button";
import { usePermissao } from "@/lib/colaborador";
import { useModulos } from "@/lib/modulos";

/** "Conversar no WhatsApp" da ficha do cliente: só com o módulo ligado e whatsapp.ver. */
export function ConversarWhatsappBotao({ clienteId, telefone }: { clienteId: string; telefone: string | null }) {
  const { ativo } = useModulos();
  const podeVer = usePermissao("whatsapp.ver");
  const { abrir, abrindo } = useAbrirConversaDoCliente();
  if (!ativo("whatsapp") || !podeVer) return null;
  return (
    <Button variant="outline" loading={abrindo} onClick={() => void abrir({ clienteId, telefone })}>
      <MessageCircle />
      Conversar no WhatsApp
    </Button>
  );
}
