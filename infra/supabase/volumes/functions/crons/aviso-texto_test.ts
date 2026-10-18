// O texto do aviso de certificado tem UMA regra, copiada em dois arquivos (a
// function não enxerga o código do painel). Este teste garante que a prévia da
// tela e a rotina mandam exatamente a mesma coisa.
import { assertEquals } from "jsr:@std/assert@1";

import { modeloEfetivo, montarTextoAviso, MODELO_RESERVA, textoDias } from "../_shared/aviso-certificado.ts";

Deno.test("aviso-certificado: cópia do painel igual à da function", async () => {
  const daqui = new URL("../_shared/aviso-certificado.ts", import.meta.url);
  const doPainel = new URL("../../../../../apps/web/src/lib/aviso-certificado.ts", import.meta.url);
  let painel: string;
  try {
    painel = await Deno.readTextFile(doPainel);
  } catch {
    // Fora do repositório (servidor só com as functions): nada a comparar.
    return;
  }
  assertEquals(await Deno.readTextFile(daqui), painel);
});

Deno.test("aviso-certificado: {dias} e {data}", () => {
  assertEquals(textoDias(0), "vence hoje");
  assertEquals(textoDias(-2), "vence hoje");
  assertEquals(textoDias(1), "em 1 dia");
  assertEquals(textoDias(15), "em 15 dias");
  assertEquals(
    montarTextoAviso("{cliente} · {tipo} · {data} · {dias}", { cliente: "Padaria", tipo: "e-CNPJ A1", validoAte: "2026-11-02", dias: 15 }),
    "Padaria · e-CNPJ A1 · 02/11/2026 · em 15 dias",
  );
});

Deno.test("aviso-certificado: modelo salvo > padrão da Config > reserva", () => {
  assertEquals(modeloEfetivo("A", "B"), "A");
  assertEquals(modeloEfetivo("  ", "B"), "B");
  assertEquals(modeloEfetivo(null, null), MODELO_RESERVA);
});
