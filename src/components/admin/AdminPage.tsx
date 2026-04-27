import { ReactNode, useEffect, useState } from "react";
import {
  Settings,
  Users,
  Building2,
  Package,
  ChevronRight,
  ShieldCheck,
  BookOpen,
} from "lucide-react";
import { AdminUsersPage } from "./AdminUsersPage";
import { AdminHotelConfigPage } from "./AdminHotelConfigPage";
import { AdminProductsPage } from "./AdminProductsPage";
import { AdminApprovalRightsPage } from "./AdminApprovalRightsPage";
import { AdminJournalAccountsPage } from "./AdminJournalAccountsPage";
import { AdminGenderTypesPage } from "./AdminGenderTypesPage";
import { AdminRecipeManagementPage } from "./AdminRecipeManagementPage";
import { AdminHotelPosControlsPage } from "./AdminHotelPosControlsPage";
import { AdminSyncQueuePage } from "./AdminSyncQueuePage";
import { AdminLocalImportPage } from "./AdminLocalImportPage";
import { AdminSubscriptionRenewalPage } from "./AdminSubscriptionRenewalPage";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";
import { PageNotes } from "../common/PageNotes";
import { useAuth } from "../../contexts/AuthContext";
import { FeatureFlagsSummary } from "../common/FeatureFlagsSummary";

export type AdminTab =
  | "users"
  | "business"
  | "products"
  | "recipes"
  | "approval"
  | "journal_accounts"
  | "gender_types"
  | "hotel_pos"
  | "sync_queue"
  | "local_import"
  | "subscription_renewal";

const ADMIN_TAB_IDS: AdminTab[] = [
  "users",
  "business",
  "products",
  "recipes",
  "approval",
  "journal_accounts",
  "gender_types",
  "hotel_pos",
  "sync_queue",
  "local_import",
  "subscription_renewal",
];

/** Validated query param for `?adminTab=` deep links (e.g. from Hotel POS). */
export function parseAdminTabParam(raw: string | null | undefined): AdminTab | undefined {
  if (!raw || typeof raw !== "string") return undefined;
  return ADMIN_TAB_IDS.includes(raw as AdminTab) ? (raw as AdminTab) : undefined;
}

const TABS: { id: AdminTab; label: string; icon: typeof Users }[] = [
  { id: "users", label: "User & Role Management", icon: Users },
  { id: "business", label: "Business Configuration", icon: Building2 },
  { id: "products", label: "Products & Departments", icon: Package },
  { id: "recipes", label: "Recipe Management", icon: Package },
  { id: "approval", label: "Permissions", icon: ShieldCheck },
  { id: "journal_accounts", label: "Journal account settings", icon: BookOpen },
  { id: "gender_types", label: "Gender Types", icon: Users },
  { id: "hotel_pos", label: "Hotel POS Controls", icon: ShieldCheck },
  { id: "sync_queue", label: "Local backup & sync", icon: BookOpen },
  { id: "local_import", label: "Local Bulk Import", icon: BookOpen },
  { id: "subscription_renewal", label: "Subscription renewal", icon: BookOpen },
];

interface AdminPageProps {
  readOnly?: boolean;
  /** Opens a specific tab (e.g. journal_accounts from Hotel POS). */
  initialTab?: AdminTab | null;
}

export function AdminPage({ readOnly = false, initialTab = null }: AdminPageProps = {}) {
  const { user } = useAuth();
  const businessType = (user?.business_type || "").toLowerCase();
  const showRecipeManagement = businessType === "hotel" || businessType === "mixed";
  const showHotelPosControls = businessType === "hotel" || businessType === "mixed";
  const [activeTab, setActiveTab] = useState<AdminTab>(() => {
    if (initialTab && ADMIN_TAB_IDS.includes(initialTab)) return initialTab;
    return "users";
  });
  const [permissionsFocusStaffId, setPermissionsFocusStaffId] = useState<string | null>(null);
  const visibleTabs = TABS.filter((tab) => {
    if (!showRecipeManagement && tab.id === "recipes") return false;
    if (!showHotelPosControls && tab.id === "hotel_pos") return false;
    return true;
  });

  useEffect(() => {
    if (!visibleTabs.some((t) => t.id === activeTab)) {
      setActiveTab("users");
    }
  }, [activeTab, visibleTabs]);

  useEffect(() => {
    if (initialTab && visibleTabs.some((t) => t.id === initialTab)) {
      setActiveTab(initialTab);
    }
  }, [initialTab, visibleTabs]);

  const renderContent = (): ReactNode => {
    if (readOnly) {
      return (
        <div className="bg-white rounded-xl border border-slate-200 p-6 text-sm text-slate-700">
          Admin module is currently read-only because subscription is inactive.
        </div>
      );
    }
    switch (activeTab) {
      case "users":
        return (
          <AdminUsersPage
            onOpenPermissions={(staffId) => {
              setPermissionsFocusStaffId(staffId ?? null);
              setActiveTab("approval");
            }}
          />
        );
      case "business":
        return <AdminHotelConfigPage />;
      case "products":
        return <AdminProductsPage />;
      case "recipes":
        return <AdminRecipeManagementPage />;
      case "approval":
        return <AdminApprovalRightsPage initialFocusStaffId={permissionsFocusStaffId ?? undefined} />;
      case "journal_accounts":
        return <AdminJournalAccountsPage />;
      case "gender_types":
        return <AdminGenderTypesPage />;
      case "hotel_pos":
        return <AdminHotelPosControlsPage />;
      case "sync_queue":
        return <AdminSyncQueuePage />;
      case "local_import":
        return <AdminLocalImportPage />;
      case "subscription_renewal":
        return <AdminSubscriptionRenewalPage />;
      default:
        return (
          <AdminUsersPage
            onOpenPermissions={(staffId) => {
              setPermissionsFocusStaffId(staffId ?? null);
              setActiveTab("approval");
            }}
          />
        );
    }
  };

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center gap-3 mb-8">
        <div className="bg-brand-600 p-2.5 rounded-lg shadow-sm">
          <Settings className="w-6 h-6 text-white" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900">
            Admin
          </h1>
          <PageNotes ariaLabel="Admin help">
            <p>User roles, business settings, and products.</p>
          </PageNotes>
        </div>
      </div>
      {readOnly && (
        <ReadOnlyNotice message="Subscription inactive - read-only mode. Changes are disabled." />
      )}
      <FeatureFlagsSummary />

      <div className="flex flex-col lg:flex-row gap-6">
        <nav className="lg:w-64 shrink-0">
          <div className="bg-white rounded-xl border border-slate-200 p-2">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition ${
                    isActive
                      ? "bg-brand-700 text-white"
                      : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <Icon className="w-5 h-5 shrink-0" />
                  <span className="font-medium flex-1">{tab.label}</span>
                  <ChevronRight className="w-4 h-4 shrink-0 opacity-70" />
                </button>
              );
            })}
          </div>
        </nav>
        <div className="flex-1 min-w-0">{renderContent()}</div>
      </div>
    </div>
  );
}
