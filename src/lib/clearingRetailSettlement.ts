import { supabase } from "@/lib/supabase";

function clearingRetailEnabled(): boolean {
  const v = import.meta.env.VITE_CLEARING_RETAIL_SETTLEMENT?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/**
 * After a retail sale is persisted, optionally notify the SACCO clearing engine (separate Supabase + boat-server).
 * Requires: Edge Function `clearing-retail-settlement` deployed, org columns `clearing_*_sacco_id`, and env
 * `VITE_CLEARING_RETAIL_SETTLEMENT=true`. Failures are non-fatal for the sale.
 */
export async function postClearingSettlementAfterRetailSale(params: {
  organizationId: string | undefined;
  saleId: string;
  amountPaid: number;
  paymentStatus: string;
}): Promise<void> {
  if (!clearingRetailEnabled()) return;
  if (!params.organizationId) return;
  if (!params.saleId || !Number.isFinite(params.amountPaid) || params.amountPaid <= 0) return;

  const { data, error } = await supabase.functions.invoke("clearing-retail-settlement", {
    body: {
      sale_id: params.saleId,
      amount_paid: params.amountPaid,
      payment_status: params.paymentStatus,
      organization_id: params.organizationId,
    },
  });

  if (error) {
    throw new Error(error.message || "clearing-retail-settlement invoke failed");
  }

  const payload = data as { ok?: boolean; skipped?: boolean; error?: string; reason?: string } | null;
  if (payload && payload.ok === false) {
    throw new Error(payload.error || "clearing settlement rejected");
  }
}
