/**
 * Bulk import member loan portfolio rows.
 * Supports full create rows and partial updates (e.g. loan_number + balance only).
 */
import type { Loan, LoanProduct, LoanStatus } from "@/types/saccoWorkspace";
import type { SaccoBulkImportContext, SaccoBulkImportPreviewRow, SaccoBulkImportResult } from "@/lib/saccoBulkImport";
import { insertLoanRow, updateLoanRow } from "@/lib/saccoDb";

const ALLOWED_STATUS = new Set<LoanStatus>([
  "pending",
  "approved",
  "disbursed",
  "closed",
  "rejected",
  "defaulted",
  "written_off",
]);

function asText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function rowHas(row: Record<string, string>, keys: string[]): boolean {
  return keys.some((k) => asText(row[k]) !== "");
}

function parseNumberCell(v: string): number | null {
  const raw = v.replace(/,/g, "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Expects yyyy-mm-dd */
export function parseIsoDateOnly(s: string): string | null {
  const t = s.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = Date.parse(`${t}T12:00:00Z`);
  return Number.isNaN(d) ? null : t;
}

function calculateMonthlyPayment(P: number, annualRate: number, n: number, basis: "flat" | "declining"): number {
  if (n <= 0 || P <= 0) return 0;
  const r = annualRate / 100 / 12;
  if (basis === "flat") {
    const totalInterest = P * (annualRate / 100) * (n / 12);
    return Math.round((P + totalInterest) / n);
  }
  if (r === 0) return Math.round(P / n);
  return Math.round((P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));
}

function cell(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = asText(row[k]);
    if (v) return v;
  }
  return "";
}

function resolveMember(
  ctx: SaccoBulkImportContext,
  row: Record<string, string>,
  optional: boolean
): { member: { id: string; member_number: string; full_name: string } } | { error: string } | { skip: true } {
  const idRaw = asText(row.sacco_member_id || row.member_id || row.uuid);
  if (idRaw) {
    const m = ctx.membersById.get(idRaw);
    if (!m) return { error: `Unknown member id ${idRaw}` };
    return { member: m };
  }
  const num = asText(row.member_number || row.member_no || row.client_no);
  if (!num) {
    if (optional) return { skip: true };
    return { error: "Provide member_number or sacco_member_id" };
  }
  const m = ctx.membersByNumber.get(num.toLowerCase());
  if (!m) return { error: `No member with number "${num}"` };
  return { member: m };
}

function matchProductByName(name: string, products: LoanProduct[]): LoanProduct | null {
  const t = name.trim().toLowerCase();
  return products.find((p) => p.name.trim().toLowerCase() === t) ?? null;
}

function matchProductByCode(code: string, products: LoanProduct[]): LoanProduct | null {
  const raw = code.trim();
  const digits = raw.replace(/\D/g, "");
  return (
    products.find((p) => {
      const pc = String(p.loanCode ?? "").trim();
      if (!pc) return false;
      if (pc === raw) return true;
      return digits !== "" && pc.replace(/\D/g, "") === digits;
    }) ?? null
  );
}

function resolveLoanProduct(
  row: Record<string, string>,
  products: LoanProduct[]
): { product: LoanProduct | null; loanTypeName: string } | { error: string } {
  const typeRaw = cell(row, ["loan_type", "loan_product", "product", "product_name"]);
  const codeRaw = cell(row, ["loan_code", "loan_product_code", "product_code"]);

  if (typeRaw) {
    const product = matchProductByName(typeRaw, products);
    return { product, loanTypeName: typeRaw.trim() };
  }
  if (codeRaw) {
    const product = matchProductByCode(codeRaw, products);
    if (!product) return { error: `No loan product with loan_code "${codeRaw}"` };
    return { product, loanTypeName: product.name };
  }
  return { error: "Provide loan_type or loan_code" };
}

function normalizeLoanNumber(n: string): string {
  return n.trim();
}

type FindLoanResult =
  | { kind: "found"; loan: Loan }
  | { kind: "not_found" }
  | { kind: "ambiguous"; message: string };

function findExistingLoan(
  existingLoans: Loan[],
  hints: {
    loanId?: string;
    loanNumber?: string;
    memberId?: string;
    loanType?: string;
    principal?: number | null;
  }
): FindLoanResult {
  const loanId = hints.loanId?.replace(/"/g, "").trim();
  if (loanId) {
    const existing = existingLoans.find((l) => l.id === loanId);
    if (!existing) return { kind: "not_found" };
    if (hints.memberId && existing.memberId !== hints.memberId) {
      return { kind: "ambiguous", message: "loan_id belongs to another member" };
    }
    return { kind: "found", loan: existing };
  }

  const loanNum = hints.loanNumber ? normalizeLoanNumber(hints.loanNumber) : "";
  if (loanNum) {
    const byNum = existingLoans.filter((l) => l.loanNumber && normalizeLoanNumber(l.loanNumber) === loanNum);
    if (byNum.length === 1) return { kind: "found", loan: byNum[0]! };
    if (byNum.length > 1) return { kind: "ambiguous", message: `Multiple loans with loan_number "${loanNum}"` };
    return { kind: "not_found" };
  }

  if (!hints.memberId || !hints.loanType) return { kind: "not_found" };

  const tl = hints.loanType.trim().toLowerCase();
  let pool = existingLoans.filter(
    (l) => l.memberId === hints.memberId && l.loanType.trim().toLowerCase() === tl
  );

  if (hints.principal != null && Number.isFinite(hints.principal)) {
    const byPrincipal = pool.filter((l) => Math.abs(l.amount - hints.principal!) < 0.01);
    if (byPrincipal.length === 1) return { kind: "found", loan: byPrincipal[0]! };
    if (byPrincipal.length > 1) {
      return { kind: "ambiguous", message: "Multiple loans match member + loan_type + principal — use loan_number or loan_id" };
    }
    if (byPrincipal.length === 0 && pool.length === 0) return { kind: "not_found" };
    if (byPrincipal.length === 0 && pool.length > 0) {
      return { kind: "ambiguous", message: "No loan with that principal — use loan_number, loan_id, or omit principal to match by type only" };
    }
  }

  if (pool.length === 1) return { kind: "found", loan: pool[0]! };
  if (pool.length > 1) {
    return { kind: "ambiguous", message: "Multiple loans for member + loan_type — set loan_number or loan_id" };
  }
  return { kind: "not_found" };
}

function describePatchFields(patch: Parameters<typeof updateLoanRow>[1]): string {
  const labels: string[] = [];
  if (patch.balance !== undefined) labels.push("balance");
  if (patch.paid_amount !== undefined) labels.push("paid");
  if (patch.amount !== undefined) labels.push("principal");
  if (patch.loan_number !== undefined) labels.push("loan_number");
  if (patch.status !== undefined) labels.push("status");
  if (patch.interest_rate !== undefined) labels.push("rate");
  if (patch.term_months !== undefined) labels.push("term");
  if (patch.disbursement_date !== undefined) labels.push("disbursement");
  if (patch.member_name !== undefined) labels.push("member");
  if (patch.purpose !== undefined) labels.push("purpose");
  return labels.length ? labels.join(", ") : "fields";
}

export type MemberLoanImportPlan =
  | {
      line: number;
      mode: "insert";
      payload: Parameters<typeof insertLoanRow>[0];
    }
  | {
      line: number;
      mode: "update";
      loanId: string;
      patch: Parameters<typeof updateLoanRow>[1];
      memberLabel: string;
    };

export function getMemberLoansPortfolioTemplateCsv(): string {
  return [
    [
      "loan_number",
      "member_number",
      "loan_code",
      "loan_type",
      "principal",
      "balance",
      "balance_as_at",
      "paid_amount",
      "term_months",
      "interest_rate",
      "interest_basis",
      "disbursement_date",
      "application_date",
      "status",
      "purpose",
      "loan_id",
    ].join(","),
    [
      "01-01-00001",
      "12",
      "01",
      "",
      2000000,
      2000000,
      "2026-01-15",
      "",
      24,
      "",
      "",
      "2025-06-01",
      "",
      "disbursed",
      "Opening import",
      "",
    ].join(","),
    [
      "01-01-00001",
      "",
      "",
      "",
      "",
      850000,
      "2026-05-01",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ].join(","),
  ].join("\n");
}

export function downloadMemberLoansPortfolioTemplate(filename?: string): void {
  const blob = new Blob([getMemberLoansPortfolioTemplateCsv()], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename ?? "sacco_member_loans_portfolio_template.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * @param defaultAsAt Fallback when row has no balance_as_at (yyyy-mm-dd).
 */
export function planMemberLoansPortfolioImport(
  ctx: SaccoBulkImportContext,
  existingLoans: Loan[],
  loanProducts: LoanProduct[],
  rows: Record<string, string>[],
  defaultAsAt: string
): { plans: MemberLoanImportPlan[]; preview: SaccoBulkImportPreviewRow[] } {
  const preview: SaccoBulkImportPreviewRow[] = [];
  const plans: MemberLoanImportPlan[] = [];

  const defaultAsAtOk = parseIsoDateOnly(defaultAsAt);
  const seenFileKeys = new Set<string>();

  rows.forEach((row, idx) => {
    const line = idx + 2;

    const loanNumberRaw = cell(row, ["loan_number", "loan_no", "account_number", "loan_account"]);
    const loanIdHint = cell(row, ["loan_id", "id", "sacco_loan_id"]).replace(/"/g, "").trim();
    const isUpdateHint = Boolean(loanNumberRaw || loanIdHint);

    const memRes = resolveMember(ctx, row, isUpdateHint);
    if ("error" in memRes) {
      preview.push({ line, status: "error", summary: memRes.error });
      return;
    }
    const member = "member" in memRes ? memRes.member : undefined;

    const productRes = rowHas(row, [
      "loan_type",
      "loan_product",
      "product",
      "product_name",
      "loan_code",
      "loan_product_code",
      "product_code",
    ])
      ? resolveLoanProduct(row, loanProducts)
      : null;
    if (productRes && "error" in productRes) {
      preview.push({ line, status: "error", summary: productRes.error });
      return;
    }

    const loanTypeRaw =
      productRes && !("error" in productRes)
        ? productRes.loanTypeName
        : cell(row, ["loan_type", "loan_product", "product", "product_name"]);

    const principalRaw = cell(row, ["principal", "amount", "loan_amount", "original_amount"]);
    const hasPrincipal = principalRaw !== "";
    const principal = hasPrincipal ? parseNumberCell(principalRaw) : null;
    if (hasPrincipal && (principal === null || principal < 0)) {
      preview.push({ line, status: "error", summary: "Invalid principal" });
      return;
    }

    const hasBalance = rowHas(row, ["balance", "outstanding", "principal_balance"]);
    const balanceRaw = cell(row, ["balance", "outstanding", "principal_balance"]);
    const balance = hasBalance ? parseNumberCell(balanceRaw) : null;
    if (hasBalance && (balance === null || balance < 0)) {
      preview.push({ line, status: "error", summary: "Invalid balance" });
      return;
    }

    const findRes = findExistingLoan(existingLoans, {
      loanId: loanIdHint || undefined,
      loanNumber: loanNumberRaw || undefined,
      memberId: member?.id,
      loanType: loanTypeRaw || undefined,
      principal: hasPrincipal ? principal : null,
    });

    if (findRes.kind === "ambiguous") {
      preview.push({ line, status: "error", summary: findRes.message });
      return;
    }

    const existing = findRes.kind === "found" ? findRes.loan : null;

    if (existing) {
      const amountForCheck = hasPrincipal ? principal! : existing.amount;
      if (hasBalance && balance! > amountForCheck + 0.01) {
        preview.push({ line, status: "error", summary: "balance cannot exceed principal" });
        return;
      }

      const patch: Parameters<typeof updateLoanRow>[1] = {};
      let fieldCount = 0;

      if (member) {
        patch.member_name = member.full_name;
        fieldCount += 1;
      }

      if (hasPrincipal && principal !== null) {
        patch.amount = principal;
        fieldCount += 1;
      }

      if (hasBalance && balance !== null) {
        patch.balance = balance;
        fieldCount += 1;
        const paidRaw = cell(row, ["paid_amount", "principal_paid", "repaid"]);
        if (paidRaw !== "") {
          const paid = parseNumberCell(paidRaw);
          if (paid === null || paid < 0) {
            preview.push({ line, status: "error", summary: "Invalid paid_amount" });
            return;
          }
          patch.paid_amount = paid;
          fieldCount += 1;
        } else if (hasPrincipal) {
          patch.paid_amount = Math.max(0, principal! - balance);
          fieldCount += 1;
        }
      } else if (rowHas(row, ["paid_amount", "principal_paid", "repaid"])) {
        const paid = parseNumberCell(cell(row, ["paid_amount", "principal_paid", "repaid"]));
        if (paid === null || paid < 0) {
          preview.push({ line, status: "error", summary: "Invalid paid_amount" });
          return;
        }
        patch.paid_amount = paid;
        fieldCount += 1;
      }

      if (loanNumberRaw && normalizeLoanNumber(loanNumberRaw) !== (existing.loanNumber ?? "")) {
        patch.loan_number = normalizeLoanNumber(loanNumberRaw);
        fieldCount += 1;
      }

      if (loanTypeRaw && loanTypeRaw.trim() !== existing.loanType) {
        preview.push({
          line,
          status: "error",
          summary: "Changing loan_type on update is not supported — create a new loan row instead",
        });
        return;
      }

      const product = productRes && !("error" in productRes) ? productRes.product : matchProductByName(existing.loanType, loanProducts);

      const termFromRow = parseNumberCell(cell(row, ["term_months", "term", "months"]));
      const rateFromRow = parseNumberCell(cell(row, ["interest_rate", "annual_rate", "rate"]));
      const basisRaw = cell(row, ["interest_basis", "basis"]).toLowerCase();

      const termMonths =
        termFromRow !== null && Number.isFinite(termFromRow)
          ? Math.max(1, Math.round(termFromRow))
          : existing.term;
      const interestRate =
        rateFromRow !== null && Number.isFinite(rateFromRow) ? rateFromRow : existing.interestRate;
      let interestBasis: "flat" | "declining" = existing.interestBasis;
      if (basisRaw === "flat" || basisRaw === "declining") interestBasis = basisRaw;
      else if (basisRaw) {
        preview.push({ line, status: "error", summary: "interest_basis must be flat or declining" });
        return;
      }

      if (rowHas(row, ["term_months", "term", "months"])) {
        patch.term_months = termMonths;
        fieldCount += 1;
      }
      if (rowHas(row, ["interest_rate", "annual_rate", "rate"])) {
        patch.interest_rate = interestRate;
        fieldCount += 1;
      }

      const principalForPayment = patch.amount ?? existing.amount;
      if (patch.term_months !== undefined || patch.interest_rate !== undefined || rowHas(row, ["interest_basis", "basis"])) {
        patch.monthly_payment = calculateMonthlyPayment(
          principalForPayment,
          patch.interest_rate ?? existing.interestRate,
          patch.term_months ?? existing.term,
          interestBasis
        );
        fieldCount += 1;
      }

      const asAtRaw = cell(row, ["balance_as_at", "as_at_date", "snapshot_date", "balances_as_at"]);
      const asAtParsed = asAtRaw ? parseIsoDateOnly(asAtRaw) : defaultAsAtOk;
      if (asAtRaw && !asAtParsed) {
        preview.push({ line, status: "error", summary: "Invalid balance_as_at (use YYYY-MM-DD)" });
        return;
      }

      const statRaw = cell(row, ["status"]).trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
      if (statRaw) {
        if (!ALLOWED_STATUS.has(statRaw as LoanStatus)) {
          preview.push({ line, status: "error", summary: `Unknown status "${cell(row, ["status"])}"` });
          return;
        }
        const finalStatus = statRaw as LoanStatus;
        patch.status = finalStatus;
        patch.approval_stage = ["disbursed", "closed", "defaulted", "written_off"].includes(finalStatus)
          ? 2
          : finalStatus === "approved"
            ? 1
            : 0;
        fieldCount += 2;
      }

      if (rowHas(row, ["disbursement_date", "disburse_date"])) {
        const disb = parseIsoDateOnly(cell(row, ["disbursement_date", "disburse_date"]));
        if (!disb) {
          preview.push({ line, status: "error", summary: "Invalid disbursement_date" });
          return;
        }
        patch.disbursement_date = disb;
        fieldCount += 1;
      }

      if (rowHas(row, ["application_date", "application"])) {
        const app = parseIsoDateOnly(cell(row, ["application_date", "application"]));
        if (!app) {
          preview.push({ line, status: "error", summary: "Invalid application_date" });
          return;
        }
        patch.application_date = app;
        fieldCount += 1;
      }

      if (rowHas(row, ["purpose", "description"])) {
        patch.purpose = cell(row, ["purpose", "description"]);
        fieldCount += 1;
      } else if (hasBalance && asAtParsed) {
        patch.purpose = `${existing.purpose || "Loan"} (balance as at ${asAtParsed})`.slice(0, 500);
        fieldCount += 1;
      }

      if (fieldCount === 0) {
        preview.push({ line, status: "error", summary: "No fields to update — include balance, principal, status, etc." });
        return;
      }

      const fileKey = loanNumberRaw
        ? `ln:${normalizeLoanNumber(loanNumberRaw)}`
        : loanIdHint
          ? `id:${loanIdHint}`
          : `${member?.member_number ?? existing.memberId}|${existing.loanType}`;
      if (seenFileKeys.has(fileKey)) {
        preview.push({ line, status: "error", summary: "Duplicate row in file for the same loan" });
        return;
      }
      seenFileKeys.add(fileKey);

      const label = member?.member_number ?? existing.memberName;
      const ref = existing.loanNumber || existing.id.slice(0, 8);
      plans.push({ line, mode: "update", loanId: existing.id, patch, memberLabel: label });
      preview.push({
        line,
        status: "ok",
        summary: `Update ${ref} · ${label} · ${describePatchFields(patch)}${hasBalance ? ` · bal ${balance!.toLocaleString()}` : ""}`,
      });
      return;
    }

    // —— Insert new loan ——
    if (!member) {
      preview.push({ line, status: "error", summary: "New loans require member_number or sacco_member_id" });
      return;
    }

    if (!loanTypeRaw && !productRes) {
      preview.push({ line, status: "error", summary: "Missing loan_type or loan_code" });
      return;
    }

    if (!hasPrincipal) {
      preview.push({ line, status: "error", summary: "New loans require principal" });
      return;
    }

    const product =
      productRes && !("error" in productRes) ? productRes.product : matchProductByName(loanTypeRaw, loanProducts);

    const insertBalance = hasBalance ? balance! : principal!;
    if (insertBalance > principal! + 0.01) {
      preview.push({ line, status: "error", summary: "balance cannot exceed principal" });
      return;
    }

    const asAtRaw = cell(row, ["balance_as_at", "as_at_date", "snapshot_date", "balances_as_at"]);
    const asAtParsed = asAtRaw ? parseIsoDateOnly(asAtRaw) : defaultAsAtOk;
    if (!asAtParsed) {
      preview.push({
        line,
        status: "error",
        summary: asAtRaw ? "Invalid balance_as_at (use YYYY-MM-DD)" : "Invalid default snapshot date (use YYYY-MM-DD)",
      });
      return;
    }

    const termFromRow = parseNumberCell(cell(row, ["term_months", "term", "months"]));
    const rateFromRow = parseNumberCell(cell(row, ["interest_rate", "annual_rate", "rate"]));

    if (!product && (termFromRow === null || rateFromRow === null)) {
      preview.push({
        line,
        status: "error",
        summary: `Unknown loan_type "${loanTypeRaw}" — add product or set term_months and interest_rate`,
      });
      return;
    }

    const termMonths = Math.max(
      1,
      Math.round(termFromRow !== null && Number.isFinite(termFromRow) ? termFromRow : (product?.maxTerm ?? 12))
    );
    const interestRate =
      rateFromRow !== null && Number.isFinite(rateFromRow) ? rateFromRow : (product?.interestRate ?? 0);

    const basisRaw = cell(row, ["interest_basis", "basis"]).toLowerCase();
    let interestBasis: "flat" | "declining" = product?.interestBasis ?? "declining";
    if (basisRaw === "flat" || basisRaw === "declining") interestBasis = basisRaw;
    else if (basisRaw) {
      preview.push({ line, status: "error", summary: "interest_basis must be flat or declining" });
      return;
    }

    const paidRaw = cell(row, ["paid_amount", "principal_paid", "repaid"]);
    let paidAmount =
      paidRaw !== "" ? parseNumberCell(paidRaw) : Math.max(0, principal! - insertBalance);
    if (paidAmount === null || paidAmount < 0) {
      preview.push({ line, status: "error", summary: "Invalid paid_amount" });
      return;
    }

    const monthlyPayment = calculateMonthlyPayment(principal!, interestRate, termMonths, interestBasis);

    const disbRaw = cell(row, ["disbursement_date", "disburse_date"]);
    const disbParsed = disbRaw ? parseIsoDateOnly(disbRaw) : null;

    const statRaw = cell(row, ["status"]).trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
    let finalStatus: LoanStatus = "disbursed";
    if (statRaw) {
      if (!ALLOWED_STATUS.has(statRaw as LoanStatus)) {
        preview.push({ line, status: "error", summary: `Unknown status "${cell(row, ["status"])}"` });
        return;
      }
      finalStatus = statRaw as LoanStatus;
    }

    let disbursementDate: string | null = disbParsed;
    if (disbursementDate === null) {
      const needsDisb = ["disbursed", "closed", "defaulted", "written_off"].includes(finalStatus);
      disbursementDate = needsDisb ? asAtParsed : null;
    }

    const appRaw = cell(row, ["application_date", "application"]);
    const appParsed = appRaw ? parseIsoDateOnly(appRaw) : null;
    const applicationDate = appParsed ?? disbursementDate ?? asAtParsed;

    const purposeRaw = cell(row, ["purpose", "description"]);
    const purpose = purposeRaw || `Portfolio import (balances as at ${asAtParsed})`;

    const approvalStage = ["disbursed", "closed", "defaulted", "written_off"].includes(finalStatus)
      ? 2
      : finalStatus === "approved"
        ? 1
        : 0;

    const fileKey = loanNumberRaw
      ? `ln:${normalizeLoanNumber(loanNumberRaw)}`
      : `${member.member_number}|${loanTypeRaw}|${principal}`;
    if (seenFileKeys.has(fileKey)) {
      preview.push({ line, status: "error", summary: "Duplicate row in file for the same loan" });
      return;
    }
    seenFileKeys.add(fileKey);

    const payload: Parameters<typeof insertLoanRow>[0] = {
      sacco_member_id: member.id,
      member_name: member.full_name,
      loan_type: loanTypeRaw.trim(),
      amount: principal!,
      balance: insertBalance,
      paid_amount: paidAmount,
      status: finalStatus,
      interest_rate: interestRate,
      term_months: termMonths,
      monthly_payment: monthlyPayment,
      approval_stage: approvalStage,
      purpose,
      guarantors: [],
      application_date: applicationDate,
      interest_basis: interestBasis,
      disbursement_date: disbursementDate,
      fees: null,
      collateral_description: null,
      lc1_chairman_name: null,
      lc1_chairman_phone: null,
      last_payment_date: null,
      loan_number: loanNumberRaw ? normalizeLoanNumber(loanNumberRaw) : null,
    };

    plans.push({ line, mode: "insert", payload });
    preview.push({
      line,
      status: "ok",
      summary: `Insert · ${member.member_number} · ${loanNumberRaw || loanTypeRaw} · principal ${principal!.toLocaleString()} · bal ${insertBalance.toLocaleString()}`,
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

export async function applyMemberLoansPortfolioPlans(plans: MemberLoanImportPlan[]): Promise<SaccoBulkImportResult> {
  let updated = 0;
  let errors = 0;
  const messages: string[] = [];

  await runInChunks(plans, 10, async (p) => {
    try {
      if (p.mode === "insert") {
        await insertLoanRow(p.payload);
        updated += 1;
      } else {
        await updateLoanRow(p.loanId, p.patch);
        updated += 1;
      }
    } catch (e) {
      errors += 1;
      messages.push(`Line ${p.line}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  return { updated, skipped: 0, errors, messages };
}
