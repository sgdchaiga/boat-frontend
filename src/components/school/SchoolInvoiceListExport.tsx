import { useState } from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

const columns = [
  ["invoice", "Invoice"], ["name", "Student name"], ["admission", "Admission number"],
  ["schoolPay", "SchoolPay code"], ["className", "Class"], ["residency", "Day/Boarding"],
  ["year", "Academic year"], ["term", "Term"], ["issueDate", "Issue date"],
  ["dueDate", "Due date"], ["due", "Total due"], ["paid", "Paid"],
  ["balance", "Balance"], ["status", "Status"],
] as const;
type Column = (typeof columns)[number][0];
export type InvoiceExportRow = Record<Column, string | number>;
const escapeHtml = (value: string | number) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function SchoolInvoiceListExport({ rows, school, disabled, onError }: {
  rows: InvoiceExportRow[];
  school: { name: string; address: string };
  disabled: boolean;
  onError: (message: string) => void;
}) {
  const [selected, setSelected] = useState<Column[]>(["invoice", "name", "schoolPay", "className", "residency", "term", "due", "paid", "balance"]);
  const active = columns.filter(([key]) => selected.includes(key));
  const headers = active.map(([, title]) => title);
  const values = rows.map((row) => active.map(([key]) => row[key]));
  const unavailable = disabled || !rows.length || !active.length;

  const print = () => {
    const popup = window.open("", "_blank", "width=1100,height=750");
    if (!popup) { onError("Allow pop-ups to print student invoices."); return; }
    popup.document.write(`<!doctype html><html><head><title>Student invoices and balances</title><style>
      @page{size:A4 landscape;margin:12mm}body{font:11px Arial,sans-serif;color:#172033}h1{font-size:20px}h2{font-size:16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #cbd5e1;padding:6px;text-align:left;overflow-wrap:anywhere}th{background:#f1f5f9}thead{display:table-header-group}tr{break-inside:avoid}.address{white-space:pre-line}
      </style></head><body><h1>${escapeHtml(school.name)}</h1><p class="address">${escapeHtml(school.address)}</p><h2>Student invoices and balances</h2><p>${rows.length} matching invoices</p><table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${values.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(typeof value === "number" ? value.toLocaleString() : value)}</td>`).join("")}</tr>`).join("")}</tbody></table><script>window.onload=()=>window.print()<\/script></body></html>`);
    popup.document.close();
  };
  const excel = () => {
    const sheet = XLSX.utils.aoa_to_sheet([headers, ...values]);
    sheet["!cols"] = active.map(([key]) => ({ wch: key === "name" ? 28 : 20 }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Student invoices");
    XLSX.writeFile(book, "student-invoices.xlsx");
  };
  const pdf = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(16);
    doc.text(school.name, 14, 16);
    doc.setFontSize(11);
    doc.text(`Student invoices and balances · ${rows.length} matching invoices`, 14, 24);
    autoTable(doc, { startY: 30, head: [headers], body: values, styles: { fontSize: 8, overflow: "linebreak" }, margin: 12 });
    doc.save("student-invoices.pdf");
  };
  return <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
    <fieldset><legend className="text-sm font-semibold text-slate-900 mb-2">Columns to print / export</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">{columns.map(([key, title]) => <label key={key} className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={selected.includes(key)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, key] : current.filter((item) => item !== key))} />{title}</label>)}</div>
    </fieldset>
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={() => setSelected(columns.map(([key]) => key))} className="text-sm text-indigo-700">Select all columns</button>
      <button type="button" disabled={unavailable} onClick={print} className="px-3 py-2 rounded-lg border text-sm disabled:opacity-50">Print list</button>
      <button type="button" disabled={unavailable} onClick={excel} className="px-3 py-2 rounded-lg border text-sm disabled:opacity-50">Export Excel</button>
      <button type="button" disabled={unavailable} onClick={pdf} className="px-3 py-2 rounded-lg border text-sm disabled:opacity-50">Export PDF</button>
      <span className="text-xs text-slate-500">Uses the filtered invoice list and selected columns.</span>
    </div>
    {!active.length && <p className="text-sm text-amber-700">Select at least one column to print or export.</p>}
  </div>;
}
