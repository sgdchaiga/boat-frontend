import { supabase } from "../../../lib/supabase";
import { sumPosCogsByDept, createJournalForPosOrder, getDefaultGlAccounts } from "../../../lib/journal";
import { resolveJournalAccountSettings } from "../../../lib/journalAccountSettings";
import { businessTodayISO } from "../../../lib/timezone";
import { insertPaymentWithMethodCompat } from "../../../lib/paymentMethod";
import type { OfflineRetailLine, OfflineRetailPayment } from "../../../lib/retailOfflineQueue";
import { desktopApi } from "../../../lib/desktopApi";
import { persistRetailSaleLedger, type SaleCustomerContext } from "./checkoutService";
import { postClearingSettlementAfterRetailSale } from "../../../lib/clearingRetailSettlement";

interface RetailCustomerLite {
  id: string;
  credit_limit?: number | null;
  current_credit_balance?: number | null;
}

interface DepartmentLite {
  id: string;
  name: string;
}

interface ProcessSaleOnlineArgs {
  saleId: string;
  lines: OfflineRetailLine[];
  tenders: OfflineRetailPayment[];
  saleCustomer: SaleCustomerContext;
  useDesktopLocalMode: boolean;
  activeSessionId: string | null;
  total: number;
  amountPaid: number;
  amountDue: number;
  changeDue: number;
  paymentStatus: "pending" | "partial" | "completed" | "overpaid";
  saleType: "cash" | "credit" | "mixed";
  creditDueDate: string;
  posVatEnabled: boolean;
  posVatRate: number | null;
  userId: string | null;
  organizationId: string | undefined;
  customers: RetailCustomerLite[];
  departments: DepartmentLite[];
  onAtomicRpcStatus: (status: "available" | "unavailable") => void;
  onAtomicFallbackCount: (count: number) => void;
}

export async function processSaleOnline(args: ProcessSaleOnlineArgs) {
  const {
    saleId,
    lines,
    tenders,
    saleCustomer,
    useDesktopLocalMode,
    activeSessionId,
    total,
    amountPaid,
    amountDue,
    changeDue,
    paymentStatus,
    saleType,
    creditDueDate,
    posVatEnabled,
    posVatRate,
    userId,
    organizationId,
    customers,
    departments,
    onAtomicRpcStatus,
    onAtomicFallbackCount,
  } = args;

  const runClearingHook = () => {
    void postClearingSettlementAfterRetailSale({
      organizationId,
      saleId,
      amountPaid,
      paymentStatus,
    }).catch((e) => console.warn("[BOAT clearing] retail settlement:", e instanceof Error ? e.message : e));
  };

  if (useDesktopLocalMode) {
    const payload = {
      sale_id: saleId,
      cashier_session_id: activeSessionId,
      customer_id: saleCustomer.id,
      customer_name: saleCustomer.name,
      customer_phone: saleCustomer.phone,
      total_amount: total,
      amount_paid: amountPaid,
      amount_due: amountDue,
      change_amount: changeDue,
      payment_status: paymentStatus,
      sale_type: saleType,
      credit_due_date: creditDueDate || null,
      vat_enabled: posVatEnabled,
      vat_rate: posVatRate,
      created_by: userId,
      lines: lines.map((line, idx) => ({
        line_no: idx + 1,
        product_id: line.productId,
        description: line.name,
        quantity: line.quantity,
        unit_price: line.unitPrice,
        line_total: line.lineTotal,
        unit_cost: line.costPrice,
        department_id: line.departmentId,
        track_inventory: line.trackInventory,
      })),
      payments: tenders.map((t) => ({
        payment_method: t.method,
        amount: t.amount,
        payment_status: t.status,
      })),
    };
    const created = await desktopApi.createRetailSale(payload);
    if (!created?.id) throw new Error("Failed to save local retail sale.");
    return;
  }

  const { data: staffRow } = await supabase.from("staff").select("id").eq("id", userId).maybeSingle();
  const selectedCustomer = customers.find((c) => c.id === saleCustomer.id);
  if (saleType !== "cash" && selectedCustomer) {
    const limit = Number(selectedCustomer.credit_limit ?? 0);
    const current = Number(selectedCustomer.current_credit_balance ?? 0);
    if (limit > 0 && current + amountDue > limit) {
      throw new Error(`Credit limit exceeded. Available credit is ${(limit - current).toFixed(2)}.`);
    }
  }
  const deptNameById = new Map(departments.map((d) => [d.id, d.name]));
  const cogsByDept = sumPosCogsByDept(
    lines.map((i) => ({
      quantity: i.quantity,
      unitCost: Number(i.costPrice ?? 0),
      departmentId: i.departmentId ?? null,
    })),
    deptNameById
  );
  const acc = await getDefaultGlAccounts();
  const receiptGl =
    tenders[0]?.method === "cash"
      ? acc.cash
      : tenders[0]?.method === "bank_transfer" || tenders[0]?.method === "card"
        ? acc.posBank ?? acc.cash
        : tenders[0]?.method === "airtel_money"
          ? acc.posAirtelMoney ?? acc.posMtnMobileMoney ?? acc.cash
          : acc.posMtnMobileMoney ?? acc.cash;
  const journalLines: Array<{ gl_account_id: string; debit: number; credit: number; line_description: string }> = [];
  if (receiptGl && acc.revenue) {
    journalLines.push(
      { gl_account_id: receiptGl, debit: total, credit: 0, line_description: "Retail sale receipt" },
      { gl_account_id: acc.revenue, debit: 0, credit: total, line_description: "Retail sales" }
    );
    if ((cogsByDept.bar ?? 0) > 0 && acc.posCogsBar && acc.posInvBar) {
      journalLines.push(
        { gl_account_id: acc.posCogsBar, debit: Number(cogsByDept.bar), credit: 0, line_description: "Bar COGS" },
        { gl_account_id: acc.posInvBar, debit: 0, credit: Number(cogsByDept.bar), line_description: "Bar stock" }
      );
    }
    if ((cogsByDept.kitchen ?? 0) > 0 && acc.posCogsKitchen && acc.posInvKitchen) {
      journalLines.push(
        { gl_account_id: acc.posCogsKitchen, debit: Number(cogsByDept.kitchen), credit: 0, line_description: "Kitchen COGS" },
        { gl_account_id: acc.posInvKitchen, debit: 0, credit: Number(cogsByDept.kitchen), line_description: "Kitchen stock" }
      );
    }
    if ((cogsByDept.room ?? 0) > 0 && acc.posCogsRoom && acc.posInvRoom) {
      journalLines.push(
        { gl_account_id: acc.posCogsRoom, debit: Number(cogsByDept.room), credit: 0, line_description: "Room COGS" },
        { gl_account_id: acc.posInvRoom, debit: 0, credit: Number(cogsByDept.room), line_description: "Room stock" }
      );
    }
  }
  const linePayload = lines.map((line, idx) => ({
    line_no: idx + 1,
    product_id: line.productId,
    description: line.name,
    quantity: line.quantity,
    unit_price: line.unitPrice,
    line_total: line.lineTotal,
    unit_cost: line.costPrice,
    department_id: line.departmentId,
    track_inventory: line.trackInventory,
  }));
  const paymentPayload = tenders.map((t) => ({ method: t.method, amount: t.amount, status: t.status }));
  const bumpCustomerCreditExposure = async () => {
    if (!saleCustomer.id || amountDue <= 0) return;
    const { data: cRow } = await supabase
      .from("retail_customers")
      .select("current_credit_balance")
      .eq("id", saleCustomer.id)
      .maybeSingle();
    const current = Number((cRow as { current_credit_balance?: number } | null)?.current_credit_balance ?? 0);
    const next = Math.round((current + amountDue) * 100) / 100;
    await supabase.from("retail_customers").update({ current_credit_balance: next }).eq("id", saleCustomer.id);
  };
  if (organizationId) {
    const { error: atomicErr } = await supabase.rpc("post_retail_sale_atomic", {
      p_sale_id: saleId,
      p_organization_id: organizationId,
      p_created_by: staffRow?.id ?? null,
      p_customer_id: saleCustomer.id,
      p_customer_name: saleCustomer.name,
      p_customer_phone: saleCustomer.phone,
      p_total_amount: total,
      p_amount_paid: amountPaid,
      p_amount_due: amountDue,
      p_change_amount: changeDue,
      p_payment_status: paymentStatus,
      p_vat_enabled: posVatEnabled,
      p_vat_rate: posVatRate,
      p_cashier_session_id: activeSessionId,
      p_lines: linePayload,
      p_payments: paymentPayload,
      p_journal_entry_date: businessTodayISO(),
      p_journal_description: lines.map((i) => `${i.quantity}x ${i.name}`).join(", ") || "Retail POS sale",
      p_journal_lines: journalLines,
    });
    if (!atomicErr) {
      await supabase
        .from("retail_sales")
        .update({ sale_type: saleType, credit_due_date: creditDueDate || null })
        .eq("id", saleId);
      onAtomicRpcStatus("available");
      await bumpCustomerCreditExposure();
      runClearingHook();
      return;
    }
    onAtomicRpcStatus("unavailable");
    const key = "boat.retail.atomic.fallback.count";
    const nextFallbackCount = Number(localStorage.getItem(key) || 0) + 1;
    localStorage.setItem(key, String(nextFallbackCount));
    onAtomicFallbackCount(nextFallbackCount);
    console.warn("Atomic retail RPC unavailable, falling back to legacy path:", atomicErr.message);
  }
  const persistedNewSale = await persistRetailSaleLedger({
    saleId,
    lines,
    tenders,
    organizationId,
    processedBy: staffRow?.id ?? null,
    saleCustomer,
    total,
    amountPaid,
    amountDue,
    changeDue,
    paymentStatus,
    saleType,
    creditDueDate,
    posVatEnabled,
    posVatRate,
    cashierSessionId: activeSessionId,
  });
  if (persistedNewSale) {
    runClearingHook();
  }
  await bumpCustomerCreditExposure();
  for (const tender of tenders) {
    const { error: paymentError } = await insertPaymentWithMethodCompat(
      supabase,
      {
        stay_id: null,
        ...(organizationId ? { organization_id: organizationId } : {}),
        payment_source: "pos_retail",
        amount: tender.amount,
        payment_status: tender.status,
        transaction_id: saleId,
        processed_by: staffRow?.id ?? null,
        retail_customer_id: saleCustomer.id,
        source_documents: {
          sale_total: total,
          payment_status: paymentStatus,
          amount_paid: amountPaid,
          amount_due: amountDue,
          customer_name: saleCustomer.name,
          customer_phone: saleCustomer.phone,
          cashier_session_id: activeSessionId,
        },
      },
      tender.method
    );
    if (paymentError) throw paymentError;
  }

  const stockMoves = lines
    .filter((i) => i.trackInventory)
    .map((i) => ({
      product_id: i.productId,
      source_type: "sale",
      source_id: saleId,
      quantity_in: 0,
      quantity_out: i.quantity,
      unit_cost: i.costPrice,
      note: "Retail POS sale",
    }));
  if (stockMoves.length > 0) {
    const { error: stockErr } = await supabase.from("product_stock_movements").insert(stockMoves);
    if (stockErr) throw stockErr;
  }

  const description = lines.map((i) => `${i.quantity}x ${i.name}`).join(", ");
  const js = await resolveJournalAccountSettings(organizationId ?? undefined);
  const vatRate = js.default_vat_percent;
  const useVatJournal = posVatEnabled && vatRate != null && Number.isFinite(vatRate) && vatRate > 0;
  const jr = await createJournalForPosOrder(saleId, total, description || "Retail POS sale", businessTodayISO(), staffRow?.id ?? null, {
    paymentMethod: tenders[0]?.method ?? "cash",
    cogsByDept,
    vatRatePercent: useVatJournal ? vatRate : undefined,
    organizationId: organizationId ?? null,
  });
  if (!jr.ok) alert(`Sale recorded but journal was not posted: ${jr.error}`);
}
