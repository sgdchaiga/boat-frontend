import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, ArrowUp, ArrowDown, ArrowUpDown, Plus, ShoppingCart, UtensilsCrossed } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { createJournalForPayment } from "../lib/journal";
import {
  formatPaymentMethodLabel,
  insertPaymentWithMethodCompat,
  PAYMENT_METHOD_SELECT_OPTIONS,
  type PaymentMethodCode,
} from "../lib/paymentMethod";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";
import { type PaymentWithCustomer } from "../lib/billingShared";
import { isPosCashReceipt } from "../lib/paymentClassification";
import { ReadOnlyNotice } from "./common/ReadOnlyNotice";
import { PageNotes } from "./common/PageNotes";
import { SourceDocumentsCell } from "./common/SourceDocumentsCell";

interface CashReceiptsPageProps {
  readOnly?: boolean;
  /** From App URL / navigate state (hotel checkout prefill) */
  pageState?: Record<string, unknown>;
  onNavigate?: (page: string, state?: Record<string, unknown>) => void;
}

function buildDebtorTransactionNumber(paymentDate: string): string {
  const ymd = (paymentDate || new Date().toISOString().slice(0, 10)).replace(/-/g, "");
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `DBT-${ymd}-${suffix}`;
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

export function CashReceiptsPage({
  readOnly = false,
  pageState,
  onNavigate,
}: CashReceiptsPageProps) {
  const { user } = useAuth();
  const businessType = user?.business_type ?? null;
  const showHotelPosShortcut =
    businessType === "hotel" || businessType === "restaurant" || businessType === "mixed";
  const showRetailPosShortcut = businessType === "retail" || businessType === "mixed";
  const orgId = user?.organization_id ?? null;
  const superAdmin = !!user?.isSuperAdmin;
  const [rows, setRows] = useState<PaymentWithCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);
  const [reversingId, setReversingId] = useState<string | null>(null);
  const [editingPayment, setEditingPayment] = useState<PaymentWithCustomer | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editMethod, setEditMethod] = useState<PaymentMethodCode>("cash");
  const [editDate, setEditDate] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [productFilter, setProductFilter] = useState("all");
  const [txDepartments, setTxDepartments] = useState<Record<string, string[]>>({});
  const [txProducts, setTxProducts] = useState<Record<string, string[]>>({});
  const [departmentOptions, setDepartmentOptions] = useState<string[]>([]);
  const [productOptions, setProductOptions] = useState<string[]>([]);
  const role = (user?.role || "").toLowerCase();
  const [canEditCashReceiptsByRole, setCanEditCashReceiptsByRole] = useState<boolean>(!!user?.isSuperAdmin);
  const canReverse = canEditCashReceiptsByRole;

  const isHotelCheckout = String(pageState?.crSource ?? "") === "hotel_checkout";

  const [hotelAmount, setHotelAmount] = useState("");
  const [hotelMethod, setHotelMethod] = useState<PaymentMethodCode>("cash");
  const [hotelDate, setHotelDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [hotelReference, setHotelReference] = useState("");
  const [hotelGuestName, setHotelGuestName] = useState("");
  const [hotelDescription, setHotelDescription] = useState("");
  const [hotelGuestId, setHotelGuestId] = useState("");
  const [hotelStayId, setHotelStayId] = useState("");
  const [hotelSaving, setHotelSaving] = useState(false);

  useEffect(() => {
    if (!isHotelCheckout) return;
    setHotelGuestId(String(pageState?.crGuestId ?? ""));
    setHotelGuestName(String(pageState?.crGuestName ?? ""));
    const a = pageState?.crAmount;
    const num = typeof a === "number" ? a : parseFloat(String(a ?? ""));
    setHotelAmount(Number.isFinite(num) && num > 0 ? String(num) : "");
    setHotelReference(String(pageState?.crReference ?? ""));
    setHotelDescription(String(pageState?.crDescription ?? ""));
    setHotelStayId(String(pageState?.crStayId ?? ""));
    setHotelDate(new Date().toISOString().slice(0, 10));
  }, [
    isHotelCheckout,
    pageState?.crGuestId,
    pageState?.crAmount,
    pageState?.crReference,
    pageState?.crDescription,
    pageState?.crGuestName,
    pageState?.crStayId,
  ]);

  const clearHotelCheckoutState = () => {
    onNavigate?.("cash_receipts", {});
  };

  const saveHotelGuestPayment = async () => {
    if (readOnly || !onNavigate) return;
    if (!hotelGuestId.trim()) {
      alert("Guest is not linked to this payment. Open the stay from Active stays and try again.");
      return;
    }
    const amt = parseFloat(hotelAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      alert("Enter a valid amount.");
      return;
    }
    setHotelSaving(true);
    try {
      const { data: staffRow } = await supabase.from("staff").select("id").eq("id", user?.id).maybeSingle();
      const dateStr = hotelDate.trim() || new Date().toISOString().slice(0, 10);
      const paidAtIso = new Date(`${dateStr}T12:00:00`).toISOString();
      const txId = hotelReference.trim() || buildDebtorTransactionNumber(dateStr);

      const insertPayload: Record<string, unknown> = {
        stay_id: hotelStayId.trim() || null,
        property_customer_id: hotelGuestId.trim(),
        payment_source: "debtor",
        ...(orgId ? { organization_id: orgId } : {}),
        amount: amt,
        payment_status: "completed",
        paid_at: paidAtIso,
        transaction_id: txId,
        processed_by: staffRow?.id ?? null,
      };

      const { data: inserted, error } = await insertPaymentWithMethodCompat(supabase, insertPayload, hotelMethod);
      if (error) throw error;
      if (!inserted?.id) throw new Error("Payment insert returned no row.");

      const paidAt = (inserted as { paid_at?: string }).paid_at ?? paidAtIso;
      const jr = await createJournalForPayment(String(inserted.id), amt, paidAt, user?.id ?? null);
      if (!jr.ok) {
        alert(`Payment saved but journal was not posted: ${jr.error}`);
      }

      const gid = hotelGuestId.trim();
      onNavigate("stays", { highlightGuestId: gid });
    } catch (e) {
      alert(`Could not save payment: ${formatSupabaseError(e)}`);
    } finally {
      setHotelSaving(false);
    }
  };

  useEffect(() => {
    const loadRolePermission = async () => {
      if (superAdmin) {
        setCanEditCashReceiptsByRole(true);
        return;
      }
      if (!orgId || !role) {
        setCanEditCashReceiptsByRole(false);
        return;
      }
      const { data, error } = await supabase
        .from("staff_permission_overrides")
        .select("allowed")
        .eq("organization_id", orgId)
        .eq("staff_id", user?.id ?? "")
        .eq("permission_key", "cash_receipts_edit")
        .maybeSingle();
      if (error && user?.id) {
        console.error("Cash receipts permission lookup failed:", error);
        setCanEditCashReceiptsByRole(false);
        return;
      }
      if (typeof data?.allowed === "boolean") {
        setCanEditCashReceiptsByRole(!!data.allowed);
        return;
      }
      const rolePerm = await supabase
        .from("organization_permissions")
        .select("allowed")
        .eq("organization_id", orgId)
        .eq("role_key", role)
        .eq("permission_key", "cash_receipts_edit")
        .maybeSingle();
      if (rolePerm.error) {
        console.error("Cash receipts role permission lookup failed:", rolePerm.error);
        setCanEditCashReceiptsByRole(false);
        return;
      }
      setCanEditCashReceiptsByRole(!!rolePerm.data?.allowed);
    };
    void loadRolePermission();
  }, [orgId, role, superAdmin, user?.id]);

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
      const posRows = all.filter((p) => isPosCashReceipt(p));
      setRows(posRows);

      const txIds = Array.from(
        new Set(
          posRows
            .map((p) => baseSaleOrOrderId(p.transaction_id))
            .filter((v) => v.length > 0)
        )
      );
      if (txIds.length === 0) {
        setTxDepartments({});
        setTxProducts({});
        setDepartmentOptions([]);
        setProductOptions([]);
        return;
      }

      const [retailLinesRes, kitchenItemsRes, productsRes, departmentsRes] = await Promise.all([
        supabase
          .from("retail_sale_lines")
          .select("sale_id,description,product_id,department_id")
          .in("sale_id", txIds),
        supabase.from("kitchen_order_items").select("order_id,product_id").in("order_id", txIds),
        supabase.from("products").select("id,name,department_id"),
        supabase.from("departments").select("id,name"),
      ]);

      const departmentById = new Map(
        ((departmentsRes.data || []) as Array<{ id: string; name: string }>).map((d) => [d.id, d.name])
      );
      const productRows = (productsRes.data || []) as Array<{ id: string; name: string; department_id: string | null }>;
      const productById = new Map(productRows.map((p) => [p.id, p]));

      const depMap: Record<string, Set<string>> = {};
      const prodMap: Record<string, Set<string>> = {};
      const ensure = (tx: string) => {
        if (!depMap[tx]) depMap[tx] = new Set<string>();
        if (!prodMap[tx]) prodMap[tx] = new Set<string>();
      };

      ((retailLinesRes.data || []) as Array<{
        sale_id: string | null;
        description: string | null;
        product_id: string | null;
        department_id: string | null;
      }>).forEach((line) => {
        const tx = String(line.sale_id || "");
        if (!tx) return;
        ensure(tx);
        const p = line.product_id ? productById.get(line.product_id) : null;
        const depName = line.department_id
          ? departmentById.get(line.department_id) || "Unassigned"
          : p?.department_id
            ? departmentById.get(p.department_id) || "Unassigned"
            : "Unassigned";
        depMap[tx].add(depName);
        const prodName = p?.name || line.description || "Item";
        prodMap[tx].add(prodName);
      });

      ((kitchenItemsRes.data || []) as Array<{ order_id: string | null; product_id: string | null }>).forEach((line) => {
        const tx = String(line.order_id || "");
        if (!tx) return;
        ensure(tx);
        const p = line.product_id ? productById.get(line.product_id) : null;
        if (p?.department_id) {
          depMap[tx].add(departmentById.get(p.department_id) || "Unassigned");
        } else {
          depMap[tx].add("Unassigned");
        }
        prodMap[tx].add(p?.name || "Item");
      });

      const flatDeps = new Set<string>();
      const flatProducts = new Set<string>();
      Object.values(depMap).forEach((set) => set.forEach((v) => flatDeps.add(v)));
      Object.values(prodMap).forEach((set) => set.forEach((v) => flatProducts.add(v)));

      setTxDepartments(
        Object.fromEntries(Object.entries(depMap).map(([k, v]) => [k, Array.from(v)]))
      );
      setTxProducts(
        Object.fromEntries(Object.entries(prodMap).map(([k, v]) => [k, Array.from(v)]))
      );
      setDepartmentOptions(Array.from(flatDeps).sort((a, b) => a.localeCompare(b)));
      setProductOptions(Array.from(flatProducts).sort((a, b) => a.localeCompare(b)));
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

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      const tx = baseSaleOrOrderId(r.transaction_id);
      if (dateFrom && new Date(r.paid_at).getTime() < new Date(`${dateFrom}T00:00:00`).getTime()) return false;
      if (dateTo && new Date(r.paid_at).getTime() > new Date(`${dateTo}T23:59:59`).getTime()) return false;
      if (departmentFilter !== "all") {
        const deps = txDepartments[tx] || [];
        if (!deps.includes(departmentFilter)) return false;
      }
      if (productFilter !== "all") {
        const products = txProducts[tx] || [];
        if (!products.includes(productFilter)) return false;
      }
      return true;
    });
  }, [rows, dateFrom, dateTo, departmentFilter, productFilter, txDepartments, txProducts]);

  const sorted = useMemo(() => {
    if (!sort) return filteredRows;
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
  }, [filteredRows, sort]);

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
    () => filteredRows.filter((p) => p.payment_status === "completed").reduce((s, p) => s + Number(p.amount), 0),
    [filteredRows]
  );

  const reverseReceipt = async (payment: PaymentWithCustomer) => {
    if (readOnly || !canReverse) return;
    if (payment.payment_status !== "completed") return;
    const ok = window.confirm(
      `Reverse cash receipt ${baseSaleOrOrderId(payment.transaction_id) || payment.id.slice(0, 8)} for ${Number(
        payment.amount
      ).toFixed(2)}?`
    );
    if (!ok) return;
    try {
      setReversingId(payment.id);
      const nextDocs =
        payment.source_documents && typeof payment.source_documents === "object"
          ? {
              ...(payment.source_documents as Record<string, unknown>),
              reversal: {
                reversed_at: new Date().toISOString(),
                reversed_by: user?.id ?? null,
                reversed_from_payment_id: payment.id,
              },
            }
          : {
              reversal: {
                reversed_at: new Date().toISOString(),
                reversed_by: user?.id ?? null,
                reversed_from_payment_id: payment.id,
              },
            };
      const { error } = await supabase
        .from("payments")
        .update({
          payment_status: "refunded",
          edited_at: new Date().toISOString(),
          edited_by_staff_id: user?.id ?? null,
          edited_by_name: user?.email ?? null,
          source_documents: nextDocs,
        })
        .eq("id", payment.id);
      if (error) throw error;
      await fetchData();
    } catch (e) {
      const msg = formatSupabaseError(e);
      if (msg.toLowerCase().includes("row-level security") || msg.toLowerCase().includes("permission denied")) {
        alert("You are not authorized to reverse cash receipts.");
      } else {
        alert(`Failed to reverse receipt: ${msg}`);
      }
    } finally {
      setReversingId(null);
    }
  };

  const openEditModal = (payment: PaymentWithCustomer) => {
    if (!canEditCashReceiptsByRole) {
      alert("You are not authorized to edit cash receipts.");
      return;
    }
    setEditingPayment(payment);
    setEditAmount(String(Number(payment.amount || 0)));
    setEditMethod((payment.payment_method as PaymentMethodCode) || "cash");
    setEditDate(new Date(payment.paid_at).toISOString().slice(0, 10));
  };

  const saveReceiptEdit = async () => {
    if (!editingPayment) return;
    if (!canEditCashReceiptsByRole) {
      alert("You are not authorized to edit cash receipts.");
      return;
    }
    const amount = Number(editAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      alert("Enter a valid amount.");
      return;
    }
    setSavingEdit(true);
    try {
      const nextDocs =
        editingPayment.source_documents && typeof editingPayment.source_documents === "object"
          ? {
              ...(editingPayment.source_documents as Record<string, unknown>),
              receipt_edit: {
                edited_at: new Date().toISOString(),
                edited_by: user?.id ?? null,
                previous_amount: editingPayment.amount,
                previous_method: editingPayment.payment_method,
                previous_paid_at: editingPayment.paid_at,
              },
            }
          : {
              receipt_edit: {
                edited_at: new Date().toISOString(),
                edited_by: user?.id ?? null,
                previous_amount: editingPayment.amount,
                previous_method: editingPayment.payment_method,
                previous_paid_at: editingPayment.paid_at,
              },
            };
      const { error } = await supabase
        .from("payments")
        .update({
          amount,
          payment_method: editMethod,
          paid_at: `${editDate}T12:00:00`,
          edited_at: new Date().toISOString(),
          edited_by_staff_id: user?.id ?? null,
          edited_by_name: user?.email ?? null,
          source_documents: nextDocs,
        })
        .eq("id", editingPayment.id);
      if (error) throw error;
      setEditingPayment(null);
      await fetchData();
    } catch (e) {
      const msg = formatSupabaseError(e);
      if (msg.toLowerCase().includes("row-level security") || msg.toLowerCase().includes("permission denied")) {
        alert("You are not authorized to edit cash receipts.");
      } else {
        alert(`Failed to edit receipt: ${msg}`);
      }
    } finally {
      setSavingEdit(false);
    }
  };

  if (loading) {
    return <div className="p-6">Loading...</div>;
  }

  return (
    <div className="p-6 md:p-8">
      {readOnly && <ReadOnlyNotice />}

      <div className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <h1 className="text-3xl font-bold">Receive money</h1>
            <PageNotes ariaLabel="Cash receipts help">
              <p>
                Immediate takings from <strong>Point of sale</strong> (pay now). Invoice balances, guest folio payments, and other debtor receipts are on{" "}
                <strong>Debtor payments</strong>.
              </p>
            </PageNotes>
          </div>
          {!readOnly && onNavigate ? (
            <div className="flex flex-wrap gap-2 shrink-0">
              {showHotelPosShortcut ? (
                <button
                  type="button"
                  onClick={() => onNavigate("hotel_pos_waiter")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
                >
                  <Plus className="w-4 h-4 text-emerald-600" aria-hidden />
                  <UtensilsCrossed className="w-4 h-4 text-slate-500" aria-hidden />
                  Hotel POS
                </button>
              ) : null}
              {showRetailPosShortcut ? (
                <button
                  type="button"
                  onClick={() => onNavigate("retail_pos")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
                >
                  <Plus className="w-4 h-4 text-violet-600" aria-hidden />
                  <ShoppingCart className="w-4 h-4 text-slate-500" aria-hidden />
                  Retail POS
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {isHotelCheckout ? (
        <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 md:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Receiving payment for</p>
              <p className="text-lg font-semibold text-slate-900 mt-1">
                {hotelGuestName || "Guest"}{hotelDescription ? ` – ${hotelDescription}` : ""}
              </p>
              <p className="text-sm text-slate-700 mt-1">
                Amount:{" "}
                <span className="font-bold tabular-nums">
                  {hotelAmount ? Number(hotelAmount).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : "—"}
                </span>
                {hotelReference ? (
                  <span className="text-slate-500 ml-2">
                    · Ref: <span className="font-mono text-xs">{hotelReference}</span>
                  </span>
                ) : null}
              </p>
            </div>
            <button
              type="button"
              onClick={clearHotelCheckoutState}
              className="shrink-0 text-sm text-slate-600 hover:text-slate-900 underline"
            >
              Dismiss
            </button>
          </div>
          {!hotelGuestId.trim() ? (
            <p className="text-sm text-amber-900 bg-amber-100/80 rounded-lg px-3 py-2 border border-amber-200">
              Guest link is missing — reopen the bill from <strong>Active stays</strong> and use <strong>Receive payment</strong>.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
              <div className="sm:col-span-1">
                <label className="block text-xs font-medium text-slate-600 mb-1">Amount</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={hotelAmount}
                  onChange={(e) => setHotelAmount(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Method</label>
                <select
                  value={hotelMethod}
                  onChange={(e) => setHotelMethod(e.target.value as PaymentMethodCode)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {PAYMENT_METHOD_SELECT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Date received</label>
                <input
                  type="date"
                  value={hotelDate}
                  onChange={(e) => setHotelDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Reference / folio</label>
                <input
                  type="text"
                  value={hotelReference}
                  onChange={(e) => setHotelReference(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono"
                  placeholder="FOLIO-…"
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  disabled={readOnly || hotelSaving}
                  onClick={() => void saveHotelGuestPayment()}
                  className="app-btn-primary px-5 disabled:opacity-50"
                >
                  {hotelSaving ? "Saving…" : "Save guest payment"}
                </button>
                <p className="text-xs text-slate-600 self-center">
                  Posts to the guest account (debtor), then returns you to <strong>Active stays</strong>.
                </p>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {!canEditCashReceiptsByRole ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Cash receipt edits are disabled for your role ({role || "staff"}). Ask an admin/super admin to grant cash receipt edit permission.
        </div>
      ) : null}

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

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">From date</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">To date</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Department</label>
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="all">All departments</option>
              {departmentOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Product</label>
            <select
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="all">All products</option>
              {productOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {filteredRows.length === 0 ? (
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
              <th className="text-right p-3 font-semibold text-slate-700">Action</th>
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
                <td className="p-3 text-right">
                  {p.payment_status === "completed" ? (
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openEditModal(p)}
                        disabled={readOnly || !canEditCashReceiptsByRole}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                      >
                        Edit
                      </button>
                      {canReverse ? (
                        <button
                          type="button"
                          onClick={() => void reverseReceipt(p)}
                          disabled={readOnly || reversingId === p.id}
                          className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                        >
                          {reversingId === p.id ? "Reversing..." : "Reverse"}
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500">{p.payment_status}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editingPayment ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !savingEdit && setEditingPayment(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 mb-3">Edit cash receipt</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Amount</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Payment method</label>
                <select
                  value={editMethod}
                  onChange={(e) => setEditMethod(e.target.value as PaymentMethodCode)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {PAYMENT_METHOD_SELECT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Payment date</label>
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEditingPayment(null)}
                  disabled={savingEdit}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void saveReceiptEdit()}
                  disabled={savingEdit}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {savingEdit ? "Saving..." : "Save changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
