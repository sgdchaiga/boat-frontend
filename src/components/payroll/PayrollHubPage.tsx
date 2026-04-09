import { Users, Wallet, MinusCircle, CalendarRange, Calculator, ArrowRight, ScrollText } from "lucide-react";
import { PAYROLL_PAGE } from "@/lib/payrollPages";
import { PayrollGuide } from "@/components/payroll/PayrollGuide";

type Props = { onNavigate: (page: string) => void };

const cards: { title: string; desc: string; page: string; icon: typeof Users }[] = [
  {
    title: "Staff & salaries",
    desc: "Link BOAT staff to payroll, base pay and allowances.",
    page: PAYROLL_PAGE.staff,
    icon: Users,
  },
  {
    title: "Payroll settings",
    desc: "PAYE / NSSF parameters and GL accounts for posting.",
    page: PAYROLL_PAGE.settings,
    icon: Wallet,
  },
  {
    title: "Loans & advances",
    desc: "Recover salary advances through payroll deductions.",
    page: PAYROLL_PAGE.loans,
    icon: MinusCircle,
  },
  {
    title: "Payroll periods",
    desc: "Define pay months or cycles before processing.",
    page: PAYROLL_PAGE.periods,
    icon: CalendarRange,
  },
  {
    title: "Process & post",
    desc: "Calculate payslips, approve for payment, post to the ledger.",
    page: PAYROLL_PAGE.run,
    icon: Calculator,
  },
  {
    title: "Audit trail",
    desc: "Who prepared, approved, and posted payroll (append-only log).",
    page: PAYROLL_PAGE.audit,
    icon: ScrollText,
  },
];

export function PayrollHubPage({ onNavigate }: Props) {
  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Payroll</h1>
        <PayrollGuide guideId="hub" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {cards.map((c) => (
          <button
            key={c.page}
            type="button"
            onClick={() => onNavigate(c.page)}
            className="text-left rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-slate-300 hover:bg-slate-50/80 transition flex flex-col gap-2"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100 text-indigo-800">
                  <c.icon className="w-5 h-5" aria-hidden />
                </span>
                <span className="font-semibold text-slate-900">{c.title}</span>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />
            </div>
            <p className="text-sm text-slate-600">{c.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
