import { useEffect, useState } from "react";
import { GraduationCap, UsersRound, FileText, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { SCHOOL_PAGE } from "@/lib/schoolPages";
import { PageNotes } from "@/components/common/PageNotes";

type Props = {
  onNavigate: (page: string, state?: Record<string, unknown>) => void;
};

/** School dashboard shipped with BOAT v1.0. Keep it available for pinned tenants. */
export function SchoolDashboardV1({ onNavigate }: Props) {
  const { user } = useAuth();
  const [counts, setCounts] = useState({ students: 0, parents: 0, invoices: 0, unpaid: 0 });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const orgId = user?.organization_id;
      if (!orgId) return;
      const [students, parents, invoices] = await Promise.all([
        supabase.from("students").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
        supabase.from("parents").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
        supabase.from("student_invoices").select("id,total_due,amount_paid", { count: "exact" }).eq("organization_id", orgId),
      ]);
      if (cancelled) return;
      const unpaid = ((invoices.data || []) as Array<{ total_due?: number; amount_paid?: number }>).reduce(
        (sum, row) => sum + Math.max(0, Number(row.total_due || 0) - Number(row.amount_paid || 0)),
        0
      );
      setCounts({
        students: students.count || 0,
        parents: parents.count || 0,
        invoices: invoices.count || 0,
        unpaid,
      });
    })();
    return () => { cancelled = true; };
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
          <p>Billing, fee structures, parents, and revenue entries use the school tables. Optional modules remain controlled by the platform administrator.</p>
        </PageNotes>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <button key={card.label} type="button" onClick={() => onNavigate(card.page)} className="text-left rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-indigo-300 hover:shadow transition">
              <div className="flex items-center gap-2 text-slate-500 mb-1"><Icon className="w-4 h-4" /><span className="text-xs font-medium uppercase tracking-wide">{card.label}</span></div>
              <p className="text-2xl font-semibold text-slate-900">{card.value}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
