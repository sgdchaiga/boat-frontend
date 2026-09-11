from pathlib import Path
p=Path('src/lib/manufacturingStatement.ts');s=p.read_text(encoding='utf-8-sig')
s=s.replace('manufacturingStatementTotals, type ManufacturingStatement','manufacturingStatementTotals, productionExpenseBucket, type ManufacturingStatement')
s=s.replace('manufacturing_wip_gl_account_id,manufacturing_finished_goods_gl_account_id','manufacturing_wip_gl_account_id,manufacturing_finished_goods_gl_account_id,manufacturing_raw_materials_gl_account_id')
s=s.replace('  const fg = settings.data?.manufacturing_finished_goods_gl_account_id;','  const fg = settings.data?.manufacturing_finished_goods_gl_account_id;\n  const raw = settings.data?.manufacturing_raw_materials_gl_account_id;')
s=s.replace('if (!wip || !fg)', 'if (!wip || !fg || !raw)').replace('Map manufacturing WIP and finished goods inventory accounts','Map manufacturing raw materials, WIP and finished goods inventory accounts')
s=s.replace('if (wip === fg)', 'if (new Set([wip, fg, raw]).size !== 3)').replace('WIP and finished goods inventory must use separate accounts.','Raw materials, WIP and finished goods must use separate accounts.')
s=s.replace('  let openingWip = 0,', '  const detail = { openingRaw: 0, closingRaw: 0, purchases: 0, freight: 0, otherRaw: 0, otherDirect: 0, overheads: [0, 0, 0, 0, 0, 0, 0, overhead], includedExpenseIds: [] as string[] };\n  let openingWip = 0,')
s=s.replace('.select("id,gl_account_id,debit,credit,journal_entries!inner(entry_date,organization_id,is_posted,is_deleted)")', '.select("id,gl_account_id,debit,credit,line_description,gl_accounts(account_name,account_type),journal_entries!inner(entry_date,organization_id,is_posted,is_deleted,reference_type)")')
s=s.replace('.in("gl_account_id", [wip, fg]).eq', '.eq')
s=s.replace('{ entry_date: string }','{ entry_date: string; reference_type: string }')
s=s.replace('      else { closingFinished += amount; if (header.entry_date < from) openingFinished += amount; }', '''      else if (row.gl_account_id === fg) { closingFinished += amount; if (header.entry_date < from) openingFinished += amount; }
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
      }''')
s=s.replace('  return manufacturingStatementTotals({ material, labour, overhead, openingWip, closingWip, openingFinished, closingFinished });','  material = detail.openingRaw + detail.purchases + detail.freight + detail.otherRaw - detail.closingRaw;\n  overhead = detail.overheads.reduce((sum, amount) => sum + amount, 0);\n  detail.includedExpenseIds = [...new Set(detail.includedExpenseIds)];\n  return manufacturingStatementTotals({ material, labour, overhead, openingWip, closingWip, openingFinished, closingFinished, detail });')
p.write_text(s,encoding='utf-8')
p=Path('src/components/accounting/IncomeStatementPage.tsx');s=p.read_text(encoding='utf-8')
s=s.replace('cogsRows = cogsRows.filter(row => classifyRetailExpenseRow(row) !== "cogs");','cogsRows = cogsRows.filter(row => classifyRetailExpenseRow(row) !== "cogs" && !manufacturing!.detail?.includedExpenseIds.includes(row.account_id));\n        opexRows = opexRows.filter(row => !manufacturing!.detail?.includedExpenseIds.includes(row.account_id));\n        totalOpex = opexRows.reduce((sum, row) => sum + row.total, 0);')
p.write_text(s,encoding='utf-8')
