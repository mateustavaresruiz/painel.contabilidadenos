// Edge Function: portal  (portal do cliente: link público enviado pelo escritório)
// URL pública: https://<web>/portal/<token>   ->   API: <supabase>/functions/v1/portal/...
//
// Rotas PÚBLICAS (sem login do painel; protegidas por TOKEN + SENHA do link):
//   GET   /portal/<token>             -> dados do portal (senha no header X-Portal-Senha)
//   POST  /portal/<token>/verificar   -> confere a senha ({ senha })
//   POST  /portal/<token>/solicitar   -> cliente pede algo; vira chamado com origem 'portal'
//
// Rotas do ESCRITÓRIO (JWT do colaborador + permissão `portal.gerenciar`):
//   GET   /portal/cliente/<id>/tokens           -> situação do link (nunca o token/senha)
//   POST  /portal/cliente/<id>/gerar            -> { validadeDias: n | null } -> link + senha (UMA vez)
//   POST  /portal/cliente/<id>/regenerar-senha  -> senha nova, mesmo link (UMA vez)
//   POST  /portal/cliente/<id>/revogar          -> derruba o link
//   POST  /portal/cliente/<id>/config           -> { mostrarSituacaoFiscal }
//
// Regras que NÃO se negociam (cada uma tem teste em handler_test.ts):
//  - Token inexistente, revogado, expirado, cliente inativo ou módulo desligado
//    respondem IGUAL: 404 com o mesmo corpo. Ninguém descobre qual foi o caso.
//  - O token tem 192 bits e só o sha256 dele fica no banco: não dá para listar nem adivinhar.
//  - Senha errada: freio por IP+link (5/15 min) e trava do LINK inteiro (8 erros seguidos,
//    15 min), que não depende do IP (o IP vem de header e pode ser forjado).
//  - A resposta pública é montada por lista branca (payload.ts). Nada de `select *`.
//  - Todo texto do cliente é limpo no servidor e renderizado como TEXTO na tela (nunca HTML).

import { ipDoCliente } from "../_shared/client-ip.ts";
import { handleCors } from "../_shared/cors.ts";
import { json } from "../_shared/response.ts";
import {
  cadastroPublico,
  certPublico,
  chamadoPublico,
  hojeSaoPaulo,
  ID_RE,
  limparTexto,
  situacaoFiscalPublica,
  TOKEN_RE,
  whatsappPublico,
  type CertRow,
  type ChamadoRow,
  type ClienteRow,
} from "./payload.ts";

// ---------------------------------------------------------------------------
// Dependências injetáveis (o index.ts liga as reais; os testes ligam mocks)
// ---------------------------------------------------------------------------
export type TokenRow = {
  id: string;
  clienteId: string;
  senhaHash: string;
  expiresAt: string | null;
  revogadoEm: string | null;
  bloqueadoAte: string | null;
};

export type TokenOffice = {
  id: string;
  criadoEm: string;
  expiresAt: string | null;
  revogadoEm: string | null;
  ultimoAcessoEm: string | null;
  acessos: number;
  bloqueadoAte: string | null;
  criadoPorNome: string | null;
};

export type EventoAuditoria = {
  acao: string;
  resumo: string;
  clienteId: string;
  solicitacaoId?: string | null;
  info?: { rotulo: string; valor: string }[];
};

export type Colab = { id: string; nome: string };

export interface Repo {
  moduloAtivo(): Promise<boolean>;
  tokenPorHash(hash: string): Promise<TokenRow | null>;
  cliente(id: string): Promise<ClienteRow | null>;
  registrarAcesso(tokenId: string): Promise<void>;
  /** Soma um erro; devolve até quando o link ficou travado (ou null). */
  registrarFalha(tokenId: string): Promise<string | null>;
  escritorio(): Promise<{ nome: string; whatsapp: string | null }>;
  chamados(clienteId: string): Promise<ChamadoRow[]>;
  tiposAtivos(): Promise<{ id: string; nome: string }[]>;
  certificados(clienteId: string): Promise<CertRow[]>;
  ultimaSituacaoFiscal(clienteId: string): Promise<{ status: string; criadoEm: string } | null>;
  chamadosPortalAbertos(clienteId: string): Promise<number>;
  criarChamado(a: { tipoId: string; clienteId: string; descricao: string | null }): Promise<{ id: string } | null>;
  auditar(e: EventoAuditoria): Promise<void>;
  // escritório
  clienteBasico(id: string): Promise<{ id: string; nome: string } | null>;
  listarTokens(clienteId: string): Promise<TokenOffice[]>;
  revogarAtivos(clienteId: string): Promise<number>;
  /**
   * Grava o link novo e revoga os outros ativos do cliente NUMA transação só
   * (RPC portal_token_trocar). Devolve o id do novo, ou null se não gravou; aí
   * nada mudou e o link anterior continua valendo.
   */
  trocarToken(a: { clienteId: string; tokenHash: string; senhaHash: string; expiresAt: string | null; criadoPorId: string }): Promise<string | null>;
  trocarSenha(clienteId: string, senhaHash: string): Promise<number>;
  definirSituacaoFiscal(clienteId: string, valor: boolean): Promise<boolean>;
}

export type Deps = {
  repo: Repo;
  hashToken: (t: string) => Promise<string>;
  randomToken: (bytes?: number) => string;
  gerarSenha: () => string;
  hashSenha: (s: string) => Promise<string>;
  verifySenha: (s: string, hash: string) => Promise<boolean>;
  /** false = estourou o limite. */
  limite: (action: string, sujeito: string, max: number, windowSecs: number) => Promise<boolean>;
  /** JWT do colaborador + permissão; devolve o colaborador ou a Response de erro. */
  autenticar: (req: Request, permissao: string) => Promise<Colab | Response>;
  baseUrl: string;
  agora?: () => Date;
};

// ---------------------------------------------------------------------------
// Respostas
// ---------------------------------------------------------------------------
const SEG_HEADERS: Record<string, string> = {
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

function resp(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return json(body, { status, headers: { ...SEG_HEADERS, ...extra } });
}
const erro = (m: string, s = 400, extra?: Record<string, string>) => resp({ error: m }, s, extra);

/** Resposta única para "este link não existe / não vale mais". Mesmo corpo em todos os casos. */
const indisponivel = () => erro("Este link não está disponível.", 404);
const MSG_LIMITE = "Muitas tentativas. Aguarde alguns minutos e tente de novo.";
const limiteExcedido = (secs = 900) => erro(MSG_LIMITE, 429, { "Retry-After": String(secs) });

const MAX_BODY = 8 * 1024;
const MAX_SENHA = 128;
const MAX_DESC = 1000;
const MAX_CHAMADOS_PORTAL_ABERTOS = 20;

async function lerJson(req: Request): Promise<Record<string, unknown> | "grande" | null> {
  const cl = Number(req.headers.get("content-length") ?? "0");
  if (cl > MAX_BODY) return "grande";
  let txt = "";
  try {
    txt = await req.text();
  } catch {
    return null;
  }
  if (txt.length > MAX_BODY) return "grande";
  if (!txt.trim()) return {};
  try {
    const v = JSON.parse(txt);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function formatarData(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export function criarHandler(deps: Deps) {
  const { repo } = deps;
  const agora = () => (deps.agora ? deps.agora() : new Date());

  async function auditarSemFalhar(e: EventoAuditoria) {
    try {
      await repo.auditar(e);
    } catch (err) {
      console.error("portal: auditoria falhou", err);
    }
  }

  // ------------------------- ESCRITÓRIO -------------------------
  async function escritorio(req: Request, clienteId: string, acao: string): Promise<Response> {
    const eu = await deps.autenticar(req, "portal.gerenciar");
    if (eu instanceof Response) return eu;
    if (!(await repo.moduloAtivo())) return erro("O módulo Portal do cliente está desligado em Configurações.", 403);
    if (!(await deps.limite("portal-escritorio", `c:${eu.id}`, 60, 60))) return limiteExcedido(60);
    if (!ID_RE.test(clienteId)) return erro("Cliente não encontrado.", 404);
    const cli = await repo.clienteBasico(clienteId);
    if (!cli) return erro("Cliente não encontrado.", 404);

    if (req.method === "GET" && acao === "tokens") {
      const tokens = await repo.listarTokens(clienteId);
      const cadastro = await repo.cliente(clienteId);
      return resp({ tokens, mostrarSituacaoFiscal: !!cadastro?.portalMostrarSituacaoFiscal });
    }

    if (req.method !== "POST") return erro("Rota não encontrada.", 404);
    const body = await lerJson(req);
    if (body === "grande") return erro("Pedido grande demais.", 413);
    if (body === null) return erro("Corpo inválido.");

    if (acao === "gerar") {
      let validadeDias: number | null = 90;
      if ("validadeDias" in body) {
        const v = body.validadeDias;
        if (v === null) validadeDias = null;
        else if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 3650) validadeDias = v;
        else return erro("Validade inválida.");
      }
      const tokenClaro = deps.randomToken(24);
      const senhaClara = deps.gerarSenha();
      const [tokenHash, senhaHash] = await Promise.all([deps.hashToken(tokenClaro), deps.hashSenha(senhaClara)]);
      const expira = validadeDias === null ? null : new Date(agora().getTime() + validadeDias * 86_400_000).toISOString();
      // Um link por cliente: o novo entra e o anterior cai juntos (uma transação).
      // Se a gravação falhar, o cliente continua com o link que já tinha.
      const novoId = await repo.trocarToken({ clienteId, tokenHash, senhaHash, expiresAt: expira, criadoPorId: eu.id });
      if (!novoId) return erro("Não foi possível gerar o link.", 500);
      await auditarSemFalhar({
        acao: "link_gerado",
        clienteId,
        resumo: `gerou o link do portal de «${cli.nome}» (${expira === null ? "sem expiração" : `vale até ${formatarData(expira)}`})`,
        info: [{ rotulo: "Validade", valor: validadeDias === null ? "Sem expiração" : `${validadeDias} dias` }],
      });
      return resp({
        token: tokenClaro,
        senha: senhaClara,
        link: `${deps.baseUrl}/portal/${tokenClaro}`,
        expiresAt: expira,
      });
    }

    if (acao === "regenerar-senha") {
      const senhaClara = deps.gerarSenha();
      const n = await repo.trocarSenha(clienteId, await deps.hashSenha(senhaClara));
      if (n === 0) return erro("Nenhum link ativo. Gere um link primeiro.");
      await auditarSemFalhar({ acao: "senha_regenerada", clienteId, resumo: `gerou uma senha nova para o portal de «${cli.nome}»` });
      return resp({ senha: senhaClara });
    }

    if (acao === "revogar") {
      const n = await repo.revogarAtivos(clienteId);
      if (n > 0) await auditarSemFalhar({ acao: "link_revogado", clienteId, resumo: `revogou o link do portal de «${cli.nome}»` });
      return resp({ ok: true });
    }

    if (acao === "config") {
      if (typeof body.mostrarSituacaoFiscal !== "boolean") return erro("Valor inválido.");
      const ok = await repo.definirSituacaoFiscal(clienteId, body.mostrarSituacaoFiscal);
      if (!ok) return erro("Não foi possível salvar.", 500);
      await auditarSemFalhar({
        acao: "config",
        clienteId,
        resumo: body.mostrarSituacaoFiscal
          ? `ligou a situação fiscal no portal de «${cli.nome}»`
          : `desligou a situação fiscal no portal de «${cli.nome}»`,
      });
      return resp({ ok: true, mostrarSituacaoFiscal: body.mostrarSituacaoFiscal });
    }

    return erro("Rota não encontrada.", 404);
  }

  // ------------------------- PÚBLICO -------------------------
  async function publico(req: Request, token: string, acao: string): Promise<Response> {
    // IP para o freio: o que a nossa cadeia de proxies viu (ver _shared/client-ip.ts), não o que o cliente mandou.
    const ip = ipDoCliente(req);

    // 1. Freio por IP em TODA chamada pública (antes de qualquer consulta).
    if (!(await deps.limite("portal", `ip:${ip}`, 60, 600))) return limiteExcedido(600);

    // 2. Método/rota. Qualquer coisa fora do mapa = o mesmo 404 neutro.
    const rotaOk =
      (req.method === "GET" && acao === "") ||
      (req.method === "POST" && (acao === "verificar" || acao === "solicitar"));
    if (!rotaOk) return indisponivel();

    // 3. Módulo desligado = link inexistente.
    if (!(await repo.moduloAtivo())) return indisponivel();

    // 4. Token. Formato ruim também consulta o banco (com o hash do que veio),
    //    para o caminho e o tempo serem os mesmos de um token que só não existe.
    const forma = TOKEN_RE.test(token);
    const hash = await deps.hashToken(forma ? token : token.slice(0, 200));
    const tk = await repo.tokenPorHash(hash);
    if (!forma || !tk || tk.revogadoEm) return indisponivel();
    if (tk.expiresAt && new Date(tk.expiresAt).getTime() <= agora().getTime()) return indisponivel();
    const cli = await repo.cliente(tk.clienteId);
    if (!cli || !cli.ativo) return indisponivel();

    // 5. Link travado por excesso de erros (vale para qualquer IP).
    if (tk.bloqueadoAte && new Date(tk.bloqueadoAte).getTime() > agora().getTime()) {
      const secs = Math.max(1, Math.ceil((new Date(tk.bloqueadoAte).getTime() - agora().getTime()) / 1000));
      return limiteExcedido(secs);
    }

    // 6. Corpo (só nas rotas POST) e senha.
    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      const b = await lerJson(req);
      if (b === "grande") return erro("Pedido grande demais.", 413);
      if (b === null) return erro("Corpo inválido.");
      body = b;
    }
    const senhaBruta = req.headers.get("x-portal-senha") ?? (typeof body.senha === "string" ? body.senha : "");
    if (!senhaBruta) {
      // Abrir o link sem senha é o caso NORMAL (a tela pede a senha): 200 sem dado nenhum,
      // para o navegador não registrar um "erro" a cada visita. Nas rotas POST segue 401.
      if (req.method === "GET") return resp({ senhaObrigatoria: true });
      return erro("Senha obrigatória.", 401);
    }

    // Senha comprida demais nem entra no PBKDF2 (custo); conta como erro.
    const certa = senhaBruta.length <= MAX_SENHA && (await deps.verifySenha(senhaBruta, tk.senhaHash));
    if (!certa) {
      const travado = await repo.registrarFalha(tk.id);
      const dentro = await deps.limite("portal-senha-errada", `ip:${ip}|l:${tk.id}`, 5, 900);
      if (travado || !dentro) return limiteExcedido(900);
      return erro("Senha incorreta.", 401);
    }

    if (acao === "verificar") return resp({ ok: true });
    if (acao === "solicitar") return solicitar(cli, body, ip, tk.id);
    return dashboard(tk, cli, ip);
  }

  async function dashboard(tk: TokenRow, cli: ClienteRow, ip: string): Promise<Response> {
    await repo.registrarAcesso(tk.id);
    // "Cliente acessou" na auditoria: no máximo uma vez por hora por link.
    if (await deps.limite("portal-acesso-auditoria", tk.id, 1, 3600)) {
      await auditarSemFalhar({
        acao: "cliente_acessou",
        clienteId: cli.id,
        resumo: "acessou o portal do cliente",
        info: [{ rotulo: "IP", valor: ip }],
      });
    }
    const hoje = hojeSaoPaulo(agora());
    const [esc, chamados, tipos, certs] = await Promise.all([
      repo.escritorio(),
      repo.chamados(cli.id),
      repo.tiposAtivos(),
      repo.certificados(cli.id),
    ]);
    const situacao = cli.portalMostrarSituacaoFiscal ? situacaoFiscalPublica(await repo.ultimaSituacaoFiscal(cli.id)) : null;
    return resp({
      escritorio: { nome: esc.nome, whatsapp: whatsappPublico(esc.whatsapp) },
      cliente: cadastroPublico(cli),
      chamados: chamados.slice(0, 30).map(chamadoPublico),
      tipos: tipos.slice(0, 50).map((t) => ({ id: t.id, nome: t.nome })),
      certificados: certs.slice(0, 20).map((c) => certPublico(c, hoje)).sort((a, b) => a.diasRestantes - b.diasRestantes),
      situacaoFiscal: situacao,
      linkExpiraEm: tk.expiresAt,
    });
  }

  async function solicitar(cli: ClienteRow, body: Record<string, unknown>, ip: string, tokenId: string): Promise<Response> {
    const tipoId = typeof body.tipoId === "string" ? body.tipoId : "";
    if (!ID_RE.test(tipoId)) return erro("Escolha o tipo de solicitação.");
    const tipos = await repo.tiposAtivos();
    if (!tipos.some((t) => t.id === tipoId)) return erro("Escolha o tipo de solicitação.");
    const descricao = limparTexto(body.descricao, MAX_DESC);
    if (descricao.length < 5) return erro("Conte em poucas palavras o que você precisa.");

    // O freio só conta pedido VÁLIDO: erro de digitação não gasta a cota.
    if (!(await deps.limite("portal-solicitar", `l:${tokenId}`, 5, 3600))) return limiteExcedido(3600);
    if (!(await deps.limite("portal-solicitar-ip", `ip:${ip}`, 10, 3600))) return limiteExcedido(3600);
    if ((await repo.chamadosPortalAbertos(cli.id)) >= MAX_CHAMADOS_PORTAL_ABERTOS) {
      return erro("Você já tem muitas solicitações em aberto. Fale com a equipe pelo WhatsApp.", 429);
    }
    const c = await repo.criarChamado({ tipoId, clienteId: cli.id, descricao });
    if (!c) return erro("Não foi possível enviar agora. Tente de novo.", 500);
    const nomeTipo = tipos.find((t) => t.id === tipoId)?.nome ?? "Solicitação";
    await auditarSemFalhar({
      acao: "chamado_aberto",
      clienteId: cli.id,
      solicitacaoId: c.id,
      resumo: `abriu um chamado pelo portal: «${nomeTipo}»`,
      info: [
        { rotulo: "Origem", valor: "Portal do cliente" },
        { rotulo: "Tipo", valor: nomeTipo },
        { rotulo: "Descrição", valor: descricao.slice(0, 500) },
      ],
    });
    return resp({ ok: true });
  }

  return function handler(req: Request): Promise<Response> | Response {
    if (req.method === "OPTIONS") return handleCors(req);
    const sub = new URL(req.url).pathname.split("/").filter(Boolean).slice(1);
    if (sub[0] === "cliente") return escritorio(req, sub[1] ?? "", sub[2] ?? "");
    if (!sub[0] || sub.length > 2) return indisponivel();
    return publico(req, sub[0], sub[1] ?? "");
  };
}
