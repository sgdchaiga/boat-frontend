import { supabase } from "./supabase";

/** `approved` = approved GRN/bill, no vendor payment recorded yet (not past due). */
export type BillWorkflowStatus = "pending_approval" | "approved" | "paid" | "overdue" | "partially_paid";
export type BillPaymentReconciliation = {
  paidTotal: number;
  paidOffDate: string | null;
  lastPaymentDate: string | null;
  paymentCount: number;
};

/** Parse bill_allocations JSON from vendor_payments.bill_allocations. */
export function parseBillAllocationsJson(json: unknown): { bill_id: string; amount: number }[] {
  if (!json || !Array.isArray(json)) return [];
  const out: { bill_id: string; amount: number }[] = [];
  for (const row of json) {
    if (!row || typeof row !== "object") continue;
    const r = row as { bill_id?: string; amount?: unknown };
    if (!r.bill_id) continue;
    const a = Number(r.amount);
    if (!Number.isFinite(a) || a <= 0) continue;
    out.push({ bill_id: r.bill_id, amount: a });
  }
  return out;
}

/** Reconciles unique payment-to-bill allocations and identifies when each bill first became fully paid. */
export async function getBillPaymentReconciliationForOrganization(
  organizationId: string,
  bills: Array<{ id: string; amount?: number | null }>
): Promise<Map<string, BillPaymentReconciliation>> {
  const result = new Map<string, BillPaymentReconciliation>();
  bills.forEach((bill) => result.set(bill.id, { paidTotal: 0, paidOffDate: null, lastPaymentDate: null, paymentCount: 0 }));
  if (bills.length === 0) return result;

  const { data: payments, error } = await supabase
    .from("vendor_payments")
    .select("id,bill_id,amount,payment_date,created_at,bill_allocations")
    .eq("organization_id", organizationId);
  if (error) throw error;

  const paymentRows = (payments || []) as Array<{
    id: string;
    bill_id?: string | null;
    amount?: number | null;
    payment_date?: string | null;
    created_at?: string | null;
    bill_allocations?: unknown;
  }>;
  const paymentDates = new Map(paymentRows.map((payment) => [payment.id, payment.payment_date || payment.created_at?.slice(0, 10) || ""]));
  const allocations = new Map<string, { paymentId: string; billId: string; amount: number; date: string }>();
  const addAllocation = (paymentId: string, billId: string, amount: number) => {
    if (!result.has(billId) || !Number.isFinite(amount) || amount <= 0) return;
    const key = `${paymentId}:${billId}`;
    const current = allocations.get(key);
    // Compatibility schemas may contain the same allocation in JSON and the allocation table.
    if (!current || amount > current.amount) allocations.set(key, { paymentId, billId, amount, date: paymentDates.get(paymentId) || "" });
  };

  paymentRows.forEach((payment) => {
    if (payment.bill_id) addAllocation(payment.id, payment.bill_id, Number(payment.amount || 0));
    parseBillAllocationsJson(payment.bill_allocations).forEach((allocation) => addAllocation(payment.id, allocation.bill_id, allocation.amount));
  });

  const billIds = bills.map((bill) => bill.id);
  for (let index = 0; index < billIds.length; index += IN_CHUNK) {
    const { data: rows, error: allocationError } = await supabase
      .from("vendor_payment_bill_allocations")
      .select("vendor_payment_id,bill_id,amount")
      .in("bill_id", billIds.slice(index, index + IN_CHUNK));
    if (allocationError) continue;
    (rows || []).forEach((row: { vendor_payment_id: string; bill_id: string; amount: number }) =>
      addAllocation(row.vendor_payment_id, row.bill_id, Number(row.amount || 0))
    );
  }

  const targetByBill = new Map(bills.map((bill) => [bill.id, Number(bill.amount || 0)]));
  const grouped = new Map<string, Array<{ amount: number; date: string }>>();
  allocations.forEach((allocation) => {
    const rows = grouped.get(allocation.billId) || [];
    rows.push({ amount: allocation.amount, date: allocation.date });
    grouped.set(allocation.billId, rows);
  });
  grouped.forEach((rows, billId) => {
    const ordered = [...rows].sort((left, right) => left.date.localeCompare(right.date));
    let running = 0;
    let paidOffDate: string | null = null;
    ordered.forEach((row) => {
      running += row.amount;
      if (!paidOffDate && running >= (targetByBill.get(billId) || 0) - 0.001) paidOffDate = row.date || null;
    });
    result.set(billId, {
      paidTotal: running,
      paidOffDate,
      lastPaymentDate: ordered[ordered.length - 1]?.date || null,
      paymentCount: ordered.length,
    });
  });
  return result;
}

/** Total applied to a bill: legacy bill_id + bill_allocations JSON + optional old allocation table. */
export async function getTotalPaidForBill(billId: string): Promise<number> {
  const vpRes = await supabase.from("vendor_payments").select("amount").eq("bill_id", billId);
  const fromVp = (vpRes.data || []).reduce((s, r) => s + Number((r as { amount?: number }).amount || 0), 0);

  const { data: billRow } = await supabase.from("bills").select("vendor_id").eq("id", billId).maybeSingle();
  const vendorId = (billRow as { vendor_id?: string | null } | null)?.vendor_id;
  let fromJson = 0;
  if (vendorId) {
    const bulkRes = await supabase
      .from("vendor_payments")
      .select("bill_allocations")
      .eq("vendor_id", vendorId)
      .not("bill_allocations", "is", null);
    if (!bulkRes.error) {
      for (const row of bulkRes.data || []) {
        for (const s of parseBillAllocationsJson((row as { bill_allocations?: unknown }).bill_allocations)) {
          if (s.bill_id === billId) fromJson += s.amount;
        }
      }
    }
  }

  let fromTable = 0;
  const alRes = await supabase.from("vendor_payment_bill_allocations").select("amount").eq("bill_id", billId);
  if (!alRes.error) {
    fromTable = (alRes.data || []).reduce((s, r) => s + Number((r as { amount?: number }).amount || 0), 0);
  }

  return fromVp + fromJson + fromTable;
}

export function isBillApproved(b: { approved_at?: string | null; status?: string | null }): boolean {
  const s = (b.status || "").toLowerCase();
  if (s === "rejected" || s === "cancelled" || s === "reversed" || s === "void" || s === "voided") return false;
  if (b.approved_at) return true;
  if (s === "pending_approval" || s === "pending") return false;
  if (s === "approved" || s === "paid" || s === "overdue" || s === "partially_paid") return true;
  return Boolean(s && s !== "pending_approval" && s !== "pending");
}

export function computeBillStatus(
  bill: { amount: number; due_date: string | null },
  totalPaid: number,
  approved: boolean
): BillWorkflowStatus {
  if (!approved) return "pending_approval";
  const amt = Number(bill.amount || 0);
  const paid = Number(totalPaid || 0);
  if (amt <= 0) return paid > 0 ? "paid" : "approved";

  if (paid >= amt - 0.001) return "paid";

  const due = bill.due_date ? new Date(`${bill.due_date}T12:00:00`) : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (due) due.setHours(0, 0, 0, 0);
  const pastDue = Boolean(due && due < today);

  if (paid <= 0.001) {
    if (pastDue) return "overdue";
    return "approved";
  }

  if (pastDue) return "overdue";
  return "partially_paid";
}

export async function syncBillStatusInDb(billId: string): Promise<void> {
  const { data: bill } = await supabase
    .from("bills")
    .select("id, amount, due_date, approved_at, status")
    .eq("id", billId)
    .maybeSingle();
  if (!bill) return;
  const prevStatus = String((bill as { status?: string | null }).status || "").toLowerCase();
  if (prevStatus === "rejected" || prevStatus === "cancelled" || prevStatus === "reversed" || prevStatus === "void" || prevStatus === "voided") return;
  const total = await getTotalPaidForBill(billId);
  const approved = isBillApproved(bill as { approved_at?: string | null; status?: string | null });
  const status = computeBillStatus(
    {
      amount: Number((bill as { amount: number }).amount),
      due_date: (bill as { due_date: string | null }).due_date,
    },
    total,
    approved
  );
  const prev = String((bill as { status?: string | null }).status || "").toLowerCase();
  if (status === prev) return;
  await supabase.from("bills").update({ status }).eq("id", billId);
}

const IN_CHUNK = 300;

/**
 * Recomputes payable status for all bills in an organization using a small number of queries.
 * Replaces per-bill syncBillStatusInDb (N bills × many round-trips) for list views like GRN/Bills.
 */
export async function syncBillStatusesForOrganization(organizationId: string): Promise<void> {
  const { data: bills, error: billsErr } = await supabase
    .from("bills")
    .select("id, amount, due_date, approved_at, status, vendor_id")
    .eq("organization_id", organizationId);
  if (billsErr || !bills?.length) return;

  const billIds = bills.map((b) => (b as { id: string }).id);

  const { data: vps } = await supabase
    .from("vendor_payments")
    .select("id, bill_id, amount, bill_allocations, vendor_id")
    .eq("organization_id", organizationId);

  /** Direct payment rows pointing at a single bill */
  const directByBill = new Map<string, number>();
  /** JSON allocations: per vendor, per bill — matches getTotalPaidForBill vendor filter */
  const jsonByVendor = new Map<string, Map<string, number>>();
  for (const row of vps || []) {
    const r = row as {
      bill_id?: string | null;
      amount?: number | null;
      bill_allocations?: unknown;
      vendor_id?: string | null;
    };
    if (r.bill_id) {
      const id = String(r.bill_id);
      directByBill.set(id, (directByBill.get(id) || 0) + Number(r.amount || 0));
    }
    const vid = r.vendor_id;
    if (vid && r.bill_allocations != null) {
      let m = jsonByVendor.get(vid);
      if (!m) {
        m = new Map();
        jsonByVendor.set(vid, m);
      }
      for (const s of parseBillAllocationsJson(r.bill_allocations)) {
        m.set(s.bill_id, (m.get(s.bill_id) || 0) + s.amount);
      }
    }
  }

  const allocByBill = new Map<string, number>();
  for (let i = 0; i < billIds.length; i += IN_CHUNK) {
    const slice = billIds.slice(i, i + IN_CHUNK);
    const { data: allocRows } = await supabase.from("vendor_payment_bill_allocations").select("bill_id, amount").in("bill_id", slice);
    for (const a of allocRows || []) {
      const ar = a as { bill_id: string; amount?: number };
      const bid = String(ar.bill_id);
      allocByBill.set(bid, (allocByBill.get(bid) || 0) + Number(ar.amount || 0));
    }
  }

  const updates: { id: string; status: BillWorkflowStatus }[] = [];
  for (const raw of bills) {
    const bill = raw as {
      id: string;
      amount: number | null;
      due_date: string | null;
      approved_at?: string | null;
      status?: string | null;
      vendor_id?: string | null;
    };
    const id = bill.id;
    const prevLower = String(bill.status || "").toLowerCase();
    if (prevLower === "rejected" || prevLower === "cancelled" || prevLower === "reversed" || prevLower === "void" || prevLower === "voided") continue;
    const direct = directByBill.get(id) || 0;
    let fromJson = 0;
    if (bill.vendor_id) {
      fromJson = jsonByVendor.get(bill.vendor_id)?.get(id) || 0;
    }
    const fromAlloc = allocByBill.get(id) || 0;
    const total = direct + fromJson + fromAlloc;
    const approved = isBillApproved(bill);
    const status = computeBillStatus(
      { amount: Number(bill.amount || 0), due_date: bill.due_date },
      total,
      approved
    );
    const prev = String(bill.status || "").toLowerCase();
    if (status !== prev) {
      updates.push({ id, status });
    }
  }

  if (updates.length === 0) return;

  const PAR = 25;
  for (let i = 0; i < updates.length; i += PAR) {
    const batch = updates.slice(i, i + PAR);
    await Promise.all(batch.map((u) => supabase.from("bills").update({ status: u.status }).eq("id", u.id)));
  }
}
