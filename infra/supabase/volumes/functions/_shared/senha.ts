/**
 * Senha de acesso público (portal do cliente) — PBKDF2
 * com Web Crypto nativo, sem deps npm. Formato armazenado:
 *
 *   pbkdf2$<iterations>$<hex_salt>$<hex_derived_key>
 *
 * A senha em claro nunca é guardada — só o hash. O escritório é
 * quem entrega a senha ao destinatário por um canal separado do link.
 */

// OWASP 2023 recomenda >= 600k iterações para PBKDF2-SHA256. Hashes antigos
// guardam suas próprias iterações no formato, então seguem verificáveis (e
// podem ser re-hasheados no próximo acesso bem-sucedido).
const PBKDF2_ITERATIONS = 600_000;
const SENHA_LEN = 12;
// 12 chars, sem ambíguos (0/O, 1/l/I)
const SENHA_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*?";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * ⚠️ O `<ArrayBuffer>` não é enfeite nem `as` disfarçado. `Uint8Array` escrito
 * sozinho significa `Uint8Array<ArrayBufferLike>` desde o TypeScript 5.7, e
 * `ArrayBufferLike` inclui `SharedArrayBuffer`, que a Web Crypto recusa como
 * `BufferSource`: era daí o único erro de tipo que este arquivo tinha, no
 * `salt` do `deriveBits` de `verifySenha`.
 *
 * O tipo estreito aqui é PROVADO, não afirmado: `new Uint8Array(<array>)`
 * aloca um `ArrayBuffer` novo e não tem como devolver memória compartilhada.
 * Escrever a garantia na assinatura é o que faz o compilador enxergar o que já
 * era verdade em tempo de execução, em vez de calar o erro com um `as`.
 */
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const m = hex.match(/.{2}/g);
  return new Uint8Array((m ?? []).map((h) => parseInt(h, 16)));
}

/** Comparação de tempo constante entre dois buffers de bytes. */
function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Gera senha aleatória de 12 chars sem ambíguos. */
export function gerarSenhaForte(): string {
  const arr = new Uint8Array(SENHA_LEN);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => SENHA_ALPHABET[b % SENHA_ALPHABET.length])
    .join("");
}

export async function hashSenha(senha: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(senha),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(new Uint8Array(bits))}`;
}

export async function verifySenha(
  senha: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1], 10);
  const salt = hexToBytes(parts[2]);
  const expectedHex = parts[3];
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(senha),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256,
  );
  // Comparação em tempo constante (bytes do digest), não `===` de string hex.
  return timingSafeEqualBytes(new Uint8Array(bits), hexToBytes(expectedHex));
}
