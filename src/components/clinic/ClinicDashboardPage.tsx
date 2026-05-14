import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  Banknote,
  FileBarChart,
  Pill,
  Stethoscope,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { computeRangeInTimezone } from "@/lib/timezone";
import { useAuth } from "@/contexts/AuthContext";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import { isRetailPosPayment, type DashboardPayment } from "@/lib/dashboardPaymentFilters";
import { fetchKitchenOrderIdsForPayments } from "@/lib/dashboardKitchenLookup";
import { toBusinessDateString } from "@/lib/timezone";
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

function isSameBusinessDay(iso: string, dayKey: string): boolean {
  try {
    return toBusinessDateString(new Date(iso)) === dayKey;
  } catch {
    return false;
  }
}

export function ClinicDashboardPage({ onNavigate }: ClinicDashboardPageProps) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [salesToday, setSalesToday] = useState(0);
  const [pendingCredit, setPendingCredit] = useState(0);
  const [pendingAccounts, setPendingAccounts] = useState(0);
  const [lowStock, setLowStock] = useState<Array<{ name: string; balance: number }>>([]);
  const [patientsToday, setPatientsToday] = useState(0);
  const [recentPatients, setRecentPatients] = useState<ClinicPatient[]>([]);

  const todayKey = useMemo(() => toBusinessDateString(new Date()), []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [clinicPatients, clinicConsultations, { from: curFrom, to: curTo }] = await Promise.all([
          fetchClinicPatients(orgId, superAdmin),
          fetchClinicConsultations(orgId, superAdmin),
          Promise.resolve(computeRangeInTimezone("today", "", "")),
        ]);

        if (!cancelled) {
          const ptoday = new Set<string>();
          for (const p of clinicPatients) {
            if (isSameBusinessDay(p.createdAt, todayKey)) ptoday.add(p.id);
          }
          for (const c of clinicConsultations) {
            if (isSameBusinessDay(c.createdAt, todayKey)) ptoday.add(c.patientId);
          }
          setPatientsToday(ptoday.size);

          const sorted = [...clinicPatients].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          setRecentPatients(sorted.slice(0, 5));
        }

        let payQ = supabase
          .from("payments")
          .select("id, transaction_id, paid_at, amount, payment_method, payment_status, stay_id, payment_source")
          .eq("payment_status", "completed")
          .gte("paid_at", curFrom.toISOString())
          .lt("paid_at", curTo.toISOString());
        payQ = filterByOrganizationId(payQ, orgId, superAdmin);

        const [paymentsRes, productsRes, movesRes, custRes] = await Promise.all([
          payQ,
          filterByOrganizationId(
            supabase.from("products").select("id, name, track_inventory").eq("active", true),
            orgId,
            superAdmin
          ),
          supabase.from("product_stock_movements").select("product_id, quantity_in, quantity_out"),
          filterByOrganizationId(
            supabase.from("retail_customers").select("id, current_credit_balance"),
            orgId,
            superAdmin
          ),
        ]);

        if (cancelled) return;
        if (paymentsRes.error) throw new Error(paymentsRes.error.message);

        const allPayments = (paymentsRes.data || []) as DashboardPayment[];
        const kitchenIds = await fetchKitchenOrderIdsForPayments(allPayments, orgId, superAdmin);
        const retailToday = allPayments.filter((p) => {
          const t = new Date(p.paid_at || 0).getTime();
          return t >= curFrom.getTime() && t < curTo.getTime() && isRetailPosPayment(p, kitchenIds);
        });
        setSalesToday(retailToday.reduce((s, p) => s + Number(p.amount ?? 0), 0));

        const customers = (custRes.data || []) as Array<{ id: string; current_credit_balance?: number | null }>;
        let pend = 0;
        let acct = 0;
        for (const c of customers) {
          const b = Number(c.current_credit_balance ?? 0);
          if (b > 0.009) {
            pend += b;
            acct += 1;
          }
        }
        setPendingCredit(pend);
        setPendingAccounts(acct);

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
  }, [orgId, superAdmin, todayKey]);

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
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-bold text-slate-900">Clinic</h1>
              <PageNotes ariaLabel="Clinic workspace help">
                <p>Patient register and visits in Supabase; sales, credit balances, and stock from your retail data.</p>
              </PageNotes>
            </div>
            <p className="text-slate-600 mt-1">Clinics, pharmacies, and drug shops — alongside your retail tools.</p>
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
          </div>
        </div>

        {loadError ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">{loadError}</div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <Users className="w-8 h-8 text-emerald-600" />
              <span className="text-2xl font-bold text-slate-900">{patientsToday}</span>
            </div>
            <p className="mt-2 font-medium text-slate-800">Patients today</p>
            <p className="text-xs text-slate-500 mt-0.5">Registered or had a consultation today</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <Activity className="w-8 h-8 text-sky-600" />
              <span className="text-2xl font-bold text-slate-900">{formatMoney(salesToday)}</span>
            </div>
            <p className="mt-2 font-medium text-slate-800">Sales today</p>
            <p className="text-xs text-slate-500 mt-0.5">Retail POS (same as retail dashboard)</p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate("retail_credit_invoices", { invoiceTab: "credit" })}
            className="text-left bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:border-slate-300 transition"
          >
            <div className="flex items-center justify-between gap-2">
              <Wallet className="w-8 h-8 text-amber-600" />
              <span className="text-2xl font-bold text-slate-900">{formatMoney(pendingCredit)}</span>
            </div>
            <p className="mt-2 font-medium text-slate-800">Pending balances</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {pendingAccounts} retail customer{pendingAccounts === 1 ? "" : "s"} with credit balance
            </p>
          </button>
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <Pill className="w-8 h-8 text-rose-600" />
              <span className="text-2xl font-bold text-slate-900">{lowStock.length}</span>
            </div>
            <p className="mt-2 font-medium text-slate-800">Low stock (≤5)</p>
            <p className="text-xs text-slate-500 mt-0.5">Tracked products from inventory</p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <FileBarChart className="h-5 w-5 text-slate-600" aria-hidden />
            <h2 className="text-lg font-bold text-slate-900">Financial and stock reports</h2>
          </div>
          <p className="text-sm text-slate-600 mb-3">Open the same reports used for retail operations (cash, credit, stock, and spend).</p>
          <div className="flex flex-wrap gap-2">
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
              onClick={() => onNavigate("reports_daily_purchases_summary")}
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
            <h2 className="text-lg font-bold text-slate-900 mb-4">Recent patients</h2>
            {recentPatients.length === 0 ? (
              <p className="text-sm text-slate-600">No patients yet — use New patient to register.</p>
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
