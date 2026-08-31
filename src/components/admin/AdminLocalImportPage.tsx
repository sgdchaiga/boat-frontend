import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { desktopApi } from "@/lib/desktopApi";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { createJournalForExpenseWithLines, createJournalForVendorPayment } from "@/lib/journal";
import { isSpendMoneyApprovalEnabled, queueExpenseForTreasury } from "@/lib/treasuryWorkflow";
import { getTotalPaidForBill, syncBillStatusInDb } from "@/lib/billStatus";
import { nextSchoolAdmissionNumber } from "@/lib/schoolAdmissionNumber";
import { toSchoolTitleCase } from "@/lib/schoolTextCase";
import { fetchAllPages } from "@/lib/supabasePagination";

type ImportEntity =
  | "products"
  | "retail-customers"
  | "hotel-customers"
  | "vendors"
  | "chart-of-accounts"
  | "school-students"
  | "school-parents"
  | "school-classes"
  | "school-streams"
  | "school-subjects"
  | "school-teachers"
  | "school-fee-structures"
  | "school-expenses"
  | "school-other-income"
  | "school-purchases"
  | "school-payments";

type ParsedRow = Record<string, unknown>;
type BulkMode = "import" | "update";
type UpdateEntity = "school-students" | "vendors";
type UpdatePreviewRow = {
  rowNumber: number;
  recordId: string;
  matchLabel: string;
  changes: Record<string, unknown>;
  changeLabels: string[];
};

const STUDENT_UPDATE_FIELDS = ["first_name", "other_names", "last_name", "gender", "class_name", "stream", "day_boarding", "status", "date_of_birth", "school_pay_number", "learner_id", "notes"] as const;
const VENDOR_UPDATE_FIELDS = ["name", "contact_name", "email", "phone", "address", "tax_number", "notes", "is_active"] as const;
const CLEAR_VALUE = "[CLEAR]";

const ENTITY_OPTIONS: Array<{ id: ImportEntity; label: string; required: string[] }> = [
  { id: "products", label: "Products", required: ["name"] },
  { id: "retail-customers", label: "Retail Customers", required: ["name"] },
  { id: "hotel-customers", label: "Hotel Customers", required: ["first_name", "last_name"] },
  { id: "vendors", label: "Vendors", required: ["name"] },
  { id: "chart-of-accounts", label: "Chart of Accounts", required: ["name"] },
  { id: "school-students", label: "School - Students", required: ["first_name", "last_name", "class_name"] },
  { id: "school-parents", label: "School - Parents & Guardians", required: ["full_name"] },
  { id: "school-classes", label: "School - Classes", required: ["name"] },
  { id: "school-streams", label: "School - Streams", required: ["name"] },
  { id: "school-subjects", label: "School - Subjects", required: ["name"] },
  { id: "school-teachers", label: "School - Teachers", required: ["full_name"] },
  { id: "school-fee-structures", label: "School - Fee Structures", required: ["class_name", "academic_year", "term_name", "tuition"] },
  { id: "school-expenses", label: "School - Expenses", required: ["expense_date", "amount", "description", "expense_account_code", "cash_account_code"] },
  { id: "school-other-income", label: "School - Other Income", required: ["revenue_type", "amount"] },
  { id: "school-purchases", label: "School - Purchases / Supplier Bills", required: ["vendor_name", "bill_date", "amount", "description"] },
  { id: "school-payments", label: "School - Supplier Payments", required: ["bill_id", "amount", "payment_date", "payment_method"] },
];

const ENTITY_TEMPLATES: Record<ImportEntity, Record<string, string>[]> = {
  products: [
    { id: "", name: "Coca Cola 300ml", sku: "COKE300", selling_price: "120", qty_on_hand: "250", is_active: "1" },
  ],
  "retail-customers": [
    {
      id: "",
      name: "John Doe",
      email: "john@example.com",
      phone: "+254700000001",
      address: "Nairobi",
      notes: "Walk-in regular customer",
    },
  ],
  "hotel-customers": [
    {
      id: "",
      first_name: "Jane",
      last_name: "Doe",
      email: "jane@example.com",
      phone: "+254711000001",
      id_type: "Passport",
      id_number: "A1234567",
      address: "Nairobi",
    },
  ],
  vendors: [
    {
      id: "",
      name: "Fresh Farm Distributors",
      contact_name: "Peter Maina",
      email: "orders@freshfarm.test",
      phone: "+254722000001",
      address: "Nairobi",
      tax_number: "TAX-001",
      notes: "Weekly produce supplier",
      is_active: "1",
    },
  ],
  "chart-of-accounts": [
    { id: "", code: "1000", name: "Cash on Hand", type: "Asset", parent_code: "", is_active: "1" },
  ],
  "school-students": [{ id: "", admission_number: "", first_name: "Amina", other_names: "Zawedde", last_name: "Nabirye", gender: "Female", class_name: "Senior 1", stream: "East", day_boarding: "Day", status: "active", date_of_birth: "2012-03-15", school_pay_number: "", learner_id: "", parent_name: "Sarah Nabirye", parent_phone: "+256700000001", relationship: "Mother", notes: "Admission number is generated automatically. Use Female, Male, or Other for gender. SchoolPay and learner IDs must be unique when provided." }],
  "school-parents": [{ id: "", full_name: "Sarah Nabirye", phone: "+256700000001", phone_alt: "", email: "", address: "Kampala", student_admission_number: "S0001", relationship: "Mother", is_primary: "1", notes: "Primary guardian" }],
  "school-classes": [{ id: "", name: "Senior 1", code: "S1", sort_order: "1", is_active: "1" }],
  "school-streams": [{ id: "", name: "East", code: "E", sort_order: "1", is_active: "1" }],
  "school-subjects": [{ id: "", name: "Mathematics", code: "MATH", sort_order: "1", is_active: "1" }],
  "school-teachers": [{ id: "", full_name: "Grace Namusoke", employee_number: "T001", phone: "+256700000002", email: "", notes: "Mathematics", is_active: "1" }],
  "school-fee-structures": [{ id: "", class_name: "Senior 1", stream: "", academic_year: "2026", term_name: "Term 2", currency: "UGX", tuition: "450000", boarding: "300000", meals: "150000", transport: "0", other: "0", is_active: "1" }],
  "school-expenses": [{ expense_date: "2026-08-27", amount: "150000", description: "Examination stationery", vendor_name: "Kampala Stationers", expense_account_code: "6100", cash_account_code: "1000", notes: "Term 2 exams" }],
  "school-other-income": [{ revenue_type: "Hall hire", payer_name: "Community Association", amount: "300000", method: "bank", reference: "DEP-1001", received_at: "2026-08-27", notes: "Weekend hall hire" }],
  "school-purchases": [{ vendor_name: "Kampala Stationers", bill_date: "2026-08-27", due_date: "2026-09-27", amount: "800000", description: "Exercise books", reference: "INV-4102" }],
  "school-payments": [{ bill_id: "paste-approved-bill-uuid-here", amount: "400000", payment_date: "2026-08-27", payment_method: "bank", reference: "PAY-4102" }],
};

function normalizeRow(row: Record<string, unknown>): ParsedRow {
  const out: ParsedRow = {};
  for (const [key, value] of Object.entries(row)) {
    const normalized = key.trim().toLowerCase().replace(/\s+/g, "_");
    out[normalized] = typeof value === "string" ? value.trim() : value;
  }
  return out;
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function asNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function asBool(value: unknown, fallback = true): boolean {
  const raw = asText(value).toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "y"].includes(raw)) return true;
  if (["0", "false", "no", "n"].includes(raw)) return false;
  return fallback;
}

function asBoarding(row: ParsedRow): boolean {
  const dayBoarding = asText(row.day_boarding || row.boarding_status).toLowerCase();
  if (["boarding", "boarder"].includes(dayBoarding)) return true;
  if (["day", "day scholar", "day_student", "day student"].includes(dayBoarding)) return false;
  return asBool(row.is_boarding, false);
}

function asGender(value: unknown): "Female" | "Male" | "Other" | null {
  const gender = asText(value).toLowerCase();
  if (["f", "female", "girl"].includes(gender)) return "Female";
  if (["m", "male", "boy"].includes(gender)) return "Male";
  if (["o", "other", "non-binary", "nonbinary"].includes(gender)) return "Other";
  return null;
}

function asStudentStatus(value: unknown): "active" | "left" | "graduated" | "suspended" {
  const status = asText(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (!status || ["active", "current", "enrolled", "continuing"].includes(status)) return "active";
  if (["left", "left_school", "withdrawn", "transferred"].includes(status)) return "left";
  if (["graduated", "graduate", "completed"].includes(status)) return "graduated";
  if (["suspended", "suspend"].includes(status)) return "suspended";
  return "active";
}

function generateId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function AdminLocalImportPage() {
  const { user } = useAuth();
  const [entity, setEntity] = useState<ImportEntity>("products");
  const [mode, setMode] = useState<BulkMode>("import");
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [updatePreview, setUpdatePreview] = useState<UpdatePreviewRow[]>([]);

  const selected = useMemo(
    () => ENTITY_OPTIONS.find((opt) => opt.id === entity) ?? ENTITY_OPTIONS[0],
    [entity]
  );

  const availableEntityOptions = useMemo(() => {
    const isSchool = String(user?.business_type || "").toLowerCase() === "school";
    if (!isSchool) return ENTITY_OPTIONS.filter((option) => !option.id.startsWith("school-"));
    return ENTITY_OPTIONS.filter((option) => !["retail-customers", "hotel-customers"].includes(option.id));
  }, [user?.business_type]);

  const parseSelectedFile = async (): Promise<ParsedRow[]> => {
    if (!file) return [];
    const arrayBuffer = await file.arrayBuffer();
    const wb = XLSX.read(arrayBuffer, { type: "array" });
    const first = wb.SheetNames[0];
    if (!first) return [];
    const ws = wb.Sheets[first];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
    return rows.map(normalizeRow);
  };

  const importProducts = async (rows: ParsedRow[]) => {
    const localOrgId =
      user?.organization_id ||
      (import.meta.env.VITE_LOCAL_ORGANIZATION_ID || "").trim() ||
      "00000000-0000-0000-0000-000000000001";
    let imported = 0;
    const productRows: Record<string, unknown>[] = [];
    for (const row of rows) {
      const name = asText(row.name);
      if (!name) continue;
      const id = asText(row.id) || generateId("prd");
      const salesPrice = asNumber(row.sales_price, asNumber(row.selling_price, 0));
      const costPrice = asNumber(row.cost_price, 0);
      const active = asBool(row.is_active, true);
      const trackInventory = asBool(row.track_inventory, true);
      await desktopApi.upsertPosProduct({
        id,
        name,
        sku: asText(row.sku) || null,
        selling_price: asNumber(row.selling_price, salesPrice),
        qty_on_hand: asNumber(row.qty_on_hand, 0),
        is_active: active,
      });
      productRows.push({
        id,
        name,
        sales_price: salesPrice,
        cost_price: costPrice,
        barcode: asText(row.barcode) || null,
        active,
        track_inventory: trackInventory,
        organization_id: asText(row.organization_id) || localOrgId,
      });
      imported += 1;
    }
    if (productRows.length > 0) {
      await desktopApi.localUpsert({ table: "products", rows: productRows });
    }
    return imported;
  };

  const importRetailCustomers = async (rows: ParsedRow[]) => {
    let imported = 0;
    for (const row of rows) {
      const name = asText(row.name);
      if (!name) continue;
      await desktopApi.createRetailCustomer({
        id: asText(row.id) || undefined,
        name,
        email: asText(row.email) || null,
        phone: asText(row.phone) || null,
        address: asText(row.address) || null,
        notes: asText(row.notes) || null,
      });
      imported += 1;
    }
    return imported;
  };

  const importHotelCustomers = async (rows: ParsedRow[]) => {
    let imported = 0;
    for (const row of rows) {
      const firstName = asText(row.first_name);
      const lastName = asText(row.last_name);
      if (!firstName || !lastName) continue;
      await desktopApi.createCustomer({
        id: asText(row.id) || undefined,
        first_name: firstName,
        last_name: lastName,
        email: asText(row.email) || null,
        phone: asText(row.phone) || null,
        id_type: asText(row.id_type) || null,
        id_number: asText(row.id_number) || null,
        address: asText(row.address) || null,
      });
      imported += 1;
    }
    return imported;
  };

  const importVendors = async (rows: ParsedRow[]) => {
    const organizationId = user?.organization_id || (import.meta.env.VITE_LOCAL_ORGANIZATION_ID || "").trim() || "00000000-0000-0000-0000-000000000001";
    const existing = await desktopApi.localSelect({ table: "vendors", filters: [{ column: "organization_id", operator: "eq", value: organizationId }] });
    const existingIds = new Set(existing.rows.map((row) => asText(row.id)).filter(Boolean));
    const seenIds = new Set<string>();
    const mapped = rows
      .filter((row) => asText(row.name))
      .map((row) => {
        const requestedId = asText(row.id);
        if (requestedId && existingIds.has(requestedId)) throw new Error(`Vendor ID ${requestedId} already exists. Vendor imports are insert-only; use Update Existing Records instead.`);
        if (requestedId && seenIds.has(requestedId)) throw new Error(`Vendor ID ${requestedId} is repeated in this import file.`);
        const id = requestedId || generateId("vnd");
        seenIds.add(id);
        return {
          id,
          organization_id: organizationId,
          name: asText(row.name),
          contact_name: asText(row.contact_name),
          email: asText(row.email),
          phone: asText(row.phone),
          address: asText(row.address),
          tax_number: asText(row.tax_number),
          notes: asText(row.notes),
          is_active: asBool(row.is_active, true),
        };
      });
    if (mapped.length === 0) return 0;
    await desktopApi.localUpsert({ table: "vendors", rows: mapped });
    return mapped.length;
  };

  const importChartOfAccounts = async (rows: ParsedRow[]) => {
    const localOrgId = user?.organization_id || (import.meta.env.VITE_LOCAL_ORGANIZATION_ID || "").trim() || "00000000-0000-0000-0000-000000000001";
    const mapped = rows
      .filter((row) => asText(row.name) || asText(row.account_name))
      .map((row) => ({
        id: asText(row.id) || generateId("gl"),
        organization_id: asText(row.organization_id) || localOrgId,
        account_code: asText(row.account_code) || asText(row.code),
        account_name: asText(row.account_name) || asText(row.name),
        account_type: (asText(row.account_type) || asText(row.type) || "income").toLowerCase(),
        category: asText(row.category) || null,
        parent_id: asText(row.parent_id) || null,
        parent_code: asText(row.parent_code),
        is_active: asBool(row.is_active, true),
        business_type: user?.business_type || null,
      }));
    if (mapped.length === 0) return 0;
    await desktopApi.localUpsert({ table: "gl_accounts", rows: mapped });
    return mapped.length;
  };

  const importSchoolRows = async (rows: ParsedRow[], type: ImportEntity) => {
    const organizationId = user?.organization_id || (import.meta.env.VITE_LOCAL_ORGANIZATION_ID || "").trim();
    if (!organizationId) throw new Error("Your school user is not linked to an organization.");
    const tableByType: Partial<Record<ImportEntity, string>> = {
      "school-students": "students", "school-parents": "parents", "school-classes": "classes",
      "school-streams": "streams", "school-subjects": "subjects", "school-teachers": "teachers",
      "school-fee-structures": "fee_structures",
    };
    const table = tableByType[type];
    if (!table) return 0;
    const existingStudentRows = type === "school-students"
      ? (await desktopApi.localSelect({
          table: "students",
          filters: [{ column: "organization_id", operator: "eq", value: organizationId }],
        })).rows
      : [];
    const existingAdmissionNumbers = existingStudentRows.map((row) => asText(row.admission_number));
    const existingStudentIds = new Set(existingStudentRows.map((row) => asText(row.id)).filter(Boolean));
    const existingSchoolPayNumbers = new Set(existingStudentRows.map((row) => asText(row.school_pay_number).toLowerCase()).filter(Boolean));
    const existingLearnerIds = new Set(existingStudentRows.map((row) => asText(row.learner_id).toLowerCase()).filter(Boolean));
    const mapped = rows.flatMap<Record<string, unknown>>((row, index) => {
      const base = { id: asText(row.id) || generateId(type.replace("school-", "sch")), organization_id: organizationId };
      if (type === "school-students") {
        if (!asText(row.first_name) || !asText(row.last_name) || !asText(row.class_name)) return [];
        const requestedAdmissionNumber = asText(row.admission_number);
        if (requestedAdmissionNumber && existingAdmissionNumbers.some((value) => value.toLowerCase() === requestedAdmissionNumber.toLowerCase())) {
          throw new Error(`Admission number ${requestedAdmissionNumber} already exists. Student imports are insert-only and cannot overwrite existing records.`);
        }
        if (asText(row.id) && existingStudentIds.has(asText(row.id))) {
          throw new Error(`Student ID ${asText(row.id)} already exists. Student imports are insert-only and cannot overwrite existing records.`);
        }
        const schoolPayNumber = asText(row.school_pay_number);
        const learnerId = asText(row.learner_id);
        if (schoolPayNumber && existingSchoolPayNumbers.has(schoolPayNumber.toLowerCase())) {
          throw new Error(`SchoolPay number ${schoolPayNumber} already exists. Student imports are insert-only and cannot overwrite existing records.`);
        }
        if (learnerId && existingLearnerIds.has(learnerId.toLowerCase())) {
          throw new Error(`Learner ID ${learnerId} already exists. Student imports are insert-only and cannot overwrite existing records.`);
        }
        const admissionNumber = requestedAdmissionNumber || nextSchoolAdmissionNumber(existingAdmissionNumbers);
        existingAdmissionNumbers.push(admissionNumber);
        existingStudentIds.add(String(base.id));
        if (schoolPayNumber) existingSchoolPayNumbers.add(schoolPayNumber.toLowerCase());
        if (learnerId) existingLearnerIds.add(learnerId.toLowerCase());
        return [{ ...base, admission_number: admissionNumber, first_name: toSchoolTitleCase(row.first_name), other_names: toSchoolTitleCase(row.other_names) || null, last_name: toSchoolTitleCase(row.last_name), gender: asGender(row.gender), class_name: toSchoolTitleCase(row.class_name), stream: toSchoolTitleCase(row.stream) || null, is_boarding: asBoarding(row), status: asStudentStatus(row.status), date_of_birth: asText(row.date_of_birth) || null, school_pay_number: schoolPayNumber || null, learner_id: learnerId || null, notes: asText(row.notes) || null }];
      }
      if (type === "school-parents") {
        if (!asText(row.full_name)) return [];
        return [{ ...base, full_name: asText(row.full_name), phone: asText(row.phone) || null, phone_alt: asText(row.phone_alt) || null, email: asText(row.email) || null, address: asText(row.address) || null, notes: asText(row.notes) || null }];
      }
      if (["school-classes", "school-streams", "school-subjects"].includes(type)) {
        if (!asText(row.name)) return [];
        return [{ ...base, name: asText(row.name), code: asText(row.code) || null, sort_order: asNumber(row.sort_order, index + 1), is_active: asBool(row.is_active, true) }];
      }
      if (type === "school-teachers") {
        if (!asText(row.full_name)) return [];
        return [{ ...base, full_name: asText(row.full_name), employee_number: asText(row.employee_number) || null, phone: asText(row.phone) || null, email: asText(row.email) || null, notes: asText(row.notes) || null, is_active: asBool(row.is_active, true) }];
      }
      if (!asText(row.class_name) || !asText(row.academic_year) || !asText(row.term_name)) return [];
      const feeLines = ([
        ["TUITION", "Tuition", row.tuition], ["BOARDING", "Boarding", row.boarding],
        ["MEALS", "Meals", row.meals], ["TRANSPORT", "Transport", row.transport],
        ["OTHER", "Other", row.other],
      ] as Array<[string, string, unknown]>)
        .map(([code, label, value], priority) => ({ code, label, amount: asNumber(value, 0), priority: priority + 1 }))
        .filter((line) => line.amount > 0);
      if (!feeLines.length) return [];
      return [{ ...base, class_name: asText(row.class_name), stream: asText(row.stream) || null, academic_year: asText(row.academic_year), term_name: asText(row.term_name), currency: asText(row.currency) || "UGX", line_items: feeLines, is_active: asBool(row.is_active, true) }];
    });
    if (!mapped.length) return 0;
    await desktopApi.localUpsert({ table, rows: mapped });
    return mapped.length;
  };

  const requireOrganizationId = () => {
    if (!user?.organization_id) throw new Error("Your account is not linked to an organization.");
    return user.organization_id;
  };

  const findOrCreateVendor = async (organizationId: string, name: string) => {
    const existing = await supabase.from("vendors").select("id").eq("organization_id", organizationId).ilike("name", name).limit(1).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data?.id) return existing.data.id as string;
    const created = await supabase.from("vendors").insert({ organization_id: organizationId, name, is_active: true }).select("id").single();
    if (created.error) throw created.error;
    return created.data.id as string;
  };

  const importCloudStudents = async (rows: ParsedRow[]) => {
    const organizationId = requireOrganizationId();
    let imported = 0;
    const seenAdmissions = new Set<string>();
    const seenSchoolPayNumbers = new Set<string>();
    const seenLearnerIds = new Set<string>();
    const seenIds = new Set<string>();
    const existingStudents = await fetchAllPages<{ id: string; admission_number: string; school_pay_number: string | null; learner_id: string | null }>((from, to) => supabase.from("students")
      .select("id,admission_number,school_pay_number,learner_id")
      .eq("organization_id", organizationId).order("id").range(from, to));
    const existingAdmissions = new Set(existingStudents.map((student) => student.admission_number.toLowerCase()));
    const existingSchoolPay = new Set(existingStudents.map((student) => student.school_pay_number?.toLowerCase()).filter((value): value is string => !!value));
    const existingLearners = new Set(existingStudents.map((student) => student.learner_id?.toLowerCase()).filter((value): value is string => !!value));
    const existingIds = new Set(existingStudents.map((student) => student.id));

    for (const [rowIndex, row] of rows.entries()) {
      const admission = asText(row.admission_number);
      const schoolPay = asText(row.school_pay_number);
      const learner = asText(row.learner_id);
      const id = asText(row.id);
      if (admission && existingAdmissions.has(admission.toLowerCase())) throw new Error(`Row ${rowIndex + 2}: admission number ${admission} already exists. Student imports are insert-only and cannot overwrite existing records.`);
      if (schoolPay && existingSchoolPay.has(schoolPay.toLowerCase())) throw new Error(`Row ${rowIndex + 2}: SchoolPay number ${schoolPay} already exists. Student imports are insert-only and cannot overwrite existing records.`);
      if (learner && existingLearners.has(learner.toLowerCase())) throw new Error(`Row ${rowIndex + 2}: learner ID ${learner} already exists. Student imports are insert-only and cannot overwrite existing records.`);
      if (id && existingIds.has(id)) throw new Error(`Row ${rowIndex + 2}: student ID ${id} already exists. Student imports are insert-only and cannot overwrite existing records.`);
      if (admission && seenAdmissions.has(admission.toLowerCase())) throw new Error(`Row ${rowIndex + 2}: admission number ${admission} is repeated in this file.`);
      if (schoolPay && seenSchoolPayNumbers.has(schoolPay.toLowerCase())) throw new Error(`Row ${rowIndex + 2}: SchoolPay number ${schoolPay} is repeated in this file.`);
      if (learner && seenLearnerIds.has(learner.toLowerCase())) throw new Error(`Row ${rowIndex + 2}: learner ID ${learner} is repeated in this file.`);
      if (id && seenIds.has(id)) throw new Error(`Row ${rowIndex + 2}: student ID ${id} is repeated in this file.`);
      if (admission) seenAdmissions.add(admission.toLowerCase());
      if (schoolPay) seenSchoolPayNumbers.add(schoolPay.toLowerCase());
      if (learner) seenLearnerIds.add(learner.toLowerCase());
      if (id) seenIds.add(id);
    }
    for (const [rowIndex, row] of rows.entries()) {
      const admissionNumber = asText(row.admission_number);
      const firstName = toSchoolTitleCase(row.first_name);
      const lastName = toSchoolTitleCase(row.last_name);
      const className = toSchoolTitleCase(row.class_name);
      if (!firstName || !lastName || !className) continue;
      const schoolPayNumber = asText(row.school_pay_number);
      const learnerId = asText(row.learner_id);
      const studentPayload = {
        organization_id: organizationId, first_name: firstName,
        other_names: toSchoolTitleCase(row.other_names) || null, last_name: lastName,
        class_name: className, stream: toSchoolTitleCase(row.stream) || null, gender: asGender(row.gender), is_boarding: asBoarding(row),
        status: asStudentStatus(row.status),
        date_of_birth: asText(row.date_of_birth) || null, school_pay_number: schoolPayNumber || null,
        learner_id: learnerId || null, notes: asText(row.notes) || null,
      };
      const student = await supabase.from("students")
        .insert(admissionNumber ? { ...studentPayload, admission_number: admissionNumber } : studentPayload)
        .select("id,admission_number").single();
      if (student.error) throw new Error(`${admissionNumber || "Automatic admission number"}: ${student.error.message}`);
      const parentName = toSchoolTitleCase(row.parent_name);
      if (parentName) {
        const phone = asText(row.parent_phone);
        let parentQuery = supabase.from("parents").select("id").eq("organization_id", organizationId);
        parentQuery = phone ? parentQuery.eq("phone", phone) : parentQuery.ilike("full_name", parentName);
        const existing = await parentQuery.limit(1).maybeSingle();
        if (existing.error) throw existing.error;
        let parentId = existing.data?.id as string | undefined;
        if (!parentId) {
          const created = await supabase.from("parents").insert({ organization_id: organizationId, full_name: parentName, phone: phone || null }).select("id").single();
          if (created.error) throw created.error;
          parentId = created.data.id as string;
        }
        const link = await supabase.from("student_parents").upsert({ organization_id: organizationId, student_id: student.data.id, parent_id: parentId, relationship: asText(row.relationship) || null, is_primary: true }, { onConflict: "student_id,parent_id" });
        if (link.error) throw link.error;
      }
      imported += 1;
    }
    return imported;
  };

  const importCloudParents = async (rows: ParsedRow[]) => {
    const organizationId = requireOrganizationId();
    let imported = 0;
    for (const row of rows) {
      const fullName = asText(row.full_name);
      if (!fullName) continue;
      const phone = asText(row.phone);
      let query = supabase.from("parents").select("id").eq("organization_id", organizationId);
      query = phone ? query.eq("phone", phone) : query.ilike("full_name", fullName);
      const existing = await query.limit(1).maybeSingle();
      if (existing.error) throw existing.error;
      const payload = { full_name: fullName, phone: phone || null, phone_alt: asText(row.phone_alt) || null, email: asText(row.email) || null, address: asText(row.address) || null, notes: asText(row.notes) || null };
      let parentId = existing.data?.id as string | undefined;
      if (parentId) {
        const updated = await supabase.from("parents").update(payload).eq("id", parentId).eq("organization_id", organizationId);
        if (updated.error) throw updated.error;
      } else {
        const created = await supabase.from("parents").insert({ organization_id: organizationId, ...payload }).select("id").single();
        if (created.error) throw created.error;
        parentId = created.data.id as string;
      }
      const admission = asText(row.student_admission_number);
      if (admission) {
        const student = await supabase.from("students").select("id").eq("organization_id", organizationId).eq("admission_number", admission).maybeSingle();
        if (student.error) throw student.error;
        if (!student.data) throw new Error(`${fullName}: student ${admission} was not found.`);
        const link = await supabase.from("student_parents").upsert({ organization_id: organizationId, student_id: student.data.id, parent_id: parentId, relationship: asText(row.relationship) || null, is_primary: asBool(row.is_primary, false) }, { onConflict: "student_id,parent_id" });
        if (link.error) throw link.error;
      }
      imported += 1;
    }
    return imported;
  };

  const importCloudSchoolReference = async (rows: ParsedRow[], type: ImportEntity) => {
    const organizationId = requireOrganizationId();
    const tableByType: Partial<Record<ImportEntity, string>> = { "school-classes": "classes", "school-streams": "streams", "school-subjects": "subjects", "school-teachers": "teachers" };
    const table = tableByType[type];
    if (!table) return 0;
    let imported = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const nameField = type === "school-teachers" ? "full_name" : "name";
      const name = asText(row[nameField]);
      if (!name) continue;
      const payload = type === "school-teachers"
        ? { full_name: name, employee_number: asText(row.employee_number) || null, phone: asText(row.phone) || null, email: asText(row.email) || null, notes: asText(row.notes) || null, is_active: asBool(row.is_active, true) }
        : { name, code: asText(row.code) || null, sort_order: asNumber(row.sort_order, index + 1), is_active: asBool(row.is_active, true) };
      const existing = await supabase.from(table).select("id").eq("organization_id", organizationId).ilike(nameField, name).limit(1).maybeSingle();
      if (existing.error) throw existing.error;
      const saved = existing.data?.id
        ? await supabase.from(table).update(payload).eq("id", existing.data.id).eq("organization_id", organizationId)
        : await supabase.from(table).insert({ organization_id: organizationId, ...payload });
      if (saved.error) throw saved.error;
      imported += 1;
    }
    return imported;
  };

  const importCloudFeeStructures = async (rows: ParsedRow[]) => {
    const organizationId = requireOrganizationId();
    const mapped = rows.flatMap((row) => {
      if (!asText(row.class_name) || !asText(row.academic_year) || !asText(row.term_name)) return [];
      const lineItems = ([
        ["TUITION", "Tuition", row.tuition], ["BOARDING", "Boarding", row.boarding], ["MEALS", "Meals", row.meals],
        ["TRANSPORT", "Transport", row.transport], ["OTHER", "Other", row.other],
      ] as Array<[string, string, unknown]>).map(([code, label, value], priority) => ({ code, label, amount: asNumber(value), priority: priority + 1 })).filter((line) => line.amount > 0);
      if (!lineItems.length) return [];
      return [{ organization_id: organizationId, class_name: asText(row.class_name), stream: asText(row.stream) || null, academic_year: asText(row.academic_year), term_name: asText(row.term_name), currency: asText(row.currency) || "UGX", line_items: lineItems, is_active: asBool(row.is_active, true) }];
    });
    if (!mapped.length) return 0;
    const result = await supabase.from("fee_structures").insert(mapped);
    if (result.error) throw result.error;
    return mapped.length;
  };

  const importCloudOtherIncome = async (rows: ParsedRow[]) => {
    const organizationId = requireOrganizationId();
    const mapped = rows.filter((row) => asText(row.revenue_type) && asNumber(row.amount) > 0).map((row) => ({
      organization_id: organizationId, revenue_type: asText(row.revenue_type), payer_name: asText(row.payer_name) || null,
      amount: asNumber(row.amount), method: asText(row.method) || "other", reference: asText(row.reference) || null,
      received_at: asText(row.received_at) || new Date().toISOString().slice(0, 10), notes: asText(row.notes) || null, created_by: user?.id || null,
    }));
    if (!mapped.length) return 0;
    const result = await supabase.from("school_other_revenue").insert(mapped);
    if (result.error) throw result.error;
    return mapped.length;
  };

  const importCloudPurchases = async (rows: ParsedRow[]) => {
    const organizationId = requireOrganizationId();
    let imported = 0;
    for (const row of rows) {
      const vendorName = asText(row.vendor_name);
      const billDate = asText(row.bill_date);
      const description = asText(row.description);
      const amount = asNumber(row.amount);
      if (!vendorName || !billDate || !description || amount <= 0) continue;
      const vendorId = await findOrCreateVendor(organizationId, vendorName);
      const result = await supabase.from("bills").insert({ organization_id: organizationId, vendor_id: vendorId, bill_date: billDate, due_date: asText(row.due_date) || billDate, amount, description: asText(row.reference) ? `${description} · Ref ${asText(row.reference)}` : description, status: "pending_approval" });
      if (result.error) throw new Error(`${vendorName}: ${result.error.message}`);
      imported += 1;
    }
    return imported;
  };

  const importCloudExpenses = async (rows: ParsedRow[]) => {
    const organizationId = requireOrganizationId();
    const approvalEnabled = await isSpendMoneyApprovalEnabled(organizationId);
    const accounts = await supabase.from("gl_accounts").select("id,account_code").eq("organization_id", organizationId).eq("is_active", true);
    if (accounts.error) throw accounts.error;
    const byCode = new Map<string, string>((accounts.data || []).map((account) => [String(account.account_code).trim().toLowerCase(), String(account.id)]));
    let imported = 0;
    for (const row of rows) {
      const expenseDate = asText(row.expense_date);
      const description = asText(row.description);
      const amount = asNumber(row.amount);
      const expenseGl = byCode.get(asText(row.expense_account_code).toLowerCase());
      const cashGl = byCode.get(asText(row.cash_account_code).toLowerCase());
      if (!expenseDate || !description || amount <= 0 || !expenseGl || !cashGl) continue;
      const vendorId = asText(row.vendor_name) ? await findOrCreateVendor(organizationId, asText(row.vendor_name)) : null;
      const expense = await supabase.from("expenses").insert({ organization_id: organizationId, vendor_id: vendorId, amount, description, expense_date: expenseDate }).select("id").single();
      if (expense.error) throw expense.error;
      const line = { expense_gl_account_id: expenseGl, source_cash_gl_account_id: cashGl, amount, bank_charges: 0, vat_amount: 0, vat_gl_account_id: null, bank_charges_gl_account_id: null, comment: asText(row.notes) || null, quantity: 1, sort_order: 0, vendor_id: vendorId };
      const lineResult = await supabase.from("expense_lines").insert({ expense_id: expense.data.id, ...line });
      if (lineResult.error) throw lineResult.error;
      if (!approvalEnabled) {
        const journal = await createJournalForExpenseWithLines(expense.data.id, expenseDate, [line], user?.id || null);
        if (!journal.ok) throw new Error(journal.error);
      }
      await queueExpenseForTreasury({ organizationId, sourceId: expense.data.id, amount, purpose: description, requestedBy: user?.id || null, vendorId });
      imported += 1;
    }
    return imported;
  };

  const importCloudPayments = async (rows: ParsedRow[]) => {
    const organizationId = requireOrganizationId();
    let imported = 0;
    for (const row of rows) {
      const billId = asText(row.bill_id);
      const amount = asNumber(row.amount);
      const paymentDate = asText(row.payment_date);
      if (!billId || amount <= 0 || !paymentDate || !asText(row.payment_method)) continue;
      const bill = await supabase.from("bills").select("id,vendor_id,status,approved_at,amount").eq("id", billId).eq("organization_id", organizationId).maybeSingle();
      if (bill.error) throw bill.error;
      if (!bill.data) throw new Error(`Bill ${billId} was not found in this organization.`);
      if (!bill.data.approved_at && !["approved", "partially_paid", "overdue"].includes(String(bill.data.status).toLowerCase())) throw new Error(`Bill ${billId} must be approved before importing a payment.`);
      const alreadyPaid = await getTotalPaidForBill(billId);
      if (alreadyPaid + amount > Number(bill.data.amount) + 0.001) throw new Error(`Payment for bill ${billId} exceeds its remaining balance.`);
      const reference = asText(row.reference);
      if (reference) {
        const duplicate = await supabase.from("vendor_payments").select("id").eq("organization_id", organizationId).eq("reference", reference).limit(1).maybeSingle();
        if (duplicate.error) throw duplicate.error;
        if (duplicate.data) throw new Error(`Payment reference ${reference} has already been imported.`);
      }
      const payment = await supabase.from("vendor_payments").insert({ organization_id: organizationId, vendor_id: bill.data.vendor_id, bill_id: billId, amount, payment_date: paymentDate, payment_method: asText(row.payment_method), reference: reference || null, bill_allocations: [] }).select("id").single();
      if (payment.error) throw payment.error;
      const journal = await createJournalForVendorPayment(payment.data.id, amount, paymentDate, user?.id || null);
      if (!journal.ok) throw new Error(`Payment saved but journal posting failed: ${journal.error}`);
      await syncBillStatusInDb(billId);
      imported += 1;
    }
    return imported;
  };

  const buildUpdatePreview = async (rows: ParsedRow[]): Promise<UpdatePreviewRow[]> => {
    if (desktopApi.isAvailable()) throw new Error("Bulk update is currently available in the cloud application only.");
    if (entity !== "school-students" && entity !== "vendors") throw new Error("Choose Students or Vendors for bulk update.");
    const organizationId = requireOrganizationId();
    const previews: UpdatePreviewRow[] = [];
    const seenRecordIds = new Set<string>();

    if (entity === "school-students") {
      const students = await fetchAllPages<Record<string, unknown>>((from, to) => supabase.from("students")
        .select("id,admission_number,first_name,other_names,last_name,gender,class_name,stream,is_boarding,status,date_of_birth,school_pay_number,learner_id,notes")
        .eq("organization_id", organizationId).order("id").range(from, to));
      const byAdmission = new Map(students.map((student) => [asText(student.admission_number).toLowerCase(), student]));
      const schoolPayOwners = new Map(students.filter((student) => asText(student.school_pay_number)).map((student) => [asText(student.school_pay_number).toLowerCase(), asText(student.id)]));
      const learnerOwners = new Map(students.filter((student) => asText(student.learner_id)).map((student) => [asText(student.learner_id).toLowerCase(), asText(student.id)]));
      const pendingSchoolPay = new Map<string, string>();
      const pendingLearners = new Map<string, string>();

      for (const [index, row] of rows.entries()) {
        const admission = asText(row.admission_number);
        if (!admission) throw new Error(`Row ${index + 2}: admission_number is required for student updates.`);
        const current = byAdmission.get(admission.toLowerCase());
        if (!current) throw new Error(`Row ${index + 2}: admission number ${admission} was not found in this organization.`);
        const recordId = asText(current.id);
        if (seenRecordIds.has(recordId)) throw new Error(`Row ${index + 2}: admission number ${admission} is repeated in this file.`);
        seenRecordIds.add(recordId);
        const changes: Record<string, unknown> = {};
        const labels: string[] = [];

        for (const field of STUDENT_UPDATE_FIELDS) {
          const raw = asText(row[field]);
          if (!raw) continue;
          let column: string = field;
          let value: unknown = raw === CLEAR_VALUE ? null : raw;
          if (field === "day_boarding") {
            column = "is_boarding";
            if (raw !== CLEAR_VALUE && !["day", "day scholar", "day_student", "day student", "boarding", "boarder"].includes(raw.toLowerCase())) {
              throw new Error(`Row ${index + 2}: day_boarding must be Day or Boarding.`);
            }
            value = raw === CLEAR_VALUE ? null : asBoarding(row);
          } else if (field === "gender") {
            value = raw === CLEAR_VALUE ? null : asGender(raw);
            if (raw !== CLEAR_VALUE && !value) throw new Error(`Row ${index + 2}: gender must be Female, Male, or Other.`);
          } else if (field === "status") {
            const normalized = raw.toLowerCase().replace(/[\s-]+/g, "_");
            if (!["active", "current", "enrolled", "continuing", "left", "left_school", "withdrawn", "transferred", "graduated", "graduate", "completed", "suspended", "suspend"].includes(normalized)) {
              throw new Error(`Row ${index + 2}: invalid student status ${raw}.`);
            }
            value = asStudentStatus(raw);
          } else if (["first_name", "other_names", "last_name", "class_name", "stream"].includes(field) && raw !== CLEAR_VALUE) {
            value = toSchoolTitleCase(raw);
          }
          const currentValue = current[column];
          if ((currentValue ?? null) !== (value ?? null)) {
            changes[column] = value;
            labels.push(`${field}: ${asText(currentValue) || "(blank)"} → ${value === null ? "(clear)" : String(value)}`);
          }
        }

        for (const [field, owners, pending] of [["school_pay_number", schoolPayOwners, pendingSchoolPay], ["learner_id", learnerOwners, pendingLearners]] as const) {
          const value = changes[field];
          if (typeof value !== "string" || !value) continue;
          const key = value.toLowerCase();
          const owner = owners.get(key);
          if (owner && owner !== recordId) throw new Error(`Row ${index + 2}: ${field} ${value} belongs to another student.`);
          const pendingOwner = pending.get(key);
          if (pendingOwner && pendingOwner !== recordId) throw new Error(`Row ${index + 2}: ${field} ${value} is repeated for different students in this file.`);
          pending.set(key, recordId);
        }
        if (labels.length) previews.push({ rowNumber: index + 2, recordId, matchLabel: admission, changes, changeLabels: labels });
      }
      return previews;
    }

    const result = await supabase.from("vendors")
      .select("id,name,contact_name,email,phone,address,tax_number,notes,is_active")
      .eq("organization_id", organizationId);
    if (result.error) throw result.error;
    const vendors = (result.data || []) as Array<Record<string, unknown>>;
    const byId = new Map(vendors.map((vendor) => [asText(vendor.id), vendor]));
    for (const [index, row] of rows.entries()) {
      const recordId = asText(row.id);
      if (!recordId) throw new Error(`Row ${index + 2}: id is required for vendor updates. Download current records first.`);
      const current = byId.get(recordId);
      if (!current) throw new Error(`Row ${index + 2}: vendor ID ${recordId} was not found in this organization.`);
      if (seenRecordIds.has(recordId)) throw new Error(`Row ${index + 2}: vendor ID ${recordId} is repeated in this file.`);
      seenRecordIds.add(recordId);
      const changes: Record<string, unknown> = {};
      const labels: string[] = [];
      for (const field of VENDOR_UPDATE_FIELDS) {
        const raw = asText(row[field]);
        if (!raw) continue;
        const value: unknown = field === "is_active" ? asBool(raw, true) : raw === CLEAR_VALUE ? null : raw;
        if ((current[field] ?? null) !== (value ?? null)) {
          changes[field] = value;
          labels.push(`${field}: ${asText(current[field]) || "(blank)"} → ${value === null ? "(clear)" : String(value)}`);
        }
      }
      if (labels.length) previews.push({ rowNumber: index + 2, recordId, matchLabel: asText(current.name), changes, changeLabels: labels });
    }
    return previews;
  };

  const previewUpdates = async () => {
    setMessage(null);
    setUpdatePreview([]);
    if (!file) return setMessage("Choose a CSV or XLSX file first.");
    setRunning(true);
    try {
      const rows = await parseSelectedFile();
      if (!rows.length) return setMessage("No rows found in the selected file.");
      const preview = await buildUpdatePreview(rows);
      setUpdatePreview(preview);
      setMessage(preview.length ? `Preview ready: ${preview.length} record(s) will change. Review before applying.` : "No changes found. Blank cells were ignored.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to preview updates.");
    } finally {
      setRunning(false);
    }
  };

  const applyUpdates = async () => {
    if (!updatePreview.length || (entity !== "school-students" && entity !== "vendors")) return;
    setRunning(true);
    setMessage(null);
    const organizationId = requireOrganizationId();
    let changed = 0;
    const failures: string[] = [];
    const table = entity === "school-students" ? "students" : "vendors";
    for (const item of updatePreview) {
      const result = await supabase.from(table).update(item.changes).eq("organization_id", organizationId).eq("id", item.recordId).select("id").maybeSingle();
      if (result.error || !result.data) failures.push(`${item.matchLabel}: ${result.error?.message || "record was not updated"}`);
      else changed += 1;
    }
    setUpdatePreview([]);
    setRunning(false);
    setMessage(`Updated ${changed} record(s).${failures.length ? ` Failed ${failures.length}: ${failures.slice(0, 3).join("; ")}` : ""}`);
  };

  const downloadCurrentRecords = async () => {
    if (entity !== "school-students" && entity !== "vendors") return;
    setRunning(true);
    setMessage(null);
    try {
      const organizationId = requireOrganizationId();
      const columns = entity === "school-students"
        ? "admission_number,first_name,other_names,last_name,gender,class_name,stream,is_boarding,status,date_of_birth,school_pay_number,learner_id,notes"
        : "id,name,contact_name,email,phone,address,tax_number,notes,is_active";
      const records = await fetchAllPages<Record<string, unknown>>((from, to) => supabase.from(entity === "school-students" ? "students" : "vendors")
        .select(columns).eq("organization_id", organizationId).order("id").range(from, to));
      const rows = records.map((row) => entity === "school-students"
        ? { ...row, day_boarding: row.is_boarding ? "Boarding" : "Day", is_boarding: undefined }
        : row);
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Current Records");
      XLSX.writeFile(wb, `${entity}-bulk-update.xlsx`);
      setMessage(`Downloaded ${rows.length} current record(s). Keep the matching column unchanged and edit only fields that should change.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to download current records.");
    } finally {
      setRunning(false);
    }
  };

  const runImport = async () => {
    setMessage(null);
    if (!file) {
      setMessage("Choose a CSV or XLSX file first.");
      return;
    }
    setRunning(true);
    try {
      const rows = await parseSelectedFile();
      if (rows.length === 0) {
        setMessage("No rows found in the selected file.");
        return;
      }
      let imported = 0;
      const cloudSchoolImport = entity.startsWith("school-") && !desktopApi.isAvailable();
      if (cloudSchoolImport) {
        if (entity === "school-students") imported = await importCloudStudents(rows);
        else if (entity === "school-parents") imported = await importCloudParents(rows);
        else if (["school-classes", "school-streams", "school-subjects", "school-teachers"].includes(entity)) imported = await importCloudSchoolReference(rows, entity);
        else if (entity === "school-fee-structures") imported = await importCloudFeeStructures(rows);
        else if (entity === "school-expenses") imported = await importCloudExpenses(rows);
        else if (entity === "school-other-income") imported = await importCloudOtherIncome(rows);
        else if (entity === "school-purchases") imported = await importCloudPurchases(rows);
        else if (entity === "school-payments") imported = await importCloudPayments(rows);
      } else {
        if (!desktopApi.isAvailable()) throw new Error("This import type is currently available in desktop mode only.");
        if (entity === "products") imported = await importProducts(rows);
        else if (entity === "retail-customers") imported = await importRetailCustomers(rows);
        else if (entity === "hotel-customers") imported = await importHotelCustomers(rows);
        else if (entity === "vendors") imported = await importVendors(rows);
        else if (entity === "chart-of-accounts") imported = await importChartOfAccounts(rows);
        else if (entity.startsWith("school-")) imported = await importSchoolRows(rows, entity);
      }

      const skipped = rows.length - imported;
      setMessage(`Imported ${imported} row(s).${skipped > 0 ? ` Skipped ${skipped} row(s).` : ""}`);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Import failed.";
      setMessage(text);
    } finally {
      setRunning(false);
    }
  };

  const downloadTemplate = () => {
    const rows = ENTITY_TEMPLATES[entity];
    const csv = XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(rows, { skipHeader: false }));
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${entity}-template.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadXlsxTemplate = () => {
    const rows = ENTITY_TEMPLATES[entity];
    const ws = XLSX.utils.json_to_sheet(rows, { skipHeader: false });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, `${entity}-template.xlsx`);
  };

  return (
    <div className="app-card p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Bulk Import & Update</h2>
        <p className="text-sm text-slate-600 mt-1">
          Add new records with insert-only import, or safely preview and apply updates to existing records.
        </p>
      </div>

      <div className="flex gap-2">
        <button type="button" className={mode === "import" ? "app-btn-primary" : "app-btn-secondary"} onClick={() => { setMode("import"); setUpdatePreview([]); setMessage(null); }}>
          Add New Records
        </button>
        <button type="button" className={mode === "update" ? "app-btn-primary" : "app-btn-secondary"} onClick={() => { setMode("update"); if (entity !== "school-students" && entity !== "vendors") setEntity("school-students"); setUpdatePreview([]); setMessage(null); }}>
          Update Existing Records
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Entity</label>
          <select
            value={entity}
            onChange={(e) => { setEntity(e.target.value as ImportEntity); setUpdatePreview([]); setMessage(null); }}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          >
            {availableEntityOptions.filter((opt) => mode === "import" || ["school-students", "vendors"].includes(opt.id)).map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">File (CSV/XLSX)</label>
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setUpdatePreview([]); setMessage(null); }}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
          />
        </div>
      </div>

      {mode === "import" ? <>
        <p className="text-xs text-slate-500">Required columns for {selected.label}: {selected.required.join(", ")}.</p>
        {entity === "school-students" ? <p className="text-xs text-amber-700">Student import adds new records only. Existing identifiers are rejected and never overwritten.</p> : null}
        {entity === "school-fee-structures" ? <p className="text-xs text-amber-700">Fee structures are added as new records so prior terms remain unchanged.</p> : null}
        {entity === "school-purchases" ? <p className="text-xs text-amber-700">Imported supplier bills are saved as pending approval and are not posted until approved.</p> : null}
        {entity === "school-payments" ? <p className="text-xs text-amber-700">Use approved bill IDs. Each payment posts through the normal supplier-payment journal workflow.</p> : null}
        {entity === "school-expenses" ? <p className="text-xs text-amber-700">GL account codes must already exist. Organization spend-approval settings are respected.</p> : null}
      </> : <p className="text-xs text-amber-700">Download current records first. Keep {entity === "school-students" ? "admission_number" : "id"} unchanged. Blank cells are ignored; use {CLEAR_VALUE} to clear an optional field.</p>}

      <div className="flex items-center gap-3">
        {mode === "import" ? <>
          <button type="button" className="app-btn-secondary" onClick={downloadTemplate}>Download CSV Template</button>
          <button type="button" className="app-btn-secondary" onClick={downloadXlsxTemplate}>Download XLSX Template</button>
          <button type="button" className="app-btn-primary" disabled={running} onClick={() => void runImport()}>{running ? "Importing..." : "Import File"}</button>
        </> : <>
          <button type="button" className="app-btn-secondary" disabled={running} onClick={() => void downloadCurrentRecords()}>Download Current Records</button>
          <button type="button" className="app-btn-secondary" disabled={running || !file} onClick={() => void previewUpdates()}>{running ? "Checking..." : "Preview Updates"}</button>
          <button type="button" className="app-btn-primary" disabled={running || !updatePreview.length} onClick={() => void applyUpdates()}>{running ? "Updating..." : `Apply ${updatePreview.length} Update(s)`}</button>
        </>}
        {file ? <span className="text-xs text-slate-600">{file.name}</span> : null}
      </div>

      {mode === "update" && updatePreview.length ? (
        <div className="border border-slate-200 rounded-lg overflow-auto max-h-80">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 sticky top-0"><tr><th className="text-left p-2">Row</th><th className="text-left p-2">Record</th><th className="text-left p-2">Proposed changes</th></tr></thead>
            <tbody>{updatePreview.map((item) => <tr key={`${item.recordId}-${item.rowNumber}`} className="border-t border-slate-100"><td className="p-2 align-top">{item.rowNumber}</td><td className="p-2 align-top font-medium">{item.matchLabel}</td><td className="p-2">{item.changeLabels.join("; ")}</td></tr>)}</tbody>
          </table>
        </div>
      ) : null}

      {message ? <p className="text-sm text-slate-700">{message}</p> : null}
    </div>
  );
}
