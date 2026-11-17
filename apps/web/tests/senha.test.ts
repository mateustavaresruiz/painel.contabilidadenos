// Regras da senha de acesso (lib/senha.ts). Rodar: deno test apps/web/tests
import { assert, assertEquals } from "jsr:@std/assert@1";

import { avaliarSenha, erroDaSenhaNova, erroDoLogin, metodosDaSessao, sessaoPorLink } from "../src/lib/senha.ts";

/** JWT de mentira só com o payload (a assinatura não importa para ler o amr). */
function jwt(payload: Record<string, unknown>): { access_token: string } {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { access_token: `${b64({ alg: "HS256" })}.${b64(payload)}.assinatura` };
}

Deno.test("amr: link de acesso / código / só e-mail contam como sessão por link", () => {
  assertEquals(metodosDaSessao(jwt({ amr: [{ method: "otp", timestamp: 1 }] })), ["otp"]);
  assert(sessaoPorLink(jwt({ amr: [{ method: "otp", timestamp: 1 }] })));
  assert(sessaoPorLink(jwt({ amr: [{ method: "recovery", timestamp: 1 }] })));
});

Deno.test("amr: senha e Google não contam; token quebrado não quebra", () => {
  assert(!sessaoPorLink(jwt({ amr: [{ method: "password", timestamp: 1 }] })));
  assert(!sessaoPorLink(jwt({ amr: [{ method: "oauth", timestamp: 1 }] })));
  assert(!sessaoPorLink({ access_token: "lixo" }));
  assert(!sessaoPorLink(null));
});

Deno.test("senha curta, só repetida ou com nome/e-mail não serve", () => {
  assert(avaliarSenha("curta").erro?.includes("10"));
  assertEquals(avaliarSenha("aaaaaaaaaaaa").nivel, 0);
  assert(avaliarSenha("mateus-tavares-2026", ["mateus.ruiz@exemplo.com.br", "Mateus Ruiz"]).erro);
  assert(avaliarSenha("x".repeat(40) + "ç".repeat(20)).erro); // 80 bytes > 72
});

Deno.test("comprimento manda; óbvio fica fraco", () => {
  assertEquals(avaliarSenha("cafe com leite as oito").nivel >= 3, true);
  assertEquals(avaliarSenha("senha12345678").nivel, 1);
  assertEquals(avaliarSenha("1234567890123").nivel, 1);
  assertEquals(avaliarSenha("Ab3$efghij").erro, null);
});

Deno.test("mensagens do Auth em português, sem dizer se o e-mail existe", () => {
  assertEquals(erroDoLogin({ status: 400, code: "invalid_credentials" }), "E-mail ou senha incorretos.");
  assert(/desativado/.test(erroDoLogin({ status: 400, code: "user_banned" })));
  assert(/Muitas tentativas/.test(erroDoLogin({ status: 429, code: "over_request_rate_limit" })));
  assert(/vazamentos/.test(erroDaSenhaNova({ status: 422, code: "weak_password", reasons: ["pwned"] })));
  assertEquals(erroDaSenhaNova({ status: 400, code: "current_password_mismatch" }), "A senha atual não confere.");
  assertEquals(erroDaSenhaNova({ status: 400, code: "current_password_invalid" }), "A senha atual não confere.");
  assert(/diferente/.test(erroDaSenhaNova({ status: 422, code: "same_password" })));
});
