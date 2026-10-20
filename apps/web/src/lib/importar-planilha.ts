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
import { CNPJ_RE, CPF_RE, isValidCpf, isValidCpfCnpj, isValidTelefone, maskTelefone, normalizarDoc } from "@/lib/masks";

export type Campo = {
  campo: string;
  rotulo: string;
  obrigatorio?: boolean;
  /** Outros cabeçalhos que querem dizer a mesma coisa (sem acento, minúsculo). */
  sinonimos: string[];
  exemplo: string;
  ajuda?: string;
};

/**
 * Coluna que a EXPORTAÇÃO preenche (lib/exportar.ts): na volta, é por ela que o
 * registro é achado, mesmo que o CPF/CNPJ, o CPF do sócio ou o nome tenham
 * sido corrigidos na planilha. Linha nova vai com ela em branco.
 */
const CAMPO_ID: Campo = {
  campo: "_id",
  rotulo: "ID (não altere)",
  sinonimos: ["id"],
  exemplo: "",
  ajuda: "Vem preenchida nas planilhas exportadas pelo painel: é como ele acha o registro na volta. Em linha nova, deixe em branco.",
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
  CAMPO_ID,
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
  CAMPO_ID,
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
  CAMPO_ID,
];

// ---------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------

export function normalizar(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
export const soDigitos = (s: string) => s.replace(/\D/g, "");
/**
 * CPF/CNPJ normalizado (normalizarDoc: maiúsculas, sem pontuação; as letras do
 * CNPJ alfanumérico ficam). Sem nenhum dígito ("N/A", "não tem") é célula
 * vazia, como antes. Só número que o Excel guardou como número perde os zeros
 * à esquerda: devolve.
 */
export const docDigitos = (s: string) => {
  const d = normalizarDoc(s);
  if (!/\d/.test(d)) return "";
  if (!/^\d+$/.test(d)) return d;
  if (d.length === 9 || d.length === 10) return d.padStart(11, "0");
  if (d.length === 12 || d.length === 13) return d.padStart(14, "0");
  return d;
};
/** Tem forma de documento (CPF de 11 dígitos ou CNPJ de 14 caracteres)? Nome não passa. */
const pareceDoc = (d: string) => CPF_RE.test(d) || CNPJ_RE.test(d);

function celulaParaTexto(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  // A exportação põe um ' antes de texto que começa com = + - @ (proteção
  // contra fórmula); na volta ele sai, senão o dado ganharia o apóstrofo.
  return String(v).trim().replace(/^'(?=[=+\-@\t\r])/, "");
}

/** Hoje em AAAA-MM-DD, no fuso de quem está importando. */
function hojeIso(agora: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`;
}

/**
 * DD/MM/AAAA (ou "-"/".") e AAAA-MM-DD → AAAA-MM-DD. Vazio: "". Data que não
 * existe no calendário (31/02, ISO "2023-02-30"): "invalida" — o banco recusaria
 * e derrubaria o lote. Ano com 2 dígitos usa pivô no ano corrente: "15/03/98" é
 * 1998, "15/03/15" é 2015. Sem `futuro`, data depois de hoje (nascimento,
 * abertura, emissão) é "futura"; com `futuro` (validade), o ano de 2 dígitos é
 * sempre 20AA.
 */
export function normalizarData(v: string, opts: { futuro?: boolean; hoje?: Date } = {}): string {
  const t = v.trim();
  if (!t) return "";
  const agora = opts.hoje ?? new Date();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const br = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/);
  let ano: number, mes: number, dia: number;
  if (iso) [ano, mes, dia] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (br) {
    [dia, mes, ano] = [Number(br[1]), Number(br[2]), Number(br[3])];
    if (br[3]!.length === 2) ano += opts.futuro || ano <= agora.getFullYear() % 100 ? 2000 : 1900;
  } else return "invalida";
  if (ano < 1900 || ano > 2199) return "invalida";
  const dt = new Date(Date.UTC(ano, mes - 1, dia));
  if (dt.getUTCFullYear() !== ano || dt.getUTCMonth() !== mes - 1 || dt.getUTCDate() !== dia) return "invalida";
  const out = `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
  if (!opts.futuro && out > hojeIso(agora)) return "futura";
  return out;
}

/** Mensagem da célula de data que não passou (vazio quando passou). */
function erroData(rotulo: string, d: string): string {
  if (d === "invalida") return `${rotulo}: data inválida, use DD/MM/AAAA`;
  if (d === "futura") return `${rotulo}: data no futuro`;
  return "";
}

/**
 * Telefone como a planilha costuma trazer: "+55 (11) 98765-4321", "0055…" ou
 * "5511987654321" perdem o DDI 55 (o cadastro guarda DDD + número; o banco põe
 * o 55 de volta ao normalizar). Sem DDI, volta como veio.
 */
export function telefoneSemDdi(v: string): string {
  const t = v.trim();
  let d = soDigitos(t);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return maskTelefone(d.slice(2));
  return t;
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
    // Sem cellDates: o Date do SheetJS nasce no fuso do navegador (com o
    // horário de verão e o LMT antigo de São Paulo) e a data podia cair um dia
    // antes. A célula de data vira AAAA-MM-DD direto do número de série.
    wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellNF: true });
    const date1904 = !!wb.Workbook?.WBProps?.date1904;
    for (const nome of wb.SheetNames) {
      const ws = wb.Sheets[nome]!;
      for (const ref of Object.keys(ws)) {
        if (ref.startsWith("!")) continue;
        const cel = ws[ref] as { t?: string; v?: unknown; z?: unknown; w?: string };
        if (cel.t !== "n" || typeof cel.v !== "number" || typeof cel.z !== "string" || !XLSX.SSF.is_date(cel.z)) continue;
        const p = XLSX.SSF.parse_date_code(cel.v, { date1904 }) as { y: number; m: number; d: number } | null;
        if (!p) continue;
        cel.t = "s";
        cel.v = `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
        delete cel.w;
      }
    }
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

export type ClienteExistente = {
  id: string;
  nome: string;
  nomeFantasia: string | null;
  cpfCnpj: string | null;
  tipo: "PF" | "PJ";
  /** Cadastro provisório (criado pelo WhatsApp): a planilha completa em vez de duplicar. */
  provisorio?: boolean;
  telefoneNormalizado?: string | null;
  email?: string | null;
};

/** Mesmo critério de public.normalizar_telefone (migration 001): só dígitos; 10/11 dígitos ganham o 55. */
export function normalizarTelefone(v: string): string {
  const d = soDigitos(v);
  return d.length === 10 || d.length === 11 ? "55" + d : d;
}

/**
 * Variantes do telefone normalizado tolerando o 9º dígito, como
 * public.cliente_por_telefone: 55DD8XXXXXXX casa com 55DD98XXXXXXX e vice-versa.
 */
export function variantesTelefone(norm: string): string[] {
  if (norm.length === 12) return [norm, norm.slice(0, 4) + "9" + norm.slice(4)];
  if (norm.length === 13) return [norm, norm.slice(0, 4) + norm.slice(5)];
  return norm ? [norm] : [];
}

export type LinhaCliente = {
  linha: number;
  nome: string;
  doc: string;
  dados?: ClienteInput;
  erros: string[];
  acao?: "criar" | "atualizar" | "repetida";
  existenteId?: string;
  /** O "atualizar" é de um cadastro provisório achado pelo telefone (a planilha completa). */
  completaProvisorio?: boolean;
  /**
   * Linha sem CPF/CNPJ parecida com um cadastro: pelo nome e pelo telefone ou
   * e-mail (atualiza esse em vez de criar outro a cada reimportação), ou só
   * pelo nome (cria, mas avisa). Texto do aviso.
   */
  possivelDuplicado?: string;
  /**
   * Casou pelo NOME (sem CPF/CNPJ nem ID): nome e fantasia da planilha não
   * regravam o cadastro (a planilha pode ter o fantasia onde está a razão social).
   */
  manterNome?: boolean;
};

function resolverTipo(v: string, doc: string): "PF" | "PJ" | "" {
  const n = normalizar(v);
  if (["pf", "f", "fisica", "pessoa fisica"].includes(n)) return "PF";
  if (["pj", "j", "juridica", "pessoa juridica", "empresa"].includes(n)) return "PJ";
  if (n) return "";
  return CPF_RE.test(normalizarDoc(doc)) ? "PF" : "PJ";
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
  const porDoc = new Map(existentes.filter((e) => e.cpfCnpj).map((e) => [normalizarDoc(e.cpfCnpj!), e]));
  const porId = new Map(existentes.map((e) => [e.id, e]));
  // Provisórios (criados pelo WhatsApp, sem CPF/CNPJ) pelo telefone
  // normalizado. Dois provisórios com o mesmo telefone = ambíguo, não casa.
  const provPorTel = new Map<string, ClienteExistente | null>();
  for (const e of existentes) {
    if (!e.provisorio || e.cpfCnpj || !e.telefoneNormalizado) continue;
    const k = e.telefoneNormalizado;
    provPorTel.set(k, provPorTel.has(k) && provPorTel.get(k)?.id !== e.id ? null : e);
  }
  const provUsados = new Set<string>();
  const acharProvisorio = (tel: string): ClienteExistente | undefined => {
    const achados = new Set<ClienteExistente>();
    for (const v of variantesTelefone(normalizarTelefone(tel))) {
      if (!provPorTel.has(v)) continue;
      const e = provPorTel.get(v);
      if (!e) return undefined; // ambíguo
      achados.add(e);
    }
    if (achados.size !== 1) return undefined;
    const [e] = [...achados];
    return e && !provUsados.has(e.id) ? e : undefined;
  };
  // Sem CPF/CNPJ, a chave é o nome normalizado: com o mesmo telefone ou
  // e-mail é o mesmo cadastro (reimportar não duplica).
  const porNome = new Map<string, ClienteExistente[]>();
  for (const e of existentes) {
    for (const n of new Set([e.nome, e.nomeFantasia].filter((x): x is string => !!x).map(normalizar))) {
      porNome.set(n, [...(porNome.get(n) ?? []), e]);
    }
  }
  const semDocUsados = new Set<string>();
  const acharSemDoc = (nome: string, telNorm: string, mail: string) => {
    const candidatos = (porNome.get(normalizar(nome)) ?? []).filter((e) => !semDocUsados.has(e.id));
    const tels = new Set(variantesTelefone(telNorm));
    const casa = (e: ClienteExistente) =>
      (!!e.telefoneNormalizado && tels.has(e.telefoneNormalizado)) || (!!mail && e.email?.trim().toLowerCase() === mail);
    const fortes = candidatos.filter(casa);
    return { forte: fortes.length === 1 ? fortes[0] : undefined, ambiguo: fortes.length > 1, soNome: candidatos[0] };
  };
  const vistos = new Map<string, number>();
  return linhas.map(({ linha, c }) => {
    const doc = docDigitos(c.cpfCnpj ?? "");
    const item: LinhaCliente = { linha, nome: c.nome ?? "", doc, erros: [] };
    const datas: Record<string, string> = {};
    for (const k of ["dataAbertura", "dataNascimento"]) {
      const d = normalizarData(c[k] ?? "");
      const erro = erroData(k === "dataAbertura" ? "Data de abertura" : "Data de nascimento", d);
      if (erro) item.erros.push(erro);
      else datas[k] = d;
    }
    const parsed = clienteSchema.safeParse({
      ...c,
      telefone: telefoneSemDdi(c.telefone ?? ""),
      cpfCnpj: doc,
      // Data inválida já foi apontada acima: não repete o erro pelo zod (usa só a válida).
      dataAbertura: undefined,
      dataNascimento: undefined,
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
    // Repetida na própria planilha: pelo documento ou, sem documento, pelo
    // nome com o mesmo telefone ou e-mail.
    const telNorm = item.dados?.telefone ? normalizarTelefone(item.dados.telefone) : "";
    const mail = item.dados?.email?.trim().toLowerCase() ?? "";
    const nomeN = normalizar(item.nome);
    const chaves = doc ? [doc] : [telNorm && `n:${nomeN}|t:${telNorm}`, mail && `n:${nomeN}|e:${mail}`].filter(Boolean);
    const repetidaDe = chaves.map((k) => vistos.get(k)).find((x) => x != null);
    if (repetidaDe != null) {
      item.acao = "repetida";
      item.erros.push(doc ? `Documento repetido (linha ${repetidaDe})` : `Mesmo nome e contato da linha ${repetidaDe}`);
    } else for (const k of chaves) vistos.set(k, linha);
    // Planilha exportada pelo painel: o ID manda (o CPF/CNPJ pode ter sido
    // completado ou corrigido nela).
    const idInf = (c._id ?? "").trim();
    if (!item.acao && idInf && item.dados) {
      const ex = porId.get(idInf);
      const dono = doc ? porDoc.get(doc) : undefined;
      if (!ex) item.erros.push("ID não encontrado (o cliente foi apagado?). Para criar de novo, apague o ID da linha");
      else if (dono && dono.id !== ex.id) item.erros.push(`Este CPF/CNPJ já é de outro cliente (${dono.nomeFantasia || dono.nome})`);
      else {
        item.acao = "atualizar";
        item.existenteId = ex.id;
        semDocUsados.add(ex.id);
        return item;
      }
    }
    if (!item.acao && !doc && item.dados) {
      const { forte, ambiguo, soNome } = acharSemDoc(item.nome, telNorm, mail);
      // Provisório sem documento segue o caminho de sempre (completar pelo telefone).
      if (forte && !(forte.provisorio && !forte.cpfCnpj)) {
        semDocUsados.add(forte.id);
        const peloTel = !!forte.telefoneNormalizado && variantesTelefone(telNorm).includes(forte.telefoneNormalizado);
        item.acao = "atualizar";
        item.existenteId = forte.id;
        item.manterNome = true;
        item.possivelDuplicado = `Mesmo nome e ${peloTel ? "telefone" : "e-mail"} de um cadastro: atualiza esse em vez de criar outro`;
        return item;
      }
      if (ambiguo) item.possivelDuplicado = "Mais de um cadastro com este nome e contato: será criado um novo";
      else if (!forte && soNome) item.possivelDuplicado = `Já existe "${soNome.nomeFantasia || soNome.nome}" sem CPF/CNPJ para confirmar: será criado um novo`;
    }
    if (!item.acao) {
      const ex = doc ? porDoc.get(doc) : undefined;
      // Documento novo (ou sem documento): o telefone pode ser de um cadastro
      // provisório criado pelo WhatsApp. Completa-o em vez de duplicar.
      const prov = !ex && item.dados?.telefone ? acharProvisorio(item.dados.telefone) : undefined;
      if (prov) provUsados.add(prov.id);
      const alvo = ex ?? prov;
      item.acao = alvo ? "atualizar" : "criar";
      item.existenteId = alvo?.id;
      item.completaProvisorio = !!prov;
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
  /** A célula Administrador veio preenchida (vazia não muda o sócio que já existe). */
  adminInformado?: boolean;
  /** Coluna ID da planilha exportada. */
  idInformado?: string;
  /** Sócio já cadastrado que esta linha atualiza (casarSocios). */
  existenteId?: string;
};

export type SocioExistente = { id: string; clienteId: string; nome: string; cpf: string | null };

/**
 * Acha o sócio já cadastrado de cada linha, dentro da MESMA empresa: pelo ID
 * (planilha exportada), senão pelo CPF, senão pelo nome (só se for um só).
 * Completar ou corrigir o CPF no Excel não cria um segundo sócio.
 */
export function casarSocios(linhas: LinhaSocio[], ja: SocioExistente[]): void {
  const porId = new Map(ja.map((s) => [s.id, s]));
  const usados = new Set<string>();
  for (const l of linhas) {
    if (!l.dados || !l.clienteId) continue; // empresa nova nesta importação: sem sócios ainda
    const daEmpresa = ja.filter((s) => s.clienteId === l.clienteId && !usados.has(s.id));
    let achado = l.idInformado ? porId.get(l.idInformado) : undefined;
    if (achado && (achado.clienteId !== l.clienteId || usados.has(achado.id))) achado = undefined;
    if (!achado && l.dados.cpf) achado = daEmpresa.find((s) => s.cpf === l.dados!.cpf);
    if (!achado) {
      const n = normalizar(l.dados.nome);
      const mesmos = daEmpresa.filter((s) => normalizar(s.nome) === n);
      if (mesmos.length === 1) achado = mesmos[0];
    }
    if (achado) {
      l.existenteId = achado.id;
      usados.add(achado.id);
    }
  }
}

type Achador = (busca: string) => { id?: string; docNovo?: string; nome: string } | null;

export function criarAchador(existentes: ClienteExistente[], novos: LinhaCliente[] = []): Achador {
  const porDoc = new Map(existentes.filter((e) => e.cpfCnpj).map((e) => [normalizarDoc(e.cpfCnpj!), e]));
  const porNome = new Map<string, ClienteExistente | null>();
  for (const e of existentes) {
    for (const n of [e.nome, e.nomeFantasia]) {
      if (!n) continue;
      const k = normalizar(n);
      porNome.set(k, porNome.has(k) && porNome.get(k)?.id !== e.id ? null : e); // null = ambíguo
    }
  }
  const novosPorDoc = new Map(novos.filter((n) => n.dados && n.doc && n.acao === "criar").map((n) => [n.doc, n]));
  // Provisório que a planilha completa ganha o documento nesta importação:
  // o sócio que aponta para esse CNPJ vai para o cadastro existente.
  const completadosPorDoc = new Map(
    novos.filter((n) => n.dados && n.doc && n.completaProvisorio && n.existenteId).map((n) => [n.doc, n]),
  );
  const novosPorNome = new Map(novos.filter((n) => n.dados && n.acao === "criar").map((n) => [normalizar(n.nome), n]));
  return (busca) => {
    const d = docDigitos(busca);
    if (pareceDoc(d)) {
      const e = porDoc.get(d);
      if (e) return { id: e.id, nome: e.nomeFantasia || e.nome };
      const n = novosPorDoc.get(d);
      if (n) return { docNovo: d, nome: n.nome };
      const p = completadosPorDoc.get(d);
      if (p) return { id: p.existenteId!, nome: p.nome };
      // Documento de verdade que não está em lugar nenhum: não achou. Sem DV
      // válido pode ser nome com cara de CNPJ alfanumérico: tenta pelo nome.
      if (isValidCpfCnpj(d)) return null;
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
    const erroNasc = erroData("Nascimento", nasc);
    if (erroNasc) item.erros.push(erroNasc);
    const tel = telefoneSemDdi(c.telefone ?? "");
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
      item.adminInformado = (c.administrador ?? "").trim() !== "";
      item.idInformado = (c._id ?? "").trim() || undefined;
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
  /** Repetido DENTRO da planilha (mesmo cliente, tipo e validade): fica de fora. */
  repetido?: boolean;
  /** Já cadastrado (mesmo cliente, tipo e validade): atualiza só o que veio preenchido. */
  existenteId?: string;
  /** Achado pela coluna ID: aí tipo e validade também podem ser corrigidos. */
  porId?: boolean;
};

function resolverTipoCert(v: string, doc: string): TipoCertificado | null {
  const n = normalizar(v);
  const pf = CPF_RE.test(normalizarDoc(doc));
  if (!n) return pf ? "e-CPF A1" : "e-CNPJ A1";
  const exato = TIPOS_CERTIFICADO.find((t) => normalizar(t) === n);
  if (exato) return exato;
  const a3 = n.includes("a3");
  if (n.includes("cpf")) return a3 ? "e-CPF A3" : "e-CPF A1";
  if (n.includes("cnpj")) return a3 ? "e-CNPJ A3" : "e-CNPJ A1";
  if (n.includes("nf")) return "NF-e";
  if (n === "a1") return pf ? "e-CPF A1" : "e-CNPJ A1";
  if (n === "a3") return pf ? "e-CPF A3" : "e-CNPJ A3";
  return null;
}

export function validarCertificados(
  linhas: Array<{ linha: number; c: Record<string, string> }>,
  existentes: ClienteExistente[],
  jaCadastrados: Array<{ id: string; clienteId: string; tipo: string; validoAte: string }>,
): LinhaCertificado[] {
  const achar = criarAchador(existentes);
  const docDe = new Map(existentes.map((e) => [e.id, e.cpfCnpj ?? ""]));
  const chave = (c: string, t: string, v: string) => `${c}|${t}|${v}`;
  // A planilha exportada pelo painel volta com os mesmos certificados: esses
  // atualizam (titular, emissora, telefone...) em vez de ficarem de fora.
  const noBanco = new Map(jaCadastrados.map((j) => [chave(j.clienteId, j.tipo, j.validoAte), j.id]));
  const porIdCert = new Map(jaCadastrados.map((j) => [j.id, j]));
  const naPlanilha = new Set<string>();
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
    const validoAte = normalizarData(c.validoAte ?? "", { futuro: true });
    if (!validoAte) item.erros.push("Válido até: obrigatório");
    else if (validoAte === "invalida") item.erros.push(erroData("Válido até", validoAte));
    const emitidoEm = normalizarData(c.emitidoEm ?? "");
    const erroEmissao = erroData("Emitido em", emitidoEm);
    if (erroEmissao) item.erros.push(erroEmissao);
    const tipo = resolverTipoCert(c.tipo ?? "", docDe.get(item.clienteId ?? "") ?? "");
    if (!tipo) item.erros.push(`Tipo: use ${TIPOS_CERTIFICADO.join(", ")}`);
    const tel = telefoneSemDdi(c.telefoneAviso ?? "");
    if (tel && !isValidTelefone(tel)) item.erros.push("Telefone para aviso inválido");
    if (item.erros.length === 0 && tipo && item.clienteId) {
      const k = chave(item.clienteId, tipo, validoAte);
      const idInf = (c._id ?? "").trim();
      const peloId = idInf ? porIdCert.get(idInf) : undefined;
      if (idInf && (!peloId || peloId.clienteId !== item.clienteId)) {
        item.erros.push("ID não encontrado para este cliente (o certificado foi apagado?). Para criar de novo, apague o ID da linha");
        return item;
      }
      if (naPlanilha.has(k)) item.repetido = true;
      else if (peloId) {
        item.existenteId = peloId.id;
        item.porId = true;
      } else item.existenteId = noBanco.get(k);
      naPlanilha.add(k);
      item.dados = {
        tipo,
        validoAte,
        titular: c.titular?.trim() || null,
        documento: normalizarDoc(c.documento ?? "") || null,
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
    [alvo === "clientes" ? "Importar clientes e sócios no Painel NÓS" : "Importar certificados digitais no Painel NÓS"],
    [],
    ["• Uma linha por registro. A primeira linha é o cabeçalho; os nomes das colunas podem mudar, a tela pergunta qual é qual."],
    alvo === "clientes"
      ? ["• Cliente com o mesmo CPF/CNPJ de um já cadastrado é ATUALIZADO (só os campos preenchidos). Cadastro provisório criado pelo WhatsApp com o mesmo telefone é COMPLETADO. A aba Sócios é opcional."]
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
