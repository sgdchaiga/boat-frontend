import { supabase } from "./supabase";

import { manufacturingStatementTotals, productionExpenseBucket, type ManufacturingStatement } from "./manufacturingStatementMath";
export type { ManufacturingStatement } from "./manufacturingStatementMath";

/** Accrual schedules, scoped to the active organisation and posted inventory ledger. */
export async function loadManufacturingStatement(org: string, from: string, to: string): Promise<ManufacturingStatement> {
  if (!org || !from || !to || from > to) throw new Error("Select an organisation and a valid reporting period.");
  const settings = await supabase.from("journal_gl_settings").select("manufacturing_wip_gl_account_id,manufacturing_finished_goods_gl_account_id,manufacturing_raw_materials_gl_account_id").eq("organization_id", org).maybeSingle();
  if (settings.error) throw new Error(settings.error.message);
  const wip = settings.data?.manufacturing_wip_gl_account_id;
  const fg = settings.data?.manufacturing_finished_goods_gl_account_id;
  const raw = settings.data?.manufacturing_raw_materials_gl_account_id;
  if (!wip || !fg || !raw) throw new Error("Map manufacturing raw materials, WIP and finished goods inventory accounts in Journal account settings before preparing these statements.");
  if (new Set([wip, fg, raw]).size !== 3) throw new Error("Raw materials, WIP and finished goods must use separate accounts.");
  let material = 0, labour = 0, overhead = 0;
  for (let offset = 0; ; offset += 1000) {
    const result = await supabase.from("manufacturing_costing_entries")
      .select("id,period,material_cost,labor_cost,overhead_cost,production_entry_id,manufacturing_production_entries(production_date)")
      .eq("organization_id", org).order("id").range(offset, offset + 999);
    if (result.error) throw new Error(result.error.message);
    for (const row of result.data || []) {
      const linked = row.manufacturing_production_entries as unknown as { production_date?: string } | null;
      const date = row.production_entry_id ? linked?.production_date : `${String(row.period).slice(0, 7)}-01`;
      if (!date || date < from || date > to) continue;
      material += Number(row.material_cost || 0); labour += Number(row.labor_cost || 0); overhead += Number(row.overhead_cost || 0);
    }
    if ((result.data || []).length < 1000) break;
  }
  const detail = { openingRaw: 0, closingRaw: 0, purchases: 0, freight: 0, otherRaw: 0, otherDirect: 0, overheads: [0, 0, 0, 0, 0, 0, 0, overhead], includedExpenseIds: [] as string[] };
  let openingWip = 0, closingWip = 0, openingFinished = 0, closingFinished = 0;
  for (let offset = 0; ; offset += 1000) {
    const result = await supabase.from("journal_entry_lines")
      .select("id,gl_account_id,debit,credit,line_description,gl_accounts(account_name,account_type),journal_entries!inner(entry_date,organization_id,is_posted,is_deleted,reference_type)")
      .eq("journal_entries.organization_id", org)
      .eq("journal_entries.is_posted", true).eq("journal_entries.is_deleted", false)
      .lte("journal_entries.entry_date", to).order("id").range(offset, offset + 999);
    if (result.error) throw new Error(result.error.message);
    for (const row of result.data || []) {
      const header = row.journal_entries as unknown as { entry_date: string; reference_type: string };
      const amount = Number(row.debit || 0) - Number(row.credit || 0);
      if (row.gl_account_id === wip) { closingWip += amount; if (header.entry_date < from) openingWip += amount; }
      else if (row.gl_account_id === fg) { closingFinished += amount; if (header.entry_date < from) openingFinished += amount; }
      else if (row.gl_account_id === raw) {
        detail.closingRaw += amount;
        if (header.entry_date < from) detail.openingRaw += amount;
        else if (header.reference_type !== "manufacturing_costing") {
          if (/freight|carriage/i.test(row.line_description || "") && amount > 0) detail.freight += amount;
          else if (["bill", "purchase", "grn", "vendor_bill"].includes(header.reference_type)) detail.purchases += amount;
          else detail.otherRaw += amount;
        }
      } else if (header.entry_date >= from) {
        const account = row.gl_accounts as unknown as { account_name: string; account_type: string } | null;
        if (account?.account_type !== "expense") continue;
        const bucket = productionExpenseBucket(account.account_name);
        if (bucket === null) continue;
        detail.includedExpenseIds.push(row.gl_account_id);
        if (bucket === "freight") detail.freight += amount;
        else if (bucket === "labour") labour += amount;
        else if (bucket === "direct") detail.otherDirect += amount;
        else detail.overheads[bucket] += amount;
      }
    }
    if ((result.data || []).length < 1000) break;
  }
  material = detail.openingRaw + detail.purchases + detail.freight + detail.otherRaw - detail.closingRaw;
  overhead = detail.overheads.reduce((sum, amount) => sum + amount, 0);
  detail.includedExpenseIds = [...new Set(detail.includedExpenseIds)];
  return manufacturingStatementTotals({ material, labour, overhead, openingWip, closingWip, openingFinished, closingFinished, detail });
}
