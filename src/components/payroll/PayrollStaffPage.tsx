import { useCallback, useEffect, useMemo, useState } from "react";
import { getPayrollAccess } from "@/lib/payrollAccess";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PayrollGuide } from "@/components/payroll/PayrollGuide";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
import { grossFromProfile, parsePayrollMoney } from "@/lib/payrollCalculation";
import { payrollBusinessLabel, payrollStaffTypes, mergePayrollProfile } from "@/lib/payrollBusiness";
import { AddPayrollEmployee } from "@/components/payroll/AddPayrollEmployee";

type StaffRow = {
  id: string;
  full_name: string;
  email: string;
  role: string | null;
};

type ProfileRow = {
  id: string;
  staff_id: string;
  employee_code: string | null;
  department: string | null;
  job_title: string | null;
  base_salary: number;
  housing_allowance: number;
  transport_allowance: number;
  responsibility_allowance: number;
  salary_grade: string | null;
  recurring_deductions: unknown;
  staff_type: string | null;
  date_joined: string | null;
  bank_name: string | null;
  bank_account_number: string | null;
  mobile_money_number: string | null;
  payment_method: string;
  tin: string | null;
  nssf_number: string | null;
  other_allowances?: unknown;
  is_on_payroll: boolean;
};

type Props = { readOnly?: boolean; mode?: "employees" | "salary" };

export function PayrollStaffPage({ readOnly, mode = "employees" }: Props) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const payrollAccess = useMemo(() => getPayrollAccess(user?.role, readOnly ?? false), [user?.role, readOnly]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileRow>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [addingEmployee, setAddingEmployee] = useState(false);
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    const [sRes, pRes] = await Promise.all([
      supabase.from("staff").select("id,full_name,email,role").eq("organization_id", orgId).order("full_name"),
      supabase.from("payroll_employee_profiles").select("*").eq("organization_id", orgId),
    ]);
    setErr(sRes.error?.message || pRes.error?.message || null);
    setStaff((sRes.data as StaffRow[]) || []);
    const map: Record<string, ProfileRow> = {};
    for (const p of (pRes.data as ProfileRow[]) || []) {
      map[p.staff_id] = p;
    }
    setProfiles(map);
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    setAddingEmployee(false); setSuccess("");
    load();
  }, [load]);

  const saveProfile = async (staffId: string, draft: Partial<ProfileRow>) => {
    if (readOnly || !orgId || !payrollAccess.canPrepare) return;
    setSavingId(staffId);
    setErr(null);
    setSuccess("");
    const existing = profiles[staffId];
    const merged = mergePayrollProfile(existing || {} as ProfileRow, draft);
    const payload = {
      staff_id: staffId,
      employee_code: merged.employee_code ?? null,
      department: merged.department ?? null,
      job_title: merged.job_title ?? null,
      base_salary: parsePayrollMoney(merged.base_salary ?? 0),
      housing_allowance: parsePayrollMoney(merged.housing_allowance ?? 0),
      transport_allowance: parsePayrollMoney(merged.transport_allowance ?? 0),
      responsibility_allowance: parsePayrollMoney(merged.responsibility_allowance ?? 0),
      salary_grade: merged.salary_grade ?? null,
      recurring_deductions: merged.recurring_deductions ?? [],
      staff_type: merged.staff_type ?? null,
      date_joined: merged.date_joined ?? null,
      bank_name: merged.bank_name ?? null,
      bank_account_number: merged.bank_account_number ?? null,
      mobile_money_number: merged.mobile_money_number ?? null,
      payment_method: merged.payment_method ?? "bank",
      tin: merged.tin ?? null,
      nssf_number: merged.nssf_number ?? null,
      is_on_payroll: merged.is_on_payroll ?? true,
    };
    try {
      const query = existing?.id
        ? supabase.from("payroll_employee_profiles").update(payload).eq("id", existing.id).eq("organization_id", orgId)
        : supabase.from("payroll_employee_profiles").insert({ organization_id: orgId, ...payload });
      const { data, error } = await query.select("*").single();
      if (error) throw error;
      setProfiles((current) => ({ ...current, [staffId]: data as ProfileRow }));
      setSuccess("Payroll profile saved.");
    } catch (error) {
      setErr(error instanceof Error ? error.message : String((error as { message?: string }).message || error));
    } finally { setSavingId(null); }
  };

  if (!orgId) {
    return <p className="p-6 text-slate-600">No organization.</p>;
  }

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div><p className="text-xs font-medium text-slate-500">{payrollBusinessLabel(user?.business_type)} › Payroll › {mode === "employees" ? "Employees" : "Salary Structure"}</p><h1 className="text-2xl font-bold text-slate-900">{mode === "employees" ? "Employees" : "Salary Structure"}</h1><p className="mt-1 text-sm text-slate-600">{mode === "employees" ? "Maintain payroll eligibility and employment information." : "Maintain salary, allowances and recurring payroll values."}</p></div>
        <PayrollGuide guideId="staff" />
        {mode === "employees" && !readOnly && payrollAccess.canPrepare && <div className="ml-auto"><button type="button" onClick={() => setAddingEmployee(true)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Add employee (no user account)</button><p className="mt-1 text-xs text-slate-500">Add staff directly to payroll without creating a BOAT login.</p></div>}
      </div>
      {readOnly && <ReadOnlyNotice />}
      {!readOnly && !payrollAccess.canPrepare && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Your role cannot edit staff salaries. Grant payroll prepare access under Admin → Approval rights.
        </p>
      )}
      {err && <p className="text-red-600 text-sm">{err}</p>}
      {success && <p role="status" className="text-sm text-emerald-700">{success}</p>}
      {addingEmployee && !readOnly && payrollAccess.canPrepare && <AddPayrollEmployee key={orgId} businessType={user?.business_type} onCancel={() => setAddingEmployee(false)} onCreated={async (id) => {
        const [s, p] = await Promise.all([
          supabase.from("staff").select("id,full_name,email,role").eq("id", id).eq("organization_id", orgId).single(),
          supabase.from("payroll_employee_profiles").select("*").eq("staff_id", id).eq("organization_id", orgId).single(),
        ]);
        if (s.error) throw s.error; if (p.error) throw p.error;
        setStaff((current) => [...current.filter((row) => row.id !== id), s.data as StaffRow].sort((a, b) => a.full_name.localeCompare(b.full_name)));
        setProfiles((current) => ({ ...current, [id]: p.data as ProfileRow }));
        setAddingEmployee(false); setSuccess("Employee added to payroll. Open Salary Structure to set allowances and deductions.");
      }} />}
      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        <div className="space-y-4">
          {staff.map((s) => {
            const p = profiles[s.id];
            return (
              <StaffSalaryCard
                key={s.id}
                staff={s}
                profile={p}
                mode={mode}
                businessType={user?.business_type}
                disabled={readOnly || !payrollAccess.canPrepare}
                saving={savingId === s.id}
                onSave={(d) => void saveProfile(s.id, d)}
              />
            );
          })}
          {staff.length === 0 && <p className="text-slate-500">No staff in this organization.</p>}
        </div>
      )}
    </div>
  );
}

/** Empty inputs when there is no saved profile yet; otherwise show stored amounts (Postgres numeric may be string). */
function salaryFieldToInputValue(
  profile: ProfileRow | undefined,
  field: "base_salary" | "housing_allowance" | "transport_allowance"
): string {
  if (!profile) return "";
  return String(parsePayrollMoney(profile[field]));
}

function StaffSalaryCard({
  staff,
  businessType,
  profile,
  mode,
  disabled,
  saving,
  onSave,
}: {
  staff: StaffRow;
  businessType?: string | null;
  profile?: ProfileRow;
  mode: "employees" | "salary";
  disabled?: boolean;
  saving: boolean;
  onSave: (d: Partial<ProfileRow>) => void;
}) {
  const [code, setCode] = useState(() => profile?.employee_code ?? "");
  const [dept, setDept] = useState(() => profile?.department ?? "");
  const [job, setJob] = useState(() => profile?.job_title ?? "");
  const [base, setBase] = useState(() => salaryFieldToInputValue(profile, "base_salary"));
  const [housing, setHousing] = useState(() => salaryFieldToInputValue(profile, "housing_allowance"));
  const [transport, setTransport] = useState(() => salaryFieldToInputValue(profile, "transport_allowance"));
  const [responsibility, setResponsibility] = useState(() => profile ? String(parsePayrollMoney(profile.responsibility_allowance)) : "");
  const [grade, setGrade] = useState(() => profile?.salary_grade ?? "");
  const [recurring, setRecurring] = useState(() => Array.isArray(profile?.recurring_deductions) ? String((profile!.recurring_deductions as { amount?: number }[]).reduce((s, d) => s + Number(d.amount ?? 0), 0)) : "");
  const [staffType, setStaffType] = useState(() => profile?.staff_type ?? "");
  const [dateJoined, setDateJoined] = useState(() => profile?.date_joined ?? "");
  const [bankName, setBankName] = useState(() => profile?.bank_name ?? "");
  const [bankAccount, setBankAccount] = useState(() => profile?.bank_account_number ?? "");
  const [mobileMoney, setMobileMoney] = useState(() => profile?.mobile_money_number ?? "");
  const [paymentMethod, setPaymentMethod] = useState(() => profile?.payment_method ?? "bank");
  const [tin, setTin] = useState(() => profile?.tin ?? "");
  const [nssfNumber, setNssfNumber] = useState(() => profile?.nssf_number ?? "");
  const [onPayroll, setOnPayroll] = useState(profile?.is_on_payroll ?? true);

  useEffect(() => {
    setCode(profile?.employee_code ?? "");
    setDept(profile?.department ?? "");
    setJob(profile?.job_title ?? "");
    setBase(salaryFieldToInputValue(profile, "base_salary"));
    setHousing(salaryFieldToInputValue(profile, "housing_allowance"));
    setTransport(salaryFieldToInputValue(profile, "transport_allowance"));
    setResponsibility(profile ? String(parsePayrollMoney(profile.responsibility_allowance)) : ""); setGrade(profile?.salary_grade ?? "");
    setRecurring(Array.isArray(profile?.recurring_deductions) ? String((profile!.recurring_deductions as { amount?: number }[]).reduce((s, d) => s + Number(d.amount ?? 0), 0)) : "");
    setStaffType(profile?.staff_type ?? ""); setDateJoined(profile?.date_joined ?? ""); setBankName(profile?.bank_name ?? ""); setBankAccount(profile?.bank_account_number ?? ""); setMobileMoney(profile?.mobile_money_number ?? ""); setPaymentMethod(profile?.payment_method ?? "bank"); setTin(profile?.tin ?? ""); setNssfNumber(profile?.nssf_number ?? "");
    setOnPayroll(profile?.is_on_payroll ?? true);
  }, [profile]);

  const grossPreview = useMemo(() => {
    return grossFromProfile({
      base_salary: parsePayrollMoney(base === "" ? 0 : base),
      housing_allowance: parsePayrollMoney(housing === "" ? 0 : housing),
      transport_allowance: parsePayrollMoney(transport === "" ? 0 : transport),
      responsibility_allowance: parsePayrollMoney(responsibility === "" ? 0 : responsibility),
      other_allowances: profile?.other_allowances,
    });
  }, [base, housing, transport, responsibility, profile?.other_allowances]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex flex-wrap justify-between gap-2">
        <div>
          <p className="font-semibold text-slate-900">{staff.full_name}</p>
          <p className="text-xs text-slate-500">
            {staff.email}{staff.email ? " · " : ""}{staff.role === "payroll_employee" ? "Payroll employee · No login" : staff.role ?? "—"}
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onPayroll}
            disabled={disabled}
            onChange={(e) => setOnPayroll(e.target.checked)}
          />
          On payroll
        </label>
      </div>
      {mode === "employees" && <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <input
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          placeholder="Employee code"
          value={code}
          disabled={disabled}
          onChange={(e) => setCode(e.target.value)}
        />
        <select className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={staffType} disabled={disabled} onChange={(e) => setStaffType(e.target.value)}><option value="">Staff type</option>{staffType && !payrollStaffTypes(businessType).includes(staffType) && <option value={staffType}>{staffType} (previous classification)</option>}{payrollStaffTypes(businessType).map((type) => <option key={type} value={type}>{type}</option>)}</select>
        <input type="date" className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={dateJoined} disabled={disabled} onChange={(e) => setDateJoined(e.target.value)} />
        <select className="border border-slate-300 rounded-lg px-3 py-2 text-sm" value={paymentMethod} disabled={disabled} onChange={(e) => setPaymentMethod(e.target.value)}><option value="bank">Bank</option><option value="mobile_money">Mobile money</option><option value="cash">Cash</option></select>
        <input className="border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="Bank name" value={bankName} disabled={disabled} onChange={(e) => setBankName(e.target.value)} />
        <input className="border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="Bank account number" value={bankAccount} disabled={disabled} onChange={(e) => setBankAccount(e.target.value)} />
        <input className="border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="Mobile-money number" value={mobileMoney} disabled={disabled} onChange={(e) => setMobileMoney(e.target.value)} />
        <input className="border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="TIN" value={tin} disabled={disabled} onChange={(e) => setTin(e.target.value)} />
        <input className="border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="NSSF number" value={nssfNumber} disabled={disabled} onChange={(e) => setNssfNumber(e.target.value)} />
        <input
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          placeholder="Department"
          value={dept}
          disabled={disabled}
          onChange={(e) => setDept(e.target.value)}
        />
        <input
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          placeholder="Job title"
          value={job}
          disabled={disabled}
          onChange={(e) => setJob(e.target.value)}
        />
      </div>}
      {!profile && (
        <p className="text-xs text-slate-500">No payroll profile yet—enter amounts and Save. Fields are blank, not zero.</p>
      )}
      {mode === "salary" && <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="block text-sm"><span className="text-slate-600">Salary grade / scale</span><input className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" value={grade} disabled={disabled} onChange={(e) => setGrade(e.target.value)} /></label>
        <label className="block text-sm">
          <span className="text-slate-600">Base salary</span>
          <input
            type="number"
            min={0}
            step="any"
            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="0"
            value={base}
            disabled={disabled}
            onChange={(e) => setBase(e.target.value)}
          />
        </label>
        <label className="block text-sm"><span className="text-slate-600">Responsibility allowance</span><input type="number" min={0} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" value={responsibility} disabled={disabled} onChange={(e) => setResponsibility(e.target.value)} /></label>
        <label className="block text-sm"><span className="text-slate-600">Recurring deductions</span><input type="number" min={0} className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" value={recurring} disabled={disabled} onChange={(e) => setRecurring(e.target.value)} /></label>
        <label className="block text-sm">
          <span className="text-slate-600">Housing allowance</span>
          <input
            type="number"
            min={0}
            step="any"
            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="0"
            value={housing}
            disabled={disabled}
            onChange={(e) => setHousing(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">Transport allowance</span>
          <input
            type="number"
            min={0}
            step="any"
            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            placeholder="0"
            value={transport}
            disabled={disabled}
            onChange={(e) => setTransport(e.target.value)}
          />
        </label>
      </div>}
      {mode === "salary" && <p className="text-sm text-slate-600">
        Gross pay (for payroll):{" "}
        <span className="font-medium tabular-nums text-slate-900">{grossPreview.toLocaleString()}</span>
      </p>}
      <button
        type="button"
        disabled={disabled || saving}
        onClick={() =>
          onSave(mode === "employees" ? {
            employee_code: code || null,
            department: dept || null,
            job_title: job || null,
            staff_type: staffType || null, date_joined: dateJoined || null, bank_name: bankName || null, bank_account_number: bankAccount || null, mobile_money_number: mobileMoney || null, payment_method: paymentMethod, tin: tin || null, nssf_number: nssfNumber || null,
            is_on_payroll: onPayroll,
          } : {
            base_salary: parsePayrollMoney(base === "" ? 0 : base),
            housing_allowance: parsePayrollMoney(housing === "" ? 0 : housing),
            transport_allowance: parsePayrollMoney(transport === "" ? 0 : transport),
            responsibility_allowance: parsePayrollMoney(responsibility === "" ? 0 : responsibility), salary_grade: grade || null,
            ...(parsePayrollMoney(recurring) !== (Array.isArray(profile?.recurring_deductions) ? (profile.recurring_deductions as { amount?: number }[]).reduce((sum, d) => sum + Number(d.amount || 0), 0) : 0)
              ? { recurring_deductions: recurring ? [{ label: "Recurring deduction", amount: parsePayrollMoney(recurring) }] : [] } : {}),
            is_on_payroll: onPayroll,
          })
        }
        className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-800 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
