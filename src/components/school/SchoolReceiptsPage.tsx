import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PageNotes } from "@/components/common/PageNotes";
import { SchoolFeeReceiptPreviewModal } from "@/components/school/SchoolFeeReceiptPreviewModal";
import { loadSchoolFeeReceiptDetail, type SchoolFeeReceiptDetail } from "@/lib/schoolFeeReceipt";

type Row = {
  id: string;
  receipt_number: string;
  issued_at: string;
  delivery_channels: string[] | null;
  school_payment_id: string;
};

type Props = { readOnly?: boolean };

export function SchoolReceiptsPage({ readOnly: _readOnly }: Props) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDetail, setPreviewDetail] = useState<SchoolFeeReceiptDetail | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    if (!orgId) {
      setLoading(false);
      return;
    }
    const { data, error } = await supabase.from("school_receipts").select("*").eq("organization_id", orgId).order("issued_at", { ascending: false });
    setErr(error?.message || null);
    setRows((data as Row[]) || []);
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const openReceiptPreview = async (receiptId: string) => {
    if (!orgId) return;
    setPreviewOpen(true);
    setPreviewDetail(null);
    setPreviewLoading(true);
    setErr(null);
    const res = await loadSchoolFeeReceiptDetail(receiptId, orgId);
    setPreviewLoading(false);
    if ("error" in res) {
      setErr(res.error);
      setPreviewOpen(false);
      return;
    }
    setPreviewDetail(res.detail);
  };

  const closePreview = () => {
    setPreviewOpen(false);
    setPreviewDetail(null);
    setPreviewLoading(false);
  };

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-900">Receipts</h1>
        <PageNotes ariaLabel="Receipts">
          <p>
            Issued for each fee payment. Click a receipt number to preview; use Print, PDF, or Excel (CSV) from the
            preview.
          </p>
        </PageNotes>
      </div>
      {err && <p className="text-red-600 text-sm">{err}</p>}
      <div className="rounded-xl border border-slate-200 overflow-x-auto bg-white">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left p-3 font-semibold text-slate-700">Receipt #</th>
              <th className="text-left p-3 font-semibold text-slate-700">Issued</th>
              <th className="text-left p-3 font-semibold text-slate-700">Channels</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={3} className="p-6 text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={3} className="p-6 text-slate-500">
                  No receipts yet — record a fee payment to generate one.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => void openReceiptPreview(r.id)}
                      className="font-mono text-sky-700 hover:text-sky-900 hover:underline text-left"
                    >
                      {r.receipt_number}
                    </button>
                  </td>
                  <td className="p-3 text-slate-700">{new Date(r.issued_at).toLocaleString()}</td>
                  <td className="p-3 text-slate-600">{(r.delivery_channels || []).join(", ") || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {previewOpen && (
        <SchoolFeeReceiptPreviewModal detail={previewDetail} loading={previewLoading} onClose={closePreview} />
      )}
    </div>
  );
}
