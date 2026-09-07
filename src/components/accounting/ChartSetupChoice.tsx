import { useState } from "react";
import { validateChartImport, type ChartAccountImport } from "@/lib/chartOfAccountsImport";

export function ChartSetupChoice({ source, onSourceChange, accounts, onAccountsChange, disabled = false }: {
  source: "template" | "custom"; onSourceChange: (source: "template" | "custom") => void;
  accounts: ChartAccountImport[]; onAccountsChange: (accounts: ChartAccountImport[]) => void; disabled?: boolean;
}) {
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  return <fieldset disabled={disabled || reading} className="my-4 space-y-3 rounded-lg border border-slate-200 p-4">
    <legend className="px-1 font-semibold text-slate-900">Chart of accounts</legend>
    <label className="flex items-start gap-2"><input type="radio" checked={source === "template"} onChange={() => onSourceChange("template")} /><span>Adopt the business template<span className="block text-xs text-slate-500">Start with the accounts provided for your business type.</span></span></label>
    <label className="flex items-start gap-2"><input type="radio" checked={source === "custom"} onChange={() => onSourceChange("custom")} /><span>Upload my own chart<span className="block text-xs text-slate-500">Start with your accounts and configure journal account mappings afterwards.</span></span></label>
    {source === "custom" && <div className="space-y-2 text-sm">
      <p>Upload CSV or Excel with columns: <strong>account_code, account_name, account_type</strong>. Optional: category, parent_code, is_active.</p>
      <p className="text-xs text-slate-500">Account types: asset, liability, equity, income, expense. Format account codes as text to preserve leading zeros.</p>
      <input aria-label="Upload chart of accounts" type="file" accept=".csv,.xlsx,.xls" onChange={async event => {
        const file = event.target.files?.[0];
        onAccountsChange([]); setError("");
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) { setError("Use a file smaller than 5 MB."); return; }
        setReading(true);
        try {
          const XLSX = await import("xlsx");
          const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", raw: true });
          const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]], { defval: "", raw: false });
          onAccountsChange(validateChartImport(rows));
        } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to read chart."); }
        finally { setReading(false); }
      }} />
      {reading && <p role="status">Reading accounts...</p>}
      {error && <p role="alert" className="text-rose-700">{error}</p>}
      {accounts.length > 0 && <><p className="text-emerald-700">{accounts.length} accounts ready to import.</p><div className="max-h-48 overflow-auto"><table className="w-full text-left text-xs"><thead><tr><th>Code</th><th>Name</th><th>Type</th></tr></thead><tbody>{accounts.map(account => <tr key={account.account_code}><td className="py-1 pr-2">{account.account_code}</td><td className="pr-2">{account.account_name}</td><td>{account.account_type}</td></tr>)}</tbody></table></div></>}
    </div>}
  </fieldset>;
}
