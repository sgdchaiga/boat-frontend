import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  CheckCircle2,
  Clock3,
  FileBarChart2,
  History,
  Phone,
  Repeat,
  Send,
  Signal,
  Smartphone,
  Users,
  Wallet,
  WifiOff,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { sendBoatMessage } from "@/lib/communicationsApi";
import {
  loadAgentHubData,
  persistCustomers,
  persistFloat,
  persistHistory,
  persistPending,
  writeOnlineTransaction,
  type AgentFloat,
  type AgentTx,
  type MainAction,
  type SavedCustomer,
  type StaffSummaryRow,
  type TxStatus,
} from "@/lib/agentHubService";

const MAX_HISTORY = 80;
const REQUIRE_SMS_KEY = "boat.agent.requireSmsSuccess.v1";

function formatUgx(value: number): string {
  return `UGX ${Math.round(value).toLocaleString("en-UG")}`;
}

function formatPhone(input: string) {
  return input.replace(/[^\d+]/g, "");
}

function isValidUgPhone(phone: string): boolean {
  const n = phone.replace(/\s+/g, "");
  return /^(\+256|0)7\d{8}$/.test(n);
}

function actionLabel(action: MainAction): string {
  if (action === "deposit") return "Deposit";
  if (action === "withdraw") return "Withdraw";
  if (action === "send") return "Send Money";
  if (action === "airtime") return "Airtime";
  return "Bill Pay";
}

function calcCharges(type: MainAction, amount: number): number {
  if (amount <= 0) return 0;
  if (type === "deposit") return amount >= 50_000 ? 800 : 300;
  if (type === "withdraw") return Math.max(500, Math.round(amount * 0.012));
  if (type === "send") return Math.max(200, Math.round(amount * 0.008));
  if (type === "airtime") return Math.max(100, Math.round(amount * 0.003));
  return Math.max(300, Math.round(amount * 0.005));
}

function calcCommission(type: MainAction, amount: number): number {
  if (amount <= 0) return 0;
  if (type === "withdraw") return Math.round(amount * 0.004);
  if (type === "deposit") return Math.round(amount * 0.002);
  if (type === "send") return Math.round(amount * 0.0025);
  if (type === "airtime") return Math.round(amount * 0.0015);
  return Math.round(amount * 0.002);
}

function txVisual(status: TxStatus) {
  if (status === "success") return { cls: "text-emerald-700 bg-emerald-50 border-emerald-200", text: "Success" };
  if (status === "pending") return { cls: "text-amber-800 bg-amber-50 border-amber-200", text: "Pending" };
  return { cls: "text-red-700 bg-red-50 border-red-200", text: "Error" };
}

function buildReceiptMessage(tx: AgentTx): string {
  const label = actionLabel(tx.type);
  return `BOAT ${label} successful. Amount ${formatUgx(tx.amount)}. Charges ${formatUgx(tx.charges)}. Ref ${tx.id}.`;
}

export function AgentHubPage() {
  const { user } = useAuth();
  const organizationId = user?.organization_id ?? null;
  const staffId = user?.id ?? null;
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [activeAction, setActiveAction] = useState<MainAction>("deposit");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [recentMessage, setRecentMessage] = useState<string | null>(null);
  const [showMiniStatement, setShowMiniStatement] = useState(false);
  const [showStaffControl, setShowStaffControl] = useState(false);
  const [requireSmsForSuccess, setRequireSmsForSuccess] = useState<boolean>(() => {
    try {
      return localStorage.getItem(REQUIRE_SMS_KEY) === "1";
    } catch {
      return false;
    }
  });

  const [savedCustomers, setSavedCustomers] = useState<SavedCustomer[]>([]);
  const [txHistory, setTxHistory] = useState<AgentTx[]>([]);
  const [pendingQueue, setPendingQueue] = useState<AgentTx[]>([]);
  const [staffRows, setStaffRows] = useState<StaffSummaryRow[]>([]);
  const [float, setFloat] = useState<AgentFloat>({ eFloat: 2_500_000, cash: 800_000 });

  useEffect(() => {
    try {
      localStorage.setItem(REQUIRE_SMS_KEY, requireSmsForSuccess ? "1" : "0");
    } catch {
      // ignore storage errors
    }
  }, [requireSmsForSuccess]);

  useEffect(() => {
    let cancelled = false;
    void loadAgentHubData(organizationId, staffId).then((data) => {
      if (cancelled) return;
      setSavedCustomers(data.customers);
      setTxHistory(data.history);
      setPendingQueue(data.pending);
      setFloat(data.float);
      setStaffRows(data.staffRows);
    });
    return () => {
      cancelled = true;
    };
  }, [organizationId, staffId]);

  useEffect(() => {
    void persistCustomers(savedCustomers, organizationId, staffId);
  }, [savedCustomers, organizationId, staffId]);

  useEffect(() => {
    void persistHistory(txHistory, organizationId, staffId);
  }, [txHistory, organizationId, staffId]);

  useEffect(() => {
    void persistPending(pendingQueue, organizationId, staffId);
  }, [pendingQueue, organizationId, staffId]);

  useEffect(() => {
    void persistFloat(float, organizationId, staffId);
  }, [float, organizationId, staffId]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    if (!isOnline || pendingQueue.length === 0) return;
    const timer = window.setTimeout(() => {
      const synced = pendingQueue.map((tx) => ({ ...tx, status: "success" as const, queuedOffline: false }));
      setTxHistory((prev) => [...synced, ...prev].slice(0, MAX_HISTORY));
      setPendingQueue([]);
      setRecentMessage("Pending offline transactions synced.");
      for (const tx of synced) {
        void writeOnlineTransaction(tx, organizationId, staffId);
      }
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [isOnline, pendingQueue, organizationId, staffId]);

  const amountNum = Number(amount || 0);
  const charges = calcCharges(activeAction, amountNum);
  const commission = calcCommission(activeAction, amountNum);
  const selectedCustomer = savedCustomers.find((c) => c.id === selectedCustomerId) ?? null;
  const effectivePhone = selectedCustomer ? selectedCustomer.phone : formatPhone(phone);
  const phoneOk = isValidUgPhone(effectivePhone);
  const unusualAmount = amountNum >= 5_000_000 || amountNum <= 0;
  const lowFloat = float.eFloat < 400_000 || float.cash < 200_000;
  const highWithdrawalActivity = useMemo(() => {
    const today = new Date().toDateString();
    const todayWithdraw = txHistory.filter((tx) => tx.type === "withdraw" && new Date(tx.createdAt).toDateString() === today);
    return todayWithdraw.length >= 8;
  }, [txHistory]);

  const todayStats = useMemo(() => {
    const today = new Date().toDateString();
    const todays = txHistory.filter((tx) => new Date(tx.createdAt).toDateString() === today);
    const commissionToday = todays.reduce((sum, tx) => sum + tx.commission, 0);
    return {
      count: todays.length,
      commission: commissionToday,
      last: txHistory[0] ?? null,
      inflow: todays.filter((t) => t.type === "deposit").reduce((s, t) => s + t.amount, 0),
      outflow: todays.filter((t) => t.type === "withdraw").reduce((s, t) => s + t.amount, 0),
    };
  }, [txHistory]);

  const frequentCustomers = useMemo(() => {
    const usage = new Map<string, number>();
    for (const tx of txHistory) {
      const key = tx.customerPhone;
      usage.set(key, (usage.get(key) ?? 0) + 1);
    }
    return [...savedCustomers]
      .sort((a, b) => (usage.get(b.phone) ?? 0) - (usage.get(a.phone) ?? 0))
      .slice(0, 5);
  }, [savedCustomers, txHistory]);

  const lastTx = txHistory[0] ?? null;

  const resetFlow = () => {
    setStep(1);
    setAmount("");
    setPhone("");
    setSelectedCustomerId("");
  };

  const applyLastCustomer = () => {
    if (!lastTx) return;
    setPhone(lastTx.customerPhone);
    setSelectedCustomerId("");
    setAmount(String(lastTx.amount));
    setActiveAction(lastTx.type);
    setStep(2);
  };

  const submitTransaction = async () => {
    if (!phoneOk) {
      setRecentMessage("Use a valid Uganda number format.");
      return;
    }
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setRecentMessage("Amount must be greater than zero.");
      return;
    }
    const now = new Date().toISOString();
    let tx: AgentTx = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: activeAction,
      customerPhone: effectivePhone,
      customerName: selectedCustomer?.name,
      amount: Math.round(amountNum),
      charges,
      commission,
      createdAt: now,
      status: isOnline ? "success" : "pending",
      queuedOffline: !isOnline,
    };

    if (isOnline) {
      if (activeAction === "deposit") {
        setFloat((f) => ({ ...f, cash: f.cash + tx.amount, eFloat: f.eFloat - tx.amount }));
      } else if (activeAction === "withdraw") {
        setFloat((f) => ({ ...f, cash: Math.max(0, f.cash - tx.amount), eFloat: f.eFloat + tx.amount }));
      }
      const sms = await sendBoatMessage({
        channel: "sms",
        to: effectivePhone,
        text: buildReceiptMessage(tx),
        organizationId: organizationId ?? undefined,
      });
      if (sms.ok) {
        setRecentMessage("Transaction successful. Customer SMS confirmation sent.");
      } else {
        if (requireSmsForSuccess) {
          tx = { ...tx, status: "pending" };
          setRecentMessage(`Transaction processed, SMS failed so status is pending: ${sms.error || "Unknown SMS error"}.`);
        } else {
          setRecentMessage(`Transaction successful, but SMS not sent: ${sms.error || "Unknown SMS error"}.`);
        }
      }
      setTxHistory((prev) => [tx, ...prev].slice(0, MAX_HISTORY));
      void writeOnlineTransaction(tx, organizationId, staffId);
    } else {
      setPendingQueue((prev) => [tx, ...prev].slice(0, MAX_HISTORY));
      setRecentMessage("Offline: transaction queued and marked pending.");
    }

    if (!selectedCustomer && effectivePhone && !savedCustomers.some((c) => c.phone === effectivePhone)) {
      setSavedCustomers((prev) => [
        { id: `c-${Date.now()}`, name: "Recent Customer", phone: effectivePhone, network: "MTN" },
        ...prev,
      ]);
    }
    resetFlow();
  };

  const repeatLastTransaction = () => {
    if (!lastTx) return;
    setActiveAction(lastTx.type);
    setPhone(lastTx.customerPhone);
    setAmount(String(lastTx.amount));
    setStep(3);
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4 pb-14">
      <div className="rounded-xl border border-slate-200 bg-white p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Agent Hub</h1>
            <p className="text-sm text-slate-500">1 screen = 90% of transactions</p>
          </div>
          <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${isOnline ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
            {isOnline ? <Signal className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
            {isOnline ? "Online" : "Offline"}
          </div>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3 text-sm">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">Agent</p>
            <p className="font-semibold text-slate-900">{user?.full_name || "Agent"}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">Float Balance</p>
            <p className="font-semibold text-slate-900">E-Float: {formatUgx(float.eFloat)} | Cash: {formatUgx(float.cash)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">Pending sync</p>
            <p className="font-semibold text-amber-700">{pendingQueue.length} pending</p>
          </div>
        </div>
            <label className="mt-3 inline-flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={requireSmsForSuccess}
                onChange={(e) => setRequireSmsForSuccess(e.target.checked)}
              />
              Require SMS for success (SMS failure marks transaction pending)
            </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="mb-3 text-sm font-semibold text-slate-800">Main actions (speed mode)</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { id: "deposit" as const, icon: ArrowDownCircle, label: "Deposit" },
                { id: "withdraw" as const, icon: ArrowUpCircle, label: "Withdraw" },
                { id: "send" as const, icon: Send, label: "Send Money" },
                { id: "airtime" as const, icon: Smartphone, label: "Airtime" },
              ].map((a) => {
                const Icon = a.icon;
                const active = activeAction === a.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      setActiveAction(a.id);
                      setStep(1);
                    }}
                    className={`min-h-[88px] rounded-xl border text-left px-4 py-3 transition ${active ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:bg-slate-50"}`}
                  >
                    <Icon className="w-6 h-6 mb-2 text-slate-700" />
                    <p className="text-lg font-semibold text-slate-900">{a.label}</p>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setActiveAction("bill")}
                className={`rounded-lg border px-3 py-2 text-sm ${activeAction === "bill" ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-700"}`}
              >
                Bill Pay
              </button>
              <button
                type="button"
                onClick={() => setShowMiniStatement((v) => !v)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
              >
                Mini Statement
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-slate-800">{actionLabel(activeAction)} flow</p>
              <p className="text-xs text-slate-500">Target: under 10 seconds</p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              {[1, 2, 3].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStep(s as 1 | 2 | 3)}
                  className={`rounded-md px-2 py-1.5 border ${step === s ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-600 border-slate-200"}`}
                >
                  Step {s}
                </button>
              ))}
            </div>

            {step === 1 && (
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Saved customer</label>
                  <select
                    value={selectedCustomerId}
                    onChange={(e) => setSelectedCustomerId(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    <option value="">Type number instead</option>
                    {frequentCustomers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} - {c.phone}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Phone</label>
                  <input
                    value={selectedCustomer ? selectedCustomer.phone : phone}
                    onChange={(e) => {
                      setSelectedCustomerId("");
                      setPhone(e.target.value);
                    }}
                    placeholder="07XXXXXXXX or +2567XXXXXXXX"
                    className={`w-full rounded-lg border px-3 py-2 text-sm ${phoneOk || (!phone && !selectedCustomer) ? "border-slate-200" : "border-red-300 bg-red-50"}`}
                  />
                  {!phoneOk && (phone || selectedCustomer) && <p className="mt-1 text-xs text-red-600">Wrong number format.</p>}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Amount</label>
                  <input
                    type="number"
                    min={0}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0"
                    className={`w-full rounded-lg border px-3 py-2 text-sm ${unusualAmount && amount ? "border-amber-300 bg-amber-50" : "border-slate-200"}`}
                  />
                  {unusualAmount && amount && <p className="mt-1 text-xs text-amber-700">Unusual amount. Confirm carefully.</p>}
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                  <p>Charges: <span className="font-semibold">{formatUgx(charges)}</span></p>
                  <p>Commission: <span className="font-semibold text-emerald-700">{formatUgx(commission)}</span></p>
                </div>
                <div className="md:col-span-2">
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white"
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm space-y-1">
                <p className="font-semibold text-slate-800">Confirm details</p>
                <p>Number: <span className="font-semibold">{effectivePhone || "—"}</span></p>
                <p>Amount: <span className="font-semibold">{formatUgx(amountNum || 0)}</span></p>
                <p>Charges: <span className="font-semibold">{formatUgx(charges)}</span></p>
                {activeAction === "withdraw" && <p>Commission: <span className="font-semibold text-emerald-700">{formatUgx(commission)}</span></p>}
                <div className="pt-2 flex gap-2">
                  <button type="button" onClick={() => setStep(1)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">Edit</button>
                  <button type="button" onClick={() => setStep(3)} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white">Confirm</button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-3">
                <button
                  type="button"
                    onClick={() => void submitTransaction()}
                  className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-base font-semibold text-white"
                >
                  Send STK / Process Transaction
                </button>
                {recentMessage && (
                  <div className={`rounded-lg border px-3 py-2 text-sm ${isOnline ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                    {isOnline ? <CheckCircle2 className="inline-block mr-1 w-4 h-4" /> : <Clock3 className="inline-block mr-1 w-4 h-4" />}
                    {recentMessage}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <button type="button" onClick={applyLastCustomer} className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-medium text-slate-800">
              <Repeat className="inline-block w-4 h-4 mr-1" />
              Repeat Last Customer
            </button>
            <button type="button" onClick={repeatLastTransaction} className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-medium text-slate-800">
              <History className="inline-block w-4 h-4 mr-1" />
              View History
            </button>
            <button type="button" onClick={() => setShowStaffControl((v) => !v)} className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm font-medium text-slate-800">
              <FileBarChart2 className="inline-block w-4 h-4 mr-1" />
              End of Day Report
            </button>
          </div>
        </div>

        <aside className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-semibold text-slate-800 mb-2">Quick Stats</p>
            <p className="text-sm">Today's tx: <span className="font-semibold">{todayStats.count}</span></p>
            <p className="text-sm">Commission today: <span className="font-semibold text-emerald-700">{formatUgx(todayStats.commission)}</span></p>
            <div className="mt-2">
              <p className="text-xs text-slate-500">Last status</p>
              {todayStats.last ? (
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${txVisual(todayStats.last.status).cls}`}>
                  {txVisual(todayStats.last.status).text}
                </span>
              ) : (
                <span className="text-xs text-slate-500">No transaction yet</span>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
            <p className="text-sm font-semibold text-slate-800">Float Dashboard</p>
            <p className="text-sm"><Wallet className="inline-block w-4 h-4 mr-1" />Cash available: {formatUgx(float.cash)}</p>
            <p className="text-sm"><Banknote className="inline-block w-4 h-4 mr-1" />E-float available: {formatUgx(float.eFloat)}</p>
            <p className="text-xs text-slate-500">Daily inflow: {formatUgx(todayStats.inflow)}</p>
            <p className="text-xs text-slate-500">Daily outflow: {formatUgx(todayStats.outflow)}</p>
            {lowFloat && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                <AlertTriangle className="inline-block w-3.5 h-3.5 mr-1" />
                Low float warning
              </p>
            )}
            {highWithdrawalActivity && (
              <p className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
                <AlertTriangle className="inline-block w-3.5 h-3.5 mr-1" />
                High withdrawal activity
              </p>
            )}
          </div>
        </aside>
      </div>

      {showMiniStatement && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-800 mb-2">Mini Statement</p>
          <div className="space-y-2">
            {(txHistory.length === 0 ? pendingQueue : txHistory).slice(0, 6).map((tx) => (
              <div key={tx.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-slate-800">{actionLabel(tx.type)} - {tx.customerPhone}</p>
                  <p className="text-xs text-slate-500">{new Date(tx.createdAt).toLocaleTimeString()}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{formatUgx(tx.amount)}</p>
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${txVisual(tx.status).cls}`}>{txVisual(tx.status).text}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showStaffControl && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-2 text-sm font-semibold text-slate-800">Staff Control (Owner View)</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                  <th className="py-2">Staff</th>
                  <th className="py-2">Transactions</th>
                  <th className="py-2">Commission</th>
                  <th className="py-2">Activity</th>
                </tr>
              </thead>
              <tbody>
                {staffRows.map((row) => (
                  <tr key={row.name} className="border-b border-slate-50">
                    <td className="py-2">{row.name}</td>
                    <td className="py-2">{row.transactions}</td>
                    <td className="py-2">{formatUgx(row.commission)}</td>
                    <td className="py-2">
                      {row.suspicious ? (
                        <span className="inline-flex items-center rounded-full bg-red-50 text-red-700 px-2 py-0.5 text-xs">
                          <AlertTriangle className="w-3.5 h-3.5 mr-1" /> Suspicious
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-xs">
                          <Users className="w-3.5 h-3.5 mr-1" /> Normal
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pendingQueue.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Offline Mode Queue</p>
          <p className="text-xs text-amber-800 mt-1">
            Transactions are queued and marked pending while offline, then auto-sync when internet is back.
          </p>
          <div className="mt-2 space-y-1 text-sm">
            {pendingQueue.slice(0, 5).map((tx) => (
              <div key={tx.id} className="flex items-center justify-between">
                <span><Phone className="inline-block w-4 h-4 mr-1" />{tx.customerPhone}</span>
                <span className="font-medium">{formatUgx(tx.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
