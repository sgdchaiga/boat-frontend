import { useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, ClipboardCheck, PackageMinus, Plus, RefreshCw, Settings2, Trash2 } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";
import { createJournalForStockAdjustment } from "../../lib/journal";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { PageNotes } from "../common/PageNotes";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";

type Product = { id: string; name: string; unit_of_measure: string | null; track_inventory: boolean | null };
type Rule = { id: string; product_id: string; quantity_per_cycle: number; cadence: "daily" | "weekly" | "monthly"; destination: string; note: string | null; active: boolean };
type Review = { id: string; period_start: string; period_end: string; status: "open" | "posted"; auto_consumption_source_id: string; variance_source_id: string | null; review_note: string | null; created_at: string };
type ReviewLine = { id: string; product_id: string; expected_quantity: number; actual_quantity: number | null; variance_quantity: number | null; products: { name: string; unit_of_measure: string | null } | null };

const isoToday = () => new Date().toISOString().slice(0, 10);
const startOfMonth = () => `${isoToday().slice(0, 8)}01`;
const qty = (value: number | null | undefined) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

export function SchoolScheduledConsumptionPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = Boolean(user?.isSuperAdmin);
  const [products, setProducts] = useState<Product[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [selectedReview, setSelectedReview] = useState<Review | null>(null);
  const [lines, setLines] = useState<ReviewLine[]>([]);
  const [actuals, setActuals] = useState<Record<string, string>>({});
  const [periodStart, setPeriodStart] = useState(startOfMonth);
  const [periodEnd, setPeriodEnd] = useState(isoToday);
  const [ruleProductId, setRuleProductId] = useState("");
  const [ruleQuantity, setRuleQuantity] = useState("");
  const [ruleCadence, setRuleCadence] = useState<Rule["cadence"]>("weekly");
  const [ruleDestination, setRuleDestination] = useState("Kitchen");
  const [ruleNote, setRuleNote] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);

  const loadLines = async (review: Review | null) => {
    if (!review) { setLines([]); setActuals({}); return; }
    const { data, error } = await supabase
      .from("school_inventory_consumption_review_lines")
      .select("id,product_id,expected_quantity,actual_quantity,variance_quantity,products(name,unit_of_measure)")
      .eq("review_id", review.id)
      .order("created_at");
    if (error) { setMessage(error.message); return; }
    const next = (data || []) as unknown as ReviewLine[];
    setLines(next);
    setActuals(Object.fromEntries(next.map((line) => [line.id, line.actual_quantity == null ? "" : String(line.actual_quantity)])));
    setReviewNote(review.review_note || "");
  };

  const load = async (keepSelectedId?: string | null) => {
    if (!orgId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [productsResult, rulesResult, reviewsResult] = await Promise.all([
        filterByOrganizationId(
          supabase.from("products").select("id,name,unit_of_measure,track_inventory").order("name"),
          orgId,
          superAdmin,
        ),
        supabase.from("school_inventory_consumption_rules").select("id,product_id,quantity_per_cycle,cadence,destination,note,active").eq("organization_id", orgId).order("created_at", { ascending: false }),
        supabase.from("school_inventory_consumption_reviews").select("id,period_start,period_end,status,auto_consumption_source_id,variance_source_id,review_note,created_at").eq("organization_id", orgId).order("period_end", { ascending: false }).limit(24),
      ]);
      if (productsResult.error) throw productsResult.error;
      if (rulesResult.error) throw rulesResult.error;
      if (reviewsResult.error) throw reviewsResult.error;
      const nextReviews = (reviewsResult.data || []) as Review[];
      setProducts((productsResult.data || []) as Product[]);
      setRules((rulesResult.data || []) as Rule[]);
      setReviews(nextReviews);
      const nextSelected = nextReviews.find((review) => review.id === (keepSelectedId ?? selectedReview?.id)) || nextReviews.find((review) => review.status === "open") || nextReviews[0] || null;
      setSelectedReview(nextSelected);
      await loadLines(nextSelected);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load scheduled consumption.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [orgId, superAdmin]);

  const saveRule = async () => {
    const quantity = Number(ruleQuantity);
    if (!orgId || !ruleProductId || !Number.isFinite(quantity) || quantity <= 0) {
      setMessage("Choose a stock item and a quantity greater than zero.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("school_inventory_consumption_rules").upsert({
        organization_id: orgId, product_id: ruleProductId, quantity_per_cycle: quantity, cadence: ruleCadence,
        destination: ruleDestination.trim() || "Kitchen", note: ruleNote.trim() || null, created_by: user?.id ?? null,
      }, { onConflict: "organization_id,product_id,cadence,destination" });
      if (error) throw error;
      setRuleProductId(""); setRuleQuantity(""); setRuleNote("");
      setMessage("Consumption rate saved. Enter the same item, cadence and destination again to update its rate.");
      await load(selectedReview?.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save this rate.");
    } finally { setSaving(false); }
  };

  const setRuleActive = async (rule: Rule, active: boolean) => {
    const { error } = await supabase.from("school_inventory_consumption_rules").update({ active }).eq("id", rule.id);
    if (error) setMessage(error.message); else await load(selectedReview?.id);
  };

  const deleteRule = async (rule: Rule) => {
    if (!confirm(`Remove the scheduled rate for ${productById.get(rule.product_id)?.name || "this item"}? Past period reviews will remain.`)) return;
    const { error } = await supabase.from("school_inventory_consumption_rules").delete().eq("id", rule.id);
    if (error) setMessage(error.message); else { setMessage("Consumption rate removed."); await load(selectedReview?.id); }
  };

  const createReview = async () => {
    if (!periodStart || !periodEnd || periodEnd < periodStart) { setMessage("Choose a valid consumption period."); return; }
    const activeRules = rules.filter((rule) => rule.active);
    if (activeRules.length === 0) { setMessage("Add at least one active consumption rate before creating a period review."); return; }
    setSaving(true);
    try {
      const { data: reviewId, error } = await supabase.rpc("create_school_inventory_consumption_review", { p_period_start: periodStart, p_period_end: periodEnd });
      if (error) throw error;
      const { data: review, error: reviewError } = await supabase
        .from("school_inventory_consumption_reviews")
        .select("id,period_start,period_end,status,auto_consumption_source_id,variance_source_id,review_note,created_at")
        .eq("id", reviewId).single();
      if (reviewError) throw reviewError;
      const journal = await createJournalForStockAdjustment((review as Review).auto_consumption_source_id, user?.id ?? null, { organizationId: orgId });
      setMessage(journal.ok ? "System consumption posted. Enter actual use when the period is counted." : `System consumption posted, but its journal needs attention: ${journal.error}`);
      await load(String(reviewId));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create the consumption review.");
    } finally { setSaving(false); }
  };

  const finalizeReview = async () => {
    if (!selectedReview) return;
    const payload = lines.map((line) => ({ line_id: line.id, actual_quantity: actuals[line.id] }));
    if (payload.some((line) => line.actual_quantity === "" || !Number.isFinite(Number(line.actual_quantity)) || Number(line.actual_quantity) < 0)) {
      setMessage("Enter a non-negative actual quantity for every item before posting the adjustment.");
      return;
    }
    setSaving(true);
    try {
      const { data: sourceId, error } = await supabase.rpc("finalize_school_inventory_consumption_review", {
        p_review_id: selectedReview.id, p_actuals: payload, p_note: reviewNote,
      });
      if (error) throw error;
      const journal = await createJournalForStockAdjustment(String(sourceId), user?.id ?? null, { organizationId: orgId });
      setMessage(journal.ok ? "Actual consumption reviewed and variance adjustment posted." : `Variance stock adjustment posted, but its journal needs attention: ${journal.error}`);
      await load(selectedReview.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not post the actual-use adjustment.");
    } finally { setSaving(false); }
  };

  return <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
    {readOnly && <ReadOnlyNotice />}
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><div className="flex items-center gap-2"><PackageMinus className="h-7 w-7 text-emerald-700" /><h1 className="text-3xl font-bold text-slate-900">Scheduled store consumption</h1><PageNotes ariaLabel="Scheduled store consumption guide" variant="guide" triggerLabel="Guide"><p className="font-semibold text-slate-900">How it works</p><ol className="list-decimal space-y-1 pl-4"><li>Set an expected daily, weekly or monthly rate for each store item.</li><li>Create a weekly or monthly period. BOAT posts the expected use as a stock movement and journal.</li><li>At period end, enter the actual quantity used or counted.</li><li>Post the variance. It is saved separately, so expected use, actual use and the adjustment remain auditable.</li></ol><p>Weekly and monthly rates are apportioned across the chosen period (weekly ÷ 7 days; monthly ÷ 30.4375 days).</p></PageNotes></div><p className="mt-1 text-sm text-slate-600">Post expected kitchen/store use on a schedule, then compare it with actual usage at the end of the period.</p></div>
      <button type="button" onClick={() => void load(selectedReview?.id)} className="app-btn-secondary"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
    </div>
    {message && <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">{message}</div>}

    <section className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-5"><div className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-emerald-700" /><div><h2 className="font-semibold text-slate-900">Start a consumption period</h2><p className="text-xs text-slate-600">This posts expected use once for the selected dates. Do not create the same period twice.</p></div></div><div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]"><label className="text-xs font-medium text-slate-700">Period start<input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label><label className="text-xs font-medium text-slate-700">Period end<input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" /></label><button type="button" disabled={readOnly || saving || loading} onClick={() => void createReview()} className="app-btn-primary self-end"><PackageMinus className="h-4 w-4" /> Post system consumption</button></div></section>

    <section className="rounded-xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><Settings2 className="h-5 w-5 text-slate-700" /><div><h2 className="font-semibold text-slate-900">Expected consumption rates</h2><p className="text-xs text-slate-500">For example: maize flour, 200 kg every week to Kitchen. The item’s own purchases / cost account is debited in profit and loss.</p></div></div><div className="mt-4 grid gap-3 lg:grid-cols-[2fr_1fr_1fr_2fr_auto]"><select value={ruleProductId} onChange={(event) => setRuleProductId(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">Choose stock item</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}{product.unit_of_measure ? ` (${product.unit_of_measure})` : ""}</option>)}</select><input type="number" min="0" step="0.001" value={ruleQuantity} onChange={(event) => setRuleQuantity(event.target.value)} placeholder="Quantity" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><select value={ruleCadence} onChange={(event) => setRuleCadence(event.target.value as Rule["cadence"])} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="daily">Per day</option><option value="weekly">Per week</option><option value="monthly">Per month</option></select><input value={ruleDestination} onChange={(event) => setRuleDestination(event.target.value)} placeholder="Destination" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><button type="button" disabled={readOnly || saving} onClick={() => void saveRule()} className="app-btn-secondary"><Plus className="h-4 w-4" /> Add rate</button></div><input value={ruleNote} onChange={(event) => setRuleNote(event.target.value)} placeholder="Optional note, e.g. boarding term menu" className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[700px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="p-3">Item</th><th className="p-3">Rate</th><th className="p-3">Destination</th><th className="p-3">Status</th><th className="p-3" /></tr></thead><tbody className="divide-y divide-slate-100">{rules.map((rule) => <tr key={rule.id}><td className="p-3 font-medium text-slate-900">{productById.get(rule.product_id)?.name || "Stock item removed"}<span className="block text-xs font-normal text-slate-500">{rule.note || "No note"}</span></td><td className="p-3">{qty(rule.quantity_per_cycle)} {productById.get(rule.product_id)?.unit_of_measure || "units"} / {rule.cadence.replace("ly", "")}</td><td className="p-3">{rule.destination}</td><td className="p-3"><button type="button" disabled={readOnly} onClick={() => void setRuleActive(rule, !rule.active)} className={`rounded-full px-2 py-1 text-xs font-semibold ${rule.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{rule.active ? "Active" : "Paused"}</button></td><td className="p-3 text-right"><button type="button" disabled={readOnly} onClick={() => void deleteRule(rule)} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-4 w-4" /></button></td></tr>)}{rules.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-slate-500">No consumption rates yet.</td></tr>}</tbody></table></div></section>

    <section className="rounded-xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-indigo-700" /><h2 className="font-semibold text-slate-900">Period review and actual-use adjustment</h2></div><p className="mt-1 text-xs text-slate-500">Expected consumption is already posted. Enter actual quantities to post only the difference.</p></div><select value={selectedReview?.id || ""} onChange={(event) => { const review = reviews.find((candidate) => candidate.id === event.target.value) || null; setSelectedReview(review); void loadLines(review); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">Choose period review</option>{reviews.map((review) => <option key={review.id} value={review.id}>{review.period_start} to {review.period_end} · {review.status === "posted" ? "Reviewed" : "Awaiting actuals"}</option>)}</select></div>
      {selectedReview ? <><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[700px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="p-3">Item</th><th className="p-3 text-right">System consumption</th><th className="p-3 text-right">Actual consumption</th><th className="p-3 text-right">Variance</th></tr></thead><tbody className="divide-y divide-slate-100">{lines.map((line) => { const actual = Number(actuals[line.id]); const variance = Number.isFinite(actual) ? actual - Number(line.expected_quantity) : null; return <tr key={line.id}><td className="p-3 font-medium text-slate-900">{line.products?.name || "Stock item"}<span className="ml-1 text-xs font-normal text-slate-500">{line.products?.unit_of_measure || "units"}</span></td><td className="p-3 text-right tabular-nums">{qty(line.expected_quantity)}</td><td className="p-3 text-right">{selectedReview.status === "open" ? <input type="number" min="0" step="0.001" value={actuals[line.id] || ""} onChange={(event) => setActuals((current) => ({ ...current, [line.id]: event.target.value }))} className="w-32 rounded border border-slate-300 px-2 py-1.5 text-right" /> : qty(line.actual_quantity)}</td><td className={`p-3 text-right font-semibold tabular-nums ${variance == null || Math.abs(variance) < 0.0005 ? "text-slate-500" : variance > 0 ? "text-rose-700" : "text-emerald-700"}`}>{selectedReview.status === "open" ? (variance == null ? "Enter actual" : `${variance > 0 ? "+" : ""}${qty(variance)}`) : `${Number(line.variance_quantity || 0) > 0 ? "+" : ""}${qty(line.variance_quantity)}`}</td></tr>; })}{lines.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-slate-500">No active stock rules were available when this period was created.</td></tr>}</tbody></table></div>{selectedReview.status === "open" && <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><label className="min-w-64 flex-1 text-xs font-medium text-amber-900">Review note (optional)<input value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Reason for variance or count reference" className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-slate-900" /></label><button type="button" disabled={readOnly || saving || lines.length === 0} onClick={() => void finalizeReview()} className="app-btn-primary"><CheckCircle2 className="h-4 w-4" /> Post actual-use adjustment</button></div>}</> : <p className="mt-6 rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-500">Create a consumption period, then select it here to review actual use.</p>}</section>
  </div>;
}
