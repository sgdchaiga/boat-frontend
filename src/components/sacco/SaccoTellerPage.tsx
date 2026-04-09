import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  Building2,
  ClipboardCheck,
  FileBarChart,
  FileSearch,
  Landmark,
  Layers,
  Loader2,
  Lock,
  PiggyBank,
  Scale,
  ScrollText,
  Shield,
  ShieldCheck,
  UserCheck,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAppContext } from "@/contexts/AppContext";
import { GlAccountPicker, type GlAccountOption } from "@/components/common/GlAccountPicker";
import { PageNotes } from "@/components/common/PageNotes";
import {
  approveTellerTransaction,
  buildTellerReportCsv,
  closeTellerSession,
  createTellerTransaction,
  downloadCsv,
  fetchTellerDashboardSnapshot,
  fetchTellerGlAccountPickList,
  fetchTellerMemberPickList,
  fetchTellerSavingsAccountPickList,
  openTellerSession,
  rejectTellerTransaction,
  TELLER_POSTING_PURPOSE_LABELS,
  transferCashFromTillToVault,
  transferCashFromVaultToTill,
  type SaccoTellerTxnType,
  type TellerDashboardSnapshot,
  type TellerPostingPurpose,
  type TellerReportId,
} from "@/lib/saccoTellerDb";
import { fetchJournalGlSettings } from "@/lib/journalAccountSettings";

function formatUgx(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `UGX ${Math.round(n).toLocaleString("en-UG")}`;
}

function formatPostingPurpose(p: string | null | undefined): string {
  if (!p) return "—";
  return TELLER_POSTING_PURPOSE_LABELS[p as TellerPostingPurpose] ?? p;
}

type MainTab = "operations" | "vault" | "eod" | "controls" | "reports";
type OpSub = "deposit" | "withdrawal" | "cheque";

function tellerTxnSuccessMessage(opSub: OpSub, mode: "posted" | "pending_approval"): string {
  if (mode === "pending_approval") {
    if (opSub === "deposit") return "Deposit submitted for approval.";
    if (opSub === "withdrawal") return "Withdrawal submitted for approval.";
    return "Transaction submitted for approval.";
  }
  if (opSub === "deposit") return "Deposit successful.";
  if (opSub === "withdrawal") return "Withdrawal successful.";
  return "Cheque transaction posted.";
}

const field =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500";
const label = "block text-xs font-medium text-slate-600 mb-1";

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active ? "bg-emerald-600 text-white shadow-sm" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

/** SACCO teller: operations, vault/till, EOD, controls (limits, maker–checker), reports. GL hooks described inline — wire to Supabase + journal engine. */
export function SaccoTellerPage() {
  const { user, isSuperAdmin } = useAuth();
  const { refreshSaccoWorkspace } = useAppContext();
  const orgId = user?.organization_id ?? null;
  const staffId = user?.id ?? undefined;

  const [mainTab, setMainTab] = useState<MainTab>("operations");
  const [opSub, setOpSub] = useState<OpSub>("deposit");
  const [snap, setSnap] = useState<TellerDashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Physical count for EOD variance (UGX). */
  const [eodCounted, setEodCounted] = useState("");
  const [eodCloseNotes, setEodCloseNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [postingPurpose, setPostingPurpose] = useState<TellerPostingPurpose | "">("");
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [selectedSavingsAccountId, setSelectedSavingsAccountId] = useState("");
  const [pickMembers, setPickMembers] = useState<Awaited<ReturnType<typeof fetchTellerMemberPickList>>>([]);
  const [pickSavingsAccounts, setPickSavingsAccounts] = useState<Awaited<ReturnType<typeof fetchTellerSavingsAccountPickList>>>([]);
  const [glAccountOptions, setGlAccountOptions] = useState<GlAccountOption[]>([]);
  const [counterpartyGlAccountId, setCounterpartyGlAccountId] = useState("");
  /** From journal_gl_settings: per-transaction picker vs fixed default. */
  const [journalTellerGl, setJournalTellerGl] = useState<{
    allowPerTxn: boolean;
    defaultId: string | null;
  }>({ allowPerTxn: true, defaultId: null });
  const [pickListsLoading, setPickListsLoading] = useState(false);
  const [amountStr, setAmountStr] = useState("");
  const [narration, setNarration] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [chequeBank, setChequeBank] = useState("");
  const [chequeAmountStr, setChequeAmountStr] = useState("");
  const [chequeValueDate, setChequeValueDate] = useState("");
  const [chequePayeeRef, setChequePayeeRef] = useState("");
  const [chequeFlow, setChequeFlow] = useState<"received" | "paid" | "clearing">("received");

  const [openFloatStr, setOpenFloatStr] = useState("");
  const [openSessionNotes, setOpenSessionNotes] = useState("");
  const [vaultXferStr, setVaultXferStr] = useState("");
  const [vaultXferNote, setVaultXferNote] = useState("");
  /** Reject reason draft per pending transaction id */
  const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({});

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!orgId) {
      setSnap(null);
      setLoading(false);
      return;
    }
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchTellerDashboardSnapshot(orgId, staffId);
      setSnap(data);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load teller data");
      setSnap(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [orgId, staffId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!orgId) {
      setPickMembers([]);
      setPickSavingsAccounts([]);
      setGlAccountOptions([]);
      setJournalTellerGl({ allowPerTxn: true, defaultId: null });
      return;
    }
    let cancelled = false;
    setPickListsLoading(true);
    void Promise.all([
      fetchTellerMemberPickList(orgId),
      fetchTellerSavingsAccountPickList(orgId),
      fetchTellerGlAccountPickList(orgId, isSuperAdmin),
    ]).then(([m, s, gl]) => {
      if (!cancelled) {
        setPickMembers(m);
        setPickSavingsAccounts(s);
        setGlAccountOptions(
          gl.map((a) => ({
            id: a.id,
            account_code: a.account_code,
            account_name: a.account_name,
          }))
        );
      }
    }).finally(() => {
      if (!cancelled) setPickListsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [orgId, isSuperAdmin]);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void fetchJournalGlSettings(orgId).then((s) => {
      if (cancelled || !s) return;
      setJournalTellerGl({
        allowPerTxn: s.teller_allow_per_transaction_counterparty_gl,
        defaultId: s.teller_default_counterparty_gl_id,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  useEffect(() => {
    if (postingPurpose === "savings") setSelectedMemberId("");
    else setSelectedSavingsAccountId("");
  }, [postingPurpose]);

  useEffect(() => {
    if (opSub === "cheque") setCounterpartyGlAccountId("");
  }, [opSub]);

  /** Refetch member/savings/GL pick lists without the full-page loading state (e.g. after posting so balances update). */
  const refreshPickListsSilently = useCallback(async () => {
    if (!orgId) return;
    const [m, s, gl] = await Promise.all([
      fetchTellerMemberPickList(orgId),
      fetchTellerSavingsAccountPickList(orgId),
      fetchTellerGlAccountPickList(orgId, isSuperAdmin),
    ]);
    setPickMembers(m);
    setPickSavingsAccounts(s);
    setGlAccountOptions(
      gl.map((a) => ({
        id: a.id,
        account_code: a.account_code,
        account_name: a.account_name,
      }))
    );
  }, [orgId, isSuperAdmin]);

  const counterpartyGlLabel = useMemo(() => {
    const fmt = (id: string | null | undefined) => {
      if (!id) return "—";
      const a = glAccountOptions.find((x) => x.id === id);
      if (a) return `${a.account_code} — ${a.account_name}`;
      return `${id.slice(0, 8)}…`;
    };
    return fmt;
  }, [glAccountOptions]);

  const effectiveCounterpartyGlId = useMemo(() => {
    if (journalTellerGl.allowPerTxn) return counterpartyGlAccountId;
    return journalTellerGl.defaultId ?? "";
  }, [journalTellerGl.allowPerTxn, journalTellerGl.defaultId, counterpartyGlAccountId]);

  const eodExpected = snap?.tillEstimated ?? null;
  const eodCountedNum = eodCounted.trim() === "" ? NaN : Number(eodCounted);
  const eodVariance =
    eodExpected !== null && !Number.isNaN(eodCountedNum) && eodCounted.trim() !== ""
      ? Math.round(eodCountedNum) - eodExpected
      : null;

  const canMutate = Boolean(orgId && staffId && !snap?.schemaMissing);

  const runMutation = useCallback(
    async (
      fn: () => Promise<void>,
      options?: { successMessage?: string; silentRefresh?: boolean }
    ) => {
      if (!canMutate || !orgId || !staffId) return;
      setSaving(true);
      setActionMessage(null);
      try {
        await fn();
        setActionMessage({ kind: "ok", text: options?.successMessage ?? "Saved." });
        await load({ silent: options?.silentRefresh !== false });
      } catch (e) {
        setActionMessage({ kind: "err", text: e instanceof Error ? e.message : "Action failed" });
      } finally {
        setSaving(false);
      }
    },
    [canMutate, orgId, staffId, load]
  );

  const handleOpenSession = () =>
    runMutation(async () => {
      const v = Number(openFloatStr);
      if (!Number.isFinite(v) || v < 0) throw new Error("Enter a valid opening float (UGX).");
      await openTellerSession({
        organizationId: orgId!,
        staffId: staffId!,
        openingFloat: Math.round(v),
        notes: openSessionNotes.trim() || null,
      });
      setOpenFloatStr("");
      setOpenSessionNotes("");
    });

  const handleVaultFrom = () =>
    runMutation(async () => {
      const sess = snap?.openSession;
      if (!sess) throw new Error("Open a till session first.");
      const v = Number(vaultXferStr);
      if (!Number.isFinite(v) || v <= 0) throw new Error("Enter a positive amount.");
      await transferCashFromVaultToTill({
        organizationId: orgId!,
        staffId: staffId!,
        sessionId: sess.id,
        amount: Math.round(v),
        narration: vaultXferNote.trim() || null,
      });
      setVaultXferStr("");
      setVaultXferNote("");
    });

  const handleVaultTo = () =>
    runMutation(async () => {
      const sess = snap?.openSession;
      if (!sess) throw new Error("Open a till session first.");
      const v = Number(vaultXferStr);
      if (!Number.isFinite(v) || v <= 0) throw new Error("Enter a positive amount.");
      await transferCashFromTillToVault({
        organizationId: orgId!,
        staffId: staffId!,
        sessionId: sess.id,
        amount: Math.round(v),
        narration: vaultXferNote.trim() || null,
      });
      setVaultXferStr("");
      setVaultXferNote("");
    });

  const handlePostTxn = (mode: "posted" | "pending_approval") =>
    runMutation(async () => {
      const sess = snap?.openSession;
      if (!sess) throw new Error("Open a till session before posting.");
      if (!postingPurpose) throw new Error("Select posting purpose (savings, membership fee, etc.).");

      let saccoMemberId: string | null = null;
      let saccoMemberSavingsAccountId: string | null = null;
      let memRef: string | null = null;

      if (postingPurpose === "savings") {
        if (!selectedSavingsAccountId) throw new Error("Select a savings account.");
        const acc = pickSavingsAccounts.find((a) => a.id === selectedSavingsAccountId);
        if (!acc) throw new Error("Savings account not found — refresh the page.");
        saccoMemberId = acc.sacco_member_id;
        saccoMemberSavingsAccountId = acc.id;
        memRef = `${acc.member_number} — ${acc.full_name} (${acc.account_number} · ${acc.savings_product_code})`;
      } else {
        if (!selectedMemberId) throw new Error("Select a member.");
        const mem = pickMembers.find((m) => m.id === selectedMemberId);
        if (!mem) throw new Error("Member not found — refresh the page.");
        saccoMemberId = mem.id;
        memRef = `${mem.member_number} — ${mem.full_name}`;
      }

      let txnType: SaccoTellerTxnType;
      let amtStr = amountStr;
      let nar = narration.trim() || null;
      let chq: { chequeNumber?: string | null; chequeBank?: string | null; chequeValueDate?: string | null } = {};
      if (opSub === "deposit") {
        txnType = "cash_deposit";
      } else if (opSub === "withdrawal") {
        txnType = "cash_withdrawal";
      } else {
        amtStr = chequeAmountStr;
        chq = {
          chequeNumber: chequeNo.trim() || null,
          chequeBank: chequeBank.trim() || null,
          chequeValueDate: chequeValueDate || null,
        };
        if (chequeFlow === "received") txnType = "cheque_received";
        else if (chequeFlow === "paid") txnType = "cheque_paid";
        else txnType = "cheque_clearing";
        const payee = chequePayeeRef.trim();
        if (payee) memRef = memRef ? `${memRef} · ${payee}` : payee;
      }
      const amt = Number(amtStr);
      if (!Number.isFinite(amt) || amt < 0) throw new Error("Enter a valid amount.");
      if (txnType === "cash_deposit" || txnType === "cash_withdrawal") {
        if (!effectiveCounterpartyGlId) {
          if (journalTellerGl.allowPerTxn) {
            throw new Error("Select the GL account used for the journal entry (counterparty to till cash).");
          }
          throw new Error(
            "Set a default counterparty GL in Accounting → Journal account settings, or enable per-transaction GL selection."
          );
        }
      }
      await createTellerTransaction({
        organizationId: orgId!,
        staffId: staffId!,
        sessionId: sess.id,
        txnType,
        amount: Math.round(amt),
        saccoMemberId,
        saccoMemberSavingsAccountId,
        postingPurpose,
        counterpartyGlAccountId:
          txnType === "cash_deposit" || txnType === "cash_withdrawal" ? effectiveCounterpartyGlId : null,
        memberRef: memRef,
        narration: nar,
        ...chq,
        mode,
      });

      if (opSub === "deposit" || opSub === "withdrawal") {
        setAmountStr("");
        setNarration("");
        if (journalTellerGl.allowPerTxn) setCounterpartyGlAccountId("");
      } else {
        setChequeNo("");
        setChequeBank("");
        setChequeAmountStr("");
        setChequeValueDate("");
        setChequePayeeRef("");
        setNarration("");
      }
      setSelectedMemberId("");
      setSelectedSavingsAccountId("");
      setPostingPurpose("");
      await refreshPickListsSilently();
      await refreshSaccoWorkspace();
    }, { successMessage: tellerTxnSuccessMessage(opSub, mode) });

  const handleEodClose = () =>
    runMutation(async () => {
      const sess = snap?.openSession;
      if (!sess) throw new Error("No open session to close.");
      const expectedBal = snap?.tillEstimated;
      if (expectedBal === null || expectedBal === undefined) throw new Error("Expected balance unavailable — refresh or check session.");
      if (eodCounted.trim() === "" || Number.isNaN(eodCountedNum)) throw new Error("Enter counted cash.");
      const counted = Math.round(eodCountedNum);
      const overShort = counted - expectedBal;
      await closeTellerSession({
        organizationId: orgId!,
        staffId: staffId!,
        sessionId: sess.id,
        closingCounted: counted,
        expectedBalance: expectedBal,
        overShort,
        notes: eodCloseNotes.trim() || null,
      });
      setEodCounted("");
      setEodCloseNotes("");
    });

  const handleApprovePending = (transactionId: string) =>
    runMutation(async () => {
      await approveTellerTransaction({
        organizationId: orgId!,
        transactionId,
        checkerStaffId: staffId!,
      });
      setRejectNotes((prev) => {
        const next = { ...prev };
        delete next[transactionId];
        return next;
      });
      await refreshSaccoWorkspace();
    });

  const handleRejectPending = (transactionId: string) =>
    runMutation(async () => {
      const reason = rejectNotes[transactionId] ?? "";
      await rejectTellerTransaction({
        organizationId: orgId!,
        transactionId,
        checkerStaffId: staffId!,
        reason: reason.trim() || null,
      });
      setRejectNotes((prev) => {
        const next = { ...prev };
        delete next[transactionId];
        return next;
      });
    });

  const reportCards = useMemo(
    () => [
      {
        id: "cash_position" as TellerReportId,
        title: "Teller cash position",
        desc: "Per-till cash on hand vs expected float, by denomination (when configured).",
        icon: Wallet,
      },
      {
        id: "daily_summary" as TellerReportId,
        title: "Daily transactions summary",
        desc: "All teller postings for the day: deposits, withdrawals, cheques, adjustments.",
        icon: FileBarChart,
      },
      {
        id: "cash_movement" as TellerReportId,
        title: "Cash movement report",
        desc: "Inflows and outflows between vault, till, and transit (cheques clearing).",
        icon: Layers,
      },
      {
        id: "over_short" as TellerReportId,
        title: "Over / short report",
        desc: "Variances at till close and EOD with teller and supervisor sign-off references.",
        icon: Scale,
      },
      {
        id: "audit_logs" as TellerReportId,
        title: "Audit logs",
        desc: "Immutable trail: who did what, when, before/after balances, checker actions.",
        icon: FileSearch,
      },
    ],
    []
  );

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6 pb-16">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-emerald-700">
              <Banknote className="w-8 h-8 shrink-0" />
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Teller</h1>
              <PageNotes ariaLabel="Teller help and notes" variant="comment">
                <p>
                  Process cash and cheques, manage <strong>till</strong> and <strong>vault</strong> balances, enforce <strong>limits</strong> and{" "}
                  <strong>maker–checker</strong> approval, and post in real time to <strong>member / loan accounts</strong> and the{" "}
                  <strong>general ledger</strong>. End-of-day balancing and full audit trail are built into the workflow below.
                </p>
                <p>
                  <span className="font-medium text-slate-800">GL posting:</span> each confirmed transaction will generate balanced journal lines (cash /
                  bank, member savings or loan, fees) via the same journal engine as manual journals — implement server-side posting with idempotency
                  keys. Rows below write to <code className="text-xs bg-slate-100 px-1 rounded">sacco_teller_transactions</code> as posted or pending
                  approval.
                </p>
                <p>
                  <span className="font-medium text-slate-800">Till &amp; vault:</span> till is physical cash at the station; vault is the branch
                  reserve. Movements post to cash-on-hand GL and adjust vault on transfers.
                </p>
                <p>
                  <span className="font-medium text-slate-800">Reports:</span> run from structured teller and journal data. Download buttons are
                  previews until report endpoints or Supabase views are connected.
                </p>
                <p className="font-medium text-slate-800">Maker–checker</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>You can approve or reject from the queue (including your own submission when working solo)</li>
                  <li>Checker action logged with timestamp</li>
                  <li>Rejected items return to maker with reason</li>
                </ul>
                <p>
                  <span className="font-medium text-slate-800">Controls / GL:</span> limits are configured per role and branch in admin. Successful
                  posts create journal batches: tie each line to <code className="text-xs bg-slate-100 px-1 rounded">teller_transaction_id</code> for
                  traceability and reversal support.
                </p>
                <p className="font-medium text-slate-800">Dual control &amp; audit</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>Vault open/close and large vault transfers require two authorised users.</li>
                  <li>High-value teller transactions require checker approval (four-eyes).</li>
                  <li>Every state change writes an append-only audit row (who, what, when, old/new snapshot).</li>
                  <li>Optional: biometric or device binding for sensitive actions (future).</li>
                </ul>
              </PageNotes>
            </div>
          </div>
        </div>

        {loadError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{loadError}</div>
        )}
        {actionMessage && (
          <div
            className={`rounded-lg border px-3 py-2 text-sm ${
              actionMessage.kind === "ok"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-red-200 bg-red-50 text-red-800"
            }`}
          >
            {actionMessage.text}
          </div>
        )}
        {snap?.schemaMissing && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            Teller tables are not installed. Run{" "}
            <code className="rounded bg-amber-100 px-1 font-mono text-xs">20260426120007_sacco_teller.sql</code> and{" "}
            <code className="rounded bg-amber-100 px-1 font-mono text-xs">20260426120008_sacco_teller_txn_types_vault.sql</code>,{" "}
            <code className="rounded bg-amber-100 px-1 font-mono text-xs">20260426120009_sacco_teller_posting_purpose.sql</code> in Supabase SQL
            Editor, then refresh.
          </div>
        )}

        {/* Live position strip — from sacco_teller_sessions, transactions, vault_movements */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">Till (est.)</p>
            <p className="text-xl font-semibold tabular-nums text-emerald-900">
              {loading ? "…" : formatUgx(snap?.tillEstimated ?? null)}
            </p>
            <p className="text-[10px] text-emerald-700/90 mt-0.5">
              {snap?.openSession ? "Open session — posted txns included" : "Open a till session to accrue"}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Vault position</p>
            <p className="text-xl font-semibold tabular-nums text-slate-900">
              {loading ? "…" : formatUgx(snap?.vaultPosition ?? 0)}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">Σ vault movements (baseline 0)</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Session</p>
            <p className="text-sm font-medium text-slate-900">
              {loading ? "…" : snap?.openSession ? "Open" : "Not opened"}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">
              {snap?.openSession ? `Since ${new Date(snap.openSession.opened_at).toLocaleString()}` : "Open a session under Till & vault"}
            </p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-900">Pending approval</p>
            <p className="text-xl font-semibold tabular-nums text-amber-950">{loading ? "…" : snap?.pendingApprovalCount ?? 0}</p>
            <p className="text-[10px] text-amber-800/90 mt-0.5">Maker–checker queue</p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || !orgId}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            Refresh
          </button>
          {!orgId ? <span>Link staff to an organization to load teller data.</span> : null}
        </div>
      </header>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        <TabButton active={mainTab === "operations"} onClick={() => setMainTab("operations")}>
          <ArrowDownToLine className="w-4 h-4" />
          Operations
        </TabButton>
        <TabButton active={mainTab === "vault"} onClick={() => setMainTab("vault")}>
          <Landmark className="w-4 h-4" />
          Till &amp; vault
        </TabButton>
        <TabButton active={mainTab === "eod"} onClick={() => setMainTab("eod")}>
          <ClipboardCheck className="w-4 h-4" />
          End of day
        </TabButton>
        <TabButton active={mainTab === "controls"} onClick={() => setMainTab("controls")}>
          <Shield className="w-4 h-4" />
          Controls
        </TabButton>
        <TabButton active={mainTab === "reports"} onClick={() => setMainTab("reports")}>
          <ScrollText className="w-4 h-4" />
          Reports
        </TabButton>
      </div>

      {/* ——— Operations ——— */}
      {mainTab === "operations" && (
        <div className="space-y-6">
          {!snap?.openSession && canMutate && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              Open a till session on the <strong>Till &amp; vault</strong> tab before posting.
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {(
              [
                ["deposit", "Cash deposit", PiggyBank],
                ["withdrawal", "Cash withdrawal", ArrowUpFromLine],
                ["cheque", "Cheque", Building2],
              ] as const
            ).map(([id, name, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setOpSub(id)}
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
                  opSub === id ? "bg-emerald-100 text-emerald-900 ring-2 ring-emerald-500" : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                }`}
              >
                <Icon className="w-4 h-4" />
                {name}
              </button>
            ))}
          </div>

          <div className="grid gap-6">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
              <h2 className="text-sm font-semibold text-slate-800 border-b border-slate-100 pb-2">
                {opSub === "deposit" && "Cash deposit"}
                {opSub === "withdrawal" && "Cash withdrawal"}
                {opSub === "cheque" && "Cheque transaction"}
              </h2>

              {pickListsLoading ? (
                <p className="text-xs text-slate-500 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Loading members and savings accounts…
                </p>
              ) : null}

              <div className="space-y-3 rounded-lg border border-slate-100 bg-slate-50/80 p-3">
                <div>
                  <label className={label}>Posting purpose</label>
                  <select
                    className={`${field} [color-scheme:light]`}
                    value={postingPurpose}
                    onChange={(ev) => {
                      const v = ev.target.value;
                      setPostingPurpose(v === "" ? "" : (v as TellerPostingPurpose));
                    }}
                    disabled={!canMutate || pickListsLoading}
                  >
                    <option value="">Select purpose…</option>
                    {(Object.keys(TELLER_POSTING_PURPOSE_LABELS) as TellerPostingPurpose[]).map((k) => (
                      <option key={k} value={k}>
                        {TELLER_POSTING_PURPOSE_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>
                {postingPurpose === "savings" && (
                  <div>
                    <label className={label}>Savings account</label>
                    <select
                      className={`${field} [color-scheme:light]`}
                      value={selectedSavingsAccountId}
                      onChange={(ev) => setSelectedSavingsAccountId(ev.target.value)}
                      disabled={!canMutate || pickListsLoading}
                    >
                      <option value="">{pickSavingsAccounts.length === 0 ? "No savings accounts — open one in SACCO" : "Select account…"}</option>
                      {pickSavingsAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.member_number} — {a.full_name} · {a.account_number} ({a.savings_product_code}) — bal {formatUgx(a.balance)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {postingPurpose && postingPurpose !== "savings" && (
                  <div>
                    <label className={label}>Member</label>
                    <select
                      className={`${field} [color-scheme:light]`}
                      value={selectedMemberId}
                      onChange={(ev) => setSelectedMemberId(ev.target.value)}
                      disabled={!canMutate || pickListsLoading}
                    >
                      <option value="">{pickMembers.length === 0 ? "No active members" : "Select member…"}</option>
                      {pickMembers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.member_number} — {m.full_name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {opSub !== "cheque" && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className={label}>Amount (UGX)</label>
                      <input
                        className={`${field} tabular-nums`}
                        type="number"
                        min={0}
                        placeholder="0"
                        value={amountStr}
                        onChange={(ev) => setAmountStr(ev.target.value)}
                      />
                    </div>
                    <div>
                      <label className={label}>Narration</label>
                      <input
                        className={field}
                        placeholder="Optional note (shown on receipt)"
                        value={narration}
                        onChange={(ev) => setNarration(ev.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className={label}>GL account (journal)</label>
                    <p className="text-[10px] text-slate-500 mb-1.5 leading-snug">
                      Counterparty to till cash on the journal — e.g. member savings liability, fees income, or other posting purpose account.
                    </p>
                    {journalTellerGl.allowPerTxn ? (
                      <GlAccountPicker
                        value={counterpartyGlAccountId}
                        onChange={setCounterpartyGlAccountId}
                        options={glAccountOptions}
                        disabled={!canMutate || pickListsLoading}
                        emptyOption={{
                          label: glAccountOptions.length === 0 ? "No GL accounts — add in Chart of accounts" : "Select GL account…",
                        }}
                        className={field}
                      />
                    ) : (
                      <div
                        className={`${field} text-sm text-slate-800 bg-slate-50 border-slate-200`}
                        title="Configured under Accounting → Journal account settings"
                      >
                        {journalTellerGl.defaultId ? (
                          counterpartyGlLabel(journalTellerGl.defaultId)
                        ) : (
                          <span className="text-amber-800">
                            No default set — open Journal account settings (admin) and choose a default counterparty GL, or enable per-transaction
                            selection.
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}

              {opSub === "cheque" && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className={label}>Cheque number</label>
                      <input className={field} placeholder="Cheque #" value={chequeNo} onChange={(ev) => setChequeNo(ev.target.value)} />
                    </div>
                    <div>
                      <label className={label}>Drawee bank</label>
                      <input className={field} placeholder="Bank name" value={chequeBank} onChange={(ev) => setChequeBank(ev.target.value)} />
                    </div>
                    <div>
                      <label className={label}>Amount (UGX)</label>
                      <input
                        className={`${field} tabular-nums`}
                        type="number"
                        min={0}
                        value={chequeAmountStr}
                        onChange={(ev) => setChequeAmountStr(ev.target.value)}
                      />
                    </div>
                    <div>
                      <label className={label}>Value / clearing date</label>
                      <input className={field} type="date" value={chequeValueDate} onChange={(ev) => setChequeValueDate(ev.target.value)} />
                    </div>
                  </div>
                  <div>
                    <label className={label}>Payee / extra ref (optional)</label>
                    <input
                      className={field}
                      placeholder="Appended to member line on the voucher"
                      value={chequePayeeRef}
                      onChange={(ev) => setChequePayeeRef(ev.target.value)}
                    />
                  </div>
                  <div>
                    <label className={label}>Transaction type</label>
                    <select
                      className={`${field} [color-scheme:light]`}
                      value={chequeFlow}
                      onChange={(ev) => setChequeFlow(ev.target.value as "received" | "paid" | "clearing")}
                    >
                      <option value="received">Cheque received (on-us / deposit)</option>
                      <option value="paid">Cheque paid (withdrawal)</option>
                      <option value="clearing">Cheque in clearing / transit</option>
                    </select>
                  </div>
                  <div>
                    <label className={label}>Narration</label>
                    <input
                      className={field}
                      placeholder="Purpose of transaction"
                      value={narration}
                      onChange={(ev) => setNarration(ev.target.value)}
                    />
                  </div>
                </>
              )}

              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  disabled={saving || !canMutate || pickListsLoading}
                  onClick={() => void handlePostTxn("posted")}
                  className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                >
                  Post now
                </button>
                <button
                  type="button"
                  disabled={saving || !canMutate || pickListsLoading}
                  onClick={() => void handlePostTxn("pending_approval")}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                >
                  Submit for approval
                </button>
              </div>
              <p className="text-[10px] text-slate-500">
                Amounts above the single-transaction or daily cumulative limit route to the checker queue instead of immediate post.
              </p>
            </div>

          </div>

          {typeof snap?.pendingApprovalCount === "number" && snap.pendingApprovalCount > 0 ? (
            <p className="text-xs font-medium text-amber-900">
              {snap.pendingApprovalCount} pending — review the queue below.
            </p>
          ) : null}

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-slate-100 bg-amber-50/80 text-sm font-medium text-slate-800 flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-amber-700" />
              Pending approval queue
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                    <th className="p-3">Created</th>
                    <th className="p-3">Purpose</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">GL account</th>
                    <th className="p-3">Amount</th>
                    <th className="p-3">Maker</th>
                    <th className="p-3">Narration</th>
                    <th className="p-3 min-w-[220px]">Checker</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700">
                  {(snap?.pendingApprovals?.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-slate-500">
                        No transactions awaiting approval.
                      </td>
                    </tr>
                  ) : (
                    snap!.pendingApprovals.map((t) => {
                      const isMaker = Boolean(staffId && t.maker_staff_id === staffId);
                      return (
                        <tr key={t.id} className="border-b border-slate-50 align-top">
                          <td className="p-3 whitespace-nowrap text-xs">{new Date(t.created_at).toLocaleString()}</td>
                          <td className="p-3 text-xs">{formatPostingPurpose(t.posting_purpose)}</td>
                          <td className="p-3 font-mono text-xs">{t.txn_type}</td>
                          <td className="p-3 text-xs max-w-[14rem] break-words">{counterpartyGlLabel(t.counterparty_gl_account_id)}</td>
                          <td className="p-3 tabular-nums">{formatUgx(t.amount)}</td>
                          <td className="p-3 font-mono text-xs text-slate-600">{t.maker_staff_id ? `${t.maker_staff_id.slice(0, 8)}…` : "—"}</td>
                          <td className="p-3 text-xs max-w-xs break-words">{t.narration ?? "—"}</td>
                          <td className="p-3">
                            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                              {isMaker ? (
                                <p className="text-[10px] text-slate-500 w-full sm:max-w-[11rem] leading-snug">
                                  You submitted this item — you can still approve or reject it here.
                                </p>
                              ) : null}
                              <input
                                className={`${field} text-xs py-1.5`}
                                placeholder="Reject reason"
                                disabled={!canMutate || saving}
                                value={rejectNotes[t.id] ?? ""}
                                onChange={(ev) => setRejectNotes((prev) => ({ ...prev, [t.id]: ev.target.value }))}
                              />
                              <button
                                type="button"
                                disabled={saving || !canMutate}
                                onClick={() => void handleApprovePending(t.id)}
                                className="rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                disabled={saving || !canMutate}
                                onClick={() => void handleRejectPending(t.id)}
                                className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-900 hover:bg-red-100 disabled:opacity-50 whitespace-nowrap"
                              >
                                Reject
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ——— Till & vault ——— */}
      {mainTab === "vault" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm">
              <Wallet className="w-5 h-5 text-emerald-600" />
              Till (working cash)
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
              <div className="flex justify-between py-1">
                <span className="text-slate-500">Opening float</span>
                <span className="font-mono tabular-nums">{snap?.openSession ? formatUgx(snap.openSession.opening_float) : "—"}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-500">+ Receipts (posted)</span>
                <span className="font-mono tabular-nums">{formatUgx(snap?.sessionReceiptsTotal ?? 0)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-500">− Payments (posted)</span>
                <span className="font-mono tabular-nums">{formatUgx(snap?.sessionPaymentsTotal ?? 0)}</span>
              </div>
              <div className="flex justify-between py-2 border-t border-slate-200 font-semibold text-slate-900">
                <span>Expected balance</span>
                <span className="font-mono tabular-nums">{formatUgx(snap?.tillEstimated ?? null)}</span>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4 space-y-3">
              <p className="text-xs font-medium text-slate-800">Till session</p>
              {!snap?.openSession ? (
                <div className="space-y-2">
                  <div>
                    <label className={label}>Opening float (UGX)</label>
                    <input
                      className={`${field} tabular-nums`}
                      type="number"
                      min={0}
                      placeholder="0"
                      value={openFloatStr}
                      onChange={(ev) => setOpenFloatStr(ev.target.value)}
                    />
                  </div>
                  <div>
                    <label className={label}>Notes (optional)</label>
                    <input className={field} value={openSessionNotes} onChange={(ev) => setOpenSessionNotes(ev.target.value)} />
                  </div>
                  <button
                    type="button"
                    disabled={saving || !canMutate}
                    onClick={() => void handleOpenSession()}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Open till session
                  </button>
                </div>
              ) : (
                <p className="text-xs text-emerald-800">
                  Session open — close from <strong>End of day</strong> after balancing.
                </p>
              )}
            </div>

            <div className="border-t border-slate-100 pt-4 space-y-2">
              <p className="text-xs font-medium text-slate-800">Vault ↔ till transfer</p>
              <div>
                <label className={label}>Amount (UGX)</label>
                <input
                  className={`${field} tabular-nums`}
                  type="number"
                  min={0}
                  placeholder="0"
                  value={vaultXferStr}
                  onChange={(ev) => setVaultXferStr(ev.target.value)}
                />
              </div>
              <div>
                <label className={label}>Note (optional)</label>
                <input className={field} value={vaultXferNote} onChange={(ev) => setVaultXferNote(ev.target.value)} />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={saving || !canMutate}
                  onClick={() => void handleVaultFrom()}
                  className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                >
                  Cash from vault → till
                </button>
                <button
                  type="button"
                  disabled={saving || !canMutate}
                  onClick={() => void handleVaultTo()}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                >
                  Till → return to vault
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm">
              <Lock className="w-5 h-5 text-slate-600" />
              Vault (branch reserve)
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
              <div className="flex justify-between py-1">
                <span className="text-slate-500">Vault position (Σ movements)</span>
                <span className="font-mono tabular-nums font-semibold">{formatUgx(snap?.vaultPosition ?? 0)}</span>
              </div>
              <div className="flex justify-between py-1 text-xs text-slate-500">
                <span>Configure opening vault baseline</span>
                <span className="text-slate-400">optional future setting</span>
              </div>
            </div>
            <p className="text-[10px] text-slate-500">
              Tables: <code className="rounded bg-slate-100 px-1">sacco_teller_sessions</code>,{" "}
              <code className="rounded bg-slate-100 px-1">sacco_vault_movements</code>.
            </p>
          </div>

          <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/80 text-sm font-medium text-slate-800">
              Recent teller transactions
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                    <th className="p-3">Time</th>
                    <th className="p-3">Purpose</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Member / account</th>
                    <th className="p-3">GL account</th>
                    <th className="p-3">Amount</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Journal</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700">
                  {(snap?.recentTransactions?.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-slate-500 text-sm">
                        No transactions yet — post from Operations after sessions and GL wiring are enabled.
                      </td>
                    </tr>
                  ) : (
                    snap!.recentTransactions.map((t) => (
                      <tr key={t.id} className="border-b border-slate-50">
                        <td className="p-3 whitespace-nowrap text-xs">{new Date(t.created_at).toLocaleString()}</td>
                        <td className="p-3 text-xs">{formatPostingPurpose(t.posting_purpose)}</td>
                        <td className="p-3 font-mono text-xs">{t.txn_type}</td>
                        <td className="p-3 text-xs max-w-[14rem] break-words">{t.member_ref ?? "—"}</td>
                        <td className="p-3 text-xs max-w-[14rem] break-words">{counterpartyGlLabel(t.counterparty_gl_account_id)}</td>
                        <td className="p-3 tabular-nums">{formatUgx(t.amount)}</td>
                        <td className="p-3 text-xs">{t.status}</td>
                        <td className="p-3 font-mono text-xs text-slate-500">{t.journal_batch_ref ?? "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/80 text-sm font-medium text-slate-800">Vault movements</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                    <th className="p-3">Time</th>
                    <th className="p-3">Vault Δ</th>
                    <th className="p-3">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {(snap?.recentVaultMoves?.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={3} className="p-6 text-center text-slate-500 text-sm">
                        No vault movements yet.
                      </td>
                    </tr>
                  ) : (
                    snap!.recentVaultMoves.map((v) => (
                      <tr key={v.id} className="border-b border-slate-50 text-slate-700">
                        <td className="p-3 whitespace-nowrap text-xs">{new Date(v.created_at).toLocaleString()}</td>
                        <td className="p-3 tabular-nums font-mono">{formatUgx(v.signed_vault_change)}</td>
                        <td className="p-3 text-xs">{v.narration ?? "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ——— End of day ——— */}
      {mainTab === "eod" && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-emerald-600" />
              Till closing &amp; balancing
            </h2>
            <ol className="text-sm text-slate-600 space-y-2 list-decimal pl-5">
              <li>Stop new teller postings (or flag session as “closing”).</li>
              <li>Count physical cash by denomination; enter counted total below.</li>
              <li>System computes expected balance from posted transactions.</li>
              <li>Record over / short with reason code; supervisor review if non-zero.</li>
              <li>Close till session; optional handover to next teller with dual sign-off.</li>
            </ol>
            <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm max-w-xl">
              <div className="flex justify-between py-1">
                <span className="text-slate-500">Expected (from posted session)</span>
                <span className="font-mono tabular-nums font-medium">{formatUgx(eodExpected)}</span>
              </div>
              {eodExpected === null && (
                <p className="text-xs text-amber-700 mt-1">No open till session or insufficient data — open a session on the Operations tab first.</p>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 max-w-xl">
              <div>
                <label className={label}>Counted cash (UGX)</label>
                <input
                  className={`${field} tabular-nums`}
                  type="number"
                  placeholder="Physical count"
                  value={eodCounted}
                  onChange={(ev) => setEodCounted(ev.target.value)}
                />
              </div>
              <div>
                <label className={label}>Over / short (UGX)</label>
                <input
                  className={`${field} tabular-nums`}
                  type="text"
                  readOnly
                  value={eodVariance === null ? "" : String(eodVariance)}
                  placeholder={eodExpected === null ? "—" : "Counted − expected"}
                />
              </div>
            </div>
            <div className="max-w-xl">
              <label className={label}>Close notes (optional)</label>
              <input className={field} value={eodCloseNotes} onChange={(ev) => setEodCloseNotes(ev.target.value)} placeholder="Supervisor ref, variance reason…" />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving || !canMutate}
                onClick={() => void handleEodClose()}
                className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Complete till close
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                Print close summary
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-950">
            <strong>Branch EOD:</strong> roll up all teller closes, reconcile vault to GL cash accounts, and lock the business date — typically a
            separate branch supervisor action with audit log entry.
          </div>
        </div>
      )}

      {/* ——— Controls ——— */}
      {mainTab === "controls" && (
        <div className="max-w-xl">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
            <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
              Limits (indicative)
            </h2>
            <ul className="text-sm text-slate-700 space-y-2">
              <li className="flex justify-between border-b border-slate-100 py-2">
                <span>Max single cash transaction</span>
                <span className="font-mono text-slate-900">—</span>
              </li>
              <li className="flex justify-between border-b border-slate-100 py-2">
                <span>Max daily cumulative (teller)</span>
                <span className="font-mono text-slate-900">—</span>
              </li>
              <li className="flex justify-between py-2">
                <span>Cheque clearing limit (without approval)</span>
                <span className="font-mono text-slate-900">—</span>
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* ——— Reports ——— */}
      {mainTab === "reports" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {reportCards.map((r) => {
              const Icon = r.icon;
              return (
                <div
                  key={r.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col gap-2 hover:border-emerald-300 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-emerald-100 p-2 text-emerald-700">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-slate-900 text-sm">{r.title}</h3>
                      <p className="text-xs text-slate-600 mt-1">{r.desc}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!snap || snap.schemaMissing || loading}
                    onClick={() => {
                      if (!snap || snap.schemaMissing) return;
                      const csv = buildTellerReportCsv(r.id, snap);
                      downloadCsv(`teller_${r.id}_${new Date().toISOString().slice(0, 10)}.csv`, csv);
                    }}
                    className="mt-auto self-start rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Download CSV (preview)
                  </button>
                </div>
              );
            })}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/80 text-sm font-medium text-slate-800 flex items-center gap-2">
              <FileSearch className="w-4 h-4 text-emerald-600" />
              Audit trail preview
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                    <th className="p-3">Time</th>
                    <th className="p-3">Action</th>
                    <th className="p-3">Entity</th>
                    <th className="p-3">Detail</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700">
                  {(snap?.recentAudit?.length ?? 0) === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-slate-500 text-sm">
                        No audit rows yet — entries appear as teller actions are logged.
                      </td>
                    </tr>
                  ) : (
                    snap!.recentAudit.map((a) => (
                      <tr key={a.id} className="border-b border-slate-50 align-top">
                        <td className="p-3 whitespace-nowrap text-xs">{new Date(a.created_at).toLocaleString()}</td>
                        <td className="p-3 font-mono text-xs">{a.action}</td>
                        <td className="p-3 text-xs">
                          {a.entity_type}
                          {a.entity_id ? <span className="text-slate-500"> · {a.entity_id.slice(0, 8)}…</span> : null}
                        </td>
                        <td className="p-3 text-xs text-slate-600 max-w-md break-words font-mono">
                          {a.detail ? JSON.stringify(a.detail) : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
