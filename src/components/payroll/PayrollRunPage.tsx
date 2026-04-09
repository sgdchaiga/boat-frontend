import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileDown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PayrollGuide } from "@/components/payroll/PayrollGuide";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
import {
  computeAbsentDeduction,
  computeNssfEmployee,
  computeNssfEmployer,
  computePayeFromGrossExcelBands,
  grossFromProfile,
  mergeStatutory,
  roundMoney,
} from "@/lib/payrollCalculation";
import {
  applyLoanWriteDownsAfterPayrollPost,
  computeLoanDeductionForStaff,
  type PayrollLoanRow,
} from "@/lib/payrollLoanWriteDown";
import { postPayrollRunToJournal, type PayrollGlIds, type PayrollRunTotals } from "@/lib/payrollPostAccounting";
import type { PayslipDetail } from "@/lib/payrollPayslipPdf";
import { downloadAllPayslipsPdf, downloadPayslipPdf } from "@/lib/payrollPayslipPdf";
import { PAYROLL_PAGE } from "@/lib/payrollPages";
import { PayrollPayslipPanel } from "@/components/payroll/PayrollPayslipPanel";
import { getPayrollAccess } from "@/lib/payrollAccess";
import { logPayrollAudit } from "@/lib/payrollAudit";

type PeriodRow = { id: string; label: string; period_start: string; period_end: string };
type ProfileRow = {
  staff_id: string;
  base_salary: number;
  housing_allowance: number;
  transport_allowance: number;
  other_allowances: unknown;
  is_on_payroll: boolean;
};
type SettingsRow = {
  paye_personal_relief_monthly: number;
  paye_taxable_band_1_limit: number;
  paye_rate_band_1_pct: number;
  paye_rate_above_band_1_pct: number;
  nssf_employee_rate_pct: number;
  nssf_employer_rate_pct: number;
  nssf_gross_ceiling: number | null;
  payroll_working_days_per_month: number;
  salary_expense_gl_account_id: string | null;
  paye_payable_gl_account_id: string | null;
  nssf_payable_gl_account_id: string | null;
  salaries_payable_gl_account_id: string | null;
  staff_loan_receivable_gl_account_id: string | null;
};
type RunRow = {
  id: string;
  status: string;
  journal_entry_id: string | null;
  payroll_period_id: string;
  approved_at?: string | null;
  approved_by?: string | null;
};
type LineRow = {
  id: string;
  staff_id: string;
  gross_pay: number;
  paye: number;
  nssf_employee: number;
  nssf_employer: number;
  loan_deduction: number;
  net_pay: number;
  days_absent?: number;
  absent_deduction?: number;
  line_detail?: { full_gross?: number };
};

function buildPayslipDetail(
  line: LineRow,
  period: PeriodRow | undefined,
  orgName: string | null,
  staffName: string,
  empCode: string | null | undefined
): PayslipDetail {
  const daysAbsent = Number(line.days_absent ?? 0);
  const fullGross = line.line_detail?.full_gross ?? Number(line.gross_pay);
  const absentDed = Number(line.absent_deduction ?? 0);
  const showAbsent = daysAbsent > 0;
  return {
    organizationName: orgName ?? "—",
    periodLabel: period?.label ?? "—",
    periodStart: period?.period_start ?? "",
    periodEnd: period?.period_end ?? "",
    staffName,
    employeeCode: empCode ?? null,
    fullGross: showAbsent ? fullGross : undefined,
    daysAbsent: showAbsent ? daysAbsent : undefined,
    absentDeduction: showAbsent ? absentDed : undefined,
    grossPay: Number(line.gross_pay),
    paye: Number(line.paye),
    nssfEmployee: Number(line.nssf_employee),
    nssfEmployer: Number(line.nssf_employer),
    loanDeduction: Number(line.loan_deduction),
    netPay: Number(line.net_pay),
  };
}

type Props = { readOnly?: boolean; onNavigate?: (page: string, state?: Record<string, unknown>) => void };

function toStatutory(s: SettingsRow) {
  return mergeStatutory({
    payePersonalReliefMonthly: Number(s.paye_personal_relief_monthly),
    payeTaxableBand1Limit: Number(s.paye_taxable_band_1_limit),
    payeRateBand1Pct: Number(s.paye_rate_band_1_pct),
    payeRateAboveBand1Pct: Number(s.paye_rate_above_band_1_pct),
    nssfEmployeeRatePct: Number(s.nssf_employee_rate_pct),
    nssfEmployerRatePct: Number(s.nssf_employer_rate_pct),
    nssfGrossCeiling: s.nssf_gross_ceiling,
  });
}

export function PayrollRunPage({ readOnly, onNavigate }: Props) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const payrollAccess = useMemo(() => getPayrollAccess(user?.role, readOnly ?? false), [user?.role, readOnly]);
  const [periods, setPeriods] = useState<PeriodRow[]>([]);
  const [periodId, setPeriodId] = useState("");
  const [run, setRun] = useState<RunRow | null>(null);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [empCodes, setEmpCodes] = useState<Record<string, string | null>>({});
  const [payslipModal, setPayslipModal] = useState<PayslipDetail | null>(null);
  /** Current DOM values for days absent (so Calculate works without blurring every field). */
  const absentInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const loadPeriods = useCallback(async () => {
    if (!orgId) return;
    const { data } = await supabase
      .from("payroll_periods")
      .select("id,label,period_start,period_end")
      .eq("organization_id", orgId)
      .order("period_start", { ascending: false });
    setPeriods((data as PeriodRow[]) || []);
  }, [orgId]);

  const loadRunBundle = useCallback(
    async (pid: string) => {
      if (!orgId || !pid) {
        setRun(null);
        setLines([]);
        setStaffNames({});
        setEmpCodes({});
        return;
      }
      const { data: r } = await supabase.from("payroll_runs").select("*").eq("payroll_period_id", pid).maybeSingle();
      const runRow = r as RunRow | null;
      setRun(runRow);
      if (runRow?.id) {
        const { data: ln } = await supabase.from("payroll_run_lines").select("*").eq("payroll_run_id", runRow.id);
        setLines((ln as LineRow[]) || []);
        const ids = [...new Set((ln as LineRow[] | null)?.map((x) => x.staff_id) || [])];
        if (ids.length) {
          const { data: st } = await supabase.from("staff").select("id,full_name").in("id", ids);
          const m: Record<string, string> = {};
          for (const s of (st as { id: string; full_name: string }[]) || []) m[s.id] = s.full_name;
          setStaffNames(m);
          const { data: profs } = await supabase
            .from("payroll_employee_profiles")
            .select("staff_id,employee_code")
            .eq("organization_id", orgId)
            .in("staff_id", ids);
          const cm: Record<string, string | null> = {};
          for (const p of (profs as { staff_id: string; employee_code: string | null }[]) || [])
            cm[p.staff_id] = p.employee_code;
          setEmpCodes(cm);
        } else {
          setStaffNames({});
          setEmpCodes({});
        }
      } else {
        setLines([]);
        setStaffNames({});
        setEmpCodes({});
      }
    },
    [orgId]
  );

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    loadPeriods().finally(() => setLoading(false));
    void supabase
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle()
      .then(({ data }) => setOrgName((data as { name?: string } | null)?.name ?? null));
  }, [orgId, loadPeriods]);

  useEffect(() => {
    void loadRunBundle(periodId);
  }, [periodId, loadRunBundle]);

  const ensureRun = async () => {
    if (readOnly || !periodId || !orgId || !user?.id) return;
    if (!payrollAccess.canPrepare) {
      setErr("Your role cannot prepare payroll runs. Ask an administrator.");
      return;
    }
    setBusy(true);
    setErr(null);
    const { data: existing } = await supabase.from("payroll_runs").select("id").eq("payroll_period_id", periodId).maybeSingle();
    if (existing) {
      setBusy(false);
      await loadRunBundle(periodId);
      return;
    }
    const { data: created, error } = await supabase
      .from("payroll_runs")
      .insert({ payroll_period_id: periodId, status: "draft" })
      .select("id")
      .maybeSingle();
    if (error) setErr(error.message);
    else if (created?.id) {
      await logPayrollAudit({
        organizationId: orgId,
        actorStaffId: user.id,
        action: "payroll_run_prepared",
        payrollRunId: created.id,
        details: { payroll_period_id: periodId },
      });
    }
    setBusy(false);
    await loadRunBundle(periodId);
  };

  const calculatePayroll = async () => {
    if (readOnly || !run?.id || !orgId) {
      setErr("Select a period and ensure a run exists (Prepare run).");
      return;
    }
    if (run.status === "posted") {
      setErr("This run is already posted. Create a new period for another payroll.");
      return;
    }
    if (!payrollAccess.canPrepare) {
      setErr("Your role cannot prepare or calculate payroll. Ask an administrator.");
      return;
    }
    setBusy(true);
    setErr(null);
    const { data: settings } = await supabase.from("payroll_org_settings").select("*").eq("organization_id", orgId).maybeSingle();
    if (!settings) {
      setErr("Configure Payroll settings first.");
      setBusy(false);
      return;
    }
    const st = toStatutory(settings as SettingsRow);
    const wdRaw = (settings as SettingsRow).payroll_working_days_per_month;
    const workingDays = Math.max(1, Number(wdRaw ?? 22));
    const { data: prevLines } = await supabase
      .from("payroll_run_lines")
      .select("staff_id,days_absent")
      .eq("payroll_run_id", run.id);
    const absentByStaff = new Map<string, number>();
    for (const row of prevLines || []) {
      absentByStaff.set((row as { staff_id: string }).staff_id, Number((row as { days_absent?: number }).days_absent ?? 0));
    }
    for (const l of lines) {
      const el = absentInputRefs.current[l.id];
      if (el) {
        const n = Math.max(0, Number(el.value) || 0);
        absentByStaff.set(l.staff_id, n);
      }
    }
    const { data: profiles } = await supabase.from("payroll_employee_profiles").select("*").eq("organization_id", orgId).eq("is_on_payroll", true);
    const { data: loans } = await supabase
      .from("payroll_loans")
      .select("id,staff_id,installment_amount,balance_remaining,is_active,created_at")
      .eq("organization_id", orgId);
    const loanList = (loans as PayrollLoanRow[]) || [];
    const profs = (profiles as ProfileRow[]) || [];

    const linePayload: Record<string, unknown>[] = [];
    for (const p of profs) {
      const fullGross = grossFromProfile(p);
      const daysAbsent = absentByStaff.get(p.staff_id) ?? 0;
      const rawAbsent = computeAbsentDeduction(fullGross, daysAbsent, workingDays);
      const absentDed = roundMoney(Math.min(rawAbsent, fullGross));
      const gross = Math.max(0, roundMoney(fullGross - absentDed));
      const nssfE = computeNssfEmployee(gross, st);
      const nssfEr = computeNssfEmployer(gross, st);
      const taxable = Math.max(0, gross - nssfE);
      const paye = computePayeFromGrossExcelBands(gross);
      const loan = computeLoanDeductionForStaff(p.staff_id, loanList);
      const net = roundMoney(gross - paye - nssfE - loan);
      linePayload.push({
        payroll_run_id: run.id,
        staff_id: p.staff_id,
        gross_pay: gross,
        taxable_income: taxable,
        paye,
        nssf_employee: nssfE,
        nssf_employer: nssfEr,
        loan_deduction: loan,
        net_pay: net,
        days_absent: daysAbsent,
        absent_deduction: absentDed,
        line_detail: {
          full_gross: fullGross,
          days_absent: daysAbsent,
          working_days: workingDays,
          absent_deduction: absentDed,
          gross,
          taxable,
          paye,
          paye_basis: "gross_excel_bands",
          nssfE,
          nssfEr,
          loan,
        },
      });
    }

    await supabase.from("payroll_run_lines").delete().eq("payroll_run_id", run.id);
    if (linePayload.length) {
      const { error: insErr } = await supabase.from("payroll_run_lines").insert(linePayload);
      if (insErr) {
        setErr(insErr.message);
        setBusy(false);
        return;
      }
    }
    const totalsForAudit = linePayload.reduce(
      (acc, row) => {
        const g = Number((row as { gross_pay: number }).gross_pay);
        const n = Number((row as { net_pay: number }).net_pay);
        return { gross: acc.gross + g, net: acc.net + n, lines: acc.lines + 1 };
      },
      { gross: 0, net: 0, lines: 0 }
    );
    await supabase
      .from("payroll_runs")
      .update({
        status: "calculated",
        calculated_at: new Date().toISOString(),
        approved_at: null,
        approved_by: null,
      })
      .eq("id", run.id);
    if (user?.id) {
      await logPayrollAudit({
        organizationId: orgId,
        actorStaffId: user.id,
        action: "payroll_calculated",
        payrollRunId: run.id,
        details: {
          employee_lines: totalsForAudit.lines,
          total_gross: totalsForAudit.gross,
          total_net: totalsForAudit.net,
        },
      });
    }
    setBusy(false);
    await loadRunBundle(periodId);
  };

  const approveForPayment = async () => {
    if (readOnly || !run?.id || !orgId || !user?.id) return;
    if (!payrollAccess.canApproveForPayment) {
      setErr("Your role cannot approve payroll for payment.");
      return;
    }
    if (run.status !== "calculated") {
      setErr("Calculate payroll first, then approve for payment.");
      return;
    }
    setBusy(true);
    setErr(null);
    const { error } = await supabase
      .from("payroll_runs")
      .update({
        status: "approved",
        approved_at: new Date().toISOString(),
        approved_by: user.id,
      })
      .eq("id", run.id);
    if (error) setErr(error.message);
    else {
      await logPayrollAudit({
        organizationId: orgId,
        actorStaffId: user.id,
        action: "payroll_approved_for_payment",
        payrollRunId: run.id,
        details: { payroll_period_id: periodId },
      });
    }
    setBusy(false);
    await loadRunBundle(periodId);
  };

  const revokeApproval = async () => {
    if (readOnly || !run?.id || !orgId || !user?.id) return;
    if (!payrollAccess.canApproveForPayment) {
      setErr("Your role cannot change approval.");
      return;
    }
    if (run.status !== "approved") return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase
      .from("payroll_runs")
      .update({
        status: "calculated",
        approved_at: null,
        approved_by: null,
      })
      .eq("id", run.id);
    if (error) setErr(error.message);
    else {
      await logPayrollAudit({
        organizationId: orgId,
        actorStaffId: user.id,
        action: "payroll_approval_revoked",
        payrollRunId: run.id,
        details: {},
      });
    }
    setBusy(false);
    await loadRunBundle(periodId);
  };

  const onDaysAbsentBlur = async (line: LineRow, raw: string) => {
    if (readOnly || !run || run.status === "posted" || !payrollAccess.canPrepare) return;
    const n = Math.max(0, Number(raw) || 0);
    if (n === Number(line.days_absent ?? 0)) return;
    setErr(null);
    const { error } = await supabase.from("payroll_run_lines").update({ days_absent: n }).eq("id", line.id);
    if (error) {
      setErr(error.message);
      return;
    }
    await calculatePayroll();
  };

  const postToAccounting = async () => {
    if (readOnly || !run?.id || !user?.id) return;
    if (!orgId) return;
    if (!payrollAccess.canPostToLedger) {
      setErr("Your role cannot post payroll to the ledger.");
      return;
    }
    if (run.status !== "approved") {
      setErr("Approve payroll for payment before posting to the ledger.");
      return;
    }
    setBusy(true);
    setErr(null);
    const { data: settings } = await supabase.from("payroll_org_settings").select("*").eq("organization_id", orgId).maybeSingle();
    if (!settings) {
      setErr("Configure Payroll settings.");
      setBusy(false);
      return;
    }
    const s = settings as SettingsRow;
    const totals: PayrollRunTotals = lines.reduce(
      (acc, l) => ({
        totalGross: acc.totalGross + Number(l.gross_pay),
        totalPaye: acc.totalPaye + Number(l.paye),
        totalNssfEmployee: acc.totalNssfEmployee + Number(l.nssf_employee),
        totalNssfEmployer: acc.totalNssfEmployer + Number(l.nssf_employer),
        totalLoan: acc.totalLoan + Number(l.loan_deduction),
        totalNet: acc.totalNet + Number(l.net_pay),
      }),
      {
        totalGross: 0,
        totalPaye: 0,
        totalNssfEmployee: 0,
        totalNssfEmployer: 0,
        totalLoan: 0,
        totalNet: 0,
      }
    );
    const gl: PayrollGlIds = {
      salaryExpenseGlAccountId: s.salary_expense_gl_account_id || "",
      payePayableGlAccountId: s.paye_payable_gl_account_id || "",
      nssfPayableGlAccountId: s.nssf_payable_gl_account_id || "",
      salariesPayableGlAccountId: s.salaries_payable_gl_account_id || "",
      staffLoanReceivableGlAccountId: s.staff_loan_receivable_gl_account_id,
    };
    const period = periods.find((p) => p.id === periodId);
    const { journalEntryId, error: postErr } = await postPayrollRunToJournal({
      organizationId: orgId,
      entryDate: period?.period_end || new Date().toISOString().slice(0, 10),
      description: period ? `Payroll — ${period.label}` : "Payroll",
      payrollRunId: run.id,
      createdBy: user.id,
      totals,
      gl,
    });
    if (postErr || !journalEntryId) {
      setErr(postErr || "Post failed");
      setBusy(false);
      return;
    }
    await supabase
      .from("payroll_runs")
      .update({
        status: "posted",
        journal_entry_id: journalEntryId,
        posted_at: new Date().toISOString(),
        posted_by: user.id,
      })
      .eq("id", run.id);

    await logPayrollAudit({
      organizationId: orgId,
      actorStaffId: user.id,
      action: "payroll_posted_to_ledger",
      payrollRunId: run.id,
      details: { journal_entry_id: journalEntryId, totals },
    });

    const wd = await applyLoanWriteDownsAfterPayrollPost(
      orgId,
      lines.map((l) => ({ staff_id: l.staff_id, loan_deduction: Number(l.loan_deduction) }))
    );
    if (wd.error) {
      setErr(
        `Journal posted (${journalEntryId}), but loan balances were not updated: ${wd.error}`
      );
    }

    setBusy(false);
    await loadRunBundle(periodId);
  };

  const periodForPayslip = periods.find((p) => p.id === periodId);

  const openPayslip = (line: LineRow) => {
    const d = buildPayslipDetail(
      line,
      periodForPayslip,
      orgName,
      staffNames[line.staff_id] ?? line.staff_id,
      empCodes[line.staff_id]
    );
    setPayslipModal(d);
  };

  const downloadAllPayslips = () => {
    if (!lines.length) return;
    const list = lines.map((l) =>
      buildPayslipDetail(l, periodForPayslip, orgName, staffNames[l.staff_id] ?? l.staff_id, empCodes[l.staff_id])
    );
    downloadAllPayslipsPdf(list);
  };

  if (!orgId) return <p className="p-6 text-slate-600">No organization.</p>;

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Process payroll</h1>
        <PayrollGuide guideId="run" />
      </div>
      {readOnly && <ReadOnlyNotice />}
      {err && <p className="text-red-600 text-sm">{err}</p>}
      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              <span className="text-slate-600 block mb-1">Period</span>
              <select
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm min-w-[220px]"
                value={periodId}
                onChange={(e) => setPeriodId(e.target.value)}
              >
                <option value="">Select period</option>
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} ({p.period_start} → {p.period_end})
                  </option>
                ))}
              </select>
            </label>
            {!readOnly && (
              <>
                <button
                  type="button"
                  disabled={!periodId || busy || !payrollAccess.canPrepare}
                  onClick={() => void ensureRun()}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50 disabled:opacity-50"
                >
                  Prepare run
                </button>
                <button
                  type="button"
                  disabled={!run || busy || run.status === "posted" || !payrollAccess.canPrepare}
                  onClick={() => void calculatePayroll()}
                  className="px-4 py-2 bg-indigo-700 text-white rounded-lg text-sm hover:bg-indigo-800 disabled:opacity-50"
                >
                  Calculate payroll
                </button>
                <button
                  type="button"
                  disabled={
                    !run ||
                    busy ||
                    run.status !== "calculated" ||
                    lines.length === 0 ||
                    !payrollAccess.canApproveForPayment
                  }
                  onClick={() => void approveForPayment()}
                  className="px-4 py-2 border border-emerald-600 text-emerald-900 bg-emerald-50 rounded-lg text-sm hover:bg-emerald-100 disabled:opacity-50"
                >
                  Approve for payment
                </button>
                <button
                  type="button"
                  disabled={!run || busy || run.status !== "approved" || !payrollAccess.canApproveForPayment}
                  onClick={() => void revokeApproval()}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50 disabled:opacity-50"
                >
                  Revoke approval
                </button>
                <button
                  type="button"
                  disabled={
                    !run ||
                    busy ||
                    run.status !== "approved" ||
                    lines.length === 0 ||
                    !payrollAccess.canPostToLedger
                  }
                  onClick={() => void postToAccounting()}
                  className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-800 disabled:opacity-50"
                >
                  Post to accounting
                </button>
              </>
            )}
          </div>
          {run && (
            <div className="text-sm text-slate-600 space-y-1">
              <p>
                Run status: <strong className="capitalize">{run.status}</strong>
                {run.status === "posted" && (
                  <span className="ml-2 text-amber-800 font-medium">· Locked (no edits)</span>
                )}
                {run.journal_entry_id && (
                  <>
                    {" "}
                    · Journal: <code className="text-xs bg-slate-100 px-1 rounded">{run.journal_entry_id}</code>
                  </>
                )}
              </p>
              {run.status === "approved" && run.approved_at && (
                <p>
                  Approved for payment: {new Date(run.approved_at).toLocaleString()}
                </p>
              )}
            </div>
          )}
          {lines.length > 0 && run?.status !== "posted" && (
            <p className="text-sm text-slate-600 max-w-2xl">
              Set <strong>Days absent</strong> per employee (daily rate = full gross ÷ working days from Payroll settings).
              Tab out or leave the field to recalculate PAYE, NSSF, and net.
            </p>
          )}
          {lines.length > 0 && (
            <div className="flex flex-wrap gap-2 print:hidden">
              <button
                type="button"
                onClick={downloadAllPayslips}
                className="inline-flex items-center gap-2 px-3 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50"
              >
                <FileDown className="w-4 h-4 shrink-0" aria-hidden />
                Download all payslips (PDF)
              </button>
            </div>
          )}
          <div className="rounded-xl border border-slate-200 overflow-x-auto bg-white">
            <table className="w-full text-sm min-w-[1100px]">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left p-3 font-semibold text-slate-700">Staff</th>
                  <th className="text-right p-3 font-semibold text-slate-700 w-[100px]">Days absent</th>
                  <th className="text-right p-3 font-semibold text-slate-700">Absent ded.</th>
                  <th className="text-right p-3 font-semibold text-slate-700">Gross</th>
                  <th className="text-right p-3 font-semibold text-slate-700">PAYE</th>
                  <th className="text-right p-3 font-semibold text-slate-700">NSSF (ee)</th>
                  <th className="text-right p-3 font-semibold text-slate-700">NSSF (er)</th>
                  <th className="text-right p-3 font-semibold text-slate-700">Loan</th>
                  <th className="text-right p-3 font-semibold text-slate-700">Net</th>
                  <th className="text-right p-3 font-semibold text-slate-700 print:hidden">Payslip</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-6 text-slate-500">
                      No payslip lines — select a period, prepare run, then calculate.
                    </td>
                  </tr>
                ) : (
                  lines.map((l) => (
                    <tr key={l.staff_id} className="border-b border-slate-100">
                      <td className="p-3">{staffNames[l.staff_id] ?? l.staff_id}</td>
                      <td className="p-3 text-right">
                        <input
                          ref={(el) => {
                            absentInputRefs.current[l.id] = el;
                          }}
                          type="number"
                          min={0}
                          step={0.5}
                          className="w-20 ml-auto border border-slate-300 rounded px-2 py-1 text-right text-sm tabular-nums"
                          defaultValue={Number(l.days_absent ?? 0)}
                          disabled={readOnly || run?.status === "posted"}
                          onBlur={(e) => void onDaysAbsentBlur(l, e.target.value)}
                          aria-label={`Days absent for ${staffNames[l.staff_id] ?? "staff"}`}
                        />
                      </td>
                      <td className="p-3 text-right tabular-nums">{Number(l.absent_deduction ?? 0).toLocaleString()}</td>
                      <td className="p-3 text-right">{Number(l.gross_pay).toLocaleString()}</td>
                      <td className="p-3 text-right">{Number(l.paye).toLocaleString()}</td>
                      <td className="p-3 text-right">{Number(l.nssf_employee).toLocaleString()}</td>
                      <td className="p-3 text-right">{Number(l.nssf_employer).toLocaleString()}</td>
                      <td className="p-3 text-right">{Number(l.loan_deduction).toLocaleString()}</td>
                      <td className="p-3 text-right font-medium">{Number(l.net_pay).toLocaleString()}</td>
                      <td className="p-3 text-right whitespace-nowrap print:hidden">
                        <button
                          type="button"
                          onClick={() => openPayslip(l)}
                          className="text-indigo-700 hover:underline text-sm mr-2"
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            downloadPayslipPdf(
                              buildPayslipDetail(
                                l,
                                periodForPayslip,
                                orgName,
                                staffNames[l.staff_id] ?? l.staff_id,
                                empCodes[l.staff_id]
                              )
                            )
                          }
                          className="text-slate-700 hover:underline text-sm mr-2"
                        >
                          PDF
                        </button>
                        {onNavigate && run?.id ? (
                          <button
                            type="button"
                            onClick={() =>
                              onNavigate(PAYROLL_PAGE.payslip, {
                                payrollRunId: run.id,
                                payrollStaffId: l.staff_id,
                              })
                            }
                            className="text-slate-600 hover:underline text-sm"
                          >
                            Full page
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {payslipModal && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="mt-8 w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <div className="flex justify-end mb-2">
              <button
                type="button"
                onClick={() => setPayslipModal(null)}
                className="text-sm text-slate-600 hover:underline print:hidden"
              >
                Close
              </button>
            </div>
            <PayrollPayslipPanel detail={payslipModal} />
          </div>
        </div>
      )}
    </div>
  );
}
