import { useEffect, useMemo, useState } from "react";
import { Clock } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { Database } from "../lib/database.types";
import { computeRangeInTimezone, type DateRangeKey } from "../lib/timezone";
import { useAuth } from "../contexts/AuthContext";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";
import { PageNotes } from "./common/PageNotes";
import { getNextOrderStatus } from "../lib/hotelPosOrderStatus";

type Department = Database["public"]["Tables"]["departments"]["Row"];

interface BarOrderItem {
  quantity: number;
  notes?: string | null;
  products: { name: string; department_id: string | null; sales_price?: number | null };
}

interface BarOrder {
  id: string;
  order_status: string;
  table_number: string | null;
  customer_name?: string | null;
  created_at: string;
  created_by: string | null;
  kitchen_order_items: BarOrderItem[];
  payments_total?: number;
}

export function BarOrdersPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [orders, setOrders] = useState<BarOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [barDepartment, setBarDepartment] = useState<Department | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [dateRange, setDateRange] = useState<DateRangeKey>("last_30_days");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  useEffect(() => {
    fetchOrders();
  }, [dateRange, customFrom, customTo, orgId, superAdmin]);

  const updateStatus = async (orderId: string, newStatus: "preparing" | "ready" | "served") => {
    setUpdatingId(orderId);
    try {
      const { error } = await supabase.from("kitchen_orders").update({ order_status: newStatus }).eq("id", orderId);
      if (error) throw error;
      await fetchOrders();
    } catch (err) {
      console.error("Bar update status error:", err);
      alert("Failed to update order status.");
    } finally {
      setUpdatingId(null);
    }
  };

  const fetchOrders = async () => {
    try {
      setLoading(true);
      const { from, to } = computeRangeInTimezone(dateRange, customFrom, customTo);
      const fromIso = from.toISOString();
      const toIso = to.toISOString();

      const [departmentsRes, ordersRes, productsRes] = await Promise.all([
        filterByOrganizationId(supabase.from("departments").select("id,name"), orgId, superAdmin),
        filterByOrganizationId(
          supabase
            .from("kitchen_orders")
            .select(
              `
            id,
            order_status,
            table_number,
            customer_name,
            created_at,
            created_by,
            kitchen_order_items(quantity, notes, product_id)
          `
            )
            .gte("created_at", fromIso)
            .lt("created_at", toIso)
            .order("created_at", { ascending: true }),
          orgId,
          superAdmin
        ),
        filterByOrganizationId(supabase.from("products").select("id, name, department_id, sales_price"), orgId, superAdmin),
      ]);

      if (departmentsRes.error) {
        console.error("Bar orders departments error:", departmentsRes.error);
      }
      if (ordersRes.error) {
        console.error("Bar orders error:", ordersRes.error);
        setLoading(false);
        return;
      }

      const departments = (departmentsRes.data || []) as Department[];
      const barDept =
        departments.find((d) => d.name.toLowerCase().includes("bar")) || null;
      setBarDepartment(barDept);

      const productMap = Object.fromEntries(
        ((productsRes?.data || []) as { id: string; name: string; department_id: string | null; sales_price: number | null }[])
          .map((p) => [p.id, p])
      );
      const rawOrders = (ordersRes.data || []) as any[];
      const data = rawOrders.map((o) => ({
        ...o,
        kitchen_order_items: (o.kitchen_order_items || []).map((i: any) => ({
          ...i,
          products: i.product_id && productMap[i.product_id]
            ? { name: productMap[i.product_id].name, department_id: productMap[i.product_id].department_id, sales_price: productMap[i.product_id].sales_price }
            : { name: "Item", department_id: null, sales_price: 0 },
        })),
      })) as BarOrder[];

      const orderIds = data.map((o) => o.id);
      let paymentsMap: Record<string, number> = {};
      if (orderIds.length > 0) {
        const { data: paymentsData, error: payError } = await filterByOrganizationId(
          supabase.from("payments").select("amount, payment_status, transaction_id").in("transaction_id", orderIds),
          orgId,
          superAdmin
        );

        if (payError) {
          console.error("Bar payments error:", payError);
        } else {
          (paymentsData || []).forEach((p: any) => {
            if (p.payment_status === "completed" && p.transaction_id) {
              const key = p.transaction_id as string;
              paymentsMap[key] = (paymentsMap[key] || 0) + Number(p.amount);
            }
          });
        }
      }

      const withPayments = data.map((o) => ({
        ...o,
        payments_total: paymentsMap[o.id] || 0,
      }));

      setOrders(withPayments);
    } finally {
      setLoading(false);
    }
  };

  const getElapsed = (time: string) => {
    const minutes = Math.floor((Date.now() - new Date(time).getTime()) / 60000);
    if (minutes < 1) return "< 1 min";
    if (minutes === 1) return "1 min";
    return `${minutes} mins`;
  };

  const renderStaffName = (order: BarOrder) =>
    order.created_by || "Unknown";

  const filteredOrders = useMemo(() => {
    if (!barDepartment) return orders;
    return orders
      .map((o) => {
        const barItems = (o.kitchen_order_items || []).filter((it) => it.products?.department_id === barDepartment.id);
        return { ...o, kitchen_order_items: barItems };
      })
      .filter((o) => (o.kitchen_order_items || []).length > 0);
  }, [orders, barDepartment]);

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 flex items-center gap-2">
              <Clock className="w-6 h-6 text-amber-600" />
              Bar Orders
            </h1>
            <PageNotes ariaLabel="Bar orders help">
              <p>Bar order queue for the department configured for this screen.</p>
            </PageNotes>
          </div>
          {barDepartment && (
            <p className="text-xs text-slate-500">
              Showing orders for department: <strong>{barDepartment.name}</strong>
            </p>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as DateRangeKey)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="last_30_days">Last 30 days</option>
            <option value="this_week">This Week</option>
            <option value="this_month">This Month</option>
            <option value="this_quarter">This Quarter</option>
            <option value="this_year">This Year</option>
            <option value="last_week">Last Week</option>
            <option value="last_month">Last Month</option>
            <option value="last_quarter">Last Quarter</option>
            <option value="last_year">Last Year</option>
            <option value="custom">Custom</option>
          </select>
          {dateRange === "custom" && (
            <div className="flex gap-2 items-center">
              <input
                type="date"
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
              <span className="text-slate-500 text-xs">to</span>
              <input
                type="date"
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-slate-500 text-sm">Loading bar orders...</p>
      ) : filteredOrders.length === 0 ? (
        <p className="text-slate-500 text-sm">No bar orders for this period.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredOrders.map((order) => (
            <div
              key={order.id}
              className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="font-semibold text-slate-900">
                    {order.customer_name || `Order #${order.id.slice(0, 6)}`}
                  </p>
                  <span className="text-xs text-slate-500">
                    {getElapsed(order.created_at)}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mb-1">
                  Table: {order.table_number || "POS"} • By:{" "}
                  {renderStaffName(order)}
                </p>
                <p className="text-xs text-slate-500 mb-2">
                  Status: <span className="font-semibold">{order.order_status}</span>
                </p>
                <div className="text-sm text-slate-700 space-y-1">
                  {orders.length > 0 &&
                    order.kitchen_order_items?.map((item, idx) => (
                      <p key={idx}>
                        {item.quantity} × {item.products?.name || "Item"}
                        {item.notes && (
                          <span className="text-xs text-red-500">
                            {" "}
                            ({item.notes})
                          </span>
                        )}
                      </p>
                    ))}
                </div>
                <div className="border-t pt-2 mt-2 text-xs text-slate-700">
                  {(() => {
                    const total = order.kitchen_order_items.reduce((sum, item) => {
                      const price = item.products?.sales_price ?? 0;
                      return sum + item.quantity * Number(price);
                    }, 0);
                    const paid = order.payments_total || 0;
                    const balance = total - paid;
                    return (
                      <>
                        <p>Total: {total.toFixed(2)}</p>
                        <p>Paid: ${paid.toFixed(2)}</p>
                        <p className="font-semibold">
                          Outstanding: {balance.toFixed(2)}
                        </p>
                      </>
                    );
                  })()}
                </div>
              </div>

              <div className="mt-3 flex gap-2">
                {order.order_status === "pending" ? (
                  <button
                    type="button"
                    onClick={() => {
                      const next = getNextOrderStatus(order.order_status, "bar");
                      if (next === "preparing") void updateStatus(order.id, next);
                    }}
                    disabled={updatingId === order.id}
                    className="flex-1 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 px-3 py-2 text-sm font-semibold hover:bg-blue-100 disabled:opacity-50"
                  >
                    {updatingId === order.id ? "…" : "Preparing"}
                  </button>
                ) : null}
                {order.order_status === "preparing" ? (
                  <button
                    type="button"
                    onClick={() => {
                      const next = getNextOrderStatus(order.order_status, "bar");
                      if (next === "ready") void updateStatus(order.id, next);
                    }}
                    disabled={updatingId === order.id}
                    className="flex-1 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 px-3 py-2 text-sm font-semibold hover:bg-emerald-100 disabled:opacity-50"
                  >
                    {updatingId === order.id ? "…" : "Ready"}
                  </button>
                ) : null}
                {order.order_status === "ready" ? (
                  <button
                    type="button"
                    onClick={() => {
                      const next = getNextOrderStatus(order.order_status, "bar");
                      if (next === "served") void updateStatus(order.id, next);
                    }}
                    disabled={updatingId === order.id}
                    className="flex-1 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 px-3 py-2 text-sm font-semibold hover:bg-slate-100 disabled:opacity-50"
                  >
                    {updatingId === order.id ? "…" : "Served"}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}