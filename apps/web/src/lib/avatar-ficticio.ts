/**
 * Avatar ILUSTRADO e determinístico para contato sem foto de perfil.
 *
 * 🔴 O desenho é FICTÍCIO e arbitrário: ele identifica a CONVERSA, não a
 * pessoa. Nada aqui é derivado do nome, do gênero ou de qualquer dado do
 * contato — só do identificador do chat —, justamente para ninguém ler o boneco
 * como "é assim que ele é". O que se ganha é o que faltava: bater o olho na
 * lista e distinguir uma conversa da outra quando ninguém tem foto (o WhatsApp
 * não entrega a foto de quem restringiu a privacidade, e é a maioria de quem
 * chega por anúncio).
 *
 * Mesmo traço dos avatares da conta de demonstração, que foi o pedido. Sai como
 * data URI: nada é gravado no storage, nada vai para rede, e o mesmo número dá
 * sempre o mesmo rosto - inclusive entre usuários do mesmo escritório.
 */

/** FNV-1a: hash estável, curto e sem dependência. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const FUNDOS = ["#E8EAF6", "#EDE7F6", "#E0F2F1", "#FFF3E0", "#FCE4EC", "#E8F5E9", "#EFEBE9", "#E1F5FE"];
const PELES = ["#F5D6BC", "#E8C39E", "#C68863", "#9C6644", "#7A4A2B", "#FAE0CE"];
const CABELOS = ["#2E2A28", "#4A3728", "#7B4B2A", "#A8654E", "#5A5A5A", "#1C1C1C", "#C69C6D"];
const ROUPAS = ["#5B6B8C", "#6D7B5A", "#8C5B5B", "#4F6B6B", "#7A6B8C", "#8C7A5B", "#3F4A5B"];

/** Estilos de cabelo: cada um é um recorte diferente sobre o círculo do rosto. */
const TOPOS = [
  // curto
  '<clipPath id="t"><rect x="52" y="28" width="152" height="52"/></clipPath>',
  // médio, cobrindo as orelhas
  '<clipPath id="t"><rect x="52" y="28" width="152" height="72"/></clipPath>',
  // longo
  '<clipPath id="t"><rect x="46" y="28" width="164" height="118"/></clipPath>',
  // entradas (topo mais alto)
  '<clipPath id="t"><rect x="60" y="30" width="136" height="34"/></clipPath>',
];

/**
 * SVG (data URI) do avatar de `semente` — normalmente o JID ou o telefone.
 * Determinístico: a mesma semente devolve sempre o mesmo desenho.
 */
export function avatarFicticio(semente: string): string {
  const h = hash(semente || "?");
  const pick = <T,>(arr: T[], desloc: number): T => arr[(h >>> desloc) % arr.length]!;

  const fundo = pick(FUNDOS, 0);
  const pele = pick(PELES, 4);
  const cabelo = pick(CABELOS, 8);
  const roupa = pick(ROUPAS, 12);
  const topo = TOPOS[(h >>> 16) % TOPOS.length]!;
  const oculos = (h >>> 20) % 4 === 0;
  const barba = (h >>> 22) % 5 === 0;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" role="img" aria-label="ilustração"><defs>${topo}</defs>` +
    `<rect width="256" height="256" fill="${fundo}"/>` +
    // pescoço, ombros e a gola em V
    `<rect x="112" y="142" width="32" height="42" rx="15" fill="${pele}" opacity=".85"/>` +
    `<path d="M36 256 C36 200 74 174 128 174 C182 174 220 200 220 256 Z" fill="${roupa}"/>` +
    `<path d="M112 176 L128 198 L144 176 C138 173 118 173 112 176 Z" fill="#F4F4F5" opacity=".9"/>` +
    // rosto
    `<circle cx="128" cy="110" r="52" fill="${pele}"/>` +
    (barba
      ? `<path d="M78 112 q0 52 50 52 q50 0 50 -52 q-6 34 -50 34 q-44 0 -50 -34 Z" fill="${cabelo}" opacity=".55"/>`
      : "") +
    `<circle cx="110" cy="108" r="5" fill="#3B3B3B"/><circle cx="146" cy="108" r="5" fill="#3B3B3B"/>` +
    `<path d="M101 96 q9 -6 18 -1" stroke="#2E2A28" stroke-width="4" fill="none" stroke-linecap="round" opacity=".8"/>` +
    `<path d="M137 95 q9 -5 18 1" stroke="#2E2A28" stroke-width="4" fill="none" stroke-linecap="round" opacity=".8"/>` +
    `<path d="M116 132 q12 9 24 0" stroke="#A8654E" stroke-width="4" fill="none" stroke-linecap="round"/>` +
    (oculos
      ? `<g fill="none" stroke="#3B3B3B" stroke-width="3.5" opacity=".85"><circle cx="110" cy="108" r="14"/><circle cx="146" cy="108" r="14"/><path d="M124 108 h8"/></g>`
      : "") +
    // cabelo por último: o recorte do topo é o que dá o estilo
    `<g clip-path="url(#t)"><circle cx="128" cy="110" r="54" fill="${cabelo}"/></g>` +
    `</svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
