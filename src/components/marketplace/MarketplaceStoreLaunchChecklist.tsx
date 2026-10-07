import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Circle, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";

const db = supabase as any;

type LaunchChecklistProps = {
  organizationId: string;
  merchantId: string;
  profilePublished: boolean;
  publishedListings: number;
  inventoryProducts: number;
  canConfigurePayments: boolean;
};

export function MarketplaceStoreLaunchChecklist({
  organizationId,
  merchantId,
  profilePublished,
  publishedListings,
  inventoryProducts,
  canConfigurePayments,
}: LaunchChecklistProps) {
  const [manualMomoReady, setManualMomoReady] = useState<boolean | null>(canConfigurePayments ? null : false);
  const [completedTestOrder, setCompletedTestOrder] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setMessage(null);
    const testOrderQuery = db.from("marketplace_orders")
      .select("id")
      .eq("merchant_id", merchantId)
      .in("status", ["paid", "fulfilled"])
      .limit(1)
      .maybeSingle();
    const momoQuery = canConfigurePayments
      ? db.from("marketplace_manual_momo_settings").select("is_active,recipient_name,recipient_phone").eq("organization_id", organizationId).maybeSingle()
      : Promise.resolve({ data: null, error: null });
    const [testOrderRes, momoRes] = await Promise.all([testOrderQuery, momoQuery]);
    setLoading(false);
    if (testOrderRes.error || momoRes.error) {
      setMessage((testOrderRes.error || momoRes.error).message);
      return;
    }
    setCompletedTestOrder(Boolean(testOrderRes.data));
    if (canConfigurePayments) {
      setManualMomoReady(Boolean(momoRes.data?.is_active && momoRes.data?.recipient_name?.trim() && momoRes.data?.recipient_phone?.trim()));
    }
  }, [canConfigurePayments, merchantId, organizationId]);

  useEffect(() => { void load(); }, [load]);

  const tasks = useMemo(() => [
    { label: "BOAT Market is authorised for this organisation", complete: true, detail: "The Market and My market sales pages are available." },
    { label: "Publish the public business profile", complete: profilePublished, detail: "Add the store name, link, description, phone, then tick Publish merchant profile." },
    { label: "Publish at least one product", complete: publishedListings > 0, detail: inventoryProducts > 0 ? `${publishedListings} storefront listing${publishedListings === 1 ? " is" : "s are"} published; ${inventoryProducts} active BOAT inventory product${inventoryProducts === 1 ? " is" : "s are"} available to add.` : "Create active, saleable BOAT products first." },
    { label: "Configure manual Mobile Money", complete: manualMomoReady === true, detail: canConfigurePayments ? "An administrator must enter and activate the receiving MoMo details below." : "Ask an organisation administrator to configure and activate the receiving MoMo details." },
    { label: "Complete one paid test order", complete: completedTestOrder === true, detail: "Use a small test purchase, submit proof, verify it, then confirm fulfilment." },
  ], [canConfigurePayments, completedTestOrder, inventoryProducts, manualMomoReady, profilePublished, publishedListings]);
  const completeCount = tasks.filter((task) => task.complete).length;

  return <section className="mt-5 rounded-xl border border-indigo-200 bg-white p-4 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-900">Store launch checklist</h3><p className="mt-1 text-sm text-slate-600">{completeCount} of {tasks.length} launch steps complete for this organisation.</p></div><button type="button" onClick={() => void load()} disabled={loading} className="app-btn-secondary"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button></div>
    {message && <p className="mt-3 text-sm text-rose-700" role="status">{message}</p>}
    <div className="mt-4 space-y-3">{tasks.map((task) => <div key={task.label} className={`flex gap-3 rounded-lg border p-3 ${task.complete ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200"}`}>{task.complete ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />}<div><p className="text-sm font-medium text-slate-900">{task.label}</p><p className="mt-0.5 text-xs text-slate-600">{task.detail}</p></div></div>)}</div>
    {completeCount === tasks.length && <p className="mt-4 rounded-lg bg-emerald-100 px-3 py-2 text-sm font-medium text-emerald-900">This store has completed the BOAT Market launch checks.</p>}
  </section>;
}
