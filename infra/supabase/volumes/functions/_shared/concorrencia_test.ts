//   deno test _shared/concorrencia_test.ts
import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { mapaComLimite } from "./concorrencia.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.test("mapaComLimite: mantém a ordem da entrada mesmo terminando fora de ordem", async () => {
  const r = await mapaComLimite([30, 5, 20, 1, 10], 3, async (ms, i) => {
    await sleep(ms);
    return `${i}:${ms}`;
  });
  assertEquals(r, ["0:30", "1:5", "2:20", "3:1", "4:10"]);
});

Deno.test("mapaComLimite: nunca passa do limite de chamadas simultâneas", async () => {
  let ativos = 0;
  let pico = 0;
  await mapaComLimite(Array.from({ length: 12 }, (_, i) => i), 5, async () => {
    ativos++;
    pico = Math.max(pico, ativos);
    await sleep(5);
    ativos--;
  });
  assertEquals(pico, 5);
});

Deno.test("mapaComLimite: lista vazia e limite maior que a lista", async () => {
  assertEquals(await mapaComLimite([], 5, () => Promise.resolve(1)), []);
  assertEquals(await mapaComLimite([1, 2], 5, (x) => Promise.resolve(x * 2)), [2, 4]);
});

Deno.test("mapaComLimite: erro de um item rejeita (quem chama trata por item)", async () => {
  await assertRejects(() => mapaComLimite([1, 2, 3], 2, (x) => (x === 2 ? Promise.reject(new Error("x")) : Promise.resolve(x))));
});
