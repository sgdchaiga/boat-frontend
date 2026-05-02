import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { ASSESSMENT_REPORT_BRAND_LINE } from "@/constants/branding";
import type { ReadinessLevel } from "@/lib/hotelAssessmentEngine";
import {
  averageForCategory,
  categoryLabel,
  defaultPricingForModule,
  formatLeakageSentenceUgx,
  formatRiskLabels,
} from "@/lib/hotelAssessmentEngine";

export type HotelAssessmentReportPdfInput = {
  hotelName: string;
  branchName: string;
  location: string;
  assessorName: string;
  assessmentDate: string;
  totalScore: number;
  readiness: ReadinessLevel;
  topRisks: string[];
  scoreRows: { category: string; item: string; score: number }[];
  recommendations: { module: string; priority: string }[];
  painPoints: [string, string, string];
  revenueLeakageLow: number;
  revenueLeakageHigh: number;
};

export function assessmentReportPdfFileName(hotelName: string, assessmentDate: string): string {
  const slug = (hotelName || "hotel").replace(/\s+/g, "-").slice(0, 36);
  return `BOAT-assessment-${slug}-${assessmentDate}.pdf`;
}

export function triggerBrowserPdfDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function categoryHeading(key: string): string {
  if (key === "billing") return "Billing & payments";
  return categoryLabel(key);
}

function verdictForItemScore(score: number): string {
  if (score <= 2) return "High risk — tighten controls and visibility.";
  if (score === 3) return "Adequate but inconsistent — formalize process.";
  return "Strong — sustain and benchmark.";
}

/** Build the report document (reuse for downloads, Supabase uploads, previews). */
export function buildHotelAssessmentReportPdfDoc(input: HotelAssessmentReportPdfInput): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  const pageW = doc.internal.pageSize.getWidth();

  const ensureSpace = (needed: number, y: number) => {
    const maxY = doc.internal.pageSize.getHeight() - 48;
    if (y + needed > maxY) {
      doc.addPage();
      return margin;
    }
    return y;
  };

  /** --- Cover --- */
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageW, 120, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.text(ASSESSMENT_REPORT_BRAND_LINE.toUpperCase(), margin, 56);
  doc.setFontSize(22);
  doc.text("HOTEL SYSTEM ASSESSMENT", margin, 88);
  doc.setTextColor(40, 40, 40);
  doc.setFontSize(13);
  let y = margin + 140;
  doc.text("Prepared for:", margin, y);
  y += 22;
  doc.setFontSize(18);
  doc.text(input.hotelName || "Prospect hotel", margin, y);
  y += 28;
  doc.setFontSize(12);
  doc.text(`Branch: ${input.branchName}`, margin, y);
  y += 18;
  doc.text(`Location: ${input.location || "—"}`, margin, y);
  y += 18;
  doc.text(`Assessment date: ${input.assessmentDate}`, margin, y);
  y += 18;
  doc.text(`Assessor: ${input.assessorName}`, margin, y);

  doc.addPage();
  y = margin;

  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text("Executive summary", margin, y);
  y += 28;
  doc.setFontSize(11);
  doc.setTextColor(45, 45, 45);
  doc.text(`Overall weighted score: ${input.totalScore.toFixed(2)} / 5.00`, margin, y);
  y += 18;
  doc.text(`Readiness tier: ${input.readiness}`, margin, y);
  y += 22;
  const risks = formatRiskLabels(input.topRisks);
  doc.text("Key operational risks:", margin, y);
  y += 16;
  doc.setFontSize(10);
  (risks.length ? risks : ["None singled out"]).forEach((r) => {
    y = ensureSpace(22, y);
    doc.text(`• ${r}`, margin + 8, y);
    y += 14;
  });
  y += 12;
  y = ensureSpace(60, y);
  doc.setFontSize(10);
  doc.text(formatLeakageSentenceUgx(input.revenueLeakageLow, input.revenueLeakageHigh), margin, y, {
    maxWidth: pageW - margin * 2,
    lineHeightFactor: 1.35,
  });
  y += 52;

  doc.setFontSize(11);
  doc.text("Captured pain points:", margin, y);
  y += 18;
  doc.setFontSize(10);
  input.painPoints.forEach((p, i) => {
    y = ensureSpace(20, y);
    const line = `${i + 1}. ${p?.trim() ? p.trim() : "—"}`;
    doc.text(line, margin + 8, y, { maxWidth: pageW - margin * 2 - 8 });
    y += 18;
  });
  doc.addPage();
  y = margin;
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text("Detailed findings (by area)", margin, y);
  y += 26;
  doc.setFontSize(10);
  doc.setTextColor(50, 50, 50);

  const categories = [
    "front_office",
    "billing",
    "pos",
    "inventory",
    "accounting",
    "housekeeping",
    "controls",
    "technology",
  ];
  for (const cat of categories) {
    const rows = input.scoreRows.filter((r) => r.category === cat);
    if (rows.length === 0) continue;
    const avg = averageForCategory(
      rows.map((r) => ({ category: r.category, item: r.item, score: r.score })),
      cat
    );
    y = ensureSpace(72, y);
    doc.setFontSize(12);
    doc.setTextColor(30, 30, 30);
    doc.text(`${categoryHeading(cat)} · area average ${avg.toFixed(2)} / 5`, margin, y);
    y += 16;
    doc.setFontSize(9);
    doc.setTextColor(70, 70, 70);
    for (const row of rows) {
      y = ensureSpace(28, y);
      doc.text(`• ${row.item} — score ${row.score}: ${verdictForItemScore(row.score)}`, margin + 10, y, {
        maxWidth: pageW - margin * 2 - 16,
      });
      y += 22;
    }
    y += 8;
  }
  doc.addPage();
  y = margin;
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text("Score breakdown", margin, y);
  y += 24;
  autoTable(doc, {
    startY: y,
    head: [["Area", "Question", "Score (1–5)"]],
    body: input.scoreRows.map((r) => [
      categoryHeading(r.category),
      r.item,
      String(r.score),
    ]),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [15, 23, 42] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: margin, right: margin },
  });
  let afterTable = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y + 100;
  y = afterTable + 32;

  y = ensureSpace(80, y);
  doc.setFontSize(16);
  doc.text("Recommendations", margin, y);
  y += 22;
  autoTable(doc, {
    startY: y,
    head: [["Module", "Priority"]],
    body: input.recommendations.map((r) => [r.module, r.priority.toUpperCase()]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [30, 64, 175] },
    margin: { left: margin, right: margin },
  });
  afterTable = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y + 60;
  y = afterTable + 28;

  y = ensureSpace(120, y);
  doc.setFontSize(16);
  doc.text("Implementation plan & cost envelope", margin, y);
  y += 20;
  doc.setFontSize(10);
  const setupTotal = input.recommendations.reduce(
    (s, r) => s + defaultPricingForModule(r.module).setup,
    0
  );
  const monthlyTotal = input.recommendations.reduce(
    (s, r) => s + defaultPricingForModule(r.module).monthly,
    0
  );
  const lines = [
    "Indicative timeline (edit per engagement): Weeks 1–2 discovery · Weeks 3–5 pilot branch & parallel run · Week 6+ rollout.",
    `Illustrative software investment (excluding training travel): setup ≈ UGX ${setupTotal.toLocaleString(
      "en-UG"
    )} · recurring ≈ UGX ${monthlyTotal.toLocaleString("en-UG")} / month combined for listed modules.`,
    "Final pricing follows scope sign-off.",
  ];
  lines.forEach((line) => {
    y = ensureSpace(44, y);
    doc.text(line, margin, y, { maxWidth: pageW - margin * 2 });
    y += 36;
  });

  return doc;
}

export function getHotelAssessmentReportPdfBlob(input: HotelAssessmentReportPdfInput): Blob {
  return buildHotelAssessmentReportPdfDoc(input).output("blob");
}

export function downloadHotelAssessmentReportPdf(input: HotelAssessmentReportPdfInput) {
  buildHotelAssessmentReportPdfDoc(input).save(assessmentReportPdfFileName(input.hotelName, input.assessmentDate));
}
