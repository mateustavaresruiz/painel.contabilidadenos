// Edge Function: crons
// URL: https://painel-supabase.at63vf.easypanel.host/functions/v1/crons
//
// Protegido por header `x-cron-secret` (CRON_SECRET), comparado em tempo
// constante. Chamado pelo pg_cron do banco (migration 003), que lê o segredo
// do Vault e chama http://functions:9000/crons/<job> pela rede do compose.
//
// Rotas:
//   POST /crons/whatsapp-keepalive        ← a cada 5 min: reconcilia status
//   POST /crons/whatsapp-fotos-pendentes  ← a cada hora: fotos que faltam
//   POST /crons/certificados-avisos       ← diário 09:00 (SP): aviso de vencimento
//   POST /crons/certificados-avisos?dryRun=1 ← o que SERIA enviado, sem enviar
//   POST /crons/serpro-agendado          ← a cada 10 min (08h-19h50 SP): ciclos do AgendamentoSerpro
//        (ver crons/serpro-agendado.ts)
//        (o de cima, certificados-avisos?dryRun=1, aceita também o JWT de um colaborador logado, pra tela mostrar a prévia)
//
// A purga do WhatsappEventoLog / RateLimit / ErrorLog é SQL puro no pg_cron
// (migration 003) — não precisa de function.

import { handleCors } from "../_shared/cors.ts";
import { badRequest, json, notFound, unauthorized } from "../_shared/response.ts";
import { CRON_SECRET } from "../_shared/env.ts";
import { serve } from "../_shared/serve.ts";
import { supabaseAdmin, TENANT_ID } from "../_shared/supabase.ts";
import * as waha from "../_shared/waha.ts";
import { ensureChatPicture, ensureContatoPicture } from "../_shared/whatsapp-avatar.ts";
import { exigirColaborador, timingSafeEqual } from "../_shared/acesso.ts";
import { enviarTexto } from "../_shared/whatsapp-envio.ts";
import { onlyDigits } from "../_shared/phone-utils.ts";
import { serproAgendado } from "./serpro-agendado.ts";

function checkCronSecret(req: Request): boolean {
  const got = req.headers.get("x-cron-secret") ?? "";
  return Boolean(CRON_SECRET) && timingSafeEqual(got, CRON_SECRET);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return handleCors(req);
  if (req.method !== "POST") return badRequest("Method não permitido");

  const url = new URL(req.url);
  const segs = url.pathname.split("/").filter(Boolean);
  const action = segs[1] ?? "";
  const dryRun = ["1", "true"].includes(url.searchParams.get("dryRun") ?? "");

  // A prévia dos avisos é leitura e serve à tela: aceita um colaborador logado.
  if (!checkCronSecret(req)) {
    const previa = action === "certificados-avisos" && dryRun;
    if (!previa) return unauthorized("cron secret inválido");
    const eu = await exigirColaborador(req, {
      permissao: ["certificados.configurar_avisos", "certificados.ver"],
    });
    if (eu instanceof Response) return eu;
  }

  if (action === "serpro-agendado") {
    return json(await serproAgendado());
  }

  // ---------------- whatsapp-fotos-pendentes ----------------
  // Processa os chats com fotoPath=null das sessões conectadas. Paralelo 4
  // pra não martelar o WAHA. Cap 100 chats por sessão por execução.
  if (action === "whatsapp-fotos-pendentes") {
    if (!waha.wahaIsConfigured()) return json({ ok: true, skipped: "waha-nao-configurado" });
    const { data: sessoes } = await supabaseAdmin
      .from("WhatsappSessao")
      .select("id, tenantId, nome, status")
      .eq("status", "WORKING");
    if (!sessoes?.length) return json({ ok: true, sessoes: 0 });

    const resultados: Array<{ sessao: string; total: number; baixadas: number }> = [];
    const concurrency = 4;
    for (const sessao of sessoes) {
      const { data: pendentes } = await supabaseAdmin
        .from("WhatsappChat")
        .select("chatId")
        .eq("tenantId", sessao.tenantId)
        .eq("sessaoId", sessao.id)
        .is("fotoPath", null)
        .is("apagadoEm", null)
        .order("ultimaMensagemEm", { ascending: false, nullsFirst: false })
        .limit(100);
      const ids = (pendentes ?? []).map((r) => r.chatId as string);
      let baixadas = 0;
      for (let i = 0; i < ids.length; i += concurrency) {
        const r = await Promise.allSettled(
          ids.slice(i, i + concurrency).map((chatId) =>
            ensureChatPicture({
              tenantId: sessao.tenantId,
              sessaoId: sessao.id,
              sessionName: sessao.nome,
              chatId,
              fotoPathAtual: null,
            })
          ),
        );
        for (const it of r) if (it.status === "fulfilled" && it.value) baixadas++;
      }
      resultados.push({ sessao: sessao.nome, total: ids.length, baixadas });

      // Contatos (participantes de grupo) — mesma lógica, tabela diferente.
      // O `__none__` NÃO é resetado aqui (no adv3 era, a cada hora, e toda
      // foto inexistente era perguntada de novo 24 vezes por dia); quem
      // reseta é o "atualizar fotos" explícito da conversa.
      const { data: contatos } = await supabaseAdmin
        .from("WhatsappContato")
        .select("contatoId")
        .eq("tenantId", sessao.tenantId)
        .is("fotoPath", null)
        .limit(100);
      const ctIds = (contatos ?? []).map((r) => r.contatoId as string);
      if (ctIds.length > 0) {
        let cBaixadas = 0;
        for (let i = 0; i < ctIds.length; i += concurrency) {
          const r = await Promise.allSettled(
            ctIds.slice(i, i + concurrency).map((cid) =>
              ensureContatoPicture({
                tenantId: sessao.tenantId,
                sessionName: sessao.nome,
                contatoId: cid,
                fotoPathAtual: null,
              })
            ),
          );
          for (const it of r) if (it.status === "fulfilled" && it.value) cBaixadas++;
        }
        resultados.push({ sessao: sessao.nome + " (contatos)", total: ctIds.length, baixadas: cBaixadas });
      }
    }
    return json({ ok: true, sessoes: sessoes.length, resultados });
  }

  // ---------------- whatsapp-keepalive ----------------
  // Roda a cada 5min. O status em tempo real vem do WEBHOOK (evento
  // session.status → banco → front). Este cron é PASSIVO: só reconcilia o
  // status (lê o real do WAHA via GET e, se divergir do banco, sincroniza —
  // com re-confirmação antes de gravar uma queda). Cobre eventos perdidos.
  //
  // NÃO re-aplica webhook nem reinicia sessão: PUT /api/sessions no
  // WAHA/GOWS REINICIA a sessão, o que derrubava a conexão a cada ciclo.
  //
  // 🔴 E só escreve STATUS. No adv3 ele gravava `numero` e `pushName` a
  // partir do `me` do WAHA quando o status divergia — numa queda o `me` vem
  // vazio e apagava o número declarado (defeito 3 do guia).
  if (action === "whatsapp-keepalive") {
    if (!waha.wahaIsConfigured()) return json({ ok: true, skipped: "waha-nao-configurado" });
    const { data: sessoes } = await supabaseAdmin
      .from("WhatsappSessao")
      .select("id, nome, tenantId, status");
    if (!sessoes?.length) return json({ ok: true, sessoes: 0 });

    type KeepaliveRes = { id: string; action: string; ok: boolean; erro?: string };

    /**
     * Lê a sessão no WAHA. Devolve `null` quando ela **não existe lá** (404):
     * é resposta definitiva, e o fluxo normal assume STOPPED.
     */
    const lerSessao = async (nome: string) => {
      try {
        return await waha.getSession(nome);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("WAHA 404")) return null;
        throw err;
      }
    };

    const processarSessao = async (s: (typeof sessoes)[number]): Promise<KeepaliveRes[]> => {
      const out: KeepaliveRes[] = [];
      try {
        let real = await lerSessao(s.nome);
        let statusReal = real?.status ?? "STOPPED";

        // Uma única leitura ≠ WORKING numa sessão WORKING quase sempre é
        // blip transitório do engine. Re-confirma depois de 6s antes de
        // gravar a queda. Vale também pra ausência (404 durante restart).
        if (s.status === "WORKING" && statusReal !== "WORKING") {
          await new Promise((r) => setTimeout(r, 6000));
          try {
            real = await lerSessao(s.nome);
            statusReal = real?.status ?? "STOPPED";
          } catch {
            // 2ª leitura falhou — mantém a primeira.
          }
        }

        if (statusReal !== s.status) {
          await supabaseAdmin
            .from("WhatsappSessao")
            .update({
              status: statusReal,
              conectadoEm: statusReal === "WORKING" ? new Date().toISOString() : null,
              atualizadoEm: new Date().toISOString(),
              ultimoErro: statusReal === "FAILED"
                ? (((real as Record<string, unknown> | null)?.error as string | undefined) ?? "WAHA reportou FAILED")
                : null,
            })
            .eq("id", s.id);
          out.push({ id: s.id, action: `syncStatus:${s.status}→${statusReal}`, ok: true });
        }
      } catch (err) {
        out.push({ id: s.id, action: "getSession", ok: false, erro: err instanceof Error ? err.message : String(err) });
      }
      return out;
    };

    const CONC = 6;
    const resultados: KeepaliveRes[] = [];
    for (let i = 0; i < sessoes.length; i += CONC) {
      const settled = await Promise.allSettled(sessoes.slice(i, i + CONC).map((s) => processarSessao(s)));
      for (const r of settled) if (r.status === "fulfilled") resultados.push(...r.value);
    }

    // `ok` reflete o que aconteceu de verdade: o `cron.job_run_details` marca
    // `succeeded` só por ter enfileirado o net.http_post, então o corpo da
    // resposta (em net._http_response) é o único lugar onde a falha aparece.
    const falhas = resultados.filter((r) => !r.ok);
    return json({ ok: falhas.length === 0, sessoes: sessoes.length, falhas: falhas.length, resultados });
  }

  // ---------------- certificados-avisos ----------------
  if (action === "certificados-avisos") {
    // Configurações > Módulos (Config 'modulos', migration 004): avisos ou o
    // módulo de certificados desligados = não envia nada. A prévia (dryRun)
    // continua funcionando para a tela.
    if (!dryRun) {
      const { data: cfg } = await supabaseAdmin.from("Config").select("valor").eq("chave", "modulos").maybeSingle();
      const m = (cfg?.valor ?? {}) as { certificados?: boolean; certificadosAvisos?: boolean };
      if (m.certificadosAvisos === false || m.certificados === false) {
        return json({ ok: true, pulado: "desativado" });
      }
    }
    return json(await certificadosAvisos(dryRun));
  }

  return notFound(`cron desconhecido: ${action}`);
});

// ===========================================================================
// Aviso de vencimento de certificado digital
// ===========================================================================
//
// Diário, 09:00 de São Paulo. Para cada CertificadoDigital com
// `avisarWhatsapp`, calcula os dias até `validoAte` e escolhe o MARCO
// (Config `certificado.marcos`, padrão [30, 15, 7, 1, 0]) da vez:
//
//   o MENOR marco que já foi alcançado (marco >= dias restantes).
//
// Com o cron rodando todo dia isso é exatamente "o marco igual aos dias
// restantes". Se um dia falhou (servidor fora), o aviso sai no dia seguinte,
// pelo marco que passou. E se o certificado foi cadastrado já em cima da
// hora (faltando 5 dias), sai UM aviso só — o do marco 7 —, não 30 + 15 + 7
// de uma vez.
//
// 🔴 NUNCA REENVIA. `CertificadoAviso` tem unique(certificadoId, marco), e a
// linha é criada ANTES do envio (é a "trava"): dois crons sobrepostos não
// mandam duas vezes. E um marco não sai se um marco MENOR (mais perto do
// vencimento) já foi registrado. A única repetição é a de `sem_conexao`:
// o WhatsApp do escritório estava fora e a mensagem nunca chegou ao WAHA,
// então tentar no dia seguinte não duplica nada. `falhou` NÃO repete: o
// WAHA pode ter enviado e só a resposta se perdeu.

type Aviso = {
  certificadoId: string;
  clienteId: string;
  cliente: string;
  tipo: string;
  validoAte: string;
  dias: number;
  marco: number;
  telefone: string | null;
  texto: string;
  status?: "enviado" | "falhou" | "sem_telefone" | "sem_conexao" | "pulado";
  erro?: string | null;
  mensagemId?: string | null;
};

/** Data de hoje (YYYY-MM-DD) no fuso de São Paulo. */
function hojeSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function diasEntre(deISO: string, ateISO: string): number {
  const de = Date.UTC(+deISO.slice(0, 4), +deISO.slice(5, 7) - 1, +deISO.slice(8, 10));
  const ate = Date.UTC(+ateISO.slice(0, 4), +ateISO.slice(5, 7) - 1, +ateISO.slice(8, 10));
  return Math.round((ate - de) / 86_400_000);
}

function somarDias(iso: string, n: number): string {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function textoDias(dias: number): string {
  if (dias <= 0) return "vence hoje";
  if (dias === 1) return "em 1 dia";
  return `em ${dias} dias`;
}

const MODELO_PADRAO =
  "Olá, {cliente}! O certificado digital {tipo} vence em {data} ({dias}). Fale com a gente para renovar. Contabilidade Denos";

function montarTexto(modelo: string, v: { cliente: string; tipo: string; validoAte: string; dias: number }): string {
  const [a, m, d] = v.validoAte.slice(0, 10).split("-");
  return modelo
    .replaceAll("{cliente}", v.cliente)
    .replaceAll("{tipo}", v.tipo)
    .replaceAll("{data}", `${d}/${m}/${a}`)
    .replaceAll("{dias}", textoDias(v.dias));
}

/** Telefone de cadastro → dígitos com DDI (número BR sem 55 ganha 55). */
function telefoneComDdi(raw: string | null | undefined): string | null {
  let t = onlyDigits(raw);
  if (t.length === 10 || t.length === 11) t = `55${t}`;
  return t.length >= 12 && t.length <= 13 ? t : null;
}

async function lerConfig(): Promise<{ marcos: number[]; sessaoId: string | null; modelo: string }> {
  const { data, error } = await supabaseAdmin
    .from("Config")
    .select("chave, valor")
    .in("chave", ["certificado.marcos", "certificado.sessaoId", "certificado.modelo"]);
  if (error) throw error;
  const cfg = new Map((data ?? []).map((r) => [r.chave as string, r.valor as unknown]));
  const marcosRaw = cfg.get("certificado.marcos");
  const marcos = (Array.isArray(marcosRaw) ? marcosRaw : [30, 15, 7, 1, 0])
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0);
  const sessaoId = typeof cfg.get("certificado.sessaoId") === "string" ? cfg.get("certificado.sessaoId") as string : null;
  const modelo = typeof cfg.get("certificado.modelo") === "string" && (cfg.get("certificado.modelo") as string).trim()
    ? cfg.get("certificado.modelo") as string
    : MODELO_PADRAO;
  return { marcos: [...new Set(marcos)].sort((a, b) => a - b), sessaoId, modelo };
}

/** A sessão que manda os avisos: a configurada, se conectada; senão a 1ª WORKING. */
async function sessaoDosAvisos(sessaoIdCfg: string | null): Promise<{ id: string; nome: string } | null> {
  const { data } = await supabaseAdmin
    .from("WhatsappSessao")
    .select("id, nome, status, criadoEm")
    .eq("tenantId", TENANT_ID)
    .eq("status", "WORKING")
    .order("criadoEm", { ascending: true });
  const lista = (data ?? []) as Array<{ id: string; nome: string }>;
  return lista.find((s) => s.id === sessaoIdCfg) ?? lista[0] ?? null;
}

async function certificadosAvisos(dryRun: boolean) {
  const hoje = hojeSaoPaulo();
  const { marcos, sessaoId, modelo } = await lerConfig();
  if (!marcos.length) return { ok: true, hoje, dryRun, avisos: [], motivo: "sem marcos configurados" };
  const maior = marcos[marcos.length - 1];

  const { data: certs, error } = await supabaseAdmin
    .from("CertificadoDigital")
    .select('id, clienteId, tipo, validoAte, telefoneAviso, renovadoPorId, cliente:Cliente(nome, "nomeFantasia", telefone, ativo)')
    .eq("tenantId", TENANT_ID)
    .eq("avisarWhatsapp", true)
    .is("renovadoPorId", null)
    .gte("validoAte", hoje)
    .lte("validoAte", somarDias(hoje, maior))
    .order("validoAte", { ascending: true });
  if (error) throw error;

  const ids = (certs ?? []).map((c) => c.id as string);
  const { data: jaFeitos } = ids.length
    ? await supabaseAdmin
      .from("CertificadoAviso")
      .select("certificadoId, marco, status")
      .in("certificadoId", ids)
    : { data: [] };
  const feitos = new Map<string, Array<{ marco: number; status: string }>>();
  for (const f of (jaFeitos ?? []) as Array<{ certificadoId: string; marco: number; status: string }>) {
    const arr = feitos.get(f.certificadoId) ?? [];
    arr.push({ marco: f.marco, status: f.status });
    feitos.set(f.certificadoId, arr);
  }

  // Monta a lista do que é devido hoje.
  const devidos: Aviso[] = [];
  for (const c of certs ?? []) {
    const cli = (Array.isArray(c.cliente) ? c.cliente[0] : c.cliente) as
      | { nome: string; nomeFantasia: string | null; telefone: string | null; ativo: boolean }
      | null;
    if (!cli || cli.ativo === false) continue;
    const dias = diasEntre(hoje, c.validoAte as string);
    if (dias < 0) continue;
    const marco = marcos.find((m) => m >= dias);
    if (marco === undefined) continue;
    const historico = feitos.get(c.id as string) ?? [];
    // Já registrado este marco ou um MAIS PERTO do vencimento → nada a fazer
    // (exceto sem_conexao do próprio marco, que pode repetir).
    const bloqueia = historico.some((h) =>
      (h.marco < marco) || (h.marco === marco && h.status !== "sem_conexao")
    );
    if (bloqueia) continue;
    const nomeCliente = cli.nomeFantasia?.trim() || cli.nome;
    devidos.push({
      certificadoId: c.id as string,
      clienteId: c.clienteId as string,
      cliente: nomeCliente,
      tipo: c.tipo as string,
      validoAte: c.validoAte as string,
      dias,
      marco,
      telefone: telefoneComDdi((c.telefoneAviso as string | null) || cli.telefone),
      texto: montarTexto(modelo, { cliente: nomeCliente, tipo: c.tipo as string, validoAte: c.validoAte as string, dias }),
    });
  }

  if (dryRun) {
    const sessao = waha.wahaIsConfigured() ? await sessaoDosAvisos(sessaoId) : null;
    return {
      ok: true,
      hoje,
      dryRun: true,
      marcos,
      sessao: sessao ? { id: sessao.id, nome: sessao.nome } : null,
      wahaConfigurado: waha.wahaIsConfigured(),
      avisos: devidos.map((d) => ({ ...d, status: d.telefone ? undefined : "sem_telefone" })),
    };
  }

  const sessao = waha.wahaIsConfigured() ? await sessaoDosAvisos(sessaoId) : null;
  const resultado: Aviso[] = [];
  for (const d of devidos) {
    // TRAVA: a linha nasce antes do envio. Retentativa de sem_conexao troca
    // o status só se ainda for sem_conexao (outro cron pode ter pegado).
    const travou = await travarAviso(d);
    if (!travou) {
      resultado.push({ ...d, status: "pulado", erro: "já em andamento por outra execução" });
      continue;
    }
    let status: NonNullable<Aviso["status"]>;
    let erro: string | null = null;
    let mensagemId: string | null = null;

    if (!d.telefone) {
      status = "sem_telefone";
      erro = "Cliente sem telefone válido (nem telefone de aviso no certificado).";
    } else if (!sessao) {
      status = "sem_conexao";
      erro = waha.wahaIsConfigured() ? "Nenhuma instância de WhatsApp conectada." : waha.WAHA_NAO_CONFIGURADO;
    } else {
      let chatId = `${d.telefone}@c.us`;
      let semWhats = false;
      try {
        const r = await waha.checkNumberExists(sessao.nome, d.telefone);
        if (r?.numberExists === false) semWhats = true;
        else if (r?.chatId) chatId = r.chatId;
      } catch (err) {
        // Conferência indisponível (WAHA Core pode não ter): segue com o
        // número como está — o pior caso é o WAHA recusar o envio.
        console.warn("[certificados] check-exists", err instanceof Error ? err.message : String(err));
      }
      if (semWhats) {
        status = "sem_telefone";
        erro = `O número ${d.telefone} não tem WhatsApp.`;
      } else {
        const r = await enviarTexto({
          tenantId: TENANT_ID,
          sessao,
          chatId,
          texto: d.texto,
          origem: "sistema",
          colaborador: null,
          garantirConversa: true,
        });
        mensagemId = r.mensagemId;
        if (r.ok) {
          status = "enviado";
        } else {
          status = "falhou";
          erro = r.erro.slice(0, 500);
        }
        // Espaça os envios: rajada de mensagens iguais é o que o WhatsApp
        // marca como spam.
        await new Promise((res) => setTimeout(res, 1500));
      }
    }

    await supabaseAdmin
      .from("CertificadoAviso")
      .update({ status, erro, mensagemId, telefone: d.telefone, criadoEm: new Date().toISOString() })
      .eq("certificadoId", d.certificadoId)
      .eq("marco", d.marco);
    resultado.push({ ...d, status, erro, mensagemId });
  }

  const enviados = resultado.filter((r) => r.status === "enviado").length;
  const falhas = resultado.filter((r) => r.status === "falhou").length;
  return {
    ok: falhas === 0,
    hoje,
    dryRun: false,
    sessao: sessao ? { id: sessao.id, nome: sessao.nome } : null,
    total: resultado.length,
    enviados,
    falhas,
    avisos: resultado,
  };
}

/** Cria (ou retoma, se sem_conexao) a linha de CertificadoAviso. */
async function travarAviso(d: Aviso): Promise<boolean> {
  const { error } = await supabaseAdmin.from("CertificadoAviso").insert({
    tenantId: TENANT_ID,
    certificadoId: d.certificadoId,
    marco: d.marco,
    telefone: d.telefone,
    status: "falhou",
    erro: "em andamento",
  });
  if (!error) return true;
  if (error.code !== "23505") throw error;
  const { data } = await supabaseAdmin
    .from("CertificadoAviso")
    .update({ status: "falhou", erro: "em andamento" })
    .eq("certificadoId", d.certificadoId)
    .eq("marco", d.marco)
    .eq("status", "sem_conexao")
    .select("id");
  return (data?.length ?? 0) > 0;
}
