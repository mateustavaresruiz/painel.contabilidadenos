// Cliente do GATEWAY Integra Contador (app "integra-contador" no Easypanel,
// código em projeto-bruno-contador). É o mesmo padrão do inboundcont-crm:
//
//   painel ──HTTPS + GATEWAY_API_KEY──► gateway ──mTLS com o A1──► Serpro
//
// 🔴 O PAINEL NÃO FALA COM O SERPRO. Certificado A1, consumer key/secret e
// CNPJ do contratante ficam SÓ no gateway. Aqui moram duas variáveis:
//   GATEWAY_URL      URL pública do gateway (sem barra final)
//   GATEWAY_API_KEY  a chave `Authorization: Bearer` do gateway
// E nunca o PIN de confirmação: ele é digitado por uma pessoa, na tela.
//
// O que o gateway resolve e por isso NÃO se repete aqui: login e cache de
// token, envelope (contratante/autor/contribuinte/pedidoDados), verbo certo
// por serviço, `dados` em texto, leitura de 202/204/304, PDFs achados em
// qualquer ponto da resposta (`pdfs[]`), registro de consumo, pausa geral,
// trava de chamada repetida em 60 s e confirmação por PIN para Emitir/Declarar
// (exceto os serviços em SERVICOS_SEM_CONFIRMACAO — hoje RELATORIOSITFIS92).
//
// Convenção do gateway: se o Serpro respondeu (qualquer status), o gateway
// devolve HTTP 200 e o resultado vem em `ok` + `serpro_http`. HTTP 202 =
// "aguardando confirmação" (PIN). 4xx/5xx são erros DO GATEWAY: chave,
// pausa (503 PAUSADO), duplicado (409 DUPLICADA), limite (429), configuração.
//
// 🔴 Nunca logar a chave. Os erros que saem daqui levam só código e mensagem.

const env = (k: string) => (Deno.env.get(k) ?? "").trim();
const GATEWAY_URL = env("GATEWAY_URL").replace(/\/+$/, "");
const GATEWAY_API_KEY = env("GATEWAY_API_KEY");

export function gatewayConfigurado(): { ok: boolean; faltando: string[] } {
  const faltando: string[] = [];
  if (!GATEWAY_URL) faltando.push("GATEWAY_URL (endereço do gateway Integra Contador)");
  if (!GATEWAY_API_KEY) faltando.push("GATEWAY_API_KEY (chave do gateway Integra Contador)");
  return { ok: faltando.length === 0, faltando };
}

export type MensagemSerpro = { codigo?: string; texto?: string };

/** O que o gateway devolve quando o Serpro respondeu (`executar` em src/app.js). */
export type ResultadoGateway = {
  ok: boolean;
  serpro_http: number;
  processando: boolean;
  tempo_espera: number | null;
  protocolo: string | null;
  mensagens: MensagemSerpro[];
  dados: unknown;
  pdfs: Array<{ campo: string; base64: string }>;
  chamada_id?: string;
  verbo?: string;
  cobrado?: boolean;
  custo_estimado?: number;
};

/** Confirmação pendente (Emitir/Declarar e serviço desconhecido). */
export type ConfirmacaoGateway = {
  id: string;
  status: "pendente" | "executada" | "falhou" | "cancelada" | "expirada" | string;
  resumo: string;
  custo_estimado?: number;
  expira_em?: string;
  resultado?: ResultadoGateway & { erro?: string; codigo?: string };
};

export type RespostaGateway = {
  http: number;
  corpo: Record<string, unknown> & {
    ok?: boolean;
    erro?: string;
    mensagem?: string;
    confirmacao?: ConfirmacaoGateway;
  };
};

export class GatewayErro extends Error {
  constructor(message: string, public readonly http: number, public readonly codigo: string | null = null) {
    super(message);
    this.name = "GatewayErro";
  }
}

/**
 * Chama uma rota do gateway. Não lança em 4xx/5xx do gateway (quem chama lê
 * `http` e `corpo.erro`); lança só quando não houve resposta (rede/timeout).
 */
export async function gateway(
  caminho: string,
  opts: { method?: "GET" | "POST"; body?: unknown; operador: string; timeoutMs?: number },
): Promise<RespostaGateway> {
  const cfg = gatewayConfigurado();
  if (!cfg.ok) throw new GatewayErro(`Gateway Integra Contador não configurado: ${cfg.faltando.join(", ")}.`, 503, "NAO_CONFIGURADO");
  const ctrl = new AbortController();
  // O gateway espera até 120 s numa transmissão; o runtime corta em 150 s.
  const tid = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 130_000);
  let res: Response;
  try {
    res = await fetch(`${GATEWAY_URL}${caminho}`, {
      method: opts.method ?? "POST",
      headers: {
        Authorization: `Bearer ${GATEWAY_API_KEY}`,
        "Content-Type": "application/json",
        // Quem pediu: aparece no registro de consumo do gateway e é o eixo
        // do limite por operador de lá.
        "X-Operador": opts.operador.slice(0, 120),
      },
      body: opts.method === "GET" ? undefined : JSON.stringify(opts.body ?? {}),
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new GatewayErro(
      (err as Error)?.name === "AbortError"
        ? "O gateway Integra Contador não respondeu a tempo."
        : "Falha de conexão com o gateway Integra Contador.",
      504,
      "SEM_RESPOSTA",
    );
  } finally {
    clearTimeout(tid);
  }
  const corpo = await res.json().catch(() => ({ ok: false, mensagem: `Gateway respondeu HTTP ${res.status}` }));
  return { http: res.status, corpo };
}

/** Texto das mensagens do Serpro (ou a do gateway). */
export function mensagensTexto(r: { mensagens?: MensagemSerpro[]; mensagem?: unknown } | null | undefined): string {
  const ms = (r?.mensagens ?? [])
    .map((m) => [m.codigo, m.texto].filter(Boolean).join(" "))
    .filter(Boolean)
    .join(" | ");
  return ms || (typeof r?.mensagem === "string" ? r.mensagem : "");
}

/** Monta o corpo de `POST /v1/chamadas`. Só estes campos seguem pro gateway. */
export function pedidoChamada(p: {
  contribuinte: string;
  idSistema: string;
  idServico: string;
  versaoSistema?: string;
  dados?: unknown;
  verbo?: string;
  /** Repetição INTENCIONAL dentro de 60 s (ex.: buscar de novo o relatório SITFIS depois do tempo de espera). */
  repetir?: boolean;
}): Record<string, unknown> {
  return {
    contribuinte: p.contribuinte,
    idSistema: p.idSistema,
    idServico: p.idServico,
    ...(p.versaoSistema ? { versaoSistema: p.versaoSistema } : {}),
    ...(p.dados !== undefined ? { dados: p.dados } : {}),
    ...(p.verbo ? { verbo: p.verbo } : {}),
    ...(p.repetir ? { repetir: true } : {}),
  };
}

export function contribuinteDe(cpfCnpj: string | null | undefined): string | null {
  const d = (cpfCnpj ?? "").replace(/\D/g, "");
  return d.length === 11 || d.length === 14 ? d : null;
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
