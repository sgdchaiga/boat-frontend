import { useCallback, useEffect, useState } from "react";
import { Banknote, BookOpenCheck, Plus, Save, RotateCcw } from "lucide-react";
import { supabase } from "@/lib/supabase";

const db = supabase as any;
type Account = { id: string; account_code: string; account_name: string; account_type: string };
type Settings = { clearing_gl_account_id: string | null; sales_revenue_gl_account_id: string | null; commission_expense_gl_account_id: string | null; settlement_account_gl_account_id: string | null };
type Rule = { id: string; rule_type: "percentage" | "fixed"; rate: number; is_active: boolean; effective_from: string; effective_to: string | null };
type Order = { id: string; order_number: string; status: string; gross_amount: number; platform_fee: number; currency: string; finance_journal_entry_id: string | null };
type Settlement = { id: string; status: string; gross_sales: number; payment_charges: number; platform_commissions: number; net_amount: number; reference: string | null; journal_entry_id: string | null; created_at: string };
type Refund = { id: string; order_id: string; amount: number; commission_reversal: number; reason: string; payment_reference: string | null; journal_entry_id: string | null; created_at: string };
type RefundDraft = { amount: string; reason: string; reference: string };

const emptySettings: Settings = { clearing_gl_account_id: "", sales_revenue_gl_account_id: "", commission_expense_gl_account_id: "", settlement_account_gl_account_id: "" };
const money = (amount: number, currency = "UGX") => `${currency} ${Number(amount || 0).toLocaleString()}`;

export function MarketplaceFinancePanel({ merchantId, organizationId }: { merchantId: string; organizationId: string }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [settings, setSettings] = useState<Settings>(emptySettings);
  const [rules, setRules] = useState<Rule[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [ruleDraft, setRuleDraft] = useState({ rule_type: "percentage" as "percentage" | "fixed", rate: "" });
  const [settlementRefs, setSettlementRefs] = useState<Record<string, string>>({});
  const [refundDrafts, setRefundDrafts] = useState<Record<string, RefundDraft>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [accountsRes, settingsRes, rulesRes, ordersRes, settlementsRes, refundsRes] = await Promise.all([
      db.from("gl_accounts").select("id,account_code,account_name,account_type").eq("is_active", true).order("account_code"),
      db.from("marketplace_finance_settings").select("clearing_gl_account_id,sales_revenue_gl_account_id,commission_expense_gl_account_id,settlement_account_gl_account_id").eq("organization_id", organizationId).maybeSingle(),
      db.from("marketplace_commission_rules").select("id,rule_type,rate,is_active,effective_from,effective_to").eq("merchant_id", merchantId).order("effective_from", { ascending: false }),
      db.from("marketplace_orders").select("id,order_number,status,gross_amount,platform_fee,currency,finance_journal_entry_id").eq("merchant_id", merchantId).in("status", ["paid", "fulfilled"]).order("created_at", { ascending: false }).limit(30),
      db.from("marketplace_settlements").select("id,status,gross_sales,payment_charges,platform_commissions,net_amount,reference,journal_entry_id,created_at").eq("merchant_id", merchantId).order("created_at", { ascending: false }).limit(30),
      db.from("marketplace_refunds").select("id,order_id,amount,commission_reversal,reason,payment_reference,journal_entry_id,created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(30),
    ]);
    const error = accountsRes.error || settingsRes.error || rulesRes.error || ordersRes.error || settlementsRes.error || refundsRes.error;
    if (error) { setMessage(error.message); return; }
    setAccounts((accountsRes.data || []) as Account[]);
    setSettings({ ...emptySettings, ...(settingsRes.data || {}) });
    setRules((rulesRes.data || []) as Rule[]);
    setOrders((ordersRes.data || []) as Order[]);
    setSettlements((settlementsRes.data || []) as Settlement[]);
    setRefunds((refundsRes.data || []) as Refund[]);
  }, [merchantId, organizationId]);

  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, work: () => Promise<{ error?: { message: string } | null }>) => {
    setBusy(key); setMessage(null);
    const result = await work();
    setBusy(null);
    if (result.error) { setMessage(result.error.message); return false; }
    await load();
    return true;
  };

  const saveSettings = () => run("settings", () => db.from("marketplace_finance_settings").upsert({ organization_id: organizationId, ...settings }, { onConflict: "organization_id" }));
  const addRule = async () => {
    if (!(Number(ruleDraft.rate) >= 0)) { setMessage("Enter a valid commission rate."); return; }
    const saved = await run("rule", () => db.from("marketplace_commission_rules").insert({ organization_id: organizationId, merchant_id: merchantId, rule_type: ruleDraft.rule_type, rate: Number(ruleDraft.rate) }));
    if (saved) setRuleDraft({ rule_type: "percentage", rate: "" });
  };
  const createSettlement = () => run("settlement", () => db.rpc("marketplace_create_settlement", { p_merchant_id: merchantId }));
  const markSettlementPaid = (settlement: Settlement) => run(`settle-${settlement.id}`, () => db.rpc("marketplace_mark_settlement_paid", { p_settlement_id: settlement.id, p_reference: settlementRefs[settlement.id] || null }));
  const postSettlement = (settlement: Settlement) => run(`settlement-journal-${settlement.id}`, () => db.rpc("marketplace_post_settlement_journal", { p_settlement_id: settlement.id }));
  const postOrder = (order: Order) => run(`order-journal-${order.id}`, () => db.rpc("marketplace_post_order_journal", { p_order_id: order.id }));
  const postRefund = (refund: Refund) => run(`refund-journal-${refund.id}`, () => db.rpc("marketplace_post_refund_journal", { p_refund_id: refund.id }));
  const recordRefund = async (order: Order) => {
    const draft = refundDrafts[order.id] || { amount: "", reason: "", reference: "" };
    if (!(Number(draft.amount) > 0) || !draft.reason.trim()) { setMessage("Enter the refund amount and reason."); return; }
    const saved = await run(`refund-${order.id}`, () => db.rpc("marketplace_record_refund", { p_order_id: order.id, p_amount: Number(draft.amount), p_reason: draft.reason, p_reference: draft.reference || null }));
    if (saved) setRefundDrafts((current) => ({ ...current, [order.id]: { amount: "", reason: "", reference: "" } }));
  };

  const accountSelect = (label: string, field: keyof Settings) => <label className="text-sm text-slate-700"><span className="mb-1 block font-medium">{label}</span><select value={settings[field] || ""} onChange={(event) => setSettings((current) => ({ ...current, [field]: event.target.value || null }))} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">Select GL account</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.account_code} — {account.account_name}</option>)}</select></label>;

  return <section className="mt-6 border-t border-indigo-200 pt-5">
    <div><h3 className="font-semibold text-slate-900">Marketplace finance</h3><p className="mt-1 text-sm text-slate-600">Set commissions, create merchant settlements, record completed refunds, and post balanced GL entries.</p></div>
    {message && <p className="mt-3 text-sm text-slate-700" role="status">{message}</p>}
    <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4"><div className="flex items-center gap-2"><BookOpenCheck className="h-5 w-5 text-indigo-700" /><h4 className="font-semibold text-slate-900">GL mappings</h4></div><p className="mt-1 text-xs text-slate-500">Order posting: Dr BOAT Pay clearing, Cr sales revenue; Dr commission expense, Cr clearing. Settlement posting moves the net balance from clearing to the settlement account.</p><div className="mt-3 grid gap-3 md:grid-cols-2">{accountSelect("BOAT Pay clearing (asset)", "clearing_gl_account_id")}{accountSelect("Marketplace sales revenue (income)", "sales_revenue_gl_account_id")}{accountSelect("Commission expense", "commission_expense_gl_account_id")}{accountSelect("Settlement bank/cash account", "settlement_account_gl_account_id")}</div><button type="button" disabled={busy === "settings"} onClick={() => void saveSettings()} className="app-btn-primary mt-3"><Save className="h-4 w-4" /> Save GL mappings</button></section>
    <div className="mt-4 grid gap-4 xl:grid-cols-2"><section className="rounded-lg border border-slate-200 bg-white p-4"><h4 className="font-semibold text-slate-900">Commission rules</h4><div className="mt-3 flex flex-wrap gap-2"><select value={ruleDraft.rule_type} onChange={(event) => setRuleDraft((current) => ({ ...current, rule_type: event.target.value as "percentage" | "fixed" }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="percentage">Percentage</option><option value="fixed">Fixed UGX</option></select><input type="number" min="0" value={ruleDraft.rate} onChange={(event) => setRuleDraft((current) => ({ ...current, rate: event.target.value }))} placeholder={ruleDraft.rule_type === "percentage" ? "Rate %" : "UGX amount"} className="min-w-32 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /><button type="button" disabled={busy === "rule"} onClick={() => void addRule()} className="app-btn-secondary"><Plus className="h-4 w-4" /> Add rule</button></div><div className="mt-3 space-y-2">{rules.map((rule) => <div key={rule.id} className="flex justify-between text-sm"><span>{rule.rule_type === "percentage" ? `${rule.rate}%` : money(rule.rate)} commission</span><span className={rule.is_active ? "text-emerald-700" : "text-slate-500"}>{rule.is_active ? "Active" : "Inactive"}</span></div>)}{rules.length === 0 && <p className="text-sm text-slate-500">No merchant-specific rule. The checkout uses a matching organization or category rule when one exists.</p>}</div></section>
      <section className="rounded-lg border border-slate-200 bg-white p-4"><div className="flex items-center justify-between gap-3"><div><h4 className="font-semibold text-slate-900">Settlements</h4><p className="mt-1 text-xs text-slate-500">Groups paid, un-settled orders into one merchant payable.</p></div><button type="button" disabled={busy === "settlement"} onClick={() => void createSettlement()} className="app-btn-primary"><Banknote className="h-4 w-4" /> Create settlement</button></div><div className="mt-3 space-y-3">{settlements.map((settlement) => <div key={settlement.id} className="rounded border border-slate-200 p-3 text-sm"><div className="flex justify-between gap-3"><span className="font-medium capitalize">{settlement.status}</span><span>{money(settlement.net_amount)}</span></div><p className="mt-1 text-xs text-slate-500">Gross {money(settlement.gross_sales)} · Commission {money(settlement.platform_commissions)} · Charges {money(settlement.payment_charges)}</p>{settlement.status === "payable" && <div className="mt-2 flex flex-wrap gap-2"><input value={settlementRefs[settlement.id] || ""} onChange={(event) => setSettlementRefs((current) => ({ ...current, [settlement.id]: event.target.value }))} placeholder="Payment reference" className="rounded border border-slate-300 px-2 py-1 text-sm" /><button type="button" onClick={() => void markSettlementPaid(settlement)} disabled={busy === `settle-${settlement.id}`} className="app-btn-secondary">Mark paid</button></div>}{settlement.status === "paid" && !settlement.journal_entry_id && <button type="button" onClick={() => void postSettlement(settlement)} disabled={busy === `settlement-journal-${settlement.id}`} className="mt-2 text-indigo-700">Post settlement journal</button>}{settlement.journal_entry_id && <p className="mt-2 text-xs text-emerald-700">GL posted</p>}</div>)}{settlements.length === 0 && <p className="text-sm text-slate-500">No settlements created yet.</p>}</div></section></div>
    <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4"><h4 className="font-semibold text-slate-900">Paid order journals and refunds</h4><div className="mt-3 space-y-3">{orders.map((order) => { const draft = refundDrafts[order.id] || { amount: "", reason: "", reference: "" }; return <div key={order.id} className="rounded border border-slate-200 p-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium text-slate-900">{order.order_number}</p><p className="text-xs text-slate-500">{money(order.gross_amount, order.currency)} · Commission {money(order.platform_fee, order.currency)}</p></div>{order.finance_journal_entry_id ? <span className="text-sm text-emerald-700">Sales journal posted</span> : <button type="button" onClick={() => void postOrder(order)} disabled={busy === `order-journal-${order.id}`} className="app-btn-secondary"><BookOpenCheck className="h-4 w-4" /> Post sales journal</button>}</div><div className="mt-3 grid gap-2 md:grid-cols-[130px_1fr_170px_auto]"><input type="number" min="0" max={order.gross_amount} value={draft.amount} onChange={(event) => setRefundDrafts((current) => ({ ...current, [order.id]: { ...draft, amount: event.target.value } }))} placeholder="Refund UGX" className="rounded border border-slate-300 px-2 py-1.5 text-sm" /><input value={draft.reason} onChange={(event) => setRefundDrafts((current) => ({ ...current, [order.id]: { ...draft, reason: event.target.value } }))} placeholder="Refund reason" className="rounded border border-slate-300 px-2 py-1.5 text-sm" /><input value={draft.reference} onChange={(event) => setRefundDrafts((current) => ({ ...current, [order.id]: { ...draft, reference: event.target.value } }))} placeholder="Refund reference" className="rounded border border-slate-300 px-2 py-1.5 text-sm" /><button type="button" onClick={() => void recordRefund(order)} disabled={busy === `refund-${order.id}`} className="app-btn-secondary text-rose-700"><RotateCcw className="h-4 w-4" /> Record refund</button></div></div>; })}{orders.length === 0 && <p className="text-sm text-slate-500">No paid marketplace orders yet.</p>}</div><div className="mt-4 border-t border-slate-200 pt-4"><p className="text-sm font-medium text-slate-900">Refund register</p>{refunds.map((refund) => <div key={refund.id} className="mt-2 flex flex-wrap items-center justify-between gap-3 text-sm"><span>{money(refund.amount)} refund · commission reversal {money(refund.commission_reversal)} · {refund.reason}</span>{refund.journal_entry_id ? <span className="text-emerald-700">GL posted</span> : <button type="button" onClick={() => void postRefund(refund)} disabled={busy === `refund-journal-${refund.id}`} className="text-indigo-700">Post refund journal</button>}</div>)}{refunds.length === 0 && <p className="mt-2 text-sm text-slate-500">No refunds recorded.</p>}</div></section>
  </section>;
}
