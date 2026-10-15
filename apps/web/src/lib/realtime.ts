import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";

type Filter = {
  /** Coluna pra filtrar no nível do canal (opcional). */
  column: string;
  /** Valor pra match exato (Realtime só suporta `eq`). */
  value: string;
};

type AssinaturaCompartilhada = {
  channel: RealtimeChannel;
  listeners: Map<string, () => void>;
  timer: ReturnType<typeof setTimeout> | null;
  primeiroEm: number | null;
};

const assinaturas = new Map<string, AssinaturaCompartilhada>();

function assinarMudancas(
  chave: string,
  table: string,
  filter: Filter | undefined,
  listenerId: string,
  listener: () => void,
) {
  let entrada = assinaturas.get(chave);
  if (!entrada) {
    const listeners = new Map<string, () => void>();
    const nova: AssinaturaCompartilhada = {
      channel: supabase.channel(`rt:${chave}`).on(
        "postgres_changes" as never,
        { event: "*", schema: "public", table, ...(filter ? { filter: `${filter.column}=eq.${filter.value}` } : {}) },
        () => {
          // Debounce de 250 ms com teto de 1 s: em escritório movimentado os
          // eventos não dão silêncio, e sem teto a lista nunca atualizava
          // (defeito 61 do adv3).
          const agora = Date.now();
          if (nova.primeiroEm === null) nova.primeiroEm = agora;
          if (nova.timer) clearTimeout(nova.timer);
          const espera = Math.max(0, Math.min(250, nova.primeiroEm + 1000 - agora));
          nova.timer = setTimeout(() => {
            nova.timer = null;
            nova.primeiroEm = null;
            for (const fn of nova.listeners.values()) fn();
          }, espera);
        },
      ),
      listeners,
      timer: null,
      primeiroEm: null,
    };
    nova.channel.subscribe();
    assinaturas.set(chave, nova);
    entrada = nova;
  }
  entrada.listeners.set(listenerId, listener);

  return () => {
    const atual = assinaturas.get(chave);
    if (!atual) return;
    atual.listeners.delete(listenerId);
    if (atual.listeners.size > 0) return;
    if (atual.timer) clearTimeout(atual.timer);
    assinaturas.delete(chave);
    void supabase.removeChannel(atual.channel);
  };
}

/**
 * Subscreve mudanças em uma tabela e invalida query-keys associadas.
 * Usa o canal Realtime do Supabase — RLS continua aplicando pra entrega.
 *
 * **Throttle**: agrupa eventos numa janela de 250ms — em chat ativo
 * (vários eventos por segundo) evita N refetches em cascata. Custo de
 * latência percebida é zero (250ms é abaixo do limite humano).
 *
 * **Importante**: as instâncias compartilham um único canal por tabela/filtro.
 * Assim não há callbacks adicionados depois do subscribe, nem joins e eventos
 * repetidos para componentes que observam a mesma tabela.
 *
 * 🔴 **`enabled` NÃO é conveniência, é a conta do banco.** Ele existe porque
 * `filter` ausente não quer dizer "assina pouco": quer dizer assina a TABELA
 * INTEIRA, e o `postgres_changes` roda a RLS do assinante contra cada registro
 * do WAL, uma vez por assinatura. O custo é `escritas x assinantes`, e quase
 * todo ele é gasto pra concluir que a linha não interessa àquele assinante.
 *
 * ⚠️ **A armadilha é o hook pendurado num id que ainda não chegou.** Hook não
 * pode ser condicional, então o jeito óbvio de escrever isto é
 * `chatId ? { column: "chatId", value: chatId } : undefined` — que, no instante
 * em que `chatId` é `undefined`, troca o filtro estreito pela tabela inteira,
 * exatamente no estado em que a query correspondente está DESLIGADA e não há
 * nada pra invalidar. Ninguém percebe: não dá erro, não dá log, e a tela
 * funciona. Volta na conta de CPU do banco, semanas depois. O sentinela
 * (`value: id ?? "__none__"`) evita a tabela inteira e ainda paga um canal e
 * uma linha em `realtime.subscription` que jamais dispara.
 *
 * Por isso a regra é curta: **passe aqui o MESMO `enabled` da query que esta
 * assinatura invalida.** Query desligada não tem o que invalidar, e assinatura
 * que não pode disparar não deve existir.
 *
 * @example
 * useRealtimeInvalidate("Comentario", [["comentarios", entityId]]);
 * @example
 * // Espelha o `enabled` da query: sem chatId não há o que invalidar.
 * useRealtimeInvalidate("WhatsappMensagem", [[...]], { column: "chatId", value: chatId! }, !!chatId);
 */
export function useRealtimeInvalidate(
  table: string,
  invalidateKeys: ReadonlyArray<ReadonlyArray<unknown>>,
  filter?: Filter,
  enabled = true,
) {
  const qc = useQueryClient();
  const instanceId = useId();
  // Serializa pra dependência estável (evita re-subscrição a cada render
  // quando o array literal é recriado).
  const keysHash = JSON.stringify(invalidateKeys);
  const filterHash = filter ? `${filter.column}=eq.${filter.value}` : "";

  useEffect(() => {
    if (!enabled) return;
    const chave = `${table}:${filterHash || "all"}`;
    const flush = () => {
      for (const key of invalidateKeys) {
        qc.invalidateQueries({ queryKey: [...key] });
      }
    };
    return assinarMudancas(chave, table, filter, instanceId, flush);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, keysHash, filterHash, instanceId, qc, enabled]);
}
