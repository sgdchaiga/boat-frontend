import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
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
  created_at: string;
  updated_at: string;
};

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

  const [rows, setRows] = useState<RetailCustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<RetailCustomerRow | null>(null);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
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
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load local customers.");
        setRows([]);
      } finally {
        setLoading(false);
      }
      return;
    }
    const { data, error: e } = await sb.from("retail_customers").select("*").eq("organization_id", orgId).order("name");
    if (e) {
      setError(e.message);
      setRows([]);
    } else {
      setRows((data || []) as RetailCustomerRow[]);
    }
    setLoading(false);
  }, [orgId, useDesktopLocalMode]);

  useEffect(() => {
    void load();
  }, [load]);

  const openNew = () => {
    setEditing(null);
    setName("");
    setEmail("");
    setPhone("");
    setAddress("");
    setNotes("");
    setShowModal(true);
  };

  const openEdit = useCallback((r: RetailCustomerRow) => {
    setEditing(r);
    setName(r.name);
    setEmail(r.email || "");
    setPhone(r.phone || "");
    setAddress(r.address || "");
    setNotes(r.notes || "");
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
            <h1 className="text-3xl font-bold text-slate-900">Customers</h1>
            <PageNotes ariaLabel="Retail customers help">
              <p>Sales customers used when creating invoices.</p>
            </PageNotes>
          </div>
        </div>
        <button type="button" onClick={openNew} disabled={readOnly} className="app-btn-primary text-sm self-start">
          <Plus className="w-4 h-4" />
          Add customer
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
                <th className="text-left p-3 w-48">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-slate-500">
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
