import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";
import { computeRangeInTimezone } from "../lib/timezone";

export function POSDashboardPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const [todaySales, setTodaySales] = useState(0);
  const [todayOrders, setTodayOrders] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const { from, to } = computeRangeInTimezone("today", "", "");
      const paymentsQ = filterByOrganizationId(
        supabase
          .from("payments")
          .select("amount, payment_status, payment_source, paid_at")
          .eq("payment_status", "completed")
          .eq("payment_source", "pos_hotel")
          .gte("paid_at", from.toISOString())
          .lt("paid_at", to.toISOString()),
        orgId,
        superAdmin
      );
      const ordersQ = filterByOrganizationId(
        supabase
          .from("kitchen_orders")
          .select("id", { count: "exact", head: true })
          .gte("created_at", from.toISOString())
          .lt("created_at", to.toISOString()),
        orgId,
        superAdmin
      );
      const [{ data: paymentRows }, { count: orderCount }] = await Promise.all([paymentsQ, ordersQ]);
      const sales = (paymentRows || []).reduce((sum, row: any) => sum + Number(row.amount || 0), 0);
      setTodaySales(sales);
      setTodayOrders(orderCount || 0);
      setLoading(false);
    })();
  }, [orgId, superAdmin]);

  return (
    <div className="p-6 md:p-8">
      <h1 className="text-2xl font-bold text-slate-900 mb-4">POS Dashboard</h1>
      {loading ? (
        <p className="text-sm text-slate-500">Loading POS metrics...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">Today sales</p>
            <p className="text-2xl font-bold text-slate-900">{todaySales.toFixed(2)}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">Today orders</p>
            <p className="text-2xl font-bold text-slate-900">{todayOrders}</p>
          </div>
        </div>
      )}
    </div>
  );
}