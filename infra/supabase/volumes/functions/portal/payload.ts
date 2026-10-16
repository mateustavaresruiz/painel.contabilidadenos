// Montagem do que o portal PÚBLICO mostra ao cliente. Funções puras: cada campo
// que sai por aqui é escolhido a dedo (lista branca). Nada de `select *` nem de
// espalhar a linha do banco na resposta: o dia em que uma coluna interna
// nascer (observações, e-mail de funcionário, comentário), ela não vaza.

export type StatusChamado = "aberta" | "em_andamento" | "concluida" | "cancelada";

export type ChamadoRow = {
  status: string;
  descricao: string | null;
  prazo: string | null;
  concluidaEm: string | null;
  criadoEm: string;
  origem: string;
  tipoNome: string | null;
};

export type Etapa = { chave: "recebido" | "andamento" | "concluido" | "cancelado"; rotulo: string; feito: boolean; atual: boolean; em: string | null };

export type ChamadoPublico = {
  tipo: string;
  status: StatusChamado;
  statusRotulo: string;
  criadoEm: string;
  prazo: string | null;
  concluidaEm: string | null;
  /** Só o texto que o PRÓPRIO cliente escreveu pelo portal; descrição de chamado interno nunca sai. */
  descricao: string | null;
  doPortal: boolean;
  etapas: Etapa[];
};

const STATUS_VALIDOS: StatusChamado[] = ["aberta", "em_andamento", "concluida", "cancelada"];

export const ROTULO_STATUS: Record<StatusChamado, string> = {
  aberta: "Recebido",
  em_andamento: "Em andamento",
  concluida: "Concluído",
  cancelada: "Cancelado",
};

/** Linha do tempo segura: criado → em andamento → concluído. Sem quem fez nem comentário interno. */
export function etapasDoChamado(status: StatusChamado, criadoEm: string, concluidaEm: string | null): Etapa[] {
  if (status === "cancelada") {
    return [
      { chave: "recebido", rotulo: "Recebido", feito: true, atual: false, em: criadoEm },
      { chave: "cancelado", rotulo: "Cancelado", feito: true, atual: true, em: null },
    ];
  }
  const andamento = status === "em_andamento" || status === "concluida";
  return [
    { chave: "recebido", rotulo: "Recebido", feito: true, atual: status === "aberta", em: criadoEm },
    { chave: "andamento", rotulo: "Em andamento", feito: andamento, atual: status === "em_andamento", em: null },
    { chave: "concluido", rotulo: "Concluído", feito: status === "concluida", atual: status === "concluida", em: status === "concluida" ? concluidaEm : null },
  ];
}

export function chamadoPublico(r: ChamadoRow): ChamadoPublico {
  const status = (STATUS_VALIDOS as string[]).includes(r.status) ? (r.status as StatusChamado) : "aberta";
  const doPortal = r.origem === "portal";
  return {
    tipo: r.tipoNome ?? "Solicitação",
    status,
    statusRotulo: ROTULO_STATUS[status],
    criadoEm: r.criadoEm,
    prazo: r.prazo,
    concluidaEm: r.concluidaEm,
    descricao: doPortal ? r.descricao : null,
    doPortal,
    etapas: etapasDoChamado(status, r.criadoEm, r.concluidaEm),
  };
}

// ---------------------------------------------------------------------------
// Certificados
// ---------------------------------------------------------------------------

export type CertRow = { tipo: string; validoAte: string };
export type CertPublico = { tipo: string; validoAte: string; diasRestantes: number; status: "valido" | "vencendo" | "vencido" };

/** AAAA-MM-DD de hoje em São Paulo (o vencimento é uma data de calendário, sem hora). */
export function hojeSaoPaulo(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

export function diasAte(data: string, hoje: string): number {
  const [a, m, d] = data.slice(0, 10).split("-").map(Number);
  const [ha, hm, hd] = hoje.split("-").map(Number);
  return Math.round((Date.UTC(a, m - 1, d) - Date.UTC(ha, hm - 1, hd)) / 86_400_000);
}

export function certPublico(c: CertRow, hoje: string): CertPublico {
  const dias = diasAte(c.validoAte, hoje);
  return {
    tipo: c.tipo,
    validoAte: c.validoAte.slice(0, 10),
    diasRestantes: dias,
    status: dias < 0 ? "vencido" : dias <= 30 ? "vencendo" : "valido",
  };
}

// ---------------------------------------------------------------------------
// Cadastro
// ---------------------------------------------------------------------------

/** CNPJ é dado público e sai inteiro; CPF é dado pessoal e sai mascarado (•••.456.789-••). */
export function documentoPublico(_tipo: string, doc: string | null): string | null {
  const d = (doc ?? "").replace(/\D/g, "");
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `•••.${d.slice(3, 6)}.${d.slice(6, 9)}-••`;
  return null;
}

export type ClienteRow = {
  id: string;
  tipo: string;
  nome: string;
  nomeFantasia: string | null;
  cpfCnpj: string | null;
  regimeTributario: string | null;
  cidade: string | null;
  estado: string | null;
  ativo: boolean;
  portalMostrarSituacaoFiscal: boolean;
};

export function cadastroPublico(c: ClienteRow) {
  return {
    tipo: c.tipo === "PF" ? "PF" : "PJ",
    nome: c.nome,
    nomeFantasia: c.nomeFantasia,
    documento: documentoPublico(c.tipo, c.cpfCnpj),
    regimeTributario: c.regimeTributario,
    cidade: c.cidade,
    estado: c.estado,
  };
}

export type SituacaoFiscalPublica = { situacao: "regular" | "pendencias" | "sem_consulta"; consultadoEm: string | null };

/** Só o veredito (regular / com pendência). Nunca o resultado bruto nem o resumo. */
export function situacaoFiscalPublica(ult: { status: string; criadoEm: string } | null): SituacaoFiscalPublica {
  if (!ult) return { situacao: "sem_consulta", consultadoEm: null };
  if (ult.status === "ok") return { situacao: "regular", consultadoEm: ult.criadoEm };
  if (ult.status === "com_pendencia") return { situacao: "pendencias", consultadoEm: ult.criadoEm };
  return { situacao: "sem_consulta", consultadoEm: null };
}

/** Número do WhatsApp conectado (só dígitos, 10 a 15) ou null. */
export function whatsappPublico(numero: string | null): string | null {
  const d = (numero ?? "").replace(/\D/g, "");
  return d.length >= 10 && d.length <= 15 ? d : null;
}

// ---------------------------------------------------------------------------
// Entrada do cliente
// ---------------------------------------------------------------------------

/** Texto livre vindo do cliente: sem caracteres de controle, sem excesso de linhas, com teto. */
export function limparTexto(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v
    .normalize("NFC")
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

export const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
export const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
