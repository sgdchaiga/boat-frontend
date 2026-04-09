import { Users, Wallet, CalendarDays, ArrowRight, PiggyBank, Coins, Briefcase, BarChart3, Shield } from "lucide-react";
import { VSLA_PAGE } from "@/lib/vslaPages";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";

type Props = {
  onNavigate?: (page: string, state?: Record<string, unknown>) => void;
  readOnly?: boolean;
};

const cards = [
  {
    title: "Member Management",
    desc: "Register members, assign roles, groups, and key holders.",
    page: VSLA_PAGE.members,
    icon: Users,
  },
  {
    title: "Savings (Shares)",
    desc: "Configure share value and post shares bought per meeting.",
    page: VSLA_PAGE.savings,
    icon: Wallet,
  },
  {
    title: "Meeting Management",
    desc: "Meeting dashboard tabs: attendance, savings, loans, repayments, and cash summary.",
    page: VSLA_PAGE.meetings,
    icon: CalendarDays,
  },
  {
    title: "Loans",
    desc: "Applications, approvals, disbursement, installments, and due dates.",
    page: VSLA_PAGE.loans,
    icon: PiggyBank,
  },
  {
    title: "Repayments",
    desc: "Principal and interest split with overdue and partial payment tracking.",
    page: VSLA_PAGE.repayments,
    icon: Coins,
  },
  {
    title: "Fines & Social Fund",
    desc: "Late/absence fines, social fund contributions and payouts.",
    page: VSLA_PAGE.finesSocial,
    icon: Briefcase,
  },
  {
    title: "Cashbox & Share-Out",
    desc: "Expected vs physical cash, variance alerts, and cycle share-out.",
    page: VSLA_PAGE.cashbox,
    icon: Wallet,
  },
  {
    title: "Reports & Controls",
    desc: "Operational reports, audit trail, and governance controls.",
    page: VSLA_PAGE.reports,
    icon: BarChart3,
  },
  {
    title: "Audit / Controls",
    desc: "Review transaction logs and trust controls.",
    page: VSLA_PAGE.controls,
    icon: Shield,
  },
] as const;

export function VslaDashboardPage({ onNavigate, readOnly = false }: Props) {
  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      {readOnly && <ReadOnlyNotice />}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Villae Savings and Loan Association (VSLA)</h1>
        <p className="text-sm text-slate-600 mt-1">Meeting-based savings and lending workflow starter module.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.page}
              type="button"
              onClick={() => onNavigate?.(card.page)}
              className="text-left rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-slate-300 hover:bg-slate-50/80 transition"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-orange-100 text-orange-700">
                  <Icon className="w-5 h-5" aria-hidden />
                </span>
                <ArrowRight className="w-4 h-4 text-slate-400" aria-hidden />
              </div>
              <p className="font-semibold text-slate-900">{card.title}</p>
              <p className="text-sm text-slate-600 mt-1">{card.desc}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
