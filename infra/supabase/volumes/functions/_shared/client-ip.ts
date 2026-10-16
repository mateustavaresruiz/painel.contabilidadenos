// IP do cliente para os freios por IP (entrar, portal).
//
// 🔴 O cabeçalho X-Forwarded-For é uma LISTA que cada proxy ACRESCENTA no fim.
// O começo dela é o que o cliente mandou (forjável: auditoria de 16/10/2026
// gravou "portal:ip:9.9.9.9" só mandando esse cabeçalho). A cadeia aqui é:
//
//   navegador → Traefik (Easypanel) → Envoy (api-gw) → edge runtime
//
// O Traefik acrescenta o IP de quem falou com ele (o cliente de verdade) e o
// Envoy acrescenta o IP do Traefik. Então o IP confiável é o PENÚLTIMO da
// lista: quem está depois dele são nossos próprios proxies, e quem está antes
// é o que o cliente inventou. Se a infraestrutura mudar (Cloudflare na frente,
// outro proxy), ajuste SALTOS_DEPOIS_DO_CLIENTE e rode o teste.
const SALTOS_DEPOIS_DO_CLIENTE = 1;

/** Pura, para testar: escolhe o IP confiável da lista do X-Forwarded-For. */
export function ipConfiavel(xff: string | null | undefined, saltos = SALTOS_DEPOIS_DO_CLIENTE): string | null {
  const partes = (xff ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (partes.length === 0) return null;
  // Lista curta (acesso direto, sem toda a cadeia): fica com o último, o que o
  // proxy mais próximo viu; nunca com o primeiro, que é do cliente.
  const i = Math.max(partes.length - 1 - saltos, 0);
  const ip = partes[Math.min(i, partes.length - 1)];
  return ip.slice(0, 64);
}

export function ipDoCliente(req: Request): string {
  return ipConfiavel(req.headers.get("x-forwarded-for")) ?? req.headers.get("x-real-ip")?.slice(0, 64) ?? "desconhecido";
}
