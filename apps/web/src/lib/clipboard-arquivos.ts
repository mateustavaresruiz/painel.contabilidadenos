/**
 * Arquivos vindos de um Ctrl+V (print da tela, imagem copiada do navegador,
 * arquivo copiado do explorador).
 *
 * O print de tela NÃO vem em `clipboardData.files` em todo navegador — vem
 * como um item de `kind: "file"` sem nome. Por isso lemos os dois lados e
 * batizamos o que vier sem nome, senão o anexo sobe como "blob".
 */
export function arquivosColados(
  clipboard: DataTransfer | null,
  { somenteImagem = false } = {},
): File[] {
  if (!clipboard) return [];

  const vistos = new Set<string>();
  const saida: File[] = [];

  const considerar = (file: File | null) => {
    if (!file) return;
    if (somenteImagem && !file.type.startsWith("image/")) return;
    const chave = `${file.name}|${file.size}|${file.type}`;
    if (vistos.has(chave)) return;
    vistos.add(chave);
    saida.push(nomear(file));
  };

  for (const item of Array.from(clipboard.items ?? [])) {
    if (item.kind === "file") considerar(item.getAsFile());
  }
  for (const file of Array.from(clipboard.files ?? [])) considerar(file);

  return saida;
}

/** Print da tela chega sem nome útil ("image.png" ou vazio). */
function nomear(file: File): File {
  if (file.name && file.name !== "image.png") return file;
  const ext = file.type.split("/")[1]?.split("+")[0] || "png";
  const carimbo = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, "-");
  return new File([file], `colado-${carimbo}.${ext}`, { type: file.type });
}
