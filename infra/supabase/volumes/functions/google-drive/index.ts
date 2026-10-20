// Edge Function: google-drive
// URL: https://painel-supabase.at63vf.easypanel.host/functions/v1/google-drive
//
// Conecta o Google Drive do escritório ao backup diário (migração 020,
// docs/BACKUP.md). O serviço "backup" lê a conexão no banco e, depois do
// backup local das 03:00, manda um arquivo cifrado por dia para a pasta.
//
// Escopo `drive.file`: o painel só enxerga o que ele mesmo criou (a pasta e os
// backups). Não lê nem apaga mais nada do Drive, e o Google não exige
// verificação do app para esse escopo.
//
// Rotas (todas com o JWT do usuário e configuracoes.gerenciar, menos o callback):
//   POST /google-drive/cliente { clientId, clientSecret } → salva o OAuth do Google Cloud
//   POST /google-drive/conectar        → { url } da tela de consentimento do Google
//   GET  /google-drive/callback?code&state → volta do Google (navegador): troca o
//        código, cria a pasta "Backup Painel NÓS" e devolve para Configurações
//   GET  /google-drive/arquivos        → backups que estão na pasta + espaço do Drive
//   POST /google-drive/desconectar     → revoga no Google e apaga o token
//
// O refresh token e o Client Secret ficam no Vault; nenhuma rota os devolve.

import { handleCors } from "../_shared/cors.ts";
import { badRequest, badGateway, json, notFound } from "../_shared/response.ts";
import { serve } from "../_shared/serve.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { exigirColaborador } from "../_shared/acesso.ts";
import { PUBLIC_BASE_URL } from "../_shared/env.ts";

const PAINEL_URL = (Deno.env.get("SITE_URL") || "https://painel-web.at63vf.easypanel.host").replace(/\/+$/, "");
const REDIRECT_URI = `${PUBLIC_BASE_URL}/functions/v1/google-drive/callback`;
const ESCOPOS = "openid email https://www.googleapis.com/auth/drive.file";
const PASTA_NOME = "Backup Painel NÓS";
const PASTA_MIME = "application/vnd.google-apps.folder";
const TIMEOUT = 15_000;

type Credenciais = {
  clientId: string | null;
  clientSecret: string | null;
  refreshToken: string | null;
  pastaId: string | null;
  pastaNome: string | null;
  conta: string | null;
  manter: number;
};

async function credenciais(): Promise<Credenciais> {
  const { data, error } = await supabaseAdmin.rpc("drive_credenciais");
  if (error) throw error;
  const linha = (Array.isArray(data) ? data[0] : data) as Credenciais | undefined;
  return linha ?? { clientId: null, clientSecret: null, refreshToken: null, pastaId: null, pastaNome: null, conta: null, manter: 30 };
}

async function sha256(texto: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Erro do Google em texto curto (sem token, que nunca vem no corpo de erro). */
async function erroGoogle(r: Response): Promise<string> {
  const t = await r.text().catch(() => "");
  try {
    const j = JSON.parse(t) as { error?: string | { message?: string }; error_description?: string };
    if (typeof j.error === "string") return `${j.error}${j.error_description ? `: ${j.error_description}` : ""}`;
    if (j.error?.message) return j.error.message;
  } catch { /* não é JSON */ }
  return `HTTP ${r.status}`;
}

async function tokenPorRefresh(c: Credenciais): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: c.refreshToken ?? "",
      client_id: c.clientId ?? "",
      client_secret: c.clientSecret ?? "",
    }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) throw new Error(`Google recusou o acesso (${await erroGoogle(r)}). Conecte o Drive de novo.`);
  return ((await r.json()) as { access_token: string }).access_token;
}

async function drive(token: string, caminho: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`https://www.googleapis.com/drive/v3/${caminho}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT),
  });
}

/** A pasta ainda existe (e não está na lixeira) para este app? */
async function pastaValida(token: string, id: string): Promise<boolean> {
  const r = await drive(token, `files/${encodeURIComponent(id)}?fields=id,trashed`);
  if (!r.ok) return false;
  const j = (await r.json()) as { trashed?: boolean };
  return !j.trashed;
}

async function criarPasta(token: string): Promise<string> {
  const r = await drive(token, "files?fields=id", {
    method: "POST",
    body: JSON.stringify({ name: PASTA_NOME, mimeType: PASTA_MIME }),
  });
  if (!r.ok) throw new Error(`Não consegui criar a pasta no Drive (${await erroGoogle(r)}).`);
  return ((await r.json()) as { id: string }).id;
}

/** E-mail da conta, lido do id_token que veio direto do Google (TLS). */
function emailDoIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const p = idToken.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const j = JSON.parse(atob(p + "=".repeat((4 - (p.length % 4)) % 4))) as { email?: string };
    return j.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Volta para Configurações > Sistema com um CÓDIGO fixo (a tela traduz). Texto
 * livre na URL deixaria qualquer um montar um link que mostra um aviso falso
 * dentro do painel. O detalhe do Google vai para o console da function.
 */
type CodigoVolta =
  | "ok"
  | "negado"
  | "incompleto"
  | "expirou"
  | "sem_cliente"
  | "codigo_recusado"
  | "sem_escopo"
  | "sem_refresh"
  | "interno";

function voltarAoPainel(codigo: CodigoVolta, detalhe?: string): Response {
  if (detalhe) console.error(`google-drive callback (${codigo}):`, detalhe);
  const q = new URLSearchParams({ tab: "sistema", drive: codigo });
  return new Response(null, { status: 302, headers: { Location: `${PAINEL_URL}/configuracoes?${q}` } });
}

async function callback(url: URL): Promise<Response> {
  const negado = url.searchParams.get("error");
  if (negado) return voltarAoPainel(negado === "access_denied" ? "negado" : "codigo_recusado", negado);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!code || !state) return voltarAoPainel("incompleto");

  const { data: ator, error: e1 } = await supabaseAdmin.rpc("drive_consumir_estado", {
    p_state_hash: await sha256(state),
  });
  if (e1) throw e1;
  if (!ator) return voltarAoPainel("expirou");

  const c = await credenciais();
  if (!c.clientId || !c.clientSecret) return voltarAoPainel("sem_cliente");

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: c.clientId,
      client_secret: c.clientSecret,
    }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!r.ok) return voltarAoPainel("codigo_recusado", await erroGoogle(r));
  const t = (await r.json()) as { access_token: string; refresh_token?: string; id_token?: string; scope?: string };

  if (!(t.scope ?? "").includes("drive.file")) {
    return voltarAoPainel("sem_escopo");
  }
  // Sem refresh token não há backup de madrugada. O Google só manda na 1ª
  // autorização; o prompt=consent da URL força de novo, mas confere.
  if (!t.refresh_token && !c.refreshToken) {
    return voltarAoPainel("sem_refresh");
  }

  const conta = emailDoIdToken(t.id_token);
  // Mesma conta e a pasta ainda existe: reaproveita (não espalha pastas).
  const mesmaConta = !!conta && conta === c.conta;
  const pastaId = mesmaConta && c.pastaId && (await pastaValida(t.access_token, c.pastaId))
    ? c.pastaId
    : await criarPasta(t.access_token);

  const { error: e2 } = await supabaseAdmin.rpc("drive_salvar_conexao", {
    p_conta: conta,
    p_pasta_id: pastaId,
    p_pasta_nome: PASTA_NOME,
    p_refresh_token: t.refresh_token ?? null,
    p_ator: ator,
  });
  if (e2) throw e2;
  return voltarAoPainel("ok");
}

/** Revoga o refresh token no Google. Melhor esforço: sem resposta, o token some daqui mesmo assim. */
async function revogar(refreshToken: string | null): Promise<void> {
  if (!refreshToken) return;
  await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }),
    signal: AbortSignal.timeout(TIMEOUT),
  }).catch((err) => console.error("google-drive revoke:", err));
}

type ArquivoDrive = { id: string; name: string; size?: string; createdTime: string };

async function arquivos(): Promise<Response> {
  const c = await credenciais();
  if (!c.refreshToken || !c.pastaId) return json({ conectado: false, arquivos: [] });
  let token: string;
  try {
    token = await tokenPorRefresh(c);
  } catch (err) {
    return badGateway(err instanceof Error ? err.message : String(err));
  }
  const q = `'${c.pastaId.replace(/'/g, "")}' in parents and trashed = false`;
  const [lista, sobre] = await Promise.all([
    drive(token, `files?${new URLSearchParams({
      q,
      orderBy: "createdTime desc",
      pageSize: "100",
      fields: "files(id,name,size,createdTime)",
    })}`),
    drive(token, "about?fields=storageQuota"),
  ]);
  if (!lista.ok) {
    const msg = await erroGoogle(lista);
    return badGateway(lista.status === 404 ? "A pasta do backup sumiu do Drive. Conecte de novo para recriar." : msg);
  }
  const { files = [] } = (await lista.json()) as { files?: ArquivoDrive[] };
  const quota = sobre.ok
    ? ((await sobre.json()) as { storageQuota?: { limit?: string; usage?: string } }).storageQuota ?? null
    : null;
  return json({
    conectado: true,
    pastaUrl: `https://drive.google.com/drive/folders/${c.pastaId}`,
    arquivos: files.map((f) => ({
      id: f.id,
      nome: f.name,
      tamanhoBytes: f.size ? Number(f.size) : null,
      criadoEm: f.createdTime,
    })),
    espaco: quota
      ? { limiteBytes: quota.limit ? Number(quota.limit) : null, usadoBytes: quota.usage ? Number(quota.usage) : null }
      : null,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return handleCors(req);
  const url = new URL(req.url);
  const rota = url.pathname.split("/").filter(Boolean).slice(1).join("/");

  // A volta do Google é uma navegação do navegador: não tem JWT. Quem vale é o
  // state de uso único criado por quem clicou em Conectar.
  if (req.method === "GET" && rota === "callback") {
    try {
      return await callback(url);
    } catch (err) {
      console.error("google-drive callback:", err);
      return voltarAoPainel("interno", err instanceof Error ? err.message : String(err));
    }
  }

  const eu = await exigirColaborador(req, { permissao: "configuracoes.gerenciar" });
  if (eu instanceof Response) return eu;

  if (req.method === "POST" && rota === "cliente") {
    const corpo = (await req.json().catch(() => ({}))) as { clientId?: unknown; clientSecret?: unknown };
    const clientId = typeof corpo.clientId === "string" ? corpo.clientId.trim() : "";
    const clientSecret = typeof corpo.clientSecret === "string" ? corpo.clientSecret.trim() : "";
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
      return badRequest("O Client ID termina em .apps.googleusercontent.com.");
    }
    if (clientSecret.length < 10 || clientSecret.length > 200 || /\s/.test(clientSecret)) {
      return badRequest("Client Secret inválido.");
    }
    // Trocar o cliente OAuth desconecta: o token antigo é revogado no Google.
    await revogar((await credenciais()).refreshToken);
    const { error } = await supabaseAdmin.rpc("drive_salvar_cliente", {
      p_client_id: clientId,
      p_client_secret: clientSecret,
      p_ator: eu.id,
    });
    if (error) throw error;
    return json({ ok: true });
  }

  if (req.method === "POST" && rota === "conectar") {
    const c = await credenciais();
    if (!c.clientId || !c.clientSecret) return badRequest("Salve antes o Client ID e o Client Secret do Google.");
    const state = crypto.randomUUID() + crypto.randomUUID();
    const { error } = await supabaseAdmin.rpc("drive_criar_estado", { p_state_hash: await sha256(state), p_ator: eu.id });
    if (error) throw error;
    const q = new URLSearchParams({
      client_id: c.clientId,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: ESCOPOS,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${q}`, redirectUri: REDIRECT_URI });
  }

  if (req.method === "GET" && rota === "arquivos") return await arquivos();

  if (req.method === "POST" && rota === "desconectar") {
    await revogar((await credenciais()).refreshToken);
    const { error } = await supabaseAdmin.rpc("drive_desconectar", { p_ator: eu.id });
    if (error) throw error;
    return json({ ok: true });
  }

  return notFound("Rota não encontrada.");
});
