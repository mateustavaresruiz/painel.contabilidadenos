import type { WhatsappContatosMap } from "@/lib/queries/whatsapp";

/**
 * Resolução de menções `@<digits>` do WhatsApp pra TEXTO puro.
 *
 * O WhatsApp grava menções no corpo como `@<número>`, onde o número é
 * normalmente o LID cru (ex.: `@59253519872216`) — não o telefone. O
 * cliente oficial troca pelo nome do contato; a gente resolve via
 * `WhatsappContato` (índice por `lidId`/`contatoId`), caindo pro telefone
 * formatado quando não há nome. É a versão "texto puro" usada no preview
 * da lista; o balão tem a sua própria (com link clicável).
 */

const RE_MENCAO = /@(\d{6,})/g;

/** Formata número (só dígitos) pra menção: BR celular → "(11) 99785-3643". */
function formatTelefoneMencao(numero: string): string {
  const d = numero.replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) {
    return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  }
  if (d.length === 12 && d.startsWith("55")) {
    return `(${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  }
  return `+${d}`;
}

/**
 * Coleta os ids de contato (`<digits>@c.us` e `<digits>@lid`) das menções
 * de um conjunto de textos — a menção crua não diz qual sufixo o WhatsApp
 * usou, então busca os dois. Alimenta `useWhatsappContatos`.
 */
export function coletarMencaoIds(
  textos: Array<string | null | undefined>,
): string[] {
  const ids = new Set<string>();
  for (const t of textos) {
    if (!t) continue;
    for (const m of t.matchAll(RE_MENCAO)) {
      const digits = m[1]!;
      ids.add(`${digits}@c.us`);
      ids.add(`${digits}@lid`);
    }
  }
  return [...ids];
}

/** Resolve `@<digits>` → nome > pushName > telefone formatado, ou null. */
function labelMencao(
  digits: string,
  mapa: WhatsappContatosMap,
): string | null {
  const c =
    mapa.porLidId.get(`${digits}@lid`) ??
    mapa.porContatoId.get(`${digits}@c.us`) ??
    mapa.porContatoId.get(`${digits}@lid`);
  if (!c) return null;
  const nome = c.nome?.trim() || c.pushName?.trim();
  if (nome) return nome;
  return c.numero ? formatTelefoneMencao(c.numero) : null;
}

/**
 * Troca menções `@<digits>` (LID cru) pelo nome/telefone resolvido. Menção
 * sem resolução fica como está. Pra preview de lista (texto puro).
 */
export function substituirMencoes(
  texto: string | null,
  mapa: WhatsappContatosMap | undefined,
): string | null {
  if (!texto || !mapa) return texto;
  return texto.replace(RE_MENCAO, (full, digits: string) => {
    const label = labelMencao(digits, mapa);
    return label ? `@${label}` : full;
  });
}
