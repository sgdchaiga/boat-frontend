/** SACCO workspace models shared by AppContext and `lib/saccoDb`. */

export type LoanStatus =
  | "pending"
  | "approved"
  | "disbursed"
  | "closed"
  | "rejected"
  | "defaulted"
  | "written_off";

export type SaccoLoanModificationType = "reschedule" | "restructure" | "write_off" | "recovery_writeoff";

export interface SaccoLoanPolicy {
  /** Minimum whole calendar days since first ordinary savings account before loan eligibility & disbursement. */
  minSavingsDaysBeforeLoan: number;
}

export interface LoanFees {
  formFee: number;
  /** % of loan amount; deducted upfront from disbursement. */
  monitoringFeeRate: number;
  processingFeeRate: number;
  insuranceFeeRate: number;
  applicationFeeRate: number;
  /** % of loan principal per month while the loan is active (when agent is enabled on application). */
  agentFeeRate: number;
}

export type LoanFeeBreakdown = {
  formFee: number;
  monitoringFee: number;
  processingFee: number;
  insuranceFee: number;
  applicationFee: number;
  /** Upfront fees deducted at disbursement. */
  totalUpfrontFees: number;
  netDisbursement: number;
  useAgent: boolean;
  agentFeeRate: number;
  agentFeeMonthly: number;
  /** agentFeeMonthly × term months. */
  agentFeeTotal: number;
  /** @deprecated Use totalUpfrontFees — kept for existing loan rows. */
  totalFees: number;
};

export interface LoanProduct {
  id: string;
  name: string;
  /** Numeric code for the loan-number middle segment (padded per org loan number settings). */
  loanCode: string;
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
  /** Structured reference from branch + loan product code + serial (when configured). */
  loanNumber?: string;
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
  /** Cumulative amount written off (audit). */
  writtenOffTotal?: number;
  /** Bad-debt remainder still recoverable; reduced when recoveries post. */
  writtenOffRemaining?: number;
  writtenOffAt?: string;
  fees?: LoanFeeBreakdown;
}

export interface Member {
  id: string;
  name: string;
  accountNumber: string;
  status: "active" | "inactive";
  savingsBalance: number;
  sharesBalance: number;
  joinDate: string;
  /** Earliest ordinary (non–share-capital) savings account open date (yyyy-mm-dd); used for loan cooling-off. */
  firstOrdinarySavingsOpenedAt?: string | null;
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
