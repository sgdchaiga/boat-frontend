import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Briefcase, CalendarClock, ChevronDown, ChevronRight, FileArchive, FileSpreadsheet, ReceiptText, RefreshCw, Scale, Settings2, Upload, Users } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { mapStatementFileRows, parseStatementFile, suggestStatementColumnMapping, type StatementColumnMapping, type StatementFilePageStat, type StatementFileRow } from "../../lib/bankReconciliation";
import { supabase } from "../../lib/supabase";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";

const db = supabase as any;
export type PracticeSection = "clients" | "engagements" | "documents" | "reconciliation" | "tasks" | "billing";
type Client = { id: string; name: string; contact_name: string | null; email: string | null; phone: string | null; tax_id: string | null; status: string };
type RecordRow = { id: string; client_id?: string | null; title?: string; file_name?: string; storage_path?: string | null; category?: string; service_type?: string; description?: string; due_date?: string | null; amount?: number; status: string; priority?: string; period_start?: string | null; period_end?: string | null; invoice_date?: string };
type ReconLine = { id: string; side: "cashbook" | "statement"; line_date: string; description: string; reference: string | null; amount: number; source_file: string | null; match_group_id: string | null };
type ReconControl = { id: string; balance_date: string; label: string; amount: number };
type ReconRun = { id: string; period_start: string; period_end: string; method: "auto" | "manual"; side_mode: "cashbook" | "statement" | "both"; notes: string | null; reconciled_at: string };
type ReconColumn = "date" | "details" | "reference" | "amount";
type SortDirection = "asc" | "desc";

const SECTION_META: Record<PracticeSection, { title: string; description: string; icon: typeof Users }> = {
  clients: { title: "Clients", description: "Manage the businesses and individuals served by the practice.", icon: Users },
  engagements: { title: "Engagements", description: "Track bookkeeping, tax, audit, and advisory assignments.", icon: Briefcase },
  documents: { title: "Document Vault", description: "Register and organize client working papers and source documents.", icon: FileArchive },
  reconciliation: { title: "Reconciliation Center", description: "Upload client cashbooks and statements, match them, and review reports.", icon: Scale },
  tasks: { title: "Tasks & Deadlines", description: "Track client deliverables, filing dates, and review work.", icon: CalendarClock },
  billing: { title: "Billing", description: "Prepare and monitor client service invoices.", icon: ReceiptText },
};

export function PracticeWorkspacePage({ section, readOnly = false }: { section: PracticeSection; readOnly?: boolean }) {
  const { user } = useAuth();
  const orgId = user?.organization_id || null;
  const [clients, setClients] = useState<Client[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [lines, setLines] = useState<ReconLine[]>([]);
  const [controls, setControls] = useState<ReconControl[]>([]);
  const [runs, setRuns] = useState<ReconRun[]>([]);
  const [clientId, setClientId] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Record<string, string>>({});
  const [importSide, setImportSide] = useState<"cashbook" | "statement">("cashbook");
  const [importFileName, setImportFileName] = useState("");
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [importRows, setImportRows] = useState<StatementFileRow[]>([]);
  const [importSheetNames, setImportSheetNames] = useState<string[]>([]);
  const [importPageStats, setImportPageStats] = useState<StatementFilePageStat[]>([]);
  const [mapping, setMapping] = useState<StatementColumnMapping>({ date: "", description: "", reference: "", amount: "", debit: "", credit: "" });
  const [controlDate, setControlDate] = useState(new Date().toISOString().slice(0, 10));
  const [controlLabel, setControlLabel] = useState("Closing control balance");
  const [controlAmount, setControlAmount] = useState("");
  const [periodStart, setPeriodStart] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().slice(0, 10));
  const [selectedCashbook, setSelectedCashbook] = useState<string[]>([]);
  const [selectedStatements, setSelectedStatements] = useState<string[]>([]);
  const [reconcileNotes, setReconcileNotes] = useState("");
  const meta = SECTION_META[section];
  const Icon = meta.icon;

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const clientsRes = await db.from("practice_clients").select("*").eq("organization_id", orgId).order("name");
    if (clientsRes.error) { setMessage(clientsRes.error.message); setLoading(false); return; }
    const clientRows = (clientsRes.data || []) as Client[];
    setClients(clientRows);
    setClientId((current) => current || clientRows[0]?.id || "");
    if (section !== "clients" && section !== "reconciliation") {
      const table = section === "engagements" ? "practice_engagements" : section === "documents" ? "practice_documents" : section === "tasks" ? "practice_tasks" : "practice_invoices";
      const result = await db.from(table).select("*").eq("organization_id", orgId).order("created_at", { ascending: false });
      if (result.error) setMessage(result.error.message); else setRecords(result.data || []);
    }
    setLoading(false);
  }, [orgId, section]);

  const loadLines = useCallback(async () => {
    if (!clientId) { setLines([]); return; }
    const [lineResult, controlResult, runResult] = await Promise.all([
      db.from("practice_reconciliation_lines").select("*").eq("client_id", clientId).order("line_date", { ascending: false }),
      db.from("practice_reconciliation_controls").select("*").eq("client_id", clientId).order("balance_date", { ascending: false }).order("created_at", { ascending: false }),
      db.from("practice_reconciliation_runs").select("*").eq("client_id", clientId).order("period_end", { ascending: false }).order("reconciled_at", { ascending: false }),
    ]);
    if (lineResult.error || controlResult.error || runResult.error) setMessage(lineResult.error?.message || controlResult.error?.message || runResult.error?.message);
    else {
      setLines((lineResult.data || []).map((line: ReconLine & { amount: string | number }) => ({ ...line, amount: Number(line.amount) })));
      setControls((controlResult.data || []).map((control: ReconControl & { amount: string | number }) => ({ ...control, amount: Number(control.amount) })));
      setRuns(runResult.data || []);
      setSelectedCashbook([]);
      setSelectedStatements([]);
    }
  }, [clientId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (section === "reconciliation") void loadLines(); }, [section, loadLines]);

  const mapped = useMemo(() => mapStatementFileRows(importRows, mapping), [importRows, mapping]);
  const clientName = (id?: string | null) => clients.find((client) => client.id === id)?.name || "Unassigned";
  const money = (value: number) => new Intl.NumberFormat("en-UG", { minimumFractionDigits: 2 }).format(value);
  const matched = lines.filter((line) => line.match_group_id);
  const unmatchedCashbook = lines.filter((line) => line.side === "cashbook" && !line.match_group_id);
  const unmatchedStatement = lines.filter((line) => line.side === "statement" && !line.match_group_id);

  const addClient = async () => {
    if (!orgId || !form.name?.trim()) return;
    const result = await db.from("practice_clients").insert({ organization_id: orgId, name: form.name.trim(), contact_name: form.contact_name || null, email: form.email || null, phone: form.phone || null, tax_id: form.tax_id || null });
    if (result.error) setMessage(result.error.message); else { setForm({}); await load(); }
  };

  const addRecord = async () => {
    if (!orgId || !form.title?.trim()) return;
    const table = section === "engagements" ? "practice_engagements" : section === "tasks" ? "practice_tasks" : "practice_invoices";
    const payload = section === "engagements"
      ? { organization_id: orgId, client_id: clientId, title: form.title, service_type: form.service_type || "Bookkeeping", period_start: form.period_start || null, period_end: form.period_end || null }
      : section === "tasks"
        ? { organization_id: orgId, client_id: clientId || null, title: form.title, due_date: form.due_date || null, priority: form.priority || "normal" }
        : { organization_id: orgId, client_id: clientId, description: form.title, amount: Number(form.amount || 0), due_date: form.due_date || null };
    const result = await db.from(table).insert(payload);
    if (result.error) setMessage(result.error.message); else { setForm({}); await load(); }
  };

  const registerDocument = async (file: File | null) => {
    if (!file || !orgId || !clientId) return;
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const storagePath = `${orgId}/${clientId}/${crypto.randomUUID()}-${safeName}`;
    const upload = await supabase.storage.from("practice-vault").upload(storagePath, file);
    if (upload.error) { setMessage(upload.error.message); return; }
    const result = await db.from("practice_documents").insert({ organization_id: orgId, client_id: clientId, file_name: file.name, storage_path: storagePath, category: form.category || "Other", notes: form.notes || null, uploaded_by: user?.id || null });
    if (result.error) setMessage(result.error.message); else { setMessage(`${file.name} registered in the client vault.`); await load(); }
  };
  const openDocument = async (path?: string | null) => {
    if (!path) return;
    const result = await supabase.storage.from("practice-vault").createSignedUrl(path, 60);
    if (result.error) setMessage(result.error.message);
    else window.open(result.data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const readImport = async (file: File | null) => {
    if (!file) return;
    try {
      const parsed = await parseStatementFile(file);
      setImportFileName(file.name); setImportHeaders(parsed.headers); setImportRows(parsed.rows); setImportSheetNames(parsed.sheetNames); setImportPageStats(parsed.pageStats); setMapping(suggestStatementColumnMapping(parsed.headers));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read the selected import file.");
    }
  };

  const importLines = async () => {
    if (!orgId || !clientId || mapped.valid.length === 0) return;
    const result = await db.from("practice_reconciliation_lines").insert(mapped.valid.map((row) => ({ organization_id: orgId, client_id: clientId, side: importSide, line_date: row.statement_date, description: row.description, reference: row.reference, amount: row.amount, source_file: importFileName, imported_by: user?.id || null })));
    if (result.error) setMessage(result.error.message); else {
      const dates = mapped.valid.map((row) => row.statement_date).sort();
      if (dates[0]) setPeriodStart(dates[0]);
      if (dates[dates.length - 1]) setPeriodEnd(dates[dates.length - 1]);
      setMessage(`${mapped.valid.length} ${importSide} line(s) imported. Reconciliation period set to the full imported date range.`);
      setImportRows([]); setImportHeaders([]); setImportSheetNames([]); setImportPageStats([]); setImportFileName(""); await loadLines();
    }
  };

  const autoReconcile = async () => {
    const available = unmatchedStatement.filter((statement) => statement.line_date >= periodStart && statement.line_date <= periodEnd);
    let count = 0;
    const runResult = await db.from("practice_reconciliation_runs").insert({ organization_id: orgId, client_id: clientId, period_start: periodStart, period_end: periodEnd, method: "auto", side_mode: "both", notes: "Automatic reconciliation", reconciled_by: user?.id || null }).select("id").single();
    if (runResult.error) { setMessage(runResult.error.message); return; }
    const runId = runResult.data.id;
    for (const cashbook of unmatchedCashbook) {
      if (cashbook.line_date < periodStart || cashbook.line_date > periodEnd) continue;
      const matchIndex = available.findIndex((statement) => Math.abs(statement.amount - cashbook.amount) < 0.005 && Math.abs(new Date(statement.line_date).getTime() - new Date(cashbook.line_date).getTime()) <= 3 * 86400000);
      if (matchIndex < 0) continue;
      const statement = available.splice(matchIndex, 1)[0];
      const group = crypto.randomUUID();
      const [cashResult, statementResult] = await Promise.all([
        db.from("practice_reconciliation_lines").update({ match_group_id: group, reconciliation_run_id: runId }).eq("id", cashbook.id),
        db.from("practice_reconciliation_lines").update({ match_group_id: group, reconciliation_run_id: runId }).eq("id", statement.id),
      ]);
      if (!cashResult.error && !statementResult.error) count += 1;
    }
    if (count === 0) await db.from("practice_reconciliation_runs").delete().eq("id", runId);
    setMessage(`${count} client transaction pair(s) reconciled.`); await loadLines();
  };
  const addControlBalance = async () => {
    const amount = Number(controlAmount);
    if (!orgId || !clientId || !controlDate || !Number.isFinite(amount)) return;
    const result = await db.from("practice_reconciliation_controls").insert({ organization_id: orgId, client_id: clientId, balance_date: controlDate, label: controlLabel.trim() || "Control balance", amount, recorded_by: user?.id || null });
    if (result.error) setMessage(result.error.message);
    else { setControlAmount(""); setMessage("Client control balance recorded."); await loadLines(); }
  };
  const selectedCashbookRows = unmatchedCashbook.filter((line) => selectedCashbook.includes(line.id));
  const selectedStatementRows = unmatchedStatement.filter((line) => selectedStatements.includes(line.id));
  const selectedCashbookTotal = selectedCashbookRows.reduce((sum, line) => sum + line.amount, 0);
  const selectedStatementTotal = selectedStatementRows.reduce((sum, line) => sum + line.amount, 0);
  const selectedDifference = selectedCashbookTotal - selectedStatementTotal;
  const manualReconcile = async () => {
    if (!orgId || !clientId || (selectedCashbook.length === 0 && selectedStatements.length === 0)) return;
    if (selectedCashbook.length > 0 && selectedStatements.length > 0 && Math.abs(selectedDifference) >= 0.005) {
      setMessage(`Selected cashbook and statement totals must agree. Difference: ${money(selectedDifference)}.`);
      return;
    }
    const sideMode = selectedCashbook.length > 0 && selectedStatements.length > 0 ? "both" : selectedCashbook.length > 0 ? "cashbook" : "statement";
    const runResult = await db.from("practice_reconciliation_runs").insert({ organization_id: orgId, client_id: clientId, period_start: periodStart, period_end: periodEnd, method: "manual", side_mode: sideMode, notes: reconcileNotes || null, reconciled_by: user?.id || null }).select("id").single();
    if (runResult.error) { setMessage(runResult.error.message); return; }
    const runId = runResult.data.id;
    const group = crypto.randomUUID();
    const ids = [...selectedCashbook, ...selectedStatements];
    const result = await db.from("practice_reconciliation_lines").update({ match_group_id: group, reconciliation_run_id: runId }).in("id", ids);
    if (result.error) { await db.from("practice_reconciliation_runs").delete().eq("id", runId); setMessage(result.error.message); }
    else { setReconcileNotes(""); setMessage(`${sideMode === "both" ? "Two-sided" : "Single-sided"} reconciliation saved for ${periodStart} to ${periodEnd}.`); await loadLines(); }
  };
  const cancelRun = async (runId: string) => {
    if (!confirm("Cancel this reconciliation and return its transactions to unmatched?")) return;
    const lineResult = await db.from("practice_reconciliation_lines").update({ match_group_id: null, reconciliation_run_id: null }).eq("reconciliation_run_id", runId);
    if (lineResult.error) { setMessage(lineResult.error.message); return; }
    const runResult = await db.from("practice_reconciliation_runs").delete().eq("id", runId);
    if (runResult.error) setMessage(runResult.error.message); else { setMessage("Reconciliation cancelled."); await loadLines(); }
  };
  const removeImportedFile = async (sourceFile: string) => {
    if (!confirm(`Remove all unreconciled transactions imported from ${sourceFile}?`)) return;
    const result = await db.from("practice_reconciliation_lines").delete().eq("client_id", clientId).eq("source_file", sourceFile).is("reconciliation_run_id", null).is("match_group_id", null);
    if (result.error) setMessage(result.error.message); else { setMessage(`${sourceFile} removed.`); await loadLines(); }
  };

  return (
    <div className="space-y-6 p-6 md:p-8">
      {readOnly && <ReadOnlyNotice />}
      <div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2"><Icon className="h-7 w-7 text-brand-700" /><h1 className="text-3xl font-bold text-slate-900">{meta.title}</h1></div><p className="mt-1 text-sm text-slate-500">{meta.description}</p></div><button type="button" className="app-btn-secondary" onClick={() => void (section === "reconciliation" ? loadLines() : load())}><RefreshCw className="h-4 w-4" /> Refresh</button></div>
      {message && <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">{message}</div>}
      {section === "clients" ? <Clients clients={clients} form={form} setForm={setForm} add={addClient} disabled={readOnly} /> :
       section === "reconciliation" ? <Reconciliation clients={clients} clientId={clientId} setClientId={setClientId} importSide={importSide} setImportSide={setImportSide} importFileName={importFileName} importSheetNames={importSheetNames} importPageStats={importPageStats} importRowCount={importRows.length} invalidCount={mapped.invalidCount} invalidReasons={mapped.invalidReasons} readImport={readImport} headers={importHeaders} mapping={mapping} setMapping={setMapping} mappedCount={mapped.valid.length} importLines={importLines} autoReconcile={autoReconcile} cashbook={unmatchedCashbook} statements={unmatchedStatement} matched={matched} allLines={lines} controls={controls} controlDate={controlDate} setControlDate={setControlDate} controlLabel={controlLabel} setControlLabel={setControlLabel} controlAmount={controlAmount} setControlAmount={setControlAmount} addControlBalance={addControlBalance} periodStart={periodStart} setPeriodStart={setPeriodStart} periodEnd={periodEnd} setPeriodEnd={setPeriodEnd} selectedCashbook={selectedCashbook} setSelectedCashbook={setSelectedCashbook} selectedStatements={selectedStatements} setSelectedStatements={setSelectedStatements} selectedCashbookTotal={selectedCashbookTotal} selectedStatementTotal={selectedStatementTotal} selectedDifference={selectedDifference} reconcileNotes={reconcileNotes} setReconcileNotes={setReconcileNotes} manualReconcile={manualReconcile} runs={runs} cancelRun={cancelRun} removeImportedFile={removeImportedFile} money={money} disabled={readOnly} /> :
       section === "documents" ? <Documents clients={clients} clientId={clientId} setClientId={setClientId} form={form} setForm={setForm} register={registerDocument} openDocument={openDocument} records={records} clientName={clientName} disabled={readOnly} /> :
       <WorkRecords section={section} clients={clients} clientId={clientId} setClientId={setClientId} form={form} setForm={setForm} add={addRecord} records={records} clientName={clientName} money={money} disabled={readOnly} />}
      {loading && <p className="text-sm text-slate-500">Loading practice workspace...</p>}
    </div>
  );
}

const input = "rounded-lg border border-slate-300 px-3 py-2 text-sm";
function ClientSelect({ clients, value, setValue }: { clients: Client[]; value: string; setValue: (value: string) => void }) { return <select value={value} onChange={(e) => setValue(e.target.value)} className={input}><option value="">Select client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select>; }
function Clients({ clients, form, setForm, add, disabled }: any) { return <><div className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-3"><input className={input} placeholder="Client name *" value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })}/><input className={input} placeholder="Contact person" value={form.contact_name || ""} onChange={(e) => setForm({ ...form, contact_name: e.target.value })}/><input className={input} placeholder="Email" value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })}/><input className={input} placeholder="Phone" value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })}/><input className={input} placeholder="Tax ID / TIN" value={form.tax_id || ""} onChange={(e) => setForm({ ...form, tax_id: e.target.value })}/><button className="app-btn-primary" disabled={disabled} onClick={() => void add()}>Add client</button></div><SimpleTable heads={["Client", "Contact", "Email", "Tax ID", "Status"]} rows={clients.map((c: Client) => [c.name, c.contact_name || c.phone || "-", c.email || "-", c.tax_id || "-", c.status])}/></>; }
function WorkRecords({ section, clients, clientId, setClientId, form, setForm, add, records, clientName, money, disabled }: any) { return <><div className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-4"><ClientSelect clients={clients} value={clientId} setValue={setClientId}/><input className={input} placeholder={section === "billing" ? "Invoice description" : section === "tasks" ? "Task title" : "Engagement title"} value={form.title || ""} onChange={(e) => setForm({ ...form, title: e.target.value })}/>{section === "billing" ? <input className={input} type="number" placeholder="Amount" value={form.amount || ""} onChange={(e) => setForm({ ...form, amount: e.target.value })}/> : section === "tasks" ? <input className={input} type="date" value={form.due_date || ""} onChange={(e) => setForm({ ...form, due_date: e.target.value })}/> : <input className={input} placeholder="Service type" value={form.service_type || ""} onChange={(e) => setForm({ ...form, service_type: e.target.value })}/>}<button className="app-btn-primary" disabled={disabled || !clientId} onClick={() => void add()}>Add {section === "billing" ? "invoice" : section === "tasks" ? "task" : "engagement"}</button></div><SimpleTable heads={["Client", "Description", "Due / period", "Amount / type", "Status"]} rows={records.map((r: RecordRow) => [clientName(r.client_id), r.title || r.description || "-", r.due_date || r.period_end || "-", r.amount != null ? money(Number(r.amount)) : r.service_type || r.priority || "-", r.status])}/></>; }
function Documents({ clients, clientId, setClientId, form, setForm, register, openDocument, records, clientName, disabled }: any) { return <><div className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-4"><ClientSelect clients={clients} value={clientId} setValue={setClientId}/><input className={input} placeholder="Category" value={form.category || ""} onChange={(e) => setForm({ ...form, category: e.target.value })}/><input className={input} placeholder="Notes" value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })}/><label className="app-btn-primary cursor-pointer"><Upload className="h-4 w-4"/> Add to vault<input type="file" className="hidden" disabled={disabled || !clientId} onChange={(e) => void register(e.target.files?.[0] || null)}/></label></div><SimpleTable heads={["Client", "File", "Category", "Open"]} rows={records.map((r: RecordRow) => [clientName(r.client_id), r.file_name || "-", r.category || "-", <button type="button" className="text-brand-700 hover:underline" onClick={() => void openDocument(r.storage_path)}>Open</button>])}/></>; }
function Reconciliation(props: any) {
  const { clients, clientId, setClientId, importSide, setImportSide, importFileName, importSheetNames, importPageStats, importRowCount, invalidCount, invalidReasons, readImport, headers, mapping, setMapping, mappedCount, importLines, autoReconcile, cashbook, statements, matched, allLines, controls, controlDate, setControlDate, controlLabel, setControlLabel, controlAmount, setControlAmount, addControlBalance, periodStart, setPeriodStart, periodEnd, setPeriodEnd, selectedCashbook, setSelectedCashbook, selectedStatements, setSelectedStatements, selectedCashbookTotal, selectedStatementTotal, selectedDifference, reconcileNotes, setReconcileNotes, manualReconcile, runs, cancelRun, removeImportedFile, money, disabled } = props;
  const [cashbookFirst, setCashbookFirst] = useState(true);
  const [showImportedDocuments, setShowImportedDocuments] = useState(false);
  const [expandedImportFiles, setExpandedImportFiles] = useState<string[]>([]);
  const mapField = (key: keyof StatementColumnMapping, label: string) => <label className="text-xs text-slate-600">{label}<select className={`${input} mt-1 w-full`} value={mapping[key]} onChange={(e) => setMapping({ ...mapping, [key]: e.target.value })}><option value="">Not mapped</option>{headers.map((h: string) => <option key={h}>{h}</option>)}</select></label>;
  const cashbookTotal = (allLines as ReconLine[]).filter((line) => line.side === "cashbook").reduce((sum, line) => sum + line.amount, 0);
  const statementTotal = (allLines as ReconLine[]).filter((line) => line.side === "statement").reduce((sum, line) => sum + line.amount, 0);
  const unmatchedCashbookTotal = (cashbook as ReconLine[]).reduce((sum, line) => sum + line.amount, 0);
  const unmatchedStatementTotal = (statements as ReconLine[]).reduce((sum, line) => sum + line.amount, 0);
  const latestControl = (controls as ReconControl[])[0];
  const periodCashbook = (cashbook as ReconLine[]).filter((line) => line.line_date >= periodStart && line.line_date <= periodEnd);
  const periodStatements = (statements as ReconLine[]).filter((line) => line.line_date >= periodStart && line.line_date <= periodEnd);
  const importedFiles = Array.from(new Set((allLines as ReconLine[]).map((line) => line.source_file).filter(Boolean))) as string[];
  const toggleImportFile = (file: string) => setExpandedImportFiles((current) => current.includes(file) ? current.filter((value) => value !== file) : [...current, file]);
  const reconciledBalance = cashbookTotal - unmatchedCashbookTotal + unmatchedStatementTotal;
  const controlDifference = latestControl ? reconciledBalance - latestControl.amount : null;
  return <>
    <div className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-3"><ClientSelect clients={clients} value={clientId} setValue={setClientId}/><select className={input} value={importSide} onChange={(e) => setImportSide(e.target.value)}><option value="cashbook">Client cashbook</option><option value="statement">Bank / channel statement</option></select><label className="app-btn-secondary cursor-pointer"><FileSpreadsheet className="h-4 w-4"/> Choose CSV, Excel, or PDF<input type="file" accept=".csv,.xls,.xlsx,.pdf,application/pdf" className="hidden" disabled={disabled || !clientId} onChange={(e) => void readImport(e.target.files?.[0] || null)}/></label></div>
    {headers.length > 0 && <div className="rounded-xl border bg-white p-4"><p className="text-sm font-semibold">{importFileName}</p><p className="mb-3 text-xs text-slate-500">{importSheetNames.length} page/worksheet(s) · {importRowCount} rows found · {mappedCount} valid · {invalidCount} skipped</p><details className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs"><summary className="cursor-pointer font-semibold text-slate-700">Page extraction audit</summary><div className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-4">{(importPageStats as StatementFilePageStat[]).map((stat) => <p key={stat.name} className={stat.rowCount === 0 ? "font-semibold text-rose-700" : "text-slate-600"}>{stat.name}: {stat.rowCount} row(s)</p>)}</div></details><div className="grid gap-3 md:grid-cols-3">{mapField("date", "Date *")}{mapField("description", "Description")}{mapField("reference", "Reference")}{mapField("amount", "Signed amount")}{mapField("debit", "Debit")}{mapField("credit", "Credit")}</div>{invalidCount > 0 && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><p className="font-semibold">Skipped row reasons</p>{Object.entries(invalidReasons as Record<string, number>).map(([reason, count]) => <p key={reason}>{reason}: {count}</p>)}</div>}<button className="app-btn-primary mt-4" disabled={disabled || !mappedCount} onClick={() => void importLines()}><Upload className="h-4 w-4"/> Import {importSide}</button></div>}
    <div className="rounded-xl border bg-white p-4"><h2 className="font-semibold text-slate-900">Record client control balance</h2><p className="text-xs text-slate-500">Capture the closing bank, cash, mobile-money, or other independent control balance.</p><div className="mt-3 grid gap-3 md:grid-cols-4"><input className={input} type="date" value={controlDate} onChange={(e) => setControlDate(e.target.value)}/><input className={input} value={controlLabel} onChange={(e) => setControlLabel(e.target.value)} placeholder="Control balance label"/><input className={input} type="number" value={controlAmount} onChange={(e) => setControlAmount(e.target.value)} placeholder="Control amount"/><button className="app-btn-primary" disabled={disabled || !clientId || controlAmount === ""} onClick={() => void addControlBalance()}>Record balance</button></div></div>
    <div className="rounded-xl border bg-white p-4"><div><h2 className="font-semibold text-slate-900">Reconcile selected period</h2><p className="text-xs text-slate-500">Choose the period, then manually match selected transactions or automatically match the whole period.</p></div><div className="mt-3 grid gap-3 md:grid-cols-4"><label className="text-xs text-slate-600">Period start<input className={`${input} mt-1 w-full`} type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)}/></label><label className="text-xs text-slate-600">Period end<input className={`${input} mt-1 w-full`} type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)}/></label><input className={`${input} self-end`} value={reconcileNotes} onChange={(e) => setReconcileNotes(e.target.value)} placeholder="Reconciliation notes"/><div className="flex items-end gap-2"><button className="app-btn-primary" disabled={disabled || (!selectedCashbook.length && !selectedStatements.length) || (selectedCashbook.length > 0 && selectedStatements.length > 0 && Math.abs(selectedDifference) >= 0.005)} onClick={() => void manualReconcile()}>Manually reconcile selected</button><button className="app-btn-secondary" disabled={disabled || !clientId} onClick={() => void autoReconcile()}>Auto reconcile period</button></div></div><div className="mt-3 grid gap-3 sm:grid-cols-3"><StatementMetric label="Selected cashbook" value={money(selectedCashbookTotal)}/><StatementMetric label="Selected statement" value={money(selectedStatementTotal)}/><StatementMetric label="Difference" value={money(selectedDifference)} alert={selectedCashbook.length > 0 && selectedStatements.length > 0 && Math.abs(selectedDifference) >= 0.005}/></div></div>
    <div className="grid gap-3 md:grid-cols-3"><Metric label="Cashbook unmatched" value={cashbook.length}/><Metric label="Statement unmatched" value={statements.length}/><Metric label="Matched lines" value={matched.length}/></div>
    <div className="rounded-xl border bg-white p-4"><h2 className="font-semibold text-slate-900">Reconciliation statement</h2><p className="text-xs text-slate-500">Client reconciliation position based on imported lines and the latest control balance.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><StatementMetric label="Cashbook total" value={money(cashbookTotal)}/><StatementMetric label="Statement total" value={money(statementTotal)}/><StatementMetric label="Unmatched cashbook" value={money(unmatchedCashbookTotal)}/><StatementMetric label="Unmatched statement" value={money(unmatchedStatementTotal)}/><StatementMetric label="Reconciled balance" value={money(reconciledBalance)}/><StatementMetric label={latestControl ? `${latestControl.label} (${latestControl.balance_date})` : "Latest control balance"} value={latestControl ? money(latestControl.amount) : "Not recorded"}/><StatementMetric label="Control difference" value={controlDifference == null ? "Not available" : money(controlDifference)} alert={controlDifference != null && Math.abs(controlDifference) >= 0.005}/><StatementMetric label="Status" value={controlDifference != null && Math.abs(controlDifference) < 0.005 ? "Reconciled" : "Review required"} alert={controlDifference == null || Math.abs(controlDifference) >= 0.005}/></div></div>
    <div className="grid items-start gap-4 xl:grid-cols-2">{cashbookFirst ? <><ReconTable title="Unmatched client cashbook" rows={periodCashbook} money={money} selected={selectedCashbook} setSelected={setSelectedCashbook} moveDirection="right" onMove={() => setCashbookFirst(false)} independentlyScrollable/><ReconTable title="Unmatched statements" rows={periodStatements} money={money} selected={selectedStatements} setSelected={setSelectedStatements} moveDirection="left" onMove={() => setCashbookFirst(false)} independentlyScrollable/></> : <><ReconTable title="Unmatched statements" rows={periodStatements} money={money} selected={selectedStatements} setSelected={setSelectedStatements} moveDirection="right" onMove={() => setCashbookFirst(true)} independentlyScrollable/><ReconTable title="Unmatched client cashbook" rows={periodCashbook} money={money} selected={selectedCashbook} setSelected={setSelectedCashbook} moveDirection="left" onMove={() => setCashbookFirst(true)} independentlyScrollable/></>}</div>
    <ReconTable title="Matched reconciliation lines" rows={matched} money={money}/>
    <div className="grid gap-4 xl:grid-cols-2"><div className="overflow-hidden rounded-xl border bg-white"><div className="flex items-center justify-between gap-3 border-b p-3"><div><h3 className="font-semibold">Imported documents</h3><p className="text-xs text-slate-500">{showImportedDocuments ? "Document transaction details are visible." : "Document transaction details are hidden."}</p></div><button type="button" className="app-btn-secondary" onClick={() => setShowImportedDocuments((value) => !value)}>{showImportedDocuments ? "Hide details" : "Show details"}</button></div>{importedFiles.map((file) => { const fileLines = (allLines as ReconLine[]).filter((line) => line.source_file === file); const expanded = expandedImportFiles.includes(file); return <div key={file} className="border-b"><div className="flex items-center justify-between gap-3 px-3 py-2 text-sm"><button type="button" className="flex items-center gap-2 text-left font-medium" disabled={!showImportedDocuments} onClick={() => toggleImportFile(file)}>{showImportedDocuments ? expanded ? <ChevronDown className="h-4 w-4"/> : <ChevronRight className="h-4 w-4"/> : null}{file}<span className="text-xs font-normal text-slate-500">{fileLines.length} line(s)</span></button><button type="button" className="text-rose-700 hover:underline" disabled={disabled} onClick={() => void removeImportedFile(file)}>Remove unreconciled lines</button></div>{showImportedDocuments && expanded && <ReconTable title={`${file} details`} rows={fileLines} money={money}/>}</div>; })}{!importedFiles.length && <p className="p-5 text-center text-sm text-slate-500">No imported documents.</p>}</div><div className="overflow-hidden rounded-xl border bg-white"><h3 className="border-b p-3 font-semibold">Reconciliation history</h3>{(runs as ReconRun[]).map((run) => <div key={run.id} className="flex items-center justify-between gap-3 border-b px-3 py-2 text-sm"><div><p className="font-medium">{run.period_start} to {run.period_end}</p><p className="text-xs text-slate-500 capitalize">{run.method} · {run.side_mode} side{run.notes ? ` · ${run.notes}` : ""}</p></div><button type="button" className="text-rose-700 hover:underline" disabled={disabled} onClick={() => void cancelRun(run.id)}>Cancel reconciliation</button></div>)}{!runs.length && <p className="p-5 text-center text-sm text-slate-500">No reconciliations saved.</p>}</div></div>
  </>;
}
function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className="text-2xl font-bold">{value}</p></div>; }
function StatementMetric({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) { return <div className={`rounded-lg border p-3 ${alert ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-slate-50"}`}><p className="text-xs text-slate-500">{label}</p><p className={`font-semibold ${alert ? "text-amber-800" : "text-slate-900"}`}>{value}</p></div>; }
function ReconTable({ title, rows, money, selected, setSelected, moveDirection, onMove, independentlyScrollable = false }: { title: string; rows: ReconLine[]; money: (value: number) => string; selected?: string[]; setSelected?: (ids: string[]) => void; moveDirection?: "left" | "right"; onMove?: () => void; independentlyScrollable?: boolean }) {
  const [columns, setColumns] = useState<ReconColumn[]>(["date", "details", "reference", "amount"]);
  const [sort, setSort] = useState<{ key: ReconColumn; direction: SortDirection }>({ key: "date", direction: "desc" });
  const sorted = useMemo(() => [...rows].sort((left, right) => comparePracticeValues(sort.key === "date" ? left.line_date : sort.key === "details" ? left.description : sort.key === "reference" ? left.reference || left.source_file || "" : left.amount, sort.key === "date" ? right.line_date : sort.key === "details" ? right.description : sort.key === "reference" ? right.reference || right.source_file || "" : right.amount, sort.direction)), [rows, sort]);
  const selectable = selected != null && setSelected != null;
  const allSelected = selectable && rows.length > 0 && rows.every((row) => selected.includes(row.id));
  const toggle = (id: string) => setSelected?.(selected?.includes(id) ? selected.filter((value) => value !== id) : [...(selected || []), id]);
  const toggleAll = () => setSelected?.(allSelected ? (selected || []).filter((id) => !rows.some((row) => row.id === id)) : Array.from(new Set([...(selected || []), ...rows.map((row) => row.id)])));
  return <div className="overflow-visible rounded-xl border bg-white"><div className="flex items-start justify-between gap-3 border-b p-3"><div><h3 className="font-semibold">{title}</h3><p className="text-xs text-slate-500">{rows.length} line(s){selectable ? ` · ${rows.filter((row) => selected.includes(row.id)).length} selected` : ""}{independentlyScrollable ? " · independent scroll" : ""}</p></div><div className="flex items-center gap-2">{moveDirection && onMove && <button type="button" className="inline-flex items-center gap-1 rounded-lg border bg-white px-3 py-2 text-xs" onClick={onMove}>{moveDirection === "left" ? <ArrowUp className="h-4 w-4 -rotate-90"/> : <ArrowDown className="h-4 w-4 -rotate-90"/>} Move {moveDirection}</button>}<PracticeColumnToggle columns={columns} setColumns={setColumns}/></div></div><div className={`${independentlyScrollable ? "h-[520px]" : ""} overflow-auto`}><table className="w-full text-sm"><thead className="sticky top-0 z-10 bg-white shadow-sm"><tr>{selectable && <th className="w-10 p-2 text-left"><input type="checkbox" checked={allSelected} onChange={toggleAll}/></th>}{columns.includes("date") && <PracticeSortHeader label="Date" sortKey="date" sort={sort} setSort={setSort}/>} {columns.includes("details") && <PracticeSortHeader label="Details" sortKey="details" sort={sort} setSort={setSort}/>} {columns.includes("reference") && <PracticeSortHeader label="Reference / source" sortKey="reference" sort={sort} setSort={setSort}/>} {columns.includes("amount") && <PracticeSortHeader label="Amount" sortKey="amount" sort={sort} setSort={setSort} right/>}</tr></thead><tbody>{sorted.map((r) => <tr key={r.id} className={`border-t ${selected?.includes(r.id) ? "bg-blue-50" : ""}`}>{selectable && <td className="p-2"><input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)}/></td>}{columns.includes("date") && <td className="whitespace-nowrap p-2">{r.line_date}</td>}{columns.includes("details") && <td className="p-2">{r.description}</td>}{columns.includes("reference") && <td className="p-2 text-slate-500">{r.reference || r.source_file || "-"}</td>}{columns.includes("amount") && <td className="p-2 text-right tabular-nums">{money(r.amount)}</td>}</tr>)}</tbody></table>{!rows.length && <p className="p-5 text-center text-sm text-slate-500">No lines.</p>}</div></div>;
}
function PracticeColumnToggle({ columns, setColumns }: { columns: ReconColumn[]; setColumns: (columns: ReconColumn[]) => void }) {
  const [open, setOpen] = useState(false);
  const options: Array<{ key: ReconColumn; label: string }> = [{ key: "date", label: "Date" }, { key: "details", label: "Details" }, { key: "reference", label: "Reference / source" }, { key: "amount", label: "Amount" }];
  return <div className="relative"><button type="button" className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-xs" onClick={() => setOpen((value) => !value)}><Settings2 className="h-4 w-4"/> Columns</button>{open && <div className="absolute right-0 top-10 z-30 w-52 rounded-xl border bg-white p-3 shadow-lg">{options.map((option) => <label key={option.key} className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" checked={columns.includes(option.key)} onChange={(event) => setColumns(event.target.checked ? [...columns, option.key] : columns.filter((key) => key !== option.key))}/>{option.label}</label>)}</div>}</div>;
}
function PracticeSortHeader({ label, sortKey, sort, setSort, right = false }: { label: string; sortKey: ReconColumn; sort: { key: ReconColumn; direction: SortDirection }; setSort: (sort: { key: ReconColumn; direction: SortDirection }) => void; right?: boolean }) {
  const active = sort.key === sortKey;
  const Icon = active ? sort.direction === "asc" ? ArrowUp : ArrowDown : ArrowUpDown;
  return <th className={`p-2 ${right ? "text-right" : "text-left"}`}><button type="button" className={`inline-flex items-center gap-1 font-semibold ${right ? "ml-auto" : ""}`} onClick={() => setSort({ key: sortKey, direction: active && sort.direction === "asc" ? "desc" : "asc" })}>{label}<Icon className={`h-3.5 w-3.5 ${active ? "text-brand-700" : "text-slate-400"}`}/></button></th>;
}
function comparePracticeValues(left: string | number, right: string | number, direction: SortDirection) {
  const value = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
  return direction === "asc" ? value : -value;
}
function SimpleTable({ heads, rows }: { heads: string[]; rows: Array<Array<React.ReactNode>> }) { return <div className="overflow-auto rounded-xl border bg-white"><table className="w-full text-sm"><thead><tr>{heads.map((h) => <th key={h} className="p-3 text-left">{h}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i} className="border-t">{row.map((cell, j) => <td key={j} className="p-3">{cell}</td>)}</tr>)}</tbody></table>{!rows.length && <p className="p-6 text-center text-sm text-slate-500">No records yet.</p>}</div>; }
