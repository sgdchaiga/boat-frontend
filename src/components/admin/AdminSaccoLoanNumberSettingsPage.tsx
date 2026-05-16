import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Hash, Loader2, Save } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
import { PageNotes } from "@/components/common/PageNotes";
import {
  DEFAULT_LOAN_NUMBER_SETTINGS,
  LOAN_NUMBER_SEGMENT_HELP,
  LOAN_NUMBER_SEGMENT_LABELS,
  buildLoanNumber,
  fetchSaccoLoanNumberSettings,
  normalizeNumericSegment,
  upsertSaccoLoanNumberSettings,
  type LoanNumberSegmentKind,
  type SaccoLoanNumberSettings,
} from "@/lib/saccoLoanNumberSettings";
import { SaccoBranchesSection } from "@/components/sacco/SaccoBranchesSection";
import { supabase } from "@/lib/supabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

function clampDigits(n: number): number {
  if (Number.isNaN(n)) return 2;
  return Math.min(12, Math.max(1, Math.floor(n)));
}

type LoanProductCodeRow = { id: string; name: string; loan_code: string };

type AdminSaccoLoanNumberSettingsPageProps = {
  readOnly?: boolean;
};

/** Admin: structured loan reference numbers (branch · loan product code · serial). */
export function AdminSaccoLoanNumberSettingsPage({ readOnly = false }: AdminSaccoLoanNumberSettingsPageProps) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [segmentOrder, setSegmentOrder] = useState<LoanNumberSegmentKind[]>(DEFAULT_LOAN_NUMBER_SETTINGS.segmentOrder);
  const [selectedKind, setSelectedKind] = useState<LoanNumberSegmentKind>("branch");

  const [branchDigits, setBranchDigits] = useState(String(DEFAULT_LOAN_NUMBER_SETTINGS.branchDigitCount));
  const [loanCodeDigits, setLoanCodeDigits] = useState(String(DEFAULT_LOAN_NUMBER_SETTINGS.loanCodeDigitCount));
  const [serialDigits, setSerialDigits] = useState(String(DEFAULT_LOAN_NUMBER_SETTINGS.serialDigitCount));
  const [branchValue, setBranchValue] = useState(DEFAULT_LOAN_NUMBER_SETTINGS.branchValue);
  const [loanCodeValue, setLoanCodeValue] = useState(DEFAULT_LOAN_NUMBER_SETTINGS.loanCodeValue);
  const [separator, setSeparator] = useState(DEFAULT_LOAN_NUMBER_SETTINGS.separator);
  const [loanProducts, setLoanProducts] = useState<LoanProductCodeRow[]>([]);

  const refreshLoanProducts = useCallback(async () => {
    if (!orgId) return;
    const { data, error: qErr } = await sb
      .from("sacco_loan_products")
      .select("id,name,loan_code")
      .eq("organization_id", orgId)
      .order("sort_order", { ascending: true });
    if (qErr) {
      if (String(qErr.message ?? "").includes("loan_code")) {
        const { data: d2, error: e2 } = await sb
          .from("sacco_loan_products")
          .select("id,name")
          .eq("organization_id", orgId)
          .order("sort_order", { ascending: true });
        if (!e2 && d2) {
          setLoanProducts(
            (d2 as { id: string; name: string }[]).map((r) => ({ ...r, loan_code: "1" }))
          );
        }
        return;
      }
      throw qErr;
    }
    setLoanProducts(
      (data ?? []).map((r: { id: string; name: string; loan_code?: string | null }) => ({
        id: r.id,
        name: r.name,
        loan_code: String(r.loan_code ?? "1").replace(/\D/g, "") || "1",
      }))
    );
  }, [orgId]);

  const load = useCallback(async () => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const row = await fetchSaccoLoanNumberSettings(orgId);
      await refreshLoanProducts();
      const s = row ?? DEFAULT_LOAN_NUMBER_SETTINGS;
      setSegmentOrder(s.segmentOrder);
      setBranchDigits(String(s.branchDigitCount));
      setLoanCodeDigits(String(s.loanCodeDigitCount));
      setSerialDigits(String(s.serialDigitCount));
      setBranchValue(s.branchValue);
      setLoanCodeValue(s.loanCodeValue);
      setSeparator(s.separator);
      setSelectedKind(s.segmentOrder[0] ?? "branch");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, [orgId, refreshLoanProducts]);

  useEffect(() => {
    void load();
  }, [load]);

  const previewSettings: SaccoLoanNumberSettings = useMemo(
    () => ({
      branchDigitCount: clampDigits(parseInt(branchDigits, 10)),
      loanCodeDigitCount: clampDigits(parseInt(loanCodeDigits, 10)),
      serialDigitCount: clampDigits(parseInt(serialDigits, 10)),
      branchValue,
      loanCodeValue,
      separator: separator.slice(0, 1),
      segmentOrder,
    }),
    [branchDigits, loanCodeDigits, serialDigits, branchValue, loanCodeValue, separator, segmentOrder]
  );

  const previewNumber = useMemo(
    () => buildLoanNumber(previewSettings, loanCodeValue, 1),
    [previewSettings, loanCodeValue]
  );

  const paddedSegmentForList = (kind: LoanNumberSegmentKind): string => {
    const bd = clampDigits(parseInt(branchDigits, 10));
    const ld = clampDigits(parseInt(loanCodeDigits, 10));
    const sd = clampDigits(parseInt(serialDigits, 10));
    if (kind === "branch") return normalizeNumericSegment(branchValue, bd);
    if (kind === "loan_code") return normalizeNumericSegment(loanCodeValue, ld);
    return String(1).padStart(sd, "0");
  };

  const rawCodeForList = (kind: LoanNumberSegmentKind): string => {
    if (kind === "serial") return "—";
    const raw = kind === "branch" ? branchValue : loanCodeValue;
    const only = String(raw ?? "").replace(/\D/g, "");
    return only || "0";
  };

  const moveSegment = (index: number, dir: -1 | 1) => {
    if (readOnly) return;
    setSegmentOrder((prev) => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      const t = next[index]!;
      next[index] = next[j]!;
      next[j] = t;
      return next;
    });
  };

  const selectedDigitsStr =
    selectedKind === "branch" ? branchDigits : selectedKind === "loan_code" ? loanCodeDigits : serialDigits;

  const setSelectedDigitsStr = (v: string) => {
    if (selectedKind === "branch") setBranchDigits(v);
    else if (selectedKind === "loan_code") setLoanCodeDigits(v);
    else setSerialDigits(v);
  };

  const save = async () => {
    if (readOnly || !orgId) return;
    setSaving(true);
    setError(null);
    try {
      const settings: SaccoLoanNumberSettings = {
        branchDigitCount: clampDigits(parseInt(branchDigits, 10)),
        loanCodeDigitCount: clampDigits(parseInt(loanCodeDigits, 10)),
        serialDigitCount: clampDigits(parseInt(serialDigits, 10)),
        branchValue: branchValue.trim() || "0",
        loanCodeValue: loanCodeValue.trim() || "0",
        separator: separator.slice(0, 1),
        segmentOrder,
      };
      await upsertSaccoLoanNumberSettings(orgId, settings);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const field =
    "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500";
  const label = "block text-xs font-medium text-slate-700 mb-1";

  if (!orgId) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">No organization context.</div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-600 text-sm py-12 justify-center rounded-xl border border-slate-200 bg-white">
        <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
        Loading…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3 mb-6">
          <div className="rounded-lg bg-emerald-100 p-2 text-emerald-700">
            <Hash className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-900">Loan reference numbers</h2>
              <PageNotes ariaLabel="Loan number format help">
                <p className="text-sm text-slate-700">
                  Each new loan gets a reference built from <strong>branch</strong>, <strong>loan product code</strong> (set on each loan product), and
                  a running <strong>serial</strong>. Member IDs are unchanged. Reorder segments with ↑ ↓; set digit widths on the right.
                </p>
              </PageNotes>
            </div>
          </div>
        </div>

        {readOnly && (
          <ReadOnlyNotice message="You can view this format. Editing may require an administrator role for loan settings." />
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(200px,1fr)_minmax(220px,1.2fr)_minmax(160px,0.9fr)] lg:items-stretch">
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 flex flex-col min-h-[280px]">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3">Parameters (order)</p>
            <ul className="space-y-2 flex-1">
              {segmentOrder.map((kind, idx) => (
                <li key={kind}>
                  <div
                    className={`flex items-center gap-2 rounded-lg border px-2 py-2 transition-colors ${
                      selectedKind === kind
                        ? "border-emerald-500 bg-emerald-50 shadow-sm"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <span className="text-[10px] font-mono text-slate-400 w-5 shrink-0">{idx + 1}.</span>
                    <button
                      type="button"
                      onClick={() => setSelectedKind(kind)}
                      className="flex-1 text-left text-sm font-medium text-slate-800 min-w-0"
                    >
                      <span className="block">{LOAN_NUMBER_SEGMENT_LABELS[kind]}</span>
                      <span className="block text-[10px] font-normal text-slate-500 mt-0.5 font-mono tabular-nums">
                        {kind === "serial" ? (
                          <>sample serial · {paddedSegmentForList(kind)}</>
                        ) : (
                          <>
                            code {rawCodeForList(kind)} → {paddedSegmentForList(kind)}
                          </>
                        )}
                      </span>
                    </button>
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button
                        type="button"
                        title="Move up"
                        disabled={readOnly || idx === 0}
                        onClick={() => moveSegment(idx, -1)}
                        className="rounded p-0.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        title="Move down"
                        disabled={readOnly || idx === segmentOrder.length - 1}
                        onClick={() => moveSegment(idx, 1)}
                        className="rounded p-0.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col min-h-[280px]">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3">Selected parameter</p>
            <div className="flex-1 space-y-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">{LOAN_NUMBER_SEGMENT_LABELS[selectedKind]}</p>
                <p className="text-xs text-slate-500 mt-1 leading-snug">{LOAN_NUMBER_SEGMENT_HELP[selectedKind]}</p>
                {selectedKind === "branch" && (
                  <>
                    <label className={`${label} mt-3`}>Branch code</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={branchValue}
                      onChange={(e) => setBranchValue(e.target.value)}
                      className={field}
                      placeholder="e.g. 1"
                      disabled={readOnly}
                    />
                    <p className="text-[10px] text-slate-600 mt-2 font-mono tabular-nums">
                      Padded segment:{" "}
                      <strong className="text-emerald-800">
                        {normalizeNumericSegment(branchValue, clampDigits(parseInt(branchDigits, 10)))}
                      </strong>
                    </p>
                  </>
                )}
                {selectedKind === "loan_code" && (
                  <>
                    <label className={`${label} mt-3`}>Loan code (preview)</label>
                    {loanProducts.length > 0 ? (
                      <select
                        value={loanProducts.some((t) => t.loan_code === loanCodeValue) ? loanCodeValue : ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v) setLoanCodeValue(v);
                        }}
                        className={`${field} mb-2`}
                        disabled={readOnly}
                      >
                        <option value="">Pick a loan product…</option>
                        {loanProducts.map((t) => (
                          <option key={t.id} value={t.loan_code}>
                            {t.loan_code} — {t.name}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <input
                      type="text"
                      inputMode="numeric"
                      value={loanCodeValue}
                      onChange={(e) => setLoanCodeValue(e.target.value)}
                      className={field}
                      placeholder="e.g. 1"
                      disabled={readOnly}
                    />
                    <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
                      Codes are edited per product under <strong>Loan settings → Loan products</strong>. This preview value is only for the sample below.
                    </p>
                    <p className="text-[10px] text-slate-600 mt-2 font-mono tabular-nums">
                      Padded segment:{" "}
                      <strong className="text-emerald-800">
                        {normalizeNumericSegment(loanCodeValue, clampDigits(parseInt(loanCodeDigits, 10)))}
                      </strong>
                    </p>
                  </>
                )}
                {selectedKind === "serial" && (
                  <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                    The serial is the next free number for each branch + loan code pair. Sample with serial = 1:{" "}
                    <span className="font-mono font-medium text-slate-800">{paddedSegmentForList("serial")}</span>
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col min-h-[280px]">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3">Digits (width)</p>
            <div className="flex-1">
              <label className={label}>Number of digits</label>
              <input
                type="number"
                min={1}
                max={12}
                value={selectedDigitsStr}
                onChange={(e) => setSelectedDigitsStr(e.target.value)}
                className={field}
                disabled={readOnly}
              />
              <p className="text-[10px] text-slate-500 mt-2">
                Applies to <strong className="font-medium text-slate-700">{LOAN_NUMBER_SEGMENT_LABELS[selectedKind]}</strong>. Switch parameters on the
                left to set each segment&apos;s width.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-3">
          <label className="block text-xs font-medium text-slate-700 mb-1">Separator between segments</label>
          <div className="flex flex-wrap items-end gap-4">
            <input
              type="text"
              maxLength={1}
              value={separator}
              onChange={(e) => setSeparator(e.target.value)}
              className="w-20 rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="— empty"
              disabled={readOnly}
            />
            <p className="text-xs text-slate-500 pb-2">One character between segments, or leave empty to concatenate with no separator.</p>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50/60 px-4 py-3">
          <p className="text-xs font-medium text-emerald-900">Sample loan reference (serial = 1)</p>
          <p className="text-[10px] text-emerald-800/90 mt-1">
            Uses branch code <span className="font-mono font-semibold">{rawCodeForList("branch")}</span> and loan code{" "}
            <span className="font-mono font-semibold">{rawCodeForList("loan_code")}</span> (from the selected loan product).
          </p>
          <p className="mt-1 font-mono text-lg font-semibold text-emerald-800 break-all">{previewNumber}</p>
        </div>

        <div className="mt-8 pt-6 border-t border-slate-200">
          <SaccoBranchesSection
            readOnly={readOnly}
            compact
            selectedCode={branchValue}
            onSelectCode={(code) => {
              setBranchValue(code);
              setSelectedKind("branch");
            }}
          />
        </div>

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={() => void save()}
            disabled={readOnly || saving}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save settings
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Tables: <code className="rounded bg-slate-100 px-1 font-mono">sacco_loan_number_settings</code>,{" "}
        <code className="rounded bg-slate-100 px-1 font-mono">sacco_loan_products</code> (<code className="font-mono">loan_code</code>),{" "}
        <code className="rounded bg-slate-100 px-1 font-mono">sacco_loans</code> (<code className="font-mono">loan_number</code>).
      </p>
    </div>
  );
}
