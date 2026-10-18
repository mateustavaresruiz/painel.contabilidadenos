/**
 * Máscaras e validações de campos brasileiros (CPF, CNPJ, telefone, CEP,
 * número CNJ). Tudo client-side. As funções `mask*` aceitam qualquer string
 * (descartam não-dígitos) e devolvem o valor formatado — usadas no onChange
 * dos inputs para impedir letras e formatar enquanto digita. As `isValid*`
 * checam os dígitos verificadores / comprimento e alimentam os refines do zod.
 */

function digits(s: string): string {
  return s.replace(/\D/g, "");
}

/** CPF (000.000.000-00) até 11 dígitos, CNPJ (00.000.000/0000-00) acima. */
export function maskCpfCnpj(v: string): string {
  const d = digits(v).slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1-$2");
  }
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
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
  const d = digits(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

/** Valida os dígitos verificadores de um CNPJ. */
export function isValidCnpj(v: string): boolean {
  const d = digits(v);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (len: number) => {
    const weights =
      len === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * weights[i];
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

/** CPF (11) ou CNPJ (14) com dígitos verificadores válidos. */
export function isValidCpfCnpj(v: string): boolean {
  const len = digits(v).length;
  if (len === 11) return isValidCpf(v);
  if (len === 14) return isValidCnpj(v);
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
