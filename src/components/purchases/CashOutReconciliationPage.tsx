import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowRight, CalendarClock, CheckCircle2, RefreshCw, Search } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { isBillApproved, parseBillAllocationsJson } from "../../lib/billStatus";
import { supabase } from "../../lib/supabase";

type Navigate = (page: string, state?: Record<string, unknown>) => void;
type Vendor = { name: string } | null;
type Bill = {
  id: string;
  vendor_id: string | null;
  bill_date: string | null;
  due_date: string | null;
  amount: number | null;
  description: string | null;
  status: string | null;
  approved_at: string | null;
  vendors: Vendor;
};
type Expense = {
  id: string;
  expense_date: string | null;
  amount: number | null;
  description: string | null;
  status: string | null;
  vendors: Vendor;
};
type Payment = {
  id: string;
  bill_id: string | null;
  amount: number | null;
  payment_date: string | null;
  created_at: string | null;
  reference: string | null;
  bill_allocations: unknown;
  vendors: Vendor;
};
type AllocationRow = { vendor_payment_id: string; bill_id: string; amount: number | null };
type TreasuryRequest = {
  source_type: "expense" | "bill";
  source_id: string;
  status: string;
  disbursed_at: string | null;
};
type Tab = "cross-month" | "unmatched" | "outstanding";

const money = new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 });
const dateLabel = (value: string | null | undefined) => (value ? new Date(value).toLocaleDateString() : "—");
const monthKey = (value: string | null | undefined) => (value ? value.slice(0, 7) : "");
const monthLabel = (value: string | null | undefined) =>
  value ? new Date(`${value.slice(0, 7)}-01T12:00:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "—";
const vendorName = (vendor: Vendor) => vendor?.name || "No vendor";
const normalizedStatus = (value: string | null | undefined) => (value || "").toLowerCase();

function MetricCard({ label, count, amount, tone }: { label: string; count: number; amount: number; tone: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className="text-2xl font-bold text-slate-900">{count}</p>
        <p className={`text-sm font-semibold ${tone}`}>{money.format(amount)}</p>
      </div>
    </div>
  );
}

export function CashOutReconciliationPage({ onNavigate }: { onNavigate?: Navigate }) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const [bills, setBills] = useState<Bill[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [allocationRows, setAllocationRows] = useState<AllocationRow[]>([]);
  const [treasuryRequests, setTreasuryRequests] = useState<TreasuryRequest[]>([]);
  const [tab, setTab] = useState<Tab>("cross-month");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const [billRes, expenseRes, initialPaymentRes, treasuryRes] = await Promise.all([
        supabase.from("bills").select("id,vendor_id,bill_date,due_date,amount,description,status,approved_at,vendors(name)").eq("organization_id", orgId),
        supabase.from("expenses").select("id,expense_date,amount,description,status,vendors(name)").eq("organization_id", orgId),
        supabase.from("vendor_payments").select("id,bill_id,amount,payment_date,created_at,reference,bill_allocations,vendors(name)").eq("organization_id", orgId),
        supabase.from("treasury_requests").select("source_type,source_id,status,disbursed_at").eq("organization_id", orgId),
      ]);
      if (billRes.error) throw billRes.error;
      if (expenseRes.error) throw expenseRes.error;
      let paymentRes = initialPaymentRes;
      if (paymentRes.error && paymentRes.error.message.toLowerCase().includes("bill_allocations")) {
        paymentRes = await supabase
          .from("vendor_payments")
          .select("id,bill_id,amount,payment_date,created_at,reference,vendors(name)")
          .eq("organization_id", orgId) as typeof initialPaymentRes;
      }
      if (paymentRes.error) throw paymentRes.error;

      const billIds = (billRes.data || []).map((row: { id: string }) => row.id);
      let rows: AllocationRow[] = [];
      if (billIds.length > 0) {
        const allocationRes = await supabase
          .from("vendor_payment_bill_allocations")
          .select("vendor_payment_id,bill_id,amount")
          .in("bill_id", billIds);
        if (!allocationRes.error) rows = (allocationRes.data || []) as AllocationRow[];
      }

      // Older records may be linked to an organization bill but have no organization_id on the payment itself.
      const linkedPaymentIds = [...new Set(rows.map((row) => row.vendor_payment_id))];
      const currentPayments = (paymentRes.data || []) as unknown as Payment[];
      const currentPaymentIds = new Set(currentPayments.map((payment) => payment.id));
      const missingLinkedIds = linkedPaymentIds.filter((id) => !currentPaymentIds.has(id));
      let linkedPayments: Payment[] = [];
      if (missingLinkedIds.length > 0) {
        const linkedRes = await supabase
          .from("vendor_payments")
          .select("id,bill_id,amount,payment_date,created_at,reference,bill_allocations,vendors(name)")
          .in("id", missingLinkedIds);
        if (!linkedRes.error) linkedPayments = (linkedRes.data || []) as unknown as Payment[];
      }
      let directLegacyPayments: Payment[] = [];
      if (billIds.length > 0) {
        const directRes = await supabase
          .from("vendor_payments")
          .select("id,bill_id,amount,payment_date,created_at,reference,bill_allocations,vendors(name)")
          .in("bill_id", billIds);
        if (!directRes.error) directLegacyPayments = (directRes.data || []) as unknown as Payment[];
      }
      let jsonLinkedLegacyPayments: Payment[] = [];
      const vendorIds = [...new Set((billRes.data || []).map((row: { vendor_id?: string | null }) => row.vendor_id).filter(Boolean))] as string[];
      if (vendorIds.length > 0) {
        const legacyRes = await supabase
          .from("vendor_payments")
          .select("id,bill_id,amount,payment_date,created_at,reference,bill_allocations,vendors(name)")
          .in("vendor_id", vendorIds)
          .is("organization_id", null)
          .not("bill_allocations", "is", null);
        if (!legacyRes.error) {
          const billIdSet = new Set(billIds);
          jsonLinkedLegacyPayments = ((legacyRes.data || []) as unknown as Payment[]).filter((payment) =>
            parseBillAllocationsJson(payment.bill_allocations).some((allocation) => billIdSet.has(allocation.bill_id))
          );
        }
      }
      const allPayments = Array.from(
        new Map([...currentPayments, ...linkedPayments, ...directLegacyPayments, ...jsonLinkedLegacyPayments].map((payment) => [payment.id, payment])).values()
      );
      setBills((billRes.data || []) as unknown as Bill[]);
      setExpenses((expenseRes.data || []) as unknown as Expense[]);
      setPayments(allPayments);
      setAllocationRows(rows);
      setTreasuryRequests(treasuryRes.error ? [] : (treasuryRes.data || []) as TreasuryRequest[]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load cash-out reconciliation.");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const results = useMemo(() => {
    const billById = new Map(bills.map((bill) => [bill.id, bill]));
    const paymentById = new Map(payments.map((payment) => [payment.id, payment]));
    const allocations = new Map<string, { paymentId: string; billId: string; amount: number; date: string }>();
    const addAllocation = (paymentId: string, billId: string, amount: number) => {
      if (!billById.has(billId) || !Number.isFinite(amount) || amount <= 0) return;
      const payment = paymentById.get(paymentId);
      const key = `${paymentId}:${billId}`;
      const current = allocations.get(key);
      if (!current || amount > current.amount) {
        allocations.set(key, {
          paymentId,
          billId,
          amount,
          date: payment?.payment_date || payment?.created_at?.slice(0, 10) || "",
        });
      }
    };
    payments.forEach((payment) => {
      if (payment.bill_id) addAllocation(payment.id, payment.bill_id, Number(payment.amount || 0));
      parseBillAllocationsJson(payment.bill_allocations).forEach((row) => addAllocation(payment.id, row.bill_id, row.amount));
    });
    allocationRows.forEach((row) => addAllocation(row.vendor_payment_id, row.bill_id, Number(row.amount || 0)));

    const allocatedByBill = new Map<string, number>();
    const allocatedByPayment = new Map<string, number>();
    const crossMonth: Array<{
      id: string; type: "Bill" | "Expense"; party: string; description: string; sourceDate: string | null;
      paidDate: string | null; amount: number; page: string; state: Record<string, unknown>;
    }> = [];
    allocations.forEach((allocation) => {
      allocatedByBill.set(allocation.billId, (allocatedByBill.get(allocation.billId) || 0) + allocation.amount);
      allocatedByPayment.set(allocation.paymentId, (allocatedByPayment.get(allocation.paymentId) || 0) + allocation.amount);
      const bill = billById.get(allocation.billId);
      if (bill && monthKey(bill.bill_date) && monthKey(allocation.date) && monthKey(bill.bill_date) !== monthKey(allocation.date)) {
        crossMonth.push({
          id: `${allocation.paymentId}:${allocation.billId}`,
          type: "Bill",
          party: vendorName(bill.vendors),
          description: bill.description || "Supplier bill",
          sourceDate: bill.bill_date,
          paidDate: allocation.date,
          amount: allocation.amount,
          page: "purchases_bills",
          state: { highlightBillId: bill.id },
        });
      }
    });

    const treasuryByExpense = new Map(
      treasuryRequests.filter((row) => row.source_type === "expense").map((row) => [row.source_id, row])
    );
    expenses.forEach((expense) => {
      const request = treasuryByExpense.get(expense.id);
      if (request?.status === "disbursed" && request.disbursed_at && monthKey(expense.expense_date) !== monthKey(request.disbursed_at)) {
        crossMonth.push({
          id: expense.id,
          type: "Expense",
          party: vendorName(expense.vendors),
          description: expense.description || "Spend money expense",
          sourceDate: expense.expense_date,
          paidDate: request.disbursed_at,
          amount: Number(expense.amount || 0),
          page: "purchases_expenses",
          state: {},
        });
      }
    });

    const unmatched = payments
      .map((payment) => {
        const allocated = allocatedByPayment.get(payment.id) || 0;
        const hasStoredLink = Boolean(payment.bill_id) || parseBillAllocationsJson(payment.bill_allocations).length > 0 ||
          allocationRows.some((row) => row.vendor_payment_id === payment.id);
        return {
          ...payment,
          unmatchedAmount: Math.max(0, Number(payment.amount || 0) - allocated),
          unmatchedReason:
            allocated > 0
              ? "Payment exceeds its bill allocations"
              : hasStoredLink
                ? "Linked bill is missing or outside this organization"
                : "No bill allocation recorded",
        };
      })
      .filter((payment) => payment.unmatchedAmount > 0.001);

    const outstandingBills = bills
      .filter((bill) => !["cancelled", "rejected", "reversed", "void", "voided"].includes(normalizedStatus(bill.status)))
      .map((bill) => ({ ...bill, balance: Math.max(0, Number(bill.amount || 0) - (allocatedByBill.get(bill.id) || 0)) }))
      .filter((bill) => bill.balance > 0.001);
    const outstandingExpenses = expenses
      .map((expense) => ({ expense, request: treasuryByExpense.get(expense.id) }))
      .filter(({ expense, request }) =>
        normalizedStatus(expense.status) !== "cancelled" && Boolean(request) && request?.status !== "disbursed" && request?.status !== "rejected"
      );

    return { crossMonth, unmatched, outstandingBills, outstandingExpenses };
  }, [allocationRows, bills, expenses, payments, treasuryRequests]);

  const query = search.trim().toLowerCase();
  const includesQuery = (...values: unknown[]) => !query || values.some((value) => String(value || "").toLowerCase().includes(query));
  const crossMonth = results.crossMonth.filter((row) => includesQuery(row.party, row.description, row.type));
  const unmatched = results.unmatched.filter((row) => includesQuery(vendorName(row.vendors), row.reference, row.payment_date));
  const outstandingBills = results.outstandingBills.filter((row) => includesQuery(vendorName(row.vendors), row.description, row.status));
  const outstandingExpenses = results.outstandingExpenses.filter(({ expense, request }) =>
    includesQuery(vendorName(expense.vendors), expense.description, request?.status)
  );
  const crossAmount = results.crossMonth.reduce((sum, row) => sum + row.amount, 0);
  const unmatchedAmount = results.unmatched.reduce((sum, row) => sum + row.unmatchedAmount, 0);
  const outstandingAmount =
    results.outstandingBills.reduce((sum, row) => sum + row.balance, 0) +
    results.outstandingExpenses.reduce((sum, row) => sum + Number(row.expense.amount || 0), 0);

  const empty = (text: string) => <div className="p-10 text-center text-sm text-slate-500">{text}</div>;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Cash-out reconciliation</h1>
          <p className="mt-1 text-sm text-slate-500">Match received-stock bills and expenses to cash-out records for this organization.</p>
        </div>
        <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>}
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Paid in another month" count={results.crossMonth.length} amount={crossAmount} tone="text-blue-700" />
        <MetricCard label="Payments not matched" count={results.unmatched.length} amount={unmatchedAmount} tone="text-amber-700" />
        <MetricCard label="Bills / expenses outstanding" count={results.outstandingBills.length + results.outstandingExpenses.length} amount={outstandingAmount} tone="text-rose-700" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
          <div className="flex flex-wrap gap-2">
            {([
              ["cross-month", "Paid in another month", CalendarClock],
              ["unmatched", "Unmatched payments", AlertCircle],
              ["outstanding", "Outstanding", CheckCircle2],
            ] as const).map(([value, label, Icon]) => (
              <button key={value} onClick={() => setTab(value)} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${tab === value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                <Icon className="h-4 w-4" /> {label}
              </button>
            ))}
          </div>
          <label className="relative block min-w-64">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search vendor, description or status" className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm" />
          </label>
        </div>

        {loading ? empty("Loading reconciliation records…") : (
          <div className="overflow-x-auto">
            {tab === "cross-month" && (crossMonth.length === 0 ? empty("No cross-month settlements found.") : (
              <table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Record</th><th className="p-3">Vendor / payee</th><th className="p-3">Recorded</th><th className="p-3">Paid</th><th className="p-3 text-right">Matched amount</th><th className="p-3" /></tr></thead>
                <tbody className="divide-y divide-slate-100">{crossMonth.map((row) => <tr key={row.id} className="hover:bg-slate-50"><td className="p-3"><span className="font-semibold text-slate-800">{row.type}</span><p className="text-xs text-slate-500">{row.description}</p></td><td className="p-3">{row.party}</td><td className="p-3">{dateLabel(row.sourceDate)}<p className="text-xs text-slate-400">{monthLabel(row.sourceDate)}</p></td><td className="p-3">{dateLabel(row.paidDate)}<p className="text-xs text-slate-400">{monthLabel(row.paidDate)}</p></td><td className="p-3 text-right font-semibold">{money.format(row.amount)}</td><td className="p-3"><button onClick={() => onNavigate?.(row.page, row.state)} className="text-blue-700"><ArrowRight className="h-4 w-4" /></button></td></tr>)}</tbody>
              </table>
            ))}
            {tab === "unmatched" && (unmatched.length === 0 ? empty("All supplier payments are fully matched to bills.") : (
              <table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Payment date</th><th className="p-3">Vendor</th><th className="p-3">Reference</th><th className="p-3">Reason</th><th className="p-3 text-right">Payment</th><th className="p-3 text-right">Not matched</th><th className="p-3" /></tr></thead>
                <tbody className="divide-y divide-slate-100">{unmatched.map((row) => <tr key={row.id} className="hover:bg-slate-50"><td className="p-3">{dateLabel(row.payment_date || row.created_at)}</td><td className="p-3 font-medium">{vendorName(row.vendors)}</td><td className="p-3 text-slate-500">{row.reference || "—"}</td><td className="p-3 text-xs text-amber-700">{row.unmatchedReason}</td><td className="p-3 text-right">{money.format(Number(row.amount || 0))}</td><td className="p-3 text-right font-semibold text-amber-700">{money.format(row.unmatchedAmount)}</td><td className="p-3"><button onClick={() => onNavigate?.("purchases_payments", { highlightVendorPaymentId: row.id })} className="text-blue-700"><ArrowRight className="h-4 w-4" /></button></td></tr>)}</tbody>
              </table>
            ))}
            {tab === "outstanding" && (outstandingBills.length + outstandingExpenses.length === 0 ? empty("No outstanding supplier bills or Treasury-routed expenses found.") : (
              <table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Record</th><th className="p-3">Vendor / payee</th><th className="p-3">Date</th><th className="p-3">Status</th><th className="p-3 text-right">Outstanding</th><th className="p-3" /></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {outstandingBills.map((row) => <tr key={row.id} className="hover:bg-slate-50"><td className="p-3"><span className="font-semibold">Bill</span><p className="text-xs text-slate-500">{row.description || "Supplier bill"}</p></td><td className="p-3">{vendorName(row.vendors)}</td><td className="p-3">{dateLabel(row.bill_date)}</td><td className="p-3">{isBillApproved(row) ? (row.status || "Approved") : (row.status || "Pending approval")}</td><td className="p-3 text-right font-semibold text-rose-700">{money.format(row.balance)}</td><td className="p-3"><button onClick={() => onNavigate?.("purchases_bills", { highlightBillId: row.id })} className="text-blue-700"><ArrowRight className="h-4 w-4" /></button></td></tr>)}
                  {outstandingExpenses.map(({ expense, request }) => <tr key={expense.id} className="hover:bg-slate-50"><td className="p-3"><span className="font-semibold">Expense</span><p className="text-xs text-slate-500">{expense.description || "Spend money expense"}</p></td><td className="p-3">{vendorName(expense.vendors)}</td><td className="p-3">{dateLabel(expense.expense_date)}</td><td className="p-3">{request?.status?.replaceAll("_", " ") || "Pending cash-out"}</td><td className="p-3 text-right font-semibold text-rose-700">{money.format(Number(expense.amount || 0))}</td><td className="p-3"><button onClick={() => onNavigate?.("purchases_expenses")} className="text-blue-700"><ArrowRight className="h-4 w-4" /></button></td></tr>)}
                </tbody>
              </table>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
