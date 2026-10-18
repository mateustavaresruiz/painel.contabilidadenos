import { supabase, SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase";

/** Base das Edge Functions: `<SUPABASE_URL>/functions/v1`. */
const BASE = `${SUPABASE_URL}/functions/v1`;

type FetchOptions = Omit<RequestInit, "body"> & { body?: unknown };

/**
 * O erro de uma chamada, com o STATUS junto. A mensagem sozinha não distingue
 * "deu ruim" de "falta configurar" (ou "a rota ainda não existe"), e são
 * respostas diferentes na tela.
 */
export class ErroDaApi extends Error {
  readonly status: number;
  /** Corpo JSON do erro (ex.: 424 do envio traz `{error, id}`; 409 traz `motivo`). */
  readonly dados: Record<string, unknown> | null;
  constructor(message: string, status: number, dados: Record<string, unknown> | null = null) {
    super(message);
    this.name = "ErroDaApi";
    this.status = status;
    this.dados = dados;
  }
}

/**
 * Headers de toda chamada às Edge Functions: `Authorization` leva o JWT da
 * sessão (a function descobre por ele quem é o colaborador e o cargo) e
 * `apikey` a chave pública do projeto. `getSession()` já renova o token
 * vencido antes de devolver.
 */
export async function apiHeaders(extras?: HeadersInit): Promise<Headers> {
  const headers = new Headers(extras);
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ErroDaApi("Sua sessão terminou. Entre de novo.", 401);
  headers.set("apikey", SUPABASE_ANON_KEY);
  headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

/**
 * fetch das Edge Functions. `path` é o nome da função + sub-caminho:
 *   api("/whatsapp/messages/send-text", { method: "POST", body: {...} })
 * O corpo é serializado AQUI — não passe `JSON.stringify(...)` (defeito 29 do adv3).
 */
export async function api<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const headers = await apiHeaders(opts.headers);
  headers.set("Content-Type", "application/json");

  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  let res: Response;
  try {
    res = await fetch(`${BASE}${cleanPath}`, {
      ...opts,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ErroDaApi("Sem conexão com o servidor. Tente de novo.", 0);
  }

  if (!res.ok) {
    const text = await res.text();
    let msg = text || `${res.status} ${res.statusText}`;
    let dados: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") dados = parsed as Record<string, unknown>;
      if (parsed?.error) msg = parsed.error;
      else if (parsed?.erro) msg = parsed.erro;
      else if (parsed?.message) msg = parsed.message;
    } catch {
      // resposta não-JSON — mantém o texto cru
    }
    // Mensagens amigáveis para os códigos que o backend do painel usa.
    if (res.status === 429) msg = "Muitas ações seguidas. Espere alguns segundos e tente de novo.";
    // Sessão revogada (desativação, logout em outro lugar): volta ao login.
    if (res.status === 401) void supabase.auth.signOut({ scope: "local" });
    throw new ErroDaApi(msg, res.status, dados);
  }

  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  return (ct.includes("application/json") ? await res.json() : await res.text()) as T;
}

/** URL completa de uma Edge Function (download de blob etc.). */
export function apiUrl(path: string): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${BASE}${cleanPath}`;
}
