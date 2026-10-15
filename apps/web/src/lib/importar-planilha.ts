/**
 * Importação de clientes (com sócios) e certificados por planilha (.xlsx ou
 * .csv). Adaptado do adv3 (gestao-adv, lib/importar-planilha.ts).
 *
 * Só leitura, mapeamento e validação: nada aqui fala com o banco (quem grava
 * é components/features/importar/importar-planilha-dialog.tsx). As regras de
 * cliente reusam `clienteSchema`: a planilha nunca aceita o que o formulário
 * recusaria.
 */

import { TIPOS_CERTIFICADO, type TipoCertificado } from "@/lib/queries/certificados";
import { clienteSchema, REGIMES, type ClienteInput } from "@/lib/validations/cliente";
import { isValidCpf, isValidTelefone } from "@/lib/masks";

export type Campo = {
  campo: string;
  rotulo: string;
  obrigatorio?: boolean;
  /** Outros cabeçalhos que querem dizer a mesma coisa (sem acento, minúsculo). */
  sinonimos: string[];
  exemplo: string;
  ajuda?: string;
};

export const CAMPOS_CLIENTE: Campo[] = [
  { campo: "tipo", rotulo: "Tipo", sinonimos: ["pf pj", "pessoa"], exemplo: "PJ", ajuda: "PF ou PJ. Em branco: pelo documento." },
  { campo: "nome", rotulo: "Nome / Razão social", obrigatorio: true, sinonimos: ["nome", "razao social", "razao", "cliente", "empresa", "nome razao social"], exemplo: "Padaria Pão Bom Ltda" },
  { campo: "nomeFantasia", rotulo: "Nome fantasia", sinonimos: ["fantasia"], exemplo: "Pão Bom" },
  { campo: "cpfCnpj", rotulo: "CPF/CNPJ", sinonimos: ["cnpj", "cpf", "documento", "cpf cnpj", "cnpj cpf", "doc"], exemplo: "11.222.333/0001-81", ajuda: "Chave da importação: cliente com o mesmo documento é atualizado." },
  { campo: "email", rotulo: "E-mail", sinonimos: ["email", "e mail"], exemplo: "contato@paobom.com.br" },
  { campo: "telefone", rotulo: "Telefone", sinonimos: ["celular", "whatsapp", "fone", "telefone celular"], exemplo: "(11) 98765-4321" },
  { campo: "regimeTributario", rotulo: "Regime tributário", sinonimos: ["regime", "tributacao", "enquadramento"], exemplo: "Simples Nacional", ajuda: REGIMES.join(", ") },
  { campo: "dataAbertura", rotulo: "Data de abertura", sinonimos: ["abertura", "fundacao", "inicio atividade"], exemplo: "15/03/2015", ajuda: "PJ. DD/MM/AAAA." },
  { campo: "dataNascimento", rotulo: "Data de nascimento", sinonimos: ["nascimento", "data nasc", "aniversario"], exemplo: "", ajuda: "PF. DD/MM/AAAA." },
  { campo: "inscricaoEstadual", rotulo: "Inscrição estadual", sinonimos: ["ie", "insc estadual"], exemplo: "" },
  { campo: "inscricaoMunicipal", rotulo: "Inscrição municipal", sinonimos: ["im", "insc municipal", "ccm"], exemplo: "" },
  { campo: "cep", rotulo: "CEP", sinonimos: [], exemplo: "01310-100" },
  { campo: "rua", rotulo: "Rua", sinonimos: ["logradouro", "endereco"], exemplo: "Av. Paulista" },
  { campo: "numero", rotulo: "Número", sinonimos: ["n", "num", "nro"], exemplo: "1000" },
  { campo: "complemento", rotulo: "Complemento", sinonimos: ["compl"], exemplo: "" },
  { campo: "bairro", rotulo: "Bairro", sinonimos: [], exemplo: "Bela Vista" },
  { campo: "cidade", rotulo: "Cidade", sinonimos: ["municipio"], exemplo: "São Paulo" },
  { campo: "estado", rotulo: "UF", sinonimos: ["estado", "uf"], exemplo: "SP" },
  { campo: "observacoes", rotulo: "Observações", sinonimos: ["obs", "observacao"], exemplo: "" },
];

export const CAMPOS_SOCIO: Campo[] = [
  { campo: "_cliente", rotulo: "CNPJ da empresa", obrigatorio: true, sinonimos: ["cnpj", "empresa", "cliente", "cnpj empresa", "cliente cpf cnpj"], exemplo: "11.222.333/0001-81", ajuda: "CNPJ (ou nome exato) do cliente, da aba Clientes ou já cadastrado." },
  { campo: "nome", rotulo: "Nome do sócio", obrigatorio: true, sinonimos: ["nome", "socio", "nome socio"], exemplo: "Maria Souza" },
  { campo: "cpf", rotulo: "CPF do sócio", sinonimos: ["cpf", "cpf socio"], exemplo: "123.456.789-09" },
  { campo: "dataNascimento", rotulo: "Nascimento", sinonimos: ["data de nascimento", "nascimento", "data nasc"], exemplo: "31/12/1980" },
  { campo: "telefone", rotulo: "Telefone", sinonimos: ["celular", "whatsapp"], exemplo: "" },
  { campo: "email", rotulo: "E-mail", sinonimos: ["email"], exemplo: "" },
  { campo: "participacao", rotulo: "Participação (%)", sinonimos: ["participacao", "percentual", "cotas"], exemplo: "50" },
  { campo: "administrador", rotulo: "Administrador", sinonimos: ["admin", "administra"], exemplo: "Sim" },
];

export const CAMPOS_CERTIFICADO: Campo[] = [
  { campo: "_cliente", rotulo: "Cliente (CPF/CNPJ ou nome)", obrigatorio: true, sinonimos: ["cliente", "cnpj", "cpf", "cpf cnpj", "empresa", "documento cliente", "razao social"], exemplo: "11.222.333/0001-81", ajuda: "CPF/CNPJ do cliente cadastrado (ou o nome exato)." },
  { campo: "tipo", rotulo: "Tipo", sinonimos: ["tipo certificado", "modelo"], exemplo: "e-CNPJ A1", ajuda: TIPOS_CERTIFICADO.join(", ") + ". Em branco: e-CNPJ A1 (PJ) ou e-CPF A1 (PF)." },
  { campo: "validoAte", rotulo: "Válido até", obrigatorio: true, sinonimos: ["validade", "vencimento", "vence em", "data de vencimento", "valido ate", "expira"], exemplo: "30/06/2027", ajuda: "DD/MM/AAAA." },
  { campo: "titular", rotulo: "Titular", sinonimos: ["titular certificado", "responsavel"], exemplo: "Maria Souza" },
  { campo: "documento", rotulo: "Documento do titular", sinonimos: ["cpf titular", "doc titular"], exemplo: "" },
  { campo: "emissora", rotulo: "Emissora", sinonimos: ["ac", "autoridade certificadora", "certificadora"], exemplo: "Serasa" },
  { campo: "emitidoEm", rotulo: "Emitido em", sinonimos: ["emissao", "data de emissao"], exemplo: "30/06/2026" },
  { campo: "telefoneAviso", rotulo: "Telefone para aviso", sinonimos: ["telefone", "whatsapp aviso", "celular", "aviso"], exemplo: "(11) 98765-4321", ajuda: "Em branco: telefone do cliente." },
  { campo: "observacoes", rotulo: "Observações", sinonimos: ["obs"], exemplo: "" },
];

// ---------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------

export function normalizar(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
export const soDigitos = (s: string) => s.replace(/\D/g, "");
/** CPF/CNPJ que o Excel guardou como número perde os zeros à esquerda: devolve. */
export const docDigitos = (s: string) => {
  const d = soDigitos(s);
  if (d.length === 9 || d.length === 10) return d.padStart(11, "0");
  if (d.length === 12 || d.length === 13) return d.padStart(14, "0");
  return d;
};

function celulaParaTexto(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v).trim();
}

/** DD/MM/AAAA (ou "-"/".") → AAAA-MM-DD. ISO passa direto. Outra coisa: "" (inválida). */
export function normalizarData(v: string): string {
  const t = v.trim();
  if (!t) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (!m) return "invalida";
  const [, d, mes, a] = m;
  const ano = a!.length === 2 ? `20${a}` : a!;
  const iso = `${ano}-${mes!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  const dt = new Date(`${iso}T12:00:00`);
  return Number.isNaN(dt.getTime()) || dt.getDate() !== Number(d) ? "invalida" : iso;
}

// ---------------------------------------------------------------------------
// Leitura e mapeamento
// ---------------------------------------------------------------------------

/** `primeiraLinha` = número (na planilha) da primeira linha de dados. */
export type Aba = { nome: string; cabecalho: string[]; linhas: string[][]; primeiraLinha: number };

export async function lerArquivo(file: File): Promise<Aba[]> {
  const XLSX = await import("xlsx");
  const ehCsv = /\.(csv|txt)$/i.test(file.name);
  let wb;
  if (ehCsv) {
    const texto = await file.text();
    const primeira = texto.split(/\r?\n/, 1)[0] ?? "";
    const FS = (primeira.match(/;/g)?.length ?? 0) > (primeira.match(/,/g)?.length ?? 0) ? ";" : ",";
    // raw: CSV sem conversão (CNPJ não vira número, data fica DD/MM/AAAA).
    wb = XLSX.read(texto, { type: "string", FS, raw: true });
  } else {
    wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  }
  return wb.SheetNames.map((nome) => {
    const m = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nome]!, { header: 1, raw: true, defval: "", blankrows: false });
    const matriz = m.map((l) => (l ?? []).map(celulaParaTexto));
    // Cabeçalho = primeira linha com 2+ células preenchidas (pula título).
    const iCab = Math.max(0, matriz.findIndex((l) => l.filter(Boolean).length >= 2));
    // Linhas vazias saem (blankrows: false), então o número é aproximado só se houver linha vazia no meio.
    return { nome, cabecalho: matriz[iCab] ?? [], linhas: matriz.slice(iCab + 1).filter((l) => l.some(Boolean)), primeiraLinha: iCab + 2 };
  });
}

export type Mapa = Record<string, number>; // campo → índice da coluna (-1 = não usar)

export function adivinharMapa(cabecalho: string[], campos: Campo[]): Mapa {
  const usados = new Set<number>();
  const mapa: Mapa = {};
  const cab = cabecalho.map((c) => normalizar(c));
  // 1º passo: rótulo exato; 2º: sinônimo exato; 3º: começa com.
  const passos: Array<(h: string, c: Campo) => boolean> = [
    (h, c) => h === normalizar(c.rotulo) || h === normalizar(c.campo),
    (h, c) => c.sinonimos.includes(h),
    (h, c) => h.length > 2 && (h.startsWith(normalizar(c.rotulo)) || c.sinonimos.some((s) => s.length > 2 && h.startsWith(s))),
  ];
  for (const c of campos) mapa[c.campo] = -1;
  for (const passo of passos) {
    for (const c of campos) {
      if (mapa[c.campo] !== -1) continue;
      const i = cab.findIndex((h, idx) => !usados.has(idx) && h && passo(h, c));
      if (i >= 0) {
        mapa[c.campo] = i;
        usados.add(i);
      }
    }
  }
  return mapa;
}

export function aplicarMapa(aba: Aba, mapa: Mapa): Array<{ linha: number; c: Record<string, string> }> {
  return aba.linhas.map((l, i) => {
    const c: Record<string, string> = {};
    for (const [campo, idx] of Object.entries(mapa)) if (idx >= 0) c[campo] = (l[idx] ?? "").trim();
    return { linha: i + aba.primeiraLinha, c };
  });
}

/** Aba que mais parece com estes campos (para pré-selecionar). */
export function melhorAba(abas: Aba[], campos: Campo[], preferido: string): number {
  const porNome = abas.findIndex((a) => normalizar(a.nome).startsWith(normalizar(preferido)));
  if (porNome >= 0) return porNome;
  let melhor = -1;
  let pts = 0;
  abas.forEach((a, i) => {
    const p = Object.values(adivinharMapa(a.cabecalho, campos)).filter((x) => x >= 0).length;
    if (p > pts) {
      pts = p;
      melhor = i;
    }
  });
  return melhor;
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

export type ClienteExistente = { id: string; nome: string; nomeFantasia: string | null; cpfCnpj: string | null; tipo: "PF" | "PJ" };

export type LinhaCliente = {
  linha: number;
  nome: string;
  doc: string;
  dados?: ClienteInput;
  erros: string[];
  acao?: "criar" | "atualizar" | "repetida";
  existenteId?: string;
};

function resolverTipo(v: string, doc: string): "PF" | "PJ" | "" {
  const n = normalizar(v);
  if (["pf", "f", "fisica", "pessoa fisica"].includes(n)) return "PF";
  if (["pj", "j", "juridica", "pessoa juridica", "empresa"].includes(n)) return "PJ";
  if (n) return "";
  const d = soDigitos(doc);
  return d.length === 11 ? "PF" : "PJ";
}

function resolverRegime(v: string): string {
  if (!v) return "";
  const n = normalizar(v);
  if (n === "simples" || n === "sn") return "Simples Nacional";
  if (n === "presumido") return "Lucro Presumido";
  if (n === "real") return "Lucro Real";
  return REGIMES.find((r) => normalizar(r) === n) ?? v;
}

export function validarClientes(linhas: Array<{ linha: number; c: Record<string, string> }>, existentes: ClienteExistente[]): LinhaCliente[] {
  const porDoc = new Map(existentes.filter((e) => e.cpfCnpj).map((e) => [soDigitos(e.cpfCnpj!), e]));
  const vistos = new Map<string, number>();
  return linhas.map(({ linha, c }) => {
    const doc = docDigitos(c.cpfCnpj ?? "");
    const item: LinhaCliente = { linha, nome: c.nome ?? "", doc, erros: [] };
    const datas: Record<string, string> = {};
    for (const k of ["dataAbertura", "dataNascimento"]) {
      const d = normalizarData(c[k] ?? "");
      if (d === "invalida") item.erros.push(`${k === "dataAbertura" ? "Data de abertura" : "Data de nascimento"}: use DD/MM/AAAA`);
      else datas[k] = d;
    }
    const parsed = clienteSchema.safeParse({
      ...c,
      cpfCnpj: doc,
      ...datas,
      tipo: resolverTipo(c.tipo ?? "", doc),
      regimeTributario: resolverRegime(c.regimeTributario ?? ""),
      estado: (c.estado ?? "").toUpperCase(),
      ativo: true,
    });
    if (!parsed.success) {
      for (const i of parsed.error.issues) {
        const rot = CAMPOS_CLIENTE.find((x) => x.campo === i.path[0])?.rotulo ?? String(i.path[0]);
        item.erros.push(`${rot}: ${i.message}`);
      }
    } else item.dados = { ...parsed.data, cpfCnpj: doc || undefined };
    if (doc && vistos.has(doc)) {
      item.acao = "repetida";
      item.erros.push(`Documento repetido (linha ${vistos.get(doc)})`);
    } else if (doc) vistos.set(doc, linha);
    if (!item.acao) {
      const ex = doc ? porDoc.get(doc) : undefined;
      item.acao = ex ? "atualizar" : "criar";
      item.existenteId = ex?.id;
    }
    return item;
  });
}

export type LinhaSocio = {
  linha: number;
  nome: string;
  clienteBusca: string;
  clienteNome?: string;
  /** cliente já cadastrado, ou o documento de um cliente que nasce nesta importação */
  clienteId?: string;
  clienteDocNovo?: string;
  dados?: { nome: string; cpf: string | null; dataNascimento: string | null; telefone: string | null; email: string | null; participacao: number | null; administrador: boolean };
  erros: string[];
};

type Achador = (busca: string) => { id?: string; docNovo?: string; nome: string } | null;

export function criarAchador(existentes: ClienteExistente[], novos: LinhaCliente[] = []): Achador {
  const porDoc = new Map(existentes.filter((e) => e.cpfCnpj).map((e) => [soDigitos(e.cpfCnpj!), e]));
  const porNome = new Map<string, ClienteExistente | null>();
  for (const e of existentes) {
    for (const n of [e.nome, e.nomeFantasia]) {
      if (!n) continue;
      const k = normalizar(n);
      porNome.set(k, porNome.has(k) && porNome.get(k)?.id !== e.id ? null : e); // null = ambíguo
    }
  }
  const novosPorDoc = new Map(novos.filter((n) => n.dados && n.doc && n.acao === "criar").map((n) => [n.doc, n]));
  const novosPorNome = new Map(novos.filter((n) => n.dados && n.acao === "criar").map((n) => [normalizar(n.nome), n]));
  return (busca) => {
    const d = docDigitos(busca);
    if (d.length === 11 || d.length === 14) {
      const e = porDoc.get(d);
      if (e) return { id: e.id, nome: e.nomeFantasia || e.nome };
      const n = novosPorDoc.get(d);
      if (n) return { docNovo: d, nome: n.nome };
      return null;
    }
    const k = normalizar(busca);
    const e = porNome.get(k);
    if (e) return { id: e.id, nome: e.nomeFantasia || e.nome };
    const n = novosPorNome.get(k);
    if (n?.doc) return { docNovo: n.doc, nome: n.nome };
    return null;
  };
}

const sim = (v: string) => ["sim", "s", "x", "1", "true", "yes", "verdadeiro"].includes(normalizar(v));

export function validarSocios(linhas: Array<{ linha: number; c: Record<string, string> }>, achar: Achador): LinhaSocio[] {
  return linhas.map(({ linha, c }) => {
    const item: LinhaSocio = { linha, nome: (c.nome ?? "").trim(), clienteBusca: (c._cliente ?? "").trim(), erros: [] };
    if (item.nome.length < 2) item.erros.push("Nome do sócio: obrigatório");
    const cpf = soDigitos(c.cpf ?? "");
    if (cpf && !isValidCpf(cpf)) item.erros.push("CPF do sócio inválido");
    const nasc = normalizarData(c.dataNascimento ?? "");
    if (nasc === "invalida") item.erros.push("Nascimento: use DD/MM/AAAA");
    const tel = (c.telefone ?? "").trim();
    if (tel && !isValidTelefone(tel)) item.erros.push("Telefone inválido");
    const partTxt = (c.participacao ?? "").replace("%", "").replace(",", ".").trim();
    const part = partTxt ? Number(partTxt) : null;
    if (part != null && (!Number.isFinite(part) || part < 0 || part > 100)) item.erros.push("Participação: número de 0 a 100");
    if (!item.clienteBusca) item.erros.push("Informe o CNPJ da empresa");
    else {
      const a = achar(item.clienteBusca);
      if (!a) item.erros.push(`Cliente "${item.clienteBusca}" não encontrado (nem na aba de clientes)`);
      else {
        item.clienteId = a.id;
        item.clienteDocNovo = a.docNovo;
        item.clienteNome = a.nome;
      }
    }
    if (item.erros.length === 0) {
      item.dados = {
        nome: item.nome,
        cpf: cpf || null,
        dataNascimento: nasc || null,
        telefone: tel || null,
        email: (c.email ?? "").trim().toLowerCase() || null,
        participacao: part,
        administrador: sim(c.administrador ?? ""),
      };
    }
    return item;
  });
}

export type LinhaCertificado = {
  linha: number;
  clienteBusca: string;
  clienteId?: string;
  clienteNome?: string;
  dados?: {
    tipo: TipoCertificado;
    validoAte: string;
    titular: string | null;
    documento: string | null;
    emissora: string | null;
    emitidoEm: string | null;
    telefoneAviso: string | null;
    observacoes: string | null;
  };
  erros: string[];
  repetido?: boolean;
};

function resolverTipoCert(v: string, doc: string): TipoCertificado | null {
  const n = normalizar(v);
  if (!n) return soDigitos(doc).length === 11 ? "e-CPF A1" : "e-CNPJ A1";
  const exato = TIPOS_CERTIFICADO.find((t) => normalizar(t) === n);
  if (exato) return exato;
  const a3 = n.includes("a3");
  if (n.includes("cpf")) return a3 ? "e-CPF A3" : "e-CPF A1";
  if (n.includes("cnpj")) return a3 ? "e-CNPJ A3" : "e-CNPJ A1";
  if (n.includes("nf")) return "NF-e";
  if (n === "a1") return soDigitos(doc).length === 11 ? "e-CPF A1" : "e-CNPJ A1";
  if (n === "a3") return soDigitos(doc).length === 11 ? "e-CPF A3" : "e-CNPJ A3";
  return null;
}

export function validarCertificados(
  linhas: Array<{ linha: number; c: Record<string, string> }>,
  existentes: ClienteExistente[],
  jaCadastrados: Array<{ clienteId: string; tipo: string; validoAte: string }>,
): LinhaCertificado[] {
  const achar = criarAchador(existentes);
  const docDe = new Map(existentes.map((e) => [e.id, e.cpfCnpj ?? ""]));
  const chave = (c: string, t: string, v: string) => `${c}|${t}|${v}`;
  const existe = new Set(jaCadastrados.map((j) => chave(j.clienteId, j.tipo, j.validoAte)));
  return linhas.map(({ linha, c }) => {
    const item: LinhaCertificado = { linha, clienteBusca: (c._cliente ?? "").trim(), erros: [] };
    if (!item.clienteBusca) item.erros.push("Informe o cliente (CPF/CNPJ ou nome)");
    else {
      const a = achar(item.clienteBusca);
      if (!a?.id) item.erros.push(`Cliente "${item.clienteBusca}" não cadastrado: importe os clientes antes`);
      else {
        item.clienteId = a.id;
        item.clienteNome = a.nome;
      }
    }
    const validoAte = normalizarData(c.validoAte ?? "");
    if (!validoAte) item.erros.push("Válido até: obrigatório");
    else if (validoAte === "invalida") item.erros.push("Válido até: use DD/MM/AAAA");
    const emitidoEm = normalizarData(c.emitidoEm ?? "");
    if (emitidoEm === "invalida") item.erros.push("Emitido em: use DD/MM/AAAA");
    const tipo = resolverTipoCert(c.tipo ?? "", docDe.get(item.clienteId ?? "") ?? "");
    if (!tipo) item.erros.push(`Tipo: use ${TIPOS_CERTIFICADO.join(", ")}`);
    const tel = (c.telefoneAviso ?? "").trim();
    if (tel && !isValidTelefone(tel)) item.erros.push("Telefone para aviso inválido");
    if (item.erros.length === 0 && tipo && item.clienteId) {
      if (existe.has(chave(item.clienteId, tipo, validoAte))) item.repetido = true;
      existe.add(chave(item.clienteId, tipo, validoAte));
      item.dados = {
        tipo,
        validoAte,
        titular: c.titular?.trim() || null,
        documento: soDigitos(c.documento ?? "") || null,
        emissora: c.emissora?.trim() || null,
        emitidoEm: emitidoEm || null,
        telefoneAviso: tel || null,
        observacoes: c.observacoes?.trim() || null,
      };
    }
    return item;
  });
}

// ---------------------------------------------------------------------------
// Modelo
// ---------------------------------------------------------------------------

export async function baixarModelo(alvo: "clientes" | "certificados") {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const abas: Array<[string, Campo[]]> =
    alvo === "clientes" ? [["Clientes", CAMPOS_CLIENTE], ["Sócios", CAMPOS_SOCIO]] : [["Certificados", CAMPOS_CERTIFICADO]];
  const leia: string[][] = [
    [alvo === "clientes" ? "Importar clientes e sócios no Painel Denos" : "Importar certificados digitais no Painel Denos"],
    [],
    ["• Uma linha por registro. A primeira linha é o cabeçalho; os nomes das colunas podem mudar, a tela pergunta qual é qual."],
    alvo === "clientes"
      ? ["• Cliente com o mesmo CPF/CNPJ de um já cadastrado é ATUALIZADO (só os campos preenchidos). A aba Sócios é opcional."]
      : ["• O cliente precisa estar cadastrado (procuramos pelo CPF/CNPJ ou pelo nome exato). Certificado igual (cliente, tipo e validade) é pulado."],
    ["• Datas em DD/MM/AAAA. Apague as linhas de exemplo antes de enviar."],
    [],
    ["Coluna", "Obrigatória", "O que aceitamos"],
    ...abas.flatMap(([nome, campos]) => [[`Aba ${nome}`], ...campos.map((c) => [c.rotulo, c.obrigatorio ? "Sim" : "", c.ajuda ?? ""])]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(leia);
  ws["!cols"] = [{ wch: 32 }, { wch: 12 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, ws, "Leia-me");
  for (const [nome, campos] of abas) {
    const a = XLSX.utils.aoa_to_sheet([campos.map((c) => c.rotulo), campos.map((c) => c.exemplo)]);
    a["!cols"] = campos.map((c) => ({ wch: Math.max(c.rotulo.length + 4, 16) }));
    XLSX.utils.book_append_sheet(wb, a, nome);
  }
  XLSX.writeFile(wb, alvo === "clientes" ? "modelo-clientes-denos.xlsx" : "modelo-certificados-denos.xlsx");
}
