// Cliente da API Integra Contador do Serpro.
// Documentação: https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/
//
// ===========================================================================
// AUTENTICAÇÃO (conferida na doc "Como autenticar na API", out/2026)
// ===========================================================================
//   POST https://autenticacao.sapi.serpro.gov.br/authenticate
//     Authorization: Basic base64(consumerKey:consumerSecret)
//     role-type: TERCEIROS
//     content-type: application/x-www-form-urlencoded
//     body: grant_type=client_credentials
//   com mTLS: o certificado e-CNPJ A1 (ICP-Brasil) do CONTRATANTE.
//   → { access_token, jwt_token, expires_in, token_type: "Bearer" }
//
//   Chamadas: POST https://gateway.apiserpro.serpro.gov.br/integra-contador/v1/{Consultar|Emitir|Apoiar|Declarar|Monitorar}
//     Authorization: Bearer <access_token>
//     jwt_token: <jwt_token>
//   O gateway devolve 401 quando o token expira: pedimos outro e repetimos.
//
// ===========================================================================
// ENV (env do serviço supabase no Easypanel, repassadas pelo compose)
// ===========================================================================
//   SERPRO_CONSUMER_KEY / SERPRO_CONSUMER_SECRET  da Área do Cliente Serpro
//   SERPRO_CONTRATANTE_CNPJ  CNPJ do escritório (quem contratou)
//   SERPRO_AUTOR_CNPJ        autor do pedido; vazio = o contratante
//   Certificado, UM dos dois caminhos:
//   1) SERPRO_CERT_PEM + SERPRO_KEY_PEM  (preferido). O PEM pode ir cru ou
//      em base64 (env de uma linha só). Para gerar a partir do .pfx:
//        openssl pkcs12 -in certificado.pfx -clcerts -nokeys -out cert.pem
//        openssl pkcs12 -in certificado.pfx -nocerts -nodes -out key.pem
//        # (OpenSSL 3 com PFX antigo: acrescente -legacy)
//        base64 -w0 cert.pem   # → SERPRO_CERT_PEM
//        base64 -w0 key.pem    # → SERPRO_KEY_PEM
//   2) SERPRO_CERT_PFX_BASE64 + SERPRO_CERT_SENHA: o .pfx em base64, aberto
//      aqui com node-forge (carregado só quando este caminho é usado).
//
// 🔴 NUNCA logar token, jwt, senha, nem conteúdo de certificado/chave. Os
// erros que saem daqui levam só status e mensagem do Serpro.

const AUTH_URL = "https://autenticacao.sapi.serpro.gov.br/authenticate";
const API_BASE = "https://gateway.apiserpro.serpro.gov.br/integra-contador/v1";

const env = (k: string) => (Deno.env.get(k) ?? "").trim();

export type TipoChamada = "Consultar" | "Emitir" | "Apoiar" | "Declarar" | "Monitorar";

export type StatusSerpro = {
  configurado: boolean;
  faltando: string[];
  certificado: "pem" | "pfx" | null;
  mtlsSuportado: boolean;
};

export class SerproNaoConfigurado extends Error {
  constructor(public readonly faltando: string[]) {
    super(
      "Integração com o Serpro não configurada. Falta definir no servidor: " +
        faltando.join(", ") + ".",
    );
    this.name = "SerproNaoConfigurado";
  }
}

export class SerproErro extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly mensagens: Array<{ codigo?: string; texto?: string }> = [],
  ) {
    super(message);
    this.name = "SerproErro";
  }
}

export function statusSerpro(): StatusSerpro {
  const faltando: string[] = [];
  if (!env("SERPRO_CONSUMER_KEY")) faltando.push("SERPRO_CONSUMER_KEY");
  if (!env("SERPRO_CONSUMER_SECRET")) faltando.push("SERPRO_CONSUMER_SECRET");
  if (!env("SERPRO_CONTRATANTE_CNPJ")) faltando.push("SERPRO_CONTRATANTE_CNPJ");
  const temPem = !!env("SERPRO_CERT_PEM") && !!env("SERPRO_KEY_PEM");
  const temPfx = !!env("SERPRO_CERT_PFX_BASE64") && !!env("SERPRO_CERT_SENHA");
  if (!temPem && !temPfx) {
    faltando.push("SERPRO_CERT_PEM + SERPRO_KEY_PEM (ou SERPRO_CERT_PFX_BASE64 + SERPRO_CERT_SENHA)");
  }
  // deno-lint-ignore no-explicit-any
  const mtlsSuportado = typeof (Deno as any).createHttpClient === "function";
  return {
    configurado: faltando.length === 0 && mtlsSuportado,
    faltando,
    certificado: temPem ? "pem" : temPfx ? "pfx" : null,
    mtlsSuportado,
  };
}

export function contratanteCnpj(): string {
  return env("SERPRO_CONTRATANTE_CNPJ").replace(/\D/g, "");
}

export function autorCnpj(): string {
  return (env("SERPRO_AUTOR_CNPJ") || env("SERPRO_CONTRATANTE_CNPJ")).replace(/\D/g, "");
}

/** PEM cru ou em base64 (env de uma linha). */
function lerPem(raw: string): string {
  if (raw.includes("-----BEGIN")) return raw.replace(/\\n/g, "\n");
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)));
  } catch {
    return raw;
  }
}

/** Converte o .pfx (base64) em PEM de certificado (com a cadeia) e chave. */
async function pemDoPfx(pfxB64: string, senha: string): Promise<{ cert: string; key: string }> {
  // Import dinâmico: o node-forge só é baixado/carregado se este caminho for
  // usado, e o boot da function não depende dele.
  const forgeMod = await import("node-forge");
  // deno-lint-ignore no-explicit-any
  const forge: any = (forgeMod as any).default ?? forgeMod;
  const der = forge.util.decode64(pfxB64.replace(/\s+/g, ""));
  const asn1 = forge.asn1.fromDer(der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha);
  const keyBags = {
    ...p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag }),
  }[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];
  const keyBags2 = p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? [];
  const keyBag = keyBags[0] ?? keyBags2[0];
  if (!keyBag?.key) throw new Error("O .pfx não tem chave privada (ou a senha está errada).");
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  if (!certBags.length) throw new Error("O .pfx não tem certificado.");
  // O certificado do titular primeiro (o que casa com a chave), depois a cadeia.
  const pubDaChave = forge.pki.setRsaPublicKey(keyBag.key.n, keyBag.key.e);
  const ehDoTitular = (c: { cert: { publicKey: { n: { equals: (x: unknown) => boolean } } } }) =>
    c.cert?.publicKey?.n?.equals?.(pubDaChave.n);
  // deno-lint-ignore no-explicit-any
  const ordenados = [...certBags].sort((a: any, b: any) => Number(ehDoTitular(b)) - Number(ehDoTitular(a)));
  // deno-lint-ignore no-explicit-any
  const cert = ordenados.map((b: any) => forge.pki.certificateToPem(b.cert)).join("\n");
  const key = forge.pki.privateKeyToPem(keyBag.key);
  return { cert, key };
}

// deno-lint-ignore no-explicit-any
let clienteMtls: any = null;

// deno-lint-ignore no-explicit-any
async function httpClient(): Promise<any> {
  if (clienteMtls) return clienteMtls;
  const st = statusSerpro();
  if (!st.mtlsSuportado) {
    throw new SerproErro("Este runtime não suporta mTLS (Deno.createHttpClient ausente).", 503);
  }
  let cert: string;
  let key: string;
  if (st.certificado === "pem") {
    cert = lerPem(env("SERPRO_CERT_PEM"));
    key = lerPem(env("SERPRO_KEY_PEM"));
  } else if (st.certificado === "pfx") {
    ({ cert, key } = await pemDoPfx(env("SERPRO_CERT_PFX_BASE64"), env("SERPRO_CERT_SENHA")));
  } else {
    throw new SerproNaoConfigurado(st.faltando);
  }
  // `cert`/`key` são os nomes do Deno 2; `certChain`/`privateKey` os do 1.x.
  // deno-lint-ignore no-explicit-any
  clienteMtls = (Deno as any).createHttpClient({ cert, key, certChain: cert, privateKey: key });
  return clienteMtls;
}

type Tokens = { accessToken: string; jwtToken: string; expiraEm: number };
let tokensCache: Tokens | null = null;

async function obterTokens(forcar = false): Promise<Tokens> {
  if (!forcar && tokensCache && tokensCache.expiraEm > Date.now() + 60_000) return tokensCache;
  const st = statusSerpro();
  if (st.faltando.length) throw new SerproNaoConfigurado(st.faltando);
  const client = await httpClient();
  const basic = btoa(`${env("SERPRO_CONSUMER_KEY")}:${env("SERPRO_CONSUMER_SECRET")}`);
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(AUTH_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "role-type": "TERCEIROS",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      client,
      signal: ctrl.signal,
    } as RequestInit);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SerproErro(
      (err as Error)?.name === "AbortError"
        ? "Autenticação no Serpro não respondeu em 30s."
        : `Falha de conexão na autenticação do Serpro (certificado/mTLS?): ${msg.slice(0, 200)}`,
      502,
    );
  } finally {
    clearTimeout(tid);
  }
  const texto = await res.text();
  if (!res.ok) {
    throw new SerproErro(
      `Serpro recusou a autenticação (HTTP ${res.status}). Confira consumer key/secret e o certificado do contratante.`,
      res.status === 401 || res.status === 403 ? 502 : 502,
    );
  }
  let corpo: { access_token?: string; jwt_token?: string; expires_in?: number };
  try {
    corpo = JSON.parse(texto);
  } catch {
    throw new SerproErro("Resposta de autenticação do Serpro inválida.", 502);
  }
  if (!corpo.access_token || !corpo.jwt_token) {
    throw new SerproErro("Autenticação do Serpro sem access_token/jwt_token.", 502);
  }
  tokensCache = {
    accessToken: corpo.access_token,
    jwtToken: corpo.jwt_token,
    expiraEm: Date.now() + Math.max(60, Number(corpo.expires_in ?? 1800)) * 1000,
  };
  return tokensCache;
}

/** Testa só a autenticação (sem gastar consulta). */
export async function testarAutenticacao(): Promise<void> {
  await obterTokens(true);
}

export type Contribuinte = { numero: string; tipo: 1 | 2 };

export function contribuinteDe(cpfCnpj: string | null | undefined): Contribuinte | null {
  const d = (cpfCnpj ?? "").replace(/\D/g, "");
  if (d.length === 11) return { numero: d, tipo: 1 };
  if (d.length === 14) return { numero: d, tipo: 2 };
  return null;
}

export type PedidoDados = {
  idSistema: string;
  idServico: string;
  versaoSistema: string;
  /** String (JSON escapado) ou objeto, que é serializado aqui. */
  dados: string | Record<string, unknown>;
};

export type RespostaSerpro = {
  httpStatus: number;
  /** ETag do gateway: no SITFIS carrega "tempoEspera:<ms>". */
  etag: string | null;
  status: number | null;
  mensagens: Array<{ codigo?: string; texto?: string }>;
  /** `dados` já desescapado (JSON) quando possível; senão a string crua. */
  dados: unknown;
};

/**
 * Chama o gateway (`Consultar`, `Emitir`, `Apoiar`...) com o corpo padrão:
 * { contratante, autorPedidoDados, contribuinte, pedidoDados }.
 */
export async function chamarSerpro(
  tipo: TipoChamada,
  contribuinte: Contribuinte,
  pedido: PedidoDados,
): Promise<RespostaSerpro> {
  const client = await httpClient();
  const corpo = {
    contratante: { numero: contratanteCnpj(), tipo: 2 },
    autorPedidoDados: { numero: autorCnpj(), tipo: 2 },
    contribuinte,
    pedidoDados: {
      idSistema: pedido.idSistema,
      idServico: pedido.idServico,
      versaoSistema: pedido.versaoSistema,
      dados: typeof pedido.dados === "string" ? pedido.dados : JSON.stringify(pedido.dados),
    },
  };

  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const tokens = await obterTokens(tentativa > 0);
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 60_000);
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/${tipo}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          jwt_token: tokens.jwtToken,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(corpo),
        client,
        signal: ctrl.signal,
      } as RequestInit);
    } catch (err) {
      throw new SerproErro(
        (err as Error)?.name === "AbortError"
          ? "O Serpro não respondeu em 60s."
          : `Falha de conexão com o Serpro: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`,
        504,
      );
    } finally {
      clearTimeout(tid);
    }
    // Token vencido: o gateway responde 401. Uma renovação e uma repetição.
    if (res.status === 401 && tentativa === 0) {
      await res.body?.cancel();
      continue;
    }
    const texto = await res.text();
    let json: Record<string, unknown> = {};
    if (texto) {
      try {
        json = JSON.parse(texto);
      } catch {
        json = { mensagens: [{ texto: texto.slice(0, 300) }] };
      }
    }
    let dados: unknown = json.dados ?? null;
    if (typeof dados === "string" && dados.trim()) {
      try {
        dados = JSON.parse(dados);
      } catch { /* fica string */ }
    }
    return {
      httpStatus: res.status,
      etag: res.headers.get("etag"),
      status: typeof json.status === "number" ? json.status : null,
      mensagens: Array.isArray(json.mensagens) ? json.mensagens as RespostaSerpro["mensagens"] : [],
      dados,
    };
  }
  throw new SerproErro("Serpro recusou o token mesmo após renovar.", 502);
}

/** "tempoEspera:4000" (ETag) ou dados.tempoEspera → ms. */
export function tempoEsperaDe(r: RespostaSerpro): number | null {
  const m = r.etag?.match(/tempoEspera:(\d+)/);
  if (m) return Number(m[1]);
  const d = r.dados as { tempoEspera?: unknown } | null;
  if (d && typeof d === "object" && Number(d.tempoEspera) > 0) return Number(d.tempoEspera);
  return null;
}

export function mensagensTexto(r: RespostaSerpro): string {
  return r.mensagens
    .map((m) => [m.codigo, m.texto].filter(Boolean).join(" "))
    .filter(Boolean)
    .join(" | ");
}

// ===========================================================================
// Leitura best-effort do texto de um PDF (relatório de situação fiscal)
// ===========================================================================
// O relatório do SITFIS vem em PDF. Para classificar ok x com_pendencia sem
// pedir a ninguém que abra o arquivo, descomprimimos os streams FlateDecode e
// juntamos as strings dos operadores de texto (Tj/TJ). ⚠️ Funciona quando a
// fonte usa codificação simples; com fonte subconjunto/Identity-H o texto sai
// ilegível e o diagnóstico fica "indeterminado" — a tela manda abrir o PDF.

async function inflar(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const ds = new DecompressionStream("deflate");
    const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

export async function textoDoPdf(pdf: Uint8Array): Promise<string> {
  const latin = new TextDecoder("latin1");
  const bruto = latin.decode(pdf);
  const partes: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(bruto)) && n < 400) {
    n++;
    const ini = m.index + m[0].length;
    const fim = bruto.indexOf("endstream", ini);
    if (fim < 0) break;
    const conteudo = await inflar(pdf.subarray(ini, fim));
    const txt = conteudo ? latin.decode(conteudo) : bruto.slice(ini, fim);
    for (const t of txt.matchAll(/\((?:\\.|[^\\)])*\)\s*Tj|\[(?:[^\]]*)\]\s*TJ/g)) {
      const strings = t[0].match(/\((?:\\.|[^\\)])*\)/g) ?? [];
      partes.push(
        strings
          .map((s) =>
            s.slice(1, -1)
              .replace(/\\([nrtbf()\\])/g, (_x, c) => ({ n: "\n", r: "", t: " ", b: "", f: "" }[c as string] ?? c))
              .replace(/\\(\d{3})/g, (_x, o) => String.fromCharCode(parseInt(o, 8)))
          )
          .join(""),
      );
    }
    re.lastIndex = fim;
  }
  return partes.join(" ").replace(/\s+/g, " ");
}

/** Sem acento e minúsculo, pra procurar frases no texto do PDF. */
export function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function base64ParaBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
