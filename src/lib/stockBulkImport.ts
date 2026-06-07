/**
 * Bulk stock adjustment import: parse CSV/Excel, validate, apply ledger movements.
 */
import { supabase } from "./supabase";
import { randomUuid } from "./randomUuid";
import { normalizeGlAccountRows } from "./glAccountNormalize";
import { filterByOrganizationId, filterStockMovementsByOrganizationId } from "./supabaseOrgFilter";
import { parseBulkImportFile } from "./saccoBulkImport";
import { effectiveStockMovementInOut } from "./stockMovementEffective";
import { businessDayRangeForDateString, businessTodayISO, toBusinessDateString } from "./timezone";

export { parseBulkImportFile };

export type StockBulkImportPreviewRow = {
  line: number;
  status: "ok" | "error" | "skip";
  summary: string;
  detail?: string;
};

export type StockAdjustmentPlan = {
  line: number;
  productId: string;
  productLabel: string;
  currentQty: number;
  delta: number;
  newQty: number;
  movementDate: string;
  reason: string;
  glAccountId: string | null;
};

type ProductMini = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  code: string | null;
  track_inventory: boolean | null;
};

type GlMini = { id: string; account_code: string; account_name: string };

type MovementMini = {
  product_id: string;
  quantity_in: number;
  quantity_out: number;
  movement_date: string;
  source_type: string | null;
  note: string | null;
};

async function fetchAllStockMovements(organizationId?: string | null): Promise<MovementMini[]> {
  const rows: MovementMini[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await filterStockMovementsByOrganizationId(
      supabase
        .from("product_stock_movements")
        .select("product_id, quantity_in, quantity_out, movement_date, source_type, note")
        .order("movement_date", { ascending: true })
        .range(from, from + pageSize - 1),
      organizationId
    );
    if (error) throw new Error(error.message);
    const page = (data || []) as Array<{
      product_id: unknown;
      quantity_in: unknown;
      quantity_out: unknown;
      movement_date: unknown;
      source_type: unknown;
      note: unknown;
    }>;
    rows.push(
      ...page.map((movement) => ({
        product_id: String(movement.product_id),
        quantity_in: Number(movement.quantity_in ?? 0),
        quantity_out: Number(movement.quantity_out ?? 0),
        movement_date: String(movement.movement_date ?? ""),
        source_type: movement.source_type ? String(movement.source_type) : null,
        note: movement.note ? String(movement.note) : null,
      }))
    );
    if (page.length < pageSize) break;
  }
  return rows;
}

export type StockBulkImportContext = {
  productsById: Map<string, ProductMini>;
  productsBySku: Map<string, ProductMini>;
  productsByBarcode: Map<string, ProductMini>;
  productsByCode: Map<string, ProductMini>;
  productsByName: Map<string, ProductMini[]>;
  allProducts: ProductMini[];
  productCount: number;
  /** On-hand totals from movements on or before closingDate (when set). */
  currentStock: Record<string, number>;
  closingDate: string | null;
  movements: MovementMini[];
  glByCode: Map<string, GlMini>;
};

function stockOnHandAsAt(movements: MovementMini[], productId: string, dateOnly: string): number {
  const endMs = endOfBusinessDateMs(dateOnly);
  let total = 0;
  for (const m of movements) {
    if (m.product_id !== productId) continue;
    const movementMs = new Date(m.movement_date).getTime();
    if (Number.isNaN(movementMs) || movementMs >= endMs) continue;
    const { inQty, outQty } = effectiveStockMovementInOut(m);
    total += inQty - outQty;
  }
  return total;
}

export function getStockBulkImportTemplate(closingDate?: string): string {
  const asAt = closingDate?.trim().slice(0, 10) || businessTodayISO();
  return `product_name,closing_stock,movement_date,reason
Amoxicillin tablets 250mg,120,${asAt},Stock count (closing) as at ${asAt}
Paracetamol 500mg,85,${asAt},Stock count (closing) as at ${asAt}`;
}

export function downloadStockBulkImportTemplate(closingDate?: string): void {
  const blob = new Blob([getStockBulkImportTemplate(closingDate)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "stock_adjustment_template.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

function asText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function cell(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const v = asText(row[key]);
    if (v) return v;
  }
  return "";
}

/** Short summary of skipped rows for the preview banner. */
export function summarizeStockImportPreview(preview: StockBulkImportPreviewRow[]): string | null {
  const skipped = preview.filter((r) => r.status === "skip");
  if (skipped.length === 0) return null;
  const noChange = skipped.filter((r) => r.summary.includes("no change")).length;
  const noTrack = skipped.filter((r) => r.summary.includes("tracking disabled")).length;
  const other = skipped.length - noChange - noTrack;
  const parts: string[] = [];
  if (noChange > 0) {
    parts.push(
      `${noChange} already match closing stock on that date (no adjustment needed)`
    );
  }
  if (noTrack > 0) parts.push(`${noTrack} non-inventory item(s)`);
  if (other > 0) parts.push(`${other} other`);
  return parts.join("; ");
}

function parseNumber(v: string): number | null {
  const raw = v.replace(/,/g, "").replace(/^\+/, "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function keyLower(v: string): string {
  return v.trim().toLowerCase();
}

function normalizeDateOnly(value: string): string | null {
  const d = value.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const parsed = new Date(`${d}T12:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === d ? d : null;
}

/** Exclusive end of the selected business calendar day. */
function endOfBusinessDateMs(dateOnly: string): number {
  return businessDayRangeForDateString(dateOnly)?.to.getTime() ?? Number.NaN;
}

/** Closing quantity from file (new_quantity is an alias for closing_stock). */
function closingStockFromRow(row: Record<string, string>): string {
  return cell(row, [
    "closing_stock",
    "closing_quantity",
    "closing_qty",
    "new_quantity",
    "new_qty",
    "quantity",
    "qty",
    "qty_on_hand",
    "on_hand",
    "stock",
    "stock_qty",
    "count",
    "physical_qty",
    "physical_quantity",
    "balance",
  ]);
}

/** Normalize product names for import matching (spacing, case, NBSP). */
export function normalizeProductName(value: string): string {
  return value
    .replace(/^\ufeff/, "")
    .replace(/\u00a0/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function looseNameKey(value: string): string {
  return normalizeProductName(value).replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

type ProductRow = {
  id: string;
  name?: string | null;
  sku?: string | null;
  barcode?: string | null;
  code?: string | null;
  track_inventory?: boolean | null;
};

async function fetchProductsForImport(
  organizationId?: string | null,
  isSuperAdmin?: boolean
): Promise<ProductRow[]> {
  // Core columns only — many tenants lack sku/barcode/code on products (PostgREST 400 if selected).
  const { data, error } = await filterByOrganizationId(
    supabase.from("products").select("id, name, track_inventory").order("name"),
    organizationId,
    isSuperAdmin
  );
  if (error) throw new Error(error.message);
  return ((data ?? []) as ProductRow[]).map((row) => ({
    ...row,
    sku: null,
    barcode: null,
    code: null,
  }));
}

/** Align DB active org with the workspace (fixes RLS / movement visibility). */
export async function ensureActiveOrganization(organizationId: string): Promise<void> {
  const { error } = await supabase.rpc("set_active_organization", {
    p_organization_id: organizationId,
  });
  if (error) {
    throw new Error(error.message || "Could not set active organization.");
  }
}

export async function loadStockBulkImportContext(
  organizationId?: string | null,
  isSuperAdmin?: boolean,
  closingDate?: string | null
): Promise<StockBulkImportContext> {
  if (organizationId) {
    await ensureActiveOrganization(organizationId);
  }

  const asAt = closingDate ? normalizeDateOnly(closingDate) : null;
  const [productsData, movementRows, { data: glData }] = await Promise.all([
    fetchProductsForImport(organizationId, isSuperAdmin),
    fetchAllStockMovements(organizationId),
    supabase.from("gl_accounts").select("*").order("account_code"),
  ]);

  const productsById = new Map<string, ProductMini>();
  const productsBySku = new Map<string, ProductMini>();
  const productsByBarcode = new Map<string, ProductMini>();
  const productsByCode = new Map<string, ProductMini>();
  const productsByName = new Map<string, ProductMini[]>();
  const allProducts: ProductMini[] = [];

  for (const row of productsData) {
    const p: ProductMini = {
      id: String(row.id),
      name: String(row.name ?? ""),
      sku: row.sku ? String(row.sku) : null,
      barcode: row.barcode ? String(row.barcode) : null,
      code: row.code ? String(row.code) : null,
      track_inventory: row.track_inventory as boolean | null,
    };
    allProducts.push(p);
    productsById.set(p.id, p);
    if (p.sku) productsBySku.set(normalizeProductName(p.sku), p);
    if (p.barcode) productsByBarcode.set(normalizeProductName(p.barcode), p);
    if (p.code) productsByCode.set(normalizeProductName(p.code), p);
    const nameKey = normalizeProductName(p.name);
    if (!nameKey) continue;
    const list = productsByName.get(nameKey) ?? [];
    list.push(p);
    productsByName.set(nameKey, list);
  }

  const currentStock: Record<string, number> = {};
  if (asAt) {
    for (const p of allProducts) {
      currentStock[p.id] = stockOnHandAsAt(movementRows, p.id, asAt);
    }
  } else {
    for (const m of movementRows) {
      const { inQty, outQty } = effectiveStockMovementInOut(m);
      currentStock[m.product_id] =
        (currentStock[m.product_id] ?? 0) + (inQty - outQty);
    }
  }

  const glByCode = new Map<string, GlMini>();
  for (const row of normalizeGlAccountRows((glData ?? []) as unknown[]).filter((g) => g.account_type === "asset")) {
    glByCode.set(keyLower(row.account_code), {
      id: row.id,
      account_code: row.account_code,
      account_name: row.account_name,
    });
  }

  return {
    productsById,
    productsBySku,
    productsByBarcode,
    productsByCode,
    productsByName,
    allProducts,
    productCount: allProducts.length,
    currentStock,
    closingDate: asAt,
    movements: movementRows,
    glByCode,
  };
}

function importNameFromRow(row: Record<string, string>): string {
  return asText(
    row.product_name ||
      row.product ||
      row.item_name ||
      row.item_description ||
      row.description ||
      row.medicine ||
      row.medicine_name ||
      row.drug ||
      row.drug_name ||
      row.item ||
      row.name
  );
}

function resolveByName(
  ctx: StockBulkImportContext,
  name: string
): { product: ProductMini } | { error: string } {
  const key = normalizeProductName(name);
  if (!key) return { error: "Product name is empty" };

  const exact = ctx.productsByName.get(key) ?? [];
  if (exact.length === 1) return { product: exact[0] };
  if (exact.length > 1) {
    return { error: `Multiple products named "${name}" — use sku or product_id` };
  }

  const loose = looseNameKey(name);
  if (loose) {
    const looseMatches = ctx.allProducts.filter((p) => looseNameKey(p.name) === loose);
    if (looseMatches.length === 1) return { product: looseMatches[0] };
    if (looseMatches.length > 1) {
      return { error: `Multiple products match "${name}" — use sku or product_id` };
    }
  }

  const partial = ctx.allProducts.filter((p) => {
    const pn = normalizeProductName(p.name);
    return pn.includes(key) || key.includes(pn);
  });
  if (partial.length === 1) return { product: partial[0] };
  if (partial.length > 1) {
    return {
      error: `Ambiguous name "${name}" (${partial.length} similar products) — use sku, code, or product_id`,
    };
  }

  return { error: `No product named "${name}"` };
}

function resolveProduct(
  ctx: StockBulkImportContext,
  row: Record<string, string>
): { product: ProductMini } | { error: string } {
  const idRaw = asText(row.product_id || row.uuid);
  if (idRaw) {
    const p = ctx.productsById.get(idRaw);
    if (!p) return { error: `Unknown product id "${idRaw}"` };
    return { product: p };
  }

  const sku = asText(row.product_sku || row.sku || row.item_sku);
  if (sku) {
    const p = ctx.productsBySku.get(normalizeProductName(sku));
    if (p) return { product: p };
    const asName = resolveByName(ctx, sku);
    if ("product" in asName) return asName;
    return { error: `No product with SKU "${sku}"` };
  }

  const barcode = asText(row.barcode || row.product_barcode);
  if (barcode) {
    const p = ctx.productsByBarcode.get(normalizeProductName(barcode));
    if (p) return { product: p };
    const asName = resolveByName(ctx, barcode);
    if ("product" in asName) return asName;
    return { error: `No product with barcode "${barcode}"` };
  }

  const code = asText(row.product_code || row.item_code);
  if (code) {
    const p = ctx.productsByCode.get(normalizeProductName(code));
    if (p) return { product: p };
    const asName = resolveByName(ctx, code);
    if ("product" in asName) return asName;
    return { error: `No product with code "${code}"` };
  }

  const name = importNameFromRow(row);
  if (!name) {
    return { error: "Provide product_id, sku, barcode, code, or product_name" };
  }
  return resolveByName(ctx, name);
}

function resolveGlAccount(
  ctx: StockBulkImportContext,
  row: Record<string, string>,
  defaultGlAccountId: string | null
): { glAccountId: string | null } | { error: string } {
  const code = asText(row.gl_account_code || row.gl_code || row.account_code);
  if (!code) {
    if (!defaultGlAccountId) {
      return { error: "GL account is required. Provide gl_account_code in the file or select a default GL account." };
    }
    return { glAccountId: defaultGlAccountId };
  }
  const gl = ctx.glByCode.get(keyLower(code));
  if (!gl) return { error: `Unknown GL account code "${code}"` };
  return { glAccountId: gl.id };
}

function parseMovementDate(row: Record<string, string>, defaultDate: string): string | null {
  const raw = asText(
    row.movement_date ||
      row.date ||
      row.adjustment_date ||
      row.closing_date ||
      row.stock_take_date ||
      row.count_date ||
      row.as_at ||
      row.as_at_date
  );
  if (!raw) return normalizeDateOnly(defaultDate);

  const isoDate = normalizeDateOnly(raw);
  if (isoDate) return isoDate;

  // Excel date cells are commonly returned as serial numbers by sheet_to_json.
  if (/^\d{4,6}(?:\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    const excelEpochMs = Date.UTC(1899, 11, 30);
    const excelDate = new Date(excelEpochMs + Math.floor(serial) * 86_400_000);
    if (!Number.isNaN(excelDate.getTime())) return excelDate.toISOString().slice(0, 10);
  }

  // Local imports commonly use day/month/year.
  const localDate = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
  if (localDate) {
    const [, day, month, year] = localDate;
    const normalized = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    const parsed = new Date(`${normalized}T12:00:00.000Z`);
    if (
      parsed.getUTCFullYear() === Number(year) &&
      parsed.getUTCMonth() + 1 === Number(month) &&
      parsed.getUTCDate() === Number(day)
    ) {
      return normalized;
    }
    return null;
  }

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return toBusinessDateString(d);
}

function defaultClosingReason(closingDate: string, rowReason: string, fallback: string): string {
  const custom = rowReason.trim() || fallback.trim();
  if (custom && custom !== "Bulk stock import") return custom;
  return `Closing stock as at ${closingDate}`;
}

export function planStockAdjustmentImports(
  ctx: StockBulkImportContext,
  rows: Record<string, string>[],
  defaults: {
    closingDate: string;
    movementDate: string;
    reason: string;
    glAccountId: string | null;
  }
): { plans: StockAdjustmentPlan[]; preview: StockBulkImportPreviewRow[] } {
  const plans: StockAdjustmentPlan[] = [];
  const preview: StockBulkImportPreviewRow[] = [];
  const firstLineByProductId = new Map<string, number>();

  rows.forEach((row, idx) => {
    const line = idx + 2;
    const productRes = resolveProduct(ctx, row);
    if ("error" in productRes) {
      preview.push({ line, status: "error", summary: productRes.error });
      return;
    }
    const { product } = productRes;
    const firstLine = firstLineByProductId.get(product.id);
    if (firstLine !== undefined) {
      preview.push({
        line,
        status: "error",
        summary: `${product.name}: duplicate product; already provided on line ${firstLine}. Use one closing_stock row per product.`,
      });
      return;
    }
    firstLineByProductId.set(product.id, line);

    if (product.track_inventory === false) {
      preview.push({ line, status: "skip", summary: `${product.name}: inventory tracking disabled` });
      return;
    }

    const glRes = resolveGlAccount(ctx, row, defaults.glAccountId);
    if ("error" in glRes) {
      preview.push({ line, status: "error", summary: glRes.error });
      return;
    }

    const closingDate = parseMovementDate(row, defaults.closingDate);
    if (!closingDate) {
      preview.push({ line, status: "error", summary: "Invalid closing / movement date" });
      return;
    }

    const currentQty = stockOnHandAsAt(ctx.movements, product.id, closingDate);
    const closingQtyRaw = closingStockFromRow(row);
    const deltaRaw = cell(row, [
      "qty_adjustment",
      "adjustment",
      "delta",
      "amount_adjusted",
      "qty_delta",
      "change",
      "variance",
      "difference",
      "diff",
    ]);

    const closingQtyParsed = closingQtyRaw ? parseNumber(closingQtyRaw) : null;
    const deltaParsed = deltaRaw ? parseNumber(deltaRaw) : null;

    if (closingQtyParsed === null && deltaParsed === null) {
      preview.push({
        line,
        status: "error",
        summary: "Provide closing_stock / new_quantity (physical count) or qty_adjustment",
      });
      return;
    }

    let delta: number;
    let closingQty: number;
    const asAtLabel = closingDate;

    if (closingQtyParsed !== null) {
      closingQty = closingQtyParsed;
      delta = closingQty - currentQty;
      if (
        deltaParsed !== null &&
        Math.abs(delta - deltaParsed) > 0.0001
      ) {
        preview.push({
          line,
          status: "error",
          summary: `closing_stock (${closingQty}) and qty_adjustment (${deltaParsed}) conflict for ${product.name}`,
        });
        return;
      }
    } else {
      delta = deltaParsed!;
      closingQty = currentQty + delta;
    }

    if (delta === 0) {
      preview.push({
        line,
        status: "skip",
        summary: `${product.name}: closing stock ${closingQty.toFixed(2)} already matches system as at ${asAtLabel}`,
      });
      return;
    }

    const reason = defaultClosingReason(
      closingDate,
      asText(row.reason || row.note),
      defaults.reason
    );

    const plan: StockAdjustmentPlan = {
      line,
      productId: product.id,
      productLabel: product.name,
      currentQty,
      delta,
      newQty: closingQty,
      movementDate: closingDate,
      reason,
      glAccountId: glRes.glAccountId,
    };
    plans.push(plan);
    preview.push({
      line,
      status: "ok",
      summary: `${product.name}: ${currentQty.toFixed(2)} on hand as at ${asAtLabel} → closing ${closingQty.toFixed(2)} (${delta > 0 ? "+" : ""}${delta.toFixed(2)})`,
    });
  });

  return { plans, preview };
}

function buildMovementNote(
  plan: StockAdjustmentPlan,
  ctx: StockBulkImportContext,
  glPrefix?: string
): string {
  let note = "";
  if (plan.glAccountId) {
    const gl = [...ctx.glByCode.values()].find((g) => g.id === plan.glAccountId);
    if (gl) {
      note = `GL ${gl.account_code} - ${gl.account_name} | `;
    }
  } else if (glPrefix) {
    note = glPrefix;
  }
  return `${note}${plan.reason} [CLOSING_STOCK:${plan.newQty}]`;
}

function movementDateIso(dateOnly: string): string {
  const d = dateOnly.trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const range = businessDayRangeForDateString(d);
    if (range) return new Date(range.to.getTime() - 1).toISOString();
  }
  const parsed = new Date(dateOnly);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

async function countAdjustmentMovements(
  sourceId: string,
  organizationId: string
): Promise<number> {
  const { count, error } = await filterStockMovementsByOrganizationId(
    supabase
      .from("product_stock_movements")
      .select("id", { count: "exact", head: true })
      .eq("source_type", "adjustment")
      .eq("source_id", sourceId),
    organizationId
  );
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function verifyClosingStockPlans(
  plans: StockAdjustmentPlan[],
  organizationId: string
): Promise<string[]> {
  const movements = await fetchAllStockMovements(organizationId);
  return plans.flatMap((plan) => {
    const actual = stockOnHandAsAt(movements, plan.productId, plan.movementDate);
    if (Math.abs(actual - plan.newQty) <= 0.0001) return [];
    return [
      `${plan.productLabel}: closing stock as at ${plan.movementDate} is ${actual.toFixed(2)}, expected ${plan.newQty.toFixed(2)}.`,
    ];
  });
}

export async function applyStockAdjustmentPlans(
  plans: StockAdjustmentPlan[],
  ctx: StockBulkImportContext,
  options?: { sourceId?: string; glPrefix?: string; organizationId?: string | null }
): Promise<{ updated: number; errors: number; messages: string[]; sourceId: string }> {
  const sourceId = options?.sourceId ?? randomUuid();
  if (plans.length === 0) {
    return { updated: 0, errors: 0, messages: [], sourceId };
  }
  if (plans.some((plan) => !plan.glAccountId)) {
    return {
      updated: 0,
      errors: plans.length,
      messages: ["Every stock adjustment requires a GL account."],
      sourceId,
    };
  }

  const orgId = options?.organizationId;
  if (!orgId) {
    return {
      updated: 0,
      errors: plans.length,
      messages: ["Organization is required to save stock movements."],
      sourceId,
    };
  }

  await ensureActiveOrganization(orgId);

  const payload = plans.map((plan) => {
    const delta = plan.delta;
    return {
      product_id: plan.productId,
      movement_date: movementDateIso(plan.movementDate),
      source_type: "adjustment" as const,
      source_id: sourceId,
      quantity_in: delta > 0 ? delta : 0,
      quantity_out: delta < 0 ? Math.abs(delta) : 0,
      unit_cost: null,
      organization_id: orgId,
      note: buildMovementNote(plan, ctx, options?.glPrefix),
    };
  });

  const defaultReason = plans[0]?.reason ?? "Bulk stock import";
  const messages: string[] = [];

  const { error: rpcError } = await supabase.rpc("apply_stock_adjustments_bulk", {
    p_adjustments: payload.map(({ organization_id: _o, unit_cost: _u, ...rest }) => rest),
    p_source_id: sourceId,
    p_default_reason: defaultReason,
  });

  const rpcUnavailable =
    !!rpcError &&
    (rpcError.code === "PGRST202" || rpcError.message?.includes("apply_stock_adjustments_bulk"));

  if (rpcError && !rpcUnavailable) {
    return {
      updated: 0,
      errors: plans.length,
      messages: [rpcError.message],
      sourceId,
    };
  }

  if (!rpcUnavailable && !rpcError) {
    const verified = await countAdjustmentMovements(sourceId, orgId);
    if (verified === plans.length) {
      const closingErrors = await verifyClosingStockPlans(plans, orgId);
      return {
        updated: verified,
        errors: closingErrors.length,
        messages: closingErrors,
        sourceId,
      };
    }
    messages.push(
      `Bulk apply finished but only ${verified} of ${plans.length} movement(s) are visible for your organization.`
    );
    return { updated: verified, errors: plans.length - verified, messages, sourceId };
  }

  const BATCH = 100;
  for (let i = 0; i < payload.length; i += BATCH) {
    const chunk = payload.slice(i, i + BATCH);
    const { error } = await supabase.from("product_stock_movements").insert(chunk);
    if (error) {
      const verified = await countAdjustmentMovements(sourceId, orgId);
      messages.push(error.message);
      return {
        updated: verified,
        errors: plans.length - verified,
        messages,
        sourceId,
      };
    }
  }

  const verified = await countAdjustmentMovements(sourceId, orgId);
  if (verified !== plans.length) {
    messages.push(
      `Only ${verified} of ${plans.length} movement(s) were saved for your organization. Check permissions and Stock Adjustments history.`
    );
    return { updated: verified, errors: plans.length - verified, messages, sourceId };
  }

  const closingErrors = await verifyClosingStockPlans(plans, orgId);
  return {
    updated: verified,
    errors: closingErrors.length,
    messages: closingErrors,
    sourceId,
  };
}
