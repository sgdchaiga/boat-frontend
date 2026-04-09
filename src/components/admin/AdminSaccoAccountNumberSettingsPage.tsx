import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Hash, Loader2, Save } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
import { PageNotes } from "@/components/common/PageNotes";
import {
  DEFAULT_ACCOUNT_NUMBER_SETTINGS,
  SEGMENT_CODE_HELP,
  SEGMENT_LABELS,
  buildSavingsAccountNumber,
  fetchSaccoAccountNumberSettings,
  normalizeNumericSegment,
  upsertSaccoAccountNumberSettings,
  type SaccoAccountNumberSettings,
  type SegmentKind,
} from "@/lib/saccoAccountNumberSettings";

function clampDigits(n: number): number {
  if (Number.isNaN(n)) return 2;
  return Math.min(12, Math.max(1, Math.floor(n)));
}

type AdminSaccoAccountNumberSettingsPageProps = {
  /** When true, settings cannot be changed (e.g. role or subscription). */
  readOnly?: boolean;
};

/** Admin: format for savings *account* numbers (not member IDs — those stay 1, 2, 3…). */
export function AdminSaccoAccountNumberSettingsPage({ readOnly = false }: AdminSaccoAccountNumberSettingsPageProps) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [segmentOrder, setSegmentOrder] = useState<SegmentKind[]>(DEFAULT_ACCOUNT_NUMBER_SETTINGS.segmentOrder);
  const [selectedKind, setSelectedKind] = useState<SegmentKind>("branch");

  const [branchDigits, setBranchDigits] = useState(String(DEFAULT_ACCOUNT_NUMBER_SETTINGS.branchDigitCount));
  const [accountTypeDigits, setAccountTypeDigits] = useState(String(DEFAULT_ACCOUNT_NUMBER_SETTINGS.accountTypeDigitCount));
  const [serialDigits, setSerialDigits] = useState(String(DEFAULT_ACCOUNT_NUMBER_SETTINGS.serialDigitCount));
  const [branchValue, setBranchValue] = useState(DEFAULT_ACCOUNT_NUMBER_SETTINGS.branchValue);
  const [accountTypeValue, setAccountTypeValue] = useState(DEFAULT_ACCOUNT_NUMBER_SETTINGS.accountTypeValue);
  const [separator, setSeparator] = useState(DEFAULT_ACCOUNT_NUMBER_SETTINGS.separator);

  const load = useCallback(async () => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const row = await fetchSaccoAccountNumberSettings(orgId);
      const s = row ?? DEFAULT_ACCOUNT_NUMBER_SETTINGS;
      setSegmentOrder(s.segmentOrder);
      setBranchDigits(String(s.branchDigitCount));
      setAccountTypeDigits(String(s.accountTypeDigitCount));
      setSerialDigits(String(s.serialDigitCount));
      setBranchValue(s.branchValue);
      setAccountTypeValue(s.accountTypeValue);
      setSeparator(s.separator);
      setSelectedKind(s.segmentOrder[0] ?? "branch");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const previewSettings: SaccoAccountNumberSettings = useMemo(
    () => ({
      branchDigitCount: clampDigits(parseInt(branchDigits, 10)),
      accountTypeDigitCount: clampDigits(parseInt(accountTypeDigits, 10)),
      serialDigitCount: clampDigits(parseInt(serialDigits, 10)),
      branchValue,
      accountTypeValue,
      separator: separator.slice(0, 1),
      segmentOrder,
    }),
    [branchDigits, accountTypeDigits, serialDigits, branchValue, accountTypeValue, separator, segmentOrder]
  );

  const previewNumber = useMemo(
    () => buildSavingsAccountNumber(previewSettings, accountTypeValue, 1),
    [previewSettings, accountTypeValue]
  );

  /** Padded segment as it appears in the account number, from each parameter’s code. */
  const paddedSegmentForList = (kind: SegmentKind): string => {
    const bd = clampDigits(parseInt(branchDigits, 10));
    const ad = clampDigits(parseInt(accountTypeDigits, 10));
    const sd = clampDigits(parseInt(serialDigits, 10));
    if (kind === "branch") return normalizeNumericSegment(branchValue, bd);
    if (kind === "account_type") return normalizeNumericSegment(accountTypeValue, ad);
    return String(1).padStart(sd, "0");
  };

  const rawCodeForList = (kind: SegmentKind): string => {
    if (kind === "serial") return "—";
    const raw = kind === "branch" ? branchValue : accountTypeValue;
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
    selectedKind === "branch" ? branchDigits : selectedKind === "account_type" ? accountTypeDigits : serialDigits;

  const setSelectedDigitsStr = (v: string) => {
    if (selectedKind === "branch") setBranchDigits(v);
    else if (selectedKind === "account_type") setAccountTypeDigits(v);
    else setSerialDigits(v);
  };

  const save = async () => {
    if (readOnly || !orgId) return;
    setSaving(true);
    setError(null);
    try {
      const settings: SaccoAccountNumberSettings = {
        branchDigitCount: clampDigits(parseInt(branchDigits, 10)),
        accountTypeDigitCount: clampDigits(parseInt(accountTypeDigits, 10)),
        serialDigitCount: clampDigits(parseInt(serialDigits, 10)),
        branchValue: branchValue.trim() || "0",
        accountTypeValue: accountTypeValue.trim() || "0",
        separator: separator.slice(0, 1),
        segmentOrder,
      };
      await upsertSaccoAccountNumberSettings(orgId, settings);
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
              <h2 className="text-lg font-semibold text-slate-900">Savings account numbers</h2>
              <PageNotes ariaLabel="Savings account number format help">
                <p className="text-sm text-slate-700">
                  Member IDs stay <strong>1, 2, 3…</strong>. Each segment is filled from its <strong>numeric code</strong> (branch code and product code
                  are padded to the digit width you set). The account-type segment always uses the <strong>product code</strong> entered when opening an
                  account (e.g. code <strong>12</strong> → that segment is <strong>12</strong> padded). Select a parameter, set its code in the middle,
                  digits on the right; use ↑ ↓ to reorder segments.
                </p>
              </PageNotes>
            </div>
          </div>
        </div>

        {readOnly && (
          <ReadOnlyNotice message="You can view this format. Only roles allowed in Admin → Approval rights → Savings & member settings may edit." />
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(200px,1fr)_minmax(220px,1.2fr)_minmax(160px,0.9fr)] lg:items-stretch">
          {/* Column 1 — ordered list */}
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
                      <span className="block">{SEGMENT_LABELS[kind]}</span>
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

          {/* Column 2 — selected parameter detail */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-col min-h-[280px]">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3">Selected parameter</p>
            <div className="flex-1 space-y-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">{SEGMENT_LABELS[selectedKind]}</p>
                <p className="text-xs text-slate-500 mt-1 leading-snug">{SEGMENT_CODE_HELP[selectedKind]}</p>
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
                {selectedKind === "account_type" && (
                  <>
                    <label className={`${label} mt-3`}>Account type code (product code)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={accountTypeValue}
                      onChange={(e) => setAccountTypeValue(e.target.value)}
                      className={field}
                      placeholder="e.g. 12"
                      disabled={readOnly}
                    />
                    <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
                      When you open a savings account, the <strong>Product code</strong> field (e.g. <strong>12</strong>) is the code for this segment —
                      it must match what you use here for the preview. The system picks that code and pads it to the digit width.
                    </p>
                    <p className="text-[10px] text-slate-600 mt-2 font-mono tabular-nums">
                      Padded segment:{" "}
                      <strong className="text-emerald-800">
                        {normalizeNumericSegment(accountTypeValue, clampDigits(parseInt(accountTypeDigits, 10)))}
                      </strong>
                    </p>
                  </>
                )}
                {selectedKind === "serial" && (
                  <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                    No separate code — the serial is the next free number for each branch + product code pair. Sample with serial = 1:{" "}
                    <span className="font-mono font-medium text-slate-800">{paddedSegmentForList("serial")}</span>
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Column 3 — digits for selected segment */}
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
                Applies to <strong className="font-medium text-slate-700">{SEGMENT_LABELS[selectedKind]}</strong>. Switch parameters on the left to
                set each segment&apos;s width.
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
          <p className="text-xs font-medium text-emerald-900">Sample savings account number (serial = 1)</p>
          <p className="text-[10px] text-emerald-800/90 mt-1">
            Uses branch code <span className="font-mono font-semibold">{rawCodeForList("branch")}</span> and account type code{" "}
            <span className="font-mono font-semibold">{rawCodeForList("account_type")}</span> (same as product code when opening).
          </p>
          <p className="mt-1 font-mono text-lg font-semibold text-emerald-800 break-all">{previewNumber}</p>
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
        Tables: <code className="rounded bg-slate-100 px-1 font-mono">sacco_account_number_settings</code>,{" "}
        <code className="rounded bg-slate-100 px-1 font-mono">sacco_member_savings_accounts</code>. Segment order is stored in{" "}
        <code className="font-mono">segment_order</code>.
      </p>
    </div>
  );
}
