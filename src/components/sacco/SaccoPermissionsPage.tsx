import { ShieldCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { AdminApprovalRightsPage } from "@/components/admin/AdminApprovalRightsPage";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
import { PageNotes } from "@/components/common/PageNotes";

type SaccoPermissionsPageProps = {
  readOnly?: boolean;
  /** Deep-link from Staff → open overrides for this staff id. */
  focusStaffId?: string;
};

export function SaccoPermissionsPage({ readOnly: subscriptionReadOnly = false, focusStaffId }: SaccoPermissionsPageProps) {
  const { user } = useAuth();
  const roleKey = String(user?.role ?? "").toLowerCase();
  const canManage = Boolean(user?.isSuperAdmin || roleKey === "super_admin" || roleKey === "admin");
  const readOnly = subscriptionReadOnly || !canManage;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <header className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="text-emerald-600 shrink-0" size={26} />
        <h1 className="text-2xl font-bold text-slate-900">Permissions</h1>
        <PageNotes ariaLabel="SACCO permissions help">
          <p className="text-sm text-slate-700">
            Control which roles can approve purchases, edit savings settings, run payroll, and more. Use staff overrides for one-off
            exceptions. Only <strong>administrators</strong> can change these settings.
          </p>
        </PageNotes>
      </header>

      {subscriptionReadOnly ? (
        <ReadOnlyNotice message="Subscription inactive — changes are disabled." />
      ) : null}

      {!subscriptionReadOnly && !canManage ? (
        <ReadOnlyNotice message="Only administrators can edit permissions. You can review the matrix below; ask an admin to make changes." />
      ) : null}

      <AdminApprovalRightsPage readOnly={readOnly} initialFocusStaffId={focusStaffId} embedded />
    </div>
  );
}
