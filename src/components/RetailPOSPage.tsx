import { useEffect, useMemo, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { supabase } from "../lib/supabase";
import { createJournalEntry } from "../lib/journal";
import { resolveJournalAccountSettings } from "../lib/journalAccountSettings";
import { businessTodayISO } from "../lib/timezone";
import { useAuth } from "../contexts/AuthContext";
import { ReadOnlyNotice } from "./common/ReadOnlyNotice";
import { PageNotes } from "./common/PageNotes";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";
import { useAppContext } from "../contexts/AppContext";
import {
  formatPaymentMethodLabel,
  insertPaymentWithMethodCompat,
  PAYMENT_METHOD_SELECT_OPTIONS,
  type PaymentMethodCode,
} from "../lib/paymentMethod";
import { randomUuid } from "../lib/randomUuid";
import {
  enqueueOfflineRetailSale,
  readOfflineRetailQueue,
  removeOfflineRetailSale,
  type OfflineRetailLine,
  type OfflineRetailPayment,
} from "../lib/retailOfflineQueue";
import { toast } from "./ui/use-toast";
import { getMarginPercent, getProductPrice } from "../services/posService";
import { desktopApi } from "../lib/desktopApi";
import { useCart } from "./retail-pos/hooks/useCart";
import { usePayments } from "./retail-pos/hooks/usePayments";
import { useOfflineQueue } from "./retail-pos/hooks/useOfflineQueue";
import { useCustomer } from "./retail-pos/hooks/useCustomer";
import { useSession } from "./retail-pos/hooks/useSession";
import { validateCheckout } from "./retail-pos/hooks/usePOSCheckout";
import { CashierCartPanel } from "./retail-pos/components/CashierCartPanel";
import { CashierPaymentPanel } from "./retail-pos/components/CashierPaymentPanel";
import { useScanFlow } from "./retail-pos/hooks/useScanFlow";
import { useProductCatalog } from "./retail-pos/hooks/useProductCatalog";
import { useCustomerProfileActions } from "./retail-pos/hooks/useCustomerProfileActions";
import {
  collectMobileMoneyPayments,
  type SaleCustomerContext,
} from "./retail-pos/services/checkoutService";
import { processSaleOnline } from "./retail-pos/services/processSaleOnline";

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

interface ReceiptOrgHeader {
  name: string;
  address: string | null;
  stkPushEnabled: boolean;
}

interface RetailCustomerRow {
  id: string;
  name: string;
  phone: string | null;
  credit_limit?: number | null;
  current_credit_balance?: number | null;
}

type PosPaymentStatus = "pending" | "partial" | "completed" | "overpaid";
interface CashierSessionRow {
  id: string;
  opened_at: string;
  opening_float: number;
  status: "open" | "closed";
}
interface RetailPOSPageProps {
  readOnly?: boolean;
}

type PaymentFeedbackStatus = "idle" | "waiting" | "success" | "failed";
type CheckoutTender = OfflineRetailPayment & { id: string };
const QUICK_PICK_STATS_KEY = "boat.retail.quickpick.stats.v1";
const QUICK_PICK_RECENT_KEY = "boat.retail.quickpick.recent.v1";

export function RetailPOSPage({ readOnly = false }: RetailPOSPageProps = {}) {
  const { user } = useAuth();
  const { setCurrentPage } = useAppContext();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([]);
  const [topSelling, setTopSelling] = useState<Array<{ id: string; name: string; qty: number }>>([]);
  const [slowMovers, setSlowMovers] = useState<Array<{ id: string; name: string; qty: number }>>([]);
  const [marginAlerts, setMarginAlerts] = useState<Array<{ id: string; name: string; marginPct: number }>>([]);
  const [quickPickStats, setQuickPickStats] = useState<Record<string, number>>({});
  const [recentQuickPickIds, setRecentQuickPickIds] = useState<string[]>([]);
  const [customers, setCustomers] = useState<RetailCustomerRow[]>([]);
  const [processing, setProcessing] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [showReceiptPreview, setShowReceiptPreview] = useState(false);
  const [receiptOrgHeader, setReceiptOrgHeader] = useState<ReceiptOrgHeader | null>(null);
  const [posVatEnabled, setPosVatEnabled] = useState(false);
  const [posVatRate, setPosVatRate] = useState<number | null>(null);
  const [autoPrintReceipt, setAutoPrintReceipt] = useState(false);
  const [speedMode] = useState<"normal" | "fast">("normal");
  const [atomicRpcStatus, setAtomicRpcStatus] = useState<"checking" | "available" | "unavailable">("checking");
  const [atomicFallbackCount, setAtomicFallbackCount] = useState(0);
  const [creditDueDate, setCreditDueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentFeedbackStatus, setPaymentFeedbackStatus] = useState<PaymentFeedbackStatus>("idle");
  const [paymentFeedbackMessage, setPaymentFeedbackMessage] = useState("");
  const [retryPendingTenders, setRetryPendingTenders] = useState<Array<{ method: PaymentMethodCode; amount: number }>>([]);
  const [activePanelTab, setActivePanelTab] = useState<"payment" | "customer" | "notes">("payment");
  const [advancedModeEnabled, setAdvancedModeEnabled] = useState(true);
  const localAuthEnabled = ["true", "1", "yes"].includes((import.meta.env.VITE_LOCAL_AUTH || "").trim().toLowerCase());
  const useDesktopLocalMode = localAuthEnabled && desktopApi.isAvailable();
  const scanInputRef = useRef<HTMLInputElement | null>(null);

  const { products, loading, productSearch, setProductSearch, filteredManualProducts } = useProductCatalog<Product>(useDesktopLocalMode, orgId);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(QUICK_PICK_STATS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, number>;
      if (parsed && typeof parsed === "object") setQuickPickStats(parsed);
    } catch {
      // Ignore corrupt quick-pick stats.
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(QUICK_PICK_RECENT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as string[];
      if (Array.isArray(parsed)) setRecentQuickPickIds(parsed.filter(Boolean));
    } catch {
      // Ignore corrupt recent quick-pick history.
    }
  }, []);

  const {
    syncingOfflineQueue,
    setSyncingOfflineQueue,
    offlineQueueCount,
    setOfflineQueueCount,
    refreshOfflineQueueCount,
  } = useOfflineQueue();
  const {
    selectedCustomerId,
    setSelectedCustomerId,
    customerNameDraft,
    setCustomerNameDraft,
    customerPhoneDraft,
    setCustomerPhoneDraft,
    savingCustomer,
    setSavingCustomer,
    posCustomerSummary,
    clearCustomer,
  } = useCustomer(customers);
  const { ensureLocalRetailCustomer, saveCustomerProfile } = useCustomerProfileActions({
    useDesktopLocalMode,
    orgId,
    selectedCustomerId,
    setSelectedCustomerId,
    customerNameDraft,
    setCustomerNameDraft,
    customerPhoneDraft,
    setCustomerPhoneDraft,
    setCustomers,
    setSavingCustomer,
  });
  const {
    activeSession,
    setActiveSession,
    posMode,
    setPosMode,
    openingFloatDraft,
    setOpeningFloatDraft,
    closingCashDraft,
    setClosingCashDraft,
    sessionBusy,
    setSessionBusy,
  } = useSession<CashierSessionRow>();

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
    const loadAdvancedModeFlag = async () => {
      if (!orgId) {
        setAdvancedModeEnabled(true);
        return;
      }
      try {
        const { data, error } = await supabase
          .from("organization_permissions")
          .select("allowed")
          .eq("organization_id", orgId)
          .eq("role_key", "__org__")
          .eq("permission_key", "retail_pos_advanced_mode")
          .maybeSingle();
        if (error) throw error;
        if (typeof data?.allowed === "boolean") {
          setAdvancedModeEnabled(!!data.allowed);
        } else {
          setAdvancedModeEnabled(true);
        }
      } catch {
        setAdvancedModeEnabled(true);
      }
    };
    void loadAdvancedModeFlag();
  }, [orgId]);

  useEffect(() => {
    const loadReceiptOrgHeader = async () => {
      if (!orgId) {
        setReceiptOrgHeader(null);
        return;
      }
      if (useDesktopLocalMode) {
        setReceiptOrgHeader({
          name: "BOAT Retail",
          address: null,
          stkPushEnabled: false,
        });
        return;
      }
      const { data } = await supabase
        .from("organizations")
        .select("name,address,retail_stk_push_enabled")
        .eq("id", orgId)
        .maybeSingle();
      const row = data as { name?: string | null; address?: string | null; retail_stk_push_enabled?: boolean | null } | null;
      if (row?.name?.trim()) {
        setReceiptOrgHeader({
          name: row.name.trim(),
          address: row.address?.trim() ? row.address.trim() : null,
          stkPushEnabled: row.retail_stk_push_enabled === true,
        });
      } else {
        setReceiptOrgHeader(null);
      }
    };
    void loadReceiptOrgHeader();
  }, [orgId, useDesktopLocalMode]);

  useEffect(() => {
    const loadDepartments = async () => {
      if (useDesktopLocalMode) {
        setDepartments([]);
        return;
      }
      const { data } = await filterByOrganizationId(
        supabase.from("departments").select("id,name").order("name"),
        orgId,
        superAdmin
      );
      setDepartments((data || []) as Array<{ id: string; name: string }>);
    };
    loadDepartments();
  }, [orgId, superAdmin, useDesktopLocalMode]);

  useEffect(() => {
    const loadActiveSession = async () => {
      if (!user?.id) {
        setActiveSession(null);
        return;
      }
      if (useDesktopLocalMode) {
        const row = await desktopApi.getActiveSession(user.id);
        setActiveSession((row as CashierSessionRow | null) ?? null);
        return;
      }
      const { data } = await supabase
        .from("retail_cashier_sessions")
        .select("id,opened_at,opening_float,status")
        .eq("opened_by", user.id)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setActiveSession((data as CashierSessionRow | null) ?? null);
    };
    void loadActiveSession();
  }, [orgId, user?.id, useDesktopLocalMode]);

  useEffect(() => {
    const loadCustomers = async () => {
      if (!orgId && !useDesktopLocalMode) {
        setCustomers([]);
        return;
      }
      if (useDesktopLocalMode) {
        const rows = await desktopApi.listRetailCustomers();
        const mapped = (rows || []).map((row) => ({
          id: String((row as { id?: string }).id || ""),
          name: String((row as { name?: string }).name || ""),
          phone: ((row as { phone?: string | null }).phone ?? null) as string | null,
          credit_limit: Number((row as { credit_limit?: number | null }).credit_limit ?? 0),
          current_credit_balance: Number((row as { current_credit_balance?: number | null }).current_credit_balance ?? 0),
        })) as RetailCustomerRow[];
        setCustomers(mapped.filter((r) => r.id && r.name));
        return;
      }
      const { data } = await filterByOrganizationId(
        supabase.from("retail_customers").select("id,name,phone,credit_limit,current_credit_balance").order("name"),
        orgId,
        superAdmin
      );
      setCustomers((data || []) as RetailCustomerRow[]);
    };
    void loadCustomers();
  }, [orgId, superAdmin, useDesktopLocalMode]);

  useEffect(() => {
    const selected = customers.find((c) => c.id === selectedCustomerId);
    if (!selected) return;
    setCustomerNameDraft((prev) => (prev.trim() ? prev : selected.name));
    setCustomerPhoneDraft((prev) => (prev.trim() ? prev : selected.phone || ""));
  }, [selectedCustomerId, customers]);

  useEffect(() => {
    const onOnline = () => {
      void flushOfflineQueue();
    };
    window.addEventListener("online", onOnline);
    void flushOfflineQueue();
    return () => window.removeEventListener("online", onOnline);
  }, []);

  useEffect(() => {
    const key = "boat.retail.atomic.fallback.count";
    setAtomicFallbackCount(Number(localStorage.getItem(key) || 0));
    const probeAtomicRpc = async () => {
      if (useDesktopLocalMode) {
        setAtomicRpcStatus("unavailable");
        return;
      }
      setAtomicRpcStatus("checking");
      const { error } = await supabase.rpc("post_retail_sale_atomic", {
        p_sale_id: randomUuid(),
        p_organization_id: orgId ?? null,
        p_created_by: user?.id ?? null,
        p_customer_id: null,
        p_customer_name: null,
        p_customer_phone: null,
        p_total_amount: 0,
        p_amount_paid: 0,
        p_amount_due: 0,
        p_change_amount: 0,
        p_payment_status: "pending",
        p_vat_enabled: false,
        p_vat_rate: null,
        p_cashier_session_id: null,
        p_lines: [],
        p_payments: [],
        p_journal_entry_date: businessTodayISO(),
        p_journal_description: "probe",
        p_journal_lines: [],
      });
      if (!error) {
        setAtomicRpcStatus("available");
        return;
      }
      const msg = String(error.message || "").toLowerCase();
      if (msg.includes("at least one sale line is required") || msg.includes("at least one payment line is required")) {
        setAtomicRpcStatus("available");
      } else {
        setAtomicRpcStatus("unavailable");
      }
    };
    void probeAtomicRpc();
  }, [orgId, user?.id, useDesktopLocalMode]);


  useEffect(() => {
    const loadInsights = async () => {
      if (products.length === 0) return;
      if (useDesktopLocalMode) {
        // In desktop local mode, there is no reliable cloud stock-movement analytics dataset.
        // Leave Top Selling empty so quick-picks fall back to local usage stats (quickPickStats).
        setTopSelling([]);
        setSlowMovers([]);
        setMarginAlerts(
          products
            .map((p) => ({ id: p.id, name: p.name, marginPct: getMarginPercent(p, getUnitPrice(p, 1)) }))
            .filter((p) => p.marginPct < 10)
            .sort((a, b) => a.marginPct - b.marginPct)
            .slice(0, 6)
        );
        return;
      }
      const { data } = await supabase
        .from("product_stock_movements")
        .select("product_id,quantity_out,created_at")
        .eq("source_type", "sale")
        .gt("quantity_out", 0)
        .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
      const qtyByProduct = new Map<string, number>();
      ((data || []) as Array<{ product_id: string; quantity_out: number | null }>).forEach((row) => {
        qtyByProduct.set(row.product_id, (qtyByProduct.get(row.product_id) || 0) + Number(row.quantity_out || 0));
      });
      const ranked = products.map((p) => ({ id: p.id, name: p.name, qty: qtyByProduct.get(p.id) || 0 }));
      setTopSelling(ranked.slice().sort((a, b) => b.qty - a.qty).slice(0, 6));
      setSlowMovers(ranked.slice().sort((a, b) => a.qty - b.qty).slice(0, 6));
      setMarginAlerts(
        products
          .map((p) => ({ id: p.id, name: p.name, marginPct: getMarginPercent(p, getUnitPrice(p, 1)) }))
          .filter((p) => p.marginPct < 10)
          .sort((a, b) => a.marginPct - b.marginPct)
          .slice(0, 6)
      );
    };
    void loadInsights();
  }, [products, useDesktopLocalMode]);

  const getUnitPrice = (product: Product, quantity = 1) => getProductPrice(product, { quantity });
  const {
    cartByProductId,
    setCartByProductId,
    cart,
    total,
    addToCart: addToCartBase,
    updateQty,
    clearCart,
    qtyPadProductId,
    qtyPadValue,
    setQtyPadValue,
    closeQtyPad,
    applyQtyPad,
    qtyPadAppend,
    qtyPadBackspace,
  } = useCart<Product>(getUnitPrice);
  const addToCart = (product: Product) => {
    addToCartBase(product);
    setQuickPickStats((prev) => {
      const next = { ...prev, [product.id]: (prev[product.id] || 0) + 1 };
      try {
        localStorage.setItem(QUICK_PICK_STATS_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage errors.
      }
      return next;
    });
    setRecentQuickPickIds((prev) => {
      const next = [product.id, ...prev.filter((id) => id !== product.id)].slice(0, 10);
      try {
        localStorage.setItem(QUICK_PICK_RECENT_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage errors.
      }
      return next;
    });
  };
  const {
    scanCode,
    setScanCode,
  } = useScanFlow<Product>({
    products,
    onExactMatch: addToCart,
  });
  const qtyPadItem = useMemo(() => cart.find((item) => item.product.id === qtyPadProductId) ?? null, [cart, qtyPadProductId]);
  const quickPickProducts = useMemo(() => {
    if (topSelling.length > 0) {
      const map = new Map(products.map((p) => [p.id, p]));
      return topSelling.map((row) => map.get(row.id)).filter((p): p is Product => Boolean(p)).slice(0, 10);
    }
    const scored = products
      .map((p) => ({ product: p, score: quickPickStats[p.id] || 0 }))
      .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name))
      .map((row) => row.product);
    return scored.slice(0, 10);
  }, [products, topSelling, quickPickStats]);
  const intelligentQuickPickProducts = useMemo(() => {
    const map = new Map(products.map((p) => [p.id, p]));
    const recent = recentQuickPickIds.map((id) => map.get(id)).filter((p): p is Product => Boolean(p));
    const frequent = quickPickProducts;
    const merged: Product[] = [];
    const seen = new Set<string>();
    for (const p of [...recent, ...frequent]) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      merged.push(p);
      if (merged.length >= 10) break;
    }
    return merged;
  }, [products, recentQuickPickIds, quickPickProducts]);

  const {
    paymentMode,
    setPaymentMode,
    paymentMethod,
    setPaymentMethod,
    paymentAmountDraft,
    setPaymentAmountDraft,
    paymentLines,
    setPaymentLines,
    amountPaid,
    amountDue,
    changeDue,
    paymentStatus,
    hasMobileTender,
    addPaymentLine,
    addQuickPayment,
    removePaymentLine,
    updatePaymentLine,
    resetPayments,
  } = usePayments(total);
  const saleType: "cash" | "credit" | "mixed" =
    amountPaid <= 0 ? "credit" : amountPaid < total ? "mixed" : "cash";
  const canUseAdvancedPayments =
    advancedModeEnabled && (useDesktopLocalMode || posMode === "manager" || Boolean(user?.isSuperAdmin));
  const stkPushEnabled = receiptOrgHeader?.stkPushEnabled === true;

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

  const openCashierSession = async () => {
    if (!user?.id) return;
    const openingFloat = Number(openingFloatDraft);
    if (!Number.isFinite(openingFloat) || openingFloat < 0) {
      toast({ title: "Invalid opening float", description: "Enter a valid opening float." });
      return;
    }
    setSessionBusy(true);
    try {
      if (useDesktopLocalMode) {
        const localRow = await desktopApi.openSession(user.id, Math.round(openingFloat * 100) / 100);
        if (!localRow) throw new Error("Failed to open local session");
        setActiveSession(localRow as CashierSessionRow);
        setClosingCashDraft("");
        return;
      }
      const { data, error } = await supabase
        .from("retail_cashier_sessions")
        .insert({
          organization_id: orgId,
          opened_by: user.id,
          opening_float: Math.round(openingFloat * 100) / 100,
          status: "open",
        })
        .select("id,opened_at,opening_float,status")
        .single();
      if (error) throw error;
      setActiveSession(data as CashierSessionRow);
      setClosingCashDraft("");
    } catch (error: unknown) {
      toast({ title: "Failed to open session", description: error instanceof Error ? error.message : "Try again." });
    } finally {
      setSessionBusy(false);
    }
  };

  const closeCashierSession = async () => {
    if (!activeSession || !user?.id) return;
    const closingCash = Number(closingCashDraft);
    if (!Number.isFinite(closingCash) || closingCash < 0) {
      toast({ title: "Invalid closing cash", description: "Enter a valid closing cash value." });
      return;
    }
    setSessionBusy(true);
    try {
      if (useDesktopLocalMode) {
        const expectedCash = Math.round((activeSession.opening_float || 0) * 100) / 100;
        const variance = Math.round((closingCash - expectedCash) * 100) / 100;
        const res = await desktopApi.closeSession({
          id: activeSession.id,
          closedBy: user.id,
          closingCashCounted: closingCash,
          expectedCash,
          varianceAmount: variance,
        });
        if (!res?.ok) throw new Error("Failed to close local session");
        setActiveSession(null);
        resetPayments();
        clearCart();
        toast({ title: "Session closed", description: `Expected ${expectedCash.toFixed(2)}, variance ${variance.toFixed(2)}.` });
        return;
      }
      const { data: cashRows } = await supabase
        .from("retail_sale_payments")
        .select("amount,payment_status,payment_method,retail_sales!inner(cashier_session_id)")
        .eq("retail_sales.cashier_session_id", activeSession.id);
      const sessionCashSales = ((cashRows || []) as Array<{ amount: number; payment_status: string; payment_method: string }>).filter(
        (r) => r.payment_status === "completed" && r.payment_method === "cash"
      );
      const expectedCash =
        Math.round(
          (activeSession.opening_float +
            sessionCashSales.reduce((sum, row) => sum + Number(row.amount ?? 0), 0)) *
            100
        ) / 100;
      const variance = Math.round((closingCash - expectedCash) * 100) / 100;
      const { error } = await supabase
        .from("retail_cashier_sessions")
        .update({
          status: "closed",
          closed_by: user.id,
          closed_at: new Date().toISOString(),
          closing_cash_counted: closingCash,
          expected_cash: expectedCash,
          variance_amount: variance,
        })
        .eq("id", activeSession.id);
      if (error) throw error;
      setActiveSession(null);
      resetPayments();
      clearCart();
      toast({ title: "Session closed", description: `Expected ${expectedCash.toFixed(2)}, variance ${variance.toFixed(2)}.` });
    } catch (error: unknown) {
      toast({ title: "Failed to close session", description: error instanceof Error ? error.message : "Try again." });
    } finally {
      setSessionBusy(false);
    }
  };

  const handleScan = () => {
    const match = findByScanCode(scanCode);
    if (!match) {
      playErrorBeep();
      toast({ title: "Item not found", description: "No product matched the scanned code." });
      window.setTimeout(() => scanInputRef.current?.focus(), 0);
      return;
    }
    addToCart(match);
    playSuccessBeep();
    setScanCode("");
    if (speedMode === "fast" && !processing) {
      window.setTimeout(() => {
        addQuickPayment("cash");
        void checkout();
      }, 0);
    }
    window.setTimeout(() => scanInputRef.current?.focus(), 0);
  };

  const playTone = (frequency: number, durationMs: number) => {
    try {
      const audioCtx = new (window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.value = 0.05;
      oscillator.connect(gain);
      gain.connect(audioCtx.destination);
      oscillator.start();
      window.setTimeout(() => {
        oscillator.stop();
        void audioCtx.close();
      }, durationMs);
    } catch {
      // Ignore sound failures.
    }
  };
  const playSuccessBeep = () => playTone(900, 90);
  const playErrorBeep = () => playTone(220, 140);

  const resetCheckoutUI = (saleId: string) => {
    setReceipt({
      saleId,
      paidAt: new Date().toISOString(),
      paymentMethod: paymentLines[0]?.method ?? "cash",
      total,
      lines: cart.map((i) => ({ name: i.product.name, qty: i.quantity, unitPrice: getUnitPrice(i.product), lineTotal: i.lineTotal })),
    });
    setShowReceiptPreview(false);
    // Keep checkout non-blocking: receipt printing is manual after sale.
    clearCart();
    resetPayments();
    setScanCode("");
    setCreditDueDate(new Date().toISOString().slice(0, 10));
  };

  const resolveCheckoutPhone = (shouldUseStkPush: boolean) => {
    let checkoutPhone = customerPhoneDraft.trim();
    if (!shouldUseStkPush) return checkoutPhone;
    const selected = customers.find((c) => c.id === selectedCustomerId);
    const detectedPhone = selected?.phone?.trim() || checkoutPhone;
    if (!detectedPhone) {
      const prompted = window.prompt("Enter mobile number")?.trim() || "";
      if (!prompted) {
        toast({ title: "Mobile number required", description: "Enter customer phone to proceed with mobile payment." });
        setPaymentFeedbackStatus("failed");
        setPaymentFeedbackMessage("Payment failed");
        return null;
      }
      checkoutPhone = prompted;
      setCustomerPhoneDraft(prompted);
      return checkoutPhone;
    }
    if (!customerPhoneDraft.trim()) setCustomerPhoneDraft(detectedPhone);
    return detectedPhone;
  };

  const prepareCheckout = () => {
    if (!validateCheckout({ readOnly, hasActiveSession: Boolean(activeSession), cartCount: cart.length, paymentLineCount: paymentLines.length })) return null;
    const shouldUseStkPush = hasMobileTender && stkPushEnabled;
    const checkoutPhone = resolveCheckoutPhone(shouldUseStkPush);
    if (shouldUseStkPush && !checkoutPhone) return null;
    setProcessing(true);
    setPaymentFeedbackStatus(shouldUseStkPush ? "waiting" : "idle");
    setPaymentFeedbackMessage(shouldUseStkPush ? "Waiting for payment..." : "");
    return {
      saleId: randomUuid(),
      lines: buildOfflineLines(),
      tenders: paymentLines.map((p) => ({ id: p.id, method: p.method, amount: p.amount, status: p.status }) as CheckoutTender),
      saleCustomer: { id: selectedCustomerId || null, name: customerNameDraft.trim() || null, phone: customerPhoneDraft.trim() || null } as SaleCustomerContext,
      shouldUseStkPush,
      checkoutPhone: checkoutPhone || "",
    };
  };

  const handlePayments = async (ctx: ReturnType<typeof prepareCheckout>) => {
    if (!ctx) throw new Error("checkout_prepare_failed");
    return ctx.shouldUseStkPush
      ? collectMobileMoneyPayments({
          saleId: ctx.saleId,
          tenders: ctx.tenders,
          phone: ctx.checkoutPhone,
          customerName: customerNameDraft.trim() || "Retail customer",
          customerEmail: user?.email ?? "no-reply@boat.local",
          organizationId: orgId ?? null,
        })
      : ctx.tenders;
  };

  const handleOnlineSale = async (ctx: NonNullable<ReturnType<typeof prepareCheckout>>, saleCustomer: SaleCustomerContext, tenders: CheckoutTender[]) => {
    const payload = {
      saleId: ctx.saleId,
      lines: ctx.lines,
      tenders: tenders.map((t) => ({ method: t.method, amount: t.amount, status: t.status })),
      saleCustomer,
      useDesktopLocalMode,
      activeSessionId: activeSession?.id ?? null,
      total,
      amountPaid,
      amountDue,
      changeDue,
      paymentStatus,
      saleType,
      creditDueDate,
      posVatEnabled,
      posVatRate,
      userId: user?.id ?? null,
      organizationId: user?.organization_id ?? undefined,
      customers,
      departments,
      onAtomicRpcStatus: setAtomicRpcStatus,
      onAtomicFallbackCount: setAtomicFallbackCount,
    };
    if (ctx.shouldUseStkPush) {
      await Promise.race([processSaleOnline(payload), new Promise((_, reject) => window.setTimeout(() => reject(new Error("payment_timeout")), 60_000))]);
      return;
    }
    await processSaleOnline(payload);
  };

  const handleOfflineFallback = (ctx: NonNullable<ReturnType<typeof prepareCheckout>>, saleCustomer: SaleCustomerContext) => {
    enqueueOfflineRetailSale({
      organizationId: user?.organization_id ?? null,
      processedBy: user?.id ?? null,
      customerId: saleCustomer.id,
      customerName: saleCustomer.name,
      customerPhone: saleCustomer.phone,
      total,
      amountPaid,
      amountDue,
      paymentStatus,
      payments: ctx.tenders,
      lines: ctx.lines,
      vatEnabled: posVatEnabled,
      vatRate: posVatRate,
    });
    refreshOfflineQueueCount();
    toast({ title: "Offline mode", description: "Sale queued offline and will sync automatically." });
    setPaymentFeedbackStatus("waiting");
    setPaymentFeedbackMessage("Waiting for payment...");
    setRetryPendingTenders([]);
  };

  const finalizeUI = (ctx: NonNullable<ReturnType<typeof prepareCheckout>>, didSucceed: boolean) => {
    if (didSucceed) resetCheckoutUI(ctx.saleId);
    setProcessing(false);
    window.setTimeout(() => scanInputRef.current?.focus(), 0);
  };

  const runCheckout = async () => {
    const ctx = prepareCheckout();
    if (!ctx) return;
    let didSucceed = false;
    let saleCustomer = ctx.saleCustomer;
    try {
      if (!useDesktopLocalMode && !navigator.onLine) throw new Error("offline");
      saleCustomer = await ensureLocalRetailCustomer(saleCustomer);
      const verifiedTenders = await handlePayments(ctx);
      await handleOnlineSale(ctx, saleCustomer, verifiedTenders);
      refreshOfflineQueueCount();
      toast({ title: "Retail sale completed" });
      setPaymentFeedbackStatus(ctx.shouldUseStkPush ? "success" : "idle");
      setPaymentFeedbackMessage(ctx.shouldUseStkPush ? "Payment successful" : "");
      setRetryPendingTenders([]);
      didSucceed = true;
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "offline") {
        handleOfflineFallback(ctx, saleCustomer);
        didSucceed = true;
      } else if (ctx.shouldUseStkPush && error instanceof Error && error.message === "payment_timeout") {
        const cancelledPending = ctx.tenders.filter((p) => p.status === "pending").map((p) => ({ method: p.method, amount: p.amount }));
        setPaymentLines((prev) => prev.filter((p) => p.status !== "pending"));
        setRetryPendingTenders(cancelledPending);
        toast({ title: "Payment timeout", description: "Payment timed out after 60 seconds and was cancelled." });
        setPaymentFeedbackStatus("failed");
        setPaymentFeedbackMessage("Payment failed");
      } else {
        console.error("Retail checkout failed:", error);
        toast({ title: "Checkout failed", description: error instanceof Error ? error.message : "Try again." });
        setRetryPendingTenders(ctx.shouldUseStkPush ? ctx.tenders.filter((p) => p.status === "pending").map((p) => ({ method: p.method, amount: p.amount })) : []);
        setPaymentFeedbackStatus(ctx.shouldUseStkPush ? "failed" : "idle");
        setPaymentFeedbackMessage(ctx.shouldUseStkPush ? "Payment failed" : "");
      }
    } finally {
      finalizeUI(ctx, didSucceed);
    }
  };

  const buildOfflineLines = (): OfflineRetailLine[] =>
    cart.map((i) => ({
      productId: i.product.id,
      quantity: i.quantity,
      unitPrice: getUnitPrice(i.product),
      lineTotal: i.lineTotal,
      costPrice: i.product.cost_price ?? null,
      trackInventory: i.product.track_inventory ?? true,
      departmentId: i.product.department_id ?? null,
      name: i.product.name,
    }));

  const flushOfflineQueue = async () => {
    if (syncingOfflineQueue) return;
    const queue = readOfflineRetailQueue();
    if (queue.length === 0) return;
    setSyncingOfflineQueue(true);
    try {
      for (const row of queue) {
        await processSaleOnline({
          saleId: row.id,
          lines: row.lines,
          tenders: row.payments,
          saleCustomer: {
            id: row.customerId,
            name: row.customerName,
            phone: row.customerPhone,
          },
          useDesktopLocalMode,
          activeSessionId: activeSession?.id ?? null,
          total: row.total,
          amountPaid: row.amountPaid,
          amountDue: row.amountDue,
          changeDue: Math.max(0, row.amountPaid - row.total),
          paymentStatus: row.paymentStatus,
          saleType: row.amountPaid <= 0 ? "credit" : row.amountPaid < row.total ? "mixed" : "cash",
          creditDueDate,
          posVatEnabled: row.vatEnabled,
          posVatRate: row.vatRate,
          userId: user?.id ?? null,
          organizationId: user?.organization_id ?? undefined,
          customers,
          departments,
          onAtomicRpcStatus: setAtomicRpcStatus,
          onAtomicFallbackCount: setAtomicFallbackCount,
        });
        removeOfflineRetailSale(row.id);
      }
      refreshOfflineQueueCount();
    } catch (error) {
      console.error("Offline sync failed:", error);
    } finally {
      setSyncingOfflineQueue(false);
    }
  };

  const checkout = runCheckout;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.key === "F1") {
        event.preventDefault();
        addQuickPayment("cash");
      } else if (event.key === "F2") {
        event.preventDefault();
        addQuickPayment("mtn_mobile_money");
      } else if (event.key === "F3") {
        event.preventDefault();
        addQuickPayment("card");
      } else if (event.key === "Enter" && (event.target as HTMLElement)?.tagName !== "TEXTAREA") {
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName || "";
        if (tag !== "INPUT" && tag !== "SELECT") {
          event.preventDefault();
          void checkout();
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        setPaymentLines([]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [checkout]);

  useEffect(() => {
    if (!canUseAdvancedPayments && paymentMode === "advanced") {
      setPaymentMode("simple");
    }
  }, [canUseAdvancedPayments, paymentMode, setPaymentMode]);

  useEffect(() => {
    if (posMode !== "cashier") return;
    const timer = window.setTimeout(() => scanInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [posMode]);

  const printRetailReceipt = () => {
    if (!receipt) return;
    const doc = window.open("", "_blank", "width=420,height=720");
    if (!doc) {
      toast({ title: "Print blocked", description: "Allow popups to print receipt." });
      return;
    }
    const paid = paymentLines.reduce((sum, p) => sum + p.amount, 0);
    const lineHtml = receipt.lines
      .map(
        (line) =>
          `<div style="display:flex;justify-content:space-between;gap:8px;"><span>${line.qty}x ${line.name}</span><span>${line.lineTotal.toFixed(
            2
          )}</span></div>`
      )
      .join("");
    const orgHeaderHtml = receiptOrgHeader?.name
      ? `
        <div style="text-align:center;margin:0 0 8px 0;">
          <h3 style="margin:0 0 4px 0">${receiptOrgHeader.name}</h3>
          ${receiptOrgHeader.address ? `<div class="muted" style="white-space:pre-line">${receiptOrgHeader.address}</div>` : ""}
        </div>
      `
      : `<h3 style="margin:0 0 6px 0">Retail Receipt</h3>`;
    const html = `
      <html>
      <head>
        <title>Retail Receipt</title>
        <style>
          body{font-family:Arial,sans-serif;padding:12px;max-width:320px;margin:0 auto;color:#0f172a}
          .row{display:flex;justify-content:space-between;gap:8px}
          .muted{color:#64748b;font-size:12px}
          .line{border-top:1px dashed #cbd5e1;margin:8px 0}
        </style>
      </head>
      <body>
        ${orgHeaderHtml}
        <div class="muted" style="text-align:center;margin-bottom:6px;">Retail Receipt</div>
        <div class="muted">Sale ID: ${receipt.saleId}</div>
        <div class="muted">Paid at: ${new Date(receipt.paidAt).toLocaleString()}</div>
        <div class="line"></div>
        ${lineHtml}
        <div class="line"></div>
        <div class="row"><strong>Total</strong><strong>${receipt.total.toFixed(2)}</strong></div>
        <div class="row muted"><span>Method</span><span>${formatPaymentMethodLabel(receipt.paymentMethod)}</span></div>
        <div class="row muted"><span>Tendered</span><span>${paid.toFixed(2)}</span></div>
        <div class="row muted"><span>Change</span><span>${Math.max(0, paid - receipt.total).toFixed(2)}</span></div>
        ${
          customerNameDraft.trim()
            ? `<div class="line"></div><div class="muted">Customer: ${customerNameDraft.trim()} ${
                customerPhoneDraft.trim() ? `(${customerPhoneDraft.trim()})` : ""
              }</div>`
            : ""
        }
      </body></html>
    `;
    doc.document.write(html);
    doc.document.close();
    doc.focus();
    doc.print();
    closeReceiptPreview();
  };

  const retryPendingPayments = () => {
    setPaymentLines((prev) => [
      ...prev,
      ...retryPendingTenders.map((line) => ({
        id: randomUuid(),
        method: line.method,
        amount: line.amount,
        status: "pending" as const,
      })),
    ]);
    setPaymentFeedbackStatus("waiting");
    setPaymentFeedbackMessage("Waiting for payment...");
  };

  const closeReceiptPreview = () => {
    setShowReceiptPreview(false);
    setReceipt(null);
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
    <div className="h-screen flex flex-col overflow-hidden px-3 py-2 md:px-4 md:py-3">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #retail-receipt, #retail-receipt * { visibility: visible; }
          #retail-receipt { position: absolute; left: 0; top: 0; width: 100%; background: white; padding: 1rem; }
        }
      `}</style>

      <div className="flex flex-wrap items-start gap-2 mb-2 shrink-0">
        <h1 className="text-2xl font-bold text-slate-900">Retail POS</h1>
        <button
          type="button"
          onClick={() => setCurrentPage("reports_retail_sales_insights")}
          className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
        >
          Open POS Analytics
        </button>
        <PageNotes ariaLabel="Retail POS help">
          <p>Scan items, total updates instantly, take payment, print receipt in seconds.</p>
        </PageNotes>
        <button
          type="button"
          onClick={() => setShowReceiptPreview((prev) => !prev)}
          disabled={!receipt}
          className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50"
        >
          {showReceiptPreview ? "Hide Receipt" : "View Receipt"}
        </button>
        <div className="ml-auto min-w-[260px] border border-slate-200 rounded-lg p-2 bg-slate-50">
          <p className="text-xs font-semibold text-slate-700 mb-2">Cashier Session</p>
          {activeSession ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-700">
                Opened: {new Date(activeSession.opened_at).toLocaleTimeString()} | Float: {activeSession.opening_float.toFixed(2)}
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={closingCashDraft}
                  onChange={(e) => setClosingCashDraft(e.target.value)}
                  placeholder="Closing cash counted"
                  className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={closeCashierSession}
                  disabled={sessionBusy}
                  className="px-3 py-2 rounded-lg text-sm border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                >
                  Close Shift
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.01"
                min="0"
                value={openingFloatDraft}
                onChange={(e) => setOpeningFloatDraft(e.target.value)}
                placeholder="Opening float"
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={openCashierSession}
                disabled={sessionBusy}
                className="px-3 py-2 rounded-lg text-sm border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
              >
                Open Shift
              </button>
            </div>
          )}
        </div>
      </div>
      {readOnly && (
        <ReadOnlyNotice />
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 shrink-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPosMode("cashier")}
            className={`px-4 py-2 rounded-lg text-sm font-semibold border ${posMode === "cashier" ? "bg-brand-600 text-white border-brand-600" : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"}`}
          >
            Cashier Mode
          </button>
          <button
            type="button"
            onClick={() => setPosMode("manager")}
            className={`px-4 py-2 rounded-lg text-sm font-semibold border ${posMode === "manager" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"}`}
          >
            Manager Mode
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1">
          <button
            type="button"
            onClick={() => setActivePanelTab("payment")}
            className={`rounded border px-3 py-1.5 text-[11px] font-semibold ${activePanelTab === "payment" ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-700"}`}
          >
            Payment
          </button>
          <button
            type="button"
            onClick={() => setActivePanelTab("customer")}
            className={`rounded border px-3 py-1.5 text-[11px] font-semibold ${activePanelTab === "customer" ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-700"}`}
          >
            Customer
          </button>
          <button
            type="button"
            onClick={() => setActivePanelTab("notes")}
            className={`rounded border px-3 py-1.5 text-[11px] font-semibold ${activePanelTab === "notes" ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-700"}`}
          >
            Notes
          </button>
        </div>
      </div>

      {posMode === "cashier" ? (
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-10 gap-3 overflow-hidden">
        <CashierCartPanel
          scanCode={scanCode}
          setScanCode={setScanCode}
          handleScan={handleScan}
          quickPickProducts={intelligentQuickPickProducts}
          addToCart={addToCart}
          getUnitPrice={getUnitPrice}
          productSearch={productSearch}
          setProductSearch={setProductSearch}
          filteredManualProducts={filteredManualProducts}
          cart={cart}
          updateQty={updateQty}
          scanInputRef={scanInputRef}
        />
        <CashierPaymentPanel
          total={total}
          posCustomerSummary={posCustomerSummary}
          selectedCustomerId={selectedCustomerId}
          setSelectedCustomerId={setSelectedCustomerId}
          customers={customers}
          setCustomerNameDraft={setCustomerNameDraft}
          setCustomerPhoneDraft={setCustomerPhoneDraft}
          customerNameDraft={customerNameDraft}
          customerPhoneDraft={customerPhoneDraft}
          clearCustomer={clearCustomer}
          saveCustomerProfile={saveCustomerProfile}
          savingCustomer={savingCustomer}
          readOnly={readOnly}
          paymentMode={paymentMode}
          setPaymentMode={setPaymentMode}
          canUseAdvancedPayments={canUseAdvancedPayments}
          clearPayments={resetPayments}
          addQuickPayment={addQuickPayment}
          paymentAmountDraft={paymentAmountDraft}
          setPaymentAmountDraft={setPaymentAmountDraft}
          addPaymentLine={addPaymentLine}
          paymentLines={paymentLines}
          updatePaymentLine={updatePaymentLine}
          removePaymentLine={removePaymentLine}
          amountPaid={amountPaid}
          amountDue={amountDue}
          changeDue={changeDue}
          paymentStatus={paymentStatus}
          paymentFeedbackStatus={paymentFeedbackStatus}
          paymentFeedbackMessage={paymentFeedbackMessage}
          retryPendingCount={retryPendingTenders.length}
          onRetryPending={retryPendingPayments}
          processing={processing}
          checkout={checkout}
          autoPrintReceipt={autoPrintReceipt}
          setAutoPrintReceipt={setAutoPrintReceipt}
          offlineQueueCount={offlineQueueCount}
          syncingOfflineQueue={syncingOfflineQueue}
          atomicRpcStatus={atomicRpcStatus}
          atomicFallbackCount={atomicFallbackCount}
          printRetailReceipt={printRetailReceipt}
          hasReceipt={Boolean(receipt)}
          activePanelTab={activePanelTab}
        />
      </div>
      ) : (
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-3 overflow-y-auto pr-1">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="text-lg font-bold text-slate-900 mb-3">Reports</h2>
          <p className="text-sm text-slate-600 mb-3">Open POS analytics and collections reports.</p>
          <button
            type="button"
            onClick={() => setCurrentPage("reports_retail_sales_insights")}
            className="app-btn-primary text-sm"
          >
            Open POS Analytics
          </button>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="text-lg font-bold text-slate-900 mb-3">Margins</h2>
          <div className="space-y-1">
            {marginAlerts.length === 0 ? (
              <p className="text-sm text-slate-500">No low-margin alerts.</p>
            ) : (
              marginAlerts.map((i) => (
                <div key={i.id} className="text-sm flex justify-between">
                  <span className="truncate pr-2">{i.name}</span>
                  <span className={i.marginPct < 0 ? "text-red-700" : "text-amber-700"}>{i.marginPct.toFixed(2)}%</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="text-lg font-bold text-slate-900 mb-3">VAT</h2>
          <label className="flex items-center gap-2 text-sm text-slate-800 mb-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={posVatEnabled}
              onChange={(e) => setPosVatEnabled(e.target.checked)}
              disabled={posVatRate == null || posVatRate <= 0}
              className="h-4 w-4 rounded border-slate-300"
            />
            <span>Enable VAT in retail checkout</span>
          </label>
          {posVatBreakdown ? (
            <div className="space-y-1 text-sm text-slate-800">
              <div className="flex justify-between gap-4"><span>Net</span><span>{posVatBreakdown.net.toFixed(2)}</span></div>
              <div className="flex justify-between gap-4"><span>VAT</span><span>{posVatBreakdown.vat.toFixed(2)}</span></div>
              <div className="flex justify-between gap-4 font-bold"><span>Gross</span><span>{posVatBreakdown.gross.toFixed(2)}</span></div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">VAT breakdown shows when cart has items and VAT is enabled.</p>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="text-lg font-bold text-slate-900 mb-3">Sessions & Insights</h2>
          <p className="text-sm text-slate-700 mb-1">
            Session: {activeSession ? `Open (float ${activeSession.opening_float.toFixed(2)})` : "No open cashier session"}
          </p>
          <p className="text-xs text-slate-500 mb-2">
            Atomic checkout: {atomicRpcStatus} · Legacy fallback count: {atomicFallbackCount}
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-1">Top Selling</p>
              {topSelling.slice(0, 5).map((i) => (
                <div key={i.id} className="text-xs flex justify-between"><span className="truncate pr-2">{i.name}</span><span>{i.qty.toFixed(0)}</span></div>
              ))}
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-1">Slow Movers</p>
              {slowMovers.slice(0, 5).map((i) => (
                <div key={i.id} className="text-xs flex justify-between"><span className="truncate pr-2">{i.name}</span><span>{i.qty.toFixed(0)}</span></div>
              ))}
            </div>
          </div>
        </div>
      </div>
      )}

      {qtyPadItem && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white border border-slate-200 p-4 shadow-2xl">
            <p className="text-sm text-slate-600 mb-1">Set quantity</p>
            <p className="text-base font-semibold text-slate-900 truncate mb-3">{qtyPadItem.product.name}</p>
            <div className="rounded-xl bg-slate-900 text-white text-center py-4 text-4xl font-extrabold tabular-nums mb-3">
              {qtyPadValue}
            </div>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
                <button
                  key={digit}
                  type="button"
                  onClick={() => qtyPadAppend(digit)}
                  className="py-3 rounded-lg border border-slate-300 text-lg font-bold hover:bg-slate-50"
                >
                  {digit}
                </button>
              ))}
              <button type="button" onClick={() => setQtyPadValue("0")} className="py-3 rounded-lg border border-slate-300 text-sm font-semibold hover:bg-slate-50">
                C
              </button>
              <button type="button" onClick={() => qtyPadAppend("0")} className="py-3 rounded-lg border border-slate-300 text-lg font-bold hover:bg-slate-50">
                0
              </button>
              <button type="button" onClick={qtyPadBackspace} className="py-3 rounded-lg border border-slate-300 text-sm font-semibold hover:bg-slate-50">
                DEL
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={closeQtyPad} className="py-3 rounded-lg border border-slate-300 text-sm font-semibold hover:bg-slate-50">
                Cancel
              </button>
              <button type="button" onClick={applyQtyPad} className="py-3 rounded-lg bg-brand-600 text-white text-sm font-bold hover:bg-brand-700">
                Apply Qty
              </button>
            </div>
          </div>
        </div>
      )}

      {receipt && showReceiptPreview && (
        <div id="retail-receipt" className="mt-6 bg-white rounded-xl border border-slate-200 p-6">
          <div className="flex justify-end mb-2">
            <button
              type="button"
              onClick={closeReceiptPreview}
              className="text-xs rounded border border-slate-300 px-2 py-1 hover:bg-slate-50"
            >
              Close receipt
            </button>
          </div>
          <div className="text-center mb-3">
            <h3 className="text-xl font-bold text-slate-900">
              {receiptOrgHeader?.name?.trim() || "Retail Receipt"}
            </h3>
            {receiptOrgHeader?.address ? (
              <p className="text-sm text-slate-600 whitespace-pre-line mt-1">{receiptOrgHeader.address}</p>
            ) : null}
            {receiptOrgHeader?.name ? (
              <p className="text-xs text-slate-500 uppercase tracking-wide mt-2">Retail Receipt</p>
            ) : null}
          </div>
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

    </div>
  );
}
