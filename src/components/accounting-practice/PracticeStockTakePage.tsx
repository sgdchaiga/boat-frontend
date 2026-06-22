import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, FileSpreadsheet, Filter, PackageCheck, Printer, RefreshCw, Upload } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { parseBulkImportFile } from "../../lib/saccoBulkImport";
import { supabase } from "../../lib/supabase";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";

const db = supabase as any;
type Client = { id: string; name: string };
type StockTake = { id: string; client_id: string; title: string; stock_date: string; source_file: string | null; status: "draft" | "completed"; created_at: string };
type StockLine = { id: string; item_code: string | null; item_name: string; category: string | null; unit: string | null; system_qty: number; physical_qty: number | null; unit_cost: number };
type ImportLine = Omit<StockLine, "id" | "physical_qty">;

const input = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
const numberFrom = (value: string) => {
  const raw = String(value ?? "").replace(/,/g, "").trim();
  if (!raw || raw === "-") return null;
  const normalized = /^\(.*\)$/.test(raw) ? `-${raw.slice(1, -1)}` : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};
const detectHeader = (headers: string[], aliases: string[], patterns: RegExp[], exclusions: RegExp[] = []) =>
  aliases.find((alias) => headers.includes(alias)) ||
  headers.find((header) => patterns.some((pattern) => pattern.test(header)) && !exclusions.some((pattern) => pattern.test(header))) ||
  "";

export function PracticeStockTakePage({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const orgId = user?.organization_id || null;
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [takes, setTakes] = useState<StockTake[]>([]);
  const [takeId, setTakeId] = useState("");
  const [lines, setLines] = useState<StockLine[]>([]);
  const [title, setTitle] = useState("Stock take");
  const [stockDate, setStockDate] = useState(new Date().toISOString().slice(0, 10));
  const [sourceFile, setSourceFile] = useState("");
  const [importLines, setImportLines] = useState<ImportLine[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [varianceFilter, setVarianceFilter] = useState<"all" | "variance" | "shortage" | "surplus" | "uncounted">("all");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadTakes = useCallback(async (selectedClient: string) => {
    if (!selectedClient) { setTakes([]); setTakeId(""); setLines([]); return; }
    const result = await db.from("practice_stock_takes").select("*").eq("client_id", selectedClient).order("stock_date", { ascending: false }).order("created_at", { ascending: false });
    if (result.error) { setMessage(result.error.message); return; }
    const rows = (result.data || []) as StockTake[];
    setTakes(rows);
    setTakeId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id || "");
  }, []);

  const loadClients = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const result = await db.from("practice_clients").select("id,name").eq("organization_id", orgId).eq("status", "active").order("name");
    if (result.error) setMessage(result.error.message);
    else {
      const rows = (result.data || []) as Client[];
      setClients(rows);
      setClientId((current) => current || rows[0]?.id || "");
    }
    setLoading(false);
  }, [orgId]);

  const loadLines = useCallback(async (selectedTake: string) => {
    if (!selectedTake) { setLines([]); return; }
    const result = await db.from("practice_stock_take_items").select("*").eq("stock_take_id", selectedTake).order("item_name");
    if (result.error) setMessage(result.error.message);
    else setLines((result.data || []).map((row: StockLine) => ({ ...row, system_qty: Number(row.system_qty || 0), physical_qty: row.physical_qty == null ? null : Number(row.physical_qty), unit_cost: Number(row.unit_cost || 0) })));
  }, []);

  useEffect(() => { void loadClients(); }, [loadClients]);
  useEffect(() => { void loadTakes(clientId); }, [clientId, loadTakes]);
  useEffect(() => { void loadLines(takeId); }, [takeId, loadLines]);

  const readFile = async (file: File | null) => {
    if (!file) return;
    try {
      const parsed = await parseBulkImportFile(file);
      const nameHeader = detectHeader(parsed.headers, ["item_name", "product_name", "description", "name", "item", "product"], [/^(item|product).*(name|description)$/, /^(item|product|description)$/]);
      const quantityHeader = detectHeader(
        parsed.headers,
        ["system_qty", "system_quantity", "book_qty", "book_quantity", "quantity", "qty", "stock", "stock_on_hand", "on_hand"],
        [/(system|book|expected|theoretical).*(qty|quantity|stock|balance)/, /(qty|quantity|stock_on_hand|on_hand|stock|balance)/],
        [/(physical|actual|counted|cost|value|amount|rate|code|sku)/]
      );
      if (!nameHeader || !quantityHeader) {
        setSourceFile(file.name); setImportLines([]);
        setMessage(`Could not identify ${!nameHeader ? "an item-name" : "a system-quantity"} column. File columns: ${parsed.headers.join(", ") || "none"}.`);
        return;
      }
      const codeHeader = detectHeader(parsed.headers, ["item_code", "product_code", "sku", "code", "barcode"], [/(item|product).*code/, /^(sku|code|barcode)$/]);
      const categoryHeader = detectHeader(parsed.headers, ["category", "group", "department", "class"], [/(category|department|group|class)/]);
      const unitHeader = detectHeader(parsed.headers, ["unit", "uom", "unit_of_measure"], [/^(unit|uom|unit_of_measure)$/]);
      const costHeader = detectHeader(parsed.headers, ["unit_cost", "cost", "cost_price", "average_cost"], [/(unit|average|avg).*(cost|price)/, /^(cost|cost_price)$/], [/(total|value|amount)/]);
      const mapped: ImportLine[] = [];
      let skipped = 0;
      parsed.rows.forEach((row) => {
        const itemName = row[nameHeader]?.trim() || "";
        const systemQty = numberFrom(row[quantityHeader]);
        if (!itemName || systemQty == null) { skipped += 1; return; }
        mapped.push({
          item_code: codeHeader ? row[codeHeader]?.trim() || null : null,
          item_name: itemName,
          category: categoryHeader ? row[categoryHeader]?.trim() || null : null,
          unit: unitHeader ? row[unitHeader]?.trim() || null : null,
          system_qty: systemQty,
          unit_cost: costHeader ? numberFrom(row[costHeader]) || 0 : 0,
        });
      });
      setSourceFile(file.name);
      setImportLines(mapped);
      setMessage(`${mapped.length} item(s) ready. System quantity mapped from “${quantityHeader}”${skipped ? `; ${skipped} row(s) skipped because item name or system quantity was missing` : ""}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read the stock file.");
    }
  };

  const createTake = async () => {
    if (!orgId || !clientId || !title.trim() || !stockDate || !importLines.length) return;
    setSaving(true);
    const header = await db.from("practice_stock_takes").insert({ organization_id: orgId, client_id: clientId, title: title.trim(), stock_date: stockDate, source_file: sourceFile || null, prepared_by: user?.id || null }).select("id").single();
    if (header.error) { setMessage(header.error.message); setSaving(false); return; }
    const stockTakeId = header.data.id;
    const detail = await db.from("practice_stock_take_items").insert(importLines.map((row) => ({ ...row, organization_id: orgId, stock_take_id: stockTakeId })));
    if (detail.error) {
      await db.from("practice_stock_takes").delete().eq("id", stockTakeId);
      setMessage(detail.error.message);
    } else {
      setImportLines([]); setSourceFile(""); setMessage("Stock take created. Enter the physical quantities below.");
      await loadTakes(clientId); setTakeId(stockTakeId); await loadLines(stockTakeId);
    }
    setSaving(false);
  };

  const saveCounts = async (complete = false) => {
    if (!takeId) return;
    setSaving(true);
    const results = await Promise.all(lines.map((line) => db.from("practice_stock_take_items").update({ physical_qty: line.physical_qty }).eq("id", line.id)));
    const failed = results.find((result) => result.error)?.error;
    if (failed) setMessage(failed.message);
    else {
      if (complete) await db.from("practice_stock_takes").update({ status: "completed", completed_at: new Date().toISOString(), completed_by: user?.id || null }).eq("id", takeId);
      setMessage(complete ? "Stock take completed." : "Physical counts saved.");
      await loadTakes(clientId);
    }
    setSaving(false);
  };

  const selectedTake = takes.find((take) => take.id === takeId);
  const categories = useMemo(() => Array.from(new Set(lines.map((line) => line.category).filter(Boolean) as string[])).sort(), [lines]);
  const filtered = useMemo(() => lines.filter((line) => {
    const needle = search.trim().toLowerCase();
    if (needle && !`${line.item_code || ""} ${line.item_name}`.toLowerCase().includes(needle)) return false;
    if (category && line.category !== category) return false;
    const variance = line.physical_qty == null ? null : line.physical_qty - line.system_qty;
    if (varianceFilter === "uncounted") return variance == null;
    if (varianceFilter === "variance") return variance != null && Math.abs(variance) > 0.0001;
    if (varianceFilter === "shortage") return variance != null && variance < -0.0001;
    if (varianceFilter === "surplus") return variance != null && variance > 0.0001;
    return true;
  }), [category, lines, search, varianceFilter]);
  const counted = lines.filter((line) => line.physical_qty != null);
  const varianceValue = counted.reduce((sum, line) => sum + (Number(line.physical_qty) - line.system_qty) * line.unit_cost, 0);
  const filteredCounted = filtered.filter((line) => line.physical_qty != null);
  const filteredVarianceQty = filteredCounted.reduce((sum, line) => sum + Number(line.physical_qty) - line.system_qty, 0);
  const filteredVarianceValue = filteredCounted.reduce((sum, line) => sum + (Number(line.physical_qty) - line.system_qty) * line.unit_cost, 0);

  const downloadReport = () => {
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = [["Item code", "Item name", "Category", "Unit", "System qty", "Physical qty", "Variance qty", "Unit cost", "Variance value"], ...filtered.map((line) => {
      const variance = line.physical_qty == null ? "" : line.physical_qty - line.system_qty;
      return [line.item_code || "", line.item_name, line.category || "", line.unit || "", line.system_qty, line.physical_qty ?? "", variance, line.unit_cost, variance === "" ? "" : Number(variance) * line.unit_cost];
    })];
    const blob = new Blob([rows.map((row) => row.map(escape).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `stock_take_${selectedTake?.stock_date || stockDate}.csv`; link.click(); URL.revokeObjectURL(link.href);
  };

  return <div className="space-y-6 p-6 md:p-8">
    {readOnly && <ReadOnlyNotice />}
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><PackageCheck className="h-7 w-7 text-brand-700"/><h1 className="text-3xl font-bold text-slate-900">Stock Take</h1></div><p className="mt-1 text-sm text-slate-500">Import a client’s system stock, capture physical counts, and report variances.</p></div><button className="app-btn-secondary" onClick={() => void loadTakes(clientId)}><RefreshCw className="h-4 w-4"/> Refresh</button></div>
    {message && <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">{message}</div>}
    <div className="grid gap-4 rounded-xl border bg-white p-4 lg:grid-cols-5">
      <label className="text-xs text-slate-600">Client<select className={`${input} mt-1 w-full`} value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">Select client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
      <label className="text-xs text-slate-600">Title<input className={`${input} mt-1 w-full`} value={title} onChange={(event) => setTitle(event.target.value)}/></label>
      <label className="text-xs text-slate-600">Stock date<input className={`${input} mt-1 w-full`} type="date" value={stockDate} onChange={(event) => setStockDate(event.target.value)}/></label>
      <label className="app-btn-secondary mt-5 cursor-pointer"><FileSpreadsheet className="h-4 w-4"/> Upload CSV / Excel<input type="file" accept=".csv,.xls,.xlsx" className="hidden" disabled={readOnly || !clientId} onChange={(event) => void readFile(event.target.files?.[0] || null)}/></label>
      <button className="app-btn-primary mt-5" disabled={readOnly || saving || !importLines.length} onClick={() => void createTake()}><Upload className="h-4 w-4"/> Import {importLines.length || "stock"}</button>
      {sourceFile && <p className="text-xs text-slate-500 lg:col-span-5">Ready: {sourceFile}. Required columns: item/name and system quantity. Optional: code, category, unit, unit cost.</p>}
    </div>
    <div className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-4"><label className="text-xs text-slate-600 md:col-span-2">Saved stock take<select className={`${input} mt-1 w-full`} value={takeId} onChange={(event) => setTakeId(event.target.value)}><option value="">No stock take selected</option>{takes.map((take) => <option key={take.id} value={take.id}>{take.stock_date} · {take.title} · {take.status}</option>)}</select></label><Metric label="Counted" value={`${counted.length}/${lines.length}`}/><Metric label="Variance value" value={varianceValue.toLocaleString("en-UG", { maximumFractionDigits: 2 })}/></div>
    {takeId && <>
      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4"><label className="text-xs text-slate-600">Search<input className={`${input} mt-1 block`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Code or item name"/></label><label className="text-xs text-slate-600">Category<select className={`${input} mt-1 block`} value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{categories.map((value) => <option key={value}>{value}</option>)}</select></label><label className="text-xs text-slate-600">Variance<select className={`${input} mt-1 block`} value={varianceFilter} onChange={(event) => setVarianceFilter(event.target.value as typeof varianceFilter)}><option value="all">All items</option><option value="variance">With variance</option><option value="shortage">Shortages</option><option value="surplus">Surpluses</option><option value="uncounted">Not counted</option></select></label><span className="inline-flex items-center gap-1 text-xs text-slate-500"><Filter className="h-4 w-4"/>{filtered.length} shown</span><div className="ml-auto flex gap-2"><button className="app-btn-secondary" onClick={downloadReport}><Download className="h-4 w-4"/> CSV report</button><button className="app-btn-secondary" onClick={() => window.print()}><Printer className="h-4 w-4"/> Print</button><button className="app-btn-primary" disabled={readOnly || saving} onClick={() => void saveCounts(false)}>Save counts</button><button className="app-btn-primary" disabled={readOnly || saving || counted.length !== lines.length} onClick={() => void saveCounts(true)}><CheckCircle2 className="h-4 w-4"/> Complete</button></div></div>
      <div className="overflow-auto rounded-xl border bg-white"><div className="border-b p-4"><h2 className="font-semibold">{selectedTake?.title}</h2><p className="text-xs text-slate-500">{clients.find((client) => client.id === clientId)?.name} · {selectedTake?.stock_date} · System stock from {selectedTake?.source_file || "uploaded file"}</p></div><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="p-3 text-left">Code</th><th className="p-3 text-left">Item</th><th className="p-3 text-left">Category</th><th className="p-3 text-right">System</th><th className="p-3 text-right">Physical</th><th className="p-3 text-right">Variance</th><th className="p-3 text-right">Variance value</th></tr></thead><tbody>{filtered.map((line) => { const variance = line.physical_qty == null ? null : line.physical_qty - line.system_qty; return <tr key={line.id} className={`border-t ${variance != null && variance < 0 ? "bg-rose-50" : variance != null && variance > 0 ? "bg-emerald-50" : ""}`}><td className="p-3 text-slate-500">{line.item_code || "—"}</td><td className="p-3 font-medium">{line.item_name}<p className="text-xs font-normal text-slate-400">{line.unit || ""}</p></td><td className="p-3">{line.category || "—"}</td><td className="p-3 text-right tabular-nums">{line.system_qty}</td><td className="p-2 text-right"><input className="w-28 rounded-lg border px-2 py-1.5 text-right tabular-nums" type="number" step="any" value={line.physical_qty ?? ""} disabled={readOnly || selectedTake?.status === "completed"} onChange={(event) => setLines((current) => current.map((row) => row.id === line.id ? { ...row, physical_qty: event.target.value === "" ? null : Number(event.target.value) } : row))}/></td><td className="p-3 text-right font-semibold tabular-nums">{variance == null ? "—" : variance}</td><td className="p-3 text-right tabular-nums">{variance == null ? "—" : (variance * line.unit_cost).toLocaleString("en-UG", { maximumFractionDigits: 2 })}</td></tr>; })}</tbody><tfoot><tr className="border-t-2 bg-slate-50 font-semibold"><td className="p-3" colSpan={5}>Filtered report totals</td><td className="p-3 text-right">{filteredVarianceQty}</td><td className="p-3 text-right">{filteredVarianceValue.toLocaleString("en-UG", { maximumFractionDigits: 2 })}</td></tr></tfoot></table>{!loading && !filtered.length && <p className="p-8 text-center text-sm text-slate-500">No stock lines match the filters.</p>}</div>
    </>}
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="font-semibold text-slate-900">{value}</p></div>; }
