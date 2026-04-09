/** SACCO workspace models shared by AppContext and `lib/saccoDb`. */

export type LoanStatus = "pending" | "approved" | "disbursed" | "closed" | "rejected" | "defaulted";

export interface LoanFees {
  formFee: number;
  /** Fixed UGX; deducted upfront from disbursement (with other upfront fees). */
  monitoringFee: number;
  processingFeeRate: number;
  insuranceFeeRate: number;
  applicationFeeRate: number;
}

export interface LoanProduct {
  id: string;
  name: string;
  interestRate: number;
  maxTerm: number;
  minAmount: number;
  maxAmount: number;
  interestBasis: "flat" | "declining";
  fees: LoanFees;
  compulsorySavingsRate: number;
  minimumShares: number;
  isActive: boolean;
}

export interface Loan {
  id: string;
  memberId: string;
  memberName: string;
  loanType: string;
  amount: number;
  balance: number;
  paidAmount: number;
  status: LoanStatus;
  interestRate: number;
  term: number;
  monthlyPayment: number;
  approvalStage: number;
  purpose: string;
  guarantors: string[];
  applicationDate: string;
  interestBasis: "flat" | "declining";
  disbursementDate?: string;
  /** Short description of collateral (land, vehicle, etc.). */
  collateralDescription?: string;
  /** LC1 chairperson — locality verification for collateral. */
  lc1ChairmanName?: string;
  lc1ChairmanPhone?: string;
  /** Set when repayments are posted (e.g. from teller/collections). */
  lastPaymentDate?: string;
  fees?: {
    formFee: number;
    monitoringFee: number;
    processingFee: number;
    insuranceFee: number;
    applicationFee: number;
    totalFees: number;
    netDisbursement: number;
  };
}

export interface Member {
  id: string;
  name: string;
  accountNumber: string;
  status: "active" | "inactive";
  savingsBalance: number;
  sharesBalance: number;
  joinDate: string;
  /** From member register; used for guarantor contact on recovery views. */
  phone?: string;
}

export interface FixedDeposit {
  id: string;
  memberId: string;
  memberName: string;
  amount: number;
  interestRate: number;
  term: number;
  startDate: string;
  maturityDate: string;
  interestEarned: number;
  autoRenew: boolean;
  status: string;
}

export interface CashbookEntry {
  id: string;
  date: string;
  description: string;
  reference?: string;
  category?: string;
  memberId?: string;
  memberName?: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface FixedAsset {
  id: string;
  name: string;
  status: string;
  currentValue: number;
}

export interface ProvisionRate {
  id: string;
  label: string;
  daysFrom: number;
  daysTo: number;
  oldRate: number;
  newRate: number;
}

export interface ProvisioningConfig {
  provisionChoice: "old" | "new";
  generalProvisionOld: number;
  generalProvisionNew: number;
  rates: ProvisionRate[];
}
