// Senha de acesso ao painel (docs/LOGIN.md > Senha).
//
// Quem guarda e confere a senha é o Auth (GoTrue): o painel só pede
// signInWithPassword / updateUser. As regras de verdade estão no servidor
// (GOTRUE_PASSWORD_MIN_LENGTH=10, HIBP, senha atual exigida para trocar);
// aqui ficam as mesmas regras para avisar antes, o medidor de força e as
// mensagens em português.

/** O que daqui se usa da Session do supabase-js (sem importar o pacote: roda no deno test). */
type ComToken = { access_token: string };

/** Igual a GOTRUE_PASSWORD_MIN_LENGTH (infra/supabase/docker-compose.yml). */
export const SENHA_MIN = 10;
/** Limite do bcrypt no Auth (bytes, não letras: "ç" e acento contam 2). */
export const SENHA_MAX_BYTES = 72;

// ---------------------------------------------------------------------------
// Sessão: veio de link/código do e-mail ou de senha?
// ---------------------------------------------------------------------------

/** Métodos de entrada desta sessão (claim "amr" do JWT: otp, password, oauth...). */
export function metodosDaSessao(sessao: ComToken | null | undefined): string[] {
  const parte = sessao?.access_token.split(".")[1];
  if (!parte) return [];
  try {
    const b64 = parte.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="))) as { amr?: unknown };
    if (!Array.isArray(json.amr)) return [];
    return json.amr.map((a) => String((a as { method?: unknown })?.method ?? ""));
  } catch {
    return [];
  }
}

/**
 * Sessão aberta por link de acesso, código do e-mail ou "só com o e-mail"
 * (todos viram "otp" no Auth). Nela o GoTrue deixa criar a senha sem pedir a
 * atual (GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD isenta esse
 * caso): é o caminho do primeiro acesso e de quem esqueceu a senha.
 */
export function sessaoPorLink(sessao: ComToken | null | undefined): boolean {
  return metodosDaSessao(sessao).some((m) => m === "otp" || m === "magiclink" || m === "recovery");
}

// ---------------------------------------------------------------------------
// "Já criou a senha neste navegador" (enquanto a lista da equipe não atualiza)
// ---------------------------------------------------------------------------

const definidasAgora = new Set<string>();
const CHAVE_LOCAL = "painel:senha-definida";

/**
 * Marca que a pessoa acabou de criar a senha. O AuthGate usa para não mandá-la
 * de novo para "Crie sua senha" se o banco ainda não mostrar a data (gatilho
 * da migration 027 ausente ou atrasado): nunca um laço.
 */
export function marcarSenhaDefinida(userId: string) {
  definidasAgora.add(userId);
  try {
    sessionStorage.setItem(CHAVE_LOCAL, userId);
  } catch {
    /* navegador sem storage: fica só na memória */
  }
}

export function senhaDefinidaAgora(userId: string): boolean {
  if (definidasAgora.has(userId)) return true;
  try {
    return sessionStorage.getItem(CHAVE_LOCAL) === userId;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Regras e força
// ---------------------------------------------------------------------------

const bytes = (s: string) => new TextEncoder().encode(s).length;

/** Pedaços óbvios: quem souber o nome ou o e-mail da pessoa tentaria primeiro. */
const OBVIOS = ["senha", "password", "123456", "654321", "qwerty", "abcdef", "contabil", "denos", "painel", "nos2026"];

function pedacosPessoais(contexto: (string | null | undefined)[]): string[] {
  const saida = new Set<string>();
  for (const c of contexto) {
    if (!c) continue;
    const base = c.toLowerCase().split("@")[0];
    for (const p of base.split(/[^a-z0-9à-ú]+/i)) if (p.length >= 4) saida.add(p);
  }
  return [...saida];
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export type AvaliacaoSenha = {
  /** 0 = não serve; 1 fraca; 2 razoável; 3 boa; 4 forte. */
  nivel: 0 | 1 | 2 | 3 | 4;
  rotulo: string;
  /** Por que não serve (bloqueia o envio). */
  erro: string | null;
  /** Como melhorar (não bloqueia). */
  dica: string | null;
};

/**
 * Força aproximada, sem biblioteca: comprimento manda, variedade ajuda, e
 * nome/e-mail/sequência óbvia derrubam. O Auth confere ainda se a senha
 * aparece em vazamentos conhecidos (HIBP).
 */
export function avaliarSenha(senha: string, contexto: (string | null | undefined)[] = []): AvaliacaoSenha {
  if (!senha) return { nivel: 0, rotulo: "", erro: null, dica: null };
  if (senha.length < SENHA_MIN) {
    return {
      nivel: 0,
      rotulo: "Curta",
      erro: `Use pelo menos ${SENHA_MIN} caracteres (faltam ${SENHA_MIN - senha.length}).`,
      dica: null,
    };
  }
  if (bytes(senha) > SENHA_MAX_BYTES) {
    return { nivel: 0, rotulo: "Longa demais", erro: "Senha longa demais. Use até 70 letras, mais ou menos.", dica: null };
  }
  if (/^(.)\1+$/.test(senha)) {
    return { nivel: 0, rotulo: "Fraca", erro: "Não use o mesmo caractere repetido.", dica: null };
  }
  const plano = semAcento(senha);
  const pessoal = pedacosPessoais(contexto).map(semAcento).find((p) => plano.includes(p));
  if (pessoal) {
    return { nivel: 0, rotulo: "Fraca", erro: "Não use seu nome nem seu e-mail na senha.", dica: null };
  }

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9\s]/, /\s/].filter((r) => r.test(senha)).length;
  let pontos = senha.length >= 18 ? 3 : senha.length >= 14 ? 2 : 1;
  if (classes >= 3) pontos += 1;
  const obvio = OBVIOS.some((o) => plano.includes(o)) || /^\d+$/.test(senha) || /(.)\1{3,}/.test(senha);
  if (obvio) pontos = Math.min(pontos, 1);
  const nivel = Math.max(1, Math.min(4, pontos)) as 1 | 2 | 3 | 4;

  const rotulo = ["", "Fraca", "Razoável", "Boa", "Forte"][nivel];
  const dica = obvio
    ? "Evite sequências e palavras óbvias (senha, 123456, o nome do escritório)."
    : nivel <= 2
      ? "Dica: uma frase com 3 ou 4 palavras é fácil de lembrar e difícil de adivinhar."
      : null;
  return { nivel, rotulo, erro: null, dica };
}

// ---------------------------------------------------------------------------
// Erros do Auth → português
// ---------------------------------------------------------------------------

type ErroAuth = { status?: number; code?: string; message?: string; name?: string; reasons?: string[] } | null | undefined;

const ehLimite = (e: NonNullable<ErroAuth>) =>
  e.status === 429 || e.code === "over_request_rate_limit" || /rate limit|too many/i.test(e.message ?? "");

const semConexao = (e: NonNullable<ErroAuth>) =>
  e.status === 0 || e.name === "AuthRetryableFetchError" || /failed to fetch|network/i.test(e.message ?? "");

/** signInWithPassword. Senha errada e e-mail inexistente dão a MESMA mensagem. */
export function erroDoLogin(e: NonNullable<ErroAuth>): string {
  if (ehLimite(e)) return "Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.";
  if (semConexao(e)) return "Sem conexão com o servidor. Confira a internet e tente de novo.";
  if (e.code === "user_banned" || /banned/i.test(e.message ?? "")) {
    return "Seu acesso ao painel está desativado. Fale com um administrador.";
  }
  if (e.code === "invalid_credentials" || e.code === "email_not_confirmed" || e.status === 400) {
    return "E-mail ou senha incorretos.";
  }
  return "Não deu para entrar agora. Tente de novo em instantes.";
}

/** updateUser({ password }). */
export function erroDaSenhaNova(e: NonNullable<ErroAuth>): string {
  if (ehLimite(e)) return "Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.";
  if (semConexao(e)) return "Sem conexão com o servidor. Confira a internet e tente de novo.";
  // GoTrue v2.196 responde "current_password_invalid"; versões novas usam "_mismatch".
  if (e.code === "current_password_invalid" || e.code === "current_password_mismatch") return "A senha atual não confere.";
  if (e.code === "current_password_required") return "Digite a sua senha atual.";
  if (e.code === "same_password") return "A senha nova precisa ser diferente da atual.";
  if (e.code === "weak_password") {
    if (e.reasons?.includes("pwned") || /weak and easy to guess/i.test(e.message ?? "")) {
      return "Essa senha aparece em vazamentos conhecidos na internet. Escolha outra.";
    }
    if (e.reasons?.includes("length")) return `Use pelo menos ${SENHA_MIN} caracteres.`;
    return "Senha fraca demais. Escolha outra.";
  }
  if (e.code === "session_not_found" || e.status === 401 || e.status === 403) {
    return "Sua sessão expirou. Entre de novo (peça um link de acesso a um administrador se precisar).";
  }
  if (e.code === "reauthentication_needed") {
    return "Por segurança, entre de novo pelo link de acesso e crie a senha logo em seguida.";
  }
  return "Não deu para salvar a senha agora. Tente de novo.";
}
