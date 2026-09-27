import dotenv from "dotenv";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

dotenv.config({ path: "C:/Projects/BOAT/server/.env" });
dotenv.config({ path: "C:/Projects/BOAT/.env" });

const configuredUrl = process.env.CLEARING_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const url = configuredUrl && /^https?:\/\//i.test(configuredUrl) ? configuredUrl : configuredUrl ? `https://${configuredUrl}` : "";
const key = process.env.CLEARING_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("BOAT server database credentials are not configured.");

const workbook = XLSX.read(fs.readFileSync("C:/Projects/BOAT/outputs/schoolpay-code-update/schoolpay-code-update.xlsx"), { type: "buffer", cellText: false, cellDates: false });
const rows = XLSX.utils.sheet_to_json(workbook.Sheets["SchoolPay updates"], { defval: null });
const updates = rows
  .filter((row) => row.admission_number != null && row.corrected_schoolpay_code != null)
  .map((row) => ({
    admission: String(row.admission_number).trim(),
    current: String(row.current_system_schoolpay_code).trim(),
    corrected: String(row.corrected_schoolpay_code).trim(),
  }));

if (updates.length !== 23) throw new Error(`Expected 23 populated corrections, found ${updates.length}.`);
const admissions = updates.map((row) => row.admission);
if (new Set(admissions).size !== admissions.length) throw new Error("Duplicate admission numbers in correction file.");

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await supabase
  .from("students")
  .select("id,organization_id,admission_number,school_pay_number")
  .in("admission_number", admissions);
if (error) throw error;

const byAdmission = new Map((data || []).map((row) => [String(row.admission_number), row]));
const missing = updates.filter((row) => !byAdmission.has(row.admission));
const mismatched = updates.filter((row) => {
  const student = byAdmission.get(row.admission);
  return student && String(student.school_pay_number || "") !== row.current;
});
const organizations = new Set((data || []).map((row) => row.organization_id));
if (missing.length || mismatched.length || data.length !== updates.length || organizations.size !== 1) {
  throw new Error(`Preflight failed: matched=${data.length}/${updates.length}, missing=${missing.length}, currentCodeMismatches=${mismatched.length}, organizations=${organizations.size}.`);
}

console.log(JSON.stringify({ status: "preflight-ok", records: updates.length, organizationId: [...organizations][0] }));
