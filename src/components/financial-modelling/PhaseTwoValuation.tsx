import type { ValuationAssumptions, ValuationResult } from "@/lib/phase2ValuationEngine";

export function PhaseTwoValuation({ assumptions, result, sensitivity, currency, money, onChange }: {
  assumptions: ValuationAssumptions; result: ValuationResult;
  sensitivity: { discountRates:number[]; terminalGrowthRates:number[]; values:number[][] };
  currency: string; money:(value:number,compact?:boolean)=>string;
  onChange:(key:keyof ValuationAssumptions,value:number)=>void;
}) {
  const field=(label:string,key:keyof ValuationAssumptions,suffix:string)=><label><span className="mb-1 block text-xs font-bold">{label}</span><div className="flex rounded-lg border border-slate-200 bg-white"><input type="number" min="0" step="0.1" value={assumptions[key]} onChange={event=>onChange(key,Number(event.target.value)||0)} className="min-w-0 flex-1 rounded-lg px-3 py-2.5 outline-none"/><span className="grid place-items-center px-3 text-xs font-bold text-slate-400">{suffix}</span></div></label>;
  return <section className="mt-6 overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-sm">
    <div className="border-b border-violet-100 bg-violet-50/50 p-5"><p className="text-xs font-bold uppercase tracking-wider text-violet-700">Phase 2 · advanced modelling</p><h3 className="mt-1 text-xl font-bold">DCF valuation and sensitivity</h3><p className="mt-1 text-sm text-slate-500">Values the linked operating cash flows and tests the two assumptions that most affect terminal value.</p></div>
    <div className="grid gap-4 border-b border-slate-100 p-5 sm:grid-cols-3">{field("Discount rate","discountRate","%")}{field("Terminal growth","terminalGrowthRate","%")}{field("Initial investment","initialInvestment",currency)}</div>
    <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">{[
      ["Enterprise value",money(result.enterpriseValue,true)],["Equity value",money(result.equityValue,true)],["NPV",money(result.npv,true)],["IRR",result.irr==null?"Not available":`${(result.irr*100).toFixed(1)}%`],
      ["Terminal value",money(result.terminalValue,true)],["Net debt",money(result.netDebt,true)],["Payback",result.paybackPeriod==null?"Beyond forecast":`${result.paybackPeriod.toFixed(1)} years`],["Forecast PV",money(result.presentValueOfForecast,true)]
    ].map(([label,value])=><div key={label} className="rounded-xl border border-slate-100 bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 text-lg font-bold text-slate-900">{value}</p></div>)}</div>
    <div className="overflow-x-auto border-t border-slate-100 p-5"><div className="mb-3"><p className="font-bold">Enterprise value sensitivity</p><p className="text-xs text-slate-500">Rows: terminal growth · Columns: discount rate · {currency}</p></div><table className="w-full min-w-[620px] text-xs"><thead><tr><th className="bg-slate-900 px-3 py-2 text-left text-white">Growth \ Discount</th>{sensitivity.discountRates.map(rate=><th key={rate} className="bg-slate-900 px-3 py-2 text-right text-white">{rate.toFixed(1)}%</th>)}</tr></thead><tbody>{sensitivity.terminalGrowthRates.map((growth,row)=><tr key={growth} className="border-t border-slate-100"><td className="bg-slate-50 px-3 py-2 font-bold">{growth.toFixed(1)}%</td>{sensitivity.values[row].map((value,col)=><td key={sensitivity.discountRates[col]} className={`px-3 py-2 text-right font-semibold ${growth===assumptions.terminalGrowthRate&&sensitivity.discountRates[col]===assumptions.discountRate?"bg-violet-100 text-violet-800":""}`}>{money(value,true)}</td>)}</tr>)}</tbody></table></div>
  </section>;
}
