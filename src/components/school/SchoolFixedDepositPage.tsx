import { PageNotes } from "@/components/common/PageNotes";

type Props = { readOnly?: boolean };

export function SchoolFixedDepositPage({ readOnly: _readOnly }: Props) {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Fixed deposits</h1>
        <PageNotes ariaLabel="Fixed deposits">
          <p>
            Term deposits for school-related savings products — connect to the same GL and posting flows as the rest of BOAT when you enable this module
            for the organization.
          </p>
        </PageNotes>
      </div>
      <p className="text-slate-600 text-sm">Placeholder workspace until term-deposit products and postings are configured for schools.</p>
    </div>
  );
}
