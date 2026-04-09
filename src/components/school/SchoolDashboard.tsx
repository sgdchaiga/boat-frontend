import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { SCHOOL_PAGE } from "@/lib/schoolPages";
import { PageNotes } from "@/components/common/PageNotes";
import { GraduationCap, UsersRound, FileText, Wallet } from "lucide-react";

type Props = {
  onNavigate: (page: string, state?: Record<string, unknown>) => void;
};

export function SchoolDashboard({ onNavigate }: Props) {
  const { user } = useAuth();
  const [counts, setCounts] = useState({ students: 0, parents: 0, invoices: 0, unpaid: 0 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const orgId = user?.organization_id;
      if (!orgId) return;
      const [s, p, inv] = await Promise.all([
        supabase.from("students").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
        supabase.from("parents").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
        supabase.from("student_invoices").select("id,total_due,amount_paid", { count: "exact" }).eq("organization_id", orgId),
      ]);
      if (cancelled) return;
      const rows = inv.data as { total_due?: number; amount_paid?: number }[] | null;
      let unpaid = 0;
      (rows || []).forEach((r) => {
        const due = Number(r.total_due ?? 0);
        const paid = Number(r.amount_paid ?? 0);
        if (due > paid) unpaid += due - paid;
      });
      setCounts({
        students: s.count ?? 0,
        parents: p.count ?? 0,
        invoices: inv.count ?? 0,
        unpaid,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.organization_id]);

  const cards = [
    { label: "Students", value: counts.students, page: SCHOOL_PAGE.students, icon: GraduationCap },
    { label: "Parents / guardians", value: counts.parents, page: SCHOOL_PAGE.parents, icon: UsersRound },
    { label: "Term invoices", value: counts.invoices, page: SCHOOL_PAGE.invoices, icon: FileText },
    { label: "Outstanding balance (sum)", value: counts.unpaid.toLocaleString(undefined, { maximumFractionDigits: 0 }), page: SCHOOL_PAGE.invoices, icon: Wallet },
  ];

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">School</h1>
        <PageNotes ariaLabel="School module">
          <p>
            Billing, fee structures, parents, and revenue entries use the school tables. Reports, accounting, inventory, purchases, and fixed deposits
            follow the same BOAT screens when enabled for your organization by a platform admin.
          </p>
        </PageNotes>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <button
              key={c.label}
              type="button"
              onClick={() => onNavigate(c.page)}
              className="text-left rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-indigo-300 hover:shadow transition"
            >
              <div className="flex items-center gap-2 text-slate-500 mb-1">
                <Icon className="w-4 h-4" />
                <span className="text-xs font-medium uppercase tracking-wide">{c.label}</span>
              </div>
              <p className="text-2xl font-semibold text-slate-900">{c.value}</p>
            </button>
          );
        })}
      </div>
      <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-600">
        <p className="font-medium text-slate-800 mb-1">Core data</p>
        <p>
          Students and parents support many-to-many links (several children per parent). Fee structures drive term invoices; payments and receipts
          are stored in <code className="text-xs bg-slate-200/80 px-1 rounded">school_payments</code> and{" "}
          <code className="text-xs bg-slate-200/80 px-1 rounded">school_receipts</code> (separate from hotel debtor payments).
        </p>
      </div>
    </div>
  );
}
