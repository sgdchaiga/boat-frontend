import React, { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type {
  SaccoTellerTransactionPatch,
  SaccoTellerTransactionRow,
  TellerMemberPickRow,
  TellerSavingsAccountPickRow,
} from "@/lib/saccoTellerDb";
import {
  TELLER_POSTING_PURPOSE_LABELS,
  type TellerPostingPurpose,
  canCorrectPostedTellerTxnType,
} from "@/lib/saccoTellerDb";
import { formatTxnTypeLabel } from "@/lib/saccoTellerConfig";
import { toBusinessDateString } from "@/lib/timezone";

type Props = {
  open: boolean;
  txn: SaccoTellerTransactionRow | null;
  members: TellerMemberPickRow[];
  savingsAccounts: TellerSavingsAccountPickRow[];
  onClose: () => void;
  onSave: (patch: SaccoTellerTransactionPatch, reason: string) => Promise<void>;
  saving?: boolean;
};

const field =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40";

function initialTxnDate(txn: SaccoTellerTransactionRow): string {
  const raw = txn.txn_date?.trim().slice(0, 10) ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return toBusinessDateString(txn.created_at);
}

export function SaccoEditTellerTransactionModal({
  open,
  txn,
  members,
  savingsAccounts,
  onClose,
  onSave,
  saving,
}: Props) {
  const [amount, setAmount] = useState("");
  const [txnType, setTxnType] = useState<"cash_deposit" | "cash_withdrawal">("cash_deposit");
  const [txnDate, setTxnDate] = useState("");
  const [narration, setNarration] = useState("");
  const [memberRef, setMemberRef] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [selectedSavingsAccountId, setSelectedSavingsAccountId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isPosted = txn?.status === "posted";
  const isEditable =
    txn?.status === "pending_approval" ||
    txn?.status === "draft" ||
    (txn?.status === "posted" && canCorrectPostedTellerTxnType(String(txn.txn_type)));

  const selectedMember = useMemo(
    () => (selectedMemberId ? members.find((m) => m.id === selectedMemberId) ?? null : null),
    [selectedMemberId, members]
  );

  const memberSavings = useMemo(
    () => savingsAccounts.filter((a) => a.sacco_member_id === selectedMemberId),
    [savingsAccounts, selectedMemberId]
  );

  const memberQueryLower = memberSearch.trim().toLowerCase();
  const memberMatches: TellerMemberPickRow[] = useMemo(() => {
    if (memberQueryLower.length < 1) return [];
    return members
      .filter(
        (m) =>
          m.member_number.toLowerCase().includes(memberQueryLower) || m.full_name.toLowerCase().includes(memberQueryLower)
      )
      .slice(0, 10);
  }, [memberQueryLower, members]);

  useEffect(() => {
    if (!txn) return;
    setAmount(String(txn.amount ?? ""));
    const t = String(txn.txn_type);
    setTxnType(t === "cash_withdrawal" ? "cash_withdrawal" : "cash_deposit");
    setTxnDate(initialTxnDate(txn));
    setNarration(txn.narration ?? "");
    setMemberRef(txn.member_ref ?? "");
    const mid = txn.sacco_member_id ?? "";
    setSelectedMemberId(mid);
    setSelectedSavingsAccountId(txn.sacco_member_savings_account_id ?? "");
    const mem = mid ? members.find((m) => m.id === mid) : null;
    setMemberSearch(mem ? `${mem.member_number} — ${mem.full_name}` : "");
    setReason("");
    setError(null);
  }, [txn, members]);

  useEffect(() => {
    if (!selectedSavingsAccountId) return;
    const acc = savingsAccounts.find((a) => a.id === selectedSavingsAccountId);
    if (acc && acc.sacco_member_id !== selectedMemberId) {
      setSelectedSavingsAccountId("");
    }
  }, [selectedMemberId, selectedSavingsAccountId, savingsAccounts]);

  if (!open || !txn) return null;

  const canFlipDepositWithdraw =
    String(txn.txn_type) === "cash_deposit" || String(txn.txn_type) === "cash_withdrawal";

  const applyRefLabel = (mem: TellerMemberPickRow, acc: TellerSavingsAccountPickRow | null) => {
    if (acc) {
      setMemberRef(`${acc.member_number} — ${acc.full_name} (${acc.account_number} · ${acc.savings_product_code})`);
    } else {
      setMemberRef(`${mem.member_number} — ${mem.full_name}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const reasonTrim = reason.trim();
    if (!reasonTrim) {
      setError("Reason is required for audit trail.");
      return;
    }
    const amt = parseFloat(amount);
    if (Number.isNaN(amt) || amt < 0) {
      setError("Enter a valid amount.");
      return;
    }
    const dateTrim = txnDate.trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateTrim)) {
      setError("Enter a valid transaction date.");
      return;
    }
    if (selectedSavingsAccountId) {
      const acc = savingsAccounts.find((a) => a.id === selectedSavingsAccountId);
      if (acc) {
        if (acc.sacco_member_id !== (selectedMemberId || null)) {
          setError("Savings account must belong to the selected member.");
          return;
        }
      } else if (selectedSavingsAccountId !== (txn.sacco_member_savings_account_id ?? "")) {
        setError("Savings account is not in the current list — refresh the page.");
        return;
      }
    }
    if (selectedMemberId) {
      const inList = members.some((m) => m.id === selectedMemberId);
      if (!inList && selectedMemberId !== (txn.sacco_member_id ?? "")) {
        setError("Selected member is not in the current list — refresh the page.");
        return;
      }
    }
    try {
      const patch: SaccoTellerTransactionPatch = {
        amount: amt,
        txn_date: dateTrim,
        narration: narration.trim() || null,
        member_ref: memberRef.trim() || null,
        sacco_member_id: selectedMemberId || null,
        sacco_member_savings_account_id: selectedSavingsAccountId || null,
      };
      if (canFlipDepositWithdraw && txnType !== String(txn.txn_type)) {
        patch.txn_type = txnType;
      }
      await onSave(patch, reasonTrim);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save changes.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" role="dialog" aria-modal>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">
            {isPosted ? "Correct transaction" : "Edit transaction"}
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {!isEditable ? (
          <p className="p-4 text-sm text-slate-600">
            {txn.status === "posted" && !canCorrectPostedTellerTxnType(String(txn.txn_type))
              ? "Corrections for vault and cheque transactions are not automated yet. Use support or manual journals."
              : `This transaction cannot be edited (${txn.status}).`}
          </p>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="p-4 space-y-3">
            <p className="text-xs text-slate-500">
              {isPosted
                ? "Posted items are reversed and re-posted with your changes. Original row is kept for audit."
                : "Changes apply to this pending transaction before posting."}
            </p>
            <p className="text-xs font-medium text-slate-700">
              {!canFlipDepositWithdraw ? (
                <>Type: {String(txn.txn_type).replace(/_/g, " ")}</>
              ) : (
                <span className="text-slate-600">Cash at till — you may switch deposit / withdrawal below.</span>
              )}
              {txn.posting_purpose
                ? ` · ${TELLER_POSTING_PURPOSE_LABELS[txn.posting_purpose as TellerPostingPurpose] ?? txn.posting_purpose}`
                : ""}
            </p>

            <label className="block text-xs font-medium text-slate-600">
              Transaction date
              <input
                type="date"
                className={field + " mt-1 [color-scheme:light]"}
                value={txnDate}
                onChange={(e) => setTxnDate(e.target.value.slice(0, 10))}
                disabled={saving}
                required
              />
            </label>

            {canFlipDepositWithdraw ? (
              <label className="block text-xs font-medium text-slate-600">
                Transaction type
                <select
                  className={field + " mt-1"}
                  value={txnType}
                  onChange={(e) => setTxnType(e.target.value as "cash_deposit" | "cash_withdrawal")}
                  disabled={saving}
                >
                  <option value="cash_deposit">{formatTxnTypeLabel("cash_deposit")}</option>
                  <option value="cash_withdrawal">{formatTxnTypeLabel("cash_withdrawal")}</option>
                </select>
              </label>
            ) : null}

            <label className="block text-xs font-medium text-slate-600">
              Amount (UGX)
              <input
                type="number"
                min={0}
                step={1}
                className={field + " mt-1"}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={saving}
                required
              />
            </label>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Member (optional)</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  className={field + " pl-9"}
                  placeholder="Search name or member number…"
                  value={memberSearch}
                  onChange={(e) => {
                    setMemberSearch(e.target.value);
                    setSelectedMemberId("");
                    setSelectedSavingsAccountId("");
                  }}
                  disabled={saving}
                  autoComplete="off"
                />
                {selectedMember && (
                  <p className="text-xs text-emerald-800 mt-1">
                    Selected: {selectedMember.member_number} — {selectedMember.full_name}
                  </p>
                )}
                {selectedMemberId && !selectedMember ? (
                  <p className="text-xs text-amber-800 mt-1">
                    Member is linked by ID but not in the search list. Refresh if you need to change the link.
                  </p>
                ) : null}
                {memberMatches.length > 0 && !selectedMemberId && (
                  <ul className="absolute z-20 mt-1 w-full max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg text-sm">
                    {memberMatches.map((m) => (
                      <li key={m.id}>
                        <button
                          type="button"
                          className="w-full text-left px-3 py-2 hover:bg-emerald-50"
                          onClick={() => {
                            setSelectedMemberId(m.id);
                            setMemberSearch(`${m.member_number} — ${m.full_name}`);
                            applyRefLabel(m, null);
                          }}
                        >
                          {m.member_number} — {m.full_name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {selectedMemberId && memberSavings.length > 0 ? (
              <label className="block text-xs font-medium text-slate-600">
                Savings account (optional)
                <select
                  className={field + " mt-1"}
                  value={selectedSavingsAccountId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSelectedSavingsAccountId(id);
                    const mem = members.find((m) => m.id === selectedMemberId);
                    if (!mem) return;
                    const acc = id ? savingsAccounts.find((a) => a.id === id) ?? null : null;
                    applyRefLabel(mem, acc);
                  }}
                  disabled={saving}
                >
                  <option value="">— None —</option>
                  {memberSavings.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.account_number} · {a.savings_product_code} ({formatUgxBrief(a.balance)})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {selectedMemberId && memberSavings.length === 0 ? (
              <p className="text-xs text-slate-500">No savings accounts in the pick list for this member.</p>
            ) : null}

            <label className="block text-xs font-medium text-slate-600">
              Member / reference label
              <input
                className={field + " mt-1"}
                value={memberRef}
                onChange={(e) => setMemberRef(e.target.value)}
                disabled={saving}
                placeholder="Shown on receipts and journals"
              />
            </label>

            <label className="block text-xs font-medium text-slate-600">
              Narration
              <textarea
                className={field + " mt-1 min-h-[4rem]"}
                value={narration}
                onChange={(e) => setNarration(e.target.value)}
                disabled={saving}
              />
            </label>

            <label className="block text-xs font-medium text-slate-600">
              Reason for change <span className="text-red-600">*</span>
              <textarea
                className={field + " mt-1 min-h-[4rem]"}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Required — recorded in audit trail"
                disabled={saving}
                required
              />
            </label>

            {error ? <p className="text-xs text-red-600">{error}</p> : null}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="flex-1 rounded-lg border border-slate-200 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 rounded-lg bg-emerald-600 text-white py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? "Saving…" : isPosted ? "Correct & re-post" : "Save changes"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function formatUgxBrief(n: number): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `UGX ${Math.round(n).toLocaleString("en-UG")}`;
}
