export type ExpenseReviewLine = {
  id: string; vendor_id: string | null; expense_gl_account_id: string; source_cash_gl_account_id: string;
  amount: number; vat_amount: number; bank_charges: number; quantity: number | null; comment: string | null;
  vat_gl_account_id: string | null; bank_charges_gl_account_id: string | null;
};
const round = (value: number) => Math.round(value * 100) / 100;

export function expenseReviewEntries(lines: ExpenseReviewLine[], description: string, bankChargesAccountId: string | null) {
  return lines.flatMap((line, index) => {
    const particulars = line.comment?.trim() || description || "Expense";
    const amounts = [round(Number(line.amount)), round(Number(line.vat_amount || 0)), round(Number(line.bank_charges || 0))];
    const entries = [
      { id: `${line.id}-net`, line: index + 1, vendorId: line.vendor_id, particulars, glAccountId: line.expense_gl_account_id, amount: amounts[0], direction: "Debit" },
      { id: `${line.id}-vat`, line: index + 1, vendorId: line.vendor_id, particulars: `VAT — ${particulars}`, glAccountId: line.vat_gl_account_id || line.expense_gl_account_id, amount: amounts[1], direction: "Debit" },
      { id: `${line.id}-fees`, line: index + 1, vendorId: line.vendor_id, particulars: `Bank charges — ${particulars}`, glAccountId: line.bank_charges_gl_account_id || bankChargesAccountId, amount: amounts[2], direction: "Debit" },
      { id: `${line.id}-funding`, line: index + 1, vendorId: line.vendor_id, particulars: `Payment — ${particulars}`, glAccountId: line.source_cash_gl_account_id, amount: round(amounts.reduce((sum, amount) => sum + amount, 0)), direction: "Credit" },
    ];
    return entries.filter(entry => entry.amount > 0);
  });
}

export function validateExpenseReviewLines(lines: ExpenseReviewLine[]) {
  if (!lines.length) throw new Error("The expense must have at least one entry.");
  for (const [index, line] of lines.entries()) {
    if (!line.expense_gl_account_id || !line.source_cash_gl_account_id) throw new Error(`Entry ${index + 1}: choose the expense and funding accounts.`);
    if ([line.amount, line.vat_amount, line.bank_charges].some(value => !Number.isFinite(Number(value)) || Number(value) < 0)) throw new Error(`Entry ${index + 1}: amounts must be valid, non-negative numbers.`);
    if (!Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0) throw new Error(`Entry ${index + 1}: quantity must be greater than zero.`);
  }
  const total = round(lines.reduce((sum, line) => sum + round(Number(line.amount)) + round(Number(line.vat_amount)) + round(Number(line.bank_charges)), 0));
  if (total <= 0) throw new Error("The expense total must be greater than zero.");
  return total;
}
