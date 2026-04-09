import type { ReactNode } from "react";
import { PageNotes } from "@/components/common/PageNotes";

/** Screen ids for the hidden-until-click payroll guides (same trigger pattern as PageNotes). */
export type PayrollGuideId = "hub" | "staff" | "settings" | "loans" | "periods" | "run" | "payslip" | "audit";

const GUIDE_META: Record<PayrollGuideId, { ariaLabel: string; body: ReactNode }> = {
  hub: {
    ariaLabel: "Payroll module guide",
    body: (
      <>
        <p>
          Use these shortcuts to set up pay, run a period, and post to the general ledger. Nothing here is required in a
          fixed order, but a typical flow is:
        </p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>
            <strong>Staff &amp; salaries</strong> — base pay and allowances for each person on payroll.
          </li>
          <li>
            <strong>Payroll settings</strong> — NSSF rates and GL accounts (needed before posting).
          </li>
          <li>
            <strong>Loans &amp; advances</strong> — optional salary deductions.
          </li>
          <li>
            <strong>Payroll periods</strong> — define the pay month or cycle.
          </li>
          <li>
            <strong>Process &amp; post</strong> — calculate payslips, <strong>approve for payment</strong>, then post
            the journal.
          </li>
          <li>
            <strong>Audit trail</strong> — who prepared, approved, and posted (append-only log).
          </li>
        </ol>
        <p>Click the book icon on any payroll screen anytime to open that screen’s guide. It stays hidden until you open it.</p>
      </>
    ),
  },
  staff: {
    ariaLabel: "Guide: Staff and salaries",
    body: (
      <>
        <p>
          Lists everyone in your organization who has a staff record. For each person, save a <strong>payroll profile</strong>{" "}
          with base salary and allowances. Gross pay for payroll is the sum of those amounts (plus any other allowances
          stored in the system for that profile).
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>On payroll</strong> — unchecked staff are skipped when you calculate a run.
          </li>
          <li>
            If you have not saved a profile yet, salary fields start blank; enter amounts and click <strong>Save</strong>.
          </li>
          <li>Employee code and department are for your reports and payslips; they do not change tax math by themselves.</li>
        </ul>
      </>
    ),
  },
  settings: {
    ariaLabel: "Guide: Payroll settings",
    body: (
      <>
        <p>
          <strong>PAYE</strong> is computed on <strong>gross pay</strong> using the band rules described on this page.
          Those rules are fixed in the app (not editable fields here).
        </p>
        <p>
          <strong>NSSF</strong> — set employee and employer percentages and an optional gross ceiling if your policy caps
          contributable salary.
        </p>
        <p>
          <strong>GL accounts</strong> — map salary expense, PAYE payable, NSSF payable, and net salaries payable before
          you post payroll. Optional staff loan receivable is used if you post loan recovery to the balance sheet.
        </p>
        <p>Confirm figures with your accountant; BOAT applies the formulas you see on this screen.</p>
      </>
    ),
  },
  loans: {
    ariaLabel: "Guide: Loans and advances",
    body: (
      <>
        <p>
          Register staff loans or salary advances you recover through payroll. Each row has principal, current balance, and
          the amount to deduct <strong>per run</strong> (installment).
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Only <strong>active</strong> loans are included in calculation.</li>
          <li>Deductions reduce net pay in the payslip for that period.</li>
          <li>
            After you <strong>post</strong> a payroll run to the ledger, remaining balances are reduced to match what was
            deducted (same logic as the payslip).
          </li>
        </ul>
      </>
    ),
  },
  periods: {
    ariaLabel: "Guide: Payroll periods",
    body: (
      <>
        <p>
          Each period is a dated window with a label (for example &quot;March 2026&quot;). You run payroll against one
          period at a time.
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Create periods before using <strong>Process &amp; post</strong>.</li>
          <li>Only one payroll run exists per period; recalculating replaces the lines for that run.</li>
          <li>Create a new period for each pay cycle you need to process.</li>
        </ul>
      </>
    ),
  },
  run: {
    ariaLabel: "Guide: Process payroll",
    body: (
      <>
        <p>
          Pick a period, create or open the run, then <strong>Calculate</strong> to build payslip lines from staff
          profiles, statutory rules, and loans.
        </p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>
            <strong>Prepare run</strong> — creates the draft run for the period if needed.
          </li>
          <li>
            <strong>Calculate</strong> — fills gross, PAYE, NSSF, loans, and net pay per employee.
          </li>
          <li>
            <strong>Days absent</strong> — optional. Daily rate = full monthly gross ÷ working days (set under Payroll
            settings). Tab out of the field to recalculate PAYE and net pay for that person.
          </li>
          <li>
            <strong>Approve for payment</strong> — required before posting (segregation of duties; roles set under Admin
            → Approval rights).
          </li>
          <li>
            Review the grid, open <strong>View</strong> / PDF for payslips, then <strong>Post to accounting</strong> when
            ready.
          </li>
        </ol>
        <p>
          After posting, the run is <strong>locked</strong>: lines cannot be changed. Posting creates journal entries
          using the GL accounts from Payroll settings. Use a new period for the next pay cycle.
        </p>
      </>
    ),
  },
  payslip: {
    ariaLabel: "Guide: Payslip view",
    body: (
      <>
        <p>This page shows one employee’s payslip for a single calculated payroll run.</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Use print or PDF from the toolbar for a paper copy or file.</li>
          <li>Figures come from the posted or last-calculated line for that run and staff member.</li>
          <li>If data looks wrong, go back to <strong>Process payroll</strong>, adjust staff or settings, and recalculate.</li>
        </ul>
      </>
    ),
  },
  audit: {
    ariaLabel: "Guide: Payroll audit trail",
    body: (
      <>
        <p>
          Append-only log of payroll actions (prepare run, calculate, approve for payment, post to ledger, etc.) with
          timestamps and optional details.
        </p>
        <p>
          Which roles may <strong>prepare</strong> payroll, <strong>approve</strong> it for payment, and{" "}
          <strong>post</strong> to the GL is set under <strong>Admin → Approval rights</strong> (stored in this browser;
          configure from an admin workstation for your organization).
        </p>
      </>
    ),
  },
};

type Props = { guideId: PayrollGuideId };

/** Hidden until opened: same UX as PageNotes, with a book icon and payroll-specific copy per screen. */
export function PayrollGuide({ guideId }: Props) {
  const g = GUIDE_META[guideId];
  return (
    <PageNotes ariaLabel={g.ariaLabel} variant="guide">
      {g.body}
    </PageNotes>
  );
}
