import { assertEquals } from "jsr:@std/assert@1";

import { ipConfiavel } from "./client-ip.ts";

Deno.test("cadeia completa: ignora o que o cliente forjou no começo", () => {
  // [forjado, IP real (Traefik), IP do Traefik (Envoy)]
  assertEquals(ipConfiavel("9.9.9.9, 200.1.2.3, 10.0.0.5"), "200.1.2.3");
});

Deno.test("vários forjados no começo continuam ignorados", () => {
  assertEquals(ipConfiavel("1.1.1.1, 2.2.2.2, 3.3.3.3, 200.1.2.3, 10.0.0.5"), "200.1.2.3");
});

Deno.test("sem forjar: o IP real é o penúltimo", () => {
  assertEquals(ipConfiavel("200.1.2.3, 10.0.0.5"), "200.1.2.3");
});

Deno.test("lista de um só item fica com ele (nunca vazio)", () => {
  assertEquals(ipConfiavel("10.0.0.5"), "10.0.0.5");
});

Deno.test("vazio ou ausente devolve null", () => {
  assertEquals(ipConfiavel(""), null);
  assertEquals(ipConfiavel(null), null);
  assertEquals(ipConfiavel(undefined), null);
});

Deno.test("espaços e itens vazios não deslocam a contagem", () => {
  assertEquals(ipConfiavel(" 9.9.9.9 ,, 200.1.2.3 , 10.0.0.5 "), "200.1.2.3");
});
