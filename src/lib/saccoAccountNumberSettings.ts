/**
 * SACCO numbering:
 * - Member register: simple sequential numeric member_number (1, 2, 3…).
 * - Savings accounts (per product): structured number from Admin (branch / account type / serial).
 */
import { supabase } from "@/lib/supabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

/** Fixed segments; each appears once in `segmentOrder` to define build order. */
export type SegmentKind = "branch" | "account_type" | "serial";

export const SEGMENT_LABELS: Record<SegmentKind, string> = {
  branch: "Branch",
  account_type: "Account type",
  serial: "Serial",
};

/**
 * Human-readable: which numeric code feeds each segment.
 * - Branch: `branchValue` from settings.
 * - Account type: product / savings code at account opening (admin preview uses `accountTypeValue`).
 * - Serial: running sequence (no fixed code).
 */
export const SEGMENT_CODE_HELP: Record<SegmentKind, string> = {
  branch: "Uses the branch code you set below (padded to width).",
  account_type:
    "Uses the savings product code for that account (e.g. 12). Enter the same code in preview below to see it padded.",
  serial: "No fixed code — the next sequence number is assigned automatically.",
};

export const DEFAULT_SEGMENT_ORDER: SegmentKind[] = ["branch", "account_type", "serial"];

const ALL_SEGMENTS: SegmentKind[] = ["branch", "account_type", "serial"];

function isSegmentKind(s: string): s is SegmentKind {
  return s === "branch" || s === "account_type" || s === "serial";
}

/** Parse DB value; invalid or missing → default order. */
export function parseSegmentOrder(raw: string | null | undefined): SegmentKind[] {
  const parts = String(raw ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const seen = new Set<SegmentKind>();
  const out: SegmentKind[] = [];
  for (const p of parts) {
    if (!isSegmentKind(p) || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  for (const k of ALL_SEGMENTS) {
    if (!seen.has(k)) out.push(k);
  }
  return out.length === 3 ? (out as SegmentKind[]) : [...DEFAULT_SEGMENT_ORDER];
}

export function serializeSegmentOrder(order: SegmentKind[]): string {
  return [...order].join(",");
}

export type SaccoAccountNumberSettingsRow = {
  organization_id: string;
  branch_digit_count: number;
  account_type_digit_count: number;
  serial_digit_count: number;
  branch_value: string;
  account_type_value: string;
  separator: string;
  segment_order?: string | null;
  updated_at: string;
};

export type SaccoAccountNumberSettings = {
  branchDigitCount: number;
  accountTypeDigitCount: number;
  serialDigitCount: number;
  branchValue: string;
  /**
   * Sample / default account-type **code** for admin preview (padded to `accountTypeDigitCount`).
   * Real accounts use the **product code** entered on “Open savings account” — e.g. code `12` fills this segment.
   */
  accountTypeValue: string;
  separator: string;
  /** Left-to-right order when joining segments. */
  segmentOrder: SegmentKind[];
};

export const DEFAULT_ACCOUNT_NUMBER_SETTINGS: SaccoAccountNumberSettings = {
  branchDigitCount: 2,
  accountTypeDigitCount: 2,
  serialDigitCount: 5,
  branchValue: "1",
  accountTypeValue: "1",
  separator: "-",
  segmentOrder: [...DEFAULT_SEGMENT_ORDER],
};

export function rowToAccountSettings(row: SaccoAccountNumberSettingsRow): SaccoAccountNumberSettings {
  return {
    branchDigitCount: row.branch_digit_count,
    accountTypeDigitCount: row.account_type_digit_count,
    serialDigitCount: row.serial_digit_count,
    branchValue: row.branch_value,
    accountTypeValue: row.account_type_value,
    separator: row.separator ?? "-",
    segmentOrder: parseSegmentOrder(row.segment_order),
  };
}

/** Numeric segment: digits from input, clamped to digitCount width, left-padded. */
export function normalizeNumericSegment(raw: string, digitCount: number): string {
  const only = String(raw ?? "").replace(/\D/g, "") || "0";
  const max = 10 ** digitCount - 1;
  const n = Math.min(Math.max(parseInt(only, 10) || 0, 0), max);
  return String(n).padStart(digitCount, "0");
}

function segmentStrings(
  settings: SaccoAccountNumberSettings,
  accountTypeForProduct: string,
  serial: number
): Record<SegmentKind, string> {
  const b = normalizeNumericSegment(settings.branchValue, settings.branchDigitCount);
  const a = normalizeNumericSegment(accountTypeForProduct, settings.accountTypeDigitCount);
  const maxSerial = 10 ** settings.serialDigitCount - 1;
  const s = Math.min(Math.max(Math.floor(serial), 0), maxSerial);
  const serialPart = String(s).padStart(settings.serialDigitCount, "0");
  return { branch: b, account_type: a, serial: serialPart };
}

/** Structured savings account number (segments joined in `segmentOrder`). */
export function buildSavingsAccountNumber(
  settings: SaccoAccountNumberSettings,
  accountTypeForProduct: string,
  serial: number
): string {
  const parts = segmentStrings(settings, accountTypeForProduct, serial);
  const order = settings.segmentOrder?.length === 3 ? settings.segmentOrder : DEFAULT_SEGMENT_ORDER;
  const strings = order.map((k) => parts[k]);
  const sep = settings.separator;
  return sep ? strings.join(sep) : strings.join("");
}

/** Split account number into three segment strings following `segmentOrder`. */
function splitAccountNumberParts(accountNumber: string, settings: SaccoAccountNumberSettings): string[] | null {
  const order = settings.segmentOrder?.length === 3 ? settings.segmentOrder : DEFAULT_SEGMENT_ORDER;
  const sep = settings.separator;
  if (sep) {
    const parts = accountNumber.split(sep);
    return parts.length === 3 ? parts : null;
  }
  let offset = 0;
  const out: string[] = [];
  for (const kind of order) {
    const w =
      kind === "branch"
        ? settings.branchDigitCount
        : kind === "account_type"
          ? settings.accountTypeDigitCount
          : settings.serialDigitCount;
    out.push(accountNumber.slice(offset, offset + w));
    offset += w;
  }
  if (offset !== accountNumber.length) return null;
  return out;
}

function partsToRecord(parts: string[], order: SegmentKind[]): Record<SegmentKind, string> | null {
  if (parts.length !== 3 || order.length !== 3) return null;
  return {
    [order[0]]: parts[0],
    [order[1]]: parts[1],
    [order[2]]: parts[2],
  } as Record<SegmentKind, string>;
}

export function extractSerialFromSavingsAccountNumber(
  accountNumber: string,
  settings: SaccoAccountNumberSettings,
  accountTypeForProduct: string
): number | null {
  const order = settings.segmentOrder?.length === 3 ? settings.segmentOrder : DEFAULT_SEGMENT_ORDER;
  const parts = splitAccountNumberParts(accountNumber, settings);
  if (!parts) return null;
  const rec = partsToRecord(parts, order);
  if (!rec) return null;
  const expect = segmentStrings(settings, accountTypeForProduct, 0);
  if (rec.branch !== expect.branch || rec.account_type !== expect.account_type) return null;
  const serialStr = rec.serial;
  if (!/^\d+$/.test(serialStr) || serialStr.length !== settings.serialDigitCount) return null;
  return parseInt(serialStr, 10);
}

export function nextSerialFromExistingSavingsAccountNumbers(
  accountNumbers: string[],
  settings: SaccoAccountNumberSettings,
  accountTypeForProduct: string
): number {
  let max = 0;
  for (const num of accountNumbers) {
    const s = extractSerialFromSavingsAccountNumber(num, settings, accountTypeForProduct);
    if (s !== null && s > max) max = s;
  }
  return max + 1;
}

/** Next member_number: 1, 2, 3… (numeric only; legacy M-##### ignored for max). */
export function nextSequentialMemberNumber(existingMemberNumbers: string[]): string {
  let max = 0;
  let hasNumeric = false;
  for (const m of existingMemberNumbers) {
    const t = m.trim();
    if (/^\d+$/.test(t)) {
      hasNumeric = true;
      const n = parseInt(t, 10);
      if (n > max) max = n;
    }
  }
  if (!hasNumeric && existingMemberNumbers.length > 0) return "1";
  return String(max + 1);
}

export function legacyMemberNumberFromIndex(oneBasedIndex: number): string {
  return `M-${String(oneBasedIndex).padStart(5, "0")}`;
}

export async function fetchSaccoAccountNumberSettings(organizationId: string): Promise<SaccoAccountNumberSettings | null> {
  const { data, error } = await sb
    .from("sacco_account_number_settings")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return rowToAccountSettings(data as SaccoAccountNumberSettingsRow);
}

export async function upsertSaccoAccountNumberSettings(
  organizationId: string,
  settings: SaccoAccountNumberSettings
): Promise<void> {
  const rowBase = {
    organization_id: organizationId,
    branch_digit_count: settings.branchDigitCount,
    account_type_digit_count: settings.accountTypeDigitCount,
    serial_digit_count: settings.serialDigitCount,
    branch_value: settings.branchValue,
    account_type_value: settings.accountTypeValue,
    separator: settings.separator,
  };
  const rowWithOrder = {
    ...rowBase,
    segment_order: serializeSegmentOrder(settings.segmentOrder?.length === 3 ? settings.segmentOrder : DEFAULT_SEGMENT_ORDER),
  };
  let { error } = await sb.from("sacco_account_number_settings").upsert(rowWithOrder, { onConflict: "organization_id" });
  if (error) {
    const msg = `${error.message ?? ""} ${(error as { details?: string }).details ?? ""}`;
    const looksLikeMissingSegmentOrder =
      /segment_order|42703|column .* does not exist/i.test(msg) || (error as { code?: string }).code === "42703";
    if (looksLikeMissingSegmentOrder) {
      console.warn(
        "[SACCO] sacco_account_number_settings.segment_order missing — run migration 20260426120005. Saving other fields without segment order."
      );
      const retry = await sb.from("sacco_account_number_settings").upsert(rowBase, { onConflict: "organization_id" });
      error = retry.error;
    }
    if (error) throw error;
  }
}

export async function suggestNextMemberNumber(organizationId: string): Promise<string> {
  const { data, error } = await sb.from("sacco_members").select("member_number").eq("organization_id", organizationId);
  if (error) throw error;
  const numbers = (data ?? []).map((r: { member_number: string }) => r.member_number);
  return nextSequentialMemberNumber(numbers);
}

/** Next savings account number for a given product code (account-type segment). */
export async function suggestNextSavingsAccountNumber(
  organizationId: string,
  savingsProductCode: string
): Promise<string> {
  const settings = await fetchSaccoAccountNumberSettings(organizationId);
  const { data, error } = await sb.from("sacco_member_savings_accounts").select("account_number").eq("organization_id", organizationId);
  if (error) throw error;
  const numbers = (data ?? []).map((r: { account_number: string }) => r.account_number);
  if (!settings) {
    const serial = numbers.length + 1;
    return `ACC-${String(serial).padStart(6, "0")}`;
  }
  const serial = nextSerialFromExistingSavingsAccountNumbers(numbers, settings, savingsProductCode);
  return buildSavingsAccountNumber(settings, savingsProductCode, serial);
}
