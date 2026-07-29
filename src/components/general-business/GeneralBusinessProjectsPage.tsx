import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Briefcase, Plus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

type Project = { id: string; code: string; name: string; description: string | null; status: string; start_date: string | null; end_date: string | null };
type Entry = { id: string; kind: "income" | "expense"; date: string; description: string; amount: number; project_id: string | null; table: "retail_invoices" | "expenses" };
const money = (value: number) => new Intl.NumberFormat("en-UG", { maximumFractionDigits: 0 }).format(value);

export function GeneralBusinessProjectsPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id || "";
  const [projects, setProjects] = useState<Project[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    const [projectRes, invoiceRes, expenseRes] = await Promise.all([
      supabase.from("business_projects").select("id,code,name,description,status,start_date,end_date").eq("organization_id", orgId).order("name"),
      supabase.from("retail_invoices").select("id,invoice_number,customer_name,total,issue_date,status,project_id").eq("organization_id", orgId).neq("status", "void").order("issue_date", { ascending: false }).limit(250),
      supabase.from("expenses").select("id,description,amount,expense_date,status,project_id").eq("organization_id", orgId).neq("status", "cancelled").order("expense_date", { ascending: false }).limit(250),
    ]);
    setProjects((projectRes.data || []) as Project[]);
    setEntries([
      ...((invoiceRes.data || []) as Array<Record<string, unknown>>).map((row) => ({ id: String(row.id), kind: "income" as const, date: String(row.issue_date), description: `${row.invoice_number} · ${row.customer_name || "Customer"}`, amount: Number(row.total || 0), project_id: row.project_id ? String(row.project_id) : null, table: "retail_invoices" as const })),
      ...((expenseRes.data || []) as Array<Record<string, unknown>>).map((row) => ({ id: String(row.id), kind: "expense" as const, date: String(row.expense_date), description: String(row.description || "Expense"), amount: Number(row.amount || 0), project_id: row.project_id ? String(row.project_id) : null, table: "expenses" as const })),
    ].sort((a, b) => b.date.localeCompare(a.date)));
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  const saveProject = async () => {
    if (!orgId || !name.trim()) return;
    setSaving(true);
    const normalizedCode = (code.trim() || name.trim()).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
    const { error } = await supabase.from("business_projects").insert({ organization_id: orgId, name: name.trim(), code: normalizedCode, description: description.trim() || null, created_by: user?.id || null });
    setSaving(false);
    if (error) { alert(error.message); return; }
    setName(""); setCode(""); setDescription(""); setShowAdd(false); await load();
  };

  const assignProject = async (entry: Entry, projectId: string) => {
    const value = projectId || null;
    const { error } = await supabase.from(entry.table).update({ project_id: value }).eq("id", entry.id).eq("organization_id", orgId);
    if (error) { alert(error.message); return; }
    setEntries((current) => current.map((item) => item.id === entry.id && item.table === entry.table ? { ...item, project_id: value } : item));
  };

  const filtered = selectedProjectId === "all" ? entries : selectedProjectId === "unassigned" ? entries.filter((entry) => !entry.project_id) : entries.filter((entry) => entry.project_id === selectedProjectId);
  const totals = useMemo(() => {
    const income = filtered.filter((entry) => entry.kind === "income").reduce((sum, entry) => sum + entry.amount, 0);
    const expense = filtered.filter((entry) => entry.kind === "expense").reduce((sum, entry) => sum + entry.amount, 0);
    return { income, expense, net: income - expense };
  }, [filtered]);

  return <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wider text-brand-700">General Business</p><h1 className="mt-1 text-3xl font-bold text-slate-900">Projects</h1><p className="mt-1 text-sm text-slate-600">Assign income and expenditure to projects, or report across the whole organization.</p></div><button type="button" className="app-btn-primary" onClick={() => setShowAdd(true)}><Plus className="h-4 w-4"/>Add project</button></header>
    {showAdd && <section className="rounded-xl border border-brand-200 bg-brand-50/30 p-5"><h2 className="font-bold">New project</h2><div className="mt-4 grid gap-3 md:grid-cols-3"><input className="rounded-lg border border-slate-300 px-3 py-2" placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)}/><input className="rounded-lg border border-slate-300 px-3 py-2" placeholder="Code (optional)" value={code} onChange={(e) => setCode(e.target.value)}/><input className="rounded-lg border border-slate-300 px-3 py-2" placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)}/></div><div className="mt-3 flex justify-end gap-2"><button className="app-btn-secondary" onClick={() => setShowAdd(false)}>Cancel</button><button className="app-btn-primary" disabled={saving || !name.trim()} onClick={() => void saveProject()}>{saving ? "Saving…" : "Create project"}</button></div></section>}
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Projects" value={String(projects.filter((project) => project.status === "active").length)} icon={Briefcase}/><Metric label="Income" value={money(totals.income)} icon={BarChart3}/><Metric label="Expenditure" value={money(totals.expense)} icon={BarChart3}/><Metric label="Net result" value={money(totals.net)} icon={BarChart3}/></section>
    <section className="rounded-xl border border-slate-200 bg-white p-4"><label className="text-sm font-semibold text-slate-700">Report scope</label><select className="ml-3 rounded-lg border border-slate-300 px-3 py-2 text-sm" value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}><option value="all">All projects (consolidated)</option><option value="unassigned">Unassigned transactions</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}</select></section>
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-200 p-4"><h2 className="font-bold">Income and expenditure allocation</h2><p className="text-xs text-slate-500">Invoices are treated as project income; Spend Money entries are treated as project expenditure.</p></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="p-3 text-left">Date</th><th className="p-3 text-left">Type</th><th className="p-3 text-left">Description</th><th className="p-3 text-right">Amount</th><th className="p-3 text-left">Project</th></tr></thead><tbody>{filtered.map((entry) => <tr key={`${entry.table}-${entry.id}`} className="border-t border-slate-100"><td className="p-3">{entry.date}</td><td className="p-3 capitalize">{entry.kind}</td><td className="p-3">{entry.description}</td><td className="p-3 text-right font-semibold">{money(entry.amount)}</td><td className="p-3"><select className="rounded border border-slate-300 px-2 py-1.5" value={entry.project_id || ""} onChange={(e) => void assignProject(entry, e.target.value)}><option value="">Unassigned</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}</select></td></tr>)}{!filtered.length && <tr><td colSpan={5} className="p-8 text-center text-slate-500">No transactions in this scope.</td></tr>}</tbody></table></div></section>
  </div>;
}

function Metric({ label, value, icon: Icon }: { label: string; value: string; icon: typeof BarChart3 }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between text-slate-500"><span className="text-xs font-semibold uppercase tracking-wide">{label}</span><Icon className="h-5 w-5 text-brand-700"/></div><p className="mt-3 text-2xl font-bold text-slate-900">{value}</p></div>;
}
