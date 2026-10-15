// Testes da regra de atendimento com banco simulado (nada toca WhatsApp nem Supabase).
//   deno test _shared/whatsapp-atendimento_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import {
  type AtendimentoDb,
  type AtendimentoStatus,
  type ChatAtendimento,
  decidirEnvio,
  garantirAtendimento,
} from "./whatsapp-atendimento.ts";

const eu = { id: "eu", nome: "Mateus" };
const chat = (resp: string | null, status: AtendimentoStatus): ChatAtendimento => ({
  id: "c1",
  responsavelId: resp,
  atendimentoStatus: status,
});

Deno.test("decidirEnvio: conversa livre → assume", () => {
  assertEquals(decidirEnvio(chat(null, "aberto"), eu, false), { acao: "assumir", evento: "assumiu" });
  assertEquals(decidirEnvio(chat(null, "aberto"), eu, true).acao, "assumir");
});

Deno.test("decidirEnvio: conversa que ainda não existe → assume", () => {
  assertEquals(decidirEnvio(null, eu, false).acao, "assumir");
});

Deno.test("decidirEnvio: minha → só envia", () => {
  assertEquals(decidirEnvio(chat("eu", "em_atendimento"), eu, false), { acao: "enviar" });
  assertEquals(decidirEnvio(chat("eu", "em_atendimento"), eu, true), { acao: "enviar" });
});

Deno.test("decidirEnvio: de outra pessoa sem permissão → bloqueia", () => {
  assertEquals(decidirEnvio(chat("ana", "em_atendimento"), eu, false), {
    acao: "bloquear",
    responsavelId: "ana",
  });
});

Deno.test("decidirEnvio: de outra pessoa com assumir_de_outros → toma", () => {
  assertEquals(decidirEnvio(chat("ana", "em_atendimento"), eu, true), {
    acao: "tomar",
    evento: "tomou",
    deId: "ana",
  });
});

Deno.test("decidirEnvio: finalizada reabre para quem envia, mesmo com responsável antigo", () => {
  assertEquals(decidirEnvio(chat(null, "finalizado"), eu, false).acao, "reabrir");
  assertEquals(decidirEnvio(chat("ana", "finalizado"), eu, false).acao, "reabrir");
  assertEquals(decidirEnvio(chat("eu", "finalizado"), eu, false).acao, "reabrir");
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

const args = (chatId = "5511999999999@c.us", pode = false) => ({
  sessaoId: "s1",
  chatId,
  eu,
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
