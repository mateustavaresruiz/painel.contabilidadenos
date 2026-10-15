import { format, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import type jsPDF from "jspdf";

import { novoPdfBrand, rodapeBrand } from "@/lib/pdf";
import { parsePgTimestamp } from "@/lib/format";
import type { WhatsappMensagem } from "@/lib/queries/whatsapp";

type GerarPdfOpts = {
  chatNome: string;
  numero?: string | null;
  escritorio?: string;
  clienteVinculado?: string | null;
};

/**
 * Gera um PDF "transcrição de conversa WhatsApp" com header brand,
 * separadores de data e bubbles texto-only (mídia aparece como
 * placeholder [imagem]/[áudio]/etc com nome do arquivo se houver).
 *
 * Retorna o jsPDF — caller decide entre `doc.save()` (download local)
 * ou `doc.output("blob")` (upload pro Storage).
 */
export function gerarPdfConversa(
  mensagens: WhatsappMensagem[],
  opts: GerarPdfOpts,
): jsPDF {
  const { doc, y } = novoPdfBrand({
    titulo: "Conversa WhatsApp",
    subtitulo: opts.chatNome,
    escritorio: opts.escritorio,
  });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 40;
  const maxWidth = pageW - marginX * 2;
  let cursorY = y;

  // Sub-cabeçalho com infos do chat
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(113, 113, 122);
  const subLinhas: string[] = [];
  if (opts.numero) subLinhas.push(`Número: ${opts.numero}`);
  if (opts.clienteVinculado) subLinhas.push(`Cliente: ${opts.clienteVinculado}`);
  subLinhas.push(`${mensagens.length} mensagem${mensagens.length === 1 ? "" : "s"}`);
  doc.text(subLinhas.join("  ·  "), marginX, cursorY);
  cursorY += 18;

  let ultimaData: Date | null = null;
  for (const m of mensagens) {
    const data = parsePgTimestamp(m.timestamp) ?? new Date();

    // Separador de dia
    if (!ultimaData || !isSameDay(ultimaData, data)) {
      cursorY = ensurePageRoom(doc, cursorY, 28, pageH);
      doc.setDrawColor(228, 228, 231);
      doc.setLineWidth(0.5);
      doc.line(marginX, cursorY + 6, pageW - marginX, cursorY + 6);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(13, 87, 148);
      const rotulo = format(data, "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR });
      doc.text(rotulo.toUpperCase(), pageW / 2, cursorY + 4, { align: "center" });
      cursorY += 22;
      ultimaData = data;
    }

    // Linha do remetente
    const hora = format(data, "HH:mm");
    const autor = m.fromMe
      ? m.enviadoPor?.nome || "Eu"
      : m.remetenteNome || "Contato";
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    // Próprias em azul-marinho; recebidas em quase-preto.
    if (m.fromMe) doc.setTextColor(13, 87, 148);
    else doc.setTextColor(24, 24, 27);
    cursorY = ensurePageRoom(doc, cursorY, 14, pageH);
    doc.text(`${autor} · ${hora}`, marginX, cursorY);
    cursorY += 12;

    // Conteúdo
    const conteudo = textoMensagem(m);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(24, 24, 27);
    const linhas = doc.splitTextToSize(conteudo, maxWidth) as string[];
    for (const linha of linhas) {
      cursorY = ensurePageRoom(doc, cursorY, 12, pageH);
      doc.text(linha, marginX, cursorY);
      cursorY += 12;
    }
    cursorY += 4;
  }

  rodapeBrand(doc);
  return doc;
}

function textoMensagem(m: WhatsappMensagem): string {
  if (m.apagadoEm) return "(mensagem apagada)";
  if (m.tipo === "text") return m.texto || "(vazio)";
  const arquivo = m.mediaNomeArquivo ? `, ${m.mediaNomeArquivo}` : "";
  const legenda = m.texto ? `\n${m.texto}` : "";
  switch (m.tipo) {
    case "image":
      return `[imagem${arquivo}]${legenda}`;
    case "video":
      return `[vídeo${arquivo}]${legenda}`;
    case "audio":
      return `[áudio${arquivo}]${legenda}`;
    case "document":
      return `[documento${arquivo}]${legenda}`;
    case "sticker":
      return "[figurinha]";
    case "location":
      return `[localização${m.latitude && m.longitude ? ` ${m.latitude}, ${m.longitude}` : ""}]`;
    case "contact":
      return `[contato${legenda}]`;
    case "poll":
      return `[enquete${legenda}]`;
    case "reaction":
      return `[reação${legenda}]`;
    case "system":
      return m.texto || "[evento do sistema]";
    default:
      return m.texto || `[${m.tipo}]`;
  }
}

function ensurePageRoom(doc: jsPDF, y: number, needed: number, pageH: number): number {
  if (y + needed > pageH - 50) {
    doc.addPage();
    return 50;
  }
  return y;
}
