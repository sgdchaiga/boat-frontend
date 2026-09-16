import { useEffect, useState } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";

type Product = { id: string; name: string };
type Lot = { id: string; product_id: string; lot_number: string; status: string };
type Template = { id: string; name: string; inspection_type: string; checks: string[] };
type Result = { check: string; passed: boolean; note: string };
type Inspection = { id: string; inspection_type: string; status: string; lot_id: string; template_id: string | null; sample_qty: number | null; notes: string | null; results: Result[] };
type Rework = { id: string; inspection_id: string; lot_id: string; action: string; status: string; reason: string; resolution: string | null };
type TraceMovement = { id: string; source_type: string; source_id: string | null; quantity_in: number; quantity_out: number; movement_date: string };
const input = "rounded-lg border border-slate-300 px-3 py-2 text-sm";

export function ManufacturingQualityPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const admin = !!user?.isSuperAdmin;
  const [products, setProducts] = useState<Product[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [reworks, setReworks] = useState<Rework[]>([]);
  const [productId, setProductId] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [assignLotId, setAssignLotId] = useState("");
  const [assignQty, setAssignQty] = useState("");
  const [lotId, setLotId] = useState("");
  const [inspectionType, setInspectionType] = useState("receiving");
  const [templateId, setTemplateId] = useState("");
  const [sampleQty, setSampleQty] = useState("");
  const [notes, setNotes] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [checkList, setCheckList] = useState("");
  const [draftResults, setDraftResults] = useState<Record<string, Result[]>>({});
  const [reworkAction, setReworkAction] = useState<Record<string, string>>({});
  const [reworkReason, setReworkReason] = useState<Record<string, string>>({});
  const [reworkResolution, setReworkResolution] = useState<Record<string, string>>({});
  const [traceLotId, setTraceLotId] = useState("");
  const [traceMovements, setTraceMovements] = useState<TraceMovement[]>([]);
  const [saleCustomers, setSaleCustomers] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!orgId && !admin) return;
    const [p, l, t, i, r] = await Promise.all([
      filterByOrganizationId(supabase.from("products").select("id,name").eq("active", true).order("name"), orgId, admin),
      filterByOrganizationId(supabase.from("product_lots").select("id,product_id,lot_number,status").order("created_at", { ascending: false }), orgId, admin),
      filterByOrganizationId(supabase.from("manufacturing_quality_templates").select("id,name,inspection_type,checks").eq("active", true).order("name"), orgId, admin),
      filterByOrganizationId(supabase.from("manufacturing_quality_inspections").select("id,inspection_type,status,lot_id,template_id,sample_qty,notes,results").order("created_at", { ascending: false }).limit(50), orgId, admin),
      filterByOrganizationId(supabase.from("manufacturing_quality_rework").select("id,inspection_id,lot_id,action,status,reason,resolution").order("created_at", { ascending: false }).limit(50), orgId, admin),
    ]);
    const error = p.error || l.error || t.error || i.error || r.error;
    if (error) { setMessage(error.message); return; }
    setProducts((p.data || []) as Product[]);
    setLots((l.data || []) as Lot[]);
    setTemplates((t.data || []) as Template[]);
    setInspections((i.data || []) as Inspection[]);
    setReworks((r.data || []) as Rework[]);
  };
  useEffect(() => { void load(); }, [orgId, admin]);

  const createLot = async () => {
    if (readOnly || busy || !orgId || !productId || !lotNumber.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("product_lots").insert({ organization_id: orgId, product_id: productId, lot_number: lotNumber.trim(), expires_on: expiry || null });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    setLotNumber(""); setExpiry(""); setMessage("Lot created."); await load();
  };
  const createTemplate = async () => {
    const checks = checkList.split("\n").map((line) => line.trim()).filter(Boolean);
    if (readOnly || busy || !orgId || !templateName.trim() || !checks.length) return;
    setBusy(true);
    const { error } = await supabase.from("manufacturing_quality_templates").insert({ organization_id: orgId, name: templateName.trim(), inspection_type: inspectionType, checks });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    setTemplateName(""); setCheckList(""); setMessage("Checklist saved."); await load();
  };
  const assignStock = async () => {
    if (readOnly || busy || !assignLotId || Number(assignQty) <= 0) return;
    setBusy(true);
    const { error } = await (supabase.rpc as any)("assign_untracked_stock_to_lot", { p_lot_id: assignLotId, p_qty: Number(assignQty) });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    setAssignQty(""); setMessage("Stock tagged to lot; total product stock is unchanged."); await load();
  };
  const createInspection = async () => {
    if (readOnly || busy || !orgId || !lotId || (sampleQty && Number(sampleQty) <= 0)) return;
    const lot = lots.find((row) => row.id === lotId);
    setBusy(true);
    const { error } = await supabase.from("manufacturing_quality_inspections").insert({ organization_id: orgId, inspection_type: inspectionType, lot_id: lotId, product_id: lot?.product_id || null, template_id: templateId || null, status: "pending", sample_qty: sampleQty ? Number(sampleQty) : null, notes: notes.trim() || null, results: [] });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    setSampleQty(""); setNotes(""); setMessage("Inspection created."); await load();
  };
  const checksFor = (inspection: Inspection) => templates.find((row) => row.id === inspection.template_id)?.checks || [];
  const resultsFor = (inspection: Inspection): Result[] => draftResults[inspection.id] || checksFor(inspection).map((check) => inspection.results?.find((result) => result.check === check) || { check, passed: false, note: "" });
  const changeResult = (inspection: Inspection, check: string, patch: Partial<Result>) => setDraftResults((current) => ({
    ...current, [inspection.id]: resultsFor(inspection).map((result) => result.check === check ? { ...result, ...patch } : result),
  }));
  const decide = async (inspection: Inspection, status: "passed" | "failed" | "on_hold") => {
    if (readOnly || busy) return;
    const results = resultsFor(inspection);
    if (status === "passed" && results.some((result) => !result.passed)) { setMessage("All checklist items must pass before releasing the lot."); return; }
    if (status === "failed" && results.length && results.every((result) => result.passed)) { setMessage("Mark a failed checklist item before rejecting the lot."); return; }
    setBusy(true);
    const { error } = await supabase.from("manufacturing_quality_inspections").update({ status, results, inspected_at: new Date().toISOString(), inspected_by: user?.id || null }).eq("id", inspection.id);
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    setMessage(`Inspection ${status.replace("_", " ")}.`); await load();
  };
  const openRework = async (inspection: Inspection) => {
    if (readOnly || busy || !orgId || !inspection.lot_id || !reworkReason[inspection.id]?.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("manufacturing_quality_rework").insert({ organization_id: orgId, inspection_id: inspection.id, lot_id: inspection.lot_id, action: reworkAction[inspection.id] || "rework", reason: reworkReason[inspection.id].trim(), opened_by: user?.id || null });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    setMessage("Corrective action opened; lot is on hold."); await load();
  };
  const completeRework = async (rework: Rework) => {
    if (readOnly || busy || !reworkResolution[rework.id]?.trim()) return;
    setBusy(true);
    const { error } = await supabase.from("manufacturing_quality_rework").update({ status: "completed", resolution: reworkResolution[rework.id].trim(), completed_at: new Date().toISOString(), completed_by: user?.id || null }).eq("id", rework.id);
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    setMessage(rework.action === "rework" ? "Rework completed. Create a fresh inspection before releasing the lot." : "Corrective action completed; lot remains rejected."); await load();
  };

  const loadTrace = async (selectedLotId: string) => {
    setTraceLotId(selectedLotId); setTraceMovements([]); setSaleCustomers({});
    if (!selectedLotId || !orgId) return;
    const { data, error } = await supabase.from("product_stock_movements").select("id,source_type,source_id,quantity_in,quantity_out,movement_date").eq("organization_id", orgId).eq("lot_id", selectedLotId).order("movement_date", { ascending: false }).limit(100);
    if (error) { setMessage(error.message); return; }
    const movements = (data || []) as TraceMovement[];
    setTraceMovements(movements);
    const saleIds = [...new Set(movements.filter((movement) => movement.source_type === "sale" && movement.source_id).map((movement) => movement.source_id!))];
    if (!saleIds.length) return;
    const { data: sales, error: salesError } = await supabase.from("retail_sales").select("id,sale_number,customer_name,customer_phone").eq("organization_id", orgId).in("id", saleIds);
    if (salesError) { setMessage(salesError.message); return; }
    setSaleCustomers(Object.fromEntries(((sales || []) as Array<{ id: string; sale_number: string | null; customer_name: string | null; customer_phone: string | null }>).map((sale) => [sale.id, `${sale.sale_number || sale.id.slice(0, 8)} · ${sale.customer_name || sale.customer_phone || "Walk-in customer"}`])));
  };

  return <div className="space-y-6 p-6 md:p-8">
    {readOnly && <ReadOnlyNotice />}
    <div><h1 className="text-2xl font-bold text-slate-900">Lots & quality</h1><p className="text-sm text-slate-600">Record batches, inspection evidence and stock release decisions.</p></div>
    {message && <p role="status" className="rounded-lg border bg-slate-50 p-3 text-sm">{message}</p>}
    <section className="rounded-xl border bg-white p-4"><h2 className="font-semibold">Create lot</h2><div className="mt-3 grid gap-2 md:grid-cols-4">
      <select aria-label="Lot product" value={productId} onChange={(e) => setProductId(e.target.value)} className={input}><option value="">Product...</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select>
      <input aria-label="Lot number" value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} placeholder="Lot / batch number" className={input}/>
      <input aria-label="Expiry date" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={input}/>
      <button type="button" onClick={() => void createLot()} disabled={readOnly || busy || !productId || !lotNumber.trim()} className="app-btn-primary disabled:opacity-50">Create lot</button>
    </div></section>
    <section className="rounded-xl border bg-white p-4"><h2 className="font-semibold">Tag existing stock to a lot</h2><p className="mt-1 text-xs text-slate-500">Moves quantity from untracked to lot-tagged stock without changing the product's total balance.</p><div className="mt-3 grid gap-2 md:grid-cols-3">
      <select aria-label="Lot to receive stock" value={assignLotId} onChange={(e) => setAssignLotId(e.target.value)} className={input}><option value="">Select available lot...</option>{lots.filter((lot) => lot.status === "available").map((lot) => <option key={lot.id} value={lot.id}>{products.find((product) => product.id === lot.product_id)?.name || "Product"} · {lot.lot_number}</option>)}</select>
      <input aria-label="Stock quantity to tag" type="number" min="0.001" step="0.001" value={assignQty} onChange={(e) => setAssignQty(e.target.value)} placeholder="Quantity" className={input}/>
      <button type="button" onClick={() => void assignStock()} disabled={readOnly || busy || !assignLotId || Number(assignQty) <= 0} className="app-btn-primary disabled:opacity-50">Tag stock</button>
    </div></section>
    <section className="rounded-xl border bg-white p-4"><h2 className="font-semibold">Lot trace</h2><p className="mt-1 text-xs text-slate-500">See production receipts, material issues and sales linked to a selected lot.</p><select aria-label="Lot to trace" value={traceLotId} onChange={(e) => void loadTrace(e.target.value)} className={`${input} mt-3 w-full max-w-md`}><option value="">Select lot...</option>{lots.map((lot) => <option key={lot.id} value={lot.id}>{products.find((product) => product.id === lot.product_id)?.name || "Product"} · {lot.lot_number}</option>)}</select>{traceLotId && <div className="mt-3 space-y-2">{traceMovements.map((movement) => <div key={movement.id} className="flex flex-wrap justify-between gap-2 rounded border bg-slate-50 px-3 py-2 text-sm"><span>{movement.source_type.replaceAll("_", " ")} · {saleCustomers[movement.source_id || ""] || movement.source_id?.slice(0, 8) || "Manual"}</span><span>{String(movement.movement_date).slice(0, 10)} · +{Number(movement.quantity_in || 0).toFixed(3)} / -{Number(movement.quantity_out || 0).toFixed(3)}</span></div>)}{!traceMovements.length && <p className="text-sm text-slate-500">No lot-tagged stock movements yet.</p>}</div>}</section>
    <section className="rounded-xl border bg-white p-4"><h2 className="font-semibold">Inspection checklist</h2><p className="mt-1 text-xs text-slate-500">Enter one check per line.</p><div className="mt-3 grid gap-2 md:grid-cols-2">
      <input aria-label="Checklist name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Checklist name" className={input}/>
      <button type="button" onClick={() => void createTemplate()} disabled={readOnly || busy || !templateName.trim() || !checkList.trim()} className="app-btn-primary disabled:opacity-50">Save checklist</button>
    </div><textarea aria-label="Checklist items" rows={3} value={checkList} onChange={(e) => setCheckList(e.target.value)} placeholder="One check per line" className={`${input} mt-2 w-full`}/></section>
    <section className="rounded-xl border bg-white p-4"><h2 className="font-semibold">Inspection queue</h2><div className="mt-3 grid gap-2 md:grid-cols-3">
      <select aria-label="Inspection lot" value={lotId} onChange={(e) => setLotId(e.target.value)} className={input}><option value="">Select lot...</option>{lots.map((lot) => <option key={lot.id} value={lot.id}>{products.find((product) => product.id === lot.product_id)?.name || "Product"} · {lot.lot_number} · {lot.status}</option>)}</select>
      <select aria-label="Inspection type" value={inspectionType} onChange={(e) => { setInspectionType(e.target.value); setTemplateId(""); }} className={input}><option value="receiving">Receiving</option><option value="in_process">In process</option><option value="finished_goods">Finished goods</option></select>
      <select aria-label="Inspection checklist" value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={input}><option value="">No checklist</option>{templates.filter((template) => template.inspection_type === inspectionType).map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select>
      <input aria-label="Sample quantity" type="number" min="0.001" step="0.001" value={sampleQty} onChange={(e) => setSampleQty(e.target.value)} placeholder="Sample quantity" className={input}/>
      <input aria-label="Inspection notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Inspection notes" className={input}/>
      <button type="button" onClick={() => void createInspection()} disabled={readOnly || busy || !lotId} className="app-btn-primary disabled:opacity-50">Create inspection</button>
    </div><div className="mt-4 space-y-3">{inspections.map((inspection) => <div key={inspection.id} className="rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2"><span>{inspection.inspection_type.replace("_", " ")} · {lots.find((lot) => lot.id === inspection.lot_id)?.lot_number || "No lot"} · <strong>{inspection.status}</strong>{inspection.sample_qty ? ` · sample ${inspection.sample_qty}` : ""}</span>{inspection.status === "pending" && <div className="flex gap-3"><button type="button" disabled={readOnly || busy} onClick={() => void decide(inspection, "passed")} className="text-emerald-700 disabled:opacity-50">Pass</button><button type="button" disabled={readOnly || busy} onClick={() => void decide(inspection, "on_hold")} className="text-amber-700 disabled:opacity-50">Hold</button><button type="button" disabled={readOnly || busy} onClick={() => void decide(inspection, "failed")} className="text-rose-700 disabled:opacity-50">Reject</button></div>}</div>
      {inspection.notes && <p className="mt-1 text-xs text-slate-600">{inspection.notes}</p>}
      {checksFor(inspection).length > 0 && <div className="mt-2 space-y-2">{resultsFor(inspection).map((result) => <label key={result.check} className="flex flex-wrap items-center gap-2 text-xs"><input type="checkbox" checked={result.passed} disabled={readOnly || inspection.status !== "pending"} onChange={(e) => changeResult(inspection, result.check, { passed: e.target.checked })}/><span className="min-w-32">{result.check}</span><input aria-label={`Note for ${result.check}`} value={result.note} disabled={readOnly || inspection.status !== "pending"} onChange={(e) => changeResult(inspection, result.check, { note: e.target.value })} placeholder="Result note" className="rounded border px-2 py-1"/></label>)}</div>}
      {(inspection.status === "failed" || inspection.status === "on_hold") && !reworks.some((row) => row.inspection_id === inspection.id) && <div className="mt-3 grid gap-2 rounded-lg bg-amber-50 p-3 sm:grid-cols-3"><select aria-label="Corrective action" value={reworkAction[inspection.id] || "rework"} onChange={(e) => setReworkAction((current) => ({ ...current, [inspection.id]: e.target.value }))} className={input}><option value="rework">Rework</option><option value="return_to_supplier">Return to supplier</option><option value="scrap">Scrap</option></select><input aria-label="Corrective action reason" value={reworkReason[inspection.id] || ""} onChange={(e) => setReworkReason((current) => ({ ...current, [inspection.id]: e.target.value }))} placeholder="Reason / defect" className={input}/><button type="button" disabled={readOnly || busy || !reworkReason[inspection.id]?.trim()} onClick={() => void openRework(inspection)} className="rounded-lg border border-amber-300 px-3 py-2 font-medium text-amber-900 disabled:opacity-50">Open corrective action</button></div>}
      {reworks.filter((row) => row.inspection_id === inspection.id).map((rework) => <div key={rework.id} className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="font-medium text-amber-900">{rework.action.replaceAll("_", " ")} · {rework.status}</p><p className="text-xs text-amber-800">{rework.reason}{rework.resolution ? ` · ${rework.resolution}` : ""}</p>{rework.status !== "completed" && <div className="mt-2 flex flex-wrap gap-2"><input aria-label="Corrective action resolution" value={reworkResolution[rework.id] || ""} onChange={(e) => setReworkResolution((current) => ({ ...current, [rework.id]: e.target.value }))} placeholder="Work performed / disposition" className={input}/><button type="button" disabled={readOnly || busy || !reworkResolution[rework.id]?.trim()} onClick={() => void completeRework(rework)} className="rounded-lg border border-amber-300 px-3 py-2 font-medium text-amber-900 disabled:opacity-50">Complete action</button></div>}</div>)}
    </div>)}{!inspections.length && <p className="text-sm text-slate-500">No inspections yet.</p>}</div></section>
  </div>;
}
