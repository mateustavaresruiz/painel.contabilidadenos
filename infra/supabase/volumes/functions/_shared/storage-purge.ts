// Remoção de arquivos do Storage por prefixo.
//
// O banco não apaga blob (storage.objects não tem FK pra conversa), então
// apagar ou limpar uma conversa exige remover os arquivos explicitamente —
// senão a mídia fica órfã no bucket. No adv3 isso não acontecia, e o
// "limpar conversas" de UMA instância apagava a mídia do escritório inteiro
// (defeito 13 do guia). Aqui o caminho da mídia é
// `denos/whatsapp/<sessaoId>/<chatSafe>/...` (`whatsapp-media.ts`), e a
// remoção é sempre pelo prefixo da conversa ou da instância.
//
// A listagem vem da RPC `storage_paths_por_prefixo` (migration 002,
// service_role): a API do Storage só lista uma pasta por vez.
import { supabaseAdmin } from "./supabase.ts";

/** Remove uma lista de objetos de um bucket, em lotes de 1000. */
export async function removerBlobs(bucket: string, names: string[]): Promise<number> {
  let total = 0;
  for (let i = 0; i < names.length; i += 1000) {
    const lote = names.slice(i, i + 1000);
    const { error } = await supabaseAdmin.storage.from(bucket).remove(lote);
    if (error) {
      console.error("[purga-storage] remove falhou", bucket, error.message);
    } else {
      total += lote.length;
    }
  }
  return total;
}

/** Apaga tudo que começa com `prefixo` no bucket. Best-effort. */
export async function removerPorPrefixo(bucket: string, prefixo: string): Promise<number> {
  // Prefixo vazio ou curto demais apagaria o bucket inteiro. Nunca.
  if (!prefixo || prefixo.split("/").filter(Boolean).length < 3) {
    console.error("[purga-storage] prefixo recusado:", prefixo);
    return 0;
  }
  const { data, error } = await supabaseAdmin.rpc("storage_paths_por_prefixo", {
    p_bucket: bucket,
    p_prefixo: prefixo.endsWith("/") ? prefixo : `${prefixo}/`,
  });
  if (error) {
    console.error("[purga-storage] storage_paths_por_prefixo", error.message);
    return 0;
  }
  const names = ((data ?? []) as Array<{ name: string }>).map((r) => r.name);
  return names.length ? removerBlobs(bucket, names) : 0;
}

/** Mesmo `chatSafe` de `whatsapp-media.ts`. */
export function chatSafe(chatId: string): string {
  return chatId.replace(/[@.:]/g, "_");
}
