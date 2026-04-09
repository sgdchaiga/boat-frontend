import { Calculator, FileText } from "lucide-react";
import { PageNotes } from "@/components/common/PageNotes";

export function SaccoLoansPage() {
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Loans</h1>
        <PageNotes ariaLabel="Loans help">
          <p>Loan origination, schedules, and arrears — principal and interest flow to receivable and revenue GL accounts.</p>
        </PageNotes>
      </header>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-slate-700/80 bg-slate-900/40 p-5">
          <div className="flex items-center gap-2 text-slate-200 font-medium text-sm">
            <Calculator className="w-4 h-4 text-amber-400" />
            Portfolio summary
          </div>
          <p className="text-xs text-slate-500 mt-3">Outstanding principal, PAR, and interest due will display once loan data is connected.</p>
        </div>
        <div className="rounded-xl border border-slate-700/80 bg-slate-900/40 p-5">
          <div className="flex items-center gap-2 text-slate-200 font-medium text-sm">
            <FileText className="w-4 h-4 text-amber-400" />
            Schedules & repayments
          </div>
          <p className="text-xs text-slate-500 mt-3">Repayment batches can generate journal entries: debit cash, credit loans receivable and interest income.</p>
        </div>
      </div>
    </div>
  );
}
