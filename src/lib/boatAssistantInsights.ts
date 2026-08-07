import { supabase } from "@/lib/supabase";

export type AssistantInsight = { id: string; fact: string; recommendation: string; page: string; sourceLabel: string; severity: "info" | "warning" | "positive" };

const iso = (date: Date) => date.toISOString().slice(0, 10);

export async function loadAssistantInsights(organizationId: string): Promise<AssistantInsight[]> {
  const now = new Date();
  const currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const db = supabase as any;
  const [invoiceResult, expenseResult] = await Promise.all([
    db.from("retail_invoices").select("id,total,issue_date,due_date,status").eq("organization_id", organizationId).gte("issue_date", iso(previousStart)).limit(1000),
    db.from("expenses").select("id,amount,expense_date,status").eq("organization_id", organizationId).gte("expense_date", iso(previousStart)).neq("status", "cancelled").limit(1000),
  ]);
  const invoices = invoiceResult.data ?? [];
  const expenses = expenseResult.data ?? [];
  const sum = (rows: any[], field: string) => rows.reduce((total, row) => total + Number(row[field] || 0), 0);
  const currentSales = sum(invoices.filter((row: any) => row.issue_date >= iso(currentStart)), "total");
  const previousSales = sum(invoices.filter((row: any) => row.issue_date < iso(currentStart)), "total");
  const currentExpenses = sum(expenses.filter((row: any) => row.expense_date >= iso(currentStart)), "amount");
  const previousExpenses = sum(expenses.filter((row: any) => row.expense_date < iso(currentStart)), "amount");
  const overdue = invoices.filter((row: any) => row.status !== "paid" && row.status !== "void" && row.due_date && row.due_date < iso(now));
  const insights: AssistantInsight[] = [];
  if (previousExpenses > 0) { const change = ((currentExpenses - previousExpenses) / previousExpenses) * 100; insights.push({ id: "expense-change", fact: `Recorded expenses are ${Math.abs(change).toFixed(0)}% ${change >= 0 ? "higher" : "lower"} than the previous month-to-date comparison.`, recommendation: change > 15 ? "Review the expense register and investigate the largest changes." : "Continue monitoring spending against supporting records.", page: "purchases_expenses", sourceLabel: `${expenses.length} expense records`, severity: change > 15 ? "warning" : "info" }); }
  if (previousSales > 0) { const change = ((currentSales - previousSales) / previousSales) * 100; insights.push({ id: "sales-change", fact: `Invoiced sales are ${Math.abs(change).toFixed(0)}% ${change >= 0 ? "higher" : "lower"} than the previous month-to-date comparison.`, recommendation: change < -10 ? "Review sales activity and outstanding quotations or orders." : "Review the sales report to confirm the trend.", page: "reports_daily_sales", sourceLabel: `${invoices.length} invoice records`, severity: change >= 0 ? "positive" : "warning" }); }
  if (overdue.length) insights.push({ id: "overdue", fact: `${overdue.length} customer invoice${overdue.length === 1 ? " is" : "s are"} overdue, worth ${sum(overdue, "total").toLocaleString()}.`, recommendation: "Review the underlying invoices and follow up with the customers.", page: "retail_credit_invoices", sourceLabel: "Retail invoices and due dates", severity: "warning" });
  return insights;
}
