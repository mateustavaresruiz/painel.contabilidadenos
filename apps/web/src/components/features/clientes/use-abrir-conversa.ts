import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { caminhoDaConversa, localizarConversaDoCliente } from "@/lib/conversa-cliente";
import { msgErro } from "@/lib/erro";
import { toast } from "@/lib/toast";

/**
 * Abre no Atendimento a conversa que JÁ existe com o cliente: a vinculada ao
 * cadastro ou, sem ela, a do número (`telefone`). Não cria conversa nova e não
 * envia nada: com `texto`, ele vai escrito no campo para a pessoa revisar e
 * enviar. Sem conversa, avisa com um toast.
 */
export function useAbrirConversaDoCliente() {
  const navigate = useNavigate();
  const [abrindo, setAbrindo] = useState(false);

  async function abrir(opts: {
    clienteId: string;
    telefone: string | null | undefined;
    /** false procura só pelo número (ex.: telefone de aviso diferente do cadastro). */
    porCliente?: boolean;
    texto?: string;
  }) {
    setAbrindo(true);
    try {
      // Sem `sessaoConectadaId` o localizar não abre conversa nova.
      const alvo = await localizarConversaDoCliente({
        clienteId: opts.clienteId,
        telefone: opts.telefone,
        porCliente: opts.porCliente,
      });
      if (!alvo) {
        toast.warning("Este cliente ainda não tem conversa no WhatsApp", {
          description: opts.telefone
            ? "Nenhuma conversa vinculada ao cadastro nem com o número dele."
            : "Cadastre o telefone para achar a conversa pelo número.",
        });
        return;
      }
      navigate(
        opts.texto
          ? caminhoDaConversa(alvo, opts.texto)
          : `/whatsapp?${new URLSearchParams({ instancia: alvo.sessaoId, chat: alvo.chatId }).toString()}`,
      );
    } catch (e) {
      toast.error(msgErro(e));
    } finally {
      setAbrindo(false);
    }
  }

  return { abrir, abrindo };
}
