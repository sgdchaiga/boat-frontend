import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Banknote, CheckCircle2, ClipboardCheck, Plus, RefreshCw, Wallet, X } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";
import { createJournalEntry } from "../../lib/journal";
import { SearchableCombobox } from "../common/SearchableCombobox";
import { PageNotes } from "../common/PageNotes";

type GlAccount = { id: string; account_code: string; account_name: string; account_type: string; category: string | null };
type Fund = { id: string; name: string; cash_gl_account_id: string; replenishment_source_gl_account_id: string | null; custodian_id: string | null; float_limit: number; replenishment_threshold: number; is_active: boolean; notes: string | null };
type Voucher = { id: string; fund_id: string; voucher_number: string; voucher_date: string; voucher_type: "expense" | "replenishment" | "adjustment"; status: "draft" | "submitted" | "approved" | "rejected" | "posted" | "reversed"; payee: string | null; narration: string; amount: number; expense_gl_account_id: string | null; offset_gl_account_id: string | null; vote_id: string | null; subvote_id: string | null; receipt_reference: string | null; submitted_by: string | null; approved_by: string | null; journal_entry_id: string | null };
type Count = { id: string; fund_id: string; count_date: string; expected_amount: number; counted_amount: number; variance_amount: number; notes: string | null; reviewed_by: string | null };
type Staff = { id: string; full_name: string | null; email: string | null };
type Vote = { id: string; vote_code: string; vote_name: string };
type Subvote = { id: string; vote_id: string; subvote_code: string; subvote_name: string; default_gl_account_id: string | null };

const money = new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 });
const today = () => new Date().toISOString().slice(0, 10);
const text = (error: unknown) => error instanceof Error ? error.message : (error && typeof error === "object" && "message" in error ? String(error.message) : String(error || "Unknown error"));
const voucherNo = () => `PC-${today().replaceAll("-", "")}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

export function SchoolPettyCashPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const role = String(user?.role || "").toLowerCase();
  const canControl = !readOnly && Boolean(user?.isSuperAdmin || ["admin", "super_admin", "manager", "accountant"].includes(role));
  const [funds, setFunds] = useState<Fund[]>([]);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [counts, setCounts] = useState<Count[]>([]);
  const [accounts, setAccounts] = useState<GlAccount[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [votes, setVotes] = useState<Vote[]>([]);
  const [subvotes, setSubvotes] = useState<Subvote[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "vouchers" | "counts">("overview");
  const [fundModal, setFundModal] = useState(false);
  const [voucherModal, setVoucherModal] = useState(false);
  const [countModal, setCountModal] = useState<Fund | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");
  const [fundFilter, setFundFilter] = useState("");
  const [fundDraft, setFundDraft] = useState({ name: "", cashGlId: "", sourceGlId: "", custodianId: "", floatLimit: "", threshold: "", notes: "" });
  const [voucherDraft, setVoucherDraft] = useState({ fundId: "", voucherType: "expense" as "expense" | "replenishment", date: today(), payee: "", narration: "", amount: "", expenseGlId: "", offsetGlId: "", voteId: "", subvoteId: "", receipt: "" });
  const [countDraft, setCountDraft] = useState({ counted: "", notes: "" });

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true); setMessage(null);
    try {
      const [fundRes, voucherRes, countRes, accountRes, staffRes, voteRes, subvoteRes] = await Promise.all([
        supabase.from("school_petty_cash_funds").select("*").eq("organization_id", orgId).order("name"),
        supabase.from("school_petty_cash_vouchers").select("*").eq("organization_id", orgId).order("voucher_date", { ascending: false }).limit(500),
        supabase.from("school_petty_cash_counts").select("*").eq("organization_id", orgId).order("count_date", { ascending: false }).limit(100),
        supabase.from("gl_accounts").select("id,account_code,account_name,account_type,category").eq("organization_id", orgId).eq("is_active", true).order("account_code"),
        supabase.from("staff").select("id,full_name,email").eq("organization_id", orgId).order("full_name"),
        supabase.from("school_budget_votes").select("id,vote_code,vote_name").eq("organization_id", orgId).eq("is_active", true).order("vote_code"),
        supabase.from("school_budget_subvotes").select("id,vote_id,subvote_code,subvote_name,default_gl_account_id").eq("organization_id", orgId).eq("is_active", true).order("subvote_code"),
      ]);
      const firstError = [fundRes, voucherRes, countRes, accountRes, staffRes, voteRes, subvoteRes].find((r) => r.error)?.error;
      if (firstError) throw firstError;
      setFunds((fundRes.data || []) as Fund[]); setVouchers((voucherRes.data || []) as Voucher[]); setCounts((countRes.data || []) as Count[]);
      setAccounts((accountRes.data || []) as GlAccount[]); setStaff((staffRes.data || []) as Staff[]); setVotes((voteRes.data || []) as Vote[]); setSubvotes((subvoteRes.data || []) as Subvote[]);
    } catch (error) { setMessage(`Could not load petty cash: ${text(error)}`); }
    finally { setLoading(false); }
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  const balanceByFund = useMemo(() => {
    const map = new Map<string, number>();
    for (const voucher of vouchers) {
      if (voucher.status !== "posted") continue;
      const direction = voucher.voucher_type === "expense" ? -1 : 1;
      map.set(voucher.fund_id, (map.get(voucher.fund_id) || 0) + direction * Number(voucher.amount || 0));
    }
    return map;
  }, [vouchers]);
  const fundById = useMemo(() => new Map(funds.map((fund) => [fund.id, fund])), [funds]);
  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const latestCountByFund = useMemo(() => new Map(counts.map((count) => [count.fund_id, count])), [counts]);
  const totalBalance = [...balanceByFund.values()].reduce((sum, value) => sum + value, 0);
  const pendingValue = vouchers.filter((v) => ["submitted", "approved"].includes(v.status)).reduce((sum, v) => sum + Number(v.amount || 0), 0);
  const exceptions = funds.filter((fund) => {
    const count = latestCountByFund.get(fund.id);
    return (count && Math.abs(Number(count.variance_amount)) > 0.01) || (fund.replenishment_threshold > 0 && (balanceByFund.get(fund.id) || 0) <= fund.replenishment_threshold);
  });
  const cashAccounts = accounts.filter((account) => account.account_type === "asset" && (account.category || "").toLowerCase() === "cash");
  const fundingAccounts = accounts.filter((account) => account.account_type === "asset" && /bank|cash|wallet|mobile/i.test(`${account.account_name} ${account.category || ""}`));
  const expenseAccounts = accounts.filter((account) => account.account_type === "expense");
  const options = (rows: GlAccount[]) => rows.map((row) => ({ id: row.id, label: `${row.account_code} — ${row.account_name}` }));
  const fundOptions = funds.filter((fund) => fund.is_active).map((fund) => ({ id: fund.id, label: `${fund.name} · balance ${money.format(balanceByFund.get(fund.id) || 0)}` }));
  const visibleVouchers = vouchers.filter((voucher) => (!fundFilter || voucher.fund_id === fundFilter) && (!statusFilter || voucher.status === statusFilter));

  const createFund = async () => {
    if (!orgId || !fundDraft.name.trim() || !fundDraft.cashGlId) { setMessage("Enter a fund name and select its petty-cash GL account."); return; }
    const limit = Number(fundDraft.floatLimit || 0), threshold = Number(fundDraft.threshold || 0);
    if (limit < 0 || threshold < 0) { setMessage("Float limit and replenishment threshold cannot be negative."); return; }
    setSaving(true);
    const { error } = await supabase.from("school_petty_cash_funds").insert({ organization_id: orgId, name: fundDraft.name.trim(), cash_gl_account_id: fundDraft.cashGlId, replenishment_source_gl_account_id: fundDraft.sourceGlId || null, custodian_id: fundDraft.custodianId || null, float_limit: limit, replenishment_threshold: threshold, notes: fundDraft.notes.trim() || null, created_by: user?.id || null });
    setSaving(false);
    if (error) { setMessage(`Could not create fund: ${text(error)}`); return; }
    setFundModal(false); setFundDraft({ name: "", cashGlId: "", sourceGlId: "", custodianId: "", floatLimit: "", threshold: "", notes: "" }); await load();
  };

  const createVoucher = async () => {
    if (!orgId || !voucherDraft.fundId || !voucherDraft.narration.trim() || Number(voucherDraft.amount) <= 0) { setMessage("Select a fund and enter a narration and positive amount."); return; }
    if (voucherDraft.voucherType === "expense" && !voucherDraft.expenseGlId) { setMessage("Select the expense GL account."); return; }
    if (voucherDraft.voucherType === "replenishment" && !voucherDraft.offsetGlId) { setMessage("Select the source bank, cash, or wallet account."); return; }
    setSaving(true);
    const { error } = await supabase.from("school_petty_cash_vouchers").insert({ organization_id: orgId, fund_id: voucherDraft.fundId, voucher_number: voucherNo(), voucher_date: voucherDraft.date, voucher_type: voucherDraft.voucherType, status: "submitted", payee: voucherDraft.payee.trim() || null, narration: voucherDraft.narration.trim(), amount: Number(voucherDraft.amount), expense_gl_account_id: voucherDraft.voucherType === "expense" ? voucherDraft.expenseGlId : null, offset_gl_account_id: voucherDraft.voucherType === "replenishment" ? voucherDraft.offsetGlId : null, vote_id: voucherDraft.voteId || null, subvote_id: voucherDraft.subvoteId || null, receipt_reference: voucherDraft.receipt.trim() || null, submitted_by: user?.id || null });
    setSaving(false);
    if (error) { setMessage(`Could not submit voucher: ${text(error)}`); return; }
    setVoucherModal(false); setVoucherDraft({ fundId: "", voucherType: "expense", date: today(), payee: "", narration: "", amount: "", expenseGlId: "", offsetGlId: "", voteId: "", subvoteId: "", receipt: "" }); await load();
  };

  const approveAndPost = async (voucher: Voucher) => {
    const fund = fundById.get(voucher.fund_id);
    if (!fund || !orgId || !user?.id) return;
    if (!canControl) { setMessage("Only an accounting controller can approve and post a petty-cash voucher."); return; }
    if (voucher.submitted_by === user.id) { setMessage("A different finance user must approve this voucher."); return; }
    const counterpart = voucher.voucher_type === "expense" ? voucher.expense_gl_account_id : voucher.offset_gl_account_id;
    if (!counterpart) { setMessage("This voucher has no counterpart GL account."); return; }
    setSaving(true);
    try {
      const approval = await supabase.from("school_petty_cash_vouchers").update({ status: "approved", approved_by: user.id, approved_at: new Date().toISOString() }).eq("id", voucher.id).in("status", ["submitted", "approved"]);
      if (approval.error) throw approval.error;
      const amount = Number(voucher.amount);
      const journal = await createJournalEntry({ organizationId: orgId, entry_date: voucher.voucher_date, description: `Petty cash ${voucher.voucher_number}: ${voucher.narration}`, reference_type: "school_petty_cash", reference_id: voucher.id, created_by: user.id, lines: voucher.voucher_type === "expense"
        ? [{ gl_account_id: counterpart, debit: amount, credit: 0, line_description: voucher.narration }, { gl_account_id: fund.cash_gl_account_id, debit: 0, credit: amount, line_description: `Petty cash ${fund.name}` }]
        : [{ gl_account_id: fund.cash_gl_account_id, debit: amount, credit: 0, line_description: `Replenish ${fund.name}` }, { gl_account_id: counterpart, debit: 0, credit: amount, line_description: voucher.narration }], });
      if (!journal.ok) throw new Error(journal.error);
      const posted = await supabase.from("school_petty_cash_vouchers").update({ status: "posted", posted_by: user.id, posted_at: new Date().toISOString(), journal_entry_id: journal.journalId }).eq("id", voucher.id);
      if (posted.error) throw posted.error;
      await load();
    } catch (error) { setMessage(`Could not post voucher: ${text(error)}`); }
    finally { setSaving(false); }
  };

  const rejectVoucher = async (voucher: Voucher) => {
    if (!canControl) return;
    const reason = window.prompt("Reason for rejecting this voucher:");
    if (!reason?.trim()) return;
    const { error } = await supabase.from("school_petty_cash_vouchers").update({ status: "rejected", rejection_reason: reason.trim() }).eq("id", voucher.id).eq("status", "submitted");
    if (error) setMessage(`Could not reject voucher: ${text(error)}`); else await load();
  };

  const recordCount = async () => {
    if (!countModal || !orgId || Number(countDraft.counted) < 0) { setMessage("Enter the physical cash counted."); return; }
    const expected = balanceByFund.get(countModal.id) || 0, counted = Number(countDraft.counted);
    setSaving(true);
    const { error } = await supabase.from("school_petty_cash_counts").insert({ organization_id: orgId, fund_id: countModal.id, count_date: today(), expected_amount: expected, counted_amount: counted, variance_amount: counted - expected, notes: countDraft.notes.trim() || null, counted_by: user?.id || null });
    setSaving(false);
    if (error) { setMessage(`Could not record count: ${text(error)}`); return; }
    setCountModal(null); setCountDraft({ counted: "", notes: "" }); await load();
  };

  return <div className="space-y-6 p-4 md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><Wallet className="h-7 w-7 text-teal-700" /><h1 className="text-3xl font-bold text-slate-900">Petty Cash</h1><PageNotes ariaLabel="Petty cash help"><p>Use a separate float for small cash spending. Every voucher is approved, posted to the general ledger, and remains available for physical-count review.</p></PageNotes></div><p className="mt-2 text-sm text-slate-600">Custody, voucher approvals, replenishment and cash-count controls for school funds.</p></div><div className="flex gap-2"><button type="button" onClick={() => void load()} className="app-btn-secondary"><RefreshCw className="h-4 w-4" />Refresh</button>{canControl && <button type="button" onClick={() => setFundModal(true)} className="app-btn-secondary"><Plus className="h-4 w-4" />New fund</button>}{!readOnly && <button type="button" onClick={() => setVoucherModal(true)} className="app-btn-primary"><Plus className="h-4 w-4" />New voucher</button>}</div></div>
    {message && <div className="flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><span>{message}</span><button onClick={() => setMessage(null)}><X className="h-4 w-4" /></button></div>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Cash held" value={money.format(totalBalance)} icon={<Banknote className="h-5 w-5" />} /><Metric label="Pending approval" value={money.format(pendingValue)} hint={`${vouchers.filter((v) => ["submitted", "approved"].includes(v.status)).length} voucher(s)`} icon={<ClipboardCheck className="h-5 w-5" />} /><Metric label="Active funds" value={String(funds.filter((fund) => fund.is_active).length)} icon={<Wallet className="h-5 w-5" />} /><Metric label="Exceptions" value={String(exceptions.length)} hint="Low floats or count variances" danger={exceptions.length > 0} icon={<AlertTriangle className="h-5 w-5" />} /></div>
    <div className="flex gap-2 border-b border-slate-200">{(["overview", "vouchers", "counts"] as const).map((item) => <button key={item} onClick={() => setTab(item)} className={`border-b-2 px-4 py-2 text-sm font-semibold capitalize ${tab === item ? "border-teal-600 text-teal-700" : "border-transparent text-slate-500"}`}>{item}</button>)}</div>
    {loading ? <div className="rounded-xl border bg-white p-8 text-sm text-slate-500">Loading petty-cash controls…</div> : tab === "overview" ? <div className="grid gap-5 xl:grid-cols-3"><section className="xl:col-span-2 overflow-hidden rounded-xl border bg-white"><div className="border-b p-4"><h2 className="font-bold">Funds and custody</h2><p className="mt-1 text-sm text-slate-500">A fund is a distinct physical float and its matching Chart of Accounts cash account.</p></div><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-slate-600"><tr><th className="p-3">Fund / custodian</th><th className="p-3 text-right">Balance</th><th className="p-3 text-right">Float limit</th><th className="p-3">Control</th><th className="p-3" /></tr></thead><tbody>{funds.map((fund) => { const balance = balanceByFund.get(fund.id) || 0; const last = latestCountByFund.get(fund.id); const low = fund.replenishment_threshold > 0 && balance <= fund.replenishment_threshold; return <tr key={fund.id} className="border-t"><td className="p-3"><div className="font-medium">{fund.name}</div><div className="text-xs text-slate-500">{accountById.get(fund.cash_gl_account_id)?.account_name || "Cash GL unavailable"}</div></td><td className="p-3 text-right font-semibold tabular-nums">{money.format(balance)}</td><td className="p-3 text-right tabular-nums">{money.format(Number(fund.float_limit || 0))}</td><td className="p-3">{low ? <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">Replenish</span> : last && Math.abs(Number(last.variance_amount)) > .01 ? <span className="rounded-full bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-800">Count variance</span> : <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">In control</span>}</td><td className="p-3">{!readOnly && <button onClick={() => { setCountModal(fund); setCountDraft({ counted: "", notes: "" }); }} className="text-sm font-semibold text-teal-700 hover:underline">Count cash</button>}</td></tr>; })}{funds.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-slate-500">Create a petty-cash fund to begin.</td></tr>}</tbody></table></div></section><section className="rounded-xl border bg-white p-4"><h2 className="font-bold">Controls needing attention</h2><div className="mt-3 space-y-3">{exceptions.map((fund) => <div key={fund.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><p className="font-semibold text-amber-900">{fund.name}</p><p className="mt-1 text-amber-800">{(fund.replenishment_threshold > 0 && (balanceByFund.get(fund.id) || 0) <= fund.replenishment_threshold) ? "Balance is at or below its replenishment threshold." : "Latest physical count differs from calculated balance."}</p></div>)}{exceptions.length === 0 && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">All funds are within their configured controls.</p>}</div></section></div> : tab === "vouchers" ? <section className="rounded-xl border bg-white"><div className="flex flex-wrap gap-3 border-b p-4"><select value={fundFilter} onChange={(e) => setFundFilter(e.target.value)} className="rounded-lg border px-3 py-2 text-sm"><option value="">All funds</option>{funds.map((fund) => <option key={fund.id} value={fund.id}>{fund.name}</option>)}</select><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border px-3 py-2 text-sm"><option value="">All statuses</option>{["submitted", "approved", "posted", "rejected", "reversed"].map((status) => <option key={status}>{status}</option>)}</select></div><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-slate-600"><tr><th className="p-3">Date / voucher</th><th className="p-3">Fund</th><th className="p-3">Details</th><th className="p-3">Status</th><th className="p-3 text-right">Amount</th><th className="p-3" /></tr></thead><tbody>{visibleVouchers.map((voucher) => <tr key={voucher.id} className="border-t"><td className="p-3"><div>{voucher.voucher_date}</div><div className="text-xs text-slate-500">{voucher.voucher_number}</div></td><td className="p-3">{fundById.get(voucher.fund_id)?.name || "—"}</td><td className="p-3"><div className="font-medium">{voucher.narration}</div><div className="text-xs text-slate-500">{voucher.payee || "No payee"}{voucher.receipt_reference ? ` · ${voucher.receipt_reference}` : ""}</div></td><td className="p-3"><Status value={voucher.status} /></td><td className="p-3 text-right font-semibold tabular-nums">{money.format(Number(voucher.amount))}</td><td className="p-3 text-right">{voucher.status === "submitted" && canControl && <div className="flex justify-end gap-2"><button disabled={saving || voucher.submitted_by === user?.id} onClick={() => void approveAndPost(voucher)} className="text-sm font-semibold text-teal-700 disabled:text-slate-400">Approve & post</button><button disabled={saving} onClick={() => void rejectVoucher(voucher)} className="text-sm font-semibold text-rose-700">Reject</button></div>}{voucher.status === "submitted" && voucher.submitted_by === user?.id && <span className="text-xs text-slate-500">Awaiting another approver</span>}</td></tr>)}{visibleVouchers.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-500">No vouchers match these filters.</td></tr>}</tbody></table></div></section> : <section className="rounded-xl border bg-white"><div className="border-b p-4"><h2 className="font-bold">Physical cash counts</h2><p className="mt-1 text-sm text-slate-500">Counts compare cash physically present with posted petty-cash activity. Differences are retained as exceptions for review.</p></div><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-slate-600"><tr><th className="p-3">Date</th><th className="p-3">Fund</th><th className="p-3 text-right">Expected</th><th className="p-3 text-right">Counted</th><th className="p-3 text-right">Variance</th><th className="p-3">Notes</th></tr></thead><tbody>{counts.map((count) => <tr key={count.id} className="border-t"><td className="p-3">{count.count_date}</td><td className="p-3">{fundById.get(count.fund_id)?.name || "—"}</td><td className="p-3 text-right tabular-nums">{money.format(Number(count.expected_amount))}</td><td className="p-3 text-right tabular-nums">{money.format(Number(count.counted_amount))}</td><td className={`p-3 text-right font-semibold tabular-nums ${Math.abs(Number(count.variance_amount)) > .01 ? "text-rose-700" : "text-emerald-700"}`}>{money.format(Number(count.variance_amount))}</td><td className="p-3 text-slate-600">{count.notes || "—"}</td></tr>)}{counts.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-500">No physical cash counts recorded yet.</td></tr>}</tbody></table></div></section>}
    {fundModal && <Modal title="Create petty-cash fund" onClose={() => !saving && setFundModal(false)}><div className="space-y-3"><Input label="Fund name *" value={fundDraft.name} onChange={(name) => setFundDraft({ ...fundDraft, name })} placeholder="For example, Main office petty cash" /><Combo label="Petty-cash GL account *" value={fundDraft.cashGlId} onChange={(cashGlId) => setFundDraft({ ...fundDraft, cashGlId })} options={options(cashAccounts)} placeholder="Select cash account from Chart of Accounts" /><Combo label="Default replenishment source" value={fundDraft.sourceGlId} onChange={(sourceGlId) => setFundDraft({ ...fundDraft, sourceGlId })} options={options(fundingAccounts)} placeholder="Select bank, cash or wallet account" /><label className="block text-sm font-medium text-slate-700">Custodian<select value={fundDraft.custodianId} onChange={(e) => setFundDraft({ ...fundDraft, custodianId: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="">Unassigned</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.full_name || person.email || person.id}</option>)}</select></label><div className="grid grid-cols-2 gap-3"><Input label="Float limit" type="number" value={fundDraft.floatLimit} onChange={(floatLimit) => setFundDraft({ ...fundDraft, floatLimit })} /><Input label="Replenish at or below" type="number" value={fundDraft.threshold} onChange={(threshold) => setFundDraft({ ...fundDraft, threshold })} /></div><Input label="Notes" value={fundDraft.notes} onChange={(notes) => setFundDraft({ ...fundDraft, notes })} /></div><ModalActions onCancel={() => setFundModal(false)} onSave={() => void createFund()} saving={saving} label="Create fund" /></Modal>}
    {voucherModal && <Modal title="Submit petty-cash voucher" onClose={() => !saving && setVoucherModal(false)}><div className="space-y-3"><Combo label="Fund *" value={voucherDraft.fundId} onChange={(fundId) => setVoucherDraft({ ...voucherDraft, fundId })} options={fundOptions} placeholder="Choose petty-cash fund" /><div className="grid grid-cols-2 gap-3"><label className="block text-sm font-medium text-slate-700">Voucher type<select value={voucherDraft.voucherType} onChange={(e) => setVoucherDraft({ ...voucherDraft, voucherType: e.target.value as "expense" | "replenishment" })} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="expense">Cash expense</option><option value="replenishment">Replenishment</option></select></label><Input label="Date" type="date" value={voucherDraft.date} onChange={(date) => setVoucherDraft({ ...voucherDraft, date })} /></div><Input label={voucherDraft.voucherType === "expense" ? "Payee" : "Source / transfer note"} value={voucherDraft.payee} onChange={(payee) => setVoucherDraft({ ...voucherDraft, payee })} /><Input label="Narration *" value={voucherDraft.narration} onChange={(narration) => setVoucherDraft({ ...voucherDraft, narration })} placeholder="What was paid or replenished?" /><Input label="Amount (UGX) *" type="number" value={voucherDraft.amount} onChange={(amount) => setVoucherDraft({ ...voucherDraft, amount })} />{voucherDraft.voucherType === "expense" ? <><Combo label="Expense GL account *" value={voucherDraft.expenseGlId} onChange={(expenseGlId) => setVoucherDraft({ ...voucherDraft, expenseGlId })} options={options(expenseAccounts)} placeholder="Search expense accounts" /><label className="block text-sm font-medium text-slate-700">Vote<select value={voucherDraft.voteId} onChange={(e) => setVoucherDraft({ ...voucherDraft, voteId: e.target.value, subvoteId: "" })} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="">No vote</option>{votes.map((vote) => <option key={vote.id} value={vote.id}>{vote.vote_code} — {vote.vote_name}</option>)}</select></label><Combo label="Subvote" value={voucherDraft.subvoteId} onChange={(subvoteId) => { const selected = subvotes.find((subvote) => subvote.id === subvoteId); setVoucherDraft({ ...voucherDraft, subvoteId, expenseGlId: selected?.default_gl_account_id || voucherDraft.expenseGlId }); }} options={subvotes.filter((subvote) => !voucherDraft.voteId || subvote.vote_id === voucherDraft.voteId).map((subvote) => ({ id: subvote.id, label: `${subvote.subvote_code} — ${subvote.subvote_name}` }))} placeholder="Search subvotes" /></> : <Combo label="Funding account *" value={voucherDraft.offsetGlId} onChange={(offsetGlId) => setVoucherDraft({ ...voucherDraft, offsetGlId })} options={options(fundingAccounts)} placeholder="Select bank, cash or wallet account" />}<Input label="Receipt / transfer reference" value={voucherDraft.receipt} onChange={(receipt) => setVoucherDraft({ ...voucherDraft, receipt })} /></div><ModalActions onCancel={() => setVoucherModal(false)} onSave={() => void createVoucher()} saving={saving} label="Submit voucher" /></Modal>}
    {countModal && <Modal title={`Count cash — ${countModal.name}`} onClose={() => !saving && setCountModal(null)}><div className="space-y-3"><div className="rounded-lg bg-slate-50 p-3 text-sm"><span className="text-slate-600">Expected ledger balance</span><p className="mt-1 text-xl font-bold">{money.format(balanceByFund.get(countModal.id) || 0)}</p></div><Input label="Physical cash counted (UGX) *" type="number" value={countDraft.counted} onChange={(counted) => setCountDraft({ ...countDraft, counted })} /><Input label="Count notes" value={countDraft.notes} onChange={(notes) => setCountDraft({ ...countDraft, notes })} placeholder="Explain any shortage or surplus" /></div><ModalActions onCancel={() => setCountModal(null)} onSave={() => void recordCount()} saving={saving} label="Save count" /></Modal>}
  </div>;
}

function Metric({ label, value, hint, icon, danger = false }: { label: string; value: string; hint?: string; icon: ReactNode; danger?: boolean }) { return <div className={`rounded-xl border bg-white p-4 ${danger ? "border-amber-300" : "border-slate-200"}`}><div className="flex items-center justify-between text-sm text-slate-500"><span>{label}</span><span className={danger ? "text-amber-600" : "text-teal-700"}>{icon}</span></div><div className={`mt-2 text-2xl font-bold tabular-nums ${danger ? "text-amber-800" : "text-slate-900"}`}>{value}</div>{hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}</div>; }
function Status({ value }: { value: Voucher["status"] }) { const styles: Record<string, string> = { submitted: "bg-amber-100 text-amber-800", approved: "bg-sky-100 text-sky-800", posted: "bg-emerald-100 text-emerald-800", rejected: "bg-rose-100 text-rose-800", reversed: "bg-slate-200 text-slate-700", draft: "bg-slate-100 text-slate-700" }; return <span className={`rounded-full px-2 py-1 text-xs font-semibold capitalize ${styles[value]}`}>{value}</span>; }
function Input({ label, value, onChange, type = "text", placeholder = "" }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string }) { return <label className="block text-sm font-medium text-slate-700">{label}<input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>; }
function Combo({ label, value, onChange, options, placeholder }: { label: string; value: string; onChange: (value: string) => void; options: { id: string; label: string }[]; placeholder: string }) { return <label className="block text-sm font-medium text-slate-700">{label}<SearchableCombobox value={value} onChange={onChange} options={options} placeholder={placeholder} emptyOption={{ label: "Select…" }} clearable /></label>; }
function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) { return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onMouseDown={onClose}><section className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onMouseDown={(e) => e.stopPropagation()}><div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-bold">{title}</h2><button onClick={onClose}><X className="h-5 w-5" /></button></div>{children}</section></div>; }
function ModalActions({ onCancel, onSave, saving, label }: { onCancel: () => void; onSave: () => void; saving: boolean; label: string }) { return <div className="mt-6 flex justify-end gap-2"><button disabled={saving} onClick={onCancel} className="app-btn-secondary">Cancel</button><button disabled={saving} onClick={onSave} className="app-btn-primary">{saving ? "Saving…" : label}</button></div>; }
