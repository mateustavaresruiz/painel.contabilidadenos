import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";

/**
 * Monta um filtro PostgREST `.or()` de `ilike` seguro para várias colunas.
 *
 * O termo do usuário é envolvido em aspas duplas e tem `"` e `\` escapados, de
 * modo que `,`, `(`, `)` no termo não quebrem nem alarguem a expressão do
 * `.or()`. (isto trata a robustez/correção do filtro.)
 *
 * Ex.: orIlike(["nome", "email"], 'a,b') →
 *   `nome.ilike."%a,b%",email.ilike."%a,b%"`
 */
export function orIlike(columns: string[], term: string): string {
  const safe = term.replace(/[\\"]/g, (c) => `\\${c}`);
  // % e _ são curingas do LIKE: escapados, buscam o caractere literal.
  // Duas barras: o PostgREST consome uma ao ler o valor entre aspas, e o
  // LIKE do Postgres recebe "\%".
  const literal = safe.replace(/[%_]/g, (c) => `\\\\${c}`);
  return columns.map((col) => `${col}.ilike."%${literal}%"`).join(",");
}

/**
 * Converte chaves `undefined` em `null` para um payload de UPDATE.
 *
 * O supabase-js serializa via JSON.stringify, que DESCARTA chaves com valor
 * `undefined`. Em forms de EDIÇÃO, limpar um campo opcional vira `undefined`
 * (o zod transforma "" → undefined), então a coluna nunca era atualizada e o
 * valor antigo permanecia silenciosamente. Trocando undefined → null, o campo
 * limpo de fato zera no banco. Use SÓ em UPDATE — no INSERT, omitir a chave
 * (deixar o default/null do banco agir) é o comportamento correto.
 */
export function nullificarVazios<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).map(([k, v]) => [k, v === undefined ? null : v]),
  ) as T;
}

/**
 * Lista enxuta de clientes (id, nome) — uso em selects de form.
 * QueryKey começa com "clientes" pra pegar o invalidate das mutations.
 */
export function useClientesList() {
  return useQuery({
    queryKey: ["clientes", "list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Cliente")
        .select("id, nome, nomeFantasia, tipo, telefone")
        .eq("ativo", true)
        .order("nome", { ascending: true })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as {
        id: string;
        nome: string;
        nomeFantasia: string | null;
        tipo: "PF" | "PJ";
        telefone: string | null;
      }[];
    },
    staleTime: 60_000,
  });
}
