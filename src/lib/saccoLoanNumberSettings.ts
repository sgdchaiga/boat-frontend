/**
 * SACCO loan reference numbers: branch + loan product code + serial (same arrangement options as savings).
 */
import { supabase } from "@/lib/supabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

/** PostgREST: table not in schema (migration not applied on this Supabase project). */
function isMissingLoanNumberSettingsRelationError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; code?: string; message?: string; details?: string };
  if (e.status === 404 || e.status === 406) return true;
  const m = `${e.message ?? ""} ${e.details ?? ""}`.toLowerCase();
  if (m.includes("schema cache") || m.includes("could not find") || m.includes("does not exist")) return true;
  const c = String(e.code ?? "");
  if (c === "PGRST205" || c === "42P01") return true;
  return false;
}

export const SACCO_LOAN_NUMBER_SETTINGS_MISSING_MSG =
  "Database is missing loan number tables. In the Supabase dashboard: SQL Editor → paste and run the migration file supabase/migrations/20260516120000_sacco_loan_number_settings.sql, then click Run. Alternatively run: supabase db push";

function asSettingsError(err: unknown): Error {
  if (isMissingLoanNumberSettingsRelationError(err)) {
    return new Error(SACCO_LOAN_NUMBER_SETTINGS_MISSING_MSG);
  }
  return err instanceof Error ? err : new Error(String(err));
}

export type LoanNumberSegmentKind = "branch" | "loan_code" | "serial";

export const LOAN_NUMBER_SEGMENT_LABELS: Record<LoanNumberSegmentKind, string> = {
  branch: "Branch",
  loan_code: "Loan code",
  serial: "Serial",
};

export const LOAN_NUMBER_SEGMENT_HELP: Record<LoanNumberSegmentKind, string> = {
  branch: "Uses the branch code you set below (padded to width).",
  loan_code: "Uses each loan product’s Loan code (Loan settings → product). Preview uses the sample code below.",
  serial: "Next sequence for that branch + loan code combination.",
};

export const DEFAULT_LOAN_NUMBER_SEGMENT_ORDER: LoanNumberSegmentKind[] = ["branch", "loan_code", "serial"];

const ALL_LOAN_SEGMENTS: LoanNumberSegmentKind[] = ["branch", "loan_code", "serial"];

function isLoanSegmentKind(s: string): s is LoanNumberSegmentKind {
  return s === "branch" || s === "loan_code" || s === "serial";
}

export function parseLoanNumberSegmentOrder(raw: string | null | undefined): LoanNumberSegmentKind[] {
  const parts = String(raw ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const seen = new Set<LoanNumberSegmentKind>();
  const out: LoanNumberSegmentKind[] = [];
  for (const p of parts) {
    if (!isLoanSegmentKind(p) || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  for (const k of ALL_LOAN_SEGMENTS) {
    if (!seen.has(k)) out.push(k);
  }
  return out.length === 3 ? (out as LoanNumberSegmentKind[]) : [...DEFAULT_LOAN_NUMBER_SEGMENT_ORDER];
}

export function serializeLoanNumberSegmentOrder(order: LoanNumberSegmentKind[]): string {
  return [...order].join(",");
}

export type SaccoLoanNumberSettingsRow = {
  organization_id: string;
  branch_digit_count: number;
  loan_code_digit_count: number;
  serial_digit_count: number;
  branch_value: string;
  loan_code_value: string;
  separator: string;
  segment_order?: string | null;
  updated_at: string;
};

export type SaccoLoanNumberSettings = {
  branchDigitCount: number;
  loanCodeDigitCount: number;
  serialDigitCount: number;
  branchValue: string;
  loanCodeValue: string;
  separator: string;
  segmentOrder: LoanNumberSegmentKind[];
};

export const DEFAULT_LOAN_NUMBER_SETTINGS: SaccoLoanNumberSettings = {
  branchDigitCount: 2,
  loanCodeDigitCount: 2,
  serialDigitCount: 5,
  branchValue: "1",
  loanCodeValue: "1",
  separator: "-",
  segmentOrder: [...DEFAULT_LOAN_NUMBER_SEGMENT_ORDER],
};

export function rowToLoanNumberSettings(row: SaccoLoanNumberSettingsRow): SaccoLoanNumberSettings {
  return {
    branchDigitCount: row.branch_digit_count,
    loanCodeDigitCount: row.loan_code_digit_count,
    serialDigitCount: row.serial_digit_count,
    branchValue: row.branch_value,
    loanCodeValue: row.loan_code_value,
    separator: row.separator ?? "-",
    segmentOrder: parseLoanNumberSegmentOrder(row.segment_order),
  };
}

export function normalizeNumericSegment(raw: string, digitCount: number): string {
  const only = String(raw ?? "").replace(/\D/g, "") || "0";
  const max = 10 ** digitCount - 1;
  const n = Math.min(Math.max(parseInt(only, 10) || 0, 0), max);
  return String(n).padStart(digitCount, "0");
}

function loanSegmentStrings(
  settings: SaccoLoanNumberSettings,
  loanProductCode: string,
  serial: number
): Record<LoanNumberSegmentKind, string> {
  const b = normalizeNumericSegment(settings.branchValue, settings.branchDigitCount);
  const lc = normalizeNumericSegment(loanProductCode, settings.loanCodeDigitCount);
  const maxSerial = 10 ** settings.serialDigitCount - 1;
  const s = Math.min(Math.max(Math.floor(serial), 0), maxSerial);
  const serialPart = String(s).padStart(settings.serialDigitCount, "0");
  return { branch: b, loan_code: lc, serial: serialPart };
}

/** Structured loan reference number. */
export function buildLoanNumber(settings: SaccoLoanNumberSettings, loanProductCode: string, serial: number): string {
  const parts = loanSegmentStrings(settings, loanProductCode, serial);
  const order =
    settings.segmentOrder?.length === 3 ? settings.segmentOrder : DEFAULT_LOAN_NUMBER_SEGMENT_ORDER;
  const strings = order.map((k) => parts[k]);
  const sep = settings.separator;
  return sep ? strings.join(sep) : strings.join("");
}

export function settingsWithLoanBranchCode(
  settings: SaccoLoanNumberSettings,
  branchCode: string
): SaccoLoanNumberSettings {
  const code = String(branchCode ?? "").trim() || settings.branchValue;
  return { ...settings, branchValue: code };
}

function splitLoanNumberParts(
  loanNumber: string,
  settings: SaccoLoanNumberSettings
): string[] | null {
  const order =
    settings.segmentOrder?.length === 3 ? settings.segmentOrder : DEFAULT_LOAN_NUMBER_SEGMENT_ORDER;
  const sep = settings.separator;
  if (sep) {
    const parts = loanNumber.split(sep);
    return parts.length === 3 ? parts : null;
  }
  let offset = 0;
  const out: string[] = [];
  for (const kind of order) {
    const w =
      kind === "branch"
        ? settings.branchDigitCount
        : kind === "loan_code"
          ? settings.loanCodeDigitCount
          : settings.serialDigitCount;
    out.push(loanNumber.slice(offset, offset + w));
    offset += w;
  }
  if (offset !== loanNumber.length) return null;
  return out;
}

function partsToRecord(parts: string[], order: LoanNumberSegmentKind[]): Record<LoanNumberSegmentKind, string> | null {
  if (parts.length !== 3 || order.length !== 3) return null;
  return {
    [order[0]]: parts[0],
    [order[1]]: parts[1],
    [order[2]]: parts[2],
  } as Record<LoanNumberSegmentKind, string>;
}

export function extractSerialFromLoanNumber(
  loanNumber: string,
  settings: SaccoLoanNumberSettings,
  loanProductCode: string
): number | null {
  const order =
    settings.segmentOrder?.length === 3 ? settings.segmentOrder : DEFAULT_LOAN_NUMBER_SEGMENT_ORDER;
  const parts = splitLoanNumberParts(loanNumber, settings);
  if (!parts) return null;
  const rec = partsToRecord(parts, order);
  if (!rec) return null;
  const expect = loanSegmentStrings(settings, loanProductCode, 0);
  if (rec.branch !== expect.branch || rec.loan_code !== expect.loan_code) return null;
  const serialStr = rec.serial;
  if (!/^\d+$/.test(serialStr) || serialStr.length !== settings.serialDigitCount) return null;
  return parseInt(serialStr, 10);
}

export function nextSerialFromExistingLoanNumbers(
  loanNumbers: string[],
  settings: SaccoLoanNumberSettings,
  loanProductCode: string
): number {
  let max = 0;
  for (const num of loanNumbers) {
    const s = extractSerialFromLoanNumber(num, settings, loanProductCode);
    if (s !== null && s > max) max = s;
  }
  return max + 1;
}

export async function fetchSaccoLoanNumberSettings(
  organizationId: string
): Promise<SaccoLoanNumberSettings | null> {
  const { data, error } = await sb
    .from("sacco_loan_number_settings")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) {
    if (isMissingLoanNumberSettingsRelationError(error)) {
      console.warn("[SACCO] sacco_loan_number_settings missing — apply migration 20260516120000_sacco_loan_number_settings.sql.");
      return null;
    }
    throw error;
  }
  if (!data) return null;
  return rowToLoanNumberSettings(data as SaccoLoanNumberSettingsRow);
}

export async function upsertSaccoLoanNumberSettings(
  organizationId: string,
  settings: SaccoLoanNumberSettings
): Promise<void> {
  const order =
    settings.segmentOrder?.length === 3 ? settings.segmentOrder : DEFAULT_LOAN_NUMBER_SEGMENT_ORDER;
  const rowBase = {
    organization_id: organizationId,
    branch_digit_count: settings.branchDigitCount,
    loan_code_digit_count: settings.loanCodeDigitCount,
    serial_digit_count: settings.serialDigitCount,
    branch_value: settings.branchValue,
    loan_code_value: settings.loanCodeValue,
    separator: settings.separator,
  };
  const rowWithOrder = {
    ...rowBase,
    segment_order: serializeLoanNumberSegmentOrder(order),
  };
  let { error } = await sb.from("sacco_loan_number_settings").upsert(rowWithOrder, { onConflict: "organization_id" });
  if (error) {
    const msg = `${error.message ?? ""} ${(error as { details?: string }).details ?? ""}`;
    const looksLikeMissingSegmentOrder =
      /segment_order|42703|column .* does not exist/i.test(msg) || (error as { code?: string }).code === "42703";
    if (looksLikeMissingSegmentOrder) {
      console.warn(
        "[SACCO] sacco_loan_number_settings.segment_order missing — run migration 20260516120000_sacco_loan_number_settings.sql. Saving other fields without segment order."
      );
      const retry = await sb.from("sacco_loan_number_settings").upsert(rowBase, { onConflict: "organization_id" });
      error = retry.error;
    }
    if (error) throw asSettingsError(error);
  }
}

/** Next loan_number for a loan product code and optional branch code. */
export async function suggestNextLoanNumber(
  organizationId: string,
  loanProductCode: string,
  branchCode?: string | null
): Promise<string> {
  const base = await fetchSaccoLoanNumberSettings(organizationId);
  const settings =
    base && branchCode?.trim()
      ? settingsWithLoanBranchCode(base, branchCode.trim())
      : base;
  const { data, error } = await sb
    .from("sacco_loans")
    .select("loan_number")
    .eq("organization_id", organizationId);
  if (error) throw error;
  const numbers = (data ?? [])
    .map((r: { loan_number: string | null }) => r.loan_number)
    .filter((n: string | null | undefined): n is string => Boolean(n?.trim()));
  if (!settings) {
    const serial = numbers.length + 1;
    return `LN-${String(serial).padStart(6, "0")}`;
  }
  const serial = nextSerialFromExistingLoanNumbers(numbers, settings, loanProductCode);
  return buildLoanNumber(settings, loanProductCode, serial);
}
