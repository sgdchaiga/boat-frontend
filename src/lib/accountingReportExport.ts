import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

/** Escape for CSV (Excel-compatible). */
export function csvCell(value: string | number | null | undefined): string {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const csv = rows.map((line) => line.map(csvCell).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export type AccountingPdfSection = {
  title: string;
  head: string[];
  body: (string | number)[][];
};

export function exportAccountingPdf(options: {
  title: string;
  subtitle?: string;
  filename: string;
  sections: AccountingPdfSection[];
  footerLines?: string[];
}): void {
  const doc = new jsPDF();
  let y = 16;
  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.text(options.title, 14, y);
  y += 7;
  if (options.subtitle) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(options.subtitle, 180);
    doc.text(lines, 14, y);
    y += lines.length * 4 + 4;
  } else {
    y += 2;
  }

  for (const sec of options.sections) {
    if (y > 240) {
      doc.addPage();
      y = 16;
    }
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(sec.title, 14, y);
    y += 5;

    autoTable(doc, {
      startY: y,
      head: [sec.head],
      body: sec.body.map((row) => row.map((c) => String(c))),
      theme: "grid",
      headStyles: { fillColor: [59, 130, 246], fontSize: 8, fontStyle: "bold" },
      bodyStyles: { fontSize: 8 },
      margin: { left: 14, right: 14 },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  }

  if (options.footerLines?.length) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    for (const line of options.footerLines) {
      if (y > 275) {
        doc.addPage();
        y = 16;
      }
      const wrapped = doc.splitTextToSize(line, 180);
      doc.text(wrapped, 14, y);
      y += wrapped.length * 4 + 2;
    }
  }

  const name = options.filename.endsWith(".pdf") ? options.filename : `${options.filename}.pdf`;
  doc.save(name);
}
