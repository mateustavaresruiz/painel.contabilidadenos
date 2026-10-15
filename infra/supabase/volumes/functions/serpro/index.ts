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
// O operador mandado ao gateway (X-Operador) é o nome do colaborador logado.
//
// Rotas (exigem o JWT do usuário logado com Colaborador ativo; ele vira `porId`):
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
//   CAIXAPOSTAL   MSGCONTRIBUINTE61 (Consultar) — mensagens do e-CAC, conta as importantes não lidas
//   PARCELAMENTOS PEDIDOSPARC163 (Simples) / PEDIDOSPARC203 (MEI) (Consultar), pelo regime do cadastro
//   PROCURACAO    OBTERPROCURACAO41 (Consultar) — o gateway preenche outorgante/outorgado
//   (lógica em _shared/serpro-servicos.ts, compartilhada com o agendamento em crons)
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
import { exigirColaborador, semPermissao, tem } from "../_shared/acesso.ts";
import { recordError } from "../_shared/error-log.ts";
import { enforceRateLimit, sujeitoTenant } from "../_shared/rate-limit.ts";
import { gateway, gatewayConfigurado, type RespostaGateway } from "../_shared/serpro.ts";
import {
  BUCKET,
  carregarConsulta,
  type ClienteConsulta,
  contribuinteParaServico,
  type Ctx,
  type Desfecho,
  desfechoDaConfirmacao,
  desfechoDeErroGateway,
  desfechoDeExcecao,
  executarConsulta,
  FALTA_LEGIVEL,
  gravarDesfecho,
  type Servico,
  SERVICOS,
  sitfisEmitir,
} from "../_shared/serpro-servicos.ts";

// ===========================================================================
// Handler
// ===========================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") return handleCors(req);
  const colaborador = await exigirColaborador(req);
  if (colaborador instanceof Response) return colaborador;

  const url = new URL(req.url);
  const sub = url.pathname.split("/").filter(Boolean).slice(1);
  const action = sub[0] ?? "";

  try {
    const operador = colaborador.nome;

    // Permissão do cargo por rota: consultar (e acompanhar) = serpro.consultar,
    // confirmar com PIN = serpro.confirmar_pin, testar o login = configurações.
    const exigidas =
      action === "status" ? ["serpro.consultar", "configuracoes.gerenciar"]
      : action === "testar-autenticacao" ? ["configuracoes.gerenciar"]
      : action === "consultas" && sub[2] === "confirmar" ? ["serpro.confirmar_pin"]
      : action === "consultas" && sub[2] === "pdf" ? ["serpro.consultar", "clientes.ver"]
      : ["serpro.consultar"];
    if (!exigidas.some((p) => tem(colaborador, p))) return semPermissao(exigidas[0]!);

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
      const linha = await gravarDesfecho(c.consulta.id, desfecho, c.consulta.servico);
      // Auditoria: quem confirmou com PIN (o PIN em si nunca é gravado).
      try {
        await supabaseAdmin.rpc("auditoria_evento", {
          p_modulo: "pendencias",
          p_entidade: "consulta",
          p_entidade_id: c.consulta.id,
          p_acao: "pin_confirmado",
          p_resumo: `confirmou com PIN a consulta ${c.consulta.servico}`,
          p_cliente: c.consulta.clienteId,
          p_ator: colaborador.id,
        });
      } catch (err) {
        console.error("serpro: auditoria falhou", err);
      }
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
      return json({ consulta: await gravarDesfecho(c.consulta.id, desfecho, c.consulta.servico) });
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
        .select('id, nome, "cpfCnpj", ativo, "regimeTributario"')
        .eq("tenantId", TENANT_ID)
        .eq("id", clienteId)
        .maybeSingle();
      if (cliErr) throw cliErr;
      if (!cli) return notFound("Cliente não encontrado");
      const val = contribuinteParaServico(cli as ClienteConsulta, servico);
      if ("recusa" in val) return badRequest(val.recusa);

      const { linha, desfecho } = await executarConsulta({
        cliente: cli as ClienteConsulta,
        contribuinte: val.contribuinte,
        servico,
        body,
        operador,
        porId: colaborador.id,
        origem: "manual",
      });
      return json({ consulta: linha }, { status: desfecho.status === "erro" ? 424 : 200 });
    }

    return notFound(`Rota ${req.method} /${sub.join("/")} não encontrada`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : (err as { message?: string })?.message ?? String(err);
    await recordError({ origem: "serpro", mensagem: `serpro ${sub[0] ?? ""}: ${msg}`, stack: err instanceof Error ? err.stack : null });
    return json({ error: msg }, { status: 500, headers: { "x-erro-registrado": "1" } });
  }
});
