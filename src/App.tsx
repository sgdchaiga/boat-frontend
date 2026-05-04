import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LoginPage } from "@/components/LoginPage";
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { RetailDashboard } from './components/RetailDashboard';
import { RoomsPage } from './components/RoomsPage';
import { ReservationsPage } from './components/ReservationsPage';
import { CheckInPage } from './components/CheckInPage';
import { CustomersPage } from './components/CustomersPage';
import { ActiveStaysPage } from './components/ActiveStaysPage';
import { POSPage } from './components/POSPage';
import { HotelPosKitchenBarPage } from './components/HotelPosKitchenBarPage';
import { HotelPosSupervisorPage } from './components/HotelPosSupervisorPage';
import { HotelPosReportsPage } from './components/HotelPosReportsPage';
import { POSDashboardPage } from './components/POSDashboard';
import { RetailPOSPage } from './components/RetailPOSPage';
import { RetailPosOrdersPage } from './components/RetailPosOrdersPage';
import { RetailInvoicesPage } from './components/RetailInvoicesPage';
import { RetailCustomersPage } from './components/RetailCustomersPage';
import { RetailCreditSalesReportPage } from './components/RetailCreditSalesReportPage';
import { BarOrdersPage } from './components/BarOrdersPage';
import { KitchenOrdersPage } from './components/KitchenOrdersPage';
import { KitchenMenuPage } from './components/KitchenMenuPage';
import { BillingPage } from './components/BillingPage';
import { PaymentsPage } from './components/PaymentsPage';
import { CashReceiptsPage } from './components/CashReceiptsPage';
import { TransactionsPage } from './components/TransactionsPage';
import { KitchenDisplayPage } from './components/KitchenDisplayPage';
import { HousekeepingPage } from './components/HousekeepingPage';
import ProductsPage from './components/ProductsPage';
import { InventoryBarcodesPage } from './components/InventoryBarcodesPage';
import { ReportsPage } from './components/ReportsPage';
import { DailySalesReportPage } from './components/DailySalesReportPage';
import { StockMovementReportPage } from './components/reports/StockMovementReportPage';
import { FinancialRevenueByChargeTypePage } from './components/reports/FinancialRevenueByChargeTypePage';
import { FinancialPaymentsByMethodPage } from './components/reports/FinancialPaymentsByMethodPage';
import { FinancialPaymentsByChargeTypePage } from './components/reports/FinancialPaymentsByChargeTypePage';
import { DailyPurchasesSummaryPage } from './components/reports/DailyPurchasesSummaryPage';
import { ManufacturingDailyProductionReportPage } from './components/reports/ManufacturingDailyProductionReportPage';
import { DailySummaryReportPage } from './components/reports/DailySummaryReportPage';
import { RetailShiftVarianceReportPage } from './components/reports/RetailShiftVarianceReportPage';
import { RetailSalesInsightsPage } from './components/reports/RetailSalesInsightsPage';
import { PurchasesByItemReportPage } from './components/reports/PurchasesByItemReportPage';
import { SalesByItemReportPage } from './components/reports/SalesByItemReportPage';
import { StaffPage } from './components/StaffPage';
import { GLAccountsPage } from './components/GLAccountsPage';
import { VendorsPage } from './components/purchases/VendorsPage';
import { ExpensesPage } from './components/purchases/ExpensesPage';
import { PurchaseOrdersPage } from './components/purchases/PurchaseOrdersPage';
import { BillsPage } from './components/purchases/BillsPage';
import { VendorPaymentsPage } from './components/purchases/VendorPaymentsPage';
import { VendorCreditsPage } from './components/purchases/VendorCreditsPage';
import { AdminPage, parseAdminTabParam } from './components/admin/AdminPage';
import { JournalEntriesPage } from './components/accounting/JournalEntriesPage';
import { ManualJournalsPage } from './components/accounting/ManualJournalsPage';
import { GeneralLedgerPage } from './components/accounting/GeneralLedgerPage';
import { TrialBalancePage } from './components/accounting/TrialBalancePage';
import { IncomeStatementPage } from './components/accounting/IncomeStatementPage';
import { BalanceSheetPage } from './components/accounting/BalanceSheetPage';
import { CashflowPage } from './components/accounting/CashflowPage';
import { BudgetingPage } from './components/accounting/BudgetingPage';
import { BudgetVarianceReportPage } from './components/accounting/BudgetVarianceReportPage';
import { FixedAssetsPage } from './components/fixedAssets/FixedAssetsPage';
import { AdminStockAdjustmentsPage } from './components/admin/AdminStockAdjustmentsPage';
import { StoreRequisitionsPage } from './components/inventory/StoreRequisitionsPage';
import { StockBalancesPage } from './components/inventory/StockBalancesPage';
import { ManufacturingPage } from './components/manufacturing/ManufacturingPage';
import { ManufacturingBomPage } from './components/manufacturing/ManufacturingBomPage';
import { ManufacturingWorkOrdersPage } from './components/manufacturing/ManufacturingWorkOrdersPage';
import { ManufacturingProductionEntriesPage } from './components/manufacturing/ManufacturingProductionEntriesPage';
import { ManufacturingCostingPage } from './components/manufacturing/ManufacturingCostingPage';
import { PlatformOverviewPage } from './components/platform/PlatformOverviewPage';
import { PlatformOrganizationsPage } from './components/platform/PlatformOrganizationsPage';
import { PlatformBusinessAdminsPage } from './components/platform/PlatformBusinessAdminsPage';
import { PlatformBusinessTypesPage } from './components/platform/PlatformBusinessTypesPage';
import { PlatformPlansPage } from './components/platform/PlatformPlansPage';
import { PlatformSuperUsersPage } from './components/platform/PlatformSuperUsersPage';
import { AppProvider } from './contexts/AppContext';
import SaccoDashboard from './components/sacco/SaccoDashboard';
import { SaccoOverviewPage } from './components/sacco/SaccoOverviewPage';
import { SaccoMembersPage } from './components/sacco/SaccoMembersPage';
import { SaccoSavingsAccountOpenPage } from './components/sacco/SaccoSavingsAccountOpenPage';
import { SaccoSavingsAccountsListPage } from './components/sacco/SaccoSavingsAccountsListPage';
import { SaccoMembersSavingsSettingsPage } from './components/sacco/SaccoMembersSavingsSettingsPage';
import { SaccoLoansPage } from './components/sacco/SaccoLoansPage';
import { SaccoCashbookPage } from './components/sacco/SaccoCashbookPage';
import { SaccoTellerPage } from './components/sacco/SaccoTellerPage';
import SaccoLoanList from './components/sacco/SaccoLoanList';
import SacoLoanInput from './components/sacco/SacoLoanInput';
import SaccoLoanApproval from './components/sacco/SaccoLoanApproval';
import SaccoLoanDashboard from './components/sacco/SaccoLoanDashboard';
import SaccoLoanReports, { type LoanReportTabId } from './components/sacco/SaccoLoanReports';
import SaccoLoanRecovery from './components/sacco/SaccoLoanRecovery';
import SaccoLoanSettings from './components/sacco/SaccoLoanSettings';
import SaccoLoanInterestCalc from './components/sacco/SaccoLoanInterestCalc';
import SaccoPerformanceDashboardPage from './components/sacco/SaccoPerformanceDashboardPage';
import SaccoLoanServicingPage from './components/sacco/SaccoLoanServicingPage';
import SaccoMemberProfilePage from './components/sacco/SaccoMemberProfilePage';
import SaccoSavingsStatementsPage from './components/sacco/SaccoSavingsStatementsPage';
import SaccoFinancialSummariesPage from './components/sacco/SaccoFinancialSummariesPage';
import SaccoSavingsInterest from './components/sacco/SaccoSavingsInterest';
import SaccoClientDashboard from './components/sacco/SaccoClientDashboard';
import { getModuleAccess, isPageAllowedForBusinessType, pageToModuleId } from './lib/moduleAccess';
import { defaultLandingPageForNavRole, isPageAllowedForNavRole } from './lib/navRoleExperience';
import { SACCOPRO_HOME_PAGE, SACCOPRO_PAGE } from './lib/saccoproPages';
import { SCHOOL_HOME_PAGE, SCHOOL_PAGE } from './lib/schoolPages';
import { VSLA_HOME_PAGE, VSLA_PAGE } from './lib/vslaPages';
import { PAYROLL_PAGE } from './lib/payrollPages';
import { HOTEL_ASSESSMENT_PAGE, HOTEL_PAGE } from './lib/hotelPages';
import { AdminRoomsPage } from './components/admin/AdminRoomsPage';
import { PayrollHubPage } from './components/payroll/PayrollHubPage';
import { PayrollStaffPage } from './components/payroll/PayrollStaffPage';
import { PayrollSettingsPage } from './components/payroll/PayrollSettingsPage';
import { PayrollLoansPage } from './components/payroll/PayrollLoansPage';
import { PayrollPeriodsPage } from './components/payroll/PayrollPeriodsPage';
import { PayrollRunPage } from './components/payroll/PayrollRunPage';
import { PayrollPayslipPage } from './components/payroll/PayrollPayslipPage';
import { PayrollAuditPage } from './components/payroll/PayrollAuditPage';
import { WalletPage } from './components/wallet/WalletPage';
import { SchoolDashboard } from './components/school/SchoolDashboard';
import { SchoolClassesPage } from './components/school/SchoolClassesPage';
import { SchoolStreamsPage } from './components/school/SchoolStreamsPage';
import { SchoolSubjectsPage } from './components/school/SchoolSubjectsPage';
import { SchoolTeachersPage } from './components/school/SchoolTeachersPage';
import { SchoolStudentsBioPage } from './components/school/SchoolStudentsBioPage';
import { StudentsListPage } from './components/school/SchoolStudentsListPage';
import { StudentsHealthPage } from './components/school/SchoolStudentsHealthPage';
import { SchoolParentsPage } from './components/school/SchoolParentsPage';
import { SchoolFeeStructuresPage } from './components/school/SchoolFeeStructuresPage';
import { SchoolSpecialFeeStructuresPage } from './components/school/SchoolSpecialFeeStructuresPage';
import { SchoolBursaryPage } from './components/school/SchoolBursaryPage';
import { SchoolStudentInvoicesPage } from './components/school/SchoolStudentInvoicesPage';
import { SchoolFeePaymentsPage } from './components/school/SchoolFeePaymentsPage';
import { SchoolOtherRevenuePage } from './components/school/SchoolOtherRevenuePage';
import { SchoolCollectionsSummaryPage } from './components/school/SchoolCollectionsSummaryPage';
import { SchoolFixedDepositPage } from './components/school/SchoolFixedDepositPage';
import { SchoolFeeCollectionsReportPage } from './components/school/reports/SchoolFeeCollectionsReportPage';
import { SchoolOutstandingBalancesReportPage } from './components/school/reports/SchoolOutstandingBalancesReportPage';
import { SchoolEnrollmentByClassReportPage } from './components/school/reports/SchoolEnrollmentByClassReportPage';
import { SchoolDailyCashReportPage } from './components/school/reports/SchoolDailyCashReportPage';
import { SchoolIncomeExpenditureReportPage } from './components/school/reports/SchoolIncomeExpenditureReportPage';
import { SchoolFeePaymentTrendsReportPage } from './components/school/reports/SchoolFeePaymentTrendsReportPage';
import { SchoolTopDefaultersReportPage } from './components/school/reports/SchoolTopDefaultersReportPage';
import { SchoolTermPerformanceReportPage } from './components/school/reports/SchoolTermPerformanceReportPage';
import { AccessDeniedNotice } from './components/common/AccessDeniedNotice';
import { PageNotes } from './components/common/PageNotes';
import { VslaDashboardPage } from './components/vsla/VslaDashboardPage';
import { VslaMembersPage } from './components/vsla/VslaMembersPage';
import { VslaSavingsPage } from './components/vsla/VslaSavingsPage';
import { VslaMeetingsPage } from './components/vsla/VslaMeetingsPage';
import { VslaLoansPage } from './components/vsla/VslaLoansPage';
import { VslaRepaymentsPage } from './components/vsla/VslaRepaymentsPage';
import { VslaFundsPage } from './components/vsla/VslaFundsPage';
import { VslaCashboxPage } from './components/vsla/VslaCashboxPage';
import { VslaShareOutPage } from './components/vsla/VslaShareOutPage';
import { VslaReportsPage } from './components/vsla/VslaReportsPage';
import { VslaControlsPage } from './components/vsla/VslaControlsPage';
import { VslaMeetingMinutesPage } from './components/vsla/VslaMeetingMinutesPage';
import { VslaMemberStatementPage } from './components/vsla/VslaMemberStatementPage';
import { CommunicationsPage } from './components/communications/CommunicationsPage';
import type { CommunicationsTabId } from './components/communications/CommunicationsPage';
import { canRunLocalSyncWorker, pushPendingLocalSyncQueue } from './lib/localSyncPush';
import { canRunLocalBackup, runLocalBackupNow } from './lib/localBackup';
import { AgentHubPage } from './components/agent/AgentHubPage';
import { HotelAssessmentDashboardPage } from './components/hotel-assessment/HotelAssessmentDashboardPage';
import { HotelAssessmentWizardPage } from './components/hotel-assessment/HotelAssessmentWizardPage';
import { IntegrationsHubPage } from './components/system/IntegrationsHubPage';
import { loadPermissionSnapshot } from './lib/permissions';

/** Old bookmarks / links: Financial Summary was removed; land on Revenue by Charge Type. */
function normalizeLegacyPage(page: string): string {
  const p = page.trim();
  if (p === "reports_financial") return "reports_financial_revenue_by_type";
  if (p === "guests" || p === "customers") return "hotel_customers";
  if (p === SCHOOL_PAGE.receipts) return SCHOOL_PAGE.payments;
  return p;
}

function getPageFromUrl(defaultPage: string) {
  if (typeof window === "undefined") return defaultPage;
  const qp = new URLSearchParams(window.location.search);
  const raw = (qp.get("page") || defaultPage).trim();
  return normalizeLegacyPage(raw);
}

/** Query keys mirrored to `pageState` and kept in sync via `history.replaceState`. */
const MANAGED_PAGE_STATE_KEYS = [
  "highlightBillId",
  "payBillId",
  "payVendorId",
  "highlightTransactionId",
  "highlightRequisitionId",
  "highlightAdjustmentSourceId",
  "invoiceTab",
  "highlightSaleId",
  "highlightCustomerId",
  "highlightGuestId",
  "highlightVendorId",
  "highlightPaymentId",
  "memberId",
  "payrollRunId",
  "payrollStaffId",
  "adminTab",
  "schoolFeeStudentId",
  "schoolFeeInvoiceId",
  "vslaMeetingTab",
  "vslaDisburseLoanId",
  "communicationsTab",
  "communicationsContext",
  "hotelAssessmentId",
  /** Prefill Receive money (cash_receipts) from hotel checkout / folio */
  "crSource",
  "crGuestId",
  "crGuestName",
  "crAmount",
  "crReference",
  "crDescription",
  "crStayId",
  "tellerDesk",
  "tellerTask",
  "cashbookView",
  "loanReportTab",
  "recoveryView",
  "memberRegister",
] as const;

function getPageStateFromUrl(): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  const qp = new URLSearchParams(window.location.search);
  const state: Record<string, unknown> = {};
  const highlightBillId = qp.get("highlightBillId");
  if (highlightBillId) state.highlightBillId = highlightBillId;
  const payBillId = qp.get("payBillId");
  if (payBillId) state.payBillId = payBillId;
  const payVendorId = qp.get("payVendorId");
  if (payVendorId) state.payVendorId = payVendorId;
  const highlightTransactionId = qp.get("highlightTransactionId");
  if (highlightTransactionId) state.highlightTransactionId = highlightTransactionId;
  const highlightRequisitionId = qp.get("highlightRequisitionId");
  if (highlightRequisitionId) state.highlightRequisitionId = highlightRequisitionId;
  const highlightAdjustmentSourceId = qp.get("highlightAdjustmentSourceId");
  if (highlightAdjustmentSourceId) state.highlightAdjustmentSourceId = highlightAdjustmentSourceId;
  const invoiceTab = qp.get("invoiceTab");
  if (invoiceTab === "credit" || invoiceTab === "invoices") state.invoiceTab = invoiceTab;
  const highlightSaleId = qp.get("highlightSaleId");
  if (highlightSaleId) state.highlightSaleId = highlightSaleId;
  const highlightCustomerId = qp.get("highlightCustomerId");
  if (highlightCustomerId) state.highlightCustomerId = highlightCustomerId;
  const highlightGuestId = qp.get("highlightGuestId");
  if (highlightGuestId) state.highlightGuestId = highlightGuestId;
  const highlightVendorId = qp.get("highlightVendorId");
  if (highlightVendorId) state.highlightVendorId = highlightVendorId;
  const highlightPaymentId = qp.get("highlightPaymentId");
  if (highlightPaymentId) state.highlightPaymentId = highlightPaymentId;
  const memberId = qp.get("memberId");
  if (memberId) state.memberId = memberId;
  const payrollRunId = qp.get("payrollRunId");
  if (payrollRunId) state.payrollRunId = payrollRunId;
  const payrollStaffId = qp.get("payrollStaffId");
  if (payrollStaffId) state.payrollStaffId = payrollStaffId;
  const adminTab = parseAdminTabParam(qp.get("adminTab"));
  if (adminTab) state.adminTab = adminTab;
  const schoolFeeStudentId = qp.get("schoolFeeStudentId");
  if (schoolFeeStudentId) state.schoolFeeStudentId = schoolFeeStudentId;
  const schoolFeeInvoiceId = qp.get("schoolFeeInvoiceId");
  if (schoolFeeInvoiceId) state.schoolFeeInvoiceId = schoolFeeInvoiceId;
  const vslaMeetingTab = qp.get("vslaMeetingTab");
  if (vslaMeetingTab) state.vslaMeetingTab = vslaMeetingTab;
  const vslaDisburseLoanId = qp.get("vslaDisburseLoanId");
  if (vslaDisburseLoanId) state.vslaDisburseLoanId = vslaDisburseLoanId;
  const communicationsTab = qp.get("communicationsTab");
  if (
    communicationsTab === "inbox" ||
    communicationsTab === "sms" ||
    communicationsTab === "whatsapp" ||
    communicationsTab === "internal"
  ) {
    state.communicationsTab = communicationsTab;
  }
  const communicationsContext = qp.get("communicationsContext");
  if (communicationsContext) state.communicationsContext = communicationsContext;
  const hotelAssessmentId = qp.get("hotelAssessmentId");
  if (hotelAssessmentId) state.hotelAssessmentId = hotelAssessmentId;
  const crSource = qp.get("crSource");
  if (crSource) state.crSource = crSource;
  const crGuestId = qp.get("crGuestId");
  if (crGuestId) state.crGuestId = crGuestId;
  const crGuestName = qp.get("crGuestName");
  if (crGuestName) state.crGuestName = crGuestName;
  const crAmount = qp.get("crAmount");
  if (crAmount) state.crAmount = crAmount;
  const crReference = qp.get("crReference");
  if (crReference) state.crReference = crReference;
  const crDescription = qp.get("crDescription");
  if (crDescription) state.crDescription = crDescription;
  const crStayId = qp.get("crStayId");
  if (crStayId) state.crStayId = crStayId;
  const tellerDesk = qp.get("tellerDesk");
  if (tellerDesk) state.tellerDesk = tellerDesk;
  const tellerTask = qp.get("tellerTask");
  if (tellerTask) state.tellerTask = tellerTask;
  const cashbookView = qp.get("cashbookView");
  if (cashbookView === "journal" || cashbookView === "reconciliation") state.cashbookView = cashbookView;
  const loanReportTab = qp.get("loanReportTab");
  if (
    loanReportTab === "summary" ||
    loanReportTab === "aging" ||
    loanReportTab === "disbursement" ||
    loanReportTab === "collection"
  ) {
    state.loanReportTab = loanReportTab;
  }
  const recoveryView = qp.get("recoveryView");
  if (recoveryView === "overdue" || recoveryView === "tracking") state.recoveryView = recoveryView;
  const memberRegister = qp.get("memberRegister");
  if (memberRegister === "1" || memberRegister?.toLowerCase() === "true") state.memberRegister = true;
  return state;
}

function AppContent() {
  const { user, loading, isSuperAdmin, isHotelStaff } = useAuth();
  const [currentPage, setCurrentPage] = useState(() => getPageFromUrl('dashboard'));
  const [pageState, setPageState] = useState<Record<string, unknown>>(() => getPageStateFromUrl());
  const navigate = (page: string, state?: Record<string, unknown>) => {
    setCurrentPage(normalizeLegacyPage(page));
    if (!state || Object.keys(state).length === 0) {
      setPageState({});
      return;
    }
    /** Normalize hotel → Receive money deep-link fields for URL sync */
    if (String(state.source) === "hotel_checkout") {
      setPageState({
        crSource: "hotel_checkout",
        crGuestId: String(state.guest_id ?? ""),
        crGuestName: String(state.guest_name ?? ""),
        crAmount: String(state.amount ?? ""),
        crReference: String(state.reference ?? ""),
        crDescription: String(state.description ?? ""),
        crStayId: String(state.stay_id ?? ""),
      });
      return;
    }
    setPageState(state);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("page", currentPage);
    for (const key of MANAGED_PAGE_STATE_KEYS) {
      const val = pageState[key];
      if (val != null && String(val) !== "") {
        url.searchParams.set(key, String(val));
      } else {
        url.searchParams.delete(key);
      }
    }
    window.history.replaceState({}, "", url.toString());
  }, [currentPage, pageState]);

  // Belt-and-suspenders: redirect if anything still sets the removed page id.
  useEffect(() => {
    if (currentPage === "reports_financial") {
      setCurrentPage("reports_financial_revenue_by_type");
    }
  }, [currentPage]);

  useEffect(() => {
    if (!user) {
      if (currentPage.startsWith("platform_")) {
        setCurrentPage("dashboard");
        setPageState({});
      }
      return;
    }
    // Previous session (e.g. superuser) may have left ?page=platform_* in state/URL — staff must not stay there.
    if (!isSuperAdmin && currentPage.startsWith("platform_")) {
      setCurrentPage(
        user.business_type === "retail"
          ? "retail_dashboard"
          : user.business_type === "sacco"
            ? SACCOPRO_HOME_PAGE
            : user.business_type === "vsla"
              ? VSLA_HOME_PAGE
            : "dashboard"
      );
      setPageState({});
      return;
    }
    if (user.business_type === "retail" && currentPage === "dashboard") {
      setCurrentPage("retail_dashboard");
      return;
    }
    if (user.business_type === "hotel" && currentPage === "dashboard") {
      setCurrentPage(user.enable_agent === false ? "dashboard" : "agent_hub");
      return;
    }
    if (user.business_type === "sacco" && currentPage === "dashboard") {
      setCurrentPage(SACCOPRO_HOME_PAGE);
      return;
    }
    if (user.business_type === "school" && currentPage === "dashboard") {
      setCurrentPage(SCHOOL_HOME_PAGE);
      return;
    }
    if (user.business_type === "school" && currentPage === "retail_dashboard") {
      setCurrentPage(SCHOOL_HOME_PAGE);
      return;
    }
    if (user.business_type === "vsla" && currentPage === "dashboard") {
      setCurrentPage(VSLA_HOME_PAGE);
      return;
    }
    if (user.business_type === "vsla" && currentPage === "retail_dashboard") {
      setCurrentPage(VSLA_HOME_PAGE);
      return;
    }
    if (
      user.business_type === "manufacturing" &&
      user.enable_manufacturing === false &&
      (currentPage === "dashboard" ||
        currentPage === "retail_dashboard" ||
        currentPage === "manufacturing" ||
        currentPage.startsWith("manufacturing_"))
    ) {
      setCurrentPage("admin");
      setPageState({});
      return;
    }
    if (user.business_type === "manufacturing" && user.enable_manufacturing !== false && currentPage === "dashboard") {
      setCurrentPage("manufacturing");
      return;
    }
    if (user.business_type === "manufacturing" && user.enable_manufacturing !== false && currentPage === "retail_dashboard") {
      setCurrentPage("manufacturing");
      return;
    }
    if (isSuperAdmin && !isHotelStaff && !currentPage.startsWith('platform_')) {
      setCurrentPage('platform_overview');
    }
  }, [user, isSuperAdmin, isHotelStaff, currentPage]);

  /** Cashier / storekeeper narrowed UX: bounce off deep-linked pages outside role allow‑list */
  useEffect(() => {
    if (!user?.id || user.isSuperAdmin) return;
    const bt = user.business_type ?? null;
    if (isPageAllowedForNavRole(currentPage, user.role, bt)) return;
    const next = defaultLandingPageForNavRole(user.role, bt);
    if (next && next !== currentPage) {
      setCurrentPage(next);
      setPageState({});
    }
  }, [user, currentPage]);

  useEffect(() => {
    if (!user?.id) return;
    if (!canRunLocalSyncWorker()) return;
    let inFlight = false;
    const run = async () => {
      if (inFlight) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      inFlight = true;
      try {
        await pushPendingLocalSyncQueue();
      } catch (err) {
        console.warn("[BOAT] Background sync failed", err);
      } finally {
        inFlight = false;
      }
    };
    void run();
    const timer = window.setInterval(() => {
      void run();
    }, 60_000);
    const onOnline = () => {
      void run();
    };
    window.addEventListener("online", onOnline);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    void loadPermissionSnapshot({
      organizationId: user.organization_id,
      staffId: user.id,
      role: user.role,
      isSuperAdmin: user.isSuperAdmin,
    }).catch((e) => {
      console.warn("Permission snapshot refresh failed", e);
    });
  }, [user?.id, user?.organization_id, user?.role, user?.isSuperAdmin]);

  useEffect(() => {
    if (!user?.id) return;
    if (!canRunLocalBackup()) return;
    let inFlight = false;
    const run = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        await runLocalBackupNow();
      } catch (err) {
        console.warn("[BOAT] Scheduled local backup failed", err);
      } finally {
        inFlight = false;
      }
    };
    void run();
    const timer = window.setInterval(() => {
      void run();
    }, 6 * 60 * 60 * 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [user?.id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-white text-lg">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  const renderPage = () => {
    // Special-case: retail users should never see the hotel dashboard/access-denied notice.
    if (user?.business_type === "retail" && currentPage === "dashboard") {
      return <RetailDashboard onNavigate={setCurrentPage} />;
    }
    if (user?.business_type === "sacco" && currentPage === "dashboard") {
      return <SaccoDashboard />;
    }
    if (user?.business_type === "school" && currentPage === "dashboard") {
      return <SchoolDashboard onNavigate={navigate} />;
    }
    if (user?.business_type === "vsla" && currentPage === "dashboard") {
      return <VslaDashboardPage onNavigate={navigate} readOnly={false} />;
    }
    if (
      user?.business_type === "manufacturing" &&
      currentPage === "dashboard" &&
      user?.enable_manufacturing !== false
    ) {
      return <ManufacturingPage readOnly={false} onNavigate={navigate} />;
    }

    const moduleId = pageToModuleId(currentPage);
    let access = moduleId
      ? getModuleAccess({
          moduleId,
          businessType: user?.business_type ?? null,
          subscriptionStatus: user?.subscription_status ?? "none",
          enableFixedAssets: user?.enable_fixed_assets === true,
          enableCommunications: user?.enable_communications !== false,
          enableWallet: user?.enable_wallet !== false,
          enablePayroll: user?.enable_payroll !== false,
          enableBudget: user?.enable_budget !== false,
          enableAgent: user?.business_type !== "retail" && user?.enable_agent !== false,
          enableHotelAssessment:
            (user?.business_type === "hotel" || user?.business_type === "mixed") &&
            user?.enable_hotel_assessment !== false,
          enableManufacturing: user?.enable_manufacturing !== false,
          enableReports: user?.enable_reports !== false,
          enableAccounting: user?.enable_accounting !== false,
          enableInventory: user?.enable_inventory !== false,
          enablePurchases: user?.enable_purchases !== false,
          schoolEnableReports: user?.school_enable_reports === true,
          schoolEnableFixedDeposit: user?.school_enable_fixed_deposit === true,
          schoolEnableAccounting: user?.school_enable_accounting === true,
          schoolEnableInventory: user?.school_enable_inventory === true,
          schoolEnablePurchases: user?.school_enable_purchases === true,
        })
      : { visible: true, readOnly: false };

    if (!isPageAllowedForBusinessType(currentPage, user?.business_type ?? null)) {
      access = {
        visible: false,
        readOnly: true,
        blockedReason: "This workspace is not available for your organization type.",
      };
    }

    if (
      !user?.isSuperAdmin &&
      access.visible &&
      !isPageAllowedForNavRole(currentPage, user.role, user?.business_type ?? null)
    ) {
      access = {
        visible: false,
        readOnly: true,
        blockedReason: "This workspace is not available for your role.",
      };
    }

    if (!access.visible) {
      const fallback =
        user?.business_type === "retail" ? (
          <RetailDashboard onNavigate={setCurrentPage} />
        ) : user?.business_type === "sacco" ? (
          <SaccoDashboard />
        ) : user?.business_type === "school" ? (
          <SchoolDashboard onNavigate={navigate} />
        ) : user?.business_type === "vsla" ? (
          <VslaDashboardPage onNavigate={navigate} readOnly={false} />
        ) : user?.business_type === "manufacturing" && user?.enable_manufacturing !== false ? (
          <ManufacturingPage readOnly={false} onNavigate={navigate} />
        ) : (
          <Dashboard onNavigate={setCurrentPage} />
        );
      return (
        <>
          <AccessDeniedNotice message={access.blockedReason || "This module is not available for your business type or subscription."} />
          {fallback}
        </>
      );
    }

    switch (currentPage) {
      case 'platform_overview':
        return <PlatformOverviewPage />;
      case 'platform_organizations':
        return <PlatformOrganizationsPage />;
      case 'platform_business_admins':
        return <PlatformBusinessAdminsPage />;
      case 'platform_business_types':
        return <PlatformBusinessTypesPage />;
      case 'platform_plans':
        return <PlatformPlansPage />;
      case 'platform_superusers':
        return <PlatformSuperUsersPage />;
      case 'communications':
        return (
          <CommunicationsPage
            initialTab={pageState?.communicationsTab as CommunicationsTabId | undefined}
            contextNote={pageState?.communicationsContext as string | undefined}
            onNavigate={navigate}
          />
        );
      case 'agent_hub':
        return <AgentHubPage />;
      case HOTEL_ASSESSMENT_PAGE.home:
        return <HotelAssessmentDashboardPage onNavigate={navigate} />;
      case HOTEL_ASSESSMENT_PAGE.run:
        return (
          <HotelAssessmentWizardPage
            onNavigate={navigate}
            resumeAssessmentId={pageState?.hotelAssessmentId as string | undefined}
          />
        );
      case 'dashboard':
        return <Dashboard onNavigate={setCurrentPage} />;
      case 'retail_dashboard':
        return <RetailDashboard onNavigate={setCurrentPage} />;
      case SACCOPRO_PAGE.dashboard:
        return <SaccoDashboard />;
      case SACCOPRO_PAGE.performanceDashboard:
        return <SaccoPerformanceDashboardPage />;
      case SACCOPRO_PAGE.overview:
        return <SaccoOverviewPage onNavigate={setCurrentPage} />;
      case SACCOPRO_PAGE.members:
        return (
          <SaccoMembersPage
            readOnly={access.readOnly}
            onNavigate={navigate}
            openMemberRegisterIntent={
              pageState.memberRegister === true ||
              pageState.memberRegister === "true" ||
              pageState.memberRegister === "1"
            }
            onConsumedMemberRegisterIntent={() => navigate(SACCOPRO_PAGE.members, {})}
          />
        );
      case SACCOPRO_PAGE.memberProfile:
        return (
          <SaccoMemberProfilePage
            memberIdFromNav={pageState.memberId as string | undefined}
            navigate={navigate}
          />
        );
      case SACCOPRO_PAGE.savingsSettings:
      case "sacco_members_savings_settings":
        return <SaccoMembersSavingsSettingsPage readOnly={access.readOnly} />;
      case SACCOPRO_PAGE.savingsAccountOpen:
        return (
          <SaccoSavingsAccountOpenPage
            readOnly={access.readOnly}
            memberIdFromNav={pageState.memberId as string | undefined}
            navigate={navigate}
          />
        );
      case SACCOPRO_PAGE.savingsAccountsList:
        return <SaccoSavingsAccountsListPage onNavigate={navigate} />;
      case SACCOPRO_PAGE.savingsStatements:
        return <SaccoSavingsStatementsPage navigate={navigate} />;
      case SACCOPRO_PAGE.savingsReports:
        return (
          <SaccoSavingsStatementsPage
            navigate={navigate}
            heading="Savings reports"
            intro="Balances and movements by member — read-only. Record deposits and withdrawals in Teller (Receive money / Give money)."
          />
        );
      case SACCOPRO_PAGE.financialSummaries:
        return <SaccoFinancialSummariesPage navigate={navigate} />;
      case SACCOPRO_PAGE.loans:
        return <SaccoLoansPage />;
      case SACCOPRO_PAGE.loanList:
        return <SaccoLoanList />;
      case SACCOPRO_PAGE.loanInput:
        return <SacoLoanInput />;
      case SACCOPRO_PAGE.loanApproval:
        return <SaccoLoanApproval pipeline="approval_gates" />;
      case SACCOPRO_PAGE.loanDisbursement:
        return <SaccoLoanApproval pipeline="disbursement_final" />;
      case SACCOPRO_PAGE.loanDashboard:
        return <SaccoLoanDashboard />;
      case SACCOPRO_PAGE.loanReports:
        return (
          <SaccoLoanReports
            navigate={navigate}
            loanReportTab={pageState.loanReportTab as LoanReportTabId | undefined}
          />
        );
      case SACCOPRO_PAGE.loanRecovery:
        return (
          <SaccoLoanRecovery
            navigate={navigate}
            recoveryView={pageState.recoveryView === "overdue" ? "overdue" : undefined}
          />
        );
      case SACCOPRO_PAGE.loanServicing:
        return <SaccoLoanServicingPage />;
      case SACCOPRO_PAGE.loanSettings:
        return <SaccoLoanSettings />;
      case SACCOPRO_PAGE.loanInterestCalc:
        return <SaccoLoanInterestCalc />;
      case SACCOPRO_PAGE.savingsInterest:
        return <SaccoSavingsInterest />;
      case SACCOPRO_PAGE.fixedDeposit:
        return (
          <div className="p-6 max-w-3xl mx-auto space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900">Fixed deposits</h1>
              <PageNotes ariaLabel="Fixed deposits notes">
                <p>
                  Term deposits and maturity — wire to Supabase and GL when ready. Summary figures also appear on the admin dashboard.
                </p>
              </PageNotes>
            </div>
          </div>
        );
      case SCHOOL_PAGE.dashboard:
        return <SchoolDashboard onNavigate={navigate} />;
      case SCHOOL_PAGE.classes:
        return <SchoolClassesPage readOnly={access.readOnly} />;
      case SCHOOL_PAGE.streams:
        return <SchoolStreamsPage readOnly={access.readOnly} />;
      case SCHOOL_PAGE.subjects:
        return <SchoolSubjectsPage readOnly={access.readOnly} />;
      case SCHOOL_PAGE.teachers:
        return <SchoolTeachersPage readOnly={access.readOnly} />;
      case SCHOOL_PAGE.students:
        return <SchoolStudentsBioPage />;
      case SCHOOL_PAGE.studentsList:
        return <StudentsListPage />;
      case SCHOOL_PAGE.healthIssues:
        return <StudentsHealthPage />;
      case SCHOOL_PAGE.parents:
        return <SchoolParentsPage readOnly={access.readOnly} />;
      case SCHOOL_PAGE.feeStructures:
        return <SchoolFeeStructuresPage readOnly={access.readOnly} />;
      case SCHOOL_PAGE.specialFeeStructures:
        return <SchoolSpecialFeeStructuresPage readOnly={access.readOnly} />;
      case SCHOOL_PAGE.bursary:
        return <SchoolBursaryPage readOnly={access.readOnly} />;
      case SCHOOL_PAGE.invoices:
        return <SchoolStudentInvoicesPage readOnly={access.readOnly} />;
      case SCHOOL_PAGE.payments:
        return (
          <SchoolFeePaymentsPage
            readOnly={access.readOnly}
            initialStudentId={pageState?.schoolFeeStudentId as string | undefined}
            initialInvoiceId={pageState?.schoolFeeInvoiceId as string | undefined}
          />
        );
      case SCHOOL_PAGE.otherRevenue:
        return <SchoolOtherRevenuePage readOnly={access.readOnly} />;
      case SCHOOL_PAGE.collections:
        return <SchoolCollectionsSummaryPage readOnly={access.readOnly} />;
      case SCHOOL_PAGE.fixedDeposit:
        return <SchoolFixedDepositPage readOnly={access.readOnly} />;
      case VSLA_PAGE.dashboard:
        return <VslaDashboardPage onNavigate={navigate} readOnly={access.readOnly} />;
      case VSLA_PAGE.members:
        return <VslaMembersPage readOnly={access.readOnly} />;
      case VSLA_PAGE.savings:
        return <VslaSavingsPage readOnly={access.readOnly} />;
      case VSLA_PAGE.meetings:
        return (
          <VslaMeetingsPage
            readOnly={access.readOnly}
            onNavigate={navigate}
            initialTab={pageState?.vslaMeetingTab as "attendance" | "savings" | "loans" | "repayments" | "cash" | undefined}
            initialDisburseLoanId={pageState?.vslaDisburseLoanId as string | undefined}
          />
        );
      case VSLA_PAGE.meetingMinutes:
        return <VslaMeetingMinutesPage readOnly={access.readOnly} />;
      case VSLA_PAGE.loans:
        return <VslaLoansPage readOnly={access.readOnly} onNavigate={navigate} />;
      case VSLA_PAGE.repayments:
        return <VslaRepaymentsPage readOnly={access.readOnly} />;
      case VSLA_PAGE.finesSocial:
        return <VslaFundsPage readOnly={access.readOnly} />;
      case VSLA_PAGE.cashbox:
        return <VslaCashboxPage readOnly={access.readOnly} />;
      case VSLA_PAGE.shareOut:
        return <VslaShareOutPage readOnly={access.readOnly} />;
      case VSLA_PAGE.reports:
        return <VslaReportsPage readOnly={access.readOnly} />;
      case VSLA_PAGE.controls:
        return <VslaControlsPage readOnly={access.readOnly} />;
      case VSLA_PAGE.memberStatement:
        return <VslaMemberStatementPage readOnly={access.readOnly} />;
      case SACCOPRO_PAGE.clientDashboard:
        return <SaccoClientDashboard />;
      case SACCOPRO_PAGE.cashbook:
        return (
          <SaccoCashbookPage
            cashbookView={(pageState?.cashbookView as "journal" | "reconciliation") || "journal"}
            navigate={navigate}
          />
        );
      case SACCOPRO_PAGE.teller:
        return (
          <SaccoTellerPage
            tellerDesk={pageState?.tellerDesk as string | undefined}
            tellerTask={pageState?.tellerTask as string | undefined}
            onDeskNavigate={navigate}
          />
        );
      case 'rooms':
        return <RoomsPage />;
      case HOTEL_PAGE.roomsSetup:
        return <AdminRoomsPage />;
      case 'reservations':
        return <ReservationsPage />;
      case 'checkin':
        return <CheckInPage />;
      case 'hotel_customers':
        return (
          <CustomersPage
            highlightCustomerId={
              (pageState?.highlightCustomerId ?? pageState?.highlightGuestId) as string | undefined
            }
          />
        );
      case 'stays':
        return (
          <ActiveStaysPage highlightGuestId={pageState?.highlightGuestId as string | undefined} onNavigate={navigate} />
        );
      case 'POS':
      case HOTEL_PAGE.posWaiter:
        return <POSPage readOnly={access.readOnly} compactMode="waiter" />;
      case HOTEL_PAGE.posKitchenBar:
        return <HotelPosKitchenBarPage />;
      case HOTEL_PAGE.posSupervisor:
        return <HotelPosSupervisorPage />;
      case HOTEL_PAGE.posReports:
        return <HotelPosReportsPage />;
      case 'pos_dashboard':
        return <POSDashboardPage />;
      case 'retail_pos':
        return <RetailPOSPage readOnly={access.readOnly} />;
      case 'retail_pos_orders':
        return <RetailPosOrdersPage />;
      case 'retail_customers':
        return (
          <RetailCustomersPage
            readOnly={access.readOnly}
            highlightCustomerId={pageState?.highlightCustomerId as string | undefined}
          />
        );
      case 'retail_credit_invoices':
        return (
          <RetailInvoicesPage
            readOnly={access.readOnly}
            onNavigate={navigate}
            invoiceTab={pageState?.invoiceTab as "invoices" | "credit" | undefined}
            highlightSaleId={pageState?.highlightSaleId as string | undefined}
          />
        );
      case 'retail_credit_sales_report':
        return <RetailCreditSalesReportPage readOnly={access.readOnly} onNavigate={navigate} />;
      case 'reports_retail_shift_variance':
        return <RetailShiftVarianceReportPage />;
      case 'reports_retail_sales_insights':
        return <RetailSalesInsightsPage />;
      case 'Bar Orders':
        return <BarOrdersPage />;
      case 'Kitchen Orders':
        return <KitchenOrdersPage />;
      case 'kitchen_menu':
        return <KitchenMenuPage readOnly={access.readOnly} onNavigate={navigate} />;
      case 'billing':
        return <BillingPage onNavigate={navigate} readOnly={access.readOnly} />;
      case 'payments':
        return (
          <PaymentsPage
            readOnly={access.readOnly}
            highlightPaymentId={pageState?.highlightPaymentId as string | undefined}
          />
        );
      case 'cash_receipts':
        return (
          <CashReceiptsPage
            readOnly={access.readOnly}
            pageState={pageState}
            onNavigate={navigate}
          />
        );
      case 'transactions':
        return <TransactionsPage highlightTransactionId={pageState?.highlightTransactionId as string | undefined} />;
      case 'kitchen_display':
        return <KitchenDisplayPage />;
      case 'housekeeping':
        return <HousekeepingPage />;
      case 'Products':
        return <ProductsPage readOnly={access.readOnly} />;
      case 'reports':
        return <ReportsPage onNavigate={navigate} />;
      case 'reports_school_fee_collections':
        return <SchoolFeeCollectionsReportPage readOnly={access.readOnly} />;
      case 'reports_school_outstanding':
        return <SchoolOutstandingBalancesReportPage readOnly={access.readOnly} />;
      case 'reports_school_enrollment':
        return <SchoolEnrollmentByClassReportPage readOnly={access.readOnly} />;
      case 'reports_school_daily_cash':
        return <SchoolDailyCashReportPage readOnly={access.readOnly} />;
      case 'reports_school_income_expenditure':
        return <SchoolIncomeExpenditureReportPage readOnly={access.readOnly} />;
      case 'reports_school_fee_trends':
        return <SchoolFeePaymentTrendsReportPage readOnly={access.readOnly} />;
      case 'reports_school_top_defaulters':
        return <SchoolTopDefaultersReportPage readOnly={access.readOnly} />;
      case 'reports_school_term_performance':
        return <SchoolTermPerformanceReportPage readOnly={access.readOnly} />;
      case 'reports_daily_sales':
        return <DailySalesReportPage />;
      case 'reports_daily_summary':
        return <DailySummaryReportPage />;
      case 'reports_financial_revenue_by_type':
        return <FinancialRevenueByChargeTypePage />;
      case 'reports_financial_payments_by_method':
        return <FinancialPaymentsByMethodPage />;
      case 'reports_financial_payments_by_charge_type':
        return <FinancialPaymentsByChargeTypePage />;
      case 'reports_daily_purchases_summary':
        return <DailyPurchasesSummaryPage />;
      case 'reports_stock_movement':
        return <StockMovementReportPage />;
      case 'reports_purchases_by_item':
        return <PurchasesByItemReportPage />;
      case 'reports_sales_by_item':
        return <SalesByItemReportPage />;
      case 'reports_manufacturing_daily_production':
        return <ManufacturingDailyProductionReportPage />;
      case 'inventory_stock_adjustments':
        return <AdminStockAdjustmentsPage highlightAdjustmentSourceId={pageState?.highlightAdjustmentSourceId as string | undefined} />;
      case 'inventory_stock_balances':
        return <StockBalancesPage />;
      case 'inventory_store_requisitions':
        return <StoreRequisitionsPage highlightRequisitionId={pageState?.highlightRequisitionId as string | undefined} />;
      case 'inventory_barcodes':
        return <InventoryBarcodesPage readOnly={access.readOnly} />;
      case 'manufacturing':
        return <ManufacturingPage readOnly={access.readOnly} onNavigate={navigate} />;
      case 'manufacturing_bom':
        return <ManufacturingBomPage readOnly={access.readOnly} />;
      case 'manufacturing_work_orders':
        return <ManufacturingWorkOrdersPage readOnly={access.readOnly} />;
      case 'manufacturing_production_entries':
        return <ManufacturingProductionEntriesPage readOnly={access.readOnly} />;
      case 'manufacturing_costing':
        return <ManufacturingCostingPage readOnly={access.readOnly} />;
      case PAYROLL_PAGE.hub:
        return <PayrollHubPage onNavigate={navigate} />;
      case PAYROLL_PAGE.staff:
        return <PayrollStaffPage readOnly={access.readOnly} />;
      case PAYROLL_PAGE.settings:
        return <PayrollSettingsPage readOnly={access.readOnly} />;
      case PAYROLL_PAGE.loans:
        return <PayrollLoansPage readOnly={access.readOnly} />;
      case PAYROLL_PAGE.periods:
        return <PayrollPeriodsPage readOnly={access.readOnly} />;
      case PAYROLL_PAGE.run:
        return <PayrollRunPage readOnly={access.readOnly} onNavigate={navigate} />;
      case PAYROLL_PAGE.audit:
        return <PayrollAuditPage readOnly={access.readOnly} />;
      case PAYROLL_PAGE.payslip:
        return (
          <PayrollPayslipPage
            payrollRunId={pageState?.payrollRunId as string | undefined}
            payrollStaffId={pageState?.payrollStaffId as string | undefined}
            onBack={() => navigate(PAYROLL_PAGE.run, { payrollRunId: undefined, payrollStaffId: undefined })}
          />
        );
      case 'wallet':
        return <WalletPage readOnly={access.readOnly} />;
      case 'staff':
        return <StaffPage readOnly={access.readOnly} />;
      case 'admin':
        return (
          <AdminPage
            readOnly={access.readOnly}
            initialTab={parseAdminTabParam(pageState?.adminTab as string | undefined) ?? null}
          />
        );
      case 'system_integrations':
        return <IntegrationsHubPage onNavigate={navigate} />;
      case 'gl_accounts':
        return <GLAccountsPage />;
      case 'purchases_vendors':
        return <VendorsPage highlightVendorId={pageState?.highlightVendorId as string | undefined} />;
      case 'purchases_expenses':
        return <ExpensesPage onNavigate={navigate} />;
      case 'purchases_orders':
        return <PurchaseOrdersPage onNavigate={navigate} readOnly={access.readOnly} />;
      case 'purchases_bills':
        return <BillsPage highlightBillId={pageState?.highlightBillId as string | undefined} onNavigate={navigate} readOnly={access.readOnly} />;
      case 'purchases_payments':
        return (
          <VendorPaymentsPage
            payBillId={pageState?.payBillId as string | undefined}
            payVendorId={pageState?.payVendorId as string | undefined}
            readOnly={access.readOnly}
            onNavigate={navigate}
          />
        );
      case 'purchases_credits':
        return <VendorCreditsPage readOnly={access.readOnly} />;
      case 'accounting_journal':
        return <JournalEntriesPage />;
      case 'accounting_manual':
        return <ManualJournalsPage />;
      case 'accounting_gl':
        return <GeneralLedgerPage />;
      case 'accounting_trial':
        return <TrialBalancePage />;
      case 'accounting_income':
        return <IncomeStatementPage />;
      case 'accounting_balance':
        return <BalanceSheetPage />;
      case 'accounting_cashflow':
        return <CashflowPage />;
      case 'accounting_budgeting':
        return <BudgetingPage readOnly={access.readOnly} />;
      case 'reports_budget_variance':
        return <BudgetVarianceReportPage />;
      case 'fixed_assets':
        return <FixedAssetsPage readOnly={access.readOnly} />;
      default:
        return user?.business_type === "retail" ? (
          <RetailDashboard onNavigate={setCurrentPage} />
        ) : user?.business_type === "sacco" ? (
          <SaccoDashboard />
        ) : user?.business_type === "school" ? (
          <SchoolDashboard onNavigate={navigate} />
        ) : user?.business_type === "vsla" ? (
          <VslaDashboardPage onNavigate={navigate} readOnly={false} />
        ) : user?.business_type === "manufacturing" && user?.enable_manufacturing !== false ? (
          <ManufacturingPage readOnly={false} onNavigate={navigate} />
        ) : (
          <Dashboard onNavigate={setCurrentPage} />
        );
    }
  };

  return (
    <AppProvider navigate={(p, state) => navigate(normalizeLegacyPage(p), state)}>
      <Layout currentPage={currentPage} pageState={pageState} onNavigate={(page, state) => navigate(page, state)}>
        {renderPage()}
      </Layout>
    </AppProvider>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;