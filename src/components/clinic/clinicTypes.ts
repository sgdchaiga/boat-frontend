export type ClinicWorkflowStep = "reception" | "doctor" | "pharmacy" | "payment";

export type ClinicLabOrderStatus = "ordered" | "in_progress" | "completed" | "cancelled";

export type ClinicLabAbnormalFlag = "normal" | "high" | "low" | "critical";

export type ClinicLabOrderItem = {
  id: string;
  labOrderId: string;
  testName: string;
  sortOrder: number;
  resultValue: string;
  resultUnit: string;
  referenceRange: string;
  abnormalFlag: ClinicLabAbnormalFlag | "";
  resultedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ClinicLabOrder = {
  id: string;
  patientId: string;
  consultationId: string | null;
  orderNumber: string;
  status: ClinicLabOrderStatus;
  clinicalNotes: string;
  createdAt: string;
  updatedAt: string;
  items: ClinicLabOrderItem[];
};

export type ClinicPatient = {
  id: string;
  patientNumber: string;
  name: string;
  gender: string;
  age: string;
  phone: string;
  address: string;
  createdAt: string;
  updatedAt: string;
};

export type ClinicConsultation = {
  id: string;
  patientId: string;
  symptoms: string;
  diagnosis: string;
  prescription: string;
  notes: string;
  step: ClinicWorkflowStep;
  createdAt: string;
  updatedAt: string;
};
