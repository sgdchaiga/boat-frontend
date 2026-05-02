import { supabase } from "../../../lib/supabase";
import { desktopApi } from "../../../lib/desktopApi";
import { toast } from "../../ui/use-toast";
import type { SaleCustomerContext } from "../services/checkoutService";
import type { Dispatch, SetStateAction } from "react";

interface RetailCustomerRow {
  id: string;
  name: string;
  phone: string | null;
  credit_limit?: number | null;
  current_credit_balance?: number | null;
}

interface UseCustomerProfileActionsArgs {
  useDesktopLocalMode: boolean;
  orgId?: string;
  selectedCustomerId: string;
  setSelectedCustomerId: (id: string) => void;
  customerNameDraft: string;
  setCustomerNameDraft: (name: string) => void;
  customerPhoneDraft: string;
  setCustomerPhoneDraft: (phone: string) => void;
  setCustomers: Dispatch<SetStateAction<RetailCustomerRow[]>>;
  setSavingCustomer: (saving: boolean) => void;
}

export function useCustomerProfileActions({
  useDesktopLocalMode,
  orgId,
  selectedCustomerId,
  setSelectedCustomerId,
  customerNameDraft,
  setCustomerNameDraft,
  customerPhoneDraft,
  setCustomerPhoneDraft,
  setCustomers,
  setSavingCustomer,
}: UseCustomerProfileActionsArgs) {
  const ensureLocalRetailCustomer = async (ctx: SaleCustomerContext): Promise<SaleCustomerContext> => {
    if (!useDesktopLocalMode) return ctx;
    const name = ctx.name?.trim() || "";
    const phone = ctx.phone?.trim() || null;
    if (!name) return { ...ctx, phone };
    try {
      if (ctx.id) {
        const updated = await desktopApi.updateRetailCustomer({ id: ctx.id, name, phone });
        if (updated?.id) {
          setCustomers((prev) => prev.map((row) => (row.id === ctx.id ? { ...row, name, phone } : row)));
        }
        return { id: ctx.id, name, phone };
      }
      const created = await desktopApi.createRetailCustomer({ name, phone });
      if (created?.id) {
        const nextRow: RetailCustomerRow = {
          id: String(created.id),
          name,
          phone,
          credit_limit: Number(created.credit_limit ?? 0),
          current_credit_balance: Number(created.current_credit_balance ?? 0),
        };
        setCustomers((prev) => [nextRow, ...prev]);
        setSelectedCustomerId(nextRow.id);
        return { id: nextRow.id, name, phone };
      }
    } catch (error) {
      console.error("Failed to persist local retail customer:", error);
      toast({ title: "Customer save failed", description: "Continuing sale without saving customer profile." });
    }
    return { ...ctx, name, phone };
  };

  const saveCustomerProfile = async () => {
    const name = customerNameDraft.trim();
    if (!name) {
      toast({ title: "Customer name required", description: "Enter customer name before saving." });
      return;
    }
    const phone = customerPhoneDraft.trim() || null;
    setSavingCustomer(true);
    try {
      if (useDesktopLocalMode) {
        const resolved = await ensureLocalRetailCustomer({ id: selectedCustomerId || null, name, phone });
        setSelectedCustomerId(resolved.id || "");
        setCustomerNameDraft(resolved.name || "");
        setCustomerPhoneDraft(resolved.phone || "");
        toast({ title: "Customer saved" });
        return;
      }
      if (!orgId) {
        toast({ title: "Organization missing", description: "Cannot save customer without organization context." });
        return;
      }
      if (selectedCustomerId) {
        const { data, error } = await supabase
          .from("retail_customers")
          .update({ name, phone })
          .eq("id", selectedCustomerId)
          .select("id,name,phone,credit_limit,current_credit_balance")
          .single();
        if (error) throw error;
        const updated = data as RetailCustomerRow;
        setCustomers((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
        setCustomerNameDraft(updated.name);
        setCustomerPhoneDraft(updated.phone || "");
      } else {
        const { data, error } = await supabase
          .from("retail_customers")
          .insert({ name, phone, organization_id: orgId, current_credit_balance: 0 })
          .select("id,name,phone,credit_limit,current_credit_balance")
          .single();
        if (error) throw error;
        const created = data as RetailCustomerRow;
        setCustomers((prev) => [created, ...prev]);
        setSelectedCustomerId(created.id);
        setCustomerNameDraft(created.name);
        setCustomerPhoneDraft(created.phone || "");
      }
      toast({ title: "Customer saved" });
    } catch (error) {
      console.error("Failed to save customer profile:", error);
      toast({ title: "Save failed", description: error instanceof Error ? error.message : "Try again." });
    } finally {
      setSavingCustomer(false);
    }
  };

  return { ensureLocalRetailCustomer, saveCustomerProfile };
}
