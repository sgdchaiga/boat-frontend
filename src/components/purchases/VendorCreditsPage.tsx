import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { canApprove } from "../../lib/approvalRights";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";
import { PageNotes } from "../common/PageNotes";
import { createJournalForVendorCredit } from "../../lib/journal";

interface VendorCredit {
  id: string;
  vendor_id?: string | null;
  amount?: number | null;
  reason?: string | null;
  credit_date?: string | null;
  created_at?: string;
  vendors?: { name: string } | null;
}

interface VendorCreditsPageProps {
  readOnly?: boolean;
}

export function VendorCreditsPage({ readOnly = false }: VendorCreditsPageProps = {}) {
  const { user } = useAuth();
  const canAddVendorCredit = canApprove("vendor_credits", user?.role);
  const [credits, setCredits] = useState<VendorCredit[]>([]);
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [vendorId, setVendorId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [creditDate, setCreditDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [credRes, venRes] = await Promise.all([
        supabase.from("vendor_credits").select("*, vendors(name)").order("credit_date", { ascending: false }),
        supabase.from("vendors").select("id, name").order("name"),
      ]);
      if (credRes.error) throw credRes.error;
      setCredits(credRes.data || []);
      setVendors(venRes.data || []);
    } catch (e) {
      console.error("Error fetching vendor credits:", e);
      setCredits([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (readOnly) return;
    if (!vendorId) {
      alert("Select a vendor.");
      return;
    }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      alert("Enter a valid credit amount.");
      return;
    }
    setSaving(true);
    try {
      const { data: inserted, error } = await supabase
        .from("vendor_credits")
        .insert({
          vendor_id: vendorId,
          amount: amt,
          reason: reason.trim() || null,
          credit_date: creditDate || new Date().toISOString().slice(0, 10),
        })
        .select("id, credit_date")
        .single();
      if (error) throw error;
      if (inserted) {
        const jr = await createJournalForVendorCredit(
          (inserted as { id: string }).id,
          amt,
          (inserted as { credit_date?: string }).credit_date || creditDate || new Date().toISOString().slice(0, 10),
          reason.trim() || null,
          user?.id ?? null
        );
        if (!jr.ok) {
          alert(`Credit saved but journal was not posted: ${jr.error}`);
        }
      }
      setShowModal(false);
      setVendorId("");
      setAmount("");
      setReason("");
      setCreditDate(new Date().toISOString().slice(0, 10));
      fetchData();
    } catch (e) {
      console.error("Error adding vendor credit:", e);
      alert("Failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 md:p-8">
      {readOnly && (
        <ReadOnlyNotice />
      )}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">Return to supplier</h1>
            <PageNotes ariaLabel="Vendor credits help">
              <p>Record returns, refunds, and credits from suppliers.</p>
            </PageNotes>
          </div>
        </div>
        {(canAddVendorCredit || !readOnly) && (
          <button type="button" onClick={() => !readOnly && setShowModal(true)} disabled={readOnly} className="bg-brand-700 hover:bg-brand-800 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg flex items-center gap-2">
            <Plus className="w-5 h-5" /> Add return / credit
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-slate-500 py-4">Loading…</p>
      ) : (
        <div className="app-card overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left p-3">Date</th>
                <th className="text-left p-3">Vendor</th>
                <th className="text-left p-3">Reason</th>
                <th className="text-right p-3">Amount</th>
              </tr>
            </thead>
            <tbody>
              {credits.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="p-3">{c.credit_date ? new Date(c.credit_date).toLocaleDateString() : "—"}</td>
                  <td className="p-3">{c.vendors?.name || "—"}</td>
                  <td className="p-3">{c.reason || "—"}</td>
                  <td className="p-3 text-right font-medium text-green-700">{Number(c.amount || 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {credits.length === 0 && <p className="p-8 text-center text-slate-500">No returns or credits yet.</p>}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !saving && setShowModal(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">Add return / credit</h2>
              <button type="button" onClick={() => !saving && setShowModal(false)}><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Vendor *</label>
                <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="w-full border rounded-lg px-3 py-2">
                  <option value="">Select vendor</option>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Credit Amount *</label>
                <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full border rounded-lg px-3 py-2" placeholder="0.00" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Credit Date</label>
                <input type="date" value={creditDate} onChange={(e) => setCreditDate(e.target.value)} className="w-full border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Reason</label>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="w-full border rounded-lg px-3 py-2" placeholder="e.g. Return of goods, Overpayment refund" />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button type="button" onClick={handleAdd} disabled={readOnly || saving} className="app-btn-primary flex-1 py-2">{saving ? "Saving…" : "Save"}</button>
              <button type="button" onClick={() => !saving && setShowModal(false)} className="px-4 py-2 border rounded-lg hover:bg-slate-50">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
