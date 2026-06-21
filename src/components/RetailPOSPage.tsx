import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { incrementActiveAccessTransactions } from "../lib/localAuthStore";
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
  type MobileMoneyGatewayProvider,
  type SaleCustomerContext,
} from "./retail-pos/services/checkoutService";
import { processSaleOnline, type PosAgentCommissionContext } from "./retail-pos/services/processSaleOnline";
import type { PosExperience } from "../lib/posExperience";
import { getPosLabels } from "../lib/posExperience";
import { fetchClinicConsultations, fetchClinicPatients } from "@/lib/clinicData";
import type { ClinicConsultation, ClinicPatient } from "./clinic/clinicTypes";
import { ClinicPosLeftPanel } from "./clinic/ClinicPosLeftPanel";

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
  manufacturing_item_type?: string | null;
}

interface CartItem {
  product: Product;
  quantity: number;
  lineTotal: number;
  unitPriceOverride?: number | null;
}

interface ReceiptData {
  saleId: string;
  paidAt: string;
  paymentMethod: PaymentMethodCode;
  total: number;
  grossSale: number;
  agentCommission: number;
  transportCost: number;
  netAmountDue: number;
  amountPaid: number;
  agentName?: string | null;
  /** When VAT-inclusive sale */
  netAmount?: number;
  vatAmount?: number;
  lines: Array<{ name: string; qty: number; unitPrice: number; lineTotal: number }>;
}

interface ReceiptOrgHeader {
  name: string;
  address: string | null;
  stkPushEnabled: boolean;
  mobileMoneyGateway: MobileMoneyGatewayProvider;
}

interface RetailCustomerRow {
  id: string;
  name: string;
  phone: string | null;
  credit_limit?: number | null;
  current_credit_balance?: number | null;
  manufacturing_customer_type_id?: string | null;
}

interface ManufacturingPriceRow {
  product_id: string;
  customer_type_id: string;
  min_qty: number;
  price: number;
}

interface ManufacturingCustomerTypeRow {
  id: string;
  name: string;
}

interface PosSalesAgentRow {
  id: string;
  name: string;
  phone: string | null;
  commission_per_unit: number;
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
  /** `"pharmacy"` = patient labels + pharmacy receipt (clinic tenants). */
  posExperience?: PosExperience;
  /** Dedicated clinic dispensing workspace (left rail). */
  leftPanelMode?: "retail_cart" | "clinic_workspace";
}

type PaymentFeedbackStatus = "idle" | "waiting" | "success" | "failed";
type CheckoutTender = OfflineRetailPayment & { id: string };
const QUICK_PICK_STATS_KEY = "boat.retail.quickpick.stats.v1";
const QUICK_PICK_RECENT_KEY = "boat.retail.quickpick.recent.v1";

export function RetailPOSPage({
  readOnly = false,
  posExperience = "retail",
  leftPanelMode = "retail_cart",
}: RetailPOSPageProps = {}) {
  const { user } = useAuth();
  const { setCurrentPage } = useAppContext();
  const orgId = user?.organization_id ?? undefined;
  const superAdmin = !!user?.isSuperAdmin;
  const effectivePosExperience: PosExperience = leftPanelMode === "clinic_workspace" ? "pharmacy" : posExperience;
  const L = useMemo(() => getPosLabels(effectivePosExperience), [effectivePosExperience]);
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([]);
  const [topSelling, setTopSelling] = useState<Array<{ id: string; name: string; qty: number }>>([]);
  const [slowMovers, setSlowMovers] = useState<Array<{ id: string; name: string; qty: number }>>([]);
  const [marginAlerts, setMarginAlerts] = useState<Array<{ id: string; name: string; marginPct: number }>>([]);
  const [quickPickStats, setQuickPickStats] = useState<Record<string, number>>({});
  const [recentQuickPickIds, setRecentQuickPickIds] = useState<string[]>([]);
  const [customers, setCustomers] = useState<RetailCustomerRow[]>([]);
  const [manufacturingPrices, setManufacturingPrices] = useState<ManufacturingPriceRow[]>([]);
  const [manufacturingCustomerTypes, setManufacturingCustomerTypes] = useState<ManufacturingCustomerTypeRow[]>([]);
  const [posSalesAgents, setPosSalesAgents] = useState<PosSalesAgentRow[]>([]);
  const [selectedPosSalesAgentId, setSelectedPosSalesAgentId] = useState("");
  const [transportCost, setTransportCost] = useState(0);
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
  const [saleDate, setSaleDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentFeedbackStatus, setPaymentFeedbackStatus] = useState<PaymentFeedbackStatus>("idle");
  const [paymentFeedbackMessage, setPaymentFeedbackMessage] = useState("");
  const [receiptAccounts, setReceiptAccounts] = useState<Array<{
    id: string;
    account_code: string;
    account_name: string;
    kind: "bank" | "wallet";
  }>>([]);
  const [retryPendingTenders, setRetryPendingTenders] = useState<Array<{ method: PaymentMethodCode; amount: number }>>([]);
  const [activePanelTab, setActivePanelTab] = useState<"payment" | "customer" | "notes">("payment");
  const [advancedModeEnabled, setAdvancedModeEnabled] = useState(true);
  const [discountEnabled, setDiscountEnabled] = useState(false);
  const [savingDiscountSetting, setSavingDiscountSetting] = useState(false);
  const [agentCommissionEnabled, setAgentCommissionEnabled] = useState(true);
  const [savingCommissionSetting, setSavingCommissionSetting] = useState(false);
  const [useManufacturingPriceList, setUseManufacturingPriceList] = useState(true);
  const [savingPricingSource, setSavingPricingSource] = useState(false);
  // Temporary rollout: Manufacturing POS prices remain freely editable until role-based blocking is introduced.
  const manufacturingPriceEditingEnabled = user?.business_type === "manufacturing";
  const localAuthEnabled = ["true", "1", "yes"].includes((import.meta.env.VITE_LOCAL_AUTH || "").trim().toLowerCase());
  const useDesktopLocalMode = localAuthEnabled && desktopApi.isAvailable();
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const [clinicPatients, setClinicPatients] = useState<ClinicPatient[]>([]);
  const [clinicConsultations, setClinicConsultations] = useState<ClinicConsultation[]>([]);
  const [clinicRegistryLoading, setClinicRegistryLoading] = useState(false);
  const [patientRegistryQuery, setPatientRegistryQuery] = useState("");
  const [selectedClinicPatientId, setSelectedClinicPatientId] = useState<string | null>(null);
  const [prescriptionSearchQuery, setPrescriptionSearchQuery] = useState("");

  const {
    products: catalogProducts,
    loading,
    catalogLoadingMore,
    productSearch,
    setProductSearch,
    filteredManualProducts: catalogFilteredManualProducts,
    hasMoreProducts,
    loadMoreProducts,
  } = useProductCatalog<Product>(useDesktopLocalMode, orgId);
  const manufacturingSalesDepartmentIds = useMemo(
    () =>
      user?.business_type === "manufacturing"
        ? new Set(
            departments
              .filter((department) => department.name.trim().toLowerCase() === "sales")
              .map((department) => department.id)
          )
        : new Set<string>(),
    [departments, user?.business_type]
  );
  const products = useMemo(
    () =>
      user?.business_type === "manufacturing"
        ? catalogProducts.filter(
            (product) =>
              product.manufacturing_item_type === "finished_product" ||
              (!!product.department_id && manufacturingSalesDepartmentIds.has(product.department_id))
          )
        : catalogProducts,
    [catalogProducts, manufacturingSalesDepartmentIds, user?.business_type]
  );
  const filteredManualProducts = useMemo(
    () =>
      user?.business_type === "manufacturing"
        ? catalogFilteredManualProducts.filter(
            (product) =>
              product.manufacturing_item_type === "finished_product" ||
              (!!product.department_id && manufacturingSalesDepartmentIds.has(product.department_id))
          )
        : catalogFilteredManualProducts,
    [catalogFilteredManualProducts, manufacturingSalesDepartmentIds, user?.business_type]
  );

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
    posExperience: effectivePosExperience,
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
    if (!orgId || user?.business_type !== "manufacturing") return;
    void supabase
      .from("organization_permissions")
      .select("allowed")
      .eq("organization_id", orgId)
      .eq("role_key", "__org__")
      .eq("permission_key", "retail_pos_agent_commission_enabled")
      .maybeSingle()
      .then(({ data }) => setAgentCommissionEnabled(data?.allowed !== false));
  }, [orgId, user?.business_type]);

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
    if (!orgId) return;
    void supabase
      .from("organization_permissions")
      .select("allowed")
      .eq("organization_id", orgId)
      .eq("role_key", "__org__")
      .eq("permission_key", "retail_pos_discount_enabled")
      .maybeSingle()
      .then(({ data }) => setDiscountEnabled(data?.allowed === true));
  }, [orgId]);

  useEffect(() => {
    if (!orgId || user?.business_type !== "manufacturing") {
      setUseManufacturingPriceList(false);
      return;
    }
    setUseManufacturingPriceList(true);
    void supabase
      .from("organization_permissions")
      .select("allowed")
      .eq("organization_id", orgId)
      .eq("role_key", "__org__")
      .eq("permission_key", "retail_pos_use_price_list")
      .maybeSingle()
      .then(({ data }) => setUseManufacturingPriceList(data?.allowed !== false));
  }, [orgId, user?.business_type]);

  const loadPosSalesAgents = useCallback(async () => {
    if (!orgId || user?.business_type !== "manufacturing" || useDesktopLocalMode) {
      setPosSalesAgents([]);
      return;
    }
    const { data, error } = await supabase
      .from("pos_sales_agents")
      .select("id,name,phone,commission_per_unit")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("name");
    if (error) {
      console.warn("Unable to load POS sales agents:", error.message);
      return;
    }
    setPosSalesAgents((data || []).map((row) => ({ ...row, commission_per_unit: Number(row.commission_per_unit || 0) })) as PosSalesAgentRow[]);
  }, [orgId, useDesktopLocalMode, user?.business_type]);

  useEffect(() => { void loadPosSalesAgents(); }, [loadPosSalesAgents]);

  const addPosSalesAgent = async () => {
    if (!orgId || readOnly) return;
    const name = window.prompt("Agent / Bodaboda name")?.trim();
    if (!name) return;
    const rateText = window.prompt("Commission per bag", "2500")?.trim();
    if (rateText == null) return;
    const rate = Number(rateText);
    if (!Number.isFinite(rate) || rate < 0) {
      toast({ title: "Invalid commission", description: "Enter a commission of zero or more." });
      return;
    }
    const { data, error } = await supabase.from("pos_sales_agents").insert({
      organization_id: orgId,
      name,
      commission_per_unit: rate,
    }).select("id,name,phone,commission_per_unit").single();
    if (error) {
      toast({ title: "Could not add agent", description: error.message });
      return;
    }
    const next = { ...data, commission_per_unit: Number(data.commission_per_unit || 0) } as PosSalesAgentRow;
    setPosSalesAgents((current) => [...current, next].sort((a, b) => a.name.localeCompare(b.name)));
    setSelectedPosSalesAgentId(next.id);
  };

  const toggleDiscountSetting = async () => {
    if (!orgId) return;
    const role = String(user?.role || "").toLowerCase();
    if (!user?.isSuperAdmin && !["admin", "manager", "supervisor"].includes(role)) {
      alert("Only a manager can change the POS discount setting.");
      return;
    }
    setSavingDiscountSetting(true);
    const next = !discountEnabled;
    const { data, error } = await supabase
      .from("organization_permissions")
      .select("id")
      .eq("organization_id", orgId)
      .eq("role_key", "__org__")
      .eq("permission_key", "retail_pos_discount_enabled")
      .maybeSingle();
    const saveError = error
      ? error
      : data?.id
        ? (await supabase.from("organization_permissions").update({ allowed: next, updated_at: new Date().toISOString() }).eq("id", data.id)).error
        : (await supabase.from("organization_permissions").insert({
            organization_id: orgId,
            role_key: "__org__",
            permission_key: "retail_pos_discount_enabled",
            allowed: next,
          })).error;
    if (saveError) alert(`Could not update POS discounts: ${saveError.message}`);
    else setDiscountEnabled(next);
    setSavingDiscountSetting(false);
  };

  const toggleAgentCommissionSetting = async () => {
    if (!orgId) return;
    const role = String(user?.role || "").toLowerCase();
    if (!user?.isSuperAdmin && !["admin", "manager", "supervisor"].includes(role)) {
      alert("Only a manager can change the agent commission setting.");
      return;
    }
    setSavingCommissionSetting(true);
    const next = !agentCommissionEnabled;
    const { data, error } = await supabase
      .from("organization_permissions")
      .select("id")
      .eq("organization_id", orgId)
      .eq("role_key", "__org__")
      .eq("permission_key", "retail_pos_agent_commission_enabled")
      .maybeSingle();
    const saveError = error
      ? error
      : data?.id
        ? (await supabase.from("organization_permissions").update({ allowed: next, updated_at: new Date().toISOString() }).eq("id", data.id)).error
        : (await supabase.from("organization_permissions").insert({
            organization_id: orgId,
            role_key: "__org__",
            permission_key: "retail_pos_agent_commission_enabled",
            allowed: next,
          })).error;
    if (saveError) alert(`Could not update agent commissions: ${saveError.message}`);
    else setAgentCommissionEnabled(next);
    setSavingCommissionSetting(false);
  };

  const enterTransportCost = () => {
    if (!selectedPosSalesAgent) {
      toast({ title: "Select an agent", description: "Choose the rider or bodaboda before entering transport cost." });
      return;
    }
    const entered = window.prompt("Transport cost for this sale", transportCost ? String(transportCost) : "0");
    if (entered == null) return;
    const amount = Number(entered.replace(/,/g, "").trim());
    if (!Number.isFinite(amount) || amount < 0) {
      toast({ title: "Invalid transport cost", description: "Enter a transport cost of zero or more." });
      return;
    }
    setTransportCost(Math.round(amount * 100) / 100);
  };

  const setPricingSource = async (usePriceList: boolean) => {
    if (!orgId || usePriceList === useManufacturingPriceList) return;
    const role = String(user?.role || "").toLowerCase();
    if (!user?.isSuperAdmin && !["admin", "manager", "supervisor"].includes(role)) {
      alert("Only a manager can change the POS pricing source.");
      return;
    }
    setSavingPricingSource(true);
    const { data, error } = await supabase
      .from("organization_permissions")
      .select("id")
      .eq("organization_id", orgId)
      .eq("role_key", "__org__")
      .eq("permission_key", "retail_pos_use_price_list")
      .maybeSingle();
    const saveError = error
      ? error
      : data?.id
        ? (await supabase.from("organization_permissions").update({ allowed: usePriceList, updated_at: new Date().toISOString() }).eq("id", data.id)).error
        : (await supabase.from("organization_permissions").insert({
            organization_id: orgId,
            role_key: "__org__",
            permission_key: "retail_pos_use_price_list",
            allowed: usePriceList,
          })).error;
    if (saveError) alert(`Could not update POS pricing source: ${saveError.message}`);
    else setUseManufacturingPriceList(usePriceList);
    setSavingPricingSource(false);
  };

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
          mobileMoneyGateway: "flutterwave",
        });
        return;
      }
      const { data } = await supabase
        .from("organizations")
        .select("name,address,retail_stk_push_enabled,retail_mobile_money_gateway")
        .eq("id", orgId)
        .maybeSingle();
      const row = data as {
        name?: string | null;
        address?: string | null;
        retail_stk_push_enabled?: boolean | null;
        retail_mobile_money_gateway?: string | null;
      } | null;
      if (row?.name?.trim()) {
        const gateway: MobileMoneyGatewayProvider = row.retail_mobile_money_gateway === "dpo" ? "dpo" : "flutterwave";
        setReceiptOrgHeader({
          name: row.name.trim(),
          address: row.address?.trim() ? row.address.trim() : null,
          stkPushEnabled: row.retail_stk_push_enabled === true,
          mobileMoneyGateway: gateway,
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
        const local = await desktopApi.localSelect({
          table: "departments",
          orderBy: { column: "name", ascending: true },
          limit: 500,
        });
        setDepartments(
          (local.rows || [])
            .map((row) => ({ id: String(row.id || ""), name: String(row.name || "") }))
            .filter((row) => row.id && row.name)
        );
        return;
      }
      const departmentQuery = supabase.from("departments").select("id,name").order("name");
      const { data } =
        user?.business_type === "manufacturing"
          ? await departmentQuery
          : await filterByOrganizationId(departmentQuery, orgId, superAdmin);
      setDepartments((data || []) as Array<{ id: string; name: string }>);
    };
    loadDepartments();
  }, [orgId, superAdmin, useDesktopLocalMode, user?.business_type]);

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
          manufacturing_customer_type_id: null,
        })) as RetailCustomerRow[];
        setCustomers(mapped.filter((r) => r.id && r.name));
        return;
      }
      const { data } = await filterByOrganizationId(
        supabase
          .from("retail_customers")
          .select("id,name,phone,credit_limit,current_credit_balance,manufacturing_customer_type_id")
          .order("name"),
        orgId,
        superAdmin
      );
      setCustomers((data || []) as RetailCustomerRow[]);
    };
    void loadCustomers();
  }, [orgId, superAdmin, useDesktopLocalMode]);

  useEffect(() => {
    if (user?.business_type !== "manufacturing" || !orgId || useDesktopLocalMode) {
      setManufacturingPrices([]);
      setManufacturingCustomerTypes([]);
      return;
    }
    void Promise.all([
      supabase
        .from("manufacturing_price_list")
        .select("product_id,customer_type_id,min_qty,price")
        .eq("organization_id", orgId),
      supabase
        .from("manufacturing_customer_types")
        .select("id,name")
        .eq("organization_id", orgId),
    ]).then(([priceResult, typeResult]) => {
      if (priceResult.error || typeResult.error) {
        console.error("Manufacturing POS price-list load failed:", priceResult.error || typeResult.error);
        toast({
          title: "Price list unavailable",
          description: (priceResult.error || typeResult.error)?.message || "Could not load manufacturing prices.",
        });
      }
      setManufacturingPrices((priceResult.data || []) as ManufacturingPriceRow[]);
      setManufacturingCustomerTypes((typeResult.data || []) as ManufacturingCustomerTypeRow[]);
    });
  }, [orgId, user?.business_type, useDesktopLocalMode]);

  useEffect(() => {
    if (leftPanelMode !== "clinic_workspace" || !orgId || useDesktopLocalMode) {
      setClinicPatients([]);
      setClinicConsultations([]);
      setClinicRegistryLoading(false);
      return;
    }
    let cancelled = false;
    setClinicRegistryLoading(true);
    void Promise.all([fetchClinicPatients(orgId, superAdmin), fetchClinicConsultations(orgId, superAdmin)])
      .then(([p, c]) => {
        if (!cancelled) {
          setClinicPatients(p);
          setClinicConsultations(c);
        }
      })
      .catch((e) => console.warn("[clinic POS] registry load failed:", e))
      .finally(() => {
        if (!cancelled) setClinicRegistryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [leftPanelMode, orgId, superAdmin, useDesktopLocalMode]);

  useEffect(() => {
    const selected = customers.find((c) => c.id === selectedCustomerId);
    if (!selected) return;
    setCustomerNameDraft((prev) => (prev.trim() ? prev : selected.name));
    setCustomerPhoneDraft((prev) => (prev.trim() ? prev : selected.phone || ""));
  }, [selectedCustomerId, customers]);

  useEffect(() => {
    if (leftPanelMode !== "clinic_workspace") return;
    if (!selectedClinicPatientId) return;
    const p = clinicPatients.find((x) => x.id === selectedClinicPatientId);
    if (!p) return;
    setCustomerNameDraft(p.name);
    setCustomerPhoneDraft(p.phone || "");
    setSelectedCustomerId("");
  }, [leftPanelMode, selectedClinicPatientId, clinicPatients, setCustomerNameDraft, setCustomerPhoneDraft, setSelectedCustomerId]);

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

  const getUnitPrice = (product: Product, quantity = 1) => {
    if (user?.business_type === "manufacturing" && useManufacturingPriceList) {
      const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId);
      const retailTypeId = manufacturingCustomerTypes.find(
        (type) => type.name.trim().toLowerCase() === "retail"
      )?.id;
      const customerTypeId = selectedCustomer?.manufacturing_customer_type_id || retailTypeId;
      if (customerTypeId) {
        const tier = manufacturingPrices
          .filter(
            (row) =>
              row.product_id === product.id &&
              row.customer_type_id === customerTypeId &&
              Number(row.min_qty) <= quantity
          )
          .sort((a, b) => Number(b.min_qty) - Number(a.min_qty))[0];
        if (tier) return Number(tier.price);
      }
    }
    return getProductPrice(product, { quantity });
  };
  const {
    cartByProductId,
    setCartByProductId,
    cart,
    total,
    addToCart: addToCartBase,
    updateQty,
    setLineUnitPrice,
    clearCart,
    qtyPadProductId,
    qtyPadValue,
    setQtyPadValue,
    closeQtyPad,
    applyQtyPad,
    qtyPadAppend,
    qtyPadBackspace,
  } = useCart<Product>(getUnitPrice);

  useEffect(() => {
    setCartByProductId((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const [productId, item] of Object.entries(previous)) {
        if (item.unitPriceOverride != null) continue;
        const unitPrice = getUnitPrice(item.product, item.quantity);
        const lineTotal = unitPrice * item.quantity;
        if (lineTotal !== item.lineTotal) {
          next[productId] = { ...item, lineTotal };
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [selectedCustomerId, customers, manufacturingPrices, manufacturingCustomerTypes, useManufacturingPriceList, user?.business_type, setCartByProductId]);
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
      const top = topSelling.map((row) => map.get(row.id)).filter((p): p is Product => Boolean(p));
      const topIds = new Set(top.map((product) => product.id));
      const remaining = products
        .filter((product) => !topIds.has(product.id))
        .sort((a, b) => (quickPickStats[b.id] || 0) - (quickPickStats[a.id] || 0) || a.name.localeCompare(b.name));
      return [...top, ...remaining].slice(0, 10);
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

  const selectedPosSalesAgent = posSalesAgents.find((agent) => agent.id === selectedPosSalesAgentId) ?? null;
  const commissionUnits = cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const agentCommissionAmount = selectedPosSalesAgent
    && agentCommissionEnabled ? Math.round(commissionUnits * selectedPosSalesAgent.commission_per_unit * 100) / 100
    : 0;
  const appliedTransportCost = selectedPosSalesAgent ? transportCost : 0;
  const netSaleAmount = Math.max(0, Math.round((total - agentCommissionAmount - appliedTransportCost) * 100) / 100);
  const agentCommissionContext: PosAgentCommissionContext | null = selectedPosSalesAgent ? {
    agentId: selectedPosSalesAgent.id,
    agentName: selectedPosSalesAgent.name,
    commissionPerUnit: selectedPosSalesAgent.commission_per_unit,
    commissionAmount: agentCommissionAmount,
    transportCost: appliedTransportCost,
    netAmountDue: netSaleAmount,
  } : null;

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
  } = usePayments(netSaleAmount);

  useEffect(() => {
    if (!orgId || useDesktopLocalMode) {
      setReceiptAccounts([]);
      return;
    }
    void supabase
      .from("gl_accounts")
      .select("id,account_code,account_name,account_type")
      .eq("organization_id", orgId)
      .eq("account_type", "asset")
      .order("account_code")
      .then(({ data }: { data: unknown[] | null }) => {
        const rows = (data || []) as Array<{ id: string; account_code: string; account_name: string }>;
        const next: Array<{
          id: string;
          account_code: string;
          account_name: string;
          kind: "bank" | "wallet";
        }> = [];
        for (const account of rows) {
          const label = `${account.account_code} ${account.account_name}`.toLowerCase();
          if (/(wallet|mobile money|momo|airtel|mtn)/.test(label)) {
            next.push({ ...account, kind: "wallet" });
          } else if (!/(inventory|stock|receivable|prepaid|fixed asset|property|equipment|wip|work in progress)/.test(label)) {
            // Bank names often omit the word "bank" (for example, just the institution name).
            next.push({ ...account, kind: "bank" });
          }
        }
        setReceiptAccounts(next);
      });
  }, [orgId, useDesktopLocalMode]);
  const saleType: "cash" | "credit" | "mixed" =
    amountPaid <= 0 ? "credit" : amountPaid < netSaleAmount ? "mixed" : "cash";
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
      toast({ title: L.medicineNotFoundTitle, description: L.medicineNotFoundDescription });
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
      paidAt: `${saleDate}T12:00:00`,
      paymentMethod: paymentLines[0]?.method ?? "cash",
      total: netSaleAmount,
      grossSale: total,
      agentCommission: agentCommissionAmount,
      transportCost: appliedTransportCost,
      netAmountDue: netSaleAmount,
      amountPaid,
      agentName: selectedPosSalesAgent?.name ?? null,
      netAmount: posVatBreakdown?.net,
      vatAmount: posVatBreakdown?.vat,
      lines: cart.map((i) => ({
        name: i.product.name,
        qty: i.quantity,
        unitPrice: i.unitPriceOverride != null && Number.isFinite(i.unitPriceOverride) ? i.unitPriceOverride : getUnitPrice(i.product, i.quantity),
        lineTotal: i.lineTotal,
      })),
    });
    setShowReceiptPreview(false);
    // Keep checkout non-blocking: receipt printing is manual after sale.
    clearCart();
    resetPayments();
    setScanCode("");
    setCreditDueDate(new Date().toISOString().slice(0, 10));
    setSaleDate(new Date().toISOString().slice(0, 10));
    setSelectedPosSalesAgentId("");
    setTransportCost(0);
  };

  const resolveCheckoutPhone = (shouldUseStkPush: boolean) => {
    let checkoutPhone = customerPhoneDraft.trim();
    if (!shouldUseStkPush) return checkoutPhone;
    const selected = customers.find((c) => c.id === selectedCustomerId);
    const detectedPhone = selected?.phone?.trim() || checkoutPhone;
    if (!detectedPhone) {
      const prompted = window.prompt("Enter mobile number")?.trim() || "";
      if (!prompted) {
        toast({ title: "Mobile number required", description: L.mobilePhoneHint });
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
    const missingReceiptAccount = paymentLines.find(
      (payment) => (payment.method === "bank_transfer" || payment.method === "wallet") && !payment.glAccountId
    );
    if (missingReceiptAccount) {
      toast({
        title: "Select receipt account",
        description: `Choose the ${missingReceiptAccount.method === "bank_transfer" ? "bank" : "wallet"} account receiving this payment.`,
      });
      return null;
    }
    if (!saleDate) {
      toast({ title: "Transaction date required", description: "Select the POS transaction date." });
      return null;
    }
    if (agentCommissionAmount + appliedTransportCost > total) {
      toast({ title: "Deductions exceed gross sale", description: "Reduce the commission or transport cost before checkout." });
      return null;
    }
    if (saleDate > new Date().toISOString().slice(0, 10)) {
      toast({ title: "Invalid transaction date", description: "POS transactions cannot be dated in the future." });
      return null;
    }
    const shouldUseStkPush = hasMobileTender && stkPushEnabled;
    const checkoutPhone = resolveCheckoutPhone(shouldUseStkPush);
    if (shouldUseStkPush && !checkoutPhone) return null;
    setProcessing(true);
    setPaymentFeedbackStatus(shouldUseStkPush ? "waiting" : "idle");
    setPaymentFeedbackMessage(shouldUseStkPush ? "Waiting for payment..." : "");
    return {
      saleId: randomUuid(),
      lines: buildOfflineLines(),
      tenders: paymentLines.map((p) => ({ id: p.id, method: p.method, amount: p.amount, status: p.status, glAccountId: p.glAccountId }) as CheckoutTender),
      saleCustomer: { id: selectedCustomerId || null, name: customerNameDraft.trim() || null, phone: customerPhoneDraft.trim() || null } as SaleCustomerContext,
      shouldUseStkPush,
      checkoutPhone: checkoutPhone || "",
      saleAt: `${saleDate}T12:00:00`,
    };
  };

  const handlePayments = async (ctx: ReturnType<typeof prepareCheckout>) => {
    if (!ctx) throw new Error("checkout_prepare_failed");
    return ctx.shouldUseStkPush
      ? collectMobileMoneyPayments({
          saleId: ctx.saleId,
          tenders: ctx.tenders,
          phone: ctx.checkoutPhone,
          customerName: customerNameDraft.trim() || L.defaultPayerName,
          customerEmail: user?.email ?? "no-reply@boat.local",
          organizationId: orgId ?? null,
          gatewayProvider: receiptOrgHeader?.mobileMoneyGateway ?? "flutterwave",
        })
      : ctx.tenders;
  };

  const clinicDispensingForCheckout = useMemo(() => {
    if (leftPanelMode !== "clinic_workspace") return null;
    const latestConsult = selectedClinicPatientId
      ? clinicConsultations
          .filter((c) => c.patientId === selectedClinicPatientId)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
      : null;
    const diagnosisBits = [
      latestConsult?.symptoms?.trim(),
      latestConsult?.diagnosis?.trim(),
      latestConsult?.notes?.trim(),
    ].filter(Boolean);
    return {
      clinicPatientId: selectedClinicPatientId,
      clinicDiagnosisSnapshot: diagnosisBits.length > 0 ? diagnosisBits.join(" · ") : null,
    };
  }, [leftPanelMode, selectedClinicPatientId, clinicConsultations]);

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
      clinicPos: leftPanelMode === "clinic_workspace",
      clinicDispensing: clinicDispensingForCheckout,
      saleAt: ctx.saleAt,
      agentCommission: agentCommissionContext,
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
      saleAt: ctx.saleAt,
    });
    refreshOfflineQueueCount();
    toast({ title: L.offlineDispensingQueuedTitle, description: L.offlineDispensingQueuedBody });
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
      toast({ title: L.saleCompletedToast });
      incrementActiveAccessTransactions();
      setPaymentFeedbackStatus(ctx.shouldUseStkPush ? "success" : "idle");
      setPaymentFeedbackMessage(ctx.shouldUseStkPush ? "Payment successful" : "");
      setRetryPendingTenders([]);
      didSucceed = true;
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "offline") {
        if (agentCommissionContext) {
          toast({ title: "Agent sale requires online access", description: "Reconnect before completing a sale with agent commission." });
        } else {
          handleOfflineFallback(ctx, saleCustomer);
          didSucceed = true;
        }
      } else if (ctx.shouldUseStkPush && error instanceof Error && error.message === "payment_timeout") {
        const cancelledPending = ctx.tenders.filter((p) => p.status === "pending").map((p) => ({ method: p.method, amount: p.amount }));
        setPaymentLines((prev) => prev.filter((p) => p.status !== "pending"));
        setRetryPendingTenders(cancelledPending);
        toast({ title: "Payment timeout", description: "Payment timed out after 60 seconds and was cancelled." });
        setPaymentFeedbackStatus("failed");
        setPaymentFeedbackMessage("Payment failed");
      } else {
        console.error(`${L.checkoutFailLogPrefix}:`, error);
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
      unitPrice: i.unitPriceOverride != null && Number.isFinite(i.unitPriceOverride) ? i.unitPriceOverride : getUnitPrice(i.product, i.quantity),
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
          clinicPos: leftPanelMode === "clinic_workspace",
          clinicDispensing: clinicDispensingForCheckout,
          saleAt: row.saleAt || row.createdAt,
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
    const paid = receipt.amountPaid;
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
      : `<h3 style="margin:0 0 6px 0">${L.receiptTitle}</h3>`;
    const html = `
      <html>
      <head>
        <title>${L.receiptTitle}</title>
        <style>
          body{font-family:Arial,sans-serif;padding:12px;max-width:320px;margin:0 auto;color:#0f172a}
          .row{display:flex;justify-content:space-between;gap:8px}
          .muted{color:#64748b;font-size:12px}
          .line{border-top:1px dashed #cbd5e1;margin:8px 0}
        </style>
      </head>
      <body>
        ${orgHeaderHtml}
        <div class="muted" style="text-align:center;margin-bottom:6px;">${L.receiptTitle}</div>
        <div class="muted">Sale ID: ${receipt.saleId}</div>
        <div class="muted">Paid at: ${new Date(receipt.paidAt).toLocaleString()}</div>
        <div class="line"></div>
        ${lineHtml}
        <div class="line"></div>
        ${receipt.agentName ? `<div class="muted">Agent / Bodaboda: ${receipt.agentName}</div>` : ""}
        <div class="row"><span>Gross Sale</span><strong>${receipt.grossSale.toFixed(2)}</strong></div>
        <div class="row"><span>Agent Commission</span><strong>-${receipt.agentCommission.toFixed(2)}</strong></div>
        <div class="row"><span>Transport Cost</span><strong>-${receipt.transportCost.toFixed(2)}</strong></div>
        <div class="row"><strong>Net Amount Due</strong><strong>${receipt.netAmountDue.toFixed(2)}</strong></div>
        <div class="row muted"><span>Method</span><span>${formatPaymentMethodLabel(receipt.paymentMethod)}</span></div>
        <div class="row muted"><span>Tendered</span><span>${paid.toFixed(2)}</span></div>
        <div class="row muted"><span>Change</span><span>${Math.max(0, paid - receipt.total).toFixed(2)}</span></div>
        ${
          customerNameDraft.trim()
            ? `<div class="line"></div><div class="muted">${L.receiptAttributionLabel}: ${customerNameDraft.trim()} ${
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
        <h1 className="text-2xl font-bold text-slate-900">
          {leftPanelMode === "clinic_workspace" ? L.dispensingWorkspaceHeading : L.posHeading}
        </h1>
        <button
          type="button"
          onClick={() => setCurrentPage("reports_retail_sales_insights")}
          className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
        >
          Open POS Analytics
        </button>
        <PageNotes ariaLabel={L.posHelpAria}>
          <p>{leftPanelMode === "clinic_workspace" ? L.dispensingWorkspaceBlurb : L.posHelpBlurb}</p>
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

      {user?.business_type === "manufacturing" ? (
        <div className="mb-2 grid shrink-0 gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 md:grid-cols-[minmax(220px,1fr)_auto_auto_auto_auto] md:items-end">
          <label className="text-xs font-semibold text-amber-950">Agent / Bodaboda
            <select value={selectedPosSalesAgentId} onChange={(event) => { setSelectedPosSalesAgentId(event.target.value); if (!event.target.value) setTransportCost(0); }} className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-normal text-slate-900">
              <option value="">No agent commission</option>
              {posSalesAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}{agentCommissionEnabled ? ` - ${agent.commission_per_unit.toLocaleString()} per bag` : ""}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => void addPosSalesAgent()} disabled={readOnly || useDesktopLocalMode} className="inline-flex items-center justify-center rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-900 disabled:opacity-50">+ Add agent</button>
          <button type="button" onClick={enterTransportCost} disabled={readOnly || !selectedPosSalesAgent} className="inline-flex items-center justify-center rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-900 disabled:opacity-50">Transport: {appliedTransportCost.toFixed(2)}</button>
          <div className="rounded-lg bg-white px-3 py-2 text-sm"><p className="text-xs text-slate-500">Gross sale</p><p className="font-bold text-slate-900">{total.toFixed(2)}</p></div>
          <div className="rounded-lg bg-white px-3 py-2 text-sm"><p className="text-xs text-slate-500">Commission + transport / Net due</p><p className="font-bold text-rose-700">-{(agentCommissionAmount + appliedTransportCost).toFixed(2)} <span className="text-slate-400">/</span> <span className="text-emerald-700">{netSaleAmount.toFixed(2)}</span></p></div>
        </div>
      ) : null}

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
          <label className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
            Transaction date
            <input
              type="date"
              value={saleDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(event) => setSaleDate(event.target.value)}
              className="rounded border border-slate-200 px-2 py-1 text-sm font-normal"
            />
          </label>
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
            {L.patientOrCustomerTab}
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
      <div
        className={
          leftPanelMode === "clinic_workspace"
            ? "flex-1 min-h-0 grid grid-cols-1 gap-3 overflow-hidden lg:grid-cols-[minmax(0,20%)_minmax(0,1fr)_minmax(0,25%)]"
            : "flex-1 min-h-0 grid grid-cols-1 gap-3 overflow-hidden lg:grid-cols-12"
        }
      >
        {leftPanelMode === "clinic_workspace" ? (
          <ClinicPosLeftPanel
            labels={L}
            patients={clinicPatients}
            patientsLoading={clinicRegistryLoading}
            patientQuery={patientRegistryQuery}
            setPatientQuery={setPatientRegistryQuery}
            selectedPatientId={selectedClinicPatientId}
            setSelectedPatientId={setSelectedClinicPatientId}
            consultations={clinicConsultations}
            consultationsLoading={clinicRegistryLoading}
            prescriptionQuery={prescriptionSearchQuery}
            setPrescriptionQuery={setPrescriptionSearchQuery}
            scanCode={scanCode}
            setScanCode={setScanCode}
            handleScan={handleScan}
            scanInputRef={scanInputRef}
            medicineSearch={productSearch}
            setMedicineSearch={setProductSearch}
            filteredMedicines={filteredManualProducts}
            addMedicineToCart={addToCart}
            getUnitPrice={getUnitPrice}
            quickPickMedicines={intelligentQuickPickProducts}
            cart={cart}
            updateQty={updateQty}
            setLineUnitPrice={setLineUnitPrice}
            hasMoreProducts={hasMoreProducts}
            catalogLoadingMore={catalogLoadingMore}
            onLoadMoreProducts={() => void loadMoreProducts()}
          />
        ) : (
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
            hasMoreProducts={hasMoreProducts}
            catalogLoadingMore={catalogLoadingMore}
            onLoadMoreProducts={() => void loadMoreProducts()}
            discountEnabled={discountEnabled || manufacturingPriceEditingEnabled}
            allowPriceIncrease={manufacturingPriceEditingEnabled}
            setLineUnitPrice={setLineUnitPrice}
          />
        )}
        <div className={leftPanelMode === "clinic_workspace" ? "min-h-0 h-full min-w-0" : "lg:col-span-3 min-h-0 h-full min-w-0"}>
        <CashierPaymentPanel
          total={netSaleAmount}
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
          receiptAccounts={receiptAccounts}
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
          posExperience={effectivePosExperience}
          panelTitle={L.paymentPanelTitle}
        />
        </div>
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
            <span>{L.managerVatHelp}</span>
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
          <h2 className="text-lg font-bold text-slate-900 mb-3">Discounts</h2>
          <label className="flex items-center gap-2 text-sm text-slate-800 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={discountEnabled}
              onChange={() => void toggleDiscountSetting()}
              disabled={savingDiscountSetting}
              className="h-4 w-4 rounded border-slate-300"
            />
            <span>Allow cashiers to enter discounted unit prices</span>
          </label>
          <p className="mt-2 text-xs text-slate-500">This organization-wide setting can only be changed by a manager.</p>
        </div>

        {user?.business_type === "manufacturing" && (
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h2 className="text-lg font-bold text-slate-900 mb-3">Agent Commission</h2>
            <label className="flex items-center gap-2 text-sm text-slate-800 cursor-pointer select-none">
              <input type="checkbox" checked={agentCommissionEnabled} onChange={() => void toggleAgentCommissionSetting()} disabled={savingCommissionSetting} className="h-4 w-4 rounded border-slate-300" />
              <span>Automatically calculate commission per bag</span>
            </label>
            <p className="mt-2 text-xs text-slate-500">This organization-wide setting can only be changed by a manager. Transport remains available when commission is off.</p>
          </div>
        )}

        {user?.business_type === "manufacturing" && (
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h2 className="text-lg font-bold text-slate-900 mb-3">Pricing Source</h2>
            <div className="space-y-2 text-sm text-slate-800">
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input
                  type="radio"
                  name="retail-pos-pricing-source"
                  checked={useManufacturingPriceList}
                  onChange={() => void setPricingSource(true)}
                  disabled={savingPricingSource}
                  className="mt-0.5 h-4 w-4 border-slate-300"
                />
                <span>
                  <span className="block font-medium">Use customer price lists</span>
                  <span className="block text-xs text-slate-500">Uses the matching customer and quantity tier, then falls back to the item price.</span>
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer select-none">
                <input
                  type="radio"
                  name="retail-pos-pricing-source"
                  checked={!useManufacturingPriceList}
                  onChange={() => void setPricingSource(false)}
                  disabled={savingPricingSource}
                  className="mt-0.5 h-4 w-4 border-slate-300"
                />
                <span>
                  <span className="block font-medium">Use item sales prices</span>
                  <span className="block text-xs text-slate-500">Ignores manufacturing customer price lists in POS.</span>
                </span>
              </label>
            </div>
            <p className="mt-2 text-xs text-slate-500">This organization-wide setting can only be changed by a manager.</p>
          </div>
        )}

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
              {receiptOrgHeader?.name?.trim() || L.receiptPreviewFallbackHeading}
            </h3>
            {receiptOrgHeader?.address ? (
              <p className="text-sm text-slate-600 whitespace-pre-line mt-1">{receiptOrgHeader.address}</p>
            ) : null}
            {receiptOrgHeader?.name ? (
              <p className="text-xs text-slate-500 uppercase tracking-wide mt-2">{L.receiptPreviewSubtitleWhenOrgNamed}</p>
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
              {receipt.agentName ? <div className="text-slate-600">Agent / Bodaboda: {receipt.agentName}</div> : null}
              <div className="flex justify-between">
                <span>Net</span>
                <span>{receipt.netAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>VAT</span>
                <span>{receipt.vatAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between"><span>Gross Sale</span><span>{receipt.grossSale.toFixed(2)}</span></div>
              <div className="flex justify-between text-rose-700"><span>Agent Commission</span><span>-{receipt.agentCommission.toFixed(2)}</span></div>
              <div className="flex justify-between text-rose-700"><span>Transport Cost</span><span>-{receipt.transportCost.toFixed(2)}</span></div>
              <div className="flex justify-between font-bold text-base"><span>Net Amount Due ({formatPaymentMethodLabel(receipt.paymentMethod)})</span><span>{receipt.netAmountDue.toFixed(2)}</span></div>
            </div>
          ) : (
            <div className="border-t border-slate-200 mt-3 space-y-1 pt-3">
              {receipt.agentName ? <div className="text-sm text-slate-600">Agent / Bodaboda: {receipt.agentName}</div> : null}
              <div className="flex justify-between text-sm"><span>Gross Sale</span><span>{receipt.grossSale.toFixed(2)}</span></div>
              <div className="flex justify-between text-sm text-rose-700"><span>Agent Commission</span><span>-{receipt.agentCommission.toFixed(2)}</span></div>
              <div className="flex justify-between text-sm text-rose-700"><span>Transport Cost</span><span>-{receipt.transportCost.toFixed(2)}</span></div>
              <div className="flex justify-between font-bold"><span>Net Amount Due ({formatPaymentMethodLabel(receipt.paymentMethod)})</span><span>{receipt.netAmountDue.toFixed(2)}</span></div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
