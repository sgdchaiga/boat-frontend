import { useCallback, useEffect, useMemo, useState } from "react";
import { ReceiptText, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";

const db = supabase as any;

type CommissionRecord = {
  id: string;
  gross_amount: number;
  commission_amount: number;
  currency: string;
  status: string;
  recorded_at: string;
  marketplace_orders: { order_number: string } | { order_number: string }[] | null;
};

const money = (amount: number, currency = "UGX") => `${currency} ${Number(amount || 0).toLocaleString()}`;

export function MarketplaceCommissionRegister({ merchantId }: { merchantId: string }) {
  const [records, setRecords] = useState<CommissionRecord[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await db.from("marketplace_commission_records")
      .select("id,gross_amount,commission_amount,currency,status,recorded_at,marketplace_orders(order_number)")
      .eq("merchant_id", merchantId)
      .order("recorded_at", { ascending: false })
      .limit(50);
    setLoading(false);
    if (result.error) {
      setMessage(result.error.message);
      return;
    }
    setRecords((result.data || []) as CommissionRecord[]);
  }, [merchantId]);

  useEffect(() => { void load(); }, [load]);

  const total = useMemo(() => records.filter((record) => record.status === "earned").reduce((sum, record) => sum + Number(record.commission_amount || 0), 0), [records]);
  const currency = records[0]?.currency || "UGX";

  return <section className="mt-6 border-t border-indigo-200 pt-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><ReceiptText className="h-5 w-5 text-indigo-700" /><div><h3 className="font-semibold text-slate-900">Verified commission register</h3><p className="mt-1 text-sm text-slate-600">Commission is recorded only after a manual MoMo transaction is approved.</p></div></div><button type="button" onClick={() => void load()} disabled={loading} className="app-btn-secondary"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button></div>
    {message && <p className="mt-3 text-sm text-slate-700" role="status">{message}</p>}
    <div className="mt-3 rounded-lg border border-slate-200 bg-white p-4"><p className="text-sm text-slate-600">Verified commission total</p><p className="mt-1 text-xl font-semibold text-slate-900">{money(total, currency)}</p><div className="mt-4 space-y-2">{records.map((record) => { const order = Array.isArray(record.marketplace_orders) ? record.marketplace_orders[0] : record.marketplace_orders; return <div key={record.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-2 text-sm"><span>{order?.order_number || "Marketplace order"} · {new Date(record.recorded_at).toLocaleString()}</span><span className="font-medium">{money(record.commission_amount, record.currency)}</span></div>; })}{!loading && records.length === 0 && <p className="text-sm text-slate-500">No verified marketplace commissions yet.</p>}</div></div>
  </section>;
}
