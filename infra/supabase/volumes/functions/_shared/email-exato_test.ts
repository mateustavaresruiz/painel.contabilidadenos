import { assertEquals } from "jsr:@std/assert@1";
import { normalizarEmail, padraoIlikeExato } from "./email-exato.ts";

Deno.test("normaliza caixa e espaços", () => {
  assertEquals(normalizarEmail("  Ana@Exemplo.COM "), "ana@exemplo.com");
});

Deno.test("recusa curingas e formatos inválidos", () => {
  assertEquals(normalizarEmail("%@x.com"), null);
  assertEquals(normalizarEmail("a*@x.com"), null);
  assertEquals(normalizarEmail("a@%.com"), null);
  assertEquals(normalizarEmail("sem-arroba"), null);
  assertEquals(normalizarEmail(42), null);
});

Deno.test("escapa _ e barra para o ilike casar só o próprio e-mail", () => {
  assertEquals(padraoIlikeExato("a_b@x.com"), "a\\_b@x.com");
  assertEquals(padraoIlikeExato("a@x.com"), "a@x.com");
});
