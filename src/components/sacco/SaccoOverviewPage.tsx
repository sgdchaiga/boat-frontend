import { Landmark, LayoutDashboard, PiggyBank, TrendingUp, Users } from "lucide-react";
import { SACCOPRO_PAGE } from "@/lib/saccoproPages";
import { PageNotes } from "@/components/common/PageNotes";

interface SaccoOverviewPageProps {
  onNavigate?: (page: string) => void;
}

export function SaccoOverviewPage({ onNavigate }: SaccoOverviewPageProps) {
  const nav = onNavigate ?? (() => {});

  const tiles = [
    {
      title: "Dashboard",
      value: "—",
      icon: LayoutDashboard,
      page: SACCOPRO_PAGE.dashboard,
    },
    {
      title: "Members",
      value: "—",
      icon: Users,
      page: SACCOPRO_PAGE.members,
    },
    {
      title: "Loan portfolio",
      value: "—",
      icon: PiggyBank,
      page: SACCOPRO_PAGE.loans,
    },
    {
      title: "Cash position",
      value: "—",
      icon: Landmark,
      page: SACCOPRO_PAGE.cashbook,
    },
    {
      title: "Period income",
      value: "—",
      icon: TrendingUp,
      page: "accounting_income",
    },
  ];

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Overview</h1>
        <PageNotes ariaLabel="SACCO overview help">
          <p>Quick links to dashboard, members, loans, cashbook, and accounting.</p>
        </PageNotes>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.title}
              type="button"
              onClick={() => nav(t.page)}
              className="text-left rounded-xl border border-slate-200/90 bg-white shadow-card app-card-interactive p-4 hover:border-brand-300/80"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{t.title}</span>
                <Icon className="w-4 h-4 text-brand-600" />
              </div>
              <p className="text-2xl font-semibold text-slate-900 mt-2 tabular-nums">{t.value}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
