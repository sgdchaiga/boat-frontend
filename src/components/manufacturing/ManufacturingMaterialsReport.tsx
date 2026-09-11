import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { effectiveStockMovementInOut } from "../../lib/stockMovementEffective";
import { businessDayRangeForDateString, toBusinessDateString } from "../../lib/timezone";

type Row = Record<string, any>;
const qty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 3 });

export function ManufacturingMaterialsReport({ fromDate, toDate }: { fromDate: string; toDate: string }) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const [data, setData] = useState<{ org: string; products: Row[]; movements: Row[]; entries: Row[] } | null>(null);
  const [error, setError] = useState("");
  const [material, setMaterial] = useState("");
  const [finished, setFinished] = useState("");
  const [location, setLocation] = useState("");
  useEffect(() => {
    let cancelled = false;
    setData(null); setError("");
    setMaterial(""); setFinished(""); setLocation("");
    if (!orgId) { setError("Select an organisation to view this report."); return; }
    if (!fromDate || !toDate || fromDate > toDate) { setError("Choose a valid date range."); return; }
    async function read(table: string, columns: string) {
      const rows: Row[] = [];
      for (let offset = 0; ; offset += 1000) {
        let query = supabase.from(table).select(columns).eq("organization_id", orgId!).order("id").range(offset, offset + 999);
        if (table === "product_stock_movements") query = query.lt("movement_date", businessDayRangeForDateString(toDate)!.to.toISOString());
        if (table === "manufacturing_production_entries") query = query.gte("production_date", fromDate).lte("production_date", toDate);
        const result = await query;
        if (result.error) throw new Error(result.error.message);
        rows.push(...(result.data || []));
        if ((result.data || []).length < 1000) return rows;
      }
    }
    void Promise.all([
      read("products", "id,name,unit_of_measure,manufacturing_item_type"),
      read("product_stock_movements", "id,product_id,movement_date,quantity_in,quantity_out,unit_cost,source_type,source_id,location,note"),
      read("manufacturing_production_entries", "id,product_id,product_name,production_date,produced_qty,scrap_qty,manual_serial_number"),
    ]).then(([products, movements, entries]) => { if (!cancelled) setData({ org: orgId!, products, movements, entries }); })
      .catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [orgId, fromDate, toDate]);
  const current = data?.org === orgId ? data : null;
  const materials = (current?.products || []).filter(p => ["raw_material", "consumable"].includes(p.manufacturing_item_type));
  const balances = useMemo(() => materials.filter(p => !material || p.id === material).map(p => {
    let opening = 0, purchased = 0, used = 0, other = 0;
    for (const m of current?.movements || []) {
      if (m.product_id !== p.id || (location && (m.location || "default") !== location)) continue;
      const { inQty, outQty } = effectiveStockMovementInOut(m);
      const net = inQty - outQty;
      if (toBusinessDateString(m.movement_date) < fromDate) opening += net;
      else if (m.source_type === "manufacturing_consumption") used -= net;
      else if (["bill", "grn", "purchase", "vendor_bill", "vendor_payment"].includes(String(m.source_type).toLowerCase())) purchased += net;
      else other += net;
    }
    return [p.name, p.unit_of_measure || "—", qty(opening), qty(purchased), qty(used), qty(other), qty(opening + purchased - used + other)];
  }), [current, material, location, fromDate]);
  const detail: string[][] = [];
  for (const entry of current?.entries || []) {
    if (finished && entry.product_id !== finished) continue;
    const issues = current!.movements.filter(m => m.source_type === "manufacturing_consumption" && m.source_id === entry.id && (!material || m.product_id === material) && (!location || (m.location || "default") === location));
    const output = current!.products.find(p => p.id === entry.product_id);
    for (const m of issues) {
      const p = current!.products.find(p => p.id === m.product_id);
      const { inQty, outQty } = effectiveStockMovementInOut(m);
      detail.push([entry.production_date, entry.manual_serial_number || entry.id, entry.product_name, qty(Number(entry.produced_qty || 0)), output?.unit_of_measure || "—", qty(Number(entry.scrap_qty || 0)), p?.name || m.product_id, p?.unit_of_measure || "—", qty(outQty - inQty), qty(Number(m.unit_cost || 0)), qty((outQty - inQty) * Number(m.unit_cost || 0)), m.location || "default"]);
    }
    if (!issues.length && !material && !location) detail.push([entry.production_date, entry.manual_serial_number || entry.id, entry.product_name, qty(Number(entry.produced_qty || 0)), output?.unit_of_measure || "—", qty(Number(entry.scrap_qty || 0)), "No recorded material issue", "—", "—", "—", "—", "—"]);
  }
  const select = (label: string, value: string, change: (value: string) => void, options: Row[]) => <label className="text-sm">{label}<select className="block mt-1 border rounded-lg p-2" value={value} onChange={e => change(e.target.value)}><option value="">All</option>{options.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>;
  if (error) return <p role="alert" className="p-4 bg-red-50 text-red-700">{error}</p>;
  if (!current) return <p className="p-4">Loading material and production reports…</p>;
  return <section className="space-y-4">
    <div className="flex flex-wrap gap-4">{select("Raw material / consumable", material, setMaterial, materials)}{select("Finished item (production detail)", finished, setFinished, current.products.filter(p => current.entries.some(e => e.product_id === p.id)))}{select("Stock location", location, setLocation, [...new Set(current.movements.map(m => m.location || "default"))].map(id => ({ id, name: id })))}</div>
    <ReportTable title="Raw material balance" headers={["Raw material", "Unit", "Opening balance", "Purchased / received", "Used for production", "Other net movements", "Closing balance"]} rows={balances} />
    <p className="text-xs text-slate-500">Closing balance at the end of {toDate} = opening balance + purchases − production usage + other net movements. Opening balance includes all recorded movements before {fromDate}. Purchases reflect stock receipts. Other movements include adjustments, transfers and non-production issues. Quantities are in each item's stock unit.</p>
    <ReportTable title="Finished items and raw materials used" headers={["Date", "Batch / serial", "Finished item", "Amount produced", "Output unit", "Scrap quantity", "Raw material", "Material unit", "Raw material used", "Issue unit cost", "Material cost", "Location"]} rows={detail} />
    <p className="text-xs text-slate-500">One row per recorded material issue. Output and scrap quantities repeat for each material in a batch; do not sum these columns across material rows. Material and location filters apply to both tables; finished-item filter applies only to production detail.</p>
  </section>;
}

function ReportTable({ title, headers, rows }: { title: string; headers: string[]; rows: string[][] }) {
  const download = () => {
    const csv = [headers, ...rows].map(row => row.map(value => `"${(/^[=+@-]/.test(value) ? "'" : "") + value.replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `${title}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  return <div className="border rounded-lg bg-white overflow-hidden"><div className="p-4 flex justify-between"><h2 className="font-semibold">{title}</h2><button onClick={download} className="text-sm text-emerald-700">Export CSV</button></div><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50"><tr>{headers.map(h => <th key={h} className="p-3 text-left whitespace-nowrap">{h}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i} className="border-t">{row.map((v, j) => <td key={j} className="p-3 whitespace-nowrap tabular-nums">{v}</td>)}</tr>)}{!rows.length && <tr><td colSpan={headers.length} className="p-6 text-center text-slate-500">No records for the selected filters.</td></tr>}</tbody></table></div></div>;
}
