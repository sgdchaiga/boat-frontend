import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  Banknote,
  FileBarChart,
  FlaskConical,
  Pill,
  Stethoscope,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  businessTodayISO,
  computeRangeInTimezone,
  type DateRangeKey,
} from "@/lib/timezone";
import { useAuth } from "@/contexts/AuthContext";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import { loadClinicPosPeriodSummary } from "@/lib/clinicPosAnalyticsSummary";
import { PageNotes } from "@/components/common/PageNotes";
import { fetchClinicConsultations, fetchClinicPatients } from "@/lib/clinicData";
import type { ClinicPatient } from "./clinicTypes";

interface ClinicDashboardPageProps {
  onNavigate: (page: string, state?: Record<string, unknown>) => void;
}

function formatMoney(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function isInRange(iso: string, from: Date, to: Date): boolean {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return t >= from.getTime() && t < to.getTime();
}

function DashHint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <PageNotes ariaLabel={label} variant="comment">
      {children}
    </PageNotes>
  );
}

function rangeLabel(key: DateRangeKey): string {
  const labels: Partial<Record<DateRangeKey, string>> = {
    today: "Today",
    yesterday: "Yesterday",
    this_week: "This week",
    this_month: "This month",
    this_quarter: "This quarter",
    this_year: "This year",
    last_week: "Last week",
    last_month: "Last month",
    last_7_days: "Last 7 days",
    last_30_days: "Last 30 days",
    last_24_hours: "Last 24 hours",
    custom: "Selected period",
  };
  return labels[key] ?? "Period";
}

export function ClinicDashboardPage({ onNavigate }: ClinicDashboardPageProps) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<DateRangeKey>("today");
  const [customFrom, setCustomFrom] = useState(() => businessTodayISO());
  const [customTo, setCustomTo] = useState(() => businessTodayISO());

  const [posSummary, setPosSummary] = useState({
    completedCount: 0,
    salesValue: 0,
    refundedValue: 0,
    outstandingCredit: 0,
    overdueCredit: 0,
    openCreditSaleCount: 0,
  });
  const [lowStock, setLowStock] = useState<Array<{ name: string; balance: number }>>([]);
  const [patientsInPeriod, setPatientsInPeriod] = useState(0);
  const [recentPatients, setRecentPatients] = useState<ClinicPatient[]>([]);

  const periodLabel = useMemo(() => rangeLabel(dateRange), [dateRange]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const { from: curFrom, to: curTo } = computeRangeInTimezone(dateRange, customFrom, customTo);
        const [clinicPatients, clinicConsultations, summary] = await Promise.all([
          fetchClinicPatients(orgId, superAdmin),
          fetchClinicConsultations(orgId, superAdmin),
          loadClinicPosPeriodSummary(orgId, superAdmin, curFrom, curTo),
        ]);

        if (!cancelled) {
          setPosSummary(summary);

          const activePatientIds = new Set<string>();
          for (const p of clinicPatients) {
            if (isInRange(p.createdAt, curFrom, curTo)) activePatientIds.add(p.id);
          }
          for (const c of clinicConsultations) {
            if (isInRange(c.createdAt, curFrom, curTo)) activePatientIds.add(c.patientId);
          }
          setPatientsInPeriod(activePatientIds.size);

          const recent = clinicPatients
            .filter((p) => activePatientIds.has(p.id))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, 5);
          setRecentPatients(recent);
        }

        const productsRes = await filterByOrganizationId(
          supabase.from("products").select("id, name, track_inventory").eq("active", true),
          orgId,
          superAdmin
        );
        const movesRes = await supabase.from("product_stock_movements").select("product_id, quantity_in, quantity_out");

        if (cancelled) return;
        if (productsRes.error) throw new Error(productsRes.error.message);

        const products = (productsRes.data || []) as Array<{ id: string; name: string; track_inventory: boolean | null }>;
        const map: Record<string, { name: string; balance: number }> = {};
        for (const p of products) {
          if ((p.track_inventory ?? true) !== true) continue;
          map[p.id] = { name: p.name, balance: 0 };
        }
        const moves = (movesRes.data || []) as Array<{
          product_id: string;
          quantity_in: number | null;
          quantity_out: number | null;
        }>;
        for (const m of moves) {
          if (!map[m.product_id]) continue;
          map[m.product_id].balance += Number(m.quantity_in || 0) - Number(m.quantity_out || 0);
        }
        const low = Object.values(map)
          .map((r) => ({ name: r.name, balance: Number(r.balance || 0) }))
          .filter((r) => r.balance <= 5)
          .sort((a, b) => a.balance - b.balance)
          .slice(0, 8);
        setLowStock(low);
      } catch (e) {
        console.error("Clinic dashboard load error:", e);
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [orgId, superAdmin, dateRange, customFrom, customTo]);

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] p-6 md:p-8 bg-gradient-to-br from-emerald-50/60 via-slate-50 to-slate-100/40">
        <div className="animate-pulse space-y-6 max-w-6xl mx-auto">
          <div className="h-8 bg-slate-200 rounded w-64" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-28 bg-slate-200 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] p-6 md:p-8 bg-gradient-to-br from-emerald-50/60 via-slate-50 to-slate-100/40">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-3xl font-bold text-slate-900">Clinic</h1>
                <PageNotes ariaLabel="Clinic workspace help" variant="comment">
                  <p>Clinics, pharmacies, and drug shops — alongside your retail tools.</p>
                  <p>Sales and credit figures use the same rules as POS Analytics, scoped to clinic dispensing.</p>
                </PageNotes>
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="clinic-dash-date-range" className="block text-sm text-slate-600 mb-1">
                  Period
                </label>
                <select
                  id="clinic-dash-date-range"
                  value={dateRange}
                  onChange={(e) => setDateRange(e.target.value as DateRangeKey)}
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white min-w-[10rem]"
                >
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="this_week">This week</option>
                  <option value="this_month">This month</option>
                  <option value="last_7_days">Last 7 days</option>
                  <option value="last_30_days">Last 30 days</option>
                  <option value="custom">Custom range</option>
                </select>
              </div>
              {dateRange === "custom" ? (
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">From</label>
                    <input
                      type="date"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">To</label>
                    <input
                      type="date"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                      className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onNavigate("clinic_patients", { clinicIntent: "new_patient" })}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 text-white px-4 py-2.5 text-sm font-medium shadow-sm hover:bg-emerald-800"
            >
              <UserPlus className="w-4 h-4" />
              New patient
            </button>
            <button
              type="button"
              onClick={() => onNavigate("clinic_pos")}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
            >
              <Banknote className="w-4 h-4 text-emerald-600" />
              New dispensing
            </button>
            <button
              type="button"
              onClick={() => onNavigate("clinic_consultation", { clinicIntent: "new" })}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
            >
              <Stethoscope className="w-4 h-4 text-sky-600" />
              New consultation
            </button>
            <button
              type="button"
              onClick={() => onNavigate("clinic_laboratory", { labTab: "orders" })}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
            >
              <FlaskConical className="w-4 h-4 text-violet-600" />
              Laboratory
            </button>
            <button
              type="button"
              onClick={() => onNavigate("reports_retail_sales_insights", { clinicOnly: true })}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-100"
            >
              <FileBarChart className="w-4 h-4 text-slate-600" />
              Clinic POS analytics
            </button>
          </div>
        </div>

        {loadError ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">{loadError}</div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <Users className="w-8 h-8 text-emerald-600" />
              <span className="text-2xl font-bold text-slate-900">{patientsInPeriod}</span>
            </div>
            <p className="mt-2 font-medium text-slate-800 inline-flex items-center gap-1">
              Patients ({periodLabel.toLowerCase()})
              <DashHint label="Patients in period">
                <p>Registered or had a consultation in the selected period.</p>
              </DashHint>
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <Activity className="w-8 h-8 text-sky-600" />
              <span className="text-2xl font-bold text-slate-900">{formatMoney(posSummary.salesValue)}</span>
            </div>
            <p className="mt-2 font-medium text-slate-800 inline-flex items-center gap-1">
              Sales ({periodLabel.toLowerCase()})
              <DashHint label="Sales in period">
                <p>
                  Matches POS Analytics &quot;Sales value&quot; for clinic dispensing: {posSummary.completedCount}{" "}
                  completed payment{posSummary.completedCount === 1 ? "" : "s"} in period.
                  {posSummary.refundedValue > 0.009
                    ? ` Refunded in period: ${formatMoney(posSummary.refundedValue)}.`
                    : ""}
                </p>
              </DashHint>
            </p>
          </div>

          <button
            type="button"
            onClick={() => onNavigate("reports_retail_sales_insights", { clinicOnly: true })}
            className="text-left bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:border-slate-300 transition"
          >
            <div className="flex items-center justify-between gap-2">
              <Wallet className="w-8 h-8 text-amber-600" />
              <span className="text-2xl font-bold text-slate-900">{formatMoney(posSummary.outstandingCredit)}</span>
            </div>
            <p className="mt-2 font-medium text-slate-800 inline-flex items-center gap-1">
              Open credit
              <DashHint label="Open credit">
                <p>
                  Matches POS Analytics &quot;Open credit&quot; for clinic sales: {posSummary.openCreditSaleCount} sale
                  {posSummary.openCreditSaleCount === 1 ? "" : "s"} with balance due.
                  {posSummary.overdueCredit > 0.009
                    ? ` Overdue: ${formatMoney(posSummary.overdueCredit)}.`
                    : ""}
                </p>
              </DashHint>
            </p>
          </button>

          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <Pill className="w-8 h-8 text-rose-600" />
              <span className="text-2xl font-bold text-slate-900">{lowStock.length}</span>
            </div>
            <p className="mt-2 font-medium text-slate-800 inline-flex items-center gap-1">
              Low stock (≤5)
              <DashHint label="Low stock">
                <p>Tracked products at or below 5 units on hand.</p>
              </DashHint>
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <FileBarChart className="h-5 w-5 text-slate-600" aria-hidden />
            <h2 className="text-lg font-bold text-slate-900">Financial and stock reports</h2>
            <DashHint label="Financial and stock reports">
              <p>Open the same reports used for retail operations (cash, credit, stock, and spend).</p>
            </DashHint>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onNavigate("reports_retail_sales_insights", { clinicOnly: true })}
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100"
            >
              Clinic POS analytics
            </button>
            <button
              type="button"
              onClick={() => onNavigate("accounting_cashflow")}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100"
            >
              Cash flow statement
            </button>
            <button
              type="button"
              onClick={() => onNavigate("retail_credit_invoices", { invoiceTab: "credit" })}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100"
            >
              Debtors report
            </button>
            <button
              type="button"
              onClick={() => onNavigate("reports_stock_movement")}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100"
            >
              Stock movement report
            </button>
            <button
              type="button"
              onClick={() => onNavigate("reports_expenses")}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100"
            >
              Expense report
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900 mb-4">Low stock medicines</h2>
            {lowStock.length === 0 ? (
              <p className="text-sm text-slate-600">No tracked items at or below 5 units.</p>
            ) : (
              <ul className="space-y-2">
                {lowStock.map((r) => (
                  <li key={r.name} className="flex justify-between text-sm border-b border-slate-100 pb-2">
                    <span className="text-slate-700 truncate pr-2">{r.name}</span>
                    <span className="font-semibold text-slate-900 shrink-0">{r.balance.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={() => onNavigate("inventory_stock_balances")}
              className="mt-4 text-sm font-medium text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-1"
            >
              Stock levels <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900 mb-4">Patients in period</h2>
            {recentPatients.length === 0 ? (
              <p className="text-sm text-slate-600">No patient activity in this period.</p>
            ) : (
              <ul className="space-y-3">
                {recentPatients.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onNavigate("clinic_patients", { highlightClinicPatientId: p.id })}
                      className="w-full text-left rounded-lg border border-slate-100 hover:bg-slate-50 px-3 py-2 transition"
                    >
                      <div className="font-medium text-slate-900">{p.name}</div>
                      <div className="text-xs text-slate-500">
                        {p.patientNumber}
                        {p.phone ? ` · ${p.phone}` : ""}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
