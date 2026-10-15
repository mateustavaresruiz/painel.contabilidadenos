/**
 * Env vars das Edge Functions. No self-hosted elas NÃO aparecem sozinhas:
 * o serviço `functions` do compose só recebe o que está listado no
 * `environment:` dele (`infra/supabase/docker-compose.yml`). Variável nova
 * = linha nova lá + valor no env do serviço no Easypanel.
 *
 *  PUBLIC_BASE_URL   URL pública do Supabase (a que o WAHA alcança), usada
 *                    pra montar a URL do webhook entregue ao WAHA.
 *  CRON_SECRET       header x-cron-secret que o pg_cron envia (o valor no
 *                    banco mora no Vault, nunca em migration).
 *  WAHA_*            ver `_shared/waha.ts`.
 *  SERPRO_*          ver `_shared/serpro.ts`.
 */
export const PUBLIC_BASE_URL = (
  Deno.env.get("PUBLIC_BASE_URL") ?? "https://painel-supabase.at63vf.easypanel.host"
).replace(/\/+$/, "");

export const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

if (!CRON_SECRET) {
  console.error(
    "⚠️  [env] CRON_SECRET vazio: todos os crons responderão 401 " +
      "silenciosamente. Acrescente no env do serviço supabase no Easypanel.",
  );
}
