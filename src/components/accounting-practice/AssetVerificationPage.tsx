import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Filter,
  PackageCheck,
  Printer,
  RefreshCw,
  ScanBarcode,
  Send,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { parseBulkImportFile } from "../../lib/saccoBulkImport";
import { supabase } from "../../lib/supabase";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";

const db = supabase as any;
const input = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
type Client = { id: string; name: string };
type Verification = {
  id: string;
  client_id: string | null;
  title: string;
  verification_date: string;
  source_mode: "upload" | "system_register";
  source_file: string | null;
  status: "draft" | "submitted" | "approved";
  review_notes: string | null;
  created_at: string;
};
type Condition = "good" | "fair" | "poor" | "damaged";
type VerificationItem = {
  id: string;
  asset_code: string;
  barcode: string | null;
  asset_name: string;
  category: string | null;
  expected_location: string | null;
  expected_custodian: string | null;
  system_quantity: number;
  observed_quantity: number | null;
  book_value: number;
  observed_present: boolean | null;
  observed_condition: Condition | null;
  observed_location: string | null;
  observed_custodian: string | null;
  notes: string | null;
  verified_by_name: string | null;
  verified_at: string | null;
  source_asset_id?: string | null;
};
type ImportItem = Omit<VerificationItem, "id" | "verified_by_name" | "verified_at">;

const normalize = (value: string | null | undefined) => String(value || "").trim().toLowerCase();
const numberFrom = (value: string | undefined) => {
  const parsed = Number(String(value || "0").replace(/,/g, "").replace(/[()]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};
const detect = (headers: string[], aliases: string[], pattern: RegExp) =>
  aliases.find((alias) => headers.includes(alias)) || headers.find((header) => pattern.test(header)) || "";
const csvCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

function hasDiscrepancy(item: VerificationItem) {
  if (item.observed_present === false) return true;
  if (item.observed_present !== true) return false;
  if (item.observed_quantity != null && Number(item.observed_quantity) !== Number(item.system_quantity || 0)) return true;
  return (
    (item.observed_condition != null && item.observed_condition !== "good") ||
    (!!item.observed_location && normalize(item.observed_location) !== normalize(item.expected_location)) ||
    (!!item.observed_custodian && normalize(item.observed_custodian) !== normalize(item.expected_custodian))
  );
}

export function AssetVerificationPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const orgId = user?.organization_id || null;
  const isPractice = user?.business_type === "accounting_practice";
  const enabled = isPractice || user?.enable_asset_verification === true;
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [sessions, setSessions] = useState<Verification[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [items, setItems] = useState<VerificationItem[]>([]);
  const [importItems, setImportItems] = useState<ImportItem[]>([]);
  const [sourceFile, setSourceFile] = useState("");
  const [sourceMode, setSourceMode] = useState<"upload" | "system_register">(isPractice ? "upload" : "system_register");
  const [title, setTitle] = useState("Asset verification");
  const [verificationDate, setVerificationDate] = useState(new Date().toISOString().slice(0, 10));
  const [barcode, setBarcode] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "unverified" | "missing" | "discrepancy">("all");
  const [locationFilter, setLocationFilter] = useState("");
  const [verificationLocation, setVerificationLocation] = useState("");
  const [quickPhysicalCount, setQuickPhysicalCount] = useState("");
  const [locationWiseMode, setLocationWiseMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [selectedLocationNames, setSelectedLocationNames] = useState<string[]>([]);
  const [knownLocations, setKnownLocations] = useState<string[]>([]);
  const [copyLastCount, setCopyLastCount] = useState(false);
  const [tab, setTab] = useState<"dashboard" | "verify" | "report">("dashboard");
  const [reviewNotes, setReviewNotes] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selected = sessions.find((row) => row.id === sessionId) || null;
  const locked = readOnly || selected?.status !== "draft";

  const loadClients = useCallback(async () => {
    if (!orgId || !isPractice) return;
    const result = await db.from("practice_clients").select("id,name").eq("organization_id", orgId).eq("status", "active").order("name");
    if (result.error) setMessage(result.error.message);
    else {
      const rows = (result.data || []) as Client[];
      setClients(rows);
      setClientId((current) => current || rows[0]?.id || "");
    }
  }, [isPractice, orgId]);

  const loadSessions = useCallback(async () => {
    if (!orgId || !enabled || (isPractice && !clientId)) {
      setSessions([]); setSessionId(""); setLoading(false); return;
    }
    setLoading(true);
    let query = db.from("asset_verifications").select("*").eq("organization_id", orgId);
    query = isPractice ? query.eq("client_id", clientId) : query.is("client_id", null);
    const result = await query.order("verification_date", { ascending: false }).order("created_at", { ascending: false });
    if (result.error) setMessage(result.error.message);
    else {
      const rows = (result.data || []) as Verification[];
      setSessions(rows);
      setSessionId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id || "");
    }
    setLoading(false);
  }, [clientId, enabled, isPractice, orgId]);

  const loadItems = useCallback(async (id: string) => {
    if (!id) { setItems([]); return; }
    const result = await db.from("asset_verification_items").select("*").eq("verification_id", id).order("asset_name");
    if (result.error) setMessage(result.error.message);
    else setItems(((result.data || []) as VerificationItem[]).map((row) => ({
      ...row,
      book_value: Number(row.book_value || 0),
      system_quantity: Number(row.system_quantity ?? 1),
      observed_quantity: row.observed_quantity == null ? null : Number(row.observed_quantity),
    })));
  }, []);

  const loadKnownLocations = useCallback(async () => {
    if (!orgId || !enabled || (isPractice && !clientId)) {
      setKnownLocations([]);
      return;
    }
    let query = db
      .from("asset_verification_items")
      .select("expected_location,observed_location,asset_verifications!inner(client_id)")
      .eq("organization_id", orgId);
    query = isPractice ? query.eq("asset_verifications.client_id", clientId) : query.is("asset_verifications.client_id", null);
    const result = await query.limit(1000);
    if (result.error) return;
    const names = new Set<string>();
    (result.data || []).forEach((row: any) => {
      [row.expected_location, row.observed_location].forEach((value) => {
        const cleaned = String(value || "").trim();
        if (cleaned) names.add(cleaned);
      });
    });
    setKnownLocations(Array.from(names).sort((a, b) => a.localeCompare(b)));
  }, [clientId, enabled, isPractice, orgId]);

  useEffect(() => { void loadClients(); }, [loadClients]);
  useEffect(() => { void loadSessions(); }, [loadSessions]);
  useEffect(() => { void loadItems(sessionId); }, [loadItems, sessionId]);
  useEffect(() => { void loadKnownLocations(); }, [loadKnownLocations, sessions.length]);
  useEffect(() => { setReviewNotes(selected?.review_notes || ""); }, [selected?.id, selected?.review_notes]);

  const readFile = async (file: File | null) => {
    if (!file) return;
    try {
      const parsed = await parseBulkImportFile(file);
      const code = detect(parsed.headers, ["asset_code", "asset_id", "code", "tag_number", "tag"], /(asset|tag).*code|^(code|tag)$/);
      const name = detect(parsed.headers, ["asset_name", "name", "description", "asset"], /(asset.*name)|^(name|description|asset)$/);
      if (!code || !name) {
        setMessage(`Could not identify asset code and name columns. File columns: ${parsed.headers.join(", ") || "none"}.`);
        setImportItems([]); setSourceFile(file.name); return;
      }
      const barcodeHeader = detect(parsed.headers, ["barcode", "qr_code", "qr", "serial_number"], /(barcode|qr|serial)/);
      const category = detect(parsed.headers, ["category", "class", "asset_class"], /(category|class)/);
      const location = detect(parsed.headers, ["location", "room", "branch", "expected_location"], /(location|room|branch)/);
      const custodian = detect(parsed.headers, ["custodian", "assigned_to", "employee", "user"], /(custodian|assigned|employee)/);
      const quantity = detect(parsed.headers, ["system_quantity", "system_qty", "expected_quantity", "expected_qty", "quantity", "qty"], /(system|expected|book).*(qty|quantity)|^(quantity|qty)$/);
      const observedQuantity = detect(parsed.headers, ["observed_quantity", "physical_quantity", "physical_qty", "counted_quantity", "counted_qty", "actual_quantity", "actual_qty"], /(observed|physical|counted|actual).*(qty|quantity)/);
      const value = detect(parsed.headers, ["book_value", "net_book_value", "cost", "value"], /(book.*value|net.*value|cost|value)/);
      const seen = new Set<string>();
      const mapped: ImportItem[] = [];
      for (const row of parsed.rows) {
        const assetCode = row[code]?.trim();
        const assetName = row[name]?.trim();
        if (!assetCode || !assetName || seen.has(normalize(assetCode))) continue;
        seen.add(normalize(assetCode));
        mapped.push({
          asset_code: assetCode,
          barcode: barcodeHeader ? row[barcodeHeader]?.trim() || null : null,
          asset_name: assetName,
          category: category ? row[category]?.trim() || null : null,
          expected_location: location ? row[location]?.trim() || null : null,
          expected_custodian: custodian ? row[custodian]?.trim() || null : null,
          system_quantity: quantity ? numberFrom(row[quantity]) || 1 : 1,
          observed_quantity: observedQuantity ? numberFrom(row[observedQuantity]) : null,
          book_value: value ? numberFrom(row[value]) : 0,
          observed_present: observedQuantity ? numberFrom(row[observedQuantity]) > 0 : null,
          observed_condition: null,
          observed_location: null,
          observed_custodian: null,
          notes: null,
          source_asset_id: null,
        });
      }
      setSourceFile(file.name); setImportItems(mapped);
      setMessage(`${mapped.length} unique asset(s) ready to import from ${file.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read the asset register.");
    }
  };

  const importSystemBalances = async (file: File | null) => {
    if (!file) {
      setMessage("No system balance file was selected.");
      return;
    }
    if (!orgId || !sessionId) {
      setMessage("Select a draft verification campaign before importing system balances.");
      return;
    }
    if (locked) {
      setMessage("System balances can only be imported into a draft verification campaign.");
      return;
    }
    setSaving(true); setMessage(`Importing system balances from ${file.name}...`);
    try {
      const parsed = await parseBulkImportFile(file);
      const code = detect(parsed.headers, ["asset_code", "asset_id", "code", "tag_number", "tag"], /(asset|tag).*code|^(code|tag)$/);
      const quantity = detect(parsed.headers, ["system_quantity", "system_qty", "expected_quantity", "expected_qty", "book_quantity", "book_qty", "quantity", "qty", "balance"], /(system|expected|book).*(qty|quantity|balance)|^(quantity|qty|balance)$/);
      if (!code || !quantity) {
        setMessage(`Could not identify asset code and system quantity columns. File columns: ${parsed.headers.join(", ") || "none"}.`);
        setSaving(false);
        return;
      }
      const name = detect(parsed.headers, ["asset_name", "name", "description", "asset"], /(asset.*name)|^(name|description|asset)$/);
      const barcodeHeader = detect(parsed.headers, ["barcode", "qr_code", "qr", "serial_number"], /(barcode|qr|serial)/);
      const category = detect(parsed.headers, ["category", "class", "asset_class"], /(category|class)/);
      const location = detect(parsed.headers, ["location", "room", "branch", "expected_location"], /(location|room|branch)/);
      const custodian = detect(parsed.headers, ["custodian", "assigned_to", "employee", "user"], /(custodian|assigned|employee)/);
      const value = detect(parsed.headers, ["book_value", "net_book_value", "cost", "value"], /(book.*value|net.*value|cost|value)/);
      const existingByCode = new Map(items.map((item) => [normalize(item.asset_code), item]));
      const seen = new Set<string>();
      let updated = 0;
      let inserted = 0;
      let skipped = 0;
      for (const row of parsed.rows) {
        const assetCode = row[code]?.trim();
        const key = normalize(assetCode);
        if (!assetCode || !key || seen.has(key)) { skipped += 1; continue; }
        seen.add(key);
        const systemQuantity = numberFrom(row[quantity]);
        const existing = existingByCode.get(key);
        const patch: Partial<VerificationItem> = {
          system_quantity: systemQuantity,
          ...(name ? { asset_name: row[name]?.trim() || existing?.asset_name || assetCode } : {}),
          ...(barcodeHeader ? { barcode: row[barcodeHeader]?.trim() || existing?.barcode || null } : {}),
          ...(category ? { category: row[category]?.trim() || existing?.category || null } : {}),
          ...(location ? { expected_location: row[location]?.trim() || existing?.expected_location || null } : {}),
          ...(custodian ? { expected_custodian: row[custodian]?.trim() || existing?.expected_custodian || null } : {}),
          ...(value ? { book_value: numberFrom(row[value]) } : {}),
        };
        if (existing) {
          const result = await db.from("asset_verification_items").update(patch).eq("id", existing.id);
          if (result.error) throw new Error(result.error.message);
          updated += 1;
        } else {
          const result = await db.from("asset_verification_items").insert({
            organization_id: orgId,
            verification_id: sessionId,
            asset_code: assetCode,
            asset_name: name ? row[name]?.trim() || assetCode : assetCode,
            barcode: barcodeHeader ? row[barcodeHeader]?.trim() || null : null,
            category: category ? row[category]?.trim() || null : null,
            expected_location: location ? row[location]?.trim() || null : null,
            expected_custodian: custodian ? row[custodian]?.trim() || null : null,
            system_quantity: systemQuantity,
            observed_quantity: null,
            book_value: value ? numberFrom(row[value]) : 0,
            observed_present: null,
            observed_condition: null,
            observed_location: null,
            observed_custodian: null,
            notes: null,
          });
          if (result.error) throw new Error(result.error.message);
          inserted += 1;
        }
      }
      await loadItems(sessionId);
      setMessage(`System balances imported for ${selected?.verification_date || "the selected date"}: ${updated} updated, ${inserted} added${skipped ? `, ${skipped} skipped` : ""}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not import system balances.");
    }
    setSaving(false);
  };

  const applyPreviousPhysicalCount = useCallback(async (rows: ImportItem[]) => {
    if (!orgId || !rows.length || !copyLastCount) return rows;
    let previous = db
      .from("asset_verifications")
      .select("id,verification_date,created_at")
      .eq("organization_id", orgId)
      .lt("verification_date", verificationDate);
    previous = isPractice ? previous.eq("client_id", clientId) : previous.is("client_id", null);
    const previousResult = await previous.order("verification_date", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (previousResult.error || !previousResult.data?.id) {
      if (previousResult.error) setMessage(previousResult.error.message);
      return rows;
    }
    const countResult = await db
      .from("asset_verification_items")
      .select("asset_code,source_asset_id,observed_present,observed_quantity,observed_condition,observed_location,observed_custodian")
      .eq("verification_id", previousResult.data.id);
    if (countResult.error) {
      setMessage(countResult.error.message);
      return rows;
    }
    const byKey = new Map<string, any>();
    (countResult.data || []).forEach((row: any) => {
      if (row.source_asset_id) byKey.set(`id:${row.source_asset_id}`, row);
      if (row.asset_code) byKey.set(`code:${normalize(row.asset_code)}`, row);
    });
    let copied = 0;
    const next = rows.map((row) => {
      const previousRow = (row.source_asset_id && byKey.get(`id:${row.source_asset_id}`)) || byKey.get(`code:${normalize(row.asset_code)}`);
      if (!previousRow || previousRow.observed_quantity == null) return row;
      copied += 1;
      const observedQty = Number(previousRow.observed_quantity || 0);
      return {
        ...row,
        observed_quantity: observedQty,
        observed_present: previousRow.observed_present ?? observedQty > 0,
        observed_condition: previousRow.observed_condition || (observedQty > 0 ? "good" : null),
        observed_location: previousRow.observed_location || null,
        observed_custodian: previousRow.observed_custodian || null,
      };
    });
    if (copied) setMessage(`Copied last physical count for ${copied} asset(s). Review and edit before saving/submitting.`);
    return next;
  }, [clientId, copyLastCount, isPractice, orgId, verificationDate]);

  const createVerification = async () => {
    if (!orgId || !title.trim() || !verificationDate || (isPractice && !clientId)) return;
    setSaving(true); setMessage("");
    let rows = importItems;
    if (sourceMode === "system_register") {
      const result = await db.from("fixed_assets").select("id,asset_code,barcode,name,branch_name,room_or_location,custodian_name,cost,accumulated_depreciation,revaluation_adjustment,impairment_loss_accumulated,fixed_asset_categories(name)").eq("organization_id", orgId).neq("status", "disposed").order("asset_code");
      if (result.error) { setMessage(result.error.message); setSaving(false); return; }
      rows = (result.data || []).map((asset: any) => ({
        source_asset_id: asset.id, asset_code: asset.asset_code, barcode: asset.barcode, asset_name: asset.name,
        category: asset.fixed_asset_categories?.name || null,
        expected_location: [asset.branch_name, asset.room_or_location].filter(Boolean).join(" / ") || null,
        expected_custodian: asset.custodian_name || null,
        system_quantity: Number(asset.quantity ?? asset.asset_quantity ?? 1) || 1,
        observed_quantity: null,
        book_value: Math.max(0, Number(asset.cost || 0) + Number(asset.revaluation_adjustment || 0) - Number(asset.accumulated_depreciation || 0) - Number(asset.impairment_loss_accumulated || 0)),
        observed_present: null, observed_condition: null, observed_location: null, observed_custodian: null, notes: null,
      }));
    }
    rows = await applyPreviousPhysicalCount(rows);
    if (!rows.length) { setMessage("No assets are available. Upload a register or add active fixed assets first."); setSaving(false); return; }
    const header = await db.from("asset_verifications").insert({ organization_id: orgId, client_id: isPractice ? clientId : null, title: title.trim(), verification_date: verificationDate, source_mode: sourceMode, source_file: sourceFile || null, prepared_by: user?.id || null }).select("id").single();
    if (header.error) { setMessage(header.error.message); setSaving(false); return; }
    const id = header.data.id;
    const detail = await db.from("asset_verification_items").insert(rows.map((row) => ({ ...row, organization_id: orgId, verification_id: id })));
    if (detail.error) { await db.from("asset_verifications").delete().eq("id", id); setMessage(detail.error.message); }
    else { setImportItems([]); setSourceFile(""); setMessage("Verification created. Start scanning or recording observations."); await loadSessions(); setSessionId(id); await loadItems(id); setTab("verify"); }
    setSaving(false);
  };

  const patchItem = (id: string, patch: Partial<VerificationItem>) => setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  const markPresent = (id: string) => setItems((current) => current.map((item) => item.id === id ? {
    ...item,
    observed_present: true,
    observed_quantity: item.observed_quantity ?? Number(item.system_quantity || 1),
    observed_condition: item.observed_condition || "good",
    observed_location: verificationLocation || item.observed_location,
    verified_by_name: user?.full_name || user?.email || "Verifier",
    verified_at: new Date().toISOString(),
  } : item));

  const addVerificationLocation = () => {
    const target = verificationLocation.trim();
    if (!target) { setMessage("Type a verification location first."); return; }
    setKnownLocations((current) => Array.from(new Set([...current, target])).sort((a, b) => a.localeCompare(b)));
    setSelectedLocationNames((current) => Array.from(new Set([...current, target])).sort((a, b) => a.localeCompare(b)));
    setVerificationLocation(target);
    setMessage(`${target} added to selected verification locations.`);
  };

  const addSearchedAssetToLocation = async () => {
    if (locked || !orgId || !sessionId) return;
    const target = verificationLocation.trim();
    if (!target) { setMessage("Choose or add a verification location first."); return; }
    const rawQuery = (barcode || search).trim();
    const query = normalize(rawQuery);
    if (!query) { setMessage("Search or scan an asset code, barcode, or asset name first."); return; }
    const physicalQtyInput = quickPhysicalCount.trim();
    const matches = items.filter((item) =>
      normalize(item.asset_code) === query ||
      normalize(item.barcode) === query ||
      normalize(item.asset_name) === query ||
      normalize(item.asset_code).includes(query) ||
      normalize(item.barcode).includes(query) ||
      normalize(item.asset_name).includes(query)
    );
    if (!matches.length) {
      const physicalQty = physicalQtyInput === "" ? 1 : numberFrom(physicalQtyInput);
      const now = new Date().toISOString();
      setSaving(true);
      const result = await db.from("asset_verification_items").insert({
        organization_id: orgId,
        verification_id: sessionId,
        asset_code: rawQuery,
        barcode: barcode.trim() || null,
        asset_name: rawQuery,
        category: "Unregistered",
        expected_location: null,
        expected_custodian: null,
        system_quantity: 0,
        observed_quantity: physicalQty,
        book_value: 0,
        observed_present: true,
        observed_condition: "good",
        observed_location: target,
        observed_custodian: null,
        notes: "Added during physical verification",
        verified_by: user?.id || null,
        verified_by_name: user?.full_name || user?.email || "Verifier",
        verified_at: now,
      }).select("*").single();
      setSaving(false);
      if (result.error) {
        setMessage(result.error.message);
        return;
      }
      const row = result.data as VerificationItem;
      setItems((current) => [...current, { ...row, book_value: Number(row.book_value || 0), system_quantity: Number(row.system_quantity || 0), observed_quantity: Number(row.observed_quantity || 0) }].sort((a, b) => a.asset_name.localeCompare(b.asset_name)));
      setKnownLocations((current) => Array.from(new Set([...current, target])).sort((a, b) => a.localeCompare(b)));
      setMessage(`${rawQuery} was not in the asset list, so it was added at ${target} with physical count ${physicalQty}.`);
      setBarcode("");
      setQuickPhysicalCount("");
      return;
    }
    let match = matches[0];
    const targetMatch = matches.find((item) => normalize(item.observed_location || item.expected_location) === normalize(target));
    if (targetMatch) match = targetMatch;
    else if (matches.length > 1 && !locationWiseMode) { setMessage(`${matches.length} assets match. Narrow the search to one asset code, barcode, or exact name, or turn on Location-wise mode.`); return; }
    const physicalQty = physicalQtyInput === "" ? Number(match.observed_quantity ?? match.system_quantity ?? 1) : numberFrom(physicalQtyInput);
    const alreadyThere = normalize(match.observed_location) === normalize(target) && match.observed_present === true;
    if (locationWiseMode && !alreadyThere && normalize(match.observed_location || match.expected_location) !== normalize(target)) {
      const now = new Date().toISOString();
      setSaving(true);
      const result = await db.from("asset_verification_items").insert({
        organization_id: orgId,
        verification_id: sessionId,
        source_asset_id: match.source_asset_id || null,
        asset_code: match.asset_code,
        barcode: match.barcode || null,
        asset_name: match.asset_name,
        category: match.category || null,
        expected_location: target,
        expected_custodian: match.expected_custodian || null,
        system_quantity: 0,
        observed_quantity: physicalQty,
        book_value: match.book_value || 0,
        observed_present: true,
        observed_condition: match.observed_condition || "good",
        observed_location: target,
        observed_custodian: match.observed_custodian || null,
        notes: match.notes || "Location-wise physical count",
        verified_by: user?.id || null,
        verified_by_name: user?.full_name || user?.email || "Verifier",
        verified_at: now,
      }).select("*").single();
      setSaving(false);
      if (result.error) {
        setMessage(result.error.message);
        return;
      }
      const row = result.data as VerificationItem;
      setItems((current) => [...current, { ...row, book_value: Number(row.book_value || 0), system_quantity: Number(row.system_quantity || 0), observed_quantity: Number(row.observed_quantity || 0) }].sort((a, b) => a.asset_name.localeCompare(b.asset_name)));
      setKnownLocations((current) => Array.from(new Set([...current, target])).sort((a, b) => a.localeCompare(b)));
      setMessage(`${match.asset_code} · ${match.asset_name} added as a separate location-wise count at ${target} with physical count ${physicalQty}.`);
      setBarcode("");
      setQuickPhysicalCount("");
      return;
    }
    setItems((current) => current.map((item) => item.id === match.id ? {
      ...item,
      observed_present: true,
      observed_quantity: physicalQty,
      observed_condition: item.observed_condition || "good",
      observed_location: target,
      verified_by_name: user?.full_name || user?.email || "Verifier",
      verified_at: new Date().toISOString(),
    } : item));
    setKnownLocations((current) => Array.from(new Set([...current, target])).sort((a, b) => a.localeCompare(b)));
    setMessage(`${match.asset_code} · ${match.asset_name} ${alreadyThere ? "already was" : "added"} at ${target} with physical count ${physicalQty}. Save progress when done.`);
    setBarcode("");
    setQuickPhysicalCount("");
  };

  const scan = () => {
    const key = normalize(barcode);
    if (!key) return;
    const match = items.find((item) => normalize(item.barcode) === key || normalize(item.asset_code) === key);
    if (!match) setMessage(`No asset matches â€œ${barcode}â€.`);
    else { markPresent(match.id); setMessage(`${match.asset_code} Â· ${match.asset_name} marked present${verificationLocation ? ` at ${verificationLocation}` : ""}.`); }
    setBarcode("");
  };

  const attachFilteredToLocation = () => {
    if (locked) return;
    const target = verificationLocation.trim();
    if (!target) { setMessage("Choose or enter a verification location first."); return; }
    const ids = new Set(filtered.map((item) => item.id));
    const now = new Date().toISOString();
    setItems((current) => current.map((item) => ids.has(item.id) ? {
      ...item,
      observed_present: true,
      observed_quantity: item.observed_quantity ?? Number(item.system_quantity || 1),
      observed_condition: item.observed_condition || "good",
      observed_location: target,
      verified_by_name: user?.full_name || user?.email || "Verifier",
      verified_at: now,
    } : item));
    setMessage(`${ids.size} visible asset(s) attached to ${target}. Review, then Save progress.`);
  };

  const clearVisiblePresent = () => {
    if (locked) return;
    const ids = new Set(filtered.map((item) => item.id));
    if (!ids.size) { setMessage("No visible assets to clear."); return; }
    setItems((current) => current.map((item) => ids.has(item.id) ? {
      ...item,
      observed_present: null,
      observed_quantity: null,
      observed_condition: null,
      observed_location: null,
      observed_custodian: null,
      verified_by_name: null,
      verified_at: null,
    } : item));
    setMessage(`Cleared present/physical count details for ${ids.size} visible asset(s). Click Save progress to persist.`);
  };

  const attachSelectedToLocation = async () => {
    if (locked || !orgId || !sessionId) return;
    const target = verificationLocation.trim();
    const targetLocations = selectedLocationNames.length ? selectedLocationNames : target ? [target] : [];
    if (!targetLocations.length) { setMessage("Choose or add one or more verification locations first."); return; }
    if (targetLocations.length > 1 && !locationWiseMode) { setMessage("Turn on Location-wise mode to attach one asset to several locations."); return; }
    const selectedIds = new Set(selectedItemIds);
    const selectedRows = items.filter((item) => selectedIds.has(item.id));
    if (!selectedRows.length) { setMessage("Select one or more searched/visible assets first."); return; }
    const physicalQtyInput = quickPhysicalCount.trim();
    const now = new Date().toISOString();
    let inserted = 0;
    const updates = new Map<string, Partial<VerificationItem>>();
    setSaving(true);
    for (const row of selectedRows) {
      const physicalQty = physicalQtyInput === "" ? Number(row.observed_quantity ?? row.system_quantity ?? 1) : numberFrom(physicalQtyInput);
      for (const targetLocation of targetLocations) {
      const existingLocationRow = items.find((item) =>
        item.id !== row.id &&
        normalize(item.asset_code) === normalize(row.asset_code) &&
        normalize(item.asset_name) === normalize(row.asset_name) &&
        normalize(item.observed_location || item.expected_location) === normalize(targetLocation)
      );
      const rowAtTarget = normalize(row.observed_location || row.expected_location) === normalize(targetLocation);
      const targetRow = existingLocationRow || (rowAtTarget ? row : null);
      if (targetRow) {
        updates.set(targetRow.id, {
          observed_present: true,
          observed_quantity: physicalQty,
          observed_condition: targetRow.observed_condition || "good",
          observed_location: targetLocation,
          verified_by_name: user?.full_name || user?.email || "Verifier",
          verified_at: now,
        });
      } else if (locationWiseMode) {
        const result = await db.from("asset_verification_items").insert({
          organization_id: orgId,
          verification_id: sessionId,
          source_asset_id: row.source_asset_id || null,
          asset_code: row.asset_code,
          barcode: row.barcode || null,
          asset_name: row.asset_name,
          category: row.category || null,
          expected_location: targetLocation,
          expected_custodian: row.expected_custodian || null,
          system_quantity: 0,
          observed_quantity: physicalQty,
          book_value: row.book_value || 0,
          observed_present: true,
          observed_condition: row.observed_condition || "good",
          observed_location: targetLocation,
          observed_custodian: row.observed_custodian || null,
          notes: row.notes || "Location-wise physical count",
          verified_by: user?.id || null,
          verified_by_name: user?.full_name || user?.email || "Verifier",
          verified_at: now,
        });
        if (result.error) { setSaving(false); setMessage(result.error.message); return; }
        inserted += 1;
      } else {
        updates.set(row.id, {
          observed_present: true,
          observed_quantity: physicalQty,
          observed_condition: row.observed_condition || "good",
          observed_location: targetLocation,
          verified_by_name: user?.full_name || user?.email || "Verifier",
          verified_at: now,
        });
      }
      }
    }
    setSaving(false);
    setItems((current) => current.map((item) => updates.has(item.id) ? { ...item, ...updates.get(item.id) } : item));
    if (inserted) await loadItems(sessionId);
    setKnownLocations((current) => Array.from(new Set([...current, ...targetLocations])).sort((a, b) => a.localeCompare(b)));
    setSelectedItemIds([]);
    setQuickPhysicalCount("");
    setMessage(`${selectedRows.length} selected asset(s) attached to ${targetLocations.length} location(s)${inserted ? `; ${inserted} separate location-wise row(s) added` : ""}. Save progress when done.`);
  };

  const saveObservations = async () => {
    if (!sessionId || locked) return;
    setSaving(true);
    const results = await Promise.all(items.map((item) => db.from("asset_verification_items").update({
      system_quantity: Number(item.system_quantity || 0),
      observed_quantity: item.observed_present == null ? null : Number(item.observed_quantity ?? 0),
      observed_present: item.observed_present,
      observed_condition: item.observed_condition,
      observed_location: item.observed_location || null,
      observed_custodian: item.observed_custodian || null,
      notes: item.notes || null,
      verified_by: item.observed_present == null ? null : user?.id || null,
      verified_by_name: item.observed_present == null ? null : item.verified_by_name || user?.email || "Verifier",
      verified_at: item.observed_present == null ? null : item.verified_at || new Date().toISOString(),
    }).eq("id", item.id)));
    const failed = results.find((result) => result.error);
    setMessage(failed?.error?.message || "Verification observations saved.");
    if (!failed) await loadItems(sessionId);
    setSaving(false);
  };

  const changeStatus = async (status: "submitted" | "approved") => {
    if (!sessionId || readOnly) return;
    if (status === "submitted" && items.some((item) => item.observed_present == null)) { setMessage("Every asset must be marked present or missing before submission."); return; }
    setSaving(true);
    if (selected?.status === "draft") await saveObservations();
    const patch = status === "submitted"
      ? { status, submitted_at: new Date().toISOString() }
      : { status, reviewed_by: user?.id || null, reviewed_at: new Date().toISOString(), review_notes: reviewNotes || null };
    const result = await db.from("asset_verifications").update(patch).eq("id", sessionId);
    setMessage(result.error?.message || (status === "approved" ? "Verification approved and locked." : "Verification submitted for review."));
    if (!result.error) await loadSessions();
    setSaving(false);
  };

  const removeSession = async () => {
    if (!selected || selected.status !== "draft" || !window.confirm(`Delete â€œ${selected.title}â€?`)) return;
    const result = await db.from("asset_verifications").delete().eq("id", selected.id);
    setMessage(result.error?.message || "Draft verification deleted.");
    if (!result.error) await loadSessions();
  };

  const verified = items.filter((item) => item.observed_present != null).length;
  const present = items.filter((item) => item.observed_present === true).length;
  const missing = items.filter((item) => item.observed_present === false).length;
  const systemTotal = items.reduce((sum, item) => sum + Number(item.system_quantity || 0), 0);
  const observedTotal = items.reduce((sum, item) => sum + Number(item.observed_quantity || 0), 0);
  const discrepancies = items.filter(hasDiscrepancy);
  const locations = useMemo(() => {
    const names = new Set<string>(knownLocations);
    items.forEach((item) => {
      [item.expected_location, item.observed_location].forEach((value) => {
        const cleaned = String(value || "").trim();
        if (cleaned) names.add(cleaned);
      });
    });
    if (verificationLocation.trim()) names.add(verificationLocation.trim());
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [items, knownLocations, verificationLocation]);
  const filtered = useMemo(() => items.filter((item) => {
    const q = normalize(search);
    const textMatch = !q || [item.asset_code, item.barcode, item.asset_name, item.category, item.expected_location].some((value) => normalize(value).includes(q));
    const filterMatch = filter === "all" || (filter === "unverified" && item.observed_present == null) || (filter === "missing" && item.observed_present === false) || (filter === "discrepancy" && hasDiscrepancy(item));
    const locationMatch = !locationFilter || normalize(item.expected_location) === normalize(locationFilter) || normalize(item.observed_location) === normalize(locationFilter);
    return textMatch && filterMatch && locationMatch;
  }), [filter, items, locationFilter, search]);

  const downloadReport = () => {
    const headers = ["Asset code", "Barcode", "Asset", "Category", "System qty", "Observed qty", "Variance", "Book value", "Expected location", "Observed location", "Expected custodian", "Observed custodian", "Present", "Condition", "Discrepancy", "Notes", "Verified by", "Verified at"];
    const rows = items.map((item) => [item.asset_code, item.barcode, item.asset_name, item.category, item.system_quantity, item.observed_quantity ?? "", item.observed_quantity == null ? "" : Number(item.observed_quantity) - Number(item.system_quantity || 0), item.book_value, item.expected_location, item.observed_location, item.expected_custodian, item.observed_custodian, item.observed_present == null ? "Unverified" : item.observed_present ? "Yes" : "No", item.observed_condition, hasDiscrepancy(item) ? "Yes" : "No", item.notes, item.verified_by_name, item.verified_at]);
    const blob = new Blob([[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `asset_verification_${selected?.verification_date || verificationDate}.csv`; link.click(); URL.revokeObjectURL(link.href);
  };

  if (!enabled) return <div className="p-8"><div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-900">Asset verification is not enabled for this organization. A platform superuser can enable it from Organizations.</div></div>;

  return <div className="mx-auto max-w-7xl space-y-5 p-6 lg:p-8">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><PackageCheck className="h-7 w-7 text-brand-700"/><h1 className="text-3xl font-bold text-slate-900">Asset Verification</h1></div><p className="mt-1 text-sm text-slate-500">Physically verify assets, record condition and custody changes, and approve exception reports.</p></div><button className="app-btn-secondary" onClick={() => void loadSessions()}><RefreshCw className="h-4 w-4"/> Refresh</button></div>
    {readOnly && <ReadOnlyNotice />}
    {message && <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">{message}</div>}
    {isPractice && <label className="block max-w-md text-xs text-slate-600">Client<select className={`${input} mt-1 w-full`} value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">Select client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>}

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Metric label="Assets in scope" value={String(items.length)}/><Metric label="Verified" value={`${verified}/${items.length}`}/><Metric label="Present" value={String(present)}/><Metric label="Missing" value={String(missing)}/><Metric label="Qty variance" value={String(observedTotal - systemTotal)}/></div>

    <div className="flex flex-wrap gap-2 border-b pb-2">{(["dashboard", "verify", "report"] as const).map((value) => <button key={value} className={tab === value ? "app-btn-primary" : "app-btn-secondary"} onClick={() => setTab(value)}>{value === "dashboard" ? "Campaigns" : value === "verify" ? "Verify assets" : "Exception report"}</button>)}</div>

    {tab === "dashboard" && <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <div className="space-y-3 rounded-xl border bg-white p-4">
        <h2 className="font-semibold">Start verification</h2>
        <input className={`${input} w-full`} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Campaign title"/>
        <input type="date" className={`${input} w-full`} value={verificationDate} onChange={(event) => setVerificationDate(event.target.value)}/>
        {!isPractice && <select className={`${input} w-full`} value={sourceMode} onChange={(event) => setSourceMode(event.target.value as typeof sourceMode)}><option value="system_register">Use BOAT fixed-asset register</option><option value="upload">Upload asset register</option></select>}
        <label className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"><input type="checkbox" className="mt-1" checked={copyLastCount} onChange={(event) => setCopyLastCount(event.target.checked)} disabled={readOnly}/><span><span className="font-medium">Copy last physical count to this new date</span><span className="block text-xs text-slate-500">Copies observed quantities, present/absent ticks, condition, location and custodian from the most recent earlier verification. You can edit them before saving.</span></span></label>
        {sourceMode === "upload" && <label className="app-btn-secondary cursor-pointer"><FileSpreadsheet className="h-4 w-4"/> Choose CSV/XLSX register<input type="file" className="hidden" accept=".csv,.xls,.xlsx" onChange={(event) => { void readFile(event.target.files?.[0] || null); event.currentTarget.value = ""; }}/></label>}
        {sourceFile && <p className="text-xs text-slate-500">{sourceFile} · {importItems.length} assets ready. Optional columns: system_quantity, observed_quantity.</p>}
        <button className="app-btn-primary w-full" disabled={readOnly || saving || (sourceMode === "upload" && !importItems.length)} onClick={() => void createVerification()}><PackageCheck className="h-4 w-4"/> Create campaign</button>
      </div>
      <div className="rounded-xl border bg-white p-4"><h2 className="font-semibold">Saved campaigns</h2><div className="mt-3 space-y-2">{sessions.map((row) => <button key={row.id} className={`w-full rounded-lg border p-3 text-left ${sessionId === row.id ? "border-brand-500 bg-brand-50" : "hover:bg-slate-50"}`} onClick={() => { setSessionId(row.id); setTab("verify"); }}><div className="flex justify-between gap-3"><span className="font-medium">{row.title}</span><Status value={row.status}/></div><p className="text-xs text-slate-500">{row.verification_date} Â· {row.source_mode === "upload" ? row.source_file || "Uploaded register" : "BOAT fixed-asset register"}</p></button>)}{!loading && !sessions.length && <p className="py-8 text-center text-sm text-slate-500">No verification campaigns yet.</p>}</div></div>
    </div>}

    {tab === "verify" && <div className="space-y-4">
      <div className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-[1fr_auto_auto]"><label className="text-xs text-slate-600">Campaign<select className={`${input} mt-1 w-full`} value={sessionId} onChange={(event) => setSessionId(event.target.value)}><option value="">Select campaign</option>{sessions.map((row) => <option key={row.id} value={row.id}>{row.verification_date} Â· {row.title} Â· {row.status}</option>)}</select></label><div className="self-end"><Status value={selected?.status || "draft"}/></div>{selected?.status === "draft" && <button className="app-btn-secondary self-end text-rose-700" disabled={readOnly} onClick={() => void removeSession()}><Trash2 className="h-4 w-4"/> Delete draft</button>}</div>
      {selected && <>
        <div className="grid gap-3 rounded-xl border bg-white p-4 xl:grid-cols-[1.2fr_1.3fr_auto_auto]">
          <div className="flex min-w-64">
            <input className={`${input} w-full rounded-r-none`} autoFocus value={barcode} onChange={(event) => setBarcode(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") scan(); }} placeholder="Scan barcode, QR payload or asset code" disabled={locked}/>
            <button className="app-btn-primary rounded-l-none" onClick={scan} disabled={locked}><ScanBarcode className="h-4 w-4"/> Scan</button>
          </div>
          <div className="flex flex-wrap gap-2">
            <select className={`${input} min-w-44`} value={verificationLocation} onChange={(event) => setVerificationLocation(event.target.value)} disabled={locked}>
              <option value="">{locations.length ? "Verification location" : "No saved locations — type one"}</option>
              {locations.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <input className={`${input} min-w-48`} value={verificationLocation} onChange={(event) => setVerificationLocation(event.target.value)} placeholder="Or type location" disabled={locked}/>
            <button className="app-btn-secondary" disabled={locked || !verificationLocation.trim()} onClick={addVerificationLocation}>Add location</button>
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:col-span-2">
            <span className="text-xs font-semibold text-slate-500">Selected locations:</span>
            {selectedLocationNames.map((location) => <span key={location} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-800">{location}<button type="button" className="text-brand-500 hover:text-brand-900" onClick={() => setSelectedLocationNames((current) => current.filter((value) => value !== location))}>×</button></span>)}
            {!selectedLocationNames.length && <span className="text-xs text-slate-400">none — Add location or use the current typed location</span>}
          </div>
          <input type="number" min="0" step="0.01" className={`${input} w-32`} value={quickPhysicalCount} onChange={(event) => setQuickPhysicalCount(event.target.value)} placeholder="Physical count" disabled={locked}/>
          <button className="app-btn-primary" disabled={locked || !verificationLocation.trim() || !(barcode.trim() || search.trim())} onClick={addSearchedAssetToLocation}><PackageCheck className="h-4 w-4"/> Attach to location</button>
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"><input type="checkbox" checked={locationWiseMode} onChange={(event) => setLocationWiseMode(event.target.checked)} disabled={locked}/><span>Location-wise mode</span></label>
          <button className="app-btn-secondary" disabled={locked || !filtered.length || !(search.trim() || barcode.trim())} onClick={() => setSelectedItemIds(filtered.map((item) => item.id))}>Select matched</button>
          <button className="app-btn-secondary" disabled={locked || !filtered.length} onClick={() => setSelectedItemIds(filtered.map((item) => item.id))}>Select visible</button>
          <button className="app-btn-primary" disabled={locked || !(verificationLocation.trim() || selectedLocationNames.length) || !selectedItemIds.length} onClick={() => void attachSelectedToLocation()}><PackageCheck className="h-4 w-4"/> Attach selected to location(s)</button>
          <button className="app-btn-secondary" disabled={!selectedItemIds.length} onClick={() => setSelectedItemIds([])}>Clear selection</button>
          <button className="app-btn-secondary" disabled={locked || !verificationLocation || !filtered.length} onClick={attachFilteredToLocation}><PackageCheck className="h-4 w-4"/> Attach visible assets</button>
          <button className="app-btn-secondary text-rose-700" disabled={locked || !filtered.some((item) => item.observed_present != null)} onClick={clearVisiblePresent}><Trash2 className="h-4 w-4"/> Clear visible present</button>
          <button className="app-btn-secondary" disabled={locked || saving} onClick={() => void saveObservations()}><CheckCircle2 className="h-4 w-4"/> Save progress</button>
          <label className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 lg:col-span-2"><FileSpreadsheet className="h-4 w-4"/> <span>System balances</span><input type="file" accept=".csv,.xls,.xlsx" disabled={locked || saving} onChange={(event) => { const file = event.currentTarget.files?.[0] || null; void importSystemBalances(file); event.currentTarget.value = ""; }}/></label>
          <button className="app-btn-primary" disabled={locked || saving || verified !== items.length} onClick={() => void changeStatus("submitted")}><Send className="h-4 w-4"/> Submit</button>
        </div>
        <p className="text-xs text-slate-500">Search assets, tick one or many rows, add one or many locations, enter physical count if needed, then Attach selected. To attach one asset to several locations at once, turn on Location-wise mode.</p>
        <Filters search={search} setSearch={setSearch} filter={filter} setFilter={setFilter} location={locationFilter} setLocation={setLocationFilter} locations={locations}/>
        <ItemsTable items={filtered} locked={locked} patch={patchItem} markPresent={markPresent} locationWiseMode={locationWiseMode} selectedIds={selectedItemIds} setSelectedIds={setSelectedItemIds}/>
      </>}
    </div>}

    {tab === "report" && <div className="space-y-4"><div className="flex flex-wrap items-end gap-3 rounded-xl border bg-white p-4"><label className="min-w-64 flex-1 text-xs text-slate-600">Campaign<select className={`${input} mt-1 w-full`} value={sessionId} onChange={(event) => setSessionId(event.target.value)}><option value="">Select campaign</option>{sessions.map((row) => <option key={row.id} value={row.id}>{row.verification_date} Â· {row.title}</option>)}</select></label><button className="app-btn-secondary" onClick={downloadReport} disabled={!selected}><Download className="h-4 w-4"/> CSV report</button><button className="app-btn-secondary" onClick={() => window.print()}><Printer className="h-4 w-4"/> Print</button></div><div className="rounded-xl border bg-white p-4"><h2 className="font-semibold">Exceptions</h2><p className="text-xs text-slate-500">Missing, damaged, poor-condition, relocated or reassigned assets.</p><ItemsTable items={discrepancies} locked={true} patch={patchItem} markPresent={markPresent}/></div>{selected?.status === "submitted" && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><label className="text-xs text-emerald-900">Review notes<textarea className={`${input} mt-1 block w-full`} rows={3} value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)}/></label><button className="app-btn-primary mt-3" disabled={readOnly || saving} onClick={() => void changeStatus("approved")}><ShieldCheck className="h-4 w-4"/> Approve & lock</button></div>}</div>}
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border bg-white p-4"><p className="text-xs uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></div>; }
function Status({ value }: { value: string }) { const style = value === "approved" ? "bg-emerald-100 text-emerald-800" : value === "submitted" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"; return <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold capitalize ${style}`}>{value}</span>; }
function Filters({ search, setSearch, filter, setFilter, location, setLocation, locations }: { search: string; setSearch: (value: string) => void; filter: "all" | "unverified" | "missing" | "discrepancy"; setFilter: (value: "all" | "unverified" | "missing" | "discrepancy") => void; location: string; setLocation: (value: string) => void; locations: string[] }) { return <div className="flex flex-wrap gap-2"><div className="relative min-w-64 flex-1"><Filter className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"/><input className={`${input} w-full pl-9`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search code, barcode, asset or location"/></div><select className={input} value={location} onChange={(event) => setLocation(event.target.value)}><option value="">All locations</option>{locations.map((value) => <option key={value} value={value}>{value}</option>)}</select><select className={input} value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">All assets</option><option value="unverified">Unverified</option><option value="missing">Missing</option><option value="discrepancy">Exceptions</option></select></div>; }
function ItemsTable({ items, locked, patch, markPresent, locationWiseMode = false, selectedIds = [], setSelectedIds }: { items: VerificationItem[]; locked: boolean; patch: (id: string, value: Partial<VerificationItem>) => void; markPresent: (id: string) => void; locationWiseMode?: boolean; selectedIds?: string[]; setSelectedIds?: (ids: string[]) => void }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const selectedSet = new Set(selectedIds);
  const toggleSelected = (id: string, checked: boolean) => {
    if (!setSelectedIds) return;
    setSelectedIds(checked ? Array.from(new Set([...selectedIds, id])) : selectedIds.filter((value) => value !== id));
  };
  const toggleMany = (ids: string[], checked: boolean) => {
    if (!setSelectedIds) return;
    const next = new Set(selectedIds);
    ids.forEach((id) => checked ? next.add(id) : next.delete(id));
    setSelectedIds(Array.from(next));
  };
  const renderItem = (item: VerificationItem, child = false) => {
    const variance = item.observed_quantity == null ? null : Number(item.observed_quantity) - Number(item.system_quantity || 0);
    return <tr key={item.id} className={`border-t ${child ? "bg-slate-50/60" : hasDiscrepancy(item) ? "bg-rose-50" : item.observed_present === true ? "bg-emerald-50/40" : ""}`}>
      <td className="p-3"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={selectedSet.has(item.id)} onChange={(event) => toggleSelected(item.id, event.target.checked)} disabled={locked || !setSelectedIds}/></td>
      <td className={`p-3 ${child ? "pl-10" : ""}`}><p className="font-medium">{item.asset_name}</p><p className="text-xs text-slate-500">{item.asset_code}{item.barcode ? ` · ${item.barcode}` : ""}</p></td>
      <td className="p-3 text-xs"><p>{item.expected_location || "No expected location"}</p><p>{item.observed_location ? `Observed: ${item.observed_location}` : item.expected_custodian || "No custodian"}</p></td>
      <td className="p-2"><input type="number" min="0" step="0.01" className={`${input} w-24 text-right`} disabled={locked} value={item.system_quantity ?? 0} onChange={(event) => patch(item.id, { system_quantity: Number(event.target.value || 0) })}/></td>
      <td className="p-2"><input type="number" min="0" step="0.01" className={`${input} w-24 text-right`} disabled={locked || item.observed_present == null} value={item.observed_quantity ?? ""} placeholder={String(item.system_quantity ?? 0)} onChange={(event) => patch(item.id, { observed_quantity: event.target.value === "" ? null : Number(event.target.value), observed_present: event.target.value === "" ? item.observed_present : Number(event.target.value) > 0 })}/></td>
      <td className="p-3 text-right font-semibold tabular-nums"><span className={variance == null ? "text-slate-400" : variance === 0 ? "text-emerald-700" : "text-rose-700"}>{variance == null ? "—" : variance}</span></td>
      <td className="p-2"><div className="flex items-center gap-2"><input type="checkbox" className="h-5 w-5 rounded border-slate-300 text-brand-600" disabled={locked} checked={item.observed_present === true} onChange={(event) => event.target.checked ? markPresent(item.id) : patch(item.id, { observed_present: false, observed_quantity: 0, observed_condition: null, verified_at: new Date().toISOString() })}/><button type="button" className="text-xs font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-40" disabled={locked || item.observed_present == null} onClick={() => patch(item.id, { observed_present: null, observed_quantity: null, observed_condition: null, verified_at: null })}>Clear</button></div></td>
      <td className="p-2"><select className={input} disabled={locked || item.observed_present !== true} value={item.observed_condition || ""} onChange={(event) => patch(item.id, { observed_condition: (event.target.value || null) as Condition | null })}><option value="">Select</option><option value="good">Good</option><option value="fair">Fair</option><option value="poor">Poor</option><option value="damaged">Damaged</option></select></td>
      <td className="p-2"><input className={input} disabled={locked || item.observed_present !== true} value={item.observed_location || ""} placeholder={item.expected_location || "Location"} onChange={(event) => patch(item.id, { observed_location: event.target.value })}/></td>
      <td className="p-2"><input className={input} disabled={locked || item.observed_present !== true} value={item.observed_custodian || ""} placeholder={item.expected_custodian || "Custodian"} onChange={(event) => patch(item.id, { observed_custodian: event.target.value })}/></td>
      <td className="p-2"><input className={input} disabled={locked} value={item.notes || ""} onChange={(event) => patch(item.id, { notes: event.target.value })}/></td>
      <td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${hasDiscrepancy(item) ? "bg-rose-100 text-rose-800" : item.observed_present == null ? "bg-slate-100 text-slate-600" : "bg-emerald-100 text-emerald-800"}`}>{hasDiscrepancy(item) ? "Exception" : item.observed_present == null ? "Pending" : "Matched"}</span></td>
    </tr>;
  };

  const groupedRows = () => {
    const groups = new Map<string, VerificationItem[]>();
    items.forEach((item) => {
      const key = `${normalize(item.asset_code)}|${normalize(item.asset_name)}`;
      groups.set(key, [...(groups.get(key) || []), item]);
    });
    return Array.from(groups.entries()).flatMap(([key, rows]) => {
      const first = rows[0];
      const isOpen = expanded[key] ?? false;
      const systemQty = rows.reduce((sum, row) => sum + Number(row.system_quantity || 0), 0);
      const observedQty = rows.reduce((sum, row) => sum + Number(row.observed_quantity || 0), 0);
      const verifiedLocations = rows.filter((row) => row.observed_present != null).length;
      const variance = observedQty - systemQty;
      const hasIssue = rows.some(hasDiscrepancy);
      const allGroupSelected = rows.every((row) => selectedSet.has(row.id));
      const parent = <tr key={`group-${key}`} className={`border-t ${hasIssue ? "bg-rose-50" : verifiedLocations ? "bg-emerald-50/40" : ""}`}>
        <td className="p-3"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={allGroupSelected} onChange={(event) => toggleMany(rows.map((row) => row.id), event.target.checked)} disabled={locked || !setSelectedIds}/></td>
        <td className="p-3"><button type="button" className="mr-2 rounded border px-2 py-1 text-xs font-semibold" onClick={() => setExpanded((current) => ({ ...current, [key]: !isOpen }))}>{isOpen ? "−" : "+"}</button><span className="font-medium">{first.asset_name}</span><p className="ml-9 text-xs text-slate-500">{first.asset_code}{first.barcode ? ` · ${first.barcode}` : ""}</p></td>
        <td className="p-3 text-xs"><p>{rows.length} location row(s)</p><p>{verifiedLocations}/{rows.length} verified</p></td>
        <td className="p-3 text-right tabular-nums">{systemQty}</td>
        <td className="p-3 text-right tabular-nums">{observedQty}</td>
        <td className="p-3 text-right font-semibold tabular-nums"><span className={variance === 0 ? "text-emerald-700" : "text-rose-700"}>{variance}</span></td>
        <td className="p-3 text-xs" colSpan={5}>Expand to verify or edit each location count.</td>
        <td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${hasIssue ? "bg-rose-100 text-rose-800" : verifiedLocations ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{hasIssue ? "Exception" : verifiedLocations ? "Grouped" : "Pending"}</span></td>
      </tr>;
      return isOpen ? [parent, ...rows.map((row) => renderItem(row, true))] : [parent];
    });
  };

  return <div className="overflow-auto rounded-xl border bg-white">
    <table className="w-full min-w-[1250px] text-sm">
      <thead className="bg-slate-50"><tr><th className="p-3 text-left">Select</th><th className="p-3 text-left">Asset</th><th className="p-3 text-left">Expected</th><th className="p-3 text-right">System qty</th><th className="p-3 text-right">Observed qty</th><th className="p-3 text-right">Variance</th><th className="p-3 text-left">Present</th><th className="p-3 text-left">Condition</th><th className="p-3 text-left">Observed location</th><th className="p-3 text-left">Observed custodian</th><th className="p-3 text-left">Notes</th><th className="p-3 text-left">Result</th></tr></thead>
      <tbody>{locationWiseMode ? groupedRows() : items.map((item) => renderItem(item))}</tbody>
    </table>
    {!items.length && <p className="p-8 text-center text-sm text-slate-500">No assets match this view.</p>}
  </div>;
}
