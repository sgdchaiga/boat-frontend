export function saccoMemberDisplay(name?: string | null, memberNumber?: string | null): string {
  const cleanName = String(name || "").trim();
  const cleanNumber = String(memberNumber || "").trim();
  if (cleanName && cleanNumber) return `${cleanName} · ${cleanNumber}`;
  return cleanName || cleanNumber || "—";
}

export function normalizeSaccoTransactionType(value?: string | null, debit = 0, credit = 0): string {
  const raw = String(value || "").trim().toLowerCase().replaceAll("_", " ");
  if (/loan.*repay|repay.*loan/.test(raw)) return "Loan repayment";
  if (/loan.*disbur|disbur.*loan/.test(raw)) return "Loan disbursement";
  if (/withdra|give money|cash out|payment/.test(raw)) return "Withdrawal";
  if (/deposit|receive money|cash in|receipt/.test(raw)) return "Deposit";
  if (/balance/.test(raw)) return "Balance b/f";
  if (raw && raw !== "journal") return raw.replace(/\b\w/g, (letter) => letter.toUpperCase());
  return debit > 0 ? "Deposit" : credit > 0 ? "Withdrawal" : "Journal";
}

export function buildSaccoNarration(transactionType: string, memberLabel: string, detail?: string | null): string {
  const type = normalizeSaccoTransactionType(transactionType);
  const party = memberLabel && memberLabel !== "—" ? memberLabel : "non-member";
  const action = type === "Deposit" ? `Deposited by ${party}`
    : type === "Withdrawal" ? `Withdrawn by ${party}`
      : type === "Loan repayment" ? `Loan repayment by ${party}`
        : type === "Loan disbursement" ? `Loan disbursed to ${party}`
          : type === "Balance b/f" ? `Balance brought forward for ${party}`
            : `${type} for ${party}`;
  const note = String(detail || "").trim();
  return note && note.toLowerCase() !== action.toLowerCase() ? `${action} — ${note}` : action;
}
