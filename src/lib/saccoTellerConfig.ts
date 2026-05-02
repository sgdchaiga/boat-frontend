import type { TellerPostingPurpose, TellerGlAccountPickRow } from "@/lib/saccoTellerDb";

/** Task-driven teller steps — not shown as "posting purpose" in the UI. */
export type TellerTaskAction = "deposit" | "withdraw" | "loan_payment" | "fees" | "cheque";

export const TELLER_TASK_LABELS: Record<TellerTaskAction, string> = {
  deposit: "Deposit",
  withdraw: "Withdraw",
  loan_payment: "Loan payment",
  fees: "Fees",
  cheque: "Cheque",
};

/** Indicative limits until org-level settings exist in the database. Teller does not pick post vs approval — the client uses these. */
export const TELLER_DEFAULT_LIMITS_UGX = {
  maxAutoPostSingle: 10_000_000,
  maxAutoPostSessionCumulative: 100_000_000,
} as const;

export function postingPurposeForTask(action: TellerTaskAction): TellerPostingPurpose {
  switch (action) {
    case "deposit":
    case "withdraw":
      return "savings";
    case "loan_payment":
      return "loan_repayment";
    case "fees":
      return "fee_or_penalty";
    case "cheque":
    default:
      return "other";
  }
}

export function taskRequiresSavingsAccount(action: TellerTaskAction): boolean {
  return action === "deposit" || action === "withdraw";
}

export function taskRequiresMemberOnly(action: TellerTaskAction): boolean {
  return action === "loan_payment" || action === "fees";
}

export function resolveTellerEntryMode(args: {
  amount: number;
  sessionSessionVolume: number;
  limits?: Partial<typeof TELLER_DEFAULT_LIMITS_UGX>;
}): "posted" | "pending_approval" {
  const maxSingle = args.limits?.maxAutoPostSingle ?? TELLER_DEFAULT_LIMITS_UGX.maxAutoPostSingle;
  const maxCum = args.limits?.maxAutoPostSessionCumulative ?? TELLER_DEFAULT_LIMITS_UGX.maxAutoPostSessionCumulative;
  if (!Number.isFinite(args.amount) || args.amount < 0) return "pending_approval";
  if (args.amount > maxSingle) return "pending_approval";
  if (args.sessionSessionVolume + args.amount > maxCum) return "pending_approval";
  return "posted";
}

/**
 * Teller must not choose GL. Uses admin default; if "per transaction" is on in settings,
 * picks a best-effort line from the org chart (same default first, then name hints).
 */
export function resolveTellerCounterpartyGlId(args: {
  allowPerTxn: boolean;
  defaultId: string | null;
  glAccounts: TellerGlAccountPickRow[];
  hint: "savings" | "fees" | "loan" | "general";
}): string | null {
  if (args.defaultId) return args.defaultId;
  if (!args.allowPerTxn) return null;
  const list = args.glAccounts;
  if (list.length === 0) return null;
  const byWords =
    args.hint === "savings"
      ? (row: TellerGlAccountPickRow) =>
          /\b(savings|member|deposit|liability|client)\b/i.test(row.account_name) ||
          /\b(21|22|23|24)/.test(row.account_code)
      : args.hint === "fees"
        ? (row: TellerGlAccountPickRow) => /\b(fee|income|charges|penalt)/i.test(row.account_name)
        : args.hint === "loan"
          ? (row: TellerGlAccountPickRow) => /\b(loan|receiv|lending|member)/i.test(row.account_name)
          : () => true;
  const found = list.find(byWords);
  return (found ?? list[0])?.id ?? null;
}

export function glHintForTask(action: TellerTaskAction): "savings" | "fees" | "loan" | "general" {
  if (action === "deposit" || action === "withdraw") return "savings";
  if (action === "loan_payment") return "loan";
  if (action === "fees") return "fees";
  return "general";
}

export const TELLER_VAL = {
  noSession: "Open a till session on the Till tab first.",
  noMember: "Select a member (search by name or number).",
  noSavings: "Select a savings account for this member.",
  noAmount: "Enter a valid amount in UGX.",
  noGl: "Ask an administrator to set a default teller counterparty account under Accounting → Journal account settings.",
  noChequeAmount: "Enter a valid cheque amount in UGX.",
} as const;

export function successMessageForMode(
  action: TellerTaskAction,
  mode: "posted" | "pending_approval"
): string {
  if (mode === "pending_approval") {
    if (action === "cheque") return "Cheque transaction submitted for approval.";
    return "This amount requires approval — it has been sent to the queue.";
  }
  if (action === "cheque") return "Cheque transaction completed.";
  return "Transaction completed.";
}

export function formatTxnTypeLabel(t: string): string {
  const map: Record<string, string> = {
    cash_deposit: "Deposit",
    cash_withdrawal: "Withdrawal",
    cheque_received: "Cheque in",
    cheque_paid: "Cheque out",
    cheque_clearing: "Cheque clearing",
    adjustment: "Adjustment",
    till_vault_in: "Vault → till",
    till_vault_out: "Till → vault",
  };
  return map[t] ?? t.replace(/_/g, " ");
}
