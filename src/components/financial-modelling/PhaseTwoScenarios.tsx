import type { ScenarioConfiguration, ScenarioDriverSet, ScenarioCase } from "@/lib/phase2ScenarioEngine";

export function PhaseTwoScenarios({ configuration, cases, money, onChange }: {
  configuration:ScenarioConfiguration; cases:ScenarioCase[]; money:(value:number,compact?:boolean)=>string;
  onChange:(scenario:"optimistic"|"conservative",key:keyof ScenarioDriverSet,value:number)=>void;
}) {
  const metrics:(keyof ScenarioCase["statements"][number])[]=["revenue","ebitda","netProfit","closingCash","dscr"];
  const labels:Record<string,string>={revenue:"Revenue",ebitda:"EBITDA",netProfit:"Net profit",closingCash:"Closing cash",dscr:"DSCR"};
  const driverFields:[keyof ScenarioDriverSet,string,string][]=[
    ["annualRevenueGrowthDelta","Annual revenue growth change","%"],["priceDelta","Pricing change","%"],["operatingCostDelta","Cost change","%"],["interestRateDelta","Interest-rate change","pts"],["launchDelayYears","Launch / expansion delay","years"]
  ];
  return <section className="mt-6 overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-sm">
    <div className="border-b border-blue-100 bg-blue-50/50 p-5"><p className="text-xs font-bold uppercase tracking-wider text-blue-700">Phase 2 · scenario analysis</p><h3 className="mt-1 text-xl font-bold">Operational downside and upside cases</h3><p className="mt-1 text-sm text-slate-500">Each case rebuilds the linked statements, debt metrics and cash position using explicit commercial and financing shocks.</p></div>
    <div className="grid gap-5 border-b border-slate-100 p-5 lg:grid-cols-2">{(["optimistic","conservative"] as const).map(scenario=><div key={scenario} className={`rounded-xl border p-4 ${scenario==="optimistic"?"border-emerald-200 bg-emerald-50/40":"border-amber-200 bg-amber-50/40"}`}><p className="mb-3 font-bold capitalize">{scenario} assumptions</p><div className="grid gap-3 sm:grid-cols-2">{driverFields.map(([key,label,suffix])=><label key={key}><span className="mb-1 block text-[11px] font-bold text-slate-600">{label}</span><div className="flex rounded-lg border border-slate-200 bg-white"><input type="number" step="0.5" min={key==="launchDelayYears"?0:undefined} value={configuration[scenario][key]} onChange={event=>onChange(scenario,key,Number(event.target.value)||0)} className="min-w-0 flex-1 rounded-lg px-2.5 py-2 text-sm outline-none"/><span className="grid place-items-center px-2 text-[10px] font-bold text-slate-400">{suffix}</span></div></label>)}</div></div>)}</div>
    <div className="overflow-x-auto p-5"><p className="mb-3 font-bold">Final projection year comparison</p><table className="w-full min-w-[680px] text-sm"><thead><tr><th className="bg-slate-900 px-4 py-3 text-left text-white">Metric</th>{cases.map(item=><th key={item.key} className="bg-slate-900 px-4 py-3 text-right text-white">{item.label}</th>)}</tr></thead><tbody>{metrics.map(metric=><tr key={metric} className="border-t border-slate-100"><td className="px-4 py-3 font-semibold">{labels[metric]}</td>{cases.map(item=>{const row=item.statements[item.statements.length-1];const value=Number(row?.[metric]??0);return <td key={item.key} className={`px-4 py-3 text-right font-bold ${value<0?"text-red-600":item.key==="optimistic"?"text-emerald-700":""}`}>{metric==="dscr"?`${value.toFixed(2)}x`:money(value,true)}</td>})}</tr>)}</tbody></table></div>
  </section>;
}
