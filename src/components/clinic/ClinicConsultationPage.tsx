import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";
import {
  fetchClinicConsultations,
  fetchClinicPatients,
  insertClinicConsultation,
  touchClinicPatientActivity,
  updateClinicConsultation,
} from "@/lib/clinicData";
import { nextWorkflowStep, prevWorkflowStep } from "./clinicWorkflow";
import type { ClinicConsultation, ClinicPatient, ClinicWorkflowStep } from "./clinicTypes";

export interface ClinicConsultationPageProps {
  openNew?: boolean;
  onConsumedNavigateIntent?: () => void;
}

const STEPS: { key: ClinicWorkflowStep; label: string }[] = [
  { key: "reception", label: "Reception" },
  { key: "doctor", label: "Doctor" },
  { key: "pharmacy", label: "Pharmacy" },
  { key: "payment", label: "Payment" },
];

export function ClinicConsultationPage({ openNew, onConsumedNavigateIntent }: ClinicConsultationPageProps) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;

  const [patients, setPatients] = useState<ClinicPatient[]>([]);
  const [rows, setRows] = useState<ClinicConsultation[]>([]);
  const [patientId, setPatientId] = useState("");
  const [symptoms, setSymptoms] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [prescription, setPrescription] = useState("");
  const [notes, setNotes] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!orgId) {
      setPatients([]);
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const [p, r] = await Promise.all([
        fetchClinicPatients(orgId, superAdmin),
        fetchClinicConsultations(orgId, superAdmin),
      ]);
      setPatients(p);
      setRows(r);
    } catch (e) {
      console.error(e);
      setLoadError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [orgId, superAdmin]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (patientId) return;
    if (patients.length === 1) setPatientId(patients[0]!.id);
  }, [patients, patientId]);

  useEffect(() => {
    if (!openNew) return;
    setEditingId(null);
    setPatientId("");
    setSymptoms("");
    setDiagnosis("");
    setPrescription("");
    setNotes("");
    onConsumedNavigateIntent?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNew]);

  const currentConsult = useMemo(
    () => (editingId ? rows.find((r) => r.id === editingId) : undefined),
    [editingId, rows]
  );

  const displayStep = currentConsult?.step ?? "reception";

  useEffect(() => {
    const row = editingId ? rows.find((r) => r.id === editingId) : undefined;
    if (!row) return;
    setPatientId(row.patientId);
    setSymptoms(row.symptoms);
    setDiagnosis(row.diagnosis);
    setPrescription(row.prescription);
    setNotes(row.notes);
  }, [editingId, rows]);

  const persist = async (patch: Partial<ClinicConsultation> & { step?: ClinicWorkflowStep }) => {
    if (!orgId || !patientId) return;
    const sx = patch.symptoms ?? symptoms;
    const dx = patch.diagnosis ?? diagnosis;
    const rx = patch.prescription ?? prescription;
    const nx = patch.notes ?? notes;
    const step = patch.step ?? currentConsult?.step ?? "reception";

    setSaving(true);
    setLoadError(null);
    try {
      if (currentConsult) {
        await updateClinicConsultation(currentConsult.id, {
          patientId: patientId !== currentConsult.patientId ? patientId : undefined,
          symptoms: sx,
          diagnosis: dx,
          prescription: rx,
          notes: nx,
          workflowStep: step,
        });
        setEditingId(currentConsult.id);
      } else {
        const created = await insertClinicConsultation({
          orgId,
          patientId,
          symptoms: sx,
          diagnosis: dx,
          prescription: rx,
          notes: nx,
          workflowStep: step,
        });
        setEditingId(created.id);
      }
      await touchClinicPatientActivity(patientId);
      await reload();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const stepIndex = (s: ClinicWorkflowStep) => STEPS.findIndex((x) => x.key === s);

  if (!orgId) {
    return (
      <div className="min-h-[calc(100vh-4rem)] p-6 md:p-8 bg-slate-50">
        <p className="text-sm text-slate-600">Select an organization to record consultations.</p>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] p-6 md:p-8 bg-slate-50">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900">Consultation</h1>
          <PageNotes ariaLabel="Consultation workflow help">
            <p>Reception → Doctor → Pharmacy → Payment. Data is saved to Supabase.</p>
          </PageNotes>
        </div>

        {loadError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{loadError}</div>
        ) : null}

        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-6">
          <div>
            <label className="block text-sm text-slate-600 mb-1">Patient</label>
            <select
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
              disabled={loading || !!currentConsult}
              className="w-full max-w-md border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white disabled:bg-slate-50"
            >
              <option value="">Select patient…</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.patientNumber} — {p.name}
                </option>
              ))}
            </select>
            {patients.length === 0 && !loading ? (
              <p className="text-xs text-amber-700 mt-2">Register a patient first (Patients module).</p>
            ) : null}
          </div>

          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">Workflow</p>
            <div className="flex flex-wrap items-center gap-1 text-sm">
              {STEPS.map((s, i) => {
                const active = stepIndex(displayStep) === i;
                const done = stepIndex(displayStep) > i;
                return (
                  <div key={s.key} className="flex items-center">
                    <span
                      className={`rounded-full px-3 py-1 font-medium ${
                        active ? "bg-emerald-700 text-white" : done ? "bg-emerald-100 text-emerald-900" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {s.label}
                    </span>
                    {i < STEPS.length - 1 ? <ChevronRight className="w-4 h-4 text-slate-400 mx-0.5 shrink-0" /> : null}
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2 mt-4">
              <button
                type="button"
                disabled={!patientId || !currentConsult || saving}
                onClick={() => void persist({ step: prevWorkflowStep(displayStep) })}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm hover:bg-slate-50 disabled:opacity-40"
              >
                Back step
              </button>
              <button
                type="button"
                disabled={!patientId || saving}
                onClick={() => void persist({ step: nextWorkflowStep(displayStep) })}
                className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-sm hover:bg-emerald-800 disabled:opacity-40"
              >
                Next step
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <label className="block text-sm">
              <span className="text-slate-600">Symptoms</span>
              <textarea
                value={symptoms}
                onChange={(e) => setSymptoms(e.target.value)}
                rows={2}
                className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">Diagnosis</span>
              <textarea
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
                rows={2}
                className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">Prescription</span>
              <textarea
                value={prescription}
                onChange={(e) => setPrescription(e.target.value)}
                rows={2}
                className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-600">Notes</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
            </label>
          </div>

          <button
            type="button"
            disabled={!patientId || saving}
            onClick={() => void persist({})}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save consultation"}
          </button>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900 mb-3">Recent consultations</h2>
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-600">None yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.slice(0, 12).map((c) => {
                const p = patients.find((x) => x.id === c.patientId);
                return (
                  <li key={c.id} className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <div className="font-medium text-slate-900">{p?.name ?? "Unknown"}</div>
                      <div className="text-xs text-slate-500">
                        {new Date(c.updatedAt).toLocaleString()} · {c.step}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditingId(c.id)}
                      className="text-sm text-emerald-700 font-medium hover:underline self-start sm:self-center"
                    >
                      Edit
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
