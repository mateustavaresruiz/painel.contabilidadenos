/**
 * Traduz erros técnicos (Postgres / PostgREST / Supabase / rede) em
 * mensagens amigáveis em pt-BR pro usuário final. Evita vazar coisas como
 * "duplicate key value violates unique constraint" na tela.
 *
 * Uso: `toast.error(msgErro(err))` no catch das mutations.
 *
 * Mensagens curtas que o PRÓPRIO código lança (ex.: "Informe o valor",
 * "Tenant não encontrado") passam direto — só escondemos o que é
 * claramente técnico.
 */

type ErroLike = {
  message?: string;
  code?: string; // SQLSTATE do Postgres ou code do PostgREST
  details?: string;
  hint?: string;
};

export function msgErro(
  err: unknown,
  fallback = "Algo deu errado. Tente novamente.",
): string {
  if (err == null) return fallback;
  const e = (typeof err === "object" ? err : {}) as ErroLike;
  const code = e.code ?? "";
  const raw = `${e.message ?? ""} ${e.details ?? ""}`.toLowerCase();

  // --- Constraints do Postgres ---------------------------------------
  if (code === "23505" || raw.includes("duplicate key")) {
    // Tenta dar uma pista pelo nome do índice/coluna sem expor SQL.
    if (raw.includes("numerocnj") || raw.includes("numero_cnj"))
      return "Já existe um processo com esse número CNJ neste escritório.";
    if (raw.includes("cpfcnpj") || raw.includes("cpf_cnpj"))
      return "Já existe um cliente com esse CPF/CNPJ neste escritório.";
    if (raw.includes("email")) return "Já existe um cliente com esse e-mail neste escritório.";
    if (raw.includes("cnpj")) return "Já existe um escritório com esse CNPJ.";
    return "Esse registro já existe.";
  }
  if (code === "23503" || raw.includes("foreign key")) {
    return "Não é possível concluir: há itens vinculados a este registro.";
  }
  if (code === "23502" || raw.includes("not-null") || raw.includes("null value")) {
    return "Preencha todos os campos obrigatórios.";
  }
  if (code === "23514" || raw.includes("check constraint")) {
    return "Algum valor informado é inválido.";
  }

  // --- Permissão / RLS ------------------------------------------------
  if (
    code === "42501" ||
    raw.includes("row-level security") ||
    raw.includes("permission denied") ||
    raw.includes("not authorized")
  ) {
    return "Você não tem permissão para essa ação.";
  }

  // --- PostgREST ------------------------------------------------------
  if (code === "PGRST116") return "Registro não encontrado.";
  if (code === "PGRST301" || raw.includes("jwt expired"))
    return "Sua sessão expirou. Entre novamente.";

  // --- Quota de armazenamento (regra do projeto) ----------------------
  if (raw.includes("storage_quota") || raw.includes("quota")) {
    return "Limite de armazenamento do escritório atingido.";
  }

  // --- Rede -----------------------------------------------------------
  if (
    raw.includes("failed to fetch") ||
    raw.includes("networkerror") ||
    raw.includes("load failed") ||
    raw.includes("network request failed")
  ) {
    return "Falha de conexão. Verifique sua internet e tente novamente.";
  }

  // --- Mensagem própria do app (curta, em pt, sem cara de SQL) --------
  const m = e.message?.trim();
  if (
    m &&
    m.length > 0 &&
    m.length < 140 &&
    !/(constraint|violates|column|relation|syntax|postgres|pgrst|null value|0x)/i.test(m)
  ) {
    return m;
  }

  return fallback;
}
