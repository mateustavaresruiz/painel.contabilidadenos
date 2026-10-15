import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { atorAtual } from "./request-context.ts";

/**
 * Variáveis de ambiente que o compose (`infra/supabase/docker-compose.yml`,
 * serviço `functions`) injeta. Dentro da rede do compose o SUPABASE_URL é o
 * gateway interno (http://api-gw:8000), não a URL pública.
 */
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Faltam SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY");
}

/** Escritório único. As tabelas mantêm "tenantId" (sempre 'denos'). */
export const TENANT_ID = "denos";

/**
 * Auditoria: quando o request veio de um colaborador logado, toda chamada ao
 * banco leva o header `x-painel-ator`. Os gatilhos de auditoria só confiam
 * nele quando o papel é service_role (o navegador, com o JWT dele, não consegue
 * forjar quem agiu).
 */
const fetchComAtor: typeof fetch = (input, init) => {
  const ator = atorAtual();
  if (!ator) return fetch(input, init);
  const base = (init as RequestInit | undefined)?.headers ?? (input instanceof Request ? input.headers : undefined);
  const headers = new Headers(base);
  headers.set("x-painel-ator", ator);
  return fetch(input, { ...init, headers });
};

/**
 * Cliente admin — bypassa RLS. Toda escrita do backend passa por ele: a
 * tela só lê (e muda os poucos campos que a RLS libera).
 */
export const supabaseAdmin: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: fetchComAtor },
  },
);
