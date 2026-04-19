import { ReactNode, useState, useMemo } from 'react';
import {
  Hotel,
  LayoutDashboard,
  BedDouble,
  CreditCard,
  Receipt,
  FileText,
  UsersRound,
  LogOut,
  Menu,
  X,
  ChevronDown,
  ChevronRight,
  ShoppingCart,
  Settings,
  Building2,
  Shield,
  PiggyBank,
  BookMarked,
  Banknote,
  Home,
  TrendingUp,
  GraduationCap,
  BookOpen,
  Wallet,
  Factory,
  MessageSquare,
} from 'lucide-react';
import { APP_SHORT_NAME } from '../constants/branding';
import { SACCOPRO_PAGE } from '@/lib/saccoproPages';
import { SCHOOL_PAGE } from '@/lib/schoolPages';
import { VSLA_PAGE } from '@/lib/vslaPages';
import { PAYROLL_PAGE } from '@/lib/payrollPages';
import { HOTEL_PAGE } from '@/lib/hotelPages';
import { useAuth } from '../contexts/AuthContext';
import { getModuleAccess, pageToModuleId } from '../lib/moduleAccess';

interface LayoutProps {
  children: ReactNode;
  currentPage: string;
  onNavigate: (page: string, state?: Record<string, unknown>) => void;
}

type NavLeaf = { name: string; icon: typeof FileText; page: string };
/** Single link or a labeled subgroup (used under Reports). */
export type NavChild =
  | { name: string; page: string }
  | { group: string; items: { name: string; page: string }[] };
type NavItem =
  | NavLeaf
  | {
      name: string;
      icon: typeof FileText;
      children: NavChild[];
    };

function navSectionAccent(sectionName: string) {
  const map: Record<string, { activeChild: string; groupHeader: string }> = {
    'Front Desk': {
      activeChild: 'bg-sky-500 text-white shadow-sm',
      groupHeader: 'text-sky-100 bg-slate-800/50 border-l-2 border-sky-500',
    },
    Sales: {
      activeChild: 'bg-emerald-500 text-white shadow-sm',
      groupHeader: 'text-emerald-100 bg-slate-800/50 border-l-2 border-emerald-500',
    },
    Purchases: {
      activeChild: 'bg-amber-500 text-white shadow-sm',
      groupHeader: 'text-amber-100 bg-slate-800/50 border-l-2 border-amber-500',
    },
    Inventory: {
      activeChild: 'bg-violet-500 text-white shadow-sm',
      groupHeader: 'text-violet-100 bg-slate-800/50 border-l-2 border-violet-500',
    },
    Manufacturing: {
      activeChild: 'bg-orange-500 text-white shadow-sm',
      groupHeader: 'text-orange-100 bg-slate-800/50 border-l-2 border-orange-500',
    },
    Accounting: {
      activeChild: 'bg-cyan-500 text-white shadow-sm',
      groupHeader: 'text-cyan-100 bg-slate-800/50 border-l-2 border-cyan-500',
    },
    Budget: {
      activeChild: 'bg-sky-600 text-white shadow-sm',
      groupHeader: 'text-sky-100 bg-slate-800/50 border-l-2 border-sky-500',
    },
    Reports: {
      activeChild: 'bg-rose-500 text-white shadow-sm',
      groupHeader: 'text-rose-100 bg-slate-800/50 border-l-2 border-rose-500',
    },
    Loans: {
      activeChild: 'bg-emerald-500 text-white shadow-sm',
      groupHeader: 'text-emerald-100 bg-slate-800/50 border-l-2 border-emerald-500',
    },
    'Students & billing': {
      activeChild: 'bg-indigo-500 text-white shadow-sm',
      groupHeader: 'text-indigo-100 bg-slate-800/50 border-l-2 border-indigo-500',
    },
    Revenue: {
      activeChild: 'bg-teal-500 text-white shadow-sm',
      groupHeader: 'text-teal-100 bg-slate-800/50 border-l-2 border-teal-500',
    },
    'School catalog': {
      activeChild: 'bg-fuchsia-500 text-white shadow-sm',
      groupHeader: 'text-fuchsia-100 bg-slate-800/50 border-l-2 border-fuchsia-500',
    },
    Payroll: {
      activeChild: 'bg-lime-600 text-white shadow-sm',
      groupHeader: 'text-lime-100 bg-slate-800/50 border-l-2 border-lime-500',
    },
    Members: {
      activeChild: 'bg-emerald-500 text-white shadow-sm',
      groupHeader: 'text-emerald-100 bg-slate-800/50 border-l-2 border-emerald-500',
    },
  };
  return (
    map[sectionName] ?? {
      activeChild: 'bg-brand-600 text-white shadow-sm',
      groupHeader: 'text-brand-100 bg-slate-800/50 border-l-2 border-brand-500',
    }
  );
}

const singleNavActive = 'bg-brand-600 text-white shadow-sm';
const singleNavIdle = 'text-slate-400 hover:bg-slate-800/80 hover:text-white';

export function Layout({ children, currentPage, onNavigate }: LayoutProps) {
  const { user, signOut, isSuperAdmin, isHotelStaff } = useAuth();
  const businessType = user?.business_type ?? null;
  const subscriptionStatus = user?.subscription_status ?? "none";
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /** Submenus stay collapsed until the user clicks the section header (no auto-expand on navigation). */
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  /** Collapsible subgroups under Reports (e.g. Sales, Operations). Undefined = expand if current page is in group. */
  const [reportSubgroupExpanded, setReportSubgroupExpanded] = useState<Record<string, boolean | undefined>>({});

  const toggleSection = (key: string) => setExpandedSections((s) => ({ ...s, [key]: !s[key] }));

  const isReportSubgroupOpen = (groupName: string, itemPages: string[]) => {
    const v = reportSubgroupExpanded[groupName];
    if (v !== undefined) return v;
    return itemPages.includes(currentPage);
  };

  const platformNavigation: NavLeaf[] = [
    { name: 'Overview', icon: LayoutDashboard, page: 'platform_overview' },
    { name: 'Communications', icon: MessageSquare, page: 'communications' },
    { name: 'Organizations', icon: Building2, page: 'platform_organizations' },
    { name: 'Business admins', icon: UsersRound, page: 'platform_business_admins' },
    { name: 'Business types', icon: Building2, page: 'platform_business_types' },
    { name: 'Subscription plans', icon: CreditCard, page: 'platform_plans' },
    { name: 'Super users', icon: Shield, page: 'platform_superusers' },
  ];

  const enableFixedAssets = user?.enable_fixed_assets === true;

  const hotelNavigation: NavItem[] = useMemo(() => {
    const showHotelFrontDesk = businessType === 'hotel' || businessType === 'mixed';
    const frontDeskNav: NavItem | null = showHotelFrontDesk
      ? {
          name: 'Front Desk',
          icon: BedDouble,
          children: [
            { name: 'Rooms', page: 'rooms' },
            { name: 'Reservations', page: 'reservations' },
            { name: 'Check-In', page: 'checkin' },
            { name: 'Active Stays', page: 'stays' },
            { name: 'Housekeeping', page: 'housekeeping' },
            { name: 'Billing', page: 'billing' },
            { name: 'Room types & setup', page: HOTEL_PAGE.roomsSetup },
          ],
        }
      : null;

    return [
    { name: 'Dashboard', icon: LayoutDashboard, page: 'dashboard' },
    { name: 'Communications', icon: MessageSquare, page: 'communications' },
    { name: 'Retail Dashboard', icon: LayoutDashboard, page: 'retail_dashboard' },
    ...(frontDeskNav ? [frontDeskNav] : []),
    {
      name: 'Sales',
      icon: Receipt,
      children: [
        ...(businessType === 'mixed'
          ? [
              { name: 'Retail customers', page: 'retail_customers' as const },
              { name: 'Customers', page: 'hotel_customers' as const },
            ]
          : businessType === 'retail' || businessType === 'restaurant'
            ? [{ name: 'Customers', page: 'retail_customers' as const }]
            : [{ name: 'Customers', page: 'hotel_customers' as const }]),
        { name: 'POS (Waiter/Cashier)', page: HOTEL_PAGE.posWaiter },
        { name: 'Kitchen/Bar Screen', page: HOTEL_PAGE.posKitchenBar },
        { name: 'Supervisor Dashboard', page: HOTEL_PAGE.posSupervisor },
        { name: 'Reports & Analytics', page: HOTEL_PAGE.posReports },
        { name: 'Retail POS', page: 'retail_pos' },
        { name: 'Invoices', page: 'retail_credit_invoices' },
        { name: 'Cash receipts', page: 'cash_receipts' },
        { name: 'Debtor payments', page: 'payments' },
        { name: 'Transactions', page: 'transactions' },
      ],
    },
    {
      name: 'Purchases',
      icon: ShoppingCart,
      children: [
        { name: 'Vendors', page: 'purchases_vendors' },
        { name: 'Purchase Orders', page: 'purchases_orders' },
        { name: 'GRN/Bills', page: 'purchases_bills' },
        { name: 'Payments Made', page: 'purchases_payments' },
        { name: 'Return to supplier', page: 'purchases_credits' },
        { name: 'Expenses', page: 'purchases_expenses' },
      ],
    },
    {
      name: 'Inventory',
      icon: FileText,
      children: [
        { name: 'Products', page: 'Products' },
        { name: 'Stock Adjustments', page: 'inventory_stock_adjustments' },
        { name: 'Stock Balances', page: 'inventory_stock_balances' },
        { name: 'Store Requisitions', page: 'inventory_store_requisitions' },
      ],
    },
    {
      name: 'Manufacturing',
      icon: Factory,
      children: [
        { name: 'Overview', page: 'manufacturing' },
        { name: 'Bill of Materials', page: 'manufacturing_bom' },
        { name: 'Work Orders', page: 'manufacturing_work_orders' },
        { name: 'Production Entries', page: 'manufacturing_production_entries' },
        { name: 'Costing', page: 'manufacturing_costing' },
      ],
    },
    {
      name: 'Accounting',
      icon: FileText,
      children: [
        { name: 'Chart of Accounts', page: 'gl_accounts' },
        { name: 'Journal Entries', page: 'accounting_journal' },
        { name: 'Manual Journals', page: 'accounting_manual' },
        { name: 'General Ledger', page: 'accounting_gl' },
        ...(enableFixedAssets ? [{ name: 'Fixed assets', page: 'fixed_assets' as const }] : []),
      ],
    },
    {
      name: 'Budget',
      icon: FileText,
      children: [
        { name: 'Budgeting', page: 'accounting_budgeting' },
        { name: 'Budget variance', page: 'reports_budget_variance' },
      ],
    },
    { name: 'Wallet', icon: Wallet, page: 'wallet' },
    {
      name: 'Reports',
      icon: FileText,
      children: [
        { name: 'Overview', page: 'reports' },
        {
          group: 'Sales',
          items: [
            { name: 'Daily Sales Report', page: 'reports_daily_sales' },
            { name: 'Daily summary', page: 'reports_daily_summary' },
            { name: 'Credit Sales Report', page: 'retail_credit_sales_report' },
          ],
        },
        {
          group: 'Operations',
          items: [
            { name: 'Revenue by Charge Type', page: 'reports_financial_revenue_by_type' },
            { name: 'Payments by Method', page: 'reports_financial_payments_by_method' },
            { name: 'Payments by Charge Type', page: 'reports_financial_payments_by_charge_type' },
          ],
        },
        {
          group: 'Purchases',
          items: [{ name: 'Daily Purchases Summary', page: 'reports_daily_purchases_summary' }],
        },
        {
          group: 'Inventory',
          items: [{ name: 'Stock Movement', page: 'reports_stock_movement' }],
        },
        {
          group: 'Financial statements',
          items: [
            { name: 'Trial Balance', page: 'accounting_trial' },
            { name: 'Income Statement', page: 'accounting_income' },
            { name: 'Balance Sheet', page: 'accounting_balance' },
            { name: 'Cash Flow', page: 'accounting_cashflow' },
          ],
        },
      ],
    },
    {
      name: 'Payroll',
      icon: Wallet,
      children: [
        { name: 'Overview', page: PAYROLL_PAGE.hub },
        { name: 'Staff & salaries', page: PAYROLL_PAGE.staff },
        { name: 'Settings & GL', page: PAYROLL_PAGE.settings },
        { name: 'Loans & advances', page: PAYROLL_PAGE.loans },
        { name: 'Periods', page: PAYROLL_PAGE.periods },
        { name: 'Process & post', page: PAYROLL_PAGE.run },
        { name: 'Audit trail', page: PAYROLL_PAGE.audit },
      ],
    },
    { name: 'Staff', icon: UsersRound, page: 'staff' },
    { name: 'Admin', icon: Settings, page: 'admin' },
  ];
  }, [businessType, enableFixedAssets]);

  const saccoNavigation: NavItem[] = useMemo(
    () => [
      { name: 'Dashboard', icon: LayoutDashboard, page: SACCOPRO_PAGE.dashboard },
      { name: 'Communications', icon: MessageSquare, page: 'communications' },
      { name: 'Overview', icon: Home, page: SACCOPRO_PAGE.overview },
      {
        name: 'Members',
        icon: UsersRound,
        children: [
          { name: 'Member register', page: SACCOPRO_PAGE.members },
          /** Must match `?page=` and App.tsx switch (avoid stale bundle missing SACCOPRO_PAGE.savingsSettings). */
          { name: 'Savings settings', page: 'sacco_members_savings_settings' },
          { name: 'Open savings account', page: SACCOPRO_PAGE.savingsAccountOpen },
          { name: 'Savings accounts', page: SACCOPRO_PAGE.savingsAccountsList },
          { name: 'Client dashboard', page: SACCOPRO_PAGE.clientDashboard },
        ],
      },
      {
        name: 'Loans',
        icon: PiggyBank,
        children: [
          { name: 'Intro & GL', page: SACCOPRO_PAGE.loans },
          { name: 'Loan dashboard', page: SACCOPRO_PAGE.loanDashboard },
          { name: 'Loan list', page: SACCOPRO_PAGE.loanList },
          { name: 'New application', page: SACCOPRO_PAGE.loanInput },
          { name: 'Approval', page: SACCOPRO_PAGE.loanApproval },
          { name: 'Reports', page: SACCOPRO_PAGE.loanReports },
          { name: 'Loan recovery', page: SACCOPRO_PAGE.loanRecovery },
          { name: 'Settings', page: SACCOPRO_PAGE.loanSettings },
          { name: 'Interest calculator', page: SACCOPRO_PAGE.loanInterestCalc },
        ],
      },
      { name: 'Savings interest', icon: TrendingUp, page: SACCOPRO_PAGE.savingsInterest },
      { name: 'Cashbook', icon: BookMarked, page: SACCOPRO_PAGE.cashbook },
      { name: 'Teller', icon: Banknote, page: SACCOPRO_PAGE.teller },
      {
        name: 'Accounting',
        icon: FileText,
        children: [
          { name: 'Chart of Accounts', page: 'gl_accounts' },
          { name: 'Journal Entries', page: 'accounting_journal' },
          { name: 'Manual Journals', page: 'accounting_manual' },
          { name: 'General Ledger', page: 'accounting_gl' },
          ...(enableFixedAssets ? [{ name: 'Fixed assets', page: 'fixed_assets' as const }] : []),
        ],
      },
      {
        name: 'Budget',
        icon: FileText,
        children: [
          { name: 'Budgeting', page: 'accounting_budgeting' },
          { name: 'Budget variance', page: 'reports_budget_variance' },
        ],
      },
      { name: 'Wallet', icon: Wallet, page: 'wallet' },
      {
        name: 'Reports',
        icon: FileText,
        children: [
          {
            group: 'Financial statements',
            items: [
              { name: 'Trial Balance', page: 'accounting_trial' },
              { name: 'Income Statement', page: 'accounting_income' },
              { name: 'Balance Sheet', page: 'accounting_balance' },
              { name: 'Cash Flow', page: 'accounting_cashflow' },
            ],
          },
        ],
      },
      {
        name: 'Payroll',
        icon: Wallet,
        children: [
          { name: 'Overview', page: PAYROLL_PAGE.hub },
          { name: 'Staff & salaries', page: PAYROLL_PAGE.staff },
          { name: 'Settings & GL', page: PAYROLL_PAGE.settings },
          { name: 'Loans & advances', page: PAYROLL_PAGE.loans },
          { name: 'Periods', page: PAYROLL_PAGE.periods },
          { name: 'Process & post', page: PAYROLL_PAGE.run },
        { name: 'Audit trail', page: PAYROLL_PAGE.audit },
        ],
      },
      { name: 'Staff', icon: UsersRound, page: 'staff' },
      { name: 'Admin', icon: Settings, page: 'admin' },
    ],
    [enableFixedAssets]
  );

  const schoolNavigation: NavItem[] = useMemo(
    () => [
      { name: 'Dashboard', icon: GraduationCap, page: SCHOOL_PAGE.dashboard },
      { name: 'Communications', icon: MessageSquare, page: 'communications' },
      {
        name: 'School catalog',
        icon: BookOpen,
        children: [
          { name: 'Classes', page: SCHOOL_PAGE.classes },
          { name: 'Streams', page: SCHOOL_PAGE.streams },
          { name: 'Subjects', page: SCHOOL_PAGE.subjects },
          { name: 'Teachers', page: SCHOOL_PAGE.teachers },
        ],
      },
      {
        name: 'Students & billing',
        icon: UsersRound,
        children: [
          { name: 'Students Bio Data', page: SCHOOL_PAGE.students },
          { name: 'Students List', page: SCHOOL_PAGE.studentsList },
          { name: 'Health Issues', page: SCHOOL_PAGE.healthIssues },
          { name: 'Parents', page: SCHOOL_PAGE.parents },
          { name: 'Fee structures', page: SCHOOL_PAGE.feeStructures },
          { name: 'Special fee structures', page: SCHOOL_PAGE.specialFeeStructures },
          { name: 'Bursary', page: SCHOOL_PAGE.bursary },
          { name: 'Student invoices', page: SCHOOL_PAGE.invoices },
        ],
      },
      {
        name: 'Revenue',
        icon: Receipt,
        children: [
          { name: 'School fees', page: SCHOOL_PAGE.payments },
          { name: 'Other revenue', page: SCHOOL_PAGE.otherRevenue },
          { name: 'Daily collections', page: SCHOOL_PAGE.collections },
        ],
      },
      { name: 'Fixed deposits', icon: PiggyBank, page: SCHOOL_PAGE.fixedDeposit },
      {
        name: 'Reports',
        icon: FileText,
        children: [
          { name: 'Overview', page: 'reports' },
          {
            group: 'Fees & billing',
            items: [
              { name: 'Fee collections', page: 'reports_school_fee_collections' },
              { name: 'School Defaulters', page: 'reports_school_outstanding' },
              { name: 'Daily cash', page: 'reports_school_daily_cash' },
              { name: 'Income & expenditure', page: 'reports_school_income_expenditure' },
            ],
          },
          {
            group: 'Management',
            items: [
              { name: 'Enrollment statistics', page: 'reports_school_enrollment' },
              { name: 'Fee payment trends', page: 'reports_school_fee_trends' },
              { name: 'Top defaulters', page: 'reports_school_top_defaulters' },
              { name: 'Term performance', page: 'reports_school_term_performance' },
            ],
          },
          {
            group: 'Purchases',
            items: [{ name: 'Daily Purchases Summary', page: 'reports_daily_purchases_summary' }],
          },
          {
            group: 'Inventory',
            items: [{ name: 'Stock Movement', page: 'reports_stock_movement' }],
          },
          {
            group: 'Financial statements',
            items: [
              { name: 'Trial Balance', page: 'accounting_trial' },
              { name: 'Income Statement', page: 'accounting_income' },
              { name: 'Balance Sheet', page: 'accounting_balance' },
              { name: 'Cash Flow', page: 'accounting_cashflow' },
            ],
          },
        ],
      },
      {
        name: 'Purchases',
        icon: ShoppingCart,
        children: [
          { name: 'Vendors', page: 'purchases_vendors' },
          { name: 'Purchase Orders', page: 'purchases_orders' },
          { name: 'GRN/Bills', page: 'purchases_bills' },
          { name: 'Payments Made', page: 'purchases_payments' },
          { name: 'Return to supplier', page: 'purchases_credits' },
          { name: 'Expenses', page: 'purchases_expenses' },
        ],
      },
      {
        name: 'Inventory',
        icon: FileText,
        children: [
          { name: 'Products', page: 'Products' },
          { name: 'Stock Adjustments', page: 'inventory_stock_adjustments' },
          { name: 'Stock Balances', page: 'inventory_stock_balances' },
          { name: 'Store Requisitions', page: 'inventory_store_requisitions' },
      ],
    },
    {
      name: 'Manufacturing',
      icon: Factory,
      children: [
        { name: 'Overview', page: 'manufacturing' },
        { name: 'Bill of Materials', page: 'manufacturing_bom' },
        { name: 'Work Orders', page: 'manufacturing_work_orders' },
        { name: 'Production Entries', page: 'manufacturing_production_entries' },
        { name: 'Costing', page: 'manufacturing_costing' },
        ],
      },
      {
        name: 'Accounting',
        icon: FileText,
        children: [
          { name: 'Chart of Accounts', page: 'gl_accounts' },
          { name: 'Journal Entries', page: 'accounting_journal' },
          { name: 'Manual Journals', page: 'accounting_manual' },
          { name: 'General Ledger', page: 'accounting_gl' },
          ...(enableFixedAssets ? [{ name: 'Fixed assets', page: 'fixed_assets' as const }] : []),
        ],
      },
      {
        name: 'Budget',
        icon: FileText,
        children: [
          { name: 'Budgeting', page: 'accounting_budgeting' },
          { name: 'Budget variance', page: 'reports_budget_variance' },
        ],
      },
      { name: 'Wallet', icon: Wallet, page: 'wallet' },
      {
        name: 'Payroll',
        icon: Wallet,
        children: [
          { name: 'Overview', page: PAYROLL_PAGE.hub },
          { name: 'Staff & salaries', page: PAYROLL_PAGE.staff },
          { name: 'Settings & GL', page: PAYROLL_PAGE.settings },
          { name: 'Loans & advances', page: PAYROLL_PAGE.loans },
          { name: 'Periods', page: PAYROLL_PAGE.periods },
          { name: 'Process & post', page: PAYROLL_PAGE.run },
        { name: 'Audit trail', page: PAYROLL_PAGE.audit },
        ],
      },
      { name: 'Staff', icon: UsersRound, page: 'staff' },
      { name: 'Admin', icon: Settings, page: 'admin' },
    ],
    [enableFixedAssets]
  );

  const vslaNavigation: NavItem[] = useMemo(
    () => [
      { name: 'Dashboard', icon: LayoutDashboard, page: VSLA_PAGE.dashboard },
      { name: 'Communications', icon: MessageSquare, page: 'communications' },
      {
        name: 'Members',
        icon: UsersRound,
        children: [
          { name: 'Member Register', page: VSLA_PAGE.members },
        ],
      },
      {
        name: 'Savings',
        icon: Wallet,
        children: [
          { name: 'Shares Purchase', page: VSLA_PAGE.savings },
          { name: 'Fines & Social Fund', page: VSLA_PAGE.finesSocial },
          { name: 'Cashbox', page: VSLA_PAGE.cashbox },
          { name: 'Share-Out', page: VSLA_PAGE.shareOut },
        ],
      },
      {
        name: 'Meetings',
        icon: BookOpen,
        children: [
          { name: 'Meeting Management', page: VSLA_PAGE.meetings },
          { name: 'Meeting Minutes', page: VSLA_PAGE.meetingMinutes },
        ],
      },
      {
        name: 'Loans',
        icon: PiggyBank,
        children: [
          { name: 'Loan Management', page: VSLA_PAGE.loans },
          { name: 'Loan Repayments', page: VSLA_PAGE.repayments },
        ],
      },
      {
        name: 'Reports',
        icon: FileText,
        children: [
          { name: 'Member Statement', page: VSLA_PAGE.memberStatement },
          { name: 'VSLA Reports', page: VSLA_PAGE.reports },
          { name: 'Controls & Audit', page: VSLA_PAGE.controls },
        ],
      },
      { name: 'Staff', icon: UsersRound, page: 'staff' },
      { name: 'Admin', icon: Settings, page: 'admin' },
    ],
    []
  );

  const mainNavigation: NavItem[] =
    businessType === 'sacco'
      ? saccoNavigation
      : businessType === 'school'
        ? schoolNavigation
        : businessType === 'vsla'
          ? vslaNavigation
          : hotelNavigation;

  const showPlatform = isSuperAdmin;
  const showHotel = !isSuperAdmin || isHotelStaff;

  const headerSubtitle = isSuperAdmin && !isHotelStaff
    ? 'Platform console'
    : isSuperAdmin
      ? `${user?.role ?? 'staff'} · platform`
      : user?.role;

  const canShowPage = (page: string) => {
    const moduleId = pageToModuleId(page);
    if (!moduleId) return true;
    return getModuleAccess({
      moduleId,
      businessType,
      subscriptionStatus,
      enableFixedAssets: user?.enable_fixed_assets === true,
      enableCommunications: user?.enable_communications !== false,
      enableWallet: user?.enable_wallet !== false,
      schoolEnableReports: user?.school_enable_reports === true,
      schoolEnableFixedDeposit: user?.school_enable_fixed_deposit === true,
      schoolEnableAccounting: user?.school_enable_accounting === true,
      schoolEnableInventory: user?.school_enable_inventory === true,
      schoolEnablePurchases: user?.school_enable_purchases === true,
    }).visible;
  };
  const isReadOnlyPage = (page: string) => {
    const moduleId = pageToModuleId(page);
    if (!moduleId) return false;
    return getModuleAccess({
      moduleId,
      businessType,
      subscriptionStatus,
      enableFixedAssets: user?.enable_fixed_assets === true,
      enableCommunications: user?.enable_communications !== false,
      enableWallet: user?.enable_wallet !== false,
      schoolEnableReports: user?.school_enable_reports === true,
      schoolEnableFixedDeposit: user?.school_enable_fixed_deposit === true,
      schoolEnableAccounting: user?.school_enable_accounting === true,
      schoolEnableInventory: user?.school_enable_inventory === true,
      schoolEnablePurchases: user?.school_enable_purchases === true,
    }).readOnly;
  };

  return (
    <div className="app-page">
      <div className="lg:hidden fixed top-0 left-0 right-0 bg-slate-950 border-b border-slate-800 z-50 px-3 py-2 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Hotel className="w-6 h-6 text-brand-400" />
            <span className="font-semibold text-white">{APP_SHORT_NAME}</span>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition touch-manipulation"
            aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
          >
            {sidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      <div className={`fixed inset-y-0 left-0 w-64 bg-slate-950 border-r border-slate-800 transform transition-transform duration-200 ease-in-out z-40 shadow-xl ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}>
        <div className="flex flex-col h-full">
          <div className="px-3 py-2.5 border-b border-slate-800 shrink-0">
            <div className="flex items-center gap-2">
              <div className="bg-brand-600 p-1.5 rounded-md shadow-sm shrink-0">
                <Hotel className="w-4 h-4 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="font-semibold text-sm text-slate-100 leading-tight truncate">{APP_SHORT_NAME}</h1>
                <p className="text-[11px] text-slate-500 leading-tight truncate">{headerSubtitle}</p>
                {!!businessType && (
                  <p className="text-[10px] text-slate-600 capitalize leading-tight truncate">
                    {businessType} · {subscriptionStatus}
                  </p>
                )}
              </div>
            </div>
          </div>

          <nav className="flex-1 p-2 pt-1 overflow-y-auto">
            <ul className="space-y-0.5">
              {showPlatform && (
                <>
                  {showHotel && (
                    <li className="px-3 py-1 text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                      Platform
                    </li>
                  )}
                  {platformNavigation.map((item) => {
                    const Icon = item.icon;
                    const isActive = currentPage === item.page;
                    return (
                      <li key={item.page}>
                        <button
                          type="button"
                          onClick={() => {
                            onNavigate(item.page);
                            setSidebarOpen(false);
                          }}
                          className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition ${
                            isActive ? 'bg-violet-600 text-white shadow-sm' : singleNavIdle
                          }`}
                        >
                          <Icon className="w-4 h-4 shrink-0" />
                          <span className="font-medium">{item.name}</span>
                        </button>
                      </li>
                    );
                  })}
                </>
              )}
              {showHotel && (
                <>
                  {showPlatform && showHotel && (
                    <li className="px-3 pt-2 pb-0.5 mt-1 border-t border-slate-800 text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                      Property
                    </li>
                  )}
                  {mainNavigation.map((item) => {
                    const Icon = item.icon;
                    if ('children' in item) {
                      const visibleChildren: NavChild[] = [];
                      for (const c of item.children) {
                        if ('page' in c && c.page) {
                          if (canShowPage(c.page)) visibleChildren.push(c);
                        } else if ('items' in c) {
                          const items = c.items.filter((i) => canShowPage(i.page));
                          if (items.length > 0) visibleChildren.push({ group: c.group, items });
                        }
                      }
                      if (visibleChildren.length === 0) return null;

                      const accent = navSectionAccent(item.name);
                      const childPages = item.children.flatMap((c) =>
                        'page' in c ? [c.page] : c.items.map((i) => i.page)
                      );
                      const isGroupActive = childPages.includes(currentPage);
                      const isExpanded = expandedSections[item.name] ?? false;
                      return (
                        <li key={item.name}>
                          <button
                            type="button"
                            onClick={() => toggleSection(item.name)}
                            className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition ${
                              isGroupActive ? accent.groupHeader : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                            }`}
                          >
                            <Icon className="w-4 h-4 shrink-0" />
                            <span className="font-medium flex-1 text-left">{item.name}</span>
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 shrink-0 opacity-80" />
                            ) : (
                              <ChevronRight className="w-4 h-4 shrink-0 opacity-80" />
                            )}
                          </button>
                          {isExpanded && (
                            <ul className="mt-0.5 ml-3 pl-2 border-l border-slate-700 space-y-0">
                              {visibleChildren.map((child) => {
                                if ('group' in child) {
                                  const itemPages = child.items.map((i) => i.page);
                                  const reportSubOpen =
                                    item.name === 'Reports'
                                      ? isReportSubgroupOpen(child.group, itemPages)
                                      : true;
                                  return (
                                    <li key={child.group} className="list-none">
                                      {item.name === 'Reports' ? (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const cur = isReportSubgroupOpen(child.group, itemPages);
                                              setReportSubgroupExpanded((s) => ({
                                                ...s,
                                                [child.group]: !cur,
                                              }));
                                            }}
                                            className={`w-full flex items-center gap-1 px-2 py-1.5 rounded-md text-[10px] font-semibold uppercase tracking-wide transition ${
                                              itemPages.includes(currentPage)
                                                ? 'text-rose-200 bg-slate-800/30'
                                                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/40'
                                            }`}
                                          >
                                            {reportSubOpen ? (
                                              <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-90" />
                                            ) : (
                                              <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-90" />
                                            )}
                                            <span className="flex-1 text-left">{child.group}</span>
                                          </button>
                                          {reportSubOpen && (
                                            <ul className="space-y-0 ml-1 border-l border-slate-700/80 pl-1.5 mt-0.5">
                                              {child.items.map((sub) => {
                                                const isChildActive = currentPage === sub.page;
                                                const readOnly = isReadOnlyPage(sub.page);
                                                return (
                                                  <li key={sub.page}>
                                                    <button
                                                      type="button"
                                                      onClick={() => {
                                                        onNavigate(sub.page);
                                                        setSidebarOpen(false);
                                                      }}
                                                      className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[13px] transition ${
                                                        isChildActive
                                                          ? accent.activeChild
                                                          : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                                                      }`}
                                                    >
                                                      <span className="font-medium">{sub.name}</span>
                                                      {readOnly && (
                                                        <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${
                                                          isChildActive
                                                            ? 'bg-white/20 text-white'
                                                            : 'bg-amber-500/20 text-amber-200'
                                                        }`}>
                                                          Read-only
                                                        </span>
                                                      )}
                                                    </button>
                                                  </li>
                                                );
                                              })}
                                            </ul>
                                          )}
                                        </>
                                      ) : (
                                        <>
                                          <p className="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                                            {child.group}
                                          </p>
                                          <ul className="space-y-0">
                                            {child.items.map((sub) => {
                                              const isChildActive = currentPage === sub.page;
                                              const readOnly = isReadOnlyPage(sub.page);
                                              return (
                                                <li key={sub.page}>
                                                  <button
                                                    type="button"
                                                    onClick={() => {
                                                      onNavigate(sub.page);
                                                      setSidebarOpen(false);
                                                    }}
                                                    className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[13px] transition ${
                                                      isChildActive
                                                        ? accent.activeChild
                                                        : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                                                    }`}
                                                  >
                                                    <span className="font-medium">{sub.name}</span>
                                                    {readOnly && (
                                                      <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${
                                                        isChildActive
                                                          ? 'bg-white/20 text-white'
                                                          : 'bg-amber-500/20 text-amber-200'
                                                      }`}>
                                                        Read-only
                                                      </span>
                                                    )}
                                                  </button>
                                                </li>
                                              );
                                            })}
                                          </ul>
                                        </>
                                      )}
                                    </li>
                                  );
                                }
                                if (!('page' in child) || !child.page) return null;
                                const isChildActive = currentPage === child.page;
                                const readOnly = isReadOnlyPage(child.page);
                                return (
                                  <li key={child.page}>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        onNavigate(child.page);
                                        setSidebarOpen(false);
                                      }}
                                      className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[13px] transition ${
                                        isChildActive
                                          ? accent.activeChild
                                          : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                                      }`}
                                    >
                                      <span className="font-medium">{child.name}</span>
                                      {readOnly && (
                                        <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${
                                          isChildActive
                                            ? 'bg-white/20 text-white'
                                            : 'bg-amber-500/20 text-amber-200'
                                        }`}>
                                          Read-only
                                        </span>
                                      )}
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </li>
                      );
                    }
                    const isActive = currentPage === item.page;
                    if (!canShowPage(item.page)) return null;
                    const readOnly = isReadOnlyPage(item.page);
                    return (
                      <li key={item.name}>
                        <button
                          type="button"
                          onClick={() => {
                            onNavigate(item.page);
                            setSidebarOpen(false);
                          }}
                          className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition ${
                            isActive ? singleNavActive : singleNavIdle
                          }`}
                        >
                          <Icon className="w-4 h-4 shrink-0" />
                          <span className="font-medium">{item.name}</span>
                          {readOnly && (
                            <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${
                              isActive ? 'bg-white/20 text-white' : 'bg-amber-500/20 text-amber-200'
                            }`}>
                              Read-only
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </>
              )}
            </ul>
          </nav>

          <div className="px-2 py-2 border-t border-slate-800 shrink-0">
            <div className="px-2 py-1 mb-1">
              <p className="text-xs font-medium text-slate-200 truncate">{user?.full_name}</p>
              <p className="text-[10px] text-slate-500 truncate">{user?.email}</p>
            </div>
            <button
              type="button"
              onClick={signOut}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-sm text-red-400 hover:bg-red-950/40 rounded-md transition"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span className="font-medium">Sign Out</span>
            </button>
          </div>
        </div>
      </div>

      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="lg:pl-64">
        <main className="pt-14 lg:pt-0">
          {children}
        </main>
      </div>
    </div>
  );
}