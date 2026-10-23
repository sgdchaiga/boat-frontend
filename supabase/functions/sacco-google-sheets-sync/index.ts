import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Content-Type": "application/json" };
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
type Source = { id: string; organization_id: string; spreadsheet_id: string; sheet_name: string; header_row: number; column_map: Record<string, string> };
const privileged = new Set(["admin", "manager", "accountant", "super_admin"]);
const normal = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const number = (value: unknown) => {
  const raw = String(value ?? "").trim().replace(/,/g, "").replace(/\s/g, "");
  if (!raw || raw === "-") return 0;
  const parsed = Number(raw.replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(parsed) ? parsed : 0;
};
const date = (value: unknown) => {
  const raw = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parts = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (parts) { const year = parts[3].length === 2 ? `20${parts[3]}` : parts[3]; return `${year}-${parts[2].padStart(2,"0")}-${parts[1].padStart(2,"0")}`; }
  const parsed = new Date(raw); return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};
const hash = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))))).map(b => b.toString(16).padStart(2, "0")).join("");

async function googleToken() {
  const clientId = Deno.env.get("GOOGLE_SHEETS_CLIENT_ID"), clientSecret = Deno.env.get("GOOGLE_SHEETS_CLIENT_SECRET"), refreshToken = Deno.env.get("GOOGLE_SHEETS_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Google Sheets credentials are not configured. Set GOOGLE_SHEETS_CLIENT_ID, GOOGLE_SHEETS_CLIENT_SECRET and GOOGLE_SHEETS_REFRESH_TOKEN.");
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }) });
  const payload = await response.json(); if (!response.ok || !payload.access_token) throw new Error(String(payload.error_description ?? "Unable to obtain Google Sheets access token"));
  return payload.access_token as string;
}
function valueAt(row: string[], indexes: Map<string, number>, header: string) { const index = indexes.get(normal(header)); return index === undefined ? "" : (row[index] ?? ""); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respond({ ok: false, error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return respond({ ok: false, error: "Missing Supabase configuration" }, 500);
  const auth = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: authData } = await auth.auth.getUser();
  if (!authData.user) return respond({ ok: false, error: "Unauthorized" }, 401);
  const staff = await auth.from("staff").select("organization_id,role").eq("id", authData.user.id).maybeSingle();
  if (!staff.data?.organization_id || !privileged.has(String(staff.data.role ?? "").toLowerCase())) return respond({ ok: false, error: "Only an accountant, manager or administrator can synchronise the cashbook." }, 403);
  const body = await req.json().catch(() => ({})) as { source_id?: string };
  if (!body.source_id) return respond({ ok: false, error: "A cashbook source is required" }, 400);
  const db = createClient(url, service, { auth: { persistSession: false } });
  const sourceResult = await db.from("sacco_cashbook_sync_sources").select("*").eq("id", body.source_id).eq("organization_id", staff.data.organization_id).maybeSingle();
  const source = sourceResult.data as Source | null;
  if (!source) return respond({ ok: false, error: "Cashbook source not found" }, 404);
  try {
    const token = await googleToken();
    const range = encodeURIComponent(`${source.sheet_name}!A:${"Z"}`);
    const sheetResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(source.spreadsheet_id)}/values/${range}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`, { headers: { Authorization: `Bearer ${token}` } });
    const sheet = await sheetResponse.json(); if (!sheetResponse.ok) throw new Error(String(sheet.error?.message ?? "Unable to read the Google Sheet"));
    const values = (sheet.values ?? []) as string[][]; const headerIndex = source.header_row - 1; const headers = values[headerIndex] ?? [];
    if (!headers.length) throw new Error(`No header found at row ${source.header_row}.`);
    const indexes = new Map(headers.map((h, i) => [normal(h), i]));
    let imported = 0, unchanged = 0, invalid = 0, changed = 0;
    for (let i = headerIndex + 1; i < values.length; i++) {
      const row = values[i]; if (!row?.some(cell => String(cell).trim())) continue;
      const rowHash = await hash(row); const rowNumber = i + 1;
      const existing = await db.from("sacco_cashbook_sync_rows").select("id,source_hash,status").eq("source_id", source.id).eq("source_row_number", rowNumber).maybeSingle();
      if (existing.data) {
        if (existing.data.source_hash === rowHash) { unchanged++; continue; }
        await db.from("sacco_cashbook_sync_rows").update({ status: "changed_after_import", message: "Sheet row changed after import; review it in the source before a correcting entry is posted.", source_hash: rowHash, raw_payload: { headers, row } }).eq("id", existing.data.id);
        changed++; continue;
      }
      const mapped = source.column_map || {};
      const entryDate = date(valueAt(row, indexes, mapped.date || "Date"));
      const description = String(valueAt(row, indexes, mapped.description || "Description")).trim();
      if (!entryDate || !description) { await db.from("sacco_cashbook_sync_rows").insert({ organization_id: source.organization_id, source_id: source.id, source_row_number: rowNumber, source_hash: rowHash, status: "invalid", message: "Date and description are required.", raw_payload: { headers, row } }); invalid++; continue; }
      const inserted = await db.from("sacco_cashbook_entries").insert({ organization_id: source.organization_id, entry_date: entryDate, description, reference: String(valueAt(row, indexes, mapped.reference || "Reference")).trim() || null, category: String(valueAt(row, indexes, mapped.category || "Category")).trim() || "Google Sheets import", member_name: String(valueAt(row, indexes, mapped.member_name || "Member")).trim() || null, debit: number(valueAt(row, indexes, mapped.debit || "Debit")), credit: number(valueAt(row, indexes, mapped.credit || "Credit")), balance: number(valueAt(row, indexes, mapped.balance || "Balance")), external_source_id: source.id, external_row_number: rowNumber, imported_at: new Date().toISOString() }).select("id").single();
      if (inserted.error) throw inserted.error;
      await db.from("sacco_cashbook_sync_rows").insert({ organization_id: source.organization_id, source_id: source.id, source_row_number: rowNumber, source_hash: rowHash, cashbook_entry_id: inserted.data.id, raw_payload: { headers, row } }); imported++;
    }
    const message = `${imported} imported, ${unchanged} unchanged, ${changed} changed after import, ${invalid} invalid.`;
    await db.from("sacco_cashbook_sync_sources").update({ last_synced_at: new Date().toISOString(), last_sync_status: changed || invalid ? "attention" : "success", last_sync_message: message }).eq("id", source.id);
    return respond({ ok: true, imported, unchanged, changed, invalid, message });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cashbook synchronisation failed";
    await db.from("sacco_cashbook_sync_sources").update({ last_synced_at: new Date().toISOString(), last_sync_status: "failed", last_sync_message: message }).eq("id", source.id);
    return respond({ ok: false, error: message }, 500);
  }
});
