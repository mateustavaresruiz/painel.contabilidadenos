// Qual falha de envio deixa a linha esperando o eco (nada toca WhatsApp nem Supabase).
//   SUPABASE_URL=http://x SUPABASE_SERVICE_ROLE_KEY=x deno test _shared/whatsapp-envio_test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { falhaAmbigua } from "./whatsapp-envio.ts";

Deno.test("falhaAmbigua: timeout e rede podem ter entregado", () => {
  assertEquals(falhaAmbigua(new Error("WAHA timeout 10000ms /api/sendText")), true);
  assertEquals(falhaAmbigua(new TypeError("error sending request for url")), true);
  const reset = new Error("connection reset");
  reset.name = "ConnectionReset";
  assertEquals(falhaAmbigua(reset), true);
});

Deno.test("falhaAmbigua: resposta do WAHA é definitiva", () => {
  assertEquals(falhaAmbigua(new Error("WAHA 422 /api/sendText: chat not found")), false);
  assertEquals(falhaAmbigua(new Error("WAHA 500 /api/sendText: boom")), false);
  assertEquals(falhaAmbigua("texto solto"), false);
  assertEquals(falhaAmbigua(undefined), false);
});
