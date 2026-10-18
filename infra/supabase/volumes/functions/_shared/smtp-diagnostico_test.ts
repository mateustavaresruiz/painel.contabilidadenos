import { assertEquals } from "jsr:@std/assert@1";
import { avisosSmtp, lerResposta, provedorSmtp, temExtensao } from "./smtp-diagnostico.ts";

Deno.test("reconhece o provedor pelo host", () => {
  assertEquals(provedorSmtp(""), null);
  assertEquals(provedorSmtp("smtp.gmail.com"), "google");
  assertEquals(provedorSmtp(" SMTP.Gmail.com "), "google");
  assertEquals(provedorSmtp("smtp-relay.gmail.com"), "google-relay");
  assertEquals(provedorSmtp("painel_email"), "stalwart");
  assertEquals(provedorSmtp("smtp.exemplo.com"), "outro");
});

const gmail = {
  host: "smtp.gmail.com",
  porta: 587,
  usuario: "painel@contabilidadenos.com.br",
  remetente: "painel@contabilidadenos.com.br",
  senhaDefinida: true,
};

Deno.test("Gmail bem configurado não tem aviso", () => {
  assertEquals(avisosSmtp(gmail), []);
});

Deno.test("Gmail: falta usuário, senha, e remetente diferente", () => {
  assertEquals(avisosSmtp({ ...gmail, usuario: "" }).length, 1);
  assertEquals(avisosSmtp({ ...gmail, senhaDefinida: false })[0].includes("senha de app"), true);
  assertEquals(avisosSmtp({ ...gmail, remetente: "contato@contabilidadenos.com.br" })[0].includes("alias"), true);
  assertEquals(avisosSmtp({ ...gmail, porta: 25 }).some((a) => a.includes("587")), true);
});

Deno.test("relay do Google sem usuário lembra da lista de IPs", () => {
  const a = avisosSmtp({ ...gmail, host: "smtp-relay.gmail.com", usuario: "", senhaDefinida: false });
  assertEquals(a.length, 1);
  assertEquals(a[0].includes("187.127.26.230"), true);
});

Deno.test("sem host não há avisos", () => {
  assertEquals(avisosSmtp({ ...gmail, host: "" }), []);
});

function leitor(partes: string[]) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    read(p: Uint8Array): Promise<number | null> {
      if (i >= partes.length) return new Promise(() => {}); // fica esperando (testa o prazo)
      const b = enc.encode(partes[i++]);
      p.set(b);
      return Promise.resolve(b.length);
    },
  };
}

Deno.test("lê resposta de várias linhas, mesmo picada em pedaços", async () => {
  const linhas = await lerResposta(
    leitor(["250-smtp.gmail.com at your service\r\n250-SIZE 35882577\r\n250-STA", "RTTLS\r\n250 SMTPUTF8\r\n"]),
    1000,
  );
  assertEquals(linhas.length, 4);
  assertEquals(temExtensao(linhas, "STARTTLS"), true);
  assertEquals(temExtensao(linhas, "AUTH"), false);
  assertEquals(temExtensao(["250-x", "250 AUTH LOGIN PLAIN XOAUTH2"], "AUTH"), true);
});

Deno.test("resposta incompleta estoura o prazo", async () => {
  let erro = "";
  await lerResposta(leitor(["250-meio"]), 50).catch((e) => (erro = e.message));
  assertEquals(erro.includes("tempo esgotado"), true);
});
