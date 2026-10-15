import jsPDF from "jspdf";

/**
 * Cabeçalho e rodapé dos PDFs do painel (hoje só a exportação de conversa).
 * Portado do adv3 sem o jspdf-autotable (não há tabela aqui) e com a marca
 * NÓS Contabilidade: azul-marinho #1D3B6F e dourado #CE9350.
 */
const COLORS = {
  fg: [17, 17, 17] as const,
  muted: [113, 113, 122] as const,
  primary: [29, 59, 111] as const, // #1D3B6F
  accent: [206, 147, 80] as const, // #CE9350
  border: [228, 228, 231] as const,
};

type PdfOpts = {
  titulo: string;
  subtitulo?: string;
  escritorio?: string;
};

/** Cria um jsPDF com o cabeçalho da marca. Retorna `{doc, y}` (onde começar). */
export function novoPdfBrand(opts: PdfOpts): { doc: jsPDF; y: number } {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;

  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...COLORS.primary);
  doc.text("NÓS", margin, 54);
  const w = doc.getTextWidth("NÓS ");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.muted);
  doc.text("Contabilidade", margin + w, 54);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.setTextColor(...COLORS.fg);
  doc.text(opts.titulo, pageW - margin, 50, { align: "right" });
  if (opts.subtitulo) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...COLORS.muted);
    doc.text(opts.subtitulo, pageW - margin, 66, { align: "right" });
  }

  const lineY = 80;
  doc.setDrawColor(...COLORS.border);
  doc.setLineWidth(0.75);
  doc.line(margin, lineY, pageW - margin, lineY);
  doc.setDrawColor(...COLORS.accent);
  doc.setLineWidth(2);
  doc.line(margin, lineY, margin + 40, lineY);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.muted);
  if (opts.escritorio) doc.text(opts.escritorio, margin, lineY + 18);
  doc.text(
    `Gerado em ${new Date().toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    })}`,
    pageW - margin,
    lineY + 18,
    { align: "right" },
  );
  return { doc, y: lineY + 42 };
}

/** Rodapé com paginação em todas as páginas. Chame por último. */
export function rodapeBrand(doc: jsPDF) {
  const pages = doc.getNumberOfPages();
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...COLORS.border);
    doc.setLineWidth(0.75);
    doc.line(margin, pageH - 34, pageW - margin, pageH - 34);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    doc.text("NÓS Contabilidade · Painel interno", margin, pageH - 20);
    doc.text(`Página ${i} de ${pages}`, pageW - margin, pageH - 20, { align: "right" });
  }
}
