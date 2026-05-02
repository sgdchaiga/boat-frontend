import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/contexts/AuthContext";
import type {
  CashbookEntry,
  FixedAsset,
  FixedDeposit,
  Loan,
  LoanProduct,
  LoanStatus,
  Member,
  ProvisioningConfig,
  SaccoLoanPolicy,
} from "@/types/saccoWorkspace";
import { memberMeetsLoanDisbursePolicy, loanProductSharesGate } from "@/lib/saccoLoanEligibility";
import {
  fetchSaccoWorkspaceData,
  insertLoanRow,
  replaceLoanProductsForOrg,
  updateLoanRow,
  upsertProvisioningSettings,
} from "@/lib/saccoDb";

export type {
  CashbookEntry,
  FixedAsset,
  FixedDeposit,
  Loan,
  LoanFees,
  LoanProduct,
  Member,
  ProvisionRate,
  ProvisioningConfig,
  LoanStatus,
  SaccoLoanPolicy,
} from "@/types/saccoWorkspace";

export function calculateMonthlyPayment(
  P: number,
  annualRate: number,
  n: number,
  basis: "flat" | "declining"
): number {
  if (n <= 0 || P <= 0) return 0;
  const r = annualRate / 100 / 12;
  if (basis === "flat") {
    const totalInterest = P * (annualRate / 100) * (n / 12);
    return Math.round((P + totalInterest) / n);
  }
  if (r === 0) return Math.round(P / n);
  return Math.round((P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));
}

export function calculateLoanFees(amount: number, product: LoanProduct) {
  const f = product.fees;
  const processingFee = (amount * f.processingFeeRate) / 100;
  const insuranceFee = (amount * f.insuranceFeeRate) / 100;
  const applicationFee = (amount * f.applicationFeeRate) / 100;
  const formFee = f.formFee;
  const monitoringFee = f.monitoringFee ?? 0;
  const totalFees = formFee + monitoringFee + processingFee + insuranceFee + applicationFee;
  return {
    formFee,
    monitoringFee,
    processingFee,
    insuranceFee,
    applicationFee,
    totalFees,
    netDisbursement: amount - totalFees,
  };
}

const DEFAULT_PROVISIONING: ProvisioningConfig = {
  provisionChoice: "new",
  generalProvisionOld: 1,
  generalProvisionNew: 1.5,
  rates: [
    { id: "PR1", label: "Current", daysFrom: 0, daysTo: 30, oldRate: 0, newRate: 0 },
    { id: "PR2", label: "Watch", daysFrom: 31, daysTo: 90, oldRate: 5, newRate: 7 },
    { id: "PR3", label: "Substandard", daysFrom: 91, daysTo: 180, oldRate: 20, newRate: 25 },
    { id: "PR4", label: "Doubtful", daysFrom: 181, daysTo: 365, oldRate: 50, newRate: 55 },
    { id: "PR5", label: "Loss", daysFrom: 366, daysTo: 9999, oldRate: 100, newRate: 100 },
  ],
};

export type AppContextValue = {
  members: Member[];
  setMembers: React.Dispatch<React.SetStateAction<Member[]>>;
  loans: Loan[];
  setLoans: React.Dispatch<React.SetStateAction<Loan[]>>;
  fixedDeposits: FixedDeposit[];
  setFixedDeposits: React.Dispatch<React.SetStateAction<FixedDeposit[]>>;
  cashbook: CashbookEntry[];
  setCashbook: React.Dispatch<React.SetStateAction<CashbookEntry[]>>;
  fixedAssets: FixedAsset[];
  setFixedAssets: React.Dispatch<React.SetStateAction<FixedAsset[]>>;
  loanProducts: LoanProduct[];
  setLoanProducts: React.Dispatch<React.SetStateAction<LoanProduct[]>>;
  provisioningConfig: ProvisioningConfig;
  setProvisioningConfig: React.Dispatch<React.SetStateAction<ProvisioningConfig>>;
  formatCurrency: (n: number) => string;
  setCurrentPage: (page: string, state?: Record<string, unknown>) => void;
  approveLoan: (id: string) => Promise<void>;
  rejectLoan: (id: string) => Promise<void>;
  addLoan: (payload: {
    memberId: string;
    memberName: string;
    loanType: string;
    amount: number;
    interestRate: number;
    term: number;
    applicationDate: string;
    guarantors: string[];
    purpose: string;
    interestBasis: "flat" | "declining";
    fees?: Loan["fees"];
    collateralDescription?: string;
    lc1ChairmanName?: string;
    lc1ChairmanPhone?: string;
  }) => Promise<void>;
  /** True while initial SACCO workspace fetch runs (sacco org only). */
  saccoLoading: boolean;
  saccoError: string | null;
  /** Reload loans, members, products, etc. from Supabase (e.g. after Members CRUD). */
  refreshSaccoWorkspace: () => Promise<void>;
  /** Org rule: min calendar days after first ordinary savings before loan application / disbursement. */
  saccoLoanPolicies: SaccoLoanPolicy;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({
  children,
  navigate,
}: {
  children: ReactNode;
  navigate: (page: string, state?: Record<string, unknown>) => void;
}) {
  const { user } = useAuth();
  const organizationId = user?.organization_id ?? null;
  const isSacco = user?.business_type === "sacco";

  const [members, setMembers] = useState<Member[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [fixedDeposits, setFixedDeposits] = useState<FixedDeposit[]>([]);
  const [cashbook, setCashbook] = useState<CashbookEntry[]>([]);
  const [fixedAssets, setFixedAssets] = useState<FixedAsset[]>([]);
  const [loanProductsInner, setLoanProductsInner] = useState<LoanProduct[]>([]);
  const [provisioningInner, setProvisioningInner] = useState<ProvisioningConfig>(DEFAULT_PROVISIONING);
  const [saccoLoanPolicies, setSaccoLoanPolicies] = useState<SaccoLoanPolicy>({ minSavingsDaysBeforeLoan: 30 });

  const [saccoLoading, setSaccoLoading] = useState(false);
  const [saccoError, setSaccoError] = useState<string | null>(null);
  const persistReadyRef = useRef(false);

  const refreshSaccoWorkspace = useCallback(async () => {
    if (!isSacco || !organizationId) {
      persistReadyRef.current = false;
      setMembers([]);
      setLoans([]);
      setFixedDeposits([]);
      setCashbook([]);
      setFixedAssets([]);
      setLoanProductsInner([]);
      setProvisioningInner(DEFAULT_PROVISIONING);
      setSaccoLoanPolicies({ minSavingsDaysBeforeLoan: 30 });
      setSaccoError(null);
      return;
    }
    setSaccoLoading(true);
    setSaccoError(null);
    persistReadyRef.current = false;
    try {
      const data = await fetchSaccoWorkspaceData(organizationId);
      setMembers(data.members);
      setLoans(data.loans);
      setFixedDeposits(data.fixedDeposits);
      setCashbook(data.cashbook);
      setFixedAssets(data.fixedAssets);
      setLoanProductsInner(data.loanProducts);
      setProvisioningInner(data.provisioning ?? DEFAULT_PROVISIONING);
      setSaccoLoanPolicies(data.saccoLoanPolicies ?? { minSavingsDaysBeforeLoan: 30 });
      persistReadyRef.current = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load SACCO data";
      setSaccoError(msg);
      console.error("[SACCO]", e);
    } finally {
      setSaccoLoading(false);
    }
  }, [isSacco, organizationId]);

  useEffect(() => {
    void refreshSaccoWorkspace();
  }, [refreshSaccoWorkspace]);

  const setLoanProducts = useCallback(
    (action: React.SetStateAction<LoanProduct[]>) => {
      setLoanProductsInner((prev) => {
        const next = typeof action === "function" ? (action as (p: LoanProduct[]) => LoanProduct[])(prev) : action;
        if (persistReadyRef.current && organizationId) {
          void replaceLoanProductsForOrg(organizationId, next)
            .then(setLoanProductsInner)
            .catch((err) => console.error("[SACCO] loan products", err));
        }
        return next;
      });
    },
    [organizationId]
  );

  const setProvisioningConfig = useCallback(
    (action: React.SetStateAction<ProvisioningConfig>) => {
      setProvisioningInner((prev) => {
        const next = typeof action === "function" ? (action as (p: ProvisioningConfig) => ProvisioningConfig)(prev) : action;
        if (persistReadyRef.current && organizationId) {
          void upsertProvisioningSettings(organizationId, next).catch((err) =>
            console.error("[SACCO] provisioning", err)
          );
        }
        return next;
      });
    },
    [organizationId]
  );

  const formatCurrency = useCallback((n: number) => {
    return `UGX ${n.toLocaleString("en-UG", { maximumFractionDigits: 0 })}`;
  }, []);

  const setCurrentPage = useCallback(
    (page: string, state?: Record<string, unknown>) => {
      navigate(page, state);
    },
    [navigate]
  );

  const approveLoan = useCallback(
    async (id: string) => {
      const loan = loans.find((l) => l.id === id);
      if (!loan) return;

      const applyLocal = (updater: (l: Loan) => Loan) => {
        setLoans((prev) => prev.map((l) => (l.id === id ? updater(l) : l)));
      };

      if (!organizationId || !persistReadyRef.current) {
        if (loan.approvalStage >= 2) {
          const member = members.find((m) => m.id === loan.memberId);
          const d0 = memberMeetsLoanDisbursePolicy(member, saccoLoanPolicies);
          if (!d0.ok) throw new Error(d0.reason);
          const prod0 = loanProductsInner.find((p) => p.name === loan.loanType);
          const shr0 = loanProductSharesGate(member, prod0);
          if (!shr0.ok) throw new Error(shr0.reason);
        }
        applyLocal((l) => {
          if (l.approvalStage < 2) return { ...l, approvalStage: l.approvalStage + 1 };
          return {
            ...l,
            status: "disbursed" as LoanStatus,
            balance: l.amount,
            paidAmount: 0,
            disbursementDate: new Date().toISOString().slice(0, 10),
          };
        });
        return;
      }

      try {
        if (loan.approvalStage < 2) {
          await updateLoanRow(id, { approval_stage: loan.approvalStage + 1 });
          applyLocal((l) => ({ ...l, approvalStage: l.approvalStage + 1 }));
        } else {
          const member = members.find((m) => m.id === loan.memberId);
          const d = memberMeetsLoanDisbursePolicy(member, saccoLoanPolicies);
          if (!d.ok) throw new Error(d.reason);
          const prod = loanProductsInner.find((p) => p.name === loan.loanType);
          const shr = loanProductSharesGate(member, prod);
          if (!shr.ok) throw new Error(shr.reason);
          const today = new Date().toISOString().slice(0, 10);
          await updateLoanRow(id, {
            status: "disbursed",
            balance: loan.amount,
            paid_amount: 0,
            disbursement_date: today,
          });
          applyLocal((l) => ({
            ...l,
            status: "disbursed",
            balance: l.amount,
            paidAmount: 0,
            disbursementDate: today,
          }));
        }
      } catch (e) {
        console.error("[SACCO] approveLoan", e);
        throw e;
      }
    },
    [loans, organizationId, members, saccoLoanPolicies, loanProductsInner]
  );

  const rejectLoan = useCallback(
    async (id: string) => {
      if (!organizationId || !persistReadyRef.current) {
        setLoans((prev) => prev.map((l) => (l.id === id ? { ...l, status: "rejected" as const } : l)));
        return;
      }
      try {
        await updateLoanRow(id, { status: "rejected" });
        setLoans((prev) => prev.map((l) => (l.id === id ? { ...l, status: "rejected" as const } : l)));
      } catch (e) {
        console.error("[SACCO] rejectLoan", e);
      }
    },
    [organizationId]
  );

  const addLoan = useCallback(
    async (payload: {
      memberId: string;
      memberName: string;
      loanType: string;
      amount: number;
      interestRate: number;
      term: number;
      applicationDate: string;
      guarantors: string[];
      purpose: string;
      interestBasis: "flat" | "declining";
      fees?: Loan["fees"];
      collateralDescription?: string;
      lc1ChairmanName?: string;
      lc1ChairmanPhone?: string;
    }) => {
      const monthlyPayment = calculateMonthlyPayment(
        payload.amount,
        payload.interestRate,
        payload.term,
        payload.interestBasis
      );

      if (!organizationId || !persistReadyRef.current) {
        const member = members.find((m) => m.id === payload.memberId);
        const d = memberMeetsLoanDisbursePolicy(member, saccoLoanPolicies);
        if (!d.ok) throw new Error(d.reason);
        const prod = loanProductsInner.find((p) => p.name === payload.loanType);
        const shr = loanProductSharesGate(member, prod);
        if (!shr.ok) throw new Error(shr.reason);
        const newLoan: Loan = {
          id: `local-${Date.now()}`,
          memberId: payload.memberId,
          memberName: payload.memberName,
          loanType: payload.loanType,
          amount: payload.amount,
          balance: payload.amount,
          paidAmount: 0,
          status: "pending",
          interestRate: payload.interestRate,
          term: payload.term,
          monthlyPayment,
          approvalStage: 0,
          purpose: payload.purpose,
          guarantors: payload.guarantors,
          applicationDate: payload.applicationDate,
          interestBasis: payload.interestBasis,
          disbursementDate: undefined,
          collateralDescription: payload.collateralDescription?.trim() || undefined,
          lc1ChairmanName: payload.lc1ChairmanName?.trim() || undefined,
          lc1ChairmanPhone: payload.lc1ChairmanPhone?.trim() || undefined,
          fees: payload.fees,
        };
        setLoans((prev) => [...prev, newLoan]);
        return;
      }

      try {
        const member = members.find((m) => m.id === payload.memberId);
        const d = memberMeetsLoanDisbursePolicy(member, saccoLoanPolicies);
        if (!d.ok) throw new Error(d.reason);
        const prod = loanProductsInner.find((p) => p.name === payload.loanType);
        const shr = loanProductSharesGate(member, prod);
        if (!shr.ok) throw new Error(shr.reason);
        const row = await insertLoanRow({
          sacco_member_id: payload.memberId,
          member_name: payload.memberName,
          loan_type: payload.loanType,
          amount: payload.amount,
          balance: payload.amount,
          paid_amount: 0,
          status: "pending",
          interest_rate: payload.interestRate,
          term_months: payload.term,
          monthly_payment: monthlyPayment,
          approval_stage: 0,
          purpose: payload.purpose,
          guarantors: payload.guarantors,
          application_date: payload.applicationDate,
          interest_basis: payload.interestBasis,
          disbursement_date: null,
          fees: payload.fees ?? null,
          collateral_description: payload.collateralDescription?.trim() || null,
          lc1_chairman_name: payload.lc1ChairmanName?.trim() || null,
          lc1_chairman_phone: payload.lc1ChairmanPhone?.trim() || null,
          last_payment_date: null,
        });
        setLoans((prev) => [...prev, row]);
      } catch (e) {
        console.error("[SACCO] addLoan", e);
        throw e;
      }
    },
    [organizationId, members, saccoLoanPolicies, loanProductsInner]
  );

  const value = useMemo(
    () => ({
      members,
      setMembers,
      loans,
      setLoans,
      fixedDeposits,
      setFixedDeposits,
      cashbook,
      setCashbook,
      fixedAssets,
      setFixedAssets,
      loanProducts: loanProductsInner,
      setLoanProducts,
      provisioningConfig: provisioningInner,
      setProvisioningConfig,
      formatCurrency,
      setCurrentPage,
      approveLoan,
      rejectLoan,
      addLoan,
      saccoLoading,
      saccoError,
      refreshSaccoWorkspace,
      saccoLoanPolicies,
    }),
    [
      members,
      loans,
      fixedDeposits,
      cashbook,
      fixedAssets,
      loanProductsInner,
      provisioningInner,
      formatCurrency,
      setCurrentPage,
      setLoanProducts,
      setProvisioningConfig,
      approveLoan,
      rejectLoan,
      addLoan,
      saccoLoading,
      saccoError,
      refreshSaccoWorkspace,
      saccoLoanPolicies,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error("useAppContext must be used within AppProvider");
  }
  return ctx;
}
