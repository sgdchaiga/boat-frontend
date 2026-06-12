import { supabase } from "./supabase";
import { createJournalForPosOrder, deleteJournalEntryByReference, sumPosCogsByDept } from "./journal";

export async function syncRetailPosOrderAfterEdit(
  saleId: string,
  saleAt: string,
  createdBy: string | null,
  organizationId?: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [
    { data: rawLines, error: linesError },
    { data: rawPayments, error: paymentsError },
    { data: saleHeader, error: headerReadError },
  ] = await Promise.all([
    supabase.from("retail_sale_lines").select("product_id,description,quantity,unit_price,line_total,department_id").eq("sale_id", saleId),
    supabase.from("payments").select("amount,payment_method,payment_status").eq("transaction_id", saleId),
    supabase.from("retail_sales").select("vat_enabled,vat_rate").eq("id", saleId).maybeSingle(),
  ]);
  if (linesError) return { ok: false, error: linesError.message };
  if (paymentsError) return { ok: false, error: paymentsError.message };
  if (headerReadError) return { ok: false, error: headerReadError.message };

  const lines = (rawLines || []) as Array<{
    product_id: string | null;
    description: string | null;
    quantity: number | null;
    unit_price: number | null;
    line_total: number | null;
    department_id: string | null;
  }>;
  const productIds = [...new Set(lines.map((line) => line.product_id).filter((id): id is string => !!id))];
  const { data: rawProducts, error: productsError } = productIds.length
    ? await supabase.from("products").select("id,cost_price,track_inventory,department_id").in("id", productIds)
    : { data: [], error: null };
  if (productsError) return { ok: false, error: productsError.message };
  const products = new Map(
    ((rawProducts || []) as Array<{ id: string; cost_price: number | null; track_inventory: boolean | null; department_id: string | null }>).map(
      (product) => [product.id, product]
    )
  );

  const total = Math.round(lines.reduce((sum, line) => sum + Number(line.line_total ?? Number(line.quantity || 0) * Number(line.unit_price || 0)), 0) * 100) / 100;
  const completedPayments = (rawPayments || []).filter((payment) => payment.payment_status === "completed");
  const amountPaid = Math.round(completedPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0) * 100) / 100;
  const amountDue = Math.max(0, Math.round((total - amountPaid) * 100) / 100);
  const paymentStatus = amountPaid <= 0 ? "pending" : amountPaid + 0.01 >= total ? "completed" : "partial";

  const { error: headerError } = await supabase.from("retail_sales").update({
    sale_at: saleAt,
    total_amount: total,
    amount_paid: amountPaid,
    amount_due: amountDue,
    change_amount: Math.max(0, amountPaid - total),
    payment_status: paymentStatus,
    sale_type: amountPaid <= 0 ? "credit" : amountPaid + 0.01 >= total ? "cash" : "mixed",
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
      unit_cost: Number(products.get(line.product_id!)?.cost_price || 0),
      note: "Retail POS sale",
      ...(organizationId ? { organization_id: organizationId } : {}),
    }));
  if (stockRows.length) {
    const { error } = await supabase.from("product_stock_movements").insert(stockRows);
    if (error) return { ok: false, error: error.message };
  }

  const cogsByDept = sumPosCogsByDept(
    lines.map((line) => ({
      quantity: Number(line.quantity || 0),
      unitCost: Number(line.product_id ? products.get(line.product_id)?.cost_price || 0 : 0),
      departmentId: line.department_id || (line.product_id ? products.get(line.product_id)?.department_id : null) || null,
    })),
    new Map()
  );
  const removed = await deleteJournalEntryByReference("pos", saleId);
  if (!removed.ok) return { ok: false, error: removed.error };
  const posted = await createJournalForPosOrder(
    saleId,
    total,
    lines.map((line) => `${Number(line.quantity || 0)}x ${line.description || "Item"}`).join(", "),
    saleAt,
    createdBy,
    {
      paymentMethod: completedPayments[0]?.payment_method || "cash",
      amountPaid,
      cogsByDept,
      vatRatePercent: saleHeader?.vat_enabled ? Number(saleHeader.vat_rate || 0) : undefined,
      organizationId: organizationId ?? null,
    }
  );
  return posted.ok ? { ok: true } : { ok: false, error: posted.error };
}
