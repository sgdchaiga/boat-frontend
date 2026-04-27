import { useEffect, useMemo, useState } from "react";
import { ScanLine, ShoppingCart, Plus, Minus, X, CreditCard, Loader2, Printer, ChevronDown, ChevronUp, User } from "lucide-react";
import { supabase } from "../lib/supabase";
import { createJournalForPosOrder, sumPosCogsByDept } from "../lib/journal";
import { createJournalEntry } from "../lib/journal";
import { getDefaultGlAccounts } from "../lib/journal";
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
type MobileCollectionResponse = { status?: string; message?: string };
type SaleCustomerContext = { id: string | null; name: string | null; phone: string | null };
const QUICK_PICK_STATS_KEY = "boat.retail.quickpick.stats.v1";

export function RetailPOSPage({ readOnly = false }: RetailPOSPageProps = {}) {
  const { user } = useAuth();
  const { setCurrentPage } = useAppContext();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const [products, setProducts] = useState<Product[]>([]);
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [scanCode, setScanCode] = useState("");
  const [cartByProductId, setCartByProductId] = useState<Record<string, CartItem>>({});
  const [debouncedScanQuery, setDebouncedScanQuery] = useState("");
  const [scanSuggestions, setScanSuggestions] = useState<Product[]>([]);
  const [topSelling, setTopSelling] = useState<Array<{ id: string; name: string; qty: number }>>([]);
  const [slowMovers, setSlowMovers] = useState<Array<{ id: string; name: string; qty: number }>>([]);
  const [marginAlerts, setMarginAlerts] = useState<Array<{ id: string; name: string; marginPct: number }>>([]);
  const [quickPickStats, setQuickPickStats] = useState<Record<string, number>>({});
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodCode>("cash");
  const [paymentAmountDraft, setPaymentAmountDraft] = useState("");
  const [paymentLines, setPaymentLines] = useState<Array<{ id: string; method: PaymentMethodCode; amount: number; status: "pending" | "completed" }>>([]);
  const [customers, setCustomers] = useState<RetailCustomerRow[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerNameDraft, setCustomerNameDraft] = useState("");
  const [customerPhoneDraft, setCustomerPhoneDraft] = useState("");
  const [syncingOfflineQueue, setSyncingOfflineQueue] = useState(false);
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [receiptOrgHeader, setReceiptOrgHeader] = useState<ReceiptOrgHeader | null>(null);
  const [posVatEnabled, setPosVatEnabled] = useState(false);
  const [posVatRate, setPosVatRate] = useState<number | null>(null);
  const [activeSession, setActiveSession] = useState<CashierSessionRow | null>(null);
  const [posMode, setPosMode] = useState<"cashier" | "manager">("cashier");
  const [openingFloatDraft, setOpeningFloatDraft] = useState("0");
  const [closingCashDraft, setClosingCashDraft] = useState("");
  const [sessionBusy, setSessionBusy] = useState(false);
  const [autoPrintReceipt, setAutoPrintReceipt] = useState(false);
  const [qtyPadProductId, setQtyPadProductId] = useState<string | null>(null);
  const [qtyPadValue, setQtyPadValue] = useState("1");
  const [atomicRpcStatus, setAtomicRpcStatus] = useState<"checking" | "available" | "unavailable">("checking");
  const [atomicFallbackCount, setAtomicFallbackCount] = useState(0);
  const [creditDueDate, setCreditDueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentFeedbackStatus, setPaymentFeedbackStatus] = useState<PaymentFeedbackStatus>("idle");
  const [paymentFeedbackMessage, setPaymentFeedbackMessage] = useState("");
  const [retryPendingTenders, setRetryPendingTenders] = useState<Array<{ method: PaymentMethodCode; amount: number }>>([]);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [showCustomerPanel, setShowCustomerPanel] = useState(false);
  const localAuthEnabled = ["true", "1", "yes"].includes((import.meta.env.VITE_LOCAL_AUTH || "").trim().toLowerCase());
  const useDesktopLocalMode = localAuthEnabled && desktopApi.isAvailable();

  useEffect(() => {
    loadProducts();
  }, []);

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
    setOfflineQueueCount(readOfflineRetailQueue().length);
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
    const timer = window.setTimeout(() => {
      setDebouncedScanQuery(scanCode.trim().toLowerCase());
    }, 150);
    return () => window.clearTimeout(timer);
  }, [scanCode]);

  useEffect(() => {
    if (!debouncedScanQuery) {
      setScanSuggestions([]);
      return;
    }
    const exact =
      products.find((p) => (p.barcode || "").toLowerCase() === debouncedScanQuery) ||
      products.find((p) => (p.sku || "").toLowerCase() === debouncedScanQuery) ||
      products.find((p) => (p.code || "").toLowerCase() === debouncedScanQuery);
    if (exact) {
      addToCart(exact);
      setScanCode("");
      setScanSuggestions([]);
      return;
    }
    const top = products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(debouncedScanQuery) ||
          (p.barcode || "").toLowerCase().includes(debouncedScanQuery) ||
          (p.sku || "").toLowerCase().includes(debouncedScanQuery) ||
          (p.code || "").toLowerCase().includes(debouncedScanQuery)
      )
      .slice(0, 6);
    setScanSuggestions(top);
  }, [debouncedScanQuery, products]);

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

  const loadProducts = async () => {
    setLoading(true);
    setProductsError(null);
    try {
      if (useDesktopLocalMode) {
        const [localStoreProducts, localPosProducts] = await Promise.all([
          desktopApi.localSelect({
            table: "products",
            orderBy: { column: "name", ascending: true },
            limit: 5000,
          }),
          desktopApi.listPosProducts(),
        ]);

        const fromLocalStore = ((localStoreProducts.rows || []) as Array<Record<string, unknown>>)
          .map((row) => {
            const id = String(row.id || "").trim();
            const name = String(row.name || "").trim();
            if (!id || !name) return null;
            return {
              id,
              name,
              sales_price: row.sales_price == null ? 0 : Number(row.sales_price),
              cost_price: row.cost_price == null ? null : Number(row.cost_price),
              track_inventory: row.track_inventory == null ? true : Boolean(row.track_inventory),
              department_id: row.department_id == null ? null : String(row.department_id),
              barcode: row.barcode == null ? null : String(row.barcode),
              sku: row.sku == null ? null : String(row.sku),
              code: row.code == null ? null : String(row.code),
            } as Product;
          })
          .filter((row): row is Product => Boolean(row));

        if (fromLocalStore.length > 0) {
          setProducts(fromLocalStore.sort((a, b) => a.name.localeCompare(b.name)));
          setLoading(false);
          return;
        }

        // Legacy fallback only when local `products` is empty.
        const fromLegacyPos = (localPosProducts || [])
          .map((p) => {
            const id = String(p.id || "").trim();
            const name = String(p.name || "").trim();
            return {
              id,
              name,
              sales_price: Number(p.selling_price ?? 0),
              cost_price: null,
              track_inventory: true,
              department_id: null,
              barcode: null,
              sku: p.sku,
              code: null,
            };
          })
          .filter((p) => p.id && p.name);

        setProducts(fromLegacyPos.sort((a, b) => a.name.localeCompare(b.name)));
        setLoading(false);
        return;
      }
      const rich = await supabase
        .from("products")
        .select("id,name,sales_price,cost_price,track_inventory,department_id,barcode,sku,code")
        .eq("active", true)
        .order("name");

      if (!rich.error && rich.data) {
        const rows = rich.data as Product[];
        setProducts(rows);
        localStorage.setItem("boat.retail.products.cache.v1", JSON.stringify(rows));
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
      localStorage.setItem("boat.retail.products.cache.v1", JSON.stringify(mapped));
    } catch (error) {
      console.error("Retail products load error:", error);
      const cached = localStorage.getItem("boat.retail.products.cache.v1");
      if (cached) {
        try {
          setProducts(JSON.parse(cached) as Product[]);
          setProductsError("Loaded cached products (offline cache).");
          return;
        } catch {
          // ignore parse failure
        }
      }
      setProductsError("Failed to load retail products.");
    } finally {
      setLoading(false);
    }
  };

  const getUnitPrice = (product: Product, quantity = 1) => getProductPrice(product, { quantity });

  const addToCart = (product: Product) => {
    setCartByProductId((prev) => {
      const existing = prev[product.id];
      if (existing) {
        const nextQty = existing.quantity + 1;
        const unit = getUnitPrice(product, nextQty);
        return { ...prev, [product.id]: { ...existing, quantity: nextQty, lineTotal: unit * nextQty } };
      }
      const unit = getUnitPrice(product, 1);
      return { ...prev, [product.id]: { product, quantity: 1, lineTotal: unit } };
    });
    setSelectedProductId(product.id);
    setQuickPickStats((prev) => {
      const next = { ...prev, [product.id]: (prev[product.id] || 0) + 1 };
      try {
        localStorage.setItem(QUICK_PICK_STATS_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage errors.
      }
      return next;
    });
  };

  const updateQty = (productId: string, nextQty: number) => {
    if (nextQty <= 0) {
      setCartByProductId((prev) => {
        const next = { ...prev };
        delete next[productId];
        return next;
      });
      return;
    }
    setCartByProductId((prev) => {
      const item = prev[productId];
      if (!item) return prev;
      const unit = getUnitPrice(item.product, nextQty);
      return { ...prev, [productId]: { ...item, quantity: nextQty, lineTotal: unit * nextQty } };
    });
  };

  const openQtyPad = (productId: string, quantity: number) => {
    setQtyPadProductId(productId);
    setQtyPadValue(String(quantity));
  };

  const closeQtyPad = () => {
    setQtyPadProductId(null);
    setQtyPadValue("1");
  };

  const applyQtyPad = () => {
    if (!qtyPadProductId) return;
    const parsed = Number(qtyPadValue);
    if (!Number.isFinite(parsed)) {
      toast({ title: "Invalid quantity", description: "Enter a valid whole number." });
      return;
    }
    const nextQty = Math.max(0, Math.floor(parsed));
    updateQty(qtyPadProductId, nextQty);
    closeQtyPad();
  };

  const qtyPadAppend = (digit: string) => {
    setQtyPadValue((prev) => {
      if (prev === "0") return digit;
      return `${prev}${digit}`.slice(0, 4);
    });
  };

  const qtyPadBackspace = () => {
    setQtyPadValue((prev) => {
      if (prev.length <= 1) return "0";
      return prev.slice(0, -1);
    });
  };

  const cart = useMemo(() => Object.values(cartByProductId), [cartByProductId]);
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
  const filteredManualProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products;
    return products
      .filter((p) =>
        [p.name.toLowerCase(), (p.barcode || "").toLowerCase(), (p.sku || "").toLowerCase(), (p.code || "").toLowerCase()].some((v) =>
          v.includes(q)
        )
      );
  }, [products, productSearch]);

  const jumpToProductByInitial = (initial: string) => {
    const key = initial.trim().toLowerCase();
    if (!key || key.length !== 1) return;
    const list = filteredManualProducts;
    if (list.length === 0) return;
    const currentIndex = list.findIndex((p) => p.id === selectedProductId);
    const normalizedName = (name: string) => name.trim().toLowerCase();
    for (let step = 1; step <= list.length; step += 1) {
      const idx = (currentIndex + step + list.length) % list.length;
      const candidate = list[idx];
      if (normalizedName(candidate.name).startsWith(key)) {
        setSelectedProductId(candidate.id);
        return;
      }
    }
  };
  const total = useMemo(() => cart.reduce((sum, i) => sum + i.lineTotal, 0), [cart]);
  const amountPaid = useMemo(() => paymentLines.reduce((sum, p) => sum + p.amount, 0), [paymentLines]);
  const hasPendingTender = useMemo(() => paymentLines.some((p) => p.status === "pending"), [paymentLines]);
  const amountDue = Math.max(0, Math.round((total - amountPaid) * 100) / 100);
  const changeDue = Math.max(0, Math.round((amountPaid - total) * 100) / 100);
  const paymentStatus: PosPaymentStatus =
    amountPaid === 0 ? (hasPendingTender ? "pending" : "pending") : amountPaid < total ? "partial" : amountPaid > total ? "overpaid" : "completed";
  const saleType: "cash" | "credit" | "mixed" =
    amountPaid <= 0 ? "credit" : amountPaid < total ? "mixed" : "cash";
  const hasMobileTender = useMemo(
    () => paymentLines.some((p) => p.method === "mtn_mobile_money" || p.method === "airtel_money"),
    [paymentLines]
  );
  const posCustomerSummary = useMemo(() => {
    const fromDraft = customerNameDraft.trim();
    if (fromDraft) return fromDraft;
    if (selectedCustomerId) {
      return customers.find((c) => c.id === selectedCustomerId)?.name?.trim() || "Selected";
    }
    return "";
  }, [customerNameDraft, selectedCustomerId, customers]);
  const stkPushEnabled = receiptOrgHeader?.stkPushEnabled === true;

  const normalizeMobilePhone = (raw: string) => {
    const digits = raw.replace(/[^\d+]/g, "").trim();
    if (!digits) return "";
    if (digits.startsWith("+")) return digits;
    if (digits.startsWith("0")) return `+256${digits.slice(1)}`;
    if (digits.startsWith("256")) return `+${digits}`;
    return `+${digits}`;
  };

  const collectMobileMoneyPayments = async (
    saleId: string,
    tenders: CheckoutTender[],
    phone: string
  ): Promise<CheckoutTender[]> => {
    const pending = tenders.filter((t) => t.status === "pending");
    if (pending.length === 0) return tenders;
    const customerName = customerNameDraft.trim() || "Retail customer";
    const normalizedPhone = normalizeMobilePhone(phone);
    for (const line of pending) {
      const network = line.method === "mtn_mobile_money" ? "mtn" : "airtel";
      const { data, error } = await supabase.functions.invoke("flutterwave-mobile-money", {
        body: {
          action: "collect",
          network,
          amount: line.amount,
          currency: "UGX",
          phone_number: normalizedPhone,
          customer_name: customerName,
          customer_email: user?.email ?? "no-reply@boat.local",
          tx_ref: `${saleId}-${line.id}`,
          sale_id: saleId,
          organization_id: orgId ?? null,
          payment_method: line.method,
          timeout_seconds: 60,
        },
      });
      if (error) {
        throw new Error(error.message || "Failed to initiate mobile money payment.");
      }
      const status = (data as MobileCollectionResponse | null)?.status;
      if (status !== "successful") {
        const detail = (data as MobileCollectionResponse | null)?.message || "Mobile money payment failed.";
        throw new Error(detail);
      }
    }
    return tenders.map((t) => (t.status === "pending" ? { ...t, status: "completed" } : t));
  };
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

  const addPaymentLine = () => {
    const parsed = Number(paymentAmountDraft);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast({ title: "Invalid payment amount", description: "Enter a valid amount greater than zero." });
      return;
    }
    const status = paymentMethod === "mtn_mobile_money" || paymentMethod === "airtel_money" ? "pending" : "completed";
    setPaymentLines((prev) => [...prev, { id: randomUuid(), method: paymentMethod, amount: Math.round(parsed * 100) / 100, status }]);
    setPaymentAmountDraft("");
  };

  const addQuickPayment = (method: PaymentMethodCode) => {
    const target = amountDue > 0 ? amountDue : total;
    if (target <= 0) {
      toast({ title: "Cart is empty", description: "Scan or add at least one item before payment." });
      return;
    }
    const status = method === "mtn_mobile_money" || method === "airtel_money" ? "pending" : "completed";
    setPaymentMethod(method);
    setPaymentLines((prev) => [
      ...prev,
      { id: randomUuid(), method, amount: Math.round(target * 100) / 100, status },
    ]);
  };

  const removePaymentLine = (id: string) => {
    setPaymentLines((prev) => prev.filter((p) => p.id !== id));
  };

  const updatePaymentLine = (id: string, patch: Partial<{ method: PaymentMethodCode; amount: number }>) => {
    setPaymentLines((prev) =>
      prev.map((line) => {
        if (line.id !== id) return line;
        const nextMethod = patch.method ?? line.method;
        const nextAmount = patch.amount ?? line.amount;
        const nextStatus: "pending" | "completed" =
          nextMethod === "mtn_mobile_money" || nextMethod === "airtel_money" ? "pending" : "completed";
        return { ...line, method: nextMethod, amount: Math.max(0, Math.round(nextAmount * 100) / 100), status: nextStatus };
      })
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
        setPaymentLines([]);
        setCartByProductId({});
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
      setPaymentLines([]);
      setCartByProductId({});
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
      toast({ title: "Item not found", description: "No product matched the scanned code." });
      return;
    }
    addToCart(match);
    setScanCode("");
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

  const ensureLocalRetailCustomer = async (ctx: SaleCustomerContext): Promise<SaleCustomerContext> => {
    if (!useDesktopLocalMode) return ctx;
    const name = ctx.name?.trim() || "";
    const phone = ctx.phone?.trim() || null;
    if (!name) return { ...ctx, phone };
    try {
      if (ctx.id) {
        const updated = await desktopApi.updateRetailCustomer({
          id: ctx.id,
          name,
          phone,
        });
        if (updated?.id) {
          setCustomers((prev) =>
            prev.map((row) => (row.id === ctx.id ? { ...row, name, phone } : row))
          );
        }
        return { id: ctx.id, name, phone };
      }
      const created = await desktopApi.createRetailCustomer({ name, phone });
      if (created?.id) {
        const nextRow: RetailCustomerRow = {
          id: String(created.id),
          name,
          phone,
          credit_limit: Number(created.credit_limit ?? 0),
          current_credit_balance: Number(created.current_credit_balance ?? 0),
        };
        setCustomers((prev) => [nextRow, ...prev]);
        setSelectedCustomerId(nextRow.id);
        return { id: nextRow.id, name, phone };
      }
    } catch (error) {
      console.error("Failed to persist local retail customer:", error);
      toast({
        title: "Customer save failed",
        description: "Continuing sale without saving customer profile.",
      });
    }
    return { ...ctx, name, phone };
  };

  const saveCustomerProfile = async () => {
    const name = customerNameDraft.trim();
    if (!name) {
      toast({ title: "Customer name required", description: "Enter customer name before saving." });
      return;
    }
    const phone = customerPhoneDraft.trim() || null;
    setSavingCustomer(true);
    try {
      if (useDesktopLocalMode) {
        const resolved = await ensureLocalRetailCustomer({
          id: selectedCustomerId || null,
          name,
          phone,
        });
        setSelectedCustomerId(resolved.id || "");
        setCustomerNameDraft(resolved.name || "");
        setCustomerPhoneDraft(resolved.phone || "");
        toast({ title: "Customer saved" });
        return;
      }

      if (!orgId) {
        toast({ title: "Organization missing", description: "Cannot save customer without organization context." });
        return;
      }

      if (selectedCustomerId) {
        const { data, error } = await supabase
          .from("retail_customers")
          .update({ name, phone })
          .eq("id", selectedCustomerId)
          .select("id,name,phone,credit_limit,current_credit_balance")
          .single();
        if (error) throw error;
        const updated = data as RetailCustomerRow;
        setCustomers((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
        setCustomerNameDraft(updated.name);
        setCustomerPhoneDraft(updated.phone || "");
      } else {
        const payload = {
          name,
          phone,
          organization_id: orgId,
          current_credit_balance: 0,
        };
        const { data, error } = await supabase
          .from("retail_customers")
          .insert(payload)
          .select("id,name,phone,credit_limit,current_credit_balance")
          .single();
        if (error) throw error;
        const created = data as RetailCustomerRow;
        setCustomers((prev) => [created, ...prev]);
        setSelectedCustomerId(created.id);
        setCustomerNameDraft(created.name);
        setCustomerPhoneDraft(created.phone || "");
      }
      toast({ title: "Customer saved" });
    } catch (error) {
      console.error("Failed to save customer profile:", error);
      toast({ title: "Save failed", description: error instanceof Error ? error.message : "Try again." });
    } finally {
      setSavingCustomer(false);
    }
  };

  const persistRetailSaleLedger = async (
    saleId: string,
    lines: OfflineRetailLine[],
    tenders: OfflineRetailPayment[],
    currentOrgId: string | undefined,
    processedBy: string | null,
    saleCustomer: SaleCustomerContext
  ) => {
    if (!currentOrgId) return;
    const { data: existingSale, error: existingErr } = await supabase
      .from("retail_sales")
      .select("id")
      .eq("organization_id", currentOrgId)
      .eq("idempotency_key", saleId)
      .maybeSingle();
    if (existingErr) return;
    if (existingSale?.id) return;

    const payload = {
      id: saleId,
      organization_id: currentOrgId,
      sale_at: new Date().toISOString(),
      idempotency_key: saleId,
      customer_id: saleCustomer.id,
      customer_name: saleCustomer.name,
      customer_phone: saleCustomer.phone,
      total_amount: total,
      amount_paid: amountPaid,
      amount_due: amountDue,
      change_amount: changeDue,
      payment_status: paymentStatus,
      sale_type: saleType,
      credit_due_date: creditDueDate || null,
      vat_enabled: posVatEnabled,
      vat_rate: posVatRate,
      created_by: processedBy,
      cashier_session_id: activeSession?.id ?? null,
    };
    const { error: saleErr } = await supabase.from("retail_sales").insert(payload);
    if (saleErr) return;

    const lineRows = lines.map((line, idx) => ({
      sale_id: saleId,
      line_no: idx + 1,
      product_id: line.productId,
      description: line.name,
      quantity: line.quantity,
      unit_price: line.unitPrice,
      line_total: line.lineTotal,
      unit_cost: line.costPrice,
      department_id: line.departmentId,
      track_inventory: line.trackInventory,
    }));
    if (lineRows.length > 0) {
      await supabase.from("retail_sale_lines").insert(lineRows);
    }
    const payRows = tenders.map((p) => ({
      sale_id: saleId,
      payment_method: p.method,
      amount: p.amount,
      payment_status: p.status,
    }));
    if (payRows.length > 0) {
      await supabase.from("retail_sale_payments").insert(payRows);
    }
  };

  const processSaleOnline = async (
    saleId: string,
    lines: OfflineRetailLine[],
    tenders: OfflineRetailPayment[],
    saleCustomer: SaleCustomerContext
  ) => {
    if (useDesktopLocalMode) {
      const payload = {
        sale_id: saleId,
        cashier_session_id: activeSession?.id ?? null,
        customer_id: saleCustomer.id,
        customer_name: saleCustomer.name,
        customer_phone: saleCustomer.phone,
        total_amount: total,
        amount_paid: amountPaid,
        amount_due: amountDue,
        change_amount: changeDue,
        payment_status: paymentStatus,
        sale_type: saleType,
        credit_due_date: creditDueDate || null,
        vat_enabled: posVatEnabled,
        vat_rate: posVatRate,
        created_by: user?.id ?? null,
        lines: lines.map((line, idx) => ({
          line_no: idx + 1,
          product_id: line.productId,
          description: line.name,
          quantity: line.quantity,
          unit_price: line.unitPrice,
          line_total: line.lineTotal,
          unit_cost: line.costPrice,
          department_id: line.departmentId,
          track_inventory: line.trackInventory,
        })),
        payments: tenders.map((t) => ({
          payment_method: t.method,
          amount: t.amount,
          payment_status: t.status,
        })),
      };
      const created = await desktopApi.createRetailSale(payload);
      if (!created?.id) throw new Error("Failed to save local retail sale.");
      return;
    }
    const { data: staffRow } = await supabase.from("staff").select("id").eq("id", user?.id).maybeSingle();
    const currentOrgId = user?.organization_id ?? undefined;
    const selectedCustomer = customers.find((c) => c.id === saleCustomer.id);
    if (saleType !== "cash" && selectedCustomer) {
      const limit = Number(selectedCustomer.credit_limit ?? 0);
      const current = Number(selectedCustomer.current_credit_balance ?? 0);
      if (limit > 0 && current + amountDue > limit) {
        throw new Error(`Credit limit exceeded. Available credit is ${(limit - current).toFixed(2)}.`);
      }
    }
    const deptNameById = new Map(departments.map((d) => [d.id, d.name]));
    const cogsByDept = sumPosCogsByDept(
      lines.map((i) => ({
        quantity: i.quantity,
        unitCost: Number(i.costPrice ?? 0),
        departmentId: i.departmentId ?? null,
      })),
      deptNameById
    );
    const acc = await getDefaultGlAccounts();
    const receiptGl =
      tenders[0]?.method === "cash"
        ? acc.cash
        : tenders[0]?.method === "bank_transfer" || tenders[0]?.method === "card"
          ? acc.posBank ?? acc.cash
          : tenders[0]?.method === "airtel_money"
            ? acc.posAirtelMoney ?? acc.posMtnMobileMoney ?? acc.cash
            : acc.posMtnMobileMoney ?? acc.cash;
    const journalLines: Array<{ gl_account_id: string; debit: number; credit: number; line_description: string }> = [];
    if (receiptGl && acc.revenue) {
      journalLines.push(
        { gl_account_id: receiptGl, debit: total, credit: 0, line_description: "Retail sale receipt" },
        { gl_account_id: acc.revenue, debit: 0, credit: total, line_description: "Retail sales" }
      );
      if ((cogsByDept.bar ?? 0) > 0 && acc.posCogsBar && acc.posInvBar) {
        journalLines.push(
          { gl_account_id: acc.posCogsBar, debit: Number(cogsByDept.bar), credit: 0, line_description: "Bar COGS" },
          { gl_account_id: acc.posInvBar, debit: 0, credit: Number(cogsByDept.bar), line_description: "Bar stock" }
        );
      }
      if ((cogsByDept.kitchen ?? 0) > 0 && acc.posCogsKitchen && acc.posInvKitchen) {
        journalLines.push(
          { gl_account_id: acc.posCogsKitchen, debit: Number(cogsByDept.kitchen), credit: 0, line_description: "Kitchen COGS" },
          { gl_account_id: acc.posInvKitchen, debit: 0, credit: Number(cogsByDept.kitchen), line_description: "Kitchen stock" }
        );
      }
      if ((cogsByDept.room ?? 0) > 0 && acc.posCogsRoom && acc.posInvRoom) {
        journalLines.push(
          { gl_account_id: acc.posCogsRoom, debit: Number(cogsByDept.room), credit: 0, line_description: "Room COGS" },
          { gl_account_id: acc.posInvRoom, debit: 0, credit: Number(cogsByDept.room), line_description: "Room stock" }
        );
      }
    }
    const linePayload = lines.map((line, idx) => ({
      line_no: idx + 1,
      product_id: line.productId,
      description: line.name,
      quantity: line.quantity,
      unit_price: line.unitPrice,
      line_total: line.lineTotal,
      unit_cost: line.costPrice,
      department_id: line.departmentId,
      track_inventory: line.trackInventory,
    }));
    const paymentPayload = tenders.map((t) => ({ method: t.method, amount: t.amount, status: t.status }));
    const bumpCustomerCreditExposure = async () => {
      if (!saleCustomer.id || amountDue <= 0) return;
      const { data: cRow } = await supabase
        .from("retail_customers")
        .select("current_credit_balance")
        .eq("id", saleCustomer.id)
        .maybeSingle();
      const current = Number((cRow as { current_credit_balance?: number } | null)?.current_credit_balance ?? 0);
      const next = Math.round((current + amountDue) * 100) / 100;
      await supabase.from("retail_customers").update({ current_credit_balance: next }).eq("id", saleCustomer.id);
    };
    if (currentOrgId) {
      const { error: atomicErr } = await supabase.rpc("post_retail_sale_atomic", {
        p_sale_id: saleId,
        p_organization_id: currentOrgId,
        p_created_by: staffRow?.id ?? null,
        p_customer_id: saleCustomer.id,
        p_customer_name: saleCustomer.name,
        p_customer_phone: saleCustomer.phone,
        p_total_amount: total,
        p_amount_paid: amountPaid,
        p_amount_due: amountDue,
        p_change_amount: changeDue,
        p_payment_status: paymentStatus,
        p_vat_enabled: posVatEnabled,
        p_vat_rate: posVatRate,
        p_cashier_session_id: activeSession?.id ?? null,
        p_lines: linePayload,
        p_payments: paymentPayload,
        p_journal_entry_date: businessTodayISO(),
        p_journal_description: lines.map((i) => `${i.quantity}x ${i.name}`).join(", ") || "Retail POS sale",
        p_journal_lines: journalLines,
      });
      if (!atomicErr) {
        await supabase
          .from("retail_sales")
          .update({ sale_type: saleType, credit_due_date: creditDueDate || null })
          .eq("id", saleId);
        setAtomicRpcStatus("available");
        await bumpCustomerCreditExposure();
        return;
      }
      setAtomicRpcStatus("unavailable");
      const key = "boat.retail.atomic.fallback.count";
      const nextFallbackCount = Number(localStorage.getItem(key) || 0) + 1;
      localStorage.setItem(key, String(nextFallbackCount));
      setAtomicFallbackCount(nextFallbackCount);
      console.warn("Atomic retail RPC unavailable, falling back to legacy path:", atomicErr.message);
    }
    await persistRetailSaleLedger(saleId, lines, tenders, currentOrgId, staffRow?.id ?? null, saleCustomer);
    await bumpCustomerCreditExposure();
    for (const tender of tenders) {
      const { error: paymentError } = await insertPaymentWithMethodCompat(
        supabase,
        {
          stay_id: null,
          ...(currentOrgId ? { organization_id: currentOrgId } : {}),
          payment_source: "pos_retail",
          amount: tender.amount,
          payment_status: tender.status,
          transaction_id: saleId,
          processed_by: staffRow?.id ?? null,
          retail_customer_id: saleCustomer.id,
          source_documents: {
            sale_total: total,
            payment_status: paymentStatus,
            amount_paid: amountPaid,
            amount_due: amountDue,
            customer_name: saleCustomer.name,
            customer_phone: saleCustomer.phone,
            cashier_session_id: activeSession?.id ?? null,
          },
        },
        tender.method
      );
      if (paymentError) throw paymentError;
    }

    const stockMoves = lines
      .filter((i) => i.trackInventory)
      .map((i) => ({
        product_id: i.productId,
        source_type: "sale",
        source_id: saleId,
        quantity_in: 0,
        quantity_out: i.quantity,
        unit_cost: i.costPrice,
        note: "Retail POS sale",
      }));
    if (stockMoves.length > 0) {
      const { error: stockErr } = await supabase.from("product_stock_movements").insert(stockMoves);
      if (stockErr) throw stockErr;
    }

    const description = lines.map((i) => `${i.quantity}x ${i.name}`).join(", ");
    const js = await resolveJournalAccountSettings(currentOrgId ?? undefined);
    const vatRate = js.default_vat_percent;
    const useVatJournal = posVatEnabled && vatRate != null && Number.isFinite(vatRate) && vatRate > 0;
    const jr = await createJournalForPosOrder(saleId, total, description || "Retail POS sale", businessTodayISO(), staffRow?.id ?? null, {
      paymentMethod: tenders[0]?.method ?? "cash",
      cogsByDept,
      vatRatePercent: useVatJournal ? vatRate : undefined,
      organizationId: currentOrgId ?? null,
    });
    if (!jr.ok) alert(`Sale recorded but journal was not posted: ${jr.error}`);
  };

  const flushOfflineQueue = async () => {
    if (syncingOfflineQueue) return;
    const queue = readOfflineRetailQueue();
    if (queue.length === 0) return;
    setSyncingOfflineQueue(true);
    try {
      for (const row of queue) {
        await processSaleOnline(row.id, row.lines, row.payments);
        removeOfflineRetailSale(row.id);
      }
      setOfflineQueueCount(readOfflineRetailQueue().length);
    } catch (error) {
      console.error("Offline sync failed:", error);
    } finally {
      setSyncingOfflineQueue(false);
    }
  };

  const checkout = async () => {
    if (readOnly) return toast({ title: "Read only mode", description: "Subscription inactive: Retail POS is read-only." });
    if (!activeSession) return toast({ title: "No active shift", description: "Open a cashier session first." });
    if (cart.length === 0) return toast({ title: "Cart is empty", description: "Scan or add at least one item." });
    if (paymentLines.length === 0) return toast({ title: "No tender lines", description: "Add at least one payment line." });
    let checkoutPhone = customerPhoneDraft.trim();
    const shouldUseStkPush = hasMobileTender && stkPushEnabled;
    if (shouldUseStkPush) {
      const selected = customers.find((c) => c.id === selectedCustomerId);
      const detectedPhone = selected?.phone?.trim() || checkoutPhone;
      if (!detectedPhone) {
        const prompted = window.prompt("Enter mobile number")?.trim() || "";
        if (!prompted) {
          toast({ title: "Mobile number required", description: "Enter customer phone to proceed with mobile payment." });
          setPaymentFeedbackStatus("failed");
          setPaymentFeedbackMessage("❌ Payment failed");
          return;
        }
        checkoutPhone = prompted;
        setCustomerPhoneDraft(prompted);
      } else {
        checkoutPhone = detectedPhone;
      }
      if (!customerPhoneDraft.trim()) {
        setCustomerPhoneDraft(detectedPhone);
      }
    }
    setProcessing(true);
    if (shouldUseStkPush) {
      setPaymentFeedbackStatus("waiting");
      setPaymentFeedbackMessage("⏳ Waiting for payment...");
    } else {
      setPaymentFeedbackStatus("idle");
      setPaymentFeedbackMessage("");
    }
    const saleId = randomUuid();
    const lines = buildOfflineLines();
    const tenders: CheckoutTender[] = paymentLines.map((p) => ({ id: p.id, method: p.method, amount: p.amount, status: p.status }));
    let saleCustomer: SaleCustomerContext = {
      id: selectedCustomerId || null,
      name: customerNameDraft.trim() || null,
      phone: customerPhoneDraft.trim() || null,
    };
    let shouldResetCheckoutState = false;
    try {
      if (!useDesktopLocalMode && !navigator.onLine) throw new Error("offline");
      saleCustomer = await ensureLocalRetailCustomer(saleCustomer);
      const verifiedTenders = shouldUseStkPush ? await collectMobileMoneyPayments(saleId, tenders, checkoutPhone) : tenders;
      if (shouldUseStkPush) {
        await Promise.race([
          processSaleOnline(
            saleId,
            lines,
            verifiedTenders.map((t) => ({ method: t.method, amount: t.amount, status: t.status })),
            saleCustomer
          ),
          new Promise((_, reject) => window.setTimeout(() => reject(new Error("payment_timeout")), 60_000)),
        ]);
      } else {
        await processSaleOnline(
          saleId,
          lines,
          verifiedTenders.map((t) => ({ method: t.method, amount: t.amount, status: t.status })),
          saleCustomer
        );
      }
      setOfflineQueueCount(readOfflineRetailQueue().length);
      toast({ title: "Retail sale completed" });
      if (shouldUseStkPush) {
        setPaymentFeedbackStatus("success");
        setPaymentFeedbackMessage("✅ Payment successful");
      } else {
        setPaymentFeedbackStatus("idle");
        setPaymentFeedbackMessage("");
      }
      setRetryPendingTenders([]);
      shouldResetCheckoutState = true;
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "offline") {
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
          payments: tenders,
          lines,
          vatEnabled: posVatEnabled,
          vatRate: posVatRate,
        });
        setOfflineQueueCount(readOfflineRetailQueue().length);
        toast({ title: "Offline mode", description: "Sale queued offline and will sync automatically." });
        setPaymentFeedbackStatus("waiting");
        setPaymentFeedbackMessage("⏳ Waiting for payment...");
        setRetryPendingTenders([]);
        shouldResetCheckoutState = true;
      } else if (shouldUseStkPush && error instanceof Error && error.message === "payment_timeout") {
        const cancelledPending = tenders
          .filter((p) => p.status === "pending")
          .map((p) => ({ method: p.method, amount: p.amount }));
        // Cancel pending mobile lines when payment takes too long.
        setPaymentLines((prev) => prev.filter((p) => p.status !== "pending"));
        setRetryPendingTenders(cancelledPending);
        toast({ title: "Payment timeout", description: "Payment timed out after 60 seconds and was cancelled." });
        setPaymentFeedbackStatus("failed");
        setPaymentFeedbackMessage("❌ Payment failed");
      } else {
        console.error("Retail checkout failed:", error);
        toast({ title: "Checkout failed", description: error instanceof Error ? error.message : "Try again." });
        if (shouldUseStkPush) {
          const cancelledPending = tenders
            .filter((p) => p.status === "pending")
            .map((p) => ({ method: p.method, amount: p.amount }));
          setRetryPendingTenders(cancelledPending);
          setPaymentFeedbackStatus("failed");
          setPaymentFeedbackMessage("❌ Payment failed");
        } else {
          setRetryPendingTenders([]);
          setPaymentFeedbackStatus("idle");
          setPaymentFeedbackMessage("");
        }
      }
    } finally {
      if (shouldResetCheckoutState) {
        setReceipt({
          saleId,
          paidAt: new Date().toISOString(),
          paymentMethod: paymentLines[0]?.method ?? "cash",
          total,
          lines: cart.map((i) => ({ name: i.product.name, qty: i.quantity, unitPrice: getUnitPrice(i.product), lineTotal: i.lineTotal })),
        });
        if (autoPrintReceipt) {
          window.setTimeout(() => {
            printRetailReceipt();
          }, 120);
        }
        setCartByProductId({});
        setPaymentLines([]);
        setPaymentAmountDraft("");
        setScanCode("");
        setCreditDueDate(new Date().toISOString().slice(0, 10));
      }
      setProcessing(false);
    }
  };

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

      <div className="flex flex-wrap items-start gap-3 mb-6">
        <h1 className="text-3xl font-bold text-slate-900">Retail POS</h1>
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
        <div className="ml-auto min-w-[280px] border border-slate-200 rounded-lg p-3 bg-slate-50">
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

      <div className="flex items-center gap-2 mb-4">
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

      {posMode === "cashier" ? (
      <div className="grid grid-cols-1 lg:grid-cols-10 gap-6">
        <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
            <ScanLine className="w-5 h-5" />
            Cart + Scan
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
              className="md:col-span-2 border border-slate-300 rounded-lg px-4 py-4 text-xl font-semibold"
            />
            <button
              type="button"
              onClick={handleScan}
              className="app-btn-primary text-base hover:bg-brand-900"
              disabled={readOnly}
            >
              Scan Item
            </button>
          </div>

          <div className="mb-4">
            <p className="text-sm font-semibold text-slate-700 mb-2">Quick picks (Top 10)</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {quickPickProducts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addToCart(p)}
                  className="text-sm border border-slate-300 rounded-lg px-3 py-2 hover:bg-slate-50 text-left truncate"
                >
                  <span className="block truncate">{p.name}</span>
                  <span className="block text-[11px] text-slate-500">{getUnitPrice(p).toFixed(2)}</span>
                </button>
              ))}
            </div>
          </div>
          {scanSuggestions.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {scanSuggestions.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    addToCart(p);
                    setScanCode("");
                    setScanSuggestions([]);
                  }}
                  className="text-xs border border-slate-300 rounded-full px-2.5 py-1 hover:bg-slate-50"
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}

          <div className="space-y-2 mb-3">
            <input
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Find product by name / barcode / SKU"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
            <div className="flex items-center gap-3">
              <select
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.altKey || e.ctrlKey || e.metaKey) return;
                  const key = e.key || "";
                  if (key.length !== 1 || !/[a-zA-Z]/.test(key)) return;
                  e.preventDefault();
                  jumpToProductByInitial(key);
                }}
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Select product manually</option>
                {filteredManualProducts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} - {getUnitPrice(p).toFixed(2)}
                  </option>
                ))}
              </select>
              {selectedProductId && (
                <button
                  type="button"
                  onClick={() => setSelectedProductId("")}
                  className="px-3 py-2 text-xs border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 mb-3">
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

          <div className="rounded-lg border border-slate-200 max-h-[30rem] overflow-y-auto">
            {cart.length === 0 ? (
              <p className="text-lg text-slate-500 p-4">No items yet. Start scanning.</p>
            ) : (
              cart.map((item) => (
                <div key={item.product.id} className="flex items-center justify-between gap-3 p-4 border-b last:border-b-0 min-h-[84px]">
                  <div className="min-w-0">
                    <p className="text-lg font-semibold text-slate-900 truncate">{item.product.name}</p>
                    <p className="text-sm text-slate-500">
                      {getUnitPrice(item.product).toFixed(2)} x {item.quantity}
                    </p>
                    <div className="mt-2 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => updateQty(item.product.id, 1)}
                        className="px-2 py-1 rounded-md text-xs font-semibold border border-slate-300 hover:bg-slate-50"
                      >
                        x1
                      </button>
                      <button
                        type="button"
                        onClick={() => updateQty(item.product.id, 2)}
                        className="px-2 py-1 rounded-md text-xs font-semibold border border-slate-300 hover:bg-slate-50"
                      >
                        x2
                      </button>
                      <button
                        type="button"
                        onClick={() => updateQty(item.product.id, 5)}
                        className="px-2 py-1 rounded-md text-xs font-semibold border border-slate-300 hover:bg-slate-50"
                      >
                        x5
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => updateQty(item.product.id, item.quantity - 1)} className="p-2 hover:bg-slate-100 rounded-lg">
                      <Minus className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openQtyPad(item.product.id, item.quantity)}
                      className="w-10 text-center text-base font-semibold rounded-md border border-slate-300 hover:bg-slate-50"
                      title="Tap to set quantity"
                    >
                      {item.quantity}
                    </button>
                    <button onClick={() => updateQty(item.product.id, item.quantity + 1)} className="p-2 hover:bg-slate-100 rounded-lg">
                      <Plus className="w-4 h-4" />
                    </button>
                    <button onClick={() => updateQty(item.product.id, 0)} className="p-2 hover:bg-red-100 text-red-600 rounded-lg">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <span className="text-lg font-bold text-slate-900">{item.lineTotal.toFixed(2)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="lg:col-span-3 bg-white rounded-xl border border-slate-200 p-6 h-fit lg:sticky lg:top-4 self-start">
          <h2 className="text-lg font-bold text-slate-900 mb-4 flex flex-wrap items-center gap-2">
            <ShoppingCart className="w-5 h-5 shrink-0" />
            Payment
          </h2>

          <div className="mb-5 rounded-xl bg-slate-900 text-white px-4 py-5 text-center">
            <p className="text-sm uppercase tracking-wide text-slate-300">TOTAL</p>
            <p className="text-5xl font-extrabold tabular-nums mt-1">{total.toFixed(2)}</p>
          </div>

          <div className="mb-3">
            <button
              type="button"
              onClick={() => setShowCustomerPanel((open) => !open)}
              aria-expanded={showCustomerPanel}
              className="w-full flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-sm font-medium text-slate-800 hover:bg-slate-100 transition-colors"
            >
              <User className="w-4 h-4 shrink-0 text-slate-600" />
              <span className="flex-1 min-w-0">
                <span className="block text-xs text-slate-500">Customer (optional)</span>
                <span className="block truncate text-slate-900">
                  {posCustomerSummary
                    ? `${posCustomerSummary} — ${showCustomerPanel ? "tap to hide" : "tap to edit"}`
                    : showCustomerPanel
                      ? "Tap to hide"
                      : "Walk-in — tap to add details"}
                </span>
              </span>
              {showCustomerPanel ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
            </button>
            {showCustomerPanel && (
              <div className="mt-2 rounded-lg border border-slate-200 p-3 bg-slate-50">
                <p className="text-xs font-semibold text-slate-700 mb-2">Optional fields</p>
                <select
                  value={selectedCustomerId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setSelectedCustomerId(nextId);
                    const selected = customers.find((c) => c.id === nextId);
                    if (selected) {
                      setCustomerNameDraft(selected.name);
                      setCustomerPhoneDraft(selected.phone || "");
                    }
                  }}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2"
                >
                  <option value="">Walk-in customer</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.phone ? ` (${c.phone})` : ""}
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-1 gap-2">
                  <input
                    value={customerNameDraft}
                    onChange={(e) => setCustomerNameDraft(e.target.value)}
                    placeholder="Customer name"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                  <input
                    value={customerPhoneDraft}
                    onChange={(e) => setCustomerPhoneDraft(e.target.value)}
                    placeholder="Phone (optional)"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <button
                  type="button"
                  onClick={saveCustomerProfile}
                  disabled={savingCustomer || readOnly}
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  {savingCustomer ? "Saving..." : "Save Customer"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCustomerId("");
                    setCustomerNameDraft("");
                    setCustomerPhoneDraft("");
                  }}
                  className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Clear Customer
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <button type="button" onClick={() => addQuickPayment("cash")} className="rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 py-3 font-bold">
              CASH
            </button>
            <button type="button" onClick={() => addQuickPayment("mtn_mobile_money")} className="rounded-lg border border-sky-300 bg-sky-50 text-sky-800 py-3 font-bold">
              MTN MOMO
            </button>
            <button type="button" onClick={() => addQuickPayment("airtel_money")} className="rounded-lg border border-amber-300 bg-amber-50 text-amber-800 py-3 font-bold">
              AIRTEL
            </button>
            <button type="button" onClick={() => addQuickPayment("card")} className="rounded-lg border border-purple-300 bg-purple-50 text-purple-800 py-3 font-bold">
              CARD
            </button>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <input
              type="number"
              step="0.01"
              min="0"
              value={paymentAmountDraft}
              onChange={(e) => setPaymentAmountDraft(e.target.value)}
              placeholder="Amount"
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
            <button type="button" onClick={addPaymentLine} className="app-btn-primary text-sm" disabled={readOnly}>
              Add
            </button>
          </div>
          <div className="space-y-1 mb-3">
            {paymentLines.map((line) => (
              <div key={line.id} className="grid grid-cols-12 items-center gap-2 text-xs border border-slate-200 rounded px-2 py-1.5">
                <select
                  value={line.method}
                  onChange={(e) => updatePaymentLine(line.id, { method: e.target.value as PaymentMethodCode })}
                  className="col-span-6 border border-slate-300 rounded px-2 py-1 text-xs"
                >
                  {PAYMENT_METHOD_SELECT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={line.amount}
                  onChange={(e) => updatePaymentLine(line.id, { amount: Number(e.target.value || 0) })}
                  className="col-span-3 border border-slate-300 rounded px-2 py-1 text-xs"
                />
                <span className="col-span-2 text-[11px] text-slate-500 text-right">{line.status}</span>
                <button type="button" onClick={() => removePaymentLine(line.id)} className="text-red-600 hover:underline">
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className="text-xs text-slate-700 mb-4 space-y-1">
            <p>Paid: {amountPaid.toFixed(2)}</p>
            <p>Due: {amountDue.toFixed(2)}</p>
            <p>Change: {changeDue.toFixed(2)}</p>
            <p className="capitalize">Status: {paymentStatus}</p>
          </div>
          {paymentFeedbackStatus !== "idle" && (
            <div
              className={`mb-3 rounded-lg border px-3 py-2 text-xs font-medium ${
                paymentFeedbackStatus === "waiting"
                  ? "border-amber-200 bg-amber-50 text-amber-800"
                  : paymentFeedbackStatus === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-red-200 bg-red-50 text-red-700"
              }`}
            >
              {paymentFeedbackMessage}
            </div>
          )}
          {paymentFeedbackStatus === "failed" && retryPendingTenders.length > 0 && (
            <button
              type="button"
              onClick={() => {
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
                setPaymentFeedbackMessage("⏳ Waiting for payment...");
              }}
              className="mb-3 w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100"
            >
              Retry payment
            </button>
          )}

          <button
            type="button"
            disabled={processing || readOnly}
            onClick={checkout}
            className="app-btn-primary w-full py-5 text-xl font-extrabold disabled:cursor-not-allowed"
          >
            {processing ? <Loader2 className="w-5 h-5 animate-spin" /> : <CreditCard className="w-5 h-5" />}
            {processing ? "Processing..." : "Complete Sale"}
          </button>
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={autoPrintReceipt}
              onChange={(e) => setAutoPrintReceipt(e.target.checked)}
              className="rounded border-slate-300"
            />
            Auto print receipt after sale
          </label>
          <p className="text-xs text-slate-600 mt-2">
            Offline queue: {offlineQueueCount}
            {syncingOfflineQueue ? " (syncing...)" : ""}
          </p>
          <div className="mt-2 text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-slate-50">
            <p>
              Atomic checkout:{" "}
              <span className={atomicRpcStatus === "available" ? "text-emerald-700" : atomicRpcStatus === "unavailable" ? "text-amber-700" : "text-slate-600"}>
                {atomicRpcStatus}
              </span>
            </p>
            <p>Legacy fallback count: {atomicFallbackCount}</p>
          </div>

          <button
            type="button"
            onClick={printRetailReceipt}
            disabled={!receipt}
            className="w-full mt-3 border border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-700 py-2 rounded-lg font-medium text-sm flex items-center justify-center gap-2"
          >
            <Printer className="w-4 h-4" />
            {receipt ? "Print Receipt" : "Print Receipt (after sale)"}
          </button>
        </div>
      </div>
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-6">
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

        <div className="bg-white rounded-xl border border-slate-200 p-6">
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

        <div className="bg-white rounded-xl border border-slate-200 p-6">
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

        <div className="bg-white rounded-xl border border-slate-200 p-6">
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

      {receipt && (
        <div id="retail-receipt" className="mt-6 bg-white rounded-xl border border-slate-200 p-6">
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
