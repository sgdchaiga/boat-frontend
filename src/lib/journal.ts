/**
 * Journal entry helpers: create journal entries from transactions (room charges, POS, purchases, etc.)
 * and resolve default GL accounts for double-entry posting.
 */

import { supabase } from "./supabase";
import { filterByOrganizationId, filterJournalLinesByOrganizationId } from "./supabaseOrgFilter";
import { resolveJournalAccountSettings } from "./journalAccountSettings";
import {
  fetchFixedAssetCategoryGlMap,
  mergeFixedAssetGlSlots,
  type FixedAssetCategoryGlRow,
} from "./fixedAssetCategoryGlSettings";
import type { PaymentMethodCode } from "./paymentMethod";
import { isPosCashReceipt } from "./paymentClassification";
import { businessDayRangeForDateString, businessTodayISO, toBusinessDateString } from "./timezone";
import { normalizeGlAccountRows } from "./glAccountNormalize";
import { effectiveStockMovementInOut } from "./stockMovementEffective";

export type JournalReferenceType =
  | "room_charge"
  | "payment"
  | "pos"
  | "bill"
  | "vendor_payment"
  | "vendor_credit"
  | "expense"
  | "manual"
  | "fixed_asset_capitalization"
  | "fixed_asset_depreciation_run"
  | "fixed_asset_disposal"
  | "fixed_asset_revaluation"
  | "fixed_asset_impairment"
  /** SACCO teller cash deposit / withdrawal — idempotent on teller transaction id. */
  | "sacco_teller"
  | "school_invoice"
  | "school_payment"
  | "manufacturing_costing";

export interface JournalLine {
  gl_account_id: string;
  debit: number;
  credit: number;
  line_description?: string | null;
  /** Stored in `journal_entry_lines.dimensions` (e.g. branch, department_id). */
  dimensions?: Record<string, unknown> | null;
}

export interface CreateJournalEntryParams {
  entry_date: string;
  description: string;
  reference_type: JournalReferenceType;
  reference_id?: string | null;
  lines: JournalLine[];
  created_by?: string | null;
  /** When set, stamps journal_entries.organization_id (required for service/cron posts). */
  organizationId?: string | null;
}

export type JournalPostResult = { ok: true; journalId: string } | { ok: false; error: string };

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Default GL account IDs by role (settings + category + type fallbacks) */
let cachedAccounts: {
  key: string;
  value: {
    revenue: string | null;
    cash: string | null;
    receivable: string | null;
    expense: string | null;
    commissionExpense: string | null;
    payable: string | null;
    vat: string | null;
    purchasesInventory: string | null;
    posBank: string | null;
    posMtnMobileMoney: string | null;
    posAirtelMoney: string | null;
    posCogsBar: string | null;
    posInvBar: string | null;
    posCogsKitchen: string | null;
    posInvKitchen: string | null;
    posCogsRoom: string | null;
    posInvRoom: string | null;
    posRevenueBar: string | null;
    posRevenueKitchen: string | null;
    posRevenueRoom: string | null;
  };
} | null = null;

async function resolveOrganizationId(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("staff").select("organization_id").eq("id", user.id).maybeSingle();
  return (data as { organization_id?: string | null } | null)?.organization_id ?? null;
}

export async function getDefaultGlAccounts(): Promise<{
  revenue: string | null;
  cash: string | null;
  receivable: string | null;
  expense: string | null;
  commissionExpense: string | null;
  payable: string | null;
  /** VAT / tax (input on purchases, output on sales) — from journal settings or chart name match. */
  vat: string | null;
  /** GRN/Bills debit — inventory / shop stock; falls back from settings + POS inventory + chart heuristic. */
  purchasesInventory: string | null;
  posBank: string | null;
  posMtnMobileMoney: string | null;
  posAirtelMoney: string | null;
  posCogsBar: string | null;
  posInvBar: string | null;
  posCogsKitchen: string | null;
  posInvKitchen: string | null;
  posCogsRoom: string | null;
  posInvRoom: string | null;
  /** POS sales revenue by bar / kitchen / room (defaults to `revenue` when unset). */
  posRevenueBar: string | null;
  posRevenueKitchen: string | null;
  posRevenueRoom: string | null;
}> {
  const orgId = await resolveOrganizationId();
  const cacheKey = orgId ?? "no-org";
  if (cachedAccounts && cachedAccounts.key === cacheKey) return cachedAccounts.value;

  const settings = await resolveJournalAccountSettings(orgId ?? undefined);

  const { data: accounts } = await filterByOrganizationId(
    supabase
      .from("gl_accounts")
      .select("*")
      .order("account_code"),
    orgId,
    false
  );

  const list = normalizeGlAccountRows((accounts || []) as unknown[]).filter((row) => row.is_active).map((row) => ({
    id: row.id,
    account_type: row.account_type,
    category: row.category,
    account_name: row.account_name,
    account_code: row.account_code,
  }));
  const byType = (t: string) => list.filter((a) => a.account_type === t);
  const first = (arr: { id: string }[]) => (arr.length > 0 ? arr[0].id : null);
  const byCategory = (cat: string) =>
    list.find((a) => (a.category || "").toLowerCase().includes(cat))?.id ?? null;
  const byCode = (code: string) => list.find((a) => a.account_code === code)?.id ?? null;

  const revenue = settings.revenue_id ?? byCategory("revenue") ?? first(byType("income"));
  const cash = settings.cash_id ?? byCategory("cash") ?? first(byType("asset"));
  const assets = byType("asset");
  const receivable =
    settings.receivable_id ??
    byCategory("receivable") ??
    list.find((a) => (a.account_name || "").toLowerCase().includes("receivable"))?.id ??
    first(assets);
  const expense = settings.expense_id ?? byCategory("expense") ?? first(byType("expense"));
  const commissionExpense =
    list.find((a) => a.account_type === "expense" && /(commission|agent|broker|delivery)/i.test(a.account_name || ""))?.id ??
    expense;
  const payable = settings.payable_id ?? byCategory("payable") ?? first(byType("liability"));

  const vat =
    settings.vat_id ??
    list.find(
      (a) =>
        a.account_type === "liability" &&
        /(vat|gst|sales tax|input tax|output tax|withholding)/i.test(a.account_name || "")
    )?.id ??
    list.find(
      (a) =>
        a.account_type === "asset" &&
        /(vat|gst|input tax|recoverable)/i.test(a.account_name || "")
    )?.id ??
    list.find((a) => /(vat|gst|sales tax)/i.test(a.account_name || ""))?.id ??
    null;

  const posBank =
    settings.pos_bank_id ??
    byCode("1120") ??
    list.find(
      (a) =>
        a.account_type === "asset" &&
        (a.account_name || "").toLowerCase().includes("bank") &&
        !(a.account_name || "").toLowerCase().includes("charge")
    )?.id ??
    null;
  const mobileFallback =
    list.find(
      (a) =>
        a.account_type === "asset" &&
        /(mobile money|momo|mtn|airtel)/i.test(a.account_name || "")
    )?.id ?? null;
  const posMtnMobileMoney =
    settings.pos_mtn_mobile_money_id ??
    byCode("1130") ??
    list.find(
      (a) =>
        a.account_type === "asset" &&
        /(mtn|mobile money|momo)/i.test(a.account_name || "") &&
        !/airtel/i.test(a.account_name || "")
    )?.id ??
    mobileFallback;
  const posAirtelMoney =
    settings.pos_airtel_money_id ??
    list.find((a) => a.account_type === "asset" && /airtel/i.test(a.account_name || ""))?.id ??
    mobileFallback;

  const posCogsBar = settings.pos_cogs_bar_id ?? null;
  const posInvBar = settings.pos_inventory_bar_id ?? null;
  const posCogsKitchen = settings.pos_cogs_kitchen_id ?? null;
  const posInvKitchen = settings.pos_inventory_kitchen_id ?? null;
  const posCogsRoom = settings.pos_cogs_room_id ?? null;
  const posInvRoom = settings.pos_inventory_room_id ?? null;

  const posRevenueBar = settings.pos_revenue_bar_id ?? revenue;
  const posRevenueKitchen = settings.pos_revenue_kitchen_id ?? revenue;
  const posRevenueRoom = settings.pos_revenue_room_id ?? revenue;

  const heuristicInventoryAsset =
    list.find((a) => {
      if (a.account_type !== "asset") return false;
      const n = (a.account_name || "").toLowerCase();
      const c = (a.category || "").toLowerCase();
      if (/(cash|bank|receivable|prepaid|deposit|mobile money)/i.test(n)) return false;
      return (
        /(inventory|stock|shop|merchandise|goods)/i.test(n) ||
        /(inventory|stock)/i.test(c)
      );
    })?.id ?? null;

  const purchasesInventory =
    settings.purchases_inventory_id ??
    posInvKitchen ??
    posInvBar ??
    posInvRoom ??
    heuristicInventoryAsset;

  const value = {
    revenue,
    cash,
    receivable: receivable ?? cash,
    expense,
    commissionExpense,
    payable,
    vat,
    purchasesInventory,
    posBank,
    posMtnMobileMoney,
    posAirtelMoney,
    posCogsBar,
    posInvBar,
    posCogsKitchen,
    posInvKitchen,
    posCogsRoom,
    posInvRoom,
    posRevenueBar,
    posRevenueKitchen,
    posRevenueRoom,
  };
  cachedAccounts = { key: cacheKey, value };
  return value;
}

export function clearJournalAccountCache() {
  cachedAccounts = null;
}

export async function createJournalEntry(params: CreateJournalEntryParams): Promise<JournalPostResult> {
  const { entry_date, description, reference_type, reference_id, lines, created_by, organizationId } = params;
  if (!lines.length) return { ok: false, error: "No journal lines" };
  const totalDr = lines.reduce((s, l) => s + l.debit, 0);
  const totalCr = lines.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalDr - totalCr) > 0.01) {
    return { ok: false, error: "Debits must equal credits" };
  }

  const orgForJournal =
    organizationId === undefined ? await resolveOrganizationId() : organizationId;

  const toRpcLines = (includeDimensions: boolean) =>
    lines.map((l) => {
      const row: Record<string, unknown> = {
        gl_account_id: l.gl_account_id,
        debit: l.debit,
        credit: l.credit,
        line_description: l.line_description ?? null,
      };
      if (
        includeDimensions &&
        l.dimensions != null &&
        typeof l.dimensions === "object" &&
        Object.keys(l.dimensions).length > 0
      ) {
        row.dimensions = l.dimensions;
      }
      return row;
    });

  const runCreate = (includeDimensions: boolean) =>
    supabase.rpc("create_journal_entry_atomic", {
      p_entry_date: toBusinessDateString(entry_date),
      p_description: description,
      p_reference_type: reference_type,
      p_reference_id: reference_id ?? null,
      p_created_by: created_by ?? null,
      p_lines: toRpcLines(includeDimensions),
      p_organization_id: orgForJournal ?? null,
    });

  let { data, error } = await runCreate(true);
  if (error && /dimensions/i.test(error.message) && /journal_entry_lines/i.test(error.message)) {
    console.warn(
      "[journal] create_journal_entry_atomic retrying without dimensions; journal_entry_lines.dimensions is unavailable in this DB schema."
    );
    ({ data, error } = await runCreate(false));
  }

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Journal entry was not created" };
  return { ok: true, journalId: data };
}

/** Retires journals for a source transaction before reposting it. */
export async function deleteJournalEntryByReference(
  referenceType: JournalReferenceType,
  referenceId: string,
  requestedOrganizationId?: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const orgId = requestedOrganizationId ?? (await resolveOrganizationId());
  const { data: existing, error: existingError } = await filterByOrganizationId(
    supabase
      .from("journal_entries")
      .select("id")
      .eq("reference_type", referenceType)
      .eq("reference_id", referenceId)
      .eq("is_posted", true)
      .eq("is_deleted", false),
    orgId,
    false
  );
  if (existingError) return { ok: false, error: existingError.message };
  const entryIds = ((existing || []) as Array<{ id: string }>).map((entry) => entry.id);
  if (entryIds.length > 0) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: softDeletedCount, error: softDeleteError } = await supabase.rpc("bulk_soft_delete_journal_entries", {
      p_entry_ids: entryIds,
      p_user_id: user?.id ?? null,
    });
    if (!softDeleteError) {
      if (Number(softDeletedCount || 0) !== entryIds.length) {
        return {
          ok: false,
          error: "Existing journal could not be retired. Check the accounting period lock before reposting this transaction.",
        };
      }
      return { ok: true };
    }
    if (!/bulk_soft_delete_journal_entries|function/i.test(softDeleteError.message)) {
      return { ok: false, error: softDeleteError.message };
    }
  }

  // Compatibility fallback for installations without journal soft-delete support.
  const { error } = await filterByOrganizationId(
    supabase
      .from("journal_entries")
      .delete()
      .eq("reference_type", referenceType)
      .eq("reference_id", referenceId),
    orgId,
    false
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Creates auditable reversal journals for every active journal posted against a source transaction. */
export async function reverseJournalEntriesByReference(
  referenceType: JournalReferenceType,
  referenceId: string,
  createdBy: string | null,
  reason: string
): Promise<{ ok: true; reversed: number } | { ok: false; error: string }> {
  const orgId = await resolveOrganizationId();
  const { data: entries, error: entryError } = await filterByOrganizationId(
    supabase
      .from("journal_entries")
      .select("id,entry_date,description")
      .eq("reference_type", referenceType)
      .eq("reference_id", referenceId)
      .eq("is_deleted", false),
    orgId,
    false
  );
  if (entryError) return { ok: false, error: entryError.message };

  let reversed = 0;
  for (const entry of (entries || []) as Array<{ id: string; entry_date: string; description: string }>) {
    const reversalQuery = filterByOrganizationId(
      supabase
        .from("journal_entries")
        .select("id")
        .eq("reference_type", "manual")
        .eq("reference_id", entry.id)
        .eq("is_deleted", false),
      orgId,
      false
    );
    const { data: existingReversal, error: reversalCheckError } = await reversalQuery.maybeSingle();
    if (reversalCheckError) return { ok: false, error: reversalCheckError.message };
    if (existingReversal) continue;

    const { data: lines, error: lineError } = await supabase
      .from("journal_entry_lines")
      .select("gl_account_id,debit,credit,line_description")
      .eq("journal_entry_id", entry.id);
    if (lineError) return { ok: false, error: lineError.message };
    const result = await createJournalEntry({
      entry_date: businessTodayISO(),
      description: `Reversal: ${entry.description} (${reason})`,
      reference_type: "manual",
      reference_id: entry.id,
      created_by: createdBy,
      organizationId: orgId,
      lines: ((lines || []) as JournalLine[]).map((line) => ({
        gl_account_id: line.gl_account_id,
        debit: Number(line.credit || 0),
        credit: Number(line.debit || 0),
        line_description: `Reversal: ${line.line_description || entry.description}`,
      })),
    });
    if (!result.ok) return result;
    reversed += 1;
  }
  return { ok: true, reversed };
}

async function resolveFixedAssetGlSlots(categoryId: string | null): Promise<{
  cost: string | null;
  accum: string | null;
  depExp: string | null;
  reval: string | null;
  impair: string | null;
  gain: string | null;
  loss: string | null;
  retainedEarnings: string | null;
  cash: string | null;
}> {
  const orgId = await resolveOrganizationId();
  const s = await resolveJournalAccountSettings(orgId ?? undefined);
  const base = await getDefaultGlAccounts();
  let catRow: FixedAssetCategoryGlRow | undefined;
  if (categoryId && orgId) {
    const { data } = await supabase
      .from("fixed_asset_category_gl_settings")
      .select("*")
      .eq("organization_id", orgId)
      .eq("category_id", categoryId)
      .maybeSingle();
    catRow = (data as FixedAssetCategoryGlRow | null) ?? undefined;
  }
  return mergeFixedAssetGlSlots(s, base.cash, catRow);
}

async function resolveCategoryIdForFixedAssetEvent(eventId: string): Promise<string | null> {
  const { data: ev, error } = await supabase
    .from("fixed_asset_events")
    .select("asset_id")
    .eq("id", eventId)
    .maybeSingle();
  if (error || !ev?.asset_id) return null;
  const { data: asset } = await supabase
    .from("fixed_assets")
    .select("category_id")
    .eq("id", ev.asset_id)
    .maybeSingle();
  return (asset as { category_id?: string | null } | null)?.category_id ?? null;
}

/** Capitalize: Dr Fixed asset cost, Cr Cash (or bank clearing). */
export async function createJournalForFixedAssetCapitalization(
  assetId: string,
  amount: number,
  entryDate: string,
  createdBy: string | null
): Promise<JournalPostResult> {
  const { data: assetRow } = await supabase
    .from("fixed_assets")
    .select("category_id")
    .eq("id", assetId)
    .maybeSingle();
  const cid = (assetRow as { category_id?: string | null } | null)?.category_id ?? null;
  const g = await resolveFixedAssetGlSlots(cid);
  if (!g.cost || !g.cash) {
    return {
      ok: false,
      error:
        "Configure Fixed assets — cost and Cash in Admin → Journal account settings before capitalizing.",
    };
  }
  const a = roundMoney(amount);
  if (a <= 0) return { ok: false, error: "Capitalization amount must be positive." };
  return createJournalEntry({
    entry_date: entryDate,
    description: `Fixed asset capitalization`,
    reference_type: "fixed_asset_capitalization",
    reference_id: assetId,
    lines: [
      { gl_account_id: g.cost, debit: a, credit: 0, line_description: "PPE capitalization" },
      { gl_account_id: g.cash, debit: 0, credit: a, line_description: "Payment / clearing" },
    ],
    created_by: createdBy,
  });
}

/** Depreciation run: Dr Depreciation expense, Cr Accumulated depreciation. */
export async function createJournalForFixedAssetDepreciationRun(
  runId: string,
  totalAmount: number,
  entryDate: string,
  createdBy: string | null
): Promise<JournalPostResult> {
  const orgId = await resolveOrganizationId();
  if (!orgId) return { ok: false, error: "No organization." };

  const { data: lineRows, error: lnErr } = await supabase
    .from("fixed_asset_depreciation_lines")
    .select("asset_id, amount")
    .eq("run_id", runId);
  if (lnErr) return { ok: false, error: lnErr.message };
  if (!lineRows?.length) return { ok: false, error: "No depreciation lines for this run." };

  const assetIds = [...new Set(lineRows.map((l) => l.asset_id))];
  const { data: assetRows, error: aErr } = await supabase
    .from("fixed_assets")
    .select("id, category_id")
    .in("id", assetIds);
  if (aErr) return { ok: false, error: aErr.message };

  const assetCat = new Map<string, string | null>();
  for (const a of assetRows || []) {
    assetCat.set((a as { id: string }).id, (a as { category_id?: string | null }).category_id ?? null);
  }

  const global = await resolveJournalAccountSettings(orgId);
  const categoryMap = await fetchFixedAssetCategoryGlMap(orgId);
  const base = await getDefaultGlAccounts();

  const byCat = new Map<string | null, number>();
  for (const ln of lineRows) {
    const cid = assetCat.get(ln.asset_id) ?? null;
    const amt = roundMoney(Number(ln.amount));
    if (amt <= 0) continue;
    byCat.set(cid, roundMoney((byCat.get(cid) ?? 0) + amt));
  }

  const journalLines: JournalLine[] = [];
  for (const [cid, amt] of byCat) {
    if (amt <= 0.005) continue;
    const catRow = cid ? categoryMap.get(cid) : undefined;
    const g = mergeFixedAssetGlSlots(global, base.cash, catRow);
    if (!g.depExp || !g.accum) {
      return {
        ok: false,
        error:
          "Configure depreciation expense and accumulated depreciation GL accounts in Admin → Journal account settings (or set per category under Fixed assets — by category).",
      };
    }
    journalLines.push(
      { gl_account_id: g.depExp, debit: amt, credit: 0, line_description: "Depreciation expense" },
      { gl_account_id: g.accum, debit: 0, credit: amt, line_description: "Accumulated depreciation" }
    );
  }

  if (journalLines.length === 0) {
    return { ok: false, error: "No positive depreciation amounts to post." };
  }

  const sumLines = roundMoney(lineRows.reduce((s, l) => s + roundMoney(Number(l.amount)), 0));
  if (Math.abs(sumLines - roundMoney(totalAmount)) > 0.05) {
    return { ok: false, error: "Depreciation line totals do not match run total." };
  }

  return createJournalEntry({
    entry_date: entryDate,
    description: `Depreciation run`,
    reference_type: "fixed_asset_depreciation_run",
    reference_id: runId,
    lines: journalLines,
    created_by: createdBy,
  });
}

/** Revaluation increase: Dr Fixed asset cost, Cr Revaluation reserve. */
export async function createJournalForFixedAssetRevaluation(
  revaluationEventId: string,
  increaseAmount: number,
  entryDate: string,
  createdBy: string | null
): Promise<JournalPostResult> {
  const categoryId = await resolveCategoryIdForFixedAssetEvent(revaluationEventId);
  const g = await resolveFixedAssetGlSlots(categoryId);
  if (!g.cost || !g.reval) {
    return {
      ok: false,
      error: "Configure fixed asset cost and revaluation reserve GL accounts.",
    };
  }
  const a = roundMoney(increaseAmount);
  if (a <= 0) return { ok: false, error: "Revaluation amount must be positive." };
  return createJournalEntry({
    entry_date: entryDate,
    description: `Fixed asset revaluation`,
    reference_type: "fixed_asset_revaluation",
    reference_id: revaluationEventId,
    lines: [
      { gl_account_id: g.cost, debit: a, credit: 0, line_description: "Fair value increase" },
      { gl_account_id: g.reval, debit: 0, credit: a, line_description: "Revaluation surplus" },
    ],
    created_by: createdBy,
  });
}

/** Impairment: Dr Impairment loss, Cr Fixed asset cost (carrying amount write-down). */
export async function createJournalForFixedAssetImpairment(
  impairmentEventId: string,
  lossAmount: number,
  entryDate: string,
  createdBy: string | null
): Promise<JournalPostResult> {
  const categoryId = await resolveCategoryIdForFixedAssetEvent(impairmentEventId);
  const g = await resolveFixedAssetGlSlots(categoryId);
  if (!g.impair || !g.cost) {
    return {
      ok: false,
      error: "Configure impairment loss and fixed asset cost GL accounts.",
    };
  }
  const a = roundMoney(lossAmount);
  if (a <= 0) return { ok: false, error: "Impairment amount must be positive." };
  return createJournalEntry({
    entry_date: entryDate,
    description: `Fixed asset impairment`,
    reference_type: "fixed_asset_impairment",
    reference_id: impairmentEventId,
    lines: [
      { gl_account_id: g.impair, debit: a, credit: 0, line_description: "Impairment loss" },
      { gl_account_id: g.cost, debit: 0, credit: a, line_description: "Asset write-down" },
    ],
    created_by: createdBy,
  });
}

/** Disposal: remove asset at cost, clear accum. dep., record cash, gain/loss; optional OCI revaluation reserve recycling. */
export async function createJournalForFixedAssetDisposal(
  disposalEventId: string,
  params: {
    originalCost: number;
    accumulatedDepreciation: number;
    proceeds: number;
    entryDate: string;
    createdBy: string | null;
    /** Release revaluation surplus (OCI) to retained earnings — set from asset `revaluation_adjustment` when > 0. */
    revaluationReserveRelease?: number;
    /** Tags all lines for subledger / multi-entity reporting. */
    lineDimensions?: { branch?: string | null; department_id?: string | null } | null;
  }
): Promise<JournalPostResult> {
  const categoryId = await resolveCategoryIdForFixedAssetEvent(disposalEventId);
  const g = await resolveFixedAssetGlSlots(categoryId);
  const {
    originalCost,
    accumulatedDepreciation,
    proceeds,
    entryDate,
    createdBy,
    revaluationReserveRelease,
    lineDimensions,
  } = params;
  if (!g.cost || !g.accum || !g.cash) {
    return {
      ok: false,
      error: "Configure fixed asset cost, accumulated depreciation, and cash GL accounts.",
    };
  }
  const cost = roundMoney(originalCost);
  const acc = roundMoney(accumulatedDepreciation);
  const proc = roundMoney(proceeds);
  const nbv = roundMoney(cost - acc);
  const gainLoss = roundMoney(proc - nbv);

  const dim =
    lineDimensions && (lineDimensions.branch || lineDimensions.department_id)
      ? ({
          ...(lineDimensions.branch ? { branch: lineDimensions.branch } : {}),
          ...(lineDimensions.department_id ? { department_id: lineDimensions.department_id } : {}),
        } as Record<string, unknown>)
      : null;

  const withDim = (line: JournalLine): JournalLine =>
    dim && Object.keys(dim).length > 0 ? { ...line, dimensions: dim } : line;

  const lines: JournalLine[] = [
    withDim({
      gl_account_id: g.accum,
      debit: acc,
      credit: 0,
      line_description: "Clear accumulated depreciation",
    }),
    withDim({ gl_account_id: g.cash, debit: proc, credit: 0, line_description: "Proceeds" }),
    withDim({ gl_account_id: g.cost, debit: 0, credit: cost, line_description: "Remove asset at cost" }),
  ];

  if (gainLoss > 0.005) {
    if (!g.gain) {
      return { ok: false, error: "Configure gain on disposal GL account (or use revenue as fallback in chart)." };
    }
    lines.push(
      withDim({ gl_account_id: g.gain, debit: 0, credit: gainLoss, line_description: "Gain on disposal" })
    );
  } else if (gainLoss < -0.005) {
    const lossAmt = Math.abs(gainLoss);
    if (!g.loss) {
      return { ok: false, error: "Configure loss on disposal GL account." };
    }
    lines.push(withDim({ gl_account_id: g.loss, debit: lossAmt, credit: 0, line_description: "Loss on disposal" }));
  }

  const release = roundMoney(revaluationReserveRelease ?? 0);
  if (release > 0.005) {
    if (!g.reval || !g.retainedEarnings) {
      return {
        ok: false,
        error:
          "Revaluation reserve balance exists on this asset. Configure revaluation reserve and retained earnings GL accounts to recycle OCI on disposal.",
      };
    }
    lines.push(
      withDim({
        gl_account_id: g.reval,
        debit: release,
        credit: 0,
        line_description: "Release revaluation reserve (OCI)",
      }),
      withDim({
        gl_account_id: g.retainedEarnings,
        debit: 0,
        credit: release,
        line_description: "Revaluation surplus to retained earnings",
      })
    );
  }

  const dr = lines.reduce((s, l) => s + l.debit, 0);
  const cr = lines.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(dr - cr) > 0.02) {
    return { ok: false, error: "Disposal journal does not balance (check GL mapping)." };
  }

  return createJournalEntry({
    entry_date: entryDate,
    description: `Fixed asset disposal`,
    reference_type: "fixed_asset_disposal",
    reference_id: disposalEventId,
    lines,
    created_by: createdBy,
  });
}

export type RoomChargeGlOverrides = {
  revenueGlAccountId?: string | null;
  receivableGlAccountId?: string | null;
};

export async function createJournalForRoomCharge(
  billingId: string,
  amount: number,
  description: string,
  chargedAt: string,
  createdBy: string | null,
  glOverrides?: RoomChargeGlOverrides,
  organizationId?: string | null
): Promise<JournalPostResult> {
  const acc = await getDefaultGlAccounts();
  const date = toBusinessDateString(chargedAt);
  const receivableId = glOverrides?.receivableGlAccountId ?? acc.receivable;
  const revenueId = glOverrides?.revenueGlAccountId ?? acc.revenue;
  if (!receivableId || !revenueId) {
    return {
      ok: false,
      error:
        "Missing GL accounts for receivable or revenue. Pick accounts under Hotel POS (this sale), or configure Accounting → Journal account settings.",
    };
  }
  return createJournalEntry({
    entry_date: date,
    description: `Room charge: ${description}`,
    reference_type: "room_charge",
    reference_id: billingId,
    lines: [
      { gl_account_id: receivableId, debit: amount, credit: 0, line_description: description },
      { gl_account_id: revenueId, debit: 0, credit: amount, line_description: "Revenue" },
    ],
    created_by: createdBy,
    organizationId: organizationId === undefined ? undefined : organizationId,
  });
}

export type RoomJournalSyncResult =
  | { ok: true; journalId: string | null }
  | { ok: false; error: string };

/** Rebuild a room-charge journal from its billing source row. */
export async function syncRoomChargeJournal(
  billingId: string,
  requestedOrganizationId?: string | null
): Promise<RoomJournalSyncResult> {
  const organizationId = requestedOrganizationId ?? (await resolveOrganizationId());
  if (!organizationId) return { ok: false, error: "Sign in under an organization before syncing room journals." };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return { ok: false, error: "Sign in before syncing room journals." };

  const { data, error } = await filterByOrganizationId(
    supabase
      .from("billing")
      .select("id,amount,description,charged_at,charge_type")
      .eq("id", billingId)
      .maybeSingle(),
    organizationId,
    false
  );
  if (error) return { ok: false, error: error.message };

  const remove = await deleteJournalEntryByReference("room_charge", billingId, organizationId);
  if (!remove.ok) return remove;
  const row = data as {
    id: string;
    amount: number | null;
    description: string | null;
    charged_at: string | null;
    charge_type: string | null;
  } | null;
  if (!row || row.charge_type !== "room") return { ok: true, journalId: null };

  return createJournalForRoomCharge(
    row.id,
    Number(row.amount || 0),
    row.description || "Room charge",
    row.charged_at || new Date().toISOString(),
    user.id,
    undefined,
    organizationId
  );
}

export interface RoomJournalRepairResult {
  repaired: number;
  errors: string[];
}

/** Rebuild every room-charge journal from billing so GL room revenue matches room billing. */
export async function repairRoomChargeJournals(options?: {
  organizationId?: string | null;
  onProgress?: (processed: number, total: number) => void;
}): Promise<RoomJournalRepairResult> {
  const organizationId = options?.organizationId ?? (await resolveOrganizationId());
  if (!organizationId) throw new Error("Sign in under an organization before repairing room journals.");

  const { data, error } = await filterByOrganizationId(
    supabase
      .from("billing")
      .select("id")
      .eq("charge_type", "room")
      .order("charged_at", { ascending: true }),
    organizationId,
    false
  );
  if (error) throw error;

  const rows = (data || []) as Array<{ id: string }>;
  const result: RoomJournalRepairResult = { repaired: 0, errors: [] };
  options?.onProgress?.(0, rows.length);
  for (let index = 0; index < rows.length; index++) {
    const sync = await syncRoomChargeJournal(rows[index].id, organizationId);
    if (sync.ok && sync.journalId) result.repaired += 1;
    else if (!sync.ok) result.errors.push(`Billing ${rows[index].id}: ${sync.error}`);
    options?.onProgress?.(index + 1, rows.length);
  }
  return result;
}

export async function createJournalForPayment(
  paymentId: string,
  amount: number,
  paidAt: string,
  createdBy: string | null
): Promise<JournalPostResult> {
  const acc = await getDefaultGlAccounts();
  const date = toBusinessDateString(paidAt);
  if (!acc.cash || !acc.receivable) {
    return {
      ok: false,
      error: "Missing GL accounts for cash or receivable. Configure Accounting → Journal account settings.",
    };
  }
  return createJournalEntry({
    entry_date: date,
    description: `Payment received`,
    reference_type: "payment",
    reference_id: paymentId,
    lines: [
      { gl_account_id: acc.cash, debit: amount, credit: 0, line_description: "Payment" },
      { gl_account_id: acc.receivable, debit: 0, credit: amount, line_description: "Receivable" },
    ],
    created_by: createdBy,
  });
}

export interface MisclassifiedPosPaymentJournalRepairResult {
  checked: number;
  removed: number;
  errors: string[];
}

export interface DuplicateExpenseJournalRepairResult {
  matched: number;
  removed: number;
  amount: number;
  errors: string[];
}

export interface MissingKitchenExpenseJournalRepairResult {
  checked: number;
  repaired: number;
  kitchenAmount: number;
  errors: string[];
}

/** Recreate missing Spend Money journals whose line items include the Kitchen purchases GL. */
export async function repairMissingKitchenExpenseJournals(options: {
  fromDate: string;
  toDate: string;
}): Promise<MissingKitchenExpenseJournalRepairResult> {
  const result: MissingKitchenExpenseJournalRepairResult = { checked: 0, repaired: 0, kitchenAmount: 0, errors: [] };
  const organizationId = await resolveOrganizationId();
  if (!organizationId) throw new Error("Sign in under an organization before rewriting Kitchen expense journals.");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) throw new Error("Sign in before rewriting Kitchen expense journals.");

  const { data: glRows, error: glError } = await filterByOrganizationId(
    supabase.from("gl_accounts").select("id,account_code,account_name"),
    organizationId,
    false
  );
  if (glError) throw glError;
  const kitchenGlIds = ((glRows || []) as Array<{ id: string; account_code: string; account_name: string }>)
    .filter((account) => {
      const code = String(account.account_code || "").trim();
      const name = String(account.account_name || "").toLowerCase();
      return code === "5002" || /\bkitchen\b.*\b(purchases?|cogs|cost)/i.test(name);
    })
    .map((account) => account.id);
  if (kitchenGlIds.length === 0) throw new Error("Kitchen purchases GL account 5002 was not found.");

  const { data: expenses, error: expensesError } = await filterByOrganizationId(
    supabase
      .from("expenses")
      .select("id,expense_date")
      .gte("expense_date", options.fromDate)
      .lte("expense_date", options.toDate),
    organizationId,
    false
  );
  if (expensesError) throw expensesError;
  const expenseRows = (expenses || []) as Array<{ id: string; expense_date: string | null }>;
  if (expenseRows.length === 0) return result;

  const expenseIds = expenseRows.map((expense) => expense.id);
  const [{ data: allLines, error: linesError }, { data: activeJournals, error: journalsError }] = await Promise.all([
    supabase
      .from("expense_lines")
      .select(
        "expense_id,expense_gl_account_id,source_cash_gl_account_id,amount,bank_charges,vat_amount,vat_gl_account_id,bank_charges_gl_account_id,comment,quantity,sort_order"
      )
      .in("expense_id", expenseIds)
      .order("sort_order", { ascending: true }),
    filterByOrganizationId(
      supabase
        .from("journal_entries")
        .select("reference_id")
        .eq("reference_type", "expense")
        .eq("is_deleted", false)
        .in("reference_id", expenseIds),
      organizationId,
      false
    ),
  ]);
  if (linesError) throw linesError;
  if (journalsError) throw journalsError;

  const linesByExpense = new Map<string, ExpenseJournalLineInput[]>();
  const kitchenAmountByExpense = new Map<string, number>();
  for (const line of (allLines || []) as Array<ExpenseJournalLineInput & { expense_id: string; sort_order: number }>) {
    const rows = linesByExpense.get(line.expense_id) || [];
    rows.push(line);
    linesByExpense.set(line.expense_id, rows);
    if (kitchenGlIds.includes(line.expense_gl_account_id)) {
      kitchenAmountByExpense.set(
        line.expense_id,
        roundMoney((kitchenAmountByExpense.get(line.expense_id) || 0) + Number(line.amount || 0))
      );
    }
  }
  const activeIds = new Set(
    ((activeJournals || []) as Array<{ reference_id: string | null }>)
      .map((journal) => journal.reference_id)
      .filter((id): id is string => !!id)
  );
  const candidates = expenseRows.filter(
    (expense) => kitchenAmountByExpense.has(expense.id) && !activeIds.has(expense.id)
  );
  result.checked = candidates.length;

  for (const expense of candidates) {
    const lines = linesByExpense.get(expense.id) || [];
    const posted = await createJournalForExpenseWithLines(
      expense.id,
      expense.expense_date || businessTodayISO(),
      lines,
      user.id
    );
    if (posted.ok) {
      result.repaired += 1;
      result.kitchenAmount = roundMoney(result.kitchenAmount + (kitchenAmountByExpense.get(expense.id) || 0));
    } else {
      result.errors.push(`Expense ${expense.id}: ${posted.error}`);
    }
  }
  return result;
}

/** Retire expense journals that duplicate a vendor-payment Cash credit on the same date and amount. */
export async function repairDuplicateExpenseJournals(options: {
  fromDate: string;
  toDate: string;
}): Promise<DuplicateExpenseJournalRepairResult> {
  const result: DuplicateExpenseJournalRepairResult = { matched: 0, removed: 0, amount: 0, errors: [] };
  const organizationId = await resolveOrganizationId();
  if (!organizationId) throw new Error("Sign in under an organization before repairing duplicate expense journals.");
  const accounts = await getDefaultGlAccounts();
  if (!accounts.cash) throw new Error("Cash GL account is not configured.");

  const { data, error } = await filterByOrganizationId(
    supabase
      .from("journal_entries")
      .select("id,entry_date,reference_type,journal_entry_lines(gl_account_id,debit,credit)")
      .in("reference_type", ["expense", "vendor_payment"])
      .eq("is_deleted", false)
      .gte("entry_date", options.fromDate)
      .lte("entry_date", options.toDate),
    organizationId,
    false
  );
  if (error) throw error;

  const cashCredits = (entry: any) =>
    ((entry.journal_entry_lines || []) as Array<{ gl_account_id: string; credit: number }>).reduce(
      (sum, line) => sum + (line.gl_account_id === accounts.cash ? Number(line.credit || 0) : 0),
      0
    );
  const vendorKeys = new Set(
    ((data || []) as any[])
      .filter((entry) => entry.reference_type === "vendor_payment")
      .map((entry) => `${entry.entry_date}|${cashCredits(entry).toFixed(2)}`)
  );
  const duplicates = ((data || []) as any[]).filter(
    (entry) =>
      entry.reference_type === "expense" &&
      cashCredits(entry) > 0 &&
      vendorKeys.has(`${entry.entry_date}|${cashCredits(entry).toFixed(2)}`)
  );

  result.matched = duplicates.length;
  result.amount = duplicates.reduce((sum, entry) => sum + cashCredits(entry), 0);
  if (duplicates.length === 0) return result;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: removed, error: removeError } = await supabase.rpc("bulk_soft_delete_journal_entries", {
    p_entry_ids: duplicates.map((entry) => entry.id),
    p_user_id: user?.id ?? null,
  });
  if (removeError) throw removeError;
  result.removed = Number(removed || 0);
  if (result.removed !== result.matched) {
    result.errors.push("Some matched journals were not retired. Check the accounting period lock.");
  }
  return result;
}

/**
 * Retire payment journals accidentally posted for immediate POS receipts.
 * POS receipts are already accounted for by their `pos` journal, so a second
 * `payment` journal incorrectly debits cash and credits receivables again.
 */
export async function repairMisclassifiedPosPaymentJournals(options?: {
  fromDate?: string | null;
  toDate?: string | null;
  onProgress?: (processed: number, total: number) => void;
}): Promise<MisclassifiedPosPaymentJournalRepairResult> {
  const result: MisclassifiedPosPaymentJournalRepairResult = { checked: 0, removed: 0, errors: [] };
  let query = supabase
    .from("payments")
    .select(
      "id,payment_status,transaction_id,stay_id,property_customer_id,retail_customer_id,invoice_allocations,payment_source,paid_at"
    )
    .eq("payment_status", "completed")
    .order("paid_at", { ascending: true });
  if (options?.fromDate) query = query.gte("paid_at", `${options.fromDate}T00:00:00`);
  if (options?.toDate) query = query.lte("paid_at", `${options.toDate}T23:59:59.999`);
  const { data, error } = await query;
  if (error) throw error;

  const posPayments = ((data || []) as Parameters<typeof isPosCashReceipt>[0][]).filter(isPosCashReceipt);
  result.checked = posPayments.length;
  if (posPayments.length === 0) return result;

  const { data: activeJournals, error: journalError } = await supabase
    .from("journal_entries")
    .select("reference_id")
    .eq("reference_type", "payment")
    .eq("is_deleted", false)
    .in(
      "reference_id",
      posPayments.map((payment) => payment.id)
    );
  if (journalError) throw journalError;
  const activePaymentIds = new Set(
    ((activeJournals || []) as Array<{ reference_id: string | null }>)
      .map((journal) => journal.reference_id)
      .filter((id): id is string => !!id)
  );
  const paymentsToRepair = posPayments.filter((payment) => activePaymentIds.has(payment.id));

  for (let index = 0; index < paymentsToRepair.length; index += 1) {
    const payment = paymentsToRepair[index];
    const retired = await deleteJournalEntryByReference("payment", payment.id);
    if (retired.ok) result.removed += 1;
    else result.errors.push(`Payment ${payment.id}: ${retired.error}`);
    options?.onProgress?.(index + 1, paymentsToRepair.length);
  }
  return result;
}

/** Posted when school uses accrual basis and an invoice is issued (not draft/cancelled). */
export async function createJournalForSchoolInvoiceAccrual(
  invoiceId: string,
  amount: number,
  description: string,
  entryDate: string,
  createdBy: string | null,
  organizationId: string,
  studentId: string | null
): Promise<JournalPostResult> {
  const acc = await getDefaultGlAccounts();
  if (!acc.receivable || !acc.revenue) {
    return {
      ok: false,
      error:
        "Missing receivable or revenue GL for school invoice accrual. Configure Accounting → Journal account settings.",
    };
  }
  const date = toBusinessDateString(entryDate);
  const dims = studentId ? { student_id: studentId } : null;
  return createJournalEntry({
    entry_date: date,
    description: `School fees receivable: ${description}`,
    reference_type: "school_invoice",
    reference_id: invoiceId,
    lines: [
      {
        gl_account_id: acc.receivable,
        debit: amount,
        credit: 0,
        line_description: "Student fees receivable",
        dimensions: dims,
      },
      {
        gl_account_id: acc.revenue,
        debit: 0,
        credit: amount,
        line_description: "Fee income (accrual)",
        dimensions: dims,
      },
    ],
    created_by: createdBy,
    organizationId,
  });
}

function resolveSchoolFeeReceiptGl(
  method: string,
  acc: Awaited<ReturnType<typeof getDefaultGlAccounts>>,
  walletClearingId: string | null | undefined
): string | null {
  const m = (method || "").toLowerCase();
  if (m === "wallet") return walletClearingId ?? acc.cash;
  if (m === "mobile_money") return acc.posMtnMobileMoney ?? acc.cash;
  if (m === "bank" || m === "transfer") return acc.posBank ?? acc.cash;
  return acc.cash;
}

/**
 * School fee receipt — accrual: Dr receipt (or wallet clearing) / Cr receivable (or revenue for cash basis).
 * Wallet flows pair with `wallet_post_transaction` (Dr liability / Cr clearing); this entry completes the tie to AR or revenue.
 */
export async function createJournalForSchoolFeePayment(
  paymentId: string,
  amount: number,
  paymentMethod: string,
  paidAt: string,
  createdBy: string | null,
  organizationId: string,
  basis: "accrual" | "cash",
  studentId: string | null
): Promise<JournalPostResult> {
  const acc = await getDefaultGlAccounts();
  const j = await resolveJournalAccountSettings(organizationId);
  const receiptGl = resolveSchoolFeeReceiptGl(paymentMethod, acc, j.wallet_clearing_id);
  const date = toBusinessDateString(paidAt);
  const dims = studentId ? { student_id: studentId } : null;
  if (!receiptGl) {
    return { ok: false, error: "Missing cash/bank/clearing GL for school fee receipt. Configure journal settings." };
  }
  if (basis === "cash") {
    if (!acc.revenue) {
      return { ok: false, error: "Missing revenue GL for school cash-basis fee income. Configure journal settings." };
    }
    return createJournalEntry({
      entry_date: date,
      description: "School fee receipt (cash basis)",
      reference_type: "school_payment",
      reference_id: paymentId,
      lines: [
        { gl_account_id: receiptGl, debit: amount, credit: 0, line_description: "Fee receipt", dimensions: dims },
        { gl_account_id: acc.revenue, debit: 0, credit: amount, line_description: "Fee income (cash)", dimensions: dims },
      ],
      created_by: createdBy,
      organizationId,
    });
  }
  if (!acc.receivable) {
    return {
      ok: false,
      error: "Missing receivable GL for school fee allocation (accrual). Configure journal settings.",
    };
  }
  return createJournalEntry({
    entry_date: date,
    description: "School fee receipt (accrual — settle receivable)",
    reference_type: "school_payment",
    reference_id: paymentId,
    lines: [
      { gl_account_id: receiptGl, debit: amount, credit: 0, line_description: "Fee receipt", dimensions: dims },
      { gl_account_id: acc.receivable, debit: 0, credit: amount, line_description: "Student fees receivable", dimensions: dims },
    ],
    created_by: createdBy,
    organizationId,
  });
}

/** Capitalize period manufacturing costs to finished goods: Dr FG / Cr WIP (or production clearing). */
export async function createJournalForManufacturingCostingEntry(
  entryId: string,
  totalCost: number,
  productName: string,
  period: string,
  entryDate: string,
  createdBy: string | null,
  organizationId: string,
  productionCosts?: { consumablesCost?: number; scrapCost?: number }
): Promise<JournalPostResult> {
  const amt = Math.round(totalCost * 100) / 100;
  if (amt <= 0) return { ok: false, error: "Manufacturing journal skipped: total cost is zero." };
  const removed = await deleteJournalEntryByReference("manufacturing_costing", entryId);
  if (!removed.ok) return removed;
  const s = await resolveJournalAccountSettings(organizationId);
  const fg = s.manufacturing_finished_goods_id;
  const wip = s.manufacturing_wip_id;
  const consumablesCost = Math.min(amt, Math.max(0, Math.round(Number(productionCosts?.consumablesCost || 0) * 100) / 100));
  const scrapCost = Math.min(
    amt - consumablesCost,
    Math.max(0, Math.round(Number(productionCosts?.scrapCost || 0) * 100) / 100)
  );
  const finishedGoodsCost = Math.max(0, Math.round((amt - consumablesCost - scrapCost) * 100) / 100);
  if (!fg || !wip) {
    return {
      ok: false,
      error:
        "Set Manufacturing — finished goods and WIP / production clearing GL accounts under Admin → Journal account settings.",
    };
  }
  if (consumablesCost > 0 && !s.manufacturing_consumables_expense_id) {
    return {
      ok: false,
      error: "Set the Manufacturing — consumables expense GL account under Admin → Journal account settings.",
    };
  }
  if (scrapCost > 0 && !s.manufacturing_scrap_inventory_id) {
    return {
      ok: false,
      error: "Set the Manufacturing — scrap metal inventory GL account under Admin → Journal account settings.",
    };
  }
  const date = toBusinessDateString(entryDate);
  const label = (productName || "Product").trim() || "Product";
  const lines = [
    ...(finishedGoodsCost > 0
      ? [{ gl_account_id: fg, debit: finishedGoodsCost, credit: 0, line_description: `${label} — finished goods` }]
      : []),
    ...(consumablesCost > 0
      ? [{
          gl_account_id: s.manufacturing_consumables_expense_id!,
          debit: consumablesCost,
          credit: 0,
          line_description: `${label} — production consumables`,
        }]
      : []),
    ...(scrapCost > 0
      ? [{
          gl_account_id: s.manufacturing_scrap_inventory_id!,
          debit: scrapCost,
          credit: 0,
          line_description: `${label} — scrap metal inventory`,
        }]
      : []),
    {
      gl_account_id: wip,
      debit: 0,
      credit: amt,
      line_description: `${label} — WIP / production clearing`,
    },
  ];
  return createJournalEntry({
    entry_date: date,
    description: `Manufacturing costing: ${label} (${period})`,
    reference_type: "manufacturing_costing",
    reference_id: entryId,
    lines,
    created_by: createdBy,
    organizationId,
  });
}

export type PosPaymentMethod = PaymentMethodCode;

export type PosDeptBucket = "bar" | "kitchen" | "room";

export type PosCogsByDept = Partial<Record<PosDeptBucket, number>>;
export type PosDepartmentAmountLine = {
  departmentId: string | null;
  departmentName: string | null;
  amount: number;
};

/** Map department display name to Bar / Kitchen / Room for POS COGS routing. */
export function mapDepartmentNameToPosBucket(deptName: string | null | undefined): PosDeptBucket {
  const n = (deptName || "").toLowerCase();
  if (n.includes("bar")) return "bar";
  if (n.includes("room")) return "room";
  if (n.includes("kitchen") || n.includes("food") || n.includes("restaurant")) return "kitchen";
  return "kitchen";
}

/** Sum extended cost (qty × unit cost) by department bucket for POS COGS / inventory lines. */
export function sumPosCogsByDept(
  lines: Array<{ quantity: number; unitCost: number; departmentId: string | null }>,
  departmentNameById: Map<string, string>
): PosCogsByDept {
  const out: PosCogsByDept = {};
  for (const L of lines) {
    const amt = roundMoney(L.quantity * L.unitCost);
    if (amt <= 0) continue;
    const name = L.departmentId ? departmentNameById.get(L.departmentId) ?? "" : "";
    const bucket = mapDepartmentNameToPosBucket(name);
    out[bucket] = roundMoney((out[bucket] ?? 0) + amt);
  }
  return out;
}

/** Sum line selling totals by bar / kitchen / room bucket (for split revenue credits). */
export function sumPosSalesByDept(
  lines: Array<{ lineTotal: number; departmentId: string | null }>,
  departmentNameById: Map<string, string>
): PosCogsByDept {
  const out: PosCogsByDept = {};
  for (const L of lines) {
    const amt = roundMoney(L.lineTotal);
    if (amt <= 0) continue;
    const name = L.departmentId ? departmentNameById.get(L.departmentId) ?? "" : "";
    const bucket = mapDepartmentNameToPosBucket(name);
    out[bucket] = roundMoney((out[bucket] ?? 0) + amt);
  }
  return out;
}

function resolvePosReceiptGlAccountId(
  acc: Awaited<ReturnType<typeof getDefaultGlAccounts>>,
  paymentMethod: PosPaymentMethod | undefined
): string | null {
  const pm = paymentMethod ?? "cash";
  if (pm === "cash") return acc.cash;
  if (pm === "mtn_mobile_money") return acc.posMtnMobileMoney ?? acc.cash;
  if (pm === "airtel_money") return acc.posAirtelMoney ?? acc.posMtnMobileMoney ?? acc.cash;
  if (pm === "card" || pm === "bank_transfer") return acc.posBank ?? acc.cash;
  return acc.cash;
}

function resolvePosRevenueGlForBucket(
  bucket: PosDeptBucket,
  acc: Awaited<ReturnType<typeof getDefaultGlAccounts>>,
  o: PosJournalGlOverrides | undefined
): string | null {
  if (bucket === "bar") return (o?.revenueBarGlAccountId?.trim() || acc.posRevenueBar) ?? null;
  if (bucket === "kitchen") return (o?.revenueKitchenGlAccountId?.trim() || acc.posRevenueKitchen) ?? null;
  return (o?.revenueRoomGlAccountId?.trim() || acc.posRevenueRoom) ?? null;
}

async function loadPosDepartmentGlMap(organizationId: string | null | undefined) {
  if (!organizationId) return new Map<string, { sales: string | null; purchases: string | null; stock: string | null }>();
  try {
    const [{ data, error }, { data: glRows, error: glError }] = await Promise.all([
      (supabase as any)
        .from("journal_gl_department_settings")
        .select("department_id,sales_gl_account_id,purchases_gl_account_id,stock_gl_account_id")
        .eq("organization_id", organizationId),
      supabase.from("gl_accounts").select("id,account_code,is_active"),
    ]);
    if (error) throw error;
    if (glError) throw glError;
    const glList = (glRows || []) as Array<{ id: string; account_code: string; is_active: boolean | null }>;
    const codeById = new Map(glList.map((account) => [account.id, account.account_code]));
    const activeByCode = new Map(
      glList.filter((account) => account.is_active !== false).map((account) => [account.account_code, account.id])
    );
    const activeAccountId = (configuredId: string | null | undefined) => {
      if (!configuredId) return null;
      const code = codeById.get(configuredId);
      return (code ? activeByCode.get(code) : null) ?? configuredId;
    };
    const map = new Map<string, { sales: string | null; purchases: string | null; stock: string | null }>();
    ((data || []) as any[]).forEach((row) => {
      map.set(String(row.department_id), {
        sales: activeAccountId(row.sales_gl_account_id),
        purchases: activeAccountId(row.purchases_gl_account_id),
        stock: activeAccountId(row.stock_gl_account_id),
      });
    });
    return map;
  } catch {
    return new Map<string, { sales: string | null; purchases: string | null; stock: string | null }>();
  }
}

/** Optional per-transaction GL overrides for Hotel POS (when journal settings are not used). */
export type PosJournalGlOverrides = {
  receiptGlAccountId?: string | null;
  /** When set, forces a single revenue line (ignores per-department split). */
  revenueGlAccountId?: string | null;
  revenueBarGlAccountId?: string | null;
  revenueKitchenGlAccountId?: string | null;
  revenueRoomGlAccountId?: string | null;
  vatGlAccountId?: string | null;
  posCogsBar?: string | null;
  posInvBar?: string | null;
  posCogsKitchen?: string | null;
  posInvKitchen?: string | null;
  posCogsRoom?: string | null;
  posInvRoom?: string | null;
};

export async function createJournalForPosOrder(
  orderId: string,
  total: number,
  description: string,
  orderDate: string,
  createdBy: string | null,
  options?: {
    paymentMethod?: PosPaymentMethod;
    /** Split receipt debits, for example when a sale is paid into different bank or wallet GL accounts. */
    receiptLines?: Array<{ glAccountId: string; amount: number; description?: string }>;
    /** Completed payments received against this order. The unpaid balance posts to receivables. */
    amountPaid?: number;
    /** Amount payable after agent commission. Defaults to gross `total`. */
    settlementTotal?: number;
    agentCommissionAmount?: number;
    commissionExpenseGlAccountId?: string | null;
    cogsByDept?: PosCogsByDept;
    cogsByDepartment?: PosDepartmentAmountLine[];
    /** Line totals by bar/kitchen/room; splits net revenue across department sales GLs (unless a single revenue override is set). */
    salesByDept?: PosCogsByDept;
    salesByDepartment?: PosDepartmentAmountLine[];
    /** If > 0 and a VAT GL is configured, `total` is VAT-inclusive: net revenue + output VAT credit. */
    vatRatePercent?: number;
    glOverrides?: PosJournalGlOverrides;
    organizationId?: string | null;
  }
): Promise<JournalPostResult> {
  const acc = await getDefaultGlAccounts();
  const deptGlMap = await loadPosDepartmentGlMap(options?.organizationId);
  const o = options?.glOverrides;
  const date = toBusinessDateString(orderDate);
  const receiptGl = o?.receiptGlAccountId?.trim()
    ? o.receiptGlAccountId
    : resolvePosReceiptGlAccountId(acc, options?.paymentMethod);
  const settlementTotal = roundMoney(Math.max(0, Number(options?.settlementTotal ?? total)));
  const amountPaid = Math.min(roundMoney(Math.max(0, Number(options?.amountPaid ?? settlementTotal))), settlementTotal);
  const receiptLines = (options?.receiptLines || [])
    .map((line) => ({ ...line, amount: roundMoney(line.amount) }))
    .filter((line) => line.glAccountId && line.amount > 0.001);
  const receivableAmount = roundMoney(settlementTotal - amountPaid);
  const agentCommissionAmount = roundMoney(Math.max(0, Number(options?.agentCommissionAmount ?? 0)));
  const commissionExpenseId = options?.commissionExpenseGlAccountId?.trim() || acc.commissionExpense;
  const revenueId = o?.revenueGlAccountId?.trim() ? o.revenueGlAccountId : acc.revenue;
  const salesByDept = options?.salesByDept;
  const salesByDepartment = (options?.salesByDepartment || [])
    .map((line) => ({ ...line, amount: roundMoney(line.amount) }))
    .filter((line) => line.amount > 0.001);
  const deptBuckets: PosDeptBucket[] = ["bar", "kitchen", "room"];
  const totalSales = deptBuckets.reduce((s, k) => s + roundMoney(salesByDept?.[k] ?? 0), 0);
  const totalSalesByDepartment = salesByDepartment.reduce((s, line) => s + line.amount, 0);
  const useRevenueSplit =
    !o?.revenueGlAccountId?.trim() && ((!!salesByDepartment.length && totalSalesByDepartment > 0.001) || (!!salesByDept && totalSales > 0.001));

  if (amountPaid > 0.001 && receiptLines.length === 0 && !receiptGl) {
    return {
      ok: false,
      error:
        "Missing GL account for receipt (cash/bank/mobile money). Pick under Hotel POS (this sale), or configure Accounting → Journal account settings.",
    };
  }
  if (receivableAmount > 0.001 && !acc.receivable) {
    return {
      ok: false,
      error: "Missing receivable GL account for the unpaid POS balance. Configure Accounting > Journal account settings.",
    };
  }
  if (agentCommissionAmount > 0.001 && !commissionExpenseId) {
    return { ok: false, error: "Missing Commission Expense GL account for the POS agent commission." };
  }

  if (useRevenueSplit) {
    if (salesByDepartment.length > 0) {
      for (const line of salesByDepartment) {
        if (!line.departmentId) continue;
        const depGl = deptGlMap.get(line.departmentId);
        if (!(depGl?.sales || revenueId)) {
          return {
            ok: false,
            error:
              "Missing sales revenue GL for one of the departments in this cart. Set the department row under Admin → Journal account settings.",
          };
        }
      }
    } else {
      for (const k of deptBuckets) {
        if (roundMoney(salesByDept![k] ?? 0) <= 0) continue;
        if (!resolvePosRevenueGlForBucket(k, acc, o)) {
          return {
            ok: false,
            error:
              "Missing sales revenue GL for a department in this cart. Set Bar / Kitchen / Room sales under Admin → Journal account settings (table), or pick revenue on the POS.",
          };
        }
      }
    }
  } else if (!revenueId) {
    return {
      ok: false,
      error:
        "Missing GL accounts for receipt (cash/bank/mobile money) or revenue. Pick accounts under Hotel POS (this sale), or configure Accounting → Journal account settings.",
    };
  }

  const rate = Number(options?.vatRatePercent);
  const gross = roundMoney(total);
  let revenueCredit = gross;
  let vatOut = 0;
  const vatGlResolved = o?.vatGlAccountId?.trim() ? o.vatGlAccountId : acc.vat;
  if (Number.isFinite(rate) && rate > 0 && vatGlResolved) {
    revenueCredit = roundMoney(gross / (1 + rate / 100));
    vatOut = roundMoney(gross - revenueCredit);
  }

  const lines: JournalLine[] = [];
  if (receiptLines.length > 0) {
    for (const line of receiptLines) {
      lines.push({
        gl_account_id: line.glAccountId,
        debit: line.amount,
        credit: 0,
        line_description: line.description || `${description} - received`,
      });
    }
  } else if (amountPaid > 0.001 && receiptGl) {
    lines.push({ gl_account_id: receiptGl, debit: amountPaid, credit: 0, line_description: `${description} - received` });
  }
  if (receivableAmount > 0.001 && acc.receivable) {
    lines.push({ gl_account_id: acc.receivable, debit: receivableAmount, credit: 0, line_description: `${description} - outstanding` });
  }
  if (agentCommissionAmount > 0.001 && commissionExpenseId) {
    lines.push({ gl_account_id: commissionExpenseId, debit: agentCommissionAmount, credit: 0, line_description: "Agent / bodaboda commission" });
  }

  if (useRevenueSplit && salesByDepartment.length > 0) {
    let remaining = revenueCredit;
    for (let i = 0; i < salesByDepartment.length; i++) {
      const line = salesByDepartment[i];
      const frac = line.amount / totalSalesByDepartment;
      const lineNet = i === salesByDepartment.length - 1 ? roundMoney(remaining) : roundMoney(revenueCredit * frac);
      remaining = roundMoney(remaining - lineNet);
      const deptGl = line.departmentId ? deptGlMap.get(line.departmentId) : null;
      const rid = deptGl?.sales ?? revenueId;
      if (lineNet > 0.001 && rid) {
        lines.push({
          gl_account_id: rid,
          debit: 0,
          credit: lineNet,
          line_description: `${line.departmentName || "Department"} sales`,
          dimensions: line.departmentId ? { department_id: line.departmentId } : null,
        });
      }
    }
  } else if (useRevenueSplit && salesByDept) {
    let remaining = revenueCredit;
    const activeBuckets = deptBuckets.filter((k) => roundMoney(salesByDept[k] ?? 0) > 0);
    for (let i = 0; i < activeBuckets.length; i++) {
      const b = activeBuckets[i];
      const share = roundMoney(salesByDept[b] ?? 0);
      const frac = share / totalSales;
      const bucketNet = i === activeBuckets.length - 1 ? roundMoney(remaining) : roundMoney(revenueCredit * frac);
      remaining = roundMoney(remaining - bucketNet);
      const rid = resolvePosRevenueGlForBucket(b, acc, o);
      if (bucketNet > 0.001 && rid) {
        lines.push({ gl_account_id: rid, debit: 0, credit: bucketNet, line_description: b === "bar" ? "Bar sales" : b === "kitchen" ? "Kitchen sales" : "Room sales" });
      }
    }
  } else {
    lines.push({
      gl_account_id: revenueId!,
      debit: 0,
      credit: revenueCredit,
      line_description: "Sales",
    });
  }
  if (vatOut > 0.001 && vatGlResolved) {
    lines.push({
      gl_account_id: vatGlResolved,
      debit: 0,
      credit: vatOut,
      line_description: "VAT (output)",
    });
  }

  const cogs = options?.cogsByDept;
  const cogsByDepartment = (options?.cogsByDepartment || [])
    .map((line) => ({ ...line, amount: roundMoney(line.amount) }))
    .filter((line) => line.amount > 0.001);
  if (cogsByDepartment.length > 0) {
    for (const line of cogsByDepartment) {
      const deptGl = line.departmentId ? deptGlMap.get(line.departmentId) : null;
      const cogsId = deptGl?.purchases ?? null;
      const stockId = deptGl?.stock ?? null;
      if (!cogsId || !stockId) continue;
      lines.push({
        gl_account_id: cogsId,
        debit: line.amount,
        credit: 0,
        line_description: `${line.departmentName || "Department"} purchases (COGS)`,
        dimensions: line.departmentId ? { department_id: line.departmentId } : null,
      });
      lines.push({
        gl_account_id: stockId,
        debit: 0,
        credit: line.amount,
        line_description: `${line.departmentName || "Department"} stock`,
        dimensions: line.departmentId ? { department_id: line.departmentId } : null,
      });
    }
  } else if (cogs) {
    const buckets: Array<{
      key: PosDeptBucket;
      amt: number;
      cogsId: string | null;
      invId: string | null;
      label: string;
    }> = [
      {
        key: "bar",
        amt: roundMoney(cogs.bar ?? 0),
        cogsId: o?.posCogsBar?.trim() ? o.posCogsBar : acc.posCogsBar,
        invId: o?.posInvBar?.trim() ? o.posInvBar : acc.posInvBar,
        label: "Bar",
      },
      {
        key: "kitchen",
        amt: roundMoney(cogs.kitchen ?? 0),
        cogsId: o?.posCogsKitchen?.trim() ? o.posCogsKitchen : acc.posCogsKitchen,
        invId: o?.posInvKitchen?.trim() ? o.posInvKitchen : acc.posInvKitchen,
        label: "Kitchen",
      },
      {
        key: "room",
        amt: roundMoney(cogs.room ?? 0),
        cogsId: o?.posCogsRoom?.trim() ? o.posCogsRoom : acc.posCogsRoom,
        invId: o?.posInvRoom?.trim() ? o.posInvRoom : acc.posInvRoom,
        label: "Room",
      },
    ];
    for (const b of buckets) {
      if (b.amt <= 0) continue;
      if (!b.cogsId || !b.invId) continue;
      lines.push({
        gl_account_id: b.cogsId,
        debit: b.amt,
        credit: 0,
        line_description: `${b.label} purchases (COGS)`,
      });
      lines.push({
        gl_account_id: b.invId,
        debit: 0,
        credit: b.amt,
        line_description: `${b.label} stock`,
      });
    }
  }

  return createJournalEntry({
    entry_date: date,
    description: `POS: ${description}`,
    reference_type: "pos",
    reference_id: orderId,
    lines,
    created_by: createdBy,
  });
}

/** Rebuild a Hotel POS journal after an order, status, or payment changes. */
export async function syncHotelPosOrderJournal(
  orderId: string,
  createdBy: string | null,
  organizationId?: string | null
): Promise<JournalPostResult | { ok: true; journalId: null }> {
  const { data: order, error: orderError } = await (supabase as any)
    .from("kitchen_orders")
    .select("id,order_status,created_at")
    .eq("id", orderId)
    .maybeSingle();
  if (orderError) return { ok: false, error: orderError.message };
  if (!order) return { ok: false, error: "Hotel POS order was not found." };

  const [
    { data: rawOrderItems, error: orderItemsError },
    { data: payments, error: paymentError },
    { data: rawStockMovements, error: stockMovementsError },
  ] = await Promise.all([
    (supabase as any).from("kitchen_order_items").select("quantity,product_id").eq("order_id", orderId),
    (supabase as any)
      .from("payments")
      .select("amount,payment_method,payment_status,paid_at")
      .eq("payment_source", "pos_hotel")
      .eq("transaction_id", orderId)
      .order("paid_at", { ascending: false }),
    (supabase as any)
      .from("product_stock_movements")
      .select("product_id,quantity_out,unit_cost,note")
      .eq("source_type", "sale")
      .eq("source_id", orderId),
  ]);
  if (orderItemsError) return { ok: false, error: orderItemsError.message };
  if (paymentError) return { ok: false, error: paymentError.message };
  if (stockMovementsError) return { ok: false, error: stockMovementsError.message };

  const voidStatus = ["cancelled", "canceled", "reversed", "void", "voided"].includes(
    String(order.order_status || "").toLowerCase()
  );
  const completedPayments = ((payments || []) as any[]).filter(
    (payment) => String(payment.payment_status || "").toLowerCase() === "completed"
  );
  if (voidStatus) {
    const remove = await deleteJournalEntryByReference("pos", orderId);
    return remove.ok ? { ok: true, journalId: null } : remove;
  }

  const orderProductIds = ((rawOrderItems || []) as any[]).map((item) => String(item.product_id || "")).filter(Boolean);
  const movementProductIds = ((rawStockMovements || []) as any[])
    .map((movement) => String(movement.product_id || ""))
    .filter(Boolean);
  const productIds = Array.from(new Set([...orderProductIds, ...movementProductIds]));
  const productById = new Map<string, any>();
  if (productIds.length > 0) {
    const { data: products, error: productsError } = await (supabase as any)
      .from("products")
      .select("id,name,sales_price,cost_price,department_id")
      .in("id", productIds);
    if (productsError) return { ok: false, error: productsError.message };
    ((products || []) as any[]).forEach((product) => productById.set(String(product.id), product));
  }
  const missingProductIds = Array.from(new Set(orderProductIds)).filter((productId) => !productById.has(productId));
  if (missingProductIds.length > 0) {
    return {
      ok: false,
      error: `Order has ${missingProductIds.length} item(s) whose product record no longer exists.`,
    };
  }

  const items = ((rawOrderItems || []) as any[])
    .map((item) => {
      const product = productById.get(String(item.product_id || ""));
      return {
        quantity: Number(item.quantity || 0),
        name: String(product?.name || "Item"),
        salesPrice: Number(product?.sales_price || 0),
        costPrice: Number(product?.cost_price || 0),
        departmentId: product?.department_id ? String(product.department_id) : null,
      };
    })
    .filter((item) => item.quantity > 0);
  const itemTotal = roundMoney(items.reduce((sum, item) => sum + item.quantity * item.salesPrice, 0));
  const total = itemTotal;
  const amountPaid = roundMoney(completedPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
  if (total <= 0) return { ok: false, error: "Hotel POS order total is zero; journal was removed but not reposted." };

  const departmentIds = Array.from(new Set(items.map((item) => item.departmentId).filter((id): id is string => !!id)));
  const departmentNameById = new Map<string, string>();
  if (departmentIds.length > 0) {
    const { data: departments, error: departmentError } = await (supabase as any)
      .from("departments")
      .select("id,name")
      .in("id", departmentIds);
    if (departmentError) return { ok: false, error: departmentError.message };
    ((departments || []) as any[]).forEach((department) =>
      departmentNameById.set(String(department.id), String(department.name || "Department"))
    );
  }
  const departmentGlMap = await loadPosDepartmentGlMap(organizationId);
  const missingSalesGlDepartments = departmentIds.filter((departmentId) => !departmentGlMap.get(departmentId)?.sales);
  if (missingSalesGlDepartments.length > 0) {
    const labels = missingSalesGlDepartments.map(
      (departmentId) => departmentNameById.get(departmentId) || departmentId
    );
    return {
      ok: false,
      error:
        `Missing sales GL mapping for department(s): ${labels.join(", ")}. ` +
        "Set each department's Sales revenue under Admin > Journal account settings, then rerun POS repair.",
    };
  }
  if (items.some((item) => !item.departmentId)) {
    return {
      ok: false,
      error:
        "One or more products on this order have no department. Assign their department, then rerun POS repair.",
    };
  }
  const salesGlOwners = new Map<string, string[]>();
  departmentIds.forEach((departmentId) => {
    const salesGl = departmentGlMap.get(departmentId)?.sales;
    if (!salesGl) return;
    salesGlOwners.set(salesGl, [...(salesGlOwners.get(salesGl) || []), departmentId]);
  });
  const sharedSalesGlDepartments = Array.from(salesGlOwners.values()).find((owners) => owners.length > 1);
  if (sharedSalesGlDepartments) {
    return {
      ok: false,
      error:
        `Departments ${sharedSalesGlDepartments
          .map((departmentId) => departmentNameById.get(departmentId) || departmentId)
          .join(", ")} share the same Sales revenue GL account. ` +
        "Map each department to its own sales account before rerunning POS repair.",
    };
  }

  const groupAmounts = (kind: "sales" | "cogs"): PosDepartmentAmountLine[] => {
    const grouped = new Map<string, PosDepartmentAmountLine>();
    items.forEach((item) => {
      const key = item.departmentId ?? "__unassigned__";
      const previous = grouped.get(key);
      grouped.set(key, {
        departmentId: item.departmentId,
        departmentName: item.departmentId ? departmentNameById.get(item.departmentId) ?? null : null,
        amount: roundMoney((previous?.amount ?? 0) + item.quantity * (kind === "sales" ? item.salesPrice : item.costPrice)),
      });
    });
    return Array.from(grouped.values());
  };
  const groupSaleTimeCogs = (): PosDepartmentAmountLine[] | null => {
    const stockMovements = ((rawStockMovements || []) as any[]).filter(
      (movement) => Number(movement.quantity_out || 0) > 0
    );
    if (stockMovements.length === 0) return null;

    const soleDepartmentId = departmentIds.length === 1 ? departmentIds[0] : null;
    const departmentByItemName = new Map(
      items.map((item) => [item.name.trim().toLowerCase(), item.departmentId] as const)
    );
    const grouped = new Map<string, PosDepartmentAmountLine>();
    for (const movement of stockMovements) {
      const quantityOut = Number(movement.quantity_out || 0);
      if (movement.unit_cost == null) return null;
      const unitCost = Number(movement.unit_cost);
      if (!Number.isFinite(unitCost) || unitCost < 0) return null;

      const note = String(movement.note || "").trim();
      const recipeItemName = /^recipe for\s+(.+)$/i.exec(note)?.[1]?.trim().toLowerCase() ?? null;
      const movementProduct = productById.get(String(movement.product_id || ""));
      const departmentId =
        (recipeItemName ? departmentByItemName.get(recipeItemName) : null) ??
        (movementProduct?.department_id ? String(movementProduct.department_id) : null) ??
        soleDepartmentId;
      if (!departmentId) return null;

      const previous = grouped.get(departmentId);
      grouped.set(departmentId, {
        departmentId,
        departmentName: departmentNameById.get(departmentId) ?? null,
        amount: roundMoney((previous?.amount ?? 0) + quantityOut * unitCost),
      });
    }
    return Array.from(grouped.values()).filter((line) => line.amount > 0.001);
  };
  const salesByDepartment = groupAmounts("sales");
  // Historical sale movements preserve the unit cost used when stock was consumed.
  // Fall back to product cost only for legacy orders without a complete movement-cost snapshot.
  const cogsByDepartment = groupSaleTimeCogs() ?? groupAmounts("cogs");

  const remove = await deleteJournalEntryByReference("pos", orderId);
  if (!remove.ok) return remove;
  const posted = await createJournalForPosOrder(
    orderId,
    total,
    items.map((item) => `${item.quantity}x ${item.name}`).join(", "),
    String(order.created_at),
    createdBy,
    {
      paymentMethod: completedPayments[0]?.payment_method as PosPaymentMethod | undefined,
      amountPaid,
      salesByDept: sumPosSalesByDept(
        items.map((item) => ({ lineTotal: item.quantity * item.salesPrice, departmentId: item.departmentId })),
        departmentNameById
      ),
      salesByDepartment,
      cogsByDepartment,
      organizationId,
    }
  );
  if (!posted.ok) return posted;

  const expectedSalesByDepartment = new Map(
    salesByDepartment.map((line) => [
      `${String(line.departmentName || "Department").trim().toLowerCase()} sales`,
      roundMoney(line.amount),
    ])
  );
  const expectedCogsByDepartment = new Map(
    cogsByDepartment.map((line) => [
      `${String(line.departmentName || "Department").trim().toLowerCase()} purchases (cogs)`,
      roundMoney(line.amount),
    ])
  );
  const { data: postedLines, error: postedLinesError } = await (supabase as any)
    .from("journal_entry_lines")
    .select("debit,credit,line_description")
    .eq("journal_entry_id", posted.journalId);
  if (postedLinesError) return { ok: false, error: postedLinesError.message };
  const actualSalesByDepartment = new Map<string, number>();
  const actualCogsByDepartment = new Map<string, number>();
  ((postedLines || []) as any[]).forEach((line) => {
    const departmentLabel = String(line.line_description || "").trim().toLowerCase();
    if (departmentLabel.endsWith(" sales")) {
      actualSalesByDepartment.set(
        departmentLabel,
        roundMoney((actualSalesByDepartment.get(departmentLabel) || 0) + Number(line.credit || 0))
      );
    }
    if (departmentLabel.endsWith(" purchases (cogs)")) {
      actualCogsByDepartment.set(
        departmentLabel,
        roundMoney((actualCogsByDepartment.get(departmentLabel) || 0) + Number(line.debit || 0))
      );
    }
  });
  const salesMismatch = Array.from(expectedSalesByDepartment.entries()).find(
    ([departmentLabel, expected]) => Math.abs(expected - (actualSalesByDepartment.get(departmentLabel) || 0)) > 0.01
  );
  const cogsMismatch = Array.from(expectedCogsByDepartment.entries()).find(
    ([departmentLabel, expected]) => Math.abs(expected - (actualCogsByDepartment.get(departmentLabel) || 0)) > 0.01
  );
  if (salesMismatch || cogsMismatch) {
    const retired = await deleteJournalEntryByReference("pos", orderId);
    if (!retired.ok) return retired;
    return {
      ok: false,
      error:
        salesMismatch
          ? `Journal revenue did not match source POS sales for ${salesMismatch[0]}. The mismatched journal was retired.`
          : `Journal COGS did not match sale-time stock costs for ${cogsMismatch![0]}. The mismatched journal was retired.`,
    };
  }
  return posted;
}

export interface PosJournalRepairResult {
  repaired: number;
  removed: number;
  errors: string[];
}

export interface InventoryLedgerReconciliationResult {
  journalId: string | null;
  barTarget: number;
  barBefore: number;
  barAdjustment: number;
  kitchenTarget: number;
  kitchenBefore: number;
  kitchenAdjustment: number;
}

/** Align Bar and Kitchen inventory GL balances to the Stock Summary weighted-average valuation. */
export async function reconcileInventoryLedgersToStockSummary(
  requestedOrganizationId?: string | null
): Promise<InventoryLedgerReconciliationResult> {
  const organizationId = requestedOrganizationId ?? (await resolveOrganizationId());
  if (!organizationId) throw new Error("Sign in under an organization before reconciling inventory ledgers.");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) throw new Error("Sign in before reconciling inventory ledgers.");

  const configuredAccounts = await getDefaultGlAccounts();
  const { data: activeGlRows, error: activeGlError } = await filterByOrganizationId(
    supabase.from("gl_accounts").select("id,account_code,is_active").eq("is_active", true),
    organizationId,
    false
  );
  if (activeGlError) throw activeGlError;
  const activeByCode = new Map(
    ((activeGlRows || []) as Array<{ id: string; account_code: string }>).map((account) => [account.account_code, account.id])
  );
  const accounts = {
    posInvBar: activeByCode.get("1051") ?? configuredAccounts.posInvBar,
    posCogsBar: activeByCode.get("5001") ?? configuredAccounts.posCogsBar,
    posInvKitchen: activeByCode.get("1061") ?? configuredAccounts.posInvKitchen,
    posCogsKitchen: activeByCode.get("5002") ?? configuredAccounts.posCogsKitchen,
  };
  if (!accounts.posInvBar || !accounts.posCogsBar || !accounts.posInvKitchen || !accounts.posCogsKitchen) {
    throw new Error("Configure Bar and Kitchen inventory and COGS accounts before reconciling inventory ledgers.");
  }

  const [productsRes, movementsRes, departmentsRes, linesRes] = await Promise.all([
    filterByOrganizationId(
      supabase.from("products").select("id,department_id,cost_price,track_inventory"),
      organizationId,
      false
    ),
    filterByOrganizationId(
      supabase.from("product_stock_movements").select("product_id,quantity_in,quantity_out,unit_cost"),
      organizationId,
      false
    ),
    filterByOrganizationId(supabase.from("departments").select("id,name"), organizationId, false),
    filterJournalLinesByOrganizationId(
      supabase
        .from("journal_entry_lines")
        .select("gl_account_id,debit,credit,journal_entries!inner(is_posted,is_deleted)")
        .in("gl_account_id", [accounts.posInvBar, accounts.posInvKitchen])
        .eq("journal_entries.is_posted", true)
        .eq("journal_entries.is_deleted", false),
      organizationId,
      false
    ),
  ]);
  if (productsRes.error) throw productsRes.error;
  if (movementsRes.error) throw movementsRes.error;
  if (departmentsRes.error) throw departmentsRes.error;
  if (linesRes.error) throw linesRes.error;

  const departmentNameById = new Map(
    ((departmentsRes.data || []) as Array<{ id: string; name: string }>).map((department) => [
      department.id,
      department.name.trim().toLowerCase(),
    ])
  );
  const products = ((productsRes.data || []) as Array<{
    id: string;
    department_id: string | null;
    cost_price: number | null;
    track_inventory: boolean | null;
  }>).filter((product) => (product.track_inventory ?? true) !== false);
  const productById = new Map(products.map((product) => [product.id, product]));
  const summaryByProduct = new Map<
    string,
    { qtyIn: number; qtyOut: number; weightedCost: number; weightedQty: number }
  >(products.map((product) => [product.id, { qtyIn: 0, qtyOut: 0, weightedCost: 0, weightedQty: 0 }]));

  ((movementsRes.data || []) as Array<{
    product_id: string;
    quantity_in: number | null;
    quantity_out: number | null;
    unit_cost: number | null;
  }>).forEach((movement) => {
    const product = productById.get(movement.product_id);
    const summary = summaryByProduct.get(movement.product_id);
    if (!product || !summary) return;
    const { inQty, outQty } = effectiveStockMovementInOut(movement);
    const unitCost = Number(movement.unit_cost ?? product.cost_price ?? 0) || 0;
    summary.qtyIn += inQty;
    summary.qtyOut += outQty;
    if (inQty > 0 && unitCost > 0) {
      summary.weightedCost += inQty * unitCost;
      summary.weightedQty += inQty;
    }
  });

  let barTarget = 0;
  let kitchenTarget = 0;
  products.forEach((product) => {
    const summary = summaryByProduct.get(product.id);
    if (!summary) return;
    const unitCost =
      summary.weightedQty > 0 ? summary.weightedCost / summary.weightedQty : Number(product.cost_price || 0);
    const stockValue = (summary.qtyIn - summary.qtyOut) * unitCost;
    const department = product.department_id ? departmentNameById.get(product.department_id) : null;
    if (department === "bar") barTarget += stockValue;
    if (department === "kitchen") kitchenTarget += stockValue;
  });
  barTarget = roundMoney(barTarget);
  kitchenTarget = roundMoney(kitchenTarget);

  let barBefore = 0;
  let kitchenBefore = 0;
  ((linesRes.data || []) as Array<{ gl_account_id: string; debit: number; credit: number }>).forEach((line) => {
    const impact = Number(line.debit || 0) - Number(line.credit || 0);
    if (line.gl_account_id === accounts.posInvBar) barBefore += impact;
    if (line.gl_account_id === accounts.posInvKitchen) kitchenBefore += impact;
  });
  barBefore = roundMoney(barBefore);
  kitchenBefore = roundMoney(kitchenBefore);
  const barAdjustment = roundMoney(barTarget - barBefore);
  const kitchenAdjustment = roundMoney(kitchenTarget - kitchenBefore);

  const lines: JournalLine[] = [];
  const addAdjustment = (amount: number, inventoryId: string, cogsId: string, label: string) => {
    if (Math.abs(amount) <= 0.01) return;
    lines.push({
      gl_account_id: inventoryId,
      debit: amount > 0 ? amount : 0,
      credit: amount < 0 ? -amount : 0,
      line_description: `${label} stock summary reconciliation`,
    });
    lines.push({
      gl_account_id: cogsId,
      debit: amount < 0 ? -amount : 0,
      credit: amount > 0 ? amount : 0,
      line_description: `${label} inventory valuation adjustment`,
    });
  };
  addAdjustment(barAdjustment, accounts.posInvBar, accounts.posCogsBar, "Bar");
  addAdjustment(kitchenAdjustment, accounts.posInvKitchen, accounts.posCogsKitchen, "Kitchen");

  if (lines.length === 0) {
    return { journalId: null, barTarget, barBefore, barAdjustment, kitchenTarget, kitchenBefore, kitchenAdjustment };
  }
  const posted = await createJournalEntry({
    entry_date: businessTodayISO(),
    description: "Inventory ledger reconciliation to Stock Summary weighted average",
    reference_type: "manual",
    lines,
    created_by: user.id,
    organizationId,
  });
  if (!posted.ok) throw new Error(posted.error);
  return {
    journalId: posted.journalId,
    barTarget,
    barBefore,
    barAdjustment,
    kitchenTarget,
    kitchenBefore,
    kitchenAdjustment,
  };
}

/** Re-sync every historical Hotel POS order for the signed-in organization. */
export async function repairHotelPosOrderJournals(options?: {
  organizationId?: string | null;
  onProgress?: (processed: number, total: number) => void;
  journalOrOrder?: string | null;
  departmentId?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
}): Promise<PosJournalRepairResult> {
  const organizationId = options?.organizationId ?? (await resolveOrganizationId());
  if (!organizationId) throw new Error("Sign in under an organization before repairing POS journals.");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) throw new Error("Sign in before repairing POS journals.");

  let specificOrderId: string | null = null;
  const journalOrOrder = options?.journalOrOrder?.trim() || "";
  if (journalOrOrder) {
    const uuidLike = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(journalOrOrder);
    if (uuidLike) {
      specificOrderId = journalOrOrder;
    } else {
      const normalizedTransactionId = journalOrOrder.replace(/^pos\s*#?/i, "").trim();
      const { data: journal, error: journalError } = await filterByOrganizationId(
        supabase
          .from("journal_entries")
          .select("reference_id")
          .eq("reference_type", "pos")
          .ilike("transaction_id", normalizedTransactionId)
          .maybeSingle(),
        organizationId,
        false
      );
      if (journalError) throw journalError;
      specificOrderId = (journal as { reference_id?: string | null } | null)?.reference_id ?? null;
      if (!specificOrderId) throw new Error(`Could not find POS journal ${journalOrOrder}.`);
    }
  }

  const fromRange = options?.fromDate ? businessDayRangeForDateString(options.fromDate) : null;
  const toRange = options?.toDate ? businessDayRangeForDateString(options.toDate) : null;
  if (options?.fromDate && !fromRange) throw new Error("Invalid POS repair start date.");
  if (options?.toDate && !toRange) throw new Error("Invalid POS repair end date.");

  let orderIds: string[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    let query = (supabase as any)
      .from("kitchen_orders")
      .select("id")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true });
    if (specificOrderId) query = query.eq("id", specificOrderId);
    if (fromRange) query = query.gte("created_at", fromRange.from.toISOString());
    if (toRange) query = query.lt("created_at", toRange.to.toISOString());
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw error;
    orderIds.push(...((data || []) as Array<{ id: string }>).map((row) => row.id));
    if (!data || data.length < pageSize) break;
  }

  if (options?.departmentId && orderIds.length > 0) {
    const { data: departmentProducts, error: productsError } = await (supabase as any)
      .from("products")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("department_id", options.departmentId);
    if (productsError) throw productsError;
    const productIds = ((departmentProducts || []) as Array<{ id: string }>).map((row) => row.id);
    if (productIds.length === 0) {
      orderIds = [];
    } else {
      const matchingOrderIds = new Set<string>();
      for (let offset = 0; offset < orderIds.length; offset += 200) {
        const { data: items, error: itemsError } = await (supabase as any)
          .from("kitchen_order_items")
          .select("order_id,product_id")
          .in("order_id", orderIds.slice(offset, offset + 200))
          .in("product_id", productIds);
        if (itemsError) throw itemsError;
        ((items || []) as Array<{ order_id: string }>).forEach((item) => matchingOrderIds.add(item.order_id));
      }
      orderIds = orderIds.filter((orderId) => matchingOrderIds.has(orderId));
    }
  }

  const result: PosJournalRepairResult = { repaired: 0, removed: 0, errors: [] };
  options?.onProgress?.(0, orderIds.length);
  for (let index = 0; index < orderIds.length; index++) {
    const orderId = orderIds[index];
    const sync = await syncHotelPosOrderJournal(orderId, user.id, organizationId);
    if (sync.ok) {
      if (sync.journalId) result.repaired += 1;
      else result.removed += 1;
    } else {
      result.errors.push(`POS ${orderId}: ${sync.error}`);
    }
    options?.onProgress?.(index + 1, orderIds.length);
  }
  return result;
}

export async function createJournalForBillToRoom(
  billingId: string,
  amount: number,
  description: string,
  chargedAt: string,
  createdBy: string | null,
  glOverrides?: RoomChargeGlOverrides
): Promise<JournalPostResult> {
  return createJournalForRoomCharge(billingId, amount, description, chargedAt, createdBy, glOverrides);
}

export async function createJournalForBill(
  billId: string,
  amount: number,
  description: string | null,
  billDate: string,
  createdBy: string | null
): Promise<JournalPostResult> {
  const acc = await getDefaultGlAccounts();
  const date = toBusinessDateString(billDate);
  const debitGl = acc.purchasesInventory;
  if (!debitGl) {
    return {
      ok: false,
      error:
        "Missing GL account for GRN/Bills inventory (shop stock). Set “GRN/Bills — Shop stock / inventory” or a POS inventory account under Admin → Journal account settings, or add an inventory/stock asset to your chart.",
    };
  }
  if (!acc.payable) {
    return {
      ok: false,
      error: "Missing GL account for accounts payable. Configure Accounting → Journal account settings.",
    };
  }
  return createJournalEntry({
    entry_date: date,
    description: description ? `GRN/Bill: ${description}` : "GRN/Bill",
    reference_type: "bill",
    reference_id: billId,
    lines: [
      {
        gl_account_id: debitGl,
        debit: amount,
        credit: 0,
        line_description: description || "Inventory / shop stock (GRN)",
      },
      { gl_account_id: acc.payable, debit: 0, credit: amount, line_description: "Accounts payable" },
    ],
    created_by: createdBy,
  });
}

/** Asset GL for vendor prepayment / excess (prepaid, advance, deposit, or unearned in name). */
async function findVendorAdvanceAssetAccountId(): Promise<string | null> {
  const orgId = await resolveOrganizationId();
  const { data } = await filterByOrganizationId(
    supabase
      .from("gl_accounts")
      .select("*")
      .order("account_code"),
    orgId,
    false
  );
  const list = normalizeGlAccountRows((data || []) as unknown[])
    .filter((a) => a.is_active && a.account_type === "asset")
    .map((a) => ({ id: a.id, account_name: a.account_name }))
    .filter(
    (a) => !(a.account_name || "").toLowerCase().includes("cash")
  );
  const byName = (sub: string) =>
    list.find((a) => (a.account_name || "").toLowerCase().includes(sub))?.id ?? null;
  return (
    byName("prepaid") ??
    byName("advance") ??
    byName("deposit") ??
    byName("unearned") ??
    list[0]?.id ??
    null
  );
}

export type VendorPaymentJournalAllocation = {
  /** Portion reducing accounts payable */
  payableAmount: number;
  /** Remainder posted to unearned income (liability) */
  unearnedExcessAmount: number;
  /** Cash, bank, wallet, or other asset account funding the payment. */
  sourceFundsGlAccountId?: string | null;
};

export async function createJournalForVendorPayment(
  paymentId: string,
  amount: number,
  paymentDate: string,
  createdBy: string | null,
  allocation?: VendorPaymentJournalAllocation
): Promise<JournalPostResult> {
  const acc = await getDefaultGlAccounts();
  const date = toBusinessDateString(paymentDate);
  const sourceFundsGlAccountId = allocation?.sourceFundsGlAccountId || acc.cash;
  if (!sourceFundsGlAccountId) {
    return {
      ok: false,
      error: "Missing GL account for cash. Configure Accounting → Journal account settings.",
    };
  }

  if (!allocation) {
    if (!acc.payable) {
      return {
        ok: false,
        error: "Missing GL accounts for payable or cash. Configure Accounting → Journal account settings.",
      };
    }
    return createJournalEntry({
      entry_date: date,
      description: "Vendor payment",
      reference_type: "vendor_payment",
      reference_id: paymentId,
      lines: [
        { gl_account_id: acc.payable, debit: amount, credit: 0, line_description: "Payable" },
        { gl_account_id: sourceFundsGlAccountId, debit: 0, credit: amount, line_description: "Source of funds" },
      ],
      created_by: createdBy,
    });
  }

  const { payableAmount, unearnedExcessAmount } = allocation;
  if (Math.abs(payableAmount + unearnedExcessAmount - amount) > 0.02) {
    return { ok: false, error: "Payable and unearned portions must sum to the payment amount." };
  }
  if (payableAmount < 0 || unearnedExcessAmount < 0) {
    return { ok: false, error: "Allocation amounts cannot be negative." };
  }

  const lines: JournalLine[] = [];
  if (payableAmount > 0) {
    if (!acc.payable) {
      return {
        ok: false,
        error: "Missing GL account for accounts payable. Configure Accounting → Journal account settings.",
      };
    }
    lines.push({
      gl_account_id: acc.payable,
      debit: payableAmount,
      credit: 0,
      line_description: "Payable",
    });
  }
  if (unearnedExcessAmount > 0) {
    const advanceId = await findVendorAdvanceAssetAccountId();
    if (!advanceId) {
      return {
        ok: false,
        error:
          "No asset GL account found for vendor advance/unearned (add a prepaid or advance asset, or any asset account).",
      };
    }
    lines.push({
      gl_account_id: advanceId,
      debit: unearnedExcessAmount,
      credit: 0,
      line_description: "Unearned income (vendor excess)",
    });
  }
  lines.push({ gl_account_id: sourceFundsGlAccountId, debit: 0, credit: amount, line_description: "Source of funds" });

  if (lines.length < 2) {
    return { ok: false, error: "Invalid payment allocation." };
  }

  return createJournalEntry({
    entry_date: date,
    description: "Vendor payment",
    reference_type: "vendor_payment",
    reference_id: paymentId,
    lines,
    created_by: createdBy,
  });
}

/** Vendor credit memo: reduces payables and expense (purchase return / credit). */
export async function createJournalForVendorCredit(
  creditId: string,
  amount: number,
  creditDate: string,
  description: string | null,
  createdBy: string | null
): Promise<JournalPostResult> {
  const acc = await getDefaultGlAccounts();
  const date = toBusinessDateString(creditDate);
  if (!acc.payable || !acc.expense) {
    return {
      ok: false,
      error: "Missing GL accounts for payable or expense. Configure Accounting → Journal account settings.",
    };
  }
  return createJournalEntry({
    entry_date: date,
    description: description ? `Vendor credit: ${description}` : "Vendor credit",
    reference_type: "vendor_credit",
    reference_id: creditId,
    lines: [
      { gl_account_id: acc.payable, debit: amount, credit: 0, line_description: description || "Reduce payables" },
      { gl_account_id: acc.expense, debit: 0, credit: amount, line_description: "Purchase credit" },
    ],
    created_by: createdBy,
  });
}

export async function createJournalForExpense(
  expenseId: string,
  amount: number,
  description: string | null,
  expenseDate: string,
  createdBy: string | null
): Promise<JournalPostResult> {
  const acc = await getDefaultGlAccounts();
  const date = toBusinessDateString(expenseDate);
  if (!acc.expense || !acc.cash) {
    return {
      ok: false,
      error: "Missing GL accounts for expense or cash. Configure Accounting → Journal account settings.",
    };
  }
  return createJournalEntry({
    entry_date: date,
    description: description ? `Expense: ${description}` : "Expense",
    reference_type: "expense",
    reference_id: expenseId,
    lines: [
      { gl_account_id: acc.expense, debit: amount, credit: 0, line_description: description || "Expense" },
      { gl_account_id: acc.cash, debit: 0, credit: amount, line_description: "Cash" },
    ],
    created_by: createdBy,
  });
}

/** Default GL for bank fees (e.g. account 6400) for the organization. */
export async function resolveBankChargesGlAccountId(_organizationId: string | null): Promise<string | null> {
  const orgId = _organizationId ?? (await resolveOrganizationId());
  const { data } = await filterByOrganizationId(
    supabase.from("gl_accounts").select("*").order("account_code"),
    orgId,
    false
  );
  const rows = normalizeGlAccountRows((data || []) as unknown[]).filter((row) => row.is_active);
  const byCode = rows.find((row) => row.account_code === "6400");
  if (byCode) return byCode.id;
  const byName = rows.find((row) => /bank.*charge/i.test(row.account_name || ""));
  if (byName) return byName.id;

  const acc = await getDefaultGlAccounts();
  return acc.expense;
}

export type ExpenseJournalLineInput = {
  expense_gl_account_id: string;
  source_cash_gl_account_id: string;
  amount: number;
  bank_charges: number;
  vat_amount: number;
  vat_gl_account_id?: string | null;
  bank_charges_gl_account_id?: string | null;
  comment?: string | null;
  quantity?: number;
};

/**
 * Cash-paid expense with multiple lines: debits expense / VAT / bank fees, credits selected cash (source of funds) accounts.
 */
export async function createJournalForExpenseWithLines(
  expenseId: string,
  expenseDate: string,
  lineRows: ExpenseJournalLineInput[],
  createdBy: string | null
): Promise<JournalPostResult> {
  const orgId = await resolveOrganizationId();
  const bankChargesDefault = await resolveBankChargesGlAccountId(orgId);

  const journalLines: JournalLine[] = [];
  const creditByGl = new Map<string, number>();

  for (const r of lineRows) {
    const amt = roundMoney(Number(r.amount) || 0);
    const vat = roundMoney(Number(r.vat_amount) || 0);
    const bc = roundMoney(Number(r.bank_charges) || 0);
    const totalOut = roundMoney(amt + vat + bc);
    if (totalOut <= 0) continue;

    const desc = (r.comment || "").trim() || "Expense";
    if (amt > 0) {
      journalLines.push({
        gl_account_id: r.expense_gl_account_id,
        debit: amt,
        credit: 0,
        line_description: desc,
      });
    }
    if (vat > 0) {
      const vatGl = r.vat_gl_account_id || r.expense_gl_account_id;
      journalLines.push({
        gl_account_id: vatGl,
        debit: vat,
        credit: 0,
        line_description: "VAT",
      });
    }
    if (bc > 0) {
      const bcGl = r.bank_charges_gl_account_id || bankChargesDefault;
      if (!bcGl) {
        return {
          ok: false,
          error:
            "Missing GL for bank charges. Add account 6400 (Bank Charges) to your chart or choose Bank charges GL on the row.",
        };
      }
      journalLines.push({
        gl_account_id: bcGl,
        debit: bc,
        credit: 0,
        line_description: "Bank charges",
      });
    }

    creditByGl.set(r.source_cash_gl_account_id, roundMoney((creditByGl.get(r.source_cash_gl_account_id) || 0) + totalOut));
  }

  for (const [glId, cr] of creditByGl) {
    if (cr > 0) {
      journalLines.push({
        gl_account_id: glId,
        debit: 0,
        credit: cr,
        line_description: "Source of funds",
      });
    }
  }

  if (journalLines.length < 2) {
    return {
      ok: false,
      error: "Add at least one line with amount, VAT, or bank charges, and select expense and source-of-funds accounts.",
    };
  }

  const totalDr = journalLines.reduce((s, l) => s + l.debit, 0);
  const totalCr = journalLines.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalDr - totalCr) > 0.02) {
    return { ok: false, error: "Journal does not balance. Check amounts." };
  }

  const date = toBusinessDateString(expenseDate);
  return createJournalEntry({
    entry_date: date,
    description: "Expense",
    reference_type: "expense",
    reference_id: expenseId,
    lines: journalLines,
    created_by: createdBy,
  });
}

export function getReferenceTypeLabel(ref: string | null): string {
  const labels: Record<string, string> = {
    room_charge: "Room charge",
    payment: "Payment",
    pos: "POS",
    bill: "GRN/Bill",
    vendor_payment: "Vendor payment",
    vendor_credit: "Vendor credit",
    expense: "Expense",
    manual: "Manual",
    fixed_asset_capitalization: "Fixed asset — capitalization",
    fixed_asset_depreciation_run: "Fixed asset — depreciation",
    fixed_asset_disposal: "Fixed asset — disposal",
    fixed_asset_revaluation: "Fixed asset — revaluation",
    fixed_asset_impairment: "Fixed asset — impairment",
  };
  return (ref && labels[ref]) || ref || "—";
}

export interface BackfillResult {
  room_charge: number;
  payment: number;
  pos: number;
  bill: number;
  vendor_payment: number;
  vendor_credit: number;
  expense: number;
  manufacturing_costing: number;
  errors: string[];
}

export interface BackfillProgress {
  phase:
    | "loading-existing"
    | "room_charge"
    | "payment"
    | "bill"
    | "vendor_payment"
    | "vendor_credit"
    | "expense"
    | "pos"
    | "manufacturing_costing"
    | "done";
  phaseLabel: string;
  processed: number;
  total: number;
  percent: number;
}

/**
 * Create journal entries for all existing transactions that don't already have one.
 * Call this once to backfill the journal_entries table from billing, payments, POS, bills, vendor_payments, expenses.
 */
async function loadJournalReferenceIdsByType(requestedOrganizationId?: string | null): Promise<Record<string, Set<string>>> {
  const orgId = requestedOrganizationId ?? (await resolveOrganizationId());
  const refIds: Record<string, Set<string>> = {};
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await filterByOrganizationId(
      supabase
        .from("journal_entries")
        .select("reference_type, reference_id")
        .not("reference_id", "is", null)
        .eq("is_deleted", false)
        .range(from, from + pageSize - 1),
      orgId,
      false
    );
    if (error) throw error;
    if (!data?.length) break;
    for (const row of data) {
      const type = (row as { reference_type: string | null }).reference_type;
      const id = (row as { reference_id: string | null }).reference_id;
      if (type && id) {
        if (!refIds[type]) refIds[type] = new Set<string>();
        refIds[type].add(id);
      }
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return refIds;
}

export async function backfillJournalEntries(options?: {
  dryRun?: boolean;
  businessType?: string | null;
  repairExisting?: boolean;
  organizationId?: string | null;
  onProgress?: (progress: BackfillProgress) => void;
}): Promise<BackfillResult> {
  const dryRun = !!options?.dryRun;
  const isManufacturing = String(options?.businessType || "").toLowerCase() === "manufacturing";
  const reportProgress = (phase: BackfillProgress["phase"], phaseLabel: string, processed: number, total: number) => {
    const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 100;
    options?.onProgress?.({ phase, phaseLabel, processed, total, percent });
  };
  const result: BackfillResult = {
    room_charge: 0,
    payment: 0,
    pos: 0,
    bill: 0,
    vendor_payment: 0,
    vendor_credit: 0,
    expense: 0,
    manufacturing_costing: 0,
    errors: [],
  };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  /** Backfill must attribute journals to the signed-in staff row so organization_id + RLS match. */
  const backfillCreatedBy = user?.id ?? null;

  if (!backfillCreatedBy) {
    result.errors.push(
      "Sign in as staff before running backfill so journal entries use your organization."
    );
    return result;
  }
  const organizationId = options?.organizationId ?? (await resolveOrganizationId());
  if (!organizationId) {
    result.errors.push("Sign in under an organization before repairing organization journals.");
    return result;
  }

  reportProgress("loading-existing", "Loading existing journal references", 0, 1);
  const refIds = await loadJournalReferenceIdsByType(organizationId);
  reportProgress("loading-existing", "Loaded existing references", 1, 1);

  const has = (type: string, id: string) => refIds[type]?.has(id) ?? false;
  const add = (type: string, id: string) => {
    if (!refIds[type]) refIds[type] = new Set();
    refIds[type].add(id);
  };

  // Room charges (billing)
  const { data: billings, error: billingsError } = isManufacturing
    ? { data: [], error: null }
    : await filterByOrganizationId(
        supabase.from("billing").select("id, amount, description, charged_at, created_by"),
        organizationId,
        false
      );
  if (billingsError) result.errors.push(`Room billing could not be loaded: ${billingsError.message}`);
  const billingsList = billings || [];
  reportProgress("room_charge", "Backfilling room charges", 0, billingsList.length);
  let billingsProcessed = 0;
  for (const b of billingsList) {
    const row = b as { id: string; amount: number; description: string; charged_at: string; created_by: string | null };
    if (has("room_charge", row.id)) continue;
    const jr = dryRun
      ? ({ ok: true, journalId: `dryrun-${row.id}` } as const)
      : await createJournalForRoomCharge(
          row.id,
          Number(row.amount),
          row.description || "Room charge",
          row.charged_at || new Date().toISOString(),
          backfillCreatedBy,
          undefined,
          organizationId
        );
    if (jr.ok) {
      add("room_charge", row.id);
      result.room_charge++;
    } else {
      result.errors.push(`Billing ${row.id}: ${jr.error}`);
    }
    billingsProcessed += 1;
    reportProgress("room_charge", "Backfilling room charges", billingsProcessed, billingsList.length);
  }

  // Payments
  const { data: payments } = await filterByOrganizationId(
    supabase
      .from("payments")
      .select(
        "id,amount,paid_at,processed_by,payment_status,transaction_id,stay_id,property_customer_id,retail_customer_id,invoice_allocations,payment_source"
      ),
    organizationId,
    false
  );
  const paymentsList = ((payments || []) as Array<
    Parameters<typeof isPosCashReceipt>[0] & {
      amount: number;
      paid_at: string;
      processed_by: string | null;
    }
  >).filter((payment) => !isPosCashReceipt(payment));
  reportProgress("payment", "Backfilling payments", 0, paymentsList.length);
  let paymentsProcessed = 0;
  for (const p of paymentsList) {
    const row = p as { id: string; amount: number; paid_at: string; processed_by: string | null };
    if (has("payment", row.id)) continue;
    const jr = dryRun
      ? ({ ok: true, journalId: `dryrun-${row.id}` } as const)
      : await createJournalForPayment(
          row.id,
          Number(row.amount),
          row.paid_at || new Date().toISOString(),
          backfillCreatedBy
        );
    if (jr.ok) {
      add("payment", row.id);
      result.payment++;
    } else {
      result.errors.push(`Payment ${row.id}: ${jr.error}`);
    }
    paymentsProcessed += 1;
    reportProgress("payment", "Backfilling payments", paymentsProcessed, paymentsList.length);
  }

  // Bills
  const { data: bills } = await filterByOrganizationId(
    supabase.from("bills").select("id, amount, description, bill_date, status"),
    organizationId,
    false
  );
  const billsList = bills || [];
  reportProgress("bill", "Backfilling bills", 0, billsList.length);
  let billsProcessed = 0;
  for (const b of billsList) {
    const row = b as { id: string; amount: number; description: string | null; bill_date: string | null; status?: string | null };
    const status = String(row.status || "").toLowerCase();
    if (["pending", "pending_approval", "rejected", "cancelled"].includes(status)) {
      billsProcessed += 1;
      reportProgress("bill", "Backfilling bills", billsProcessed, billsList.length);
      continue;
    }
    if (has("bill", row.id)) continue;
    const jr = dryRun
      ? ({ ok: true, journalId: `dryrun-${row.id}` } as const)
      : await createJournalForBill(
          row.id,
          Number(row.amount),
          row.description,
          row.bill_date || businessTodayISO(),
          backfillCreatedBy
        );
    if (jr.ok) {
      add("bill", row.id);
      result.bill++;
    } else {
      result.errors.push(`Bill ${row.id}: ${jr.error}`);
    }
    billsProcessed += 1;
    reportProgress("bill", "Backfilling bills", billsProcessed, billsList.length);
  }

  // Vendor payments
  const { data: vendorPayments } = await filterByOrganizationId(
    supabase.from("vendor_payments").select("id, amount, payment_date"),
    organizationId,
    false
  );
  const vendorPaymentsList = vendorPayments || [];
  reportProgress("vendor_payment", "Backfilling vendor payments", 0, vendorPaymentsList.length);
  let vendorPaymentsProcessed = 0;
  for (const v of vendorPaymentsList) {
    const row = v as { id: string; amount: number; payment_date: string };
    if (has("vendor_payment", row.id)) continue;
    const jr = dryRun
      ? ({ ok: true, journalId: `dryrun-${row.id}` } as const)
      : await createJournalForVendorPayment(
          row.id,
          Number(row.amount),
          row.payment_date || businessTodayISO(),
          backfillCreatedBy
        );
    if (jr.ok) {
      add("vendor_payment", row.id);
      result.vendor_payment++;
    } else {
      result.errors.push(`Vendor payment ${row.id}: ${jr.error}`);
    }
    vendorPaymentsProcessed += 1;
    reportProgress("vendor_payment", "Backfilling vendor payments", vendorPaymentsProcessed, vendorPaymentsList.length);
  }

  // Vendor credits
  const { data: vendorCredits } = await filterByOrganizationId(
    supabase.from("vendor_credits").select("id, amount, reason, credit_date"),
    organizationId,
    false
  );
  const vendorCreditsList = vendorCredits || [];
  reportProgress("vendor_credit", "Backfilling vendor credits", 0, vendorCreditsList.length);
  let vendorCreditsProcessed = 0;
  for (const c of vendorCreditsList) {
    const row = c as { id: string; amount: number; reason: string | null; credit_date: string | null };
    if (has("vendor_credit", row.id)) continue;
    const jr = dryRun
      ? ({ ok: true, journalId: `dryrun-${row.id}` } as const)
      : await createJournalForVendorCredit(
          row.id,
          Number(row.amount),
          row.credit_date || businessTodayISO(),
          row.reason,
          backfillCreatedBy
        );
    if (jr.ok) {
      add("vendor_credit", row.id);
      result.vendor_credit++;
    } else {
      result.errors.push(`Vendor credit ${row.id}: ${jr.error}`);
    }
    vendorCreditsProcessed += 1;
    reportProgress("vendor_credit", "Backfilling vendor credits", vendorCreditsProcessed, vendorCreditsList.length);
  }

  // Expenses — use line-item GL accounts when expense_lines exist (same as Expenses page); else legacy single-line post.
  const { data: expenses } = await filterByOrganizationId(
    supabase.from("expenses").select("id, amount, description, expense_date"),
    organizationId,
    false
  );
  const expenseList = (expenses || []) as {
    id: string;
    amount: number;
    description: string | null;
    expense_date: string | null;
  }[];
  const expenseIds = expenseList.map((e) => e.id);
  let linesByExpenseId = new Map<
    string,
    Array<{
      expense_gl_account_id: string;
      source_cash_gl_account_id: string;
      amount: number;
      bank_charges: number;
      vat_amount: number;
      vat_gl_account_id: string | null;
      bank_charges_gl_account_id: string | null;
      comment: string | null;
      sort_order: number;
    }>
  >();
  if (expenseIds.length > 0) {
    const { data: allLines, error: linesErr } = await supabase
      .from("expense_lines")
      .select(
        "expense_id, expense_gl_account_id, source_cash_gl_account_id, amount, bank_charges, vat_amount, vat_gl_account_id, bank_charges_gl_account_id, comment, sort_order"
      )
      .in("expense_id", expenseIds)
      .order("sort_order", { ascending: true });
    if (!linesErr && allLines?.length) {
      linesByExpenseId = new Map();
      for (const line of allLines as Array<{
        expense_id: string;
        expense_gl_account_id: string;
        source_cash_gl_account_id: string;
        amount: number;
        bank_charges: number;
        vat_amount: number;
        vat_gl_account_id: string | null;
        bank_charges_gl_account_id: string | null;
        comment: string | null;
        sort_order: number;
      }>) {
        const arr = linesByExpenseId.get(line.expense_id) ?? [];
        arr.push(line);
        linesByExpenseId.set(line.expense_id, arr);
      }
      for (const arr of linesByExpenseId.values()) {
        arr.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      }
    }
  }

  reportProgress("expense", "Backfilling expenses", 0, expenseList.length);
  let expensesProcessed = 0;
  for (const row of expenseList) {
    if (has("expense", row.id)) continue;
    const lineRows = linesByExpenseId.get(row.id);
    let jr: JournalPostResult;
    if (dryRun) {
      jr = { ok: true, journalId: `dryrun-${row.id}` };
    } else if (lineRows && lineRows.length > 0) {
      const journalRows: ExpenseJournalLineInput[] = lineRows.map((l) => ({
        expense_gl_account_id: l.expense_gl_account_id,
        source_cash_gl_account_id: l.source_cash_gl_account_id,
        amount: Number(l.amount) || 0,
        bank_charges: Number(l.bank_charges) || 0,
        vat_amount: Number(l.vat_amount) || 0,
        vat_gl_account_id: l.vat_gl_account_id,
        bank_charges_gl_account_id: l.bank_charges_gl_account_id,
        comment: l.comment,
      }));
      jr = await createJournalForExpenseWithLines(
        row.id,
        row.expense_date || businessTodayISO(),
        journalRows,
        backfillCreatedBy
      );
    } else {
      jr = await createJournalForExpense(
        row.id,
        Number(row.amount),
        row.description,
        row.expense_date || businessTodayISO(),
        backfillCreatedBy
      );
    }
    if (jr.ok) {
      add("expense", row.id);
      result.expense++;
    } else {
      result.errors.push(`Expense ${row.id}: ${jr.error}`);
    }
    expensesProcessed += 1;
    reportProgress("expense", "Backfilling expenses", expensesProcessed, expenseList.length);
  }

  // POS (kitchen_orders): get orders with items and product prices to compute total
  const { data: orders, error: ordersError } = isManufacturing
    ? { data: [], error: null }
    : await filterByOrganizationId(
        supabase.from("kitchen_orders").select("id, created_at"),
        organizationId,
        false
      );
  if (ordersError) result.errors.push(`Hotel POS orders could not be loaded: ${ordersError.message}`);
  const orderIds = (orders || []).map((o: { id: string }) => o.id);
  if (orderIds.length > 0) {
    reportProgress("pos", "Backfilling POS orders", 0, (orders || []).length);
    const { data: items } = await supabase
      .from("kitchen_order_items")
      .select("order_id, quantity, product_id")
      .in("order_id", orderIds);
    const productIds = [...new Set((items || []).map((i: { product_id: string }) => i.product_id).filter(Boolean))];
    const { data: products } = await supabase.from("products").select("id, sales_price").in("id", productIds);
    const priceMap = Object.fromEntries(
      ((products || []) as { id: string; sales_price: number | null }[]).map((p) => [p.id, Number(p.sales_price) || 0])
    );
    const totalByOrder: Record<string, number> = {};
    (items || []).forEach((i: { order_id: string; quantity: number; product_id: string }) => {
      if (!totalByOrder[i.order_id]) totalByOrder[i.order_id] = 0;
      totalByOrder[i.order_id] += (i.quantity || 0) * (priceMap[i.product_id] ?? 0);
    });
    let posProcessed = 0;
    for (const o of orders || []) {
      const row = o as { id: string; created_at: string };
      if (has("pos", row.id)) continue;
      const total = totalByOrder[row.id] ?? 0;
      if (total <= 0) continue;
      const jr = dryRun
        ? ({ ok: true, journalId: `dryrun-${row.id}` } as const)
        : await createJournalForPosOrder(
            row.id,
            total,
            "POS order (backfill)",
            toBusinessDateString(row.created_at || new Date().toISOString()),
            backfillCreatedBy
          );
      if (jr.ok) {
        add("pos", row.id);
        result.pos++;
      } else {
        result.errors.push(`POS ${row.id}: ${jr.error}`);
      }
      posProcessed += 1;
      reportProgress("pos", "Backfilling POS orders", posProcessed, (orders || []).length);
    }
  }

  // Manufacturing costing entries
  const { data: costingEntries, error: costingError } = await filterByOrganizationId(
    supabase
      .from("manufacturing_costing_entries")
      .select("id,product_name,period,material_cost,labor_cost,overhead_cost"),
    organizationId,
    false
  );
  if (costingError) {
    result.errors.push(`Manufacturing costing entries could not be loaded: ${costingError.message}`);
  }
  const costingList = (costingEntries || []) as Array<{
    id: string;
    product_name: string | null;
    period: string;
    material_cost: number | null;
    labor_cost: number | null;
    overhead_cost: number | null;
  }>;
  if (isManufacturing && !costingError && costingList.length === 0) {
    result.errors.push(
      "No manufacturing costing entries were found for this organization. Record production with a BOM or add costing entries before running journal backfill."
    );
  }
  reportProgress("manufacturing_costing", "Backfilling manufacturing costing", 0, costingList.length);
  let costingProcessed = 0;
  for (const row of costingList) {
    if (options?.repairExisting || !has("manufacturing_costing", row.id)) {
      const totalCost =
        Number(row.material_cost || 0) + Number(row.labor_cost || 0) + Number(row.overhead_cost || 0);
      if (totalCost > 0) {
        const jr = dryRun
          ? ({ ok: true, journalId: `dryrun-${row.id}` } as const)
          : await createJournalForManufacturingCostingEntry(
              row.id,
              totalCost,
              row.product_name || "Product",
              row.period,
              `${row.period}-01`,
              backfillCreatedBy,
              organizationId
            );
        if (jr.ok) {
          add("manufacturing_costing", row.id);
          result.manufacturing_costing++;
        } else {
          result.errors.push(`Manufacturing costing ${row.id}: ${jr.error}`);
        }
      }
    }
    costingProcessed += 1;
    reportProgress(
      "manufacturing_costing",
      "Backfilling manufacturing costing",
      costingProcessed,
      costingList.length
    );
  }

  reportProgress("done", dryRun ? "Dry run complete" : "Backfill complete", 1, 1);
  return result;
}
