import { useCallback, useMemo, useState } from "react";
import { CheckCircle2, Download, FileSpreadsheet, FileUp, Loader2, RefreshCw, Upload } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { businessTodayISO } from "@/lib/timezone";
import { StockBulkImportPanel } from "@/components/inventory/StockBulkImportPanel";
import {
  applyMasterDataImport,
  downloadMigrationTemplate,
  fetchGoogleSheetRows,
  googleSheetCsvUrl,
  loadGlAccounts,
  openingBalanceTotals,
  parseMigrationFile,
  previewMasterDataImport,
  previewOpeningBalances,
  type GlAccountMini,
  type MigrationImportType,
  type MigrationPreviewRow,
  type MigrationSourceType,
} from "@/lib/dataMigration";

type TabId = "file" | "sheets" | "stock" | "opening";
type MasterImportType = Exclude<MigrationImportType, "opening_balances">;

const MASTER_IMPORT_TYPES: Array<{ id: MasterImportType; label: string }> = [
  { id: "customers", label: "Customers" },
  { id: "suppliers", label: "Suppliers" },
  { id: "products", label: "Products & services" },
];

function statusClass(status: MigrationPreviewRow["status"]) {
  if (status === "ok") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "skip") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-rose-50 text-rose-700 border-rose-200";
}

function PreviewTable({ rows }: { rows: MigrationPreviewRow[] }) {
  if (!rows.length) return null;
  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2">Line</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Summary</th>
            <th className="px-3 py-2">Detail</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.slice(0, 80).map((row) => (
            <tr key={`${row.line}-${row.summary}`}>
              <td className="px-3 py-2 text-slate-500">{row.line}</td>
              <td className="px-3 py-2">
                <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${statusClass(row.status)}`}>
                  {row.status}
                </span>
              </td>
              <td className="px-3 py-2 font-medium text-slate-900">{row.summary}</td>
              <td className="px-3 py-2 text-slate-600">{row.detail || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 80 ? <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">Showing first 80 rows.</p> : null}
    </div>
  );
}

export function DataMigrationPage({ readOnly = false, onNavigate }: { readOnly?: boolean; onNavigate?: (page: string) => void }) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const [tab, setTab] = useState<TabId>("file");
  const [masterType, setMasterType] = useState<MasterImportType>("customers");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<MigrationPreviewRow[]>([]);
  const [sourceName, setSourceName] = useState("");
  const [sheetUrl, setSheetUrl] = useState("");
  const [openingFile, setOpeningFile] = useState<File | null>(null);
  const [openingDate, setOpeningDate] = useState(businessTodayISO);
  const [openingPreview, setOpeningPreview] = useState<MigrationPreviewRow[]>([]);
  const [accounts, setAccounts] = useState<GlAccountMini[]>([]);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(
    () => ({
      ok: preview.filter((row) => row.status === "ok").length,
      error: preview.filter((row) => row.status === "error").length,
      skip: preview.filter((row) => row.status === "skip").length,
    }),
    [preview]
  );
  const openingCounts = useMemo(
    () => ({
      ok: openingPreview.filter((row) => row.status === "ok").length,
      error: openingPreview.filter((row) => row.status === "error").length,
      skip: openingPreview.filter((row) => row.status === "skip").length,
    }),
    [openingPreview]
  );
  const openingTotals = useMemo(() => openingBalanceTotals(openingPreview), [openingPreview]);
  const openingBalanced = Math.abs(openingTotals.debit - openingTotals.credit) <= 0.01 && openingTotals.debit > 0;

  const reset = () => {
    setPreview([]);
    setOpeningPreview([]);
    setMessage(null);
    setError(null);
  };

  const markImportStepComplete = async () => {
    if (!orgId) return;
    const { data } = await supabase
      .from("organization_onboarding_state")
      .select("completed_steps")
      .eq("organization_id", orgId)
      .maybeSingle();
    const current = Array.isArray((data as { completed_steps?: unknown } | null)?.completed_steps)
      ? ((data as { completed_steps: string[] }).completed_steps)
      : [];
    await supabase.rpc("update_organization_onboarding_state", {
      p_organization_id: orgId,
      p_completed_steps: Array.from(new Set([...current, "import_data"])),
      p_dismissed: null,
    });
  };

  const previewFile = useCallback(async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const parsed = await parseMigrationFile(file);
      const next = previewMasterDataImport(masterType, parsed.rows);
      setPreview(next);
      setSourceName(file.name);
      setMessage(`Previewed ${next.length} row(s). ${next.filter((row) => row.status === "ok").length} ready.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed.");
    } finally {
      setLoading(false);
    }
  }, [file, masterType]);

  const previewSheet = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const parsed = await fetchGoogleSheetRows(sheetUrl);
      const next = previewMasterDataImport(masterType, parsed.rows);
      setPreview(next);
      setSourceName(googleSheetCsvUrl(sheetUrl));
      setMessage(`Synced preview from Google Sheets. ${next.filter((row) => row.status === "ok").length} row(s) ready.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Google Sheets sync failed.");
    } finally {
      setLoading(false);
    }
  }, [masterType, sheetUrl]);

  const applyMaster = async (sourceType: MigrationSourceType) => {
    if (!orgId || readOnly) return;
    setPosting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await applyMasterDataImport({
        organizationId: orgId,
        type: masterType,
        preview,
        sourceType,
        sourceName,
      });
      await markImportStepComplete();
      setMessage(`Imported ${result.inserted} new and updated ${result.updated} existing ${masterType.replace("_", " ")} row(s).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setPosting(false);
    }
  };

  const previewOpening = useCallback(async () => {
    if (!openingFile || !orgId) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const [parsed, glAccounts] = await Promise.all([
        parseMigrationFile(openingFile),
        accounts.length ? Promise.resolve(accounts) : loadGlAccounts(orgId),
      ]);
      setAccounts(glAccounts);
      const next = previewOpeningBalances(parsed.rows, glAccounts);
      setOpeningPreview(next);
      setMessage(`Previewed ${next.length} opening balance line(s).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opening balance preview failed.");
    } finally {
      setLoading(false);
    }
  }, [accounts, openingFile, orgId]);

  const postOpening = async () => {
    if (!orgId || readOnly || !openingBalanced || openingCounts.error > 0) return;
    setPosting(true);
    setError(null);
    setMessage(null);
    try {
      const lines = openingPreview.filter((row) => row.status === "ok").map((row) => row.payload);
      const { data, error: rpcError } = await supabase.rpc("post_opening_balance_import", {
        p_organization_id: orgId,
        p_as_of_date: openingDate,
        p_description: `Opening balances as at ${openingDate}`,
        p_lines: lines,
        p_source_type: openingFile ? (openingFile.name.toLowerCase().endsWith(".csv") ? "csv" : "excel") : "manual",
        p_source_name: openingFile?.name ?? null,
      });
      if (rpcError) throw new Error(rpcError.message);
      const journalId = String((data as { journal_entry_id?: string } | null)?.journal_entry_id ?? "");
      setMessage(`Opening balances posted. Journal ${journalId ? journalId.slice(0, 8) : "created"}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Posting failed.");
    } finally {
      setPosting(false);
    }
  };

  if (!orgId) {
    return <div className="p-6 text-slate-600">Select an organization before importing data.</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">Data Migration</h1>
          <p className="text-sm text-slate-600">Import existing data, sync published Google Sheets, and post opening balances.</p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate?.("accounting_journal")}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <CheckCircle2 className="h-4 w-4" />
          View journals
        </button>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200">
        {[
          ["file", "Excel / CSV"],
          ["sheets", "Google Sheets"],
          ["stock", "Opening stock"],
          ["opening", "Opening balances"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setTab(id as TabId);
              reset();
            }}
            className={`min-h-10 border-b-2 px-3 text-sm font-bold ${
              tab === id ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</div> : null}

      {tab === "file" || tab === "sheets" ? (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <label className="block">
              <span className="text-sm font-bold text-slate-800">Import type</span>
              <select
                value={masterType}
                onChange={(event) => {
                  setMasterType(event.target.value as MasterImportType);
                  reset();
                }}
                className="mt-1 min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
              >
                {MASTER_IMPORT_TYPES.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={() => downloadMigrationTemplate(masterType)}
              className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-4 w-4" />
              Download template
            </button>

            {tab === "file" ? (
              <div className="mt-4">
                <label className="block text-sm font-bold text-slate-800">File</label>
                <input
                  type="file"
                  accept=".csv,.txt,.xlsx,.xls"
                  disabled={readOnly}
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    reset();
                  }}
                  className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-emerald-600 file:px-3 file:py-2 file:text-sm file:font-bold file:text-white"
                />
                <button
                  type="button"
                  disabled={!file || loading}
                  onClick={() => void previewFile()}
                  className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                  Preview file
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <label className="block">
                  <span className="text-sm font-bold text-slate-800">Published Google Sheet URL</span>
                  <input
                    value={sheetUrl}
                    onChange={(event) => {
                      setSheetUrl(event.target.value);
                      reset();
                    }}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-3 text-sm"
                  />
                </label>
                <button
                  type="button"
                  disabled={!sheetUrl.trim() || loading}
                  onClick={() => void previewSheet()}
                  className="inline-flex min-h-10 items-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Sync preview
                </button>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-slate-600">
                  Ready <strong className="text-emerald-700">{counts.ok}</strong>, errors <strong className="text-rose-700">{counts.error}</strong>, skipped <strong>{counts.skip}</strong>
                </div>
                <button
                  type="button"
                  disabled={readOnly || counts.ok === 0 || counts.error > 0 || posting}
                  onClick={() => void applyMaster(tab === "sheets" ? "google_sheet" : file?.name.toLowerCase().endsWith(".csv") ? "csv" : "excel")}
                  className="inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-bold text-white disabled:opacity-50"
                >
                  {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Apply import
                </button>
              </div>
            </div>
            <PreviewTable rows={preview} />
          </div>
        </section>
      ) : null}

      {tab === "stock" ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <FileSpreadsheet className="h-4 w-4" />
            Opening stock uses the existing stock-count importer and posts adjustment journals automatically.
          </div>
          <StockBulkImportPanel readOnly={readOnly} />
        </div>
      ) : null}

      {tab === "opening" ? (
        <section className="grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <label className="block">
              <span className="text-sm font-bold text-slate-800">Opening balance date</span>
              <input
                type="date"
                value={openingDate}
                onChange={(event) => setOpeningDate(event.target.value)}
                className="mt-1 min-h-10 w-full rounded-md border border-slate-300 px-3 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => downloadMigrationTemplate("opening_balances")}
              className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Download className="h-4 w-4" />
              Download template
            </button>
            <label className="mt-4 block">
              <span className="text-sm font-bold text-slate-800">File</span>
              <input
                type="file"
                accept=".csv,.txt,.xlsx,.xls"
                disabled={readOnly}
                onChange={(event) => {
                  setOpeningFile(event.target.files?.[0] ?? null);
                  setOpeningPreview([]);
                }}
                className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-emerald-600 file:px-3 file:py-2 file:text-sm file:font-bold file:text-white"
              />
            </label>
            <button
              type="button"
              disabled={!openingFile || loading}
              onClick={() => void previewOpening()}
              className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
              Preview balances
            </button>
          </div>

          <div className="space-y-3">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-slate-600">
                  Debit <strong>{openingTotals.debit.toFixed(2)}</strong> | Credit <strong>{openingTotals.credit.toFixed(2)}</strong> | Ready <strong className="text-emerald-700">{openingCounts.ok}</strong>
                </div>
                <button
                  type="button"
                  disabled={readOnly || !openingBalanced || openingCounts.error > 0 || posting}
                  onClick={() => void postOpening()}
                  className="inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-bold text-white disabled:opacity-50"
                >
                  {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Post opening journal
                </button>
              </div>
              {!openingBalanced && openingPreview.length ? (
                <p className="mt-2 text-xs font-semibold text-amber-700">Debits and credits must balance before posting.</p>
              ) : null}
            </div>
            <PreviewTable rows={openingPreview} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
