import { useCallback, useEffect, useMemo, useState } from "react";
import { getPayrollAccess } from "@/lib/payrollAccess";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PayrollGuide } from "@/components/payroll/PayrollGuide";
import { ReadOnlyNotice } from "@/components/common/ReadOnlyNotice";
import { grossFromProfile, parsePayrollMoney } from "@/lib/payrollCalculation";

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
  other_allowances?: unknown;
  is_on_payroll: boolean;
};

type Props = { readOnly?: boolean };

export function PayrollStaffPage({ readOnly }: Props) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const payrollAccess = useMemo(() => getPayrollAccess(user?.role, readOnly ?? false), [user?.role, readOnly]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileRow>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

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
    load();
  }, [load]);

  const saveProfile = async (staffId: string, draft: Partial<ProfileRow>) => {
    if (readOnly || !orgId || !payrollAccess.canPrepare) return;
    setSavingId(staffId);
    setErr(null);
    const existing = profiles[staffId];
    const payload = {
      staff_id: staffId,
      employee_code: draft.employee_code ?? existing?.employee_code ?? null,
      department: draft.department ?? existing?.department ?? null,
      job_title: draft.job_title ?? existing?.job_title ?? null,
      base_salary: parsePayrollMoney(draft.base_salary ?? existing?.base_salary ?? 0),
      housing_allowance: parsePayrollMoney(draft.housing_allowance ?? existing?.housing_allowance ?? 0),
      transport_allowance: parsePayrollMoney(draft.transport_allowance ?? existing?.transport_allowance ?? 0),
      is_on_payroll: draft.is_on_payroll ?? existing?.is_on_payroll ?? true,
    };
    if (existing?.id) {
      const { error } = await supabase.from("payroll_employee_profiles").update(payload).eq("id", existing.id);
      if (error) setErr(error.message);
    } else {
      const { error } = await supabase
        .from("payroll_employee_profiles")
        .insert({ organization_id: orgId, ...payload });
      if (error) setErr(error.message);
    }
    setSavingId(null);
    load();
  };

  if (!orgId) {
    return <p className="p-6 text-slate-600">No organization.</p>;
  }

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Payroll staff</h1>
        <PayrollGuide guideId="staff" />
      </div>
      {readOnly && <ReadOnlyNotice />}
      {!readOnly && !payrollAccess.canPrepare && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Your role cannot edit staff salaries. Grant payroll prepare access under Admin → Approval rights.
        </p>
      )}
      {err && <p className="text-red-600 text-sm">{err}</p>}
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
  profile,
  disabled,
  saving,
  onSave,
}: {
  staff: StaffRow;
  profile?: ProfileRow;
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
  const [onPayroll, setOnPayroll] = useState(profile?.is_on_payroll ?? true);

  useEffect(() => {
    setCode(profile?.employee_code ?? "");
    setDept(profile?.department ?? "");
    setJob(profile?.job_title ?? "");
    setBase(salaryFieldToInputValue(profile, "base_salary"));
    setHousing(salaryFieldToInputValue(profile, "housing_allowance"));
    setTransport(salaryFieldToInputValue(profile, "transport_allowance"));
    setOnPayroll(profile?.is_on_payroll ?? true);
  }, [profile]);

  const grossPreview = useMemo(() => {
    return grossFromProfile({
      base_salary: parsePayrollMoney(base === "" ? 0 : base),
      housing_allowance: parsePayrollMoney(housing === "" ? 0 : housing),
      transport_allowance: parsePayrollMoney(transport === "" ? 0 : transport),
      other_allowances: profile?.other_allowances,
    });
  }, [base, housing, transport, profile?.other_allowances]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex flex-wrap justify-between gap-2">
        <div>
          <p className="font-semibold text-slate-900">{staff.full_name}</p>
          <p className="text-xs text-slate-500">
            {staff.email} · {staff.role ?? "—"}
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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <input
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
          placeholder="Employee code"
          value={code}
          disabled={disabled}
          onChange={(e) => setCode(e.target.value)}
        />
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
      </div>
      {!profile && (
        <p className="text-xs text-slate-500">No payroll profile yet—enter amounts and Save. Fields are blank, not zero.</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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
      </div>
      <p className="text-sm text-slate-600">
        Gross pay (for payroll):{" "}
        <span className="font-medium tabular-nums text-slate-900">{grossPreview.toLocaleString()}</span>
      </p>
      <button
        type="button"
        disabled={disabled || saving}
        onClick={() =>
          onSave({
            employee_code: code || null,
            department: dept || null,
            job_title: job || null,
            base_salary: parsePayrollMoney(base === "" ? 0 : base),
            housing_allowance: parsePayrollMoney(housing === "" ? 0 : housing),
            transport_allowance: parsePayrollMoney(transport === "" ? 0 : transport),
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
