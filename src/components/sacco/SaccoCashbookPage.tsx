import { useEffect, useMemo, useState } from "react";
import { ArrowRight, BookMarked, CloudDownload, Link2, RefreshCw, Scale } from "lucide-react";
import { SaccoReportToolbar } from "@/components/common/SaccoReportToolbar";
import { downloadCashbookPdf } from "@/lib/saccoReportPdf";
import { PageNotes } from "@/components/common/PageNotes";
import { useAppContext } from "@/contexts/AppContext";
import { SACCOPRO_PAGE } from "@/lib/saccoproPages";
import { useAuth } from "@/contexts/AuthContext";
import { normalizeSaccoTransactionType, saccoMemberDisplay } from "@/lib/saccoCashbookDisplay";
import { supabase } from "@/lib/supabase";

export type CashbookSacView = "journal" | "reconciliation";

export function SaccoCashbookPage({
  cashbookView = "journal",
  navigate,
}: {
  cashbookView?: CashbookSacView;
  navigate?: (page: string, state?: Record<string, unknown>) => void;
}) {
  const { user, isSuperAdmin } = useAuth();
  const { cashbook, members, formatCurrency, saccoLoading } = useAppContext();
  const canSync = Boolean(isSuperAdmin || user?.isSuperAdmin || ["admin", "manager", "accountant", "super_admin"].includes(String(user?.role ?? "").toLowerCase()));
  const [sources, setSources] = useState<Array<any>>([]);
  const [sheetUrl, setSheetUrl] = useState("");
  const [sheetName, setSheetName] = useState("Cashbook");
  const [savingSource, setSavingSource] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState("");

  const loadSources = async () => {
    if (!user?.organization_id || !canSync) return;
    const { data, error } = await supabase.from("sacco_cashbook_sync_sources").select("*").eq("organization_id", user.organization_id).order("created_at", { ascending: false });
    if (!error) setSources(data ?? []);
  };
  useEffect(() => { void loadSources(); }, [user?.organization_id, canSync]);

  const extractSpreadsheetId = (value: string) => {
    const match = value.trim().match(/\/spreadsheets\/d\/([^/?#]+)/);
    return match?.[1] ?? (value.trim().match(/^[a-zA-Z0-9_-]{20,}$/)?.[0] ?? "");
  };
  const saveSource = async () => {
    const spreadsheetId = extractSpreadsheetId(sheetUrl);
    if (!user?.organization_id || !spreadsheetId || !sheetName.trim()) { setSyncMessage("Paste a Google Sheets link (or spreadsheet ID) and the exact tab name."); return; }
    setSavingSource(true); setSyncMessage("");
    const { error } = await supabase.from("sacco_cashbook_sync_sources").upsert({ organization_id: user.organization_id, name: "Google Sheets cashbook", spreadsheet_id: spreadsheetId, sheet_name: sheetName.trim(), header_row: 1, column_map: { date: "Date", description: "Description", reference: "Reference", category: "Category", debit: "Debit", credit: "Credit", balance: "Balance", member_name: "Member" }, auto_sync_enabled: true, sync_frequency_minutes: 15 }, { onConflict: "organization_id,spreadsheet_id,sheet_name" });
    setSavingSource(false);
    if (error) { setSyncMessage(error.message); return; }
    setSheetUrl(""); setSyncMessage("Source saved. Select Sync now to bring across new rows."); await loadSources();
  };
  const syncSource = async (sourceId: string) => {
    setSyncingId(sourceId); setSyncMessage("");
    const { data, error } = await supabase.functions.invoke("sacco-google-sheets-sync", { body: { source_id: sourceId } });
    setSyncMessage(error?.message ?? data?.error ?? data?.message ?? "Sync finished."); await loadSources(); setSyncingId(null);
  };
  // During the parallel-run period, keep the visible cashbook fresh without a clerk
  // having to press a button. The server function remains idempotent, so a manual
  // Sync now and this timer can safely overlap.
  useEffect(() => {
    if (!canSync || sources.length === 0) return;
    const runDueSources = () => {
      const now = Date.now();
      sources.forEach((source) => {
        if (!source.auto_sync_enabled || syncingId === source.id) return;
        const frequency = Math.max(5, Number(source.sync_frequency_minutes || 15)) * 60_000;
        const lastSync = source.last_synced_at ? Date.parse(source.last_synced_at) : 0;
        if (!lastSync || now - lastSync >= frequency) void syncSource(source.id);
      });
    };
    runDueSources();
    const timer = window.setInterval(runDueSources, 60_000);
    return () => window.clearInterval(timer);
  }, [canSync, sources, syncingId]);

  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);

  const sorted = useMemo(
    () => cashbook.slice().sort((a, b) => a.date.localeCompare(b.date)),
    [cashbook]
  );

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <header className="flex flex-wrap items-center gap-2">
        <BookMarked className="text-violet-500" size={28} />
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Cashbook <span className="text-base font-normal text-slate-500">(system only)</span>
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {cashbookView === "journal"
              ? "Sequential journal-style lines sourced from workspace data."
              : "Spot checks and reconciliation notes — operational teller work stays in Teller."}
          </p>
        </div>
        <PageNotes ariaLabel="Cashbook help">
          <p>
            Intended for accountants and auditors. SACCO clerks and tellers post through <strong>Teller</strong>; this cashbook mirrors
            what has been synced into the workspace.
          </p>
        </PageNotes>
        <SaccoReportToolbar
          className="ml-auto"
          onPrint={() => window.print()}
          onPdf={() => {
            const today = new Date().toISOString().slice(0, 10);
            const from = sorted[0]?.date ?? today;
            const to = sorted[sorted.length - 1]?.date ?? today;
            void downloadCashbookPdf(cashbook, from, to, user?.organization_id);
          }}
        />
      </header>

      <div role="tablist" className="flex flex-wrap gap-2 text-sm border-b border-slate-100 pb-2">
        <button
          type="button"
          role="tab"
          aria-selected={cashbookView === "journal"}
          onClick={() => navigate?.(SACCOPRO_PAGE.cashbook, { cashbookView: "journal" })}
          className={`px-3 py-1.5 rounded-lg font-medium ${
            cashbookView === "journal" ? "bg-violet-100 text-violet-900" : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          Journal view
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={cashbookView === "reconciliation"}
          onClick={() => navigate?.(SACCOPRO_PAGE.cashbook, { cashbookView: "reconciliation" })}
          className={`px-3 py-1.5 rounded-lg font-medium ${
            cashbookView === "reconciliation"
              ? "bg-violet-100 text-violet-900"
              : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          Reconciliation
        </button>
      </div>

      {cashbookView === "journal" && (
        <>
          {canSync && (
            <section className="rounded-xl border border-violet-100 bg-violet-50/40 p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="rounded-lg bg-violet-100 p-2 text-violet-700"><CloudDownload size={18} /></div>
                <div className="flex-1 min-w-[240px]">
                  <h2 className="font-semibold text-slate-900">Google Sheets cashbook sync</h2>
                  <p className="mt-0.5 text-sm text-slate-600">Keep posting in the old cashbook while BOAT imports new lines. Imported rows are never duplicated; later sheet edits are flagged for review instead of silently changing a financial record.</p>
                </div>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-[1fr_180px_auto]">
                <input value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="Paste Google Sheets link or spreadsheet ID" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                <input value={sheetName} onChange={(e) => setSheetName(e.target.value)} placeholder="Exact tab name" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
                <button type="button" onClick={() => void saveSource()} disabled={savingSource} className="app-btn-secondary whitespace-nowrap"><Link2 className="h-4 w-4" />{savingSource ? "Saving…" : "Connect sheet"}</button>
              </div>
              <p className="mt-2 text-xs text-slate-500">Expected headers: Date, Description, Reference, Category, Debit, Credit, Balance and Member. While this cashbook is open, connected sources refresh every 15 minutes; the sheet must be shared with BOAT’s Google integration account.</p>
              {sources.length > 0 && <div className="mt-3 space-y-2">{sources.map((source) => <div key={source.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><div className="min-w-[200px] flex-1"><b>{source.name}</b><span className="ml-2 text-slate-500">{source.sheet_name}</span><span className="block text-xs text-slate-500">{source.last_sync_message || "Not synced yet"}</span></div><span className={`text-xs font-medium ${source.last_sync_status === "success" ? "text-emerald-700" : source.last_sync_status === "failed" ? "text-rose-700" : "text-amber-700"}`}>{source.last_sync_status || "Pending"}</span><button type="button" onClick={() => void syncSource(source.id)} disabled={syncingId === source.id} className="app-btn-primary whitespace-nowrap"><RefreshCw className={`h-4 w-4 ${syncingId === source.id ? "animate-spin" : ""}`} />{syncingId === source.id ? "Syncing…" : "Sync now"}</button></div>)}</div>}
              {syncMessage && <p className="mt-2 text-sm text-slate-700" role="status">{syncMessage}</p>}
            </section>
          )}
          {saccoLoading && <p className="text-sm text-slate-500 animate-pulse">Loading lines…</p>}
          <div className="rounded-xl border border-slate-100 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50">
              <BookMarked className="w-4 h-4 text-violet-500" />
              <span className="text-sm font-medium text-slate-800">{sorted.length} line(s)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-600 border-b border-slate-100">
                    <th className="px-4 py-2">Date</th>
                    <th className="px-4 py-2">Member</th>
                    <th className="px-4 py-2">Transaction type</th>
                    <th className="px-4 py-2">Description</th>
                    <th className="px-4 py-2 text-right">Debit</th>
                    <th className="px-4 py-2 text-right">Credit</th>
                    <th className="px-4 py-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {sorted.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                        No cashbook lines synced yet.
                      </td>
                    </tr>
                  ) : (
                    sorted.map((e) => (
                      <tr key={e.id} className="hover:bg-slate-50/80">
                        <td className="px-4 py-2 whitespace-nowrap text-slate-600">{e.date}</td>
                        <td className="px-4 py-2">{saccoMemberDisplay(e.memberName ?? memberById.get(e.memberId ?? "")?.name, memberById.get(e.memberId ?? "")?.accountNumber)}</td>
                        <td className="px-4 py-2">{normalizeSaccoTransactionType(e.category, e.debit, e.credit)}</td>
                        <td className="px-4 py-2 max-w-[280px]">
                          <div className="line-clamp-2">{e.description}</div>
                          {e.reference && (
                            <span className="text-[11px] text-slate-400">Ref {e.reference}</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(e.debit)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatCurrency(e.credit)}</td>
                        <td className="px-4 py-2 text-right tabular-nums font-medium">{formatCurrency(e.balance)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {cashbookView === "reconciliation" && (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-6 flex gap-4">
          <Scale className="text-emerald-700 shrink-0" size={24} />
          <div className="flex-1 text-sm text-emerald-950 space-y-3">
            <div><p className="font-semibold">Automated cash and bank reconciliation</p><p className="mt-1">Import statement lines, auto-match them against posted GL activity, review exceptions, and complete a standard reconciliation statement. The same workspace supports bank, cash, mobile-money and float accounts.</p></div>
            <div className="grid gap-2 sm:grid-cols-3"><div className="rounded-lg bg-white/80 p-3"><span className="block text-xs text-slate-500">Cashbook lines</span><b>{sorted.length}</b></div><div className="rounded-lg bg-white/80 p-3"><span className="block text-xs text-slate-500">Period start</span><b>{sorted[0]?.date || "—"}</b></div><div className="rounded-lg bg-white/80 p-3"><span className="block text-xs text-slate-500">Period end</span><b>{sorted[sorted.length - 1]?.date || "—"}</b></div></div>
            <button type="button" onClick={() => navigate?.("accounting_bank_reconciliation")} className="app-btn-primary"><span>Open reconciliation workspace</span><ArrowRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
