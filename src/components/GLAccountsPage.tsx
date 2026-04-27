import { useEffect, useMemo, useState } from "react";
import { Plus, Edit2, CheckCircle2, XCircle, Save } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { canApprove } from "../lib/approvalRights";
import { PageNotes } from "./common/PageNotes";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";

type GLAccount = {
  id: string;
  account_code: string;
  account_name: string;
  account_type: "asset" | "liability" | "equity" | "income" | "expense";
  category: string | null;
  parent_id: string | null;
  is_active: boolean;
  created_at: string;
};

const ACCOUNT_TYPES: GLAccount["account_type"][] = [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
];

const CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "None" },
  { value: "revenue", label: "Revenue" },
  { value: "cash", label: "Cash" },
  { value: "receivable", label: "Receivable" },
  { value: "expense", label: "Expense" },
  { value: "payable", label: "Payable" },
  { value: "inventory", label: "Inventory" },
  { value: "cogs", label: "Cost of sales" },
  { value: "other", label: "Other" },
];

export function GLAccountsPage() {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const localAuthEnabled = ["true", "1", "yes"].includes((import.meta.env.VITE_LOCAL_AUTH || "").trim().toLowerCase());
  const roleKey = String(user?.role || "").toLowerCase();
  const localDesktopRoleCanManage = localAuthEnabled && ["admin", "manager", "accountant"].includes(roleKey);
  const canManageChartOfAccounts = localAuthEnabled || localDesktopRoleCanManage || canApprove("chart_of_accounts", user?.role);
  const [accounts, setAccounts] = useState<GLAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<GLAccount | null>(null);

  const [form, setForm] = useState({
    account_code: "",
    account_name: "",
    account_type: "income" as GLAccount["account_type"],
    category: "",
    parent_id: "",
    is_active: true,
  });

  useEffect(() => {
    fetchAccounts();
  }, []);

  const fetchAccounts = async () => {
    setLoading(true);
    let q = supabase
      .from("gl_accounts")
      .select("*")
      .order("account_code");
    if (!localAuthEnabled) {
      q = filterByOrganizationId(q, orgId, superAdmin);
    }
    const { data, error } = await q;

    if (error) {
      console.error("Error loading gl_accounts:", error);
      setLoading(false);
      return;
    }

    const normalized = ((data || []) as Array<Record<string, unknown>>).map((row) => {
      const typeRaw = String(row.account_type ?? row.type ?? "income").toLowerCase();
      const accountType: GLAccount["account_type"] = ["asset", "liability", "equity", "income", "expense"].includes(typeRaw)
        ? (typeRaw as GLAccount["account_type"])
        : "income";
      return {
        id: String(row.id ?? ""),
        account_code: String(row.account_code ?? row.code ?? ""),
        account_name: String(row.account_name ?? row.name ?? ""),
        account_type: accountType,
        category: row.category == null ? null : String(row.category),
        parent_id: row.parent_id == null ? null : String(row.parent_id),
        is_active: Boolean(row.is_active ?? true),
        created_at: String(row.created_at ?? new Date().toISOString()),
      } as GLAccount;
    });
    setAccounts(normalized);
    setLoading(false);
  };

  const openNew = () => {
    if (!canManageChartOfAccounts) return;
    setEditing(null);
    setForm({
      account_code: "",
      account_name: "",
      account_type: "income",
      category: "",
      parent_id: "",
      is_active: true,
    });
    setShowForm(true);
  };

  const openEdit = (acc: GLAccount) => {
    if (!canManageChartOfAccounts) return;
    const cat = (acc.category || "").toLowerCase();
    const matchedCategory = CATEGORY_OPTIONS.find((o) => o.value && o.value === cat)?.value ?? "";
    setEditing(acc);
    setForm({
      account_code: acc.account_code,
      account_name: acc.account_name,
      account_type: acc.account_type,
      category: matchedCategory || (acc.category || ""),
      parent_id: acc.parent_id || "",
      is_active: acc.is_active,
    });
    setShowForm(true);
  };

  const saveAccount = async () => {
    if (!canManageChartOfAccounts) {
      return;
    }
    if (!form.account_code || !form.account_name) {
      alert("Enter account code and name");
      return;
    }

    const payload = {
      account_code: form.account_code,
      account_name: form.account_name,
      account_type: form.account_type,
      category: form.category || null,
      parent_id: form.parent_id || null,
      is_active: form.is_active,
    };

    if (editing) {
      const { error } = await supabase
        .from("gl_accounts")
        .update(payload)
        .eq("id", editing.id);
      if (error) {
        console.error(error);
        alert(error.message);
        return;
      }
    } else {
      const { error } = await supabase.from("gl_accounts").insert({
        ...payload,
        organization_id: orgId ?? null,
      });
      if (error) {
        console.error(error);
        alert(error.message);
        return;
      }
    }

    setShowForm(false);
    fetchAccounts();
  };

  const toggleActive = async (acc: GLAccount) => {
    if (!canManageChartOfAccounts) return;
    const { error } = await supabase
      .from("gl_accounts")
      .update({ is_active: !acc.is_active })
      .eq("id", acc.id);
    if (error) {
      console.error(error);
      alert(error.message);
      return;
    }
    fetchAccounts();
  };

  const filteredAccounts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((acc) => {
      const haystack = [
        acc.account_code,
        acc.account_name,
        acc.account_type,
        acc.category || "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [accounts, searchQuery]);

  if (loading) {
    return <div className="p-6 md:p-8">Loading Chart of Accounts...</div>;
  }

  return (
    <div className="p-6 md:p-8">
      {/* HEADER */}
      <div className="flex justify-between mb-8">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold">Chart of Accounts</h1>
            <PageNotes ariaLabel="Chart of accounts help">
              <p>Manage GL accounts used for sales, purchases, and stock.</p>
            </PageNotes>
          </div>
        </div>
        {canManageChartOfAccounts && (
          <button
            onClick={openNew}
            className="bg-brand-700 text-white px-4 py-2 rounded-lg flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Add Account
          </button>
        )}
      </div>

      {/* TABLE */}
      <div className="mb-3">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by code, name, type, or category"
          className="w-full md:w-96 border border-slate-300 rounded-lg px-3 py-2 text-sm"
        />
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="p-2 text-left">Code</th>
              <th className="p-2 text-left">Name</th>
              <th className="p-2 text-left">Type</th>
              <th className="p-2 text-left">Category</th>
              <th className="p-2 text-center">Active</th>
              <th className="p-2 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredAccounts.map((acc) => (
              <tr key={acc.id} className="border-t border-slate-200">
                <td className="p-2 font-mono">{acc.account_code}</td>
                <td className="p-2">{acc.account_name}</td>
                <td className="p-2 capitalize">{acc.account_type}</td>
                <td className="p-2">{acc.category || ""}</td>
                <td className="p-2 text-center">
                  {acc.is_active ? (
                    <CheckCircle2 className="w-4 h-4 text-green-600 inline-block" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-600 inline-block" />
                  )}
                </td>
                <td className="p-2 text-center">
                  {canManageChartOfAccounts ? (
                    <>
                      <button
                        onClick={() => openEdit(acc)}
                        className="text-blue-600 inline-flex items-center gap-1 mr-3"
                      >
                        <Edit2 className="w-4 h-4" />
                        Edit
                      </button>
                      <button
                        onClick={() => toggleActive(acc)}
                        className="text-slate-600 text-xs"
                      >
                        {acc.is_active ? "Deactivate" : "Activate"}
                      </button>
                    </>
                  ) : (
                    <span className="text-slate-400 text-xs italic">View only</span>
                  )}
                </td>
              </tr>
            ))}
            {filteredAccounts.length === 0 && (
              <tr>
                <td
                  className="p-4 text-center text-slate-500"
                  colSpan={6}
                >
                  {accounts.length === 0
                    ? "No GL accounts yet. Click \"Add Account\" to create one."
                    : "No accounts match your search."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* FORM MODAL */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-xl w-full max-w-md space-y-4">
            <h2 className="text-xl font-bold">
              {editing ? "Edit GL Account" : "Add GL Account"}
            </h2>

            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-sm font-medium mb-1 block">
                    Code
                  </label>
                  <input
                    className="border w-full p-2 rounded"
                    placeholder="4000"
                    value={form.account_code}
                    onChange={(e) =>
                      setForm({ ...form, account_code: e.target.value })
                    }
                  />
                </div>
                <div className="flex-1">
                  <label className="text-sm font-medium mb-1 block">
                    Type
                  </label>
                  <select
                    className="border w-full p-2 rounded"
                    value={form.account_type}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        account_type: e.target.value as GLAccount["account_type"],
                      })
                    }
                  >
                    {ACCOUNT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">
                  Name
                </label>
                <input
                  className="border w-full p-2 rounded"
                  placeholder="Sales - Food"
                  value={form.account_name}
                  onChange={(e) =>
                    setForm({ ...form, account_name: e.target.value })
                  }
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">
                  Category (optional)
                </label>
                <select
                  className="border w-full p-2 rounded"
                  value={CATEGORY_OPTIONS.some((o) => o.value === form.category) ? form.category : ""}
                  onChange={(e) =>
                    setForm({ ...form, category: e.target.value })
                  }
                >
                  {CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value || "none"} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm font-medium mb-1 block">
                  Parent Account (optional)
                </label>
                <select
                  className="border w-full p-2 rounded"
                  value={form.parent_id}
                  onChange={(e) =>
                    setForm({ ...form, parent_id: e.target.value })
                  }
                >
                  <option value="">None</option>
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.account_code} - {acc.account_name}
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) =>
                    setForm({ ...form, is_active: e.target.checked })
                  }
                />
                <span>Active</span>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 border rounded"
              >
                Cancel
              </button>
              <button
                onClick={saveAccount}
                className="px-4 py-2 bg-brand-700 text-white rounded flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

