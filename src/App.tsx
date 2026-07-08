import { Suspense, lazy, useState, useEffect, type ComponentType, type ReactNode } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LoginPage } from "@/components/LoginPage";
import { OrganizationPickerPage } from "@/components/OrganizationPickerPage";
import { SelfServiceOnboardingPage } from "@/components/SelfServiceOnboardingPage";
import { OnboardingChecklist } from "@/components/OnboardingChecklist";
import { Layout } from './components/Layout';
import { AppProvider } from './contexts/AppContext';
import SaccoSavingsStatementsPage from './components/sacco/SaccoSavingsStatementsPage';
import type { LoanReportTabId } from './components/sacco/SaccoLoanReports';
import { getModuleAccess, isPageAllowedForBusinessType, pageToModuleId } from './lib/moduleAccess';
import {
  defaultLandingPageForNavRole,
  defaultLandingStateForNavRole,
  isPageAllowedForNavRole,
} from './lib/navRoleExperience';
import { getRoleCapabilities } from './lib/roleCapabilities';
import { SACCOPRO_HOME_PAGE, SACCOPRO_PAGE } from './lib/saccoproPages';
import { SCHOOL_HOME_PAGE, SCHOOL_PAGE } from './lib/schoolPages';
import { VSLA_HOME_PAGE, VSLA_PAGE } from './lib/vslaPages';
import { PAYROLL_PAGE } from './lib/payrollPages';
import { HOTEL_ASSESSMENT_PAGE, HOTEL_PAGE } from './lib/hotelPages';
import { AccessDeniedNotice } from './components/common/AccessDeniedNotice';
import { PageNotes } from './components/common/PageNotes';
import type { CommunicationsTabId } from './components/communications/CommunicationsPage';
import { DesktopServerConnectionPage } from './components/system/DesktopServerConnectionPage';
import { desktopApi } from './lib/desktopApi';
import { isDesktopApiDataMode } from './lib/boatApi';
import { parseAdminTabParam } from './lib/adminTabs';

const lazyNamed = (
  loader: () => Promise<Record<string, ComponentType<any>>>,
  exportName: string
) =>
  lazy(async () => {
    const mod = await loader();
    return { default: mod[exportName] };
  });

const Dashboard = lazyNamed(() => import('./components/Dashboard'), 'Dashboard');
const RetailDashboard = lazyNamed(() => import('./components/RetailDashboard'), 'RetailDashboard');
const RoomsPage = lazyNamed(() => import('./components/RoomsPage'), 'RoomsPage');
const ReservationsPage = lazyNamed(() => import('./components/ReservationsPage'), 'ReservationsPage');
const CheckInPage = lazyNamed(() => import('./components/CheckInPage'), 'CheckInPage');
const CustomersPage = lazyNamed(() => import('./components/CustomersPage'), 'CustomersPage');
const ActiveStaysPage = lazyNamed(() => import('./components/ActiveStaysPage'), 'ActiveStaysPage');
const POSPage = lazyNamed(() => import('./components/POSPage'), 'POSPage');
const HotelPosKitchenBarPage = lazyNamed(() => import('./components/HotelPosKitchenBarPage'), 'HotelPosKitchenBarPage');
const HotelPosSupervisorPage = lazyNamed(() => import('./components/HotelPosSupervisorPage'), 'HotelPosSupervisorPage');
const HotelPosReportsPage = lazyNamed(() => import('./components/HotelPosReportsPage'), 'HotelPosReportsPage');
const POSDashboardPage = lazyNamed(() => import('./components/POSDashboard'), 'POSDashboardPage');
const RetailPOSPage = lazyNamed(() => import('./components/RetailPOSPage'), 'RetailPOSPage');
const ClinicPOSPage = lazyNamed(() => import('./components/clinic/ClinicPOSPage'), 'ClinicPOSPage');
const RetailPosOrdersPage = lazyNamed(() => import('./components/RetailPosOrdersPage'), 'RetailPosOrdersPage');
const RetailInvoicesPage = lazyNamed(() => import('./components/RetailInvoicesPage'), 'RetailInvoicesPage');
const RetailCustomersPage = lazyNamed(() => import('./components/RetailCustomersPage'), 'RetailCustomersPage');
const RetailCreditSalesReportPage = lazyNamed(() => import('./components/RetailCreditSalesReportPage'), 'RetailCreditSalesReportPage');
const ClinicDashboardPage = lazyNamed(() => import('./components/clinic/ClinicDashboardPage'), 'ClinicDashboardPage');
const ClinicPatientsPage = lazyNamed(() => import('./components/clinic/ClinicPatientsPage'), 'ClinicPatientsPage');
const ClinicConsultationPage = lazyNamed(() => import('./components/clinic/ClinicConsultationPage'), 'ClinicConsultationPage');
const ClinicLaboratoryPage = lazyNamed(() => import('./components/clinic/ClinicLaboratoryPage'), 'ClinicLaboratoryPage');
const BarOrdersPage = lazyNamed(() => import('./components/BarOrdersPage'), 'BarOrdersPage');
const KitchenOrdersPage = lazyNamed(() => import('./components/KitchenOrdersPage'), 'KitchenOrdersPage');
const KitchenMenuPage = lazyNamed(() => import('./components/KitchenMenuPage'), 'KitchenMenuPage');
const BillingPage = lazyNamed(() => import('./components/BillingPage'), 'BillingPage');
const PaymentsPage = lazyNamed(() => import('./components/PaymentsPage'), 'PaymentsPage');
const CashReceiptsPage = lazyNamed(() => import('./components/CashReceiptsPage'), 'CashReceiptsPage');
const TransactionsPage = lazyNamed(() => import('./components/TransactionsPage'), 'TransactionsPage');
const KitchenDisplayPage = lazyNamed(() => import('./components/KitchenDisplayPage'), 'KitchenDisplayPage');
const HousekeepingPage = lazyNamed(() => import('./components/HousekeepingPage'), 'HousekeepingPage');
const ProductsPage = lazy(() => import('./components/ProductsPage'));
const InventoryBarcodesPage = lazyNamed(() => import('./components/InventoryBarcodesPage'), 'InventoryBarcodesPage');
const ReportsPage = lazyNamed(() => import('./components/ReportsPage'), 'ReportsPage');
const DailySalesReportPage = lazyNamed(() => import('./components/DailySalesReportPage'), 'DailySalesReportPage');
const StockMovementReportPage = lazyNamed(() => import('./components/reports/StockMovementReportPage'), 'StockMovementReportPage');
const StockSummaryReportPage = lazyNamed(() => import('./components/reports/StockSummaryReportPage'), 'StockSummaryReportPage');
const FinancialRevenueByChargeTypePage = lazyNamed(() => import('./components/reports/FinancialRevenueByChargeTypePage'), 'FinancialRevenueByChargeTypePage');
const FinancialPaymentsByMethodPage = lazyNamed(() => import('./components/reports/FinancialPaymentsByMethodPage'), 'FinancialPaymentsByMethodPage');
const FinancialPaymentsByChargeTypePage = lazyNamed(() => import('./components/reports/FinancialPaymentsByChargeTypePage'), 'FinancialPaymentsByChargeTypePage');
const DailyPurchasesSummaryPage = lazyNamed(() => import('./components/reports/DailyPurchasesSummaryPage'), 'DailyPurchasesSummaryPage');
const ExpensesReportPage = lazyNamed(() => import('./components/reports/ExpensesReportPage'), 'ExpensesReportPage');
const ManufacturingDailyProductionReportPage = lazyNamed(() => import('./components/reports/ManufacturingDailyProductionReportPage'), 'ManufacturingDailyProductionReportPage');
const DailySummaryReportPage = lazyNamed(() => import('./components/reports/DailySummaryReportPage'), 'DailySummaryReportPage');
const RetailShiftVarianceReportPage = lazyNamed(() => import('./components/reports/RetailShiftVarianceReportPage'), 'RetailShiftVarianceReportPage');
const RetailSalesInsightsPage = lazyNamed(() => import('./components/reports/RetailSalesInsightsPage'), 'RetailSalesInsightsPage');
const PurchasesByItemReportPage = lazyNamed(() => import('./components/reports/PurchasesByItemReportPage'), 'PurchasesByItemReportPage');
const SalesByItemReportPage = lazyNamed(() => import('./components/reports/SalesByItemReportPage'), 'SalesByItemReportPage');
const PosCashCollectionsReportPage = lazyNamed(() => import('./components/reports/PosCashCollectionsReportPage'), 'PosCashCollectionsReportPage');
const RoomBillingReportPage = lazyNamed(() => import('./components/reports/RoomBillingReportPage'), 'RoomBillingReportPage');
const StockAdjustmentsReportPage = lazyNamed(() => import('./components/reports/StockAdjustmentsReportPage'), 'StockAdjustmentsReportPage');
const StaffPage = lazyNamed(() => import('./components/StaffPage'), 'StaffPage');
const GLAccountsPage = lazyNamed(() => import('./components/GLAccountsPage'), 'GLAccountsPage');
const VendorsPage = lazyNamed(() => import('./components/purchases/VendorsPage'), 'VendorsPage');
const ExpensesPage = lazyNamed(() => import('./components/purchases/ExpensesPage'), 'ExpensesPage');
const PurchaseOrdersPage = lazyNamed(() => import('./components/purchases/PurchaseOrdersPage'), 'PurchaseOrdersPage');
const BillsPage = lazyNamed(() => import('./components/purchases/BillsPage'), 'BillsPage');
const VendorPaymentsPage = lazyNamed(() => import('./components/purchases/VendorPaymentsPage'), 'VendorPaymentsPage');
const VendorCreditsPage = lazyNamed(() => import('./components/purchases/VendorCreditsPage'), 'VendorCreditsPage');
const CashOutReconciliationPage = lazyNamed(() => import('./components/purchases/CashOutReconciliationPage'), 'CashOutReconciliationPage');
const AdminPage = lazyNamed(() => import('./components/admin/AdminPage'), 'AdminPage');
const JournalEntriesPage = lazyNamed(() => import('./components/accounting/JournalEntriesPage'), 'JournalEntriesPage');
const ManualJournalsPage = lazyNamed(() => import('./components/accounting/ManualJournalsPage'), 'ManualJournalsPage');
const GeneralLedgerPage = lazyNamed(() => import('./components/accounting/GeneralLedgerPage'), 'GeneralLedgerPage');
const BankReconciliationPage = lazyNamed(() => import('./components/accounting/BankReconciliationPage'), 'BankReconciliationPage');
const PracticeWorkspacePage = lazyNamed(() => import('./components/accounting-practice/PracticeWorkspacePage'), 'PracticeWorkspacePage');
const PracticeStockTakePage = lazyNamed(() => import('./components/accounting-practice/PracticeStockTakePage'), 'PracticeStockTakePage');
const PracticeHousekeepingAuditPage = lazyNamed(() => import('./components/accounting-practice/PracticeHousekeepingAuditPage'), 'PracticeHousekeepingAuditPage');
const AssetVerificationPage = lazyNamed(() => import('./components/accounting-practice/AssetVerificationPage'), 'AssetVerificationPage');
const TrialBalancePage = lazyNamed(() => import('./components/accounting/TrialBalancePage'), 'TrialBalancePage');
const IncomeStatementPage = lazyNamed(() => import('./components/accounting/IncomeStatementPage'), 'IncomeStatementPage');
const PosIncomeReconciliationPage = lazyNamed(() => import('./components/accounting/PosIncomeReconciliationPage'), 'PosIncomeReconciliationPage');
const BalanceSheetPage = lazyNamed(() => import('./components/accounting/BalanceSheetPage'), 'BalanceSheetPage');
const CashflowPage = lazyNamed(() => import('./components/accounting/CashflowPage'), 'CashflowPage');
const BudgetingPage = lazyNamed(() => import('./components/accounting/BudgetingPage'), 'BudgetingPage');
const BudgetVarianceReportPage = lazyNamed(() => import('./components/accounting/BudgetVarianceReportPage'), 'BudgetVarianceReportPage');
const FixedAssetsPage = lazyNamed(() => import('./components/fixedAssets/FixedAssetsPage'), 'FixedAssetsPage');
const AdminStockAdjustmentsPage = lazyNamed(() => import('./components/admin/AdminStockAdjustmentsPage'), 'AdminStockAdjustmentsPage');
const StoreRequisitionsPage = lazyNamed(() => import('./components/inventory/StoreRequisitionsPage'), 'StoreRequisitionsPage');
const StockBalancesPage = lazyNamed(() => import('./components/inventory/StockBalancesPage'), 'StockBalancesPage');
const ManufacturingPage = lazyNamed(() => import('./components/manufacturing/ManufacturingPage'), 'ManufacturingPage');
const ManufacturingBomPage = lazyNamed(() => import('./components/manufacturing/ManufacturingBomPage'), 'ManufacturingBomPage');
const ManufacturingWorkOrdersPage = lazyNamed(() => import('./components/manufacturing/ManufacturingWorkOrdersPage'), 'ManufacturingWorkOrdersPage');
const ManufacturingProductionEntriesPage = lazyNamed(() => import('./components/manufacturing/ManufacturingProductionEntriesPage'), 'ManufacturingProductionEntriesPage');
const ManufacturingCostingPage = lazyNamed(() => import('./components/manufacturing/ManufacturingCostingPage'), 'ManufacturingCostingPage');
const CostAllocationPage = lazyNamed(() => import('./components/accounting/CostAllocationPage'), 'CostAllocationPage');
const ManufacturingPriceListsPage = lazyNamed(() => import('./components/manufacturing/ManufacturingPriceListsPage'), 'ManufacturingPriceListsPage');
const PlatformOverviewPage = lazyNamed(() => import('./components/platform/PlatformOverviewPage'), 'PlatformOverviewPage');
const PlatformOrganizationsPage = lazyNamed(() => import('./components/platform/PlatformOrganizationsPage'), 'PlatformOrganizationsPage');
const PlatformBusinessAdminsPage = lazyNamed(() => import('./components/platform/PlatformBusinessAdminsPage'), 'PlatformBusinessAdminsPage');
const PlatformBusinessTypesPage = lazyNamed(() => import('./components/platform/PlatformBusinessTypesPage'), 'PlatformBusinessTypesPage');
const PlatformPlansPage = lazyNamed(() => import('./components/platform/PlatformPlansPage'), 'PlatformPlansPage');
const PlatformSuperUsersPage = lazyNamed(() => import('./components/platform/PlatformSuperUsersPage'), 'PlatformSuperUsersPage');
const PlatformLinkUserPage = lazyNamed(() => import('./components/platform/PlatformLinkUserPage'), 'PlatformLinkUserPage');
const SaccoDashboard = lazy(() => import('./components/sacco/SaccoDashboard'));
const SaccoOverviewPage = lazyNamed(() => import('./components/sacco/SaccoOverviewPage'), 'SaccoOverviewPage');
const SaccoMembersPage = lazyNamed(() => import('./components/sacco/SaccoMembersPage'), 'SaccoMembersPage');
const SaccoSavingsAccountOpenPage = lazyNamed(() => import('./components/sacco/SaccoSavingsAccountOpenPage'), 'SaccoSavingsAccountOpenPage');
const SaccoSavingsAccountsListPage = lazyNamed(() => import('./components/sacco/SaccoSavingsAccountsListPage'), 'SaccoSavingsAccountsListPage');
const SaccoMembersSavingsSettingsPage = lazyNamed(() => import('./components/sacco/SaccoMembersSavingsSettingsPage'), 'SaccoMembersSavingsSettingsPage');
const SaccoBulkImportPage = lazyNamed(() => import('./components/sacco/SaccoBulkImportPage'), 'SaccoBulkImportPage');
const SaccoPermissionsPage = lazyNamed(() => import('./components/sacco/SaccoPermissionsPage'), 'SaccoPermissionsPage');
const SaccoLoansPage = lazyNamed(() => import('./components/sacco/SaccoLoansPage'), 'SaccoLoansPage');
const SaccoCashbookPage = lazyNamed(() => import('./components/sacco/SaccoCashbookPage'), 'SaccoCashbookPage');
const SaccoTellerPage = lazyNamed(() => import('./components/sacco/SaccoTellerPage'), 'SaccoTellerPage');
const SaccoLoanList = lazy(() => import('./components/sacco/SaccoLoanList'));
const SacoLoanInput = lazy(() => import('./components/sacco/SacoLoanInput'));
const SaccoLoanApproval = lazy(() => import('./components/sacco/SaccoLoanApproval'));
const SaccoLoanDashboard = lazy(() => import('./components/sacco/SaccoLoanDashboard'));
const SaccoLoanReports = lazy(() => import('./components/sacco/SaccoLoanReports'));
const SaccoLoanRecovery = lazy(() => import('./components/sacco/SaccoLoanRecovery'));
const SaccoLoanSettings = lazy(() => import('./components/sacco/SaccoLoanSettings'));
const SaccoLoanInterestCalc = lazy(() => import('./components/sacco/SaccoLoanInterestCalc'));
const SaccoPerformanceDashboardPage = lazy(() => import('./components/sacco/SaccoPerformanceDashboardPage'));
const SaccoLoanServicingPage = lazy(() => import('./components/sacco/SaccoLoanServicingPage'));
const SaccoMemberProfilePage = lazy(() => import('./components/sacco/SaccoMemberProfilePage'));
const SaccoFinancialSummariesPage = lazy(() => import('./components/sacco/SaccoFinancialSummariesPage'));
const SaccoSavingsInterest = lazy(() => import('./components/sacco/SaccoSavingsInterest'));
const SaccoClientDashboard = lazy(() => import('./components/sacco/SaccoClientDashboard'));
const SaccoMemberLoanApplication = lazyNamed(() => import('./components/sacco/SaccoMemberLoanApplication'), 'SaccoMemberLoanApplication');
const AdminRoomsPage = lazyNamed(() => import('./components/admin/AdminRoomsPage'), 'AdminRoomsPage');
const PayrollHubPage = lazyNamed(() => import('./components/payroll/PayrollHubPage'), 'PayrollHubPage');
const PayrollStaffPage = lazyNamed(() => import('./components/payroll/PayrollStaffPage'), 'PayrollStaffPage');
const PayrollSettingsPage = lazyNamed(() => import('./components/payroll/PayrollSettingsPage'), 'PayrollSettingsPage');
const PayrollLoansPage = lazyNamed(() => import('./components/payroll/PayrollLoansPage'), 'PayrollLoansPage');
const PayrollPeriodsPage = lazyNamed(() => import('./components/payroll/PayrollPeriodsPage'), 'PayrollPeriodsPage');
const PayrollRunPage = lazyNamed(() => import('./components/payroll/PayrollRunPage'), 'PayrollRunPage');
const PayrollPayslipPage = lazyNamed(() => import('./components/payroll/PayrollPayslipPage'), 'PayrollPayslipPage');
const PayrollAuditPage = lazyNamed(() => import('./components/payroll/PayrollAuditPage'), 'PayrollAuditPage');
const WalletPage = lazyNamed(() => import('./components/wallet/WalletPage'), 'WalletPage');
const TreasuryPage = lazyNamed(() => import('./components/treasury/TreasuryPage'), 'TreasuryPage');
const SchoolDashboard = lazyNamed(() => import('./components/school/SchoolDashboard'), 'SchoolDashboard');
const SchoolClassesPage = lazyNamed(() => import('./components/school/SchoolClassesPage'), 'SchoolClassesPage');
const SchoolStreamsPage = lazyNamed(() => import('./components/school/SchoolStreamsPage'), 'SchoolStreamsPage');
const SchoolSubjectsPage = lazyNamed(() => import('./components/school/SchoolSubjectsPage'), 'SchoolSubjectsPage');
const SchoolTeachersPage = lazyNamed(() => import('./components/school/SchoolTeachersPage'), 'SchoolTeachersPage');
const SchoolStudentsBioPage = lazyNamed(() => import('./components/school/SchoolStudentsBioPage'), 'SchoolStudentsBioPage');
const StudentsListPage = lazyNamed(() => import('./components/school/SchoolStudentsListPage'), 'StudentsListPage');
const StudentsHealthPage = lazyNamed(() => import('./components/school/SchoolStudentsHealthPage'), 'StudentsHealthPage');
const SchoolParentsPage = lazyNamed(() => import('./components/school/SchoolParentsPage'), 'SchoolParentsPage');
const SchoolFeeStructuresPage = lazyNamed(() => import('./components/school/SchoolFeeStructuresPage'), 'SchoolFeeStructuresPage');
const SchoolSpecialFeeStructuresPage = lazyNamed(() => import('./components/school/SchoolSpecialFeeStructuresPage'), 'SchoolSpecialFeeStructuresPage');
const SchoolBursaryPage = lazyNamed(() => import('./components/school/SchoolBursaryPage'), 'SchoolBursaryPage');
const SchoolStudentInvoicesPage = lazyNamed(() => import('./components/school/SchoolStudentInvoicesPage'), 'SchoolStudentInvoicesPage');
const SchoolFeePaymentsPage = lazyNamed(() => import('./components/school/SchoolFeePaymentsPage'), 'SchoolFeePaymentsPage');
const SchoolOtherRevenuePage = lazyNamed(() => import('./components/school/SchoolOtherRevenuePage'), 'SchoolOtherRevenuePage');
const SchoolCollectionsSummaryPage = lazyNamed(() => import('./components/school/SchoolCollectionsSummaryPage'), 'SchoolCollectionsSummaryPage');
const SchoolFixedDepositPage = lazyNamed(() => import('./components/school/SchoolFixedDepositPage'), 'SchoolFixedDepositPage');
const SchoolFeeCollectionsReportPage = lazyNamed(() => import('./components/school/reports/SchoolFeeCollectionsReportPage'), 'SchoolFeeCollectionsReportPage');
const SchoolOutstandingBalancesReportPage = lazyNamed(() => import('./components/school/reports/SchoolOutstandingBalancesReportPage'), 'SchoolOutstandingBalancesReportPage');
const SchoolEnrollmentByClassReportPage = lazyNamed(() => import('./components/school/reports/SchoolEnrollmentByClassReportPage'), 'SchoolEnrollmentByClassReportPage');
const SchoolDailyCashReportPage = lazyNamed(() => import('./components/school/reports/SchoolDailyCashReportPage'), 'SchoolDailyCashReportPage');
const SchoolIncomeExpenditureReportPage = lazyNamed(() => import('./components/school/reports/SchoolIncomeExpenditureReportPage'), 'SchoolIncomeExpenditureReportPage');
const SchoolFeePaymentTrendsReportPage = lazyNamed(() => import('./components/school/reports/SchoolFeePaymentTrendsReportPage'), 'SchoolFeePaymentTrendsReportPage');
const SchoolTopDefaultersReportPage = lazyNamed(() => import('./components/school/reports/SchoolTopDefaultersReportPage'), 'SchoolTopDefaultersReportPage');
const SchoolTermPerformanceReportPage = lazyNamed(() => import('./components/school/reports/SchoolTermPerformanceReportPage'), 'SchoolTermPerformanceReportPage');
const VslaDashboardPage = lazyNamed(() => import('./components/vsla/VslaDashboardPage'), 'VslaDashboardPage');
const VslaMembersPage = lazyNamed(() => import('./components/vsla/VslaMembersPage'), 'VslaMembersPage');
const VslaSavingsPage = lazyNamed(() => import('./components/vsla/VslaSavingsPage'), 'VslaSavingsPage');
const VslaMeetingsPage = lazyNamed(() => import('./components/vsla/VslaMeetingsPage'), 'VslaMeetingsPage');
const VslaLoansPage = lazyNamed(() => import('./components/vsla/VslaLoansPage'), 'VslaLoansPage');
const VslaRepaymentsPage = lazyNamed(() => import('./components/vsla/VslaRepaymentsPage'), 'VslaRepaymentsPage');
const VslaFundsPage = lazyNamed(() => import('./components/vsla/VslaFundsPage'), 'VslaFundsPage');
const VslaCashboxPage = lazyNamed(() => import('./components/vsla/VslaCashboxPage'), 'VslaCashboxPage');
const VslaShareOutPage = lazyNamed(() => import('./components/vsla/VslaShareOutPage'), 'VslaShareOutPage');
const VslaReportsPage = lazyNamed(() => import('./components/vsla/VslaReportsPage'), 'VslaReportsPage');
const VslaControlsPage = lazyNamed(() => import('./components/vsla/VslaControlsPage'), 'VslaControlsPage');
const VslaMeetingMinutesPage = lazyNamed(() => import('./components/vsla/VslaMeetingMinutesPage'), 'VslaMeetingMinutesPage');
const VslaMemberStatementPage = lazyNamed(() => import('./components/vsla/VslaMemberStatementPage'), 'VslaMemberStatementPage');
const CommunicationsPage = lazyNamed(() => import('./components/communications/CommunicationsPage'), 'CommunicationsPage');
const AgentHubPage = lazyNamed(() => import('./components/agent/AgentHubPage'), 'AgentHubPage');
const HotelAssessmentDashboardPage = lazyNamed(() => import('./components/hotel-assessment/HotelAssessmentDashboardPage'), 'HotelAssessmentDashboardPage');
const HotelAssessmentWizardPage = lazyNamed(() => import('./components/hotel-assessment/HotelAssessmentWizardPage'), 'HotelAssessmentWizardPage');
const IntegrationsHubPage = lazyNamed(() => import('./components/system/IntegrationsHubPage'), 'IntegrationsHubPage');
const BoatConnectPage = lazyNamed(() => import('./components/system/BoatConnectPage'), 'BoatConnectPage');
const ImageDocumentConverterPage = lazyNamed(() => import('./components/tools/ImageDocumentConverterPage'), 'ImageDocumentConverterPage');
const DataMigrationPage = lazyNamed(() => import('./components/DataMigrationPage'), 'DataMigrationPage');
const IndustryIntelligencePage = lazyNamed(() => import('./components/IndustryIntelligencePage'), 'IndustryIntelligencePage');
const EcosystemPage = lazyNamed(() => import('./components/EcosystemPage'), 'EcosystemPage');

function PageLoadingFallback() {
  return (
    <div className="min-h-[18rem] flex items-center justify-center p-6 text-sm text-slate-500">
      Loading workspace...
    </div>
  );
}

function pageSuspense(children: ReactNode) {
  return <Suspense fallback={<PageLoadingFallback />}>{children}</Suspense>;
}

function runWhenIdle(task: () => void, timeout = 2000) {
  if (typeof window === "undefined") return () => undefined;
  const idleCallback = window.requestIdleCallback;
  if (idleCallback) {
    const id = idleCallback(task, { timeout });
    return () => window.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(task, Math.min(timeout, 1000));
  return () => window.clearTimeout(id);
}

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
  "highlightVendorPaymentId",
  "memberId",
  "permissionsStaffId",
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
  "tellerReportsTab",
  "cashbookView",
  "loanReportTab",
  "recoveryView",
  "memberRegister",
  "highlightClinicPatientId",
  "clinicIntent",
  "highlightLabOrderId",
  "labTab",
  "posPanel",
  "barView",
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
  const highlightVendorPaymentId = qp.get("highlightVendorPaymentId");
  if (highlightVendorPaymentId) state.highlightVendorPaymentId = highlightVendorPaymentId;
  const memberId = qp.get("memberId");
  if (memberId) state.memberId = memberId;
  const permissionsStaffId = qp.get("permissionsStaffId");
  if (permissionsStaffId) state.permissionsStaffId = permissionsStaffId;
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
  const tellerReportsTab = qp.get("tellerReportsTab");
  if (tellerReportsTab === "recent_activity" || tellerReportsTab === "daily_summary") {
    state.tellerReportsTab = tellerReportsTab;
  }
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
  const highlightClinicPatientId = qp.get("highlightClinicPatientId");
  if (highlightClinicPatientId) state.highlightClinicPatientId = highlightClinicPatientId;
  const clinicIntent = qp.get("clinicIntent");
  if (clinicIntent === "new_patient" || clinicIntent === "new") state.clinicIntent = clinicIntent;
  const highlightLabOrderId = qp.get("highlightLabOrderId");
  if (highlightLabOrderId) state.highlightLabOrderId = highlightLabOrderId;
  const labTab = qp.get("labTab");
  if (labTab === "orders" || labTab === "results") state.labTab = labTab;
  const posPanel = qp.get("posPanel");
  if (posPanel === "tables" || posPanel === "orders" || posPanel === "new") state.posPanel = posPanel;
  const barView = qp.get("barView");
  if (barView === "queue" || barView === "pending" || barView === "completed") state.barView = barView;
  return state;
}

function AppContent() {
  const { user, loading, needsOrganizationPicker, memberships, isSuperAdmin, isHotelStaff, signOut, completeMemberInitialPassword } = useAuth();
  const [currentPage, setCurrentPage] = useState(() => getPageFromUrl('dashboard'));
  const [pageState, setPageState] = useState<Record<string, unknown>>(() => getPageStateFromUrl());
  const [pageHistory, setPageHistory] = useState<Array<{ page: string; state: Record<string, unknown> }>>([]);
  const needsServerConnection = isDesktopApiDataMode() && desktopApi.isAvailable();
  const [serverConnectionReady, setServerConnectionReady] = useState(!needsServerConnection);
  const [checkingServerConnection, setCheckingServerConnection] = useState(needsServerConnection);
  const [memberNewPassword, setMemberNewPassword] = useState("");
  const [memberConfirmPassword, setMemberConfirmPassword] = useState("");
  const [memberPasswordError, setMemberPasswordError] = useState<string | null>(null);
  const [memberPasswordSaving, setMemberPasswordSaving] = useState(false);

  useEffect(() => {
    if (!needsServerConnection) {
      setServerConnectionReady(true);
      setCheckingServerConnection(false);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setCheckingServerConnection(true);
      try {
        const settings = await desktopApi.getSettings();
        if (!settings.apiBaseUrl) {
          if (!cancelled) setServerConnectionReady(false);
          return;
        }
        const health = await desktopApi.checkApiHealth(settings.apiBaseUrl);
        if (!cancelled) setServerConnectionReady(health.ok);
      } catch {
        if (!cancelled) setServerConnectionReady(false);
      } finally {
        if (!cancelled) setCheckingServerConnection(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [needsServerConnection]);

  const navigate = (page: string, state?: Record<string, unknown>) => {
    const nextPage = normalizeLegacyPage(page);
    let nextState: Record<string, unknown> = {};
    if (!state || Object.keys(state).length === 0) {
      if (nextPage === currentPage && Object.keys(pageState).length === 0) return;
      setPageHistory((history) => [...history.slice(-49), { page: currentPage, state: pageState }]);
      setCurrentPage(nextPage);
      setPageState({});
      return;
    }
    /** Normalize hotel → Receive money deep-link fields for URL sync */
    if (String(state.source) === "hotel_checkout") {
      nextState = {
        crSource: "hotel_checkout",
        crGuestId: String(state.guest_id ?? ""),
        crGuestName: String(state.guest_name ?? ""),
        crAmount: String(state.amount ?? ""),
        crReference: String(state.reference ?? ""),
        crDescription: String(state.description ?? ""),
        crStayId: String(state.stay_id ?? ""),
      };
    } else {
      nextState = state;
    }
    if (nextPage === currentPage && JSON.stringify(nextState) === JSON.stringify(pageState)) return;
    setPageHistory((history) => [...history.slice(-49), { page: currentPage, state: pageState }]);
    setCurrentPage(nextPage);
    setPageState(nextState);
  };
  const navigateBack = () => {
    setPageHistory((history) => {
      const previous = history[history.length - 1];
      if (!previous) return history;
      setCurrentPage(previous.page);
      setPageState(previous.state);
      return history.slice(0, -1);
    });
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
          : user.business_type === "clinic"
            ? "clinic_dashboard"
            : user.business_type === "sacco"
              ? SACCOPRO_HOME_PAGE
              : user.business_type === "vsla"
                ? VSLA_HOME_PAGE
                : user.business_type === "accounting_practice"
                  ? "practice_clients"
                  : "dashboard"
      );
      setPageState({});
      return;
    }
    if (user.business_type === "retail" && currentPage === "dashboard") {
      setCurrentPage("retail_dashboard");
      return;
    }
    if (user.business_type === "accounting_practice" && (currentPage === "dashboard" || currentPage === "retail_dashboard")) {
      setCurrentPage("practice_clients");
      return;
    }
    if (user.business_type === "clinic" && currentPage === "dashboard") {
      setCurrentPage("clinic_dashboard");
      return;
    }
    if (user.business_type === "clinic" && currentPage === "retail_dashboard") {
      setCurrentPage("clinic_dashboard");
      return;
    }
    if (user.business_type === "clinic" && currentPage === "retail_pos") {
      setCurrentPage("clinic_pos");
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
    const nextState = defaultLandingStateForNavRole(user.role);
    if (next && next !== currentPage) {
      setCurrentPage(next);
      setPageState(nextState ?? {});
    }
  }, [user, currentPage]);

  useEffect(() => {
    if (!user?.id) return;
    if (!desktopApi.isAvailable()) return;
    let inFlight = false;
    let cancelled = false;
    const run = async () => {
      if (inFlight) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      inFlight = true;
      try {
        const { canRunLocalSyncWorker, pushPendingLocalSyncQueue } = await import("./lib/localSyncPush");
        if (cancelled || !canRunLocalSyncWorker()) return;
        await pushPendingLocalSyncQueue();
      } catch (err) {
        console.warn("[BOAT] Background sync failed", err);
      } finally {
        inFlight = false;
      }
    };
    const cancelInitialRun = runWhenIdle(() => {
      void run();
    }, 5000);
    const timer = window.setInterval(() => {
      void run();
    }, 60_000);
    const onOnline = () => {
      void run();
    };
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      cancelInitialRun();
      window.clearInterval(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    return runWhenIdle(() => {
      void import("./lib/permissions")
        .then(({ loadPermissionSnapshot }) =>
          loadPermissionSnapshot({
            organizationId: user.organization_id,
            staffId: user.id,
            role: user.role,
            isSuperAdmin: user.isSuperAdmin,
          })
        )
        .catch((e) => {
          console.warn("Permission snapshot refresh failed", e);
        });
    }, 3500);
  }, [user?.id, user?.organization_id, user?.role, user?.isSuperAdmin]);

  useEffect(() => {
    if (!user?.id) return;
    if (!desktopApi.isAvailable()) return;
    let inFlight = false;
    let cancelled = false;
    const run = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const { canRunLocalBackup, runLocalBackupNow } = await import("./lib/localBackup");
        if (cancelled || !canRunLocalBackup()) return;
        await runLocalBackupNow();
      } catch (err) {
        console.warn("[BOAT] Scheduled local backup failed", err);
      } finally {
        inFlight = false;
      }
    };
    const cancelInitialRun = runWhenIdle(() => {
      void run();
    }, 8000);
    const timer = window.setInterval(() => {
      void run();
    }, 6 * 60 * 60 * 1000);
    return () => {
      cancelled = true;
      cancelInitialRun();
      window.clearInterval(timer);
    };
  }, [user?.id]);

  if (checkingServerConnection) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-white text-lg">Checking BOAT server...</p>
        </div>
      </div>
    );
  }

  if (needsServerConnection && !serverConnectionReady) {
    return <DesktopServerConnectionPage onConnected={() => setServerConnectionReady(true)} />;
  }

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

  if (needsOrganizationPicker) {
    if (memberships.filter((m) => m.is_active).length === 0) {
      return <SelfServiceOnboardingPage />;
    }
    return <OrganizationPickerPage />;
  }

  if (user.isSaccoMember && user.sacco_member_id &&
      (!['active', 'invited'].includes(user.sacco_member_access_status || '') || user.sacco_member_must_change_password)) {
    if (!["active", "invited"].includes(user.sacco_member_access_status || "")) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
          <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-6 text-center shadow-lg">
            <h1 className="text-xl font-bold text-slate-900">Member app access suspended</h1>
            <p className="mt-2 text-sm text-slate-600">Contact your SACCO office to restore access. Your account records remain protected.</p>
            <button type="button" onClick={() => void signOut()} className="mt-5 min-h-11 rounded-xl bg-slate-900 px-5 font-semibold text-white">Sign out</button>
          </div>
        </div>
      );
    }
    if (user.sacco_member_must_change_password) {
      const saveMemberPassword = async (event: React.FormEvent) => {
        event.preventDefault();
        setMemberPasswordError(null);
        if (memberNewPassword.length < 8) return setMemberPasswordError("Use at least 8 characters.");
        if (memberNewPassword !== memberConfirmPassword) return setMemberPasswordError("Passwords do not match.");
        setMemberPasswordSaving(true);
        const { error } = await completeMemberInitialPassword(memberNewPassword);
        setMemberPasswordSaving(false);
        if (error) setMemberPasswordError(error.message);
      };
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
          <form onSubmit={saveMemberPassword} className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl">
            <div><h1 className="text-xl font-bold text-slate-900">Secure your member account</h1><p className="mt-1 text-sm text-slate-600">Replace the temporary password before opening the app.</p></div>
            {memberPasswordError && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{memberPasswordError}</p>}
            <label className="block text-sm font-semibold">New password<input type="password" autoComplete="new-password" required minLength={8} value={memberNewPassword} onChange={(e) => setMemberNewPassword(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
            <label className="block text-sm font-semibold">Confirm password<input type="password" autoComplete="new-password" required value={memberConfirmPassword} onChange={(e) => setMemberConfirmPassword(e.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
            <button disabled={memberPasswordSaving} className="min-h-11 w-full rounded-xl bg-emerald-600 font-bold text-white disabled:opacity-50">{memberPasswordSaving ? "Saving…" : "Set password and continue"}</button>
          </form>
        </div>
      );
    }
    if (currentPage === SACCOPRO_PAGE.loanInput) {
      return pageSuspense(<SaccoMemberLoanApplication memberId={user.sacco_member_id} onBack={() => navigate(SACCOPRO_PAGE.clientDashboard)} />);
    }
    if (currentPage === SACCOPRO_PAGE.savingsStatements) {
      return <div className="min-h-screen bg-slate-100 p-3 sm:p-6"><button type="button" onClick={() => navigate(SACCOPRO_PAGE.clientDashboard)} className="mb-4 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">← Back to member app</button><SaccoSavingsStatementsPage memberIdFromNav={user.sacco_member_id} navigate={navigate} /></div>;
    }
    return pageSuspense(<SaccoClientDashboard memberIdFromAuth={user.sacco_member_id} memberMode navigate={navigate} />);
  }

  const renderPage = () => {
    // Special-case: retail users should never see the hotel dashboard/access-denied notice.
    if (user?.business_type === "retail" && currentPage === "dashboard") {
      return <RetailDashboard onNavigate={navigate} />;
    }
    if (user?.business_type === "accounting_practice" && currentPage === "dashboard") {
      return <PracticeWorkspacePage section="clients" readOnly={false} />;
    }
    if (user?.business_type === "clinic" && currentPage === "dashboard") {
      return <ClinicDashboardPage onNavigate={navigate} />;
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
          enableAssetVerification: user?.enable_asset_verification === true,
          enableCommunications: user?.enable_communications !== false,
          enableWallet: user?.enable_wallet !== false,
          enablePayroll: user?.enable_payroll !== false,
          enableBudget: user?.enable_budget !== false,
          enableTreasury: user?.enable_treasury !== false,
          enableReconciliation: user?.enable_reconciliation !== false,
          enableAgent: user?.business_type !== "retail" && user?.business_type !== "clinic" && user?.enable_agent !== false,
          enableBoatConnect: user?.enable_boat_connect !== false,
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
        blockedReason: "This workspace is hidden by your user page-access settings.",
      };
    }

    if (!access.visible) {
      const fallback =
        user?.business_type === "retail" ? (
          <RetailDashboard onNavigate={navigate} />
        ) : user?.business_type === "clinic" ? (
          <ClinicDashboardPage onNavigate={navigate} />
        ) : user?.business_type === "sacco" ? (
          <SaccoDashboard />
        ) : user?.business_type === "school" ? (
          <SchoolDashboard onNavigate={navigate} />
        ) : user?.business_type === "vsla" ? (
          <VslaDashboardPage onNavigate={navigate} readOnly={false} />
        ) : user?.business_type === "manufacturing" && user?.enable_manufacturing !== false ? (
          <ManufacturingPage readOnly={false} onNavigate={navigate} />
        ) : (
          <Dashboard onNavigate={navigate} />
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
      case 'platform_link_user':
        return <PlatformLinkUserPage />;
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
        return <Dashboard onNavigate={navigate} />;
      case 'practice_dashboard':
      case 'practice_clients':
        return <PracticeWorkspacePage section="clients" readOnly={access.readOnly} />;
      case 'practice_engagements':
        return <PracticeWorkspacePage section="engagements" readOnly={access.readOnly} />;
      case 'practice_documents':
        return <PracticeWorkspacePage section="documents" readOnly={access.readOnly} />;
      case 'practice_reconciliation':
        return <PracticeWorkspacePage section="reconciliation" readOnly={access.readOnly} />;
      case 'practice_tasks':
        return <PracticeWorkspacePage section="tasks" readOnly={access.readOnly} />;
      case 'practice_billing':
        return <PracticeWorkspacePage section="billing" readOnly={access.readOnly} />;
      case 'practice_stock_take':
        return <PracticeStockTakePage readOnly={access.readOnly} />;
      case 'practice_housekeeping_audit':
        return <PracticeHousekeepingAuditPage />;
      case 'asset_verification':
        return <AssetVerificationPage readOnly={access.readOnly} />;
      case 'retail_dashboard':
        return <RetailDashboard onNavigate={navigate} />;
      case SACCOPRO_PAGE.dashboard:
        return <SaccoDashboard />;
      case SACCOPRO_PAGE.performanceDashboard:
        return <SaccoPerformanceDashboardPage />;
      case SACCOPRO_PAGE.overview:
        return <SaccoOverviewPage onNavigate={navigate} />;
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
      case SACCOPRO_PAGE.bulkImport:
        return <SaccoBulkImportPage readOnly={access.readOnly} />;
      case SACCOPRO_PAGE.loanBulkImport:
        return <SaccoBulkImportPage readOnly={access.readOnly} lockedKind="loan_products" />;
      case SACCOPRO_PAGE.loanPortfolioImport:
        return <SaccoBulkImportPage readOnly={access.readOnly} lockedKind="member_loans" />;
      case SACCOPRO_PAGE.permissions:
        return (
          <SaccoPermissionsPage
            readOnly={access.readOnly}
            focusStaffId={pageState.permissionsStaffId as string | undefined}
          />
        );
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
        return (
          <SaccoSavingsStatementsPage
            navigate={navigate}
            memberIdFromNav={pageState.memberId as string | undefined}
          />
        );
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
        return <SacoLoanInput initialMemberId={pageState.memberId as string | undefined} />;
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
      case SACCOPRO_PAGE.memberApp:
      case SACCOPRO_PAGE.clientDashboard:
        return <SaccoClientDashboard navigate={navigate} readOnly={access.readOnly} />;
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
            tellerReportsTab={pageState?.tellerReportsTab as string | undefined}
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
            readOnly={access.readOnly}
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
      case HOTEL_PAGE.posWaiter: {
        const caps = getRoleCapabilities(user?.role);
        const panel =
          pageState?.posPanel === "orders" || pageState?.posPanel === "tables" || pageState?.posPanel === "new"
            ? pageState.posPanel
            : "tables";
        return (
          <POSPage
            readOnly={access.readOnly || !caps.canEditPrices}
            compactMode="waiter"
            posPanel={panel}
            hidePricing={caps.hidePricing}
          />
        );
      }
      case HOTEL_PAGE.posKitchenBar:
        return <HotelPosKitchenBarPage />;
      case HOTEL_PAGE.posSupervisor:
        return <HotelPosSupervisorPage />;
      case HOTEL_PAGE.posReports:
        return <HotelPosReportsPage />;
      case 'pos_dashboard':
        return <POSDashboardPage />;
      case 'clinic_pos':
        return <ClinicPOSPage readOnly={access.readOnly} />;
      case 'retail_pos':
        return <RetailPOSPage readOnly={access.readOnly} />;
      case 'retail_pos_orders':
        return <RetailPosOrdersPage />;
      case 'retail_customers':
        if (user?.business_type === 'clinic') {
          return (
            <ClinicPatientsPage
              highlightPatientId={
                (pageState?.highlightClinicPatientId ?? pageState?.highlightCustomerId) as string | undefined
              }
              openRegister={pageState?.clinicIntent === 'new_patient'}
              onConsumedNavigateIntent={() => navigate('retail_customers', {})}
            />
          );
        }
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
      case 'clinic_dashboard':
        return <ClinicDashboardPage onNavigate={navigate} />;
      case 'clinic_patients':
        return (
          <ClinicPatientsPage
            highlightPatientId={pageState?.highlightClinicPatientId as string | undefined}
            openRegister={pageState?.clinicIntent === 'new_patient'}
            onConsumedNavigateIntent={() => navigate('clinic_patients', {})}
          />
        );
      case 'clinic_consultation':
        return (
          <ClinicConsultationPage
            openNew={pageState?.clinicIntent === 'new'}
            onConsumedNavigateIntent={() => navigate('clinic_consultation', {})}
          />
        );
      case 'clinic_laboratory':
        return (
          <ClinicLaboratoryPage
            readOnly={access.readOnly}
            initialTab={pageState?.labTab === 'results' ? 'results' : 'orders'}
            highlightLabOrderId={pageState?.highlightLabOrderId as string | undefined}
            onConsumedNavigateIntent={() => navigate('clinic_laboratory', {})}
          />
        );
      case 'reports_retail_shift_variance':
        return <RetailShiftVarianceReportPage />;
      case 'reports_retail_sales_insights':
        return (
          <RetailSalesInsightsPage
            clinicOnly={pageState?.clinicOnly === true || pageState?.clinicOnly === "true"}
            onNavigate={navigate}
          />
        );
      case 'Bar Orders': {
        const caps = getRoleCapabilities(user?.role);
        const barView =
          pageState?.barView === "queue" || pageState?.barView === "pending" || pageState?.barView === "completed"
            ? pageState.barView
            : "queue";
        return (
          <BarOrdersPage
            readOnly={access.readOnly || !caps.canEditPrices}
            initialBarView={barView}
            hidePricing={caps.hidePricing}
          />
        );
      }
      case 'Kitchen Orders':
        return (
          <KitchenOrdersPage
            readOnly={access.readOnly}
            hidePricing={getRoleCapabilities(user?.role).hidePricing}
          />
        );
      case 'kitchen_menu':
        return <KitchenMenuPage readOnly={access.readOnly} onNavigate={navigate} />;
      case 'billing':
        return <BillingPage onNavigate={navigate} readOnly={access.readOnly} />;
      case 'payments':
        return (
          <PaymentsPage
            readOnly={access.readOnly}
            highlightPaymentId={pageState?.highlightPaymentId as string | undefined}
            openRecordPayment={Boolean(pageState?.openRecordPayment)}
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
        return <KitchenDisplayPage hidePricing={getRoleCapabilities(user?.role).hidePricing} />;
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
      case 'reports_expenses':
        return <ExpensesReportPage />;
      case 'reports_stock_movement':
        return <StockMovementReportPage />;
      case 'reports_stock_summary':
        return <StockSummaryReportPage />;
      case 'reports_stock_adjustments':
        return <StockAdjustmentsReportPage />;
      case 'reports_purchases_by_item':
        return <PurchasesByItemReportPage />;
      case 'reports_sales_by_item':
        return <SalesByItemReportPage />;
      case 'reports_pos_cash_collections':
        return <PosCashCollectionsReportPage />;
      case 'reports_room_billing':
        return <RoomBillingReportPage />;
      case 'reports_manufacturing_daily_production':
        return <ManufacturingDailyProductionReportPage />;
      case 'inventory_stock_adjustments':
        return (
          <AdminStockAdjustmentsPage
            highlightAdjustmentSourceId={pageState?.highlightAdjustmentSourceId as string | undefined}
            readOnly={access.readOnly}
          />
        );
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
      case 'accounting_cost_allocation':
      case 'manufacturing_cost_allocation':
        return <CostAllocationPage readOnly={access.readOnly} />;
      case 'manufacturing_price_lists':
        return <ManufacturingPriceListsPage readOnly={access.readOnly} />;
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
      case 'treasury':
        return <TreasuryPage readOnly={access.readOnly} />;
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
      case 'ecosystem':
        return <EcosystemPage onNavigate={navigate} />;
      case 'data_migration':
        return <DataMigrationPage readOnly={access.readOnly} onNavigate={navigate} />;
      case 'industry_intelligence':
        return <IndustryIntelligencePage onNavigate={navigate} />;
      case 'boat_connect':
        return <BoatConnectPage readOnly={access.readOnly} />;
      case 'image_document_converter':
        return <ImageDocumentConverterPage />;
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
            highlightVendorPaymentId={pageState?.highlightVendorPaymentId as string | undefined}
            readOnly={access.readOnly}
            onNavigate={navigate}
          />
        );
      case 'purchases_credits':
        return <VendorCreditsPage readOnly={access.readOnly} />;
      case 'purchases_cash_out_reconciliation':
        return <CashOutReconciliationPage onNavigate={navigate} />;
      case 'accounting_journal':
        return <JournalEntriesPage />;
      case 'accounting_manual':
        return <ManualJournalsPage />;
      case 'accounting_gl':
        return <GeneralLedgerPage />;
      case 'accounting_bank_reconciliation':
        return <BankReconciliationPage readOnly={access.readOnly} />;
      case 'accounting_trial':
        return <TrialBalancePage />;
      case 'accounting_income':
        return <IncomeStatementPage />;
      case 'accounting_pos_income_reconciliation':
        return <PosIncomeReconciliationPage />;
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
          <RetailDashboard onNavigate={navigate} />
        ) : user?.business_type === "clinic" ? (
          <ClinicDashboardPage onNavigate={navigate} />
        ) : user?.business_type === "sacco" ? (
          <SaccoDashboard />
        ) : user?.business_type === "school" ? (
          <SchoolDashboard onNavigate={navigate} />
        ) : user?.business_type === "vsla" ? (
          <VslaDashboardPage onNavigate={navigate} readOnly={false} />
        ) : user?.business_type === "manufacturing" && user?.enable_manufacturing !== false ? (
          <ManufacturingPage readOnly={false} onNavigate={navigate} />
        ) : (
          <Dashboard onNavigate={navigate} />
        );
    }
  };

  const renderMemberPage = () => {
    if (!user.sacco_member_id) return null;
    if (currentPage === SACCOPRO_PAGE.loanInput) {
      return <SaccoMemberLoanApplication memberId={user.sacco_member_id} onBack={() => navigate(SACCOPRO_PAGE.clientDashboard)} />;
    }
    if (currentPage === SACCOPRO_PAGE.savingsStatements) {
      return <div className="min-h-screen bg-slate-100 p-3 sm:p-6"><button type="button" onClick={() => navigate(SACCOPRO_PAGE.clientDashboard)} className="mb-4 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">Back to member app</button><SaccoSavingsStatementsPage memberIdFromNav={user.sacco_member_id} navigate={navigate} /></div>;
    }
    return <SaccoClientDashboard memberIdFromAuth={user.sacco_member_id} memberMode navigate={navigate} />;
  };

  return (
    <AppProvider navigate={(p, state) => navigate(normalizeLegacyPage(p), state)}>
      {user.isSaccoMember ? pageSuspense(renderMemberPage()) : <Layout
        currentPage={currentPage}
        pageState={pageState}
        onNavigate={(page, state) => navigate(page, state)}
        onBack={navigateBack}
        canGoBack={pageHistory.length > 0}
      >
        <OnboardingChecklist onNavigate={(page) => navigate(page)} />
        {pageSuspense(renderPage())}
      </Layout>}
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
