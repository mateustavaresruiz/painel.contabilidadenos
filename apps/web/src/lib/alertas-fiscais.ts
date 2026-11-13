// Central de alertas fiscais: regras puras (sem React, sem Supabase), para
// poder testar com `deno test apps/web/tests`. Tudo sai das consultas que já
// estão gravadas (ConsultaFiscalUltima): abrir a tela não chama o Serpro.

export type Gravidade = "alta" | "media" | "baixa";

export type ChaveAlerta =
  | "sitfis_pendencia"
  | "sem_procuracao"
  | "caixa_importante"
  | "pgdas"
  | "dctfweb"
  | "procuracao_vencendo"
  | "certificado_vencendo"
  | "consulta_erro"
  | "aguardando_pin"
  | "parcelamentos"
  | "sitfis_desatualizada"
  | "nunca_consultada";

/** Última consulta de um serviço (a view ConsultaFiscalUltima). */
export type ConsultaAlerta = {
  servico: string;
  status: "ok" | "com_pendencia" | "erro";
  resumo: string | null;
  resultado: Record<string, unknown> | null;
  criadoEm: string;
};

export type EmpresaAlerta = {
  id: string;
  nome: string;
  nomeFantasia: string | null;
  cpfCnpj: string | null;
  telefone: string | null;
  /** Última consulta por serviço (SITFIS, CAIXAPOSTAL, ...). */
  ultimas: Record<string, ConsultaAlerta | undefined>;
  /** Consultas esperando o PIN (ainda dentro do prazo). */
  pendentesPin: number;
  /** Validade (AAAA-MM-DD) do certificado digital mais novo do cliente, se houver. */
  certificadoValidoAte: string | null;
};

export type ItemAlerta = {
  clienteId: string;
  nome: string;
  cpfCnpj: string | null;
  telefone: string | null;
  /** Uma linha curta: o que está errado nesta empresa. */
  detalhe: string;
  /** Para ordenar: menor primeiro (o mais urgente no topo). */
  ordem: number;
};

export type Alerta = {
  chave: ChaveAlerta;
  gravidade: Gravidade;
  titulo: string;
  descricao: string;
  /** Frase quando não há nenhuma empresa no alerta. */
  vazio: string;
  /** Texto pronto para o WhatsApp (a pessoa revisa antes de mandar). */
  mensagem?: (nome: string) => string;
  itens: ItemAlerta[];
};

export const DIAS_PROCURACAO_VENCENDO = 30;
export const DIAS_CERTIFICADO_VENCENDO = 30;
/** Consulta mensal + folga. */
export const DIAS_SITFIS_DESATUALIZADA = 35;

const ROTULO: Record<string, string> = {
  SITFIS: "Situação fiscal",
  CAIXAPOSTAL: "Caixa postal",
  PARCELAMENTOS: "Parcelamentos",
  PROCURACAO: "Procuração",
  PGDASD: "PGDAS-D",
  DCTFWEB: "DCTFWeb",
  CCMEI: "CCMEI",
};

const DIA = 86_400_000;

/** Dias inteiros de `hoje` até a data AAAA-MM-DD (negativo = já passou). */
export function diasAte(dataIso: string, hoje: Date): number {
  const [a, m, d] = dataIso.slice(0, 10).split("-").map(Number);
  if (!a || !m || !d) return Number.NaN;
  const alvo = Date.UTC(a, m - 1, d);
  const base = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.round((alvo - base) / DIA);
}

/** Dias desde um instante (timestamp do banco). */
export function diasDesde(instante: string, hoje: Date): number {
  const t = new Date(instante).getTime();
  if (Number.isNaN(t)) return Number.NaN;
  return Math.floor((hoje.getTime() - t) / DIA);
}

const dataBR = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

const nomeDe = (e: EmpresaAlerta) => e.nomeFantasia || e.nome;

function item(e: EmpresaAlerta, detalhe: string, ordem = 0): ItemAlerta {
  return { clienteId: e.id, nome: nomeDe(e), cpfCnpj: e.cpfCnpj, telefone: e.telefone, detalhe, ordem };
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const curto = (s: string | null | undefined, max = 140) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

// ---------------------------------------------------------------------------
// Situação do cliente (a mesma regra do resumo da aba Painel)
// ---------------------------------------------------------------------------

export type SituacaoFiscal = "regular" | "com_pendencia" | "parcelado" | "erro" | "nunca";

/**
 * erro (último SITFIS falhou) > parcelado (há parcelamento ativo) > com
 * pendência (SITFIS) > regular > nunca consultado.
 */
export function situacaoFiscal(
  sitfis?: Pick<ConsultaAlerta, "status"> | null,
  parcel?: Pick<ConsultaAlerta, "status" | "resultado"> | null,
): SituacaoFiscal {
  const ativos = num((parcel?.resultado as { ativos?: unknown } | null)?.ativos);
  if (!sitfis && !parcel) return "nunca";
  if (sitfis?.status === "erro") return "erro";
  if (ativos > 0) return "parcelado";
  if (sitfis?.status === "com_pendencia") return "com_pendencia";
  if (sitfis?.status === "ok") return "regular";
  return parcel?.status === "erro" ? "erro" : "nunca";
}

export function cobertura(empresas: EmpresaAlerta[]): Record<SituacaoFiscal, number> {
  const c: Record<SituacaoFiscal, number> = { regular: 0, com_pendencia: 0, parcelado: 0, erro: 0, nunca: 0 };
  for (const e of empresas) c[situacaoFiscal(e.ultimas.SITFIS, e.ultimas.PARCELAMENTOS)]++;
  return c;
}

// ---------------------------------------------------------------------------
// Alertas
// ---------------------------------------------------------------------------

const ola = (nome: string) => `Olá, ${nome}! Tudo bem?`;

type Definicao = Omit<Alerta, "itens"> & { regra: (e: EmpresaAlerta, hoje: Date) => ItemAlerta | null };

const DEFINICOES: Definicao[] = [
  {
    chave: "sitfis_pendencia",
    gravidade: "alta",
    titulo: "Pendência na situação fiscal",
    descricao: "O relatório da Receita e da PGFN apontou pendência.",
    vazio: "Nenhuma pendência no relatório",
    mensagem: (n) =>
      `${ola(n)} Na consulta da situação fiscal da empresa apareceu uma pendência na Receita Federal. Podemos conversar para regularizar?`,
    regra: (e) => {
      const s = e.ultimas.SITFIS;
      if (s?.status !== "com_pendencia") return null;
      const trechos = (s.resultado as { trechos?: unknown } | null)?.trechos;
      const primeiro = Array.isArray(trechos) && trechos.length ? String(trechos[0]) : s.resumo;
      const extra = Array.isArray(trechos) && trechos.length > 1 ? ` (+${trechos.length - 1})` : "";
      return item(e, curto(primeiro || "Pendência no relatório") + extra);
    },
  },
  {
    chave: "sem_procuracao",
    gravidade: "alta",
    titulo: "Sem procuração",
    descricao: "Sem procuração no e-CAC, o Serpro não deixa consultar a empresa.",
    vazio: "Todas as consultadas têm procuração",
    mensagem: (n) =>
      `${ola(n)} Para acompanharmos a empresa na Receita, precisamos que a procuração eletrônica para o escritório seja cadastrada no e-CAC. Podemos te ajudar com o passo a passo?`,
    regra: (e) => {
      const p = e.ultimas.PROCURACAO;
      return (p?.resultado as { procuracao?: string } | null)?.procuracao === "sem_procuracao"
        ? item(e, "A Receita não encontrou procuração para o escritório")
        : null;
    },
  },
  {
    chave: "caixa_importante",
    gravidade: "alta",
    titulo: "Mensagem importante no e-CAC",
    descricao: "Mensagem não lida que parece intimação, cobrança ou exclusão.",
    vazio: "Nada importante na caixa postal",
    mensagem: (n) =>
      `${ola(n)} Chegou uma mensagem importante da Receita Federal na caixa postal da empresa. Já estamos olhando e te explicamos o que fazer.`,
    regra: (e) => {
      const cp = (e.ultimas.CAIXAPOSTAL?.resultado as { caixaPostal?: { importantes?: unknown; mensagens?: unknown } } | null)?.caixaPostal;
      const n = num(cp?.importantes);
      if (n <= 0) return null;
      const msgs = Array.isArray(cp?.mensagens) ? (cp.mensagens as Array<{ assunto?: string; importante?: boolean; naoLida?: boolean }>) : [];
      const assunto = msgs.find((m) => m.importante && m.naoLida !== false)?.assunto;
      return item(e, `${plural(n, "importante não lida", "importantes não lidas")}${assunto ? `: ${curto(assunto, 90)}` : ""}`, -n);
    },
  },
  {
    chave: "pgdas",
    gravidade: "alta",
    titulo: "PGDAS-D com problema",
    descricao: "Declaração do Simples não transmitida ou com multa por atraso (MAED).",
    vazio: "PGDAS-D em dia",
    regra: (e) => {
      const c = e.ultimas.PGDASD;
      if (c?.status !== "com_pendencia") return null;
      const maed = (c.resultado as { maed?: unknown } | null)?.maed === true;
      return item(e, curto(c.resumo || (maed ? "Multa por atraso (MAED)" : "Declaração não encontrada")));
    },
  },
  {
    chave: "dctfweb",
    gravidade: "alta",
    titulo: "DCTFWeb sem recibo",
    descricao: "A DCTFWeb do período não tem recibo de entrega.",
    vazio: "DCTFWeb com recibo",
    regra: (e) => {
      const c = e.ultimas.DCTFWEB;
      return c?.status === "com_pendencia" ? item(e, curto(c.resumo || "Sem recibo no período")) : null;
    },
  },
  {
    chave: "procuracao_vencendo",
    gravidade: "media",
    titulo: "Procuração vencendo",
    descricao: `Procuração que vence em até ${DIAS_PROCURACAO_VENCENDO} dias.`,
    vazio: "Nenhuma procuração vencendo",
    mensagem: (n) =>
      `${ola(n)} A procuração eletrônica da empresa para o escritório está perto de vencer. Podemos te ajudar a renovar no e-CAC?`,
    regra: (e, hoje) => {
      const r = e.ultimas.PROCURACAO?.resultado as { procuracao?: string; validade?: string | null } | null;
      if (r?.procuracao !== "ativa" || !r.validade) return null;
      const d = diasAte(r.validade, hoje);
      if (!(d >= 0 && d <= DIAS_PROCURACAO_VENCENDO)) return null;
      return item(e, d === 0 ? `Vence hoje (${dataBR(r.validade)})` : `Vence em ${dataBR(r.validade)} (${plural(d, "dia", "dias")})`, d);
    },
  },
  {
    chave: "certificado_vencendo",
    gravidade: "media",
    titulo: "Certificado digital vencendo",
    descricao: `Certificado vencido ou que vence em até ${DIAS_CERTIFICADO_VENCENDO} dias.`,
    vazio: "Certificados em dia",
    mensagem: (n) => `${ola(n)} O certificado digital da empresa está perto de vencer. Vamos agendar a renovação?`,
    regra: (e, hoje) => {
      if (!e.certificadoValidoAte) return null;
      const d = diasAte(e.certificadoValidoAte, hoje);
      if (!(d <= DIAS_CERTIFICADO_VENCENDO)) return null;
      const data = dataBR(e.certificadoValidoAte);
      return item(e, d < 0 ? `Venceu em ${data}` : d === 0 ? `Vence hoje (${data})` : `Vence em ${data} (${plural(d, "dia", "dias")})`, d);
    },
  },
  {
    chave: "consulta_erro",
    gravidade: "media",
    titulo: "Consulta com erro",
    descricao: "A última consulta de algum serviço não deu certo.",
    vazio: "Nenhuma consulta com erro",
    regra: (e) => {
      const erros = Object.values(e.ultimas).filter((c): c is ConsultaAlerta => c?.status === "erro");
      if (!erros.length) return null;
      const [p] = erros;
      const extra = erros.length > 1 ? ` (+${erros.length - 1})` : "";
      return item(e, `${ROTULO[p.servico] ?? p.servico}: ${curto(p.resumo || "falhou", 100)}${extra}`);
    },
  },
  {
    chave: "aguardando_pin",
    gravidade: "media",
    titulo: "Esperando o PIN",
    descricao: "Consulta parada até alguém confirmar com o PIN.",
    vazio: "Nada esperando confirmação",
    regra: (e) => (e.pendentesPin > 0 ? item(e, plural(e.pendentesPin, "consulta esperando o PIN", "consultas esperando o PIN")) : null),
  },
  {
    chave: "parcelamentos",
    gravidade: "baixa",
    titulo: "Parcelamentos ativos",
    descricao: "Empresas com parcelamento em andamento no Simples ou no MEI.",
    vazio: "Nenhum parcelamento ativo",
    regra: (e) => {
      const n = num((e.ultimas.PARCELAMENTOS?.resultado as { ativos?: unknown } | null)?.ativos);
      return n > 0 ? item(e, plural(n, "parcelamento ativo", "parcelamentos ativos"), -n) : null;
    },
  },
  {
    chave: "sitfis_desatualizada",
    gravidade: "baixa",
    titulo: "Situação fiscal antiga",
    descricao: `Última situação fiscal com mais de ${DIAS_SITFIS_DESATUALIZADA} dias.`,
    vazio: "Situações fiscais recentes",
    regra: (e, hoje) => {
      const s = e.ultimas.SITFIS;
      if (!s) return null;
      const d = diasDesde(s.criadoEm, hoje);
      return d > DIAS_SITFIS_DESATUALIZADA ? item(e, `Consultada há ${plural(d, "dia", "dias")}`, -d) : null;
    },
  },
  {
    chave: "nunca_consultada",
    gravidade: "baixa",
    titulo: "Nunca consultadas",
    descricao: "Empresas com CNPJ que ainda não tiveram a situação fiscal consultada.",
    vazio: "Todas já foram consultadas",
    regra: (e) => {
      if (!e.cpfCnpj || e.ultimas.SITFIS) return null;
      // Sem procuração a consulta nem roda: já aparece no alerta próprio.
      if ((e.ultimas.PROCURACAO?.resultado as { procuracao?: string } | null)?.procuracao === "sem_procuracao") return null;
      return item(e, "Situação fiscal ainda não consultada");
    },
  },
];

const PESO: Record<Gravidade, number> = { alta: 0, media: 1, baixa: 2 };

/** Todos os alertas, na ordem de gravidade, cada um com suas empresas. */
export function montarAlertas(empresas: EmpresaAlerta[], hoje = new Date()): Alerta[] {
  return DEFINICOES.map(({ regra, ...def }) => {
    const itens: ItemAlerta[] = [];
    for (const e of empresas) {
      const i = regra(e, hoje);
      if (i) itens.push(i);
    }
    itens.sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR"));
    return { ...def, itens };
  }).sort((a, b) => PESO[a.gravidade] - PESO[b.gravidade]);
}

export type ResumoAlertas = {
  /** Empresas (contadas uma vez) com algum alerta de gravidade alta ou média. */
  empresasComProblema: number;
  /** Empresas com algum alerta de gravidade alta. */
  empresasGraves: number;
  /** Alertas altos/médios com pelo menos uma empresa. */
  ativos: Alerta[];
};

export function resumirAlertas(alertas: Alerta[]): ResumoAlertas {
  const problema = new Set<string>();
  const graves = new Set<string>();
  for (const a of alertas) {
    if (a.gravidade === "baixa") continue;
    for (const i of a.itens) {
      problema.add(i.clienteId);
      if (a.gravidade === "alta") graves.add(i.clienteId);
    }
  }
  return {
    empresasComProblema: problema.size,
    empresasGraves: graves.size,
    ativos: alertas.filter((a) => a.gravidade !== "baixa" && a.itens.length > 0),
  };
}

/** CSV (separador `;`, com BOM, para abrir certo no Excel) das empresas de um alerta. */
export function csvDoAlerta(a: Alerta): string {
  const esc = (v: string | null) => {
    const s = String(v ?? "");
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const linhas = [["Empresa", "CPF/CNPJ", "Telefone", "Detalhe"].join(";")];
  for (const i of a.itens) linhas.push([esc(i.nome), esc(i.cpfCnpj), esc(i.telefone), esc(i.detalhe)].join(";"));
  return "﻿" + linhas.join("\r\n");
}
