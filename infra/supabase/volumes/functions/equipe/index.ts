// Edge Function: equipe
// URL: https://painel-supabase.at63vf.easypanel.host/functions/v1/equipe
//
// Quem entra no painel. Toda escrita em Colaborador passa por aqui (a RLS
// não deixa a tela escrever), junto com o usuário do Auth amarrado a ele.
// Exige o JWT do usuário logado; as rotas de pessoa exigem equipe.gerenciar.
//
// Rotas:
//   POST   /equipe/convidar { nome, email, cargoId, telefone?, cor? }
//          → cria o usuário no Auth (sem senha, e-mail confirmado) e o
//            Colaborador. Com SMTP configurado manda o e-mail de acesso;
//            sem SMTP devolve um link de acesso de uso único.
//   PATCH  /equipe/:id { nome?, email?, telefone?, cor?, cargoId?, ativo? }
//          → e-mail novo vale no Auth também; desativar bane o usuário e
//            derruba as sessões; reativar tira o banimento.
//   DELETE /equipe/:id                → apaga o Colaborador e o usuário do Auth
//   POST   /equipe/:id/link           → link de acesso de uso único (expira)
//   POST   /equipe/:id/enviar-acesso  → manda o e-mail de acesso (precisa SMTP)
//   GET    /equipe/email              → SMTP configurado? servidor responde, oferece
//                                        STARTTLS? avisos de configuração (sem segredo)
//   POST   /equipe/email/teste        → manda um e-mail de acesso para quem pede
//
// 🔴 Link e e-mail usam o MESMO token do Auth: gerar um link invalida o que
// foi por e-mail antes, e vice-versa. Por isso o convite faz um OU outro.

import { handleCors } from "../_shared/cors.ts";
import {
  badRequest,
  conflict,
  forbidden,
  json,
  notFound,
} from "../_shared/response.ts";
import { serve } from "../_shared/serve.ts";
import { supabaseAdmin, TENANT_ID } from "../_shared/supabase.ts";
import { esquecerUsuario, exigirColaborador, tem } from "../_shared/acesso.ts";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { avisosSmtp, provedorSmtp, sondarSmtp } from "../_shared/smtp-diagnostico.ts";
import { padraoIlikeExato } from "../_shared/email-exato.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
/** URL do painel (SITE_URL do Auth). O link de acesso cai em /auth/callback. */
const PAINEL_URL = (Deno.env.get("SITE_URL") || "https://painel-web.at63vf.easypanel.host").replace(/\/+$/, "");
const SMTP_HOST = (Deno.env.get("SMTP_HOST") ?? "").trim();
const SMTP_PORT = Number(Deno.env.get("SMTP_PORT") ?? "587") || 587;
const SMTP_USER = (Deno.env.get("SMTP_USER") ?? "").trim();
const SMTP_ADMIN_EMAIL = (Deno.env.get("SMTP_ADMIN_EMAIL") ?? "").trim();
const SMTP_SENDER_NAME = (Deno.env.get("SMTP_SENDER_NAME") ?? "").trim();
/** "sim" quando SMTP_PASS está preenchido no serviço (a senha em si não vem). */
const SMTP_PASS_DEFINIDA: boolean | null = (() => {
  const v = Deno.env.get("SMTP_PASS_DEFINIDA");
  return v === undefined ? null : v.trim() === "sim";
})();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COR_RE = /^#[0-9a-f]{6}$/i;
/** Banimento "para sempre" (100 anos) — o GoTrue não tem um "bloqueado". */
const BANIDO = "876000h";

const smtpConfigurado = () => SMTP_HOST.length > 0;

function texto(v: unknown, max = 120): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function linkDeAcesso(hashedToken: string): string {
  const q = new URLSearchParams({ token_hash: hashedToken, type: "magiclink" });
  return `${PAINEL_URL}/auth/callback?${q}`;
}

/** Link de uso único (mesma validade do código do e-mail). */
async function gerarLink(email: string): Promise<string> {
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${PAINEL_URL}/auth/callback` },
  });
  if (error || !data?.properties?.hashed_token) {
    throw new Error(`Não foi possível gerar o link: ${error?.message ?? "sem token"}`);
  }
  return linkDeAcesso(data.properties.hashed_token);
}

/** Manda o e-mail de acesso (link + código) pelo próprio Auth. */
async function enviarEmailDeAcesso(email: string): Promise<{ ok: boolean; erro?: string }> {
  if (!smtpConfigurado()) return { ok: false, erro: "SMTP não configurado." };
  const r = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, create_user: false }),
  });
  if (r.ok) return { ok: true };
  const t = await r.text();
  let msg = t.slice(0, 200);
  try {
    const j = JSON.parse(t);
    msg = j.msg ?? j.message ?? j.error_description ?? j.error ?? msg;
  } catch { /* texto cru */ }
  if (r.status === 429) return { ok: false, erro: "Muitos e-mails em pouco tempo. Tente em 1 minuto." };
  // O GoTrue responde só "Error sending ... email"; o motivo do servidor SMTP
  // (senha recusada, remetente não permitido, IP fora do relay) fica no log dele.
  if (r.status >= 500 || /error sending/i.test(msg)) {
    return {
      ok: false,
      erro: "o Auth não conseguiu enviar pelo SMTP. Confira SMTP_USER, SMTP_PASS (no Gmail, a senha de app), " +
        "o remetente (SMTP_ADMIN_EMAIL igual ao usuário) e a porta 587. O motivo exato aparece no log do " +
        "serviço supabase (container auth) no Easypanel.",
    };
  }
  return { ok: false, erro: msg };
}

/** O usuário do Auth com esse e-mail (para reaproveitar num convite refeito). */
async function usuarioPorEmail(email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const achado = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (achado) return achado.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function cargoExiste(id: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from("Cargo").select("id").eq("id", id).maybeSingle();
  return !!data;
}

/** Erro do banco (gatilho com mensagem em português) vira 400 legível. */
function erroDoBanco(e: { message?: string; code?: string } | null): Response | null {
  if (!e) return null;
  if (e.code === "23505") return conflict("Já existe alguém da equipe com este e-mail.");
  if (e.code === "P0001") return badRequest(e.message ?? "Operação recusada.");
  throw e;
}

/** Diagnóstico do SMTP: a porta abre, o servidor saúda, oferece TLS? A config faz sentido? */
async function diagnosticoSmtp() {
  const resolve = async (host: string) => {
    try {
      const ips = await Deno.resolveDns(host, "A");
      return ips.length > 0;
    } catch {
      return false;
    }
  };
  const [sonda, painelEmail] = await Promise.all([
    smtpConfigurado() ? sondarSmtp(SMTP_HOST, SMTP_PORT, 5000) : Promise.resolve(null),
    resolve("painel_email"),
  ]);
  return {
    configurado: smtpConfigurado(),
    host: SMTP_HOST || null,
    porta: SMTP_PORT,
    provedor: provedorSmtp(SMTP_HOST),
    usuarioConfigurado: SMTP_USER.length > 0,
    /** null = o env do serviço ainda não diz (SMTP_PASS_DEFINIDA ausente). */
    senhaDefinida: SMTP_PASS_DEFINIDA,
    remetente: SMTP_ADMIN_EMAIL || null,
    nomeRemetente: SMTP_SENDER_NAME || null,
    portaAbre: sonda ? sonda.portaAbre : null,
    saudacao: sonda?.saudacao ?? null,
    tls: sonda?.tls ?? null,
    erroConexao: sonda?.erro ?? null,
    avisos: avisosSmtp({
      host: SMTP_HOST,
      porta: SMTP_PORT,
      usuario: SMTP_USER,
      remetente: SMTP_ADMIN_EMAIL,
      senhaDefinida: SMTP_PASS_DEFINIDA,
    }),
    // O app "email" (Stalwart) do Easypanel visto pela rede interna do Supabase.
    redeInterna: { painel_email: painelEmail },
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return handleCors(req);

  const eu = await exigirColaborador(req);
  if (eu instanceof Response) return eu;

  const sub = new URL(req.url).pathname.split("/").filter(Boolean).slice(1);
  const [a, b] = sub;

  // ---------------- E-mail (SMTP) ----------------
  if (a === "email") {
    if (!tem(eu, "configuracoes.gerenciar") && !tem(eu, "equipe.gerenciar")) {
      return forbidden("Seu cargo não tem permissão para isso (configuracoes.gerenciar).");
    }
    if (!b && req.method === "GET") return json(await diagnosticoSmtp());
    if (b === "teste" && req.method === "POST") {
      if (!eu.email) return badRequest("Seu cadastro não tem e-mail.");
      const r = await enviarEmailDeAcesso(eu.email.toLowerCase());
      return r.ok ? json({ ok: true, para: eu.email }) : badRequest(`E-mail não enviado: ${r.erro}`);
    }
    return notFound();
  }

  if (!tem(eu, "equipe.gerenciar")) {
    return forbidden("Seu cargo não tem permissão para isso (equipe.gerenciar).");
  }

  const freio = await enforceRateLimit({
    action: "equipe",
    sujeito: `c:${eu.id}`,
    max: 60,
    windowSecs: 60,
  });
  if (freio) return freio;

  // ---------------- Convidar ----------------
  if (a === "convidar" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const nome = texto(body.nome);
    const email = texto(body.email, 254)?.toLowerCase() ?? null;
    const cargoId = texto(body.cargoId, 40);
    const telefone = texto(body.telefone, 40);
    const cor = texto(body.cor, 7);
    if (!nome || nome.length < 2) return badRequest("Informe o nome.");
    if (!email || !EMAIL_RE.test(email)) return badRequest("E-mail inválido.");
    if (!cargoId || !UUID_RE.test(cargoId) || !(await cargoExiste(cargoId))) return badRequest("Escolha o cargo.");
    if (cor && !COR_RE.test(cor)) return badRequest("Cor inválida.");

    const { data: jaTem } = await supabaseAdmin
      .from("Colaborador").select("id").eq("tenantId", TENANT_ID).ilike("email", padraoIlikeExato(email)).maybeSingle();
    if (jaTem) return conflict("Já existe alguém da equipe com este e-mail.");

    // Usuário do Auth: novo, ou o que sobrou de um convite antigo.
    let userId: string | null = null;
    let criouUsuario = false;
    const criado = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { nome },
    });
    if (criado.data?.user) {
      userId = criado.data.user.id;
      criouUsuario = true;
    } else {
      userId = await usuarioPorEmail(email);
      if (!userId) throw new Error(`Não foi possível criar o usuário: ${criado.error?.message}`);
      await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: "none", email_confirm: true });
    }
    const { data: jaAmarrado } = await supabaseAdmin
      .from("Colaborador").select("id").eq("userId", userId).maybeSingle();
    if (jaAmarrado) return conflict("Este e-mail já está ligado a outra pessoa da equipe.");

    const { data: colab, error } = await supabaseAdmin
      .from("Colaborador")
      .insert({
        tenantId: TENANT_ID, nome, email, telefone, cargoId, userId, ativo: true,
        ...(cor ? { cor } : {}),
      })
      .select("*")
      .single();
    if (error) {
      if (criouUsuario) await supabaseAdmin.auth.admin.deleteUser(userId);
      return erroDoBanco(error)!;
    }

    let emailEnviado = false;
    let erroEmail: string | null = null;
    let link: string | null = null;
    if (smtpConfigurado()) {
      const r = await enviarEmailDeAcesso(email);
      emailEnviado = r.ok;
      erroEmail = r.erro ?? null;
    }
    if (!emailEnviado) link = await gerarLink(email);
    return json({ colaborador: colab, emailEnviado, erroEmail, link });
  }

  // ---------------- Uma pessoa ----------------
  if (!a || !UUID_RE.test(a)) return notFound();
  const { data: alvo } = await supabaseAdmin
    .from("Colaborador").select("*").eq("tenantId", TENANT_ID).eq("id", a).maybeSingle();
  if (!alvo) return notFound("Pessoa não encontrada.");

  if (!b && req.method === "PATCH") {
    const body = await req.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};
    if ("nome" in body) {
      const nome = texto(body.nome);
      if (!nome || nome.length < 2) return badRequest("Informe o nome.");
      patch.nome = nome;
    }
    if ("telefone" in body) patch.telefone = texto(body.telefone, 40);
    if ("cor" in body) {
      const cor = texto(body.cor, 7);
      if (!cor || !COR_RE.test(cor)) return badRequest("Cor inválida.");
      patch.cor = cor;
    }
    if ("cargoId" in body) {
      const cargoId = texto(body.cargoId, 40);
      if (!cargoId || !UUID_RE.test(cargoId) || !(await cargoExiste(cargoId))) return badRequest("Cargo inválido.");
      patch.cargoId = cargoId;
    }
    let emailNovo: string | null = null;
    if ("email" in body) {
      const email = texto(body.email, 254)?.toLowerCase() ?? null;
      if (!email || !EMAIL_RE.test(email)) return badRequest("E-mail inválido.");
      if (email !== (alvo.email ?? "").toLowerCase()) emailNovo = email;
      patch.email = email;
    }
    if ("ativo" in body) {
      if (typeof body.ativo !== "boolean") return badRequest("ativo deve ser true ou false.");
      if (!body.ativo && alvo.id === eu.id) return badRequest("Você não pode desativar a si mesmo.");
      patch.ativo = body.ativo;
    }
    if (alvo.id === eu.id && "cargoId" in patch && patch.cargoId !== alvo.cargoId) {
      // Trocar o próprio cargo pode tirar o acesso de quem está mexendo.
      const { data: novo } = await supabaseAdmin
        .from("Cargo").select("sistema, permissoes").eq("id", patch.cargoId as string).single();
      if (!novo?.sistema && !(novo?.permissoes ?? []).includes("equipe.gerenciar")) {
        return badRequest("Você perderia o acesso à Equipe. Peça a outra pessoa para trocar seu cargo.");
      }
    }
    if (Object.keys(patch).length === 0) return badRequest("Nada para alterar.");

    // E-mail novo: Auth primeiro (se recusar, nada muda no painel).
    if (emailNovo && alvo.userId) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(alvo.userId, {
        email: emailNovo,
        email_confirm: true,
      });
      if (error) {
        return /already|registered|exists/i.test(error.message)
          ? conflict("Este e-mail já é usado por outro acesso.")
          : badRequest(`O Auth recusou o e-mail: ${error.message}`);
      }
    }

    const { data: salvo, error } = await supabaseAdmin
      .from("Colaborador").update(patch).eq("id", alvo.id).select("*").single();
    if (error) {
      if (emailNovo && alvo.userId && alvo.email) {
        await supabaseAdmin.auth.admin.updateUserById(alvo.userId, { email: alvo.email, email_confirm: true });
      }
      return erroDoBanco(error)!;
    }

    if (alvo.userId) {
      if ("ativo" in patch && patch.ativo !== alvo.ativo) {
        await supabaseAdmin.auth.admin.updateUserById(alvo.userId, {
          ban_duration: patch.ativo ? "none" : BANIDO,
        });
        if (!patch.ativo) await supabaseAdmin.rpc("revogar_sessoes", { p_user: alvo.userId });
      }
      esquecerUsuario(alvo.userId);
    }
    return json({ colaborador: salvo });
  }

  if (!b && req.method === "DELETE") {
    if (alvo.id === eu.id) return badRequest("Você não pode excluir a si mesmo.");
    const { error } = await supabaseAdmin.from("Colaborador").delete().eq("id", alvo.id);
    if (error) return erroDoBanco(error)!;
    if (alvo.userId) {
      await supabaseAdmin.rpc("revogar_sessoes", { p_user: alvo.userId });
      await supabaseAdmin.auth.admin.deleteUser(alvo.userId);
      esquecerUsuario(alvo.userId);
    }
    return json({ ok: true });
  }

  if (b === "link" && req.method === "POST") {
    if (!alvo.ativo) return badRequest("Pessoa desativada: reative antes de gerar o acesso.");
    if (!alvo.email || !alvo.userId) return badRequest("Esta pessoa não tem e-mail de acesso.");
    const link = await gerarLink(alvo.email.toLowerCase());
    // Quem tem o link entra como a pessoa: fica registrado quem gerou (o login
    // depois aparece como da própria pessoa).
    await supabaseAdmin.rpc("auditoria_evento", {
      p_modulo: "equipe",
      p_entidade: "colaborador",
      p_entidade_id: alvo.id,
      p_acao: "link_gerado",
      p_resumo: `gerou um link de acesso para ${alvo.nome ?? "uma pessoa da equipe"}`,
      p_ator: eu.id,
    });
    return json({ link });
  }

  if (b === "enviar-acesso" && req.method === "POST") {
    if (!alvo.ativo) return badRequest("Pessoa desativada: reative antes de enviar o acesso.");
    if (!alvo.email || !alvo.userId) return badRequest("Esta pessoa não tem e-mail de acesso.");
    const r = await enviarEmailDeAcesso(alvo.email.toLowerCase());
    return r.ok ? json({ ok: true }) : badRequest(`E-mail não enviado: ${r.erro}`);
  }

  return notFound();
});
