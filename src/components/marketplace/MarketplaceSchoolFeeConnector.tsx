import { useCallback, useEffect, useMemo, useState } from "react";
import { Globe2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

const db = supabase as any;
type FeeLine = { amount?: number | string };
type FeeStructure = { id: string; class_name: string; stream: string | null; academic_year: string; term_name: string; currency: string; line_items: FeeLine[] | null; is_active: boolean };

const total = (fee: FeeStructure) => (fee.line_items || []).reduce((sum, line) => sum + Math.max(0, Number(line.amount) || 0), 0);
const title = (fee: FeeStructure) => [fee.class_name, fee.stream, "school fees", "—", fee.academic_year, fee.term_name].filter(Boolean).join(" ");

export function MarketplaceSchoolFeeConnector({ merchantId, organizationId }: { merchantId: string; organizationId: string }) {
  const [fees, setFees] = useState<FeeStructure[]>([]);
  const [publishedIds, setPublishedIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [feeRes, listingRes] = await Promise.all([
      db.from("fee_structures").select("id,class_name,stream,academic_year,term_name,currency,line_items,is_active").eq("organization_id", organizationId).eq("is_active", true).order("academic_year", { ascending: false }),
      db.from("marketplace_listings").select("source_record_id").eq("merchant_id", merchantId).eq("source_module", "school_fee_structure"),
    ]);
    if (feeRes.error || listingRes.error) { setMessage((feeRes.error || listingRes.error).message); return; }
    setFees((feeRes.data || []) as FeeStructure[]);
    setPublishedIds(new Set(((listingRes.data || []) as Array<{ source_record_id: string | null }>).map((row) => row.source_record_id).filter((id): id is string => Boolean(id))));
  }, [merchantId, organizationId]);

  useEffect(() => { void load(); }, [load]);

  const publish = async (fee: FeeStructure) => {
    setBusyId(fee.id); setMessage(null);
    const existing = await db.from("marketplace_listings").select("id").eq("merchant_id", merchantId).eq("source_module", "school_fee_structure").eq("source_record_id", fee.id).maybeSingle();
    if (existing.error) { setBusyId(null); setMessage(existing.error.message); return; }
    const payload = {
      organization_id: organizationId,
      merchant_id: merchantId,
      title: title(fee),
      description: "School fee payment request. Provide the student admission or SchoolPay number so the school can allocate the payment.",
      listing_type: "school_item",
      source_module: "school_fee_structure",
      source_record_id: fee.id,
      currency: fee.currency || "UGX",
      price: total(fee),
      is_published: true,
    };
    const result = existing.data
      ? await db.from("marketplace_listings").update(payload).eq("id", existing.data.id)
      : await db.from("marketplace_listings").insert(payload);
    setBusyId(null);
    if (result.error) { setMessage(result.error.message); return; }
    setMessage(`${title(fee)} is now a marketplace payment request.`);
    await load();
  };

  const publishedCount = useMemo(() => fees.filter((fee) => publishedIds.has(fee.id)).length, [fees, publishedIds]);

  return <section className="mt-6 border-t border-indigo-200 pt-5"><div className="flex items-start gap-2"><Globe2 className="mt-0.5 h-5 w-5 text-indigo-700" /><div><h3 className="font-semibold text-slate-900">School fee payment requests</h3><p className="mt-1 text-sm text-slate-600">Publish an active fee structure without re-entering its term amount. A payment request is not allocated to a student automatically; match the learner by admission or SchoolPay number in BOAT before recording the school-fee receipt.</p></div></div>{message && <p className="mt-3 text-sm text-slate-700" role="status">{message}</p>}<p className="mt-3 text-xs text-slate-500">{publishedCount} of {fees.length} active fee structures published.</p><div className="mt-3 divide-y rounded-lg border border-slate-200 bg-white">{fees.map((fee) => <div key={fee.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"><div><p className="font-medium text-slate-900">{title(fee)}</p><p className="text-xs text-slate-500">{fee.currency || "UGX"} {total(fee).toLocaleString()} · {publishedIds.has(fee.id) ? "Published" : "Not published"}</p></div><button type="button" onClick={() => void publish(fee)} disabled={busyId === fee.id} className="app-btn-secondary">{busyId === fee.id ? "Publishing…" : publishedIds.has(fee.id) ? "Refresh listing" : "Publish request"}</button></div>)}{fees.length === 0 && <p className="p-3 text-sm text-slate-500">No active school fee structures are available to publish.</p>}</div></section>;
}
