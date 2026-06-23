import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Bell,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  FileText,
  Landmark,
  PiggyBank,
  QrCode,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  UserRound,
  Wifi,
  WifiOff,
} from "lucide-react";
import { PageNotes } from "@/components/common/PageNotes";
import { useAppContext } from "@/contexts/AppContext";
import { useAuth } from "@/contexts/AuthContext";
import { SACCOPRO_PAGE } from "@/lib/saccoproPages";
import {
  fetchSavingsAccountsList,
  type SaccoSavingsAccountListRow,
} from "@/lib/saccoSavingsAccountsList";
import {
  queueMemberRequest,
  readMemberRequests,
  syncMemberRequests,
  type MemberRequestKind,
  type SaccoMemberRequest,
} from "@/lib/saccoMemberOffline";

type Props = {
  navigate?: (page: string, state?: Record<string, unknown>) => void;
  readOnly?: boolean;
  memberIdFromAuth?: string;
  memberMode?: boolean;
};

function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "active" || s === "disbursed" || s === "approved") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (s === "pending") return "bg-amber-50 text-amber-700 border-amber-200";
  if (s === "closed") return "bg-slate-50 text-slate-600 border-slate-200";
  return "bg-rose-50 text-rose-700 border-rose-200";
}

function isShareAccount(code: string): boolean {
  const c = code.trim().toUpperCase();
  return c.includes("SHARE") || c === "EQUITY" || c.startsWith("SHR");
}

function moneyDelta(row: { debit: number; credit: number }): number {
  return Number(row.debit || 0) - Number(row.credit || 0);
}

const SaccoClientDashboard: React.FC<Props> = ({ navigate, readOnly, memberIdFromAuth, memberMode = false }) => {
  const { user, isSuperAdmin, signOut } = useAuth();
  const { members, loans, fixedDeposits, cashbook, formatCurrency } = useAppContext();
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [accounts, setAccounts] = useState<SaccoSavingsAccountListRow[]>([]);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [memberRequests, setMemberRequests] = useState<SaccoMemberRequest[]>([]);
  const [activeAction, setActiveAction] = useState<MemberRequestKind | null>(null);
  const [actionForm, setActionForm] = useState({ amount: "", destination: "", provider: "MTN", reference: "", note: "" });
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (memberIdFromAuth) {
      setSelectedMemberId(memberIdFromAuth);
      return;
    }
    if (!selectedMemberId) {
      const firstActive = members.find((m) => m.status === "active") ?? members[0];
      if (firstActive) setSelectedMemberId(firstActive.id);
    }
  }, [memberIdFromAuth, members, selectedMemberId]);

  useEffect(() => {
    const orgId = user?.organization_id;
    if (!orgId) return;
    let alive = true;
    setAccountsError(null);
    const cacheKey = `boat.sacco.member.accounts.v1:${orgId}`;
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || "[]");
      if (Array.isArray(cached) && cached.length) setAccounts(cached);
    } catch { /* keep server data */ }
    void fetchSavingsAccountsList(orgId)
      .then((rows) => {
        if (alive) {
          setAccounts(rows);
          localStorage.setItem(cacheKey, JSON.stringify(rows));
        }
      })
      .catch((e) => {
        if (alive) setAccountsError(navigator.onLine
          ? (e instanceof Error ? e.message : "Could not load savings accounts.")
          : "Offline: showing the most recently saved account information on this device.");
      });
    return () => {
      alive = false;
    };
  }, [user?.organization_id]);

  useEffect(() => {
    const setConnected = () => setOnline(navigator.onLine);
    window.addEventListener("online", setConnected);
    window.addEventListener("offline", setConnected);
    return () => {
      window.removeEventListener("online", setConnected);
      window.removeEventListener("offline", setConnected);
    };
  }, []);

  useEffect(() => {
    const orgId = user?.organization_id;
    if (!orgId || !selectedMemberId) return;
    const refresh = () => setMemberRequests(readMemberRequests(orgId, selectedMemberId));
    refresh();
    window.addEventListener("boat:sacco-member-queue", refresh);
    return () => window.removeEventListener("boat:sacco-member-queue", refresh);
  }, [selectedMemberId, user?.organization_id]);

  useEffect(() => {
    const orgId = user?.organization_id;
    if (!online || !orgId || !selectedMemberId) return;
    setSyncing(true);
    void syncMemberRequests(orgId, selectedMemberId)
      .then(setMemberRequests)
      .finally(() => setSyncing(false));
  }, [online, selectedMemberId, user?.organization_id]);

  const memberOptions = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    const allowedMembers = memberIdFromAuth ? members.filter((m) => m.id === memberIdFromAuth) : members;
    const source = q
      ? allowedMembers.filter((m) => `${m.name} ${m.accountNumber} ${m.phone ?? ""}`.toLowerCase().includes(q))
      : allowedMembers;
    return source.slice().sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
  }, [memberIdFromAuth, memberSearch, members]);

  const member = members.find((m) => m.id === selectedMemberId) ?? null;
  const memberLoans = useMemo(
    () => loans.filter((l) => l.memberId === selectedMemberId).sort((a, b) => b.applicationDate.localeCompare(a.applicationDate)),
    [loans, selectedMemberId]
  );
  const memberAccounts = useMemo(
    () =>
      accounts
        .filter((a) => a.sacco_member_id === selectedMemberId)
        .slice()
        .sort((a, b) => a.account_number.localeCompare(b.account_number)),
    [accounts, selectedMemberId]
  );
  const memberFDs = useMemo(
    () => fixedDeposits.filter((f) => f.memberId === selectedMemberId).sort((a, b) => b.startDate.localeCompare(a.startDate)),
    [fixedDeposits, selectedMemberId]
  );
  const memberTransactions = useMemo(
    () => cashbook.filter((c) => c.memberId === selectedMemberId).slice().sort((a, b) => b.date.localeCompare(a.date)),
    [cashbook, selectedMemberId]
  );

  const ordinaryAccounts = memberAccounts.filter((a) => !isShareAccount(a.savings_product_code));
  const shareAccounts = memberAccounts.filter((a) => isShareAccount(a.savings_product_code));
  const activeLoans = memberLoans.filter((l) => ["approved", "disbursed", "defaulted"].includes(l.status));
  const totalLoanBalance = activeLoans.reduce((sum, loan) => sum + Number(loan.balance || 0), 0);
  const lastTransaction = memberTransactions[0] ?? null;

  const submitMemberRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    const orgId = user?.organization_id;
    const amount = Number(actionForm.amount);
    if (!orgId || !member || !activeAction || !Number.isFinite(amount) || amount <= 0) return;
    if (activeAction === "member_transfer" && !actionForm.destination.trim()) return;
    if (activeAction === "bill_payment" && !actionForm.reference.trim()) return;
    queueMemberRequest({
      organizationId: orgId,
      memberId: member.id,
      kind: activeAction,
      amount,
      destination: actionForm.destination.trim() || undefined,
      provider: actionForm.provider || undefined,
      accountReference: actionForm.reference.trim() || undefined,
      note: actionForm.note.trim() || undefined,
    });
    if (online) {
      setSyncing(true);
      const rows = await syncMemberRequests(orgId, member.id);
      setMemberRequests(rows);
      setSyncing(false);
      setActionMessage("Request submitted for confirmation. Your balance changes only after it is processed.");
    } else {
      setActionMessage("Saved safely on this phone. It will submit automatically when internet returns.");
    }
    setActionForm({ amount: "", destination: "", provider: "MTN", reference: "", note: "" });
    setActiveAction(null);
  };

  if (!member) {
    if (memberMode) {
      return <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4 text-sm font-semibold text-slate-600">Loading your SACCO account…</div>;
    }
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <Landmark className="text-emerald-600" size={26} />
          <h1 className="text-2xl font-bold text-slate-900">SACCO member app</h1>
          <PageNotes ariaLabel="SACCO member app help">
            <p>Member-facing account view built from the SACCO member, savings, teller, cashbook, and loan records.</p>
          </PageNotes>
        </div>
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <label className="block text-xs font-semibold uppercase text-slate-500">Member</label>
          <select
            value={selectedMemberId}
            onChange={(e) => setSelectedMemberId(e.target.value)}
            className="mt-2 w-full max-w-xl rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
          >
            <option value="">Choose a member...</option>
            {memberOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.accountNumber})
              </option>
            ))}
          </select>
        </section>
      </div>
    );
  }

  const availableBalance = memberAccounts.reduce((sum, account) => sum + Number(account.balance || 0), 0) || member.savingsBalance;
  const latestLoan = memberLoans[0] ?? null;
  const notifications = [
    lastTransaction ? `Latest activity: ${lastTransaction.description}` : "No recent member activity yet.",
    latestLoan ? `Loan ${latestLoan.loanType} is ${latestLoan.status.replace(/_/g, " ")}.` : "No loan application currently on file.",
    shareAccounts.length > 0 ? `${shareAccounts.length} share account${shareAccounts.length === 1 ? "" : "s"} active.` : "Share account not opened yet.",
  ];
  const mobileActions: Array<{
    label: string;
    desc: string;
    icon: React.ReactNode;
    tone: string;
    disabled?: boolean;
    onClick?: () => void;
  }> = [
    {
      label: "Save",
      desc: "Add savings",
      icon: <PiggyBank size={20} />,
      tone: "bg-emerald-50 text-emerald-700 border-emerald-100",
      disabled: readOnly,
      onClick: () => setActiveAction("savings_deposit"),
    },
    {
      label: "Transfer",
      desc: "Member to member",
      icon: <Send size={20} />,
      tone: "bg-sky-50 text-sky-700 border-sky-100",
      disabled: readOnly,
      onClick: () => setActiveAction("member_transfer"),
    },
    {
      label: "Loans",
      desc: "Apply",
      icon: <CreditCard size={20} />,
      tone: "bg-violet-50 text-violet-700 border-violet-100",
      disabled: readOnly,
      onClick: () => navigate?.(SACCOPRO_PAGE.loanInput, { memberId: member.id }),
    },
    {
      label: "Statement",
      desc: "Download/view",
      icon: <FileText size={20} />,
      tone: "bg-slate-50 text-slate-700 border-slate-200",
      onClick: () => navigate?.(SACCOPRO_PAGE.savingsStatements, { memberId: member.id }),
    },
    {
      label: "Bills",
      desc: "Utilities & airtime",
      icon: <Smartphone size={20} />,
      tone: "bg-amber-50 text-amber-700 border-amber-100",
      disabled: readOnly,
      onClick: () => setActiveAction("bill_payment"),
    },
    {
      label: "Balance",
      desc: "Available offline",
      icon: <QrCode size={20} />,
      tone: "bg-rose-50 text-rose-700 border-rose-100",
    },
  ];

  return (
    <div className={memberMode ? "min-h-screen space-y-5 bg-slate-100 p-3 pb-10 sm:p-6" : "space-y-6"}>
      <div className={`sticky top-2 z-20 flex items-center justify-between gap-3 rounded-xl border px-4 py-3 shadow-sm ${online ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-950"}`}>
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          {online ? <Wifi size={18} /> : <WifiOff size={18} />}
          <span>{online ? (syncing ? "Internet restored — syncing…" : "Online") : "Offline mode — balances are last synced"}</span>
        </div>
        <span className="shrink-0 rounded-full bg-white/80 px-2.5 py-1 text-xs font-bold">
          {memberRequests.filter((row) => row.status !== "submitted").length} pending
        </span>
      </div>

      {actionMessage && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> {actionMessage}
        </div>
      )}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Landmark className="text-emerald-600" size={26} />
          <h1 className="text-2xl font-bold text-slate-900">SACCO member app</h1>
          <PageNotes ariaLabel="SACCO member app help">
            <p>
              Mobile member self-service with cached balances and an offline request queue. Money is posted only after server confirmation.
            </p>
          </PageNotes>
        </div>
        {!memberMode && <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-slate-400" />
            <input
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              placeholder="Search member"
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm sm:w-56"
            />
          </div>
          <select
            value={selectedMemberId}
            onChange={(e) => setSelectedMemberId(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm sm:w-64"
          >
            {memberOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.accountNumber})
              </option>
            ))}
          </select>
        </div>}
        {memberMode && <button type="button" onClick={() => void signOut()} className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700">Sign out</button>}
      </div>

      {accountsError && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{accountsError}</p>
      )}

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(320px,420px)_1fr]">
        <div className="mx-auto w-full max-w-[420px] rounded-[2rem] border border-slate-300 bg-slate-950 p-3 shadow-2xl">
          <div className="overflow-hidden rounded-[1.5rem] bg-slate-50">
            <div className="bg-slate-900 px-5 pb-5 pt-4 text-white">
              <div className="mx-auto mb-4 h-1.5 w-16 rounded-full bg-white/25" />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase text-emerald-200">Member App</p>
                  <h2 className="mt-1 text-xl font-bold">{member.name}</h2>
                  <p className="text-xs text-slate-300">{member.accountNumber}</p>
                </div>
                <button
                  type="button"
                  className="relative flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
                  aria-label="Notifications"
                >
                  <Bell size={18} />
                  <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-emerald-400" />
                </button>
              </div>

              <div className="mt-5 rounded-2xl bg-emerald-500 p-4 text-emerald-950">
                <p className="text-xs font-semibold uppercase">Available balance</p>
                <p className="mt-1 text-2xl font-black tabular-nums">{formatCurrency(availableBalance)}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-semibold">
                  <span>Savings {formatCurrency(member.savingsBalance)}</span>
                  <span>Shares {formatCurrency(member.sharesBalance)}</span>
                </div>
              </div>
            </div>

            <div className="space-y-5 px-4 py-5">
              <div className="grid grid-cols-3 gap-3">
                {mobileActions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    onClick={action.onClick}
                    disabled={action.disabled || (!action.onClick && action.label !== "Balance" && action.label !== "QR Pay")}
                    className={`min-h-[86px] rounded-2xl border p-3 text-left transition enabled:hover:-translate-y-0.5 enabled:hover:shadow-sm disabled:opacity-55 ${action.tone}`}
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/75">{action.icon}</span>
                    <span className="mt-2 block text-sm font-bold">{action.label}</span>
                    <span className="block text-[11px] leading-tight opacity-75">{action.desc}</span>
                  </button>
                ))}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">Notifications</h3>
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                    {notifications.length}
                  </span>
                </div>
                <div className="mt-3 space-y-2">
                  {notifications.map((note) => (
                    <p key={note} className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700">
                      {note}
                    </p>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">Latest statement</h3>
                  <button
                    type="button"
                    onClick={() => navigate?.(SACCOPRO_PAGE.savingsStatements, { memberId: member.id })}
                    disabled={!navigate}
                    className="text-xs font-semibold text-emerald-700 disabled:opacity-50"
                  >
                    View all
                  </button>
                </div>
                {memberTransactions.slice(0, 3).map((row) => {
                  const delta = moneyDelta(row);
                  const incoming = delta >= 0;
                  return (
                    <div key={row.id} className="flex items-center justify-between border-t border-slate-100 py-2 first:border-t-0">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-slate-900">{row.description}</p>
                        <p className="text-[11px] text-slate-500">{row.date}</p>
                      </div>
                      <p className={`text-xs font-bold tabular-nums ${incoming ? "text-emerald-700" : "text-rose-700"}`}>
                        {incoming ? "+" : "-"}{formatCurrency(Math.abs(delta))}
                      </p>
                    </div>
                  );
                })}
                {memberTransactions.length === 0 && <p className="text-xs text-slate-500">No statement activity yet.</p>}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-semibold uppercase text-emerald-700">Smartphone member experience</p>
            <h2 className="mt-1 text-xl font-bold text-slate-900">Member self-service app</h2>
            <p className="mt-2 text-sm text-slate-600">
              This is the phone-facing SACCO app surface members would use for balances, transfers, loan applications,
              statements, notifications, QR payments, and mobile money deposits.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {mobileActions.map((action) => (
              <div key={action.label} className="rounded-lg border border-slate-200 p-3">
                <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <span className={`flex h-8 w-8 items-center justify-center rounded-lg border ${action.tone}`}>{action.icon}</span>
                  {action.label}
                </p>
                <p className="mt-1 text-xs text-slate-500">{action.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {activeAction && (
        <section className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
          <form onSubmit={submitMemberRequest} className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Member self-service</p>
                <h2 className="mt-1 text-xl font-black text-slate-950">
                  {activeAction === "savings_deposit" ? "Add to savings" : activeAction === "member_transfer" ? "Send to a member" : "Pay a bill"}
                </h2>
                <p className="mt-1 text-xs text-slate-500">{online ? "Will submit now for confirmation." : "Will be saved in this device's local app storage and queued until online."}</p>
              </div>
              <button type="button" onClick={() => setActiveAction(null)} className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-bold">Close</button>
            </div>
            <div className="space-y-4">
              {activeAction === "member_transfer" && (
                <label className="block text-sm font-semibold text-slate-700">Recipient member number
                  <input required value={actionForm.destination} onChange={(e) => setActionForm((f) => ({ ...f, destination: e.target.value }))} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3" placeholder="e.g. SAC-00124" />
                </label>
              )}
              {activeAction === "bill_payment" && (<>
                <label className="block text-sm font-semibold text-slate-700">Provider
                  <select value={actionForm.provider} onChange={(e) => setActionForm((f) => ({ ...f, provider: e.target.value }))} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3">
                    <option>MTN</option><option>Airtel</option><option>UMEME</option><option>NWSC</option><option>TV</option><option>Other</option>
                  </select>
                </label>
                <label className="block text-sm font-semibold text-slate-700">Phone / meter / account number
                  <input required value={actionForm.reference} onChange={(e) => setActionForm((f) => ({ ...f, reference: e.target.value }))} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3" />
                </label>
              </>)}
              <label className="block text-sm font-semibold text-slate-700">Amount (UGX)
                <input required type="number" inputMode="decimal" min="500" step="100" value={actionForm.amount} onChange={(e) => setActionForm((f) => ({ ...f, amount: e.target.value }))} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-lg font-bold" placeholder="0" />
              </label>
              <label className="block text-sm font-semibold text-slate-700">Note (optional)
                <input value={actionForm.note} onChange={(e) => setActionForm((f) => ({ ...f, note: e.target.value }))} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3" />
              </label>
              <button type="submit" className="min-h-12 w-full rounded-xl bg-emerald-600 px-4 font-bold text-white hover:bg-emerald-700">
                {online ? "Submit request" : "Save offline"}
              </button>
              <p className="text-center text-xs text-slate-500">No balance is deducted until the SACCO or payment provider confirms the transaction.</p>
            </div>
          </form>
        </section>
      )}

      {memberRequests.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between"><h2 className="font-bold text-slate-900">Requests from this phone</h2><span className="text-xs text-slate-500">Auto-sync enabled</span></div>
          <div className="mt-3 divide-y divide-slate-100">
            {memberRequests.slice(0, 5).map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <div><p className="font-semibold capitalize text-slate-900">{row.kind.replace(/_/g, " ")}</p><p className="text-xs text-slate-500">{new Date(row.createdAt).toLocaleString()} {row.error ? `· ${row.error}` : ""}</p></div>
                <div className="text-right"><p className="font-bold tabular-nums">{formatCurrency(row.amount)}</p><p className={`text-xs font-semibold capitalize ${row.status === "failed" ? "text-rose-700" : row.status === "submitted" ? "text-emerald-700" : "text-amber-700"}`}>{row.status}</p></div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <UserRound size={24} />
            </div>
            <div>
              <p className="text-xl font-bold text-slate-900">{member.name}</p>
              <p className="text-sm text-slate-500">
                {member.accountNumber} | Joined {member.joinDate} | {member.phone ?? "No phone on file"}
              </p>
            </div>
          </div>
          <span className={`w-fit rounded-full border px-3 py-1 text-xs font-semibold capitalize ${statusClass(member.status)}`}>
            {member.status}
          </span>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase text-emerald-800">
              <PiggyBank size={14} /> Savings
            </p>
            <p className="mt-2 text-lg font-bold text-emerald-950 tabular-nums">{formatCurrency(member.savingsBalance)}</p>
          </div>
          <div className="rounded-lg border border-sky-100 bg-sky-50 p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase text-sky-800">
              <ShieldCheck size={14} /> Shares
            </p>
            <p className="mt-2 text-lg font-bold text-sky-950 tabular-nums">{formatCurrency(member.sharesBalance)}</p>
          </div>
          <div className="rounded-lg border border-violet-100 bg-violet-50 p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase text-violet-800">
              <CreditCard size={14} /> Loan balance
            </p>
            <p className="mt-2 text-lg font-bold text-violet-950 tabular-nums">{formatCurrency(totalLoanBalance)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase text-slate-600">
              <ClipboardList size={14} /> Last activity
            </p>
            <p className="mt-2 text-sm font-semibold text-slate-900">{lastTransaction?.date ?? "No activity"}</p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => navigate?.(SACCOPRO_PAGE.memberProfile, { memberId: member.id })}
            disabled={!navigate}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
          >
            View full profile
          </button>
          <button
            type="button"
            onClick={() => navigate?.(SACCOPRO_PAGE.teller, { tellerDesk: "receive", tellerTask: "deposit" })}
            disabled={!navigate || readOnly}
            className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Receive savings
          </button>
          <button
            type="button"
            onClick={() => navigate?.(SACCOPRO_PAGE.loanInput, { memberId: member.id })}
            disabled={!navigate || readOnly}
            className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            New loan application
          </button>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm xl:col-span-2">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Banknote size={18} className="text-emerald-600" /> Savings accounts
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left">Account</th>
                  <th className="px-4 py-2 text-left">Product</th>
                  <th className="px-4 py-2 text-left">Opened</th>
                  <th className="px-4 py-2 text-right">Balance</th>
                  <th className="px-4 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {memberAccounts.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      No savings accounts opened for this member.
                    </td>
                  </tr>
                ) : (
                  memberAccounts.map((account) => (
                    <tr key={account.id} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-mono text-xs text-slate-700">{account.account_number}</td>
                      <td className="px-4 py-2">
                        {account.savings_product_code}
                        {account.sub_account ? <span className="text-slate-400"> / {account.sub_account}</span> : null}
                      </td>
                      <td className="px-4 py-2 text-slate-600">{account.date_account_opened ?? account.created_at.slice(0, 10)}</td>
                      <td className="px-4 py-2 text-right font-semibold tabular-nums">{formatCurrency(Number(account.balance || 0))}</td>
                      <td className="px-4 py-2">
                        <span className={`rounded-full border px-2 py-0.5 text-xs ${statusClass(account.is_active ? "active" : "inactive")}`}>
                          {account.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
            Ordinary accounts: {ordinaryAccounts.length} | Share accounts: {shareAccounts.length}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <CreditCard size={18} className="text-violet-600" /> Loans
            </h2>
          </div>
          <div className="divide-y divide-slate-100">
            {memberLoans.length === 0 ? (
              <p className="p-5 text-sm text-slate-500">No loans found for this member.</p>
            ) : (
              memberLoans.slice(0, 6).map((loan) => {
                const paidPct = loan.amount > 0 ? Math.min(100, Math.round((loan.paidAmount / loan.amount) * 100)) : 0;
                return (
                  <div key={loan.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">{loan.loanType}</p>
                        <p className="text-xs text-slate-500">{loan.applicationDate} | {loan.interestRate}% | {loan.term} months</p>
                      </div>
                      <span className={`rounded-full border px-2 py-0.5 text-xs capitalize ${statusClass(loan.status)}`}>
                        {loan.status.replace(/_/g, " ")}
                      </span>
                    </div>
                    <div className="mt-3 flex justify-between text-xs text-slate-600">
                      <span>Paid {formatCurrency(loan.paidAmount)}</span>
                      <span>Balance {formatCurrency(loan.balance)}</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-violet-500" style={{ width: `${paidPct}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm xl:col-span-2">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <ClipboardList size={18} className="text-slate-700" /> Recent activity
            </h2>
          </div>
          <div className="divide-y divide-slate-100">
            {memberTransactions.length === 0 ? (
              <p className="p-5 text-sm text-slate-500">No cashbook activity linked to this member yet.</p>
            ) : (
              memberTransactions.slice(0, 12).map((row) => {
                const delta = moneyDelta(row);
                const incoming = delta >= 0;
                return (
                  <div key={row.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className={`flex h-9 w-9 items-center justify-center rounded-full ${incoming ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                        {incoming ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{row.description}</p>
                        <p className="text-xs text-slate-500">{row.date} | {row.reference ?? row.category ?? "No reference"}</p>
                      </div>
                    </div>
                    <p className={`shrink-0 text-sm font-bold tabular-nums ${incoming ? "text-emerald-700" : "text-rose-700"}`}>
                      {incoming ? "+" : "-"}{formatCurrency(Math.abs(delta))}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <PiggyBank size={18} className="text-sky-600" /> Fixed deposits
            </h2>
          </div>
          <div className="divide-y divide-slate-100">
            {memberFDs.length === 0 ? (
              <p className="p-5 text-sm text-slate-500">No fixed deposits found.</p>
            ) : (
              memberFDs.map((fd) => (
                <div key={fd.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900">{formatCurrency(fd.amount)}</p>
                      <p className="text-xs text-slate-500">{fd.interestRate}% | {fd.term} months | Matures {fd.maturityDate}</p>
                    </div>
                    <span className={`rounded-full border px-2 py-0.5 text-xs capitalize ${statusClass(fd.status)}`}>{fd.status}</span>
                  </div>
                  <p className="mt-2 text-xs font-medium text-sky-700">Interest earned: {formatCurrency(fd.interestEarned)}</p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {isSuperAdmin && (
        <p className="text-xs text-slate-400">
          Admin note: this screen uses SACCO tables only: members, savings accounts, loans, fixed deposits, and cashbook lines.
        </p>
      )}
    </div>
  );
};

export default SaccoClientDashboard;
