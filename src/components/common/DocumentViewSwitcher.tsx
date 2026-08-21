import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, Loader2, Printer, Rows3 } from "lucide-react";

type Props = {
  normalView: ReactNode;
  createPdfBlob: () => Blob | Promise<Blob>;
  fileName: string;
  documentLabel?: string;
  className?: string;
};

/** Shared Normal/PDF document viewer for receipts, invoices, payslips and statements. */
export function DocumentViewSwitcher({ normalView, createPdfBlob, fileName, documentLabel = "Document", className = "" }: Props) {
  const [mode, setMode] = useState<"normal" | "pdf">("normal");
  const [pdfUrl, setPdfUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const ensurePdf = useCallback(async () => {
    if (pdfUrl || loading) return pdfUrl;
    setLoading(true);
    setError(null);
    try {
      const blob = await createPdfBlob();
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
      return url;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Could not prepare the ${documentLabel.toLowerCase()} PDF.`);
      return "";
    } finally {
      setLoading(false);
    }
  }, [createPdfBlob, documentLabel, loading, pdfUrl]);

  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  const selectPdf = () => { setMode("pdf"); void ensurePdf(); };
  const download = async () => {
    const url = pdfUrl || await ensurePdf();
    if (!url) return;
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
  };
  const print = () => {
    if (mode === "pdf" && frameRef.current?.contentWindow) frameRef.current.contentWindow.print();
    else window.print();
  };

  return <div className={`space-y-4 ${className}`}>
    <div className="flex flex-wrap items-center justify-between gap-2 print:hidden" role="toolbar" aria-label={`${documentLabel} view and actions`}>
      <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
        <button type="button" onClick={() => setMode("normal")} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition ${mode === "normal" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}><Rows3 className="h-4 w-4" />Normal view</button>
        <button type="button" onClick={selectPdf} className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition ${mode === "pdf" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}><FileText className="h-4 w-4" />PDF view</button>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={print} disabled={mode === "pdf" && !pdfUrl} className="app-btn-secondary disabled:opacity-50"><Printer className="h-4 w-4" />Print</button>
        <button type="button" onClick={() => void download()} disabled={loading} className="app-btn-primary disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Download PDF</button>
      </div>
    </div>
    {mode === "normal" ? normalView : <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
      {loading ? <div className="grid min-h-[520px] place-items-center text-sm text-slate-600"><span className="inline-flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin" />Preparing PDF preview…</span></div> : error ? <div className="grid min-h-[320px] place-items-center p-6 text-center text-sm text-rose-700">{error}</div> : pdfUrl ? <iframe ref={frameRef} title={`${documentLabel} PDF preview`} src={pdfUrl} className="h-[min(72vh,850px)] min-h-[520px] w-full bg-white" /> : null}
    </div>}
  </div>;
}
