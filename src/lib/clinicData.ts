import { supabase } from "@/lib/supabase";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import type { ClinicConsultation, ClinicPatient, ClinicWorkflowStep } from "@/components/clinic/clinicTypes";

type PatientRow = {
  id: string;
  patient_number: string;
  name: string;
  gender: string | null;
  age: string | null;
  phone: string | null;
  address: string | null;
  created_at: string;
  updated_at: string;
};

type ConsultationRow = {
  id: string;
  patient_id: string;
  symptoms: string | null;
  diagnosis: string | null;
  prescription: string | null;
  notes: string | null;
  workflow_step: string;
  created_at: string;
  updated_at: string;
};

const STEPS_VALID = new Set<string>(["reception", "doctor", "pharmacy", "payment"]);

export function mapPatientRow(r: PatientRow): ClinicPatient {
  return {
    id: r.id,
    patientNumber: r.patient_number,
    name: r.name,
    gender: r.gender ?? "",
    age: r.age ?? "",
    phone: r.phone ?? "",
    address: r.address ?? "",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function mapConsultationRow(r: ConsultationRow): ClinicConsultation {
  const ws = r.workflow_step;
  const step = (STEPS_VALID.has(ws) ? ws : "reception") as ClinicWorkflowStep;
  return {
    id: r.id,
    patientId: r.patient_id,
    symptoms: r.symptoms ?? "",
    diagnosis: r.diagnosis ?? "",
    prescription: r.prescription ?? "",
    notes: r.notes ?? "",
    step,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function nextPatientNumberFromList(numbers: string[]): string {
  let max = 0;
  for (const raw of numbers) {
    const m = /^P-(\d+)$/i.exec(String(raw || "").trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  const n = max + 1;
  return `P-${String(n).padStart(5, "0")}`;
}

export async function fetchClinicPatients(
  orgId: string | undefined,
  superAdmin: boolean
): Promise<ClinicPatient[]> {
  let q = supabase.from("clinic_patients").select("*").order("name", { ascending: true });
  q = filterByOrganizationId(q, orgId, superAdmin);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data || []) as PatientRow[]).map(mapPatientRow);
}

export async function fetchClinicConsultations(
  orgId: string | undefined,
  superAdmin: boolean
): Promise<ClinicConsultation[]> {
  let q = supabase.from("clinic_consultations").select("*").order("updated_at", { ascending: false });
  q = filterByOrganizationId(q, orgId, superAdmin);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data || []) as ConsultationRow[]).map(mapConsultationRow);
}

export async function computeNextPatientNumber(
  orgId: string | undefined,
  superAdmin: boolean
): Promise<string> {
  let q = supabase.from("clinic_patients").select("patient_number");
  q = filterByOrganizationId(q, orgId, superAdmin);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const nums = ((data || []) as { patient_number: string }[]).map((r) => r.patient_number);
  return nextPatientNumberFromList(nums);
}

export async function insertClinicPatient(input: {
  orgId: string;
  patientNumber: string;
  name: string;
  gender: string;
  age: string;
  phone: string;
  address: string;
}): Promise<ClinicPatient> {
  const row = {
    organization_id: input.orgId,
    patient_number: input.patientNumber,
    name: input.name,
    gender: input.gender || null,
    age: input.age || null,
    phone: input.phone || null,
    address: input.address || null,
  };
  const { data, error } = await supabase.from("clinic_patients").insert(row).select("*").single();
  if (error) throw new Error(error.message);
  return mapPatientRow(data as PatientRow);
}

export async function insertClinicConsultation(input: {
  orgId: string;
  patientId: string;
  symptoms: string;
  diagnosis: string;
  prescription: string;
  notes: string;
  workflowStep: ClinicWorkflowStep;
}): Promise<ClinicConsultation> {
  const row = {
    organization_id: input.orgId,
    patient_id: input.patientId,
    symptoms: input.symptoms || null,
    diagnosis: input.diagnosis || null,
    prescription: input.prescription || null,
    notes: input.notes || null,
    workflow_step: input.workflowStep,
  };
  const { data, error } = await supabase.from("clinic_consultations").insert(row).select("*").single();
  if (error) throw new Error(error.message);
  return mapConsultationRow(data as ConsultationRow);
}

export async function updateClinicConsultation(
  id: string,
  patch: {
    patientId?: string;
    symptoms: string;
    diagnosis: string;
    prescription: string;
    notes: string;
    workflowStep: ClinicWorkflowStep;
  }
): Promise<void> {
  const body: Record<string, unknown> = {
    symptoms: patch.symptoms || null,
    diagnosis: patch.diagnosis || null,
    prescription: patch.prescription || null,
    notes: patch.notes || null,
    workflow_step: patch.workflowStep,
  };
  if (patch.patientId) body.patient_id = patch.patientId;
  const { error } = await supabase.from("clinic_consultations").update(body).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Bump patient row so “recent patients” reflects latest visit activity. */
export async function touchClinicPatientActivity(patientId: string): Promise<void> {
  try {
    const { data, error: selErr } = await supabase.from("clinic_patients").select("name").eq("id", patientId).maybeSingle();
    if (selErr || !data) return;
    const name = (data as { name: string }).name;
    const { error } = await supabase.from("clinic_patients").update({ name }).eq("id", patientId);
    if (error) console.warn("touchClinicPatientActivity:", error.message);
  } catch (e) {
    console.warn("touchClinicPatientActivity:", e);
  }
}
