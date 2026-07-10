import { supabase } from "./supabase";
import {
  createJournalForPosOrder,
  deleteJournalEntryByReference,
  resolveManufacturingCogsAccountId,
  sumPosCogsByDept,
  type PosJournalRepairResult,
  type PosDirectCogsLine,
} from "./journal";
import { resolveJournalAccountSettings } from "./journalAccountSettings";

async function fetchWeightedStockUnitCosts(
  organizationId: string | null | undefined,
  productIds: string[],
  saleAt: string
): Promise<Map<string, number>> {
  if (!organizationId || productIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("product_stock_movements")
    .select("product_id,quantity_in,unit_cost")
    .in("product_id", productIds)
    .gt("quantity_in", 0)
    .not("unit_cost", "is", null)
    .lte("movement_date", saleAt)
    .or(`organization_id.eq.${organizationId},organization_id.is.null`);
  if (error) return new Map();

  const totals = new Map<string, { qty: number; value: number }>();
  ((data || []) as Array<{ product_id: string | null; quantity_in: number | null; unit_cost: number | null }>).forEach((movement) => {
    const productId = movement.product_id;
    const qty = Number(movement.quantity_in || 0);
    const unitCost = Number(movement.unit_cost || 0);
    if (!productId || qty <= 0 || unitCost <= 0) return;
    const prev = totals.get(productId) || { qty: 0, value: 0 };
    totals.set(productId, { qty: prev.qty + qty, value: prev.value + qty * unitCost });
  });

  return new Map(
    Array.from(totals.entries())
      .filter(([, total]) => total.qty > 0 && total.value > 0)
      .map(([productId, total]) => [productId, Math.round((total.value / total.qty) * 10000) / 10000])
  );
}

function nextDateString(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  parsed.setDate(parsed.getDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

export async function syncRetailPosOrderAfterEdit(
  saleId: string,
  saleAt: string,
  createdBy: string | null,
  organizationId?: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [
    { data: rawLines, error: linesError },
    { data: rawPayments, error: paymentsError },
    { data: rawSalePayments, error: salePaymentsError },
    { data: saleHeader, error: headerReadError },
  ] = await Promise.all([
    supabase.from("retail_sale_lines").select("product_id,description,quantity,unit_price,line_total,department_id").eq("sale_id", saleId),
    supabase.from("payments").select("amount,payment_method,payment_status").eq("transaction_id", saleId),
    supabase.from("retail_sale_payments").select("amount,payment_method,payment_status,receipt_gl_account_id").eq("sale_id", saleId),
    supabase.from("retail_sales").select("vat_enabled,vat_rate,agent_commission_amount,transport_cost").eq("id", saleId).maybeSingle(),
  ]);
  if (linesError) return { ok: false, error: linesError.message };
  if (paymentsError) return { ok: false, error: paymentsError.message };
  if (salePaymentsError) return { ok: false, error: salePaymentsError.message };
  if (headerReadError) return { ok: false, error: headerReadError.message };

  const lines = (rawLines || []) as Array<{
    product_id: string | null;
    description: string | null;
    quantity: number | null;
    unit_price: number | null;
    line_total: number | null;
    department_id: string | null;
  }>;
  if (lines.length === 0) {
    return { ok: false, error: "An active order must contain at least one item. Reverse the order instead of saving it empty." };
  }
  const productIds = [...new Set(lines.map((line) => line.product_id).filter((id): id is string => !!id))];
  const { data: rawProducts, error: productsError } = productIds.length
    ? await supabase.from("products").select("id,cost_price,track_inventory,department_id,manufacturing_item_type").in("id", productIds)
    : { data: [], error: null };
  if (productsError) return { ok: false, error: productsError.message };
  const products = new Map(
    ((rawProducts || []) as Array<{ id: string; cost_price: number | null; track_inventory: boolean | null; department_id: string | null; manufacturing_item_type?: string | null }>).map(
      (product) => [product.id, product]
    )
  );
  const stockUnitCostByProduct = await fetchWeightedStockUnitCosts(organizationId, productIds, saleAt);
  const { data: rawManufacturingReceipts, error: manufacturingReceiptsError } = productIds.length
    ? await supabase
        .from("product_stock_movements")
        .select("product_id")
        .eq("source_type", "manufacturing_production")
        .in("product_id", productIds)
        .gt("quantity_in", 0)
        .or(organizationId ? `organization_id.eq.${organizationId},organization_id.is.null` : "organization_id.is.null")
    : { data: [], error: null };
  if (manufacturingReceiptsError) return { ok: false, error: manufacturingReceiptsError.message };
  const manufacturingReceiptProductIds = new Set(
    ((rawManufacturingReceipts || []) as Array<{ product_id: string | null }>).map((row) => row.product_id).filter((id): id is string => !!id)
  );
  const unitCostForProduct = (productId: string | null | undefined) => {
    if (!productId) return 0;
    const resolved = stockUnitCostByProduct.get(productId);
    return Number.isFinite(Number(resolved)) && Number(resolved) > 0 ? Number(resolved) : Number(products.get(productId)?.cost_price || 0);
  };
  const isManufacturedProduct = (productId: string | null | undefined) => {
    if (!productId) return false;
    const type = products.get(productId)?.manufacturing_item_type;
    return type === "finished_product" || type === "semi_finished_goods" || manufacturingReceiptProductIds.has(productId);
  };

  const total = Math.round(lines.reduce((sum, line) => sum + Number(line.line_total ?? Number(line.quantity || 0) * Number(line.unit_price || 0)), 0) * 100) / 100;
  const agentCommissionAmount = Math.max(0, Number(saleHeader?.agent_commission_amount || 0));
  const transportCost = Math.max(0, Number(saleHeader?.transport_cost || 0));
  const settlementTotal = Math.max(0, Math.round((total - agentCommissionAmount - transportCost) * 100) / 100);
  const salePayments = (rawSalePayments || []) as Array<{
    amount: number | null;
    payment_method: string | null;
    payment_status: string | null;
    receipt_gl_account_id?: string | null;
  }>;
  const completedSalePayments = salePayments.filter((payment) => payment.payment_status === "completed");
  const completedPayments = completedSalePayments.length > 0
    ? completedSalePayments
    : (rawPayments || []).filter((payment) => payment.payment_status === "completed");
  const amountPaid = Math.round(completedPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0) * 100) / 100;
  const amountDue = Math.max(0, Math.round((settlementTotal - amountPaid) * 100) / 100);
  const paymentStatus = amountPaid <= 0 ? "pending" : amountPaid + 0.01 >= settlementTotal ? "completed" : "partial";

  const { error: headerError } = await supabase.from("retail_sales").update({
    sale_at: saleAt,
    total_amount: total,
    net_amount_due: settlementTotal,
    amount_paid: amountPaid,
    amount_due: amountDue,
    change_amount: Math.max(0, amountPaid - settlementTotal),
    payment_status: paymentStatus,
    sale_type: amountPaid <= 0 ? "credit" : amountPaid + 0.01 >= settlementTotal ? "cash" : "mixed",
  }).eq("id", saleId);
  if (headerError) return { ok: false, error: headerError.message };

  await Promise.all([
    supabase.from("payments").update({ paid_at: saleAt }).eq("transaction_id", saleId),
    supabase.from("retail_sale_payments").update({ paid_at: saleAt }).eq("sale_id", saleId),
    supabase.from("product_stock_movements").delete().eq("source_type", "sale").eq("source_id", saleId),
  ]);

  const stockRows = lines
    .filter((line) => line.product_id && products.get(line.product_id)?.track_inventory !== false && Number(line.quantity || 0) > 0)
    .map((line) => ({
      product_id: line.product_id,
      source_type: "sale",
      source_id: saleId,
      movement_date: saleAt,
      quantity_in: 0,
      quantity_out: Number(line.quantity || 0),
      unit_cost: unitCostForProduct(line.product_id),
      note: "Retail POS sale",
      ...(organizationId ? { organization_id: organizationId } : {}),
    }));
  if (stockRows.length) {
    const { error } = await supabase.from("product_stock_movements").insert(stockRows);
    if (error) return { ok: false, error: error.message };
  }

  const cogsByDept = sumPosCogsByDept(
    lines
      .filter((line) => !isManufacturedProduct(line.product_id))
      .map((line) => ({
        quantity: Number(line.quantity || 0),
        unitCost: unitCostForProduct(line.product_id),
        departmentId: line.department_id || (line.product_id ? products.get(line.product_id)?.department_id : null) || null,
      })),
    new Map()
  );
  const settings = await resolveJournalAccountSettings(organizationId);
  const manufacturingCogsGlAccountId = await resolveManufacturingCogsAccountId(organizationId);
  const manufacturingCogsAmount = Math.round(
    lines
      .filter((line) => isManufacturedProduct(line.product_id))
      .reduce((sum, line) => sum + Number(line.quantity || 0) * unitCostForProduct(line.product_id), 0) * 100
  ) / 100;
  const cogsDirect: PosDirectCogsLine[] =
    manufacturingCogsAmount > 0 && settings.manufacturing_finished_goods_id && manufacturingCogsGlAccountId
      ? [{
          cogsGlAccountId: manufacturingCogsGlAccountId,
          inventoryGlAccountId: settings.manufacturing_finished_goods_id,
          amount: manufacturingCogsAmount,
          label: "Manufactured goods",
        }]
      : [];
  if (manufacturingCogsAmount > 0 && (!settings.manufacturing_finished_goods_id || !manufacturingCogsGlAccountId)) {
    return {
      ok: false,
      error:
        "Manufacturing COGS cannot be posted. Configure Manufacturing finished goods inventory and Manufacturing COGS accounts in Admin > Journal account settings.",
    };
  }
  const removed = await deleteJournalEntryByReference("pos", saleId);
  if (!removed.ok) return { ok: false, error: removed.error };
  const receiptAccountIds = completedSalePayments
    .map((payment) => payment.receipt_gl_account_id)
    .filter((id): id is string => !!id);
  const receiptAssetIds = new Set<string>();
  if (receiptAccountIds.length > 0) {
    const { data: receiptAccounts, error: receiptAccountsError } = await supabase
      .from("gl_accounts")
      .select("id,account_type")
      .in("id", Array.from(new Set(receiptAccountIds)));
    if (receiptAccountsError) return { ok: false, error: receiptAccountsError.message };
    ((receiptAccounts || []) as Array<{ id: string; account_type: string | null }>).forEach((account) => {
      if (account.account_type === "asset") receiptAssetIds.add(account.id);
    });
  }
  const receiptLines = completedSalePayments
    .map((payment) => ({
      glAccountId: payment.receipt_gl_account_id && receiptAssetIds.has(payment.receipt_gl_account_id) ? payment.receipt_gl_account_id : "",
      amount: Number(payment.amount || 0),
      description: `Retail sale receipt - ${String(payment.payment_method || "cash").replace(/_/g, " ")}`,
    }))
    .filter((line) => line.glAccountId && line.amount > 0);
  const posted = await createJournalForPosOrder(
    saleId,
    total,
    lines.map((line) => `${Number(line.quantity || 0)}x ${line.description || "Item"}`).join(", "),
    saleAt,
    createdBy,
    {
      paymentMethod: completedPayments[0]?.payment_method || "cash",
      receiptLines,
      amountPaid,
      settlementTotal,
      agentCommissionAmount,
      transportCostAmount: transportCost,
      cogsByDept,
      cogsDirect,
      vatRatePercent: saleHeader?.vat_enabled ? Number(saleHeader.vat_rate || 0) : undefined,
      organizationId: organizationId ?? null,
    }
  );
  return posted.ok ? { ok: true } : { ok: false, error: posted.error };
}

export async function repairRetailPosOrderJournals(options?: {
  organizationId?: string | null;
  onProgress?: (processed: number, total: number) => void;
  journalOrOrder?: string | null;
  departmentId?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
}): Promise<PosJournalRepairResult> {
  const organizationId = options?.organizationId ?? null;
  if (!organizationId) throw new Error("Sign in under an organization before repairing POS journals.");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) throw new Error("Sign in before repairing POS journals.");

  let specificSaleId: string | null = null;
  const journalOrOrder = options?.journalOrOrder?.trim() || "";
  if (journalOrOrder) {
    const uuidLike = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(journalOrOrder);
    if (uuidLike) {
      specificSaleId = journalOrOrder;
    } else {
      const normalizedTransactionId = journalOrOrder.replace(/^pos\s*#?/i, "").trim();
      const { data: journal, error: journalError } = await supabase
        .from("journal_entries")
        .select("reference_id")
        .eq("organization_id", organizationId)
        .eq("reference_type", "pos")
        .ilike("transaction_id", normalizedTransactionId)
        .maybeSingle();
      if (journalError) throw journalError;
      specificSaleId = (journal as { reference_id?: string | null } | null)?.reference_id ?? null;
      if (!specificSaleId) throw new Error(`Could not find POS journal ${journalOrOrder}.`);
    }
  }

  let saleIds: string[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from("retail_sales")
      .select("id")
      .eq("organization_id", organizationId)
      .order("sale_at", { ascending: true });
    if (specificSaleId) query = query.eq("id", specificSaleId);
    if (options?.fromDate) query = query.gte("sale_at", options.fromDate);
    if (options?.toDate) query = query.lt("sale_at", nextDateString(options.toDate));
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw error;
    saleIds.push(...((data || []) as Array<{ id: string }>).map((row) => row.id));
    if (!data || data.length < pageSize) break;
  }

  if (options?.departmentId && saleIds.length > 0) {
    const matchingSaleIds = new Set<string>();
    for (let offset = 0; offset < saleIds.length; offset += 200) {
      const { data, error } = await supabase
        .from("retail_sale_lines")
        .select("sale_id")
        .in("sale_id", saleIds.slice(offset, offset + 200))
        .eq("department_id", options.departmentId);
      if (error) throw error;
      ((data || []) as Array<{ sale_id: string | null }>).forEach((line) => {
        if (line.sale_id) matchingSaleIds.add(line.sale_id);
      });
    }
    saleIds = saleIds.filter((saleId) => matchingSaleIds.has(saleId));
  }

  const result: PosJournalRepairResult = { repaired: 0, removed: 0, errors: [] };
  options?.onProgress?.(0, saleIds.length);
  for (let index = 0; index < saleIds.length; index++) {
    const saleId = saleIds[index];
    const { data: sale, error: saleError } = await supabase
      .from("retail_sales")
      .select("sale_at")
      .eq("id", saleId)
      .maybeSingle();
    if (saleError) {
      result.errors.push(`POS ${saleId}: ${saleError.message}`);
    } else if (!sale?.sale_at) {
      result.errors.push(`POS ${saleId}: sale date is missing.`);
    } else {
      const sync = await syncRetailPosOrderAfterEdit(saleId, String(sale.sale_at), user.id, organizationId);
      if (sync.ok) result.repaired += 1;
      else result.errors.push(`POS ${saleId}: ${sync.error}`);
    }
    options?.onProgress?.(index + 1, saleIds.length);
  }
  return result;
}
