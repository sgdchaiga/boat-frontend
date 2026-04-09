import { useEffect, useState } from "react";
import { Building2, CreditCard, AlertTriangle, CheckCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageNotes } from "@/components/common/PageNotes";

export function PlatformOverviewPage() {
  const [loading, setLoading] = useState(true);
  const [orgCount, setOrgCount] = useState(0);
  const [subStats, setSubStats] = useState<Record<string, number>>({});

  useEffect(() => {
    (async () => {
      const { data: orgs, error: e1 } = await supabase.from("organizations").select("id");
      const { data: subs, error: e2 } = await supabase.from("organization_subscriptions").select("status");
      if (!e1) setOrgCount(orgs?.length ?? 0);
      if (!e2 && subs) {
        const m: Record<string, number> = {};
        subs.forEach((s) => {
          m[s.status] = (m[s.status] || 0) + 1;
        });
        setSubStats(m);
      }
      setLoading(false);
    })();
  }, []);

  const cards = [
    { label: "Organizations", value: orgCount, icon: Building2, color: "bg-brand-700" },
    {
      label: "Active subscriptions",
      value: subStats.active ?? 0,
      icon: CheckCircle,
      color: "bg-emerald-600",
    },
    {
      label: "Trials",
      value: subStats.trial ?? 0,
      icon: CreditCard,
      color: "bg-blue-600",
    },
    {
      label: "Past due / expired",
      value: (subStats.past_due ?? 0) + (subStats.expired ?? 0),
      icon: AlertTriangle,
      color: "bg-amber-600",
    },
  ];

  if (loading) {
    return (
      <div className="p-8 text-slate-600">Loading platform overview…</div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900">Platform overview</h1>
          <PageNotes ariaLabel="Platform overview help">
            <p>Organizations and subscription health across all tenants.</p>
          </PageNotes>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className="bg-white rounded-xl border border-slate-200 p-6 flex items-start gap-4"
          >
            <div className={`${c.color} p-3 rounded-lg text-white`}>
              <c.icon className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500">{c.label}</p>
              <p className="text-2xl font-bold text-slate-900">{c.value}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-8 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
        <strong>Note:</strong> Subscription rows are counted per record; renewals may appear as
        multiple rows per organization. Use Organizations for the latest status per tenant.
      </div>
    </div>
  );
}
