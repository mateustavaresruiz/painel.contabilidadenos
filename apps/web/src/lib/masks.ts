/**
 * Máscaras e validações de campos brasileiros (CPF, CNPJ, telefone, CEP,
 * número CNJ). Tudo client-side. As funções `mask*` aceitam qualquer string
 * (descartam o que não cabe no campo) e devolvem o valor formatado — usadas
 * no onChange dos inputs para formatar enquanto digita. As `isValid*` checam
 * os dígitos verificadores / comprimento e alimentam os refines do zod.
 *
 * CNPJ alfanumérico (IN RFB 2.229/2024, CNPJs novos a partir de julho/2026):
 * 14 caracteres, os 12 primeiros [0-9A-Z] e os 2 últimos (DV) só dígitos. O
 * CNPJ só numérico de sempre continua válido pela mesma conta. CPF continua
 * só dígitos.
 */

function digits(s: string): string {
  return s.replace(/\D/g, "");
}

/**
 * CPF/CNPJ normalizado para gravar e comparar: maiúsculas e sem `.`, `/`, `-`
 * e espaços. As letras do CNPJ alfanumérico ficam (o gatilho
 * `cliente_normaliza` do banco segue a mesma regra).
 */
export function normalizarDoc(s: string): string {
  return s.toUpperCase().replace(/[./\-\s]/g, "");
}

/** CNPJ (numérico ou alfanumérico) já normalizado: 12 de [0-9A-Z] + 2 dígitos. */
export const CNPJ_RE = /^[0-9A-Z]{12}\d{2}$/;
/** CPF já normalizado: 11 dígitos. */
export const CPF_RE = /^\d{11}$/;

/** PF (CPF, 11 dígitos), PJ (CNPJ, 14 caracteres) ou null, pelo formato do documento. */
export function tipoDoc(v: string): "PF" | "PJ" | null {
  const d = normalizarDoc(v);
  if (CPF_RE.test(d)) return "PF";
  if (CNPJ_RE.test(d)) return "PJ";
  return null;
}

/** CPF 000.000.000-00 (só dígitos, até 11). */
export function maskCpf(v: string): string {
  return digits(v)
    .slice(0, 11)
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

/**
 * CPF (000.000.000-00) enquanto for só dígitos e até 11; CNPJ
 * (AA.AAA.AAA/AAAA-DD) acima disso ou com letra. Letra vira maiúscula; os dois
 * últimos (DV) só aceitam dígito.
 */
export function maskCpfCnpj(v: string): string {
  let d = v.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (d.length > 12) d = d.slice(0, 12) + digits(d.slice(12));
  d = d.slice(0, 14);
  if (d.length <= 11 && /^\d*$/.test(d)) return maskCpf(d);
  let out = d.slice(0, 2);
  if (d.length > 2) out += "." + d.slice(2, 5);
  if (d.length > 5) out += "." + d.slice(5, 8);
  if (d.length > 8) out += "/" + d.slice(8, 12);
  if (d.length > 12) out += "-" + d.slice(12);
  return out;
}

/** Telefone (00) 0000-0000 ou (00) 00000-0000. */
export function maskTelefone(v: string): string {
  const d = digits(v).slice(0, 11);
  if (d.length <= 2) return d.replace(/^(\d{0,2})/, "($1");
  if (d.length <= 6) return d.replace(/^(\d{2})(\d{0,4})/, "($1) $2");
  if (d.length <= 10) return d.replace(/^(\d{2})(\d{4})(\d{0,4})/, "($1) $2-$3");
  return d.replace(/^(\d{2})(\d{5})(\d{0,4})/, "($1) $2-$3");
}

/** CEP 00000-000. */
export function maskCep(v: string): string {
  return digits(v)
    .slice(0, 8)
    .replace(/^(\d{5})(\d)/, "$1-$2");
}

/** Número CNJ NNNNNNN-DD.AAAA.J.TR.OOOO (20 dígitos). */
export function maskCnj(v: string): string {
  const d = digits(v).slice(0, 20);
  return d
    .replace(/^(\d{7})(\d)/, "$1-$2")
    .replace(/^(\d{7})-(\d{2})(\d)/, "$1-$2.$3")
    .replace(/^(\d{7})-(\d{2})\.(\d{4})(\d)/, "$1-$2.$3.$4")
    .replace(/^(\d{7})-(\d{2})\.(\d{4})\.(\d)(\d)/, "$1-$2.$3.$4.$5")
    .replace(/^(\d{7})-(\d{2})\.(\d{4})\.(\d)\.(\d{2})(\d)/, "$1-$2.$3.$4.$5.$6");
}

/** Valida os dígitos verificadores de um CPF. */
export function isValidCpf(v: string): boolean {
  const d = normalizarDoc(v);
  if (!CPF_RE.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

/**
 * Valida os dígitos verificadores de um CNPJ, numérico ou alfanumérico. Cada
 * caractere vale o código ASCII − 48 ('0'..'9' = 0..9, 'A' = 17 … 'Z' = 42);
 * pesos, módulo 11 e a regra do resto são os do CNPJ de sempre.
 */
export function isValidCnpj(v: string): boolean {
  const d = normalizarDoc(v);
  if (!CNPJ_RE.test(d) || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (len: number) => {
    const weights =
      len === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += (d.charCodeAt(i) - 48) * weights[i];
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

/** CPF (11 dígitos) ou CNPJ (14 caracteres) com dígitos verificadores válidos. */
export function isValidCpfCnpj(v: string): boolean {
  const tipo = tipoDoc(v);
  if (tipo === "PF") return isValidCpf(v);
  if (tipo === "PJ") return isValidCnpj(v);
  return false;
}

export function isValidTelefone(v: string): boolean {
  const len = digits(v).length;
  return len === 10 || len === 11;
}

export function isValidCep(v: string): boolean {
  return digits(v).length === 8;
}

export function isValidCnj(v: string): boolean {
  return digits(v).length === 20;
}
