import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import {
  formatPaymentMethodLabel,
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
