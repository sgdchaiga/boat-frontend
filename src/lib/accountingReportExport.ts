import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

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

/** True if a GL line amount should be treated as non-zero (avoids float noise). */
export function isNonZeroGlAmount(n: number): boolean {
  return Math.abs(Number(n) || 0) >= 0.0001;
}

/** Debit/credit (or In/Out) column: always two decimals, including `0.00` — never blank. */
export function formatDrCrCell(n: number): string {
  return (Number(n) || 0).toFixed(2);
}

export function formatCurrency(
  value: number,
  options?: { currency?: string; locale?: string; minimumFractionDigits?: number; maximumFractionDigits?: number }
): string {
  const currency = options?.currency || "USD";
  const locale = options?.locale || "en-US";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: options?.minimumFractionDigits ?? 2,
    maximumFractionDigits: options?.maximumFractionDigits ?? 2,
  }).format(Number(value) || 0);
}

export function downloadXlsx(
  filename: string,
  rows: (string | number)[][],
  options?: { companyName?: string; sheetName?: string }
): void {
  const finalRows: (string | number)[][] = [];
  if (options?.companyName?.trim()) {
    finalRows.push([options.companyName.trim()]);
    finalRows.push([]);
  }
  finalRows.push(...rows);
  const ws = XLSX.utils.aoa_to_sheet(finalRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, options?.sheetName || "Report");
  const name = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  XLSX.writeFile(wb, name);
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
  companyName?: string;
}): void {
  const doc = new jsPDF();
  let y = 16;
  if (options.companyName?.trim()) {
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(options.companyName.trim(), 14, y);
    y += 7;
  }
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
