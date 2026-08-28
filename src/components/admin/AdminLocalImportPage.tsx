import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { desktopApi } from "@/lib/desktopApi";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { createJournalForExpenseWithLines, createJournalForVendorPayment } from "@/lib/journal";
import { isSpendMoneyApprovalEnabled, queueExpenseForTreasury } from "@/lib/treasuryWorkflow";
import { getTotalPaidForBill, syncBillStatusInDb } from "@/lib/billStatus";

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

const ENTITY_OPTIONS: Array<{ id: ImportEntity; label: string; required: string[] }> = [
  { id: "products", label: "Products", required: ["name"] },
  { id: "retail-customers", label: "Retail Customers", required: ["name"] },
  { id: "hotel-customers", label: "Hotel Customers", required: ["first_name", "last_name"] },
  { id: "vendors", label: "Vendors", required: ["name"] },
  { id: "chart-of-accounts", label: "Chart of Accounts", required: ["name"] },
  { id: "school-students", label: "School - Students", required: ["admission_number", "first_name", "last_name", "class_name"] },
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
  "school-students": [{ id: "", admission_number: "S0001", first_name: "Amina", other_names: "Zawedde", last_name: "Nabirye", class_name: "Senior 1", stream: "East", status: "active", date_of_birth: "2012-03-15", school_pay_number: "SP-10001", learner_id: "LRN-10001", parent_name: "Sarah Nabirye", parent_phone: "+256700000001", relationship: "Mother", notes: "" }],
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

function generateId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function AdminLocalImportPage() {
  const { user } = useAuth();
  const [entity, setEntity] = useState<ImportEntity>("products");
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
    const mapped = rows
      .filter((row) => asText(row.name))
      .map((row) => ({
        id: asText(row.id) || generateId("vnd"),
        name: asText(row.name),
        contact_name: asText(row.contact_name),
        email: asText(row.email),
        phone: asText(row.phone),
        address: asText(row.address),
        tax_number: asText(row.tax_number),
        notes: asText(row.notes),
        is_active: asBool(row.is_active, true),
      }));
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
    const mapped = rows.flatMap<Record<string, unknown>>((row, index) => {
      const base = { id: asText(row.id) || generateId(type.replace("school-", "sch")), organization_id: organizationId };
      if (type === "school-students") {
        if (!asText(row.admission_number) || !asText(row.first_name) || !asText(row.last_name) || !asText(row.class_name)) return [];
        return [{ ...base, admission_number: asText(row.admission_number), first_name: asText(row.first_name), other_names: asText(row.other_names) || null, last_name: asText(row.last_name), class_name: asText(row.class_name), stream: asText(row.stream) || null, status: asText(row.status) || "active", date_of_birth: asText(row.date_of_birth) || null, notes: asText(row.notes) || null }];
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
    for (const row of rows) {
      const admissionNumber = asText(row.admission_number);
      const firstName = asText(row.first_name);
      const lastName = asText(row.last_name);
      const className = asText(row.class_name);
      if (!admissionNumber || !firstName || !lastName || !className) continue;
      const student = await supabase.from("students").upsert({
        organization_id: organizationId, admission_number: admissionNumber, first_name: firstName,
        other_names: asText(row.other_names) || null, last_name: lastName,
        class_name: className, stream: asText(row.stream) || null, status: asText(row.status) || "active",
        date_of_birth: asText(row.date_of_birth) || null, school_pay_number: asText(row.school_pay_number) || null,
        learner_id: asText(row.learner_id) || null, notes: asText(row.notes) || null,
      }, { onConflict: "organization_id,admission_number" }).select("id").single();
      if (student.error) throw new Error(`${admissionNumber}: ${student.error.message}`);
      const parentName = asText(row.parent_name);
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
        <h2 className="text-lg font-semibold text-slate-900">Bulk Import</h2>
        <p className="text-sm text-slate-600 mt-1">
          Import CSV/XLSX into your cloud organization. Desktop installations can also import local business records.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Entity</label>
          <select
            value={entity}
            onChange={(e) => setEntity(e.target.value as ImportEntity)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
          >
            {availableEntityOptions.map((opt) => (
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
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
          />
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Required columns for {selected.label}: {selected.required.join(", ")}.
      </p>
      {entity === "school-fee-structures" ? <p className="text-xs text-amber-700">Fee structures are added as new records so prior terms remain unchanged.</p> : null}
      {entity === "school-purchases" ? <p className="text-xs text-amber-700">Imported supplier bills are saved as pending approval and are not posted until approved.</p> : null}
      {entity === "school-payments" ? <p className="text-xs text-amber-700">Use approved bill IDs. Each payment posts through the normal supplier-payment journal workflow.</p> : null}
      {entity === "school-expenses" ? <p className="text-xs text-amber-700">GL account codes must already exist. Organization spend-approval settings are respected.</p> : null}

      <div className="flex items-center gap-3">
        <button type="button" className="app-btn-secondary" onClick={downloadTemplate}>
          Download CSV Template
        </button>
        <button type="button" className="app-btn-secondary" onClick={downloadXlsxTemplate}>
          Download XLSX Template
        </button>
        <button type="button" className="app-btn-primary" disabled={running} onClick={() => void runImport()}>
          {running ? "Importing..." : "Import File"}
        </button>
        {file ? <span className="text-xs text-slate-600">{file.name}</span> : null}
      </div>

      {message ? <p className="text-sm text-slate-700">{message}</p> : null}
    </div>
  );
}
