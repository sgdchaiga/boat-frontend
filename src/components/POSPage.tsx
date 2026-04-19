import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Minus, X, ShoppingCart, Loader2, RefreshCw, Wifi, WifiOff, TabletSmartphone, Hand, Pencil, Printer } from "lucide-react";
import { supabase } from "../lib/supabase";
import { businessTodayISO, computeRangeInTimezone } from "../lib/timezone";
import { useAuth } from "../contexts/AuthContext";
import {
  createJournalForPosOrder,
  createJournalForBillToRoom,
  sumPosCogsByDept,
  sumPosSalesByDept,
  type PosJournalGlOverrides,
  type RoomChargeGlOverrides,
} from "../lib/journal";
import { resolveJournalAccountSettings } from "../lib/journalAccountSettings";
import {
  insertPaymentWithMethodCompat,
  normalizePaymentMethod,
  PAYMENT_METHOD_SELECT_OPTIONS,
  type PaymentMethodCode,
} from "../lib/paymentMethod";
import type { Database } from "../lib/database.types";
import { ReadOnlyNotice } from "./common/ReadOnlyNotice";
import { PageNotes } from "./common/PageNotes";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";
import { GlAccountPicker, type GlAccountOption } from "./common/GlAccountPicker";
import { effectivePosCatalogMode } from "../lib/posCatalogMode";
import { randomUuid } from "../lib/randomUuid";
import { getNextOrderStatus, type ServiceType } from "../lib/hotelPosOrderStatus";

type Department = Database["public"]["Tables"]["departments"]["Row"];
type PropertyCustomer = Database["public"]["Tables"]["hotel_customers"]["Row"];

type PosGlAccountRow = {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
};

interface Product {
  id: string;
  name: string;
  sales_price?: number;  // POS unit price
  cost_price?: number | null;
  track_inventory?: boolean | null;
  department_id?: string | null;
}

interface CartItem {
  product: Product;
  quantity: number;
  note?: string;
  total: number;
  menuType?: PosMenuType;
  courseType?: "starter" | "main_course" | "dessert";
  fireTiming?: "now" | "with_mains" | "after_mains";
}

interface ActiveStay {
  id: string;
  room_id: string;
  rooms: { room_number: string } | null;
  hotel_customers: { id: string; first_name: string; last_name: string } | null;
}

interface QueuedOrder {
  id: string;
  room_id: string | null;
  room_number?: string | null;
  table_number: string | null;
  customer_name: string | null;
  order_status: string;
  created_at: string;
  kitchen_order_items?: { id?: string; product_id?: string; quantity: number; notes?: string; products?: { name: string; sales_price?: number | null } }[];
  payments_total?: number;
}

type PosAction = "send_kitchen" | "pay_now" | "bill_to_room" | "credit_sale";
interface HeldTicket {
  id: string;
  label: string;
  tableNumber: string;
  guestId: string;
  paymentMethod: PaymentMethodCode;
  items: CartItem[];
  createdAt: string;
}

interface RecipeIngredientRule {
  ingredientName: string;
  qtyPerUnit: number;
}

interface RecipeIngredientByIdRule {
  ingredientProductId: string;
  qtyPerUnit: number;
}

interface StockConsumptionLine {
  product_id: string;
  quantity_out: number;
  unit_cost: number | null;
  note: string;
}

type PaymentStatus = "pending" | "completed" | "failed" | "refunded";

interface PostedHotelTransaction {
  id: string;
  saleId: string;
  paidAt: string;
  amount: number;
  paymentMethod: PaymentMethodCode;
  paymentStatus: PaymentStatus;
  editedAt: string | null;
  editedByName: string | null;
}

interface PostedHotelTransactionDraft {
  amount: string;
  paymentMethod: PaymentMethodCode;
  paymentStatus: PaymentStatus;
}

type PosMenuType = "all" | "breakfast" | "lunch" | "bar" | "room_service";
type PosTableStatus = "available" | "occupied" | "reserved" | "cleaning";
type SplitBillMode = "item" | "guest" | "percentage";
type StationFilter = "all" | "bar" | "kitchen" | "dessert";

type PosSellMode = "kitchen_dishes" | "retail_products" | "all";

const POS_SELL_MODE_STORAGE_KEY = "hotel-pos-sell-mode-v1";

interface PosTableLayoutState {
  number: string;
  status: Exclude<PosTableStatus, "occupied">;
  waiterId: string;
}

interface PendingOfflineOrder {
  id: string;
  createdAt: string;
  status?: "pending" | "syncing" | "synced" | "failed" | "conflict";
  retryCount?: number;
  action: PosAction;
  tableNumber: string;
  selectedGuestId: string;
  selectedStayId: string | null;
  paymentMethod: PaymentMethodCode;
  items: Array<{ productId: string; quantity: number; note?: string; total: number }>;
}

// Temporary in-app recipe rules. Move to DB recipe tables when available.
const RECIPE_BY_PRODUCT_NAME: Record<string, RecipeIngredientRule[]> = {
  omelette: [{ ingredientName: "eggs", qtyPerUnit: 2 }],
  omelet: [{ ingredientName: "eggs", qtyPerUnit: 2 }],
};

const TABLE_LAYOUT_KEY = "hotel-pos-table-layout-v1";
const OFFLINE_ORDER_KEY = "hotel-pos-offline-orders-v1";
const OFFLINE_DB = "boat_pos_sync_db";
const OFFLINE_STORE = "hotel_pos_orders";
const BASE_TABLES = ["T1", "T2", "T3", "T4", "VIP1", "VIP2", "B1", "B2"];

interface POSPageProps {
  readOnly?: boolean;
  compactMode?: "full" | "waiter";
}

export function POSPage({ readOnly = false, compactMode = "full" }: POSPageProps = {}) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? undefined;
  const [products, setProducts] = useState<Product[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [hotelCustomers, setHotelCustomers] = useState<PropertyCustomer[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeStays, setActiveStays] = useState<ActiveStay[]>([]);
  const [queue, setQueue] = useState<QueuedOrder[]>([]);
  const [payQueueOrder, setPayQueueOrder] = useState<QueuedOrder | null>(null);
  const [payQueueAmount, setPayQueueAmount] = useState("");
  const [payQueueMethod, setPayQueueMethod] = useState<PaymentMethodCode>("cash");
  const [payQueueDate, setPayQueueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [savingQueuePayment, setSavingQueuePayment] = useState(false);
  const [selectedStay, setSelectedStay] = useState<ActiveStay | null>(null);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>("");
  const [selectedGuestId, setSelectedGuestId] = useState<string>("");
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [productSearch, setProductSearch] = useState("");
  const [tableNumber, setTableNumber] = useState("");
  const [online, setOnline] = useState<boolean>(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [touchMode, setTouchMode] = useState(false);
  const [selectedMenuType, setSelectedMenuType] = useState<PosMenuType>("all");
  const [modifierDraft, setModifierDraft] = useState("");
  const [happyHourEnabled, setHappyHourEnabled] = useState(false);
  const [happyHourStart, setHappyHourStart] = useState("17:00");
  const [happyHourEnd, setHappyHourEnd] = useState("19:00");
  const [happyHourDiscountPercent, setHappyHourDiscountPercent] = useState("10");
  const [tableLayout, setTableLayout] = useState<Record<string, PosTableLayoutState>>({});
  const [waiters, setWaiters] = useState<Array<{ id: string; full_name: string }>>([]);
  const [splitBillMode, setSplitBillMode] = useState<SplitBillMode>("item");
  const [stationFilter, setStationFilter] = useState<StationFilter>("all");
  const [posSellMode, setPosSellMode] = useState<PosSellMode>(() => {
    if (typeof window === "undefined") return "all";
    try {
      const v = localStorage.getItem(POS_SELL_MODE_STORAGE_KEY);
      if (v === "kitchen_dishes" || v === "retail_products" || v === "all") return v;
    } catch {
      /* ignore */
    }
    return "all";
  });
  const [tableSessionOpen, setTableSessionOpen] = useState(false);
  const [tableSessionStartedAt, setTableSessionStartedAt] = useState<string | null>(null);
  const [tableSessionId, setTableSessionId] = useState<string | null>(null);
  const [promoCode, setPromoCode] = useState("");
  const [promoDiscountPercent, setPromoDiscountPercent] = useState("0");
  const [managerPinDraft, setManagerPinDraft] = useState("");
  const [voidReasonDraftByPaymentId, setVoidReasonDraftByPaymentId] = useState<Record<string, string>>({});
  const [vipGuestIds, setVipGuestIds] = useState<Record<string, boolean>>({});
  const [splitPercentA, setSplitPercentA] = useState("50");
  const [splitGuestCount, setSplitGuestCount] = useState("2");
  const [promoEnabled, setPromoEnabled] = useState(true);
  const [vipPricingEnabled, setVipPricingEnabled] = useState(true);
  const [pendingOfflineOrders, setPendingOfflineOrders] = useState<PendingOfflineOrder[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodCode>("cash");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const submitLockRef = useRef(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [heldTickets, setHeldTickets] = useState<HeldTicket[]>([]);
  const [queueStatusFilter, setQueueStatusFilter] = useState<"active" | "all" | "pending" | "preparing">("active");
  const [recipeByProductId, setRecipeByProductId] = useState<Record<string, RecipeIngredientByIdRule[]>>({});
  const [postedTransactions, setPostedTransactions] = useState<PostedHotelTransaction[]>([]);
  const [postedTransactionDrafts, setPostedTransactionDrafts] = useState<Record<string, PostedHotelTransactionDraft>>({});
  const [postedTransactionsLoading, setPostedTransactionsLoading] = useState(false);
  const [postedTransactionsError, setPostedTransactionsError] = useState<string | null>(null);
  const [savingPostedTransactionId, setSavingPostedTransactionId] = useState<string | null>(null);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [editingOrderDate, setEditingOrderDate] = useState("");
  const [editingOrderItems, setEditingOrderItems] = useState<Array<{ product_id: string; quantity: number; notes: string }>>([]);
  const [showPrintBill, setShowPrintBill] = useState(false);
  const printRef = useRef<HTMLDivElement | null>(null);
  const isWaiterCompact = compactMode === "waiter";
  const [showTableLayout, setShowTableLayout] = useState(!isWaiterCompact);
  const [showOrderQueue, setShowOrderQueue] = useState(!isWaiterCompact);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showPostedTransactions, setShowPostedTransactions] = useState(false);
  const [queueDate, setQueueDate] = useState(() => {
    const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kampala", year: "numeric", month: "2-digit", day: "2-digit" });
    const p = f.formatToParts(new Date());
    const y = p.find((x) => x.type === "year")!.value;
    const m = p.find((x) => x.type === "month")!.value;
    const d = p.find((x) => x.type === "day")!.value;
    return `${y}-${m}-${d}`;
  });
  const [posVatEnabled, setPosVatEnabled] = useState(false);
  const [posVatRate, setPosVatRate] = useState<number | null>(null);
  const compactView = !touchMode;

  /** Per-sale GL overrides (optional). Empty = use journal settings / chart fallbacks. */
  const [glAccounts, setGlAccounts] = useState<PosGlAccountRow[]>([]);
  const [posGlRevenueId, setPosGlRevenueId] = useState("");
  const [posGlReceiptId, setPosGlReceiptId] = useState("");
  const [posGlVatId, setPosGlVatId] = useState("");
  const [posGlReceivableId, setPosGlReceivableId] = useState("");
  const [posGlCogsBar, setPosGlCogsBar] = useState("");
  const [posGlInvBar, setPosGlInvBar] = useState("");
  const [posGlCogsKitchen, setPosGlCogsKitchen] = useState("");
  const [posGlInvKitchen, setPosGlInvKitchen] = useState("");
  const [posGlCogsRoom, setPosGlCogsRoom] = useState("");
  const [posGlInvRoom, setPosGlInvRoom] = useState("");
  const [posGlAdvancedOpen, setPosGlAdvancedOpen] = useState(false);

  const glByType = useCallback(
    (t: string): GlAccountOption[] =>
      glAccounts
        .filter((a) => a.account_type === t)
        .map((a) => ({ id: a.id, account_code: a.account_code, account_name: a.account_name })),
    [glAccounts]
  );

  const allGlOptions = useMemo(
    () =>
      glAccounts.map((a) => ({
        id: a.id,
        account_code: a.account_code,
        account_name: a.account_name,
      })),
    [glAccounts]
  );

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
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("gl_accounts")
        .select("id, account_code, account_name, account_type")
        .eq("is_active", true)
        .order("account_code");
      if (cancelled || error) return;
      setGlAccounts((data || []) as PosGlAccountRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, user?.isSuperAdmin]);

  useEffect(() => {
    loadData();
  }, [queueDate, queueStatusFilter, user?.organization_id, user?.isSuperAdmin]);

  useEffect(() => {
    void loadPostedTransactions();
  }, [queueDate, user?.organization_id, user?.isSuperAdmin]);

  useEffect(() => {
    const syncOnlineState = () => setOnline(navigator.onLine);
    window.addEventListener("online", syncOnlineState);
    window.addEventListener("offline", syncOnlineState);
    return () => {
      window.removeEventListener("online", syncOnlineState);
      window.removeEventListener("offline", syncOnlineState);
    };
  }, []);

  useEffect(() => {
    const parsed = (() => {
      try {
        const raw = localStorage.getItem(TABLE_LAYOUT_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as Record<string, PosTableLayoutState>;
      } catch {
        return null;
      }
    })();
    const next: Record<string, PosTableLayoutState> = {};
    BASE_TABLES.forEach((table) => {
      next[table] = parsed?.[table] || { number: table, status: "available", waiterId: "" };
    });
    setTableLayout(next);
  }, []);

  useEffect(() => {
    localStorage.setItem(TABLE_LAYOUT_KEY, JSON.stringify(tableLayout));
  }, [tableLayout]);

  useEffect(() => {
    void (async () => {
      try {
        const indexed = await getOfflineOrdersIndexedDb();
        if (indexed.length > 0) {
          setPendingOfflineOrders(indexed);
          return;
        }
      } catch {
        // fallback below
      }
      try {
        const raw = localStorage.getItem(OFFLINE_ORDER_KEY);
        const parsed = raw ? (JSON.parse(raw) as PendingOfflineOrder[]) : [];
        setPendingOfflineOrders(parsed);
      } catch {
        setPendingOfflineOrders([]);
      }
    })();
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("hotel-pos-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "kitchen_orders" }, () => {
        void loadData();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "payments" }, () => {
        void loadPostedTransactions();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queueDate, queueStatusFilter, user?.organization_id, user?.isSuperAdmin]);

  const loadData = async () => {
    setLoading(true);
    setProductsError(null);
    setQueueError(null);

    try {
      const { from, to } = computeRangeInTimezone("custom", queueDate, queueDate);
      const orgId = user?.organization_id ?? undefined;
      const superAdmin = !!user?.isSuperAdmin;

      let ordersQuery = supabase
        .from("kitchen_orders")
        .select("id,room_id,table_number,customer_name,order_status,created_at,kitchen_order_items(id,quantity,notes,product_id)")
        .gte("created_at", from.toISOString())
        .lt("created_at", to.toISOString())
        .order("created_at", { ascending: false });
      if (queueStatusFilter === "active") {
        ordersQuery = ordersQuery.in("order_status", ["pending", "preparing"]);
      } else if (queueStatusFilter !== "all") {
        ordersQuery = ordersQuery.eq("order_status", queueStatusFilter);
      }
      ordersQuery = filterByOrganizationId(ordersQuery, orgId, superAdmin);

      const [productsRes, staysRes, ordersRes, departmentsRes, customersRes, roomsRes, waitersRes, profilesRes] = await Promise.all([
        filterByOrganizationId(
          supabase
            .from("products")
            .select("id,name,sales_price,cost_price,track_inventory,department_id,saleable")
            .eq("active", true)
            .eq("saleable", true),
          orgId,
          superAdmin
        ),
        filterByOrganizationId(
          supabase
            .from("stays")
            .select("id,room_id,rooms(room_number),hotel_customers(id,first_name,last_name)")
            .is("actual_check_out", null),
          orgId,
          superAdmin
        ),
        ordersQuery,
        filterByOrganizationId(supabase.from("departments").select("id,name,pos_catalog_mode").order("name"), orgId, superAdmin),
        filterByOrganizationId(supabase.from("hotel_customers").select("id,first_name,last_name").order("first_name"), orgId, superAdmin),
        filterByOrganizationId(supabase.from("rooms").select("id,room_number"), orgId, superAdmin),
        filterByOrganizationId(supabase.from("staff").select("id,full_name").eq("is_active", true).order("full_name"), orgId, superAdmin),
        filterByOrganizationId((supabase as any).from("pos_customer_profiles").select("property_customer_id,vip"), orgId, superAdmin),
      ]);

      if (productsRes.data) setProducts(productsRes.data as Product[]);
      if (productsRes.error) setProductsError(productsRes.error.message);
      if (productsRes.data) await loadRecipeRules(productsRes.data as Product[]);

      if (staysRes.data) setActiveStays(staysRes.data as unknown as ActiveStay[]);
      const rawOrders = (ordersRes.data || []) as any[];
      const productMap = Object.fromEntries((productsRes.data || []).map((p: any) => [p.id, p]));
      const deptMap = Object.fromEntries(((departmentsRes.data || []) as any[]).map((d: any) => [d.id, String(d.name || "").toLowerCase()]));
      const roomMap = Object.fromEntries(((roomsRes.data || []) as any[]).map((r: any) => [r.id, r.room_number]));
      const queueWithProducts = rawOrders.map((o) => ({
        ...o,
        room_number: o.room_id ? roomMap[o.room_id] ?? null : null,
        kitchen_order_items: (o.kitchen_order_items || []).map((i: any) => ({
          ...i,
          station: (() => {
            const deptId = i.product_id && productMap[i.product_id] ? productMap[i.product_id].department_id : null;
            const deptName = deptId ? deptMap[deptId] || "" : "";
            const deptRow = (departmentsRes.data || []).find((x: { id: string }) => x.id === deptId) as
              | { name?: string; pos_catalog_mode?: string | null }
              | undefined;
            const n = deptName.toLowerCase();
            if (n.includes("dessert")) return "dessert";
            if (n.includes("bar") || n.includes("sauna") || n.includes("spa")) return "bar";
            if (deptRow && effectivePosCatalogMode(deptRow) === "product_catalog") return "bar";
            return "kitchen";
          })(),
          products:
            i.product_id && productMap[i.product_id]
              ? { name: productMap[i.product_id].name, sales_price: productMap[i.product_id].sales_price ?? 0 }
              : { name: "Item", sales_price: 0 },
        })),
      }));
      const orderIds = queueWithProducts.map((o: any) => String(o.id));
      let paymentsMap: Record<string, number> = {};
      if (orderIds.length > 0) {
        const { data: paymentsData, error: payError } = await filterByOrganizationId(
          supabase.from("payments").select("amount, payment_status, transaction_id").in("transaction_id", orderIds),
          orgId,
          superAdmin
        );
        if (payError) {
          console.error("POS queue payments:", payError);
        } else {
          (paymentsData || []).forEach((p: any) => {
            if (p.payment_status === "completed" && p.transaction_id) {
              const key = String(p.transaction_id);
              paymentsMap[key] = (paymentsMap[key] || 0) + Number(p.amount || 0);
            }
          });
        }
      }
      setQueue(
        (queueWithProducts as unknown as QueuedOrder[]).map((o) => ({
          ...o,
          payments_total: paymentsMap[o.id] || 0,
        }))
      );
      if (ordersRes.error) setQueueError(ordersRes.error.message);
      if (departmentsRes.data) setDepartments(departmentsRes.data as Department[]);
      if (customersRes.data) setHotelCustomers(customersRes.data as PropertyCustomer[]);
      if (waitersRes.data) setWaiters((waitersRes.data as Array<{ id: string; full_name: string }>) || []);
      if (!profilesRes?.error && profilesRes?.data) {
        const vipMap: Record<string, boolean> = {};
        (profilesRes.data as any[]).forEach((r) => {
          const id = String(r.property_customer_id || "");
          if (id) vipMap[id] = !!r.vip;
        });
        setVipGuestIds((prev) => ({ ...prev, ...vipMap }));
      }

      // default department to first one so products are always scoped
      if (!selectedDepartmentId && departmentsRes.data && departmentsRes.data.length > 0) {
        setSelectedDepartmentId(departmentsRes.data[0].id);
      }
    } catch (e) {
      setProductsError("Failed to load data");
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const getQueueOrderTotals = (order: QueuedOrder) => {
    const total = (order.kitchen_order_items || []).reduce((sum, item) => {
      const price = Number(item.products?.sales_price ?? 0);
      return sum + Number(item.quantity || 0) * price;
    }, 0);
    const paid = Number(order.payments_total || 0);
    const balance = Math.max(0, total - paid);
    return { total, paid, balance };
  };

  const openQueuePayModal = (order: QueuedOrder) => {
    const { balance } = getQueueOrderTotals(order);
    setPayQueueOrder(order);
    setPayQueueAmount(balance.toFixed(2));
    setPayQueueMethod("cash");
    setPayQueueDate(new Date().toISOString().slice(0, 10));
  };

  const saveQueueOrderPayment = async () => {
    if (!payQueueOrder) return;
    const amount = Number(payQueueAmount);
    const { balance } = getQueueOrderTotals(payQueueOrder);
    if (!Number.isFinite(amount) || amount <= 0) {
      alert("Enter a valid payment amount.");
      return;
    }
    if (amount > balance + 0.01) {
      alert("Payment cannot exceed outstanding amount.");
      return;
    }
    setSavingQueuePayment(true);
    try {
      const insertPayload: Record<string, unknown> = {
        amount,
        paid_at: `${payQueueDate}T12:00:00`,
        payment_status: "completed",
        payment_source: "pos_hotel",
        transaction_id: payQueueOrder.id,
        processed_by: user?.id ?? null,
        ...(orgId ? { organization_id: orgId } : {}),
      };
      const { error } = await insertPaymentWithMethodCompat(supabase, insertPayload, payQueueMethod);
      if (error) throw error;
      setPayQueueOrder(null);
      await loadData();
    } catch (e) {
      alert(`Failed to record payment: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingQueuePayment(false);
    }
  };

  const verifyManagerPin = async () => {
    const pin = managerPinDraft.trim();
    if (!pin) return false;
    try {
      const res = await (supabase as any).rpc("verify_manager_pin", { pin, org_id: orgId ?? null });
      if (!res?.error) return !!res?.data;
      // Fallback for pre-migration environments.
      return pin === "4321";
    } catch {
      return pin === "4321";
    }
  };

  const openTableSessionDb = async (table: string) => {
    try {
      const { data, error } = await (supabase as any)
        .from("pos_table_sessions")
        .insert({
          organization_id: orgId ?? null,
          table_number: table,
          status: "open",
          opened_by: user?.id ?? null,
        })
        .select("id, opened_at")
        .single();
      if (error) throw error;
      setTableSessionId(String(data.id));
      setTableSessionOpen(true);
      setTableSessionStartedAt(String(data.opened_at));
    } catch (err) {
      // fallback: local-only session
      setTableSessionId(null);
      setTableSessionOpen(true);
      setTableSessionStartedAt(new Date().toISOString());
    }
  };

  const closeTableSessionDb = async () => {
    if (!tableSessionId) {
      setTableSessionOpen(false);
      setTableSessionStartedAt(null);
      return;
    }
    try {
      await (supabase as any)
        .from("pos_table_sessions")
        .update({
          status: "closed",
          closed_at: new Date().toISOString(),
          closed_by: user?.id ?? null,
        })
        .eq("id", tableSessionId);
    } catch {
      // ignore
    } finally {
      setTableSessionId(null);
      setTableSessionOpen(false);
      setTableSessionStartedAt(null);
    }
  };

  const openOfflineDb = async () =>
    await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(OFFLINE_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(OFFLINE_STORE)) {
          db.createObjectStore(OFFLINE_STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

  const saveOfflineOrderIndexedDb = async (order: PendingOfflineOrder) => {
    const db = await openOfflineDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(OFFLINE_STORE, "readwrite");
      tx.objectStore(OFFLINE_STORE).put(order);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  };

  const deleteOfflineOrderIndexedDb = async (id: string) => {
    const db = await openOfflineDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(OFFLINE_STORE, "readwrite");
      tx.objectStore(OFFLINE_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  };

  const getOfflineOrdersIndexedDb = async () => {
    const db = await openOfflineDb();
    const rows = await new Promise<PendingOfflineOrder[]>((resolve, reject) => {
      const tx = db.transaction(OFFLINE_STORE, "readonly");
      const req = tx.objectStore(OFFLINE_STORE).getAll();
      req.onsuccess = () => resolve((req.result || []) as PendingOfflineOrder[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  };

  const loadPostedTransactions = async () => {
    setPostedTransactionsLoading(true);
    setPostedTransactionsError(null);
    try {
      const { from, to } = computeRangeInTimezone("custom", queueDate, queueDate);
      const orgId = user?.organization_id ?? undefined;
      const superAdmin = !!user?.isSuperAdmin;
      let ordersByDateQuery = supabase
        .from("kitchen_orders")
        .select("id")
        .gte("created_at", from.toISOString())
        .lt("created_at", to.toISOString());
      ordersByDateQuery = filterByOrganizationId(ordersByDateQuery, orgId, superAdmin);
      const { data: orderRows, error: ordersErr } = await ordersByDateQuery;
      if (ordersErr) throw ordersErr;
      const orderIds = ((orderRows || []) as Array<{ id: string }>).map((r) => r.id);
      if (orderIds.length === 0) {
        setPostedTransactions([]);
        setPostedTransactionDrafts({});
        return;
      }
      let query = supabase
        .from("payments")
        .select("id, transaction_id, paid_at, amount, payment_method, payment_status, edited_at, edited_by_name")
        .eq("payment_source", "pos_hotel")
        .in("transaction_id", orderIds)
        .order("paid_at", { ascending: false });
      query = filterByOrganizationId(query, orgId, superAdmin);
      let data: any[] | null = null;
      let error: { message?: string } | null = null;
      const richRes = await query;
      data = (richRes.data || null) as any[] | null;
      error = richRes.error as { message?: string } | null;
      if (error && String(error.message || "").toLowerCase().includes("edited_")) {
        // Backward-compatible fallback until migration is applied.
        let fallbackQuery = supabase
          .from("payments")
          .select("id, transaction_id, paid_at, amount, payment_method, payment_status")
          .eq("payment_source", "pos_hotel")
          .in("transaction_id", orderIds)
          .order("paid_at", { ascending: false });
        fallbackQuery = filterByOrganizationId(fallbackQuery, orgId, superAdmin);
        const fallbackRes = await fallbackQuery;
        data = (fallbackRes.data || null) as any[] | null;
        error = fallbackRes.error as { message?: string } | null;
      }
      if (error) throw error;
      const rows = ((data || []) as any[]).map((row) => ({
        id: String(row.id),
        saleId: String(row.transaction_id || ""),
        paidAt: String(row.paid_at || ""),
        amount: Number(row.amount || 0),
        paymentMethod: normalizePaymentMethod(String(row.payment_method || "")),
        paymentStatus: (String(row.payment_status || "completed") as PaymentStatus),
        editedAt: row.edited_at ? String(row.edited_at) : null,
        editedByName: row.edited_by_name ? String(row.edited_by_name) : null,
      }));
      setPostedTransactions(rows);
      setPostedTransactionDrafts(
        Object.fromEntries(
          rows.map((row) => [
            row.id,
            {
              amount: row.amount.toFixed(2),
              paymentMethod: row.paymentMethod,
              paymentStatus: row.paymentStatus,
            },
          ])
        )
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load posted hotel POS transactions.";
      setPostedTransactionsError(message);
    } finally {
      setPostedTransactionsLoading(false);
    }
  };

  const savePostedTransaction = async (transactionId: string) => {
    if (readOnly) {
      alert("Subscription inactive: Hotel POS is in read-only mode.");
      return;
    }
    const draft = postedTransactionDrafts[transactionId];
    if (!draft) return;
    const role = (user?.role || "").toLowerCase();
    const isWaiter = role === "waiter";
    const requiresManagerOverride = draft.paymentStatus === "refunded" || draft.paymentStatus === "failed";
    if (isWaiter && requiresManagerOverride && !(await verifyManagerPin())) {
      alert("Manager PIN override required for refunds/voids.");
      return;
    }
    const existing = postedTransactions.find((tx) => tx.id === transactionId);
    if (existing?.paymentStatus === "refunded") {
      alert("Refunded transactions are locked and cannot be edited.");
      return;
    }
    const parsedAmount = Number(draft.amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      alert("Enter a valid amount.");
      return;
    }
    setSavingPostedTransactionId(transactionId);
    try {
      const voidReason = (voidReasonDraftByPaymentId[transactionId] || "").trim();
      if (draft.paymentStatus !== "completed" && !voidReason) {
        alert("Provide void/refund reason before saving.");
        return;
      }
      if (draft.paymentStatus !== "completed") {
        const isManager = role === "manager" || role === "supervisor";
        await (supabase as any).from("pos_void_logs").insert({
          organization_id: orgId ?? null,
          payment_id: transactionId,
          requested_by: user?.id ?? null,
          approved_by: isManager ? user?.id ?? null : null,
          status: isManager ? "approved" : "pending",
          reason: voidReason,
          approved_at: isManager ? new Date().toISOString() : null,
        });
      }
      const { error } = await supabase
        .from("payments")
        .update({
          amount: Math.round(parsedAmount * 100) / 100,
          payment_method: draft.paymentMethod,
          payment_status: draft.paymentStatus,
          edited_at: new Date().toISOString(),
          edited_by_staff_id: user?.id ?? null,
          edited_by_name: user?.full_name || user?.email || null,
          transaction_id:
            draft.paymentStatus === "completed"
              ? existing?.saleId || null
              : `${existing?.saleId || ""} [VOID_REASON:${voidReason}]`.trim(),
        })
        .eq("id", transactionId);
      if (error) throw error;
      await loadPostedTransactions();
      alert("Transaction updated.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to update transaction.";
      alert(message);
    } finally {
      setSavingPostedTransactionId(null);
    }
  };

  const isHappyHourNow = () => {
    if (!happyHourEnabled || selectedMenuType !== "bar") return false;
    const parseMins = (v: string) => {
      const [h, m] = v.split(":").map(Number);
      return h * 60 + m;
    };
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    const from = parseMins(happyHourStart);
    const to = parseMins(happyHourEnd);
    return from <= to ? mins >= from && mins <= to : mins >= from || mins <= to;
  };

  const getProductMenuType = (product: Product): PosMenuType => {
    const dept = departments.find((d) => d.id === product.department_id)?.name.toLowerCase() || "";
    const name = product.name.toLowerCase();
    if (dept.includes("breakfast") || name.includes("breakfast")) return "breakfast";
    if (dept.includes("lunch") || name.includes("lunch")) return "lunch";
    if (dept.includes("bar") || name.includes("beer") || name.includes("wine") || name.includes("cocktail")) return "bar";
    if (dept.includes("room") || name.includes("room service")) return "room_service";
    return "all";
  };

  const departmentsForPicker = useMemo(() => {
    if (posSellMode === "all") return departments;
    return departments.filter((d) => {
      const m = effectivePosCatalogMode(d);
      if (posSellMode === "kitchen_dishes") return m === "dish_menu";
      return m === "product_catalog";
    });
  }, [departments, posSellMode]);

  useEffect(() => {
    if (departmentsForPicker.length === 0) return;
    if (!departmentsForPicker.some((d) => d.id === selectedDepartmentId)) {
      setSelectedDepartmentId(departmentsForPicker[0].id);
    }
  }, [departmentsForPicker, selectedDepartmentId]);

  const getUnitPrice = (product: Product) => {
    const base = product.sales_price ?? 0;
    if (!isHappyHourNow()) return base;
    const discountPct = Math.max(0, Math.min(90, Number(happyHourDiscountPercent) || 0));
    return Math.round(base * (1 - discountPct / 100) * 100) / 100;
  };

  const filteredProducts = products.filter((p) => {
    const byDept = selectedDepartmentId ? (p.department_id ?? null) === selectedDepartmentId : true;
    const menuType = getProductMenuType(p);
    const byMenu = selectedMenuType === "all" ? true : menuType === selectedMenuType;
    const q = productSearch.trim().toLowerCase();
    const bySearch = !q ? true : String(p.name || "").toLowerCase().includes(q);
    const bySellMode =
      posSellMode === "all"
        ? true
        : (() => {
            const dept = p.department_id ? departments.find((x) => x.id === p.department_id) : null;
            const m = dept ? effectivePosCatalogMode(dept) : "product_catalog";
            if (posSellMode === "kitchen_dishes") return m === "dish_menu";
            return m === "product_catalog";
          })();
    return byDept && byMenu && bySearch && bySellMode;
  });

  const activeOccupiedTables = useMemo(() => {
    const set = new Set<string>();
    queue.forEach((order) => {
      if ((order.order_status === "pending" || order.order_status === "preparing") && order.table_number) {
        set.add(order.table_number);
      }
    });
    return set;
  }, [queue]);

  const getTableStatus = (table: string): PosTableStatus => {
    if (activeOccupiedTables.has(table)) return "occupied";
    return tableLayout[table]?.status ?? "available";
  };

  const getOrderServiceType = (order: QueuedOrder): ServiceType => {
    const hasBarLine = (order.kitchen_order_items || []).some((item: any) => (item.station || "kitchen") === "bar");
    if (hasBarLine) return "bar";
    return "restaurant";
  };

  const nextOrderStatus = (status: string, serviceType: ServiceType): string | null => {
    return getNextOrderStatus(status, serviceType);
  };

  const getNextOrderStatusLabel = (status: string, serviceType: ServiceType): string => {
    const next = nextOrderStatus(status, serviceType);
    if (!next) return "Update Status";
    if (next === "preparing") return "Mark Preparing";
    if (next === "ready") return "Mark Ready";
    if (next === "served") return "Mark Served";
    if (next === "in_progress") return "Mark In Progress";
    return "Mark Completed";
  };

  const updateQueueOrderStatus = async (orderId: string, currentStatus: string, serviceType: ServiceType) => {
    const next = nextOrderStatus(currentStatus, serviceType);
    if (!next) return;
    try {
      const { error } = await supabase
        .from("kitchen_orders")
        .update({ order_status: next })
        .eq("id", orderId);
      if (error) throw error;
      await loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update order status.");
    }
  };

  const addToCart = (product: Product) => {
    const safeProduct: Product = {
      ...product,
      name: String(product.name || "").trim() || "Item",
    };
    const unitPrice = getUnitPrice(product);
    const existing = cart.find((i) => i.product.id === safeProduct.id && (i.menuType ?? "all") === selectedMenuType);
    if (existing) {
      setCart(
        cart.map((item) =>
          item.product.id === safeProduct.id && (item.menuType ?? "all") === selectedMenuType
            ? { ...item, quantity: item.quantity + 1, total: (item.quantity + 1) * unitPrice }
            : item
        )
      );
    } else {
      setCart([...cart, { product: safeProduct, quantity: 1, total: unitPrice, menuType: selectedMenuType }]);
    }
  };

  const updateQuantity = (productId: string, qty: number) => {
    if (qty <= 0) {
      setCart(cart.filter((i) => i.product.id !== productId));
      return;
    }
    setCart(
      cart.map((item) =>
        item.product.id === productId
          ? { ...item, quantity: qty, total: qty * getUnitPrice(item.product) }
          : item
      )
    );
  };

  const removeItem = (productId: string) => {
    setCart(cart.filter((i) => i.product.id !== productId));
  };

  const addNote = (productId: string, note: string) => {
    setCart(
      cart.map((item) => (item.product.id === productId ? { ...item, note } : item))
    );
  };

  const updateItemCourse = (productId: string, courseType: CartItem["courseType"]) => {
    setCart((prev) => prev.map((item) => (item.product.id === productId ? { ...item, courseType } : item)));
  };
  const updateItemFireTiming = (productId: string, fireTiming: CartItem["fireTiming"]) => {
    setCart((prev) => prev.map((item) => (item.product.id === productId ? { ...item, fireTiming } : item)));
  };

  const applyModifier = (productId: string) => {
    const draft = modifierDraft.trim();
    if (!draft) return;
    setCart((prev) =>
      prev.map((item) =>
        item.product.id === productId
          ? { ...item, note: item.note ? `${item.note}; ${draft}` : draft }
          : item
      )
    );
    setModifierDraft("");
  };

  const updateTableMeta = (table: string, updates: Partial<PosTableLayoutState>) => {
    setTableLayout((prev) => ({
      ...prev,
      [table]: {
        number: table,
        status: prev[table]?.status ?? "available",
        waiterId: prev[table]?.waiterId ?? "",
        ...updates,
      },
    }));
  };

  const selectedTableWaiterName = useMemo(() => {
    const waiterId = tableLayout[tableNumber]?.waiterId;
    return waiters.find((w) => w.id === waiterId)?.full_name || null;
  }, [tableLayout, tableNumber, waiters]);

  const startEditOrder = (order: QueuedOrder) => {
    setEditingOrderId(order.id);
    setEditingOrderDate(new Date(order.created_at).toISOString().slice(0, 16));
    setEditingOrderItems(
      (order.kitchen_order_items || []).map((item) => ({
        product_id: String(item.product_id || ""),
        quantity: Number(item.quantity || 1),
        notes: String(item.notes || ""),
      }))
    );
  };

  const addEditingOrderItem = () => {
    const fallbackProductId = filteredProducts[0]?.id || products[0]?.id || "";
    setEditingOrderItems((prev) => [...prev, { product_id: fallbackProductId, quantity: 1, notes: "" }]);
  };

  const saveEditedOrder = async () => {
    if (!editingOrderId) return;
    try {
      const iso = new Date(editingOrderDate).toISOString();
      const { error: orderErr } = await supabase
        .from("kitchen_orders")
        .update({ created_at: iso })
        .eq("id", editingOrderId);
      if (orderErr) throw orderErr;
      const { error: delErr } = await supabase.from("kitchen_order_items").delete().eq("order_id", editingOrderId);
      if (delErr) throw delErr;
      const nextItems = editingOrderItems
        .filter((item) => item.product_id && Number(item.quantity) > 0)
        .map((item) => ({
          order_id: editingOrderId,
          product_id: item.product_id,
          quantity: Number(item.quantity),
          notes: item.notes.trim() || null,
        }));
      if (nextItems.length > 0) {
        const { error: insErr } = await supabase.from("kitchen_order_items").insert(nextItems);
        if (insErr) throw insErr;
      }
      setEditingOrderId(null);
      setEditingOrderDate("");
      setEditingOrderItems([]);
      await loadData();
      alert("Order updated.");
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to update order.");
    }
  };

  const splitPreview = useMemo(() => {
    if (cart.length === 0) return null;
    const currentTotal = cart.reduce((sum, item) => sum + item.total, 0);
    if (splitBillMode === "item") {
      const groups = cart.reduce(
        (acc, item, idx) => {
          const bucket = idx % 2 === 0 ? "A" : "B";
          acc[bucket] += item.total;
          return acc;
        },
        { A: 0, B: 0 }
      );
      return groups;
    }
    if (splitBillMode === "guest") {
      const count = Math.max(1, Number(splitGuestCount) || 1);
      const each = currentTotal / count;
      return { A: each, B: currentTotal - each };
    }
    const pctA = Math.max(0, Math.min(100, Number(splitPercentA) || 0));
    const a = (currentTotal * pctA) / 100;
    return { A: a, B: currentTotal - a };
  }, [cart, splitBillMode, splitGuestCount, splitPercentA]);

  const total = useMemo(() => cart.reduce((s, i) => s + i.total, 0), [cart]);
  const promoDiscountAmount = useMemo(() => {
    if (!promoEnabled) return 0;
    const code = promoCode.trim().toUpperCase();
    const pct = Number(promoDiscountPercent) || 0;
    if (!code || pct <= 0) return 0;
    return Math.round(total * (Math.min(80, pct) / 100) * 100) / 100;
  }, [promoCode, promoDiscountPercent, promoEnabled, total]);
  const vipDiscountAmount = useMemo(() => {
    if (!vipPricingEnabled) return 0;
    if (!selectedGuestId || !vipGuestIds[selectedGuestId]) return 0;
    return Math.round(total * 0.05 * 100) / 100;
  }, [selectedGuestId, total, vipGuestIds, vipPricingEnabled]);
  const payableTotal = Math.max(0, Math.round((total - promoDiscountAmount - vipDiscountAmount) * 100) / 100);

  const buildPosGlOverrides = (): PosJournalGlOverrides | undefined => {
    const o: PosJournalGlOverrides = {};
    if (posGlRevenueId) o.revenueGlAccountId = posGlRevenueId;
    if (posGlReceiptId) o.receiptGlAccountId = posGlReceiptId;
    if (posGlVatId) o.vatGlAccountId = posGlVatId;
    if (posGlCogsBar) o.posCogsBar = posGlCogsBar;
    if (posGlInvBar) o.posInvBar = posGlInvBar;
    if (posGlCogsKitchen) o.posCogsKitchen = posGlCogsKitchen;
    if (posGlInvKitchen) o.posInvKitchen = posGlInvKitchen;
    if (posGlCogsRoom) o.posCogsRoom = posGlCogsRoom;
    if (posGlInvRoom) o.posInvRoom = posGlInvRoom;
    return Object.values(o).some(Boolean) ? o : undefined;
  };

  const buildRoomChargeGlOverrides = (): RoomChargeGlOverrides | undefined => {
    if (!posGlRevenueId && !posGlReceivableId) return undefined;
    return {
      revenueGlAccountId: posGlRevenueId || undefined,
      receivableGlAccountId: posGlReceivableId || undefined,
    };
  };

  const posVatBreakdown = useMemo(() => {
    if (!posVatEnabled || posVatRate == null || posVatRate <= 0) return null;
    const gross = payableTotal;
    const net = Math.round((gross / (1 + posVatRate / 100)) * 100) / 100;
    const vat = Math.round((gross - net) * 100) / 100;
    return { net, vat, gross };
  }, [payableTotal, posVatEnabled, posVatRate]);

  const validateStockBeforeSubmit = async () => {
    const consumption = buildStockConsumptionLines();
    if (consumption.length === 0) return;
    const productIds = consumption.map((i) => i.product_id);
    const { data, error } = await supabase
      .from("product_stock_movements")
      .select("product_id, quantity_in, quantity_out")
      .in("product_id", productIds);
    if (error) throw new Error(error.message || "Failed to validate stock.");
    const bal: Record<string, number> = {};
    (data || []).forEach((m: any) => {
      const pid = m.product_id as string;
      bal[pid] = (bal[pid] || 0) + Number(m.quantity_in || 0) - Number(m.quantity_out || 0);
    });
    const shortages = consumption.filter((i) => (bal[i.product_id] || 0) < i.quantity_out);
    if (shortages.length > 0) {
      const msg = shortages
        .map((s) => {
          const p = products.find((pp) => pp.id === s.product_id);
          return `${p?.name || s.product_id}: in stock ${bal[s.product_id] || 0}, needed ${s.quantity_out}`;
        })
        .join("\n");
      throw new Error(`Insufficient stock:\n${msg}`);
    }
  };

  const normalizeName = (value: string) => value.trim().toLowerCase();

  const loadRecipeRules = async (productsList: Product[]) => {
    try {
      const { data, error } = await (supabase as any)
        .from("product_recipe_items")
        .select("product_id,ingredient_product_id,quantity_per_unit");

      if (error) {
        const msg = String(error.message || "").toLowerCase();
        // Missing table should not break POS; fallback map still applies.
        if (!msg.includes("does not exist") && !msg.includes("not found")) {
          console.warn("Recipe table query warning:", error.message);
        }
        setRecipeByProductId({});
        return;
      }

      const rows = (data || []) as Array<{
        product_id: string;
        ingredient_product_id: string;
        quantity_per_unit: number;
      }>;
      const productIds = new Set(productsList.map((p) => p.id));
      const map: Record<string, RecipeIngredientByIdRule[]> = {};
      rows.forEach((r) => {
        if (!r.product_id || !r.ingredient_product_id || !Number(r.quantity_per_unit)) return;
        if (!productIds.has(r.product_id)) return;
        if (!map[r.product_id]) map[r.product_id] = [];
        map[r.product_id].push({
          ingredientProductId: r.ingredient_product_id,
          qtyPerUnit: Number(r.quantity_per_unit),
        });
      });
      setRecipeByProductId(map);
    } catch (err) {
      console.warn("Recipe rules fallback activated:", err);
      setRecipeByProductId({});
    }
  };

  const buildStockConsumptionLines = (): StockConsumptionLine[] => {
    const rawLines: StockConsumptionLine[] = [];
    for (const item of cart) {
      const dbRules = recipeByProductId[item.product.id] || [];
      if (dbRules.length > 0) {
        for (const rule of dbRules) {
          const ingredient = products.find((p) => p.id === rule.ingredientProductId);
          if (!ingredient) {
            throw new Error(`Recipe ingredient product not found for ${item.product.name}.`);
          }
          rawLines.push({
            product_id: ingredient.id,
            quantity_out: item.quantity * Number(rule.qtyPerUnit || 0),
            unit_cost: ingredient.cost_price ?? null,
            note: `Recipe for ${item.product.name}`,
          });
        }
      } else {
        const fallbackRules = RECIPE_BY_PRODUCT_NAME[normalizeName(item.product.name)] || [];
        if (fallbackRules.length > 0) {
          for (const rule of fallbackRules) {
            const ingredient = products.find((p) => normalizeName(p.name) === normalizeName(rule.ingredientName));
            if (!ingredient) {
              throw new Error(`Recipe ingredient "${rule.ingredientName}" not found for ${item.product.name}.`);
            }
            rawLines.push({
              product_id: ingredient.id,
              quantity_out: item.quantity * Number(rule.qtyPerUnit || 0),
              unit_cost: ingredient.cost_price ?? null,
              note: `Recipe for ${item.product.name}`,
            });
          }
          continue;
        }
      }

      if ((item.product.track_inventory ?? true) && dbRules.length === 0) {
        rawLines.push({
          product_id: item.product.id,
          quantity_out: item.quantity,
          unit_cost: item.product.cost_price ?? null,
          note: "POS sale",
        });
      }
    }

    const byProduct: Record<string, StockConsumptionLine> = {};
    for (const line of rawLines) {
      if (!byProduct[line.product_id]) {
        byProduct[line.product_id] = { ...line };
      } else {
        byProduct[line.product_id].quantity_out += line.quantity_out;
      }
    }
    return Object.values(byProduct).filter((l) => l.quantity_out > 0);
  };

  const queueOfflineOrder = (action: PosAction) => {
    const payload: PendingOfflineOrder = {
      id: randomUuid(),
      createdAt: new Date().toISOString(),
      status: "pending",
      retryCount: 0,
      action,
      tableNumber: tableNumber.trim(),
      selectedGuestId,
      selectedStayId: selectedStay?.id ?? null,
      paymentMethod,
      items: cart.map((i) => ({
        productId: i.product.id,
        quantity: i.quantity,
        note: i.note,
        total: i.total,
      })),
    };
    const next = [payload, ...pendingOfflineOrders];
    setPendingOfflineOrders(next);
    localStorage.setItem(OFFLINE_ORDER_KEY, JSON.stringify(next));
    void saveOfflineOrderIndexedDb(payload);
    setCart([]);
    setTableNumber("");
    setSelectedGuestId("");
  };

  const syncOfflineOrders = async () => {
    if (!online || pendingOfflineOrders.length === 0) return;
    const queueCopy = [...pendingOfflineOrders];
    for (const item of queueCopy) {
      item.status = "syncing";
      void saveOfflineOrderIndexedDb(item);
      const rebuilt = item.items
        .map((ln) => {
          const product = products.find((p) => p.id === ln.productId);
          if (!product) return null;
          return { product: { ...product, name: String(product.name || "").trim() || "Item" }, quantity: ln.quantity, note: ln.note, total: ln.total };
        })
        .filter(Boolean) as CartItem[];
      if (rebuilt.length === 0) continue;
      setCart(rebuilt);
      setTableNumber(item.tableNumber);
      setSelectedGuestId(item.selectedGuestId);
      setPaymentMethod(item.paymentMethod);
      if (item.selectedStayId) {
        const stay = activeStays.find((s) => s.id === item.selectedStayId);
        setSelectedStay(stay || null);
      }
      try {
        await processOrder(item.action, true);
      } catch {
        item.retryCount = Number(item.retryCount || 0) + 1;
        item.status = item.retryCount > 3 ? "conflict" : "failed";
        await saveOfflineOrderIndexedDb(item);
        continue;
      }
      const remaining = queueCopy.filter((q) => q.id !== item.id);
      setPendingOfflineOrders(remaining);
      localStorage.setItem(OFFLINE_ORDER_KEY, JSON.stringify(remaining));
      await deleteOfflineOrderIndexedDb(item.id);
    }
  };

  const processOrder = async (action: PosAction, isSyncRun = false) => {
    if (submitLockRef.current) return;
    if (readOnly) {
      alert("Subscription inactive: Hotel POS is in read-only mode.");
      return;
    }
    if (cart.length === 0) {
      alert("Cart is empty");
      return;
    }
    if (action === "bill_to_room" && !selectedStay) {
      alert("Select a room for bill to room");
      return;
    }
    if (action !== "bill_to_room" && !selectedGuestId) {
      alert("Select a customer from the guest list.");
      return;
    }
    if (!tableSessionOpen && action !== "bill_to_room") {
      alert("Open table session first.");
      return;
    }
    if (!online && !isSyncRun) {
      queueOfflineOrder(action);
      alert("You are offline. Order queued and will sync when online.");
      return;
    }

    submitLockRef.current = true;
    setSending(true);
    try {
      await validateStockBeforeSubmit();
      const { data: staffRow } = await supabase
        .from("staff")
        .select("id, full_name")
        .eq("id", user?.id)
        .maybeSingle();

      const roomId = action === "bill_to_room" && selectedStay ? selectedStay.room_id : null;
      const orderTable = action !== "bill_to_room" ? (tableNumber.trim() || "POS") : null;
      const orderCustomer =
        action === "bill_to_room" && selectedStay?.hotel_customers
          ? `${selectedStay.hotel_customers.first_name} ${selectedStay.hotel_customers.last_name}`.trim()
          : (() => {
              const g = hotelCustomers.find((gg) => gg.id === selectedGuestId);
              return g ? `${g.first_name} ${g.last_name}`.trim() : null;
            })();

      const basePayload: { room_id: string | null; table_number: string | null; order_status: string; created_by?: string | null } = {
        room_id: roomId,
        table_number: orderTable,
        order_status: "pending",
      };
      if (staffRow?.id) basePayload.created_by = staffRow.id;

      const waiterName = selectedTableWaiterName ? ` [Waiter: ${selectedTableWaiterName}]` : "";
      const withCustomer = orderCustomer ? { ...basePayload, customer_name: `${orderCustomer}${waiterName}` } : basePayload;
      const res = await supabase.from("kitchen_orders").insert(withCustomer).select().single();
      let orderData = res.data as { id: string } | null;
      let orderErr = res.error as { message?: string; details?: string } | null;
      if (orderErr && orderErr.message?.toLowerCase().includes("customer_name")) {
        const fallback = await supabase.from("kitchen_orders").insert(basePayload).select().single();
        orderData = fallback.data as { id: string } | null;
        orderErr = fallback.error as { message?: string; details?: string } | null;
      }
      if (orderErr || !orderData?.id) throw new Error(orderErr?.message || orderErr?.details || "Failed to create order.");

      const items = cart.map((item) => ({
        order_id: orderData!.id,
        product_id: item.product.id,
        quantity: item.quantity,
        notes: `${item.menuType && item.menuType !== "all" ? `[${item.menuType}] ` : ""}${item.courseType ? `[COURSE:${item.courseType}] ` : ""}${item.fireTiming ? `[FIRE:${item.fireTiming}] ` : ""}${item.note || ""}`.trim() || null,
      }));
      const { error: itemsErr } = await supabase.from("kitchen_order_items").insert(items);
      if (itemsErr) throw new Error(itemsErr.message || itemsErr.details || "Failed to create order items.");

      const consumption = buildStockConsumptionLines();
      if (consumption.length > 0) {
        const stockMoves = consumption.map((i) => ({
          product_id: i.product_id,
          source_type: "sale",
          source_id: orderData!.id,
          quantity_in: 0,
          quantity_out: i.quantity_out,
          unit_cost: i.unit_cost,
          note: i.note,
        }));
        await supabase.from("product_stock_movements").insert(stockMoves);
      }

      const cartDescription = cart
        .map((i) => `${i.quantity}× ${i.product.name}${i.note ? ` (${i.note})` : ""}${i.menuType && i.menuType !== "all" ? ` [${i.menuType}]` : ""}`)
        .join(", ") + (promoEnabled && promoCode.trim() ? ` [PROMO:${promoCode.trim().toUpperCase()}]` : "");
      const entryDate = businessTodayISO();

      if (action === "bill_to_room" && selectedStay) {
        const { data: billingRow } = await supabase
          .from("billing")
          .insert({
            organization_id: orgId ?? null,
            stay_id: selectedStay.id,
            description: cartDescription,
            amount: payableTotal,
            charge_type: "food",
            created_by: staffRow?.id || null,
          })
          .select("id, charged_at")
          .single();
        if (billingRow) {
          const chargedAt = (billingRow as { charged_at?: string }).charged_at ?? new Date().toISOString();
          const jr = await createJournalForBillToRoom(
            (billingRow as { id: string }).id,
            payableTotal,
            cartDescription,
            chargedAt,
            staffRow?.id ?? null,
            buildRoomChargeGlOverrides()
          );
          if (!jr.ok) {
            alert(`Order saved but journal was not posted: ${jr.error}`);
          }
        }
      } else if (action === "pay_now" || action === "credit_sale") {
        const orgId = user?.organization_id ?? undefined;
        const { error: payInsErr } = await insertPaymentWithMethodCompat(
          supabase,
          {
            stay_id: null,
            ...(orgId ? { organization_id: orgId } : {}),
            payment_source: "pos_hotel",
            amount: payableTotal,
            payment_status: action === "credit_sale" ? "pending" : "completed",
            transaction_id: orderData.id,
            processed_by: staffRow?.id ?? null,
          },
          paymentMethod
        );
        if (payInsErr) throw new Error(String((payInsErr as Error)?.message || payInsErr) || "Failed to record payment.");
        const deptNameById = new Map(departments.map((d) => [d.id, d.name]));
        const groupedSalesByDepartment = new Map<string, { departmentId: string | null; departmentName: string | null; amount: number }>();
        const groupedCogsByDepartment = new Map<string, { departmentId: string | null; departmentName: string | null; amount: number }>();
        cart.forEach((item) => {
          const departmentId = item.product.department_id ?? null;
          const departmentName = departmentId ? deptNameById.get(departmentId) ?? null : null;
          const salesKey = departmentId ?? "__unassigned__";
          const prevSale = groupedSalesByDepartment.get(salesKey);
          groupedSalesByDepartment.set(salesKey, {
            departmentId,
            departmentName,
            amount: Number((prevSale?.amount ?? 0) + item.total),
          });
          const cogsAmount = item.quantity * Number(item.product.cost_price ?? 0);
          const prevCogs = groupedCogsByDepartment.get(salesKey);
          groupedCogsByDepartment.set(salesKey, {
            departmentId,
            departmentName,
            amount: Number((prevCogs?.amount ?? 0) + cogsAmount),
          });
        });
        const cogsByDept = sumPosCogsByDept(
          cart.map((i) => ({
            quantity: i.quantity,
            unitCost: Number(i.product.cost_price ?? 0),
            departmentId: i.product.department_id ?? null,
          })),
          deptNameById
        );
        const salesByDept = sumPosSalesByDept(
          cart.map((i) => ({
            lineTotal: i.total,
            departmentId: i.product.department_id ?? null,
          })),
          deptNameById
        );
        const js = await resolveJournalAccountSettings(orgId ?? undefined);
        const vatRate = js.default_vat_percent;
        const useVatJournal =
          posVatEnabled && vatRate != null && Number.isFinite(vatRate) && vatRate > 0;
        if (action === "pay_now") {
          const jr = await createJournalForPosOrder(orderData.id, payableTotal, cartDescription, entryDate, staffRow?.id ?? null, {
            paymentMethod,
            cogsByDept,
            cogsByDepartment: Array.from(groupedCogsByDepartment.values()),
            salesByDept,
            salesByDepartment: Array.from(groupedSalesByDepartment.values()),
            vatRatePercent: useVatJournal ? vatRate : undefined,
            glOverrides: buildPosGlOverrides(),
            organizationId: orgId ?? null,
          });
          if (!jr.ok) {
            alert(`Payment recorded but journal was not posted: ${jr.error}`);
          }
        }
      }

      setCart([]);
      setSelectedStay(null);
      setTableNumber("");
      setSelectedGuestId("");
      setTableSessionOpen(false);
      setTableSessionStartedAt(null);
      if (orderTable) {
        updateTableMeta(orderTable, { status: "reserved" });
      }
      loadData();
      alert(
        action === "send_kitchen"
          ? "Order sent to kitchen."
          : action === "pay_now"
            ? "Order paid and sent successfully."
            : action === "credit_sale"
              ? "Credit sale saved and sent successfully."
            : "Order billed to room successfully."
      );
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : err && typeof err === "object" && "message" in err
            ? String((err as { message?: string }).message)
            : "Failed to process POS action";
      alert(msg);
      console.error("POS order error:", err);
    } finally {
      setSending(false);
      submitLockRef.current = false;
    }
  };

  const holdCurrentTicket = () => {
    if (readOnly) {
      alert("Subscription inactive: Hotel POS is in read-only mode.");
      return;
    }
    if (cart.length === 0) {
      alert("Cart is empty");
      return;
    }
    const guest = hotelCustomers.find((g) => g.id === selectedGuestId);
    const label = guest ? `${guest.first_name} ${guest.last_name}` : tableNumber.trim() || "Untitled";
    const ticket: HeldTicket = {
      id: randomUuid(),
      label,
      tableNumber,
      guestId: selectedGuestId,
      paymentMethod,
      items: cart,
      createdAt: new Date().toISOString(),
    };
    setHeldTickets((prev) => [ticket, ...prev]);
    setCart([]);
    setTableNumber("");
    setSelectedGuestId("");
  };

  const resumeTicket = (ticketId: string) => {
    const ticket = heldTickets.find((t) => t.id === ticketId);
    if (!ticket) return;
    setCart((prev) => {
      const merged = [...prev];
      ticket.items.forEach((incoming) => {
        const idx = merged.findIndex((m) => m.product.id === incoming.product.id);
        if (idx >= 0) {
          const nextQty = merged[idx].quantity + incoming.quantity;
          merged[idx] = {
            ...merged[idx],
            quantity: nextQty,
            total: nextQty * getUnitPrice(merged[idx].product),
            note: merged[idx].note || incoming.note,
          };
        } else {
          merged.push({ ...incoming });
        }
      });
      return merged;
    });
    setTableNumber(ticket.tableNumber);
    setSelectedGuestId(ticket.guestId);
    setPaymentMethod(ticket.paymentMethod);
    setHeldTickets((prev) => prev.filter((t) => t.id !== ticketId));
  };

  const deleteHeldTicket = (ticketId: string) => {
    setHeldTickets((prev) => prev.filter((t) => t.id !== ticketId));
  };

  const clearCart = () => setCart([]);

  if (loading) {
    return (
      <div className="p-6 md:p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-slate-200 rounded w-48" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 h-96 bg-slate-200 rounded-xl" />
            <div className="h-96 bg-slate-200 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${compactView ? "p-4 md:p-5" : "p-6 md:p-8"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold text-slate-900">Hotel POS</h1>
          <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1">
            <span className="text-[11px] font-medium text-slate-600">
              Session: {tableSessionOpen ? "OPEN" : "CLOSED"}
            </span>
            <input
              type="text"
              placeholder="Table"
              value={tableNumber}
              onChange={(e) => setTableNumber(e.target.value)}
              className="h-7 w-24 border border-slate-200 rounded px-2 text-xs"
            />
            <button
              type="button"
              disabled={!tableNumber}
              onClick={() => {
                void openTableSessionDb(tableNumber);
              }}
              className="h-7 px-2 text-xs rounded border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
            >
              Open
            </button>
            <button
              type="button"
              disabled={!tableSessionOpen}
              onClick={() => {
                void closeTableSessionDb();
              }}
              className="h-7 px-2 text-xs rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Close
            </button>
          </div>
          <PageNotes ariaLabel="Hotel POS help">
            <p>Hospitality POS for room/table orders and bill-to-room workflows.</p>
            <p className="mt-2">
              Use <strong>Journal GL settings</strong> to map cash, bank, mobile money, COGS, and inventory accounts used when posting POS sales.
            </p>
          </PageNotes>
          <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded border ${online ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
            {online ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {online ? "Online" : "Offline"}
          </span>
          <button
            type="button"
            onClick={() => setTouchMode((v) => !v)}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50"
          >
            {touchMode ? <Hand className="w-3 h-3" /> : <TabletSmartphone className="w-3 h-3" />}
            {touchMode ? "Touch mode on" : "Touch mode off"}
          </button>
          <div className="inline-flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1">
            <label className="inline-flex items-center gap-1 text-[11px] text-slate-700">
              <input type="checkbox" checked={happyHourEnabled} onChange={(e) => setHappyHourEnabled(e.target.checked)} />
              HH
            </label>
            <input
              type="time"
              value={happyHourStart}
              onChange={(e) => setHappyHourStart(e.target.value)}
              className="h-7 border rounded px-1.5 text-[11px]"
              disabled={!happyHourEnabled}
            />
            <input
              type="time"
              value={happyHourEnd}
              onChange={(e) => setHappyHourEnd(e.target.value)}
              className="h-7 border rounded px-1.5 text-[11px]"
              disabled={!happyHourEnabled}
            />
            <input
              type="number"
              min="0"
              max="90"
              value={happyHourDiscountPercent}
              onChange={(e) => setHappyHourDiscountPercent(e.target.value)}
              className="h-7 w-16 border rounded px-1.5 text-[11px]"
              placeholder="%"
              disabled={!happyHourEnabled}
            />
            <label className="inline-flex items-center gap-1 text-[11px] text-slate-700">
              <input type="checkbox" checked={promoEnabled} onChange={(e) => setPromoEnabled(e.target.checked)} />
              Promo
            </label>
            <input
              type="text"
              value={promoCode}
              onChange={(e) => setPromoCode(e.target.value)}
              placeholder="Code"
              className="h-7 w-20 border rounded px-1.5 text-[11px]"
              disabled={!promoEnabled}
            />
            <input
              type="number"
              min="0"
              max="80"
              value={promoDiscountPercent}
              onChange={(e) => setPromoDiscountPercent(e.target.value)}
              placeholder="%"
              className="h-7 w-14 border rounded px-1.5 text-[11px]"
              disabled={!promoEnabled}
            />
            <label className="inline-flex items-center gap-1 text-[11px] text-slate-700">
              <input type="checkbox" checked={vipPricingEnabled} onChange={(e) => setVipPricingEnabled(e.target.checked)} />
              VIP
            </label>
            <label className="inline-flex items-center gap-1 text-[11px] text-slate-700">
              <input
                type="checkbox"
                checked={!!vipGuestIds[selectedGuestId || ""]}
                onChange={(e) =>
                  setVipGuestIds((prev) => {
                    const id = selectedGuestId || "";
                    const next = { ...prev, [id]: e.target.checked };
                    if (id) {
                      void (async () => {
                        try {
                          await (supabase as any)
                            .from("pos_customer_profiles")
                            .upsert({
                              organization_id: orgId ?? null,
                              property_customer_id: id,
                              vip: e.target.checked,
                              updated_at: new Date().toISOString(),
                            }, { onConflict: "property_customer_id" });
                        } catch {
                          // ignore (pre-migration)
                        }
                      })();
                    }
                    return next;
                  })
                }
                disabled={!selectedGuestId || !vipPricingEnabled}
              />
              Guest VIP
            </label>
          </div>
          {pendingOfflineOrders.length > 0 && (
            <button
              type="button"
              onClick={() => void syncOfflineOrders()}
              disabled={!online}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 disabled:opacity-50"
            >
              Sync offline ({pendingOfflineOrders.length})
            </button>
          )}
        </div>
      </div>
      {readOnly && (
        <ReadOnlyNotice />
      )}

      {!isWaiterCompact ? (
      <div className="mb-4 bg-white rounded-xl border border-slate-200 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-slate-900">Table Layout</h2>
            <PageNotes ariaLabel="Table layout help">
              <p>Live table status: occupied, reserved, cleaning, available.</p>
            </PageNotes>
          </div>
          <button
            type="button"
            onClick={() => setShowTableLayout((v) => !v)}
            className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50"
          >
            {showTableLayout ? "Hide" : "Show"}
          </button>
        </div>
        {showTableLayout ? (
        <div className={`grid grid-cols-3 sm:grid-cols-6 ${compactView ? "lg:grid-cols-12" : "lg:grid-cols-10"} gap-1.5`}>
          {BASE_TABLES.map((table) => {
            const status = getTableStatus(table);
            const selected = tableNumber === table;
            const statusClass =
              status === "occupied"
                ? "bg-red-50 border-red-200 text-red-700"
                : status === "reserved"
                  ? "bg-amber-50 border-amber-200 text-amber-700"
                  : status === "cleaning"
                    ? "bg-blue-50 border-blue-200 text-blue-700"
                    : "bg-emerald-50 border-emerald-200 text-emerald-700";
            return (
              <button
                key={table}
                type="button"
                onClick={() => setTableNumber(table)}
                className={`border rounded-md px-2 py-1.5 text-left ${statusClass} ${selected ? "ring-2 ring-brand-400" : ""}`}
              >
                <p className="font-semibold text-xs">{table}</p>
                <p className="text-[10px] uppercase">{status}</p>
              </button>
            );
          })}
        </div>
        ) : null}
        {showTableLayout && tableNumber && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
            <div>
              <label className="block text-xs text-slate-600 mb-1">Selected table</label>
              <input value={tableNumber} readOnly className="w-full border rounded px-2 py-1.5 text-sm bg-slate-50" />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Status</label>
              <select
                value={tableLayout[tableNumber]?.status || "available"}
                onChange={(e) => updateTableMeta(tableNumber, { status: e.target.value as PosTableLayoutState["status"] })}
                className="w-full border rounded px-2 py-1.5 text-sm"
                disabled={getTableStatus(tableNumber) === "occupied"}
              >
                <option value="available">available</option>
                <option value="reserved">reserved</option>
                <option value="cleaning">cleaning</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Assigned waiter</label>
              <select
                value={tableLayout[tableNumber]?.waiterId || ""}
                onChange={(e) => updateTableMeta(tableNumber, { waiterId: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm"
              >
                <option value="">Unassigned</option>
                {waiters.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.full_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Products */}
        <div className="lg:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-lg font-bold text-slate-900">{posSellMode === "kitchen_dishes" ? "Kitchen menu" : "Products"}</h2>
            <PageNotes ariaLabel="Products help">
              <p>
                <strong>Kitchen menu</strong> lists dish products (set department to &quot;Kitchen menu&quot; in Admin → Products).
                Link each dish to ingredients under Admin → Recipe Management so stock reduces correctly.
              </p>
              <p className="mt-2">
                <strong>Bar / sauna</strong> lists retail SKUs (beer, spa items): stock reduces on the product you sell.
              </p>
              <p className="mt-2">Pick department and meal period, then add items to the active order.</p>
            </PageNotes>
          </div>
          {productsError && (
            <p className="text-red-600 text-sm mb-3">
              {productsError}. Ensure the products table has id, name, sales_price, active.
            </p>
          )}
          {departments.length > 0 && (
            <div className="mb-3 flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-sm text-slate-700">Sell from</label>
                <select
                  value={posSellMode}
                  onChange={(e) => {
                    const v = e.target.value as PosSellMode;
                    setPosSellMode(v);
                    try {
                      localStorage.setItem(POS_SELL_MODE_STORAGE_KEY, v);
                    } catch {
                      /* ignore */
                    }
                  }}
                  className="border rounded-lg px-3 py-1.5 text-sm max-w-[min(100%,20rem)]"
                >
                  <option value="all">All (manager)</option>
                  <option value="kitchen_dishes">Kitchen menu (dishes)</option>
                  <option value="retail_products">Bar / sauna (products)</option>
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-sm text-slate-700">Department</label>
                <select
                  value={selectedDepartmentId}
                  onChange={(e) => setSelectedDepartmentId(e.target.value)}
                  className="border rounded-lg px-3 py-1.5 text-sm"
                  disabled={departmentsForPicker.length === 0}
                >
                  {departmentsForPicker.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <label className="text-sm text-slate-700 ml-2">Menu</label>
              <select
                value={selectedMenuType}
                onChange={(e) => setSelectedMenuType(e.target.value as PosMenuType)}
                className="border rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="all">All menu</option>
                <option value="breakfast">Breakfast</option>
                <option value="lunch">Lunch</option>
                <option value="bar">Bar</option>
                <option value="room_service">Room service</option>
              </select>
              </div>
              {posSellMode !== "all" && departmentsForPicker.length === 0 ? (
                <p className="text-amber-800 text-sm">
                  No departments for this mode. In Admin → Products → Departments, set{" "}
                  <span className="font-medium">POS list</span> to{" "}
                  {posSellMode === "kitchen_dishes" ? "Kitchen menu (dishes)" : "Bar / retail (products)"}.
                </p>
              ) : null}
            </div>
          )}
          <div className="mb-3">
            <label className="block text-xs font-medium text-slate-600 mb-1">Search products</label>
            <input
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Type to search…"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div className={`rounded-xl border border-slate-200 bg-white p-3 ${compactView ? "max-h-[44vh] overflow-y-auto" : ""}`}>
            {filteredProducts.length === 0 ? (
              <p className="text-slate-500 py-6 text-sm text-center">
                {productsError ? "Products failed to load." : "No products match your filters/search."}
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-2">
                {filteredProducts.slice(0, 60).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={readOnly}
                    onClick={() => addToCart(p)}
                    className={`text-left border border-slate-200 rounded-xl hover:bg-slate-50 active:bg-slate-100 transition ${
                      touchMode ? "p-4" : "p-3"
                    }`}
                  >
                    <p className={`font-semibold text-slate-900 ${touchMode ? "text-base" : "text-sm"} truncate`}>
                      {p.name}
                    </p>
                    <p className={`text-slate-600 tabular-nums ${touchMode ? "text-sm" : "text-xs"}`}>
                      {getUnitPrice(p).toFixed(2)}
                    </p>
                  </button>
                ))}
              </div>
            )}
            {filteredProducts.length > 60 ? (
              <p className="text-xs text-slate-500 mt-3 text-center">
                Showing first 60 results. Refine search to narrow down.
              </p>
            ) : null}
          </div>
          {filteredProducts.length === 0 && !productsError && (
            <p className="text-slate-500 py-4 text-sm">
              No active products for this department. Check Products setup.
            </p>
          )}
        </div>

        {/* Cart + Actions */}
        <div className="lg:col-span-3 bg-white rounded-xl border border-slate-200 p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <ShoppingCart className="w-5 h-5" />
              Active Order
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm font-medium text-slate-700">Date</label>
              <input
                type="date"
                value={queueDate}
                onChange={(e) => setQueueDate(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
              <label className="text-sm font-medium text-slate-700">Table</label>
              <input
                type="text"
                placeholder="e.g. 5, Terrace"
                value={tableNumber}
                onChange={(e) => setTableNumber(e.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm w-36"
              />
            </div>
          </div>

          {/* Customer, pay method, bill-to-room */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Customer</label>
              <select
                value={selectedGuestId}
                onChange={(e) => setSelectedGuestId(e.target.value)}
                className="w-full border border-slate-200 rounded px-2 py-1.5 text-xs"
              >
                <option value="">Select customer</option>
                {hotelCustomers.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.first_name} {g.last_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Pay Method</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethodCode)}
                className="w-full border rounded px-2 py-1.5 text-xs"
              >
                {PAYMENT_METHOD_SELECT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Bill to Room</label>
              <select
                value={selectedStay?.id ?? ""}
                onChange={(e) => {
                  const s = activeStays.find((x) => x.id === e.target.value);
                  setSelectedStay(s || null);
                }}
                className="w-full border rounded px-2 py-1.5 text-xs"
              >
                <option value="">Select room</option>
                {activeStays.map((s) => (
                  <option key={s.id} value={s.id}>
                    Room {s.rooms?.room_number} – {s.hotel_customers?.first_name} {s.hotel_customers?.last_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-1.5 mb-3">
            <button
              onClick={() => processOrder("send_kitchen")}
              disabled={sending || cart.length === 0 || readOnly}
              className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded font-medium py-1.5 text-xs"
            >
              {sending ? "..." : "Kitchen"}
            </button>
            <button
              onClick={() => processOrder("pay_now")}
              disabled={sending || cart.length === 0 || readOnly}
              className="app-btn-primary font-medium py-1.5 text-xs disabled:cursor-not-allowed"
            >
              {sending ? "..." : "Pay Now"}
            </button>
            <button
              onClick={() => processOrder("bill_to_room")}
              disabled={sending || cart.length === 0 || readOnly}
              className="bg-indigo-700 hover:bg-indigo-800 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded font-medium py-1.5 text-xs"
            >
              {sending ? "..." : "Bill Room"}
            </button>
            <button
              type="button"
              onClick={() => setShowPrintBill(true)}
              disabled={cart.length === 0}
              className="border border-slate-300 text-slate-700 hover:bg-slate-50 rounded py-1.5 text-xs"
            >
              Print Bill
            </button>
            <button
              onClick={holdCurrentTicket}
              disabled={sending || cart.length === 0 || readOnly}
              className="border border-slate-300 text-slate-700 hover:bg-slate-50 rounded py-1.5 text-xs"
            >
              Hold Ticket
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <input
              type="text"
              placeholder='Modifier e.g. "no salt", "extra cheese"'
              value={modifierDraft}
              onChange={(e) => setModifierDraft(e.target.value)}
              className="col-span-2 border border-slate-200 rounded-lg px-3 py-2 text-xs"
            />
          </div>
          {selectedTableWaiterName ? (
            <p className="text-xs text-slate-600 mb-2">Waiter on {tableNumber}: {selectedTableWaiterName}</p>
          ) : null}

          <div className={`space-y-4 ${compactView ? "min-h-[260px] max-h-[42vh]" : "min-h-[360px] max-h-[560px]"} overflow-y-auto mb-4 pr-1`}>
            {cart.length === 0 ? (
              <p className="text-slate-500 text-base py-8 text-center">No items in the active order yet. Add products to build the order.</p>
            ) : (
              cart.map((item) => (
                <div key={item.product.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 text-sm break-words leading-5">
                        {item.product.name || "Item"}
                      </p>
                      <p className="text-xs text-slate-600">
                        Price: {getUnitPrice(item.product).toFixed(2)} | Qty: {item.quantity}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                        className={`p-1.5 hover:bg-slate-200 rounded ${touchMode ? "p-2.5" : ""}`}
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span className="w-7 text-center text-sm font-semibold">{item.quantity}</span>
                      <button
                        onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                        className={`p-1.5 hover:bg-slate-200 rounded ${touchMode ? "p-2.5" : ""}`}
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => removeItem(item.product.id)}
                        className={`p-1.5 hover:bg-red-100 text-red-600 rounded ${touchMode ? "p-2.5" : ""}`}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-[1.2fr_auto_auto_auto] gap-2">
                    <input
                      placeholder="Comment"
                      value={item.note || ""}
                      onChange={(e) => addNote(item.product.id, e.target.value)}
                      className="w-full border rounded px-2 py-1.5 text-xs"
                    />
                    <select
                      value={item.courseType || "main_course"}
                      onChange={(e) => updateItemCourse(item.product.id, e.target.value as CartItem["courseType"])}
                      className="w-full md:w-24 border rounded px-2 py-1.5 text-xs"
                    >
                      <option value="starter">Starter</option>
                      <option value="main_course">Main</option>
                      <option value="dessert">Dessert</option>
                    </select>
                    <select
                      value={item.fireTiming || "now"}
                      onChange={(e) => updateItemFireTiming(item.product.id, e.target.value as CartItem["fireTiming"])}
                      className="w-full md:w-28 border rounded px-2 py-1.5 text-xs"
                    >
                      <option value="now">Fire now</option>
                      <option value="with_mains">With mains</option>
                      <option value="after_mains">After mains</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => applyModifier(item.product.id)}
                      className="text-xs px-2 py-1.5 border border-slate-300 rounded hover:bg-white"
                    >
                      Modifier
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="mb-3 border rounded-lg p-2 bg-slate-50">
            <div className="flex items-center gap-2 mb-2">
              <label className="text-xs text-slate-700">Split bill</label>
              <select
                value={splitBillMode}
                onChange={(e) => setSplitBillMode(e.target.value as SplitBillMode)}
                className="border rounded px-2 py-1 text-xs"
              >
                <option value="item">By item</option>
                <option value="guest">By guest</option>
                <option value="percentage">By percentage</option>
              </select>
              {splitBillMode === "guest" ? (
                <input
                  type="number"
                  min="1"
                  value={splitGuestCount}
                  onChange={(e) => setSplitGuestCount(e.target.value)}
                  className="w-16 border rounded px-2 py-1 text-xs"
                />
              ) : null}
              {splitBillMode === "percentage" ? (
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={splitPercentA}
                  onChange={(e) => setSplitPercentA(e.target.value)}
                  className="w-16 border rounded px-2 py-1 text-xs"
                />
              ) : null}
            </div>
            {splitPreview ? (
              <p className="text-xs text-slate-700">Split A: {splitPreview.A.toFixed(2)} | Split B: {splitPreview.B.toFixed(2)}</p>
            ) : (
              <p className="text-xs text-slate-500">Add items to preview split.</p>
            )}
          </div>

          <div className="border-t border-slate-200 pt-4 space-y-3">
            <label className="flex items-center gap-2 text-sm text-slate-800 cursor-pointer select-none">
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
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                Set Default VAT % under Admin → Journal account settings to enable VAT breakdown.
              </p>
            ) : null}
            {posVatBreakdown ? (
              <div className="space-y-1 text-sm text-slate-800">
                <div className="flex justify-between gap-4">
                  <span className="text-slate-600">Net (ex VAT)</span>
                  <span className="tabular-nums font-medium">{posVatBreakdown.net.toFixed(2)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-600">VAT</span>
                  <span className="tabular-nums font-medium">{posVatBreakdown.vat.toFixed(2)}</span>
                </div>
                <div className="flex justify-between gap-4 text-xl font-bold text-slate-900 pt-1 border-t border-slate-200">
                  <span>Total</span>
                  <span className="tabular-nums">{posVatBreakdown.gross.toFixed(2)}</span>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-xs text-slate-600">Subtotal: {total.toFixed(2)}</p>
                {(promoDiscountAmount > 0 || vipDiscountAmount > 0) && (
                  <p className="text-xs text-emerald-700">Discounts: -{(promoDiscountAmount + vipDiscountAmount).toFixed(2)}</p>
                )}
                <p className="text-xl font-bold text-slate-900">Total: {payableTotal.toFixed(2)}</p>
              </div>
            )}

            <div>
              <button
                onClick={() => processOrder("credit_sale")}
                disabled={sending || cart.length === 0 || readOnly}
                className={`w-full bg-purple-700 hover:bg-purple-800 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium flex items-center justify-center gap-2 ${touchMode ? "py-3 text-base" : "py-2"}`}
              >
                {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                Credit Sale
              </button>
            </div>

            {heldTickets.length > 0 && (
              <div className="border rounded-lg p-3 bg-slate-50">
                <p className="text-sm font-medium text-slate-700 mb-2">Held Tickets</p>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {heldTickets.map((t) => (
                    <div key={t.id} className="flex items-center justify-between text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{t.label || "Untitled"}</p>
                        <p className="text-xs text-slate-500">{new Date(t.createdAt).toLocaleTimeString()} · {t.items.length} item(s)</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => resumeTicket(t.id)}
                        className="px-2 py-1 rounded border border-slate-300 hover:bg-white"
                      >
                        Resume
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteHeldTicket(t.id)}
                        className="px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {cart.length > 0 && (
              <button
                onClick={clearCart}
                disabled={readOnly}
                className="w-full py-2 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg text-sm"
              >
                Clear Cart
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Order queue */}
      {!isWaiterCompact ? (
      <div className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
          <h2 className="text-lg font-bold text-slate-900">Order Queue</h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowOrderQueue((v) => !v)}
              className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50"
            >
              {showOrderQueue ? "Hide" : "Show"}
            </button>
            <label className="text-sm font-medium text-slate-700">Status</label>
            <select
              value={queueStatusFilter}
              onChange={(e) => setQueueStatusFilter(e.target.value as typeof queueStatusFilter)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="active">Active (pending + preparing)</option>
              <option value="all">All</option>
              <option value="pending">Pending only</option>
              <option value="preparing">Preparing only</option>
            </select>
            <label className="text-sm font-medium text-slate-700">Station</label>
            <select
              value={stationFilter}
              onChange={(e) => setStationFilter(e.target.value as StationFilter)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="all">All stations</option>
              <option value="kitchen">Kitchen</option>
              <option value="bar">Bar</option>
              <option value="dessert">Dessert</option>
            </select>
          </div>
        </div>
        {!showOrderQueue ? null : (
        <>
        {queueError ? (
          <p className="text-red-600 text-sm">Failed to load queue: {queueError}</p>
        ) : queue.length === 0 ? (
          <p className="text-slate-500 text-sm">No orders found for this date/filter.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {queue
              .filter((o: any) =>
                stationFilter === "all"
                  ? true
                  : (o.kitchen_order_items || []).some((it: any) => (it.station || "kitchen") === stationFilter)
              )
              .map((o: any) => (
              <div
                key={o.id}
                className="bg-white rounded-xl border border-slate-200 p-4"
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <span className="font-bold block">
                      {o.room_id ? `Room ${o.room_number ?? "(unmapped)"}` : o.table_number || "POS"}
                    </span>
                    {o.customer_name && (
                      <span className="text-sm text-slate-600">{o.customer_name}</span>
                    )}
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      o.order_status === "pending"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-blue-100 text-blue-800"
                    }`}
                  >
                    {o.order_status}
                  </span>
                </div>
                <div className="text-sm text-slate-600">
                  {o.kitchen_order_items?.map((it: any, i: number) => (
                    <p key={i}>
                      {it.quantity}× {it.products?.name || "Item"} [{it.station || "kitchen"}] {it.notes && `(${it.notes})`}
                    </p>
                  ))}
                </div>
                {(() => {
                  const { total, paid, balance } = getQueueOrderTotals(o);
                  return (
                    <div className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-600">
                      <p>Total: {total.toFixed(2)}</p>
                      <p>Paid: {paid.toFixed(2)}</p>
                      <p className="font-semibold text-slate-800">Outstanding: {balance.toFixed(2)}</p>
                    </div>
                  );
                })()}
                <p className="text-xs text-slate-400 mt-2">{new Date(o.created_at).toLocaleString()}</p>
                <div className="mt-3 flex items-center justify-end gap-2">
                  {getQueueOrderTotals(o).balance > 0.01 ? (
                    <button
                      type="button"
                      onClick={() => openQueuePayModal(o)}
                      className="inline-flex items-center gap-1 px-2 py-1 border border-emerald-300 text-emerald-700 rounded hover:bg-emerald-50 text-xs"
                    >
                      Pay Outstanding
                    </button>
                  ) : null}
                  {nextOrderStatus(o.order_status, getOrderServiceType(o)) ? (
                    <button
                      type="button"
                      onClick={() => void updateQueueOrderStatus(o.id, o.order_status, getOrderServiceType(o))}
                      className="inline-flex items-center gap-1 px-2 py-1 border border-emerald-300 text-emerald-700 rounded hover:bg-emerald-50 text-xs"
                    >
                      {getNextOrderStatusLabel(o.order_status, getOrderServiceType(o))}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => startEditOrder(o)}
                    className="inline-flex items-center gap-1 px-2 py-1 border border-slate-300 rounded hover:bg-slate-50 text-xs"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        </>
        )}
      </div>
      ) : null}

      {!isWaiterCompact && editingOrderId ? (
        <div className="mt-8 bg-white rounded-xl border border-slate-200 p-4 md:p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-lg font-bold text-slate-900">Edit Order</h2>
            <button
              type="button"
              onClick={() => {
                setEditingOrderId(null);
                setEditingOrderDate("");
                setEditingOrderItems([]);
              }}
              className="px-3 py-1.5 border border-slate-300 rounded-lg hover:bg-slate-50 text-sm"
            >
              Cancel
            </button>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1">Order date & time</label>
            <input
              type="datetime-local"
              value={editingOrderDate}
              onChange={(e) => setEditingOrderDate(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div className="space-y-3">
            {editingOrderItems.map((item, index) => (
              <div key={`${editingOrderId}-${index}`} className="grid grid-cols-1 md:grid-cols-[1.5fr_120px_1fr_auto] gap-2 items-center">
                <select
                  value={item.product_id}
                  onChange={(e) =>
                    setEditingOrderItems((prev) =>
                      prev.map((row, i) => (i === index ? { ...row, product_id: e.target.value } : row))
                    )
                  }
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Select product</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1"
                  value={item.quantity}
                  onChange={(e) =>
                    setEditingOrderItems((prev) =>
                      prev.map((row, i) => (i === index ? { ...row, quantity: Number(e.target.value) || 1 } : row))
                    )
                  }
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
                <input
                  type="text"
                  value={item.notes}
                  onChange={(e) =>
                    setEditingOrderItems((prev) =>
                      prev.map((row, i) => (i === index ? { ...row, notes: e.target.value } : row))
                    )
                  }
                  placeholder="Comments"
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setEditingOrderItems((prev) => prev.filter((_, i) => i !== index))}
                  className="px-3 py-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 text-sm"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={addEditingOrderItem}
              className="px-3 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 text-sm"
            >
              Add Item
            </button>
            <button
              type="button"
              onClick={() => void saveEditedOrder()}
              className="app-btn-primary text-sm"
            >
              Save Order Changes
            </button>
          </div>
        </div>
      ) : null}

      {!isWaiterCompact ? (
      <div className="mt-8 bg-white rounded-xl border border-slate-200 p-4 md:p-6">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-lg font-bold text-slate-900">Staff Performance Analytics</h2>
          <button
            type="button"
            onClick={() => setShowAnalytics((v) => !v)}
            className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50"
          >
            {showAnalytics ? "Hide" : "Show"}
          </button>
        </div>
        {showAnalytics ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          {waiters.map((w) => {
            const waiterTables = Object.values(tableLayout).filter((t) => t.waiterId === w.id).map((t) => t.number);
            const sales = postedTransactions
              .filter((tx) => waiterTables.some((table) => tx.saleId.includes(table)))
              .reduce((sum, tx) => sum + tx.amount, 0);
            const assignedOrders = queue.filter((q) => q.table_number && waiterTables.includes(q.table_number)).length;
            const upsell = assignedOrders > 0 ? sales / assignedOrders : 0;
            return (
              <div key={w.id} className="border rounded-lg p-3 bg-slate-50">
                <p className="font-semibold text-sm text-slate-900">{w.full_name}</p>
                <p className="text-xs text-slate-600">Sales: {sales.toFixed(2)}</p>
                <p className="text-xs text-slate-600">Orders: {assignedOrders}</p>
                <p className="text-xs text-slate-600">Upsell metric (avg/order): {upsell.toFixed(2)}</p>
              </div>
            );
          })}
          {waiters.length === 0 && <p className="text-sm text-slate-500">No waiter analytics yet.</p>}
        </div>
        ) : null}
      </div>
      ) : null}

      {!isWaiterCompact ? (
      <div className="mt-8 bg-white rounded-xl border border-slate-200 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-lg font-bold text-slate-900">Posted Hotel POS Transactions</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPostedTransactions((v) => !v)}
              className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50"
            >
              {showPostedTransactions ? "Hide" : "Show"}
            </button>
            <button
              type="button"
              onClick={() => void loadPostedTransactions()}
              className="inline-flex items-center gap-1 text-sm px-3 py-1.5 border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </div>
        {showPostedTransactions ? (
        <>
        <p className="text-xs text-slate-500 mb-3">
          Edit posted POS payments for {queueDate}. Changes update the `payments` record only.
        </p>
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-3">
          Refunded transactions are locked and cannot be edited.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
          <input
            type="password"
            placeholder="Manager PIN (for waiter override)"
            value={managerPinDraft}
            onChange={(e) => setManagerPinDraft(e.target.value)}
            className="border rounded px-2 py-1 text-xs"
          />
          <p className="text-xs text-slate-600">
            Roles: waiter can view; supervisor/manager can edit. Waiter requires manager PIN for void/refund.
          </p>
        </div>
        {postedTransactionsError ? (
          <p className="text-sm text-red-600 mb-3">{postedTransactionsError}</p>
        ) : null}
        {postedTransactionsLoading ? (
          <p className="text-sm text-slate-500">Loading posted transactions...</p>
        ) : postedTransactions.length === 0 ? (
          <p className="text-sm text-slate-500">No posted hotel POS transactions found for this date.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-200">
                  <th className="py-2 pr-2">Time</th>
                  <th className="py-2 pr-2">Sale ID</th>
                  <th className="py-2 pr-2">Amount</th>
                  <th className="py-2 pr-2">Method</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2">Last Edit</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {postedTransactions.map((tx) => {
                  const draft = postedTransactionDrafts[tx.id];
                  const isRefunded = tx.paymentStatus === "refunded";
                  const role = (user?.role || "").toLowerCase();
                  const canEdit = role === "manager" || role === "supervisor" || role === "accountant" || role === "admin";
                  return (
                    <tr key={tx.id} className="border-b border-slate-100">
                      <td className="py-2 pr-2">{new Date(tx.paidAt).toLocaleTimeString()}</td>
                      <td className="py-2 pr-2 font-mono text-xs">{tx.saleId.slice(0, 12)}</td>
                      <td className="py-2 pr-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={draft?.amount ?? tx.amount.toFixed(2)}
                          onChange={(e) =>
                            setPostedTransactionDrafts((prev) => ({
                              ...prev,
                              [tx.id]: {
                                amount: e.target.value,
                                paymentMethod: prev[tx.id]?.paymentMethod ?? tx.paymentMethod,
                                paymentStatus: prev[tx.id]?.paymentStatus ?? tx.paymentStatus,
                              },
                            }))
                          }
                          className="w-28 border border-slate-300 rounded px-2 py-1 text-xs"
                          disabled={readOnly || isRefunded || !canEdit}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <select
                          value={draft?.paymentMethod ?? tx.paymentMethod}
                          onChange={(e) =>
                            setPostedTransactionDrafts((prev) => ({
                              ...prev,
                              [tx.id]: {
                                amount: prev[tx.id]?.amount ?? tx.amount.toFixed(2),
                                paymentMethod: e.target.value as PaymentMethodCode,
                                paymentStatus: prev[tx.id]?.paymentStatus ?? tx.paymentStatus,
                              },
                            }))
                          }
                          className="border border-slate-300 rounded px-2 py-1 text-xs"
                          disabled={readOnly || isRefunded || !canEdit}
                        >
                          {PAYMENT_METHOD_SELECT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-2">
                        <select
                          value={draft?.paymentStatus ?? tx.paymentStatus}
                          onChange={(e) =>
                            setPostedTransactionDrafts((prev) => ({
                              ...prev,
                              [tx.id]: {
                                amount: prev[tx.id]?.amount ?? tx.amount.toFixed(2),
                                paymentMethod: prev[tx.id]?.paymentMethod ?? tx.paymentMethod,
                                paymentStatus: e.target.value as PaymentStatus,
                              },
                            }))
                          }
                          className="border border-slate-300 rounded px-2 py-1 text-xs"
                          disabled={readOnly || isRefunded || !canEdit}
                        >
                          <option value="pending">pending</option>
                          <option value="completed">completed</option>
                          <option value="failed">failed</option>
                          <option value="refunded">refunded</option>
                        </select>
                      </td>
                      <td className="py-2 pr-2 text-xs text-slate-600">
                        {tx.editedAt
                          ? `${new Date(tx.editedAt).toLocaleString()}${tx.editedByName ? ` · ${tx.editedByName}` : ""}`
                          : "—"}
                        {!canEdit ? <p className="text-[10px] text-amber-700">Read-only by role ({role || "staff"})</p> : null}
                        {(draft?.paymentStatus === "failed" || draft?.paymentStatus === "refunded") && (
                          <input
                            type="text"
                            placeholder="Void/refund reason"
                            value={voidReasonDraftByPaymentId[tx.id] || ""}
                            onChange={(e) =>
                              setVoidReasonDraftByPaymentId((prev) => ({ ...prev, [tx.id]: e.target.value }))
                            }
                            className="mt-1 w-full border rounded px-2 py-1 text-[10px]"
                            disabled={readOnly || !canEdit}
                          />
                        )}
                      </td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          onClick={() => void savePostedTransaction(tx.id)}
                          disabled={readOnly || isRefunded || !canEdit || savingPostedTransactionId === tx.id}
                          className="inline-flex items-center gap-1 px-2 py-1 border border-brand-200 text-brand-700 rounded hover:bg-brand-50 disabled:opacity-60"
                        >
                          {isRefunded ? "Locked" : savingPostedTransactionId === tx.id ? "Saving..." : "Save"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        </>
        ) : null}
      </div>
      ) : null}

      {payQueueOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !savingQueuePayment && setPayQueueOrder(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Settle Order</h3>
            <p className="text-sm text-slate-600 mb-3">
              Sale ID: <span className="font-mono">{payQueueOrder.id.slice(0, 8)}</span>
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Amount</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={payQueueAmount}
                  onChange={(e) => setPayQueueAmount(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Payment date</label>
                <input
                  type="date"
                  value={payQueueDate}
                  onChange={(e) => setPayQueueDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Payment method</label>
                <select
                  value={payQueueMethod}
                  onChange={(e) => setPayQueueMethod(e.target.value as PaymentMethodCode)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {PAYMENT_METHOD_SELECT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setPayQueueOrder(null)}
                  disabled={savingQueuePayment}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void saveQueueOrderPayment()}
                  disabled={savingQueuePayment}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {savingQueuePayment ? "Saving..." : "Record Payment"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showPrintBill && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2">
                <Printer className="w-4 h-4 text-slate-700" />
                <h3 className="text-sm font-semibold text-slate-900">Print POS Bill</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowPrintBill(false)}
                className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50"
              >
                Close
              </button>
            </div>
            <div className="px-4 py-3 flex gap-2 print:hidden">
              <button
                type="button"
                onClick={() => {
                  window.print();
                }}
                className="flex items-center gap-2 bg-brand-700 text-white px-4 py-2 rounded-lg hover:bg-brand-800"
              >
                <Printer className="w-4 h-4" />
                Print
              </button>
              <p className="text-xs text-slate-500">
                Use this to print a guest bill for the current cart.
              </p>
            </div>
            <div
              ref={printRef}
              className="px-4 pb-4 pt-2 print:p-0"
            >
              <style>{`
                @media print {
                  body * { visibility: hidden; }
                  #hotel-pos-print-bill, #hotel-pos-print-bill * { visibility: visible; }
                  #hotel-pos-print-bill { position: absolute; left: 0; top: 0; width: 100%; background: white; padding: 1rem; }
                }
              `}</style>
              <div id="hotel-pos-print-bill" className="text-sm text-slate-800">
                <div className="mb-4 border-b pb-3">
                  <h1 className="text-lg font-bold text-slate-900">Hotel POS Bill</h1>
                  <p className="text-xs text-slate-600">
                    {new Date().toLocaleDateString()} – {new Date().toLocaleTimeString()}
                  </p>
                  <p className="text-xs text-slate-600 mt-1">
                    Table: {tableNumber || "—"}
                    {selectedGuestId
                      ? ` · Guest: ${
                          hotelCustomers.find((g) => g.id === selectedGuestId)?.first_name || ""
                        } ${
                          hotelCustomers.find((g) => g.id === selectedGuestId)?.last_name || ""
                        }`
                      : ""}
                  </p>
                </div>
                <table className="w-full mb-4">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-1 text-xs">Item</th>
                      <th className="text-right py-1 text-xs">Qty</th>
                      <th className="text-right py-1 text-xs">Price</th>
                      <th className="text-right py-1 text-xs">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cart.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-3 text-center text-xs text-slate-500">
                          No items in cart
                        </td>
                      </tr>
                    ) : (
                      cart.map((item) => (
                        <tr key={item.product.id} className="border-b">
                          <td className="py-1 pr-2 align-top">
                            <div className="font-medium">{item.product.name || "Item"}</div>
                            {item.note ? (
                              <div className="text-[11px] text-slate-500">({item.note})</div>
                            ) : null}
                          </td>
                          <td className="py-1 text-right align-top">{item.quantity}</td>
                          <td className="py-1 text-right align-top">
                            {getUnitPrice(item.product).toFixed(2)}
                          </td>
                          <td className="py-1 text-right align-top">
                            {(getUnitPrice(item.product) * item.quantity).toFixed(2)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                <div className="border-t pt-2 space-y-1 text-right">
                  <p className="text-xs text-slate-600">
                    Subtotal: <span className="font-medium">{total.toFixed(2)}</span>
                  </p>
                  {(promoDiscountAmount > 0 || vipDiscountAmount > 0) && (
                    <p className="text-xs text-slate-600">
                      Discounts: -{(promoDiscountAmount + vipDiscountAmount).toFixed(2)}
                    </p>
                  )}
                  <p className="text-sm font-bold">
                    Total: {payableTotal.toFixed(2)}
                  </p>
                </div>
                <p className="text-[11px] text-slate-500 text-center mt-4">
                  Thank you.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
