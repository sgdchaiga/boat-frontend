import { useCallback, useEffect, useMemo, useState } from "react";
import { SACCOPRO_PAGE } from "@/lib/saccoproPages";
import {
  ArrowDownToLine,
  Banknote,
  Banknote as BanknoteIcon,
  Building2,
  ClipboardCheck,
  ChevronLeft,
  ChevronRight,
  Coins,
  AlertTriangle,
  FileBarChart,
  FileSearch,
  HandCoins,
  PiggyBank,
  Landmark,
  Layers,
  Loader2,
  Lock,
  MessageCircle,
  ScrollText,
  Search,
  Shield,
  ShieldCheck,
  UserCheck,
  Wallet,
  Eye,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAppContext } from "@/contexts/AppContext";
import {
  taskRequiresMemberOnly,
  taskRequiresSavingsAccount,
  TELLER_TASK_LABELS,
  TELLER_VAL,
  formatTxnTypeLabel,
  type TellerTaskAction,
} from "@/lib/saccoTellerConfig";
import {
  approveTellerTransaction,
  buildTellerReportCsv,
  buildTellerReportTable,
  correctPostedTellerTransaction,
  canCorrectPostedTellerTxnType,
  editPendingTellerTransaction,
  closeTellerSession,
  closeTellerSessionByIdAsSupervisor,
  downloadCsv,
  closeAllOpenTellerSessionsForStaff,
  fetchOpenTellerSessionsForOrganization,
  fetchTillPositionsForOrganization,
  fetchTellerTransactionsForDateRange,
  resumeOrOpenTellerSession,
  rejectTellerTransaction,
  resolveTellerStaffContext,
  transferCashFromTillToVault,
  transferCashFromVaultToTill,
  type TellerOpenSessionListRow,
  type TellerReportId,
  type TellerReportTable,
  type TillPositionRow,
  TELLER_MIGRATION_HINT,
  formatTellerDbError,
} from "@/lib/saccoTellerDb";
import { fetchSaccoTillInsuredLimit, upsertSaccoTillInsuredLimit } from "@/lib/saccoTellerSettings";
import { downloadTellerReportPdf } from "@/lib/saccoReportPdf";
import { SaccoTellerReportPreview } from "@/components/sacco/SaccoTellerReportPreview";
import { SaccoTillOversightPanel } from "@/components/sacco/SaccoTillOversightPanel";
import { SaccoEditTellerTransactionModal } from "@/components/sacco/SaccoEditTellerTransactionModal";
import { canEditSaccoTransactions } from "@/lib/saccoTransactionEditAccess";
import { isLocalAuthEnvEnabled } from "@/lib/saccoSavingsSettingsAccess";
import { supabase } from "@/lib/supabase";
import { toBusinessDateString } from "@/lib/timezone";
import { useTellerCompleteTransaction } from "@/components/sacco/hooks/useTellerCompleteTransaction";
import { useTellerInit } from "@/components/sacco/hooks/useTellerInit";
import type {
  SaccoTellerTransactionRow,
  TellerMemberPickRow,
  TellerSavingsAccountPickRow,
  TellerPostingPurpose,
} from "@/lib/saccoTellerDb";

function formatUgx(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `UGX ${Math.round(n).toLocaleString("en-UG")}`;
}

const TELLER_ENTRY_MODE_STORAGE_KEY = "sacco_teller_entry_mode";

const RECENT_ACTIVITY_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

/** Comma-formatted display for POS amount fields. */
function amountWithCommas(digits: string): string {
  if (!digits) return "";
  const n = Number(digits);
  if (!Number.isFinite(n) || n < 0) return "";
  return n.toLocaleString("en-UG");
}

type MainTab = "transactions" | "till" | "approvals" | "reports" | "controls" | "oversight";

type ReportsSubTab = "daily_summary" | "recent_activity";

export type SaccoTellerDesk = "receive" | "give" | "transfer" | "daily" | "oversight";

export type SaccoTellerPageProps = {
  tellerDesk?: string | null;
  tellerTask?: string | null;
  /** When opening the daily desk: `recent_activity` opens the transaction list; default / omitted is daily summary & reports. */
  tellerReportsTab?: string | null;
  onDeskNavigate?: (page: string, state?: Record<string, unknown>) => void;
};

function normalizeDesk(v: string | null | undefined, allowOversight: boolean): SaccoTellerDesk {
  const x = String(v ?? "receive").toLowerCase();
  if (allowOversight && x === "oversight") return "oversight";
  if (x === "give" || x === "transfer" || x === "daily") return x;
  return "receive";
}

function deskNavState(id: SaccoTellerDesk): Record<string, string> {
  if (id === "receive") return { tellerDesk: "receive" };
  if (id === "give") return { tellerDesk: "give" };
  if (id === "transfer") return { tellerDesk: "transfer" };
  if (id === "oversight") return { tellerDesk: "oversight" };
  return { tellerDesk: "daily" };
}

const field =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500";
const amountFieldPos =
  "w-full rounded-2xl border-2 border-slate-300 bg-white px-4 py-5 min-h-[5.5rem] text-4xl font-bold tabular-nums text-center text-slate-900 tracking-tight outline-none focus:ring-4 focus:ring-emerald-500/30 focus:border-emerald-500 shadow-inner";
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
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "text-emerald-900 font-semibold"
          : "text-slate-700 hover:text-slate-950 hover:bg-slate-100/90"
      }`}
    >
      {children}
    </button>
  );
}

function pendingCardLabel(t: SaccoTellerTransactionRow): string {
  return formatTxnTypeLabel(String(t.txn_type));
}

/** SACCO teller: task-driven flow, single complete action, no GL on the counter. */
export function SaccoTellerPage({ tellerDesk, tellerTask, tellerReportsTab, onDeskNavigate }: SaccoTellerPageProps = {}) {
  const { user, isSuperAdmin } = useAuth();
  const { refreshSaccoWorkspace } = useAppContext();
  const [tellerCtx, setTellerCtx] = useState<Awaited<ReturnType<typeof resolveTellerStaffContext>>>(null);
  const [tellerCtxLoading, setTellerCtxLoading] = useState(true);
  const [orgOpenSessions, setOrgOpenSessions] = useState<TellerOpenSessionListRow[]>([]);
  const [tillPositions, setTillPositions] = useState<TillPositionRow[]>([]);
  const [tillPositionsLoading, setTillPositionsLoading] = useState(false);
  const [insuredLimitUgx, setInsuredLimitUgx] = useState<number | null>(null);
  const [insuredLimitDraft, setInsuredLimitDraft] = useState("");
  const [orgName, setOrgName] = useState("");
  const [reportPreviewOpen, setReportPreviewOpen] = useState(false);
  const [reportPreviewTable, setReportPreviewTable] = useState<TellerReportTable | null>(null);
  const [activeReportId, setActiveReportId] = useState<TellerReportId | null>(null);
  const [dailyReportDate, setDailyReportDate] = useState(() => new Date().toISOString().slice(0, 10));
  /** Calendar day (yyyy-mm-dd) for the Recent teller activity table. */
  const [recentActivityDate, setRecentActivityDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [recentActivityRows, setRecentActivityRows] = useState<SaccoTellerTransactionRow[]>([]);
  const [recentActivityLoading, setRecentActivityLoading] = useState(false);
  const [recentActivityPageSize, setRecentActivityPageSize] = useState(25);
  const [recentActivityPageIndex, setRecentActivityPageIndex] = useState(0);
  const [editTxn, setEditTxn] = useState<SaccoTellerTransactionRow | null>(null);
  const [editTxnOpen, setEditTxnOpen] = useState(false);

  useEffect(() => {
    if (!user?.id) {
      setTellerCtx(null);
      setTellerCtxLoading(false);
      return;
    }
    setTellerCtxLoading(true);
    void resolveTellerStaffContext(user.id).then((ctx) => {
      setTellerCtx(ctx);
      setTellerCtxLoading(false);
    });
  }, [user?.id]);

  const orgId = tellerCtx?.organizationId ?? user?.organization_id ?? null;
  const staffId = tellerCtx?.staffId ?? user?.id ?? undefined;
  const staffLinkMissing = Boolean(user?.id && !tellerCtxLoading && !tellerCtx);
  const showAdminControls =
    Boolean(isSuperAdmin) || ["admin", "accountant", "manager"].includes(String(user?.role ?? "").toLowerCase());
  const canEditTransactions = canEditSaccoTransactions(user?.role, {
    isSuperAdmin: Boolean(isSuperAdmin),
    localAuthEnabled: isLocalAuthEnvEnabled(),
  });

  const desk = useMemo(() => normalizeDesk(tellerDesk, showAdminControls), [tellerDesk, showAdminControls]);

  const [mainTab, setMainTab] = useState<MainTab>("transactions");
  const [reportsSubTab, setReportsSubTab] = useState<ReportsSubTab>("daily_summary");

  const goMainTab = useCallback(
    (tab: MainTab) => {
      setMainTab(tab);
      if (desk === "oversight" && tab !== "oversight") {
        onDeskNavigate?.(SACCOPRO_PAGE.teller, { tellerDesk: "receive" });
        return;
      }
      if (tab !== "reports" && onDeskNavigate) {
        const payload: Record<string, string> = { tellerDesk: desk };
        if (tellerTask) payload.tellerTask = tellerTask;
        onDeskNavigate(SACCOPRO_PAGE.teller, payload);
      }
    },
    [desk, onDeskNavigate, tellerTask]
  );

  const [taskAction, setTaskAction] = useState<TellerTaskAction>("deposit");
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [selectedSavingsAccountId, setSelectedSavingsAccountId] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [narration, setNarration] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [chequeBank, setChequeBank] = useState("");
  const [chequeAmountStr, setChequeAmountStr] = useState("");
  const [chequeValueDate, setChequeValueDate] = useState("");
  const [chequePayeeRef, setChequePayeeRef] = useState("");
  const [chequeFlow, setChequeFlow] = useState<"received" | "paid" | "clearing">("received");

  const [eodCounted, setEodCounted] = useState("");
  const [eodCloseNotes, setEodCloseNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [openFloatStr, setOpenFloatStr] = useState("");
  const [openSessionNotes, setOpenSessionNotes] = useState("");
  const [vaultXferStr, setVaultXferStr] = useState("");
  const [vaultXferNote, setVaultXferNote] = useState("");
  const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({});
  const [openTillModal, setOpenTillModal] = useState(false);
  const [confirmTxnOpen, setConfirmTxnOpen] = useState(false);
  const [tellerTipsOpen, setTellerTipsOpen] = useState(false);
  const [tellerEntryMode, setTellerEntryMode] = useState<"simple" | "accountant">(() => {
    try {
      return localStorage.getItem(TELLER_ENTRY_MODE_STORAGE_KEY) === "accountant" ? "accountant" : "simple";
    } catch {
      return "simple";
    }
  });
  const [accountantFeePostingPurpose, setAccountantFeePostingPurpose] = useState<
    Extract<TellerPostingPurpose, "membership_fee" | "subscription" | "shares" | "fee_or_penalty" | "other">
  >("membership_fee");

  useEffect(() => {
    try {
      localStorage.setItem(TELLER_ENTRY_MODE_STORAGE_KEY, tellerEntryMode);
    } catch {
      /* ignore */
    }
  }, [tellerEntryMode]);

  useEffect(() => {
    const d = normalizeDesk(tellerDesk, showAdminControls);
    if (d === "transfer") setMainTab("till");
    else if (d === "daily") {
      setMainTab("reports");
      setReportsSubTab(tellerReportsTab === "recent_activity" ? "recent_activity" : "daily_summary");
    } else if (d === "oversight") setMainTab("oversight");
    else setMainTab("transactions");

    if (d === "receive") {
      const t = (tellerTask || "deposit").toLowerCase();
      const allow = ["deposit", "loan_payment", "fees", "cheque"];
      setTaskAction((allow.includes(t) ? t : "deposit") as TellerTaskAction);
    }
    if (d === "give") {
      const t = (tellerTask || "withdraw").toLowerCase();
      if (t === "cheque") {
        setTaskAction("cheque");
        setChequeFlow("paid");
      } else {
        setTaskAction("withdraw");
      }
    }
  }, [tellerDesk, tellerTask, showAdminControls, tellerReportsTab]);

  useEffect(() => {
    if (desk === "give" && taskAction === "cheque") setChequeFlow("paid");
    else if (desk === "receive" && taskAction === "cheque") setChequeFlow("received");
  }, [desk, taskAction]);

  const { snap, init, loading, loadError, initLoading, load } = useTellerInit(orgId, staffId, Boolean(isSuperAdmin));

  const refreshOrgOpenSessions = useCallback(async () => {
    if (!orgId || !showAdminControls) {
      setOrgOpenSessions([]);
      return;
    }
    const rows = await fetchOpenTellerSessionsForOrganization(orgId);
    setOrgOpenSessions(rows);
  }, [orgId, showAdminControls]);

  const refreshTillOversight = useCallback(async () => {
    if (!orgId) {
      setTillPositions([]);
      setInsuredLimitUgx(null);
      return;
    }
    setTillPositionsLoading(true);
    try {
      const limit = await fetchSaccoTillInsuredLimit(orgId);
      setInsuredLimitUgx(limit);
      setInsuredLimitDraft(limit != null ? String(Math.round(limit)) : "");
      if (showAdminControls) {
        setTillPositions(await fetchTillPositionsForOrganization(orgId, limit));
      } else {
        setTillPositions([]);
      }
    } catch (e) {
      console.error("[SACCO teller oversight]", e);
    } finally {
      setTillPositionsLoading(false);
    }
  }, [orgId, showAdminControls]);

  const fetchRecentActivity = useCallback(
    async (date: string) => {
      if (!orgId || snap?.schemaMissing) {
        setRecentActivityRows([]);
        return;
      }
      setRecentActivityLoading(true);
      try {
        const rows = await fetchTellerTransactionsForDateRange(orgId, date, date);
        setRecentActivityRows([...rows].reverse());
      } finally {
        setRecentActivityLoading(false);
      }
    },
    [orgId, snap?.schemaMissing]
  );

  useEffect(() => {
    void fetchRecentActivity(recentActivityDate);
  }, [recentActivityDate, fetchRecentActivity]);

  useEffect(() => {
    setRecentActivityPageIndex(0);
  }, [recentActivityDate]);

  useEffect(() => {
    if (recentActivityRows.length === 0) {
      setRecentActivityPageIndex(0);
      return;
    }
    const maxIdx = Math.ceil(recentActivityRows.length / recentActivityPageSize) - 1;
    setRecentActivityPageIndex((prev) => Math.min(prev, Math.max(0, maxIdx)));
  }, [recentActivityRows.length, recentActivityPageSize]);

  const recentActivityPagedRows = useMemo(() => {
    const start = recentActivityPageIndex * recentActivityPageSize;
    return recentActivityRows.slice(start, start + recentActivityPageSize);
  }, [recentActivityRows, recentActivityPageIndex, recentActivityPageSize]);

  const recentActivityPageCount = useMemo(() => {
    if (recentActivityRows.length === 0) return 0;
    return Math.ceil(recentActivityRows.length / recentActivityPageSize);
  }, [recentActivityRows.length, recentActivityPageSize]);

  const recentActivityDisabled = recentActivityLoading || !orgId || Boolean(snap?.schemaMissing);

  useEffect(() => {
    void refreshOrgOpenSessions();
    void refreshTillOversight();
  }, [refreshOrgOpenSessions, refreshTillOversight, snap?.openSession, loading]);

  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    void supabase
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        const row = data as { name?: string | null } | null;
        setOrgName(row?.name?.trim() || "");
      });
    return () => {
      alive = false;
    };
  }, [orgId]);

  const buildReportOptions = useCallback(
    async (reportId: TellerReportId, dateForDaily?: string) => {
      if (!orgId || !snap) return {};
      const reportDate = dateForDaily ?? new Date().toISOString().slice(0, 10);
      if (reportId === "daily_summary") {
        const dailyTransactions = await fetchTellerTransactionsForDateRange(orgId, reportDate, reportDate);
        return { dailyTransactions, insuredLimitUgx, reportDate };
      }
      if (reportId === "cash_position" && showAdminControls) {
        const tillPositions = await fetchTillPositionsForOrganization(orgId, insuredLimitUgx);
        return { tillPositions, insuredLimitUgx, reportDate };
      }
      return { insuredLimitUgx, reportDate };
    },
    [orgId, snap, showAdminControls, insuredLimitUgx]
  );

  const openReportPreview = useCallback(
    async (reportId: TellerReportId, dateForDaily?: string) => {
      if (!snap || snap.schemaMissing) return;
      setActiveReportId(reportId);
      const opts = await buildReportOptions(reportId, dateForDaily);
      setReportPreviewTable(buildTellerReportTable(reportId, snap, opts));
      setReportPreviewOpen(true);
    },
    [snap, buildReportOptions]
  );

  useEffect(() => {
    if (desk !== "daily" || !snap || snap.schemaMissing || !orgId) return;
    let cancelled = false;
    void (async () => {
      const opts = await buildReportOptions("daily_summary", dailyReportDate);
      if (cancelled) return;
      setActiveReportId("daily_summary");
      setReportPreviewTable(buildTellerReportTable("daily_summary", snap, opts));
      setReportPreviewOpen(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [desk, dailyReportDate, orgId, snap?.schemaMissing, buildReportOptions]);

  const pickMembers = init?.members ?? [];
  const pickSavingsAccounts = init?.savingsAccounts ?? [];

  const recentActivityMemberById = useMemo(
    () => new Map<string, TellerMemberPickRow>(pickMembers.map((m) => [m.id, m])),
    [pickMembers]
  );
  const recentActivitySavingsById = useMemo(
    () => new Map<string, TellerSavingsAccountPickRow>(pickSavingsAccounts.map((a) => [a.id, a])),
    [pickSavingsAccounts]
  );

  const memberQueryLower = memberSearch.trim().toLowerCase();
  const memberMatches: TellerMemberPickRow[] = useMemo(() => {
    if (memberQueryLower.length < 1) return [];
    return pickMembers
      .filter(
        (m) =>
          m.member_number.toLowerCase().includes(memberQueryLower) || m.full_name.toLowerCase().includes(memberQueryLower)
      )
      .slice(0, 10);
  }, [memberQueryLower, pickMembers]);

  const selectedMember = useMemo(
    () => (selectedMemberId ? pickMembers.find((m) => m.id === selectedMemberId) ?? null : null),
    [selectedMemberId, pickMembers]
  );

  const memberSavings = useMemo(
    () => pickSavingsAccounts.filter((a) => a.sacco_member_id === selectedMemberId),
    [pickSavingsAccounts, selectedMemberId]
  );

  useEffect(() => {
    if (!taskRequiresSavingsAccount(taskAction)) return;
    if (memberSavings.length === 1) setSelectedSavingsAccountId(memberSavings[0].id);
  }, [taskAction, memberSavings]);

  const eodExpected = snap?.tillEstimated ?? null;
  const eodCountedNum = eodCounted.trim() === "" ? NaN : Number(eodCounted);
  const eodVariance =
    eodExpected !== null && !Number.isNaN(eodCountedNum) && eodCounted.trim() !== "" ? Math.round(eodCountedNum) - eodExpected : null;

  const canMutate = Boolean(orgId && staffId && !snap?.schemaMissing && !staffLinkMissing && !tellerCtxLoading);

  const { doComplete, fieldMsg, setFieldMsg } = useTellerCompleteTransaction({
    canMutate,
    organizationId: orgId,
    staffId,
    snap,
    init,
    load,
    refreshSaccoWorkspace,
    setSaving,
    setActionMessage,
    taskAction,
    selectedMemberId,
    selectedSavingsAccountId,
    amountStr,
    narration,
    chequeNo,
    chequeBank,
    chequeAmountStr,
    chequeValueDate,
    chequePayeeRef,
    chequeFlow,
    setAmountStr,
    setNarration,
    setChequeNo,
    setChequeBank,
    setChequeAmountStr,
    setChequeValueDate,
    setChequePayeeRef,
    setSelectedMemberId,
    setSelectedSavingsAccountId,
    setMemberSearch,
    tellerEntryMode,
    accountantFeePostingPurpose:
      tellerEntryMode === "accountant" && taskAction === "fees" ? accountantFeePostingPurpose : null,
  });

  const runMutation = useCallback(
    async (fn: () => Promise<void>, options?: { successMessage?: string | false; silentRefresh?: boolean }) => {
      if (!orgId) {
        setActionMessage({ kind: "err", text: "Link your staff account to an organization before using Teller." });
        return;
      }
      if (!staffId) {
        setActionMessage({ kind: "err", text: "Sign in with a staff account to use Teller." });
        return;
      }
      if (snap?.schemaMissing) {
        setActionMessage({ kind: "err", text: TELLER_MIGRATION_HINT });
        return;
      }
      setSaving(true);
      setActionMessage(null);
      try {
        await fn();
        if (options?.successMessage !== false) {
          setActionMessage({ kind: "ok", text: options?.successMessage ?? "Saved." });
        }
        await load({ silent: options?.silentRefresh !== false });
        void fetchRecentActivity(recentActivityDate);
        await refreshOrgOpenSessions();
      } catch (e) {
        setActionMessage({ kind: "err", text: formatTellerDbError(e) });
      } finally {
        setSaving(false);
      }
    },
    [orgId, staffId, snap?.schemaMissing, load, refreshOrgOpenSessions, fetchRecentActivity, recentActivityDate]
  );

  const handleSupervisorCloseSession = (sessionId: string) =>
    runMutation(
      async () => {
        await closeTellerSessionByIdAsSupervisor({ organizationId: orgId!, sessionId });
        await refreshTillOversight();
        await refreshOrgOpenSessions();
        await load({ silent: true });
      },
      { successMessage: "Till session closed." }
    );

  const validateTransactionForm = useCallback((): boolean => {
    setFieldMsg({});
    if (!snap?.openSession) {
      setActionMessage({ kind: "err", text: TELLER_VAL.noSession });
      return false;
    }
    if (taskRequiresSavingsAccount(taskAction)) {
      if (!selectedMemberId) {
        setFieldMsg({ member: TELLER_VAL.noMember });
        return false;
      }
      if (!selectedSavingsAccountId) {
        setFieldMsg({ account: TELLER_VAL.noSavings });
        return false;
      }
    } else if (taskRequiresMemberOnly(taskAction)) {
      if (!selectedMemberId) {
        setFieldMsg({ member: TELLER_VAL.noMember });
        return false;
      }
    }
    const rawDigits = digitsOnly(taskAction === "cheque" ? chequeAmountStr : amountStr);
    const n = Number(rawDigits || "0");
    if (taskAction === "cheque") {
      if (!Number.isFinite(n) || n <= 0) {
        setFieldMsg({ amount: TELLER_VAL.noChequeAmount });
        return false;
      }
    } else if (!Number.isFinite(n) || n <= 0) {
      setFieldMsg({ amount: TELLER_VAL.noAmount });
      return false;
    }
    return true;
  }, [
    snap?.openSession,
    taskAction,
    selectedMemberId,
    selectedSavingsAccountId,
    amountStr,
    chequeAmountStr,
    setFieldMsg,
    setActionMessage,
  ]);

  const openTillWithFloat = async (opts?: { forceNew?: boolean; successMessage?: string }) => {
    const v = Number(openFloatStr);
    if (!Number.isFinite(v) || v < 0) throw new Error("Enter a valid opening float.");
    const { session, resumed } = await resumeOrOpenTellerSession({
      organizationId: orgId!,
      staffId: staffId!,
      openingFloat: Math.round(v),
      notes: openSessionNotes.trim() || null,
      forceNew: opts?.forceNew,
    });
    setOpenFloatStr("");
    setOpenSessionNotes("");
    return {
      session,
      message:
        opts?.successMessage ??
        (resumed ? "Resumed your open till session." : "Till session opened."),
    };
  };

  const handleOpenSession = () =>
    runMutation(async () => {
      const { message } = await openTillWithFloat();
      setActionMessage({ kind: "ok", text: message });
    }, { successMessage: false, silentRefresh: false });

  const submitOpenTillFromModal = () =>
    runMutation(async () => {
      const { message } = await openTillWithFloat();
      setOpenTillModal(false);
      setActionMessage({ kind: "ok", text: message });
    }, { successMessage: false, silentRefresh: false });

  const handleResumeOpenTill = () =>
    runMutation(async () => {
      const v = Number(openFloatStr);
      const float = Number.isFinite(v) && v >= 0 ? Math.round(v) : 0;
      const { session, resumed } = await resumeOrOpenTellerSession({
        organizationId: orgId!,
        staffId: staffId!,
        openingFloat: float,
        notes: openSessionNotes.trim() || null,
      });
      if (!resumed) {
        setOpenFloatStr("");
        setOpenSessionNotes("");
      }
      setOpenTillModal(false);
      setActionMessage({
        kind: "ok",
        text: resumed ? "Till session resumed — you can post transactions." : "Till session opened.",
      });
      void session;
    }, { successMessage: false, silentRefresh: false });

  const handleCloseStuckTill = () =>
    runMutation(async () => {
      const n = await closeAllOpenTellerSessionsForStaff({
        organizationId: orgId!,
        staffId: staffId!,
        notes: "Closed from Teller (stuck session recovery).",
      });
      if (n === 0) {
        throw new Error("No open till session was found to close. Refresh the page and try again.");
      }
    }, { successMessage: "Stuck till session closed. You can open a new session now.", silentRefresh: false });

  const requestCompleteTransaction = useCallback(() => {
    if (!validateTransactionForm()) return;
    setConfirmTxnOpen(true);
  }, [validateTransactionForm]);

  const confirmTransactionSummary = useMemo(() => {
    const amtSrc = taskAction === "cheque" ? chequeAmountStr : amountStr;
    const n = Math.round(Number(digitsOnly(amtSrc) || "0"));
    const memberLine = selectedMember ? `${selectedMember.member_number} — ${selectedMember.full_name}` : "—";

    let accountDetail = "";
    if (taskRequiresSavingsAccount(taskAction) && selectedSavingsAccountId) {
      const acc = pickSavingsAccounts.find((x) => x.id === selectedSavingsAccountId);
      if (acc)
        accountDetail = `${acc.savings_product_code} (${acc.account_number}) · balance ${formatUgx(acc.balance)}`;
    }

    const verbShort =
      taskAction === "withdraw"
        ? "withdrawal"
        : taskAction === "deposit"
          ? "deposit"
          : taskAction === "loan_payment"
            ? "loan payment"
            : taskAction === "fees"
              ? "fee payment"
              : "cheque transaction";

    const verbSentence =
      taskAction === "withdraw"
        ? `Confirm withdrawal of ${formatUgx(n)}?`
        : taskAction === "deposit"
          ? `Confirm deposit of ${formatUgx(n)}?`
          : taskAction === "cheque"
            ? `Confirm ${chequeFlow === "paid" ? "cheque payment" : chequeFlow === "received" ? "cheque received" : "cheque clearing"} of ${formatUgx(n)}?`
            : `Confirm ${verbShort} of ${formatUgx(n)}?`;

    return { n, amountDisplay: formatUgx(n), memberLine, accountDetail, verbShort, verbSentence };
  }, [
    taskAction,
    amountStr,
    chequeAmountStr,
    chequeFlow,
    selectedMember,
    selectedSavingsAccountId,
    pickSavingsAccounts,
  ]);

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

  const handleEodClose = () =>
    runMutation(async () => {
      const sess = snap?.openSession;
      if (!sess) throw new Error("No open session to close.");
      const expectedBal = snap?.tillEstimated;
      if (expectedBal === null || expectedBal === undefined) throw new Error("Expected balance unavailable — refresh or check session.");
      if (eodCounted.trim() === "" || Number.isNaN(eodCountedNum)) throw new Error("Please enter the counted cash amount.");
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
    }, { successMessage: "Till closed." });

  const handleApprovePending = (transactionId: string) =>
    runMutation(
      async () => {
        await approveTellerTransaction({ organizationId: orgId!, transactionId, checkerStaffId: staffId! });
        setRejectNotes((prev) => {
          const n = { ...prev };
          delete n[transactionId];
          return n;
        });
        await refreshSaccoWorkspace();
      },
      { successMessage: "Approved." }
    );

  const handleRejectPending = (transactionId: string) =>
    runMutation(
      async () => {
        const reason = rejectNotes[transactionId] ?? "";
        await rejectTellerTransaction({
          organizationId: orgId!,
          transactionId,
          checkerStaffId: staffId!,
          reason: reason.trim() || null,
        });
        setRejectNotes((prev) => {
          const n = { ...prev };
          delete n[transactionId];
          return n;
        });
      },
      { successMessage: "Rejected." }
    );

  const openEditTransaction = (t: SaccoTellerTransactionRow) => {
    setEditTxn(t);
    setEditTxnOpen(true);
  };

  const handleSaveTxnEdit = async (
    patch: Parameters<typeof editPendingTellerTransaction>[0]["patch"],
    reason: string
  ) => {
    if (!orgId || !staffId || !editTxn) throw new Error("Session not ready.");
    if (snap?.schemaMissing) throw new Error(TELLER_MIGRATION_HINT);
    setSaving(true);
    setActionMessage(null);
    try {
      if (editTxn.status === "posted") {
        await correctPostedTellerTransaction({
          organizationId: orgId,
          transactionId: editTxn.id,
          editorStaffId: staffId,
          patch,
          reason,
        });
      } else {
        await editPendingTellerTransaction({
          organizationId: orgId,
          transactionId: editTxn.id,
          editorStaffId: staffId,
          patch,
          reason,
        });
      }
      setEditTxnOpen(false);
      setEditTxn(null);
      setActionMessage({
        kind: "ok",
        text: editTxn.status === "posted" ? "Transaction corrected." : "Transaction updated.",
      });
      await load();
      void fetchRecentActivity(recentActivityDate);
      await refreshSaccoWorkspace();
    } catch (e) {
      const msg = formatTellerDbError(e);
      setActionMessage({ kind: "err", text: msg });
      throw new Error(msg);
    } finally {
      setSaving(false);
    }
  };

  const reportCards = useMemo(
    () => [
      { id: "cash_position" as TellerReportId, title: "Teller cash position", desc: "Per-till cash on hand vs expected float.", icon: Wallet },
      { id: "daily_summary" as TellerReportId, title: "Daily transactions summary", desc: "All teller postings for the day.", icon: FileBarChart },
      { id: "cash_movement" as TellerReportId, title: "Cash movement report", desc: "Inflows and outflows between vault, till, and transit.", icon: Layers },
      { id: "over_short" as TellerReportId, title: "Over / short report", desc: "Variances at till close and EOD.", icon: FileSearch },
      { id: "audit_logs" as TellerReportId, title: "Audit logs", desc: "Immutable trail of teller actions.", icon: FileSearch },
    ],
    []
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4 md:p-6 max-w-6xl mx-auto pb-28">
      <header className="space-y-4 shrink-0">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-emerald-700">
              <Banknote className="w-8 h-8 shrink-0" />
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Teller</h1>
              <button
                type="button"
                onClick={() => setTellerTipsOpen((o) => !o)}
                aria-expanded={tellerTipsOpen}
                aria-label={tellerTipsOpen ? "Hide tips and comments" : "Show tips and comments"}
                title="Tips and comments"
                className={`rounded-full p-1.5 transition shrink-0 ${
                  tellerTipsOpen
                    ? "bg-emerald-200 text-emerald-900 ring-2 ring-emerald-400/50"
                    : "text-slate-500 hover:bg-slate-200 hover:text-slate-800"
                }`}
              >
                <MessageCircle className="w-5 h-5" aria-hidden />
              </button>
            </div>
            {tellerTipsOpen ? (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/95 px-4 py-3 text-sm text-slate-800 space-y-3 shadow-sm">
                <p>
                  Choose what you are doing, find the member, enter the amount, and use <strong>Complete transaction</strong>. The system
                  posts small amounts directly and routes larger ones for approval. GL mapping is configured by accounting — not on this
                  screen.
                </p>
                <p className="rounded-lg border border-emerald-200 bg-emerald-50/90 px-3 py-2 text-emerald-950">
                  <strong>Heart of BOAT:</strong> savings deposits, withdrawals, loan repayments, and fees are posted here after member
                  selection. Loans and statements prepare the story — treasury completes the movement.
                </p>
                {desk === "transfer" ? (
                  <p className="text-slate-600">
                    Move physical cash between the vault and this till below (Till &amp; vault section).
                  </p>
                ) : null}
                {desk === "daily" ? (
                  <p className="text-slate-600">
                    Use <strong>Daily summary</strong> for report previews, or <strong>Recent activity</strong> / Reports → Recent
                    teller activity for dated transactions. Change the date under Reports.
                  </p>
                ) : null}
                {desk === "oversight" ? (
                  <p className="text-slate-600">
                    Monitor cash on hand per open till against the insured limit. Configure the limit under Controls.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {loadError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{loadError}</div>}
        {actionMessage && (
          <div
            className={`rounded-lg border px-3 py-2 text-sm ${
              actionMessage.kind === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-800"
            }`}
          >
            {actionMessage.text}
          </div>
        )}
        {snap?.schemaMissing && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            Teller database objects are missing or out of date. In Supabase → SQL Editor, run migrations starting with{" "}
            <code className="text-xs">20260426120007_sacco_teller.sql</code> through{" "}
            <code className="text-xs">20260426120011_journal_gl_teller_counterparty_settings.sql</code>, then refresh.
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-3">
          {(
            [
              ["receive", "Receive money"],
              ["give", "Give money"],
              ["transfer", "Transfers"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => onDeskNavigate?.(SACCOPRO_PAGE.teller, deskNavState(id))}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold border transition-colors ${
                desk === id
                  ? "bg-emerald-700 text-white border-emerald-800 shadow-sm"
                  : "bg-white text-slate-700 border-slate-200 hover:border-emerald-400"
              }`}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onDeskNavigate?.(SACCOPRO_PAGE.teller, { tellerDesk: "daily" })}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold border transition-colors ${
              desk === "daily" && reportsSubTab === "daily_summary"
                ? "bg-emerald-700 text-white border-emerald-800 shadow-sm"
                : "bg-white text-slate-700 border-slate-200 hover:border-emerald-400"
            }`}
          >
            Daily summary
          </button>
          <button
            type="button"
            onClick={() =>
              onDeskNavigate?.(SACCOPRO_PAGE.teller, { tellerDesk: "daily", tellerReportsTab: "recent_activity" })
            }
            className={`rounded-full px-4 py-1.5 text-xs font-semibold border transition-colors ${
              desk === "daily" && reportsSubTab === "recent_activity"
                ? "bg-emerald-700 text-white border-emerald-800 shadow-sm"
                : "bg-white text-slate-700 border-slate-200 hover:border-emerald-400"
            }`}
          >
            Recent activity
          </button>
          {showAdminControls ? (
            <button
              key="oversight"
              type="button"
              onClick={() => onDeskNavigate?.(SACCOPRO_PAGE.teller, deskNavState("oversight"))}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold border transition-colors ${
                desk === "oversight"
                  ? "bg-emerald-700 text-white border-emerald-800 shadow-sm"
                  : "bg-white text-slate-700 border-slate-200 hover:border-emerald-400"
              }`}
            >
              Till oversight
            </button>
          ) : null}
        </div>

        {(desk === "receive" || desk === "give") && (
          <div className="flex flex-wrap gap-3 sm:gap-4 pt-1">
            {(desk === "receive"
              ? [
                  ["deposit", "Deposit", PiggyBank] as const,
                  ["loan_payment", "Loan repayment", HandCoins] as const,
                  ["fees", "Fees / penalties", Coins] as const,
                  ["cheque", "Cheque (received)", Building2] as const,
                ]
              : [
                  ["withdraw", "Withdraw", BanknoteIcon] as const,
                  ["cheque", "Cheque (paid)", Building2] as const,
                ]
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setMainTab("transactions");
                  setTaskAction(id);
                  setFieldMsg({});
                  setSelectedSavingsAccountId("");
                  if (id === "cheque") setChequeFlow(desk === "give" ? "paid" : "received");
                  onDeskNavigate?.(SACCOPRO_PAGE.teller, {
                    tellerDesk: desk === "give" ? "give" : "receive",
                    tellerTask: id,
                  });
                }}
                className={`inline-flex items-center gap-3 rounded-2xl px-6 py-4 text-base font-semibold shadow-sm transition-all active:scale-[0.98] ${
                  taskAction === id
                    ? "bg-emerald-600 text-white shadow-lg ring-4 ring-emerald-500/30"
                    : "bg-white border-2 border-slate-200 text-slate-900 hover:border-emerald-400 hover:shadow-md"
                }`}
              >
                <Icon className={`w-6 h-6 shrink-0 ${taskAction === id ? "text-white" : "text-emerald-700"}`} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        )}

        {!snap?.openSession && canMutate && (
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-2 text-sm text-amber-950">
            <span className="inline-flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" aria-hidden />
              <span className="font-medium">Till not open</span>
            </span>
            <button
              type="button"
              onClick={() => void handleResumeOpenTill()}
              disabled={saving}
              className="rounded-lg border border-amber-700 bg-white px-3 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-50"
            >
              Resume session
            </button>
            <button
              type="button"
              onClick={() => setOpenTillModal(true)}
              className="rounded-lg bg-amber-800 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-900"
            >
              Open till
            </button>
            <button
              type="button"
              onClick={() => void handleCloseStuckTill()}
              disabled={saving}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              title='Use if you see "already have an open session" but Till shows closed'
            >
              Close stuck session
            </button>
          </div>
        )}

        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 bg-slate-50/90 px-3 py-2 text-sm text-slate-700"
          role="status"
        >
          <span className="inline-flex items-center gap-1.5">
            <span className="text-slate-500">Till</span>
            <strong className="tabular-nums text-emerald-900">{loading ? "…" : formatUgx(snap?.tillEstimated ?? null)}</strong>
          </span>
          <span className="text-slate-300 hidden sm:inline" aria-hidden>
            |
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="text-slate-500">Vault</span>
            <strong className="tabular-nums text-slate-900">{loading ? "…" : formatUgx(snap?.vaultPosition ?? 0)}</strong>
          </span>
          <span className="text-slate-300 hidden sm:inline" aria-hidden>
            |
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="text-slate-500">Session</span>
            <strong className="text-slate-900">{loading ? "…" : snap?.openSession ? "Open" : "Closed"}</strong>
          </span>
          <span className="text-slate-300 hidden sm:inline" aria-hidden>
            |
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="text-slate-500">Pending</span>
            <strong className="tabular-nums text-amber-900">{loading ? "…" : snap?.pendingApprovalCount ?? 0}</strong>
          </span>
        </div>

        {!orgId ? <p className="text-xs text-slate-500">Link staff to an organization.</p> : null}
        {staffLinkMissing ? (
          <p className="text-xs text-red-700">
            Your login is not on the Staff list for this SACCO. Ask an administrator to add you under Staff (same account you
            use to sign in), then refresh.
          </p>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 space-y-4 pt-2">
      {mainTab === "transactions" && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 md:p-6 shadow-sm space-y-5">
            {initLoading || loading ? (
              <p className="text-sm text-slate-500 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading…
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2">
              <span className="text-xs font-medium text-slate-600">Teller entry</span>
              <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-medium">
                <button
                  type="button"
                  disabled={!canMutate}
                  onClick={() => setTellerEntryMode("simple")}
                  className={`rounded-md px-3 py-1.5 transition ${
                    tellerEntryMode === "simple" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  Simple
                </button>
                <button
                  type="button"
                  disabled={!canMutate}
                  onClick={() => setTellerEntryMode("accountant")}
                  className={`rounded-md px-3 py-1.5 transition ${
                    tellerEntryMode === "accountant" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  Accountant
                </button>
              </div>
              <span className="text-[11px] text-slate-500">
                Accountant mode asks for fee type on <strong>Fees</strong> tasks.
              </span>
            </div>

            {taskAction !== "cheque" && (
              <>
                <div>
                  <label className={label}>Member</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      className={`${field} pl-9`}
                      placeholder="Search name or member number…"
                      value={memberSearch}
                      onChange={(e) => {
                        setMemberSearch(e.target.value);
                        setSelectedMemberId("");
                        setSelectedSavingsAccountId("");
                      }}
                      disabled={!canMutate}
                      autoComplete="off"
                    />
                    {selectedMember && (
                      <p className="text-xs text-emerald-800 mt-1">
                        Selected: {selectedMember.member_number} — {selectedMember.full_name}
                      </p>
                    )}
                    {memberMatches.length > 0 && !selectedMemberId && (
                      <ul className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg text-sm">
                        {memberMatches.map((m) => (
                          <li key={m.id}>
                            <button
                              type="button"
                              className="w-full text-left px-3 py-2 hover:bg-emerald-50"
                              onClick={() => {
                                setSelectedMemberId(m.id);
                                setMemberSearch(`${m.member_number} — ${m.full_name}`);
                                setFieldMsg({});
                              }}
                            >
                              {m.member_number} — {m.full_name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {fieldMsg.member && <p className="text-sm text-amber-800 mt-1">{fieldMsg.member}</p>}
                </div>

                {taskRequiresSavingsAccount(taskAction) && selectedMemberId && memberSavings.length > 0 && (
                  <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-4">
                    <p className="text-sm font-semibold text-slate-900 mb-3">Accounts — tap one</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {memberSavings.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => {
                            setSelectedSavingsAccountId(a.id);
                            setFieldMsg({});
                          }}
                          className={`text-left rounded-xl border-2 px-4 py-4 transition-all shadow-sm ${
                            selectedSavingsAccountId === a.id
                              ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-300/60"
                              : "border-slate-200 bg-white hover:border-emerald-300"
                          }`}
                        >
                          <p className="text-base font-semibold text-slate-900 leading-snug">
                            {a.savings_product_code}
                            <span className="font-normal text-slate-600"> · {a.account_number}</span>
                          </p>
                          <p className="text-sm font-medium text-emerald-900 mt-2 tabular-nums">{formatUgx(a.balance)}</p>
                        </button>
                      ))}
                    </div>
                    {fieldMsg.account && <p className="text-sm text-amber-800 mt-2">{fieldMsg.account}</p>}
                  </div>
                )}

                {taskRequiresSavingsAccount(taskAction) && selectedMemberId && memberSavings.length === 0 && (
                  <p className="text-sm text-amber-800">No active savings account for this member.</p>
                )}

                <div className="space-y-3">
                  <label className={`${label} text-sm font-semibold text-slate-800`}>Amount (UGX)</label>
                  <input
                    className={amountFieldPos}
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    autoComplete="off"
                    value={amountWithCommas(amountStr)}
                    onChange={(e) => {
                      setAmountStr(digitsOnly(e.target.value));
                      setFieldMsg((f) => ({ ...f, amount: undefined }));
                    }}
                    disabled={!canMutate}
                  />
                  {fieldMsg.amount && <p className="text-sm text-amber-800">{fieldMsg.amount}</p>}
                </div>

                {taskAction === "fees" && tellerEntryMode === "accountant" && (
                  <div>
                    <label className={label}>Fee type (posting purpose)</label>
                    <select
                      className={`${field} [color-scheme:light]`}
                      value={accountantFeePostingPurpose}
                      onChange={(e) =>
                        setAccountantFeePostingPurpose(e.target.value as typeof accountantFeePostingPurpose)
                      }
                      disabled={!canMutate}
                    >
                      <option value="membership_fee">Membership fee</option>
                      <option value="subscription">Subscription</option>
                      <option value="shares">Shares / equity</option>
                      <option value="fee_or_penalty">Penalty or miscellaneous fee</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                )}
              </>
            )}

            {taskAction === "cheque" && (
              <div className="space-y-4">
                <div>
                  <label className={label}>Member (optional)</label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      className={`${field} pl-9`}
                      placeholder="Search…"
                      value={memberSearch}
                      onChange={(e) => {
                        setMemberSearch(e.target.value);
                        setSelectedMemberId("");
                      }}
                    />
                    {memberMatches.length > 0 && !selectedMemberId && (
                      <ul className="absolute z-20 mt-1 w-full max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg text-sm">
                        {memberMatches.map((m) => (
                          <li key={m.id}>
                            <button
                              type="button"
                              className="w-full text-left px-3 py-2 hover:bg-emerald-50"
                              onClick={() => {
                                setSelectedMemberId(m.id);
                                setMemberSearch(`${m.member_number} — ${m.full_name}`);
                              }}
                            >
                              {m.member_number} — {m.full_name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className={label}>Cheque number</label>
                    <input className={field} value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} />
                  </div>
                  <div>
                    <label className={label}>Bank</label>
                    <input className={field} value={chequeBank} onChange={(e) => setChequeBank(e.target.value)} />
                  </div>
                  <div>
                    <label className={label}>Value date</label>
                    <input className={field} type="date" value={chequeValueDate} onChange={(e) => setChequeValueDate(e.target.value)} />
                  </div>
                  <div>
                    <label className={label}>Cheque type</label>
                    <select
                      className={`${field} [color-scheme:light]`}
                      value={chequeFlow}
                      onChange={(e) => setChequeFlow(e.target.value as "received" | "paid" | "clearing")}
                    >
                      <option value="received">Received (deposit)</option>
                      <option value="paid">Paid (withdrawal)</option>
                      <option value="clearing">In clearing</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className={label}>Payee / reference</label>
                  <input className={field} value={chequePayeeRef} onChange={(e) => setChequePayeeRef(e.target.value)} />
                </div>
                <div className="space-y-3">
                  <label className={`${label} text-sm font-semibold text-slate-800`}>Amount (UGX)</label>
                  <input
                    className={amountFieldPos}
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    autoComplete="off"
                    value={amountWithCommas(chequeAmountStr)}
                    onChange={(e) => {
                      setChequeAmountStr(digitsOnly(e.target.value));
                      setFieldMsg((f) => ({ ...f, amount: undefined }));
                    }}
                  />
                  {fieldMsg.amount && <p className="text-sm text-amber-800">{fieldMsg.amount}</p>}
                </div>
              </div>
            )}

            {fieldMsg.gl && <p className="text-sm text-amber-800">{fieldMsg.gl}</p>}

            <div className="space-y-2">
              <label className={label}>Narration (optional)</label>
              <textarea
                className={`${field} min-h-[4.5rem] resize-y`}
                rows={3}
                placeholder="Shown on receipt or voucher"
                value={narration}
                onChange={(e) => setNarration(e.target.value)}
                disabled={!canMutate}
              />
            </div>

            <div className="space-y-3 pt-1">
              <button
                type="button"
                disabled={saving || !canMutate || initLoading}
                onClick={() => requestCompleteTransaction()}
                className="w-full rounded-2xl bg-emerald-600 py-4 text-center text-lg font-bold uppercase tracking-wide text-white shadow-lg hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? "Working…" : "Complete transaction"}
              </button>
              <p className="text-center text-[11px] leading-snug text-slate-500">
                Large amounts may require supervisor approval after confirm.
              </p>
            </div>
          </div>
        </div>
      )}

      {mainTab === "till" && (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
              <div className="flex items-center gap-2 text-slate-900 font-semibold text-sm">
                <Wallet className="w-5 h-5 text-emerald-600" />
                Till
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">Opening float</span>
                  <span className="font-mono tabular-nums">{snap?.openSession ? formatUgx(snap.openSession.opening_float) : "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Receipts (posted)</span>
                  <span className="font-mono tabular-nums">{formatUgx(snap?.sessionReceiptsTotal ?? 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Payments (posted)</span>
                  <span className="font-mono tabular-nums">{formatUgx(snap?.sessionPaymentsTotal ?? 0)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-slate-200 font-semibold">
                  <span>Expected balance</span>
                  <span className="font-mono tabular-nums text-emerald-800">{formatUgx(snap?.tillEstimated ?? null)}</span>
                </div>
              </div>

              {!snap?.openSession ? (
                <div className="space-y-2">
                  <label className={label}>Opening float (UGX)</label>
                  <input
                    className={field}
                    type="number"
                    min={0}
                    value={openFloatStr}
                    onChange={(e) => setOpenFloatStr(e.target.value)}
                  />
                  <label className={label}>Notes (optional)</label>
                  <input className={field} value={openSessionNotes} onChange={(e) => setOpenSessionNotes(e.target.value)} />
                  <button
                    type="button"
                    disabled={saving || !canMutate}
                    onClick={() => void handleOpenSession()}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white"
                  >
                    Open till session
                  </button>
                </div>
              ) : (
                <p className="text-sm text-emerald-800">Session is open. Close from End of day below when cash is counted.</p>
              )}

              <div className="border-t border-slate-100 pt-4 space-y-2">
                <p className="text-xs font-medium text-slate-800">Vault ↔ till</p>
                <input
                  className={`${field} tabular-nums`}
                  type="number"
                  min={0}
                  placeholder="Amount"
                  value={vaultXferStr}
                  onChange={(e) => setVaultXferStr(e.target.value)}
                />
                <input className={field} placeholder="Note" value={vaultXferNote} onChange={(e) => setVaultXferNote(e.target.value)} />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving || !canMutate}
                    onClick={() => void handleVaultFrom()}
                    className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
                  >
                    Vault → till
                  </button>
                  <button
                    type="button"
                    disabled={saving || !canMutate}
                    onClick={() => void handleVaultTo()}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    Till → vault
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
              <div className="flex items-center gap-2 font-semibold text-sm">
                <Lock className="w-5 h-5 text-slate-600" />
                Vault
              </div>
              <p className="text-2xl font-bold tabular-nums">{formatUgx(snap?.vaultPosition ?? 0)}</p>
            </div>
          </div>

          <div className="rounded-2xl border-2 border-slate-200 bg-slate-50/50 p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-emerald-600" />
              End of day
            </h3>
            <div className="flex flex-wrap gap-6 text-sm">
              <div>
                <p className="text-slate-500 text-xs">Expected</p>
                <p className="text-xl font-bold tabular-nums">{formatUgx(eodExpected)}</p>
              </div>
              <div className="flex-1 min-w-[12rem]">
                <p className="text-slate-500 text-xs">Counted</p>
                <input
                  className={`${field} text-lg font-semibold tabular-nums max-w-xs mt-1`}
                  type="text"
                  inputMode="numeric"
                  placeholder="0"
                  value={eodCounted}
                  onChange={(e) => setEodCounted(e.target.value.replace(/[^\d.]/g, ""))}
                />
              </div>
              <div>
                <p className="text-slate-500 text-xs">Difference</p>
                <p className={`text-xl font-bold tabular-nums ${eodVariance !== null && eodVariance !== 0 ? "text-amber-800" : "text-slate-900"}`}>
                  {eodVariance === null ? "—" : eodVariance > 0 ? `+${formatUgx(eodVariance).replace("UGX ", "")}` : formatUgx(eodVariance)}
                </p>
              </div>
            </div>
            <input
              className={field}
              placeholder="Close notes (optional)"
              value={eodCloseNotes}
              onChange={(e) => setEodCloseNotes(e.target.value)}
            />
            <button
              type="button"
              disabled={saving || !canMutate}
              onClick={() => void handleEodClose()}
              className="w-full sm:w-auto rounded-xl bg-slate-900 text-white font-semibold px-6 py-3 hover:bg-slate-800"
            >
              Close till
            </button>
          </div>
        </div>
      )}

      {mainTab === "approvals" && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Review and approve or reject. Same screen works for tellers and supervisors.</p>
          <div className="grid gap-3">
            {(snap?.pendingApprovals?.length ?? 0) === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500">No items in the queue.</div>
            ) : (
              snap!.pendingApprovals.map((t) => {
                const isMaker = Boolean(staffId && t.maker_staff_id === staffId);
                return (
                  <div
                    key={t.id}
                    className="rounded-2xl border-2 border-amber-100 bg-gradient-to-br from-amber-50/80 to-white p-4 shadow-sm flex flex-col sm:flex-row sm:items-stretch gap-3"
                  >
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="text-lg font-bold text-slate-900">
                        {pendingCardLabel(t)} — {formatUgx(t.amount)}
                      </p>
                      <p className="text-sm text-slate-700 line-clamp-2">{t.member_ref || "—"}</p>
                      <p className="text-xs text-slate-500">{new Date(t.created_at).toLocaleString()}</p>
                      {t.narration ? <p className="text-xs text-slate-600 italic">{t.narration}</p> : null}
                      {isMaker ? <p className="text-xs text-slate-500">You are the maker — you may still approve or reject here.</p> : null}
                      {canEditTransactions ? (
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => openEditTransaction(t)}
                          className="text-xs font-medium text-emerald-700 hover:text-emerald-900 text-left"
                        >
                          Edit before approve
                        </button>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-2 sm:w-56 shrink-0">
                      <input
                        className={field + " text-xs py-1.5"}
                        placeholder="Reject reason"
                        value={rejectNotes[t.id] ?? ""}
                        onChange={(e) => setRejectNotes((p) => ({ ...p, [t.id]: e.target.value }))}
                        disabled={!canMutate || saving}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="flex-1 rounded-lg bg-emerald-600 text-white text-sm font-medium py-2"
                          disabled={!canMutate || saving}
                          onClick={() => void handleApprovePending(t.id)}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="flex-1 rounded-lg border-2 border-red-200 bg-red-50 text-red-900 text-sm font-medium py-2"
                          disabled={!canMutate || saving}
                          onClick={() => void handleRejectPending(t.id)}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {mainTab === "reports" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-2">
            <TabButton
              active={reportsSubTab === "daily_summary"}
              onClick={() => {
                setReportsSubTab("daily_summary");
                onDeskNavigate?.(SACCOPRO_PAGE.teller, { tellerDesk: "daily" });
              }}
            >
              <FileBarChart className="hidden sm:inline h-3.5 w-3.5 opacity-70" />
              Daily summary
            </TabButton>
            <TabButton
              active={reportsSubTab === "recent_activity"}
              onClick={() => {
                setReportsSubTab("recent_activity");
                onDeskNavigate?.(SACCOPRO_PAGE.teller, { tellerDesk: "daily", tellerReportsTab: "recent_activity" });
              }}
            >
              <ScrollText className="hidden sm:inline h-3.5 w-3.5 opacity-70" />
              Recent teller activity
            </TabButton>
          </div>

          {reportsSubTab === "daily_summary" ? (
            <>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 flex flex-wrap items-end gap-3">
                <label className="text-sm">
                  <span className="block text-xs font-medium text-slate-600 mb-1">Summary date</span>
                  <input
                    type="date"
                    value={dailyReportDate}
                    onChange={(e) => setDailyReportDate(e.target.value)}
                    className={field + " max-w-[11rem]"}
                  />
                </label>
                <button
                  type="button"
                  disabled={!snap || snap.schemaMissing || loading}
                  onClick={() => void openReportPreview("daily_summary", dailyReportDate)}
                  className="rounded-lg bg-emerald-700 text-white px-4 py-2 text-sm font-medium hover:bg-emerald-800 disabled:opacity-50"
                >
                  Refresh preview
                </button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {reportCards.map((r) => {
                  const Icon = r.icon;
                  return (
                    <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col gap-2">
                      <div className="flex items-start gap-3">
                        <div className="rounded-lg bg-emerald-100 p-2 text-emerald-700">
                          <Icon className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-slate-900 text-sm">{r.title}</h3>
                          <p className="text-xs text-slate-600 mt-1">{r.desc}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-auto">
                        <button
                          type="button"
                          disabled={!snap || snap.schemaMissing || loading}
                          onClick={() =>
                            void openReportPreview(
                              r.id,
                              r.id === "daily_summary" ? dailyReportDate : undefined
                            )
                          }
                          className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-emerald-700 disabled:opacity-50"
                        >
                          Preview
                        </button>
                        <button
                          type="button"
                          disabled={!snap || snap.schemaMissing || loading}
                          onClick={() => {
                            void (async () => {
                              if (!snap || snap.schemaMissing) return;
                              const opts = await buildReportOptions(
                                r.id,
                                r.id === "daily_summary" ? dailyReportDate : undefined
                              );
                              const csv = buildTellerReportCsv(r.id, snap, opts);
                              downloadCsv(`teller_${r.id}_${dailyReportDate}.csv`, csv);
                            })();
                          }}
                          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-900 disabled:opacity-50"
                        >
                          CSV
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="px-4 py-2 border-b border-slate-100 text-sm font-medium">Audit preview</div>
                <div className="overflow-x-auto text-sm">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left text-xs text-slate-500 border-b">
                        <th className="p-2">Time</th>
                        <th className="p-2">Action</th>
                        <th className="p-2">Entity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(snap?.recentAudit?.length ?? 0) === 0 ? (
                        <tr>
                          <td colSpan={3} className="p-6 text-center text-slate-500">
                            No rows yet.
                          </td>
                        </tr>
                      ) : (
                        snap!.recentAudit.map((a) => (
                          <tr key={a.id} className="border-b">
                            <td className="p-2 text-xs whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</td>
                            <td className="p-2 font-mono text-xs">{a.action}</td>
                            <td className="p-2 text-xs">{a.entity_type}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm font-medium">Recent teller activity</span>
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                  <label className="flex items-center gap-2 shrink-0">
                    <span>Date</span>
                    <input
                      type="date"
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500 max-w-[11rem]"
                      value={recentActivityDate}
                      onChange={(e) => setRecentActivityDate(e.target.value.slice(0, 10))}
                      disabled={recentActivityDisabled}
                    />
                  </label>
                  <label className="flex items-center gap-2 shrink-0">
                    <span>Per page</span>
                    <select
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500"
                      value={recentActivityPageSize}
                      onChange={(e) => setRecentActivityPageSize(Number(e.target.value))}
                      disabled={recentActivityDisabled}
                    >
                      {RECENT_ACTIVITY_PAGE_SIZE_OPTIONS.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b">
                      <th className="p-2">Business date</th>
                      <th className="p-2">Time</th>
                      <th className="p-2">Type</th>
                      <th className="p-2">Member</th>
                      <th className="p-2">Mbr #</th>
                      <th className="p-2">Savings acct</th>
                      <th className="p-2">Amount</th>
                      <th className="p-2">Status</th>
                      {canEditTransactions ? <th className="p-2 w-16" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {recentActivityLoading ? (
                      <tr>
                        <td colSpan={canEditTransactions ? 9 : 8} className="p-6 text-center text-slate-500">
                          <span className="inline-flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                            Loading transactions…
                          </span>
                        </td>
                      </tr>
                    ) : recentActivityRows.length === 0 ? (
                      <tr>
                        <td colSpan={canEditTransactions ? 9 : 8} className="p-6 text-center text-slate-500">
                          No transactions for this date.
                        </td>
                      </tr>
                    ) : (
                      recentActivityPagedRows.map((t) => {
                        const td = t.txn_date?.trim().slice(0, 10) ?? "";
                        const businessDate =
                          /^\d{4}-\d{2}-\d{2}$/.test(td) ? td : toBusinessDateString(t.created_at);
                        const mem = t.sacco_member_id ? recentActivityMemberById.get(t.sacco_member_id) : undefined;
                        const sav = t.sacco_member_savings_account_id
                          ? recentActivitySavingsById.get(t.sacco_member_savings_account_id)
                          : undefined;
                        return (
                        <tr key={t.id} className="border-b border-slate-50">
                          <td className="p-2 text-xs whitespace-nowrap tabular-nums">{businessDate}</td>
                          <td className="p-2 text-xs whitespace-nowrap">{new Date(t.created_at).toLocaleTimeString()}</td>
                          <td className="p-2 text-xs">{formatTxnTypeLabel(String(t.txn_type))}</td>
                          <td className="p-2 text-xs max-w-[8rem] break-words">{mem?.full_name ?? "—"}</td>
                          <td className="p-2 text-xs tabular-nums">{mem?.member_number ?? "—"}</td>
                          <td className="p-2 text-xs tabular-nums">{sav?.account_number ?? "—"}</td>
                          <td className="p-2 tabular-nums">{formatUgx(t.amount)}</td>
                          <td className="p-2 text-xs">{t.status}</td>
                          {canEditTransactions ? (
                            <td className="p-2">
                              {(t.status === "pending_approval" || t.status === "draft" || (t.status === "posted" && canCorrectPostedTellerTxnType(String(t.txn_type)))) &&
                              t.status !== "reversed" ? (
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={() => openEditTransaction(t)}
                                  className="text-xs font-medium text-emerald-700 hover:text-emerald-900"
                                >
                                  Edit
                                </button>
                              ) : null}
                            </td>
                          ) : null}
                        </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {!recentActivityLoading && recentActivityRows.length > 0 ? (
                <div className="px-4 py-2 border-t border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
                  <span className="tabular-nums">
                    Showing{" "}
                    {recentActivityPageIndex * recentActivityPageSize + 1}
                    –
                    {Math.min(recentActivityRows.length, (recentActivityPageIndex + 1) * recentActivityPageSize)} of{" "}
                    {recentActivityRows.length}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="tabular-nums text-slate-500">
                      Page {recentActivityPageIndex + 1} of {recentActivityPageCount}
                    </span>
                    <button
                      type="button"
                      disabled={recentActivityPageIndex <= 0}
                      onClick={() => setRecentActivityPageIndex((p) => Math.max(0, p - 1))}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" aria-hidden />
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={recentActivityPageIndex >= recentActivityPageCount - 1}
                      onClick={() => setRecentActivityPageIndex((p) => Math.min(recentActivityPageCount - 1, p + 1))}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none"
                    >
                      Next
                      <ChevronRight className="w-3.5 h-3.5" aria-hidden />
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}

      {mainTab === "oversight" && showAdminControls && (
        <div className="space-y-4">
          <SaccoTillOversightPanel
            positions={tillPositions}
            insuredLimitUgx={insuredLimitUgx}
            loading={tillPositionsLoading}
            onRefresh={() => void refreshTillOversight()}
            canSupervise
            saving={saving}
            onCloseTill={(sessionId) => void handleSupervisorCloseSession(sessionId)}
          />
        </div>
      )}

      {mainTab === "controls" && showAdminControls && (
        <div className="max-w-xl space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
            <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
              Till insured cash limit
            </h2>
            <p className="text-sm text-slate-600">
              Maximum cash per open till before oversight flags uninsured exposure.
            </p>
            <label className="block text-sm">
              <span className={label}>Limit (UGX)</span>
              <input
                className={field}
                inputMode="numeric"
                placeholder="e.g. 50000000"
                value={insuredLimitDraft}
                onChange={(e) => setInsuredLimitDraft(e.target.value.replace(/\D/g, ""))}
              />
            </label>
            <button
              type="button"
              disabled={!orgId || saving}
              onClick={() =>
                void runMutation(async () => {
                  if (!orgId) return;
                  const n = insuredLimitDraft.trim() === "" ? null : Number(insuredLimitDraft);
                  await upsertSaccoTillInsuredLimit(orgId, n);
                  await refreshTillOversight();
                }, { successMessage: "Insured till limit saved." })
              }
              className="rounded-lg bg-emerald-600 text-white px-4 py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
            >
              Save limit
            </button>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
            <h2 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
              Limits (reference)
            </h2>
            <p className="text-sm text-slate-600">Auto-post and approval cut-offs for the teller screen are in code today and can be moved to org settings later.</p>
            <ul className="text-sm text-slate-700 space-y-2">
              <li className="flex justify-between border-b border-slate-100 py-2">
                <span>Max single auto-post (UGX)</span>
                <span className="font-mono">10,000,000</span>
              </li>
              <li className="flex justify-between border-b border-slate-100 py-2">
                <span>Max session volume for auto-post (UGX)</span>
                <span className="font-mono">100,000,000</span>
              </li>
            </ul>
          </div>
        </div>
      )}
      </div>

      <nav
        className="sticky bottom-0 z-30 mt-auto flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur-md supports-[backdrop-filter]:bg-white/90 md:px-6"
        aria-label="Teller sections"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 md:gap-x-5">
          <TabButton active={mainTab === "transactions"} onClick={() => goMainTab("transactions")}>
            <ArrowDownToLine className="hidden sm:inline h-3.5 w-3.5 opacity-70" />
            Transactions
          </TabButton>
          <TabButton active={mainTab === "till"} onClick={() => goMainTab("till")}>
            <Landmark className="hidden sm:inline h-3.5 w-3.5 opacity-70" />
            Till
          </TabButton>
          <TabButton active={mainTab === "approvals"} onClick={() => goMainTab("approvals")}>
            <UserCheck className="hidden sm:inline h-3.5 w-3.5 opacity-70" />
            Approvals
          </TabButton>
          <TabButton active={mainTab === "reports"} onClick={() => goMainTab("reports")}>
            <ScrollText className="hidden sm:inline h-3.5 w-3.5 opacity-70" />
            Reports
          </TabButton>
          {showAdminControls ? (
            <TabButton
              active={mainTab === "oversight"}
              onClick={() => {
                setMainTab("oversight");
                onDeskNavigate?.(SACCOPRO_PAGE.teller, { tellerDesk: "oversight" });
              }}
            >
              <Eye className="hidden sm:inline h-3.5 w-3.5 opacity-70" />
              Till oversight
            </TabButton>
          ) : null}
          {showAdminControls ? (
            <TabButton active={mainTab === "controls"} onClick={() => goMainTab("controls")}>
              <Shield className="hidden sm:inline h-3.5 w-3.5 opacity-70" />
              Controls
            </TabButton>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            void load().then(() => void fetchRecentActivity(recentActivityDate));
          }}
          disabled={loading || !orgId}
          className="inline-flex items-center gap-1 rounded-md border border-slate-100 bg-slate-50 px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50 shrink-0"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
          Refresh
        </button>
      </nav>

      {openTillModal ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="relative max-w-md w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <button
              type="button"
              className="absolute right-3 top-3 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              onClick={() => setOpenTillModal(false)}
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-semibold text-slate-900 pr-10">Open till session</h2>
            <p className="mt-1 text-sm text-slate-600">Enter opening float counted at hand-over.</p>
            <div className="mt-4 space-y-3">
              <div>
                <label className={label}>Opening float (UGX)</label>
                <input
                  className={`${field} tabular-nums text-lg`}
                  type="number"
                  min={0}
                  placeholder="0"
                  value={openFloatStr}
                  onChange={(e) => setOpenFloatStr(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <label className={label}>Notes (optional)</label>
                <input className={field} value={openSessionNotes} onChange={(e) => setOpenSessionNotes(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2 pt-2">
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    disabled={saving || !orgId || !staffId || snap?.schemaMissing}
                    onClick={() => void submitOpenTillFromModal()}
                  >
                    Open till
                  </button>
                  <button
                    type="button"
                    className="flex-1 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                    disabled={saving || !orgId || !staffId || snap?.schemaMissing}
                    onClick={() => void handleResumeOpenTill()}
                  >
                    Resume existing
                  </button>
                </div>
                <button
                  type="button"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  disabled={saving || !orgId || !staffId}
                  onClick={() => void handleCloseStuckTill()}
                >
                  Close stuck session (then open again)
                </button>
                <button type="button" className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={() => setOpenTillModal(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {confirmTxnOpen ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="relative max-w-md w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
            <button
              type="button"
              className="absolute right-3 top-3 rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              onClick={() => setConfirmTxnOpen(false)}
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-lg font-semibold text-slate-900 pr-10">Confirm transaction</h2>
            <p className="mt-3 text-base leading-snug text-slate-800">{confirmTransactionSummary.verbSentence}</p>
            <div className="mt-4 space-y-2 rounded-xl bg-slate-50 px-4 py-3 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-slate-500 shrink-0">Amount</span>
                <span className="font-semibold tabular-nums text-right">{confirmTransactionSummary.amountDisplay}</span>
              </div>
              {(taskRequiresMemberOnly(taskAction) || taskRequiresSavingsAccount(taskAction) || taskAction === "cheque") &&
              confirmTransactionSummary.memberLine !== "—" ? (
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500 shrink-0">Member</span>
                  <span className="text-right text-slate-900">{confirmTransactionSummary.memberLine}</span>
                </div>
              ) : null}
              {confirmTransactionSummary.accountDetail ? (
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500 shrink-0">Account</span>
                  <span className="text-right text-slate-900">{confirmTransactionSummary.accountDetail}</span>
                </div>
              ) : null}
            </div>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                disabled={saving || !canMutate || initLoading}
                onClick={() => {
                  void (async () => {
                    const ok = await doComplete();
                    if (ok) setConfirmTxnOpen(false);
                  })();
                }}
              >
                Confirm
              </button>
              <button
                type="button"
                className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => setConfirmTxnOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <SaccoEditTellerTransactionModal
        open={editTxnOpen}
        txn={editTxn}
        members={pickMembers}
        savingsAccounts={pickSavingsAccounts}
        saving={saving}
        onClose={() => {
          setEditTxnOpen(false);
          setEditTxn(null);
        }}
        onSave={(patch, reason) => handleSaveTxnEdit(patch, reason)}
      />

      <SaccoTellerReportPreview
        open={reportPreviewOpen}
        onClose={() => setReportPreviewOpen(false)}
        table={reportPreviewTable}
        orgName={orgName}
        onDownloadPdf={() => {
          if (!reportPreviewTable || !activeReportId) return;
          downloadTellerReportPdf(
            reportPreviewTable,
            `teller_${activeReportId}_${dailyReportDate}.pdf`,
            orgName
          );
        }}
        onDownloadCsv={() => {
          if (!snap || !activeReportId || snap.schemaMissing) return;
          void (async () => {
            const opts = await buildReportOptions(
              activeReportId,
              activeReportId === "daily_summary" ? dailyReportDate : undefined
            );
            downloadCsv(
              `teller_${activeReportId}_${dailyReportDate}.csv`,
              buildTellerReportCsv(activeReportId, snap, opts)
            );
          })();
        }}
      />
    </div>
  );
}

