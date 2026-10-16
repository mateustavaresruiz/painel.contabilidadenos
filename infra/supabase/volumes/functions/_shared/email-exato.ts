// E-mail → filtro de igualdade EXATA (sem caixa) usando `ilike` do PostgREST.
//
// `.ilike("email", valor)` trata `%` e `_` (SQL) e `*` (PostgREST) como
// curingas: "a_b@x.com" casaria "aXb@x.com" e "%@x.com" casaria todo mundo, o
// que vira oráculo de enumeração de e-mails da equipe. Aqui o valor é
// normalizado, os curingas inválidos são recusados e `_`/`\` são escapados.

const EMAIL_RE = /^[^\s@*%\\]+@[^\s@*%\\]+\.[^\s@*%\\]+$/;

/** E-mail minúsculo e aparado, ou `null` se inválido ou com caractere de curinga. */
export function normalizarEmail(bruto: unknown): string | null {
  if (typeof bruto !== "string") return null;
  const email = bruto.trim().toLowerCase().slice(0, 254);
  return EMAIL_RE.test(email) ? email : null;
}

/** Padrão para `.ilike("email", ...)` que só casa com o próprio e-mail (sem caixa). */
export function padraoIlikeExato(email: string): string {
  return email.replace(/\\/g, "\\\\").replace(/_/g, "\\_");
}
