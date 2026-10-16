// Acha (ou abre) a conversa de WhatsApp de um cliente para o painel abrir o
// Atendimento com um texto PRÉ-ESCRITO no campo. Nunca envia nada: quem aperta
// "enviar" é a pessoa da equipe, depois de revisar. Usado por "Parabenizar" em
// Aniversários e por "Enviar o portal pelo WhatsApp" na ficha do cliente.

import { abrirConversaPorTelefone } from "@/lib/queries/whatsapp";
import { supabase } from "@/lib/supabase";

export type ConversaAlvo = { sessaoId: string; chatId: string };

/** Telefone digitado → dígitos com DDI 55 (10/11 dígitos ganham o 55). */
export function telefoneComDdi(telefone: string | null | undefined): string | null {
  const d = (telefone ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  return d.length <= 11 ? "55" + d : d;
}

/**
 * 1) conversa já vinculada ao cliente (quando `porCliente`); 2) conversa do
 * número (tolera o 9º dígito); 3) abre uma nova no número conectado
 * (`sessaoConectadaId`). Devolve null se não houver como (sem telefone ou sem número conectado).
 */
export async function localizarConversaDoCliente(opts: {
  clienteId: string;
  telefone: string | null | undefined;
  /** false para sócio: o vínculo por cliente levaria à empresa. */
  porCliente?: boolean;
  sessaoConectadaId?: string | null;
}): Promise<ConversaAlvo | null> {
  if (opts.porCliente !== false) {
    const { data, error } = await supabase
      .from("WhatsappChat")
      .select("sessaoId, chatId")
      .eq("clienteId", opts.clienteId)
      .eq("tipo", "individual")
      .is("apagadoEm", null)
      .order("ultimaMensagemEm", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }
  const comDdi = telefoneComDdi(opts.telefone);
  if (!comDdi) return null;
  // Tolera o 9º dígito: procura as duas formas do número.
  const variantes = [comDdi];
  if (comDdi.length === 13) variantes.push(comDdi.slice(0, 4) + comDdi.slice(5));
  if (comDdi.length === 12) variantes.push(comDdi.slice(0, 4) + "9" + comDdi.slice(4));
  const { data, error } = await supabase
    .from("WhatsappChat")
    .select("sessaoId, chatId")
    .in("chatId", variantes.map((v) => `${v}@c.us`))
    .is("apagadoEm", null)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;
  if (opts.sessaoConectadaId) {
    const nova = await abrirConversaPorTelefone(opts.sessaoConectadaId, comDdi);
    return { sessaoId: opts.sessaoConectadaId, chatId: nova.chatId };
  }
  return null;
}

/** Caminho do Atendimento com o texto já escrito no campo (não envia). */
export function caminhoDaConversa(alvo: ConversaAlvo, texto: string): string {
  const q = new URLSearchParams({ instancia: alvo.sessaoId, chat: alvo.chatId, texto });
  return `/whatsapp?${q.toString()}`;
}
