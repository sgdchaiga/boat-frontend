import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { formatPaymentMethodLabel } from "../lib/paymentMethod";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";
import { type PaymentWithCustomer } from "../lib/billingShared";
import { isPosCashReceipt } from "../lib/paymentClassification";
import { ReadOnlyNotice } from "./common/ReadOnlyNotice";
import { PageNotes } from "./common/PageNotes";
import { SourceDocumentsCell } from "./common/SourceDocumentsCell";

interface CashReceiptsPageProps {
  readOnly?: boolean;
}

type SortKey = "transaction_id" | "amount" | "payment_method" | "paid_at";

function baseSaleOrOrderId(raw: string | null | undefined): string {
  if (raw == null) return "";
  const s = String(raw);
  const tag = "[REFUND_REASON:";
  if (s.includes(tag)) return s.slice(0, s.indexOf(tag)).trim();
  return s.trim();
}

function formatSupabaseError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const err = e as { message?: string; details?: string; hint?: string };
    const parts = [err.message, err.details, err.hint].filter(Boolean);
    if (parts.length) return parts.join(" — ");
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export function CashReceiptsPage({ readOnly = false }: CashReceiptsPageProps) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!user?.isSuperAdmin;
  const [rows, setRows] = useState<PaymentWithCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const res = await filterByOrganizationId(
        supabase.from("payments").select("*").order("paid_at", { ascending: false }),
        orgId ?? undefined,
        superAdmin
      );
      if (res.error) throw res.error;
      const all = (res.data || []) as unknown as PaymentWithCustomer[];
      setRows(all.filter((p) => isPosCashReceipt(p)));
    } catch (e) {
      setError(formatSupabaseError(e));
      console.error("Cash receipts:", e);
    } finally {
      setLoading(false);
    }
  }, [orgId, superAdmin]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const { key, dir } = sort;
    const m = dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      let cmp = 0;
      switch (key) {
        case "transaction_id":
          cmp = (a.transaction_id || "").localeCompare(b.transaction_id || "");
          break;
        case "amount":
          cmp = Number(a.amount) - Number(b.amount);
          break;
        case "payment_method":
          cmp = (a.payment_method || "").localeCompare(b.payment_method || "");
          break;
        case "paid_at":
          cmp = new Date(a.paid_at).getTime() - new Date(b.paid_at).getTime();
          break;
        default:
          cmp = 0;
      }
      return cmp * m;
    });
  }, [rows, sort]);

  const toggleSort = (key: SortKey) => {
    setSort((prev) => {
      if (prev?.key === key) return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      const defaultDesc = key === "amount" || key === "paid_at";
      return { key, dir: defaultDesc ? "desc" : "asc" };
    });
  };

  const SortIcon = ({ active, dir }: { active: boolean; dir: "asc" | "desc" }) => {
    if (!active) return <ArrowUpDown className="w-4 h-4 text-slate-400 shrink-0" aria-hidden />;
    return dir === "asc" ? (
      <ArrowUp className="w-4 h-4 text-slate-800 shrink-0" aria-hidden />
    ) : (
      <ArrowDown className="w-4 h-4 text-slate-800 shrink-0" aria-hidden />
    );
  };

  const th = (key: SortKey, label: string, align: "left" | "right" = "left") => (
    <th className={`${align === "right" ? "text-right" : "text-left"} p-0`}>
      <button
        type="button"
        onClick={() => toggleSort(key)}
        className={`w-full flex items-center gap-1.5 p-3 font-semibold text-slate-700 hover:bg-slate-100 transition ${
          align === "right" ? "justify-end" : "justify-start"
        }`}
      >
        {label}
        <SortIcon active={sort?.key === key} dir={sort?.dir ?? "asc"} />
      </button>
    </th>
  );

  const total = useMemo(
    () => rows.filter((p) => p.payment_status === "completed").reduce((s, p) => s + Number(p.amount), 0),
    [rows]
  );

  if (loading) {
    return <div className="p-6">Loading...</div>;
  }

  return (
    <div className="p-6 md:p-8">
      {readOnly && <ReadOnlyNotice />}

      <div className="mb-8">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold">Cash receipts</h1>
          <PageNotes ariaLabel="Cash receipts help">
            <p>
              Immediate takings from <strong>Point of sale</strong> (pay now). Invoice balances, guest folio payments, and other debtor receipts are on{" "}
              <strong>Debtor payments</strong>.
            </p>
          </PageNotes>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}

      <div className="bg-white p-6 rounded-xl border mb-6 max-w-md">
        <div className="flex items-center gap-2 mb-2">
          <Banknote className="w-5 h-5 text-emerald-600" />
          <p>Point of sale total (completed)</p>
        </div>
        <p className="text-2xl font-bold">{total.toFixed(2)}</p>
      </div>

      {rows.length === 0 ? (
        <p className="text-slate-500 py-6 border border-dashed border-slate-200 rounded-lg px-4">
          No cash receipts yet. Pay-now sales from <strong>Point of sale</strong> appear here automatically.
        </p>
      ) : (
        <table className="w-full border">
          <thead className="bg-slate-50">
            <tr>
              {th("paid_at", "Date")}
              {th("transaction_id", "Order / sale ref")}
              {th("amount", "Amount", "right")}
              {th("payment_method", "Method")}
              <th className="text-left p-3 font-semibold text-slate-700">Docs</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="p-3 whitespace-nowrap">{new Date(p.paid_at).toLocaleString()}</td>
                <td className="p-3 font-mono text-xs break-all max-w-[14rem]">
                  {baseSaleOrOrderId(p.transaction_id) || "—"}
                </td>
                <td className="p-3 text-right tabular-nums">{Number(p.amount).toFixed(2)}</td>
                <td className="p-3">{formatPaymentMethodLabel(p.payment_method)}</td>
                <td className="p-3 align-top">
                  <SourceDocumentsCell
                    table="payments"
                    recordId={p.id}
                    organizationId={p.organization_id ?? orgId}
                    rawDocuments={p.source_documents}
                    readOnly={readOnly}
                    onUpdated={fetchData}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
