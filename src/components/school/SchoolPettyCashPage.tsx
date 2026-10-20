import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Banknote, CheckCircle2, ClipboardCheck, Download, Plus, RefreshCw, Upload, Wallet, X } from "lucide-react";
import * as XLSX from "xlsx";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";
import { createJournalEntry } from "../../lib/journal";
import { SearchableCombobox } from "../common/SearchableCombobox";
import { PageNotes } from "../common/PageNotes";
import { SchoolSpendingGuideButton } from "./SchoolSpendingGuide";

type GlAccount = { id: string; account_code: string; account_name: string; account_type: string; category: string | null };
type Fund = { id: string; name: string; cash_gl_account_id: string; replenishment_source_gl_account_id: string | null; custodian_id: string | null; float_limit: number; replenishment_threshold: number; is_active: boolean; notes: string | null };
type Voucher = { id: string; fund_id: string; voucher_number: string; voucher_date: string; voucher_type: "expense" | "replenishment" | "adjustment"; status: "draft" | "submitted" | "approved" | "rejected" | "posted" | "reversed"; payee: string | null; narration: string; amount: number; expense_gl_account_id: string | null; offset_gl_account_id: string | null; vote_id: string | null; subvote_id: string | null; receipt_reference: string | null; submitted_by: string | null; approved_by: string | null; journal_entry_id: string | null; import_batch_id?: string | null; import_fingerprint?: string | null };
type Count = { id: string; fund_id: string; count_date: string; expected_amount: number; counted_amount: number; variance_amount: number; notes: string | null; reviewed_by: string | null };
type Staff = { id: string; full_name: string | null; email: string | null };
type Vote = { id: string; vote_code: string; vote_name: string };
type Subvote = { id: string; vote_id: string; subvote_code: string; subvote_name: string; default_gl_account_id: string | null };

const money = new Intl.NumberFormat("en-UG", { style: "currency", currency: "UGX", maximumFractionDigits: 0 });
const today = () => new Date().toISOString().slice(0, 10);
const text = (error: unknown) => error instanceof Error ? error.message : (error && typeof error === "object" && "message" in error ? String(error.message) : String(error || "Unknown error"));
const voucherNo = () => `PC-${today().replaceAll("-", "")}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const importBatch = () => `PC-${today().replaceAll("-", "")}-${Date.now().toString(36).toUpperCase()}`;
const normalized = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const numberValue = (value: unknown) => Number(String(value ?? "").replace(/[,$\s]/g, "").replace(/^UGX/i, ""));
function fingerprint(values: unknown[]) { let hash = 2166136261; const value = values.map(normalized).join("|"); for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619); return (hash >>> 0).toString(36); }
function importDate(value: unknown): string { if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10); const raw = String(value ?? "").trim(); if (/^\d+(\.\d+)?$/.test(raw)) { const parts = XLSX.SSF.parse_date_code(Number(raw)); if (parts?.y && parts.m && parts.d) return `${parts.y}-${String(parts.m).padStart(2, "0")}-${String(parts.d).padStart(2, "0")}`; } const dmy = raw.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/); if (dmy) { const day = Number(dmy[1]), month = Number(dmy[2]), year = Number(dmy[3]), candidate = new Date(Date.UTC(year, month - 1, day)); return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : raw; } const parsed = Date.parse(raw); return Number.isNaN(parsed) ? raw : new Date(parsed).toISOString().slice(0, 10); }
const field = (row: Record<string, unknown>, ...names: string[]) => { const keys = Object.keys(row); const key = keys.find((candidate) => names.includes(candidate.trim().toLowerCase().replace(/[\s-]+/g, "_"))); return key ? row[key] : ""; };

export function SchoolPettyCashPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const role = String(user?.role || "").toLowerCase();
  const canControl = !readOnly && Boolean(user?.isSuperAdmin || ["admin", "super_admin", "manager", "accountant"].includes(role));
  const canSelfApprove = Boolean(user?.isSuperAdmin);
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
  const [fundNameEdit, setFundNameEdit] = useState<Fund | null>(null);
  const [fundNameDraft, setFundNameDraft] = useState("");
  const [voucherModal, setVoucherModal] = useState(false);
  const [countModal, setCountModal] = useState<Fund | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ completed: 0, total: 0 });
  const [importIssues, setImportIssues] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<string | null>(null);
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
  const subvoteOptions = subvotes.map((subvote) => {
    const account = subvote.default_gl_account_id ? accountById.get(subvote.default_gl_account_id) : null;
    return { id: subvote.id, label: `${subvote.subvote_code} — ${subvote.subvote_name}${account ? ` · ${account.account_code} — ${account.account_name}` : ""}` };
  });

  const applySubvoteClassification = (subvoteId: string) => {
    const subvote = subvotes.find((item) => item.id === subvoteId);
    setVoucherDraft({
      ...voucherDraft,
      subvoteId,
      voteId: subvote?.vote_id || "",
      expenseGlId: subvote?.default_gl_account_id || "",
    });
  };

  const applyExpenseGlClassification = (expenseGlId: string) => {
    if (!expenseGlId) {
      setVoucherDraft({ ...voucherDraft, expenseGlId: "", voteId: "", subvoteId: "" });
      return;
    }
    const mappedSubvotes = subvotes.filter((subvote) => subvote.default_gl_account_id === expenseGlId);
    if (mappedSubvotes.length === 1) {
      const subvote = mappedSubvotes[0];
      setVoucherDraft({ ...voucherDraft, expenseGlId, voteId: subvote.vote_id, subvoteId: subvote.id });
      return;
    }
    const mappedVotes = [...new Set(mappedSubvotes.map((subvote) => subvote.vote_id))];
    setVoucherDraft({ ...voucherDraft, expenseGlId, voteId: mappedVotes.length === 1 ? mappedVotes[0] : "", subvoteId: "" });
    setMessage(mappedSubvotes.length
      ? "This GL account is used by more than one subvote. Select the intended subvote to complete the classification."
      : "This GL account has no active subvote mapping. Select or configure a subvote before posting this expense.");
  };

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

  const renameFund = async () => {
    if (!fundNameEdit || !fundNameDraft.trim()) { setMessage("Enter a fund name."); return; }
    if (fundNameDraft.trim() === fundNameEdit.name) { setFundNameEdit(null); return; }
    setSaving(true);
    const { error } = await supabase.from("school_petty_cash_funds").update({ name: fundNameDraft.trim() }).eq("id", fundNameEdit.id);
    setSaving(false);
    if (error) { setMessage(`Could not rename fund: ${text(error)}`); return; }
    setFundNameEdit(null); setFundNameDraft(""); await load();
  };

  const createVoucher = async () => {
    if (!orgId || !voucherDraft.fundId || !voucherDraft.narration.trim() || Number(voucherDraft.amount) <= 0) { setMessage("Select a fund and enter a narration and positive amount."); return; }
    if (voucherDraft.voucherType === "expense" && (!voucherDraft.expenseGlId || !voucherDraft.voteId || !voucherDraft.subvoteId)) { setMessage("Select a subvote or a uniquely mapped expense GL so the vote, subvote, and GL are all recorded."); return; }
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
    if (voucher.submitted_by === user.id && !canSelfApprove) { setMessage("A different finance user must approve this voucher."); return; }
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

  const downloadImportTemplate = () => {
    const csv = [
      "date,fund,voucher_type,payee,narration,amount,expense_gl_code,offset_gl_code,vote_code,subvote_code,receipt_reference,voucher_number",
      "07/01/2026,Main Office Petty Cash,expense,Stationery Shop,January stationery,50000,6200,,19,19.01,RC-1001,",
      "08/01/2026,Main Office Petty Cash,replenishment,Bank- Centenary 1285,Replenish petty cash float,500000,,1121,,,,PC-20260108-001",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "boat_school_petty_cash_import_template.csv"; link.click(); URL.revokeObjectURL(url);
  };

  const importFile = async (file?: File) => {
    if (!file || !orgId || importing || readOnly) return;
    setImporting(true); setImportIssues([]); setImportResult(null);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const sheet = workbook.SheetNames[0] ? workbook.Sheets[workbook.SheetNames[0]] : null;
      if (!sheet) throw new Error("The file has no worksheet.");
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: true });
      if (!rows.length) throw new Error("The file contains no data rows.");
      const batch = importBatch(); const issues: string[] = []; let imported = 0; let updated = 0; let skipped = 0;
      const fundMap = new Map(funds.map((fund) => [normalized(fund.name), fund]));
      const accountByCode = new Map(accounts.map((account) => [normalized(account.account_code), account]));
      const voteByCode = new Map<string, Vote>();
      for (const vote of votes) for (const value of [vote.vote_code, vote.vote_name, `${vote.vote_code} ${vote.vote_name}`]) voteByCode.set(normalized(value), vote);
      const subvoteByCode = new Map<string, Subvote>();
      for (const subvote of subvotes) for (const value of [subvote.subvote_code, subvote.subvote_name, `${subvote.subvote_code} ${subvote.subvote_name}`]) subvoteByCode.set(normalized(value), subvote);
      setImportProgress({ completed: 0, total: rows.length });
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]; const rowLabel = `Row ${index + 2}`;
        try {
          const date = importDate(field(row, "date", "voucher_date"));
          const fundName = String(field(row, "fund", "petty_cash_fund") || "").trim();
          const voucherTypeRaw = String(field(row, "voucher_type", "type") || "expense").trim().toLowerCase();
          const voucherType = voucherTypeRaw === "top_up" || voucherTypeRaw === "topup" ? "replenishment" : voucherTypeRaw;
          const payee = String(field(row, "payee", "supplier", "beneficiary") || "").trim();
          const narration = String(field(row, "narration", "particulars", "description") || "").trim();
          const amount = numberValue(field(row, "amount", "total"));
          const expenseCode = String(field(row, "expense_gl_code", "expense_gl", "expense_account_code") || "").trim();
          const offsetCode = String(field(row, "offset_gl_code", "funding_gl_code", "source_gl_code") || "").trim();
          const voteCode = String(field(row, "vote_code", "vote") || "").trim();
          const subvoteCode = String(field(row, "subvote_code", "subvote") || "").trim();
          const receipt = String(field(row, "receipt_reference", "receipt", "reference") || "").trim();
          const suppliedNumber = String(field(row, "voucher_number", "voucher_no") || "").trim();
          const fund = fundMap.get(normalized(fundName));
           if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("a valid Date is required (for example 07/01/2026).");
          if (!fund) throw new Error(`fund '${fundName || "blank"}' was not found. Create it first or use its exact name.`);
          if (!fund.is_active) throw new Error(`fund '${fund.name}' is inactive.`);
          if (voucherType !== "expense" && voucherType !== "replenishment") throw new Error("Voucher Type must be expense or replenishment.");
          if (!narration) throw new Error("Narration is required.");
          if (!Number.isFinite(amount) || amount <= 0) throw new Error("a positive Amount is required.");
           let expense = expenseCode ? accountByCode.get(normalized(expenseCode)) : undefined;
          const offset = offsetCode ? accountByCode.get(normalized(offsetCode)) : undefined;
          if (voucherType === "replenishment" && (!offset || offset.account_type !== "asset")) throw new Error(`offset_gl_code '${offsetCode || "blank"}' must be an active bank, cash, mobile-money, or wallet account.`);
           let vote = voteCode ? voteByCode.get(normalized(voteCode)) : undefined;
           let subvote = subvoteCode ? subvoteByCode.get(normalized(subvoteCode)) : undefined;
          if (voteCode && !vote) throw new Error(`vote_code '${voteCode}' was not found.`);
          if (subvoteCode && !subvote) throw new Error(`subvote_code '${subvoteCode}' was not found.`);
           if (voucherType === "expense") {
             if (subvote) {
               const mappedExpense = subvote.default_gl_account_id ? accounts.find((account) => account.id === subvote!.default_gl_account_id) : undefined;
               if (!mappedExpense || mappedExpense.account_type !== "expense") throw new Error(`subvote '${subvoteCode}' has no active mapped expense GL.`);
               if (expense && expense.id !== mappedExpense.id) throw new Error(`expense_gl_code '${expenseCode}' does not match the GL mapped to subvote '${subvoteCode}'.`);
               expense = mappedExpense;
               const mappedVote = votes.find((item) => item.id === subvote!.vote_id);
               if (!mappedVote) throw new Error(`subvote '${subvoteCode}' has no active parent vote.`);
               if (vote && vote.id !== mappedVote.id) throw new Error(`subvote '${subvoteCode}' does not belong to vote '${voteCode}'.`);
               vote = mappedVote;
             } else if (expense) {
               if (expense.account_type !== "expense") throw new Error(`expense_gl_code '${expenseCode}' must be an active expense account.`);
               const matches = subvotes.filter((item) => item.default_gl_account_id === expense!.id && (!vote || item.vote_id === vote.id));
               if (matches.length !== 1) throw new Error(matches.length ? `expense_gl_code '${expenseCode}' maps to multiple subvotes; provide subvote_code.` : `expense_gl_code '${expenseCode}' has no mapped school subvote.`);
               subvote = matches[0];
               vote = votes.find((item) => item.id === subvote!.vote_id);
             } else {
               throw new Error("provide a subvote_code or expense_gl_code for an expense voucher.");
             }
           }
           const rowFingerprint = fingerprint([date, fund.id, voucherType, payee, narration, amount, expense?.id || "", offsetCode, vote?.id || "", subvote?.id || "", receipt, suppliedNumber]);
          const voucherNumber = suppliedNumber || `PC-IMP-${rowFingerprint.toUpperCase()}`;
           const duplicate = await supabase.from("school_petty_cash_vouchers").select("id,status,import_fingerprint,voucher_number").eq("organization_id", orgId).or(`import_fingerprint.eq.${rowFingerprint},voucher_number.eq.${voucherNumber}`).limit(2);
          if (duplicate.error) throw duplicate.error;
           const exactDuplicate = (duplicate.data || []).find((item) => item.import_fingerprint === rowFingerprint);
           if (exactDuplicate) { skipped += 1; continue; }
           const sameVoucher = suppliedNumber ? (duplicate.data || []).find((item) => item.voucher_number === voucherNumber) : undefined;
           if (sameVoucher) {
             if (!["draft", "submitted", "rejected"].includes(String(sameVoucher.status))) throw new Error(`voucher '${voucherNumber}' has already been approved or posted and cannot be changed by import.`);
             const correction = await supabase.from("school_petty_cash_vouchers").update({ fund_id: fund.id, voucher_date: date, voucher_type: voucherType, payee: payee || null, narration, amount, expense_gl_account_id: expense?.id || null, offset_gl_account_id: offset?.id || null, vote_id: vote?.id || null, subvote_id: subvote?.id || null, receipt_reference: receipt || null, import_batch_id: batch, import_fingerprint: rowFingerprint }).eq("id", sameVoucher.id).in("status", ["draft", "submitted", "rejected"]);
             if (correction.error) throw correction.error;
             updated += 1; continue;
           }
          const insert = await supabase.from("school_petty_cash_vouchers").insert({ organization_id: orgId, fund_id: fund.id, voucher_number: voucherNumber, voucher_date: date, voucher_type: voucherType, status: "submitted", payee: payee || null, narration, amount, expense_gl_account_id: expense?.id || null, offset_gl_account_id: offset?.id || null, vote_id: vote?.id || null, subvote_id: subvote?.id || null, receipt_reference: receipt || null, submitted_by: user?.id || null, import_batch_id: batch, import_fingerprint: rowFingerprint });
          if (insert.error) throw insert.error;
          imported += 1;
        } catch (error) { issues.push(`${rowLabel}: ${text(error)}`); }
        finally { setImportProgress((progress) => ({ ...progress, completed: progress.completed + 1 })); }
      }
      setImportIssues(issues); setImportResult(`Imported ${imported} voucher(s) in batch ${batch}.${updated ? ` Updated ${updated} existing unapproved voucher(s).` : ""}${skipped ? ` Skipped ${skipped} unchanged duplicate row(s).` : ""}${issues.length ? ` ${issues.length} row(s) need attention.` : ""}`);
      await load();
    } catch (error) { setImportResult(`Import failed: ${text(error)}`); }
    finally { setImporting(false); setImportProgress({ completed: 0, total: 0 }); }
  };

  return <div className="space-y-6 p-4 md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><Wallet className="h-7 w-7 text-teal-700" /><h1 className="text-3xl font-bold text-slate-900">Petty Cash</h1><PageNotes ariaLabel="Petty cash help"><p>Use a separate float for small cash spending. Every voucher is approved, posted to the general ledger, and remains available for physical-count review.</p></PageNotes></div><p className="mt-2 text-sm text-slate-600">Custody, voucher approvals, replenishment and cash-count controls for school funds.</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => void load()} className="app-btn-secondary"><RefreshCw className="h-4 w-4" />Refresh</button><SchoolSpendingGuideButton focus="petty_cash" /><button type="button" onClick={downloadImportTemplate} className="app-btn-secondary"><Download className="h-4 w-4" />Template</button>{canControl && <label className={`app-btn-secondary cursor-pointer ${importing ? "pointer-events-none opacity-50" : ""}`}><Upload className="h-4 w-4" />Import vouchers<input type="file" accept=".csv,.xlsx,.xls,text/csv" className="hidden" disabled={importing} onChange={(event) => { void importFile(event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>}{canControl && <button type="button" onClick={() => setFundModal(true)} className="app-btn-secondary"><Plus className="h-4 w-4" />New fund</button>}{!readOnly && <button type="button" onClick={() => setVoucherModal(true)} className="app-btn-primary"><Plus className="h-4 w-4" />New voucher</button>}</div></div>
    {message && <div className="flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><span>{message}</span><button onClick={() => setMessage(null)}><X className="h-4 w-4" /></button></div>}
    {importing && importProgress.total > 0 && <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900" role="status"><div className="mb-2 flex justify-between"><span className="font-semibold">Importing petty-cash vouchers…</span><span>{importProgress.completed} / {importProgress.total}</span></div><div className="h-2 overflow-hidden rounded-full bg-indigo-100"><div className="h-full bg-indigo-600 transition-all" style={{ width: `${Math.round(importProgress.completed / importProgress.total * 100)}%` }} /></div></div>}
    {importResult && <div className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">{importResult}</div>}
    {importIssues.length > 0 && <div className="max-h-52 overflow-auto rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"><p className="font-semibold">Petty-cash import issues</p><ul className="mt-2 list-disc space-y-1 pl-5">{importIssues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}</ul></div>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Cash held" value={money.format(totalBalance)} icon={<Banknote className="h-5 w-5" />} /><Metric label="Pending approval" value={money.format(pendingValue)} hint={`${vouchers.filter((v) => ["submitted", "approved"].includes(v.status)).length} voucher(s)`} icon={<ClipboardCheck className="h-5 w-5" />} /><Metric label="Active funds" value={String(funds.filter((fund) => fund.is_active).length)} icon={<Wallet className="h-5 w-5" />} /><Metric label="Exceptions" value={String(exceptions.length)} hint="Low floats or count variances" danger={exceptions.length > 0} icon={<AlertTriangle className="h-5 w-5" />} /></div>
    {canSelfApprove && vouchers.some((voucher) => voucher.status === "submitted" && voucher.submitted_by === user?.id) && <div className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-sm text-teal-950"><p className="font-semibold">Your submitted vouchers</p><p className="mt-1 text-xs text-teal-800">As Super Admin, you may approve and post your own petty-cash vouchers. Your identity remains recorded as both submitter and approver in the audit trail.</p><div className="mt-3 flex flex-wrap gap-2">{vouchers.filter((voucher) => voucher.status === "submitted" && voucher.submitted_by === user?.id).map((voucher) => <button key={voucher.id} type="button" disabled={saving} onClick={() => void approveAndPost(voucher)} className="rounded-lg border border-teal-300 bg-white px-3 py-2 text-xs font-semibold text-teal-800 hover:bg-teal-100 disabled:opacity-50">Approve {voucher.voucher_number} · {money.format(Number(voucher.amount))}</button>)}</div></div>}
    {canControl && funds.length > 0 && <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm"><span className="font-medium text-slate-700">Manage funds:</span>{funds.map((fund) => <button key={fund.id} type="button" onClick={() => { setFundNameEdit(fund); setFundNameDraft(fund.name); }} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-slate-700 hover:border-teal-300 hover:bg-teal-50">Edit {fund.name}</button>)}</div>}
    <div className="flex gap-2 border-b border-slate-200">{(["overview", "vouchers", "counts"] as const).map((item) => <button key={item} onClick={() => setTab(item)} className={`border-b-2 px-4 py-2 text-sm font-semibold capitalize ${tab === item ? "border-teal-600 text-teal-700" : "border-transparent text-slate-500"}`}>{item}</button>)}</div>
    {loading ? <div className="rounded-xl border bg-white p-8 text-sm text-slate-500">Loading petty-cash controls…</div> : tab === "overview" ? <div className="grid gap-5 xl:grid-cols-3"><section className="xl:col-span-2 overflow-hidden rounded-xl border bg-white"><div className="border-b p-4"><h2 className="font-bold">Funds and custody</h2><p className="mt-1 text-sm text-slate-500">A fund is a distinct physical float and its matching Chart of Accounts cash account.</p></div><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-slate-600"><tr><th className="p-3">Fund / custodian</th><th className="p-3 text-right">Balance</th><th className="p-3 text-right">Float limit</th><th className="p-3">Control</th><th className="p-3" /></tr></thead><tbody>{funds.map((fund) => { const balance = balanceByFund.get(fund.id) || 0; const last = latestCountByFund.get(fund.id); const low = fund.replenishment_threshold > 0 && balance <= fund.replenishment_threshold; return <tr key={fund.id} className="border-t"><td className="p-3"><div className="font-medium">{fund.name}</div><div className="text-xs text-slate-500">{accountById.get(fund.cash_gl_account_id)?.account_name || "Cash GL unavailable"}</div></td><td className="p-3 text-right font-semibold tabular-nums">{money.format(balance)}</td><td className="p-3 text-right tabular-nums">{money.format(Number(fund.float_limit || 0))}</td><td className="p-3">{low ? <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">Replenish</span> : last && Math.abs(Number(last.variance_amount)) > .01 ? <span className="rounded-full bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-800">Count variance</span> : <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">In control</span>}</td><td className="p-3">{!readOnly && <button onClick={() => { setCountModal(fund); setCountDraft({ counted: "", notes: "" }); }} className="text-sm font-semibold text-teal-700 hover:underline">Count cash</button>}</td></tr>; })}{funds.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-slate-500">Create a petty-cash fund to begin.</td></tr>}</tbody></table></div></section><section className="rounded-xl border bg-white p-4"><h2 className="font-bold">Controls needing attention</h2><div className="mt-3 space-y-3">{exceptions.map((fund) => <div key={fund.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"><p className="font-semibold text-amber-900">{fund.name}</p><p className="mt-1 text-amber-800">{(fund.replenishment_threshold > 0 && (balanceByFund.get(fund.id) || 0) <= fund.replenishment_threshold) ? "Balance is at or below its replenishment threshold." : "Latest physical count differs from calculated balance."}</p></div>)}{exceptions.length === 0 && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">All funds are within their configured controls.</p>}</div></section></div> : tab === "vouchers" ? <section className="rounded-xl border bg-white"><div className="flex flex-wrap gap-3 border-b p-4"><select value={fundFilter} onChange={(e) => setFundFilter(e.target.value)} className="rounded-lg border px-3 py-2 text-sm"><option value="">All funds</option>{funds.map((fund) => <option key={fund.id} value={fund.id}>{fund.name}</option>)}</select><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border px-3 py-2 text-sm"><option value="">All statuses</option>{["submitted", "approved", "posted", "rejected", "reversed"].map((status) => <option key={status}>{status}</option>)}</select></div><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-slate-600"><tr><th className="p-3">Date / voucher</th><th className="p-3">Fund</th><th className="p-3">Details</th><th className="p-3">Status</th><th className="p-3 text-right">Amount</th><th className="p-3" /></tr></thead><tbody>{visibleVouchers.map((voucher) => <tr key={voucher.id} className="border-t"><td className="p-3"><div>{voucher.voucher_date}</div><div className="text-xs text-slate-500">{voucher.voucher_number}</div></td><td className="p-3">{fundById.get(voucher.fund_id)?.name || "—"}</td><td className="p-3"><div className="font-medium">{voucher.narration}</div><div className="text-xs text-slate-500">{voucher.payee || "No payee"}{voucher.receipt_reference ? ` · ${voucher.receipt_reference}` : ""}</div></td><td className="p-3"><Status value={voucher.status} /></td><td className="p-3 text-right font-semibold tabular-nums">{money.format(Number(voucher.amount))}</td><td className="p-3 text-right">{voucher.status === "submitted" && canControl && <div className="flex justify-end gap-2"><button disabled={saving || voucher.submitted_by === user?.id} onClick={() => void approveAndPost(voucher)} className="text-sm font-semibold text-teal-700 disabled:text-slate-400">Approve & post</button><button disabled={saving} onClick={() => void rejectVoucher(voucher)} className="text-sm font-semibold text-rose-700">Reject</button></div>}{voucher.status === "submitted" && voucher.submitted_by === user?.id && <span className="text-xs text-slate-500">Awaiting another approver</span>}</td></tr>)}{visibleVouchers.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-500">No vouchers match these filters.</td></tr>}</tbody></table></div></section> : <section className="rounded-xl border bg-white"><div className="border-b p-4"><h2 className="font-bold">Physical cash counts</h2><p className="mt-1 text-sm text-slate-500">Counts compare cash physically present with posted petty-cash activity. Differences are retained as exceptions for review.</p></div><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-slate-600"><tr><th className="p-3">Date</th><th className="p-3">Fund</th><th className="p-3 text-right">Expected</th><th className="p-3 text-right">Counted</th><th className="p-3 text-right">Variance</th><th className="p-3">Notes</th></tr></thead><tbody>{counts.map((count) => <tr key={count.id} className="border-t"><td className="p-3">{count.count_date}</td><td className="p-3">{fundById.get(count.fund_id)?.name || "—"}</td><td className="p-3 text-right tabular-nums">{money.format(Number(count.expected_amount))}</td><td className="p-3 text-right tabular-nums">{money.format(Number(count.counted_amount))}</td><td className={`p-3 text-right font-semibold tabular-nums ${Math.abs(Number(count.variance_amount)) > .01 ? "text-rose-700" : "text-emerald-700"}`}>{money.format(Number(count.variance_amount))}</td><td className="p-3 text-slate-600">{count.notes || "—"}</td></tr>)}{counts.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-500">No physical cash counts recorded yet.</td></tr>}</tbody></table></div></section>}
    {fundModal && <Modal title="Create petty-cash fund" onClose={() => !saving && setFundModal(false)}><div className="space-y-3"><Input label="Fund name *" value={fundDraft.name} onChange={(name) => setFundDraft({ ...fundDraft, name })} placeholder="For example, Main office petty cash" /><Combo label="Petty-cash GL account *" value={fundDraft.cashGlId} onChange={(cashGlId) => setFundDraft({ ...fundDraft, cashGlId })} options={options(cashAccounts)} placeholder="Select cash account from Chart of Accounts" /><Combo label="Default replenishment source" value={fundDraft.sourceGlId} onChange={(sourceGlId) => setFundDraft({ ...fundDraft, sourceGlId })} options={options(fundingAccounts)} placeholder="Select bank, cash or wallet account" /><label className="block text-sm font-medium text-slate-700">Custodian<select value={fundDraft.custodianId} onChange={(e) => setFundDraft({ ...fundDraft, custodianId: e.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="">Unassigned</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.full_name || person.email || person.id}</option>)}</select></label><div className="grid grid-cols-2 gap-3"><Input label="Float limit" type="number" value={fundDraft.floatLimit} onChange={(floatLimit) => setFundDraft({ ...fundDraft, floatLimit })} /><Input label="Replenish at or below" type="number" value={fundDraft.threshold} onChange={(threshold) => setFundDraft({ ...fundDraft, threshold })} /></div><Input label="Notes" value={fundDraft.notes} onChange={(notes) => setFundDraft({ ...fundDraft, notes })} /></div><ModalActions onCancel={() => setFundModal(false)} onSave={() => void createFund()} saving={saving} label="Create fund" /></Modal>}
    {fundNameEdit && <Modal title="Edit petty-cash fund name" onClose={() => !saving && setFundNameEdit(null)}><div className="space-y-3"><Input label="Fund name *" value={fundNameDraft} onChange={setFundNameDraft} /><p className="text-sm text-slate-500">The fund's GL account and all historical vouchers remain unchanged.</p></div><ModalActions onCancel={() => setFundNameEdit(null)} onSave={() => void renameFund()} saving={saving} label="Save name" /></Modal>}
    {voucherModal && <Modal title="Submit petty-cash voucher" onClose={() => !saving && setVoucherModal(false)}><div className="space-y-3"><Combo label="Fund *" value={voucherDraft.fundId} onChange={(fundId) => setVoucherDraft({ ...voucherDraft, fundId })} options={fundOptions} placeholder="Choose petty-cash fund" /><div className="grid grid-cols-2 gap-3"><label className="block text-sm font-medium text-slate-700">Voucher type<select value={voucherDraft.voucherType} onChange={(e) => setVoucherDraft({ ...voucherDraft, voucherType: e.target.value as "expense" | "replenishment" })} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="expense">Cash expense</option><option value="replenishment">Replenishment</option></select></label><Input label="Date" type="date" value={voucherDraft.date} onChange={(date) => setVoucherDraft({ ...voucherDraft, date })} /></div><Input label={voucherDraft.voucherType === "expense" ? "Payee" : "Source / transfer note"} value={voucherDraft.payee} onChange={(payee) => setVoucherDraft({ ...voucherDraft, payee })} /><Input label="Narration *" value={voucherDraft.narration} onChange={(narration) => setVoucherDraft({ ...voucherDraft, narration })} placeholder="What was paid or replenished?" /><Input label="Amount (UGX) *" type="number" value={voucherDraft.amount} onChange={(amount) => setVoucherDraft({ ...voucherDraft, amount })} />{voucherDraft.voucherType === "expense" ? <><Combo label="Subvote (recommended)" value={voucherDraft.subvoteId} onChange={applySubvoteClassification} options={subvoteOptions} placeholder="Search subvote — fills vote and GL" /><label className="block text-sm font-medium text-slate-700">Vote<select value={voucherDraft.voteId} onChange={(e) => setVoucherDraft({ ...voucherDraft, voteId: e.target.value, subvoteId: "" })} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="">No vote</option>{votes.map((vote) => <option key={vote.id} value={vote.id}>{vote.vote_code} — {vote.vote_name}</option>)}</select></label><Combo label="Expense GL account *" value={voucherDraft.expenseGlId} onChange={applyExpenseGlClassification} options={options(expenseAccounts)} placeholder="Search GL — fills mapping where unique" /></> : <Combo label="Funding account *" value={voucherDraft.offsetGlId} onChange={(offsetGlId) => setVoucherDraft({ ...voucherDraft, offsetGlId })} options={options(fundingAccounts)} placeholder="Select bank, cash or wallet account" />}<Input label="Receipt / transfer reference" value={voucherDraft.receipt} onChange={(receipt) => setVoucherDraft({ ...voucherDraft, receipt })} /></div><ModalActions onCancel={() => setVoucherModal(false)} onSave={() => void createVoucher()} saving={saving} label="Submit voucher" /></Modal>}
    {countModal && <Modal title={`Count cash — ${countModal.name}`} onClose={() => !saving && setCountModal(null)}><div className="space-y-3"><div className="rounded-lg bg-slate-50 p-3 text-sm"><span className="text-slate-600">Expected ledger balance</span><p className="mt-1 text-xl font-bold">{money.format(balanceByFund.get(countModal.id) || 0)}</p></div><Input label="Physical cash counted (UGX) *" type="number" value={countDraft.counted} onChange={(counted) => setCountDraft({ ...countDraft, counted })} /><Input label="Count notes" value={countDraft.notes} onChange={(notes) => setCountDraft({ ...countDraft, notes })} placeholder="Explain any shortage or surplus" /></div><ModalActions onCancel={() => setCountModal(null)} onSave={() => void recordCount()} saving={saving} label="Save count" /></Modal>}
  </div>;
}

function Metric({ label, value, hint, icon, danger = false }: { label: string; value: string; hint?: string; icon: ReactNode; danger?: boolean }) { return <div className={`rounded-xl border bg-white p-4 ${danger ? "border-amber-300" : "border-slate-200"}`}><div className="flex items-center justify-between text-sm text-slate-500"><span>{label}</span><span className={danger ? "text-amber-600" : "text-teal-700"}>{icon}</span></div><div className={`mt-2 text-2xl font-bold tabular-nums ${danger ? "text-amber-800" : "text-slate-900"}`}>{value}</div>{hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}</div>; }
function Status({ value }: { value: Voucher["status"] }) { const styles: Record<string, string> = { submitted: "bg-amber-100 text-amber-800", approved: "bg-sky-100 text-sky-800", posted: "bg-emerald-100 text-emerald-800", rejected: "bg-rose-100 text-rose-800", reversed: "bg-slate-200 text-slate-700", draft: "bg-slate-100 text-slate-700" }; return <span className={`rounded-full px-2 py-1 text-xs font-semibold capitalize ${styles[value]}`}>{value}</span>; }
function Input({ label, value, onChange, type = "text", placeholder = "" }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string }) { return <label className="block text-sm font-medium text-slate-700">{label}<input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>; }
function Combo({ label, value, onChange, options, placeholder }: { label: string; value: string; onChange: (value: string) => void; options: { id: string; label: string }[]; placeholder: string }) { return <label className="block text-sm font-medium text-slate-700">{label}<SearchableCombobox value={value} onChange={onChange} options={options} placeholder={placeholder} emptyOption={{ label: "Select…" }} clearable /></label>; }
function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) { return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onMouseDown={onClose}><section className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onMouseDown={(e) => e.stopPropagation()}><div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-bold">{title}</h2><button onClick={onClose}><X className="h-5 w-5" /></button></div>{children}</section></div>; }
function ModalActions({ onCancel, onSave, saving, label }: { onCancel: () => void; onSave: () => void; saving: boolean; label: string }) { return <div className="mt-6 flex justify-end gap-2"><button disabled={saving} onClick={onCancel} className="app-btn-secondary">Cancel</button><button disabled={saving} onClick={onSave} className="app-btn-primary">{saving ? "Saving…" : label}</button></div>; }
