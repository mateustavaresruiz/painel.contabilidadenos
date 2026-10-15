// Edge Function: serpro
// URL: https://painel-supabase.at63vf.easypanel.host/functions/v1/serpro
//
// Consulta de pendências fiscais dos clientes pela API Integra Contador do
// Serpro ("deixada pronta para uso": funciona assim que as credenciais e o
// certificado do escritório entrarem no env — ver `_shared/serpro.ts`).
//
// Toda consulta vira uma linha em ConsultaFiscal: nasce `pendente`, termina
// `ok` | `com_pendencia` | `erro`, com `resumo` legível e `resultado` (jsonb).
// PDFs devolvidos (relatório SITFIS, recibos) vão pro bucket privado
// `consultas-fiscais`, em `denos/<clienteId>/<consultaId>-<nome>.pdf`.
//
// Rotas (exigem a chave apikey; `x-colaborador-id` opcional vira `porId`):
//   GET  /serpro/status                    → configurado? o que falta?
//   POST /serpro/testar-autenticacao       → só autentica (não gasta consulta)
//   POST /serpro/consultar { clienteId, servico, periodo?, categoria?, ... }
//   POST /serpro/consultas/:id/retomar     → continua um SITFIS em processamento
//   GET  /serpro/consultas/:id/pdf         → URL assinada (10 min) do PDF
//
// Serviços (ids conferidos no catálogo do Integra Contador, out/2026):
//   SITFIS   Apoiar SOLICITARPROTOCOLO91 v2.0 → Emitir RELATORIOSITFIS92 v2.0
//            (assíncrono: espera o `tempoEspera`, ETag "tempoEspera:<ms>")
//   PGDASD   Consultar CONSULTIMADECREC14 v1.0 { periodoApuracao: AAAAMM }
//   DCTFWEB  Consultar CONSRECIBO32 v1.0 { categoria, anoPA, mesPA }
//   CCMEI    Consultar DADOSCCMEI122 v1.0 (dados vazio)
//   AVANCADO qualquer serviço: { tipo, idSistema, idServico, versaoSistema, dados }

import { handleCors } from "../_shared/cors.ts";
import {
  badRequest,
  json,
  notFound,
  serviceUnavailable,
} from "../_shared/response.ts";
import { serve } from "../_shared/serve.ts";
import { supabaseAdmin, TENANT_ID } from "../_shared/supabase.ts";
import { colaboradorDoRequest, exigirApikey } from "../_shared/acesso.ts";
import { recordError } from "../_shared/error-log.ts";
import { enforceRateLimit, sujeitoTenant } from "../_shared/rate-limit.ts";
import {
  base64ParaBytes,
  chamarSerpro,
  type Contribuinte,
  contribuinteDe,
  mensagensTexto,
  normalizar,
  type RespostaSerpro,
  SerproErro,
  SerproNaoConfigurado,
  statusSerpro,
  tempoEsperaDe,
  testarAutenticacao,
  textoDoPdf,
  type TipoChamada,
} from "../_shared/serpro.ts";

const BUCKET = "consultas-fiscais";
const SERVICOS = ["SITFIS", "PGDASD", "DCTFWEB", "CCMEI", "AVANCADO"] as const;
type Servico = (typeof SERVICOS)[number];

/** Quanto o SITFIS pode esperar dentro de UMA requisição (runtime corta em 150s). */
const ORCAMENTO_SITFIS_MS = 100_000;

type Desfecho = {
  status: "pendente" | "ok" | "com_pendencia" | "erro";
  resumo: string;
  resultado: Record<string, unknown>;
  erro?: string | null;
};

type Consulta = { id: string; clienteId: string; servico: string; resultado: Record<string, unknown> | null };

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

async function salvarPdf(consultaId: string, clienteId: string, nome: string, b64: string): Promise<string | null> {
  try {
    const bytes = base64ParaBytes(b64);
    const path = `${TENANT_ID}/${clienteId}/${consultaId}-${nome.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
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

/** Resposta de erro do Serpro → desfecho `erro` com a mensagem dele. */
function desfechoDeErro(r: RespostaSerpro, oQue: string): Desfecho {
  const msgs = mensagensTexto(r);
  return {
    status: "erro",
    resumo: `${oQue}: o Serpro respondeu HTTP ${r.httpStatus}${msgs ? ` — ${msgs}` : ""}`.slice(0, 1000),
    resultado: { httpStatus: r.httpStatus, mensagens: r.mensagens },
    erro: msgs || `HTTP ${r.httpStatus}`,
  };
}

// ---------------------------------------------------------------------------
// SITFIS — relatório de situação fiscal (2 passos, assíncrono)
// ---------------------------------------------------------------------------

async function sitfisSolicitar(c: Contribuinte): Promise<{ protocolo: string; esperaMs: number } | Desfecho> {
  const inicio = Date.now();
  while (Date.now() - inicio < 40_000) {
    const r = await chamarSerpro("Apoiar", c, {
      idSistema: "SITFIS",
      idServico: "SOLICITARPROTOCOLO91",
      versaoSistema: "2.0",
      dados: "",
    });
    const d = (r.dados ?? {}) as { protocoloRelatorio?: string };
    if (r.httpStatus === 200 && d.protocoloRelatorio) {
      return { protocolo: d.protocoloRelatorio, esperaMs: tempoEsperaDe(r) ?? 0 };
    }
    // 503 com tempoEspera = o serviço pediu pra esperar antes de pedir de novo.
    const espera = tempoEsperaDe(r);
    if ((r.httpStatus === 503 || r.httpStatus === 202) && espera) {
      await sleep(Math.min(espera, 15_000));
      continue;
    }
    return desfechoDeErro(r, "Solicitação do relatório de situação fiscal");
  }
  return {
    status: "erro",
    resumo: "O Serpro pediu para aguardar e não liberou o protocolo a tempo. Tente de novo em alguns minutos.",
    resultado: {},
    erro: "timeout protocolo",
  };
}

/**
 * Passo 2: emite o relatório com o protocolo. 202 = em processamento (espera o
 * `tempoEspera` do corpo), 204 = ainda processando (espera o do ETag), 200 =
 * pronto (`dados.pdf`). Esgotado o orçamento, devolve `pendente` com o
 * protocolo pra rota /retomar continuar.
 */
async function sitfisEmitir(
  consulta: Consulta,
  c: Contribuinte,
  protocolo: string,
  esperaInicialMs: number,
  inicio: number,
): Promise<Desfecho> {
  let espera = esperaInicialMs;
  while (true) {
    const restante = ORCAMENTO_SITFIS_MS - (Date.now() - inicio);
    if (espera > restante) {
      return {
        status: "pendente",
        resumo: "Relatório em processamento na Receita. Clique em \"Atualizar\" em instantes para buscá-lo.",
        resultado: {
          protocoloRelatorio: protocolo,
          proximaTentativaEm: new Date(Date.now() + espera).toISOString(),
        },
      };
    }
    if (espera > 0) await sleep(espera);
    const r = await chamarSerpro("Emitir", c, {
      idSistema: "SITFIS",
      idServico: "RELATORIOSITFIS92",
      versaoSistema: "2.0",
      dados: { protocoloRelatorio: protocolo },
    });
    if (r.httpStatus === 202 || r.httpStatus === 204) {
      espera = Math.max(tempoEsperaDe(r) ?? 5_000, 2_000);
      continue;
    }
    const d = (r.dados ?? {}) as { pdf?: string };
    if (r.httpStatus !== 200 || !d.pdf) {
      return desfechoDeErro(r, "Emissão do relatório de situação fiscal");
    }
    const pdfPath = await salvarPdf(consulta.id, consulta.clienteId, "situacao-fiscal.pdf", d.pdf);
    const diag = await diagnosticoSitfis(d.pdf);
    return {
      status: diag.status,
      resumo: diag.resumo,
      resultado: {
        protocoloRelatorio: protocolo,
        pdfPath,
        diagnostico: diag.diagnostico,
        trechos: diag.trechos,
        mensagens: r.mensagens,
      },
    };
  }
}

/**
 * Classifica o relatório lendo o texto do PDF (best-effort). A Receita
 * escreve "Não foram detectadas pendências/exigibilidades suspensas" quando
 * está tudo certo, e lista "Pendência - ..." / "Débito ..." quando não.
 */
async function diagnosticoSitfis(pdfB64: string): Promise<{
  status: "ok" | "com_pendencia";
  diagnostico: "sem_pendencias" | "com_pendencias" | "indeterminado";
  resumo: string;
  trechos: string[];
}> {
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
      status: "ok",
      diagnostico: "sem_pendencias",
      resumo: "Sem pendências na Receita Federal e na PGFN (relatório de situação fiscal).",
      trechos,
    };
  }
  if (trechos.length > 0 || /\bpendencias?\b.*\b(debito|divida|omissao)/.test(n)) {
    return {
      status: "com_pendencia",
      diagnostico: "com_pendencias",
      resumo: `Relatório de situação fiscal aponta pendência(s)${trechos.length ? `: ${trechos.slice(0, 3).join("; ")}` : ""}.`
        .slice(0, 1000),
      trechos,
    };
  }
  // ⚠️ Não deu pra ler o diagnóstico (fonte do PDF ilegível). `ok` aqui quer
  // dizer "relatório emitido", e o resumo diz isso com todas as letras.
  return {
    status: "ok",
    diagnostico: "indeterminado",
    resumo: "Relatório de situação fiscal emitido. Não foi possível ler o diagnóstico automaticamente: abra o PDF.",
    trechos,
  };
}

// ---------------------------------------------------------------------------
// Demais serviços (síncronos)
// ---------------------------------------------------------------------------

async function consultarPgdasd(consulta: Consulta, c: Contribuinte, body: Record<string, unknown>): Promise<Desfecho> {
  const pa = periodoDe(body.periodo);
  if (!pa) return { status: "erro", resumo: "Período inválido (use AAAAMM).", resultado: {}, erro: "periodo" };
  const periodo = `${pa.ano}${pa.mes}`;
  const r = await chamarSerpro("Consultar", c, {
    idSistema: "PGDASD",
    idServico: "CONSULTIMADECREC14",
    versaoSistema: "1.0",
    dados: { periodoApuracao: periodo },
  });
  const d = (r.dados ?? {}) as {
    numeroDeclaracao?: string;
    recibo?: { nomeArquivo?: string; pdf?: string };
    declaracao?: { nomeArquivo?: string; pdf?: string };
    maed?: { pdfNotificacao?: string; pdfDarf?: string };
  };
  if (r.httpStatus === 200 && d.numeroDeclaracao) {
    const reciboPath = d.recibo?.pdf ? await salvarPdf(consulta.id, consulta.clienteId, "recibo-pgdasd.pdf", d.recibo.pdf) : null;
    const declaracaoPath = d.declaracao?.pdf
      ? await salvarPdf(consulta.id, consulta.clienteId, "declaracao-pgdasd.pdf", d.declaracao.pdf)
      : null;
    const temMaed = !!(d.maed?.pdfNotificacao || d.maed?.pdfDarf);
    return {
      status: temMaed ? "com_pendencia" : "ok",
      resumo: temMaed
        ? `PGDAS-D ${pa.mes}/${pa.ano} transmitido (nº ${d.numeroDeclaracao}) com multa por atraso (MAED).`
        : `PGDAS-D ${pa.mes}/${pa.ano} transmitido (nº ${d.numeroDeclaracao}).`,
      resultado: { periodo, numeroDeclaracao: d.numeroDeclaracao, pdfPath: reciboPath, declaracaoPath, maed: temMaed },
    };
  }
  if (r.httpStatus === 404 || r.httpStatus === 204 || (r.httpStatus === 200 && !d.numeroDeclaracao)) {
    return {
      status: "com_pendencia",
      resumo: `Nenhuma declaração PGDAS-D transmitida para ${pa.mes}/${pa.ano}.${mensagensTexto(r) ? ` (${mensagensTexto(r)})` : ""}`
        .slice(0, 1000),
      resultado: { periodo, httpStatus: r.httpStatus, mensagens: r.mensagens },
    };
  }
  return desfechoDeErro(r, `PGDAS-D ${pa.mes}/${pa.ano}`);
}

async function consultarDctfweb(consulta: Consulta, c: Contribuinte, body: Record<string, unknown>): Promise<Desfecho> {
  const pa = periodoDe(body.periodo);
  if (!pa) return { status: "erro", resumo: "Período inválido (use AAAAMM).", resultado: {}, erro: "periodo" };
  const categoria = Number(body.categoria ?? 40) || 40; // 40 = GERAL_MENSAL
  const r = await chamarSerpro("Consultar", c, {
    idSistema: "DCTFWEB",
    idServico: "CONSRECIBO32",
    versaoSistema: "1.0",
    dados: { categoria, anoPA: pa.ano, mesPA: pa.mes },
  });
  const d = (r.dados ?? {}) as { PDFByteArrayBase64?: string };
  if (r.httpStatus === 200 && d.PDFByteArrayBase64) {
    const pdfPath = await salvarPdf(consulta.id, consulta.clienteId, "recibo-dctfweb.pdf", d.PDFByteArrayBase64);
    return {
      status: "ok",
      resumo: `DCTFWeb ${pa.mes}/${pa.ano} transmitida (recibo disponível).`,
      resultado: { periodo: `${pa.ano}${pa.mes}`, categoria, pdfPath },
    };
  }
  if (r.httpStatus === 404 || r.httpStatus === 204) {
    return {
      status: "com_pendencia",
      resumo: `Sem recibo de DCTFWeb para ${pa.mes}/${pa.ano} (declaração não transmitida?).${mensagensTexto(r) ? ` (${mensagensTexto(r)})` : ""}`
        .slice(0, 1000),
      resultado: { periodo: `${pa.ano}${pa.mes}`, categoria, httpStatus: r.httpStatus, mensagens: r.mensagens },
    };
  }
  return desfechoDeErro(r, `DCTFWeb ${pa.mes}/${pa.ano}`);
}

async function consultarCcmei(c: Contribuinte): Promise<Desfecho> {
  const r = await chamarSerpro("Consultar", c, {
    idSistema: "CCMEI",
    idServico: "DADOSCCMEI122",
    versaoSistema: "1.0",
    dados: "",
  });
  if (r.httpStatus !== 200 || !r.dados || typeof r.dados !== "object") return desfechoDeErro(r, "CCMEI");
  const d = r.dados as {
    nomeEmpresarial?: string;
    situacaoCadastralVigente?: string;
    enquadramento?: { optanteMei?: boolean; situacao?: string };
  };
  const situacao = d.situacaoCadastralVigente ?? "desconhecida";
  const ativa = normalizar(situacao).includes("ativa");
  const optante = d.enquadramento?.optanteMei;
  const ok = ativa && optante !== false;
  return {
    status: ok ? "ok" : "com_pendencia",
    resumo: `MEI: situação cadastral ${situacao}${optante === false ? ", NÃO optante pelo SIMEI" : ""}.`,
    resultado: { dados: d },
  };
}

async function consultarAvancado(c: Contribuinte, body: Record<string, unknown>): Promise<Desfecho> {
  const tipo = String(body.tipo ?? "Consultar") as TipoChamada;
  if (!["Consultar", "Emitir", "Apoiar", "Monitorar"].includes(tipo)) {
    // Declarar transmite declaração: não é consulta e não sai por aqui.
    return { status: "erro", resumo: "tipo deve ser Consultar, Emitir, Apoiar ou Monitorar.", resultado: {}, erro: "tipo" };
  }
  const idSistema = String(body.idSistema ?? "").trim();
  const idServico = String(body.idServico ?? "").trim();
  if (!idSistema || !idServico) {
    return { status: "erro", resumo: "idSistema e idServico obrigatórios.", resultado: {}, erro: "ids" };
  }
  const r = await chamarSerpro(tipo, c, {
    idSistema,
    idServico,
    versaoSistema: String(body.versaoSistema ?? "1.0"),
    dados: (body.dados as string | Record<string, unknown> | undefined) ?? "",
  });
  if (r.httpStatus >= 200 && r.httpStatus < 300) {
    return {
      status: "ok",
      resumo: `${idSistema}/${idServico}: HTTP ${r.httpStatus}${mensagensTexto(r) ? ` — ${mensagensTexto(r)}` : ""}`.slice(0, 1000),
      resultado: { httpStatus: r.httpStatus, mensagens: r.mensagens, dados: r.dados },
    };
  }
  return desfechoDeErro(r, `${idSistema}/${idServico}`);
}

async function gravarDesfecho(consultaId: string, d: Desfecho): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin
    .from("ConsultaFiscal")
    .update({
      status: d.status,
      resumo: d.resumo.slice(0, 2000),
      resultado: d.resultado,
      erro: d.erro ?? null,
    })
    .eq("id", consultaId)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Erro inesperado (rede, mTLS, código) → desfecho `erro` legível. */
function desfechoDeExcecao(err: unknown): Desfecho {
  if (err instanceof SerproNaoConfigurado) {
    return { status: "erro", resumo: err.message, resultado: { faltando: err.faltando }, erro: "nao_configurado" };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { status: "erro", resumo: msg.slice(0, 1000), resultado: {}, erro: msg.slice(0, 1000) };
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

  // GET /serpro/status — nunca devolve valor de segredo, só o que falta.
  if (action === "status" && req.method === "GET") {
    const st = statusSerpro();
    const { data: amb } = await supabaseAdmin.from("Config").select("valor").eq("chave", "serpro.ambiente").maybeSingle();
    return json({
      ...st,
      ambiente: amb?.valor ?? "producao",
      servicos: SERVICOS,
      mensagem: st.configurado
        ? "Integração com o Serpro configurada."
        : !st.mtlsSuportado
        ? "O runtime das funções não suporta mTLS (Deno.createHttpClient)."
        : `Integração com o Serpro não configurada. Falta: ${st.faltando.join(", ")}.`,
    });
  }

  const st = statusSerpro();
  const exigeConfig = ["testar-autenticacao", "consultar", "consultas"].includes(action) &&
    !(action === "consultas" && sub[2] === "pdf");
  if (exigeConfig && !st.configurado) {
    return serviceUnavailable(
      !st.mtlsSuportado
        ? "O runtime das funções não suporta mTLS (Deno.createHttpClient); a consulta ao Serpro não é possível aqui."
        : `Integração com o Serpro não configurada. Falta definir no servidor: ${st.faltando.join(", ")}.`,
    );
  }

  try {
    const { colaborador, erro: erroColab } = await colaboradorDoRequest(req);
    if (erroColab) return erroColab;

    // POST /serpro/testar-autenticacao
    if (action === "testar-autenticacao" && req.method === "POST") {
      try {
        await testarAutenticacao();
        return json({ ok: true, mensagem: "Autenticação no Serpro OK (certificado e credenciais aceitos)." });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return json({ ok: false, error: msg }, { status: 424 });
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

    // Freio: cada consulta é cobrada pelo Serpro. 30/min cobre um lote
    // manual da carteira sem deixar um loop esvaziar a franquia.
    const freio = await enforceRateLimit({
      action: "serpro:consulta",
      sujeito: sujeitoTenant(TENANT_ID),
      max: 30,
      windowSecs: 60,
      mensagem: "Muitas consultas ao Serpro em pouco tempo. Aguarde um minuto.",
    });
    if (freio) return freio;

    // POST /serpro/consultas/:id/retomar — continua o SITFIS pendente.
    if (action === "consultas" && sub[2] === "retomar" && req.method === "POST") {
      const { data: c } = await supabaseAdmin
        .from("ConsultaFiscal")
        .select('id, "clienteId", servico, status, resultado, cliente:Cliente("cpfCnpj")')
        .eq("id", sub[1])
        .maybeSingle();
      if (!c) return notFound("Consulta não encontrada");
      const protocolo = (c.resultado as { protocoloRelatorio?: string } | null)?.protocoloRelatorio;
      if (c.servico !== "SITFIS" || c.status !== "pendente" || !protocolo) {
        return badRequest("Só dá pra retomar relatório de situação fiscal em processamento.");
      }
      const cli = (Array.isArray(c.cliente) ? c.cliente[0] : c.cliente) as { cpfCnpj: string | null } | null;
      const contrib = contribuinteDe(cli?.cpfCnpj);
      if (!contrib) return badRequest("Cliente sem CPF/CNPJ válido.");
      let desfecho: Desfecho;
      try {
        desfecho = await sitfisEmitir(c as Consulta, contrib, protocolo, 0, Date.now());
      } catch (err) {
        desfecho = desfechoDeExcecao(err);
      }
      return json({ consulta: await gravarDesfecho(c.id, desfecho) });
    }

    // POST /serpro/consultar { clienteId, servico, ... }
    if (action === "consultar" && req.method === "POST") {
      const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
      const clienteId = typeof body.clienteId === "string" ? body.clienteId : "";
      const servico = String(body.servico ?? "").toUpperCase() as Servico;
      if (!clienteId) return badRequest("clienteId obrigatório");
      if (!SERVICOS.includes(servico)) {
        return badRequest(`servico deve ser um de: ${SERVICOS.join(", ")}`);
      }
      const { data: cli, error: cliErr } = await supabaseAdmin
        .from("Cliente")
        .select('id, nome, "cpfCnpj", tipo')
        .eq("tenantId", TENANT_ID)
        .eq("id", clienteId)
        .maybeSingle();
      if (cliErr) throw cliErr;
      if (!cli) return notFound("Cliente não encontrado");
      const contrib = contribuinteDe(cli.cpfCnpj);
      if (!contrib) return badRequest("Cliente sem CPF/CNPJ válido no cadastro.");
      if ((servico === "DCTFWEB" || servico === "PGDASD" || servico === "CCMEI") && contrib.tipo !== 2) {
        return badRequest(`${servico} só se aplica a CNPJ.`);
      }

      const { data: consulta, error: insErr } = await supabaseAdmin
        .from("ConsultaFiscal")
        .insert({
          tenantId: TENANT_ID,
          clienteId,
          servico,
          status: "pendente",
          porId: colaborador?.id ?? null,
        })
        .select('id, "clienteId", servico, resultado')
        .single();
      if (insErr || !consulta) throw insErr ?? new Error("Falha ao registrar a consulta");

      let desfecho: Desfecho;
      try {
        if (servico === "SITFIS") {
          const inicio = Date.now();
          const sol = await sitfisSolicitar(contrib);
          desfecho = "status" in sol
            ? sol
            : await sitfisEmitir(consulta as Consulta, contrib, sol.protocolo, sol.esperaMs, inicio);
        } else if (servico === "PGDASD") {
          desfecho = await consultarPgdasd(consulta as Consulta, contrib, body);
        } else if (servico === "DCTFWEB") {
          desfecho = await consultarDctfweb(consulta as Consulta, contrib, body);
        } else if (servico === "CCMEI") {
          desfecho = await consultarCcmei(contrib);
        } else {
          desfecho = await consultarAvancado(contrib, body);
        }
      } catch (err) {
        desfecho = desfechoDeExcecao(err);
        if (!(err instanceof SerproErro) && !(err instanceof SerproNaoConfigurado)) {
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
