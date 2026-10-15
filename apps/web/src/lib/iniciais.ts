/**
 * Iniciais de um contato, ou `null` quando não há LETRA nenhuma no nome.
 *
 * 🔴 Contato do WhatsApp sem nome salvo chega com o próprio telefone no lugar
 * do nome ("+55 44 9701-8057", "554497018057") — e a regra genérica de iniciais
 * devolvia "+4" e "55". Um pedaço aleatório do telefone não identifica ninguém,
 * fica igual entre todos os contatos do mesmo DDD e ainda parece defeito na
 * tela (foi assim que apareceu, 25/08/2026). Sem letra não existe inicial: quem
 * chama decide o que desenhar no lugar, e o desenho é sempre o mesmo ícone de
 * pessoa, porque o avatar aqui é de quem AINDA não tem nome.
 *
 * Devolver `null` (e não "?") é de propósito: string vazia ou interrogação
 * continuaria caindo no mesmo `<span>` de texto, e o chamador não teria como
 * saber que precisa trocar de desenho.
 */
export function iniciaisDeContato(nome: string | null | undefined): string | null {
  const partes = (nome ?? "").trim().split(/\s+/).filter((p) => /\p{L}/u.test(p));
  if (partes.length === 0) return null;
  if (partes.length === 1) {
    // Uma palavra só: as duas primeiras letras dela ("Bolzon" → "BO").
    const letras = (partes[0]!.match(/\p{L}/gu) ?? []).slice(0, 2).join("");
    return letras.toUpperCase();
  }
  const primeira = partes[0]!.match(/\p{L}/u)![0];
  const ultima = partes[partes.length - 1]!.match(/\p{L}/u)![0];
  return (primeira + ultima).toUpperCase();
}
