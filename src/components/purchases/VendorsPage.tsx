import { useEffect, useRef, useState } from "react";
import { GitMerge, Pencil, Plus, X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { enqueueSyncOutbox } from "../../lib/syncOutbox";
import { PageNotes } from "../common/PageNotes";
import { randomUuid } from "../../lib/randomUuid";
import { useAuth } from "../../contexts/AuthContext";

interface Vendor {
  id: string;
  name: string;
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  created_at?: string;
}

interface VendorWithFinance extends Vendor {
  billAmount: number;
  payments: number;
  returns: number;
  balance: number;
}

function formatErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const err = e as { message?: string; details?: string; hint?: string; error?: string };
    return err.message || err.details || err.hint || err.error || JSON.stringify(err);
  }
  return String(e);
}

function fmtMoney(n: number) {
  return Number.isFinite(n)
    ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00";
}

export function VendorsPage({ highlightVendorId }: { highlightVendorId?: string }) {
  const { user, isSuperAdmin } = useAuth();
  const [vendors, setVendors] = useState<VendorWithFinance[]>([]);
  const [loading, setLoading] = useState(true);
  const highlightRef = useRef<HTMLTableRowElement | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [masterVendorId, setMasterVendorId] = useState("");
  const [selectedVendorIds, setSelectedVendorIds] = useState<string[]>([]);
  const [merging, setMerging] = useState(false);
  const role = String(user?.role || "").trim().toLowerCase();
  const canMerge = Boolean(isSuperAdmin || user?.isSuperAdmin || role === "admin" || role === "super_admin");

  useEffect(() => {
    void fetchVendors();
  }, []);

  useEffect(() => {
    if (!highlightVendorId || vendors.length === 0) return;
    const t = setTimeout(() => {
      highlightRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 100);
    return () => clearTimeout(t);
  }, [highlightVendorId, vendors]);

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setContactName("");
    setEmail("");
    setPhone("");
    setAddress("");
  };

  const openAdd = () => {
    resetForm();
    setShowModal(true);
  };

  const openEdit = (v: Vendor) => {
    setEditingId(v.id);
    setName(v.name);
    setContactName(v.contact_name || "");
    setEmail(v.email || "");
    setPhone(v.phone || "");
    setAddress(v.address || "");
    setShowModal(true);
  };

  const selectedVendors = vendors.filter((vendor) => selectedVendorIds.includes(vendor.id));

  const toggleVendorSelection = (vendorId: string) => {
    setSelectedVendorIds((current) => current.includes(vendorId)
      ? current.filter((id) => id !== vendorId)
      : [...current, vendorId]);
  };

  const openMerge = () => {
    if (selectedVendorIds.length < 2) return;
    setMasterVendorId("");
    setShowMergeModal(true);
  };

  const handleMerge = async () => {
    const duplicates = selectedVendorIds.filter((id) => id !== masterVendorId);
    if (!masterVendorId || duplicates.length === 0) {
      alert("Choose which selected supplier record to keep as the master.");
      return;
    }
    const master = vendors.find((vendor) => vendor.id === masterVendorId);
    if (!master) return;
    if (!window.confirm(`Merge ${duplicates.length} selected supplier record${duplicates.length === 1 ? "" : "s"} into master “${master.name}”? All bills, payments, credits, and other linked records will be retained under the master. This cannot be undone.`)) return;
    setMerging(true);
    try {
      const { error } = await supabase.rpc("merge_multiple_vendors", {
        p_master_vendor_id: masterVendorId,
        p_duplicate_vendor_ids: duplicates,
      });
      if (error) throw error;
      setShowMergeModal(false);
      setSelectedVendorIds([]);
      await fetchVendors();
    } catch (e) {
      console.error("Vendor merge failed:", e);
      alert("Merge failed: " + formatErrorMessage(e));
    } finally {
      setMerging(false);
    }
  };

  const fetchVendors = async () => {
    setLoading(true);
    try {
      const [venRes, billsRes, payRes, credRes] = await Promise.all([
        supabase.from("vendors").select("*").order("name"),
        supabase.from("bills").select("vendor_id, amount"),
        supabase.from("vendor_payments").select("vendor_id, amount"),
        supabase.from("vendor_credits").select("vendor_id, amount"),
      ]);

      if (venRes.error) throw venRes.error;

      const billSum = new Map<string, number>();
      for (const r of billsRes.data || []) {
        const row = r as { vendor_id?: string | null; amount?: number | null };
        if (!row.vendor_id) continue;
        billSum.set(row.vendor_id, (billSum.get(row.vendor_id) || 0) + Number(row.amount ?? 0));
      }

      const paySum = new Map<string, number>();
      if (!payRes.error) {
        for (const r of payRes.data || []) {
          const row = r as { vendor_id?: string | null; amount?: number | null };
          if (!row.vendor_id) continue;
          paySum.set(row.vendor_id, (paySum.get(row.vendor_id) || 0) + Number(row.amount ?? 0));
        }
      } else {
        console.warn("vendor_payments:", payRes.error.message);
      }

      const retSum = new Map<string, number>();
      if (!credRes.error) {
        for (const r of credRes.data || []) {
          const row = r as { vendor_id?: string | null; amount?: number | null };
          if (!row.vendor_id) continue;
          retSum.set(row.vendor_id, (retSum.get(row.vendor_id) || 0) + Number(row.amount ?? 0));
        }
      } else {
        console.warn("vendor_credits:", credRes.error.message);
      }

      const rows: VendorWithFinance[] = (venRes.data || []).map((v: Vendor) => {
        const b = billSum.get(v.id) || 0;
        const p = paySum.get(v.id) || 0;
        const ret = retSum.get(v.id) || 0;
        return {
          ...v,
          billAmount: b,
          payments: p,
          returns: ret,
          balance: b - p - ret,
        };
      });

      setVendors(rows);
      setSelectedVendorIds((current) => current.filter((id) => rows.some((vendor) => vendor.id === id)));
    } catch (e) {
      console.error("Error fetching vendors:", e);
      setVendors([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      alert("Enter vendor name.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        contact_name: contactName.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
      };

      if (editingId) {
        const { error } = await supabase.from("vendors").update(payload).eq("id", editingId);
        if (error) throw error;
        try {
          await enqueueSyncOutbox(supabase, {
            tableName: "vendors",
            operation: "UPDATE",
            recordId: editingId,
            payload: { id: editingId, ...payload } as Record<string, unknown>,
          });
        } catch (syncErr) {
          console.warn("Vendor updated but sync queue enqueue failed:", syncErr);
        }
      } else {
        const newId = randomUuid();
        const insertPayload = { id: newId, ...payload };
        const { error } = await supabase.from("vendors").insert(insertPayload);
        if (error) throw error;
        try {
          await enqueueSyncOutbox(supabase, {
            tableName: "vendors",
            operation: "INSERT",
            recordId: newId,
            payload: insertPayload as Record<string, unknown>,
          });
        } catch (syncErr) {
          console.warn("Vendor saved but sync queue enqueue failed:", syncErr);
        }
      }
      setShowModal(false);
      resetForm();
      void fetchVendors();
    } catch (e) {
      console.error("Error saving vendor:", e);
      alert("Failed: " + formatErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 md:p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">Vendors</h1>
            <PageNotes ariaLabel="Vendors help">
              <p>Manage supplier contacts and view bills, payments, returns, and balance.</p>
            </PageNotes>
          </div>
        </div>
        <div className="flex gap-2">
          {canMerge && <button type="button" onClick={openMerge} disabled={selectedVendorIds.length < 2} className="border border-brand-200 text-brand-700 hover:bg-brand-50 disabled:opacity-50 px-4 py-2 rounded-lg flex items-center gap-2"><GitMerge className="w-5 h-5" />Merge selected{selectedVendorIds.length ? ` (${selectedVendorIds.length})` : ""}</button>}
          <button
            type="button"
            onClick={openAdd}
            className="bg-brand-700 hover:bg-brand-800 text-white px-4 py-2 rounded-lg flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Add Vendor
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-slate-500 py-4">Loading…</p>
      ) : (
        <div className="app-card overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                {canMerge && <th className="p-3 w-10"><input type="checkbox" aria-label="Select all suppliers" checked={vendors.length > 0 && selectedVendorIds.length === vendors.length} onChange={(event) => setSelectedVendorIds(event.target.checked ? vendors.map((vendor) => vendor.id) : [])} /></th>}
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Contact</th>
                <th className="text-left p-3">Email</th>
                <th className="text-left p-3">Phone</th>
                <th className="text-right p-3 whitespace-nowrap">Bill amount</th>
                <th className="text-right p-3 whitespace-nowrap">Payments</th>
                <th className="text-right p-3 whitespace-nowrap">Returns</th>
                <th className="text-right p-3 whitespace-nowrap">Balance</th>
                <th className="text-right p-3 w-24"> </th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => (
                <tr
                  key={v.id}
                  ref={highlightVendorId === v.id ? highlightRef : undefined}
                  className={`border-t ${highlightVendorId === v.id ? "bg-emerald-50 ring-1 ring-emerald-200" : ""}`}
                >
                  {canMerge && <td className="p-3"><input type="checkbox" aria-label={`Select ${v.name} for merge`} checked={selectedVendorIds.includes(v.id)} onChange={() => toggleVendorSelection(v.id)} /></td>}
                  <td className="p-3 font-medium">{v.name}</td>
                  <td className="p-3">{v.contact_name || "—"}</td>
                  <td className="p-3">{v.email || "—"}</td>
                  <td className="p-3">{v.phone || "—"}</td>
                  <td className="p-3 text-right tabular-nums">{fmtMoney(v.billAmount)}</td>
                  <td className="p-3 text-right tabular-nums">{fmtMoney(v.payments)}</td>
                  <td className="p-3 text-right tabular-nums text-emerald-800">{fmtMoney(v.returns)}</td>
                  <td className="p-3 text-right tabular-nums font-medium">{fmtMoney(v.balance)}</td>
                  <td className="p-3 text-right">
                    <button
                      type="button"
                      onClick={() => openEdit(v)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-brand-700 border border-brand-200 rounded-md hover:bg-brand-50"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {vendors.length === 0 && (
            <p className="p-8 text-center text-slate-500">No vendors yet. Add one to get started.</p>
          )}
        </div>
      )}

      {showModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => {
            if (!saving) {
              setShowModal(false);
              resetForm();
            }
          }}
        >
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">{editingId ? "Edit vendor" : "Add Vendor"}</h2>
              <button
                type="button"
                onClick={() => {
                  if (!saving) {
                    setShowModal(false);
                    resetForm();
                  }
                }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Vendor Name *</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="e.g. ABC Supplies"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Contact Person</label>
                <input value={contactName} onChange={(e) => setContactName(e.target.value)} className="w-full border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Phone</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Address</label>
                <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} className="w-full border rounded-lg px-3 py-2" />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button type="button" onClick={() => void handleSave()} disabled={saving} className="app-btn-primary flex-1 py-2">
                {saving ? "Saving…" : editingId ? "Save changes" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!saving) {
                    setShowModal(false);
                    resetForm();
                  }
                }}
                className="px-4 py-2 border rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showMergeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !merging && setShowMergeModal(false)}>
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between"><h2 className="text-xl font-bold">Merge selected suppliers</h2><button type="button" onClick={() => !merging && setShowMergeModal(false)}><X className="h-5 w-5" /></button></div>
            <p className="mb-4 text-sm text-slate-600">Choose the one supplier record to keep. Every bill, payment, credit, and other linked record on the remaining selected suppliers will move to it, then those duplicate records are removed.</p>
            <label className="mb-3 block text-sm font-medium">Master supplier (keep)<select value={masterVendorId} onChange={(event) => setMasterVendorId(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="">Choose the record to keep</option>{selectedVendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}{vendor.created_at ? ` — created ${new Date(vendor.created_at).toLocaleDateString()}` : ""}</option>)}</select></label>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm"><p className="font-medium text-slate-800">Selected suppliers ({selectedVendors.length})</p><ul className="mt-2 space-y-1 text-slate-600">{selectedVendors.map((vendor) => <li key={vendor.id} className={vendor.id === masterVendorId ? "font-semibold text-emerald-700" : ""}>{vendor.name}{vendor.id === masterVendorId ? " — keep this record" : " — merge into master"}</li>)}</ul></div>
            <div className="mt-6 flex gap-2"><button type="button" onClick={() => void handleMerge()} disabled={merging || !masterVendorId} className="app-btn-primary flex-1 py-2 disabled:opacity-50">{merging ? "Merging…" : `Merge ${Math.max(0, selectedVendors.length - 1)} record${selectedVendors.length - 1 === 1 ? "" : "s"}`}</button><button type="button" onClick={() => !merging && setShowMergeModal(false)} className="rounded-lg border px-4 py-2 hover:bg-slate-50">Cancel</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
