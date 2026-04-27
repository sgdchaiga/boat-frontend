import { useCallback, useEffect, useMemo, useState } from "react";
import { getPayrollAccess } from "@/lib/payrollAccess";
import { supabase } from "@/lib/supabase";
import { normalizeGlAccountRows } from "@/lib/glAccountNormalize";
import { useAuth } from "@/contexts/AuthContext";
import { PayrollGuide } from "@/components/payroll/PayrollGuide";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";

type GlAcc = { id: string; account_code: string; account_name: string };

type SettingsRow = {
  organization_id: string;
  paye_personal_relief_monthly: number;
  paye_taxable_band_1_limit: number;
  paye_rate_band_1_pct: number;
  paye_rate_above_band_1_pct: number;
  nssf_employee_rate_pct: number;
  nssf_employer_rate_pct: number;
  nssf_gross_ceiling: number | null;
  /** Days in a typical pay month for daily rate (full gross ÷ days × days absent). */
  payroll_working_days_per_month?: number;
  salary_expense_gl_account_id: string | null;
  paye_payable_gl_account_id: string | null;
  nssf_payable_gl_account_id: string | null;
  salaries_payable_gl_account_id: string | null;
  staff_loan_receivable_gl_account_id: string | null;
};

type Props = { readOnly?: boolean };

export function PayrollSettingsPage({ readOnly }: Props) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const payrollAccess = useMemo(() => getPayrollAccess(user?.role, readOnly ?? false), [user?.role, readOnly]);
  const [gl, setGl] = useState<GlAcc[]>([]);
  const [row, setRow] = useState<Partial<SettingsRow>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [gRes, sRes] = await Promise.all([
      supabase.from("gl_accounts").select("*").order("account_code"),
      supabase.from("payroll_org_settings").select("*").eq("organization_id", orgId).maybeSingle(),
    ]);
    setErr(gRes.error?.message || sRes.error?.message || null);
    const normalizedGl = normalizeGlAccountRows((gRes.data || []) as unknown[]).map((row) => ({
      id: row.id,
      account_code: row.account_code,
      account_name: row.account_name,
    }));
    setGl(normalizedGl as GlAcc[]);
    setRow((sRes.data as SettingsRow) || {});
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (readOnly || !orgId) return;
    setSaving(true);
    setErr(null);
    const payload = {
      organization_id: orgId,
      // Legacy DB columns; PAYE in runs uses computePayeFromGrossExcelBands (gross pay), not these values.
      paye_personal_relief_monthly: Number(row.paye_personal_relief_monthly ?? 235000),
      paye_taxable_band_1_limit: Number(row.paye_taxable_band_1_limit ?? 235000),
      paye_rate_band_1_pct: Number(row.paye_rate_band_1_pct ?? 0),
      paye_rate_above_band_1_pct: Number(row.paye_rate_above_band_1_pct ?? 30),
      nssf_employee_rate_pct: Number(row.nssf_employee_rate_pct ?? 5),
      nssf_employer_rate_pct: Number(row.nssf_employer_rate_pct ?? 10),
      nssf_gross_ceiling: row.nssf_gross_ceiling === null || row.nssf_gross_ceiling === ("" as unknown)
        ? null
        : Number(row.nssf_gross_ceiling),
      payroll_working_days_per_month: Number(row.payroll_working_days_per_month ?? 22),
      salary_expense_gl_account_id: row.salary_expense_gl_account_id || null,
      paye_payable_gl_account_id: row.paye_payable_gl_account_id || null,
      nssf_payable_gl_account_id: row.nssf_payable_gl_account_id || null,
      salaries_payable_gl_account_id: row.salaries_payable_gl_account_id || null,
      staff_loan_receivable_gl_account_id: row.staff_loan_receivable_gl_account_id || null,
    };
    const { error } = await supabase.from("payroll_org_settings").upsert(payload, { onConflict: "organization_id" });
    if (error) setErr(error.message);
    setSaving(false);
    load();
  };

  if (!orgId) return <p className="p-6 text-slate-600">No organization.</p>;

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Payroll settings</h1>
        <PayrollGuide guideId="settings" />
      </div>
      {readOnly && <ReadOnlyNotice />}
      {!readOnly && !payrollAccess.canPrepare && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Your role cannot change payroll settings. Ask an administrator to grant payroll prepare access (Admin →
          Approval rights).
        </p>
      )}
      {err && <p className="text-red-600 text-sm">{err}</p>}
      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        <div className="space-y-4">
        <fieldset
          disabled={readOnly || !payrollAccess.canPrepare}
          className="space-y-4 border-0 p-0 m-0 min-w-0 disabled:opacity-60"
        >
          <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <h2 className="font-semibold text-slate-800">Statutory parameters</h2>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm text-slate-700 space-y-2">
              <p className="font-medium text-slate-800">PAYE (Pay As You Earn)</p>
              <p>
                Computed on <strong>gross pay</strong> (Excel-style bands). Let <code className="text-xs bg-white px-1 rounded border">J8</code>{" "}
                = gross pay:
              </p>
              <ul className="list-disc pl-5 space-y-1 text-slate-600">
                <li>If J8 ≤ 235,000 → 0</li>
                <li>Else if J8 &lt; 335,000 → (J8 − 235,000) × 10%</li>
                <li>Else if J8 &lt; 410,000 → (J8 − 335,000) × 20% + 10,000</li>
                <li>Else if J8 ≤ 10,000,000 → (J8 − 410,000) × 30% + 25,000</li>
                <li>Else → (J8 − 410,000) × 30% + 25,000 + (J8 − 10,000,000) × 10%</li>
              </ul>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Field label="NSSF employee %" value={row.nssf_employee_rate_pct} onChange={(n) => setRow((r) => ({ ...r, nssf_employee_rate_pct: n }))} />
              <Field label="NSSF employer %" value={row.nssf_employer_rate_pct} onChange={(n) => setRow((r) => ({ ...r, nssf_employer_rate_pct: n }))} />
              <Field
                label="Working days per month (for absence deduction)"
                value={row.payroll_working_days_per_month ?? 22}
                onChange={(n) =>
                  setRow((r) => ({
                    ...r,
                    payroll_working_days_per_month: n === "" ? 22 : Math.max(1, Number(n) || 22),
                  }))
                }
              />
              <p className="text-xs text-slate-500 sm:col-span-2">
                Daily rate = full monthly gross ÷ this number. Absent deduction = daily rate × days absent (set on Process
                payroll).
              </p>
              <label className="block text-sm sm:col-span-2">
                <span className="text-slate-600">NSSF gross ceiling (optional)</span>
                <input
                  type="number"
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="Leave empty for no cap"
                  value={row.nssf_gross_ceiling ?? ""}
                  onChange={(e) =>
                    setRow((r) => ({
                      ...r,
                      nssf_gross_ceiling: e.target.value === "" ? null : Number(e.target.value),
                    }))
                  }
                />
              </label>
            </div>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <h2 className="font-semibold text-slate-800">GL accounts</h2>
            <GlSelect
              label="Salary expense"
              value={row.salary_expense_gl_account_id}
              gl={gl}
              onChange={(id) => setRow((r) => ({ ...r, salary_expense_gl_account_id: id }))}
            />
            <GlSelect label="PAYE payable" value={row.paye_payable_gl_account_id} gl={gl} onChange={(id) => setRow((r) => ({ ...r, paye_payable_gl_account_id: id }))} />
            <GlSelect label="NSSF payable" value={row.nssf_payable_gl_account_id} gl={gl} onChange={(id) => setRow((r) => ({ ...r, nssf_payable_gl_account_id: id }))} />
            <GlSelect
              label="Salaries payable (net)"
              value={row.salaries_payable_gl_account_id}
              gl={gl}
              onChange={(id) => setRow((r) => ({ ...r, salaries_payable_gl_account_id: id }))}
            />
            <GlSelect
              label="Staff loan receivable (optional)"
              value={row.staff_loan_receivable_gl_account_id}
              gl={gl}
              onChange={(id) => setRow((r) => ({ ...r, staff_loan_receivable_gl_account_id: id }))}
              optional
            />
          </section>
        </fieldset>
        <button
          type="button"
          disabled={readOnly || saving || !payrollAccess.canPrepare}
          onClick={() => void save()}
          className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | string | undefined;
  onChange: (n: number | "") => void;
}) {
  return (
    <label className="block text-sm">
      <span className="text-slate-600">{label}</span>
      <input
        type="number"
        className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
        value={value === null || value === undefined ? "" : value}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
      />
    </label>
  );
}

function GlSelect({
  label,
  value,
  gl,
  onChange,
  optional,
}: {
  label: string;
  value: string | null | undefined;
  gl: GlAcc[];
  onChange: (id: string | null) => void;
  optional?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="text-slate-600">{label}</span>
      <select
        className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">{optional ? "— None —" : "— Select —"}</option>
        {gl.map((a) => (
          <option key={a.id} value={a.id}>
            {a.account_code} — {a.account_name}
          </option>
        ))}
      </select>
    </label>
  );
}
