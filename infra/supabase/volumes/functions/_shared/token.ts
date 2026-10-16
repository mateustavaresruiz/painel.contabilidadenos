/**
 * Helpers de token do portal do cliente (link público).
 * Token é uma string base64url; tokenHash é sha256 hex pra guardar no banco.
 *
 * Padrão: nunca guarda token em claro. O caller que mandou pro usuário
 * (em email/url) é a única forma de "voltar".
 */

export function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return base64url(arr);
}

export async function hashToken(token: string): Promise<string> {
  const enc = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
