import { assertEquals } from "jsr:@std/assert@1";
import { avisoBloqueado, statusRetentavel } from "./avisos-regra.ts";

Deno.test("sem_conexao e sem_telefone repetem; enviado e falhou não", () => {
  assertEquals(statusRetentavel("sem_conexao"), true);
  assertEquals(statusRetentavel("sem_telefone"), true);
  assertEquals(statusRetentavel("enviado"), false);
  assertEquals(statusRetentavel("falhou"), false);
});

Deno.test("marco enviado bloqueia; marco sem_telefone não", () => {
  assertEquals(avisoBloqueado([{ marco: 7, status: "enviado" }], 7), true);
  assertEquals(avisoBloqueado([{ marco: 7, status: "falhou" }], 7), true);
  assertEquals(avisoBloqueado([{ marco: 7, status: "sem_telefone" }], 7), false);
  assertEquals(avisoBloqueado([{ marco: 7, status: "sem_conexao" }], 7), false);
});

Deno.test("marco mais perto do vencimento bloqueia qualquer status; marco maior não", () => {
  assertEquals(avisoBloqueado([{ marco: 1, status: "sem_telefone" }], 7), true);
  assertEquals(avisoBloqueado([{ marco: 30, status: "enviado" }], 7), false);
  assertEquals(avisoBloqueado([], 7), false);
});

Deno.test("sem_telefone só repete quando o telefone muda", () => {
  const semNumero = [{ marco: 7, status: "sem_telefone", telefone: null }];
  assertEquals(avisoBloqueado(semNumero, 7, null), true);
  assertEquals(avisoBloqueado(semNumero, 7, "5511987654321"), false);
  const semWhats = [{ marco: 7, status: "sem_telefone", telefone: "5511987654321" }];
  assertEquals(avisoBloqueado(semWhats, 7, "5511987654321"), true);
  assertEquals(avisoBloqueado(semWhats, 7, "5511912345678"), false);
  // Cadastro mudou (tirou o número): tenta uma vez, grava sem_telefone sem número e para.
  assertEquals(avisoBloqueado(semWhats, 7, null), false);
  // sem_conexao repete sempre, com ou sem mudança no cadastro.
  assertEquals(avisoBloqueado([{ marco: 7, status: "sem_conexao", telefone: "5511987654321" }], 7, "5511987654321"), false);
});
