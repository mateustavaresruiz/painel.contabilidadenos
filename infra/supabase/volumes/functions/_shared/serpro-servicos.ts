// Serviços do Serpro (via gateway Integra Contador) usados pela function
// `serpro` (tela) e pela rota `serpro-agendado` da function `crons`.
// Toda consulta vira uma linha em ConsultaFiscal (ver serpro/index.ts).

import { supabaseAdmin, TENANT_ID } from "./supabase.ts";
import { recordError } from "./error-log.ts";
import {
  base64ParaBytes,
  type ConfirmacaoGateway,
  contribuinteDe,
  gateway,
  GatewayErro,
  mensagensTexto,
  normalizar,
  pedidoChamada,
  type RespostaGateway,
  type ResultadoGateway,
  textoDoPdf,
} from "./serpro.ts";

export const BUCKET = "consultas-fiscais";
export const SERVICOS = [
  "SITFIS", "PGDASD", "DCTFWEB", "CCMEI", "CAIXAPOSTAL", "PARCELAMENTOS", "PROCURACAO", "AVANCADO",
] as const;
/** Serviços que o agendamento pode rodar (só leitura, nada que peça PIN). */
export const SERVICOS_AGENDAVEIS = ["SITFIS", "CAIXAPOSTAL", "PARCELAMENTOS", "PROCURACAO"] as const;
export type Servico = (typeof SERVICOS)[number];

/** Quanto o SITFIS pode esperar dentro de UMA requisição (runtime corta em 150s). */
const ORCAMENTO_SITFIS_MS = 100_000;

/** Nome legível de cada pendência que o gateway lista em `faltam`. */
export const FALTA_LEGIVEL: Record<string, string> = {
  SERPRO_CONSUMER_KEY: "SERPRO_CONSUMER_KEY (consumer key do contrato Integra Contador)",
  SERPRO_CONSUMER_SECRET: "SERPRO_CONSUMER_SECRET (consumer secret do contrato Integra Contador)",
  SERPRO_CONTRATANTE_CNPJ: "SERPRO_CONTRATANTE_CNPJ (CNPJ do contratante)",
  SERPRO_CERT_PASSWORD: "SERPRO_CERT_PASSWORD (senha do certificado A1)",
  GATEWAY_PIN_CONFIRMACAO: "GATEWAY_PIN_CONFIRMACAO (PIN de confirmação do gateway)",
  GATEWAY_API_KEY: "GATEWAY_API_KEY (chave do gateway)",
};

export type Desfecho = {
  status: "pendente" | "ok" | "com_pendencia" | "erro";
  resumo: string;
  resultado: Record<string, unknown>;
  erro?: string | null;
};

export type Consulta = {
  id: string;
  clienteId: string;
  servico: string;
  status?: string;
  resultado: Record<string, unknown> | null;
};

export type Ctx = { consulta: Consulta; contribuinte: string; operador: string; body: Record<string, unknown> };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function mesAnterior(): { ano: string; mes: string } {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return { ano: String(d.getUTCFullYear()), mes: String(d.getUTCMonth() + 1).padStart(2, "0") };
}

/** "AAAAMM" do body ou o mês anterior. */
function periodoDe(raw: unknown): { ano: string; mes: string } | null {
  if (raw == null || raw === "") return mesAnterior();
  const s = String(raw).replace(/\D/g, "");
  if (!/^\d{6}$/.test(s)) return null;
  const mes = Number(s.slice(4));
  if (mes < 1 || mes > 12) return null;
  return { ano: s.slice(0, 4), mes: s.slice(4) };
}

async function salvarPdf(c: Consulta, nome: string, b64: string): Promise<string | null> {
  try {
    const bytes = base64ParaBytes(b64);
    const path = `${TENANT_ID}/${c.clienteId}/${c.id}-${nome.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (error) {
      console.warn("[serpro] upload pdf", error.message);
      return null;
    }
    return path;
  } catch (err) {
    console.warn("[serpro] pdf inválido", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Custo e rastreio que o gateway devolve — vão junto pro `resultado`. */
function rastreio(r: ResultadoGateway): Record<string, unknown> {
  return {
    chamadaId: r.chamada_id ?? null,
    serproHttp: r.serpro_http,
    cobrado: r.cobrado ?? null,
    custoEstimado: r.custo_estimado ?? null,
  };
}

/** O Serpro respondeu com erro → desfecho `erro` com a mensagem dele. */
function desfechoDeErroSerpro(r: ResultadoGateway, oQue: string): Desfecho {
  const msgs = mensagensTexto(r);
  return {
    status: "erro",
    resumo: `${oQue}: o Serpro respondeu HTTP ${r.serpro_http}${msgs ? ` — ${msgs}` : ""}`.slice(0, 1000),
    resultado: { ...rastreio(r), mensagens: r.mensagens },
    erro: msgs || `HTTP ${r.serpro_http}`,
  };
}

/** Erro DO GATEWAY (chave, pausa, duplicado, limite, configuração). */
export function desfechoDeErroGateway(g: RespostaGateway, oQue: string): Desfecho {
  const codigo = typeof g.corpo.erro === "string" ? g.corpo.erro : `HTTP ${g.http}`;
  const msg = typeof g.corpo.mensagem === "string" ? g.corpo.mensagem : "";
  return {
    status: "erro",
    resumo: `${oQue}: o gateway recusou (${codigo})${msg ? ` — ${msg}` : ""}`.slice(0, 1000),
    resultado: { gatewayHttp: g.http, gatewayErro: codigo },
    erro: codigo,
  };
}

function desfechoAguardandoPin(c: ConfirmacaoGateway, extra: Record<string, unknown> = {}): Desfecho {
  return {
    status: "pendente",
    resumo: `Aguardando confirmação com PIN: ${c.resumo}${c.custo_estimado ? ` (custo estimado R$ ${c.custo_estimado.toFixed(2)})` : ""}.`,
    resultado: {
      ...extra,
      aguardandoPin: true,
      confirmacao: { id: c.id, resumo: c.resumo, custoEstimado: c.custo_estimado ?? null, expiraEm: c.expira_em ?? null },
    },
  };
}

/** Exceção (sem resposta do gateway, ou código nosso) → desfecho `erro`. */
export function desfechoDeExcecao(err: unknown): Desfecho {
  const msg = err instanceof Error ? err.message : String(err);
  return {
    status: "erro",
    resumo: msg.slice(0, 1000),
    resultado: err instanceof GatewayErro ? { gatewayErro: err.codigo } : {},
    erro: msg.slice(0, 1000),
  };
}

type Chamada =
  | { tipo: "resultado"; r: ResultadoGateway }
  | { tipo: "pin"; confirmacao: ConfirmacaoGateway }
  | { tipo: "erro"; g: RespostaGateway };

async function chamar(ctx: Ctx, pedido: Parameters<typeof pedidoChamada>[0]): Promise<Chamada> {
  const g = await gateway("/v1/chamadas", { body: pedidoChamada(pedido), operador: ctx.operador });
  if (g.http === 202 && g.corpo.confirmacao) return { tipo: "pin", confirmacao: g.corpo.confirmacao };
  if (g.http === 200) return { tipo: "resultado", r: g.corpo as unknown as ResultadoGateway };
  return { tipo: "erro", g };
}

// ---------------------------------------------------------------------------
// Interpretação por serviço (o `r` vem igual de uma chamada direta ou de
// uma confirmação com PIN)
// ---------------------------------------------------------------------------

async function interpretarPgdasd(ctx: Ctx, r: ResultadoGateway, periodo: string): Promise<Desfecho> {
  const pa = `${periodo.slice(4)}/${periodo.slice(0, 4)}`;
  const d = (r.dados ?? {}) as {
    numeroDeclaracao?: string;
    recibo?: { pdf?: string };
    declaracao?: { pdf?: string };
    maed?: { pdfNotificacao?: string; pdfDarf?: string };
  };
  if (r.ok && d.numeroDeclaracao) {
    const pdfPath = d.recibo?.pdf ? await salvarPdf(ctx.consulta, "recibo-pgdasd.pdf", d.recibo.pdf) : null;
    const declaracaoPath = d.declaracao?.pdf ? await salvarPdf(ctx.consulta, "declaracao-pgdasd.pdf", d.declaracao.pdf) : null;
    const temMaed = !!(d.maed?.pdfNotificacao || d.maed?.pdfDarf);
    return {
      status: temMaed ? "com_pendencia" : "ok",
      resumo: temMaed
        ? `PGDAS-D ${pa} transmitido (nº ${d.numeroDeclaracao}) com multa por atraso (MAED).`
        : `PGDAS-D ${pa} transmitido (nº ${d.numeroDeclaracao}).`,
      resultado: { ...rastreio(r), periodo, numeroDeclaracao: d.numeroDeclaracao, pdfPath, declaracaoPath, maed: temMaed },
    };
  }
  if (r.ok || r.serpro_http === 404) {
    const msgs = mensagensTexto(r);
    return {
      status: "com_pendencia",
      resumo: `Nenhuma declaração PGDAS-D transmitida para ${pa}.${msgs ? ` (${msgs})` : ""}`.slice(0, 1000),
      resultado: { ...rastreio(r), periodo, mensagens: r.mensagens },
    };
  }
  return desfechoDeErroSerpro(r, `PGDAS-D ${pa}`);
}

async function interpretarDctfweb(ctx: Ctx, r: ResultadoGateway, periodo: string, categoria: number): Promise<Desfecho> {
  const pa = `${periodo.slice(4)}/${periodo.slice(0, 4)}`;
  const pdf = r.pdfs?.[0]?.base64;
  if (r.ok && pdf) {
    const pdfPath = await salvarPdf(ctx.consulta, "recibo-dctfweb.pdf", pdf);
    return {
      status: "ok",
      resumo: `DCTFWeb ${pa} transmitida (recibo disponível).`,
      resultado: { ...rastreio(r), periodo, categoria, pdfPath },
    };
  }
  if (r.ok || r.serpro_http === 404) {
    const msgs = mensagensTexto(r);
    return {
      status: "com_pendencia",
      resumo: `Sem recibo de DCTFWeb para ${pa} (declaração não transmitida?).${msgs ? ` (${msgs})` : ""}`.slice(0, 1000),
      resultado: { ...rastreio(r), periodo, categoria, mensagens: r.mensagens },
    };
  }
  return desfechoDeErroSerpro(r, `DCTFWeb ${pa}`);
}

function interpretarCcmei(r: ResultadoGateway): Desfecho {
  if (!r.ok || !r.dados || typeof r.dados !== "object") return desfechoDeErroSerpro(r, "CCMEI");
  const d = r.dados as { situacaoCadastralVigente?: string; enquadramento?: { optanteMei?: boolean } };
  const situacao = d.situacaoCadastralVigente ?? "desconhecida";
  const optante = d.enquadramento?.optanteMei;
  const ok = normalizar(situacao).includes("ativa") && optante !== false;
  return {
    status: ok ? "ok" : "com_pendencia",
    resumo: `MEI: situação cadastral ${situacao}${optante === false ? ", NÃO optante pelo SIMEI" : ""}.`,
    resultado: { ...rastreio(r), dados: d },
  };
}

async function interpretarAvancado(ctx: Ctx, r: ResultadoGateway, rotulo: string): Promise<Desfecho> {
  if (!r.ok) return desfechoDeErroSerpro(r, rotulo);
  const pdf = r.pdfs?.[0]?.base64;
  const pdfPath = pdf ? await salvarPdf(ctx.consulta, "documento.pdf", pdf) : null;
  const msgs = mensagensTexto(r);
  return {
    status: "ok",
    resumo: `${rotulo}: HTTP ${r.serpro_http}${msgs ? ` — ${msgs}` : ""}`.slice(0, 1000),
    // O base64 do PDF já está no bucket; não duplica no jsonb.
    resultado: { ...rastreio(r), mensagens: r.mensagens, dados: pdf ? null : r.dados, pdfPath },
  };
}

/**
 * Classifica o relatório SITFIS lendo o texto do PDF (best-effort). A Receita
 * escreve "Não foram detectadas pendências/exigibilidades suspensas" quando
 * está tudo certo, e lista "Pendência - ..." quando não.
 */
async function diagnosticoSitfis(pdfB64: string) {
  let texto = "";
  try {
    texto = await textoDoPdf(base64ParaBytes(pdfB64));
  } catch { /* fica vazio */ }
  const n = normalizar(texto);
  const trechos: string[] = [];
  for (const m of n.matchAll(/pendencia\s*-\s*[^.]{0,120}/g)) {
    if (trechos.length < 10) trechos.push(m[0].trim());
  }
  if (n.includes("nao foram detectadas pendencias") && trechos.length === 0) {
    return {
      status: "ok" as const,
      diagnostico: "sem_pendencias",
      resumo: "Sem pendências na Receita Federal e na PGFN (relatório de situação fiscal).",
      trechos,
    };
  }
  if (trechos.length > 0) {
    return {
      status: "com_pendencia" as const,
      diagnostico: "com_pendencias",
      resumo: `Relatório de situação fiscal aponta pendência(s): ${trechos.slice(0, 3).join("; ")}.`.slice(0, 1000),
      trechos,
    };
  }
  // ⚠️ Não deu pra ler o diagnóstico (fonte do PDF ilegível). `ok` aqui quer
  // dizer "relatório emitido", e o resumo diz isso com todas as letras.
  return {
    status: "ok" as const,
    diagnostico: "indeterminado",
    resumo: "Relatório de situação fiscal emitido. Não foi possível ler o diagnóstico automaticamente: abra o PDF.",
    trechos,
  };
}

async function interpretarRelatorioSitfis(ctx: Ctx, r: ResultadoGateway, protocolo: string): Promise<Desfecho> {
  const pdf = r.pdfs?.[0]?.base64;
  if (!r.ok || !pdf) return desfechoDeErroSerpro(r, "Emissão do relatório de situação fiscal");
  const pdfPath = await salvarPdf(ctx.consulta, "situacao-fiscal.pdf", pdf);
  const diag = await diagnosticoSitfis(pdf);
  return {
    status: diag.status,
    resumo: diag.resumo,
    resultado: {
      ...rastreio(r),
      protocoloRelatorio: protocolo,
      pdfPath,
      diagnostico: diag.diagnostico,
      trechos: diag.trechos,
      mensagens: r.mensagens,
    },
  };
}

// ---------------------------------------------------------------------------
// SITFIS — relatório de situação fiscal (2 passos, assíncrono)
// ---------------------------------------------------------------------------

async function sitfisSolicitar(ctx: Ctx): Promise<{ protocolo: string; esperaMs: number } | Desfecho> {
  const ch = await chamar(ctx, {
    contribuinte: ctx.contribuinte,
    idSistema: "SITFIS",
    idServico: "SOLICITARPROTOCOLO91",
    versaoSistema: "2.0",
    dados: "",
  });
  if (ch.tipo === "erro") return desfechoDeErroGateway(ch.g, "Solicitação do relatório de situação fiscal");
  if (ch.tipo === "pin") return desfechoAguardandoPin(ch.confirmacao);
  if (ch.r.ok && ch.r.protocolo) return { protocolo: ch.r.protocolo, esperaMs: ch.r.tempo_espera ?? 0 };
  return desfechoDeErroSerpro(ch.r, "Solicitação do relatório de situação fiscal");
}

/**
 * Passo 2: emite o relatório com o protocolo. "Ainda processando" (202/204)
 * espera o `tempo_espera` e tenta de novo — 🔴 cada 202 é COBRADO, então
 * nunca antes do tempo. Esgotado o orçamento, devolve `pendente` com o
 * protocolo pra rota /retomar continuar.
 */
export async function sitfisEmitir(ctx: Ctx, protocolo: string, esperaInicialMs: number, inicio: number): Promise<Desfecho> {
  let espera = esperaInicialMs;
  let tentativa = 0;
  while (true) {
    const restante = ORCAMENTO_SITFIS_MS - (Date.now() - inicio);
    if (espera > restante) {
      return {
        status: "pendente",
        resumo: "Relatório em processamento na Receita. Clique em \"Atualizar\" em instantes para buscá-lo.",
        resultado: { protocoloRelatorio: protocolo, proximaTentativaEm: new Date(Date.now() + espera).toISOString() },
      };
    }
    if (espera > 0) await sleep(espera);
    const ch = await chamar(ctx, {
      contribuinte: ctx.contribuinte,
      idSistema: "SITFIS",
      idServico: "RELATORIOSITFIS92",
      versaoSistema: "2.0",
      dados: { protocoloRelatorio: protocolo },
      // Repetir depois do tempo de espera é intencional: a trava de 60 s do
      // gateway é pra clique duplo, não pra este laço.
      repetir: tentativa > 0,
    });
    tentativa++;
    if (ch.tipo === "pin") return desfechoAguardandoPin(ch.confirmacao, { protocoloRelatorio: protocolo });
    if (ch.tipo === "erro") {
      // 409 DUPLICADA no /retomar: alguém acabou de pedir o mesmo relatório.
      if (ch.g.http === 409) {
        return {
          status: "pendente",
          resumo: "O relatório acabou de ser pedido. Aguarde um minuto e clique em \"Atualizar\".",
          resultado: { protocoloRelatorio: protocolo },
        };
      }
      return desfechoDeErroGateway(ch.g, "Emissão do relatório de situação fiscal");
    }
    if (ch.r.ok && ch.r.processando && !ch.r.pdfs?.length) {
      espera = Math.max(ch.r.tempo_espera ?? 5_000, 2_000);
      continue;
    }
    return interpretarRelatorioSitfis(ctx, ch.r, protocolo);
  }
}

// ---------------------------------------------------------------------------
// Demais serviços (síncronos, ou PIN)
// ---------------------------------------------------------------------------

export async function rodarServico(ctx: Ctx, servico: Servico): Promise<Desfecho> {
  const { body } = ctx;
  if (servico === "SITFIS") {
    const inicio = Date.now();
    const sol = await sitfisSolicitar(ctx);
    return "status" in sol ? sol : sitfisEmitir(ctx, sol.protocolo, sol.esperaMs, inicio);
  }

  if (servico === "PGDASD") {
    const pa = periodoDe(body.periodo);
    if (!pa) return { status: "erro", resumo: "Período inválido (use AAAAMM).", resultado: {}, erro: "periodo" };
    const periodo = `${pa.ano}${pa.mes}`;
    const ch = await chamar(ctx, {
      contribuinte: ctx.contribuinte,
      idSistema: "PGDASD",
      idServico: "CONSULTIMADECREC14",
      dados: { periodoApuracao: periodo },
    });
    if (ch.tipo === "erro") return desfechoDeErroGateway(ch.g, "PGDAS-D");
    if (ch.tipo === "pin") return desfechoAguardandoPin(ch.confirmacao, { periodo });
    return interpretarPgdasd(ctx, ch.r, periodo);
  }

  if (servico === "DCTFWEB") {
    const pa = periodoDe(body.periodo);
    if (!pa) return { status: "erro", resumo: "Período inválido (use AAAAMM).", resultado: {}, erro: "periodo" };
    const categoria = Number(body.categoria ?? 40) || 40; // 40 = GERAL_MENSAL
    const periodo = `${pa.ano}${pa.mes}`;
    const ch = await chamar(ctx, {
      contribuinte: ctx.contribuinte,
      idSistema: "DCTFWEB",
      idServico: "CONSRECIBO32",
      dados: { categoria, anoPA: pa.ano, mesPA: pa.mes },
    });
    if (ch.tipo === "erro") return desfechoDeErroGateway(ch.g, "DCTFWeb");
    if (ch.tipo === "pin") return desfechoAguardandoPin(ch.confirmacao, { periodo, categoria });
    return interpretarDctfweb(ctx, ch.r, periodo, categoria);
  }

  if (servico === "CCMEI") {
    // DADOSCCMEI122 não está na tabela de verbos do gateway: informamos
    // Consultar, e por ser serviço "desconhecido" o gateway pede PIN.
    const ch = await chamar(ctx, {
      contribuinte: ctx.contribuinte,
      idSistema: "CCMEI",
      idServico: "DADOSCCMEI122",
      versaoSistema: "1.0",
      dados: "",
      verbo: "Consultar",
    });
    if (ch.tipo === "erro") return desfechoDeErroGateway(ch.g, "CCMEI");
    if (ch.tipo === "pin") return desfechoAguardandoPin(ch.confirmacao);
    return interpretarCcmei(ch.r);
  }

  if (servico === "CAIXAPOSTAL") {
    const ch = await chamar(ctx, {
      contribuinte: ctx.contribuinte,
      idSistema: "CAIXAPOSTAL",
      idServico: "MSGCONTRIBUINTE61",
      versaoSistema: "1.0",
      dados: { statusLeitura: 0, indicadorPagina: 0 },
    });
    if (ch.tipo === "erro") return desfechoDeErroGateway(ch.g, "Caixa postal");
    if (ch.tipo === "pin") return desfechoAguardandoPin(ch.confirmacao);
    return interpretarCaixaPostal(ch.r);
  }

  if (servico === "PARCELAMENTOS") {
    const ids = idsParcelamento(String(body.regimeTributario ?? ""));
    if (!ids) {
      return {
        status: "erro",
        resumo: "Parcelamentos: só há consulta para clientes do Simples Nacional ou MEI (confira o regime no cadastro).",
        resultado: {},
        erro: "regime",
      };
    }
    const ch = await chamar(ctx, { contribuinte: ctx.contribuinte, ...ids, versaoSistema: "1.0", dados: "" });
    if (ch.tipo === "erro") return desfechoDeErroGateway(ch.g, "Parcelamentos");
    if (ch.tipo === "pin") return desfechoAguardandoPin(ch.confirmacao, { modalidade: ids.idSistema });
    return interpretarParcelamentos(ch.r, ids.idSistema);
  }

  if (servico === "PROCURACAO") {
    // Sem `dados`: o gateway preenche outorgante (cliente) e outorgado (escritório).
    const ch = await chamar(ctx, {
      contribuinte: ctx.contribuinte,
      idSistema: "PROCURACOES",
      idServico: "OBTERPROCURACAO41",
      versaoSistema: "1",
    });
    if (ch.tipo === "erro") return desfechoDeErroGateway(ch.g, "Procuração");
    if (ch.tipo === "pin") return desfechoAguardandoPin(ch.confirmacao);
    return interpretarProcuracao(ch.r);
  }

  // AVANCADO
  const idSistema = String(body.idSistema ?? "").trim().toUpperCase();
  const idServico = String(body.idServico ?? "").trim().toUpperCase();
  if (!idSistema || !idServico) {
    return { status: "erro", resumo: "idSistema e idServico obrigatórios.", resultado: {}, erro: "ids" };
  }
  const ch = await chamar(ctx, {
    contribuinte: ctx.contribuinte,
    idSistema,
    idServico,
    versaoSistema: body.versaoSistema ? String(body.versaoSistema) : undefined,
    dados: body.dados ?? "",
    verbo: body.verbo ? String(body.verbo) : undefined,
  });
  const rotulo = `${idSistema}/${idServico}`;
  if (ch.tipo === "erro") return desfechoDeErroGateway(ch.g, rotulo);
  if (ch.tipo === "pin") return desfechoAguardandoPin(ch.confirmacao, { idSistema, idServico });
  return interpretarAvancado(ctx, ch.r, rotulo);
}

/** Resultado de uma confirmação com PIN → desfecho do serviço da consulta. */
export function desfechoDaConfirmacao(ctx: Ctx, c: ConfirmacaoGateway): Desfecho | Promise<Desfecho> {
  const r = c.resultado;
  if (!r || c.status === "falhou" || (r as { erro?: string }).erro) {
    const msg = (r as { erro?: string } | undefined)?.erro ?? mensagensTexto(r) ?? "";
    return { status: "erro", resumo: `A confirmação falhou: ${msg || c.status}`.slice(0, 1000), resultado: { confirmacao: { id: c.id, status: c.status } }, erro: msg || c.status };
  }
  const anterior = ctx.consulta.resultado ?? {};
  const servico = ctx.consulta.servico as Servico;
  if (servico === "PGDASD") return interpretarPgdasd(ctx, r, String(anterior.periodo ?? `${mesAnterior().ano}${mesAnterior().mes}`));
  if (servico === "DCTFWEB") {
    return interpretarDctfweb(ctx, r, String(anterior.periodo ?? ""), Number(anterior.categoria ?? 40));
  }
  if (servico === "CCMEI") return interpretarCcmei(r);
  if (servico === "CAIXAPOSTAL") return interpretarCaixaPostal(r);
  if (servico === "PARCELAMENTOS") return interpretarParcelamentos(r, String(anterior.modalidade ?? ""));
  if (servico === "PROCURACAO") return interpretarProcuracao(r);
  if (servico === "SITFIS") {
    const protocolo = String(anterior.protocoloRelatorio ?? r.protocolo ?? "");
    if (r.protocolo && !r.pdfs?.length) {
      // Confirmou a SOLICITAÇÃO: segue pro relatório.
      return sitfisEmitir(ctx, r.protocolo, r.tempo_espera ?? 0, Date.now());
    }
    return interpretarRelatorioSitfis(ctx, r, protocolo);
  }
  return interpretarAvancado(ctx, r, `${anterior.idSistema ?? "?"}/${anterior.idServico ?? "?"}`);
}

export async function gravarDesfecho(consultaId: string, d: Desfecho, servico?: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin
    .from("ConsultaFiscal")
    .update({
      status: d.status,
      resumo: d.resumo.slice(0, 2000),
      resultado: d.resultado,
      erro: d.erro ?? null,
      custoEstimado: custoDoDesfecho(d, servico),
    })
    .eq("id", consultaId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function carregarConsulta(id: string) {
  const { data, error } = await supabaseAdmin
    .from("ConsultaFiscal")
    .select('id, "clienteId", servico, status, resultado, cliente:Cliente("cpfCnpj")')
    .eq("tenantId", TENANT_ID)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const cli = (Array.isArray(data.cliente) ? data.cliente[0] : data.cliente) as { cpfCnpj: string | null } | null;
  return { consulta: data as unknown as Consulta, contribuinte: contribuinteDe(cli?.cpfCnpj) };
}


// ===========================================================================
// Caixa postal, parcelamentos e procuração (formatos vistos no inboundcont-crm,
// src/lib/caixaPostal.js e serproPuro.js, com respostas reais de 06/10/2026)
// ===========================================================================

/** Importante = não lida E (Painel de Conformidade OU assunto com estas palavras). Suposição a validar com o escritório. */
const PALAVRAS_IMPORTANTES = [
  "intimacao", "notificacao", "termo de", "auto de infracao", "exclusao", "cobranca", "malha",
  "despacho decisorio", "ato declaratorio", "cancelamento", "omissao", "inadimpl", "debito", "irregular", "pendencia", "prazo",
];
const SISTEMAS_IMPORTANTES = ["00050"];

type MensagemCaixa = {
  isn?: string | number;
  dataEnvio?: string;
  indicadorLeitura?: string | number;
  assuntoModelo?: string;
  assunto?: string;
  valorParametroAssunto?: string;
  codigoSistemaRemetente?: string;
};

function abrirDados(d: unknown): unknown {
  if (typeof d === "string") {
    try {
      return JSON.parse(d);
    } catch {
      return d;
    }
  }
  return d;
}

const dataCaixa = (s?: string) => {
  const t = String(s ?? "");
  return /^\d{8}$/.test(t) ? `${t.slice(6, 8)}/${t.slice(4, 6)}/${t.slice(0, 4)}` : t;
};

export function resumirCaixaPostal(dadosBrutos: unknown) {
  const dados = abrirDados(dadosBrutos) as
    | { conteudo?: Array<{ listaMensagens?: MensagemCaixa[]; indicadorUltimaPagina?: string }> }
    | null;
  if (!dados || !Array.isArray(dados.conteudo)) return null;
  const msgs = dados.conteudo.flatMap((c) => (Array.isArray(c?.listaMensagens) ? c.listaMensagens : []));
  const naoLida = (m: MensagemCaixa) => String(m.indicadorLeitura ?? "") === "0";
  const assunto = (m: MensagemCaixa) =>
    String(m.assuntoModelo ?? m.assunto ?? "")
      .replace(/\+\+VARIAVEL\+\+/g, (m.valorParametroAssunto ?? "").trim() || "…")
      .replace(/\s+/g, " ")
      .trim() || "(sem assunto)";
  const importante = (m: MensagemCaixa) =>
    SISTEMAS_IMPORTANTES.includes(String(m.codigoSistemaRemetente ?? "")) ||
    PALAVRAS_IMPORTANTES.some((p) => normalizar(String(m.assuntoModelo ?? m.assunto ?? "")).includes(p));
  const importantes = msgs.filter((m) => naoLida(m) && importante(m));
  return {
    total: msgs.length,
    naoLidas: msgs.filter(naoLida).length,
    importantes: importantes.length,
    mensagens: msgs.slice(0, 30).map((m) => ({
      data: dataCaixa(m.dataEnvio),
      assunto: assunto(m),
      naoLida: naoLida(m),
      importante: naoLida(m) && importante(m),
    })),
    temMaisPaginas: dados.conteudo.some((c) => c?.indicadorUltimaPagina === "N"),
  };
}

export function interpretarCaixaPostal(r: ResultadoGateway): Desfecho {
  if (!r.ok) return desfechoDeErroSerpro(r, "Caixa postal");
  const cx = resumirCaixaPostal(r.dados);
  if (!cx) {
    return {
      status: "erro",
      resumo: "Caixa postal: resposta em formato desconhecido.",
      resultado: { ...rastreio(r), dados: r.dados },
      erro: "formato",
    };
  }
  return {
    status: cx.importantes > 0 ? "com_pendencia" : "ok",
    resumo: cx.importantes > 0
      ? `Caixa postal: ${cx.importantes} mensagem(ns) importante(s) não lida(s) de ${cx.total}.`
      : `Caixa postal: ${cx.total} mensagem(ns), ${cx.naoLidas} não lida(s), nenhuma importante.`,
    resultado: { ...rastreio(r), caixaPostal: cx },
  };
}

export function idsParcelamento(regime: string): { idSistema: string; idServico: string } | null {
  if (regime === "MEI") return { idSistema: "PARCMEI", idServico: "PEDIDOSPARC203" };
  if (regime === "Simples Nacional") return { idSistema: "PARCSN", idServico: "PEDIDOSPARC163" };
  return null;
}

function statusParcelamento(situacao: unknown): "ATIVO" | "QUITADO" | "RESCINDIDO" | "CANCELADO" {
  const s = String(situacao ?? "").toLowerCase();
  if (s.includes("liquidad") || s.includes("quitad")) return "QUITADO";
  if (s.includes("rescindid")) return "RESCINDIDO";
  if (s.includes("cancelad") || s.includes("encerrad")) return "CANCELADO";
  return "ATIVO";
}

export function interpretarParcelamentos(r: ResultadoGateway, modalidade: string): Desfecho {
  const msgs = mensagensTexto(r);
  const dados = abrirDados(r.dados) as { parcelamentos?: unknown[]; parcelamentosParc?: unknown[] } | null;
  const lista = Array.isArray(dados?.parcelamentos)
    ? dados.parcelamentos
    : Array.isArray(dados?.parcelamentosParc)
    ? dados.parcelamentosParc
    : null;
  // Sem parcelamento a resposta real vem vazia com esta mensagem (e é cobrada).
  const semPedido = /n[aã]o existe pedido de parcelamento/i.test(msgs);
  if (!r.ok && !semPedido) return desfechoDeErroSerpro(r, "Parcelamentos");
  if (lista === null && !semPedido) {
    return {
      status: "erro",
      resumo: "Parcelamentos: resposta em formato desconhecido.",
      resultado: { ...rastreio(r), dados: r.dados, mensagens: r.mensagens },
      erro: "formato",
    };
  }
  const itens = (lista ?? []).map((it, i) => {
    const o = (it ?? {}) as Record<string, unknown>;
    return {
      numero: String(o.numero ?? o.numeroParcelamento ?? `${modalidade}-${i + 1}`),
      dataPedido: o.dataDoPedido ?? null,
      situacao: o.situacao ?? null,
      status: statusParcelamento(o.situacao),
    };
  });
  const ativos = itens.filter((p) => p.status === "ATIVO").length;
  return {
    status: "ok",
    resumo: itens.length === 0 ? "Nenhum pedido de parcelamento." : `${itens.length} parcelamento(s), ${ativos} ativo(s).`,
    resultado: { ...rastreio(r), modalidade, parcelamentos: itens, ativos },
  };
}

const hojeYmd = () => {
  const d = new Date();
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
};

/** OBTERPROCURACAO41: lista { dtexpiracao "AAAAMMDD", sistemas[] }. Vigente = expira hoje ou depois. */
export function analisarProcuracao(dadosBrutos: unknown) {
  const d = abrirDados(dadosBrutos);
  const comLista = d as { procuracoes?: unknown[] } | null;
  const lista = (
    Array.isArray(comLista?.procuracoes)
      ? comLista.procuracoes
      : Array.isArray(d)
      ? d
      : d && typeof d === "object" && Object.keys(d).length
      ? [d]
      : []
  ) as Array<Record<string, unknown>>;
  const expiracao = (p: Record<string, unknown>) => {
    const bruto = p?.dtexpiracao ?? p?.validBefore ?? p?.dataValidade ?? p?.validade;
    if (!bruto) return null;
    const s = String(bruto).replace(/\D/g, "");
    return /^\d{8}$/.test(s) ? Number(s) : null;
  };
  const vigentes = lista.filter((p) => {
    const ymd = expiracao(p);
    if (ymd != null) return ymd >= hojeYmd();
    return /^ativ/i.test(String(p?.status ?? p?.situacao ?? "")) || (Array.isArray(p?.sistemas) && p.sistemas.length > 0);
  });
  if (!vigentes.length) return { ativa: false, total: lista.length, validade: null as string | null, sistemas: [] as string[] };
  const primeira = vigentes[0]!;
  const ymd = expiracao(primeira);
  const s = ymd ? String(ymd) : "";
  return {
    ativa: true,
    total: lista.length,
    validade: s ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null,
    sistemas: Array.isArray(primeira.sistemas) ? (primeira.sistemas as unknown[]).map(String) : [],
  };
}

export function interpretarProcuracao(r: ResultadoGateway): Desfecho {
  if (r.ok) {
    const a = analisarProcuracao(r.dados);
    return {
      status: a.ativa ? "ok" : "com_pendencia",
      resumo: a.ativa
        ? `Procuração vigente${a.validade ? ` até ${a.validade.split("-").reverse().join("/")}` : ""}.`
        : "O Serpro não encontrou procuração vigente para o escritório.",
      resultado: { ...rastreio(r), procuracao: a.ativa ? "ativa" : "sem_procuracao", validade: a.validade, sistemas: a.sistemas },
    };
  }
  // 403 = quase sempre falta de procuração.
  if (r.serpro_http === 403) {
    const msgs = mensagensTexto(r);
    return {
      status: "com_pendencia",
      resumo: `Sem procuração eletrônica para o escritório no e-CAC.${msgs ? ` (${msgs})` : ""}`.slice(0, 1000),
      resultado: { ...rastreio(r), procuracao: "sem_procuracao", mensagens: r.mensagens },
    };
  }
  return desfechoDeErroSerpro(r, "Procuração");
}

// ===========================================================================
// Custo estimado (tabela do contrato, faixa 1; docs/INTEGRA-CONTADOR.md do
// gateway). O preço é por verbo: Consultar 0,24 · Emitir 0,32 · Declarar 0,40.
// Pedir o protocolo do SITFIS (Apoiar) é grátis; buscar o relatório é Emitir.
// A fatura do Serpro é a que vale (faixa retroativa).
// ===========================================================================

export const CUSTO_POR_SERVICO: Record<string, number> = {
  SITFIS: 0.32,
  PGDASD: 0.24,
  DCTFWEB: 0.24,
  CCMEI: 0.24,
  CAIXAPOSTAL: 0.24,
  PARCELAMENTOS: 0.24,
  PROCURACAO: 0.24,
  AVANCADO: 0.24,
};

/** Custo do desfecho: o que o gateway informou; senão a tabela, só se o Serpro chegou a responder. */
export function custoDoDesfecho(d: Desfecho, servico?: string): number | null {
  const res = d.resultado ?? {};
  const doGateway = res.custoEstimado;
  if (typeof doGateway === "number" && Number.isFinite(doGateway)) return doGateway;
  if (res.cobrado === false) return 0;
  if (typeof res.serproHttp === "number" && servico) return CUSTO_POR_SERVICO[servico] ?? 0.24;
  return d.status === "pendente" ? null : 0;
}

// ===========================================================================
// Executar uma consulta de ponta a ponta (tela e agendamento)
// ===========================================================================

export type ClienteConsulta = {
  id: string;
  nome: string;
  cpfCnpj: string | null;
  ativo: boolean;
  regimeTributario: string | null;
};

/** Valida o cliente para o serviço. Devolve o contribuinte ou a mensagem de recusa. */
export function contribuinteParaServico(
  cli: ClienteConsulta,
  servico: Servico,
): { contribuinte: string } | { recusa: string } {
  if (cli.ativo === false) return { recusa: "Cliente inativo: reative o cadastro para consultar o Serpro." };
  const contribuinte = contribuinteDe(cli.cpfCnpj);
  if (!contribuinte) return { recusa: "Cliente sem CPF/CNPJ válido no cadastro." };
  const soCnpj = ["DCTFWEB", "PGDASD", "CCMEI", "PARCELAMENTOS"];
  if (soCnpj.includes(servico) && contribuinte.length !== 14) return { recusa: `${servico} só se aplica a CNPJ.` };
  if (servico === "PARCELAMENTOS" && !idsParcelamento(cli.regimeTributario ?? "")) {
    return { recusa: "Parcelamentos: só para clientes do Simples Nacional ou MEI." };
  }
  return { contribuinte };
}

export async function executarConsulta(p: {
  cliente: ClienteConsulta;
  contribuinte: string;
  servico: Servico;
  body: Record<string, unknown>;
  operador: string;
  porId: string | null;
  origem: "manual" | "agendamento";
  agendamentoId?: string | null;
}): Promise<{ linha: Record<string, unknown>; desfecho: Desfecho; excecao: unknown }> {
  const { data: consulta, error: insErr } = await supabaseAdmin
    .from("ConsultaFiscal")
    .insert({
      tenantId: TENANT_ID,
      clienteId: p.cliente.id,
      servico: p.servico,
      status: "pendente",
      porId: p.porId,
      origem: p.origem,
      agendamentoId: p.agendamentoId ?? null,
    })
    .select('id, "clienteId", servico, resultado')
    .single();
  if (insErr || !consulta) throw insErr ?? new Error("Falha ao registrar a consulta");

  let desfecho: Desfecho;
  let excecao: unknown = null;
  try {
    desfecho = await rodarServico(
      {
        consulta: consulta as Consulta,
        contribuinte: p.contribuinte,
        operador: p.operador,
        body: { ...p.body, regimeTributario: p.cliente.regimeTributario },
      },
      p.servico,
    );
  } catch (err) {
    excecao = err;
    desfecho = desfechoDeExcecao(err);
    if (!(err instanceof GatewayErro)) {
      await recordError({
        origem: "serpro",
        mensagem: `consultar ${p.servico}: ${desfecho.resumo}`,
        stack: err instanceof Error ? err.stack : null,
      });
    }
  }
  const linha = await gravarDesfecho(consulta.id as string, desfecho, p.servico);
  return { linha, desfecho, excecao };
}
