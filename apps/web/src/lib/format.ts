/**
 * Postgres `timestamp` (sem timezone) vem via supabase-js como string
 * `"2026-05-19 04:08:32.530767"` — com espaço, sem `T`, sem `Z`.
 *
 * **O valor armazenado já é UTC** (nosso código sempre grava com
 * `new Date().toISOString()` ou `to_timestamp(seconds)`). Como a string
 * vem sem o `Z`, o `new Date(...)` interpreta como LOCAL → erra em 3h
 * no Brasil. Forçamos UTC anexando `Z` quando não tem offset.
 *
 * Safari e date-fns estrito retornam Invalid Date pra formato sem `T`,
 * por isso normalizamos antes.
 */
export function parsePgTimestamp(input: string | null | undefined): Date | null {
  if (!input) return null;
  let iso = input.includes("T") ? input : input.replace(" ", "T");
  // Já tem offset (Z ou +HH:MM)? Mantém. Senão é UTC ingênuo → cola Z.
  const temOffset = /(Z|[+-]\d{2}:?\d{2})$/.test(iso);
  if (!temOffset) iso = iso + "Z";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Colunas `date` do Postgres (dataVencimento, dataPagamento) vêm como
 * `"2026-07-30"`. `new Date("2026-07-30")` é lido como **meia-noite UTC**, que
 * no Brasil (UTC-3) vira 29/07 21:00 — a tela mostrava o dia ANTERIOR. Aqui a
 * data é construída no fuso local, sem deslocamento.
 */
export function parsePgDate(input: string | null | undefined): Date | null {
  if (!input) return null;
  const [ano, mes, dia] = input.slice(0, 10).split("-").map(Number);
  if (!ano || !mes || !dia) return null;
  return new Date(ano, mes - 1, dia);
}

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatBRL(
  value: number | string | null | undefined,
): string {
  if (value === null || value === undefined) return "-";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "-";
  return brl.format(n);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Data (coluna date ou timestamptz) como dd/mm/aaaa. */
export function formatData(input: string | null | undefined): string {
  if (!input) return "-";
  const d = input.length <= 10 ? parsePgDate(input) : parsePgTimestamp(input);
  return d ? d.toLocaleDateString("pt-BR") : "-";
}

/** Data e hora (timestamptz) como dd/mm/aaaa hh:mm. */
export function formatDataHora(input: string | null | undefined): string {
  const d = parsePgTimestamp(input);
  if (!d) return "-";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** CPF/CNPJ só com dígitos → com máscara. */
export function formatDoc(doc: string | null | undefined): string {
  if (!doc) return "-";
  const d = doc.replace(/D/g, "");
  if (d.length === 11) return d.replace(/(d{3})(d{3})(d{3})(d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(d{2})(d{3})(d{3})(d{4})(d{2})/, "$1.$2.$3/$4-$5");
  return doc;
}

/** Telefone BR (com ou sem 55) → (DD) 9XXXX-XXXX. */
export function formatTelefone(tel: string | null | undefined): string {
  if (!tel) return "-";
  let d = tel.replace(/D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return tel;
}

/**
 * Link wa.me SEMPRE com o 55: o adv3 montava com o telefone cru e
 * "44997018057" abria um número do Reino Unido (defeito 62).
 */
export function linkWaMe(tel: string | null | undefined, texto?: string): string | null {
  if (!tel) return null;
  let d = tel.replace(/D/g, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  if (d.length < 12) return null;
  return `https://wa.me/${d}${texto ? `?text=${encodeURIComponent(texto)}` : ""}`;
}

/** Hoje em AAAA-MM-DD (fuso local). */
export function hojeISO(delta = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
