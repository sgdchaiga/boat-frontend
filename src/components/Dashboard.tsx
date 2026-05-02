import { useEffect, useMemo, useState } from "react";
import {
  BedDouble,
  Calendar,
  DoorOpen,
  DollarSign,
  Users,
  Sparkles,
  TrendingUp,
  TrendingDown,
  UtensilsCrossed,
  Receipt,
  PieChart,
  Plus,
  Banknote,
  CreditCard,
  ShoppingCart,
  Package,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { businessTodayISO, computeRangeInTimezone, type DateRangeKey } from "../lib/timezone";
import { useAuth } from "../contexts/AuthContext";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";
import {
  hotelRevenueBucket,
  isHotelHospitalityPayment,
  type DashboardPayment,
} from "../lib/dashboardPaymentFilters";
import { PageNotes } from "./common/PageNotes";
import { fetchKitchenOrderIdsForPayments } from "../lib/dashboardKitchenLookup";
import { FeatureFlagsSummary } from "./common/FeatureFlagsSummary";

interface Stats {
  totalRooms: number;
  availableRooms: number;
  occupiedRooms: number;
  maintenanceRooms: number;
  cleaningRooms: number;
  periodStays: number;
  periodCheckIns: number;
  periodCheckOuts: number;
  periodReservations: number;
  periodGuests: number;
  periodHousekeeping: number;
  occupancyRate: number;
}
interface HotelRevenueStats {
  total: number;
  priorTotal: number;
  posHotel: number;
  stay: number;
  kitchen: number;
  debtor: number;
  roomChargesBilling: number;
}

interface DashboardProps {
  onNavigate?: (page: string) => void;
}

type RevenueRange = "today" | "this_week" | "this_month";

function priorRevenueRangeKey(range: RevenueRange): DateRangeKey {
  if (range === "today") return "yesterday";
  if (range === "this_week") return "last_week";
  return "last_month";
}

function pctChange(current: number, prior: number): number | null {
  if (prior === 0) return current === 0 ? 0 : null;
  return ((current - prior) / prior) * 100;
}

export function Dashboard({ onNavigate }: DashboardProps) {
  const { user } = useAuth();
  const businessType = user?.business_type ?? null;
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [stats, setStats] = useState<Stats>({
    totalRooms: 0,
    availableRooms: 0,
    occupiedRooms: 0,
    maintenanceRooms: 0,
    cleaningRooms: 0,
    periodStays: 0,
    periodCheckIns: 0,
    periodCheckOuts: 0,
    periodReservations: 0,
    periodGuests: 0,
    periodHousekeeping: 0,
    occupancyRate: 0,
  });
  const [hotelRev, setHotelRev] = useState<HotelRevenueStats>({
    total: 0,
    priorTotal: 0,
    posHotel: 0,
    stay: 0,
    kitchen: 0,
    debtor: 0,
    roomChargesBilling: 0,
  });
  const [kitchenOrdersActive, setKitchenOrdersActive] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revenueRange, setRevenueRange] = useState<RevenueRange>("today");

  useEffect(() => {
    fetchStats();
  }, [orgId, superAdmin, revenueRange]);

  const fetchStats = async () => {
    try {
      setLoadError(null);
      if (!orgId && !superAdmin) {
        setStats({
          totalRooms: 0,
          availableRooms: 0,
          occupiedRooms: 0,
          maintenanceRooms: 0,
          cleaningRooms: 0,
          periodStays: 0,
          periodCheckIns: 0,
          periodCheckOuts: 0,
          periodReservations: 0,
          periodGuests: 0,
          periodHousekeeping: 0,
          occupancyRate: 0,
        });
        setHotelRev({
          total: 0,
          priorTotal: 0,
          posHotel: 0,
          stay: 0,
          kitchen: 0,
          debtor: 0,
          roomChargesBilling: 0,
        });
        setKitchenOrdersActive(0);
        setLoadError("Missing organization on your staff profile. Contact admin to link your account.");
        return;
      }
      const { from: revFrom, to: revTo } = computeRangeInTimezone(revenueRange, "", "");
      const { from: prFrom, to: prTo } = computeRangeInTimezone(priorRevenueRangeKey(revenueRange), "", "");

      const minPay = new Date(Math.min(revFrom.getTime(), prFrom.getTime())).toISOString();
      const maxPay = new Date(Math.max(revTo.getTime(), prTo.getTime())).toISOString();

      let roomsPromise = supabase.from("rooms").select("status");
      roomsPromise = filterByOrganizationId(roomsPromise, orgId, superAdmin);

      let staysPromise = supabase.from("stays").select("actual_check_in, actual_check_out");
      staysPromise = filterByOrganizationId(staysPromise, orgId, superAdmin);

      let reservationsPromise = supabase.from("reservations").select("status, check_in_date, check_out_date, created_at");
      reservationsPromise = filterByOrganizationId(reservationsPromise, orgId, superAdmin);

      let customersPromise = supabase.from("hotel_customers").select("id, created_at");
      customersPromise = filterByOrganizationId(customersPromise, orgId, superAdmin);

      let housekeepingPromise = supabase.from("housekeeping_tasks").select("status, created_at");
      housekeepingPromise = filterByOrganizationId(housekeepingPromise, orgId, superAdmin);

      let paymentsPromise = supabase
        .from("payments")
        .select("amount, paid_at, stay_id, transaction_id, payment_status, payment_source")
        .eq("payment_status", "completed")
        .gte("paid_at", minPay)
        .lt("paid_at", maxPay);
      paymentsPromise = filterByOrganizationId(paymentsPromise, orgId, superAdmin);

      let billingPromise = supabase
        .from("billing")
        .select("amount, charged_at")
        .not("stay_id", "is", null)
        .gte("charged_at", revFrom.toISOString())
        .lt("charged_at", revTo.toISOString());
      billingPromise = filterByOrganizationId(billingPromise, orgId, superAdmin);

      let kitchenQueuePromise = supabase
        .from("kitchen_orders")
        .select("id", { count: "exact", head: true })
        .gte("created_at", revFrom.toISOString())
        .lt("created_at", revTo.toISOString());
      kitchenQueuePromise = filterByOrganizationId(kitchenQueuePromise, orgId, superAdmin);

      const [
        roomsResult,
        staysResult,
        reservationsResult,
        customersResult,
        housekeepingResult,
        paymentsResult,
        billingResult,
        kitchenCountResult,
      ] = await Promise.all([
        roomsPromise,
        staysPromise,
        reservationsPromise,
        customersPromise,
        housekeepingPromise,
        paymentsPromise,
        billingPromise,
        kitchenQueuePromise,
      ]);

      if (roomsResult.error) throw new Error(roomsResult.error.message);
      if (staysResult.error) throw new Error(staysResult.error.message);
      if (reservationsResult.error) throw new Error(reservationsResult.error.message);
      if (customersResult.error) throw new Error(customersResult.error.message);
      if (housekeepingResult.error) throw new Error(housekeepingResult.error.message);
      if (billingResult.error) throw new Error(billingResult.error.message);
      if (kitchenCountResult.error) throw new Error(kitchenCountResult.error.message);
      if (paymentsResult.error) throw new Error(paymentsResult.error.message);

      const rooms = roomsResult.data || [];
      const stays = staysResult.data || [];
      const reservations = reservationsResult.data || [];
      const customers = customersResult.data || [];
      const housekeeping = housekeepingResult.data || [];
      const payments = (paymentsResult.data || []) as DashboardPayment[];

      const kitchenIds = await fetchKitchenOrderIdsForPayments(payments, orgId, superAdmin);

      const inRange = (p: DashboardPayment, from: Date, to: Date) => {
        const t = new Date(p.paid_at || 0).getTime();
        return t >= from.getTime() && t < to.getTime();
      };

      const currentPay = payments.filter((p) => inRange(p, revFrom, revTo));
      const priorPay = payments.filter((p) => inRange(p, prFrom, prTo));

      let total = 0,
        priorTotal = 0;
      let posHotel = 0,
        stay = 0,
        kitchen = 0,
        debtor = 0;

      for (const p of currentPay) {
        if (!isHotelHospitalityPayment(p, kitchenIds)) continue;
        const amt = Number(p.amount ?? 0);
        total += amt;
        const b = hotelRevenueBucket(p, kitchenIds);
        if (b === "pos_hotel") posHotel += amt;
        else if (b === "stay") stay += amt;
        else if (b === "kitchen") kitchen += amt;
        else if (b === "debtor") debtor += amt;
      }
      for (const p of priorPay) {
        if (!isHotelHospitalityPayment(p, kitchenIds)) continue;
        priorTotal += Number(p.amount ?? 0);
      }

      const billingRows = (billingResult.data || []) as Array<{ amount: number }>;
      const roomChargesBilling = billingRows.reduce((s, b) => s + Number(b.amount ?? 0), 0);

      const totalRooms = rooms.length;
      const occupiedRooms = rooms.filter((r) => r.status === "occupied").length;
      const maintenanceRooms = rooms.filter((r) => r.status === "maintenance").length;
      const cleaningRooms = rooms.filter((r) => r.status === "cleaning").length;
      const availableRooms = Math.max(
        0,
        totalRooms - occupiedRooms - maintenanceRooms - cleaningRooms
      );
      type StayRow = {
        actual_check_in: string | null;
        actual_check_out: string | null;
      };
      const periodStays = (stays as StayRow[]).filter((s) => {
        const checkIn = s.actual_check_in ? new Date(s.actual_check_in).getTime() : NaN;
        const checkOut = s.actual_check_out ? new Date(s.actual_check_out).getTime() : Number.POSITIVE_INFINITY;
        if (!Number.isFinite(checkIn)) return false;
        return checkIn < revTo.getTime() && checkOut >= revFrom.getTime();
      }).length;
      const periodCheckIns = reservations.filter((r) => {
        if (r.status === "cancelled") return false;
        const t = r.check_in_date ? new Date(`${r.check_in_date}T12:00:00`).getTime() : NaN;
        return Number.isFinite(t) && t >= revFrom.getTime() && t < revTo.getTime();
      }).length;
      const periodCheckOuts = reservations.filter((r) => {
        if (r.status === "cancelled") return false;
        const t = r.check_out_date ? new Date(`${r.check_out_date}T12:00:00`).getTime() : NaN;
        return Number.isFinite(t) && t >= revFrom.getTime() && t < revTo.getTime();
      }).length;
      const periodReservations = reservations.filter((r) => {
        if (r.status === "cancelled") return false;
        const t = r.created_at ? new Date(r.created_at).getTime() : NaN;
        return Number.isFinite(t) && t >= revFrom.getTime() && t < revTo.getTime();
      }).length;
      const periodGuests = customers.filter((c) => {
        const t = c.created_at ? new Date(c.created_at).getTime() : NaN;
        return Number.isFinite(t) && t >= revFrom.getTime() && t < revTo.getTime();
      }).length;
      const periodHousekeeping = housekeeping.filter((h) => {
        if (h.status !== "pending") return false;
        const t = h.created_at ? new Date(h.created_at).getTime() : NaN;
        return Number.isFinite(t) && t >= revFrom.getTime() && t < revTo.getTime();
      }).length;
      const occupancyRate = totalRooms > 0 ? (occupiedRooms / totalRooms) * 100 : 0;

      setStats({
        totalRooms,
        availableRooms,
        occupiedRooms,
        maintenanceRooms,
        cleaningRooms,
        periodStays,
        periodCheckIns,
        periodCheckOuts,
        periodReservations,
        periodGuests,
        periodHousekeeping,
        occupancyRate,
      });

      setHotelRev({
        total,
        priorTotal,
        posHotel,
        stay,
        kitchen,
        debtor,
        roomChargesBilling,
      });

      const kc = kitchenCountResult.count;
      setKitchenOrdersActive(typeof kc === "number" ? kc : 0);
    } catch (error) {
      console.error("Error fetching stats:", error);
      setLoadError(error instanceof Error ? error.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  };

  const revPct = pctChange(hotelRev.total, hotelRev.priorTotal);

  const rangeLabel =
    revenueRange === "today" ? "Today" : revenueRange === "this_week" ? "This week" : "This month";
  const breakdownRows = useMemo(
    () => [
      { key: "posHotel", label: "Hotel POS (pay now)", amount: hotelRev.posHotel, color: "bg-emerald-500" },
      { key: "stay", label: "Guest / stay payments", amount: hotelRev.stay, color: "bg-blue-500" },
      { key: "kitchen", label: "Kitchen order (cash)", amount: hotelRev.kitchen, color: "bg-amber-500" },
      { key: "debtor", label: "Debtor / collections", amount: hotelRev.debtor, color: "bg-violet-500" },
    ],
    [hotelRev]
  );

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] p-6 md:p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-slate-200 rounded w-48"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="h-32 bg-slate-200 rounded-xl"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] p-6 md:p-8 bg-gradient-to-br from-slate-50 via-white to-sky-50/30">
      <div className="mb-8">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
              <FeatureFlagsSummary compact />
              <PageNotes ariaLabel="Dashboard help">
                <p>Hotel operations, occupancy, and hospitality revenue.</p>
              </PageNotes>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-slate-600">Revenue period</label>
            <select
              value={revenueRange}
              onChange={(e) => setRevenueRange(e.target.value as RevenueRange)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="today">Today</option>
              <option value="this_week">This week</option>
              <option value="this_month">This month</option>
            </select>
          </div>
        </div>
        {onNavigate ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onNavigate("cash_receipts")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
            >
              <Plus className="w-4 h-4 text-emerald-600" />
              <Banknote className="w-4 h-4 text-slate-500" />
              Receive money
            </button>
            <button
              type="button"
              onClick={() => onNavigate("purchases_expenses")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
            >
              <Plus className="w-4 h-4 text-amber-600" />
              <CreditCard className="w-4 h-4 text-slate-500" />
              Spend money
            </button>
            {businessType === "mixed" ? (
              <>
                <button
                  type="button"
                  onClick={() => onNavigate("hotel_pos_waiter")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
                >
                  <Plus className="w-4 h-4 text-emerald-600" />
                  <UtensilsCrossed className="w-4 h-4 text-slate-500" />
                  Hotel POS
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate("retail_pos")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
                >
                  <Plus className="w-4 h-4 text-violet-600" />
                  <ShoppingCart className="w-4 h-4 text-slate-500" />
                  Retail POS
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() =>
                  onNavigate(
                    businessType === "hotel" || businessType === "restaurant" ? "hotel_pos_waiter" : "retail_pos",
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
              >
                <Plus
                  className={`w-4 h-4 ${businessType === "hotel" || businessType === "restaurant" ? "text-emerald-600" : "text-violet-600"}`}
                />
                {businessType === "hotel" || businessType === "restaurant" ? (
                  <UtensilsCrossed className="w-4 h-4 text-slate-500" />
                ) : (
                  <ShoppingCart className="w-4 h-4 text-slate-500" />
                )}
                {businessType === "hotel" || businessType === "restaurant" ? "Hotel POS" : "Retail POS"}
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigate("purchases_orders")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
            >
              <Plus className="w-4 h-4 text-sky-600" />
              <Package className="w-4 h-4 text-slate-500" />
              Add stock
            </button>
          </div>
        ) : null}
      </div>
      <p className="mb-4 text-xs text-slate-500">All dashboard cards reflect: <span className="font-medium text-slate-700">{rangeLabel}</span>.</p>

      {loadError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{loadError}</div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="app-card-interactive p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-blue-100 p-3 rounded-lg">
              <BedDouble className="w-6 h-6 text-blue-600" />
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-slate-900">{stats.availableRooms}</p>
              <p className="text-sm text-slate-500">of {stats.totalRooms}</p>
            </div>
          </div>
          <p className="text-slate-700 font-medium">Available Rooms</p>
          <p className="text-xs text-slate-500 mt-1">
            {stats.occupiedRooms} occupied, {stats.maintenanceRooms} maintenance, {stats.cleaningRooms}{" "}
            cleaning
          </p>
        </div>

        <div className="app-card-interactive p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-green-100 p-3 rounded-lg">
              <DoorOpen className="w-6 h-6 text-green-600" />
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-slate-900">{stats.periodStays}</p>
              <p className="text-sm text-slate-500">Active</p>
            </div>
          </div>
          <p className="text-slate-700 font-medium">Stays in period</p>
          <div className="flex items-center gap-2 mt-1">
            <TrendingUp className="w-4 h-4 text-green-600" />
            <p className="text-xs text-slate-500">{stats.occupancyRate.toFixed(1)}% occupancy</p>
          </div>
        </div>

        <div className="app-card-interactive p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-amber-100 p-3 rounded-lg">
              <Calendar className="w-6 h-6 text-amber-600" />
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-slate-900">{stats.periodReservations}</p>
              <p className="text-sm text-slate-500">Pending</p>
            </div>
          </div>
          <p className="text-slate-700 font-medium">Reservations in period</p>
          <p className="text-xs text-slate-500 mt-1">
            {stats.periodCheckIns} check-ins, {stats.periodCheckOuts} check-outs ({rangeLabel.toLowerCase()})
          </p>
        </div>

        <div className="app-card-interactive p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-emerald-100 p-3 rounded-lg">
              <DollarSign className="w-6 h-6 text-emerald-600" />
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-slate-900">{hotelRev.total.toFixed(2)}</p>
              <p className="text-sm text-slate-500">{rangeLabel}</p>
            </div>
          </div>
          <p className="text-slate-700 font-medium">Hospitality revenue</p>
          <div className="flex items-center gap-2 mt-1">
            {revPct !== null ? (
              <>
                {revPct >= 0 ? (
                  <TrendingUp className="w-4 h-4 text-emerald-600" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-rose-600" />
                )}
                <p className={`text-xs ${revPct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  {revPct >= 0 ? "+" : ""}
                  {revPct.toFixed(1)}% vs prior period
                </p>
              </>
            ) : (
              <p className="text-xs text-slate-500">Payments & receipts</p>
            )}
          </div>
        </div>

        <div className="app-card-interactive p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-violet-100 p-3 rounded-lg">
              <Users className="w-6 h-6 text-violet-600" />
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-slate-900">{stats.periodGuests}</p>
              <p className="text-sm text-slate-500">{rangeLabel}</p>
            </div>
          </div>
          <p className="text-slate-700 font-medium">Guest records created</p>
          <p className="text-xs text-slate-500 mt-1">Created in selected period</p>
        </div>

        <div className="app-card-interactive p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-pink-100 p-3 rounded-lg">
              <Sparkles className="w-6 h-6 text-pink-600" />
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-slate-900">{stats.periodHousekeeping}</p>
              <p className="text-sm text-slate-500">{rangeLabel}</p>
            </div>
          </div>
          <p className="text-slate-700 font-medium">Pending housekeeping created</p>
          <p className="text-xs text-slate-500 mt-1">Created in selected period</p>
        </div>

        <div className="app-card-interactive p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-orange-100 p-3 rounded-lg">
              <UtensilsCrossed className="w-6 h-6 text-orange-600" />
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-slate-900">{kitchenOrdersActive}</p>
              <p className="text-sm text-slate-500">{rangeLabel}</p>
            </div>
          </div>
          <p className="text-slate-700 font-medium">Kitchen orders created</p>
          <p className="text-xs text-slate-500 mt-1">Created in selected period</p>
        </div>

        <div className="app-card-interactive p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-cyan-100 p-3 rounded-lg">
              <Receipt className="w-6 h-6 text-cyan-600" />
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-slate-900">{hotelRev.roomChargesBilling.toFixed(2)}</p>
              <p className="text-sm text-slate-500">{rangeLabel}</p>
            </div>
          </div>
          <p className="text-slate-700 font-medium">Room & folio charges</p>
          <p className="text-xs text-slate-500 mt-1">Posted to billing (accrual)</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="app-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <PieChart className="w-5 h-5 text-slate-700" />
            <h2 className="text-lg font-bold text-slate-900">Payment receipts ({rangeLabel})</h2>
          </div>
          <p className="text-xs text-slate-500 mb-4">Cash in by source — excludes pure retail POS.</p>
          {hotelRev.total <= 0 ? (
            <p className="text-sm text-slate-500">No hospitality payments in this period.</p>
          ) : (
            <ul className="space-y-3">
              {breakdownRows.map((r) => {
                const share = hotelRev.total > 0 ? (r.amount / hotelRev.total) * 100 : 0;
                if (r.amount <= 0 && share === 0) return null;
                return (
                  <li key={r.key}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-700">{r.label}</span>
                      <span className="font-medium text-slate-900">
                        {r.amount.toFixed(2)} <span className="text-slate-400">({share.toFixed(0)}%)</span>
                      </span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${r.color}`} style={{ width: `${share}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="app-card p-6">
          <h2 className="text-lg font-bold text-slate-900 mb-2">At a glance</h2>
          <ul className="text-sm text-slate-600 space-y-2">
            <li>
              • <strong className="text-slate-800">Revenue</strong> compares hospitality payments to the prior equivalent period
              (yesterday / last week / last month).
            </li>
            <li>
              • <strong className="text-slate-800">Room & folio charges</strong> sum posted billing lines for the selected period (may differ
              from cash timing).
            </li>
            <li>
              • <strong className="text-slate-800">Kitchen queue</strong> counts orders still pending or being prepared.
            </li>
          </ul>
        </div>
      </div>

      <div className="app-card p-6">
        <h2 className="text-xl font-bold text-slate-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <button
            type="button"
            onClick={() => onNavigate?.("reservations")}
            className="p-4 border-2 border-slate-200 rounded-lg hover:border-brand-700 hover:bg-slate-50 transition text-left cursor-pointer"
          >
            <Calendar className="w-6 h-6 text-slate-700 mb-2" />
            <p className="font-medium text-slate-900">New Reservation</p>
            <p className="text-sm text-slate-500">Create a new booking</p>
          </button>
          <button
            type="button"
            onClick={() => onNavigate?.("checkin")}
            className="p-4 border-2 border-slate-200 rounded-lg hover:border-brand-700 hover:bg-slate-50 transition text-left cursor-pointer"
          >
            <DoorOpen className="w-6 h-6 text-slate-700 mb-2" />
            <p className="font-medium text-slate-900">Check-In Guest</p>
            <p className="text-sm text-slate-500">Process arrival</p>
          </button>
          <button
            type="button"
            onClick={() => onNavigate?.("pos")}
            className="p-4 border-2 border-slate-200 rounded-lg hover:border-brand-700 hover:bg-slate-50 transition text-left cursor-pointer"
          >
            <UtensilsCrossed className="w-6 h-6 text-slate-700 mb-2" />
            <p className="font-medium text-slate-900">Hotel POS</p>
            <p className="text-sm text-slate-500">F&B & room service</p>
          </button>
          <button
            type="button"
            onClick={() => onNavigate?.("Kitchen Orders")}
            className="p-4 border-2 border-slate-200 rounded-lg hover:border-brand-700 hover:bg-slate-50 transition text-left cursor-pointer"
          >
            <Sparkles className="w-6 h-6 text-slate-700 mb-2" />
            <p className="font-medium text-slate-900">Kitchen queue</p>
            <p className="text-sm text-slate-500">Orders & prep</p>
          </button>
          <button
            type="button"
            onClick={() => onNavigate?.("housekeeping")}
            className="p-4 border-2 border-slate-200 rounded-lg hover:border-brand-700 hover:bg-slate-50 transition text-left cursor-pointer md:col-span-2 lg:col-span-1"
          >
            <Sparkles className="w-6 h-6 text-slate-700 mb-2" />
            <p className="font-medium text-slate-900">Housekeeping Task</p>
            <p className="text-sm text-slate-500">Assign room cleaning</p>
          </button>
        </div>
      </div>
    </div>
  );
}
