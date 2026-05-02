import type { FC } from "react";
import { BarChart3, FileSpreadsheet } from "lucide-react";
import { PageNotes } from "@/components/common/PageNotes";

type NavigateFn = (page: string, state?: Record<string, unknown>) => void;

interface SaccoFinancialSummariesPageProps {
  navigate?: NavigateFn;
}

/** Board-friendly launch pad for statement-style reports — routes are standard accounting screens. */
const SaccoFinancialSummariesPage: FC<SaccoFinancialSummariesPageProps> = ({ navigate }) => {
  const links: { title: string; subtitle: string; page: string }[] = [
    { title: "Trial balance", subtitle: "All accounts balanced for the period.", page: "accounting_trial" },
    { title: "Income statement", subtitle: "Profit and loss at a glance.", page: "accounting_income" },
    { title: "Balance sheet", subtitle: "What the SACCO owns and owes.", page: "accounting_balance" },
    { title: "Cash flow", subtitle: "How cash moved in and out.", page: "accounting_cashflow" },
  ];

  return (
    <div className="space-y-6 max-w-4xl px-4 sm:px-0">
      <div className="flex flex-wrap items-center gap-2">
        <FileSpreadsheet className="text-emerald-600" size={26} aria-hidden />
        <h1 className="text-2xl font-bold text-slate-900">Financial summaries</h1>
        <PageNotes ariaLabel="Financial summaries help">
          <p className="text-sm">
            Open each report in BOAT&apos;s accounting workspace. Figures post from Teller, journals, and other modules —
            clerks normally use Performance and Reports rather than changing these totals here.
          </p>
        </PageNotes>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {links.map((x) => (
          <button
            key={x.page}
            type="button"
            onClick={() => navigate?.(x.page)}
            className="text-left rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-emerald-300 hover:bg-emerald-50/40 transition flex gap-3"
          >
            <div className="rounded-lg bg-emerald-600/10 p-2 h-fit shrink-0">
              <BarChart3 className="text-emerald-700 w-5 h-5" />
            </div>
            <div>
              <p className="font-semibold text-slate-900">{x.title}</p>
              <p className="text-sm text-slate-600 mt-0.5">{x.subtitle}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default SaccoFinancialSummariesPage;
