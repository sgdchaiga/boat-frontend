import { CreditCard, Loader2, Printer, ShoppingCart, User } from "lucide-react";
import { PAYMENT_METHOD_SELECT_OPTIONS, type PaymentMethodCode } from "../../../lib/paymentMethod";
import { useState } from "react";

interface CustomerLike {
  id: string;
  name: string;
  phone: string | null;
}

interface PaymentLineLike {
  id: string;
  method: PaymentMethodCode;
  amount: number;
  status: "pending" | "completed";
}

type PaymentFeedbackStatus = "idle" | "waiting" | "success" | "failed";

interface CashierPaymentPanelProps {
  total: number;
  posCustomerSummary: string;
  selectedCustomerId: string;
  setSelectedCustomerId: (id: string) => void;
  customers: CustomerLike[];
  setCustomerNameDraft: (name: string) => void;
  setCustomerPhoneDraft: (phone: string) => void;
  customerNameDraft: string;
  customerPhoneDraft: string;
  clearCustomer: () => void;
  saveCustomerProfile: () => void;
  savingCustomer: boolean;
  readOnly: boolean;
  paymentMode: "simple" | "advanced";
  setPaymentMode: (mode: "simple" | "advanced") => void;
  canUseAdvancedPayments: boolean;
  clearPayments: () => void;
  addQuickPayment: (method: PaymentMethodCode) => void;
  paymentAmountDraft: string;
  setPaymentAmountDraft: (value: string) => void;
  addPaymentLine: () => void;
  paymentLines: PaymentLineLike[];
  updatePaymentLine: (id: string, patch: Partial<{ method: PaymentMethodCode; amount: number }>) => void;
  removePaymentLine: (id: string) => void;
  amountPaid: number;
  amountDue: number;
  changeDue: number;
  paymentStatus: string;
  paymentFeedbackStatus: PaymentFeedbackStatus;
  paymentFeedbackMessage: string;
  retryPendingCount: number;
  onRetryPending: () => void;
  processing: boolean;
  checkout: () => void;
  autoPrintReceipt: boolean;
  setAutoPrintReceipt: (value: boolean) => void;
  offlineQueueCount: number;
  syncingOfflineQueue: boolean;
  atomicRpcStatus: "checking" | "available" | "unavailable";
  atomicFallbackCount: number;
  printRetailReceipt: () => void;
  hasReceipt: boolean;
  activePanelTab: "payment" | "customer" | "notes";
}

export function CashierPaymentPanel({
  total,
  posCustomerSummary,
  selectedCustomerId,
  setSelectedCustomerId,
  customers,
  setCustomerNameDraft,
  setCustomerPhoneDraft,
  customerNameDraft,
  customerPhoneDraft,
  clearCustomer,
  saveCustomerProfile,
  savingCustomer,
  readOnly,
  paymentMode,
  setPaymentMode,
  canUseAdvancedPayments,
  clearPayments,
  addQuickPayment,
  paymentAmountDraft,
  setPaymentAmountDraft,
  addPaymentLine,
  paymentLines,
  updatePaymentLine,
  removePaymentLine,
  amountPaid,
  amountDue,
  changeDue,
  paymentStatus,
  paymentFeedbackStatus,
  paymentFeedbackMessage,
  retryPendingCount,
  onRetryPending,
  processing,
  checkout,
  autoPrintReceipt,
  setAutoPrintReceipt,
  offlineQueueCount,
  syncingOfflineQueue,
  atomicRpcStatus,
  atomicFallbackCount,
  printRetailReceipt,
  hasReceipt,
  activePanelTab,
}: CashierPaymentPanelProps) {
  const [showCustomerModal, setShowCustomerModal] = useState(false);

  return (
    <div className="lg:col-span-3 bg-white rounded-xl border border-slate-200 p-3 h-full min-h-0 overflow-y-auto">
      <h2 className="text-base font-bold text-slate-900 mb-2 flex flex-wrap items-center gap-2">
        <ShoppingCart className="w-5 h-5 shrink-0" />
        Payment
      </h2>

      <div className="mb-2 rounded-xl bg-slate-900 text-white px-3 py-3 text-center">
        <p className="text-[11px] uppercase tracking-wide text-slate-300">TOTAL</p>
        <p className="text-5xl font-extrabold tabular-nums mt-1">{total.toFixed(2)}</p>
      </div>
      <div className="mb-2 grid grid-cols-1 gap-1">
        <div className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm flex justify-between">
          <span className="text-slate-600">PAID</span>
          <strong className="tabular-nums">{amountPaid.toFixed(2)}</strong>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm flex justify-between">
          <span className="text-emerald-700">CHANGE</span>
          <strong className="tabular-nums text-emerald-800">{changeDue.toFixed(2)}</strong>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm flex justify-between">
          <span className="text-red-700">BALANCE</span>
          <strong className="tabular-nums text-red-800">{amountDue.toFixed(2)}</strong>
        </div>
      </div>

      <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex items-center gap-2">
          <User className="w-4 h-4 shrink-0 text-slate-600" />
          <span className="text-sm text-slate-800 truncate flex-1">{posCustomerSummary || "Walk-in customer"}</span>
          <button
            type="button"
            onClick={() => setShowCustomerModal(true)}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
          >
            {selectedCustomerId ? "Change" : "+ Add"}
          </button>
        </div>
      </div>

      {activePanelTab === "customer" && (
        <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
          <p className="text-xs text-slate-700 mb-2">Customer: {posCustomerSummary || "Walk-in customer"}</p>
          <button
            type="button"
            onClick={() => setShowCustomerModal(true)}
            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            Open customer details
          </button>
        </div>
      )}
      {activePanelTab === "notes" && <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">Notes panel ready for cashier annotations.</div>}

      {activePanelTab === "payment" && (
        <>
      <div className="mb-2">
        <div className={`grid gap-2 mb-2 ${canUseAdvancedPayments ? "grid-cols-2" : "grid-cols-1"}`}>
          <button
            type="button"
            onClick={() => setPaymentMode("simple")}
            className={`rounded-lg border py-2 text-xs font-semibold ${paymentMode === "simple" ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-700"}`}
          >
            Simple
          </button>
          {canUseAdvancedPayments && (
            <button
              type="button"
              onClick={() => setPaymentMode("advanced")}
              className={`rounded-lg border py-2 text-xs font-semibold ${paymentMode === "advanced" ? "border-slate-800 bg-slate-900 text-white" : "border-slate-300 text-slate-700"}`}
            >
              Advanced
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <button type="button" onClick={() => addQuickPayment("cash")} className="rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 py-2.5 font-bold">
          CASH
        </button>
        <button type="button" onClick={() => addQuickPayment("mtn_mobile_money")} className="rounded-lg border border-sky-300 bg-sky-50 text-sky-800 py-2.5 font-bold">
          MTN MOMO
        </button>
        <button type="button" onClick={() => addQuickPayment("airtel_money")} className="rounded-lg border border-amber-300 bg-amber-50 text-amber-800 py-2.5 font-bold">
          AIRTEL
        </button>
        <button type="button" onClick={() => addQuickPayment("card")} className="rounded-lg border border-purple-300 bg-purple-50 text-purple-800 py-2.5 font-bold">
          CARD
        </button>
      </div>
      {paymentMode === "simple" && (
        <button
          type="button"
          onClick={clearPayments}
          className="mb-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Clear paid amount
        </button>
      )}

      {canUseAdvancedPayments && paymentMode === "advanced" && (
        <>
          <div className="flex items-center gap-2 mb-2">
            <input
              type="number"
              step="0.01"
              min="0"
              value={paymentAmountDraft}
              onChange={(e) => setPaymentAmountDraft(e.target.value)}
              placeholder="Amount"
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
            <button type="button" onClick={addPaymentLine} className="app-btn-primary text-sm" disabled={readOnly}>
              Add
            </button>
          </div>
          <div className="space-y-1 mb-2">
            {paymentLines.map((line) => (
              <div key={line.id} className="grid grid-cols-12 items-center gap-2 text-xs border border-slate-200 rounded px-2 py-1.5">
                <select
                  value={line.method}
                  onChange={(e) => updatePaymentLine(line.id, { method: e.target.value as PaymentMethodCode })}
                  className="col-span-6 border border-slate-300 rounded px-2 py-1 text-xs"
                >
                  {PAYMENT_METHOD_SELECT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={line.amount}
                  onChange={(e) => updatePaymentLine(line.id, { amount: Number(e.target.value || 0) })}
                  className="col-span-3 border border-slate-300 rounded px-2 py-1 text-xs"
                />
                <span className="col-span-2 text-[11px] text-slate-500 text-right">{line.status}</span>
                <button type="button" onClick={() => removePaymentLine(line.id)} className="text-red-600 hover:underline">
                  Remove
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      </>
      )}
      <div className="text-xs text-slate-700 mb-2"><p className="capitalize">Status: {paymentStatus}</p></div>
      {paymentFeedbackStatus !== "idle" && (
        <div
          className={`mb-2 rounded-lg border px-3 py-2 text-xs font-medium ${
            paymentFeedbackStatus === "waiting"
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : paymentFeedbackStatus === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {paymentFeedbackMessage}
        </div>
      )}
      {paymentFeedbackStatus === "failed" && retryPendingCount > 0 && (
        <button
          type="button"
          onClick={onRetryPending}
          className="mb-2 w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100"
        >
          Retry payment
        </button>
      )}

      <button
        type="button"
        disabled={processing || readOnly}
        onClick={checkout}
        className="app-btn-primary w-full py-3.5 text-lg font-extrabold disabled:cursor-not-allowed"
      >
        {processing ? <Loader2 className="w-5 h-5 animate-spin" /> : <CreditCard className="w-5 h-5" />}
        {processing ? "Processing..." : "Complete Sale"}
      </button>
      <label className="mt-2 flex items-center gap-2 text-xs text-slate-700">
        <input
          type="checkbox"
          checked={autoPrintReceipt}
          onChange={(e) => setAutoPrintReceipt(e.target.checked)}
          className="rounded border-slate-300"
          disabled
        />
        Auto print disabled for fast checkout
      </label>
      <p className="text-xs text-slate-600 mt-2">
        Offline queue: {offlineQueueCount}
        {syncingOfflineQueue ? " (syncing...)" : ""}
      </p>
      <div className="mt-2 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-slate-50">
        <p>
          Atomic checkout:{" "}
          <span className={atomicRpcStatus === "available" ? "text-emerald-700" : atomicRpcStatus === "unavailable" ? "text-amber-700" : "text-slate-600"}>
            {atomicRpcStatus}
          </span>
        </p>
        <p>Legacy fallback count: {atomicFallbackCount}</p>
      </div>

      <button
        type="button"
        onClick={printRetailReceipt}
        disabled={!hasReceipt}
        className="w-full mt-2 border border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-700 py-2 rounded-lg font-medium text-sm flex items-center justify-center gap-2"
      >
        <Printer className="w-4 h-4" />
        {hasReceipt ? "Print Receipt" : "Print Receipt (after sale)"}
      </button>

      {showCustomerModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl bg-white border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-900">Customer details</h3>
              <button
                type="button"
                onClick={() => setShowCustomerModal(false)}
                className="text-xs rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
            <select
              value={selectedCustomerId}
              onChange={(e) => {
                const nextId = e.target.value;
                setSelectedCustomerId(nextId);
                const selected = customers.find((c) => c.id === nextId);
                if (selected) {
                  setCustomerNameDraft(selected.name);
                  setCustomerPhoneDraft(selected.phone || "");
                  setShowCustomerModal(false);
                }
              }}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2"
            >
              <option value="">Walk-in customer</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.phone ? ` (${c.phone})` : ""}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-1 gap-2">
              <input
                value={customerNameDraft}
                onChange={(e) => setCustomerNameDraft(e.target.value)}
                placeholder="+ Add customer name"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
              <input
                value={customerPhoneDraft}
                onChange={(e) => setCustomerPhoneDraft(e.target.value)}
                placeholder="Phone (optional)"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  clearCustomer();
                  setShowCustomerModal(false);
                }}
                className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
              >
                Walk-in
              </button>
              <button
                type="button"
                onClick={async () => {
                  await Promise.resolve(saveCustomerProfile());
                  setShowCustomerModal(false);
                }}
                disabled={savingCustomer || readOnly}
                className="col-span-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                {savingCustomer ? "Saving..." : selectedCustomerId ? "Update" : "+ Add"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
