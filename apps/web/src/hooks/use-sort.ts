import { useMemo, useState } from "react";

export type SortDir = "asc" | "desc";
export type SortState<K extends string> = { key: K; dir: SortDir } | null;

type Valor = string | number | Date | null | undefined;

/**
 * Ordenação client-side ESTÁVEL sobre uma lista já carregada (não vai ao
 * banco). `accessors` mapeia cada coluna ordenável a um valor comparável —
 * passe um objeto ESTÁVEL (module-level const ou useMemo) para não re-ordenar à
 * toa. Nulos vão sempre por último; strings comparam em pt-BR (numeric).
 */
export function useSort<T, K extends string>(
  rows: T[],
  accessors: Record<K, (row: T) => Valor>,
  initial: SortState<K> = null,
) {
  const [sort, setSort] = useState<SortState<K>>(initial);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const acc = accessors[sort.key];
    const mult = sort.dir === "asc" ? 1 : -1;
    // decorate → sort → undecorate (o índice original mantém a estabilidade).
    return rows
      .map((row, i) => ({ row, i, v: acc(row) }))
      .sort((a, b) => {
        if (a.v == null && b.v == null) return a.i - b.i;
        if (a.v == null) return 1;
        if (b.v == null) return -1;
        let c: number;
        if (typeof a.v === "number" && typeof b.v === "number") c = a.v - b.v;
        else if (a.v instanceof Date && b.v instanceof Date) c = a.v.getTime() - b.v.getTime();
        else c = String(a.v).localeCompare(String(b.v), "pt-BR", { numeric: true, sensitivity: "base" });
        return c !== 0 ? c * mult : a.i - b.i;
      })
      .map((d) => d.row);
  }, [rows, sort, accessors]);

  /** Alterna a coluna: não-ordenada → asc → desc → não-ordenada. */
  function toggle(key: K) {
    setSort((cur) => {
      if (!cur || cur.key !== key) return { key, dir: "asc" };
      if (cur.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }

  return { rows: sorted, sort, toggle };
}
