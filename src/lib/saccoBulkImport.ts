/**
 * SACCO bulk import: parse CSV/Excel, validate against org data, apply updates.
 */
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export type SaccoBulkImportKind =
  | "savings_balances"
  | "member_profile"
  | "historical_cashbook"
  | "loan_products"
  /** Member loan accounts: principal, balance, etc. (often as at a snapshot date). */
  | "member_loans";

export type SaccoBulkImportRowStatus = "ok" | "error" | "skip";

export type SaccoBulkImportPreviewRow = {
  line: number;
  status: SaccoBulkImportRowStatus;
  summary: string;
  detail?: string;
};

export type SaccoBulkImportResult = {
  updated: number;
  skipped: number;
  errors: number;
  messages: string[];
};

type MemberMini = { id: string; member_number: string; full_name: string };
type AccountMini = {
  id: string;
  sacco_member_id: string;
  account_number: string;
  savings_product_code: string;
  sub_account: string | null;
  balance: number;
};

export type SaccoBulkImportContext = {
  membersById: Map<string, MemberMini>;
  membersByNumber: Map<string, MemberMini>;
  accountByNumber: Map<string, AccountMini>;
  accountByMemberProduct: Map<string, AccountMini>;
};

const SAVINGS_TEMPLATES: Record<Exclude<SaccoBulkImportKind, "loan_products" | "member_loans">, string> = {
  savings_balances: `member_number,current_savings_product_code,balance,new_savings_product_code
1,1,150000,
2,ORD,,SAV`,
  member_profile: `member_number,full_name,phone,email,address,savings_balance,shares_balance
1,Jane Member,+256700000001,jane@example.com,Kampala,150000,50000`,
  historical_cashbook: `ID,Date Submitted,Trx Type,Date,Narration,Client Name.,GL Account,Voucher_No,Deposit Amount,Withdraw Amount,Loan No.,A/C_NO,Client NO.,GL,Net Amount,Month,Year
18d42486,01/08/2025,Savings/Deposits,01/02/2025,Deposit Ratibu,Axxxx 590,Savings Individuals - 21011,6692,"900,000",,,,590,21011,"900,000",1,2025`,
};

export function getSaccoBulkImportTemplate(kind: SaccoBulkImportKind): string {
  if (kind === "loan_products") {
    throw new Error("Loan product template uses downloadLoanProductsBulkTemplate()");
  }
  if (kind === "member_loans") {
    throw new Error("Member loan template uses downloadMemberLoansPortfolioTemplate()");
  }
  return SAVINGS_TEMPLATES[kind];
}

export function downloadSaccoBulkImportTemplate(kind: SaccoBulkImportKind, filename?: string): void {
  if (kind === "loan_products") {
    throw new Error("Loan product template uses downloadLoanProductsBulkTemplate()");
  }
  if (kind === "member_loans") {
    throw new Error("Member loan template uses downloadMemberLoansPortfolioTemplate()");
  }
  const blob = new Blob([getSaccoBulkImportTemplate(kind)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename ?? `sacco_${kind}_template.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** One guided workbook for the recommended SACCO migration sequence. */
export function downloadSaccoMigrationWorkbook(): void {
  const wb = XLSX.utils.book_new();
  const add = (name: string, rows: (string | number)[][], widths: number[]) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  add("Instructions", [
    ["BOAT SACCO BULK MIGRATION WORKBOOK"],
    ["Import order", "1 Members → 2 Savings Accounts → 3 Loan Products → 4 Loan Accounts → 5 Historical Cashbook"],
    ["Dates", "Use DD/MM/YYYY or YYYY-MM-DD. Historical cashbook dates default to DD/MM/YYYY."],
    ["Identifiers", "Keep Client NO., A/C_NO, Loan No. and source ID exactly as they appear in the old system."],
    ["Amounts", "Enter numbers only; commas are accepted. Do not enter UGX text."],
    ["Safety", "Run Preview first. Correct every error before posting. Previously imported cashbook fingerprints are skipped."],
    [],
    ["Worksheet", "Use in BOAT"],
    ["Members", "Bulk import → Member profile"],
    ["Savings Accounts", "Bulk import → Savings account balances (accounts must exist/backfill first)"],
    ["Loan Products", "Bulk import → Loan products"],
    ["Loan Accounts", "Bulk import → Member loan accounts"],
    ["Historical Cashbook", "Bulk import → Historical cashbook"],
  ], [24, 105]);
  add("Members", [
    ["member_number","full_name","phone","email","address","savings_balance","shares_balance"],
    ["590","Example Member","+256700000000","member@example.com","Kampala",0,0],
  ], [18,28,20,28,28,18,18]);
  add("Savings Accounts", [
    ["member_number","account_number","current_savings_product_code","balance","new_savings_product_code"],
    ["590","590","ORD",900000,""],
    ["590","590-SH","SHARE",50000,""],
  ], [18,20,30,18,28]);
  add("Loan Products", [
    ["name","loan_code","interest_rate","interest_basis","term_months","minimum_amount","maximum_amount","processing_fee_rate","is_active"],
    ["Development Loan","01",12,"declining",12,100000,10000000,1,"true"],
  ], [28,14,18,20,16,20,20,22,14]);
  add("Loan Accounts", [
    ["member_number","loan_number","loan_type","loan_code","principal","balance","interest_rate","term_months","status","application_date","disbursement_date","balance_as_at"],
    ["590","LN-001","Development Loan","01",1000000,750000,12,12,"disbursed","01/01/2025","05/01/2025","31/07/2025"],
  ], [18,20,26,14,16,16,18,16,16,20,20,20]);
  add("Historical Cashbook", [
    ["ID","Date Submitted","Trx Type","Date","Narration","Client Name.","GL Account","Voucher_No","Deposit Amount","Withdraw Amount","Loan No.","A/C_NO","Client NO.","GL","Net Amount","Month","Year"],
    ["18d42486","01/08/2025","Savings/Deposits","01/02/2025","Deposit Ratibu","Example Member","Savings Individuals - 21011","6692",900000,"","","590","590","21011",900000,1,2025],
  ], [18,18,22,16,30,26,34,18,20,20,18,16,16,14,18,10,10]);
  XLSX.writeFile(wb, "BOAT_SACCO_Bulk_Migration_Templates.xlsx");
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (!inQ && c === ",") {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

export function normalizeBulkHeader(h: string): string {
  return h
    .replace(/^\ufeff/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function asText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function parseNumber(v: string): number | null {
  const raw = v.replace(/,/g, "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function accountProductKey(memberId: string, productCode: string, subAccount: string | null): string {
  return `${memberId}|${productCode}|${subAccount ?? ""}`;
}

export async function loadSaccoBulkImportContext(organizationId: string): Promise<SaccoBulkImportContext> {
  const [memRes, acctRes] = await Promise.all([
    sb.from("sacco_members").select("id, member_number, full_name").eq("organization_id", organizationId),
    sb
      .from("sacco_member_savings_accounts")
      .select("id, sacco_member_id, account_number, savings_product_code, sub_account, balance")
      .eq("organization_id", organizationId),
  ]);
  if (memRes.error) throw new Error(memRes.error.message);
  if (acctRes.error) throw new Error(acctRes.error.message);

  const membersById = new Map<string, MemberMini>();
  const membersByNumber = new Map<string, MemberMini>();
  for (const r of memRes.data ?? []) {
    const m = r as MemberMini;
    membersById.set(m.id, m);
    membersByNumber.set(m.member_number.trim().toLowerCase(), m);
  }

  const accountByNumber = new Map<string, AccountMini>();
  const accountByMemberProduct = new Map<string, AccountMini>();
  for (const r of acctRes.data ?? []) {
    const row = r as {
      id: string;
      sacco_member_id: string;
      account_number: string;
      savings_product_code: string;
      sub_account: string | null;
      balance?: unknown;
    };
    const a: AccountMini = {
      id: row.id,
      sacco_member_id: row.sacco_member_id,
      account_number: row.account_number,
      savings_product_code: row.savings_product_code,
      sub_account: row.sub_account,
      balance: Number(row.balance ?? 0),
    };
    accountByNumber.set(a.account_number.trim().toLowerCase(), a);
    accountByMemberProduct.set(
      accountProductKey(a.sacco_member_id, a.savings_product_code, a.sub_account),
      a
    );
  }

  return { membersById, membersByNumber, accountByNumber, accountByMemberProduct };
}

export async function parseBulkImportFile(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 1) return { headers: [], rows: [] };
    const headers = parseCsvLine(lines[0]).map(normalizeBulkHeader);
    const rows: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = parseCsvLine(lines[i]);
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        row[h] = cells[idx] ?? "";
      });
      rows.push(row);
    }
    return { headers, rows };
  }

  const arrayBuffer = await file.arrayBuffer();
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const first = wb.SheetNames[0];
  if (!first) return { headers: [], rows: [] };
  const ws = wb.Sheets[first];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  if (raw.length === 0) return { headers: [], rows: [] };
  const headers = Object.keys(raw[0]).map(normalizeBulkHeader);
  const rows = raw.map((r) => {
    const out: Record<string, string> = {};
    for (const [key, val] of Object.entries(r)) {
      out[normalizeBulkHeader(key)] = asText(val);
    }
    return out;
  });
  return { headers, rows };
}

function resolveMember(
  ctx: SaccoBulkImportContext,
  row: Record<string, string>
): { member: MemberMini } | { error: string } {
  const idRaw = asText(row.sacco_member_id || row.member_id || row.uuid);
  if (idRaw) {
    const m = ctx.membersById.get(idRaw);
    if (!m) return { error: `Unknown member id ${idRaw}` };
    return { member: m };
  }
  const num = asText(row.member_number || row.member_no || row.client_no);
  if (!num) return { error: "Provide sacco_member_id or member_number" };
  const m = ctx.membersByNumber.get(num.toLowerCase());
  if (!m) return { error: `No member with number "${num}"` };
  return { member: m };
}

function resolveAccount(
  ctx: SaccoBulkImportContext,
  memberId: string,
  row: Record<string, string>
): { account: AccountMini } | { error: string } {
  const acctNo = asText(row.account_number || row.account_no);
  if (acctNo) {
    const a = ctx.accountByNumber.get(acctNo.toLowerCase());
    if (!a) return { error: `No savings account "${acctNo}"` };
    if (a.sacco_member_id !== memberId) return { error: `Account ${acctNo} belongs to another member` };
    return { account: a };
  }
  const product = asText(
    row.current_savings_product_code || row.savings_product_code || row.product_code || row.product
  );
  if (!product) return { error: "Provide account_number or savings_product_code" };
  const sub = asText(row.sub_account) || null;
  const a = ctx.accountByMemberProduct.get(accountProductKey(memberId, product, sub));
  if (!a) {
    return {
      error: sub
        ? `No account for product "${product}" sub-account "${sub}"`
        : `No account for product "${product}" (run savings backfill first)`,
    };
  }
  return { account: a };
}

/** Optional new product code after import (column new_savings_product_code / new_product_code / to_savings_product_code). */
function parseNewSavingsProductCode(row: Record<string, string>): string | null {
  const n = asText(
    row.new_savings_product_code ?? row.new_product_code ?? row.to_savings_product_code ?? row.target_product_code
  );
  return n || null;
}

export type SavingsBalancePlan = {
  line: number;
  accountId: string;
  memberLabel: string;
  accountNumber: string;
  currentProductCode: string;
  newBalance: number;
  /** If set and different from current, update savings_product_code (unique per member+product+sub). */
  newProductCode: string | null;
};

export type MemberProfilePlan = {
  line: number;
  memberId: string;
  memberLabel: string;
  patch: Record<string, unknown>;
};

export function planSavingsBalanceImports(
  ctx: SaccoBulkImportContext,
  rows: Record<string, string>[]
): { plans: SavingsBalancePlan[]; preview: SaccoBulkImportPreviewRow[] } {
  const plans: SavingsBalancePlan[] = [];
  const preview: SaccoBulkImportPreviewRow[] = [];

  rows.forEach((row, idx) => {
    const line = idx + 2;
    const memRes = resolveMember(ctx, row);
    if ("error" in memRes) {
      preview.push({ line, status: "error", summary: memRes.error });
      return;
    }
    const acctRes = resolveAccount(ctx, memRes.member.id, row);
    if ("error" in acctRes) {
      preview.push({ line, status: "error", summary: acctRes.error });
      return;
    }
    const acct = acctRes.account;
    const balRaw = asText(row.balance ?? row.new_balance ?? row.savings_balance);
    const balParsed = balRaw === "" ? null : parseNumber(balRaw);
    const newProd = parseNewSavingsProductCode(row);
    const productWouldChange = newProd !== null && newProd !== acct.savings_product_code.trim();

    if (balParsed === null && !productWouldChange) {
      preview.push({
        line,
        status: "error",
        summary: "Provide balance and/or new_savings_product_code (different from current product)",
      });
      return;
    }
    const newBalance = balParsed !== null ? balParsed : acct.balance;

    if (newProd !== null && productWouldChange) {
      const sub = acct.sub_account;
      const keyNew = accountProductKey(acct.sacco_member_id, newProd, sub);
      const occupant = ctx.accountByMemberProduct.get(keyNew);
      if (occupant && occupant.id !== acct.id) {
        preview.push({
          line,
          status: "error",
          summary: `Member already has product "${newProd}" for this sub-account (account ${occupant.account_number})`,
        });
        return;
      }
    }

    const parts: string[] = [];
    if (balParsed !== null) parts.push(`balance → ${newBalance.toLocaleString()}`);
    if (productWouldChange && newProd !== null) parts.push(`product ${acct.savings_product_code} → ${newProd}`);
    else if (newProd !== null && !productWouldChange) parts.push(`product unchanged (${acct.savings_product_code})`);

    plans.push({
      line,
      accountId: acct.id,
      memberLabel: `${memRes.member.member_number} — ${memRes.member.full_name}`,
      accountNumber: acct.account_number,
      currentProductCode: acct.savings_product_code,
      newBalance,
      newProductCode: productWouldChange && newProd !== null ? newProd : null,
    });
    preview.push({
      line,
      status: "ok",
      summary: `${memRes.member.member_number}: ${acct.account_number} — ${parts.join("; ")}`,
    });
  });

  return { plans, preview };
}

const PROFILE_FIELDS: Array<{ keys: string[]; column: string }> = [
  { keys: ["member_number"], column: "member_number" },
  { keys: ["full_name", "name"], column: "full_name" },
  { keys: ["email"], column: "email" },
  { keys: ["phone", "telephone", "mobile"], column: "phone" },
  { keys: ["national_id", "nin"], column: "national_id" },
  { keys: ["notes"], column: "notes" },
  { keys: ["gender"], column: "gender" },
  { keys: ["date_of_birth", "dob"], column: "date_of_birth" },
  { keys: ["marital_status"], column: "marital_status" },
  { keys: ["address"], column: "address" },
  { keys: ["occupation"], column: "occupation" },
  { keys: ["next_of_kin", "nok"], column: "next_of_kin" },
  { keys: ["nok_phone", "next_of_kin_phone"], column: "nok_phone" },
  { keys: ["join_date"], column: "join_date" },
  { keys: ["savings_balance"], column: "savings_balance" },
  { keys: ["shares_balance"], column: "shares_balance" },
  { keys: ["is_active", "active"], column: "is_active" },
];

function cellForField(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = asText(row[k]);
    if (v) return v;
  }
  return "";
}

export function planMemberProfileImports(
  ctx: SaccoBulkImportContext,
  rows: Record<string, string>[]
): { plans: MemberProfilePlan[]; preview: SaccoBulkImportPreviewRow[] } {
  const plans: MemberProfilePlan[] = [];
  const preview: SaccoBulkImportPreviewRow[] = [];

  rows.forEach((row, idx) => {
    const line = idx + 2;
    const memRes = resolveMember(ctx, row);
    if ("error" in memRes) {
      preview.push({ line, status: "error", summary: memRes.error });
      return;
    }
    const patch: Record<string, unknown> = {};
    for (const { keys, column } of PROFILE_FIELDS) {
      if (keys.includes("member_number")) continue;
      const raw = cellForField(row, keys);
      if (!raw) continue;
      if (column === "savings_balance" || column === "shares_balance") {
        const n = parseNumber(raw);
        if (n === null) {
          preview.push({ line, status: "error", summary: `Invalid ${column}` });
          return;
        }
        patch[column] = n;
        continue;
      }
      if (column === "is_active") {
        const low = raw.toLowerCase();
        patch.is_active = ["1", "true", "yes", "y", "active"].includes(low);
        continue;
      }
      patch[column] = raw;
    }
    if (Object.keys(patch).length === 0) {
      preview.push({ line, status: "skip", summary: "No fields to update (row empty)" });
      return;
    }
    plans.push({
      line,
      memberId: memRes.member.id,
      memberLabel: `${memRes.member.member_number} — ${memRes.member.full_name}`,
      patch,
    });
    preview.push({
      line,
      status: "ok",
      summary: `${memRes.member.member_number}: update ${Object.keys(patch).join(", ")}`,
    });
  });

  return { plans, preview };
}

async function runInChunks<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    await Promise.all(chunk.map(fn));
  }
}

export async function applySavingsBalancePlans(plans: SavingsBalancePlan[]): Promise<SaccoBulkImportResult> {
  let updated = 0;
  let errors = 0;
  const messages: string[] = [];

  await runInChunks(plans, 15, async (p) => {
    const patch: Record<string, unknown> = {
      balance: p.newBalance,
      updated_at: new Date().toISOString(),
    };
    if (p.newProductCode !== null) {
      patch.savings_product_code = p.newProductCode;
    }
    const { error } = await sb.from("sacco_member_savings_accounts").update(patch).eq("id", p.accountId);
    if (error) {
      errors += 1;
      messages.push(`Line ${p.line}: ${error.message}`);
    } else {
      updated += 1;
    }
  });

  return { updated, skipped: 0, errors, messages };
}

export async function applyMemberProfilePlans(plans: MemberProfilePlan[]): Promise<SaccoBulkImportResult> {
  let updated = 0;
  let errors = 0;
  const messages: string[] = [];

  await runInChunks(plans, 15, async (p) => {
    const { error } = await sb.from("sacco_members").update(p.patch).eq("id", p.memberId);
    if (error) {
      errors += 1;
      messages.push(`Line ${p.line}: ${error.message}`);
    } else {
      updated += 1;
    }
  });

  return { updated, skipped: 0, errors, messages };
}
