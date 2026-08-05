import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Ban, BookOpen, CheckCircle2, Download, Palette, Pencil, Plus, Printer, RefreshCw, SlidersHorizontal, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAppContext } from "@/contexts/AppContext";
import { supabase } from "@/lib/supabase";
import { isGlAccountRelevantForBusinessType } from "@/lib/glAccountBusinessScope";
import { useGeneralBusinessMode } from "@/lib/generalBusinessMode";
import { SACCOPRO_PAGE } from "@/lib/saccoproPages";
import { SearchableCombobox } from "@/components/common/SearchableCombobox";
import { buildSaccoNarration, normalizeSaccoTransactionType, saccoMemberDisplay } from "@/lib/saccoCashbookDisplay";
import { canEditSaccoTransactions } from "@/lib/saccoTransactionEditAccess";

type View = "register" | "entry" | "daily";
type Appearance = { primary_color: string; accent_color: string; button_radius: number; show_page_description: boolean; page_description: string };
type Gl = { id: string; account_code: string; account_name: string; account_type: string; category: string | null };
type Row = {
  id: string; submitted_at: string; transaction_type: string; transaction_date: string; narration: string;
  member_id: string | null; client_name: string | null; gl_account_id: string; gl_account_label?: string;
  voucher_no: string | null; deposit_amount: number; withdraw_amount: number; loan_id: string | null;
  loan_no: string | null; account_no: string | null; client_no: string | null; payment_channel: string;
  net_amount: number; posted_by_name?: string | null; edited_by_name?: string | null;
  approval_status?: "pending" | "approved" | "voided" | "replaced"; created_by?: string | null;
};

const routes = { register: "sacco_cashbook_register", entry: "sacco_cashbook_entry", daily: "sacco_cashbook_daily" };
const money = new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 });
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const blank = () => ({ transactionType: "Deposit", date: today(), narration: "", memberId: "", glAccountId: "", voucherNo: "", deposit: "", withdraw: "", loanId: "", paymentChannel: "cash" });
const DEFAULT_APPEARANCE: Appearance = { primary_color: "#6d28d9", accent_color: "#8b5cf6", button_radius: 10, show_page_description: true, page_description: "Transaction entry, cashbook register and daily cash summary." };

export function SaccoTerekaCashbookPage({ view, navigate }: { view: View; navigate: (page: string, state?: Record<string, unknown>) => void }) {
  const { user } = useAuth();
  const { members, loans, cashbook, refreshSaccoWorkspace } = useAppContext();
  const { mode, setMode } = useGeneralBusinessMode(user?.id, user?.organization_id);
  const orgId = user?.organization_id;
  const [rows, setRows] = useState<Row[]>([]);
  const [gls, setGls] = useState<Gl[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [summaryDate, setSummaryDate] = useState(today);
  const [form, setForm] = useState(blank);
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [savingAppearance, setSavingAppearance] = useState(false);
  const [appearanceMessage, setAppearanceMessage] = useState("");
  const roleKey = String(user?.role || "").trim().toLowerCase();
  const canCustomizeAppearance = Boolean(user?.isSuperAdmin || ["admin", "super_admin"].includes(roleKey));
  const canControlTransactions = canEditSaccoTransactions(user?.role, { isSuperAdmin: user?.isSuperAdmin });
  const themedButton = { backgroundColor: appearance.primary_color, borderRadius: appearance.button_radius };

  useEffect(() => { if (mode !== "cashbook") setMode("cashbook"); }, [mode, setMode]);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const [entries, accounts] = await Promise.all([
      (supabase as any).from("sacco_cashbook_entries").select("*,gl_accounts(account_code,account_name),creator:staff!created_by(full_name),editor:staff!updated_by(full_name)").eq("organization_id", orgId).order("entry_date", { ascending: false }).limit(2500),
      supabase.from("gl_accounts").select("id,account_code,account_name,account_type,category").eq("organization_id", orgId).eq("is_active", true).order("account_code"),
    ]);
    if (entries.error) setMessage("Apply the latest SACCO cashbook migration to enable direct entries.");
    else setRows((entries.data || []).map((r: any) => ({ ...r,
      submitted_at: r.created_at, transaction_type: r.transaction_type || r.category || "Journal",
      transaction_date: r.entry_date, narration: r.narration || r.description,
      member_id: r.sacco_member_id, client_name: r.member_name,
      voucher_no: r.voucher_no || null, deposit_amount: Number(r.deposit_amount || r.debit || 0),
      withdraw_amount: Number(r.withdraw_amount || r.credit || 0), net_amount: Number((r.deposit_amount || r.debit || 0) - (r.withdraw_amount || r.credit || 0)),
      payment_channel: r.payment_channel || "cash", gl_account_label: [r.gl_accounts?.account_code, r.gl_accounts?.account_name].filter(Boolean).join(" · "),
      posted_by_name: r.creator?.full_name, edited_by_name: r.editor?.full_name
    })));
    if (!accounts.error) setGls(((accounts.data || []) as Gl[]).filter((a) => isGlAccountRelevantForBusinessType(a, "sacco")));
    setLoading(false);
  }, [orgId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!orgId) return;
    void (supabase as any).from("sacco_cashbook_settings").select("primary_color,accent_color,button_radius,show_page_description,page_description").eq("organization_id", orgId).maybeSingle().then(({ data }: any) => {
      if (data) setAppearance({ ...DEFAULT_APPEARANCE, ...data });
    });
  }, [orgId]);

  const saveAppearance = async () => {
    if (!orgId || !canCustomizeAppearance) return;
    setSavingAppearance(true); setAppearanceMessage("");
    const { error } = await (supabase as any).from("sacco_cashbook_settings").upsert({ organization_id: orgId, ...appearance, updated_by: user?.id || null, updated_at: new Date().toISOString() }, { onConflict: "organization_id" });
    setSavingAppearance(false);
    setAppearanceMessage(error ? error.message : "SACCO cashbook appearance saved.");
  };

  const member = members.find((m) => m.id === form.memberId);
  const memberLoans = loans.filter((l) => !form.memberId || l.memberId === form.memberId);

  const save = async () => {
    if (!orgId || !form.glAccountId || (!Number(form.deposit) && !Number(form.withdraw)) || (Number(form.deposit) > 0 && Number(form.withdraw) > 0)) {
      setMessage("Enter a GL account and either Deposit Amount or Withdraw Amount."); return;
    }
    setSaving(true); setMessage("");
    const loan = loans.find((l) => l.id === form.loanId);
    const transactionType = normalizeSaccoTransactionType(form.transactionType, Number(form.deposit || 0), Number(form.withdraw || 0));
    const narration = buildSaccoNarration(transactionType, saccoMemberDisplay(member?.name, member?.accountNumber), form.narration);
    const { error } = await (supabase as any).rpc("post_sacco_cashbook_entry", {
      p_organization_id: orgId, p_transaction_type: transactionType, p_transaction_date: form.date,
      p_narration: narration, p_member_id: form.memberId || null, p_client_name: member?.name || null,
      p_gl_account_id: form.glAccountId, p_voucher_no: form.voucherNo.trim() || null,
      p_deposit_amount: Number(form.deposit || 0), p_withdraw_amount: Number(form.withdraw || 0),
      p_loan_id: form.loanId || null, p_loan_no: loan?.loanNumber || null, p_account_no: member?.accountNumber || null,
      p_client_no: member?.accountNumber || null, p_payment_channel: form.paymentChannel,
    });
    setSaving(false);
    if (error) { setMessage(error.message); return; }
    setForm(blank()); setMessage("Cash Book entry posted successfully.");
    await Promise.all([load(), refreshSaccoWorkspace()]);
    navigate(routes.register);
  };

  const dailyRows = useMemo(() => rows.filter((r) => r.transaction_date === summaryDate).sort((a, b) => a.submitted_at.localeCompare(b.submitted_at)), [rows, summaryDate]);
  const opening = useMemo(() => rows.filter((r) => r.transaction_date < summaryDate).reduce((s, r) => s + r.net_amount, 0), [rows, summaryDate]);
  let running = opening;

  return <div className="mx-auto max-w-[1500px] space-y-5 p-4 sm:p-6 lg:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-bold uppercase tracking-wider" style={{ color: appearance.primary_color }}>SACCO · Cashbook Workspace</p><h1 className="mt-1 flex items-center gap-2 text-3xl font-bold text-slate-900"><BookOpen style={{ color: appearance.primary_color }} />{view === "entry" ? "Cashbook Entry" : view === "daily" ? "Daily Summary" : "Cashbook Register"}</h1>{appearance.show_page_description && <p className="mt-1 text-sm text-slate-600">{appearance.page_description}</p>}</div>
      <div className="flex flex-wrap gap-2"><div className="inline-flex rounded-lg border bg-white p-1 text-sm"><button onClick={() => { setMode("modern"); navigate(SACCOPRO_PAGE.dashboard); }} className="rounded-md px-3 py-1.5 font-semibold text-slate-600">Full System</button><button className="px-3 py-1.5 font-semibold text-white" style={themedButton}>Cashbook</button></div><button onClick={() => void load()} className="app-btn-secondary"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</button>{canCustomizeAppearance && <button onClick={() => setAppearanceOpen(open => !open)} className="app-btn-secondary"><Palette className="h-4 w-4" />Appearance</button>}{view !== "entry" && <button onClick={() => navigate(routes.entry)} className="app-btn-primary" style={themedButton}><Plus className="h-4 w-4" />Cashbook entry</button>}</div>
    </header>
    {appearanceOpen && canCustomizeAppearance && <AppearancePanel appearance={appearance} setAppearance={setAppearance} saving={savingAppearance} message={appearanceMessage} onClose={() => setAppearanceOpen(false)} onSave={() => void saveAppearance()} />}
    <nav className="flex flex-wrap gap-2 rounded-xl border bg-white p-2">{([['entry','Cashbook Entry'],['register','Cashbook Register'],['daily','Daily Summary']] as const).map(([id,label]) => <button key={id} onClick={() => navigate(routes[id])} className={view === id ? "app-btn-primary" : "app-btn-secondary"} style={view === id ? themedButton : { borderRadius: appearance.button_radius }}>{label}</button>)}</nav>
    {message && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{message}</div>}

    {view === "entry" && <section className="rounded-2xl border bg-white p-5 shadow-sm"><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <Field label="Trx Type"><select value={form.transactionType} onChange={(e) => setForm(v => ({ ...v, transactionType: e.target.value }))} className="cashbook-input"><option>Deposit</option><option>Withdrawal</option><option>Loan repayment</option><option>Loan disbursement</option><option>Journal</option><option>Balance b/f</option></select></Field>
      <Field label="Date"><input type="date" value={form.date} onChange={(e) => setForm(v => ({ ...v, date: e.target.value }))} className="cashbook-input" /></Field>
      <Field label="Payment channel"><select value={form.paymentChannel} onChange={(e) => setForm(v => ({ ...v, paymentChannel: e.target.value }))} className="cashbook-input"><option value="cash">Cash</option><option value="mtn_momo">MTN MoMo</option><option value="airtel_money">Airtel Money</option><option value="bank">Bank</option></select></Field>
      <Field label="Client Name"><select value={form.memberId} onChange={(e) => setForm(v => ({ ...v, memberId: e.target.value, loanId: "" }))} className="cashbook-input"><option value="">Non-member / select client</option>{members.map(m => <option key={m.id} value={m.id}>{m.name} · {m.accountNumber}</option>)}</select></Field>
      <Field label="A/C_NO"><input value={member?.accountNumber || ""} readOnly className="cashbook-input bg-slate-50" /></Field>
      <Field label="Client NO."><input value={member?.accountNumber || ""} readOnly className="cashbook-input bg-slate-50" /></Field>
      <Field label="GL Account"><select value={form.glAccountId} onChange={(e) => setForm(v => ({ ...v, glAccountId: e.target.value }))} className="cashbook-input"><option value="">Select GL account</option>{gls.map(g => <option key={g.id} value={g.id}>{g.account_code} · {g.account_name}</option>)}</select></Field>
      <Field label="Reference / Voucher No."><input value={form.voucherNo} onChange={(e) => setForm(v => ({ ...v, voucherNo: e.target.value }))} placeholder="Enter receipt or voucher reference" className="cashbook-input" /></Field>
      <Field label="Loan No."><select value={form.loanId} onChange={(e) => setForm(v => ({ ...v, loanId: e.target.value }))} className="cashbook-input"><option value="">No linked loan</option>{memberLoans.map(l => <option key={l.id} value={l.id}>{l.loanNumber || l.id} · {l.memberName}</option>)}</select></Field>
      <div className="md:col-span-2 lg:col-span-3"><Field label="Additional narration / details"><textarea rows={3} value={form.narration} onChange={(e) => setForm(v => ({ ...v, narration: e.target.value }))} placeholder="Optional extra details; BOAT automatically records what was done and by/to whom." className="cashbook-input" /></Field><p className="mt-1 text-xs text-slate-500">Posting narration: {buildSaccoNarration(form.transactionType, saccoMemberDisplay(member?.name, member?.accountNumber), form.narration)}</p></div>
      <Field label="Deposit Amount"><input type="number" min="0" value={form.deposit} onChange={(e) => setForm(v => ({ ...v, deposit: e.target.value, withdraw: e.target.value ? "" : v.withdraw }))} className="cashbook-input" /></Field>
      <Field label="Withdraw Amount"><input type="number" min="0" value={form.withdraw} onChange={(e) => setForm(v => ({ ...v, withdraw: e.target.value, deposit: e.target.value ? "" : v.deposit }))} className="cashbook-input" /></Field>
    </div><div className="mt-5 flex justify-end"><button onClick={() => void save()} disabled={saving} className="app-btn-primary" style={themedButton}>{saving ? "Posting…" : "Post Cash Book entry"}</button></div></section>}

    {view === "register" && <CashbookRegister rows={rows} members={members} loans={loans} loading={loading} preferenceKey={`boat.sacco.cashbook.columns.${orgId || "no-org"}.${user?.id || "anonymous"}`} headerColor={appearance.primary_color} orgId={orgId} currentUserId={user?.id} canControl={canControlTransactions} onChanged={load} setMessage={setMessage} />}

    {view === "daily" && <section className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><label className="text-sm font-semibold">Summary date<input type="date" value={summaryDate} onChange={(e) => setSummaryDate(e.target.value)} className="ml-3 rounded-lg border px-3 py-2" /></label><button onClick={() => window.print()} className="app-btn-secondary"><Printer className="h-4 w-4" />Print summary</button></div><div className="mt-4 overflow-x-auto rounded-xl border"><table className="w-full min-w-[1050px] text-sm"><thead className="bg-slate-900 text-xs uppercase text-white"><tr><th className="px-3 py-3 text-left">Details</th><th>Date</th><th className="text-right">Airtel Money</th><th className="text-right">MTN MoMo</th><th className="text-right">Bank</th><th className="text-right">Cash In</th><th className="text-right">Cash Out</th><th className="px-3 text-right">Balance</th></tr></thead><tbody><tr className="bg-slate-50 font-semibold"><td className="px-3 py-2">Balance b/f</td><td>{summaryDate}</td><td/><td/><td/><td/><td/><td className="px-3 text-right">{money.format(opening)}</td></tr>{dailyRows.map(r => { running += r.net_amount; return <tr key={r.id} className="border-t"><td className="px-3 py-2"><b>{r.narration}</b><span className="block text-xs text-slate-500">{r.client_name}</span></td><td>{r.transaction_date}</td><ChannelCell show={r.payment_channel === "airtel_money"} n={r.net_amount}/><ChannelCell show={r.payment_channel === "mtn_momo"} n={r.net_amount}/><ChannelCell show={r.payment_channel === "bank"} n={r.net_amount}/><MoneyCell n={r.payment_channel === "cash" ? r.deposit_amount : 0}/><MoneyCell n={r.payment_channel === "cash" ? r.withdraw_amount : 0}/><td className="px-3 py-2 text-right font-bold">{money.format(running)}</td></tr>})}</tbody></table></div><p className="mt-3 text-xs text-slate-500">Unified report: direct cashbook and teller-synced entries are included and grouped by their recorded payment channel ({cashbook.length} system journal lines).</p></section>}
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm font-semibold text-slate-700">{label}<div className="mt-1">{children}</div></label>; }
function AppearancePanel({ appearance, setAppearance, saving, message, onClose, onSave }: { appearance: Appearance; setAppearance: React.Dispatch<React.SetStateAction<Appearance>>; saving: boolean; message: string; onClose: () => void; onSave: () => void }) {
  return <section className="rounded-2xl border bg-white p-5 shadow-sm">
    <div className="flex items-start justify-between gap-3"><div><h2 className="font-bold text-slate-900">SACCO cashbook appearance</h2><p className="mt-1 text-sm text-slate-600">Applies to this organization's Cashbook mode.</p></div><button onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100" aria-label="Close appearance settings"><X className="h-4 w-4" /></button></div>
    <div className="mt-4 grid gap-4 sm:grid-cols-3"><Field label="Primary color"><input type="color" value={appearance.primary_color} onChange={e => setAppearance(v => ({ ...v, primary_color: e.target.value }))} className="h-11 w-full cursor-pointer rounded-lg border p-1" /></Field><Field label="Accent color"><input type="color" value={appearance.accent_color} onChange={e => setAppearance(v => ({ ...v, accent_color: e.target.value }))} className="h-11 w-full cursor-pointer rounded-lg border p-1" /></Field><Field label={`Button corners (${appearance.button_radius}px)`}><input type="range" min="0" max="24" value={appearance.button_radius} onChange={e => setAppearance(v => ({ ...v, button_radius: Number(e.target.value) }))} className="mt-3 w-full" style={{ accentColor: appearance.accent_color }} /></Field></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-[190px_minmax(0,1fr)]"><label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={appearance.show_page_description} onChange={e => setAppearance(v => ({ ...v, show_page_description: e.target.checked }))} />Show page subtitle</label><Field label="Page subtitle"><input value={appearance.page_description} disabled={!appearance.show_page_description} onChange={e => setAppearance(v => ({ ...v, page_description: e.target.value }))} className="cashbook-input disabled:bg-slate-100" /></Field></div>
    <div className="mt-4 flex items-center justify-end gap-3">{message && <span className="text-sm text-slate-600">{message}</span>}<button onClick={onSave} disabled={saving} className="app-btn-primary" style={{ backgroundColor: appearance.primary_color, borderRadius: appearance.button_radius }}>{saving ? "Saving..." : "Save appearance"}</button></div>
  </section>;
}
function MoneyCell({ n }: { n: number }) { return <td className="px-3 py-2 text-right tabular-nums">{n ? money.format(n) : "—"}</td>; }
function ChannelCell({ show, n }: { show: boolean; n: number }) { return <td className={`px-3 py-2 text-right font-semibold ${show && n < 0 ? "text-rose-700" : "text-emerald-700"}`}>{show && n ? money.format(n) : "—"}</td>; }

type ColumnId = "submitted" | "type" | "date" | "narration" | "member" | "gl" | "voucher" | "deposit" | "withdraw" | "loan" | "account" | "clientNo" | "net" | "postedBy" | "editedBy";
const DEFAULT_COLUMNS: ColumnId[] = ["date", "type", "narration", "member", "voucher", "deposit", "withdraw", "loan", "net"];
const COLUMN_LABELS: Record<ColumnId, string> = { submitted: "Date Submitted", type: "Trx Type", date: "Date", narration: "Narration", member: "Member", gl: "GL Account", voucher: "Reference / Voucher No.", deposit: "Deposit Amount", withdraw: "Withdraw Amount", loan: "Loan No.", account: "A/C_NO", clientNo: "Client NO.", net: "Net Amount", postedBy: "Posted By", editedBy: "Edited By" };
const ALL_COLUMNS = Object.keys(COLUMN_LABELS) as ColumnId[];

function CashbookRegister({ rows, members, loans, loading, preferenceKey, headerColor, orgId, currentUserId, canControl, onChanged, setMessage }: { rows: Row[]; members: Array<{ id: string; name: string; accountNumber?: string }>; loans: Array<{ id: string; loanNumber?: string; memberName: string }>; loading: boolean; preferenceKey: string; headerColor: string; orgId?: string | null; currentUserId?: string | null; canControl: boolean; onChanged: () => Promise<void>; setMessage: (value: string) => void }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [memberId, setMemberId] = useState("");
  const [loanId, setLoanId] = useState("");
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [sort, setSort] = useState<{ id: ColumnId; direction: "asc" | "desc" }>({ id: "date", direction: "desc" });
  const memberById = useMemo(() => new Map(members.map((member) => [member.id, member])), [members]);
  const memberLabel = useCallback((row: Row) => {
    const member = memberById.get(row.member_id || "");
    return saccoMemberDisplay(row.client_name || member?.name, member?.accountNumber || row.client_no);
  }, [memberById]);
  const readColumns = useCallback((): ColumnId[] => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(preferenceKey) || "null");
      return Array.isArray(saved) && saved.some((id) => ALL_COLUMNS.includes(id)) ? saved.filter((id) => ALL_COLUMNS.includes(id)) : DEFAULT_COLUMNS;
    } catch { return DEFAULT_COLUMNS; }
  }, [preferenceKey]);
  const [visible, setVisible] = useState<ColumnId[]>(readColumns);
  useEffect(() => setVisible(readColumns()), [readColumns]);

  const persistColumns = (next: ColumnId[]) => { setVisible(next); window.localStorage.setItem(preferenceKey, JSON.stringify(next)); };
  const setColumn = (id: ColumnId, checked: boolean) => {
    const next = checked ? ALL_COLUMNS.filter((column) => visible.includes(column) || column === id) : visible.filter((column) => column !== id);
    if (next.length) persistColumns(next);
  };
  const value = (row: Row, id: ColumnId): string | number => {
    switch (id) {
      case "submitted": return row.submitted_at || ""; case "type": return row.transaction_type || ""; case "date": return row.transaction_date || "";
      case "narration": return row.narration || ""; case "member": return memberLabel(row); case "gl": return row.gl_account_label || "";
      case "voucher": return row.voucher_no || ""; case "deposit": return row.deposit_amount; case "withdraw": return row.withdraw_amount;
      case "loan": return row.loan_no || ""; case "account": return row.account_no || ""; case "clientNo": return row.client_no || "";
      case "net": return row.net_amount; case "postedBy": return row.posted_by_name || ""; case "editedBy": return row.edited_by_name || "";
    }
  };
  const display = (row: Row, id: ColumnId) => {
    if (id === "member") return memberLabel(row);
    if (id === "submitted") return row.submitted_at ? new Date(row.submitted_at).toLocaleString() : "—";
    if (id === "deposit" || id === "withdraw" || id === "net") { const n = Number(value(row, id)); return n ? money.format(n) : "—"; }
    return String(value(row, id) || "—");
  };
  const filtered = useMemo(() => rows.filter((row) => (!from || row.transaction_date >= from) && (!to || row.transaction_date <= to) && (!memberId || row.member_id === memberId) && (!loanId || row.loan_id === loanId)).sort((a, b) => {
    const av = value(a, sort.id); const bv = value(b, sort.id);
    const result = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    return sort.direction === "asc" ? result : -result;
  }), [rows, from, to, memberId, loanId, sort, memberLabel]);
  const toggleSort = (id: ColumnId) => setSort((current) => current.id === id ? { id, direction: current.direction === "asc" ? "desc" : "asc" } : { id, direction: "asc" });
  const exportCsv = () => {
    const ids = visible;
    const quote = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
    const csv = [ids.map(id => quote(COLUMN_LABELS[id])).join(","), ...filtered.map(row => ids.map(id => quote(value(row, id))).join(","))].join("\r\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); link.download = `sacco-cashbook-${new Date().toISOString().slice(0,10)}.csv`; link.click(); URL.revokeObjectURL(link.href);
  };
  const act = async (row: Row, action: "approve" | "correct" | "void") => {
    if (!orgId) return;
    let error: { message?: string } | null = null;
    if (action === "approve") ({ error } = await (supabase as any).rpc("approve_sacco_cashbook_entry", { p_organization_id: orgId, p_entry_id: row.id }));
    if (action === "void") { const reason = window.prompt("Reason for voiding this entry:"); if (!reason) return; ({ error } = await (supabase as any).rpc("void_sacco_cashbook_entry", { p_organization_id: orgId, p_entry_id: row.id, p_reason: reason })); }
    if (action === "correct") { const reason = window.prompt("Reason for the correction:"); if (!reason) return; const narration = window.prompt("Corrected narration:", row.narration); if (narration === null) return; const voucher = window.prompt("Corrected reference / voucher number:", row.voucher_no || ""); if (voucher === null) return; ({ error } = await (supabase as any).rpc("correct_sacco_cashbook_entry", { p_organization_id: orgId, p_entry_id: row.id, p_reason: reason, p_narration: narration, p_voucher_no: voucher || null })); }
    setMessage(error?.message || `Entry ${action === "approve" ? "approved" : action === "void" ? "voided with a reversing journal" : "corrected with a full audit trail"}.`); if (!error) await onChanged();
  };

  return <section className="rounded-2xl border bg-white shadow-sm">
    <div className="grid gap-3 border-b p-4 sm:grid-cols-2 lg:grid-cols-[150px_150px_minmax(180px,1fr)_minmax(180px,1fr)_auto]">
      <Field label="Date from"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="cashbook-input" /></Field>
      <Field label="Date to"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="cashbook-input" /></Field>
      <Field label="Member"><SearchableCombobox value={memberId} onChange={setMemberId} options={members.map(m => ({ id: m.id, label: m.name }))} emptyOption={{ label: "All members" }} placeholder="Type a member name…" inputAriaLabel="Filter cashbook by member" clearable /></Field>
      <Field label="Loan number"><select value={loanId} onChange={(e) => setLoanId(e.target.value)} className="cashbook-input"><option value="">All loans</option>{loans.map(l => <option key={l.id} value={l.id}>{l.loanNumber || l.id} · {l.memberName}</option>)}</select></Field>
      <div className="relative self-end"><button type="button" onClick={() => setColumnsOpen(v => !v)} className="app-btn-secondary w-full"><SlidersHorizontal className="h-4 w-4" />Columns ({visible.length})</button>{columnsOpen && <div className="absolute right-0 z-30 mt-2 max-h-80 w-72 overflow-y-auto rounded-xl border bg-white p-3 shadow-xl"><div className="mb-2 flex justify-between"><b className="text-sm">Show columns</b><button type="button" onClick={() => persistColumns(ALL_COLUMNS)} className="text-xs font-semibold text-violet-700">Show all</button></div>{ALL_COLUMNS.map(id => <label key={id} className="flex items-center gap-2 py-1.5 text-sm"><input type="checkbox" checked={visible.includes(id)} onChange={(e) => setColumn(id, e.target.checked)} />{COLUMN_LABELS[id]}</label>)}</div>}</div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-slate-50 px-4 py-2 text-xs text-slate-600"><span>{filtered.length} of {rows.length} entries</span><div className="flex gap-2"><button onClick={exportCsv} className="app-btn-secondary"><Download className="h-4 w-4" />CSV</button><button onClick={() => window.print()} className="app-btn-secondary"><Printer className="h-4 w-4" />Print</button></div></div>
    <div className="max-h-[68vh] overflow-auto"><table className="w-full min-w-max text-sm"><thead className="sticky top-0 z-10 text-xs uppercase text-white" style={{ backgroundColor: headerColor }}><tr>{visible.map((id, index) => <th key={id} className={`whitespace-nowrap px-3 py-3 text-left ${index === 0 ? "sticky left-0 z-20" : ""}`} style={index === 0 ? { backgroundColor: headerColor } : undefined}><button type="button" onClick={() => toggleSort(id)} className="inline-flex items-center gap-1 font-semibold">{COLUMN_LABELS[id]}{sort.id === id ? sort.direction === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUpDown className="h-3.5 w-3.5 opacity-60" />}</button></th>)}<th className="px-3 py-3 text-left">Status / Actions</th></tr></thead><tbody className="divide-y">{filtered.map(row => <tr key={row.id} className="hover:bg-slate-50">{visible.map((id, index) => <td key={id} className={`whitespace-nowrap px-3 py-2 ${["deposit", "withdraw", "net"].includes(id) ? "text-right tabular-nums" : ""} ${index === 0 ? "sticky left-0 bg-white" : ""}`}>{display(row, id)}</td>)}<td className="px-3 py-2"><div className="flex items-center gap-2"><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold capitalize">{row.approval_status || "pending"}</span>{canControl && !["voided","replaced"].includes(row.approval_status || "pending") && <><button title="Correct entry" onClick={() => void act(row,"correct")} className="rounded p-1.5 hover:bg-violet-50"><Pencil className="h-4 w-4" /></button><button title="Void entry" onClick={() => void act(row,"void")} className="rounded p-1.5 text-rose-700 hover:bg-rose-50"><Ban className="h-4 w-4" /></button>{(row.approval_status || "pending") === "pending" && row.created_by !== currentUserId && <button title="Approve entry" onClick={() => void act(row,"approve")} className="rounded p-1.5 text-emerald-700 hover:bg-emerald-50"><CheckCircle2 className="h-4 w-4" /></button>}</>}</div></td></tr>)}{!loading && filtered.length === 0 && <tr><td colSpan={visible.length + 1} className="px-4 py-10 text-center text-slate-500">No cashbook entries match these filters.</td></tr>}</tbody></table></div>
  </section>;
}
