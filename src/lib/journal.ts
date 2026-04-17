/**
 * Journal entry helpers: create journal entries from transactions (room charges, POS, purchases, etc.)
 * and resolve default GL accounts for double-entry posting.
 */

import { supabase } from "./supabase";
import { filterByOrganizationId } from "./supabaseOrgFilter";
import { resolveJournalAccountSettings } from "./journalAccountSettings";
import {
  fetchFixedAssetCategoryGlMap,
  mergeFixedAssetGlSlots,
  type FixedAssetCategoryGlRow,
} from "./fixedAssetCategoryGlSettings";
import type { PaymentMethodCode } from "./paymentMethod";
import { businessTodayISO, toBusinessDateString } from "./timezone";

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
  | "sacco_teller";

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
      .select("id, account_type, category, account_name, account_code")
      .eq("is_active", true)
      .order("account_code"),
    orgId,
    false
  );

  const list = (accounts || []) as {
    id: string;
    account_type: string;
    category: string | null;
    account_name: string;
    account_code: string;
  }[];
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
  const { entry_date, description, reference_type, reference_id, lines, created_by } = params;
  if (!lines.length) return { ok: false, error: "No journal lines" };
  const totalDr = lines.reduce((s, l) => s + l.debit, 0);
  const totalCr = lines.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalDr - totalCr) > 0.01) {
    return { ok: false, error: "Debits must equal credits" };
  }

  const { data, error } = await supabase.rpc("create_journal_entry_atomic", {
    p_entry_date: toBusinessDateString(entry_date),
    p_description: description,
    p_reference_type: reference_type,
    p_reference_id: reference_id ?? null,
    p_created_by: created_by ?? null,
    p_lines: lines.map((l) => {
      const row: Record<string, unknown> = {
        gl_account_id: l.gl_account_id,
        debit: l.debit,
        credit: l.credit,
        line_description: l.line_description ?? null,
      };
      if (l.dimensions != null && typeof l.dimensions === "object" && Object.keys(l.dimensions).length > 0) {
        row.dimensions = l.dimensions;
      }
      return row;
    }),
  });

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Journal entry was not created" };
  return { ok: true, journalId: data };
}

/** Removes the journal header (lines cascade). Use before reposting when editing a transaction. */
export async function deleteJournalEntryByReference(
  referenceType: JournalReferenceType,
  referenceId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const orgId = await resolveOrganizationId();
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
  glOverrides?: RoomChargeGlOverrides
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
  });
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
    const { data, error } = await (supabase as any)
      .from("journal_gl_department_settings")
      .select("department_id,sales_gl_account_id,purchases_gl_account_id,stock_gl_account_id")
      .eq("organization_id", organizationId);
    if (error) throw error;
    const map = new Map<string, { sales: string | null; purchases: string | null; stock: string | null }>();
    ((data || []) as any[]).forEach((row) => {
      map.set(String(row.department_id), {
        sales: row.sales_gl_account_id ?? null,
        purchases: row.purchases_gl_account_id ?? null,
        stock: row.stock_gl_account_id ?? null,
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

  if (!receiptGl) {
    return {
      ok: false,
      error:
        "Missing GL account for receipt (cash/bank/mobile money). Pick under Hotel POS (this sale), or configure Accounting → Journal account settings.",
    };
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

  const lines: JournalLine[] = [{ gl_account_id: receiptGl, debit: gross, credit: 0, line_description: description }];

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
      });
      lines.push({
        gl_account_id: stockId,
        debit: 0,
        credit: line.amount,
        line_description: `${line.departmentName || "Department"} stock`,
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
      .select("id, account_name, account_type")
      .eq("is_active", true)
      .eq("account_type", "asset")
      .order("account_code"),
    orgId,
    false
  );
  const list = ((data || []) as { id: string; account_name: string }[]).filter(
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
  if (!acc.cash) {
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
        { gl_account_id: acc.cash, debit: 0, credit: amount, line_description: "Cash" },
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
  lines.push({ gl_account_id: acc.cash, debit: 0, credit: amount, line_description: "Cash" });

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
  const { data: byCode } = await filterByOrganizationId(
    supabase
      .from("gl_accounts")
      .select("id")
      .eq("is_active", true)
      .eq("account_code", "6400")
      .maybeSingle(),
    orgId,
    false
  );
  if (byCode) return (byCode as { id: string }).id;

  const { data: byName } = await filterByOrganizationId(
    supabase
      .from("gl_accounts")
      .select("id")
      .eq("is_active", true)
      .ilike("account_name", "%bank%charge%")
      .limit(1)
      .maybeSingle(),
    orgId,
    false
  );
  if (byName) return (byName as { id: string }).id;

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
async function loadJournalReferenceIdsByType(): Promise<Record<string, Set<string>>> {
  const orgId = await resolveOrganizationId();
  const refIds: Record<string, Set<string>> = {};
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await filterByOrganizationId(
      supabase
        .from("journal_entries")
        .select("reference_type, reference_id")
        .not("reference_id", "is", null)
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
  onProgress?: (progress: BackfillProgress) => void;
}): Promise<BackfillResult> {
  const dryRun = !!options?.dryRun;
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

  reportProgress("loading-existing", "Loading existing journal references", 0, 1);
  const refIds = await loadJournalReferenceIdsByType();
  reportProgress("loading-existing", "Loaded existing references", 1, 1);

  const has = (type: string, id: string) => refIds[type]?.has(id) ?? false;
  const add = (type: string, id: string) => {
    if (!refIds[type]) refIds[type] = new Set();
    refIds[type].add(id);
  };

  // Room charges (billing)
  const { data: billings } = await supabase.from("billing").select("id, amount, description, charged_at, created_by");
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
          backfillCreatedBy
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
  const { data: payments } = await supabase.from("payments").select("id, amount, paid_at, processed_by");
  const paymentsList = payments || [];
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
  const { data: bills } = await supabase.from("bills").select("id, amount, description, bill_date");
  const billsList = bills || [];
  reportProgress("bill", "Backfilling bills", 0, billsList.length);
  let billsProcessed = 0;
  for (const b of billsList) {
    const row = b as { id: string; amount: number; description: string | null; bill_date: string | null };
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
  const { data: vendorPayments } = await supabase.from("vendor_payments").select("id, amount, payment_date");
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
  const { data: vendorCredits } = await supabase.from("vendor_credits").select("id, amount, reason, credit_date");
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
  const { data: expenses } = await supabase.from("expenses").select("id, amount, description, expense_date");
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
  const { data: orders } = await supabase.from("kitchen_orders").select("id, created_at");
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

  reportProgress("done", dryRun ? "Dry run complete" : "Backfill complete", 1, 1);
  return result;
}
