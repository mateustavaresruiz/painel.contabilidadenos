/**
 * Exportar para Excel (.xlsx) NO MESMO FORMATO da importação: as colunas têm
 * os nomes da planilha modelo (lib/importar-planilha.ts), então o caminho de
 * ida e volta é exportar → corrigir no Excel → importar de novo. Na volta, o
 * cliente é achado pelo CPF/CNPJ, o sócio pelo CPF (ou nome) e o certificado
 * por cliente + tipo + validade, e só as células preenchidas mudam o cadastro.
 *
 * Colunas "(só leitura)" vão no fim, para conferência; a importação ignora.
 * Chamados só exportam (relatório), não voltam.
 *
 * Tudo pagina de 1000 em 1000 (teto do PostgREST) e respeita a RLS de quem
 * exporta. A lib `xlsx` só baixa no clique (import dinâmico).
 */

import { formatDoc, formatTelefone, hojeISO, parsePgDate, parsePgTimestamp } from "@/lib/format";
import { CAMPOS_CERTIFICADO, CAMPOS_CLIENTE, CAMPOS_SOCIO, type Campo } from "@/lib/importar-planilha";
import { diasRestantes } from "@/lib/queries/certificados";
import { consultaClientes, nomeExibicao, type ClientesFilters } from "@/lib/queries/clientes";
import { STATUS_SOLICITACAO_LABEL, type SolicitacaoStatus } from "@/lib/queries/solicitacoes";
import { supabase } from "@/lib/supabase";
import { compararTexto } from "@/lib/texto";

type XLSXMod = typeof import("xlsx");
type Celula = string | number | null;
type Aba = { nome: string; cabecalho: string[]; linhas: Celula[][]; larguras?: number[] };

/**
 * Injeção de fórmula: texto que começa com `=`, `+`, `-`, `@`, tab ou CR vira
 * fórmula se alguém salvar como CSV ou editar a célula. O `'` na frente faz o
 * Excel tratar como texto.
 */
function celulaSegura(v: Celula): Celula {
  return typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

/** Data AAAA-MM-DD → DD/MM/AAAA (texto: é o que a importação lê, sem fuso). */
function dataBr(d: string | null | undefined): string {
  const x = parsePgDate(d ?? null);
  return x ? `${String(x.getDate()).padStart(2, "0")}/${String(x.getMonth() + 1).padStart(2, "0")}/${x.getFullYear()}` : "";
}

function dataHoraBr(ts: string | null | undefined): string {
  const d = parsePgTimestamp(ts);
  return d ? d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "";
}

const sn = (b: boolean | null | undefined) => (b ? "Sim" : "Não");

/** Todas as linhas de uma consulta, de 1000 em 1000, em ordem estável por id. */
async function paginar<T>(
  consulta: (de: number, ate: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw error;
    const pagina = (data ?? []) as T[];
    out.push(...pagina);
    if (pagina.length < 1000) return out;
  }
}

const rotulos = (campos: Campo[]) => campos.map((c) => c.rotulo);

// ---------------------------------------------------------------------------
// Clientes + sócios
// ---------------------------------------------------------------------------

type ClienteCompleto = {
  id: string;
  tipo: "PF" | "PJ";
  nome: string;
  nomeFantasia: string | null;
  cpfCnpj: string | null;
  email: string | null;
  telefone: string | null;
  regimeTributario: string | null;
  dataAbertura: string | null;
  dataNascimento: string | null;
  inscricaoEstadual: string | null;
  inscricaoMunicipal: string | null;
  cep: string | null;
  rua: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  observacoes: string | null;
  ativo: boolean;
  provisorio?: boolean | null;
  criadoEm: string;
};

type SocioLinha = {
  id: string;
  clienteId: string;
  nome: string;
  cpf: string | null;
  dataNascimento: string | null;
  telefone: string | null;
  email: string | null;
  participacao: number | null;
  administrador: boolean;
};

/** Como a planilha aponta o cliente (sócio, certificado): o CPF/CNPJ, ou o nome se não tiver. */
const refCliente = (c: { nome: string; cpfCnpj: string | null } | null | undefined) =>
  c ? (c.cpfCnpj ? formatDoc(c.cpfCnpj) : c.nome) : "";

async function abasClientes(filters: ClientesFilters): Promise<Aba[]> {
  const clientes = (
    await paginar<ClienteCompleto>((de, ate) =>
      consultaClientes(filters, "*").order("id", { ascending: true }).range(de, ate),
    )
  ).sort((a, b) => compararTexto(nomeExibicao(a), nomeExibicao(b)));

  // Sócios dos clientes exportados (fatias de 200 ids no .in, URL curta).
  const ids = clientes.map((c) => c.id);
  const socios: SocioLinha[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const fatia = ids.slice(i, i + 200);
    socios.push(
      ...(await paginar<SocioLinha>((de, ate) =>
        supabase
          .from("Socio")
          .select("id, clienteId, nome, cpf, dataNascimento, telefone, email, participacao, administrador")
          .in("clienteId", fatia)
          .order("id", { ascending: true })
          .range(de, ate),
      )),
    );
  }
  const porId = new Map(clientes.map((c) => [c.id, c]));

  const valorCliente: Record<string, (c: ClienteCompleto) => Celula> = {
    tipo: (c) => c.tipo,
    nome: (c) => c.nome,
    nomeFantasia: (c) => c.nomeFantasia,
    cpfCnpj: (c) => (c.cpfCnpj ? formatDoc(c.cpfCnpj) : ""),
    email: (c) => c.email,
    telefone: (c) => (c.telefone ? formatTelefone(c.telefone) : ""),
    regimeTributario: (c) => c.regimeTributario,
    dataAbertura: (c) => dataBr(c.dataAbertura),
    dataNascimento: (c) => dataBr(c.dataNascimento),
    inscricaoEstadual: (c) => c.inscricaoEstadual,
    inscricaoMunicipal: (c) => c.inscricaoMunicipal,
    cep: (c) => c.cep,
    rua: (c) => c.rua,
    numero: (c) => c.numero,
    complemento: (c) => c.complemento,
    bairro: (c) => c.bairro,
    cidade: (c) => c.cidade,
    estado: (c) => c.estado,
    observacoes: (c) => c.observacoes,
    _id: (c) => c.id,
  };
  const valorSocio: Record<string, (s: SocioLinha) => Celula> = {
    _cliente: (s) => refCliente(porId.get(s.clienteId)),
    nome: (s) => s.nome,
    cpf: (s) => (s.cpf ? formatDoc(s.cpf) : ""),
    dataNascimento: (s) => dataBr(s.dataNascimento),
    telefone: (s) => (s.telefone ? formatTelefone(s.telefone) : ""),
    email: (s) => s.email,
    participacao: (s) => (s.participacao != null ? Number(s.participacao) : null),
    administrador: (s) => sn(s.administrador),
    _id: (s) => s.id,
  };

  return [
    {
      nome: "Clientes",
      cabecalho: [...rotulos(CAMPOS_CLIENTE), "Ativo (só leitura)", "Cadastrado em (só leitura)"],
      linhas: clientes.map((c) => [
        ...CAMPOS_CLIENTE.map((f) => valorCliente[f.campo]?.(c) ?? null),
        sn(c.ativo),
        dataHoraBr(c.criadoEm),
      ]),
    },
    {
      nome: "Sócios",
      cabecalho: [...rotulos(CAMPOS_SOCIO), "Empresa (só leitura)"],
      linhas: socios
        .map((s) => [
          ...CAMPOS_SOCIO.map((f) => valorSocio[f.campo]?.(s) ?? null),
          porId.get(s.clienteId) ? nomeExibicao(porId.get(s.clienteId)!) : "",
        ])
        .sort((a, b) => compararTexto(String(a.at(-1)), String(b.at(-1)))),
    },
  ];
}

// ---------------------------------------------------------------------------
// Certificados
// ---------------------------------------------------------------------------

type CertLinha = {
  id: string;
  tipo: string;
  validoAte: string;
  titular: string | null;
  documento: string | null;
  emissora: string | null;
  emitidoEm: string | null;
  telefoneAviso: string | null;
  observacoes: string | null;
  avisarWhatsapp: boolean;
  renovadoPorId: string | null;
  cliente: { nome: string; nomeFantasia: string | null; cpfCnpj: string | null } | null;
};

function situacaoCert(c: CertLinha): string {
  if (c.renovadoPorId) return "Renovado";
  const d = diasRestantes(c.validoAte);
  if (d < 0) return "Vencido";
  if (d === 0) return "Vence hoje";
  return d <= 30 ? `Vence em ${d} dias` : "Em dia";
}

async function abaCertificados(): Promise<Aba> {
  const certs = await paginar<CertLinha>((de, ate) =>
    supabase
      .from("CertificadoDigital")
      .select(
        "id, tipo, validoAte, titular, documento, emissora, emitidoEm, telefoneAviso, observacoes, avisarWhatsapp, renovadoPorId, cliente:Cliente(nome, nomeFantasia, cpfCnpj)",
      )
      .order("validoAte", { ascending: true })
      .order("id", { ascending: true })
      .range(de, ate),
  );
  const valor: Record<string, (c: CertLinha) => Celula> = {
    _cliente: (c) => refCliente(c.cliente),
    tipo: (c) => c.tipo,
    validoAte: (c) => dataBr(c.validoAte),
    titular: (c) => c.titular,
    documento: (c) => (c.documento ? formatDoc(c.documento) : ""),
    emissora: (c) => c.emissora,
    emitidoEm: (c) => dataBr(c.emitidoEm),
    telefoneAviso: (c) => (c.telefoneAviso ? formatTelefone(c.telefoneAviso) : ""),
    observacoes: (c) => c.observacoes,
    _id: (c) => c.id,
  };
  return {
    nome: "Certificados",
    cabecalho: [...rotulos(CAMPOS_CERTIFICADO), "Nome do cliente (só leitura)", "Situação (só leitura)", "Aviso no WhatsApp (só leitura)"],
    linhas: certs.map((c) => [
      ...CAMPOS_CERTIFICADO.map((f) => valor[f.campo]?.(c) ?? null),
      c.cliente ? nomeExibicao(c.cliente) : "",
      situacaoCert(c),
      sn(c.avisarWhatsapp),
    ]),
  };
}

// ---------------------------------------------------------------------------
// Chamados (só exportação)
// ---------------------------------------------------------------------------

type ChamadoLinha = {
  criadoEm: string;
  status: SolicitacaoStatus;
  descricao: string | null;
  prazo: string | null;
  concluidaEm: string | null;
  responsavelId: string | null;
  origem?: string | null;
  tipo: { nome: string } | null;
  cliente: { nome: string; nomeFantasia: string | null; cpfCnpj: string | null } | null;
};

async function abaChamados(): Promise<Aba> {
  const [chamados, { data: equipe }] = await Promise.all([
    paginar<ChamadoLinha>((de, ate) =>
      supabase
        .from("Solicitacao")
        .select("*, tipo:SolicitacaoTipo(nome), cliente:Cliente(nome, nomeFantasia, cpfCnpj)")
        .order("criadoEm", { ascending: false })
        .order("id", { ascending: true })
        .range(de, ate),
    ),
    supabase.from("Colaborador").select("id, nome"),
  ]);
  const nomeDe = new Map(((equipe ?? []) as Array<{ id: string; nome: string }>).map((c) => [c.id, c.nome]));
  const ORIGEM: Record<string, string> = { painel: "Painel", whatsapp: "WhatsApp", portal: "Portal do cliente" };
  return {
    nome: "Chamados",
    cabecalho: ["Aberto em", "Tipo", "Cliente", "CPF/CNPJ", "Status", "Responsável", "Prazo", "Concluído em", "Origem", "Descrição"],
    larguras: [16, 28, 36, 20, 14, 20, 12, 16, 16, 60],
    linhas: chamados.map((s) => [
      dataHoraBr(s.criadoEm),
      s.tipo?.nome ?? "",
      s.cliente ? nomeExibicao(s.cliente) : "",
      s.cliente?.cpfCnpj ? formatDoc(s.cliente.cpfCnpj) : "",
      STATUS_SOLICITACAO_LABEL[s.status] ?? s.status,
      s.responsavelId ? (nomeDe.get(s.responsavelId) ?? "") : "",
      dataBr(s.prazo),
      dataHoraBr(s.concluidaEm),
      s.origem ? (ORIGEM[s.origem] ?? s.origem) : "",
      s.descricao,
    ]),
  };
}

// ---------------------------------------------------------------------------
// Montagem do arquivo
// ---------------------------------------------------------------------------

function leiaMe(abas: string[]): Aba {
  const texto: string[] = [
    `Exportado do Painel NÓS em ${new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}.`,
    "",
    "Para corrigir em lote: edite as abas e importe este mesmo arquivo de volta (Configurações > Importar e exportar, ou o botão Importar planilha nas telas de Clientes e de Certificados).",
    "• A coluna \"ID (não altere)\" é como o painel acha cada registro na volta. Não mude nem apague. Para incluir alguém novo, use uma linha nova com o ID em branco.",
  ];
  if (abas.includes("Clientes"))
    texto.push(
      "• Clientes: achados pelo ID (ou pelo CPF/CNPJ, em linha nova). Só as células preenchidas mudam o cadastro (apagar uma célula NÃO apaga o dado).",
      "• Sócios: achados pelo ID (ou pelo CPF, ou pelo nome) dentro da empresa da coluna \"CNPJ da empresa\".",
    );
  if (abas.includes("Certificados"))
    texto.push(
      "• Certificados: achados pelo ID; com ele, dá para corrigir até a validade. Certificado renovado (novo) entra numa linha nova, ou pelo botão Renovar na tela.",
    );
  if (abas.includes("Chamados")) texto.push("• Chamados: só para consulta e relatório; não voltam na importação.");
  texto.push("• Colunas \"(só leitura)\" são para conferência e são ignoradas na importação.", "• Datas em DD/MM/AAAA.");
  return { nome: "Leia-me", cabecalho: ["Como usar"], linhas: texto.map((t) => [t]), larguras: [120] };
}

function escrever(XLSX: XLSXMod, abas: Aba[], arquivo: string) {
  const wb = XLSX.utils.book_new();
  for (const a of abas) {
    const ws = XLSX.utils.aoa_to_sheet([a.cabecalho, ...a.linhas.map((l) => l.map(celulaSegura))]);
    ws["!cols"] = (a.larguras ?? a.cabecalho.map((h) => Math.min(Math.max(h.length + 4, 14), 40))).map((wch) => ({ wch }));
    if (a.nome !== "Leia-me" && ws["!ref"]) ws["!autofilter"] = { ref: ws["!ref"] };
    XLSX.utils.book_append_sheet(wb, ws, a.nome);
  }
  XLSX.writeFile(wb, arquivo);
}

export type Exportacao = "clientes" | "certificados" | "chamados";

/**
 * Baixa o .xlsx do que foi pedido. `clientes` leva as abas Clientes e Sócios
 * (com os filtros da tela, se vierem). Devolve quantas linhas saíram por aba.
 */
export async function exportar(
  o: { incluir: Exportacao[]; filtrosClientes?: ClientesFilters },
): Promise<Record<string, number>> {
  const XLSXp = import("xlsx");
  const abas: Aba[] = [];
  if (o.incluir.includes("clientes")) abas.push(...(await abasClientes(o.filtrosClientes ?? { situacao: "todos" })));
  if (o.incluir.includes("certificados")) abas.push(await abaCertificados());
  if (o.incluir.includes("chamados")) abas.push(await abaChamados());
  const XLSX = await XLSXp;
  const nome =
    o.incluir.length > 1 ? "painel-nos" : o.incluir[0] === "clientes" ? "clientes-e-socios" : o.incluir[0]!;
  escrever(XLSX, [leiaMe(abas.map((a) => a.nome)), ...abas], `${nome}-${hojeISO()}.xlsx`);
  return Object.fromEntries(abas.map((a) => [a.nome, a.linhas.length]));
}
