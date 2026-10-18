// Testes da regra de atendimento com banco simulado (nada toca WhatsApp nem Supabase).
//   deno test _shared/whatsapp-atendimento_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import {
  type AtendimentoDb,
  type AtendimentoStatus,
  type ChatAtendimento,
  decidirEnvio,
  garantirAtendimento,
  MSG_DISPUTA,
  MSG_SEM_PERMISSAO_ASSUMIR,
  statusDoConflito,
} from "./whatsapp-atendimento.ts";

const eu = { id: "eu", nome: "Mateus" };
/** Atendente comum (assumir), supervisor (assumir_de_outros) e cargo que só responde. */
const ATD = { podeAssumir: true, podeAssumirDeOutros: false };
const SUP = { podeAssumir: false, podeAssumirDeOutros: true };
const SO_RESPONDE = { podeAssumir: false, podeAssumirDeOutros: false };
const chat = (resp: string | null, status: AtendimentoStatus): ChatAtendimento => ({
  id: "c1",
  responsavelId: resp,
  atendimentoStatus: status,
});

Deno.test("decidirEnvio: conversa livre → assume", () => {
  assertEquals(decidirEnvio(chat(null, "aberto"), eu, ATD), { acao: "assumir", evento: "assumiu" });
  assertEquals(decidirEnvio(chat(null, "aberto"), eu, SUP).acao, "assumir");
});

Deno.test("decidirEnvio: conversa que ainda não existe → assume", () => {
  assertEquals(decidirEnvio(null, eu, ATD).acao, "assumir");
});

Deno.test("decidirEnvio: minha → só envia", () => {
  assertEquals(decidirEnvio(chat("eu", "em_atendimento"), eu, ATD), { acao: "enviar" });
  assertEquals(decidirEnvio(chat("eu", "em_atendimento"), eu, SUP), { acao: "enviar" });
});

Deno.test("decidirEnvio: de outra pessoa sem permissão → bloqueia", () => {
  assertEquals(decidirEnvio(chat("ana", "em_atendimento"), eu, ATD), {
    acao: "bloquear",
    responsavelId: "ana",
  });
});

Deno.test("decidirEnvio: de outra pessoa com assumir_de_outros → toma", () => {
  assertEquals(decidirEnvio(chat("ana", "em_atendimento"), eu, SUP), {
    acao: "tomar",
    evento: "tomou",
    deId: "ana",
  });
});

Deno.test("decidirEnvio: finalizada reabre para quem envia, mesmo com responsável antigo", () => {
  assertEquals(decidirEnvio(chat(null, "finalizado"), eu, ATD).acao, "reabrir");
  assertEquals(decidirEnvio(chat("ana", "finalizado"), eu, ATD).acao, "reabrir");
  assertEquals(decidirEnvio(chat("eu", "finalizado"), eu, ATD).acao, "reabrir");
});

// --- garantirAtendimento com banco simulado ---------------------------------

function bancoFalso(inicial: ChatAtendimento | null, nomes: Record<string, string> = { ana: "Ana" }) {
  let atual = inicial;
  const aplicados: Array<Record<string, unknown>> = [];
  const mexerDepoisDeLer: Array<() => void> = [];
  const db: AtendimentoDb = {
    lerChat: () => {
      const r = atual ? { ...atual } : null;
      mexerDepoisDeLer.shift()?.(); // simula corrida: alguém muda DEPOIS da leitura
      return Promise.resolve(r);
    },
    aplicar: (a) => {
      if (!atual) return Promise.resolve({ ok: false as const, responsavelId: null, status: null });
      if (atual.responsavelId !== a.esperadoResp || atual.atendimentoStatus !== a.esperadoStatus) {
        return Promise.resolve({
          ok: false as const,
          responsavelId: atual.responsavelId,
          status: atual.atendimentoStatus,
        });
      }
      aplicados.push({ ...a });
      atual = { ...atual, responsavelId: a.novoResp, atendimentoStatus: "em_atendimento" };
      return Promise.resolve({ ok: true as const });
    },
    nomeColaborador: (id) => Promise.resolve(nomes[id] ?? null),
  };
  return {
    db,
    aplicados,
    estado: () => atual,
    aoLer: (fn: () => void) => mexerDepoisDeLer.push(fn),
    forcar: (c: ChatAtendimento) => (atual = c),
  };
}

const args = (chatId = "5511999999999@c.us", pode = false, podeAssumir = true) => ({
  sessaoId: "s1",
  chatId,
  eu,
  podeAssumir,
  podeAssumirDeOutros: pode,
});

Deno.test("garantir: livre → grava responsável e registra 'assumiu' (antes do envio)", async () => {
  const b = bancoFalso(chat(null, "aberto"));
  assertEquals(await garantirAtendimento(b.db, args()), { ok: true, decisao: "assumir" });
  assertEquals(b.estado()?.responsavelId, "eu");
  assertEquals(b.estado()?.atendimentoStatus, "em_atendimento");
  assertEquals(b.aplicados.length, 1);
  assertEquals(b.aplicados[0].evento, "assumiu");
  assertEquals(b.aplicados[0].esperadoResp, null);
});

Deno.test("garantir: minha → nenhuma escrita", async () => {
  const b = bancoFalso(chat("eu", "em_atendimento"));
  assertEquals(await garantirAtendimento(b.db, args()), { ok: true, decisao: "enviar" });
  assertEquals(b.aplicados.length, 0);
});

Deno.test("garantir: de outra pessoa → 409 com nome e sem escrita", async () => {
  const b = bancoFalso(chat("ana", "em_atendimento"));
  assertEquals(await garantirAtendimento(b.db, args()), {
    ok: false,
    conflito: {
      error: "Conversa em atendimento por Ana",
      motivo: "em_atendimento",
      responsavel: { id: "ana", nome: "Ana" },
    },
  });
  assertEquals(b.aplicados.length, 0);
  assertEquals(b.estado()?.responsavelId, "ana");
});

Deno.test("garantir: supervisor toma e registra 'Assumida por <nome>'", async () => {
  const b = bancoFalso(chat("ana", "em_atendimento"));
  assertEquals(await garantirAtendimento(b.db, args("5511999999999@c.us", true)), {
    ok: true,
    decisao: "tomar",
  });
  assertEquals(b.estado()?.responsavelId, "eu");
  assertEquals(b.aplicados[0].evento, "tomou");
  assertEquals(b.aplicados[0].motivo, "Assumida por Mateus");
});

Deno.test("garantir: finalizada reabre em nome de quem envia", async () => {
  const b = bancoFalso(chat("ana", "finalizado"));
  assertEquals(await garantirAtendimento(b.db, args()), { ok: true, decisao: "reabrir" });
  assertEquals(b.estado(), { id: "c1", responsavelId: "eu", atendimentoStatus: "em_atendimento" });
  assertEquals(b.aplicados[0].evento, "reabriu");
});

Deno.test("garantir: corrida — Ana assume entre a leitura e a escrita → 409", async () => {
  const b = bancoFalso(chat(null, "aberto"));
  b.aoLer(() => b.forcar(chat("ana", "em_atendimento")));
  const r = await garantirAtendimento(b.db, args());
  assertEquals(r.ok, false);
  assertEquals(b.estado()?.responsavelId, "ana");
  assertEquals(b.aplicados.length, 0);
});

Deno.test("garantir: corrida — eu mesmo assumi em outra aba → segue sem erro", async () => {
  const b = bancoFalso(chat(null, "aberto"));
  b.aoLer(() => b.forcar(chat("eu", "em_atendimento")));
  assertEquals(await garantirAtendimento(b.db, args()), { ok: true, decisao: "enviar" });
});

Deno.test("garantir: grupo não tem dono (ignorado, sem escrita)", async () => {
  const b = bancoFalso(chat("ana", "em_atendimento"));
  assertEquals(await garantirAtendimento(b.db, args("120363000000@g.us")), {
    ok: true,
    decisao: "ignorado",
  });
  assertEquals(b.aplicados.length, 0);
});

Deno.test("garantir: conversa inexistente → ignorado", async () => {
  const b = bancoFalso(null);
  assertEquals(await garantirAtendimento(b.db, args()), { ok: true, decisao: "ignorado" });
});

// --- cargo sem permissão de assumir (decisão do dono) -------------------------

Deno.test("decidirEnvio: sem assumir/transferir não assume conversa livre, nova nem finalizada", () => {
  assertEquals(decidirEnvio(chat(null, "aberto"), eu, SO_RESPONDE), { acao: "sem_permissao" });
  assertEquals(decidirEnvio(null, eu, SO_RESPONDE), { acao: "sem_permissao" });
  assertEquals(decidirEnvio(chat("ana", "finalizado"), eu, SO_RESPONDE), { acao: "sem_permissao" });
  assertEquals(decidirEnvio(chat("eu", "finalizado"), eu, SO_RESPONDE), { acao: "sem_permissao" });
});

Deno.test("decidirEnvio: sem assumir, mas a conversa é minha → envia; de outra pessoa → bloqueia", () => {
  assertEquals(decidirEnvio(chat("eu", "em_atendimento"), eu, SO_RESPONDE), { acao: "enviar" });
  assertEquals(decidirEnvio(chat("ana", "em_atendimento"), eu, SO_RESPONDE), {
    acao: "bloquear",
    responsavelId: "ana",
  });
});

Deno.test("decidirEnvio: assumir_de_outros sozinho já permite assumir conversa livre e reabrir", () => {
  assertEquals(decidirEnvio(chat(null, "aberto"), eu, SUP).acao, "assumir");
  assertEquals(decidirEnvio(chat("ana", "finalizado"), eu, SUP).acao, "reabrir");
});

Deno.test("garantir: sem permissão de assumir → 403 sem_permissao_assumir e nenhuma escrita", async () => {
  const b = bancoFalso(chat(null, "aberto"));
  const r = await garantirAtendimento(b.db, args("5511999999999@c.us", false, false));
  assertEquals(r, {
    ok: false,
    conflito: { error: MSG_SEM_PERMISSAO_ASSUMIR, motivo: "sem_permissao_assumir" },
  });
  if (!r.ok) assertEquals(statusDoConflito(r.conflito), 403);
  assertEquals(b.aplicados.length, 0);
  assertEquals(b.estado()?.responsavelId, null);
});

Deno.test("garantir: sem permissão de assumir, finalizada → 403 e continua finalizada", async () => {
  const b = bancoFalso(chat("eu", "finalizado"));
  const r = await garantirAtendimento(b.db, args("5511999999999@c.us", false, false));
  assertEquals(r.ok, false);
  assertEquals(b.estado()?.atendimentoStatus, "finalizado");
  assertEquals(b.aplicados.length, 0);
});

Deno.test("garantir: sem permissão de assumir, minha → envia", async () => {
  const b = bancoFalso(chat("eu", "em_atendimento"));
  assertEquals(await garantirAtendimento(b.db, args("5511999999999@c.us", false, false)), {
    ok: true,
    decisao: "enviar",
  });
});

// --- disputa que não assenta em 2 voltas --------------------------------------

/** Banco cujo `aplicar` sempre falha, devolvendo os estados da lista (um por chamada). */
function bancoDisputa(inicial: ChatAtendimento, depois: Array<[string | null, AtendimentoStatus]>) {
  let chamadas = 0;
  const db: AtendimentoDb = {
    lerChat: () => Promise.resolve({ ...inicial }),
    aplicar: () => {
      const [resp, status] = depois[Math.min(chamadas++, depois.length - 1)];
      return Promise.resolve({ ok: false as const, responsavelId: resp, status });
    },
    nomeColaborador: (id) => Promise.resolve(id === "ana" ? "Ana" : null),
  };
  return { db, chamadas: () => chamadas };
}

Deno.test("garantir: disputa — 2 falhas e a conversa ficou livre → 409 disputa (não envia)", async () => {
  const b = bancoDisputa(chat(null, "aberto"), [[null, "aberto"], [null, "aberto"]]);
  const r = await garantirAtendimento(b.db, args());
  assertEquals(r, { ok: false, conflito: { error: MSG_DISPUTA, motivo: "disputa" } });
  if (!r.ok) assertEquals(statusDoConflito(r.conflito), 409);
  assertEquals(b.chamadas(), 2);
});

Deno.test("garantir: disputa — 2 falhas e ficou finalizada comigo → 409 disputa", async () => {
  const b = bancoDisputa(chat(null, "aberto"), [[null, "finalizado"], ["eu", "finalizado"]]);
  assertEquals((await garantirAtendimento(b.db, args())).ok, false);
});

Deno.test("garantir: disputa — 2 falhas e ficou com a Ana → 409 em_atendimento com o nome", async () => {
  const b = bancoDisputa(chat(null, "aberto"), [[null, "finalizado"], ["ana", "em_atendimento"]]);
  const r = await garantirAtendimento(b.db, args());
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.conflito.motivo, "em_atendimento");
});

Deno.test("garantir: disputa — 2 falhas e ficou comigo em atendimento → envia", async () => {
  const b = bancoDisputa(chat(null, "aberto"), [[null, "finalizado"], ["eu", "em_atendimento"]]);
  assertEquals(await garantirAtendimento(b.db, args()), { ok: true, decisao: "enviar" });
});
