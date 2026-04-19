import { useEffect, useState } from "react";
import { Plus, Edit2, CheckCircle, Clock, Save, X, Trash2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { filterByOrganizationId } from "../../lib/supabaseOrgFilter";
import { randomUuid } from "../../lib/randomUuid";
import { PageNotes } from "../common/PageNotes";

interface Requisition {
  id: string;
  request_date: string | null;
  from_location: string | null;
  to_location: string | null;
  status: string | null;
  note: string | null;
}

interface Product {
  id: string;
  name: string;
  track_inventory?: boolean | null;
}

interface Department {
  id: string;
  name: string;
}

interface RequisitionItemRow {
  id: string;
  product_id: string;
  quantity: string;
}

export function StoreRequisitionsPage({ highlightRequisitionId }: { highlightRequisitionId?: string }) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const [requisitions, setRequisitions] = useState<Requisition[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [requestDate, setRequestDate] = useState(new Date().toISOString().slice(0, 10));
  const [fromLocation, setFromLocation] = useState("store");
  const [toLocation, setToLocation] = useState("bar");
  const [note, setNote] = useState("");
  const [itemRows, setItemRows] = useState<RequisitionItemRow[]>([
    { id: randomUuid(), product_id: "", quantity: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);

  useEffect(() => {
    fetchRequisitions();
    filterByOrganizationId(
      supabase.from("products").select("id, name, track_inventory").order("name"),
      orgId,
      superAdmin
    )
      .then(({ data }) => {
        setProducts((data || []) as Product[]);
      });
    filterByOrganizationId(
      supabase.from("departments").select("id, name").order("name"),
      orgId,
      superAdmin
    )
      .then(({ data }) => {
        setDepartments((data || []) as Department[]);
      });
  }, [orgId, superAdmin]);

  const fetchRequisitions = async () => {
    setLoading(true);
    const { data, error } = await filterByOrganizationId(
      supabase
        .from("store_requisitions")
        .select("id, request_date, from_location, to_location, status, note")
        .order("request_date", { ascending: false }),
      orgId,
      superAdmin
    );
    if (error) {
      console.error("Error loading store_requisitions:", error);
      setLoading(false);
      return;
    }
    setRequisitions((data || []) as Requisition[]);
    setLoading(false);
  };

  const openNew = () => {
    setEditingId(null);
    setRequestDate(new Date().toISOString().slice(0, 10));
    setFromLocation("store");
    setToLocation("bar");
    setNote("");
    setItemRows([{ id: randomUuid(), product_id: "", quantity: "" }]);
    setShowModal(true);
  };

  const openEdit = async (id: string) => {
    const { data: header } = await filterByOrganizationId(
      supabase
        .from("store_requisitions")
        .select("request_date, from_location, to_location, note")
        .eq("id", id),
      orgId,
      superAdmin
    ).single();
    const { data: items } = await filterByOrganizationId(
      supabase
        .from("store_requisition_items")
        .select("product_id, quantity")
        .eq("requisition_id", id),
      orgId,
      superAdmin
    );

    setEditingId(id);
    setRequestDate((header?.request_date as string) || new Date().toISOString().slice(0, 10));
    setFromLocation((header?.from_location as string) || "store");
    setToLocation((header?.to_location as string) || "bar");
    setNote((header?.note as string) || "");
    setItemRows(
      (items || []).length > 0
        ? (items || []).map((it: any) => ({
            id: randomUuid(),
            product_id: it.product_id,
            quantity: String(it.quantity ?? ""),
          }))
        : [{ id: randomUuid(), product_id: "", quantity: "" }]
    );
    setShowModal(true);
  };

  const addItemRow = () => {
    setItemRows((prev) => [...prev, { id: randomUuid(), product_id: "", quantity: "" }]);
  };

  const updateItemRow = (id: string, patch: Partial<RequisitionItemRow>) => {
    setItemRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  };

  const removeItemRow = (id: string) => {
    setItemRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)));
  };

  const handleSave = async () => {
    const validItems = itemRows.filter(
      (r) => r.product_id && Number(r.quantity) > 0
    );
    if (validItems.length === 0) {
      alert("Add at least one product with a quantity.");
      return;
    }
    setSaving(true);
    try {
      let requisitionId = editingId;
      if (editingId) {
        const { error } = await supabase
          .from("store_requisitions")
          .update({
            request_date: requestDate,
            from_location: fromLocation,
            to_location: toLocation,
            note: note.trim() || null,
          })
          .eq("id", editingId);
        if (error) throw error;
        await supabase
          .from("store_requisition_items")
          .delete()
          .eq("requisition_id", editingId);
      } else {
        const { data, error } = await supabase
          .from("store_requisitions")
          .insert({
            request_date: requestDate,
            from_location: fromLocation,
            to_location: toLocation,
            note: note.trim() || null,
            status: "pending",
            requested_by: user?.id ?? null,
          })
          .select("id")
          .single();
        if (error) throw error;
        requisitionId = (data as any).id as string;
      }

      const itemPayload = validItems.map((r) => ({
        requisition_id: requisitionId,
        product_id: r.product_id,
        quantity: Number(r.quantity),
      }));
      const { error: itemsError } = await supabase
        .from("store_requisition_items")
        .insert(itemPayload);
      if (itemsError) throw itemsError;

      setShowModal(false);
      await fetchRequisitions();
    } catch (e) {
      console.error(e);
      alert("Failed to save requisition.");
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async (id: string) => {
    try {
      const { data: header, error: hErr } = await filterByOrganizationId(
        supabase
          .from("store_requisitions")
          .select("from_location, to_location")
          .eq("id", id),
        orgId,
        superAdmin
      ).single();
      if (hErr) throw hErr;

      const { data: items, error: iErr } = await filterByOrganizationId(
        supabase
          .from("store_requisition_items")
          .select("product_id, quantity")
          .eq("requisition_id", id),
        orgId,
        superAdmin
      );
      if (iErr) throw iErr;
      if (!items || items.length === 0) {
        alert("This requisition has no items.");
        return;
      }

      const fromLoc = (header?.from_location as string) || "store";
      const toLoc = (header?.to_location as string) || "bar";
      const nowIso = new Date().toISOString();

      const movements: any[] = [];
      (items || []).forEach((it: any) => {
        const qty = Number(it.quantity) || 0;
        if (qty <= 0) return;
        movements.push(
          {
            product_id: it.product_id,
            movement_date: nowIso,
            source_type: "transfer",
            source_id: id,
            quantity_in: 0,
            quantity_out: qty,
            location: fromLoc,
            unit_cost: null,
            note: `Requisition ${fromLoc} → ${toLoc}`,
          },
          {
            product_id: it.product_id,
            movement_date: nowIso,
            source_type: "transfer",
            source_id: id,
            quantity_in: qty,
            quantity_out: 0,
            location: toLoc,
            unit_cost: null,
            note: `Requisition ${fromLoc} → ${toLoc}`,
          }
        );
      });

      if (movements.length > 0) {
        const { error: mErr } = await supabase
          .from("product_stock_movements")
          .insert(movements);
        if (mErr) throw mErr;
      }

      const { error: uErr } = await supabase
        .from("store_requisitions")
        .update({
          status: "approved",
          approved_by: user?.id ?? null,
          approved_at: nowIso,
        })
        .eq("id", id);
      if (uErr) throw uErr;

      await fetchRequisitions();
    } catch (e) {
      console.error(e);
      alert("Failed to approve requisition.");
    }
  };

  return (
    <div className="p-6 md:p-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">Store Requisitions</h1>
            <PageNotes ariaLabel="Store requisitions help">
              <p>Move stock from store to bar and other locations.</p>
            </PageNotes>
          </div>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-2 bg-brand-700 text-white px-4 py-2 rounded-lg hover:bg-brand-800"
        >
          <Plus className="w-4 h-4" />
          New Requisition
        </button>
      </div>

      {loading ? (
        <div className="text-slate-500">Loading…</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="p-3 text-left">Date</th>
                <th className="p-3 text-left">From</th>
                <th className="p-3 text-left">To</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-left">Note</th>
                <th className="p-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {requisitions.map((r) => (
                <tr
                  key={r.id}
                  className={`border-t border-slate-100 ${
                    highlightRequisitionId && r.id === highlightRequisitionId
                      ? "bg-amber-50 ring-1 ring-amber-300"
                      : ""
                  }`}
                >
                  <td className="p-3">{r.request_date || "—"}</td>
                  <td className="p-3 capitalize">{r.from_location || "store"}</td>
                  <td className="p-3 capitalize">{r.to_location || "bar"}</td>
                  <td className="p-3">
                    {r.status === "approved" ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-medium">
                        <CheckCircle className="w-4 h-4" /> Approved
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-600 text-xs font-medium">
                        <Clock className="w-4 h-4" /> {r.status || "pending"}
                      </span>
                    )}
                  </td>
                  <td className="p-3">{r.note || "—"}</td>
                  <td className="p-3 text-center">
                    {r.status === "pending" && (
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(r.id)}
                          className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800"
                        >
                          <Edit2 className="w-4 h-4" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApprove(r.id)}
                          className="inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-900"
                        >
                          <CheckCircle className="w-4 h-4" />
                          Approve
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {requisitions.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-500">
                    No store requisitions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 space-y-4">
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-xl font-semibold text-slate-900">
                {editingId ? "Edit Store Requisition" : "New Store Requisition"}
              </h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="p-1 rounded hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-wrap gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Date</label>
                <input
                  type="date"
                  className="border rounded-lg px-3 py-2"
                  value={requestDate}
                  onChange={(e) => setRequestDate(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">From</label>
                <select
                  className="border rounded-lg px-3 py-2"
                  value={fromLocation}
                  onChange={(e) => setFromLocation(e.target.value)}
                >
                  <option value="store">Store</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.name.toLowerCase()}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">To</label>
                <select
                  className="border rounded-lg px-3 py-2"
                  value={toLocation}
                  onChange={(e) => setToLocation(e.target.value)}
                >
                  <option value="store">Store</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.name.toLowerCase()}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Note (optional)</label>
              <input
                className="border rounded-lg px-3 py-2 w-full"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            <div className="border rounded-lg">
              <div className="flex justify-between items-center px-3 py-2 bg-slate-50 border-b">
                <span className="text-sm font-medium text-slate-700">Items</span>
                <button
                  type="button"
                  onClick={addItemRow}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  <Plus className="w-3 h-3" />
                  Add row
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="p-2 text-left">Product</th>
                      <th className="p-2 text-right w-32">Quantity</th>
                      <th className="p-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemRows.map((r) => (
                      <tr key={r.id} className="border-t border-slate-100">
                        <td className="p-2">
                          <select
                            className="border rounded-lg px-2 py-1 w-full"
                            value={r.product_id}
                            onChange={(e) =>
                              updateItemRow(r.id, { product_id: e.target.value })
                            }
                          >
                            <option value="">Select product</option>
                            {products
                              .filter((p) => p.track_inventory ?? true)
                              .map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                          </select>
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            className="border rounded-lg px-2 py-1 w-full text-right"
                            value={r.quantity}
                            min={0}
                            onChange={(e) =>
                              updateItemRow(r.id, { quantity: e.target.value })
                            }
                          />
                        </td>
                        <td className="p-2 text-center">
                          <button
                            type="button"
                            onClick={() => removeItemRow(r.id)}
                            className="p-1 text-slate-500 hover:text-red-600"
                            title="Remove row"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-4 py-2 border rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-brand-700 text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

