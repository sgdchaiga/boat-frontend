import { FileDown, Printer, Table2 } from "lucide-react";
import { APP_SHORT_NAME } from "@/constants/branding";
import {
  downloadSchoolFeeReceiptExcel,
  downloadSchoolFeeReceiptPdf,
  type SchoolFeeReceiptDetail,
} from "@/lib/schoolFeeReceipt";

type Props = {
  detail: SchoolFeeReceiptDetail | null;
  loading?: boolean;
  onClose: () => void;
};

export function SchoolFeeReceiptPreviewModal({ detail, loading, onClose }: Props) {
  const handlePrint = () => {
    window.print();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 print:p-0 print:bg-white"
      role="dialog"
      aria-modal="true"
      aria-labelledby="school-fee-receipt-title"
      aria-busy={loading ? true : undefined}
    >
      <div className="mt-8 w-full max-w-md rounded-xl bg-white p-6 shadow-xl print:mt-0 print:max-w-none print:rounded-none print:shadow-none flex flex-col gap-4">
        <style>{`
          @page {
            size: A4;
            margin: 10mm;
          }
          @media print {
            body * { visibility: hidden; }
            #school-fee-receipt-print, #school-fee-receipt-print * { visibility: visible; }
            #school-fee-receipt-print {
              position: relative;
              left: auto;
              top: auto;
              width: 100%;
              max-width: 180mm;
              margin-left: auto;
              margin-right: auto;
              max-height: 128mm;
              min-height: 0;
              overflow: hidden;
              box-sizing: border-box;
              border: 2pt solid #0f172a;
              padding: 5mm 7mm;
              background: #fff;
              page-break-inside: avoid;
            }
          }
        `}</style>

        <div
          className="flex flex-col gap-2 print:hidden"
          role="toolbar"
          aria-label="Receipt actions"
        >
          <div className="flex flex-wrap items-stretch sm:items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-3 sm:py-2 border border-slate-300 rounded-lg text-sm font-medium hover:bg-slate-50 flex-1 sm:flex-initial min-w-[5rem]"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={!detail || loading}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 sm:py-2 bg-slate-900 text-white rounded-lg text-sm font-semibold hover:bg-slate-800 disabled:opacity-50 flex-1 sm:flex-initial min-w-[5rem]"
            >
              <Printer className="w-4 h-4 shrink-0" aria-hidden />
              Print
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => detail && downloadSchoolFeeReceiptPdf(detail)}
              disabled={!detail || loading}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-50 flex-1 sm:flex-initial"
            >
              <FileDown className="w-4 h-4 shrink-0" aria-hidden />
              PDF
            </button>
            <button
              type="button"
              onClick={() => detail && downloadSchoolFeeReceiptExcel(detail)}
              disabled={!detail || loading}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-50 flex-1 sm:flex-initial"
            >
              <Table2 className="w-4 h-4 shrink-0" aria-hidden />
              Excel
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Excel downloads as a CSV file you can open in Microsoft Excel or Google Sheets.
          </p>
        </div>

        {loading && (
          <p className="text-slate-600 text-sm py-6 print:hidden" role="status">
            Loading receipt…
          </p>
        )}

        {!loading && detail && (
          <div
            id="school-fee-receipt-print"
            className="flex flex-col border-2 border-slate-800 rounded-sm bg-white p-4 sm:p-5 w-full max-w-md mx-auto max-h-[min(520px,48svh)] min-h-0 overflow-y-auto shadow-sm print:overflow-hidden print:rounded-none print:shadow-none print:border-slate-900"
          >
            <header className="mb-3 text-center sm:text-left print:mb-2">
              <p className="text-xl font-bold text-slate-900 print:text-lg leading-tight">{detail.orgName ?? "—"}</p>
              {detail.orgAddress ? (
                <p className="text-xs text-slate-600 mt-1 whitespace-pre-line leading-snug print:text-[10px] print:mt-0.5">
                  {detail.orgAddress}
                </p>
              ) : null}
              <h2
                id="school-fee-receipt-title"
                className="text-lg font-semibold text-slate-900 mt-3 print:text-base print:mt-2"
              >
                Fee payment receipt
              </h2>
            </header>
            <dl className="space-y-1.5 text-sm print:space-y-1 print:text-xs">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600">Receipt #</dt>
                <dd className="font-mono font-medium text-slate-900">{detail.receipt_number}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600">Student</dt>
                <dd className="text-slate-900 text-right">{detail.studentLabel}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600">Amount</dt>
                <dd className="font-semibold text-slate-900">{Number(detail.amount).toLocaleString()}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600">Method</dt>
                <dd className="capitalize text-slate-900">{detail.method.replace(/_/g, " ")}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600">Reference</dt>
                <dd className="text-slate-900 text-right">{detail.reference ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600">Paid</dt>
                <dd className="text-slate-900">{new Date(detail.paid_at).toLocaleString()}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600">Issued</dt>
                <dd className="text-slate-900">{new Date(detail.issued_at).toLocaleString()}</dd>
              </div>
            </dl>
            <p className="text-[10px] text-slate-400 mt-auto pt-3 border-t border-slate-200 print:mt-2 print:pt-2 print:border-slate-300">
              Powered by {APP_SHORT_NAME}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
