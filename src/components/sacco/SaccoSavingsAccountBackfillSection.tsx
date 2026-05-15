import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Trash2, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAppContext } from "@/contexts/AppContext";
import {
  backfillSaccoMemberSavingsAccounts,
  clearAllSaccoMemberSavingsAccounts,
  getSaccoSavingsBackfillPreview,
  type SaccoSavingsBackfillPreview,
  type SaccoSavingsBackfillResult,
} from "@/lib/saccoOpenMemberSavingsAccount";

type SaccoSavingsAccountBackfillSectionProps = {
  readOnly?: boolean;
};

export function SaccoSavingsAccountBackfillSection({ readOnly = false }: SaccoSavingsAccountBackfillSectionProps) {
  const { user } = useAuth();
  const { refreshSaccoWorkspace } = useAppContext();
  const orgId = user?.organization_id ?? null;

  const [preview, setPreview] = useState<SaccoSavingsBackfillPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [activeOnly, setActiveOnly] = useState(true);
  const [dryRun, setDryRun] = useState(true);
  const [running, setRunning] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [progress, setProgress] = useState<{ processed: number; total: number; percent: number; phaseLabel: string } | null>(
    null
  );
  const [result, setResult] = useState<SaccoSavingsBackfillResult | null>(null);

  const loadPreview = useCallback(async () => {
    if (!orgId) {
      setPreview(null);
      return;
    }
    setLoadingPreview(true);
    try {
      const p = await getSaccoSavingsBackfillPreview(orgId, { activeOnly });
      setPreview(p);
    } catch {
      setPreview(null);
    } finally {
      setLoadingPreview(false);
    }
  }, [orgId, activeOnly]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  const clearAllAccounts = async () => {
    if (!orgId || readOnly || clearing || running) return;
    const totalAccounts = preview ? preview.alreadyHadAccount : null;
    const msg =
      totalAccounts != null
        ? `Delete savings accounts for ${totalAccounts} member(s) who have one?\n\nAll savings account rows for this organization will be removed. Members stay on the register. Teller history is kept but unlinked from accounts.\n\nRun backfill again afterward to issue new numbers in member order (1, 2, 3…).`
        : "Delete ALL savings accounts for this organization?\n\nMembers stay on the register.";
    if (!confirm(msg)) return;
    if (!confirm("This cannot be undone from the app. Are you sure?")) return;

    setClearing(true);
    setResult(null);
    try {
      const { deleted } = await clearAllSaccoMemberSavingsAccounts(orgId);
      await refreshSaccoWorkspace();
      await loadPreview();
      setResult(null);
      alert(`Removed ${deleted} savings account(s). You can run backfill to start fresh.`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not remove savings accounts.");
    } finally {
      setClearing(false);
    }
  };

  const runBackfill = async () => {
    if (!orgId || readOnly || running) return;
    if (!dryRun && preview && preview.needsAccount > 0) {
      const ok = confirm(
        `Open savings accounts for ${preview.needsAccount} member(s)?\n\n` +
          `Product code: ${preview.productCode}\n` +
          `Branch code: ${preview.branchCode ?? "—"}\n\n` +
          "Account numbers follow your Savings settings format."
      );
      if (!ok) return;
    }

    setRunning(true);
    setResult(null);
    setProgress(null);
    try {
      const res = await backfillSaccoMemberSavingsAccounts({
        organizationId: orgId,
        dryRun,
        activeOnly,
        postedByStaffId: user?.id ?? null,
        postedByName: user?.full_name || user?.email || null,
        onProgress: setProgress,
      });
      setResult(res);
      if (!dryRun && res.opened > 0) {
        await refreshSaccoWorkspace();
        await loadPreview();
      }
    } catch (e) {
      setResult({
        dryRun,
        totalMembers: 0,
        alreadyHadAccount: 0,
        opened: 0,
        skipped: 0,
        failed: 1,
        errors: [e instanceof Error ? e.message : "Backfill failed"],
        openedAccounts: [],
      });
    } finally {
      setRunning(false);
    }
  };

  if (!orgId) return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="rounded-lg bg-emerald-100 p-2 text-emerald-700">
          <Users className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-slate-900">Backfill savings account numbers</h2>
          <p className="text-sm text-slate-600 mt-1">
            Create a first savings account for members who registered before auto-open was enabled. Each account number uses
            your branch code, the default savings product code from settings, and a serial equal to the member number (member
            15 → serial 15 in the account number). Members who already have an account are skipped.
          </p>
        </div>
      </div>

      {loadingPreview ? (
        <p className="text-sm text-slate-500 inline-flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Checking members…
        </p>
      ) : preview ? (
        <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <div>
            <dt className="text-xs font-medium text-slate-500">Members in scope</dt>
            <dd className="font-semibold text-slate-900">{preview.totalMembers}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Already have account</dt>
            <dd className="font-semibold text-slate-900">{preview.alreadyHadAccount}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Need account</dt>
            <dd className="font-semibold text-emerald-800">{preview.needsAccount}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Default product / branch</dt>
            <dd className="font-mono text-xs text-slate-800">
              {preview.productCode} / {preview.branchCode ?? "—"}
            </dd>
          </div>
        </dl>
      ) : null}

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
            disabled={readOnly || running}
            className="rounded border-slate-300"
          />
          Active members only
        </label>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            disabled={readOnly || running}
            className="rounded border-slate-300"
          />
          Dry run (preview only, no inserts)
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void loadPreview()}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loadingPreview ? "animate-spin" : ""}`} />
          Refresh count
        </button>
        <button
          type="button"
          onClick={() => void runBackfill()}
          disabled={readOnly || running || (preview?.needsAccount === 0 && !dryRun)}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {running ? "Running…" : dryRun ? "Dry run backfill" : "Backfill account numbers"}
        </button>
        <button
          type="button"
          onClick={() => void clearAllAccounts()}
          disabled={readOnly || running || clearing || (preview != null && preview.alreadyHadAccount === 0)}
          className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
          title="Delete all savings accounts so you can backfill again from member 1"
        >
          {clearing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          Remove all accounts
        </button>
      </div>

      {running && progress && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <div className="flex items-center justify-between text-sm text-blue-900 mb-1">
            <span>{progress.phaseLabel}</span>
            <span>
              {progress.processed}/{progress.total} ({progress.percent}%)
            </span>
          </div>
          <div className="h-2 rounded bg-blue-100 overflow-hidden">
            <div className="h-full bg-blue-600 transition-all" style={{ width: `${progress.percent}%` }} />
          </div>
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm space-y-2">
          <p className="font-medium text-slate-800">{result.dryRun ? "Dry run complete" : "Backfill complete"}</p>
          <ul className="list-disc list-inside text-slate-600 space-y-0.5">
            {result.dryRun ? (
              <li>Would open accounts for {result.opened} member(s)</li>
            ) : (
              <>
                <li>Opened: {result.opened}</li>
                {result.skipped > 0 && <li>Skipped: {result.skipped}</li>}
                {result.failed > 0 && <li>Failed: {result.failed}</li>}
              </>
            )}
            <li>Already had account: {result.alreadyHadAccount}</li>
          </ul>
          {result.errors.length > 0 && (
            <ul className="list-disc list-inside text-amber-800 text-xs mt-2">
              {result.errors.slice(0, 8).map((err, i) => (
                <li key={i}>{err}</li>
              ))}
              {result.errors.length > 8 && <li>… and {result.errors.length - 8} more</li>}
            </ul>
          )}
          {!result.dryRun && result.openedAccounts.length > 0 && result.openedAccounts.length <= 10 && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-1 pr-2">No.</th>
                    <th className="py-1 pr-2">Name</th>
                    <th className="py-1">Account</th>
                  </tr>
                </thead>
                <tbody>
                  {result.openedAccounts.map((r) => (
                    <tr key={r.accountNumber} className="font-mono">
                      <td className="py-0.5 pr-2">{r.memberNumber}</td>
                      <td className="py-0.5 pr-2 font-sans">{r.fullName}</td>
                      <td className="py-0.5">{r.accountNumber}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {preview?.needsAccount === 0 && result.errors.length === 0 && (
            <p className="text-slate-500">All members in scope already have a savings account.</p>
          )}
        </div>
      )}
    </section>
  );
}
