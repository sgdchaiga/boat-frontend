import { useCallback, useState } from "react";
import { Download, FileUp, Loader2, Upload } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { PageNotes } from "../common/PageNotes";
import {
  applyStockAdjustmentPlans,
  downloadStockBulkImportTemplate,
  loadStockBulkImportContext,
  parseBulkImportFile,
  planStockAdjustmentImports,
  summarizeStockImportPreview,
  type StockBulkImportPreviewRow,
} from "../../lib/stockBulkImport";

type StockBulkImportPanelProps = {
  readOnly?: boolean;
  onApplied?: () => void;
};

export function StockBulkImportPanel({ readOnly = false, onApplied }: StockBulkImportPanelProps) {
  const { user, isSuperAdmin } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = Boolean(isSuperAdmin);
  const [file, setFile] = useState<File | null>(null);
  const [defaultDate, setDefaultDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [defaultReason, setDefaultReason] = useState(() => {
    const d = new Date().toISOString().slice(0, 10);
    return `Closing stock as at ${d}`;
  });
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<StockBulkImportPreviewRow[] | null>(null);

  const resetPreview = () => {
    setPreview(null);
    setResultMessage(null);
    setError(null);
  };

  const runPreview = useCallback(async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResultMessage(null);
    try {
      const { rows } = await parseBulkImportFile(file);
      if (rows.length === 0) {
        setError("File has no data rows (need a header row plus at least one row).");
        setPreview(null);
        return;
      }
      const ctx = await loadStockBulkImportContext(orgId, superAdmin, defaultDate);
      if (ctx.productCount === 0) {
        setError(
          "No products loaded for your organization. Confirm your staff account is linked to the correct organization, then try again."
        );
        setPreview(null);
        return;
      }
      const { preview: pv } = planStockAdjustmentImports(ctx, rows, {
        closingDate: defaultDate,
        movementDate: defaultDate,
        reason: defaultReason,
        glAccountId: null,
      });
      setPreview(pv);
      const ok = pv.filter((r) => r.status === "ok").length;
      const bad = pv.filter((r) => r.status === "error").length;
      const skip = pv.filter((r) => r.status === "skip").length;
      if (bad > 0) {
        setError(`${bad} row(s) have errors. Fix the file before import.`);
      } else if (ok === 0) {
        setError("No rows ready to import.");
      } else {
        setError(null);
        const skipDetail = summarizeStockImportPreview(pv);
        setResultMessage(
          `Ready: ${ok} adjustment(s)${skip ? `, ${skip} skipped` : ""} (${ctx.productCount} products in catalog).` +
            (skipDetail ? ` Skipped: ${skipDetail}.` : "")
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed.");
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [file, defaultDate, defaultReason, orgId, superAdmin]);

  const runImport = async () => {
    if (!file || readOnly || running) return;
    if (!orgId) {
      setError("Your account is not linked to an organization. Stock movements cannot be saved.");
      return;
    }
    if ((preview?.filter((r) => r.status === "ok").length ?? 0) === 0) {
      setError("Run preview first and fix errors.");
      return;
    }

    setRunning(true);
    setError(null);
    setResultMessage(null);
    try {
      const { rows } = await parseBulkImportFile(file);
      const ctx = await loadStockBulkImportContext(orgId, superAdmin, defaultDate);
      const defaults = {
        closingDate: defaultDate,
        movementDate: defaultDate,
        reason: defaultReason.trim() || `Closing stock as at ${defaultDate}`,
        glAccountId: null as string | null,
      };
      const { plans, preview: freshPreview } = planStockAdjustmentImports(ctx, rows, defaults);
      const okCount = freshPreview.filter((r) => r.status === "ok").length;
      if (okCount === 0) {
        setError(
          "Nothing to apply — stock may already match the file. Run preview again, or check Stock Balances."
        );
        setPreview(freshPreview);
        return;
      }
      if (
        !confirm(
          `Apply ${okCount} closing-stock adjustment(s) as at ${defaultDate} from "${file.name}"?\n\nMovements are posted on that date. Rows marked “skipped” already match closing stock on that date.`
        )
      ) {
        return;
      }

      const result = await applyStockAdjustmentPlans(plans, ctx, { organizationId: orgId });
      if (result.errors > 0 || result.updated !== plans.length) {
        setError(
          result.messages.join("\n") ||
            `Only ${result.updated} of ${plans.length} adjustment(s) were saved. Check Stock Adjustments history.`
        );
        return;
      }
      setResultMessage(
        `Done. Saved and verified ${result.updated} stock movement(s) for your organization. Reference: ${result.sourceId.slice(0, 8)}… — open Stock Balances and click Refresh.`
      );
      onApplied?.();
      await runPreview();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setRunning(false);
    }
  };

  const previewOk = preview?.filter((r) => r.status === "ok").length ?? 0;
  const previewErr = preview?.filter((r) => r.status === "error").length ?? 0;

  return (
    <div className="space-y-4">
      <PageNotes ariaLabel="Bulk stock import help">
        <p className="text-sm text-slate-700">
          Upload CSV or Excel for a <strong>stock count</strong>. Set the <strong>closing stock date</strong> first —
          figures in <strong>closing_stock</strong> or <strong>new_quantity</strong> are treated as{" "}
          <strong>closing stock on that date</strong>. The system compares to on-hand calculated from movements on or
          before that date, then posts the difference. Match products by name, SKU, barcode, code, or product_id.
          Optional <strong>qty_adjustment</strong> for explicit +/- changes instead of a closing count.
        </p>
      </PageNotes>

      <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4 max-w-3xl">
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Closing stock date (as at)</label>
            <input
              type="date"
              className="border rounded-lg px-3 py-2"
              value={defaultDate}
              disabled={readOnly}
              onChange={(e) => {
                const d = e.target.value;
                setDefaultDate(d);
                setDefaultReason(`Closing stock as at ${d}`);
                resetPreview();
              }}
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium mb-1">Default reason</label>
            <input
              className="border rounded-lg px-3 py-2 w-full"
              value={defaultReason}
              disabled={readOnly}
              onChange={(e) => {
                setDefaultReason(e.target.value);
                resetPreview();
              }}
              placeholder="e.g. Stock count"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => downloadStockBulkImportTemplate(defaultDate)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-4 w-4" />
            Download template
          </button>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">File</label>
          <input
            type="file"
            accept=".csv,.txt,.xlsx,.xls"
            disabled={readOnly}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              resetPreview();
            }}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-700 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-800"
          />
          {file ? <p className="mt-1 text-xs text-slate-500">{file.name}</p> : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={readOnly || !file || loading}
            onClick={() => void runPreview()}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
            Preview
          </button>
          <button
            type="button"
            disabled={readOnly || !file || loading || running || previewOk === 0 || previewErr > 0}
            onClick={() => void runImport()}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Apply adjustments
          </button>
        </div>

        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 whitespace-pre-wrap">
            {error}
          </p>
        ) : null}
        {resultMessage && !error ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            {resultMessage}
          </p>
        ) : null}
      </div>

      {preview && preview.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden max-w-3xl">
          <div className="border-b border-slate-100 px-4 py-3 flex flex-wrap gap-3 text-sm">
            <span className="text-emerald-700 font-medium">{previewOk} OK</span>
            {previewErr > 0 ? <span className="text-red-700 font-medium">{previewErr} errors</span> : null}
            <span className="text-slate-500">{preview.length} row(s) in file</span>
          </div>
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="p-2 text-left w-14">Line</th>
                  <th className="p-2 text-left w-20">Status</th>
                  <th className="p-2 text-left">Result</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((r) => (
                  <tr key={r.line} className="border-t border-slate-100">
                    <td className="p-2 tabular-nums text-slate-500">{r.line}</td>
                    <td className="p-2">
                      <span
                        className={
                          r.status === "ok"
                            ? "text-emerald-700 font-medium"
                            : r.status === "error"
                              ? "text-red-700 font-medium"
                              : "text-slate-500"
                        }
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="p-2 text-slate-800">{r.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
