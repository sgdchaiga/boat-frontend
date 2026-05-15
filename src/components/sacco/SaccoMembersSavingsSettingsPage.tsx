import { useState } from "react";
import { Building2, Hash, Layers } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { AdminSaccoAccountNumberSettingsPage } from "@/components/admin/AdminSaccoAccountNumberSettingsPage";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
import { PageNotes } from "@/components/common/PageNotes";
import { canEditSaccoSavingsSettings, isLocalAuthEnvEnabled } from "@/lib/saccoSavingsSettingsAccess";
import { SaccoBranchesSection } from "./SaccoBranchesSection";
import { SaccoSavingsAccountTypesSection } from "./SaccoSavingsAccountTypesSection";

type TabId = "types" | "branches" | "numbers";

type SaccoMembersSavingsSettingsPageProps = {
  /** Subscription / global read-only (e.g. inactive plan). */
  readOnly?: boolean;
};

export function SaccoMembersSavingsSettingsPage({ readOnly: subscriptionReadOnly = false }: SaccoMembersSavingsSettingsPageProps) {
  const { user, isSuperAdmin } = useAuth();
  const orgId = user?.organization_id ?? null;
  const canEdit =
    canEditSaccoSavingsSettings(user?.role, {
      isSuperAdmin: Boolean(isSuperAdmin),
      localAuthEnabled: isLocalAuthEnvEnabled(),
    }) && !subscriptionReadOnly;

  const [tab, setTab] = useState<TabId>("types");

  if (!orgId) {
    return (
      <div className="p-6 max-w-4xl mx-auto text-slate-600 text-sm">Link your staff account to an organization to manage savings settings.</div>
    );
  }

  const tabBtn = (id: TabId, label: string, Icon: typeof Layers) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
        tab === id ? "bg-emerald-600 text-white shadow-sm" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {label}
    </button>
  );

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Savings settings</h1>
        <PageNotes ariaLabel="Savings settings help">
          <p className="text-sm text-slate-700">
            Define savings account types, branches, and the account number format. Who may edit is controlled under{" "}
            <strong className="font-medium text-slate-800">Permissions → Savings settings</strong>.
          </p>
        </PageNotes>
      </header>

      {subscriptionReadOnly && <ReadOnlyNotice message="Subscription inactive — changes are disabled." />}

      {!subscriptionReadOnly && !canEdit ? (
        <ReadOnlyNotice message="Your role cannot edit these settings. Ask an administrator to grant “Savings settings” under Admin → Permissions (or Approval rights)." />
      ) : null}

      <div className="flex flex-wrap gap-2">
        {tabBtn("types", "Account types", Layers)}
        {tabBtn("branches", "Branches", Building2)}
        {tabBtn("numbers", "Account number format", Hash)}
      </div>

      {tab === "types" && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden p-4">
          <SaccoSavingsAccountTypesSection readOnly={!canEdit} />
        </div>
      )}

      {tab === "branches" && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden p-4">
          <SaccoBranchesSection readOnly={!canEdit} />
        </div>
      )}

      {tab === "numbers" && <AdminSaccoAccountNumberSettingsPage readOnly={!canEdit} />}
    </div>
  );
}
