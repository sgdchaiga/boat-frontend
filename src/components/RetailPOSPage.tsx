import { useEffect, useMemo, useState } from "react";
import { ScanLine, ShoppingCart, Plus, Minus, X, CreditCard, Loader2, Printer, RotateCcw, RefreshCw } from "lucide-react";
import { supabase } from "../lib/supabase";
import { createJournalForPosOrder, sumPosCogsByDept } from "../lib/journal";
import { resolveJournalAccountSettings } from "../lib/journalAccountSettings";
import { businessTodayISO } from "../lib/timezone";
import { useAuth } from "../contexts/AuthContext";
import { ReadOnlyNotice } from "./common/ReadOnlyNotice";
import { PageNotes } from "./common/PageNotes";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";
import {
  formatPaymentMethodLabel,
  insertPaymentWithMethodCompat,
  normalizePaymentMethod,
  PAYMENT_METHOD_SELECT_OPTIONS,
  type PaymentMethodCode,
} from "../lib/paymentMethod";
import { randomUuid } from "../lib/randomUuid";

interface Product {
  id: string;
  name: string;
  sales_price: number | null;
  cost_price: number | null;
  track_inventory: boolean | null;
  department_id?: string | null;
  barcode?: string | null;
  sku?: string | null;
  code?: string | null;
}

interface CartItem {
  product: Product;
  quantity: number;
  lineTotal: number;
}

interface ReceiptData {
  saleId: string;
  paidAt: string;
  paymentMethod: PaymentMethodCode;
  total: number;
  /** When VAT-inclusive sale */
  netAmount?: number;
  vatAmount?: number;
  lines: Array<{ name: string; qty: number; unitPrice: number; lineTotal: number }>;
}

interface RetailSaleRow {
  paymentId: string;
  saleId: string;
  paidAt: string;
  amount: number;
  paymentMethod: PaymentMethodCode;
  paymentStatus: "pending" | "completed" | "failed" | "refunded";
  refundReason?: string;
}

type SalesDateFilter = "today" | "custom";

interface RetailPOSPageProps {
  readOnly?: boolean;
}

export function RetailPOSPage({ readOnly = false }: RetailPOSPageProps = {}) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const [products, setProducts] = useState<Product[]>([]);
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [scanCode, setScanCode] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodCode>("cash");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [recentSales, setRecentSales] = useState<RetailSaleRow[]>([]);
  const [salesLoading, setSalesLoading] = useState(false);
  const [salesError, setSalesError] = useState<string | null>(null);
  const [rebuildingReceiptSaleId, setRebuildingReceiptSaleId] = useState<string | null>(null);
  const [refundingPaymentId, setRefundingPaymentId] = useState<string | null>(null);
  const [salesDateFilter, setSalesDateFilter] = useState<SalesDateFilter>("today");
  const [salesFromDate, setSalesFromDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [salesToDate, setSalesToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [refundReasonDraftByPaymentId, setRefundReasonDraftByPaymentId] = useState<Record<string, string>>({});
  const [refundsOnly, setRefundsOnly] = useState(false);
  const [posVatEnabled, setPosVatEnabled] = useState(false);
  const [posVatRate, setPosVatRate] = useState<number | null>(null);

  useEffect(() => {
    loadProducts();
  }, []);

  useEffect(() => {
    if (!orgId) {
      setPosVatRate(null);
      return;
    }
    void resolveJournalAccountSettings(orgId).then((s) => {
      const r = s.default_vat_percent;
      setPosVatRate(r != null && Number.isFinite(r) ? r : null);
    });
  }, [orgId]);

  useEffect(() => {
    const loadDepartments = async () => {
      const { data } = await filterByOrganizationId(
        supabase.from("departments").select("id,name").order("name"),
        orgId,
        superAdmin
      );
      setDepartments((data || []) as Array<{ id: string; name: string }>);
    };
    loadDepartments();
  }, [orgId, superAdmin]);

  useEffect(() => {
    loadRecentSales();
  }, [salesDateFilter, salesFromDate, salesToDate]);

  const loadProducts = async () => {
    setLoading(true);
    setProductsError(null);
    try {
      const rich = await supabase
        .from("products")
        .select("id,name,sales_price,cost_price,track_inventory,department_id,barcode,sku,code")
        .eq("active", true)
        .order("name");

      if (!rich.error && rich.data) {
        setProducts(rich.data as Product[]);
        return;
      }

      const fallback = await supabase
        .from("products")
        .select("id,name,sales_price,cost_price,track_inventory")
        .eq("active", true)
        .order("name");

      if (fallback.error) {
        setProductsError(fallback.error.message);
        return;
      }

      const mapped = (fallback.data || []).map((p) => ({
        ...p,
        barcode: null,
        sku: null,
        code: null,
      })) as Product[];
      setProducts(mapped);
    } catch (error) {
      console.error("Retail products load error:", error);
      setProductsError("Failed to load retail products.");
    } finally {
      setLoading(false);
    }
  };

  const getUnitPrice = (product: Product) => Number(product.sales_price ?? 0);

  const addToCart = (product: Product) => {
    const price = getUnitPrice(product);
    setCart((prev) => {
      const existing = prev.find((i) => i.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1, lineTotal: (item.quantity + 1) * price }
            : item
        );
      }
      return [...prev, { product, quantity: 1, lineTotal: price }];
    });
    setSelectedProductId(product.id);
  };

  const updateQty = (productId: string, nextQty: number) => {
    if (nextQty <= 0) {
      setCart((prev) => prev.filter((i) => i.product.id !== productId));
      return;
    }
    setCart((prev) =>
      prev.map((item) =>
        item.product.id === productId
          ? { ...item, quantity: nextQty, lineTotal: getUnitPrice(item.product) * nextQty }
          : item
      )
    );
  };

  const total = useMemo(() => cart.reduce((sum, i) => sum + i.lineTotal, 0), [cart]);

  const posVatBreakdown = useMemo(() => {
    if (!posVatEnabled || posVatRate == null || posVatRate <= 0) return null;
    const gross = total;
    const net = Math.round((gross / (1 + posVatRate / 100)) * 100) / 100;
    const vat = Math.round((gross - net) * 100) / 100;
    return { net, vat, gross };
  }, [total, posVatEnabled, posVatRate]);

  const findByScanCode = (value: string) => {
    const q = value.trim().toLowerCase();
    if (!q) return null;
    return (
      products.find((p) => (p.barcode || "").toLowerCase() === q) ||
      products.find((p) => (p.sku || "").toLowerCase() === q) ||
      products.find((p) => (p.code || "").toLowerCase() === q) ||
      products.find((p) => p.id.toLowerCase() === q) ||
      products.find((p) => p.name.toLowerCase().includes(q)) ||
      null
    );
  };

  const handleScan = () => {
    const match = findByScanCode(scanCode);
    if (!match) {
      alert("Item not found for scanned code.");
      return;
    }
    addToCart(match);
    setScanCode("");
  };

  const checkout = async () => {
    if (readOnly) {
      alert("Subscription inactive: Retail POS is in read-only mode.");
      return;
    }
    if (cart.length === 0) {
      alert("Scan/add at least one item.");
      return;
    }

    setProcessing(true);
    try {
      const { data: staffRow } = await supabase
        .from("staff")
        .select("id")
        .eq("id", user?.id)
        .maybeSingle();

      const saleId = randomUuid();
      const orgId = user?.organization_id ?? undefined;
      const { data: paymentRow, error: paymentError } = await insertPaymentWithMethodCompat(
        supabase,
        {
          stay_id: null,
          ...(orgId ? { organization_id: orgId } : {}),
          payment_source: "pos_retail",
          amount: total,
          payment_status: "completed",
          transaction_id: saleId,
          processed_by: staffRow?.id ?? null,
        },
        paymentMethod
      );

      if (paymentError) throw paymentError;

      const stockMoves = cart
        .filter((i) => i.product.track_inventory ?? true)
        .map((i) => ({
          product_id: i.product.id,
          source_type: "sale",
          source_id: saleId,
          quantity_in: 0,
          quantity_out: i.quantity,
          unit_cost: i.product.cost_price ?? null,
          note: "Retail POS sale",
        }));
      if (stockMoves.length > 0) {
        const { error: stockErr } = await supabase.from("product_stock_movements").insert(stockMoves);
        if (stockErr) throw stockErr;
      }

      const description = cart.map((i) => `${i.quantity}x ${i.product.name}`).join(", ");
      const deptNameById = new Map(departments.map((d) => [d.id, d.name]));
      const cogsByDept = sumPosCogsByDept(
        cart.map((i) => ({
          quantity: i.quantity,
          unitCost: Number(i.product.cost_price ?? 0),
          departmentId: i.product.department_id ?? null,
        })),
        deptNameById
      );
      const js = await resolveJournalAccountSettings(orgId ?? undefined);
      const vatRate = js.default_vat_percent;
      const useVatJournal =
        posVatEnabled && vatRate != null && Number.isFinite(vatRate) && vatRate > 0;
      let netAmt: number | undefined;
      let vatAmt: number | undefined;
      if (useVatJournal) {
        const gross = total;
        netAmt = Math.round((gross / (1 + vatRate / 100)) * 100) / 100;
        vatAmt = Math.round((gross - netAmt) * 100) / 100;
      }
      const jr = await createJournalForPosOrder(
        saleId,
        total,
        description || "Retail POS sale",
        businessTodayISO(),
        staffRow?.id ?? null,
        {
          paymentMethod,
          cogsByDept,
          vatRatePercent: useVatJournal ? vatRate : undefined,
        }
      );
      if (!jr.ok) {
        alert(`Sale recorded but journal was not posted: ${jr.error}`);
      }

      setReceipt({
        saleId,
        paidAt: paymentRow?.paid_at || new Date().toISOString(),
        paymentMethod,
        total,
        netAmount: useVatJournal ? netAmt : undefined,
        vatAmount: useVatJournal ? vatAmt : undefined,
        lines: cart.map((i) => ({
          name: i.product.name,
          qty: i.quantity,
          unitPrice: getUnitPrice(i.product),
          lineTotal: i.lineTotal,
        })),
      });

      setCart([]);
      setScanCode("");
      await loadRecentSales();
      alert("Retail sale completed.");
    } catch (error: unknown) {
      console.error("Retail checkout failed:", error);
      const message =
        error instanceof Error
          ? error.message
          : error && typeof error === "object" && "message" in error
            ? String((error as { message?: string }).message)
            : "Failed to complete retail checkout.";
      alert(message);
    } finally {
      setProcessing(false);
    }
  };

  const loadRecentSales = async () => {
    setSalesLoading(true);
    setSalesError(null);
    try {
      let start: Date;
      let end: Date;
      if (salesDateFilter === "today") {
        start = new Date();
        start.setHours(0, 0, 0, 0);
        end = new Date(start);
        end.setDate(end.getDate() + 1);
      } else {
        start = new Date(`${salesFromDate}T00:00:00`);
        end = new Date(`${salesToDate}T00:00:00`);
        end.setDate(end.getDate() + 1);
      }

      const { data, error } = await supabase
        .from("payments")
        .select("id, transaction_id, paid_at, amount, payment_method, payment_status, stay_id")
        .is("stay_id", null)
        .not("transaction_id", "is", null)
        .gte("paid_at", start.toISOString())
        .lt("paid_at", end.toISOString())
        .order("paid_at", { ascending: false });

      if (error) throw error;

      const rows = ((data || []) as any[]).map((p) => {
        const rawRef = String(p.transaction_id || "");
        const reasonTag = "[REFUND_REASON:";
        const baseSaleId = rawRef.includes(reasonTag) ? rawRef.slice(0, rawRef.indexOf(reasonTag)).trim() : rawRef;
        const reason =
          rawRef.includes(reasonTag)
            ? rawRef.slice(rawRef.indexOf(reasonTag) + reasonTag.length).replace(/\]$/, "").trim()
            : "";
        return {
          paymentId: p.id as string,
          saleId: baseSaleId,
          paidAt: p.paid_at as string,
          amount: Number(p.amount ?? 0),
          paymentMethod: normalizePaymentMethod(p.payment_method as string),
          paymentStatus: p.payment_status as RetailSaleRow["paymentStatus"],
          refundReason: reason,
        };
      });
      setRecentSales(rows);
    } catch (error: unknown) {
      console.error("Retail sales history load error:", error);
      setSalesError(error instanceof Error ? error.message : "Failed to load retail sales history.");
    } finally {
      setSalesLoading(false);
    }
  };

  const reprintFromSale = async (saleId: string, paidAt: string, method: PaymentMethodCode, paidTotal: number) => {
    setRebuildingReceiptSaleId(saleId);
    try {
      const { data: moves, error: moveError } = await supabase
        .from("product_stock_movements")
        .select("product_id, quantity_out")
        .eq("source_type", "sale")
        .eq("source_id", saleId)
        .gt("quantity_out", 0);
      if (moveError) throw moveError;

      const movementRows = (moves || []) as Array<{ product_id: string; quantity_out: number }>;
      if (movementRows.length === 0) {
        setReceipt({
          saleId,
          paidAt,
          paymentMethod: method,
          total: paidTotal,
          lines: [{ name: "Retail sale", qty: 1, unitPrice: paidTotal, lineTotal: paidTotal }],
        });
        return;
      }

      const productIds = [...new Set(movementRows.map((m) => m.product_id))];
      const { data: productRows } = await supabase
        .from("products")
        .select("id, name, sales_price")
        .in("id", productIds);
      const productMap = Object.fromEntries(
        ((productRows || []) as Array<{ id: string; name: string; sales_price: number | null }>).map((p) => [p.id, p])
      );

      const lines = movementRows.map((m, idx) => {
        const prod = productMap[m.product_id];
        const unitPrice = Number(prod?.sales_price ?? 0);
        return {
          name: prod?.name || `Item ${idx + 1}`,
          qty: Number(m.quantity_out ?? 0),
          unitPrice,
          lineTotal: Number(m.quantity_out ?? 0) * unitPrice,
        };
      });

      const reconstructedTotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
      setReceipt({
        saleId,
        paidAt,
        paymentMethod: method,
        total: reconstructedTotal > 0 ? reconstructedTotal : paidTotal,
        lines,
      });
    } catch (error: unknown) {
      console.error("Rebuild retail receipt error:", error);
      alert(error instanceof Error ? error.message : "Failed to rebuild receipt for this sale.");
    } finally {
      setRebuildingReceiptSaleId(null);
    }
  };

  const markRefunded = async (paymentId: string, saleId: string) => {
    setRefundingPaymentId(paymentId);
    try {
      const reason = (refundReasonDraftByPaymentId[paymentId] || "").trim();
      if (!reason) {
        alert("Enter a refund reason before marking refunded.");
        setRefundingPaymentId(null);
        return;
      }

      const existingRef = saleId || "";
      const reasonTag = "[REFUND_REASON:";
      const strippedRef = existingRef.includes(reasonTag)
        ? existingRef.slice(0, existingRef.indexOf(reasonTag)).trim()
        : existingRef;
      const updatedTransactionRef = `${strippedRef} ${reasonTag} ${reason}]`.trim();

      const { error } = await supabase
        .from("payments")
        .update({ payment_status: "refunded", transaction_id: updatedTransactionRef })
        .eq("id", paymentId);
      if (error) throw error;
      setRefundReasonDraftByPaymentId((prev) => ({ ...prev, [paymentId]: "" }));
      await loadRecentSales();
    } catch (error: unknown) {
      console.error("Refund mark error:", error);
      alert(error instanceof Error ? error.message : "Failed to mark payment as refunded.");
    } finally {
      setRefundingPaymentId(null);
    }
  };

  const visibleSales = useMemo(
    () => (refundsOnly ? recentSales.filter((s) => s.paymentStatus === "refunded") : recentSales),
    [recentSales, refundsOnly]
  );

  const toCsvCell = (value: string | number) => {
    const text = String(value ?? "");
    if (text.includes(",") || text.includes('"') || text.includes("\n")) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const exportSalesCsv = () => {
    const header = ["Paid At", "Sale ID", "Payment Method", "Status", "Amount", "Refund Reason"];
    const rows = visibleSales.map((sale) => [
      new Date(sale.paidAt).toISOString(),
      sale.saleId,
      sale.paymentMethod,
      sale.paymentStatus,
      sale.amount.toFixed(2),
      sale.refundReason || refundReasonDraftByPaymentId[sale.paymentId] || "",
    ]);
    const csv = [header, ...rows].map((line) => line.map((v) => toCsvCell(v)).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      salesDateFilter === "today"
        ? "retail-sales-today.csv"
        : `retail-sales-${salesFromDate}-to-${salesToDate}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="p-6 md:p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-200 rounded w-56" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 h-80 bg-slate-200 rounded-xl" />
            <div className="h-80 bg-slate-200 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #retail-receipt, #retail-receipt * { visibility: visible; }
          #retail-receipt { position: absolute; left: 0; top: 0; width: 100%; background: white; padding: 1rem; }
        }
      `}</style>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <h1 className="text-3xl font-bold text-slate-900">Retail POS</h1>
        <PageNotes ariaLabel="Retail POS help">
          <p>Scan items, total updates instantly, take payment, print receipt in seconds.</p>
        </PageNotes>
      </div>
      {readOnly && (
        <ReadOnlyNotice />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
            <ScanLine className="w-5 h-5" />
            Scan & Add Items
          </h2>

          {productsError && <p className="text-sm text-red-600 mb-3">{productsError}</p>}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <input
              value={scanCode}
              onChange={(e) => setScanCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleScan();
              }}
              placeholder="Scan barcode / SKU"
              className="md:col-span-2 border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={handleScan}
              className="app-btn-primary text-sm hover:bg-brand-900"
              disabled={readOnly}
            >
              Scan Item
            </button>
          </div>

          <div className="flex items-center gap-3 mb-3">
            <select
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Select product manually</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} - {getUnitPrice(p).toFixed(2)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!selectedProductId || readOnly}
              onClick={() => {
                const p = products.find((x) => x.id === selectedProductId);
                if (p) addToCart(p);
              }}
              className="inline-flex items-center gap-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </div>

          <div className="rounded-lg border border-slate-200 max-h-72 overflow-y-auto">
            {cart.length === 0 ? (
              <p className="text-sm text-slate-500 p-4">No items yet. Start scanning.</p>
            ) : (
              cart.map((item) => (
                <div key={item.product.id} className="flex items-center justify-between gap-2 p-3 border-b last:border-b-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{item.product.name}</p>
                    <p className="text-xs text-slate-500">
                      {getUnitPrice(item.product).toFixed(2)} x {item.quantity}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => updateQty(item.product.id, item.quantity - 1)} className="p-1 hover:bg-slate-100 rounded">
                      <Minus className="w-4 h-4" />
                    </button>
                    <span className="w-7 text-center text-sm font-medium">{item.quantity}</span>
                    <button onClick={() => updateQty(item.product.id, item.quantity + 1)} className="p-1 hover:bg-slate-100 rounded">
                      <Plus className="w-4 h-4" />
                    </button>
                    <button onClick={() => updateQty(item.product.id, 0)} className="p-1 hover:bg-red-100 text-red-600 rounded">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <span className="text-sm font-semibold text-slate-900">{item.lineTotal.toFixed(2)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-6 h-fit">
          <h2 className="text-lg font-bold text-slate-900 mb-4 flex flex-wrap items-center gap-2">
            <ShoppingCart className="w-5 h-5 shrink-0" />
            Checkout
            <PageNotes ariaLabel="Retail checkout help">
              <p className="text-sm text-slate-700">
                Customer walks in → Items scanned → Total calculated → Payment made → Receipt printed.
              </p>
              <p className="text-sm font-semibold text-emerald-700 pt-2">Transaction takes seconds.</p>
            </PageNotes>
          </h2>

          <label className="flex items-center gap-2 text-sm text-slate-800 mb-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={posVatEnabled}
              onChange={(e) => setPosVatEnabled(e.target.checked)}
              disabled={posVatRate == null || posVatRate <= 0}
              className="h-4 w-4 rounded border-slate-300"
            />
            <span>
              VAT on (prices include VAT
              {posVatRate != null && posVatRate > 0 ? ` · ${posVatRate}%` : ""})
            </span>
          </label>
          {posVatRate == null || posVatRate <= 0 ? (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mb-3">
              Set <strong>Default VAT %</strong> and a <strong>VAT GL</strong> under Admin → Journal account settings to
              enable VAT on POS.
            </p>
          ) : null}

          {posVatBreakdown ? (
            <div className="mb-4 space-y-1 text-sm text-slate-800">
              <div className="flex justify-between gap-4">
                <span className="text-slate-600">Net (ex VAT)</span>
                <span className="tabular-nums font-medium">{posVatBreakdown.net.toFixed(2)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-600">VAT</span>
                <span className="tabular-nums font-medium">{posVatBreakdown.vat.toFixed(2)}</span>
              </div>
              <div className="flex justify-between gap-4 text-lg font-bold text-slate-900 pt-1 border-t border-slate-200">
                <span>Total</span>
                <span className="tabular-nums">{posVatBreakdown.gross.toFixed(2)}</span>
              </div>
            </div>
          ) : (
            <p className="text-2xl font-bold text-slate-900 mb-4">Total: {total.toFixed(2)}</p>
          )}

          <label className="block text-sm font-medium text-slate-700 mb-1">Payment Method</label>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethodCode)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-4"
          >
            {PAYMENT_METHOD_SELECT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          <button
            type="button"
            disabled={processing || cart.length === 0 || readOnly}
            onClick={checkout}
            className="app-btn-primary w-full py-3 font-medium disabled:cursor-not-allowed"
          >
            {processing ? <Loader2 className="w-5 h-5 animate-spin" /> : <CreditCard className="w-5 h-5" />}
            {processing ? "Processing..." : "Take Payment & Complete Sale"}
          </button>

          {receipt && (
            <button
              type="button"
              onClick={() => window.print()}
              className="w-full mt-3 border border-slate-300 hover:bg-slate-50 text-slate-700 py-2 rounded-lg font-medium text-sm flex items-center justify-center gap-2"
            >
              <Printer className="w-4 h-4" />
              Print Receipt
            </button>
          )}
        </div>
      </div>

      {receipt && (
        <div id="retail-receipt" className="mt-6 bg-white rounded-xl border border-slate-200 p-6">
          <h3 className="text-xl font-bold text-slate-900 mb-2">Retail Receipt</h3>
          <p className="text-sm text-slate-600">Sale ID: {receipt.saleId}</p>
          <p className="text-sm text-slate-600 mb-3">Paid at: {new Date(receipt.paidAt).toLocaleString()}</p>
          <div className="space-y-1 text-sm">
            {receipt.lines.map((line, index) => (
              <div key={`${line.name}-${index}`} className="flex justify-between gap-2">
                <span>
                  {line.qty}x {line.name} @ {line.unitPrice.toFixed(2)}
                </span>
                <span>{line.lineTotal.toFixed(2)}</span>
              </div>
            ))}
          </div>
          {receipt.netAmount != null && receipt.vatAmount != null ? (
            <div className="border-t border-slate-200 mt-3 pt-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Net</span>
                <span>{receipt.netAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>VAT</span>
                <span>{receipt.vatAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-base">
                <span>Total ({formatPaymentMethodLabel(receipt.paymentMethod)})</span>
                <span>{receipt.total.toFixed(2)}</span>
              </div>
            </div>
          ) : (
            <div className="border-t border-slate-200 mt-3 pt-3 flex justify-between font-bold">
              <span>Total ({formatPaymentMethodLabel(receipt.paymentMethod)})</span>
              <span>{receipt.total.toFixed(2)}</span>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h3 className="text-lg font-bold text-slate-900">
            {salesDateFilter === "today" ? "Today's Retail Sales" : "Retail Sales History"}
          </h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadRecentSales}
              className="inline-flex items-center gap-1 text-sm px-3 py-1.5 border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            <button
              type="button"
              onClick={exportSalesCsv}
              disabled={visibleSales.length === 0}
              className="inline-flex items-center gap-1 text-sm px-3 py-1.5 border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50"
            >
              Export CSV
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label className="block text-xs text-slate-600 mb-1">Date Filter</label>
            <select
              value={salesDateFilter}
              onChange={(e) => setSalesDateFilter(e.target.value as SalesDateFilter)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="today">Today</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>
          {salesDateFilter === "custom" && (
            <>
              <div>
                <label className="block text-xs text-slate-600 mb-1">From</label>
                <input
                  type="date"
                  value={salesFromDate}
                  onChange={(e) => setSalesFromDate(e.target.value)}
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">To</label>
                <input
                  type="date"
                  value={salesToDate}
                  onChange={(e) => setSalesToDate(e.target.value)}
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </>
          )}
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 mb-1">
            <input
              type="checkbox"
              checked={refundsOnly}
              onChange={(e) => setRefundsOnly(e.target.checked)}
              className="rounded border-slate-300"
            />
            Refunds only
          </label>
        </div>
        {salesError && <p className="text-sm text-red-600 mb-3">{salesError}</p>}
        {salesLoading ? (
          <p className="text-sm text-slate-500">Loading sales...</p>
        ) : visibleSales.length === 0 ? (
          <p className="text-sm text-slate-500">
            {refundsOnly ? "No refunded sales in this filter." : "No retail sales in this filter."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-200">
                  <th className="py-2 pr-2">Time</th>
                  <th className="py-2 pr-2">Sale ID</th>
                  <th className="py-2 pr-2">Method</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2">Refund Reason</th>
                  <th className="py-2 pr-2 text-right">Amount</th>
                  <th className="py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleSales.map((sale) => (
                  <tr key={sale.paymentId} className="border-b border-slate-100">
                    <td className="py-2 pr-2">{new Date(sale.paidAt).toLocaleTimeString()}</td>
                    <td className="py-2 pr-2 font-mono text-xs">{sale.saleId.slice(0, 8)}</td>
                    <td className="py-2 pr-2">{formatPaymentMethodLabel(sale.paymentMethod)}</td>
                    <td className="py-2 pr-2 capitalize">{sale.paymentStatus}</td>
                    <td className="py-2 pr-2">
                      <input
                        type="text"
                        placeholder="Reason"
                        value={refundReasonDraftByPaymentId[sale.paymentId] ?? sale.refundReason ?? ""}
                        onChange={(e) =>
                          setRefundReasonDraftByPaymentId((prev) => ({ ...prev, [sale.paymentId]: e.target.value }))
                        }
                        disabled={sale.paymentStatus === "refunded"}
                        className="w-full min-w-[140px] border border-slate-300 rounded px-2 py-1 text-xs disabled:bg-slate-50"
                      />
                    </td>
                    <td className="py-2 pr-2 text-right">{sale.amount.toFixed(2)}</td>
                    <td className="py-2 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => reprintFromSale(sale.saleId, sale.paidAt, sale.paymentMethod, sale.amount)}
                          disabled={rebuildingReceiptSaleId === sale.saleId}
                          className="inline-flex items-center gap-1 px-2 py-1 border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          {rebuildingReceiptSaleId === sale.saleId ? "Loading..." : "Reprint"}
                        </button>
                        <button
                          type="button"
                          onClick={() => markRefunded(sale.paymentId, sale.saleId)}
                          disabled={sale.paymentStatus === "refunded" || refundingPaymentId === sale.paymentId}
                          className="inline-flex items-center gap-1 px-2 py-1 border border-amber-300 text-amber-700 rounded hover:bg-amber-50 disabled:opacity-50"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          {sale.paymentStatus === "refunded" ? "Refunded" : "Mark Refunded"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
