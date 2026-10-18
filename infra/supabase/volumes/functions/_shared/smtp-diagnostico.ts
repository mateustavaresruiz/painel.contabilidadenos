// Diagnóstico do SMTP do login (Configurações > Integrações > E-mail).
//
// Quem manda o e-mail é o Auth (GoTrue), com o env SMTP_* do serviço supabase.
// A function só confere se o servidor responde e se a configuração faz sentido;
// ela NÃO recebe a senha (só sabe se está preenchida, via SMTP_PASS_DEFINIDA).
//
// Sonda: abre a porta, lê a saudação (220), manda EHLO e vê se o servidor
// oferece STARTTLS (porta 587) ou se o TLS direto abre (porta 465). Não
// autentica nem manda nada: o "Enviar e-mail de teste" é que prova o envio.

export type Provedor = "google" | "google-relay" | "stalwart" | "outro";

export type Sonda = {
  /** A conexão TCP (ou TLS, na 465) abriu. */
  portaAbre: boolean;
  /** Primeira linha da saudação, ex.: "220 smtp.gmail.com ESMTP ...". */
  saudacao: string | null;
  /** 587/25: o servidor oferece STARTTLS. 465: o TLS direto abriu. */
  tls: boolean | null;
  /** O servidor anuncia AUTH (login com usuário e senha). */
  auth: boolean | null;
  erro: string | null;
};

export function provedorSmtp(host: string): Provedor | null {
  const h = host.trim().toLowerCase();
  if (!h) return null;
  if (h === "smtp.gmail.com" || h === "smtp.googlemail.com") return "google";
  if (h === "smtp-relay.gmail.com") return "google-relay";
  if (h === "painel_email" || h.startsWith("mail.contabilidadenos") || h.includes("stalwart")) return "stalwart";
  return "outro";
}

export type ConfigSmtp = {
  host: string;
  porta: number;
  usuario: string;
  remetente: string;
  /** null = a function não sabe (env antigo sem SMTP_PASS_DEFINIDA). */
  senhaDefinida: boolean | null;
};

/** Avisos de configuração (frases curtas para a tela). Vazio = nada a corrigir. */
export function avisosSmtp(c: ConfigSmtp): string[] {
  const p = provedorSmtp(c.host);
  if (!p) return [];
  const avisos: string[] = [];
  const usuario = c.usuario.trim().toLowerCase();
  const remetente = c.remetente.trim().toLowerCase();
  if (![25, 465, 587, 2525].includes(c.porta)) {
    avisos.push(`Porta ${c.porta} incomum para SMTP: use 587 (STARTTLS).`);
  }
  if (!remetente) avisos.push("SMTP_ADMIN_EMAIL (remetente) está vazio.");
  if (p === "google") {
    if (!usuario) avisos.push("smtp.gmail.com exige SMTP_USER (a conta do Google Workspace que envia).");
    if (c.senhaDefinida === false) {
      avisos.push("SMTP_PASS vazio: gere uma senha de app na conta (precisa da verificação em 2 etapas).");
    }
    if (c.porta === 25) avisos.push("No smtp.gmail.com use a porta 587 (ou 465), não a 25.");
    if (usuario && remetente && usuario !== remetente) {
      avisos.push(
        "Remetente diferente do usuário: o Gmail troca o remetente pela conta que autenticou, a menos que ele seja um alias configurado nela. Use o mesmo endereço.",
      );
    }
  }
  if (p === "google-relay") {
    if (!usuario) {
      avisos.push(
        "Relay sem usuário: só funciona se o IP 187.127.26.230 estiver liberado no Admin Console (Gmail > Encaminhamento SMTP).",
      );
    }
    if (remetente && !remetente.endsWith("@contabilidadenos.com.br")) {
      avisos.push("O relay do Google só aceita remetente de um domínio do Workspace (contabilidadenos.com.br).");
    }
  }
  if (usuario && c.senhaDefinida === false && p !== "google") avisos.push("SMTP_USER preenchido mas SMTP_PASS vazio.");
  return avisos;
}

/** Lê uma resposta SMTP inteira (várias linhas "250-..." até a "250 ..."). */
export async function lerResposta(
  conn: { read(p: Uint8Array): Promise<number | null> },
  timeoutMs: number,
): Promise<string[]> {
  const dec = new TextDecoder();
  const buf = new Uint8Array(4096);
  let acumulado = "";
  const fim = Date.now() + timeoutMs;
  while (true) {
    const resta = fim - Date.now();
    if (resta <= 0) throw new Error("tempo esgotado esperando o servidor");
    let timer: number | undefined;
    const n = await Promise.race([
      conn.read(buf),
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error("tempo esgotado esperando o servidor")), resta);
      }),
    ]).finally(() => clearTimeout(timer));
    if (n === null) throw new Error("o servidor fechou a conexão");
    acumulado += dec.decode(buf.subarray(0, n));
    const linhas = acumulado.split(/\r?\n/).filter((l) => l.length > 0);
    const ultima = linhas.at(-1) ?? "";
    // Resposta completa: termina em quebra de linha e a última linha é "NNN texto".
    if (/\r?\n$/.test(acumulado) && /^\d{3}(\s|$)/.test(ultima)) return linhas;
    if (acumulado.length > 64_000) throw new Error("resposta grande demais");
  }
}

/** O EHLO anuncia a extensão? (linhas "250-STARTTLS", "250 AUTH LOGIN PLAIN"...) */
export function temExtensao(linhas: string[], ext: string): boolean {
  const alvo = ext.toUpperCase();
  return linhas.some((l) => {
    const corpo = l.slice(4).trim().toUpperCase();
    return corpo === alvo || corpo.startsWith(alvo + " ") || corpo.startsWith(alvo + "=");
  });
}

type Conexao = Deno.Conn | Deno.TlsConn;

async function comPrazo<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error("tempo esgotado")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Abre, lê a saudação, EHLO, confere STARTTLS/TLS e AUTH, e sai (QUIT). */
export async function sondarSmtp(host: string, porta: number, timeoutMs = 5000): Promise<Sonda> {
  const r: Sonda = { portaAbre: false, saudacao: null, tls: null, auth: null, erro: null };
  let conn: Conexao | null = null;
  const enc = new TextEncoder();
  try {
    conn = porta === 465
      ? await comPrazo(Deno.connectTls({ hostname: host, port: porta }), timeoutMs)
      : await comPrazo(Deno.connect({ hostname: host, port: porta }), timeoutMs);
    r.portaAbre = true;
    if (porta === 465) r.tls = true;
    const saudacao = await lerResposta(conn, timeoutMs);
    r.saudacao = (saudacao[0] ?? "").slice(0, 160) || null;
    if (!saudacao[0]?.startsWith("220")) {
      r.erro = "O servidor não mandou a saudação 220.";
      return r;
    }
    await conn.write(enc.encode("EHLO painel-supabase.at63vf.easypanel.host\r\n"));
    const ehlo = await lerResposta(conn, timeoutMs);
    if (!ehlo.at(-1)?.startsWith("250")) {
      r.erro = `O servidor recusou o EHLO: ${(ehlo.at(-1) ?? "").slice(0, 120)}`;
      return r;
    }
    if (porta !== 465) r.tls = temExtensao(ehlo, "STARTTLS");
    // Muitos servidores (o Gmail inclusive) só anunciam AUTH depois do STARTTLS.
    r.auth = temExtensao(ehlo, "AUTH") ? true : (r.tls && porta !== 465 ? null : false);
    await conn.write(enc.encode("QUIT\r\n")).catch(() => 0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    r.erro = r.portaAbre ? msg : `A porta não abriu (${msg}).`;
  } finally {
    try {
      conn?.close();
    } catch { /* já fechada */ }
  }
  return r;
}
