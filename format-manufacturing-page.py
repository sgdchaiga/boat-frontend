from pathlib import Path
p=Path('src/components/manufacturing/ManufacturingAccountingReportsPage.tsx');s=p.read_text(encoding='utf-8')
s='import { manufacturingAccountLines } from "../../lib/manufacturingStatementMath";\n'+s
s=s.replace('    const material = rows.reduce', '    const material = statement?.material ?? rows.reduce').replace('    const labor = rows.reduce','    const labor = statement?.labour ?? rows.reduce').replace('    const overhead = rows.reduce','    const overhead = statement?.overhead ?? rows.reduce')
s=s.replace('const manufacturingCosts = material + labor + overhead;', 'const manufacturingCosts = material + labor + overhead + (statement?.detail?.otherDirect || 0);')
s=s.replace('    const lines = [', '    const lines = !isWip && statement ? [["Manufacturing Account", "UGX"], ["From", fromDate, "To", toDate], ...manufacturingAccountLines(statement).map(line => [line.label, line.value === null ? "" : String(line.value)])] : [',1)
a=s.index('        <h2 className="text-sm font-semibold text-slate-900">Cost of goods manufactured</h2>');b=s.index('        {activeDrill && (',a)
old=s[a:b]
new='''        {!isWip && statement ? <>
          <h2 className="text-lg font-semibold text-slate-900">Manufacturing Account for {Math.round((Date.parse(toDate) - Date.parse(fromDate)) / 86400000) >= 364 && Math.round((Date.parse(toDate) - Date.parse(fromDate)) / 86400000) <= 365 ? "year" : "period"} ended {new Date(`${toDate}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</h2>
          <p className="mt-1 text-sm text-slate-500">{user?.organization_name || "Active organisation"} · {fromDate} to {toDate}</p>
          <table className="mt-4 w-full text-sm"><thead><tr className="border-b"><th className="p-3 text-left">Particulars</th><th className="p-3 text-right">UGX</th></tr></thead><tbody>
            {manufacturingAccountLines(statement).map(line => <tr key={line.label} className={line.strong ? "border-t bg-slate-50 font-semibold" : "border-t border-slate-100"}><td className="p-3">{line.label}</td><td className="p-3 text-right tabular-nums">{line.value === null ? "" : line.value < 0 ? `(${Math.abs(line.value).toLocaleString("en-UG", { maximumFractionDigits: 2 })})` : line.value.toLocaleString("en-UG", { maximumFractionDigits: 2 })}</td></tr>)}
          </tbody></table>
          <p className="mt-3 text-xs text-slate-500">Inventory balances and raw-material receipts use the posted ledger. Direct labour and applied overhead use production costing, with net separately posted production expenses added once. Unitemised applied overhead is included in other factory overheads. Zero means no amount was identified in these sources. Other raw-material movements are disclosed separately when present.</p>
        </> : <>
'''+old+'''        </>}
'''
s=s[:a]+new+s[b:]
s=s.replace('href="?page=accounting_income">Continue', 'href={`?page=accounting_income&from=${fromDate}&to=${toDate}`}>Continue')
p.write_text(s,encoding='utf-8')
