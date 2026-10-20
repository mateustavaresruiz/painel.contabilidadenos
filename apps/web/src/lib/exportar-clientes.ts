/**
 * Exportar a lista de clientes para Excel (.xlsx), com os mesmos filtros e a
 * mesma busca da tela. A tela mostra até 500; o arquivo traz todos os que
 * casam com o filtro, de 1000 em 1000 (teto do PostgREST por pedido).
 *
 * A lib `xlsx` só baixa quando alguém clica em Exportar (import dinâmico).
 */

import { formatDoc, formatTelefone, hojeISO, parsePgTimestamp } from "@/lib/format";
import { consultaClientes, nomeExibicao, razaoSocialDeApoio, type ClienteResumo, type ClientesFilters } from "@/lib/queries/clientes";
import { compararTexto } from "@/lib/texto";

/**
 * Injeção de fórmula: texto que começa com `=`, `+`, `-`, `@`, tab ou CR vira
 * fórmula se alguém salvar como CSV ou editar a célula. O `'` na frente faz o
 * Excel tratar como texto.
 */
function celulaSegura(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

/** Data de cadastro como data de calendário local (sem hora), para o Excel não deslocar pelo fuso. */
function dataLocal(ts: string | null | undefined): Date | null {
  const d = parsePgTimestamp(ts);
  return d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()) : null;
}

async function carregarTodos(filters: ClientesFilters): Promise<ClienteResumo[]> {
  const lista: ClienteResumo[] = [];
  for (let de = 0; ; de += 1000) {
    // id desempata o nome: ordem estável entre as páginas.
    const { data, error } = await consultaClientes(filters)
      .order("nome", { ascending: true })
      .order("id", { ascending: true })
      .range(de, de + 999);
    if (error) throw error;
    const pagina = (data ?? []) as unknown as ClienteResumo[];
    lista.push(...pagina);
    if (pagina.length < 1000) break;
  }
  // Mesma ordem da tela: o nome que aparece (fantasia quando houver).
  return lista.sort((a, b) => compararTexto(nomeExibicao(a), nomeExibicao(b)));
}

const COLUNAS: Array<{ titulo: string; largura: number }> = [
  { titulo: "Nome", largura: 40 },
  { titulo: "Razão social", largura: 40 },
  { titulo: "CPF/CNPJ", largura: 20 },
  { titulo: "Tipo", largura: 6 },
  { titulo: "Regime", largura: 18 },
  { titulo: "Telefone", largura: 17 },
  { titulo: "E-mail", largura: 32 },
  { titulo: "Cidade", largura: 22 },
  { titulo: "UF", largura: 5 },
  { titulo: "Ativo", largura: 7 },
  { titulo: "Cadastro incompleto", largura: 10 },
  { titulo: "Data de cadastro", largura: 14 },
];

/** Baixa clientes-AAAA-MM-DD.xlsx com os clientes do filtro. Devolve quantos foram. */
export async function exportarClientes(filters: ClientesFilters): Promise<number> {
  const [lista, XLSX] = await Promise.all([carregarTodos(filters), import("xlsx")]);
  const linhas: Array<Array<string | Date | null>> = lista.map((c) => [
    nomeExibicao(c),
    razaoSocialDeApoio(c) ?? "",
    c.cpfCnpj ? formatDoc(c.cpfCnpj) : "",
    c.tipo,
    c.regimeTributario ?? "",
    c.telefone ? formatTelefone(c.telefone) : "",
    c.email ?? "",
    c.cidade ?? "",
    c.estado ?? "",
    c.ativo ? "Sim" : "Não",
    c.provisorio ? "Sim" : "Não",
    dataLocal(c.criadoEm),
  ]);
  const aoa = [COLUNAS.map((c) => c.titulo), ...linhas].map((l) =>
    l.map((v) => (typeof v === "string" ? celulaSegura(v) : v)),
  );
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true, dateNF: "dd/mm/yyyy" });
  ws["!cols"] = COLUNAS.map((c) => ({ wch: c.largura }));
  if (ws["!ref"]) ws["!autofilter"] = { ref: ws["!ref"] };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Clientes");
  XLSX.writeFile(wb, `clientes-${hojeISO()}.xlsx`);
  return lista.length;
}
