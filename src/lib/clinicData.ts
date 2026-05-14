import { supabase } from "@/lib/supabase";
import { filterByOrganizationId } from "@/lib/supabaseOrgFilter";
import type {
  ClinicConsultation,
  ClinicLabAbnormalFlag,
  ClinicLabOrder,
  ClinicLabOrderItem,
  ClinicLabOrderStatus,
  ClinicPatient,
  ClinicWorkflowStep,
} from "@/components/clinic/clinicTypes";

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

const LAB_STATUS_VALID = new Set<string>(["ordered", "in_progress", "completed", "cancelled"]);

const LAB_FLAG_VALID = new Set<string>(["", "normal", "high", "low", "critical"]);

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

type LabOrderRow = {
  id: string;
  patient_id: string;
  consultation_id: string | null;
  order_number: string;
  status: string;
  clinical_notes: string | null;
  created_at: string;
  updated_at: string;
  clinic_lab_order_items?: LabItemRow[] | null;
};

type LabItemRow = {
  id: string;
  lab_order_id: string;
  test_name: string;
  sort_order: number;
  result_value: string | null;
  result_unit: string | null;
  reference_range: string | null;
  abnormal_flag: string | null;
  resulted_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapLabItemRow(r: LabItemRow): ClinicLabOrderItem {
  const flag = r.abnormal_flag ?? "";
  const safeFlag = LAB_FLAG_VALID.has(flag) ? (flag as ClinicLabAbnormalFlag | "") : "";
  return {
    id: r.id,
    labOrderId: r.lab_order_id,
    testName: r.test_name,
    sortOrder: Number(r.sort_order ?? 0),
    resultValue: r.result_value ?? "",
    resultUnit: r.result_unit ?? "",
    referenceRange: r.reference_range ?? "",
    abnormalFlag: safeFlag === "" ? "" : (safeFlag as ClinicLabAbnormalFlag),
    resultedAt: r.resulted_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapLabOrderRow(r: LabOrderRow): ClinicLabOrder {
  const st = r.status;
  const status = (LAB_STATUS_VALID.has(st) ? st : "ordered") as ClinicLabOrderStatus;
  const items = (r.clinic_lab_order_items ?? [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map(mapLabItemRow);
  return {
    id: r.id,
    patientId: r.patient_id,
    consultationId: r.consultation_id,
    orderNumber: r.order_number,
    status,
    clinicalNotes: r.clinical_notes ?? "",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    items,
  };
}

export function nextLabOrderNumberFromList(numbers: string[]): string {
  let max = 0;
  for (const raw of numbers) {
    const m = /^LO-(\d+)$/i.exec(String(raw || "").trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  const n = max + 1;
  return `LO-${String(n).padStart(5, "0")}`;
}

export async function computeNextLabOrderNumber(
  orgId: string | undefined,
  superAdmin: boolean
): Promise<string> {
  let q = supabase.from("clinic_lab_orders").select("order_number");
  q = filterByOrganizationId(q, orgId, superAdmin);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const nums = ((data || []) as { order_number: string }[]).map((r) => r.order_number);
  return nextLabOrderNumberFromList(nums);
}

export async function fetchClinicLabOrders(
  orgId: string | undefined,
  superAdmin: boolean
): Promise<ClinicLabOrder[]> {
  let q = supabase
    .from("clinic_lab_orders")
    .select("*, clinic_lab_order_items(*)")
    .order("updated_at", { ascending: false });
  q = filterByOrganizationId(q, orgId, superAdmin);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data || []) as LabOrderRow[]).map(mapLabOrderRow);
}

export async function insertClinicLabOrder(input: {
  orgId: string;
  patientId: string;
  consultationId: string | null;
  orderNumber: string;
  clinicalNotes: string;
  testNames: string[];
  initialStatus?: ClinicLabOrderStatus;
}): Promise<ClinicLabOrder> {
  const names = input.testNames.map((t) => t.trim()).filter(Boolean);
  if (names.length === 0) throw new Error("Add at least one test.");

  const orderRow = {
    organization_id: input.orgId,
    patient_id: input.patientId,
    consultation_id: input.consultationId || null,
    order_number: input.orderNumber,
    status: input.initialStatus ?? "ordered",
    clinical_notes: input.clinicalNotes.trim() || null,
  };
  const { data: ord, error: oErr } = await supabase.from("clinic_lab_orders").insert(orderRow).select("*").single();
  if (oErr) throw new Error(oErr.message);
  const orderId = (ord as LabOrderRow).id;

  const itemRows = names.map((test_name, i) => ({
    lab_order_id: orderId,
    test_name,
    sort_order: i,
  }));
  const { error: iErr } = await supabase.from("clinic_lab_order_items").insert(itemRows);
  if (iErr) {
    await supabase.from("clinic_lab_orders").delete().eq("id", orderId);
    throw new Error(iErr.message);
  }

  const { data: full, error: fErr } = await supabase
    .from("clinic_lab_orders")
    .select("*, clinic_lab_order_items(*)")
    .eq("id", orderId)
    .single();
  if (fErr || !full) throw new Error(fErr?.message || "Failed to load new lab order.");
  await touchClinicPatientActivity(input.patientId);
  return mapLabOrderRow(full as LabOrderRow);
}

export async function updateClinicLabOrderStatus(orderId: string, status: ClinicLabOrderStatus): Promise<void> {
  const { error } = await supabase.from("clinic_lab_orders").update({ status }).eq("id", orderId);
  if (error) throw new Error(error.message);
}

export async function updateClinicLabOrderItem(input: {
  itemId: string;
  resultValue: string;
  resultUnit: string;
  referenceRange: string;
  abnormalFlag: ClinicLabAbnormalFlag | "";
}): Promise<void> {
  const body: Record<string, unknown> = {
    result_value: input.resultValue.trim() || null,
    result_unit: input.resultUnit.trim() || null,
    reference_range: input.referenceRange.trim() || null,
    abnormal_flag: input.abnormalFlag === "" ? null : input.abnormalFlag,
  };
  const { error } = await supabase.from("clinic_lab_order_items").update(body).eq("id", input.itemId);
  if (error) throw new Error(error.message);
}
