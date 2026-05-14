import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, UserPlus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";
import {
  computeNextPatientNumber,
  fetchClinicConsultations,
  fetchClinicPatients,
  insertClinicPatient,
} from "@/lib/clinicData";
import type { ClinicConsultation, ClinicPatient } from "./clinicTypes";

export interface ClinicPatientsPageProps {
  highlightPatientId?: string;
  openRegister?: boolean;
  onConsumedNavigateIntent?: () => void;
}

export function ClinicPatientsPage({
  highlightPatientId,
  openRegister,
  onConsumedNavigateIntent,
}: ClinicPatientsPageProps) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [patients, setPatients] = useState<ClinicPatient[]>([]);
  const [consultations, setConsultations] = useState<ClinicConsultation[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    gender: "",
    age: "",
    phone: "",
    address: "",
  });

  const reload = useCallback(async () => {
    if (!orgId) {
      setPatients([]);
      setConsultations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const [p, c] = await Promise.all([
        fetchClinicPatients(orgId, superAdmin),
        fetchClinicConsultations(orgId, superAdmin),
      ]);
      setPatients(p);
      setConsultations(c);
    } catch (e) {
      console.error(e);
      setLoadError(e instanceof Error ? e.message : "Failed to load patients");
    } finally {
      setLoading(false);
    }
  }, [orgId, superAdmin]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!openRegister) return;
    setShowForm(true);
    onConsumedNavigateIntent?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRegister]);

  useEffect(() => {
    if (!highlightPatientId) return;
    setSelectedId(highlightPatientId);
    onConsumedNavigateIntent?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightPatientId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.patientNumber.toLowerCase().includes(q) ||
        (p.phone || "").toLowerCase().includes(q)
    );
  }, [patients, query]);

  const selected = selectedId ? patients.find((p) => p.id === selectedId) : undefined;
  const history = useMemo(() => {
    if (!selectedId) return [];
    return consultations.filter((c) => c.patientId === selectedId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [consultations, selectedId]);

  const register = async () => {
    const name = form.name.trim();
    if (!name || !orgId) return;
    setSaving(true);
    setLoadError(null);
    try {
      const patientNumber = await computeNextPatientNumber(orgId, superAdmin);
      const patient = await insertClinicPatient({
        orgId,
        patientNumber,
        name,
        gender: form.gender.trim(),
        age: form.age.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
      });
      await reload();
      setForm({ name: "", gender: "", age: "", phone: "", address: "" });
      setShowForm(false);
      setSelectedId(patient.id);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (!orgId) {
    return (
      <div className="min-h-[calc(100vh-4rem)] p-6 md:p-8 bg-slate-50">
        <p className="text-sm text-slate-600">Select an organization to manage clinic patients.</p>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] p-6 md:p-8 bg-slate-50">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900">Patients</h1>
              <PageNotes ariaLabel="Patients module help">
                <p>Patient register stored in Supabase (per organization). Search and open visit history.</p>
              </PageNotes>
            </div>
            <p className="text-slate-600 text-sm mt-1">Patient number, name, gender, age, phone, address.</p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 text-white px-4 py-2 text-sm font-medium hover:bg-emerald-800"
          >
            <UserPlus className="w-4 h-4" />
            Register patient
          </button>
        </div>

        {loadError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{loadError}</div>
        ) : null}

        {showForm ? (
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
            <h2 className="font-semibold text-slate-900">New patient</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block text-sm">
                <span className="text-slate-600">Name</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="Full name"
                />
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">Gender</span>
                <select
                  value={form.gender}
                  onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
                >
                  <option value="">—</option>
                  <option value="Female">Female</option>
                  <option value="Male">Male</option>
                  <option value="Other">Other</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">Age</span>
                <input
                  value={form.age}
                  onChange={(e) => setForm((f) => ({ ...f, age: e.target.value }))}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="e.g. 34"
                />
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">Phone</span>
                <input
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="text-slate-600">Address</span>
                <input
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </label>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void register()}
                className="px-4 py-2 rounded-lg bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-800 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save patient"}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-800 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-2 space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, number, phone…"
                className="w-full border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm"
              />
            </div>
            <div className="bg-white rounded-xl border border-slate-200 max-h-[420px] overflow-y-auto divide-y divide-slate-100">
              {loading ? (
                <p className="p-4 text-sm text-slate-500">Loading…</p>
              ) : filtered.length === 0 ? (
                <p className="p-4 text-sm text-slate-600">No matches.</p>
              ) : (
                filtered.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    className={`w-full text-left px-4 py-3 text-sm hover:bg-slate-50 ${
                      selectedId === p.id ? "bg-emerald-50 border-l-4 border-l-emerald-600" : ""
                    }`}
                  >
                    <div className="font-medium text-slate-900">{p.name}</div>
                    <div className="text-xs text-slate-500">{p.patientNumber}</div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="lg:col-span-3 bg-white rounded-xl border border-slate-200 p-6 shadow-sm min-h-[280px]">
            {!selected ? (
              <p className="text-sm text-slate-600">Select a patient to view details and visit history.</p>
            ) : (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">{selected.name}</h2>
                  <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-slate-500">Patient number</dt>
                      <dd className="font-medium text-slate-900">{selected.patientNumber}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Gender</dt>
                      <dd className="font-medium text-slate-900">{selected.gender || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Age</dt>
                      <dd className="font-medium text-slate-900">{selected.age || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Phone</dt>
                      <dd className="font-medium text-slate-900">{selected.phone || "—"}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-slate-500">Address</dt>
                      <dd className="font-medium text-slate-900">{selected.address || "—"}</dd>
                    </div>
                  </dl>
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900 mb-2">Visit history</h3>
                  {history.length === 0 ? (
                    <p className="text-sm text-slate-600">No consultations recorded.</p>
                  ) : (
                    <ul className="space-y-3">
                      {history.map((c) => (
                        <li key={c.id} className="border border-slate-100 rounded-lg p-3 text-sm">
                          <div className="text-xs text-slate-500 mb-1">
                            {new Date(c.createdAt).toLocaleString()} · Step: {c.step}
                          </div>
                          {c.symptoms ? (
                            <p>
                              <span className="text-slate-500">Symptoms: </span>
                              {c.symptoms}
                            </p>
                          ) : null}
                          {c.diagnosis ? (
                            <p>
                              <span className="text-slate-500">Diagnosis: </span>
                              {c.diagnosis}
                            </p>
                          ) : null}
                          {c.prescription ? (
                            <p>
                              <span className="text-slate-500">Rx: </span>
                              {c.prescription}
                            </p>
                          ) : null}
                          {c.notes ? (
                            <p>
                              <span className="text-slate-500">Notes: </span>
                              {c.notes}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
