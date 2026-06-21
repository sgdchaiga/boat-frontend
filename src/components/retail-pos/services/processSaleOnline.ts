import { supabase } from "../../../lib/supabase";
import { sumPosCogsByDept, createJournalForPosOrder, getDefaultGlAccounts } from "../../../lib/journal";
import { resolveJournalAccountSettings } from "../../../lib/journalAccountSettings";
import { insertPaymentWithMethodCompat } from "../../../lib/paymentMethod";
import type { OfflineRetailLine, OfflineRetailPayment } from "../../../lib/retailOfflineQueue";
import { desktopApi } from "../../../lib/desktopApi";
import { persistRetailSaleLedger, type SaleCustomerContext } from "./checkoutService";
import { postClearingSettlementAfterRetailSale } from "../../../lib/clearingRetailSettlement";
import { fetchServiceConsumableCogsLines, fetchServiceConsumableStockMoves } from "../../../lib/serviceConsumableCogs";

interface RetailCustomerLite {
  id: string;
  credit_limit?: number | null;
  current_credit_balance?: number | null;
}

interface DepartmentLite {
  id: string;
  name: string;
}

export interface PosAgentCommissionContext {
  agentId: string | null;
  agentName: string | null;
  commissionPerUnit: number;
  commissionAmount: number;
  transportCost: number;
  netAmountDue: number;
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
  /** When set, links the sale to a clinic patient for dispensing history / receipts. */
  clinicDispensing?: {
    clinicPatientId: string | null;
    clinicDiagnosisSnapshot: string | null;
  } | null;
  /** Clinic dispensing workspace (`clinic_pos` route), not shop-floor retail POS. */
  clinicPos?: boolean;
  saleAt: string;
  agentCommission?: PosAgentCommissionContext | null;
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
    clinicDispensing,
    clinicPos = false,
    saleAt,
    agentCommission,
  } = args;

  const paymentSource = clinicPos || clinicDispensing?.clinicPatientId ? "pos_clinic" : "pos_retail";

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
      clinic_patient_id: clinicDispensing?.clinicPatientId ?? null,
      clinic_diagnosis_snapshot: clinicDispensing?.clinicDiagnosisSnapshot ?? null,
      total_amount: total,
      sales_agent_id: agentCommission?.agentId ?? null,
      sales_agent_name: agentCommission?.agentName ?? null,
      agent_commission_per_unit: agentCommission?.commissionPerUnit ?? 0,
      agent_commission_amount: agentCommission?.commissionAmount ?? 0,
      transport_cost: agentCommission?.transportCost ?? 0,
      net_amount_due: agentCommission?.netAmountDue ?? total,
      amount_paid: amountPaid,
      amount_due: amountDue,
      change_amount: changeDue,
      payment_status: paymentStatus,
      sale_type: saleType,
      credit_due_date: creditDueDate || null,
      sale_at: saleAt,
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
        reference: t.reference ?? null,
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
  const consumableCogs =
    organizationId && lines.some((l) => !(l.trackInventory ?? true) && l.productId)
      ? await fetchServiceConsumableCogsLines(
          organizationId,
          lines.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            trackInventory: i.trackInventory ?? true,
          }))
        )
      : [];
  const cogsByDept = sumPosCogsByDept(
    [
      ...lines
        .filter((i) => i.trackInventory ?? true)
        .map((i) => ({
          quantity: i.quantity,
          unitCost: Number(i.costPrice ?? 0),
          departmentId: i.departmentId ?? null,
        })),
      ...consumableCogs,
    ],
    deptNameById
  );
  const acc = await getDefaultGlAccounts();
  const receiptGlForTender = (tender: OfflineRetailPayment) =>
    tender.glAccountId ||
    (tender.method === "cash"
      ? acc.cash
      : tender.method === "bank_transfer" || tender.method === "card"
        ? acc.posBank ?? acc.cash
        : tender.method === "airtel_money"
          ? acc.posAirtelMoney ?? acc.posMtnMobileMoney ?? acc.cash
          : acc.posMtnMobileMoney ?? acc.cash);
  const settlementTotal = agentCommission?.netAmountDue ?? total;
  let journalReceiptRemaining = settlementTotal;
  const receiptLines = tenders
    .filter((tender) => tender.status === "completed" && tender.amount > 0)
    .map((tender) => {
      const amount = Math.max(0, Math.min(tender.amount, journalReceiptRemaining));
      journalReceiptRemaining = Math.max(0, journalReceiptRemaining - amount);
      return {
        glAccountId: receiptGlForTender(tender),
        amount,
        description: `Retail sale receipt - ${tender.method.replace(/_/g, " ")}`,
      };
    })
    .filter((line) => line.amount > 0);
  const journalLines: Array<{ gl_account_id: string; debit: number; credit: number; line_description: string }> = [];
  if (
    receiptLines.some((line) => !line.glAccountId) ||
    !acc.revenue ||
    ((agentCommission?.commissionAmount ?? 0) > 0 && !acc.commissionExpense) ||
    ((agentCommission?.transportCost ?? 0) > 0 && !acc.transportExpense)
  ) {
    throw new Error(
      "POS sale cannot be posted because the receipt, sales revenue, or Commission Expense GL account is missing. Configure Admin > Journal account settings."
    );
  }
  {
    journalLines.push(
      ...receiptLines.map((line) => ({
        gl_account_id: line.glAccountId!,
        debit: line.amount,
        credit: 0,
        line_description: line.description,
      })),
      { gl_account_id: acc.revenue, debit: 0, credit: total, line_description: "Retail sales" }
    );
    if (amountDue > 0.001) {
      if (!acc.receivable) throw new Error("POS receivable GL account is missing.");
      journalLines.push({
        gl_account_id: acc.receivable,
        debit: amountDue,
        credit: 0,
        line_description: "Retail sale outstanding balance",
      });
    }
    if ((agentCommission?.commissionAmount ?? 0) > 0.001) {
      journalLines.push({
        gl_account_id: acc.commissionExpense!,
        debit: agentCommission!.commissionAmount,
        credit: 0,
        line_description: agentCommission!.agentName ? `Agent commission - ${agentCommission!.agentName}` : "Agent commission",
      });
    }
    if ((agentCommission?.transportCost ?? 0) > 0.001) {
      journalLines.push({
        gl_account_id: acc.transportExpense!,
        debit: agentCommission!.transportCost,
        credit: 0,
        line_description: agentCommission!.agentName ? `Transport cost - ${agentCommission!.agentName}` : "POS transport cost",
      });
    }
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
  const paymentPayload = tenders.map((t) => ({ method: t.method, amount: t.amount, status: t.status, reference: t.reference ?? null, gl_account_id: t.glAccountId ?? null }));
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
      p_journal_entry_date: saleAt.slice(0, 10),
      p_journal_description: lines.map((i) => `${i.quantity}x ${i.name}`).join(", ") || "Retail POS sale",
      p_journal_lines: journalLines,
      p_clinic_patient_id: clinicDispensing?.clinicPatientId ?? null,
      p_clinic_diagnosis_snapshot: clinicDispensing?.clinicDiagnosisSnapshot ?? null,
    });
    if (!atomicErr) {
      const { error: saleSnapshotError } = await supabase
        .from("retail_sales")
        .update({
          sale_type: saleType,
          credit_due_date: creditDueDate || null,
          sale_at: saleAt,
          sales_agent_id: agentCommission?.agentId ?? null,
          sales_agent_name: agentCommission?.agentName ?? null,
          agent_commission_per_unit: agentCommission?.commissionPerUnit ?? 0,
           agent_commission_amount: agentCommission?.commissionAmount ?? 0,
           transport_cost: agentCommission?.transportCost ?? 0,
          net_amount_due: settlementTotal,
        })
        .eq("id", saleId);
      if (saleSnapshotError) throw saleSnapshotError;
      await Promise.all([
        supabase.from("payments").update({ paid_at: saleAt }).eq("transaction_id", saleId),
        supabase.from("retail_sale_payments").update({ paid_at: saleAt }).eq("sale_id", saleId),
        supabase.from("product_stock_movements").update({ movement_date: saleAt }).eq("source_type", "sale").eq("source_id", saleId),
      ]);
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
    clinicPatientId: clinicDispensing?.clinicPatientId ?? null,
    clinicDiagnosisSnapshot: clinicDispensing?.clinicDiagnosisSnapshot ?? null,
    saleAt,
  });
  if (persistedNewSale) {
    const { error: saleSnapshotError } = await supabase.from("retail_sales").update({
      sales_agent_id: agentCommission?.agentId ?? null,
      sales_agent_name: agentCommission?.agentName ?? null,
      agent_commission_per_unit: agentCommission?.commissionPerUnit ?? 0,
      agent_commission_amount: agentCommission?.commissionAmount ?? 0,
      transport_cost: agentCommission?.transportCost ?? 0,
      net_amount_due: settlementTotal,
    }).eq("id", saleId);
    if (saleSnapshotError) throw saleSnapshotError;
    runClearingHook();
  }
  await bumpCustomerCreditExposure();
  for (const tender of tenders) {
    const { error: paymentError } = await insertPaymentWithMethodCompat(
      supabase,
      {
        stay_id: null,
        ...(organizationId ? { organization_id: organizationId } : {}),
        payment_source: paymentSource,
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
          mobile_money_tx_ref: tender.reference ?? null,
          gateway_transaction_id: tender.gatewayTransactionId ?? null,
          receipt_gl_account_id: tender.glAccountId ?? null,
          sales_agent_id: agentCommission?.agentId ?? null,
          sales_agent_name: agentCommission?.agentName ?? null,
          agent_commission_amount: agentCommission?.commissionAmount ?? 0,
          transport_cost: agentCommission?.transportCost ?? 0,
          net_amount_due: settlementTotal,
        },
        paid_at: saleAt,
      },
      tender.method
    );
    if (paymentError) throw paymentError;
  }

  const consumableMoves =
    organizationId && lines.some((l) => !(l.trackInventory ?? true) && l.productId)
      ? await fetchServiceConsumableStockMoves(
          organizationId,
          saleId,
          lines.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            trackInventory: i.trackInventory ?? true,
          }))
        )
      : [];
  const stockMoves = [
    ...lines
      .filter((i) => i.trackInventory)
      .map((i) => ({
        product_id: i.productId,
        source_type: "sale",
        source_id: saleId,
        quantity_in: 0,
        quantity_out: i.quantity,
        unit_cost: i.costPrice,
      note: "Retail POS sale",
      movement_date: saleAt,
      })),
    ...consumableMoves,
  ];
  if (stockMoves.length > 0) {
    const { error: stockErr } = await supabase.from("product_stock_movements").insert(stockMoves);
    if (stockErr) throw stockErr;
  }

  const description = lines.map((i) => `${i.quantity}x ${i.name}`).join(", ");
  const js = await resolveJournalAccountSettings(organizationId ?? undefined);
  const vatRate = js.default_vat_percent;
  const useVatJournal = posVatEnabled && vatRate != null && Number.isFinite(vatRate) && vatRate > 0;
  const jr = await createJournalForPosOrder(saleId, total, description || "Retail POS sale", saleAt, staffRow?.id ?? null, {
    paymentMethod: tenders[0]?.method ?? "cash",
    amountPaid,
    settlementTotal,
    agentCommissionAmount: agentCommission?.commissionAmount ?? 0,
    commissionExpenseGlAccountId: acc.commissionExpense,
    transportCostAmount: agentCommission?.transportCost ?? 0,
    transportExpenseGlAccountId: acc.transportExpense,
    receiptLines: receiptLines.map((line) => ({
      glAccountId: line.glAccountId!,
      amount: line.amount,
      description: line.description,
    })),
    cogsByDept,
    vatRatePercent: useVatJournal ? vatRate : undefined,
    organizationId: organizationId ?? null,
  });
  if (!jr.ok) alert(`Sale recorded but journal was not posted: ${jr.error}`);
}
