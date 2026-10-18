// Testa o login do painel de ponta a ponta contra um Supabase de verdade.
//
//   SUPABASE_URL=https://painel-supabase.at63vf.easypanel.host \
//   SUPABASE_SERVICE_ROLE_KEY=<service role> SUPABASE_ANON_KEY=<anon> \
//   node scripts/testar-login.mjs
//
// O que faz (tudo com pessoas "TESTE QA ...", apagadas no fim, inclusive no Auth):
//   1. cria um administrador de teste direto no banco (service role) só para
//      poder chamar a function equipe com um login de verdade;
//   2. convida pela function equipe as pessoas de teste (sem SMTP vem o link);
//   3. link de uso único: o link do convite vira sessão e não vale de novo;
//   4. código de 6 números (o mesmo que iria no e-mail) vira sessão;
//   5. auditoria: o gatilho do servidor grava "entrou no painel" e a tela só
//      refina para "Link de acesso" / "Código por e-mail" (migration 017);
//   6. entrada só com o e-mail (se ligada): resolve o ALTCHA como o navegador
//      e entra, sem auditoria duplicada;
//   7. sair com scope=local derruba só aquela sessão;
//   8. pessoa desativada não entra (link, código, só e-mail, sessão antiga);
//   9. e-mail desconhecido é recusado.
// Imprime PASSOU/FALHOU por item, sem token, senha nem link. Nunca desloga
// ninguém além das pessoas de teste. Código de saída 1 se algo falhar.
import { createHash, randomBytes } from 'node:crypto';

const URL_ = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON = process.env.SUPABASE_ANON_KEY ?? '';
if (!URL_ || !SERVICE || !ANON) {
  console.error('Defina SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e SUPABASE_ANON_KEY.');
  process.exit(2);
}

const sufixo = randomBytes(3).toString('hex');
const emailQa = (papel) => `qa-login-${papel}-${sufixo}@teste.invalid`;
const resultados = [];
const criados = { authIds: new Set(), colabIds: new Set() };

function registrar(nome, ok, detalhe = '') {
  resultados.push({ nome, ok });
  console.log(`${ok ? 'PASSOU' : 'FALHOU'}  ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(caminho, { method = 'GET', token, body, chave = ANON, headers = {} } = {}) {
  const r = await fetch(`${URL_}${caminho}`, {
    method,
    headers: {
      apikey: chave,
      Authorization: `Bearer ${token ?? chave}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const texto = await r.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch { /* resposta sem JSON */ }
  return { status: r.status, ok: r.ok, json };
}
const admin = (caminho, opts = {}) => http(caminho, { ...opts, chave: SERVICE });
/** Mensagem de erro curta e sem segredo. */
const msg = (r) => `HTTP ${r.status}${r.json?.error_code ? ` ${r.json.error_code}` : ''}${r.json?.error ? ` ${String(r.json.error).slice(0, 80)}` : ''}`;

/** Token de uso único do Auth para o e-mail (o mesmo do e-mail de acesso). */
async function gerarToken(email) {
  const r = await admin('/auth/v1/admin/generate_link', { method: 'POST', body: { type: 'magiclink', email } });
  const p = r.json?.properties ?? r.json ?? {};
  return { status: r.status, hash: p.hashed_token ?? null, codigo: p.email_otp ?? null };
}
const verificarHash = (hash, type = 'magiclink') => http('/auth/v1/verify', { method: 'POST', body: { type, token_hash: hash } });
const verificarCodigo = (email, token) => http('/auth/v1/verify', { method: 'POST', body: { type: 'email', email, token } });
const renovar = (refresh) => http('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: refresh } });

async function eventosLogin(colabId) {
  const q = new URLSearchParams({
    select: 'detalhes,criadoEm', modulo: 'eq.acesso', acao: 'eq.login', atorId: `eq.${colabId}`, order: 'id.desc',
  });
  const r = await admin(`/rest/v1/AuditoriaEvento?${q}`);
  return Array.isArray(r.json) ? r.json : [];
}
const comoDe = (ev) => ev?.detalhes?.info?.find((i) => i.rotulo === 'Como')?.valor ?? null;

/** ALTCHA como o widget do navegador: acha o número cujo SHA-256(salt + n) bate. */
function resolverAltcha(d) {
  const inicio = Date.now();
  for (let n = 0; n <= (d.maxnumber ?? d.maxNumber ?? 1_000_000); n++) {
    if (createHash('sha256').update(d.salt + n).digest('hex') === d.challenge) {
      const payload = { algorithm: d.algorithm, challenge: d.challenge, number: n, salt: d.salt, signature: d.signature, took: Date.now() - inicio };
      return Buffer.from(JSON.stringify(payload)).toString('base64');
    }
  }
  return null;
}
async function entrarSoEmail(email) {
  const desafio = await http('/functions/v1/entrar');
  if (!desafio.ok) return { status: desafio.status, json: desafio.json };
  const altcha = resolverAltcha(desafio.json);
  return http('/functions/v1/entrar', { method: 'POST', body: { email, altcha } });
}

/** Chama a function equipe como o administrador de teste. */
const equipe = (caminho, token, opts = {}) => http(`/functions/v1/equipe${caminho}`, { ...opts, token });

async function main() {
  // ---------------- 0. Administrador de teste (direto, service role) ----------------
  const cargos = (await admin('/rest/v1/Cargo?select=id,nome,sistema')).json ?? [];
  const cargoAdmin = cargos.find((c) => c.sistema)?.id;
  const cargoComum = cargos.find((c) => !c.sistema && /estagi/i.test(c.nome))?.id ?? cargos.find((c) => !c.sistema)?.id;
  if (!cargoAdmin || !cargoComum) throw new Error('Cargos não encontrados.');

  const emailAdm = emailQa('admin');
  const u = await admin('/auth/v1/admin/users', { method: 'POST', body: { email: emailAdm, email_confirm: true, user_metadata: { nome: 'TESTE QA Admin (login)' } } });
  if (!u.json?.id) throw new Error(`Não criou o admin de teste: ${msg(u)}`);
  criados.authIds.add(u.json.id);
  const c = await admin('/rest/v1/Colaborador', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: { tenantId: 'denos', nome: 'TESTE QA Admin (login)', email: emailAdm, cargoId: cargoAdmin, userId: u.json.id, ativo: true },
  });
  const admId = c.json?.[0]?.id;
  if (!admId) throw new Error(`Não criou o Colaborador admin: ${msg(c)}`);
  criados.colabIds.add(admId);
  const tAdm = await gerarToken(emailAdm);
  const sAdm = await verificarHash(tAdm.hash);
  if (!sAdm.json?.access_token) throw new Error(`Admin de teste não entrou: ${msg(sAdm)}`);
  const jwtAdm = sAdm.json.access_token;

  // ---------------- 1. Convites pela function equipe ----------------
  const pessoas = {};
  for (const [chave, nome] of [['link', 'TESTE QA Link'], ['codigo', 'TESTE QA Código'], ['soemail', 'TESTE QA Só e-mail']]) {
    const r = await equipe('/convidar', jwtAdm, { method: 'POST', body: { nome, email: emailQa(chave), cargoId: cargoComum } });
    if (r.json?.colaborador?.id) {
      criados.colabIds.add(r.json.colaborador.id);
      if (r.json.colaborador.userId) criados.authIds.add(r.json.colaborador.userId);
    }
    pessoas[chave] = { email: emailQa(chave), id: r.json?.colaborador?.id, userId: r.json?.colaborador?.userId, link: r.json?.link ?? null, emailEnviado: r.json?.emailEnviado };
    if (!r.ok) throw new Error(`Convite ${chave} falhou: ${msg(r)}`);
  }
  const P = pessoas.link;
  registrar('convite pela function equipe', !!P.id && (P.link !== null || P.emailEnviado === true),
    P.emailEnviado ? 'e-mail de acesso enviado (SMTP ligado)' : 'sem SMTP: veio o link de acesso');

  // ---------------- 2. Link de uso único ----------------
  let hashLink = P.link ? new URL(P.link).searchParams.get('token_hash') : null;
  if (!hashLink) hashLink = (await gerarToken(P.email)).hash; // com SMTP o convite não devolve link
  const s1 = await verificarHash(hashLink);
  registrar('link de acesso vira sessão', !!s1.json?.access_token, s1.json?.access_token ? '' : msg(s1));
  const s1b = await verificarHash(hashLink);
  registrar('o mesmo link não vale de novo', !s1b.json?.access_token, `segunda tentativa: HTTP ${s1b.status}`);

  // Auditoria do link: gatilho grava genérico, a tela refina.
  await esperar(300);
  let evs = await eventosLogin(P.id);
  registrar('auditoria: servidor gravou "entrou no painel"', evs.length === 1 && comoDe(evs[0]) === 'Link ou código por e-mail', `Como: ${comoDe(evs[0]) ?? 'nada'}`);
  await http('/rest/v1/rpc/registrar_login', { method: 'POST', token: s1.json?.access_token, body: { p_metodo: 'link' } });
  evs = await eventosLogin(P.id);
  registrar('auditoria: tela refinou para "Link de acesso"', evs.length === 1 && comoDe(evs[0]) === 'Link de acesso', `Como: ${comoDe(evs[0]) ?? 'nada'}`);

  // ---------------- 3. Código de 6 números ----------------
  const C = pessoas.codigo;
  const tC = await gerarToken(C.email);
  const errado = await verificarCodigo(C.email, tC.codigo === '000000' ? '111111' : '000000');
  registrar('código errado é recusado', !errado.json?.access_token, `HTTP ${errado.status}`);
  const sC = await verificarCodigo(C.email, tC.codigo);
  registrar('código de 6 números vira sessão', !!sC.json?.access_token && /^\d{6}$/.test(tC.codigo ?? ''), sC.json?.access_token ? '' : msg(sC));
  await http('/rest/v1/rpc/registrar_login', { method: 'POST', token: sC.json?.access_token, body: { p_metodo: 'codigo' } });
  evs = await eventosLogin(C.id);
  registrar('auditoria: "Código por e-mail", uma linha só', evs.length === 1 && comoDe(evs[0]) === 'Código por e-mail', `${evs.length} linha(s), Como: ${comoDe(evs[0]) ?? 'nada'}`);

  // ---------------- 4. Só com o e-mail ----------------
  // A chave é a mesma que a function lê: Config 'modulos'.loginSemVerificacao (ligada se não for false).
  const cfg = await admin('/rest/v1/Config?select=valor&chave=eq.modulos');
  const soEmailLigado = cfg.json?.[0]?.valor?.loginSemVerificacao !== false;
  const E = pessoas.soemail;
  if (!soEmailLigado) {
    const r = await entrarSoEmail(E.email);
    registrar('entrada só com o e-mail desligada recusa', r.status === 403, `HTTP ${r.status}`);
  } else {
    const r = await entrarSoEmail(E.email);
    const sE = r.json?.token_hash ? await verificarHash(r.json.token_hash) : null;
    registrar('entrada só com o e-mail (ALTCHA resolvido)', !!sE?.json?.access_token, sE ? (sE.json?.access_token ? '' : msg(sE)) : msg(r));
    await esperar(300);
    evs = await eventosLogin(E.id);
    registrar('auditoria: só e-mail sem duplicar', evs.length === 1 && /Só com o e-mail/.test(comoDe(evs[0]) ?? ''), `${evs.length} linha(s), Como: ${comoDe(evs[0]) ?? 'nada'}`);
    const reuso = await http('/functions/v1/entrar', { method: 'POST', body: { email: E.email, altcha: 'invalido' } });
    registrar('só e-mail sem ALTCHA válido é recusado', reuso.status === 403, `HTTP ${reuso.status}`);
  }

  // ---------------- 5. Sair (scope=local) ----------------
  const s2 = await verificarHash((await gerarToken(P.email)).hash); // segunda sessão da mesma pessoa
  const sair = await http('/auth/v1/logout?scope=local', { method: 'POST', token: s1.json?.access_token });
  const r1 = await renovar(s1.json?.refresh_token);
  const r2 = await renovar(s2.json?.refresh_token);
  registrar('sair (local) encerra a sessão', sair.status === 204 && !r1.json?.access_token, `logout HTTP ${sair.status}, renovar HTTP ${r1.status}`);
  registrar('sair (local) não derruba a outra sessão', !!r2.json?.access_token, `renovar a outra: HTTP ${r2.status}`);

  // ---------------- 6. Pessoa desativada ----------------
  const off = await equipe(`/${C.id}`, jwtAdm, { method: 'PATCH', body: { ativo: false } });
  registrar('desativar pela function equipe', off.ok && off.json?.colaborador?.ativo === false, `HTTP ${off.status}`);
  const rC = await renovar(sC.json?.refresh_token);
  registrar('desativada: sessão aberta cai', !rC.json?.access_token, `renovar: HTTP ${rC.status}`);
  const linkOff = await equipe(`/${C.id}/link`, jwtAdm, { method: 'POST' });
  registrar('desativada: equipe não gera link', linkOff.status === 400, `HTTP ${linkOff.status}`);
  const tOff = await gerarToken(C.email);
  const vOff = tOff.hash ? await verificarHash(tOff.hash) : { json: null, status: tOff.status };
  registrar('desativada: token do Auth não vira sessão', !vOff.json?.access_token, `HTTP ${vOff.status}`);
  if (soEmailLigado) {
    const eOff = await entrarSoEmail(C.email);
    registrar('desativada: só e-mail recusa', eOff.status === 403 && !eOff.json?.token_hash, `HTTP ${eOff.status}`);
  }

  // ---------------- 7. E-mail desconhecido ----------------
  const desconhecido = `qa-login-ninguem-${sufixo}@teste.invalid`;
  const otp = await http('/auth/v1/otp', { method: 'POST', body: { email: desconhecido, create_user: false } });
  registrar('desconhecido: Auth não cria nem manda código', !otp.ok, `HTTP ${otp.status}`);
  if (soEmailLigado) {
    const eD = await entrarSoEmail(desconhecido);
    registrar('desconhecido: só e-mail recusa', eD.status === 403 && !eD.json?.token_hash, `HTTP ${eD.status}`);
  }
  const lista = await admin(`/auth/v1/admin/users?page=1&per_page=200`);
  const vazou = (lista.json?.users ?? []).some((x) => x.email === desconhecido);
  registrar('desconhecido: nenhum usuário criado', !vazou);

  // ---------------- 8. Limpeza das pessoas convidadas (pela function) ----------------
  for (const p of Object.values(pessoas)) {
    if (!p.id) continue;
    const d = await equipe(`/${p.id}`, jwtAdm, { method: 'DELETE' });
    if (d.ok) {
      criados.colabIds.delete(p.id);
      if (p.userId) criados.authIds.delete(p.userId);
    }
  }
  await http('/auth/v1/logout?scope=local', { method: 'POST', token: jwtAdm });
}

async function limpar() {
  // O que a function não apagou (e o admin de teste): direto, com service role.
  for (const id of criados.colabIds) await admin(`/rest/v1/Colaborador?id=eq.${id}`, { method: 'DELETE' });
  for (const id of criados.authIds) await admin(`/auth/v1/admin/users/${id}`, { method: 'DELETE' });
  const lista = await admin('/auth/v1/admin/users?page=1&per_page=200');
  const sobrou = (lista.json?.users ?? []).filter((x) => (x.email ?? '').includes(`-${sufixo}@teste.invalid`));
  const colabs = await admin(`/rest/v1/Colaborador?select=id&email=like.*-${sufixo}@teste.invalid`);
  const ok = sobrou.length === 0 && (colabs.json ?? []).length === 0;
  registrar('limpeza: nenhuma pessoa de teste sobrou (Auth e Equipe)', ok, ok ? '' : `${sobrou.length} no Auth, ${(colabs.json ?? []).length} na Equipe`);
}

try {
  await main();
} catch (err) {
  registrar('execução', false, err instanceof Error ? err.message : String(err));
} finally {
  await limpar().catch((e) => registrar('limpeza', false, e instanceof Error ? e.message : String(e)));
  const falhas = resultados.filter((r) => !r.ok).length;
  console.log(`\n${resultados.length - falhas} passaram, ${falhas} falharam.`);
  process.exit(falhas ? 1 : 0);
}
