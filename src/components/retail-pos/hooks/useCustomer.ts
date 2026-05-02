import { useMemo, useState } from "react";

interface RetailCustomerLike {
  id: string;
  name: string;
}

export function useCustomer<T extends RetailCustomerLike>(customers: T[]) {
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerNameDraft, setCustomerNameDraft] = useState("");
  const [customerPhoneDraft, setCustomerPhoneDraft] = useState("");
  const [savingCustomer, setSavingCustomer] = useState(false);

  const posCustomerSummary = useMemo(() => {
    const fromDraft = customerNameDraft.trim();
    if (fromDraft) return fromDraft;
    if (selectedCustomerId) {
      return customers.find((c) => c.id === selectedCustomerId)?.name?.trim() || "Selected";
    }
    return "";
  }, [customerNameDraft, selectedCustomerId, customers]);

  const clearCustomer = () => {
    setSelectedCustomerId("");
    setCustomerNameDraft("");
    setCustomerPhoneDraft("");
  };

  return {
    selectedCustomerId,
    setSelectedCustomerId,
    customerNameDraft,
    setCustomerNameDraft,
    customerPhoneDraft,
    setCustomerPhoneDraft,
    savingCustomer,
    setSavingCustomer,
    posCustomerSummary,
    clearCustomer,
  };
}
