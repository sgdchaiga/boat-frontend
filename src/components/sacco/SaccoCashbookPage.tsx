import { BookMarked, List } from "lucide-react";
import { PageNotes } from "@/components/common/PageNotes";

export function SaccoCashbookPage() {
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Cashbook</h1>
        <PageNotes ariaLabel="Cashbook help">
          <p>Day book of all cash and bank movements — reconciles to the cash / bank GL and supports audit trails.</p>
        </PageNotes>
      </header>

      <div className="rounded-xl border border-slate-700/80 bg-slate-900/40 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700/60 bg-slate-900/60">
          <BookMarked className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-medium text-slate-200">Cashbook lines</span>
        </div>
        <div className="p-8 text-center">
          <List className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <p className="text-sm text-slate-500">Transaction grid will list dated receipts and payments with GL batch references.</p>
        </div>
      </div>
    </div>
  );
}
