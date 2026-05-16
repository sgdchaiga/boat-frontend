/**
 * Merge CSV/XLS rows into SACCO loan products (rates, fees, limits).
 * Rows match or create products by name; products omitted from the file stay unchanged.
 */
import type { LoanFees, LoanProduct } from "@/types/saccoWorkspace";
import { replaceLoanProductsForOrg } from "@/lib/saccoDb";
import type { SaccoBulkImportPreviewRow, SaccoBulkImportResult } from "@/lib/saccoBulkImport";

/** Defaults aligned with SACCO Loan products form defaults (new inserts). */
const DEFAULT_FEES_NEW: LoanFees = {
  formFee: 5000,
  monitoringFeeRate: 0,
  processingFeeRate: 2,
  insuranceFeeRate: 1,
  applicationFeeRate: 1,
  agentFeeRate: 0,
};

const DEFAULT_TERMS_NEW: Pick<
  LoanProduct,
  | "interestRate"
  | "maxTerm"
  | "minAmount"
  | "maxAmount"
  | "interestBasis"
  | "compulsorySavingsRate"
  | "minimumShares"
  | "isActive"
  | "loanCode"
> = {
  interestRate: 12,
  maxTerm: 36,
  minAmount: 100000,
  maxAmount: 10_000_000,
  interestBasis: "declining",
  compulsorySavingsRate: 10,
  minimumShares: 50000,
  isActive: true,
  loanCode: "1",
};

function cell(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = asText(row[k]);
    if (v) return v;
  }
  return "";
}

function parseNumberFlexible(v: string): number | null {
  const raw = v.replace(/,/g, "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseBool(v: string, fallback: boolean): boolean | null {
  if (!v.trim()) return null;
  const low = v.toLowerCase();
  if (["1", "true", "yes", "y", "active"].includes(low)) return true;
  if (["0", "false", "no", "n", "inactive"].includes(low)) return false;
  return null;
}

function pickNumber(row: Record<string, string>, keys: string[], existing: number | undefined, insertDefault: number): number | "" {
  const raw = cell(row, keys);
  if (!raw) {
    if (existing !== undefined) return existing;
    return insertDefault;
  }
  const n = parseNumberFlexible(raw);
  return n === null ? "" : n;
}

function pickFees(row: Record<string, string>, existing: LoanFees | undefined): LoanFees | { error: string } {
  const base: LoanFees = existing ? { ...existing } : { ...DEFAULT_FEES_NEW };

  const formFee = pickNumber(row, ["form_fee", "loan_form_fee", "formfee"], existing?.formFee, DEFAULT_FEES_NEW.formFee);
  if (formFee === "") return { error: "Invalid form_fee" };

  const monitoringFeeRate = pickNumber(
    row,
    ["monitoring_fee_rate", "monitoring_fee_pct", "monitoring_pct"],
    existing?.monitoringFeeRate,
    DEFAULT_FEES_NEW.monitoringFeeRate
  );
  if (monitoringFeeRate === "") return { error: "Invalid monitoring_fee_rate" };

  const processingFeeRate = pickNumber(
    row,
    ["processing_fee_rate", "processing_pct"],
    existing?.processingFeeRate,
    DEFAULT_FEES_NEW.processingFeeRate
  );
  if (processingFeeRate === "") return { error: "Invalid processing_fee_rate" };

  const insuranceFeeRate = pickNumber(row, ["insurance_fee_rate", "insurance_pct"], existing?.insuranceFeeRate, DEFAULT_FEES_NEW.insuranceFeeRate);
  if (insuranceFeeRate === "") return { error: "Invalid insurance_fee_rate" };

  const applicationFeeRate = pickNumber(
    row,
    ["application_fee_rate", "application_pct"],
    existing?.applicationFeeRate,
    DEFAULT_FEES_NEW.applicationFeeRate
  );
  if (applicationFeeRate === "") return { error: "Invalid application_fee_rate" };

  const agentFeeRate = pickNumber(row, ["agent_fee_rate", "agent_fee_pct"], existing?.agentFeeRate, DEFAULT_FEES_NEW.agentFeeRate);
  if (agentFeeRate === "") return { error: "Invalid agent_fee_rate" };

  return {
    ...base,
    formFee,
    monitoringFeeRate,
    processingFeeRate,
    insuranceFeeRate,
    applicationFeeRate,
    agentFeeRate,
  };
}

/** Template row documents common column aliases. */
export function getLoanProductsBulkTemplateCsv(): string {
  return [
    [
      "product_name",
      "loan_code",
      "interest_rate",
      "max_term_months",
      "min_amount",
      "max_amount",
      "interest_basis",
      "form_fee",
      "monitoring_fee_rate",
      "processing_fee_rate",
      "insurance_fee_rate",
      "application_fee_rate",
      "agent_fee_rate",
      "compulsory_savings_rate",
      "minimum_shares",
      "is_active",
    ].join(","),
    [
      'Ordinary Loan',
      "01",
      12,
      36,
      500000,
      10000000,
      "declining",
      5000,
      0,
      2,
      1,
      1,
      0,
      10,
      50000,
      "yes",
    ].join(","),
  ].join("\n");
}

export function downloadLoanProductsBulkTemplate(filename?: string): void {
  const blob = new Blob([getLoanProductsBulkTemplateCsv()], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename ?? "sacco_loan_products_template.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * Builds next catalog: CSV rows merged by product name first in file order, then existing products not listed.
 */
export function planLoanProductImports(
  existingProducts: LoanProduct[],
  rows: Record<string, string>[]
): { merged: LoanProduct[] | null; preview: SaccoBulkImportPreviewRow[] } {
  const preview: SaccoBulkImportPreviewRow[] = [];
  const byLower = new Map<string, LoanProduct>();
  for (const p of existingProducts) {
    byLower.set(p.name.trim().toLowerCase(), p);
  }

  const namesSeenInCsv = new Set<string>();
  const csvProducts: LoanProduct[] = [];

  rows.forEach((row, idx) => {
    const line = idx + 2;
    const rawName =
      cell(row, ["product_name", "name", "loan_product", "loan_product_name", "loan_type"]) || cell(row, ["product"]);
    if (!rawName) {
      preview.push({ line, status: "error", summary: "Missing product_name (or name)" });
      return;
    }
    const key = rawName.trim().toLowerCase();
    if (namesSeenInCsv.has(key)) {
      preview.push({ line, status: "error", summary: `Duplicate product name "${rawName}" in file` });
      return;
    }
    namesSeenInCsv.add(key);

    const match = byLower.get(key);

    const basisRaw = cell(row, ["interest_basis", "basis", "rate_type"]).toLowerCase();
    let interestBasis: "flat" | "declining" = match?.interestBasis ?? DEFAULT_TERMS_NEW.interestBasis;
    if (basisRaw) {
      if (basisRaw !== "flat" && basisRaw !== "declining") {
        preview.push({ line, status: "error", summary: `interest_basis must be flat or declining (got "${basisRaw}")` });
        return;
      }
      interestBasis = basisRaw;
    }

    const interestRateRaw = pickNumber(row, ["interest_rate", "annual_rate", "rate_pa"], match?.interestRate, DEFAULT_TERMS_NEW.interestRate);
    if (interestRateRaw === "" || typeof interestRateRaw !== "number" || interestRateRaw < 0) {
      preview.push({ line, status: "error", summary: "Invalid interest_rate" });
      return;
    }

    const loanCodeCell = cell(row, ["loan_code", "loan_product_code", "product_code"]);
    let loanCode = match?.loanCode ?? DEFAULT_TERMS_NEW.loanCode;
    if (loanCodeCell) {
      const stripped = loanCodeCell.replace(/\D/g, "");
      if (!stripped) {
        preview.push({ line, status: "error", summary: "Invalid loan_code (use digits)" });
        return;
      }
      loanCode = stripped;
    }

    const maxTermRaw = pickNumber(row, ["max_term_months", "max_term", "term_months"], match?.maxTerm, DEFAULT_TERMS_NEW.maxTerm);
    if (maxTermRaw === "" || typeof maxTermRaw !== "number" || maxTermRaw < 1 || !Number.isFinite(maxTermRaw)) {
      preview.push({ line, status: "error", summary: "Invalid max_term_months (need integer ≥ 1)" });
      return;
    }

    const minAmountRaw = pickNumber(row, ["min_amount"], match?.minAmount, DEFAULT_TERMS_NEW.minAmount);
    if (minAmountRaw === "" || typeof minAmountRaw !== "number" || minAmountRaw < 0) {
      preview.push({ line, status: "error", summary: "Invalid min_amount" });
      return;
    }

    const maxAmountRaw = pickNumber(row, ["max_amount"], match?.maxAmount, DEFAULT_TERMS_NEW.maxAmount);
    if (maxAmountRaw === "" || typeof maxAmountRaw !== "number" || maxAmountRaw < 0) {
      preview.push({ line, status: "error", summary: "Invalid max_amount" });
      return;
    }

    if (maxAmountRaw < minAmountRaw) {
      preview.push({ line, status: "error", summary: "max_amount must be ≥ min_amount" });
      return;
    }

    const fees = pickFees(row, match?.fees);
    if ("error" in fees) {
      preview.push({ line, status: "error", summary: fees.error });
      return;
    }

    const csRaw = pickNumber(
      row,
      ["compulsory_savings_rate", "comp_savings_pct", "compulsory_savings"],
      match?.compulsorySavingsRate,
      DEFAULT_TERMS_NEW.compulsorySavingsRate
    );
    if (csRaw === "" || typeof csRaw !== "number" || csRaw < 0) {
      preview.push({ line, status: "error", summary: "Invalid compulsory_savings_rate" });
      return;
    }

    const minSharesRaw = pickNumber(row, ["minimum_shares", "min_shares"], match?.minimumShares, DEFAULT_TERMS_NEW.minimumShares);
    if (minSharesRaw === "" || typeof minSharesRaw !== "number" || minSharesRaw < 0) {
      preview.push({ line, status: "error", summary: "Invalid minimum_shares" });
      return;
    }

    const activeRaw = cell(row, ["is_active", "active"]);
    let isActive = match?.isActive ?? DEFAULT_TERMS_NEW.isActive;
    if (activeRaw) {
      const b = parseBool(activeRaw, isActive);
      if (b === null) {
        preview.push({ line, status: "error", summary: "is_active must be yes/no or true/false" });
        return;
      }
      isActive = b;
    }

    const id =
      match?.id ??
      `LP${String(existingProducts.length + csvProducts.length + 1).padStart(4, "0")}`;

    const product: LoanProduct = {
      id,
      name: rawName.trim(),
      loanCode,
      interestRate: interestRateRaw,
      maxTerm: Math.round(maxTermRaw),
      minAmount: minAmountRaw,
      maxAmount: maxAmountRaw,
      interestBasis,
      fees,
      compulsorySavingsRate: csRaw,
      minimumShares: minSharesRaw,
      isActive,
    };

    csvProducts.push(product);
    const verb = match ? "Update" : "Create";
    preview.push({
      line,
      status: "ok",
      summary: `${verb}: ${product.name}${match ? "" : " (new)"}`,
    });
  });

  const errCount = preview.filter((r) => r.status === "error").length;
  if (errCount > 0) return { merged: null, preview };

  const untouched = existingProducts.filter((p) => !namesSeenInCsv.has(p.name.trim().toLowerCase()));
  const merged = [...csvProducts, ...untouched];

  return { merged, preview };
}

export async function applyLoanProductsImport(organizationId: string, merged: LoanProduct[]): Promise<SaccoBulkImportResult> {
  try {
    await replaceLoanProductsForOrg(organizationId, merged);
    return { updated: merged.length, skipped: 0, errors: 0, messages: [] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { updated: 0, skipped: 0, errors: 1, messages: [msg] };
  }
}

/** Loan product CSV/Excel bulk import — org Admin or Super Admin only. */
export function canBulkImportSaccoLoanProducts(
  staffRole: string | null | undefined,
  opts?: { isSuperAdmin?: boolean }
): boolean {
  if (opts?.isSuperAdmin) return true;
  return String(staffRole ?? "").trim().toLowerCase() === "admin";
}
