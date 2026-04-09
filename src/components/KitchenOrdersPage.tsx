import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { Database } from "../lib/database.types";
import { computeRangeInTimezone, type DateRangeKey } from "../lib/timezone";
import { useAuth } from "../contexts/AuthContext";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";
import { PageNotes } from "./common/PageNotes";

type Department = Database["public"]["Tables"]["departments"]["Row"];

/** Hide bar / room-service lines from the Kitchen queue (shared `kitchen_orders` table). */
function excludeLineFromKitchenQueue(deptName: string | null | undefined): boolean {
  const n = (deptName || "").toLowerCase();
  if (/\broom\b/.test(n) || n.includes("room service")) return true;
  if (/\bbar\b/.test(n)) return true;
  return false;
}

interface KitchenItem {
  quantity: number;
  notes?: string;
  products: { name: string; department_id: string | null; sales_price?: number | null };
}

interface KitchenOrder {
  id: string;
  room_id?: string | null;
  table_number?: string | null;
  customer_name?: string | null;
  order_status: string;
  created_at: string;
  kitchen_order_items: KitchenItem[];
  payments_total?: number;
}

export function KitchenOrdersPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [kitchenDepartments, setKitchenDepartments] = useState<Department[]>([]);

  const [dateRange, setDateRange] = useState<DateRangeKey>("last_30_days");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  useEffect(() => {
    fetchOrders();
  }, [dateRange, customFrom, customTo]);

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
            room_id,
            table_number,
            customer_name,
            order_status,
            created_at,
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
        console.error("Kitchen departments error:", departmentsRes.error);
      }
      if (ordersRes.error) {
        console.error("Kitchen orders error:", ordersRes.error);
        setLoading(false);
        return;
      }

      const departments = (departmentsRes.data || []) as Department[];
      const deptNameById = Object.fromEntries(departments.map((d) => [d.id, d.name]));
      const productMap = Object.fromEntries(
        ((productsRes?.data || []) as { id: string; name: string; department_id: string | null; sales_price: number | null }[])
          .map((p) => [p.id, p])
      );
      const kitchenDeps = departments.filter((d) => {
        const n = d.name.toLowerCase();
        return n.includes("kitchen") || n.includes("restaurant") || n.includes("food");
      });
      setKitchenDepartments(kitchenDeps);

      const rawOrders = (ordersRes.data || []) as any[];
      const data = (rawOrders
        .map((o) => {
          const items = (o.kitchen_order_items || []).map((i: any) => {
            const prod =
              i.product_id && productMap[i.product_id]
                ? productMap[i.product_id]
                : ({ name: "Item", department_id: null, sales_price: 0 } as {
                    name: string;
                    department_id: string | null;
                    sales_price: number | null;
                  });
            const deptName = prod.department_id ? deptNameById[prod.department_id] ?? null : null;
            return {
              ...i,
              products: {
                name: prod.name,
                department_id: prod.department_id,
                sales_price: prod.sales_price,
              },
              _deptName: deptName,
            };
          });
          const filteredItems = items.filter((i: { _deptName: string | null }) => !excludeLineFromKitchenQueue(i._deptName));
          const kitchen_order_items = filteredItems.map(({ _deptName, ...rest }: { _deptName: string | null; [k: string]: unknown }) => rest);
          return { ...o, kitchen_order_items };
        })
        .filter((o) => o.kitchen_order_items.length > 0) as KitchenOrder[]);

      const orderIds = data.map((o) => o.id);
      let paymentsMap: Record<string, number> = {};
      if (orderIds.length > 0) {
        const { data: paymentsData, error: payError } = await filterByOrganizationId(
          supabase.from("payments").select("amount, payment_status, transaction_id").in("transaction_id", orderIds),
          orgId,
          superAdmin
        );

        if (payError) {
          console.error("Kitchen payments error:", payError);
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
    const minutes =
      Math.floor((Date.now() - new Date(time).getTime()) / 60000);
    if (minutes < 1) return "< 1 min";
    if (minutes === 1) return "1 min";
    return `${minutes} mins`;
  };

  return (
    <div className="p-6 bg-slate-50 min-h-screen">
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">Kitchen Orders</h1>
            <PageNotes ariaLabel="Kitchen orders help">
              <p>Live kitchen order queue for configured departments.</p>
            </PageNotes>
          </div>
          {kitchenDepartments.length > 0 && (
            <p className="text-xs text-slate-500 mt-1">
              Departments:{" "}
              {kitchenDepartments.map((d) => d.name).join(", ")}
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
        <p className="text-slate-500 text-sm">Loading kitchen orders...</p>
      ) : orders.length === 0 ? (
        <p className="text-slate-500 text-sm">No kitchen orders for this period.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {orders.map((order) => (
            <div
              key={order.id}
              className="bg-white rounded-xl shadow p-4 border"
            >
              <div className="flex justify-between mb-3">
                <div className="font-bold text-lg">
                  {order.customer_name
                    ? order.customer_name
                    : order.room_id
                    ? `Room ${order.room_id}`
                    : `Table ${order.table_number || "POS"}`}
                </div>
                <div className="flex items-center gap-1 text-sm text-gray-500">
                  <Clock size={16} />
                  {getElapsed(order.created_at)}
                </div>
              </div>

              <div className="space-y-2 mb-4">
                {order.kitchen_order_items.map((item, i) => (
                  <div key={i}>
                    <p className="font-medium">
                      {item.quantity} × {item.products.name}
                    </p>
                    {item.notes && (
                      <p className="text-xs text-red-500">
                        {item.notes}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              <div className="border-t pt-2 mt-2 text-sm text-gray-700">
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
                      <p>Paid: {paid.toFixed(2)}</p>
                      <p className="font-semibold">
                        Outstanding: {balance.toFixed(2)}
                      </p>
                    </>
                  );
                })()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}