import { FileSpreadsheet, FileText } from "lucide-react";

interface AccountingExportButtonsProps {
  onExcel: () => void;
  onPdf: () => void;
  disabled?: boolean;
}

export function AccountingExportButtons({ onExcel, onPdf, disabled }: AccountingExportButtonsProps) {
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <button
        type="button"
        disabled={disabled}
        onClick={onExcel}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
      >
        <FileSpreadsheet className="w-4 h-4" />
        Excel
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onPdf}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
      >
        <FileText className="w-4 h-4" />
        PDF
      </button>
    </div>
  );
}
