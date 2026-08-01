import React, { useState } from "react";
import { StatementYear } from "../../lib/phase1FinancialEngine";

export interface MonthlyActual {
  revenue: number;
  costOfSales: number;
  operatingExpenses: number;
}

export type MonthlyActuals = Record<string, MonthlyActual>;

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface Props {
  statements: StatementYear[];
  startYear: number;
  actuals: MonthlyActuals;
  currency: string;
  onStartYear: (year: number) => void;
  onChange: (actuals: MonthlyActuals) => void;
}

export function MonthlyActualsForecast({ statements, startYear, actuals, currency, onStartYear, onChange }: Props) {
  const [selectedYear, setSelectedYear] = useState(1);
  const annual = statements[selectedYear - 1];
  const patch = (key: string, field: keyof MonthlyActual, value: number) => {
    const current = actuals[key] ?? { revenue: 0, costOfSales: 0, operatingExpenses: 0 };
    onChange({ ...actuals, [key]: { ...current, [field]: value } });
  };

  return <section className="mt-6 overflow-hidden rounded-2xl border border-teal-200 bg-white shadow-sm">
    <div className="flex flex-col justify-between gap-3 border-b border-teal-100 bg-teal-50 p-5 sm:flex-row sm:items-center">
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-teal-700">Monthly management reporting</p>
        <h3 className="mt-1 text-xl font-bold">Actual versus forecast</h3>
        <p className="mt-1 text-sm text-slate-500">Annual model values are phased monthly; entered actuals remain editable and are saved with the model.</p>
      </div>
      <div className="flex gap-2">
        <input type="number" value={startYear} onChange={event => onStartYear(Math.max(2000, Number(event.target.value) || new Date().getFullYear()))} className="w-24 rounded-lg border border-teal-200 bg-white px-2 py-2 text-sm" />
        <select value={selectedYear} onChange={event => setSelectedYear(Number(event.target.value))} className="rounded-lg border border-teal-200 bg-white px-2 py-2 text-sm">
          {statements.map(row => <option key={row.year} value={row.year}>Model Year {row.year}</option>)}
        </select>
      </div>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] text-xs">
        <thead className="bg-slate-50"><tr><th className="p-3 text-left">Month</th><th className="p-3 text-right">Revenue forecast</th><th className="p-3 text-right">Revenue actual</th><th className="p-3 text-right">Variance</th><th className="p-3 text-right">Cost forecast</th><th className="p-3 text-right">Cost actual</th><th className="p-3 text-right">Opex forecast</th><th className="p-3 text-right">Opex actual</th></tr></thead>
        <tbody>{monthNames.map((month, index) => {
          const calendarYear = startYear + selectedYear - 1;
          const key = `${calendarYear}-${String(index + 1).padStart(2, "0")}`;
          const actual = actuals[key] ?? { revenue: 0, costOfSales: 0, operatingExpenses: 0 };
          const revenueForecast = (annual?.revenue ?? 0) / 12;
          const costForecast = (annual?.costOfSales ?? 0) / 12;
          const opexForecast = (annual?.operatingExpenses ?? 0) / 12;
          return <tr key={key} className="border-t border-slate-100">
            <td className="p-2 font-bold">{month} {calendarYear}</td>
            <td className="p-2 text-right">{currency} {revenueForecast.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
            <td className="p-2"><input type="number" value={actual.revenue} onChange={event => patch(key, "revenue", Number(event.target.value) || 0)} className="w-28 rounded-md border border-slate-200 px-2 py-1.5 text-right" /></td>
            <td className={`p-2 text-right font-bold ${actual.revenue - revenueForecast < 0 ? "text-red-600" : "text-emerald-700"}`}>{currency} {(actual.revenue - revenueForecast).toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
            <td className="p-2 text-right">{currency} {costForecast.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
            <td className="p-2"><input type="number" value={actual.costOfSales} onChange={event => patch(key, "costOfSales", Number(event.target.value) || 0)} className="w-28 rounded-md border border-slate-200 px-2 py-1.5 text-right" /></td>
            <td className="p-2 text-right">{currency} {opexForecast.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
            <td className="p-2"><input type="number" value={actual.operatingExpenses} onChange={event => patch(key, "operatingExpenses", Number(event.target.value) || 0)} className="w-28 rounded-md border border-slate-200 px-2 py-1.5 text-right" /></td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </section>;
}
