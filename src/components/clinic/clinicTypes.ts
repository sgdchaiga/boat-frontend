export type ClinicWorkflowStep = "reception" | "doctor" | "pharmacy" | "payment";

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
