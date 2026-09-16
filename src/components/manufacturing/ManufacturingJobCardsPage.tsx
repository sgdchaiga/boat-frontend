import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { fetchAllPages } from "../../lib/supabasePagination";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";

type JobStatus = "Pending" | "In Progress" | "Completed" | "Blocked";
type JobCard = {
  id: string; organization_id: string; work_order_id: string; sequence_no: number;
  operation_name: string; work_center_id: string | null; planned_minutes: number;
  actual_minutes: number; status: JobStatus; instructions: string | null;
  block_reason: string | null; started_at: string | null; completed_at: string | null; updated_at: string;
};
type Order = { id: string; product_name: string };
type Center = { id: string; name: string };
const messageOf = (error: unknown) => error && typeof error === "object" && "message" in error ? String(error.message) : "Could not save or load job cards.";
const field = "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100";

export function ManufacturingJobCardsPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!user?.isSuperAdmin;
  const [cards, setCards] = useState<JobCard[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [centers, setCenters] = useState<Center[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [actual, setActual] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [statusFilter, setStatusFilter] = useState("active");
  const [centerFilter, setCenterFilter] = useState("");
  const [orderFilter, setOrderFilter] = useState("");
  const request = useRef(0);
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    const generation = ++request.current;
    setLoading(true); setError("");
    try {
      const [nextCards, nextOrders, nextCenters] = await Promise.all([
        fetchAllPages<JobCard>((from, to) => filterByOrganizationId(supabase.from("manufacturing_job_cards")
          .select("id,organization_id,work_order_id,sequence_no,operation_name,work_center_id,planned_minutes,actual_minutes,status,instructions,block_reason,started_at,completed_at,updated_at")
          .order("created_at", { ascending: false }).order("id").range(from, to), orgId, superAdmin)),
        fetchAllPages<Order>((from, to) => filterByOrganizationId(supabase.from("manufacturing_work_orders")
          .select("id,product_name").order("id").range(from, to), orgId, superAdmin)),
        fetchAllPages<Center>((from, to) => filterByOrganizationId(supabase.from("manufacturing_work_centers")
          .select("id,name").order("id").range(from, to), orgId, superAdmin)),
      ]);
      if (generation !== request.current) return;
      setCards(nextCards); setOrders(nextOrders); setCenters(nextCenters);
      setActual(Object.fromEntries(nextCards.map((card) => [card.id, String(card.actual_minutes)])));
      setReasons(Object.fromEntries(nextCards.map((card) => [card.id, card.block_reason || ""])));
    } catch (e) {
      if (generation === request.current) { setCards([]); setError(messageOf(e)); }
    } finally {
      if (generation === request.current) setLoading(false);
    }
  }, [orgId, superAdmin]);

  useEffect(() => {
    setCards([]); setOrders([]); setCenters([]); setOrderFilter(""); setCenterFilter(""); setNotice("");
    void load();
    return () => { request.current++; };
  }, [load]);

  const save = async (card: JobCard, status: JobStatus) => {
    if (readOnly || savingRef.current) return;
    const minutes = Number(actual[card.id]);
    if (!Number.isFinite(minutes) || minutes < 0 || !actual[card.id]?.trim()) {
      setError("Enter a valid actual time of zero or more minutes."); return;
    }
    const reason = reasons[card.id]?.trim() || "";
    if (status === "Blocked" && !reason) { setError("Enter a reason before blocking this job."); return; }
    savingRef.current = true; setSaving(card.id); setError(""); setNotice("");
    try {
      const { data, error: updateError } = await supabase.from("manufacturing_job_cards")
        .update({ status, actual_minutes: minutes, block_reason: reason || null })
        .eq("id", card.id).eq("organization_id", card.organization_id)
        .eq("updated_at", card.updated_at).select("id");
      if (updateError) throw updateError;
      if (!data?.length) throw new Error("This job changed or is no longer available. Refresh the list before saving again.");
      setNotice(card.operation_name + ": " + (status === card.status ? "time saved" : status.toLowerCase()) + ".");
      await load();
    } catch (e) { setError(messageOf(e)); }
    finally { savingRef.current = false; setSaving(null); }
  };

  const orderNames = useMemo(() => new Map(orders.map((order) => [order.id, order.product_name])), [orders]);
  const centerNames = useMemo(() => new Map(centers.map((center) => [center.id, center.name])), [centers]);
  const visible = cards.filter((card) =>
    (statusFilter === "all" || (statusFilter === "active" ? card.status !== "Completed" : card.status === statusFilter)) &&
    (!centerFilter || card.work_center_id === centerFilter) && (!orderFilter || card.work_order_id === orderFilter)
  ).sort((a, b) => a.work_order_id.localeCompare(b.work_order_id) || a.sequence_no - b.sequence_no);
  const action = "min-h-11 rounded-lg border px-4 text-sm disabled:opacity-50";

  return <div className="space-y-5 p-4 md:p-8">
    {readOnly && <ReadOnlyNotice />}
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-slate-900">Job cards</h1><p className="mt-1 text-sm text-slate-600">Start production steps, record total working time, and explain delays.</p></div>
      <button type="button" disabled={loading || !!saving} onClick={() => void load()} className={action}>Refresh</button>
    </header>
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">{(["Pending", "In Progress", "Blocked", "Completed"] as JobStatus[]).map((status) =>
      <button type="button" key={status} onClick={() => setStatusFilter(status)} className={"rounded-xl border p-3 text-left " + (statusFilter === status ? "border-blue-500 bg-blue-50" : "bg-white")}>
        <span className="block text-xs text-slate-600">{status}</span><strong className="text-xl">{cards.filter((card) => card.status === status).length}</strong>
      </button>)}</div>
    <div className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-3">
      <label className="text-sm">Status<select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={field}><option value="active">All unfinished jobs</option><option value="all">All jobs</option>{["Pending", "In Progress", "Blocked", "Completed"].map((status) => <option key={status}>{status}</option>)}</select></label>
      <label className="text-sm">Work centre<select value={centerFilter} onChange={(e) => setCenterFilter(e.target.value)} className={field}><option value="">All work centres</option>{centers.map((center) => <option key={center.id} value={center.id}>{center.name}</option>)}</select></label>
      <label className="text-sm">Production order<select value={orderFilter} onChange={(e) => setOrderFilter(e.target.value)} className={field}><option value="">All orders</option>{orders.map((order) => <option key={order.id} value={order.id}>{order.product_name} · {order.id.slice(0, 8)}</option>)}</select></label>
    </div>
    {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    {loading ? <p role="status" className="p-6 text-center text-slate-500">Loading job cards...</p> : <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">{visible.map((card) => {
      const disabled = readOnly || !!saving || card.status === "Completed";
      return <article key={card.id} className="min-w-0 space-y-3 rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs text-slate-500">{orderNames.get(card.work_order_id) || "Production order"} · {card.work_order_id.slice(0, 8)}</p><h2 className="font-semibold text-slate-900">{card.sequence_no}. {card.operation_name}</h2></div><span className={"rounded-full px-2 py-1 text-xs font-medium " + (card.status === "Blocked" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700")}>{card.status}</span></div>
        <p className="text-sm text-slate-600">{card.work_center_id ? centerNames.get(card.work_center_id) || "Work centre" : "No work centre"} · Planned {Number(card.planned_minutes).toFixed(2)} min</p>
        {card.instructions && <p className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-sm">{card.instructions}</p>}
        <label className="block text-sm">Total actual minutes<input type="number" min="0" step="0.01" inputMode="decimal" value={actual[card.id] ?? "0"} disabled={disabled} onChange={(e) => setActual((current) => ({ ...current, [card.id]: e.target.value }))} className={field} /></label>
        {card.status !== "Completed" ? <label className="block text-sm">Block reason<textarea rows={2} value={reasons[card.id] || ""} disabled={disabled} onChange={(e) => setReasons((current) => ({ ...current, [card.id]: e.target.value }))} className={field} placeholder="Required when blocking a job" /></label> : card.block_reason && <p className="text-sm text-slate-600">Previous delay: {card.block_reason}</p>}
        {card.started_at && <p className="text-xs text-slate-500">Started {new Date(card.started_at).toLocaleString()}{card.completed_at ? " · Completed " + new Date(card.completed_at).toLocaleString() : ""}</p>}
        <div className="flex flex-wrap gap-2">
          {card.status === "Pending" && <button disabled={disabled} onClick={() => void save(card, "In Progress")} className={action + " bg-blue-700 text-white"}>Start</button>}
          {card.status === "Blocked" && <button disabled={disabled} onClick={() => void save(card, "In Progress")} className={action + " bg-blue-700 text-white"}>Resume</button>}
          {card.status === "In Progress" && <><button disabled={disabled} onClick={() => void save(card, "Completed")} className={action + " bg-emerald-700 text-white"}>Complete</button><button disabled={disabled} onClick={() => void save(card, "Blocked")} className={action + " border-amber-400 text-amber-800"}>Block</button></>}
          {(card.status === "In Progress" || card.status === "Blocked") && <button disabled={disabled} onClick={() => void save(card, card.status)} className={action}>Save time</button>}
        </div>
      </article>;
    })}</div>}
    {!loading && !visible.length && <p className="rounded-xl border bg-white p-6 text-center text-sm text-slate-500">{cards.length ? "No jobs match these filters." : "No job cards yet. Add routing operations, reserve materials, then release a production order."}</p>}
  </div>;
}
