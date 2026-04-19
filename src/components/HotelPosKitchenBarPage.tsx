import { useState } from "react";
import { KitchenDisplayPage } from "./KitchenDisplayPage";
import { BarOrdersPage } from "./BarOrdersPage";
import { KitchenOrdersPage } from "./KitchenOrdersPage";

type KitchenBarTab = "kitchen" | "bar" | "kitchen_orders";

export function HotelPosKitchenBarPage() {
  const [tab, setTab] = useState<KitchenBarTab>("kitchen");

  return (
    <div className="space-y-4">
      <div className="px-6 pt-6 md:px-8">
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Kitchen/Bar Screen</h1>
        <p className="text-sm text-slate-600 mt-1">Order queue, status updates, and near real-time refresh for service stations.</p>
        <div className="mt-3 inline-flex rounded-lg border border-slate-300 bg-white p-1 gap-1">
          <button
            type="button"
            onClick={() => setTab("kitchen")}
            className={`px-3 py-1.5 text-sm rounded ${tab === "kitchen" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}
          >
            Kitchen Display
          </button>
          <button
            type="button"
            onClick={() => setTab("bar")}
            className={`px-3 py-1.5 text-sm rounded ${tab === "bar" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}
          >
            Bar Orders
          </button>
          <button
            type="button"
            onClick={() => setTab("kitchen_orders")}
            className={`px-3 py-1.5 text-sm rounded ${tab === "kitchen_orders" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}
          >
            Kitchen Orders
          </button>
        </div>
      </div>
      {tab === "kitchen" ? <KitchenDisplayPage /> : null}
      {tab === "bar" ? <BarOrdersPage /> : null}
      {tab === "kitchen_orders" ? <KitchenOrdersPage /> : null}
    </div>
  );
}
