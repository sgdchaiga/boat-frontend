import { useMemo, useState } from "react";
import { randomUuid } from "../../../lib/randomUuid";
import type { PaymentMethodCode } from "../../../lib/paymentMethod";
import { toast } from "../../ui/use-toast";

type PaymentLine = { id: string; method: PaymentMethodCode; amount: number; status: "pending" | "completed" };
type PosPaymentStatus = "pending" | "partial" | "completed" | "overpaid";

const isPendingMethod = (method: PaymentMethodCode) => method === "mtn_mobile_money" || method === "airtel_money";

export function usePayments(total: number) {
  const [paymentMode, setPaymentMode] = useState<"simple" | "advanced">("simple");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodCode>("cash");
  const [paymentAmountDraft, setPaymentAmountDraft] = useState("");
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);

  const amountPaid = useMemo(() => paymentLines.reduce((sum, p) => sum + p.amount, 0), [paymentLines]);
  const hasPendingTender = useMemo(() => paymentLines.some((p) => p.status === "pending"), [paymentLines]);
  const amountDue = Math.max(0, Math.round((total - amountPaid) * 100) / 100);
  const changeDue = Math.max(0, Math.round((amountPaid - total) * 100) / 100);
  const paymentStatus: PosPaymentStatus =
    amountPaid === 0 ? (hasPendingTender ? "pending" : "pending") : amountPaid < total ? "partial" : amountPaid > total ? "overpaid" : "completed";
  const hasMobileTender = useMemo(
    () => paymentLines.some((p) => p.method === "mtn_mobile_money" || p.method === "airtel_money"),
    [paymentLines]
  );

  const addPaymentLine = () => {
    const parsed = Number(paymentAmountDraft);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast({ title: "Invalid payment amount", description: "Enter a valid amount greater than zero." });
      return;
    }
    const status = isPendingMethod(paymentMethod) ? "pending" : "completed";
    setPaymentLines((prev) => [...prev, { id: randomUuid(), method: paymentMethod, amount: Math.round(parsed * 100) / 100, status }]);
    setPaymentAmountDraft("");
  };

  const addQuickPayment = (method: PaymentMethodCode) => {
    const target = amountDue > 0 ? amountDue : total;
    if (target <= 0) {
      toast({ title: "Cart is empty", description: "Scan or add at least one item before payment." });
      return;
    }
    const status = isPendingMethod(method) ? "pending" : "completed";
    setPaymentMethod(method);
    const nextLine = { id: randomUuid(), method, amount: Math.round(target * 100) / 100, status };
    setPaymentLines((prev) => (paymentMode === "simple" ? [nextLine] : [...prev, nextLine]));
  };

  const removePaymentLine = (id: string) => {
    setPaymentLines((prev) => prev.filter((p) => p.id !== id));
  };

  const updatePaymentLine = (id: string, patch: Partial<{ method: PaymentMethodCode; amount: number }>) => {
    setPaymentLines((prev) =>
      prev.map((line) => {
        if (line.id !== id) return line;
        const nextMethod = patch.method ?? line.method;
        const nextAmount = patch.amount ?? line.amount;
        const nextStatus: "pending" | "completed" = isPendingMethod(nextMethod) ? "pending" : "completed";
        return { ...line, method: nextMethod, amount: Math.max(0, Math.round(nextAmount * 100) / 100), status: nextStatus };
      })
    );
  };

  const resetPayments = () => {
    setPaymentLines([]);
    setPaymentAmountDraft("");
  };

  return {
    paymentMode,
    setPaymentMode,
    paymentMethod,
    setPaymentMethod,
    paymentAmountDraft,
    setPaymentAmountDraft,
    paymentLines,
    setPaymentLines,
    amountPaid,
    amountDue,
    changeDue,
    paymentStatus,
    hasMobileTender,
    addPaymentLine,
    addQuickPayment,
    removePaymentLine,
    updatePaymentLine,
    resetPayments,
  };
}

export type { PaymentLine, PosPaymentStatus };
