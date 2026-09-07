export type ChartAccountImport = {
  account_code: string; account_name: string; account_type: string; category: string;
  parent_code: string; is_active: boolean;
};

export function validateChartImport(rows: Record<string, unknown>[]): ChartAccountImport[] {
  if (!rows.length || rows.length > 5000) throw new Error("Upload between 1 and 5000 accounts.");
  const codes = new Set<string>();
  const accounts = rows.map((raw, index) => {
    const row = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key.trim().toLowerCase().replace(/\s+/g, "_"), value]));
    const value = (key: string) => String(row[key] ?? "").trim();
    const account_code = value("account_code");
    const account_name = value("account_name");
    const account_type = value("account_type").toLowerCase();
    if (!account_code || !account_name || !["asset", "liability", "equity", "income", "expense"].includes(account_type)) throw new Error(`Row ${index + 2}: provide account_code, account_name, and account_type (asset, liability, equity, income, or expense).`);
    if (codes.has(account_code)) throw new Error(`Duplicate account code: ${account_code}.`);
    codes.add(account_code);
    const active = value("is_active").toLowerCase();
    if (active && !["true", "false", "yes", "no", "1", "0"].includes(active)) throw new Error(`Row ${index + 2}: is_active must be true or false.`);
    return { account_code, account_name, account_type, category: value("category"), parent_code: value("parent_code"), is_active: !["false", "no", "0"].includes(active) };
  });
  const byCode = new Map(accounts.map(account => [account.account_code, account]));
  for (const account of accounts) {
    const visited = new Set([account.account_code]);
    let parent = account.parent_code;
    while (parent) {
      if (!byCode.has(parent)) throw new Error(`Unknown parent code ${parent} for ${account.account_code}.`);
      if (visited.has(parent)) throw new Error(`Parent accounts contain a cycle at ${account.account_code}.`);
      visited.add(parent);
      parent = byCode.get(parent)!.parent_code;
    }
  }
  return accounts;
}
