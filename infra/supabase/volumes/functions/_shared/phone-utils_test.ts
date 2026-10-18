import { assertEquals } from "jsr:@std/assert@1";

import { telefonePareamento } from "./phone-utils.ts";

Deno.test("telefonePareamento: número BR sem 55 ganha o código do país", () => {
  assertEquals(telefonePareamento("(11) 98765-4321"), "5511987654321");
  assertEquals(telefonePareamento("1133334444"), "551133334444");
});

Deno.test("telefonePareamento: número completo passa como está", () => {
  assertEquals(telefonePareamento("+55 11 98765-4321"), "5511987654321");
  assertEquals(telefonePareamento("551133334444"), "551133334444");
});

Deno.test("telefonePareamento: o que não é telefone volta null", () => {
  assertEquals(telefonePareamento(""), null);
  assertEquals(telefonePareamento("123"), null);
  assertEquals(telefonePareamento(undefined), null);
  assertEquals(telefonePareamento("12345678901234"), null);
});
