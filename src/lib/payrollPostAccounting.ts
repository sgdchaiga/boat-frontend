import { supabase } from "@/lib/supabase";

export type PayrollGlIds = {
  salaryExpenseGlAccountId: string;
  payePayableGlAccountId: string;
  nssfPayableGlAccountId: string;
  salariesPayableGlAccountId: string;
  staffLoanReceivableGlAccountId: string | null;
};

export type PayrollRunTotals = {
  totalGross: number;
  totalPaye: number;
  totalNssfEmployee: number;
  totalNssfEmployer: number;
  totalLoan: number;
  totalNet: number;
};

export function buildPayrollJournalLines(
  totals: PayrollRunTotals,
  gl: PayrollGlIds
): { gl_account_id: string; debit: number; credit: number; line_description: string }[] {
  const lines: { gl_account_id: string; debit: number; credit: number; line_description: string }[] = [];
  const g = totals.totalGross;
  const paye = totals.totalPaye;
  const nssfE = totals.totalNssfEmployee;
  const nssfEr = totals.totalNssfEmployer;
  const loan = totals.totalLoan;
  const net = totals.totalNet;

  // Dr Salary expense (gross + employer NSSF as employer cost)
  lines.push({
    gl_account_id: gl.salaryExpenseGlAccountId,
    debit: round2(g + nssfEr),
    credit: 0,
    line_description: "Payroll salary & employer NSSF expense",
  });

  lines.push({
    gl_account_id: gl.payePayableGlAccountId,
    debit: 0,
    credit: round2(paye),
    line_description: "PAYE withheld",
  });

  lines.push({
    gl_account_id: gl.nssfPayableGlAccountId,
    debit: 0,
    credit: round2(nssfE + nssfEr),
    line_description: "NSSF employee + employer",
  });

  lines.push({
    gl_account_id: gl.salariesPayableGlAccountId,
    debit: 0,
    credit: round2(net),
    line_description: "Net salaries payable",
  });

  if (loan > 0 && gl.staffLoanReceivableGlAccountId) {
    lines.push({
      gl_account_id: gl.staffLoanReceivableGlAccountId,
      debit: 0,
      credit: round2(loan),
      line_description: "Loan / advance recovered from payroll",
    });
  }

  return lines;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Validate debits = credits after building lines. */
export function journalLinesBalance(
  lines: { debit: number; credit: number }[]
): { ok: boolean; dr: number; cr: number } {
  const dr = lines.reduce((s, l) => s + l.debit, 0);
  const cr = lines.reduce((s, l) => s + l.credit, 0);
  return { ok: Math.abs(dr - cr) < 0.02, dr, cr };
}

export async function postPayrollRunToJournal(params: {
  organizationId: string;
  entryDate: string;
  description: string;
  payrollRunId: string;
  createdBy: string;
  totals: PayrollRunTotals;
  gl: PayrollGlIds;
}): Promise<{ journalEntryId: string | null; error: string | null }> {
  const { totals, gl } = params;
  if (
    !gl.salaryExpenseGlAccountId ||
    !gl.payePayableGlAccountId ||
    !gl.nssfPayableGlAccountId ||
    !gl.salariesPayableGlAccountId
  ) {
    return { journalEntryId: null, error: "Configure all required GL accounts in Payroll settings." };
  }
  if (totals.totalLoan > 0 && !gl.staffLoanReceivableGlAccountId) {
    return { journalEntryId: null, error: "Configure staff loan receivable GL or clear loan deductions." };
  }

  const lines = buildPayrollJournalLines(totals, gl);
  const bal = journalLinesBalance(lines);
  if (!bal.ok) {
    return {
      journalEntryId: null,
      error: `Journal does not balance (Dr ${bal.dr} vs Cr ${bal.cr}).`,
    };
  }

  const payload = lines.map((l) => ({
    gl_account_id: l.gl_account_id,
    debit: l.debit,
    credit: l.credit,
    line_description: l.line_description,
  }));

  const { data, error } = await supabase.rpc("create_journal_entry_atomic", {
    p_entry_date: params.entryDate,
    p_description: params.description,
    p_reference_type: "payroll_run",
    p_reference_id: params.payrollRunId,
    p_created_by: params.createdBy,
    p_lines: payload,
  });

  if (error) {
    return { journalEntryId: null, error: error.message };
  }
  if (data == null || typeof data !== "string") {
    return { journalEntryId: null, error: "Journal posting returned no entry id." };
  }
  return { journalEntryId: data as string, error: null };
}
