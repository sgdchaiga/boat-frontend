import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "../lib/supabase";
import { computeRangeInTimezone } from "../lib/timezone";
import { useAuth } from "../contexts/AuthContext";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";
import { PageNotes } from "./common/PageNotes";
import { getNextOrderStatus } from "../lib/hotelPosOrderStatus";

interface KitchenItem {
  quantity: number;
  notes?: string | null;
  products: { name: string };
}

interface KitchenOrder {
  id: string;
  room_id: string | null;
  table_number: string | null;
  customer_name: string | null;
  order_status: string;
  created_at: string;
  rooms?: { room_number: string } | null;
  kitchen_order_items: KitchenItem[];
}

export function KitchenDisplayPage() {
  const { user, isSuperAdmin } = useAuth();
  const orgId = user?.organization_id ?? null;

  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [viewRange, setViewRange] = useState<"last_7_days" | "today" | "yesterday" | "date">("today");
  const [viewDate, setViewDate] = useState(() => {
    const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kampala", year: "numeric", month: "2-digit", day: "2-digit" });
    const p = f.formatToParts(new Date());
    return `${p.find((x) => x.type === "year")!.value}-${p.find((x) => x.type === "month")!.value}-${p.find((x) => x.type === "day")!.value}`;
  });

  const fetchOrders = async () => {
    try {
      setLoading(true);
      setFetchError(null);
      const rangeKey = viewRange === "date" ? "custom" : viewRange as "last_7_days" | "today" | "yesterday";
      const customFrom = viewRange === "date" ? viewDate : "";
      const customTo = viewRange === "date" ? viewDate : "";
      const { from, to } = computeRangeInTimezone(rangeKey, customFrom, customTo);

      const [ordersRes, deptRes, productsRes] = await Promise.all([
        filterByOrganizationId(
          supabase
            .from("kitchen_orders")
            .select(`id, room_id, table_number, customer_name, order_status, created_at, kitchen_order_items(quantity, notes, product_id)`)
            .gte("created_at", from.toISOString())
            .lt("created_at", to.toISOString())
            .order("created_at", { ascending: true }),
          orgId,
          isSuperAdmin
        ),
        filterByOrganizationId(supabase.from("departments").select("id, name"), orgId, isSuperAdmin),
        filterByOrganizationId(supabase.from("products").select("id, name, department_id"), orgId, isSuperAdmin),
      ]);

      const { data: ordersData, error } = ordersRes;
      if (error) throw error;

      const departments = (deptRes.data || []) as { id: string; name: string }[];
      const kitchenDepts = departments.filter((d) => {
        const n = d.name.toLowerCase();
        return n.includes("kitchen") || n.includes("restaurant") || n.includes("food");
      });
      const kitchenDeptIds = new Set(kitchenDepts.map((d) => d.id));
      const hasKitchenDept = kitchenDeptIds.size > 0;

      const productMap: Record<string, { name: string; department_id: string | null }> = {};
      ((productsRes?.data || []) as { id: string; name: string; department_id: string | null }[]).forEach((p) => {
        productMap[p.id] = p;
      });

      const ordersWithProducts = (ordersData || [])
        .map((o: any) => {
          const allItems = (o.kitchen_order_items || []).map((i: any) => ({
            ...i,
            products: i.product_id ? { name: productMap[i.product_id]?.name ?? "Item" } : { name: "Item" },
            department_id: productMap[i.product_id]?.department_id ?? null,
          }));
          const kitchenItems = hasKitchenDept
            ? allItems.filter((i: any) => i.department_id && kitchenDeptIds.has(i.department_id))
            : allItems;
          return {
            ...o,
            kitchen_order_items: kitchenItems.map((item: Record<string, unknown>) => {
              const rest = { ...item };
              delete rest.department_id;
              return rest;
            }),
          };
        })
        .filter((o: any) => (o.kitchen_order_items || []).length > 0);

      setOrders(ordersWithProducts as KitchenOrder[]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load orders";
      setFetchError(msg);
      setOrders([]);
      console.error("Kitchen display fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 30000);
    return () => clearInterval(interval);
  }, [viewRange, viewDate, orgId, isSuperAdmin]);

  const updateStatus = async (orderId: string, newStatus: "preparing" | "ready") => {
    setUpdatingId(orderId);
    try {
      const { error } = await supabase
        .from("kitchen_orders")
        .update({ order_status: newStatus })
        .eq("id", orderId);

      if (error) throw error;
      await fetchOrders();
    } catch (err) {
      console.error("Update status error:", err);
      alert("Failed to update order status.");
    } finally {
      setUpdatingId(null);
    }
  };

  const getOrderLabel = (order: KitchenOrder) => {
    if (order.customer_name) return order.customer_name;
    if (order.room_id && order.rooms?.room_number) return `Room ${order.rooms.room_number}`;
    return `Table ${order.table_number || "POS"}`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-amber-100 text-amber-800 border-amber-300";
      case "preparing":
        return "bg-blue-100 text-blue-800 border-blue-300";
      case "ready":
        return "bg-green-100 text-green-800 border-green-300";
      case "completed":
      case "served":
        return "bg-slate-100 text-slate-700 border-slate-300";
      default:
        return "bg-slate-100 text-slate-800 border-slate-300";
    }
  };

  if (loading && orders.length === 0) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div className="animate-pulse text-xl">Loading kitchen display…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6">
      <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold">Kitchen Display</h1>
          <PageNotes ariaLabel="Kitchen display help" className="[&_button]:text-slate-300 [&_button]:hover:bg-slate-700 [&_button]:hover:text-white">
            <p>Live display of kitchen orders for the selected date range.</p>
          </PageNotes>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={viewRange}
            onChange={(e) => setViewRange(e.target.value as "last_7_days" | "today" | "yesterday" | "date")}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white"
          >
            <option value="last_7_days">Last 7 days</option>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="date">Specific date</option>
          </select>
          {viewRange === "date" && (
            <input
              type="date"
              value={viewDate}
              onChange={(e) => setViewDate(e.target.value)}
              className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white"
            />
          )}
        </div>
        <button
          onClick={fetchOrders}
          disabled={loading}
          className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg transition disabled:opacity-50"
        >
          <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {fetchError && (
        <div className="mb-4 p-4 bg-amber-900/50 border border-amber-600 rounded-lg text-amber-200 text-sm">
          {fetchError}
        </div>
      )}
      {orders.length === 0 ? (
        <div className="text-center py-20 text-slate-400 text-xl">
          {fetchError ? "Fix the error above and refresh" : "No kitchen orders for the selected period"}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {orders.map((order) => (
            <div
              key={order.id}
              className={`bg-slate-800 rounded-xl border-2 p-5 transition ${
                order.order_status === "ready"
                  ? "border-green-500"
                  : order.order_status === "preparing"
                    ? "border-blue-500"
                    : "border-amber-500"
              }`}
            >
              <div className="flex justify-between items-start mb-3">
                <span className="text-2xl font-bold text-amber-400">
                  #{order.id.slice(0, 6).toUpperCase()}
                </span>
                <span
                  className={`px-3 py-1 rounded-full text-sm font-semibold border ${getStatusColor(
                    order.order_status
                  )}`}
                >
                  {order.order_status}
                </span>
              </div>

              <p className="text-lg font-medium text-white mb-2">
                {getOrderLabel(order)}
              </p>
              <p className="text-xs text-slate-400 mb-4">
                {new Date(order.created_at).toLocaleDateString()} · {new Date(order.created_at).toLocaleTimeString()}
              </p>

              <div className="space-y-1 mb-4">
                {order.kitchen_order_items.map((item, i) => (
                  <div key={i} className="flex gap-2 text-slate-200">
                    <span className="font-semibold w-6">{item.quantity}×</span>
                    <span>{item.products?.name || "Item"}</span>
                    {item.notes && (
                      <span className="text-amber-300 text-sm">({item.notes})</span>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex gap-2 mt-4">
                {order.order_status === "pending" && (
                  <button
                    onClick={() => {
                      const next = getNextOrderStatus(order.order_status, "restaurant");
                      if (next === "preparing") void updateStatus(order.id, next);
                    }}
                    disabled={updatingId === order.id}
                    className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 py-2 rounded-lg font-semibold transition"
                  >
                    {updatingId === order.id ? "…" : "Preparing"}
                  </button>
                )}
                {order.order_status === "preparing" && (
                  <button
                    onClick={() => {
                      const next = getNextOrderStatus(order.order_status, "restaurant");
                      if (next === "ready") void updateStatus(order.id, next);
                    }}
                    disabled={updatingId === order.id}
                    className="flex-1 bg-green-600 hover:bg-green-500 disabled:opacity-50 py-2 rounded-lg font-semibold transition"
                  >
                    {updatingId === order.id ? "…" : "Ready"}
                  </button>
                )}
                {order.order_status === "ready" && (
                  <div className="flex-1 py-2 text-center text-green-400 font-semibold">
                    Ready for pickup
                  </div>
                )}
                {["completed", "served"].includes(order.order_status) && (
                  <div className="flex-1 py-2 text-center text-slate-400 font-semibold">
                    Completed
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
