import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bell, Clock, LayoutDashboard, UtensilsCrossed } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";
import { computeRangeInTimezone } from "../lib/timezone";

type QueueOrder = {
  id: string;
  table_number: string | null;
  order_status: string;
  created_at: string;
};

export function HotelPosSupervisorPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [orders, setOrders] = useState<QueueOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const { from, to } = computeRangeInTimezone("today", "", "");
      const { data } = await filterByOrganizationId(
        supabase
          .from("kitchen_orders")
          .select("id, table_number, order_status, created_at")
          .gte("created_at", from.toISOString())
          .lt("created_at", to.toISOString())
          .order("created_at", { ascending: false }),
        orgId,
        superAdmin
      );
      setOrders(((data as QueueOrder[]) || []).map((o) => ({ ...o })));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    const timer = setInterval(() => {
      void loadData();
    }, 30000);
    return () => clearInterval(timer);
  }, [orgId, superAdmin]);

  const stats = useMemo(() => {
    let pending = 0;
    let preparing = 0;
    let ready = 0;
    let active = 0;
    const occupiedTables = new Set<string>();
    const alerts: Array<{ id: string; label: string }> = [];
    for (const o of orders) {
      const status = String(o.order_status || "");
      if (status === "pending") pending += 1;
      if (status === "preparing") preparing += 1;
      if (status === "ready") ready += 1;
      if (status === "pending" || status === "preparing") {
        active += 1;
        if (o.table_number) occupiedTables.add(o.table_number);
      }
      const ageMinutes = Math.floor((Date.now() - new Date(o.created_at).getTime()) / 60000);
      if ((status === "pending" || status === "preparing") && ageMinutes >= 20) {
        alerts.push({
          id: o.id,
          label: `Order ${o.id.slice(0, 8)} pending ${ageMinutes} min (${o.table_number || "POS"})`,
        });
      }
    }
    return {
      pending,
      preparing,
      ready,
      active,
      occupiedTables: occupiedTables.size,
      alerts,
    };
  }, [orders]);

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Supervisor Dashboard</h1>
        <p className="text-sm text-slate-600 mt-1">Live orders overview, table status, and service alerts.</p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading supervisor metrics...</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500 flex items-center gap-1"><LayoutDashboard className="w-4 h-4" /> Live orders</p>
              <p className="text-2xl font-bold text-slate-900">{stats.active}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500 flex items-center gap-1"><UtensilsCrossed className="w-4 h-4" /> Occupied tables</p>
              <p className="text-2xl font-bold text-slate-900">{stats.occupiedTables}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500 flex items-center gap-1"><Clock className="w-4 h-4" /> Preparing</p>
              <p className="text-2xl font-bold text-slate-900">{stats.preparing}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500 flex items-center gap-1"><Bell className="w-4 h-4" /> Ready</p>
              <p className="text-2xl font-bold text-slate-900">{stats.ready}</p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <h2 className="text-lg font-semibold text-slate-900 mb-2 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              Alerts
            </h2>
            {stats.alerts.length === 0 ? (
              <p className="text-sm text-slate-500">No critical service delay alerts.</p>
            ) : (
              <ul className="space-y-2">
                {stats.alerts.slice(0, 10).map((a) => (
                  <li key={a.id} className="text-sm rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2">
                    {a.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
