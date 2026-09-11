import { supabase } from "./supabase";

import { manufacturingStatementTotals, type ManufacturingStatement } from "./manufacturingStatementMath";
export type { ManufacturingStatement } from "./manufacturingStatementMath";

/** Accrual schedules, scoped to the active organisation and posted inventory ledger. */
export async function loadManufacturingStatement(org: string, from: string, to: string): Promise<ManufacturingStatement> {
  if (!org || !from || !to || from > to) throw new Error("Select an organisation and a valid reporting period.");
  const settings = await supabase.from("journal_gl_settings").select("manufacturing_wip_gl_account_id,manufacturing_finished_goods_gl_account_id").eq("organization_id", org).maybeSingle();
  if (settings.error) throw new Error(settings.error.message);
  const wip = settings.data?.manufacturing_wip_gl_account_id;
  const fg = settings.data?.manufacturing_finished_goods_gl_account_id;
  if (!wip || !fg) throw new Error("Map manufacturing WIP and finished goods inventory accounts in Journal account settings before preparing these statements.");
  if (wip === fg) throw new Error("WIP and finished goods inventory must use separate accounts.");
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
  let openingWip = 0, closingWip = 0, openingFinished = 0, closingFinished = 0;
  for (let offset = 0; ; offset += 1000) {
    const result = await supabase.from("journal_entry_lines")
      .select("id,gl_account_id,debit,credit,journal_entries!inner(entry_date,organization_id,is_posted,is_deleted)")
      .in("gl_account_id", [wip, fg]).eq("journal_entries.organization_id", org)
      .eq("journal_entries.is_posted", true).eq("journal_entries.is_deleted", false)
      .lte("journal_entries.entry_date", to).order("id").range(offset, offset + 999);
    if (result.error) throw new Error(result.error.message);
    for (const row of result.data || []) {
      const header = row.journal_entries as unknown as { entry_date: string };
      const amount = Number(row.debit || 0) - Number(row.credit || 0);
      if (row.gl_account_id === wip) { closingWip += amount; if (header.entry_date < from) openingWip += amount; }
      else { closingFinished += amount; if (header.entry_date < from) openingFinished += amount; }
    }
    if ((result.data || []).length < 1000) break;
  }
  return manufacturingStatementTotals({ material, labour, overhead, openingWip, closingWip, openingFinished, closingFinished });
}
