import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Pencil, Trash2, Loader2, FileText, Printer } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { getPosLabels } from "../lib/posExperience";
import { ReadOnlyNotice } from "./common/ReadOnlyNotice";
import { PageNotes } from "./common/PageNotes";
import { desktopApi } from "../lib/desktopApi";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export type RetailCustomerRow = {
  id: string;
  organization_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  manufacturing_customer_type_id?: string | null;
  created_at: string;
  updated_at: string;
};

type CustomerSaleRow = {
  id: string;
  customer_id: string | null;
  sale_at: string;
  total_amount: number | null;
  net_amount_due: number | null;
  sale_status: string | null;
};

type CustomerPaymentRow = {
  id: string;
  retail_customer_id: string | null;
  transaction_id: string | null;
  amount: number | null;
  paid_at: string | null;
  payment_status: string | null;
};

type StatementLine = { id: string; date: string; description: string; debit: number; credit: number; balance: number };

export function RetailCustomersPage({
  readOnly = false,
  highlightCustomerId,
}: {
  readOnly?: boolean;
  /** Open edit modal for this customer (e.g. from Invoices). */
  highlightCustomerId?: string;
}) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const posL = getPosLabels(user?.business_type === "clinic" ? "pharmacy" : "retail");

  const [rows, setRows] = useState<RetailCustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<RetailCustomerRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [debtFilter, setDebtFilter] = useState<"all" | "with_debt" | "no_debt">("all");
  const [customerSales, setCustomerSales] = useState<CustomerSaleRow[]>([]);
  const [customerPayments, setCustomerPayments] = useState<CustomerPaymentRow[]>([]);
  const [statementCustomer, setStatementCustomer] = useState<RetailCustomerRow | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [customerTypeId, setCustomerTypeId] = useState("");
  const [customerTypes, setCustomerTypes] = useState<Array<{ id: string; name: string }>>([]);
  const highlightOpenedRef = useRef<string | null>(null);
  const localAuthEnabled = ["true", "1", "yes"].includes((import.meta.env.VITE_LOCAL_AUTH || "").trim().toLowerCase());
  const useDesktopLocalMode = localAuthEnabled && desktopApi.isAvailable();

  const load = useCallback(async () => {
    if (!orgId && !useDesktopLocalMode) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    if (useDesktopLocalMode) {
      try {
        const data = await desktopApi.listRetailCustomers();
        setRows((data || []) as RetailCustomerRow[]);
        setCustomerSales([]);
        setCustomerPayments([]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load local customers.");
        setRows([]);
      } finally {
        setLoading(false);
      }
      return;
    }
    const [{ data, error: e }, salesResult, paymentsResult] = await Promise.all([
      sb.from("retail_customers").select("*").eq("organization_id", orgId).order("name"),
      sb.from("retail_sales").select("id,customer_id,sale_at,total_amount,net_amount_due,sale_status").eq("organization_id", orgId),
      sb.from("payments").select("id,retail_customer_id,transaction_id,amount,paid_at,payment_status").eq("organization_id", orgId),
    ]);
    if (e) {
      setError(e.message);
      setRows([]);
    } else {
      setRows((data || []) as RetailCustomerRow[]);
      setCustomerSales((salesResult.data || []) as CustomerSaleRow[]);
      setCustomerPayments((paymentsResult.data || []) as CustomerPaymentRow[]);
    }
    setLoading(false);
  }, [orgId, useDesktopLocalMode]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (user?.business_type !== "manufacturing" || !orgId || useDesktopLocalMode) {
      setCustomerTypes([]);
      return;
    }
    void sb
      .from("manufacturing_customer_types")
      .select("id,name")
      .eq("organization_id", orgId)
      .order("name")
      .then(({ data }: { data?: Array<{ id: string; name: string }> }) => setCustomerTypes(data || []));
  }, [orgId, user?.business_type, useDesktopLocalMode]);

  const openNew = () => {
    setEditing(null);
    setName("");
    setEmail("");
    setPhone("");
    setAddress("");
    setNotes("");
    setCustomerTypeId("");
    setShowModal(true);
  };

  const openEdit = useCallback((r: RetailCustomerRow) => {
    setEditing(r);
    setName(r.name);
    setEmail(r.email || "");
    setPhone(r.phone || "");
    setAddress(r.address || "");
    setNotes(r.notes || "");
    setCustomerTypeId(r.manufacturing_customer_type_id || "");
    setShowModal(true);
  }, []);

  useEffect(() => {
    highlightOpenedRef.current = null;
  }, [highlightCustomerId]);

  useEffect(() => {
    if (!highlightCustomerId || rows.length === 0) return;
    if (highlightOpenedRef.current === highlightCustomerId) return;
    const r = rows.find((x) => x.id === highlightCustomerId);
    if (r) {
      openEdit(r);
      highlightOpenedRef.current = highlightCustomerId;
    }
  }, [highlightCustomerId, rows, openEdit]);

  const save = async () => {
    if ((!orgId && !useDesktopLocalMode) || readOnly) return;
    if (!name.trim()) {
      alert("Name is required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        notes: notes.trim() || null,
        ...(user?.business_type === "manufacturing"
          ? { manufacturing_customer_type_id: customerTypeId || null }
          : {}),
      };
      if (useDesktopLocalMode) {
        if (editing) {
          const row = await desktopApi.updateRetailCustomer({ id: editing.id, ...payload });
          if (!row) throw new Error("Failed to update local customer.");
        } else {
          const row = await desktopApi.createRetailCustomer(payload);
          if (!row) throw new Error("Failed to create local customer.");
        }
        setShowModal(false);
        await load();
        return;
      }
      if (editing) {
        const { error: e } = await sb.from("retail_customers").update(payload).eq("id", editing.id);
        if (e) throw e;
      } else {
        const { error: e } = await sb.from("retail_customers").insert({ ...payload, organization_id: orgId });
        if (e) throw e;
      }
      setShowModal(false);
      await load();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to save customer.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r: RetailCustomerRow) => {
    if (readOnly) return;
    if (!confirm(`Delete customer “${r.name}”? Invoices linked to this customer will keep their snapshot text.`)) return;
    if (useDesktopLocalMode) {
      const res = await desktopApi.deleteRetailCustomer(r.id);
      if (!res?.ok) {
        alert("Failed to delete local customer.");
        return;
      }
      await load();
      return;
    }
    const { error: e } = await sb.from("retail_customers").delete().eq("id", r.id);
    if (e) {
      alert(e.message);
      return;
    }
    await load();
  };

  const debtByCustomerId = (() => {
    const balances = new Map<string, number>();
    const saleCustomerById = new Map<string, string>();
    for (const sale of customerSales) {
      if (!sale.customer_id || ["refunded", "reversed", "void"].includes(String(sale.sale_status || "").toLowerCase())) continue;
      saleCustomerById.set(sale.id, sale.customer_id);
      balances.set(sale.customer_id, (balances.get(sale.customer_id) || 0) + Number(sale.net_amount_due ?? sale.total_amount ?? 0));
    }
    for (const payment of customerPayments) {
      if (payment.payment_status !== "completed") continue;
      const customerId = payment.retail_customer_id || (payment.transaction_id ? saleCustomerById.get(payment.transaction_id) : null);
      if (!customerId) continue;
      balances.set(customerId, (balances.get(customerId) || 0) - Number(payment.amount || 0));
    }
    for (const [customerId, balance] of balances) balances.set(customerId, Math.max(0, Math.round(balance * 100) / 100));
    return balances;
  })();

  const statementLines = (customer: RetailCustomerRow): StatementLine[] => {
    const saleIds = new Set<string>();
    const entries: Array<Omit<StatementLine, "balance"> & { order: number }> = [];
    for (const sale of customerSales) {
      if (sale.customer_id !== customer.id || ["refunded", "reversed", "void"].includes(String(sale.sale_status || "").toLowerCase())) continue;
      saleIds.add(sale.id);
      entries.push({ id: `sale-${sale.id}`, date: sale.sale_at, description: `POS sale ${sale.id.slice(0, 8)}`, debit: Number(sale.net_amount_due ?? sale.total_amount ?? 0), credit: 0, order: 0 });
    }
    for (const payment of customerPayments) {
      if (payment.payment_status !== "completed") continue;
      if (payment.retail_customer_id !== customer.id && (!payment.transaction_id || !saleIds.has(payment.transaction_id))) continue;
      entries.push({ id: `payment-${payment.id}`, date: payment.paid_at || "", description: payment.transaction_id ? `Payment for ${payment.transaction_id.slice(0, 8)}` : "Customer payment", debit: 0, credit: Number(payment.amount || 0), order: 1 });
    }
    entries.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
    let balance = 0;
    return entries.map(({ order: _order, ...entry }) => {
      balance = Math.max(0, Math.round((balance + entry.debit - entry.credit) * 100) / 100);
      return { ...entry, balance };
    });
  };

  const printStatement = (customer: RetailCustomerRow) => {
    const lines = statementLines(customer);
    const doc = window.open("", "_blank", "width=760,height=800");
    if (!doc) return alert("Allow popups to print the customer statement.");
    const rowsHtml = lines.map((line) => `<tr><td>${line.date ? new Date(line.date).toLocaleDateString() : "-"}</td><td>${line.description}</td><td class="num">${line.debit.toFixed(2)}</td><td class="num">${line.credit.toFixed(2)}</td><td class="num">${line.balance.toFixed(2)}</td></tr>`).join("");
    doc.document.write(`<html><head><title>Customer Statement</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#0f172a}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{padding:8px;border-bottom:1px solid #cbd5e1;text-align:left}.num{text-align:right}</style></head><body><h2>Customer Statement</h2><p><strong>${customer.name}</strong></p><p>${customer.phone || customer.email || ""}</p><table><thead><tr><th>Date</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead><tbody>${rowsHtml || '<tr><td colspan="5">No transactions.</td></tr>'}</tbody></table></body></html>`);
    doc.document.close();
    doc.focus();
    doc.print();
  };

  if (!orgId && !useDesktopLocalMode) {
    return (
      <div className="p-6 md:p-8">
        <p className="text-slate-600">Link your staff account to an organization to manage customers.</p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">{posL.retailCustomersListPageTitle}</h1>
            <PageNotes ariaLabel={posL.retailCustomersListHelpAria}>
              <p>{posL.retailCustomersListBlurb}</p>
            </PageNotes>
          </div>
        </div>
        <button type="button" onClick={openNew} disabled={readOnly} className="app-btn-primary text-sm self-start">
          <Plus className="w-4 h-4" />
          {posL.addPayerAccountButton}
        </button>
      </div>

      {readOnly && <ReadOnlyNotice />}

      {error ? <p className="text-red-600 text-sm">{error}</p> : null}

      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        <div className="app-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Email</th>
                <th className="text-left p-3">Phone</th>
                <th className="text-left p-3">Address</th>
                {user?.business_type === "manufacturing" ? <th className="text-left p-3">Customer type</th> : null}
                <th className="text-left p-3 w-48">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={user?.business_type === "manufacturing" ? 6 : 5} className="p-8 text-center text-slate-500">
                    No customers yet. Add one to pick them in invoices.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="p-3 font-medium">{r.name}</td>
                    <td className="p-3">{r.email || "—"}</td>
                    <td className="p-3">{r.phone || "—"}</td>
                    <td className="p-3 max-w-xs truncate">{r.address || "—"}</td>
                    {user?.business_type === "manufacturing" ? (
                      <td className="p-3">
                        {customerTypes.find((type) => type.id === r.manufacturing_customer_type_id)?.name || "Retail"}
                      </td>
                    ) : null}
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(r)}
                          disabled={readOnly}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-xs disabled:opacity-50"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(r)}
                          disabled={readOnly}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-red-700 bg-red-50 hover:bg-red-100 text-xs disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">{editing ? "Edit customer" : "New customer"}</h2>
              <button type="button" className="text-slate-500 hover:text-slate-800" onClick={() => !saving && setShowModal(false)}>
                ✕
              </button>
            </div>
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="text-slate-600">Name *</span>
                <input
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={readOnly}
                />
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">Email</span>
                <input
                  type="email"
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={readOnly}
                />
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">Phone</span>
                <input
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  disabled={readOnly}
                />
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">Address</span>
                <textarea
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  rows={2}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  disabled={readOnly}
                />
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">Notes</span>
                <textarea
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={readOnly}
                />
              </label>
              {user?.business_type === "manufacturing" ? (
                <label className="block text-sm">
                  <span className="text-slate-600">Customer type</span>
                  <select
                    className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                    value={customerTypeId}
                    onChange={(e) => setCustomerTypeId(e.target.value)}
                    disabled={readOnly}
                  >
                    <option value="">Retail / standard price</option>
                    {customerTypes.map((type) => (
                      <option key={type.id} value={type.id}>{type.name}</option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="app-btn-secondary" onClick={() => !saving && setShowModal(false)}>
                Cancel
              </button>
              <button type="button" className="app-btn-primary" disabled={readOnly || saving} onClick={() => void save()}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
