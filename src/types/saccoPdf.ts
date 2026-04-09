/** Types for legacy SACCO PDF report helpers (`lib/pdfGenerator.ts`). */

export type LedgerAccount = {
  code: string;
  name: string;
  type: "Asset" | "Liability" | "Equity" | "Income" | "Expense";
  category: string;
  balance: number;
};

export type Loan = {
  id: string;
  status: string;
  amount: number;
  balance: number;
  paidAmount: number;
  loanType: string;
  interestRate: number;
  memberName: string;
  term: number;
  monthlyPayment: number;
};

export type Member = {
  accountNumber: string;
  name: string;
  gender: string;
  joinDate: string;
  savingsBalance: number;
  sharesBalance: number;
  status: string;
};

export type FixedDeposit = {
  id: string;
  memberName: string;
  amount: number;
  interestRate: number;
  term: number;
  startDate: string;
  maturityDate: string;
  interestEarned: number;
  autoRenew: boolean;
  status: string;
};

export type CashbookEntry = {
  id: string;
  date: string;
  description: string;
  reference: string;
  category: string;
  memberName?: string | null;
  debit: number;
  credit: number;
  balance: number;
};
