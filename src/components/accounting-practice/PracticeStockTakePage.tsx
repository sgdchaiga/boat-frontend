import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, CheckCircle2, Download, EyeOff, FileSpreadsheet, Filter, PackageCheck, Printer, RefreshCw, ScanBarcode, Send, ShieldCheck, Trash2, Upload, X } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { parseBulkImportFile } from "../../lib/saccoBulkImport";
import { supabase } from "../../lib/supabase";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";

const db = supabase as any;
type Client = { id: string; name: string };
type StockTake = { id: string; client_id: string; title: string; stock_date: string; source_file: string | null; status: "draft" | "completed" | "submitted" | "adjusted"; created_at: string };
type StockLine = { id: string; stock_take_id?: string; item_code: string | null; barcode?: string | null; item_name: string; category: string | null; department?: string | null; unit: string | null; system_qty: number; physical_qty: number | null; unit_cost: number; last_movement_date?: string | null; counted_by_name?: string | null };
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
const matchKey = (value: string | null | undefined) => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
const normalizeStockLine = (row: StockLine): StockLine => ({
  ...row,
  system_qty: Number(row.system_qty || 0),
  physical_qty: row.physical_qty == null ? null : Number(row.physical_qty),
  unit_cost: Number(row.unit_cost || 0),
});

export function PracticeStockTakePage({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const orgId = user?.organization_id || null;
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [takes, setTakes] = useState<StockTake[]>([]);
  const [allTakeLines, setAllTakeLines] = useState<StockLine[]>([]);
  const [takeId, setTakeId] = useState("");
  const [lines, setLines] = useState<StockLine[]>([]);
  const [title, setTitle] = useState("Stock take");
  const [stockDate, setStockDate] = useState(new Date().toISOString().slice(0, 10));
  const [sourceFile, setSourceFile] = useState("");
  const [importLines, setImportLines] = useState<ImportLine[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [varianceFilter, setVarianceFilter] = useState<"all" | "variance" | "shortage" | "surplus" | "uncounted">("all");
  const [reportView, setReportView] = useState<"all" | "missing" | "excess" | "slow" | "high_value" | "department">("all");
  const [blindCount, setBlindCount] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [inventoryAccount, setInventoryAccount] = useState("Inventory Account");
  const [gainLossAccount, setGainLossAccount] = useState("Stock Gain / Loss Account");
  const [workspaceTab, setWorkspaceTab] = useState<"dashboard" | "count" | "reports" | "adjustments">("dashboard");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const pendingLineSaves = useRef(new Map<string, number>());

  const loadTakes = useCallback(async (selectedClient: string) => {
    if (!selectedClient) { setTakes([]); setTakeId(""); setLines([]); return; }
    const result = await db.from("practice_stock_takes").select("*").eq("client_id", selectedClient).order("stock_date", { ascending: false }).order("created_at", { ascending: false });
    if (result.error) { setMessage(result.error.message); return; }
    const rows = (result.data || []) as StockTake[];
    setTakes(rows);
    if (rows.length) {
      const itemResult = await db.from("practice_stock_take_items").select("*").in("stock_take_id", rows.map((row) => row.id));
      if (!itemResult.error) setAllTakeLines((itemResult.data || []).map(normalizeStockLine));
    } else setAllTakeLines([]);
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
    const cacheKey = `boat.practice.stocktake.${selectedTake}`;
    if (result.error) {
      const cached = localStorage.getItem(cacheKey);
      if (cached) { setLines(JSON.parse(cached)); setMessage("Offline mode: showing locally saved counts."); }
      else setMessage(result.error.message);
    } else {
      setLines((result.data || []).map(normalizeStockLine));
      if (!pendingLineSaves.current.size) localStorage.removeItem(cacheKey);
    }
  }, []);

  useEffect(() => { void loadClients(); }, [loadClients]);
  useEffect(() => { void loadTakes(clientId); }, [clientId, loadTakes]);
  useEffect(() => { void loadLines(takeId); }, [takeId, loadLines]);
  useEffect(() => () => {
    pendingLineSaves.current.forEach((timer) => window.clearTimeout(timer));
    pendingLineSaves.current.clear();
  }, []);
  useEffect(() => {
    if (!takeId) return;
    const refresh = () => {
      void loadLines(takeId);
      if (clientId) void loadTakes(clientId);
    };
    const channel = db
      .channel(`practice-stock-take-${takeId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "practice_stock_take_items", filter: `stock_take_id=eq.${takeId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "practice_stock_takes", filter: `id=eq.${takeId}` }, refresh)
      .subscribe();
    const poll = window.setInterval(refresh, 8000);
    return () => {
      window.clearInterval(poll);
      void db.removeChannel(channel);
    };
  }, [clientId, loadLines, loadTakes, takeId]);

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
      const barcodeHeader = detectHeader(parsed.headers, ["barcode", "bar_code", "ean", "upc"], [/(barcode|bar_code|ean|upc)/]);
      const categoryHeader = detectHeader(parsed.headers, ["category", "group", "class"], [/(category|group|class)/]);
      const departmentHeader = detectHeader(parsed.headers, ["department", "dept"], [/^(department|dept)$/]);
      const unitHeader = detectHeader(parsed.headers, ["unit", "uom", "unit_of_measure"], [/^(unit|uom|unit_of_measure)$/]);
      const costHeader = detectHeader(parsed.headers, ["unit_cost", "cost", "cost_price", "average_cost"], [/(unit|average|avg).*(cost|price)/, /^(cost|cost_price)$/], [/(total|value|amount)/]);
      const movementHeader = detectHeader(parsed.headers, ["last_movement_date", "last_sale_date", "last_transaction_date"], [/(last).*(movement|sale|transaction).*(date)/]);
      const mapped: ImportLine[] = [];
      let skipped = 0;
      parsed.rows.forEach((row) => {
        const itemName = row[nameHeader]?.trim() || "";
        const systemQty = numberFrom(row[quantityHeader]);
        if (!itemName || systemQty == null) { skipped += 1; return; }
        mapped.push({
          item_code: codeHeader ? row[codeHeader]?.trim() || null : null,
          barcode: barcodeHeader ? row[barcodeHeader]?.trim() || null : null,
          item_name: itemName,
          category: categoryHeader ? row[categoryHeader]?.trim() || null : null,
          department: departmentHeader ? row[departmentHeader]?.trim() || null : null,
          unit: unitHeader ? row[unitHeader]?.trim() || null : null,
          system_qty: systemQty,
          unit_cost: costHeader ? numberFrom(row[costHeader]) || 0 : 0,
          last_movement_date: movementHeader ? row[movementHeader]?.trim().slice(0, 10) || null : null,
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

  const cancelPendingImport = () => {
    setImportLines([]);
    setSourceFile("");
    setMessage("Pending system-stock import cancelled.");
  };

  const removeTake = async () => {
    if (!takeId || selectedTake?.status === "completed") return;
    if (!window.confirm(`Remove “${selectedTake?.title || "this stock take"}” and all of its imported lines?`)) return;
    setSaving(true);
    const result = await db.from("practice_stock_takes").delete().eq("id", takeId);
    if (result.error) setMessage(result.error.message);
    else {
      setMessage("Imported stock take removed.");
      setTakeId("");
      setLines([]);
      await loadTakes(clientId);
    }
    setSaving(false);
  };

  const readPhysicalFile = async (file: File | null) => {
    if (!file || !takeId || !lines.length) return;
    try {
      const parsed = await parseBulkImportFile(file);
      const nameHeader = detectHeader(parsed.headers, ["item_name", "product_name", "description", "name", "item", "product"], [/^(item|product).*(name|description)$/, /^(item|product|description)$/]);
      const codeHeader = detectHeader(parsed.headers, ["item_code", "product_code", "sku", "code", "barcode"], [/(item|product).*code/, /^(sku|code|barcode)$/]);
      const physicalHeader = detectHeader(
        parsed.headers,
        ["physical_qty", "physical_quantity", "physical_count", "counted_qty", "actual_qty", "actual_quantity", "count", "quantity", "qty"],
        [/(physical|actual|counted).*(qty|quantity|count|stock)/, /^(physical_count|count|quantity|qty)$/],
        [/(system|book|expected|theoretical|cost|value|amount|rate)/]
      );
      if ((!nameHeader && !codeHeader) || !physicalHeader) {
        setMessage(`Could not identify ${!physicalHeader ? "a physical-count" : "an item code/name"} column. File columns: ${parsed.headers.join(", ") || "none"}.`);
        return;
      }
      const byCode = new Map(lines.filter((line) => line.item_code).map((line) => [matchKey(line.item_code), line.id]));
      const byName = new Map(lines.map((line) => [matchKey(line.item_name), line.id]));
      const counts = new Map<string, number>();
      let invalid = 0;
      let unmatched = 0;
      parsed.rows.forEach((row) => {
        const physical = numberFrom(row[physicalHeader]);
        if (physical == null) { invalid += 1; return; }
        const id = (codeHeader ? byCode.get(matchKey(row[codeHeader])) : undefined) || (nameHeader ? byName.get(matchKey(row[nameHeader])) : undefined);
        if (!id) { unmatched += 1; return; }
        counts.set(id, physical);
      });
      setLines((current) => current.map((line) => counts.has(line.id) ? { ...line, physical_qty: counts.get(line.id)! } : line));
      setMessage(`${counts.size} physical count(s) loaded from ${file.name}${unmatched ? `; ${unmatched} item(s) did not match` : ""}${invalid ? `; ${invalid} row(s) had no valid physical quantity` : ""}. Review, then Save counts.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read the physical-count file.");
    }
  };

  const readClassificationFile = async (file: File | null) => {
    if (!file || !takeId || !lines.length) return;
    try {
      const parsed = await parseBulkImportFile(file);
      const nameHeader = detectHeader(parsed.headers, ["item_name", "product_name", "description", "name", "item", "product"], [/^(item|product).*(name|description)$/, /^(item|product|description)$/]);
      const codeHeader = detectHeader(parsed.headers, ["item_code", "product_code", "sku", "code"], [/(item|product).*code/, /^(sku|code)$/]);
      const barcodeHeader = detectHeader(parsed.headers, ["barcode", "bar_code", "ean", "upc"], [/(barcode|bar_code|ean|upc)/]);
      const categoryHeader = detectHeader(parsed.headers, ["category", "group", "class"], [/(category|group|class)/]);
      const departmentHeader = detectHeader(parsed.headers, ["department", "dept"], [/^(department|dept)$/]);
      if ((!nameHeader && !codeHeader && !barcodeHeader) || (!categoryHeader && !departmentHeader)) {
        setMessage(`Could not identify an item column plus category or department. File columns: ${parsed.headers.join(", ") || "none"}.`);
        return;
      }

      const byBarcode = new Map(lines.filter((line) => line.barcode).map((line) => [matchKey(line.barcode), line.id]));
      const byCode = new Map(lines.filter((line) => line.item_code).map((line) => [matchKey(line.item_code), line.id]));
      const byName = new Map(lines.map((line) => [matchKey(line.item_name), line.id]));
      const updates = new Map<string, Partial<Pick<StockLine, "category" | "department">>>();
      let unmatched = 0;
      let skipped = 0;

      parsed.rows.forEach((row) => {
        const id =
          (barcodeHeader ? byBarcode.get(matchKey(row[barcodeHeader])) : undefined) ||
          (codeHeader ? byCode.get(matchKey(row[codeHeader])) : undefined) ||
          (nameHeader ? byName.get(matchKey(row[nameHeader])) : undefined);
        if (!id) { unmatched += 1; return; }
        const categoryValue = categoryHeader ? row[categoryHeader]?.trim() || null : undefined;
        const departmentValue = departmentHeader ? row[departmentHeader]?.trim() || null : undefined;
        const update: Partial<Pick<StockLine, "category" | "department">> = {};
        if (categoryValue) update.category = categoryValue;
        if (departmentValue) update.department = departmentValue;
        if (!Object.keys(update).length) { skipped += 1; return; }
        updates.set(id, { ...updates.get(id), ...update });
      });

      if (!updates.size) {
        setMessage(`No category or department values were matched from ${file.name}${unmatched ? `; ${unmatched} row(s) did not match stock items` : ""}.`);
        return;
      }

      setSaving(true);
      const results = await Promise.all(Array.from(updates.entries()).map(([id, update]) => db.from("practice_stock_take_items").update(update).eq("id", id)));
      const failed = results.find((result) => result.error)?.error;
      if (failed) setMessage(failed.message);
      else {
        setLines((current) => current.map((line) => updates.has(line.id) ? { ...line, ...updates.get(line.id)! } : line));
        setMessage(`${updates.size} item(s) updated from ${file.name}${unmatched ? `; ${unmatched} row(s) did not match` : ""}${skipped ? `; ${skipped} matched row(s) had no category or department value` : ""}.`);
        await loadLines(takeId);
        await loadTakes(clientId);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read the category/department file.");
    } finally {
      setSaving(false);
    }
  };

  const saveCounts = async (complete = false) => {
    if (!takeId) return;
    setSaving(true);
    const results = await Promise.all(lines.map((line) => db.from("practice_stock_take_items").update({ physical_qty: line.physical_qty, counted_by: line.physical_qty == null ? null : user?.id || null, counted_by_name: line.physical_qty == null ? null : user?.email || "Counter", counted_at: line.physical_qty == null ? null : new Date().toISOString() }).eq("id", line.id)));
    const failed = results.find((result) => result.error)?.error;
    if (failed) setMessage(failed.message);
    else {
      if (complete) await db.from("practice_stock_takes").update({ status: "submitted", completed_at: new Date().toISOString(), completed_by: user?.id || null }).eq("id", takeId);
      localStorage.removeItem(`boat.practice.stocktake.${takeId}`);
      setMessage(complete ? "Stock take submitted for approval." : "Physical counts saved. You can continue later.");
      await loadTakes(clientId);
    }
    setSaving(false);
  };

  const updatePhysical = (lineId: string, value: number | null) => {
    setLines((current) => {
      const next = current.map((row) => row.id === lineId ? { ...row, physical_qty: value, counted_by_name: user?.email || "Counter" } : row);
      localStorage.setItem(`boat.practice.stocktake.${takeId}`, JSON.stringify(next));
      return next;
    });
    const existing = pendingLineSaves.current.get(lineId);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(async () => {
      pendingLineSaves.current.delete(lineId);
      if (!takeId) return;
      const result = await db.from("practice_stock_take_items").update({
        physical_qty: value,
        counted_by: value == null ? null : user?.id || null,
        counted_by_name: value == null ? null : user?.email || "Counter",
        counted_at: value == null ? null : new Date().toISOString(),
      }).eq("id", lineId);
      if (result.error) setMessage(`${result.error.message}. Count kept on this device until you save again.`);
      else if (!pendingLineSaves.current.size) localStorage.removeItem(`boat.practice.stocktake.${takeId}`);
    }, 700);
    pendingLineSaves.current.set(lineId, timer);
  };

  const scanBarcode = () => {
    const key = matchKey(barcode);
    const found = lines.find((line) => matchKey(line.barcode) === key || matchKey(line.item_code) === key);
    if (!found) { setMessage(`No stock item matches barcode/code ${barcode}.`); return; }
    setSearch(found.item_name);
    setBarcode("");
    setMessage(`${found.item_name} selected for counting.`);
  };

  const approveAndPost = async () => {
    if (!orgId || !clientId || !takeId || selectedTake?.status !== "submitted") return;
    const shortageValue = lines.reduce((sum, line) => { const value = ((line.physical_qty ?? line.system_qty) - line.system_qty) * line.unit_cost; return sum + Math.max(0, -value); }, 0);
    const surplusValue = lines.reduce((sum, line) => { const value = ((line.physical_qty ?? line.system_qty) - line.system_qty) * line.unit_cost; return sum + Math.max(0, value); }, 0);
    setSaving(true);
    const header = await db.from("practice_stock_adjustments").insert({ organization_id: orgId, client_id: clientId, stock_take_id: takeId, entry_date: selectedTake.stock_date, inventory_account: inventoryAccount, gain_loss_account: gainLossAccount, shortage_value: shortageValue, surplus_value: surplusValue, posted_by: user?.id || null }).select("id").single();
    if (header.error) { setMessage(header.error.message); setSaving(false); return; }
    const adjustmentId = header.data.id;
    const journalLines = [
      ...(surplusValue > 0 ? [{ organization_id: orgId, adjustment_id: adjustmentId, account_name: inventoryAccount, debit: surplusValue, credit: 0, description: "Stock surplus" }, { organization_id: orgId, adjustment_id: adjustmentId, account_name: gainLossAccount, debit: 0, credit: surplusValue, description: "Stock gain" }] : []),
      ...(shortageValue > 0 ? [{ organization_id: orgId, adjustment_id: adjustmentId, account_name: gainLossAccount, debit: shortageValue, credit: 0, description: "Stock loss" }, { organization_id: orgId, adjustment_id: adjustmentId, account_name: inventoryAccount, debit: 0, credit: shortageValue, description: "Stock shortage" }] : []),
    ];
    const details = journalLines.length ? await db.from("practice_stock_adjustment_lines").insert(journalLines) : { error: null };
    if (details.error) { await db.from("practice_stock_adjustments").delete().eq("id", adjustmentId); setMessage(details.error.message); }
    else { await db.from("practice_stock_takes").update({ status: "adjusted" }).eq("id", takeId); setMessage("Approved. Balanced client stock-adjustment journal posted."); await loadTakes(clientId); }
    setSaving(false);
  };

  const selectedTake = takes.find((take) => take.id === takeId);
  const categories = useMemo(() => Array.from(new Set(lines.map((line) => line.category).filter(Boolean) as string[])).sort(), [lines]);
  const filtered = useMemo(() => lines.filter((line) => {
    const needle = search.trim().toLowerCase();
    if (needle && !`${line.item_code || ""} ${line.item_name}`.toLowerCase().includes(needle)) return false;
    if (category && line.category !== category) return false;
    const variance = line.physical_qty == null ? null : line.physical_qty - line.system_qty;
    const varianceValue = variance == null ? null : variance * line.unit_cost;
    if (reportView === "missing" && !(variance != null && variance < 0)) return false;
    if (reportView === "excess" && !(variance != null && variance > 0)) return false;
    if (reportView === "high_value" && !(varianceValue != null && Math.abs(varianceValue) >= 100000)) return false;
    if (reportView === "slow") {
      const cutoff = Date.now() - 90 * 86400000;
      if (!line.last_movement_date || new Date(line.last_movement_date).getTime() > cutoff) return false;
    }
    if (varianceFilter === "uncounted") return variance == null;
    if (varianceFilter === "variance") return variance != null && Math.abs(variance) > 0.0001;
    if (varianceFilter === "shortage") return variance != null && variance < -0.0001;
    if (varianceFilter === "surplus") return variance != null && variance > 0.0001;
    return true;
  }), [category, lines, reportView, search, varianceFilter]);
  const counted = lines.filter((line) => line.physical_qty != null);
  const varianceValue = counted.reduce((sum, line) => sum + (Number(line.physical_qty) - line.system_qty) * line.unit_cost, 0);
  const filteredCounted = filtered.filter((line) => line.physical_qty != null);
  const filteredVarianceQty = filteredCounted.reduce((sum, line) => sum + Number(line.physical_qty) - line.system_qty, 0);
  const filteredVarianceValue = filteredCounted.reduce((sum, line) => sum + (Number(line.physical_qty) - line.system_qty) * line.unit_cost, 0);
  const openTakes = takes.filter((take) => take.status === "draft" || take.status === "submitted");
  const completedTakes = takes.filter((take) => take.status === "completed" || take.status === "adjusted");
  const dashboardVariance = allTakeLines.filter((line) => line.physical_qty != null).reduce((sum, line) => sum + (Number(line.physical_qty) - line.system_qty) * line.unit_cost, 0);
  const notCounted = allTakeLines.filter((line) => line.physical_qty == null).length;
  const ranked = [...lines].filter((line) => line.physical_qty != null).map((line) => ({ ...line, varianceValue: (Number(line.physical_qty) - line.system_qty) * line.unit_cost }));
  const topShortages = ranked.filter((line) => line.varianceValue < 0).sort((a, b) => a.varianceValue - b.varianceValue).slice(0, 5);
  const topSurpluses = ranked.filter((line) => line.varianceValue > 0).sort((a, b) => b.varianceValue - a.varianceValue).slice(0, 5);
  const departmentSummary = Array.from(filtered.reduce((map, line) => { const key = line.department || line.category || "Uncategorised"; const value = line.physical_qty == null ? 0 : (line.physical_qty - line.system_qty) * line.unit_cost; map.set(key, (map.get(key) || 0) + value); return map; }, new Map<string, number>()).entries()).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

  const downloadReport = () => {
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = [["Item code", "Item name", "Category", "Department", "Unit", "System qty", "Physical qty", "Variance qty", "Unit cost", "Variance value"], ...filtered.map((line) => {
      const variance = line.physical_qty == null ? "" : line.physical_qty - line.system_qty;
      return [line.item_code || "", line.item_name, line.category || "", line.department || "", line.unit || "", line.system_qty, line.physical_qty ?? "", variance, line.unit_cost, variance === "" ? "" : Number(variance) * line.unit_cost];
    })];
    const blob = new Blob([rows.map((row) => row.map(escape).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `stock_take_${selectedTake?.stock_date || stockDate}.csv`; link.click(); URL.revokeObjectURL(link.href);
  };

  return <div className="practice-stocktake-page space-y-6 p-4 md:p-8">
    <style>{`${blindCount ? ".practice-stocktake-page table th:nth-child(4),.practice-stocktake-page table td:nth-child(4){display:none}" : ""}@media(max-width:767px){.practice-stocktake-page table{display:none}}`}</style>
    {readOnly && <ReadOnlyNotice />}
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><PackageCheck className="h-7 w-7 text-brand-700"/><h1 className="text-3xl font-bold text-slate-900">Stock Take</h1></div><p className="mt-1 text-sm text-slate-500">Import a client’s system stock, capture physical counts, and report variances.</p></div><button className="app-btn-secondary" onClick={() => void loadTakes(clientId)}><RefreshCw className="h-4 w-4"/> Refresh</button></div>
    {message && <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">{message}</div>}
    <div className="flex gap-1 overflow-x-auto rounded-xl border bg-white p-1">{([['dashboard','Dashboard'],['count','Count Stock'],['reports','Variance Reports'],['adjustments','Adjustments']] as const).map(([value,label]) => <button key={value} type="button" onClick={() => setWorkspaceTab(value)} className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold ${workspaceTab === value ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{label}</button>)}</div>
    <div className="rounded-xl border bg-white p-4"><label className="text-xs text-slate-600">Client<select className={`${input} mt-1 w-full max-w-md`} value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">Select client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label></div>
    {workspaceTab === "dashboard" && <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><DashboardMetric label="Open stock takes" value={String(openTakes.length)}/><DashboardMetric label="Completed stock takes" value={String(completedTakes.length)}/><DashboardMetric label="Variance value" value={dashboardVariance.toLocaleString("en-UG", { maximumFractionDigits: 2 })}/><DashboardMetric label="Items not counted" value={String(notCounted)}/></div><div className="grid gap-4 lg:grid-cols-2"><RankedVariance title="Top shortages" rows={topShortages}/><RankedVariance title="Top surpluses" rows={topSurpluses}/></div></>}
    {workspaceTab === "count" && <div className="grid gap-4 rounded-xl border bg-white p-4 lg:grid-cols-5">
      <label className="text-xs text-slate-600">Title<input className={`${input} mt-1 w-full`} value={title} onChange={(event) => setTitle(event.target.value)}/></label>
      <label className="text-xs text-slate-600">Stock date<input className={`${input} mt-1 w-full`} type="date" value={stockDate} onChange={(event) => setStockDate(event.target.value)}/></label>
      <label className="app-btn-secondary mt-5 cursor-pointer"><FileSpreadsheet className="h-4 w-4"/> Upload CSV / Excel<input type="file" accept=".csv,.xls,.xlsx" className="hidden" disabled={readOnly || !clientId} onChange={(event) => void readFile(event.target.files?.[0] || null)}/></label>
      <button className="app-btn-primary mt-5" disabled={readOnly || saving || !importLines.length} onClick={() => void createTake()}><Upload className="h-4 w-4"/> Import {importLines.length || "stock"}</button>
      {sourceFile && <div className="flex items-center justify-between gap-3 text-xs text-slate-500 lg:col-span-5"><p>Ready: {sourceFile}. Required columns: item/name and system quantity. Optional: code, category, department, unit, unit cost.</p><button type="button" className="inline-flex items-center gap-1 font-semibold text-rose-700" onClick={cancelPendingImport}><X className="h-4 w-4"/> Cancel upload</button></div>}
    </div>}
    <div className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-4"><label className="text-xs text-slate-600 md:col-span-2">Saved stock take<select className={`${input} mt-1 w-full`} value={takeId} onChange={(event) => setTakeId(event.target.value)}><option value="">No stock take selected</option>{takes.map((take) => <option key={take.id} value={take.id}>{take.stock_date} · {take.title} · {take.status}</option>)}</select></label><Metric label="Counted" value={`${counted.length}/${lines.length}`}/><Metric label="Variance value" value={varianceValue.toLocaleString("en-UG", { maximumFractionDigits: 2 })}/></div>
    {takeId && <>
      {workspaceTab === "count" && <>
      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4">
        <label className="text-xs text-slate-600">Search item<input className={`${input} mt-1 block`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Code or item name"/></label>
        <label className="text-xs text-slate-600">Scan barcode<div className="mt-1 flex"><input className={`${input} rounded-r-none`} value={barcode} onChange={(event) => setBarcode(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") scanBarcode(); }} placeholder="Scan or type"/><button type="button" className="rounded-r-lg bg-slate-900 px-3 text-white" onClick={scanBarcode}><ScanBarcode className="h-4 w-4"/></button></div></label>
        <label className="text-xs text-slate-600">Category<select className={`${input} mt-1 block`} value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{categories.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="text-xs text-slate-600">Report<select className={`${input} mt-1 block`} value={reportView} onChange={(event) => setReportView(event.target.value as typeof reportView)}><option value="all">All items</option><option value="missing">Missing stock</option><option value="excess">Excess stock</option><option value="slow">Slow-moving (90+ days)</option><option value="high_value">High-value variances</option><option value="department">Department variance</option></select></label>
        <label className="inline-flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={blindCount} onChange={(event) => setBlindCount(event.target.checked)}/><EyeOff className="h-4 w-4"/> Blind count</label><span className="pb-2 text-xs text-slate-500">{filtered.length} shown</span>
        <div className="w-full flex flex-wrap gap-2"><label className={`app-btn-secondary cursor-pointer ${readOnly || selectedTake?.status !== "draft" ? "pointer-events-none opacity-50" : ""}`}><FileSpreadsheet className="h-4 w-4"/> Import physical counts<input type="file" accept=".csv,.xls,.xlsx" className="hidden" disabled={readOnly || selectedTake?.status !== "draft"} onChange={(event) => { void readPhysicalFile(event.target.files?.[0] || null); event.currentTarget.value = ""; }}/></label><label className={`app-btn-secondary cursor-pointer ${readOnly || saving || selectedTake?.status !== "draft" ? "pointer-events-none opacity-50" : ""}`}><FileSpreadsheet className="h-4 w-4"/> Update category/department<input type="file" accept=".csv,.xls,.xlsx" className="hidden" disabled={readOnly || saving || selectedTake?.status !== "draft"} onChange={(event) => { void readClassificationFile(event.target.files?.[0] || null); event.currentTarget.value = ""; }}/></label><button className="app-btn-secondary" onClick={downloadReport}><Download className="h-4 w-4"/> CSV report</button><button className="app-btn-secondary" onClick={() => window.print()}><Printer className="h-4 w-4"/> Print</button>{selectedTake?.status === "draft" && <button className="app-btn-secondary text-rose-700" disabled={readOnly || saving} onClick={() => void removeTake()}><Trash2 className="h-4 w-4"/> Remove import</button>}<button className="app-btn-primary" disabled={readOnly || saving || selectedTake?.status !== "draft"} onClick={() => void saveCounts(false)}>Save & continue later</button><button className="app-btn-primary" disabled={readOnly || saving || selectedTake?.status !== "draft" || counted.length !== lines.length} onClick={() => void saveCounts(true)}><Send className="h-4 w-4"/> Submit for approval</button></div>
      </div>
      {selectedTake?.status === "submitted" && <div className="grid gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 md:grid-cols-3"><input className={input} value={inventoryAccount} onChange={(event) => setInventoryAccount(event.target.value)} placeholder="Inventory account"/><input className={input} value={gainLossAccount} onChange={(event) => setGainLossAccount(event.target.value)} placeholder="Stock gain/loss account"/><button className="app-btn-primary" disabled={readOnly || saving || !inventoryAccount.trim() || !gainLossAccount.trim()} onClick={() => void approveAndPost()}><ShieldCheck className="h-4 w-4"/> Approve & post adjustment</button><p className="text-xs text-amber-800 md:col-span-3">Shortage: Dr Stock Gain/Loss, Cr Inventory. Surplus: Dr Inventory, Cr Stock Gain/Loss. Posts to the client practice journal, not the firm ledger.</p></div>}
      {reportView === "department" && <div className="rounded-xl border bg-white p-4"><h3 className="font-semibold">Department variance report</h3><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{departmentSummary.map(([name, value]) => <Metric key={name} label={name} value={value.toLocaleString("en-UG", { maximumFractionDigits: 2 })}/>)}</div></div>}
      <div className="space-y-3 md:hidden">{filtered.map((line) => { const variance = line.physical_qty == null ? null : line.physical_qty - line.system_qty; return <div key={line.id} className="rounded-xl border bg-white p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{line.item_name}</p><p className="text-xs text-slate-500">{line.item_code || line.barcode || "No code"} · {line.category || "Uncategorised"}</p></div>{!blindCount && <span className="text-xs text-slate-500">System {line.system_qty}</span>}</div><label className="mt-3 block text-xs text-slate-600">Physical count<input className="mt-1 w-full rounded-lg border px-3 py-3 text-lg" type="number" step="any" value={line.physical_qty ?? ""} disabled={readOnly || selectedTake?.status !== "draft"} onChange={(event) => updatePhysical(line.id, event.target.value === "" ? null : Number(event.target.value))}/></label><div className="mt-2 flex justify-between text-xs"><span>Counter: {line.counted_by_name || user?.email || "Not counted"}</span>{!blindCount && <span className={variance != null && variance < 0 ? "text-rose-700" : "text-emerald-700"}>Variance {variance ?? "—"}</span>}</div></div>; })}</div>
      <div className="overflow-auto rounded-xl border bg-white"><div className="border-b p-4"><h2 className="font-semibold">{selectedTake?.title}</h2><p className="text-xs text-slate-500">{clients.find((client) => client.id === clientId)?.name} · {selectedTake?.stock_date} · System stock from {selectedTake?.source_file || "uploaded file"}</p></div><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="p-3 text-left">Code</th><th className="p-3 text-left">Item</th><th className="p-3 text-left">Category</th><th className="p-3 text-right">System</th><th className="p-3 text-right">Physical</th><th className="p-3 text-right">Variance</th><th className="p-3 text-right">Variance value</th></tr></thead><tbody>{filtered.map((line) => { const variance = line.physical_qty == null ? null : line.physical_qty - line.system_qty; return <tr key={line.id} className={`border-t ${variance != null && variance < 0 ? "bg-rose-50" : variance != null && variance > 0 ? "bg-emerald-50" : ""}`}><td className="p-3 text-slate-500">{line.item_code || "—"}</td><td className="p-3 font-medium">{line.item_name}<p className="text-xs font-normal text-slate-400">{line.unit || ""}</p></td><td className="p-3">{line.category || "—"}</td><td className="p-3 text-right tabular-nums">{line.system_qty}</td><td className="p-2 text-right"><input className="w-28 rounded-lg border px-2 py-1.5 text-right tabular-nums" type="number" step="any" value={line.physical_qty ?? ""} disabled={readOnly || selectedTake?.status !== "draft"} onChange={(event) => updatePhysical(line.id, event.target.value === "" ? null : Number(event.target.value))}/></td><td className="p-3 text-right font-semibold tabular-nums">{variance == null ? "—" : variance}</td><td className="p-3 text-right tabular-nums">{variance == null ? "—" : (variance * line.unit_cost).toLocaleString("en-UG", { maximumFractionDigits: 2 })}</td></tr>; })}</tbody><tfoot><tr className="border-t-2 bg-slate-50 font-semibold"><td className="p-3" colSpan={5}>Filtered report totals</td><td className="p-3 text-right">{filteredVarianceQty}</td><td className="p-3 text-right">{filteredVarianceValue.toLocaleString("en-UG", { maximumFractionDigits: 2 })}</td></tr></tfoot></table>{!loading && !filtered.length && <p className="p-8 text-center text-sm text-slate-500">No stock lines match the filters.</p>}</div>
      </>}
      {workspaceTab === "reports" && <VarianceReportPanel reportView={reportView} setReportView={setReportView} rows={filtered} departments={departmentSummary} download={downloadReport}/>} 
      {workspaceTab === "adjustments" && (selectedTake?.status === "submitted" ? <div className="grid gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 md:grid-cols-3"><input className={input} value={inventoryAccount} onChange={(event) => setInventoryAccount(event.target.value)} placeholder="Inventory account"/><input className={input} value={gainLossAccount} onChange={(event) => setGainLossAccount(event.target.value)} placeholder="Stock gain/loss account"/><button className="app-btn-primary" disabled={readOnly || saving} onClick={() => void approveAndPost()}><ShieldCheck className="h-4 w-4"/> Approve & post adjustment</button><p className="text-xs text-amber-800 md:col-span-3">Shortage: Dr Stock Gain/Loss, Cr Inventory. Surplus: Dr Inventory, Cr Stock Gain/Loss.</p></div> : <div className="rounded-xl border bg-white p-8 text-center text-sm text-slate-500">This stock take has no adjustment awaiting approval.</div>)}
    </>}
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="font-semibold text-slate-900">{value}</p></div>; }
function DashboardMetric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border bg-white p-4"><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold text-slate-900">{value}</p></div>; }
function RankedVariance({ title, rows }: { title: string; rows: Array<StockLine & { varianceValue: number }> }) { return <div className="rounded-xl border bg-white p-4"><div className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-brand-700"/><h3 className="font-semibold">{title}</h3></div><div className="mt-3 space-y-2">{rows.map((row) => <div key={row.id} className="flex justify-between gap-3 text-sm"><span className="truncate">{row.item_name}</span><span className={row.varianceValue < 0 ? "font-semibold text-rose-700" : "font-semibold text-emerald-700"}>{row.varianceValue.toLocaleString("en-UG", { maximumFractionDigits: 2 })}</span></div>)}{!rows.length && <p className="text-sm text-slate-500">No variances yet.</p>}</div></div>; }
function VarianceReportPanel({ reportView, setReportView, rows, departments, download }: { reportView: "all" | "missing" | "excess" | "slow" | "high_value" | "department"; setReportView: (value: "all" | "missing" | "excess" | "slow" | "high_value" | "department") => void; rows: StockLine[]; departments: Array<[string, number]>; download: () => void }) { return <div className="space-y-4"><div className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4"><label className="text-xs text-slate-600">Report type<select className={`${input} mt-1 block`} value={reportView} onChange={(event) => setReportView(event.target.value as typeof reportView)}><option value="all">All variances</option><option value="missing">Missing stock</option><option value="excess">Excess stock</option><option value="slow">Slow-moving items</option><option value="high_value">High-value variances</option><option value="department">Department variance</option></select></label><button className="app-btn-secondary" onClick={download}><Download className="h-4 w-4"/> Download report</button></div>{reportView === "department" ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{departments.map(([name, value]) => <Metric key={name} label={name} value={value.toLocaleString("en-UG", { maximumFractionDigits: 2 })}/>)}</div> : <div className="rounded-xl border bg-white p-4"><h3 className="font-semibold">Variance analysis</h3><div className="mt-3 divide-y">{rows.map((line) => { const variance = line.physical_qty == null ? null : line.physical_qty - line.system_qty; return <div key={line.id} className="grid gap-1 py-3 text-sm sm:grid-cols-4"><span className="font-medium">{line.item_name}</span><span>{line.category || "Uncategorised"}</span><span>Variance {variance ?? "—"}</span><span className="text-right font-semibold">{variance == null ? "—" : (variance * line.unit_cost).toLocaleString("en-UG", { maximumFractionDigits: 2 })}</span></div>; })}{!rows.length && <p className="py-6 text-center text-sm text-slate-500">No rows match this report.</p>}</div></div>}</div>; }
