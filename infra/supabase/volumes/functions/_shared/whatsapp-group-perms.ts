// Permissão de envio em chat de GRUPO.
//
// Dois casos de bloqueio:
//   - 'so_admins': grupo "só admins enviam" (announce) e o número
//     conectado NÃO é admin/superadmin.
//   - 'removido': o número conectado não está mais no grupo (saiu/foi
//     removido) — ou o WAHA responde 403/404 pro getGroup.
//
// Princípio FAIL-OPEN: só bloqueia com sinal positivo. Qualquer
// incerteza (erro de rede no getGroup, engine sem os campos, lista de
// participantes vazia) → deixa enviar (podeEnviar=true).

import { supabaseAdmin } from "./supabase.ts";
import * as waha from "./waha.ts";
import { mesmoNumeroWhatsapp } from "./phone-utils.ts";

export type MotivoBloqueio = "so_admins" | "removido";

export type GroupSendPermission = {
  podeEnviar: boolean;
  motivo: MotivoBloqueio | null;
};

const ENVIAVEL: GroupSendPermission = { podeEnviar: true, motivo: null };

/** Detecta status HTTP na mensagem de erro do wrapper waha() ("WAHA 404 ..."). */
function wahaStatus(err: unknown): number | null {
  const m = err instanceof Error ? err.message : String(err);
  const match = m.match(/WAHA (\d{3})/);
  return match ? Number(match[1]) : null;
}

/**
 * Calcula se o número conectado pode enviar no grupo, consultando o
 * WAHA. `meNumero` são só dígitos (igual a WhatsappSessao.numero).
 */
export async function computeGroupSendPermission(args: {
  session: string;
  groupId: string;
  meNumero: string | null;
}): Promise<GroupSendPermission> {
  // Só faz sentido pra grupo. Individual sempre enviável.
  if (!args.groupId.endsWith("@g.us")) return ENVIAVEL;

  let group: waha.WahaGroup;
  try {
    group = await waha.getGroup(args.session, args.groupId);
  } catch (err) {
    const status = wahaStatus(err);
    // 403/404 = não faço mais parte do grupo (engine recusa o getGroup).
    if (status === 403 || status === 404) {
      return { podeEnviar: false, motivo: "removido" };
    }
    // Qualquer outro erro (timeout, rede, 5xx) → fail-open.
    console.warn(
      `[groupPerms] getGroup falhou ${args.groupId}: ${
        err instanceof Error ? err.message : String(err)
      } — fail-open`,
    );
    return ENVIAVEL;
  }

  const participants = group.participants ?? [];

  // Sem número próprio ou lista vazia → não dá pra afirmar nada. Fail-open.
  if (!args.meNumero || participants.length === 0) return ENVIAVEL;

  // Compara pelas grafias com e sem o 9º dígito (`mesmoNumeroWhatsapp`): no
  // adv3 era igualdade exata de dígitos, e a diferença do nono dígito marcava
  // o grupo como "removido" por engano (defeito 17 do guia).
  const meNumero = args.meNumero;
  const eu = participants.find((p) => {
    const jid = p.pn ?? (p.id?.endsWith("@lid") ? null : p.id);
    const d = waha.phoneDigitsFromJid(jid);
    return !!d && mesmoNumeroWhatsapp(d, meNumero);
  });

  if (!eu) {
    // Participante listado só como @lid, sem `pn`, pode ser eu: aí "não estou
    // na lista" é "não sei", e não sei = fail-open.
    const temLidSemPn = participants.some((p) => p.id?.endsWith("@lid") && !p.pn);
    if (temLidSemPn) return ENVIAVEL;
    return { podeEnviar: false, motivo: "removido" };
  }
  if (eu.role === "left") {
    return { podeEnviar: false, motivo: "removido" };
  }

  const souAdmin = eu.role === "admin" || eu.role === "superadmin";

  // Grupo announce (só admins) e não sou admin → bloqueado.
  if (group.membersCanSendMessages === false && !souAdmin) {
    return { podeEnviar: false, motivo: "so_admins" };
  }

  return ENVIAVEL;
}

/** Persiste o resultado no WhatsappChat (idempotente). */
export async function applyGroupSendPermission(args: {
  tenantId: string;
  sessaoId: string;
  chatId: string;
  perm: GroupSendPermission;
}): Promise<void> {
  await supabaseAdmin
    .from("WhatsappChat")
    .update({
      podeEnviar: args.perm.podeEnviar,
      motivoBloqueio: args.perm.motivo,
      atualizadoEm: new Date().toISOString(),
    })
    .eq("tenantId", args.tenantId)
    .eq("sessaoId", args.sessaoId)
    .eq("chatId", args.chatId);
}

/**
 * Conveniência: calcula + persiste numa tacada. Usado pelos handlers de
 * evento do webhook e pelo endpoint de refresh on-demand.
 */
export async function refreshGroupSendPermission(args: {
  tenantId: string;
  sessaoId: string;
  session: string;
  groupId: string;
  meNumero: string | null;
}): Promise<GroupSendPermission> {
  const perm = await computeGroupSendPermission({
    session: args.session,
    groupId: args.groupId,
    meNumero: args.meNumero,
  });
  await applyGroupSendPermission({
    tenantId: args.tenantId,
    sessaoId: args.sessaoId,
    chatId: args.groupId,
    perm,
  });
  return perm;
}
