/**
 * SACCO admin dashboard charts — always loaded for the given organization_id.
 */
import { supabase } from "@/lib/supabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

const CHART_PALETTE = ["#10b981", "#f59e0b", "#3b82f6", "#8b5cf6", "#ec4899", "#06b6d4", "#64748b"];

export type SaccoDashboardChartPoint = {
  month: string;
  deposits: number;
  withdrawals: number;
  loans: number;
};

export type SaccoSavingsGrowthPoint = {
  month: string;
  amount: number;
};

export type SaccoLoanTypeSlice = {
  name: string;
  value: number;
  color: string;
};

export type SaccoDashboardCharts = {
  monthlyData: SaccoDashboardChartPoint[];
  savingsGrowth: SaccoSavingsGrowthPoint[];
  loanTypeData: SaccoLoanTypeSlice[];
};

function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

function lastNMonthKeys(n: number): { key: string; label: string }[] {
  const keys: { key: string; label: string }[] = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    keys.push({
      key: `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`,
      label: x.toLocaleString("default", { month: "short" }),
    });
  }
  return keys;
}

function isShareCapitalProductCode(code: string | null | undefined): boolean {
  const c = (code ?? "").trim().toUpperCase();
  if (!c) return false;
  return c.includes("SHARE") || c === "EQUITY" || c.startsWith("SHR");
}

function txnDate(iso: string): string {
  return String(iso).slice(0, 10);
}

export async function fetchSaccoDashboardCharts(organizationId: string): Promise<SaccoDashboardCharts> {
  const monthBuckets = lastNMonthKeys(7);
  const earliest = new Date();
  earliest.setMonth(earliest.getMonth() - 6);
  earliest.setDate(1);
  const sinceIso = earliest.toISOString();

  const [tellerRes, loanRes, savRes] = await Promise.all([
    sb
      .from("sacco_teller_transactions")
      .select("txn_type, amount, created_at, posting_purpose, status, sacco_member_id")
      .eq("organization_id", organizationId)
      .eq("status", "posted")
      .gte("created_at", sinceIso),
    sb
      .from("sacco_loans")
      .select("loan_type, amount, disbursement_date, status")
      .eq("organization_id", organizationId),
    sb
      .from("sacco_member_savings_accounts")
      .select("balance, savings_product_code")
      .eq("organization_id", organizationId),
  ]);

  if (tellerRes.error) throw tellerRes.error;
  if (loanRes.error) throw loanRes.error;
  if (savRes.error) throw savRes.error;

  const depositsBy = new Map(monthBuckets.map((m) => [m.key, 0]));
  const withdrawalsBy = new Map(monthBuckets.map((m) => [m.key, 0]));
  const loansBy = new Map(monthBuckets.map((m) => [m.key, 0]));
  const savingsNetBy = new Map(monthBuckets.map((m) => [m.key, 0]));

  type TellerRow = {
    txn_type: string;
    amount: number;
    created_at: string;
    posting_purpose?: string | null;
    sacco_member_id?: string | null;
  };

  for (const row of (tellerRes.data ?? []) as TellerRow[]) {
    const k = monthKey(txnDate(row.created_at));
    if (!depositsBy.has(k)) continue;
    const amt = Number(row.amount) || 0;
    const purpose = String(row.posting_purpose ?? "").toLowerCase();
    const isSavings =
      purpose === "savings" ||
      purpose === "shares" ||
      (!purpose && row.sacco_member_id != null);

    if (row.txn_type === "cash_deposit" || row.txn_type === "cheque_received") {
      depositsBy.set(k, (depositsBy.get(k) ?? 0) + amt);
      if (isSavings) savingsNetBy.set(k, (savingsNetBy.get(k) ?? 0) + amt);
    } else if (row.txn_type === "cash_withdrawal" || row.txn_type === "cheque_paid") {
      withdrawalsBy.set(k, (withdrawalsBy.get(k) ?? 0) + amt);
      if (isSavings) savingsNetBy.set(k, (savingsNetBy.get(k) ?? 0) - amt);
    }
  }

  type LoanRow = {
    loan_type: string;
    amount: number;
    disbursement_date: string | null;
    status: string;
  };

  const loanTypeCounts = new Map<string, number>();
  for (const row of (loanRes.data ?? []) as LoanRow[]) {
    if (row.status === "rejected") continue;
    const type = String(row.loan_type ?? "").trim() || "Other";
    loanTypeCounts.set(type, (loanTypeCounts.get(type) ?? 0) + 1);
    if (!row.disbursement_date) continue;
    const k = monthKey(String(row.disbursement_date).slice(0, 10));
    if (!loansBy.has(k)) continue;
    loansBy.set(k, (loansBy.get(k) ?? 0) + (Number(row.amount) || 0));
  }

  let totalSavings = 0;
  for (const row of savRes.data ?? []) {
    const code = (row as { savings_product_code?: string }).savings_product_code;
    if (isShareCapitalProductCode(code)) continue;
    totalSavings += Number((row as { balance?: number }).balance) || 0;
  }

  const monthlyData = monthBuckets.map((m) => ({
    month: m.label,
    deposits: depositsBy.get(m.key) ?? 0,
    withdrawals: withdrawalsBy.get(m.key) ?? 0,
    loans: loansBy.get(m.key) ?? 0,
  }));

  let endBalance = totalSavings;
  const savingsGrowth: SaccoSavingsGrowthPoint[] = [];
  for (let i = monthBuckets.length - 1; i >= 0; i--) {
    const m = monthBuckets[i];
    savingsGrowth.unshift({ month: m.label, amount: Math.max(0, endBalance) });
    endBalance -= savingsNetBy.get(m.key) ?? 0;
  }

  const loanTypeData = Array.from(loanTypeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], i) => ({
      name: name.length > 22 ? `${name.slice(0, 20)}…` : name,
      value,
      color: CHART_PALETTE[i % CHART_PALETTE.length],
    }));

  return { monthlyData, savingsGrowth, loanTypeData };
}
