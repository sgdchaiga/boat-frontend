import { supabase } from "@/lib/supabase";

type Raw = Record<string, string>;
type Member = { id: string; member_number: string; full_name: string };
type Account = { id: string; sacco_member_id: string; account_number: string; savings_product_code: string };
type Loan = { id: string; sacco_member_id: string; loan_number: string | null; balance: number };

export type HistoricalKind = "savings_deposit" | "savings_withdrawal" | "share_purchase" | "loan_repayment" | "fee_payment" | "account_charge";
export type HistoricalPlan = {
  line: number; status: "ok" | "error" | "skip"; summary: string; fingerprint: string;
  payload?: { source_id: string; entry_date: string; submitted_date: string | null; kind: HistoricalKind; narration: string; reference: string; amount: number; cash_direction: "in" | "out"; member_id: string | null; member_name: string | null; savings_account_id: string | null; loan_id: string | null; source_gl_code: string | null; source_row: Raw };
};

const text = (v: unknown) => String(v ?? "").trim();
const key = (v: unknown) => text(v).toLowerCase().replace(/\s+/g, " ");
const amount = (v: unknown) => { const n = Number(text(v).replace(/,/g, "")); return Number.isFinite(n) ? Math.abs(n) : 0; };

/** SACCO source sheets are normally dd/mm/yyyy; ISO and Excel serial dates are also accepted. */
export function parseHistoricalDate(value: string): string | null {
  const v = text(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const dmy = v.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (dmy) {
    const d = Number(dmy[1]), m = Number(dmy[2]), y = Number(dmy[3]);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d) return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  }
  const serial = Number(v);
  if (Number.isFinite(serial) && serial > 20000 && serial < 100000) {
    const dt = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    return dt.toISOString().slice(0, 10);
  }
  return null;
}

function classify(row: Raw): HistoricalKind | null {
  const s = key(`${row.trx_type} ${row.narration} ${row.gl_account}`);
  if (/loan.*(repay|payment)|repay.*loan/.test(s) || text(row.loan_no)) return "loan_repayment";
  if (/share|equity|capital contribution/.test(s)) return "share_purchase";
  if (/(ledger|interest|penalty|charge)/.test(s) && !/(interest paid|interest income received)/.test(s)) return "account_charge";
  if (/fee|subscription|membership/.test(s)) return "fee_payment";
  if (/withdraw|cash out/.test(s) || amount(row.withdraw_amount) > 0) return "savings_withdrawal";
  if (/saving|deposit|cash in/.test(s) || amount(row.deposit_amount) > 0) return "savings_deposit";
  return null;
}

export async function loadHistoricalImportContext(organizationId: string) {
  const [m, a, l, imported] = await Promise.all([
    supabase.from("sacco_members").select("id,member_number,full_name").eq("organization_id", organizationId),
    supabase.from("sacco_member_savings_accounts").select("id,sacco_member_id,account_number,savings_product_code").eq("organization_id", organizationId),
    supabase.from("sacco_loans").select("id,sacco_member_id,loan_number,balance").eq("organization_id", organizationId),
    supabase.from("sacco_historical_import_items").select("fingerprint").eq("organization_id", organizationId),
  ]);
  for (const r of [m, a, l]) if (r.error) throw new Error(r.error.message);
  if (imported.error && !/does not exist|schema cache/i.test(imported.error.message)) throw new Error(imported.error.message);
  return { members: (m.data ?? []) as Member[], accounts: (a.data ?? []) as Account[], loans: (l.data ?? []) as Loan[], fingerprints: new Set((imported.data ?? []).map((x) => String(x.fingerprint))) };
}

export function planHistoricalCashbookRows(ctx: Awaited<ReturnType<typeof loadHistoricalImportContext>>, rows: Raw[]): HistoricalPlan[] {
  const membersNo = new Map(ctx.members.map(m => [key(m.member_number), m]));
  const membersName = new Map(ctx.members.map(m => [key(m.full_name), m]));
  const accounts = new Map(ctx.accounts.map(a => [key(a.account_number), a]));
  const loans = new Map(ctx.loans.filter(l => l.loan_number).map(l => [key(l.loan_number), l]));
  return rows.map((row, i) => {
    const line = i + 2, sourceId = text(row.id), ref = text(row.voucher_no || row.reference || sourceId);
    const date = parseHistoricalDate(row.date || row.transaction_date), submitted = parseHistoricalDate(row.date_submitted);
    const kind = classify(row);
    const deposit = amount(row.deposit_amount), withdrawal = amount(row.withdraw_amount), net = amount(row.net_amount);
    const value = deposit || withdrawal || net;
    const fingerprint = `${sourceId || ref}|${date || ""}|${value.toFixed(2)}`.toLowerCase();
    if (ctx.fingerprints.has(fingerprint)) return { line, status: "skip", summary: `Already imported: ${ref}`, fingerprint };
    if (!sourceId && !ref) return { line, status: "error", summary: "Missing both ID and Voucher_No", fingerprint };
    if (!date) return { line, status: "error", summary: `Invalid Date “${text(row.date)}” (expected dd/mm/yyyy)`, fingerprint };
    if (!kind) return { line, status: "error", summary: `Could not classify Trx Type “${text(row.trx_type)}”`, fingerprint };
    if (!value) return { line, status: "error", summary: "Deposit, withdrawal and net amounts are all zero/blank", fingerprint };
    const acct = accounts.get(key(row.a_c_no));
    const member = membersNo.get(key(row.client_no)) ?? (acct ? ctx.members.find(m => m.id === acct.sacco_member_id) : undefined) ?? membersName.get(key(row.client_name));
    const loan = loans.get(key(row.loan_no));
    if (["savings_deposit","savings_withdrawal","share_purchase","account_charge"].includes(kind) && !acct)
      return { line, status: "error", summary: `Account ${text(row.a_c_no) || "(blank)"} was not found`, fingerprint };
    if (!member && kind !== "fee_payment") return { line, status: "error", summary: `Member ${text(row.client_no) || text(row.client_name) || "(blank)"} was not found`, fingerprint };
    if (kind === "loan_repayment" && !loan) return { line, status: "error", summary: `Loan ${text(row.loan_no) || "(blank)"} was not found`, fingerprint };
    const out = kind === "savings_withdrawal" || kind === "account_charge" || withdrawal > 0;
    return { line, status: "ok", fingerprint, summary: `${date} · ${kind.replace(/_/g," ")} · ${(member?.full_name ?? text(row.client_name)) || "General"} · UGX ${value.toLocaleString("en-UG")}`,
      payload: { source_id: sourceId || ref, entry_date: date, submitted_date: submitted, kind, narration: text(row.narration) || text(row.trx_type), reference: ref, amount: value, cash_direction: out ? "out" : "in", member_id: member?.id ?? null, member_name: (member?.full_name ?? text(row.client_name)) || null, savings_account_id: acct?.id ?? null, loan_id: loan?.id ?? null, source_gl_code: text(row.gl) || null, source_row: row } };
  });
}

export async function applyHistoricalCashbookPlans(organizationId: string, plans: HistoricalPlan[]) {
  let imported = 0; const errors: string[] = [];
  for (const p of plans.filter(x => x.status === "ok" && x.payload)) {
    const { error } = await supabase.rpc("import_sacco_historical_cashbook_row", { p_organization_id: organizationId, p_fingerprint: p.fingerprint, p_row: p.payload });
    if (error) errors.push(`Line ${p.line}: ${error.message}`); else imported++;
  }
  return { imported, errors };
}
