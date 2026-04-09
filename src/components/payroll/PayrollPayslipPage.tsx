import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PayrollGuide } from "@/components/payroll/PayrollGuide";
import { PayrollPayslipPanel } from "@/components/payroll/PayrollPayslipPanel";
import type { PayslipDetail } from "@/lib/payrollPayslipPdf";

type Props = {
  payrollRunId?: string;
  payrollStaffId?: string;
  onBack?: () => void;
};

export function PayrollPayslipPage({ payrollRunId, payrollStaffId, onBack }: Props) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const [detail, setDetail] = useState<PayslipDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!orgId || !payrollRunId || !payrollStaffId) {
      setLoading(false);
      setDetail(null);
      return;
    }
    setLoading(true);
    setErr(null);
    const [{ data: org }, { data: line }, { data: run }, { data: prof }] = await Promise.all([
      supabase.from("organizations").select("name").eq("id", orgId).maybeSingle(),
      supabase
        .from("payroll_run_lines")
        .select("*")
        .eq("payroll_run_id", payrollRunId)
        .eq("staff_id", payrollStaffId)
        .maybeSingle(),
      supabase.from("payroll_runs").select("payroll_period_id").eq("id", payrollRunId).maybeSingle(),
      supabase
        .from("payroll_employee_profiles")
        .select("employee_code")
        .eq("organization_id", orgId)
        .eq("staff_id", payrollStaffId)
        .maybeSingle(),
    ]);
    const periodId = (run as { payroll_period_id?: string } | null)?.payroll_period_id;
    const { data: period } = periodId
      ? await supabase.from("payroll_periods").select("label,period_start,period_end").eq("id", periodId).maybeSingle()
      : { data: null };
    const { data: st } = await supabase.from("staff").select("full_name").eq("id", payrollStaffId).maybeSingle();

    if (!line) {
      setErr("Payslip line not found.");
      setDetail(null);
      setLoading(false);
      return;
    }
    const l = line as {
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
    const daysAbsent = Number(l.days_absent ?? 0);
    const fullGross = l.line_detail?.full_gross ?? Number(l.gross_pay);
    const absentDed = Number(l.absent_deduction ?? 0);
    const showAbsent = daysAbsent > 0;
    setDetail({
      organizationName: (org as { name?: string } | null)?.name ?? "—",
      periodLabel: (period as { label?: string } | null)?.label ?? "—",
      periodStart: String((period as { period_start?: string } | null)?.period_start ?? ""),
      periodEnd: String((period as { period_end?: string } | null)?.period_end ?? ""),
      staffName: (st as { full_name?: string } | null)?.full_name ?? payrollStaffId,
      employeeCode: (prof as { employee_code?: string | null } | null)?.employee_code ?? null,
      fullGross: showAbsent ? fullGross : undefined,
      daysAbsent: showAbsent ? daysAbsent : undefined,
      absentDeduction: showAbsent ? absentDed : undefined,
      grossPay: Number(l.gross_pay),
      paye: Number(l.paye),
      nssfEmployee: Number(l.nssf_employee),
      nssfEmployer: Number(l.nssf_employer),
      loanDeduction: Number(l.loan_deduction),
      netPay: Number(l.net_pay),
    });
    setLoading(false);
  }, [orgId, payrollRunId, payrollStaffId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!payrollRunId || !payrollStaffId) {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <p className="text-slate-600">Open a payslip from Process payroll (View) or use a link with payroll run and staff.</p>
        {onBack && (
          <button type="button" onClick={onBack} className="mt-4 text-sm text-indigo-700 hover:underline">
            Back
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900">Payslip</h1>
          <PayrollGuide guideId="payslip" />
        </div>
        {onBack && (
          <button type="button" onClick={onBack} className="text-sm text-indigo-700 hover:underline print:hidden">
            ← Back to payroll
          </button>
        )}
      </div>
      {err && <p className="text-red-600 text-sm">{err}</p>}
      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : detail ? (
        <PayrollPayslipPanel detail={detail} />
      ) : null}
    </div>
  );
}
