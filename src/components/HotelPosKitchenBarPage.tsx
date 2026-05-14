import { useCallback, useEffect, useState } from "react";
import { KitchenDisplayPage } from "./KitchenDisplayPage";
import { BarOrdersPage } from "./BarOrdersPage";
import { KitchenOrdersPage } from "./KitchenOrdersPage";
import { SaunaOrdersPage } from "./SaunaOrdersPage";
import { useAuth } from "../contexts/AuthContext";
import { loadHotelConfig } from "../lib/hotelConfig";
import { resolvePosSaunaDepartment } from "../lib/resolvePosSaunaDepartment";

type KitchenBarTab = "kitchen" | "bar" | "sauna" | "kitchen_orders";

export function HotelPosKitchenBarPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [tab, setTab] = useState<KitchenBarTab>("kitchen");
  const [saunaCounterTabLabel, setSaunaCounterTabLabel] = useState("Sauna Orders");

  const refreshSaunaCounterTabLabel = useCallback(async () => {
    if (!orgId) {
      setSaunaCounterTabLabel("Sauna Orders");
      return;
    }
    const cfg = loadHotelConfig(orgId);
    const dept = await resolvePosSaunaDepartment(orgId, superAdmin, cfg.pos_sauna_department_id);
    setSaunaCounterTabLabel(dept ? `${dept.name} Orders` : "Sauna Orders");
  }, [orgId, superAdmin]);

  useEffect(() => {
    void refreshSaunaCounterTabLabel();
  }, [refreshSaunaCounterTabLabel]);

  useEffect(() => {
    const fn = () => void refreshSaunaCounterTabLabel();
    window.addEventListener("focus", fn);
    return () => window.removeEventListener("focus", fn);
  }, [refreshSaunaCounterTabLabel]);

  return (
    <div className="space-y-4">
      <div className="px-6 pt-6 md:px-8">
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900">POS Orders</h1>
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
            onClick={() => setTab("sauna")}
            className={`px-3 py-1.5 text-sm rounded ${tab === "sauna" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}
          >
            {saunaCounterTabLabel}
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
      {tab === "sauna" ? <SaunaOrdersPage /> : null}
      {tab === "kitchen_orders" ? <KitchenOrdersPage /> : null}
    </div>
  );
}
