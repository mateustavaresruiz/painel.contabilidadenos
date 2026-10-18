// Roda `fn` sobre a lista com no máximo `limite` chamadas ao mesmo tempo e
// devolve os resultados NA ORDEM da entrada (resultado i = itens[i]).
// Usado no encaminhar: até 50 destinos sem esperar um por um, sem abrir 50
// conexões de uma vez com o WAHA.
export async function mapaComLimite<T, R>(
  itens: readonly T[],
  limite: number,
  fn: (item: T, indice: number) => Promise<R>,
): Promise<R[]> {
  const resultados = new Array<R>(itens.length);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      resultados[i] = await fn(itens[i], i);
    }
  };
  const n = Math.max(1, Math.min(limite, itens.length));
  await Promise.all(Array.from({ length: n }, trabalhador));
  return resultados;
}
