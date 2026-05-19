import { useEffect } from "react";
import { X } from "lucide-react";
import type { TellerReportTable } from "@/lib/saccoTellerDb";
import { SaccoReportToolbar } from "@/components/common/SaccoReportToolbar";

type Props = {
  open: boolean;
  onClose: () => void;
  table: TellerReportTable | null;
  orgName?: string;
  onDownloadCsv?: () => void;
  onDownloadPdf: () => void;
  printTargetId?: string;
};

/** On-screen teller report preview before print or PDF. */
export function SaccoTellerReportPreview({
  open,
  onClose,
  table,
  orgName,
  onDownloadCsv,
  onDownloadPdf,
  printTargetId = "sacco-teller-report-print",
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !table) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 print:relative print:inset-auto print:z-auto">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #${printTargetId}, #${printTargetId} * { visibility: visible; }
          #${printTargetId} {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            background: white;
          }
        }
      `}</style>
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/50 print:hidden"
        aria-label="Close preview"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-4xl flex-col rounded-t-2xl sm:rounded-2xl border border-slate-200 bg-white shadow-xl print:max-h-none print:shadow-none print:border-0">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 print:hidden">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{table.title}</h2>
            <p className="text-xs text-slate-500">{table.subtitle}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2 print:hidden">
          <SaccoReportToolbar onPrint={() => window.print()} onPdf={onDownloadPdf} />
          {onDownloadCsv ? (
            <button
              type="button"
              onClick={onDownloadCsv}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Download CSV
            </button>
          ) : null}
        </div>

        <div id={printTargetId} className="overflow-auto flex-1 p-4 sm:p-6">
          <div className="hidden print:block border-b border-slate-200 pb-3 mb-4">
            <p className="text-lg font-bold text-slate-900">{table.title}</p>
            <p className="text-sm text-slate-600">{table.subtitle}</p>
            {orgName ? <p className="text-xs text-slate-500 mt-1">{orgName}</p> : null}
          </div>
          {table.summaryLines.length > 0 && (
            <ul className="mb-4 flex flex-wrap gap-3 text-xs text-slate-600">
              {table.summaryLines.map((line) => (
                <li key={line} className="rounded-full bg-slate-100 px-3 py-1">
                  {line}
                </li>
              ))}
            </ul>
          )}
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs text-slate-600">
                  {table.head.map((h) => (
                    <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.length === 0 ? (
                  <tr>
                    <td colSpan={table.head.length} className="px-3 py-8 text-center text-slate-500">
                      No rows for this report.
                    </td>
                  </tr>
                ) : (
                  table.rows.map((row, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      {row.map((cell, j) => (
                        <td key={j} className="px-3 py-2 text-slate-800 align-top">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
