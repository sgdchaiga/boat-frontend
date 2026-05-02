import { supabase } from "./supabase";

/** `approved` = approved GRN/bill, no vendor payment recorded yet (not past due). */
export type BillWorkflowStatus = "pending_approval" | "approved" | "paid" | "overdue" | "partially_paid";

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
  if (s === "rejected" || s === "cancelled") return false;
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
  if (prevStatus === "rejected" || prevStatus === "cancelled") return;
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
    if (prevLower === "rejected" || prevLower === "cancelled") continue;
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
