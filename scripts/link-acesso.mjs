// Link de acesso de emergência: entra no painel sem e-mail e sem senha.
// Use quando o e-mail (SMTP) não estiver funcionando, ou quando ninguém com
// a permissão equipe.gerenciar conseguir entrar para gerar o link pela tela.
//
//   SUPABASE_URL=https://painel-supabase.at63vf.easypanel.host \
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/link-acesso.mjs pessoa@exemplo.com
//
// O link funciona UMA vez e expira junto com o código do e-mail (15 min,
// GOTRUE_MAILER_OTP_EXP). Gerar um link novo invalida o anterior e o último
// e-mail de acesso. A pessoa precisa existir no Auth e ser um Colaborador
// ativo (senão entra e vê "acesso não liberado"). Ver docs/LOGIN.md.
//
// 🔴 Quem tiver o link entra como a pessoa. Não cole em grupo nem em ticket.

const url = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const painel = (process.env.PAINEL_URL ?? "https://painel-web.at63vf.easypanel.host").replace(/\/+$/, "");
const email = (process.argv[2] ?? "").trim().toLowerCase();

if (!url || !key) {
  console.error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Uso: node scripts/link-acesso.mjs <email>");
  process.exit(1);
}

const r = await fetch(`${url}/auth/v1/admin/generate_link`, {
  method: "POST",
  headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({ type: "magiclink", email, redirect_to: `${painel}/auth/callback` }),
});
const corpo = await r.json().catch(() => ({}));
if (!r.ok) {
  const msg = corpo.msg ?? corpo.message ?? corpo.error_description ?? JSON.stringify(corpo);
  console.error(`Falhou (${r.status}): ${msg}`);
  if (r.status === 404 || /not found/i.test(String(msg))) {
    console.error("Esse e-mail não tem acesso. Convide a pessoa em Equipe (ou peça a quem administra).");
  }
  process.exit(1);
}
const hash = corpo.hashed_token ?? corpo.properties?.hashed_token;
if (!hash) {
  console.error("O Auth não devolveu o token.");
  process.exit(1);
}
const q = new URLSearchParams({ token_hash: hash, type: "magiclink" });
console.log(`${painel}/auth/callback?${q}`);
console.error("Uso único, expira em 15 minutos.");
