import { useMemo } from "react";
import { useAuth } from "../../contexts/AuthContext";

export function FeatureFlagsSummary({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth();
  const disabled = useMemo(() => {
    const out: string[] = [];
    if (user?.enable_payroll === false) out.push("Payroll");
    if (user?.enable_budget === false) out.push("Budget");
    if (user?.enable_fixed_assets === false) out.push("Fixed assets");
    if (user?.enable_wallet === false) out.push("Wallet");
    if (user?.enable_communications === false) out.push("Communications");
    return out;
  }, [user]);

  if (disabled.length === 0) return null;

  if (compact) {
    return (
      <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
        Additional flags: {disabled.join(", ")}
      </span>
    );
  }

  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <span className="font-semibold">Additional Feature flags to activate:</span> {disabled.join(", ")}.
    </div>
  );
}
