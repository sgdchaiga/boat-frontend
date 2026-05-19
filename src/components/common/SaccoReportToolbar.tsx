import { FileDown, Printer } from "lucide-react";

type Props = {
  onPrint?: () => void;
  onPdf: () => void;
  printLabel?: string;
  pdfLabel?: string;
  className?: string;
};

/** Print + PDF actions for SACCO reports. */
export function SaccoReportToolbar({
  onPrint,
  onPdf,
  printLabel = "Print",
  pdfLabel = "Download PDF",
  className = "",
}: Props) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {onPrint ? (
        <button
          type="button"
          onClick={onPrint}
          className="inline-flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <Printer size={16} aria-hidden />
          {printLabel}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onPdf}
        className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700"
      >
        <FileDown size={16} aria-hidden />
        {pdfLabel}
      </button>
    </div>
  );
}
