// Edge Function: entrar
// URL: https://painel-supabase.at63vf.easypanel.host/functions/v1/entrar
//
// 🔴 ENTRADA SÓ COM O E-MAIL, SEM CONFERIR A CAIXA DE ENTRADA (decisão do dono,
// 15/10/2026, enquanto o servidor de e-mail não está configurado). Quem souber
// o e-mail de alguém da equipe entra como essa pessoa. Liga e desliga em
// Configurações > Módulos (Config 'modulos'.loginSemVerificacao). Quando o
// SMTP estiver funcionando, DESLIGUE: o login volta a ser só por link/código.
//
//   GET  /entrar → desafio ALTCHA (prova de trabalho; o navegador resolve)
//   POST /entrar { email, altcha } → { token_hash } que a tela troca por sessão com
//        verifyOtp({ token_hash, type: 'magiclink' }), o mesmo caminho do link.
//
// Só e-mail de Colaborador ativo e amarrado ao Auth. Freio por IP e global,
// porque é uma porta aberta sem login.

import { handleCors } from "../_shared/cors.ts";
import { badRequest, errorResponse, forbidden, json, notFound } from "../_shared/response.ts";
import { serve } from "../_shared/serve.ts";
import { supabaseAdmin, TENANT_ID } from "../_shared/supabase.ts";
import { dentroDoLimite } from "../_shared/rate-limit.ts";
import { createChallenge, verifySolution } from "npm:altcha-lib@2.6.0/v1";

const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const ALTCHA_KEY = Deno.env.get("ALTCHA_HMAC_KEY") ?? "";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A chave vale enquanto não for desligada explicitamente. */
async function liberado(): Promise<boolean> {
  const { data } = await supabaseAdmin.from("Config").select("valor").eq("chave", "modulos").maybeSingle();
  const v = (data?.valor ?? {}) as Record<string, unknown>;
  return v.loginSemVerificacao !== false;
}

function ipDe(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") ?? "";
  return xff.split(",")[0].trim() || req.headers.get("x-real-ip") || "desconhecido";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return handleCors(req);
  if (!ALTCHA_KEY) return errorResponse("Proteção anti-robô não configurada (ALTCHA_HMAC_KEY).", 503);

  // Desafio novo a cada pedido; vence em 10 minutos.
  if (req.method === "GET") {
    const desafio = await createChallenge({
      hmacKey: ALTCHA_KEY,
      maxNumber: 100_000,
      expires: new Date(Date.now() + 10 * 60_000),
    });
    return json(desafio, { headers: { "Cache-Control": "no-store" } });
  }
  if (req.method !== "POST") return notFound();
  // O desafio (GET) sai sem a chave: o widget o busca sozinho e ele não revela nada.
  if (!ANON_KEY || req.headers.get("apikey") !== ANON_KEY) return forbidden();

  if (!(await liberado())) {
    return forbidden("Entrada só com o e-mail está desligada. Use o link ou o código enviado por e-mail.");
  }

  const ip = ipDe(req);
  const porIp = await dentroDoLimite({ action: "entrar", sujeito: `ip:${ip}`, max: 10, windowSecs: 300 });
  const global = await dentroDoLimite({ action: "entrar", sujeito: "global", max: 60, windowSecs: 300 });
  if (!porIp || !global) return errorResponse("Muitas tentativas. Espere alguns minutos.", 429);

  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 254) : "";
  if (!EMAIL_RE.test(email)) return badRequest("E-mail inválido.");

  // Anti-robô: a solução tem de ser válida, no prazo e usada uma vez só.
  const altcha = typeof body.altcha === "string" ? body.altcha.slice(0, 2000) : "";
  if (!altcha || !(await verifySolution(altcha, ALTCHA_KEY, true).catch(() => false))) {
    return forbidden("Verificação anti-robô falhou. Recarregue a página e tente de novo.");
  }
  let assinatura = "";
  try {
    assinatura = String(JSON.parse(atob(altcha)).signature ?? "");
  } catch { /* payload já validado acima */ }
  if (!(await dentroDoLimite({ action: "altcha", sujeito: assinatura, max: 1, windowSecs: 900 }))) {
    return forbidden("Verificação anti-robô já usada. Recarregue a página.");
  }

  const { data: c } = await supabaseAdmin
    .from("Colaborador")
    .select("id, ativo, userId")
    .eq("tenantId", TENANT_ID)
    .ilike("email", email)
    .maybeSingle();
  if (!c?.ativo || !c.userId) return forbidden("Este e-mail não tem acesso ao painel.");

  const { data, error } = await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data?.properties?.hashed_token) {
    throw new Error(`Não foi possível entrar: ${error?.message ?? "sem token"}`);
  }
  // Auditoria: "entrou no painel". Falha aqui não pode impedir a entrada.
  try {
    await supabaseAdmin.rpc("auditoria_evento", {
      p_modulo: "acesso",
      p_entidade: "colaborador",
      p_entidade_id: c.id,
      p_acao: "login",
      p_resumo: "entrou no painel",
      p_detalhes: { info: [{ rotulo: "Como", valor: "Só com o e-mail (sem verificação)" }, { rotulo: "IP", valor: ip }] },
      p_ator: c.id,
    });
  } catch (err) {
    console.error("entrar: auditoria falhou", err);
  }
  return json({ token_hash: data.properties.hashed_token });
});
