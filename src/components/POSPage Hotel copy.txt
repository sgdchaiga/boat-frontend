import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Minus, X, ShoppingCart, Loader2, BookOpen } from "lucide-react";
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
import { insertPaymentWithMethodCompat, PAYMENT_METHOD_SELECT_OPTIONS, type PaymentMethodCode } from "../lib/paymentMethod";
import type { Database } from "../lib/database.types";
import { ReadOnlyNotice } from "./common/ReadOnlyNotice";
import { PageNotes } from "./common/PageNotes";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";
import { useAppContext } from "../contexts/AppContext";
import { GlAccountPicker, type GlAccountOption } from "./common/GlAccountPicker";

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
  kitchen_order_items?: { quantity: number; notes?: string; products?: { name: string } }[];
}

type PosAction = "send_kitchen" | "pay_now" | "bill_to_room";
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

// Temporary in-app recipe rules. Move to DB recipe tables when available.
const RECIPE_BY_PRODUCT_NAME: Record<string, RecipeIngredientRule[]> = {
  omelette: [{ ingredientName: "eggs", qtyPerUnit: 2 }],
  omelet: [{ ingredientName: "eggs", qtyPerUnit: 2 }],
};

interface POSPageProps {
  readOnly?: boolean;
}

export function POSPage({ readOnly = false }: POSPageProps = {}) {
  const { user } = useAuth();
  const { setCurrentPage } = useAppContext();
  const orgId = user?.organization_id ?? undefined;
  const [products, setProducts] = useState<Product[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [hotelCustomers, setHotelCustomers] = useState<PropertyCustomer[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeStays, setActiveStays] = useState<ActiveStay[]>([]);
  const [queue, setQueue] = useState<QueuedOrder[]>([]);
  const [selectedStay, setSelectedStay] = useState<ActiveStay | null>(null);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>("");
  const [selectedGuestId, setSelectedGuestId] = useState<string>("");
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [tableNumber, setTableNumber] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodCode>("cash");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [heldTickets, setHeldTickets] = useState<HeldTicket[]>([]);
  const [queueStatusFilter, setQueueStatusFilter] = useState<"active" | "all" | "pending" | "preparing">("active");
  const [recipeByProductId, setRecipeByProductId] = useState<Record<string, RecipeIngredientByIdRule[]>>({});
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
        .select("id,room_id,table_number,customer_name,order_status,created_at,kitchen_order_items(quantity,notes,product_id)")
        .gte("created_at", from.toISOString())
        .lt("created_at", to.toISOString())
        .order("created_at", { ascending: false });
      if (queueStatusFilter === "active") {
        ordersQuery = ordersQuery.in("order_status", ["pending", "preparing"]);
      } else if (queueStatusFilter !== "all") {
        ordersQuery = ordersQuery.eq("order_status", queueStatusFilter);
      }
      ordersQuery = filterByOrganizationId(ordersQuery, orgId, superAdmin);

      const [productsRes, staysRes, ordersRes, departmentsRes, customersRes, roomsRes] = await Promise.all([
        filterByOrganizationId(
          supabase.from("products").select("id,name,sales_price,cost_price,track_inventory,department_id").eq("active", true),
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
        filterByOrganizationId(supabase.from("departments").select("id,name").order("name"), orgId, superAdmin),
        filterByOrganizationId(supabase.from("hotel_customers").select("id,first_name,last_name").order("first_name"), orgId, superAdmin),
        filterByOrganizationId(supabase.from("rooms").select("id,room_number"), orgId, superAdmin),
      ]);

      if (productsRes.data) setProducts(productsRes.data as Product[]);
      if (productsRes.error) setProductsError(productsRes.error.message);
      if (productsRes.data) await loadRecipeRules(productsRes.data as Product[]);

      if (staysRes.data) setActiveStays(staysRes.data as unknown as ActiveStay[]);
      const rawOrders = (ordersRes.data || []) as any[];
      const productMap = Object.fromEntries((productsRes.data || []).map((p: any) => [p.id, p]));
      const roomMap = Object.fromEntries(((roomsRes.data || []) as any[]).map((r: any) => [r.id, r.room_number]));
      const queueWithProducts = rawOrders.map((o) => ({
        ...o,
        room_number: o.room_id ? roomMap[o.room_id] ?? null : null,
        kitchen_order_items: (o.kitchen_order_items || []).map((i: any) => ({
          ...i,
          products: i.product_id && productMap[i.product_id] ? { name: productMap[i.product_id].name } : { name: "Item" },
        })),
      }));
      setQueue(queueWithProducts as unknown as QueuedOrder[]);
      if (ordersRes.error) setQueueError(ordersRes.error.message);
      if (departmentsRes.data) setDepartments(departmentsRes.data as Department[]);
      if (customersRes.data) setHotelCustomers(customersRes.data as PropertyCustomer[]);

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

  const getUnitPrice = (product: Product) => product.sales_price ?? 0;

  const filteredProducts =
    selectedDepartmentId
      ? products.filter((p) => (p.department_id ?? null) === selectedDepartmentId)
      : products;

  const addToCart = (product: Product) => {
    const unitPrice = getUnitPrice(product);
    const existing = cart.find((i) => i.product.id === product.id);
    if (existing) {
      setCart(
        cart.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1, total: (item.quantity + 1) * unitPrice }
            : item
        )
      );
    } else {
      setCart([...cart, { product, quantity: 1, total: unitPrice }]);
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

  const total = useMemo(() => cart.reduce((s, i) => s + i.total, 0), [cart]);

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
    const gross = total;
    const net = Math.round((gross / (1 + posVatRate / 100)) * 100) / 100;
    const vat = Math.round((gross - net) * 100) / 100;
    return { net, vat, gross };
  }, [total, posVatEnabled, posVatRate]);

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

  const processOrder = async (action: PosAction) => {
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

      const withCustomer = orderCustomer ? { ...basePayload, customer_name: orderCustomer } : basePayload;
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
        notes: item.note || null,
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

      const cartDescription = cart.map((i) => `${i.quantity}× ${i.product.name}`).join(", ");
      const entryDate = businessTodayISO();

      if (action === "bill_to_room" && selectedStay) {
        const { data: billingRow } = await supabase
          .from("billing")
          .insert({
            stay_id: selectedStay.id,
            description: cartDescription,
            amount: total,
            charge_type: "food",
            created_by: staffRow?.id || null,
          })
          .select("id, charged_at")
          .single();
        if (billingRow) {
          const chargedAt = (billingRow as { charged_at?: string }).charged_at ?? new Date().toISOString();
          const jr = await createJournalForBillToRoom(
            (billingRow as { id: string }).id,
            total,
            cartDescription,
            chargedAt,
            staffRow?.id ?? null,
            buildRoomChargeGlOverrides()
          );
          if (!jr.ok) {
            alert(`Order saved but journal was not posted: ${jr.error}`);
          }
        }
      } else if (action === "pay_now") {
        const orgId = user?.organization_id ?? undefined;
        const { error: payInsErr } = await insertPaymentWithMethodCompat(
          supabase,
          {
            stay_id: null,
            ...(orgId ? { organization_id: orgId } : {}),
            payment_source: "pos_hotel",
            amount: total,
            payment_status: "completed",
            transaction_id: orderData.id,
            processed_by: staffRow?.id ?? null,
          },
          paymentMethod
        );
        if (payInsErr) throw new Error(String((payInsErr as Error)?.message || payInsErr) || "Failed to record payment.");
        const deptNameById = new Map(departments.map((d) => [d.id, d.name]));
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
        const jr = await createJournalForPosOrder(orderData.id, total, cartDescription, entryDate, staffRow?.id ?? null, {
          paymentMethod,
          cogsByDept,
          salesByDept,
          vatRatePercent: useVatJournal ? vatRate : undefined,
          glOverrides: buildPosGlOverrides(),
        });
        if (!jr.ok) {
          alert(`Payment recorded but journal was not posted: ${jr.error}`);
        }
      }

      setCart([]);
      setSelectedStay(null);
      setTableNumber("");
      setSelectedGuestId("");
      loadData();
      alert(
        action === "send_kitchen"
          ? "Order sent to kitchen."
          : action === "pay_now"
            ? "Order paid and sent successfully."
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
      id: crypto.randomUUID(),
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
    <div className="p-6 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold text-slate-900">Hotel POS</h1>
          <PageNotes ariaLabel="Hotel POS help">
            <p>Hospitality POS for room/table orders and bill-to-room workflows.</p>
            <p className="mt-2">
              Use <strong>Journal GL settings</strong> to map cash, bank, mobile money, COGS, and inventory accounts used when posting POS sales.
            </p>
          </PageNotes>
        </div>
        <button
          type="button"
          onClick={() => setCurrentPage("admin", { adminTab: "journal_accounts" })}
          className="inline-flex items-center gap-2 text-sm font-medium text-brand-800 bg-brand-50 hover:bg-brand-100 border border-brand-200 rounded-lg px-3 py-2 shrink-0"
        >
          <BookOpen className="w-4 h-4" />
          Journal GL settings
        </button>
      </div>
      {readOnly && (
        <ReadOnlyNotice />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Products */}
        <div className="lg:col-span-2">
          <h2 className="text-lg font-bold text-slate-900 mb-3">Products</h2>
          {productsError && (
            <p className="text-red-600 text-sm mb-3">
              {productsError}. Ensure the products table has id, name, sales_price, active.
            </p>
          )}
          {departments.length > 0 && (
            <div className="mb-3 flex items-center gap-2">
              <label className="text-sm text-slate-700">Department</label>
              <select
                value={selectedDepartmentId}
                onChange={(e) => setSelectedDepartmentId(e.target.value)}
                className="border rounded-lg px-3 py-1.5 text-sm"
              >
                {/* No \"All\" option so products are always scoped */}
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-center gap-3 mb-2">
            <select
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
              className="flex-1 border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">
                {filteredProducts.length === 0 ? "No products in this department" : "Select product"}
              </option>
              {filteredProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} – {getUnitPrice(p).toFixed(2)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!selectedProductId || readOnly}
              onClick={() => {
                const product = filteredProducts.find((p) => p.id === selectedProductId);
                if (product) addToCart(product);
              }}
              className="app-btn-primary gap-1 text-sm disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </div>
          {filteredProducts.length === 0 && !productsError && (
            <p className="text-slate-500 py-4 text-sm">
              No active products for this department. Check Products setup.
            </p>
          )}
        </div>

        {/* Cart + Actions */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 h-fit">
          <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
            <ShoppingCart className="w-5 h-5" />
            Cart
          </h2>

          {/* Customer & Table */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Table</label>
              <input
                type="text"
                placeholder="e.g. 5, Terrace"
                value={tableNumber}
                onChange={(e) => setTableNumber(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Customer</label>
              <select
                value={selectedGuestId}
                onChange={(e) => setSelectedGuestId(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Select customer</option>
                {hotelCustomers.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.first_name} {g.last_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-3 max-h-64 overflow-y-auto mb-4">
            {cart.length === 0 ? (
              <p className="text-slate-500 text-sm py-4">Cart is empty. Tap products to add.</p>
            ) : (
              cart.map((item) => (
                <div
                  key={item.product.id}
                  className="flex items-center justify-between gap-2 p-2 bg-slate-50 rounded-lg"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900 text-sm truncate">{item.product.name}</p>
                    <p className="text-xs text-slate-500">
                      {getUnitPrice(item.product).toFixed(2)} × {item.quantity}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                      className="p-1 hover:bg-slate-200 rounded"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <span className="w-6 text-center text-sm font-medium">{item.quantity}</span>
                    <button
                      onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                      className="p-1 hover:bg-slate-200 rounded"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => removeItem(item.product.id)}
                      className="p-1 hover:bg-red-100 text-red-600 rounded"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <input
                    placeholder="Note"
                    value={item.note || ""}
                    onChange={(e) => addNote(item.product.id, e.target.value)}
                    className="w-20 border rounded px-2 py-1 text-xs"
                  />
                </div>
              ))
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
              <p className="text-xl font-bold text-slate-900">Total: {total.toFixed(2)}</p>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Pay Now Method</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethodCode)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              >
                {PAYMENT_METHOD_SELECT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/90 space-y-3">
              <button
                type="button"
                onClick={() => setPosGlAdvancedOpen((o) => !o)}
                className="w-full flex items-center justify-between text-left text-sm font-semibold text-slate-900"
              >
                <span>GL accounts for this sale (optional)</span>
                <span className="text-slate-500">{posGlAdvancedOpen ? "−" : "+"}</span>
              </button>
              <p className="text-xs text-slate-600">
                If Admin → Journal account settings are not working, choose accounts here for <strong>this</strong> payment or
                bill-to-room posting. Leave on Auto to use defaults from settings / chart.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Revenue (income)</label>
                  <GlAccountPicker
                    value={posGlRevenueId}
                    onChange={setPosGlRevenueId}
                    options={glByType("income")}
                    emptyOption={{ label: "Auto — revenue" }}
                    placeholder="Search account…"
                    className="w-full text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Receipt / cash-side (Pay now — asset: cash, bank, mobile money)
                  </label>
                  <GlAccountPicker
                    value={posGlReceiptId}
                    onChange={setPosGlReceiptId}
                    options={glByType("asset")}
                    emptyOption={{ label: "Auto — by payment method" }}
                    placeholder="Search account…"
                    className="w-full text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Accounts receivable (Bill to room — guest ledger)
                  </label>
                  <GlAccountPicker
                    value={posGlReceivableId}
                    onChange={setPosGlReceivableId}
                    options={glByType("asset")}
                    emptyOption={{ label: "Auto — receivable" }}
                    placeholder="Search account…"
                    className="w-full text-sm"
                  />
                </div>
                {posVatEnabled && posVatRate != null && posVatRate > 0 ? (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">VAT / output tax</label>
                    <GlAccountPicker
                      value={posGlVatId}
                      onChange={setPosGlVatId}
                      options={allGlOptions}
                      emptyOption={{ label: "Auto — VAT account" }}
                      placeholder="Search account…"
                      className="w-full text-sm"
                    />
                  </div>
                ) : null}
                {posGlAdvancedOpen ? (
                  <div className="pt-2 border-t border-slate-200 space-y-3">
                    <p className="text-xs font-medium text-slate-700">COGS & inventory (by department bucket)</p>
                    <p className="text-xs text-slate-500">Only used when stock / cost lines apply. Expense = COGS; Asset = inventory.</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">Bar COGS</label>
                        <GlAccountPicker
                          value={posGlCogsBar}
                          onChange={setPosGlCogsBar}
                          options={glByType("expense")}
                          emptyOption={{ label: "Auto" }}
                          placeholder="…"
                          className="w-full text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">Bar inventory</label>
                        <GlAccountPicker
                          value={posGlInvBar}
                          onChange={setPosGlInvBar}
                          options={glByType("asset")}
                          emptyOption={{ label: "Auto" }}
                          placeholder="…"
                          className="w-full text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">Kitchen COGS</label>
                        <GlAccountPicker
                          value={posGlCogsKitchen}
                          onChange={setPosGlCogsKitchen}
                          options={glByType("expense")}
                          emptyOption={{ label: "Auto" }}
                          placeholder="…"
                          className="w-full text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">Kitchen inventory</label>
                        <GlAccountPicker
                          value={posGlInvKitchen}
                          onChange={setPosGlInvKitchen}
                          options={glByType("asset")}
                          emptyOption={{ label: "Auto" }}
                          placeholder="…"
                          className="w-full text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">Room COGS</label>
                        <GlAccountPicker
                          value={posGlCogsRoom}
                          onChange={setPosGlCogsRoom}
                          options={glByType("expense")}
                          emptyOption={{ label: "Auto" }}
                          placeholder="…"
                          className="w-full text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] uppercase tracking-wide text-slate-500 mb-0.5">Room inventory</label>
                        <GlAccountPicker
                          value={posGlInvRoom}
                          onChange={setPosGlInvRoom}
                          options={glByType("asset")}
                          emptyOption={{ label: "Auto" }}
                          placeholder="…"
                          className="w-full text-xs"
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Room (Bill to Room)</label>
              <select
                value={selectedStay?.id ?? ""}
                onChange={(e) => {
                  const s = activeStays.find((x) => x.id === e.target.value);
                  setSelectedStay(s || null);
                }}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Select room</option>
                {activeStays.map((s) => (
                  <option key={s.id} value={s.id}>
                    Room {s.rooms?.room_number} – {s.hotel_customers?.first_name} {s.hotel_customers?.last_name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <button
                onClick={() => processOrder("send_kitchen")}
                disabled={sending || cart.length === 0 || readOnly}
                className="w-full bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2 rounded-lg font-medium flex items-center justify-center gap-2"
              >
                {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                Send to Kitchen
              </button>
              <button
                onClick={() => processOrder("pay_now")}
                disabled={sending || cart.length === 0 || readOnly}
                className="app-btn-primary w-full py-2 font-medium disabled:cursor-not-allowed"
              >
                {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                Pay Now
              </button>
              <button
                onClick={() => processOrder("bill_to_room")}
                disabled={sending || cart.length === 0 || readOnly}
                className="w-full bg-indigo-700 hover:bg-indigo-800 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2 rounded-lg font-medium flex items-center justify-center gap-2"
              >
                {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
                Bill to Room
              </button>
              <button
                onClick={holdCurrentTicket}
                disabled={sending || cart.length === 0 || readOnly}
                className="w-full py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg text-sm"
              >
                Hold Ticket
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
      <div className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
          <h2 className="text-lg font-bold text-slate-900">Order Queue</h2>
          <div className="flex flex-wrap items-center gap-2">
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
            <label className="text-sm font-medium text-slate-700">Date</label>
            <input
              type="date"
              value={queueDate}
              onChange={(e) => setQueueDate(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>
        {queueError ? (
          <p className="text-red-600 text-sm">Failed to load queue: {queueError}</p>
        ) : queue.length === 0 ? (
          <p className="text-slate-500 text-sm">No orders found for this date/filter.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {queue.map((o) => (
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
                  {o.kitchen_order_items?.map((it, i) => (
                    <p key={i}>
                      {it.quantity}× {it.products?.name || "Item"} {it.notes && `(${it.notes})`}
                    </p>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  {new Date(o.created_at).toLocaleTimeString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
