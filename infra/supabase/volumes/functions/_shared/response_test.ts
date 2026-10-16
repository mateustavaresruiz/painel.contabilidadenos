import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { internalError, mensagemErroInterno, novoErroId } from "./response.ts";

Deno.test("5xx não vaza o detalhe: só 'Erro interno (ref id)'", async () => {
  const res = internalError('duplicate key value violates unique constraint "Cliente_pkey"');
  assertEquals(res.status, 500);
  const corpo = await res.json();
  assertFalse(JSON.stringify(corpo).includes("duplicate key"));
  assert(/^Erro interno \(ref [0-9a-f]{8}\)$/.test(corpo.error));
});

Deno.test("o id informado é o que o cliente vê; 'registrado' marca o header", async () => {
  const res = internalError("x", { id: "abc12345", registrado: true });
  assertEquals((await res.json()).error, mensagemErroInterno("abc12345"));
  assertEquals(res.headers.get("x-erro-registrado"), "1");
});

Deno.test("ids são curtos e diferentes", () => {
  assert(novoErroId() !== novoErroId());
  assertEquals(novoErroId().length, 8);
});
