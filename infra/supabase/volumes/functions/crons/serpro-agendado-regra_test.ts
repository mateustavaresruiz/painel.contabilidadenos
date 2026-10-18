//   deno test crons/serpro-agendado-regra_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import {
  corteVarredura,
  deveIniciar,
  ehErroDeSistema,
  hojeEmSaoPaulo,
  PENDENTE_MAX_MS,
  problemaDoCliente,
  temTrabalho,
} from "./serpro-agendado-regra.ts";

const hoje = { iso: "2026-10-05", diaMes: 5 };
const ag = (o: Partial<{ ativo: boolean; cicloConcluido: boolean; diaMes: number; cicloEm: string | null }> = {}) => ({
  ativo: true,
  cicloConcluido: true,
  diaMes: 5,
  cicloEm: "2026-09-05",
  ...o,
});

Deno.test("hojeEmSaoPaulo: 02h UTC ainda é o dia anterior em São Paulo", () => {
  assertEquals(hojeEmSaoPaulo(new Date("2026-10-05T02:00:00Z")), { iso: "2026-10-04", diaMes: 4 });
  assertEquals(hojeEmSaoPaulo(new Date("2026-10-05T12:00:00Z")), { iso: "2026-10-05", diaMes: 5 });
});

Deno.test("deveIniciar: ligado, ciclo anterior concluído, dia certo e ainda não rodou hoje", () => {
  assertEquals(deveIniciar(ag(), hoje), true);
  assertEquals(deveIniciar(ag({ ativo: false }), hoje), false);
  assertEquals(deveIniciar(ag({ cicloConcluido: false }), hoje), false);
  assertEquals(deveIniciar(ag({ diaMes: 6 }), hoje), false);
  assertEquals(deveIniciar(ag({ cicloEm: "2026-10-05" }), hoje), false); // já começou hoje: não recomeça
  assertEquals(deveIniciar(ag({ cicloEm: null }), hoje), true);
});

Deno.test("temTrabalho: só pega a trava quando há ciclo para começar ou continuar", () => {
  assertEquals(temTrabalho(ag(), hoje), true); // começa hoje
  assertEquals(temTrabalho(ag({ diaMes: 20 }), hoje), false); // nada a fazer
  assertEquals(temTrabalho(ag({ cicloConcluido: false, cicloEm: "2026-10-05" }), hoje), true); // continua
  assertEquals(temTrabalho(ag({ ativo: false, cicloConcluido: false }), hoje), true); // encerra o desligado
  assertEquals(temTrabalho(ag({ ativo: false }), hoje), false);
});

Deno.test("ehErroDeSistema: gateway fora/pausado/limite para o ciclo; erro do cliente não", () => {
  assertEquals(ehErroDeSistema({ status: "erro", erro: "SEM_RESPOSTA" }), true);
  assertEquals(ehErroDeSistema({ status: "erro", resultado: { gatewayErro: "PAUSADO" } }), true);
  assertEquals(ehErroDeSistema({ status: "erro", erro: "HTTP 429" }), true);
  assertEquals(ehErroDeSistema({ status: "erro", erro: "HTTP 400" }), false);
  assertEquals(ehErroDeSistema({ status: "pendente", erro: "SEM_RESPOSTA" }), false);
  assertEquals(ehErroDeSistema({ status: "ok", resultado: null }), false);
});

Deno.test("problemaDoCliente: erro e pendente vão para o ultimoErro; ok e com_pendencia não", () => {
  assertEquals(problemaDoCliente("ACME", { status: "erro", resumo: "HTTP 400" }), "ACME: consulta deu erro — HTTP 400");
  assertEquals(
    problemaDoCliente("ACME", { status: "pendente", resumo: "Aguardando PIN" }),
    "ACME: consulta ficou pendente — Aguardando PIN",
  );
  assertEquals(problemaDoCliente("ACME", { status: "ok", resumo: "x" }), null);
  assertEquals(problemaDoCliente("ACME", { status: "com_pendencia", resumo: "x" }), null);
  assertEquals(problemaDoCliente("A", { status: "erro", resumo: "x".repeat(900) })!.length, 500);
});

Deno.test("corteVarredura: 15 minutos antes de agora", () => {
  const agora = new Date("2026-10-05T12:00:00Z");
  assertEquals(PENDENTE_MAX_MS, 15 * 60_000);
  assertEquals(corteVarredura(agora), "2026-10-05T11:45:00.000Z");
});
