// deno-lint-ignore-file no-import-prefix
// Testes do portal com banco simulado (nada toca produção).
//   deno test --allow-env portal/
import { assert, assertEquals, assertNotEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { criarHandler, type Deps, type EventoAuditoria, type Repo, type TokenOffice, type TokenRow } from "./handler.ts";
import { chamadoPublico, diasAte, documentoPublico, etapasDoChamado, limparTexto, whatsappPublico, type ChamadoRow, type ClienteRow } from "./payload.ts";
import { gerarSenhaForte, hashSenha, verifySenha } from "../_shared/senha.ts";
import { hashToken } from "../_shared/token.ts";

const TOKEN_A = "A".repeat(32);
const TOKEN_B = "B".repeat(32);
const SENHA_A = "Senha-Correta-A1";
const SENHA_B = "Senha-Correta-B2";

const cliente = (id: string, extra: Partial<ClienteRow> = {}): ClienteRow => ({
  id, tipo: "PJ", nome: `Empresa ${id}`, nomeFantasia: null, cpfCnpj: "12345678000190", regimeTributario: "Simples Nacional",
  cidade: "São Paulo", estado: "SP", ativo: true, portalMostrarSituacaoFiscal: false, ...extra,
});

type Estado = {
  moduloAtivo: boolean;
  tokens: Map<string, TokenRow & { acessos: number; falhas: number }>; // por tokenHash
  clientes: Map<string, ClienteRow>;
  chamados: Map<string, (ChamadoRow & { comentarioInterno?: string; email?: string; observacoes?: string })[]>;
  eventos: EventoAuditoria[];
  criados: { tipoId: string; clienteId: string; descricao: string | null }[];
  contadores: Map<string, number>;
  tokensCriados: { hash: string; senhaHash: string; expiresAt: string | null }[];
  situacao: { status: string; criadoEm: string } | null;
  tipos: { id: string; nome: string }[];
  verificacoes: number;
};

// Hash "rápido" nos testes (o PBKDF2 real tem teste próprio abaixo).
const fakeHash = (s: string) => Promise.resolve(`fake$${s}`);

async function montar(over: Partial<Estado> = {}, depsOver: Partial<Deps> = {}) {
  const st: Estado = {
    moduloAtivo: true,
    tokens: new Map(),
    clientes: new Map([["cli-0001", cliente("cli-0001")], ["cli-0002", cliente("cli-0002")]]),
    chamados: new Map(),
    eventos: [],
    criados: [],
    contadores: new Map(),
    tokensCriados: [],
    situacao: null,
    tipos: [{ id: "tipo-nf-0001", nome: "Emissão de nota fiscal" }],
    verificacoes: 0,
    ...over,
  };
  st.tokens.set(await hashToken(TOKEN_A), { id: "tk-a", clienteId: "cli-0001", senhaHash: await fakeHash(SENHA_A), expiresAt: null, revogadoEm: null, bloqueadoAte: null, acessos: 0, falhas: 0 });
  st.tokens.set(await hashToken(TOKEN_B), { id: "tk-b", clienteId: "cli-0002", senhaHash: await fakeHash(SENHA_B), expiresAt: null, revogadoEm: null, bloqueadoAte: null, acessos: 0, falhas: 0 });

  const repo: Repo = {
    moduloAtivo: () => Promise.resolve(st.moduloAtivo),
    tokenPorHash: (h) => Promise.resolve(st.tokens.get(h) ?? null),
    cliente: (id) => Promise.resolve(st.clientes.get(id) ?? null),
    registrarAcesso: (id) => {
      for (const t of st.tokens.values()) if (t.id === id) { t.acessos++; t.falhas = 0; t.bloqueadoAte = null; }
      return Promise.resolve();
    },
    registrarFalha: (id) => {
      for (const t of st.tokens.values()) {
        if (t.id !== id) continue;
        t.falhas++;
        if (t.falhas >= 8) { t.falhas = 0; t.bloqueadoAte = new Date(Date.now() + 15 * 60_000).toISOString(); return Promise.resolve(t.bloqueadoAte); }
      }
      return Promise.resolve(null);
    },
    escritorio: () => Promise.resolve({ nome: "NÓS Contabilidade", whatsapp: "5511974135959" }),
    chamados: (cid) => Promise.resolve((st.chamados.get(cid) ?? []) as ChamadoRow[]),
    tiposAtivos: () => Promise.resolve(st.tipos),
    certificados: (cid) => Promise.resolve(cid === "cli-0001" ? [{ tipo: "e-CNPJ A1", validoAte: "2099-01-01" }] : [{ tipo: "e-CPF A3", validoAte: "2000-01-01" }]),
    ultimaSituacaoFiscal: () => Promise.resolve(st.situacao),
    chamadosPortalAbertos: (cid) => Promise.resolve(st.criados.filter((c) => c.clienteId === cid).length),
    criarChamado: (a) => { st.criados.push(a); return Promise.resolve({ id: `s${st.criados.length}` }); },
    auditar: (e) => { st.eventos.push(e); return Promise.resolve(); },
    clienteBasico: (id) => Promise.resolve(st.clientes.has(id) ? { id, nome: st.clientes.get(id)!.nome } : null),
    listarTokens: () => Promise.resolve([] as TokenOffice[]),
    revogarAtivos: (cid) => {
      let n = 0;
      for (const t of st.tokens.values()) if (t.clienteId === cid && !t.revogadoEm) { t.revogadoEm = new Date().toISOString(); n++; }
      return Promise.resolve(n);
    },
    criarToken: (a) => {
      st.tokensCriados.push({ hash: a.tokenHash, senhaHash: a.senhaHash, expiresAt: a.expiresAt });
      st.tokens.set(a.tokenHash, { id: `novo-${st.tokensCriados.length}`, clienteId: a.clienteId, senhaHash: a.senhaHash, expiresAt: a.expiresAt, revogadoEm: null, bloqueadoAte: null, acessos: 0, falhas: 0 });
      return Promise.resolve(true);
    },
    trocarSenha: (cid, h) => {
      let n = 0;
      for (const t of st.tokens.values()) if (t.clienteId === cid && !t.revogadoEm) { t.senhaHash = h; n++; }
      return Promise.resolve(n);
    },
    definirSituacaoFiscal: (cid, v) => { const c = st.clientes.get(cid); if (c) c.portalMostrarSituacaoFiscal = v; return Promise.resolve(true); },
  };

  const deps: Deps = {
    repo,
    hashToken,
    randomToken: (n = 24) => "T" + crypto.randomUUID().replaceAll("-", "").slice(0, n),
    gerarSenha: () => "SenhaNova-12345",
    hashSenha: fakeHash,
    verifySenha: (s, h) => { st.verificacoes++; return Promise.resolve(h === `fake$${s}`); },
    limite: (action, sujeito, max) => {
      const k = `${action}:${sujeito}`;
      const n = (st.contadores.get(k) ?? 0) + 1;
      st.contadores.set(k, n);
      return Promise.resolve(n <= max);
    },
    autenticar: () => Promise.resolve({ id: "colab-1", nome: "Maria" }),
    baseUrl: "https://painel.test",
    ...depsOver,
  };
  return { st, h: criarHandler(deps) };
}

const BASE = "https://x.test/portal";
const get = (token: string, senha?: string, ip = "1.1.1.1") =>
  new Request(`${BASE}/${token}`, { headers: { ...(senha ? { "x-portal-senha": senha } : {}), "x-forwarded-for": ip } });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${BASE}/${path}`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "2.2.2.2", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

// ---------------------------------------------------------------------------
Deno.test("senha certa abre o portal; corpo traz só campos da lista branca", async () => {
  const { h, st } = await montar({ chamados: new Map([["cli-0001", [{ status: "em_andamento", descricao: "NOTA INTERNA do contador", prazo: "2026-11-01", concluidaEm: null, criadoEm: "2026-10-01T10:00:00Z", origem: "painel", tipoNome: "Emissão de nota fiscal", comentarioInterno: "SEGREDO-COMENTARIO", email: "equipe@nos.com.br", observacoes: "OBS-INTERNA" } as ChamadoRow]]]) });
  const r = await h(get(TOKEN_A, SENHA_A));
  assertEquals(r.status, 200);
  const txt = await r.text();
  for (const proibido of ["SEGREDO-COMENTARIO", "equipe@nos.com.br", "OBS-INTERNA", "NOTA INTERNA", "senhaHash", "tokenHash", "criadoPor", "atorId", "12345678000190".slice(0, 3) + "xx"]) {
    assert(!txt.includes(proibido), `vazou: ${proibido}`);
  }
  const j = JSON.parse(txt);
  assertEquals(j.cliente.nome, "Empresa cli-0001");
  assertEquals(j.cliente.documento, "12.345.678/0001-90");
  assertEquals(j.chamados.length, 1);
  assertEquals(j.chamados[0].descricao, null); // chamado interno nunca mostra a descrição
  assertEquals(j.chamados[0].etapas.map((e: { chave: string }) => e.chave), ["recebido", "andamento", "concluido"]);
  assertEquals(j.escritorio.whatsapp, "5511974135959");
  assertEquals(j.situacaoFiscal, null);
  assertEquals(Object.keys(j).sort(), ["certificados", "chamados", "cliente", "escritorio", "linkExpiraEm", "situacaoFiscal", "tipos"]);
  assertEquals(st.tokens.get(await hashToken(TOKEN_A))!.acessos, 1);
});

Deno.test("nenhum dado de outro cliente: token A só vê o cliente A", async () => {
  const { h } = await montar({
    chamados: new Map([
      ["cli-0001", [{ status: "aberta", descricao: null, prazo: null, concluidaEm: null, criadoEm: "2026-10-01T10:00:00Z", origem: "painel", tipoNome: "Chamado do C1" }]],
      ["cli-0002", [{ status: "aberta", descricao: null, prazo: null, concluidaEm: null, criadoEm: "2026-10-01T10:00:00Z", origem: "painel", tipoNome: "Chamado do C2" }]],
    ]),
  });
  const txt = await (await h(get(TOKEN_A, SENHA_A))).text();
  assertStringIncludes(txt, "Chamado do C1");
  assert(!txt.includes("Chamado do C2") && !txt.includes("Empresa cli-0002") && !txt.includes("e-CPF A3"));
  // A senha do cliente B não abre o link do A.
  assertEquals((await h(get(TOKEN_A, SENHA_B))).status, 401);
});

Deno.test("situação fiscal: só com a chave ligada, e só o veredito", async () => {
  const { h, st } = await montar({ situacao: { status: "com_pendencia", criadoEm: "2026-10-10T10:00:00Z" } });
  assertEquals((await (await h(get(TOKEN_A, SENHA_A, "3.3.3.3"))).json()).situacaoFiscal, null);
  st.clientes.get("cli-0001")!.portalMostrarSituacaoFiscal = true;
  const j = await (await h(get(TOKEN_A, SENHA_A, "3.3.3.4"))).json();
  assertEquals(j.situacaoFiscal, { situacao: "pendencias", consultadoEm: "2026-10-10T10:00:00Z" });
});

Deno.test("sem enumeração: inexistente, malformado, revogado, expirado, cliente inativo e módulo desligado dão a MESMA resposta", async () => {
  const { h, st } = await montar();
  const hashA = await hashToken(TOKEN_A);
  const hashB = await hashToken(TOKEN_B);
  st.tokens.get(hashB)!.revogadoEm = new Date().toISOString();
  const TOKEN_C = "C".repeat(32);
  st.tokens.set(await hashToken(TOKEN_C), { id: "tk-c", clienteId: "cli-0001", senhaHash: await fakeHash("x"), expiresAt: new Date(Date.now() - 1000).toISOString(), revogadoEm: null, bloqueadoAte: null, acessos: 0, falhas: 0 });
  const TOKEN_D = "D".repeat(32);
  st.clientes.set("cli-0003", cliente("cli-0003", { ativo: false }));
  st.tokens.set(await hashToken(TOKEN_D), { id: "tk-d", clienteId: "cli-0003", senhaHash: await fakeHash("x"), expiresAt: null, revogadoEm: null, bloqueadoAte: null, acessos: 0, falhas: 0 });

  const casos = ["Z".repeat(32), "curto", "a'; drop table x;--", TOKEN_B, TOKEN_C, TOKEN_D];
  const respostas: { status: number; corpo: string; ct: string | null }[] = [];
  for (const [i, t] of casos.entries()) {
    // Mesmo com a senha CERTA do link, revogado/expirado/inativo não revela nada.
    const r = await h(get(t, i === 3 ? SENHA_B : "x", `9.9.9.${i}`));
    respostas.push({ status: r.status, corpo: await r.text(), ct: r.headers.get("content-type") });
  }
  st.moduloAtivo = false;
  const r = await h(get(TOKEN_A, SENHA_A, "9.9.9.99"));
  respostas.push({ status: r.status, corpo: await r.text(), ct: r.headers.get("content-type") });
  for (const x of respostas) assertEquals(x, respostas[0]);
  assertEquals(respostas[0].status, 404);
  assert(hashA.length === 64);
});

Deno.test("senha errada: 401, freio por IP+link no 6º erro e trava do LINK no 8º (qualquer IP)", async () => {
  const { h, st } = await montar();
  const statuses: number[] = [];
  for (let i = 0; i < 5; i++) statuses.push((await h(get(TOKEN_A, "errada", "5.5.5.5"))).status);
  assertEquals(statuses, [401, 401, 401, 401, 401]);
  assertEquals((await h(get(TOKEN_A, "errada", "5.5.5.5"))).status, 429); // 6º: freio IP+link
  // IPs diferentes (forjados) não escapam da trava do link: 8 erros seguidos no total.
  assertEquals((await h(get(TOKEN_A, "errada", "6.6.6.6"))).status, 401); // 7º
  const oitavo = await h(get(TOKEN_A, "errada", "7.7.7.7"));
  assertEquals(oitavo.status, 429);
  assert(oitavo.headers.get("retry-after"));
  // Travado: nem a senha CERTA entra, e nem se gasta PBKDF2.
  const antes = st.verificacoes;
  const certa = await h(get(TOKEN_A, SENHA_A, "8.8.8.8"));
  assertEquals(certa.status, 429);
  assertEquals(st.verificacoes, antes);
  // O outro cliente não é afetado.
  assertEquals((await h(get(TOKEN_B, SENHA_B, "8.8.8.8"))).status, 200);
});

Deno.test("sem senha = 401; senha gigante nem chega ao PBKDF2", async () => {
  const { h, st } = await montar();
  const semSenha = await h(get(TOKEN_A));
  assertEquals(semSenha.status, 200);
  assertEquals(await semSenha.json(), { senhaObrigatoria: true });
  const antes = st.verificacoes;
  const r = await h(get(TOKEN_A, "x".repeat(5000)));
  assertEquals(r.status, 401);
  assertEquals(st.verificacoes, antes);
});

Deno.test("freio por IP em toda chamada pública (61ª em 10 min)", async () => {
  const { h } = await montar();
  let ultimo = 0;
  for (let i = 0; i < 61; i++) ultimo = (await h(get("Z".repeat(32), "x", "4.4.4.4"))).status;
  assertEquals(ultimo, 429);
});

Deno.test("cabeçalhos: noindex, no-store, nosniff, e CORS não libera site de fora", async () => {
  const { h } = await montar();
  const r = await h(new Request(`${BASE}/${TOKEN_A}`, { headers: { "x-portal-senha": SENHA_A, origin: "https://malicioso.example" } }));
  assertEquals(r.headers.get("x-robots-tag"), "noindex, nofollow");
  assertEquals(r.headers.get("cache-control"), "no-store");
  assertEquals(r.headers.get("x-content-type-options"), "nosniff");
  assertNotEquals(r.headers.get("access-control-allow-origin"), "https://malicioso.example");
  // Mesmo o 404 e o 401 levam os cabeçalhos.
  const r404 = await h(get("Z".repeat(32), "x", "1.2.3.4"));
  assertEquals(r404.headers.get("x-robots-tag"), "noindex, nofollow");
  const pre = await h(new Request(`${BASE}/${TOKEN_A}`, { method: "OPTIONS", headers: { origin: "https://painel-web.at63vf.easypanel.host" } }));
  assertEquals(pre.status, 204);
  assertStringIncludes(pre.headers.get("access-control-allow-headers") ?? "", "x-portal-senha");
});

Deno.test("método/rota fora do mapa = 404 neutro", async () => {
  const { h } = await montar();
  for (const m of ["PUT", "DELETE", "PATCH"]) {
    const r = await h(new Request(`${BASE}/${TOKEN_A}`, { method: m, headers: { "x-portal-senha": SENHA_A } }));
    assertEquals(r.status, 404);
  }
  assertEquals((await h(new Request(`${BASE}/${TOKEN_A}/outra`, { headers: { "x-portal-senha": SENHA_A } }))).status, 404);
  assertEquals((await h(new Request(`${BASE}/${TOKEN_A}/a/b/c`))).status, 404);
  assertEquals((await h(new Request(`${BASE}/`))).status, 404);
});

Deno.test("verificar: confere a senha sem entregar dados", async () => {
  const { h } = await montar();
  const ok = await h(post(`${TOKEN_A}/verificar`, { senha: SENHA_A }));
  assertEquals(ok.status, 200);
  assertEquals(await ok.json(), { ok: true });
  assertEquals((await h(post(`${TOKEN_A}/verificar`, { senha: "nao" }))).status, 401);
  assertEquals((await h(post(`${TOKEN_A}/verificar`, "{json quebrado", {}))).status, 400);
});

Deno.test("solicitar: cria chamado com origem portal, sem responsável, e audita", async () => {
  const { h, st } = await montar();
  const r = await h(post(`${TOKEN_A}/solicitar`, { tipoId: "tipo-nf-0001", descricao: "  Preciso de uma nota\u0000 de R$ 500  " }, { "x-portal-senha": SENHA_A }));
  assertEquals(r.status, 200);
  assertEquals(st.criados, [{ tipoId: "tipo-nf-0001", clienteId: "cli-0001", descricao: "Preciso de uma nota de R$ 500" }]);
  assertEquals(st.eventos.at(-1)?.acao, "chamado_aberto");
  assertEquals(st.eventos.at(-1)?.solicitacaoId, "s1");
});

Deno.test("solicitar: validação (tipo, tamanho, injeção) e freios", async () => {
  const { h, st } = await montar();
  const H = { "x-portal-senha": SENHA_A };
  assertEquals((await h(post(`${TOKEN_A}/solicitar`, { tipoId: "' or 1=1 --", descricao: "descricao valida" }, H))).status, 400);
  assertEquals((await h(post(`${TOKEN_A}/solicitar`, { tipoId: "tipo-inexistente", descricao: "descricao valida" }, H))).status, 400);
  assertEquals((await h(post(`${TOKEN_A}/solicitar`, { tipoId: "tipo-nf-0001", descricao: "oi" }, H))).status, 400);
  assertEquals((await h(post(`${TOKEN_A}/solicitar`, { tipoId: "tipo-nf-0001", descricao: "x".repeat(9000) }, H))).status, 413);
  assertEquals((await h(post(`${TOKEN_A}/solicitar`, { tipoId: ["tipo-nf-0001"], descricao: "descricao valida" }, H))).status, 400);
  assertEquals(st.criados.length, 0);
  // texto longo (dentro do corpo máximo) é cortado em 1000
  const r = await h(post(`${TOKEN_A}/solicitar`, { tipoId: "tipo-nf-0001", descricao: "a".repeat(3000) }, H));
  assertEquals(r.status, 200);
  assertEquals(st.criados[0].descricao!.length, 1000);
  // 5 por hora por link: depois disso, 429
  for (let i = 0; i < 4; i++) assertEquals((await h(post(`${TOKEN_A}/solicitar`, { tipoId: "tipo-nf-0001", descricao: "pedido numero " + i }, H))).status, 200);
  assertEquals((await h(post(`${TOKEN_A}/solicitar`, { tipoId: "tipo-nf-0001", descricao: "pedido a mais" }, H))).status, 429);
});

Deno.test("solicitar exige a senha e respeita token revogado", async () => {
  const { h, st } = await montar();
  assertEquals((await h(post(`${TOKEN_A}/solicitar`, { tipoId: "tipo-nf-0001", descricao: "sem senha aqui" }))).status, 401);
  st.tokens.get(await hashToken(TOKEN_A))!.revogadoEm = new Date().toISOString();
  assertEquals((await h(post(`${TOKEN_A}/solicitar`, { tipoId: "tipo-nf-0001", descricao: "link revogado" }, { "x-portal-senha": SENHA_A }))).status, 404);
  assertEquals(st.criados.length, 0);
});

Deno.test("texto do cliente com HTML sai como texto puro no JSON (a tela renderiza sem innerHTML)", async () => {
  const { h } = await montar({
    chamados: new Map([["cli-0001", [{ status: "aberta", descricao: "<img src=x onerror=alert(1)>", prazo: null, concluidaEm: null, criadoEm: "2026-10-01T10:00:00Z", origem: "portal", tipoNome: "Nota" }]]]),
  });
  const j = await (await h(get(TOKEN_A, SENHA_A))).json();
  assertEquals(j.chamados[0].descricao, "<img src=x onerror=alert(1)>");
  assertEquals((await h(get(TOKEN_A, SENHA_A))).headers.get("content-type"), "application/json");
});

Deno.test("auditoria: 'cliente acessou' no máximo 1 por hora por link", async () => {
  const { h, st } = await montar();
  for (let i = 0; i < 4; i++) await h(get(TOKEN_A, SENHA_A, `7.0.0.${i}`));
  assertEquals(st.eventos.filter((e) => e.acao === "cliente_acessou").length, 1);
  await h(get(TOKEN_B, SENHA_B, "7.1.0.1"));
  assertEquals(st.eventos.filter((e) => e.acao === "cliente_acessou").length, 2);
});

// ---------------------------------------------------------------------------
// Escritório
// ---------------------------------------------------------------------------
const off = (acao: string, body: unknown = {}, method = "POST", cid = "cli-0001") =>
  new Request(`${BASE}/cliente/${cid}/${acao}`, { method, headers: { "content-type": "application/json", authorization: "Bearer x.y.z" }, body: method === "GET" ? undefined : JSON.stringify(body) });

Deno.test("escritório: sem login/permissão devolve a resposta do autenticador e não faz nada", async () => {
  const negado = new Response(JSON.stringify({ error: "Sem permissão" }), { status: 403 });
  const { h, st } = await montar({}, { autenticar: () => Promise.resolve(negado) });
  const r = await h(off("gerar"));
  assertEquals(r.status, 403);
  assertEquals(st.tokensCriados.length, 0);
});

Deno.test("escritório: gerar entrega link+senha uma vez, guarda só hashes, revoga o anterior e audita sem segredo", async () => {
  const { h, st } = await montar();
  const r = await h(off("gerar", { validadeDias: 30 }));
  assertEquals(r.status, 200);
  const j = await r.json();
  assert(j.link.startsWith("https://painel.test/portal/"));
  assertEquals(j.senha, "SenhaNova-12345");
  assertEquals(st.tokens.get(await hashToken(TOKEN_A))!.revogadoEm !== null, true); // link antigo caiu
  const guardado = st.tokensCriados[0];
  assertEquals(guardado.hash, await hashToken(j.token));
  assert(!JSON.stringify(st.tokensCriados).includes(j.token) && !guardado.senhaHash.includes("SenhaNova-12345".toLowerCase()) || guardado.senhaHash.startsWith("fake$"));
  const dias = (new Date(j.expiresAt).getTime() - Date.now()) / 86_400_000;
  assert(dias > 29.9 && dias < 30.1);
  const ev = st.eventos.at(-1)!;
  assertEquals(ev.acao, "link_gerado");
  assert(!JSON.stringify(ev).includes(j.token) && !JSON.stringify(ev).includes("SenhaNova"));
  // o link novo funciona e o velho dá 404
  assertEquals((await h(get(j.token, "SenhaNova-12345", "1.0.0.1"))).status, 200);
  assertEquals((await h(get(TOKEN_A, SENHA_A, "1.0.0.2"))).status, 404);
});

Deno.test("escritório: sem expiração (null), validade inválida, regenerar senha, revogar e config", async () => {
  const { h, st } = await montar();
  assertEquals((await (await h(off("gerar", { validadeDias: null }))).json()).expiresAt, null);
  assertEquals((await h(off("gerar", { validadeDias: -3 }))).status, 400);
  assertEquals((await h(off("gerar", { validadeDias: "30" }))).status, 400);
  // regenerar: link igual, senha nova
  const antes = st.tokensCriados.length;
  const reg = await h(off("regenerar-senha"));
  assertEquals((await reg.json()).senha, "SenhaNova-12345");
  assertEquals(st.tokensCriados.length, antes);
  assertEquals(st.eventos.at(-1)?.acao, "senha_regenerada");
  // revogar
  assertEquals((await h(off("revogar"))).status, 200);
  assertEquals(st.eventos.at(-1)?.acao, "link_revogado");
  assertEquals((await h(off("regenerar-senha"))).status, 400); // sem link ativo
  // config
  assertEquals((await h(off("config", { mostrarSituacaoFiscal: "sim" }))).status, 400);
  assertEquals((await h(off("config", { mostrarSituacaoFiscal: true }))).status, 200);
  assertEquals(st.clientes.get("cli-0001")!.portalMostrarSituacaoFiscal, true);
  assertEquals((await (await h(off("tokens", {}, "GET"))).json()).mostrarSituacaoFiscal, true);
});

Deno.test("escritório: módulo desligado = 403; cliente inexistente = 404; id malformado = 404", async () => {
  const { h, st } = await montar();
  assertEquals((await h(off("gerar", {}, "POST", "nao-existe-123"))).status, 404);
  assertEquals((await h(off("gerar", {}, "POST", "a'b"))).status, 404);
  st.moduloAtivo = false;
  assertEquals((await h(off("gerar"))).status, 403);
});

Deno.test("escritório: corpo gigante = 413", async () => {
  const { h } = await montar();
  assertEquals((await h(off("config", { mostrarSituacaoFiscal: true, lixo: "x".repeat(20_000) }))).status, 413);
});

// ---------------------------------------------------------------------------
// Peças puras e criptografia real
// ---------------------------------------------------------------------------
Deno.test("payload: CPF mascarado, CNPJ inteiro, dias restantes, etapas, WhatsApp", () => {
  assertEquals(documentoPublico("PF", "123.456.789-09"), "•••.456.789-••");
  assertEquals(documentoPublico("PJ", "12345678000190"), "12.345.678/0001-90");
  assertEquals(documentoPublico("PJ", null), null);
  assertEquals(documentoPublico("PJ", "123"), null);
  assertEquals(diasAte("2026-10-20", "2026-10-15"), 5);
  assertEquals(diasAte("2026-10-10", "2026-10-15"), -5);
  assertEquals(etapasDoChamado("concluida", "a", "b").map((e) => e.feito), [true, true, true]);
  assertEquals(etapasDoChamado("aberta", "a", null).map((e) => e.feito), [true, false, false]);
  assertEquals(etapasDoChamado("cancelada", "a", null).map((e) => e.chave), ["recebido", "cancelado"]);
  assertEquals(chamadoPublico({ status: "estranho", descricao: "x", prazo: null, concluidaEm: null, criadoEm: "z", origem: "painel", tipoNome: null }).status, "aberta");
  assertEquals(whatsappPublico("+55 (11) 97413-5959"), "5511974135959");
  assertEquals(whatsappPublico(null), null);
  assertEquals(whatsappPublico("123"), null);
  assertEquals(limparTexto("a‮b​c\r\n\r\n\r\n\r\nd", 100), "abc\n\nd");
  assertEquals(limparTexto(123, 10), "");
});

Deno.test("senha real: PBKDF2 gera e confere; errada falha; formato do hash", async () => {
  const s = gerarSenhaForte();
  assertEquals(s.length, 12);
  const hash = await hashSenha(s);
  assert(hash.startsWith("pbkdf2$600000$"));
  assertEquals(await verifySenha(s, hash), true);
  assertEquals(await verifySenha(s + "x", hash), false);
  assertEquals(await verifySenha(s, "lixo"), false);
  assertNotEquals(await hashSenha(s), hash); // sal diferente a cada vez
});
