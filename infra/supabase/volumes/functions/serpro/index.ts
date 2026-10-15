// Edge Function: serpro
// URL: https://painel-supabase.at63vf.easypanel.host/functions/v1/serpro
//
// Consulta de pendências fiscais dos clientes pela API Integra Contador do
// Serpro, SEMPRE através do gateway Integra Contador (`_shared/serpro.ts`):
// certificado e credenciais do Serpro ficam lá, nunca aqui.
//
// Toda consulta vira uma linha em ConsultaFiscal: nasce `pendente`, termina
// `ok` | `com_pendencia` | `erro`, com `resumo` legível e `resultado` (jsonb).
// PDFs devolvidos (relatório SITFIS, recibos) vão pro bucket privado
// `consultas-fiscais`, em `denos/<clienteId>/<consultaId>-<nome>.pdf`.
//
// O CPF/CNPJ consultado sai SEMPRE do cadastro do cliente, nunca do corpo.
// O operador mandado ao gateway (X-Operador) é o nome do colaborador de
// `x-colaborador-id` (ou "painel-denos" sem colaborador).
//
// Rotas (exigem a chave apikey; `x-colaborador-id` opcional vira `porId`):
//   GET  /serpro/status                    → configurado? o que falta? (GET /v1/status do gateway)
//   POST /serpro/testar-autenticacao       → testa o login no Serpro (GET /v1/status?testar_login=1)
//   POST /serpro/consultar { clienteId, servico, periodo?, categoria?, ... }
//   POST /serpro/consultas/:id/retomar     → continua um SITFIS em processamento
//   POST /serpro/consultas/:id/confirmar { pin } → confirma serviço que pede PIN
//   POST /serpro/consultas/:id/cancelar    → cancela a confirmação pendente
//   GET  /serpro/consultas/:id/pdf         → URL assinada (10 min) do PDF
//
// Serviços:
//   SITFIS   SOLICITARPROTOCOLO91 (Apoiar, grátis) → espera `tempo_espera` →
//            RELATORIOSITFIS92 (Emitir; o gateway roda SEM PIN porque está em
//            SERVICOS_SEM_CONFIRMACAO)
//   PGDASD   CONSULTIMADECREC14 { periodoApuracao: AAAAMM }   (Consultar)
//   DCTFWEB  CONSRECIBO32 { categoria, anoPA, mesPA }         (Consultar)
//   CCMEI    DADOSCCMEI122 — verbo fora da tabela do gateway: ele pede PIN
//   AVANCADO { idSistema, idServico, versaoSistema?, dados?, verbo? } — o
//            gateway decide se executa ou pede PIN
// Quando o gateway pede confirmação (HTTP 202), a consulta fica `pendente`
// com `resultado.confirmacao` (id, resumo, custo, validade) até alguém
// confirmar com o PIN ou cancelar. A confirmação vive na MEMÓRIA do gateway:
// se ele reiniciar, ela some, e a consulta vira `erro` ao tentar confirmar.

import { handleCors } from "../_shared/cors.ts";
import { badRequest, errorResponse, json, notFound, serviceUnavailable } from "../_shared/response.ts";
import { serve } from "../_shared/serve.ts";
import { supabaseAdmin, TENANT_ID } from "../_shared/supabase.ts";
import { colaboradorDoRequest, exigirApikey } from "../_shared/acesso.ts";
import { recordError } from "../_shared/error-log.ts";
import { enforceRateLimit, sujeitoTenant } from "../_shared/rate-limit.ts";
import {
  base64ParaBytes,
  type ConfirmacaoGateway,
  contribuinteDe,
  gateway,
  gatewayConfigurado,
  GatewayErro,
  mensagensTexto,
  normalizar,
  pedidoChamada,
  type RespostaGateway,
  type ResultadoGateway,
  textoDoPdf,
} from "../_shared/serpro.ts";

const BUCKET = "consultas-fiscais";
const SERVICOS = ["SITFIS", "PGDASD", "DCTFWEB", "CCMEI", "AVANCADO"] as const;
type Servico = (typeof SERVICOS)[number];

/** Quanto o SITFIS pode esperar dentro de UMA requisição (runtime corta em 150s). */
const ORCAMENTO_SITFIS_MS = 100_000;

/** Nome legível de cada pendência que o gateway lista em `faltam`. */
const FALTA_LEGIVEL: Record<string, string> = {
  SERPRO_CONSUMER_KEY: "SERPRO_CONSUMER_KEY (consumer key do contrato Integra Contador)",
  SERPRO_CONSUMER_SECRET: "SERPRO_CONSUMER_SECRET (consumer secret do contrato Integra Contador)",
  SERPRO_CONTRATANTE_CNPJ: "SERPRO_CONTRATANTE_CNPJ (CNPJ do contratante)",
  SERPRO_CERT_PASSWORD: "SERPRO_CERT_PASSWORD (senha do certificado A1)",
  GATEWAY_PIN_CONFIRMACAO: "GATEWAY_PIN_CONFIRMACAO (PIN de confirmação do gateway)",
  GATEWAY_API_KEY: "GATEWAY_API_KEY (chave do gateway)",
};

type Desfecho = {
  status: "pendente" | "ok" | "com_pendencia" | "erro";
  resumo: string;
  resultado: Record<string, unknown>;
  erro?: string | null;
};

type Consulta = {
  id: string;
  clienteId: string;
  servico: string;
  status?: string;
  resultado: Record<string, unknown> | null;
};

type Ctx = { consulta: Consulta; contribuinte: string; operador: string; body: Record<string, unknown> };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mesAnterior(): { ano: string; mes: string } {
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
function desfechoDeErroGateway(g: RespostaGateway, oQue: string): Desfecho {
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
function desfechoDeExcecao(err: unknown): Desfecho {
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
async function sitfisEmitir(ctx: Ctx, protocolo: string, esperaInicialMs: number, inicio: number): Promise<Desfecho> {
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

async function rodarServico(ctx: Ctx, servico: Servico): Promise<Desfecho> {
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
function desfechoDaConfirmacao(ctx: Ctx, c: ConfirmacaoGateway): Desfecho | Promise<Desfecho> {
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

async function gravarDesfecho(consultaId: string, d: Desfecho): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin
    .from("ConsultaFiscal")
    .update({ status: d.status, resumo: d.resumo.slice(0, 2000), resultado: d.resultado, erro: d.erro ?? null })
    .eq("id", consultaId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function carregarConsulta(id: string) {
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
// Handler
// ===========================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") return handleCors(req);
  const semChave = exigirApikey(req);
  if (semChave) return semChave;

  const url = new URL(req.url);
  const sub = url.pathname.split("/").filter(Boolean).slice(1);
  const action = sub[0] ?? "";

  try {
    const { colaborador, erro: erroColab } = await colaboradorDoRequest(req);
    if (erroColab) return erroColab;
    const operador = colaborador?.nome ?? "painel-denos";

    // GET /serpro/status — o `/v1/status` do gateway, no formato da tela:
    // `configurado` + `faltando` (texto com o nome da variável). Nunca
    // devolve valor de segredo.
    if (action === "status" && req.method === "GET") {
      const cfg = gatewayConfigurado();
      if (!cfg.ok) {
        return json({
          configurado: false,
          faltando: cfg.faltando,
          gatewayAlcancavel: false,
          servicos: SERVICOS,
          mensagem: `Gateway Integra Contador não configurado nas funções. Falta: ${cfg.faltando.join(", ")}.`,
        });
      }
      let g: RespostaGateway;
      try {
        g = await gateway("/v1/status", { method: "GET", operador, timeoutMs: 15_000 });
      } catch (err) {
        return json({
          configurado: false,
          faltando: [],
          gatewayAlcancavel: false,
          servicos: SERVICOS,
          mensagem: err instanceof Error ? err.message : "Gateway Integra Contador fora do ar.",
        });
      }
      if (g.http !== 200) {
        return json({
          configurado: false,
          faltando: g.http === 401 ? ["GATEWAY_API_KEY (o gateway recusou a chave)"] : [],
          gatewayAlcancavel: true,
          servicos: SERVICOS,
          mensagem: `O gateway respondeu HTTP ${g.http}${typeof g.corpo.mensagem === "string" ? `: ${g.corpo.mensagem}` : ""}.`,
        });
      }
      const s = g.corpo as {
        pausado?: boolean;
        faltam?: string[];
        certificado?: { erro?: string; titular?: string; cnpj?: string; validade?: string; dias_para_vencer?: number };
        contratante?: string | null;
        avisos?: string[];
        pin_confirmacao?: boolean;
        servicos_sem_confirmacao?: string[];
        confirmar_verbos?: string[];
      };
      const faltando = (s.faltam ?? []).map((f) => FALTA_LEGIVEL[f] ?? f);
      if (s.certificado?.erro) faltando.push(`Certificado A1 do contratante: ${s.certificado.erro}`);
      const configurado = faltando.length === 0 && !s.pausado;
      return json({
        configurado,
        faltando,
        gatewayAlcancavel: true,
        pausado: !!s.pausado,
        avisos: s.avisos ?? [],
        contratante: s.contratante ?? null,
        certificado: s.certificado?.erro
          ? { ok: false, erro: s.certificado.erro }
          : { ok: true, titular: s.certificado?.titular ?? null, cnpj: s.certificado?.cnpj ?? null, validade: s.certificado?.validade ?? null, diasParaVencer: s.certificado?.dias_para_vencer ?? null },
        pinConfirmacao: !!s.pin_confirmacao,
        servicosSemConfirmacao: s.servicos_sem_confirmacao ?? [],
        confirmarVerbos: s.confirmar_verbos ?? [],
        servicos: SERVICOS,
        mensagem: configurado
          ? "Integração com o Serpro pronta (via gateway Integra Contador)."
          : s.pausado
          ? "As chamadas ao Serpro estão pausadas no gateway."
          : `Integração com o Serpro não configurada no gateway. Falta: ${faltando.map((f) => f.replace(/\.+$/, "")).join("; ")}.`,
      });
    }

    const cfg = gatewayConfigurado();
    if (!cfg.ok && action !== "consultas") {
      return serviceUnavailable(`Gateway Integra Contador não configurado nas funções. Falta: ${cfg.faltando.join(", ")}.`);
    }

    // POST /serpro/testar-autenticacao → login no Serpro feito pelo gateway.
    if (action === "testar-autenticacao" && req.method === "POST") {
      try {
        const g = await gateway("/v1/status?testar_login=1", { method: "GET", operador, timeoutMs: 45_000 });
        const login = (g.corpo as { login?: { ok: boolean; erro?: string } }).login;
        if (g.http === 200 && login?.ok) {
          return json({ ok: true, mensagem: "Login no Serpro OK (certificado e credenciais aceitos pelo gateway)." });
        }
        const msg = login?.erro ?? (typeof g.corpo.mensagem === "string" ? g.corpo.mensagem : `HTTP ${g.http}`);
        return json({ ok: false, error: `Login no Serpro falhou: ${msg}` }, { status: 424 });
      } catch (err) {
        return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 424 });
      }
    }

    // GET /serpro/consultas/:id/pdf → URL assinada
    if (action === "consultas" && sub[2] === "pdf" && req.method === "GET") {
      const { data: c } = await supabaseAdmin.from("ConsultaFiscal").select("resultado").eq("id", sub[1]).maybeSingle();
      const path = (c?.resultado as { pdfPath?: string } | null)?.pdfPath;
      if (!path) return notFound("Esta consulta não tem PDF.");
      const { data: signed, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 600);
      if (error || !signed?.signedUrl) return notFound("PDF indisponível.");
      const publica = (Deno.env.get("PUBLIC_BASE_URL") ?? "").replace(/\/+$/, "");
      const interna = new URL(Deno.env.get("SUPABASE_URL") ?? "http://api-gw:8000").origin;
      const u = new URL(signed.signedUrl);
      return json({ url: publica && u.origin === interna ? `${publica}${u.pathname}${u.search}` : signed.signedUrl });
    }

    if (!cfg.ok) {
      return serviceUnavailable(`Gateway Integra Contador não configurado nas funções. Falta: ${cfg.faltando.join(", ")}.`);
    }

    // POST /serpro/consultas/:id/cancelar — cancela a confirmação pendente.
    if (action === "consultas" && sub[2] === "cancelar" && req.method === "POST") {
      const c = await carregarConsulta(sub[1]);
      if (!c) return notFound("Consulta não encontrada");
      const cid = (c.consulta.resultado?.confirmacao as { id?: string } | undefined)?.id;
      if (c.consulta.status !== "pendente" || !cid) return badRequest("Esta consulta não está aguardando confirmação.");
      const g = await gateway(`/v1/confirmacoes/${encodeURIComponent(cid)}/cancelar`, { operador });
      // NAO_ENCONTRADA: o gateway reiniciou e a pendência já sumiu — cancelada de fato.
      if (g.http !== 200 && g.corpo.erro !== "NAO_ENCONTRADA") {
        return errorResponse(String(g.corpo.mensagem ?? `Gateway respondeu HTTP ${g.http}`), g.http === 409 ? 409 : 424);
      }
      const linha = await gravarDesfecho(c.consulta.id, {
        status: "erro",
        resumo: `Cancelada por ${operador}.`,
        resultado: { ...(c.consulta.resultado ?? {}), aguardandoPin: false, cancelada: true },
        erro: "cancelada",
      });
      return json({ consulta: linha });
    }

    // Freio: cada consulta é cobrada pelo Serpro. 30/min cobre um lote manual
    // da carteira sem deixar um loop esvaziar a franquia. (O gateway tem o
    // próprio teto, por operador e global.)
    const freio = await enforceRateLimit({
      action: "serpro:consulta",
      sujeito: sujeitoTenant(TENANT_ID),
      max: 30,
      windowSecs: 60,
      mensagem: "Muitas consultas ao Serpro em pouco tempo. Aguarde um minuto.",
    });
    if (freio) return freio;

    // POST /serpro/consultas/:id/confirmar { pin }
    if (action === "consultas" && sub[2] === "confirmar" && req.method === "POST") {
      const body = ((await req.json().catch(() => null)) ?? {}) as { pin?: unknown };
      const pin = typeof body.pin === "string" || typeof body.pin === "number" ? String(body.pin).trim() : "";
      if (!pin) return badRequest("Informe o PIN de confirmação.");
      const c = await carregarConsulta(sub[1]);
      if (!c) return notFound("Consulta não encontrada");
      const cid = (c.consulta.resultado?.confirmacao as { id?: string } | undefined)?.id;
      if (c.consulta.status !== "pendente" || !cid) return badRequest("Esta consulta não está aguardando confirmação.");
      if (!c.contribuinte) return badRequest("Cliente sem CPF/CNPJ válido.");
      const ctx: Ctx = { consulta: c.consulta, contribuinte: c.contribuinte, operador, body: {} };

      const g = await gateway(`/v1/confirmacoes/${encodeURIComponent(cid)}/confirmar`, { body: { pin }, operador });
      const codigo = typeof g.corpo.erro === "string" ? g.corpo.erro : null;
      const msgGateway = typeof g.corpo.mensagem === "string" ? g.corpo.mensagem : `Gateway respondeu HTTP ${g.http}`;

      // Erros que NÃO mudam a consulta: dá pra tentar de novo.
      if (codigo === "PIN_INVALIDO") return errorResponse(msgGateway || "PIN inválido.", 400);
      if (codigo === "PIN_BLOQUEADO_TEMPORARIAMENTE" || codigo === "LIMITE") return errorResponse(msgGateway, 429);
      if (codigo === "PAUSADO") return errorResponse(msgGateway, 503);
      if (codigo === "PIN_NAO_CONFIGURADO") return errorResponse(msgGateway, 503);

      let desfecho: Desfecho;
      if (g.http === 200 && g.corpo.confirmacao) {
        try {
          desfecho = await desfechoDaConfirmacao(ctx, g.corpo.confirmacao);
        } catch (err) {
          desfecho = desfechoDeExcecao(err);
        }
      } else if (codigo === "JA_PROCESSADA" && g.corpo.confirmacao) {
        // Outra aba confirmou antes: adota o resultado de lá.
        desfecho = await desfechoDaConfirmacao(ctx, g.corpo.confirmacao);
      } else if (codigo === "PIN_BLOQUEADO") {
        desfecho = { status: "erro", resumo: "Cancelada: PIN errado 5 vezes.", resultado: { confirmacao: { id: cid } }, erro: codigo };
      } else if (codigo === "NAO_ENCONTRADA") {
        desfecho = {
          status: "erro",
          resumo: "A confirmação expirou ou o gateway reiniciou. Faça a consulta de novo.",
          resultado: { confirmacao: { id: cid } },
          erro: codigo,
        };
      } else {
        desfecho = desfechoDeErroGateway(g, "Confirmação");
      }
      const linha = await gravarDesfecho(c.consulta.id, desfecho);
      return json({ consulta: linha }, { status: desfecho.status === "erro" ? 424 : 200 });
    }

    // POST /serpro/consultas/:id/retomar — continua o SITFIS pendente.
    if (action === "consultas" && sub[2] === "retomar" && req.method === "POST") {
      const c = await carregarConsulta(sub[1]);
      if (!c) return notFound("Consulta não encontrada");
      const protocolo = (c.consulta.resultado as { protocoloRelatorio?: string } | null)?.protocoloRelatorio;
      const aguardandoPin = (c.consulta.resultado as { aguardandoPin?: boolean } | null)?.aguardandoPin;
      if (c.consulta.servico !== "SITFIS" || c.consulta.status !== "pendente" || !protocolo || aguardandoPin) {
        return badRequest("Só dá pra retomar relatório de situação fiscal em processamento.");
      }
      if (!c.contribuinte) return badRequest("Cliente sem CPF/CNPJ válido.");
      let desfecho: Desfecho;
      try {
        desfecho = await sitfisEmitir(
          { consulta: c.consulta, contribuinte: c.contribuinte, operador, body: {} },
          protocolo,
          0,
          Date.now(),
        );
      } catch (err) {
        desfecho = desfechoDeExcecao(err);
      }
      return json({ consulta: await gravarDesfecho(c.consulta.id, desfecho) });
    }

    // POST /serpro/consultar { clienteId, servico, ... }
    if (action === "consultar" && req.method === "POST") {
      const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
      const clienteId = typeof body.clienteId === "string" ? body.clienteId : "";
      const servico = String(body.servico ?? "").toUpperCase() as Servico;
      if (!clienteId) return badRequest("clienteId obrigatório");
      if (!SERVICOS.includes(servico)) return badRequest(`servico deve ser um de: ${SERVICOS.join(", ")}`);

      const { data: cli, error: cliErr } = await supabaseAdmin
        .from("Cliente")
        .select('id, nome, "cpfCnpj", ativo')
        .eq("tenantId", TENANT_ID)
        .eq("id", clienteId)
        .maybeSingle();
      if (cliErr) throw cliErr;
      if (!cli) return notFound("Cliente não encontrado");
      if (cli.ativo === false) return badRequest("Cliente inativo: reative o cadastro para consultar o Serpro.");
      const contribuinte = contribuinteDe(cli.cpfCnpj);
      if (!contribuinte) return badRequest("Cliente sem CPF/CNPJ válido no cadastro.");
      if ((servico === "DCTFWEB" || servico === "PGDASD" || servico === "CCMEI") && contribuinte.length !== 14) {
        return badRequest(`${servico} só se aplica a CNPJ.`);
      }

      const { data: consulta, error: insErr } = await supabaseAdmin
        .from("ConsultaFiscal")
        .insert({ tenantId: TENANT_ID, clienteId, servico, status: "pendente", porId: colaborador?.id ?? null })
        .select('id, "clienteId", servico, resultado')
        .single();
      if (insErr || !consulta) throw insErr ?? new Error("Falha ao registrar a consulta");

      let desfecho: Desfecho;
      try {
        desfecho = await rodarServico({ consulta: consulta as Consulta, contribuinte, operador, body }, servico);
      } catch (err) {
        desfecho = desfechoDeExcecao(err);
        if (!(err instanceof GatewayErro)) {
          await recordError({
            origem: "serpro",
            mensagem: `consultar ${servico}: ${desfecho.resumo}`,
            stack: err instanceof Error ? err.stack : null,
          });
        }
      }
      const linha = await gravarDesfecho(consulta.id, desfecho);
      return json({ consulta: linha }, { status: desfecho.status === "erro" ? 424 : 200 });
    }

    return notFound(`Rota ${req.method} /${sub.join("/")} não encontrada`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : (err as { message?: string })?.message ?? String(err);
    await recordError({ origem: "serpro", mensagem: `serpro ${sub[0] ?? ""}: ${msg}`, stack: err instanceof Error ? err.stack : null });
    return json({ error: msg }, { status: 500, headers: { "x-erro-registrado": "1" } });
  }
});
