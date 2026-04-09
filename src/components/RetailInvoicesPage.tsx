import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Download,
  FileText,
  Plus,
  Trash2,
  Eye,
  Printer,
  FileDown,
  Loader2,
  Pencil,
} from "lucide-react";
import { jsPDF } from "jspdf";
import { supabase } from "../lib/supabase";
import { loadHotelConfig } from "../lib/hotelConfig";
import { filterByOrganizationId } from "../lib/supabaseOrgFilter";
import {
  buildInvoiceSettlementMap,
  invoiceBalanceDue,
  type InvoiceSettlementMap,
  type InvoiceSettlementPaymentLink,
} from "../lib/invoicePaymentAllocations";
import type { BusinessType } from "../contexts/AuthContext";
import { useAuth } from "../contexts/AuthContext";
import { ReadOnlyNotice } from "./common/ReadOnlyNotice";
import { PageNotes } from "./common/PageNotes";
import type { RetailCustomerRow } from "./RetailCustomersPage";

/** Typed client omits newer tables; use for retail_invoices / retail_invoice_lines until DB types are regenerated. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

function isMissingRetailInvoicesSchemaError(message: string | undefined | null): boolean {
  const m = (message || "").toLowerCase();
  return (
    m.includes("retail_invoices") ||
    m.includes("retail_invoice_lines") ||
    m.includes("retail_customers") ||
    m.includes("property_customer_id") ||
    m.includes("guest_id") ||
    m.includes("schema cache") ||
    m.includes("pgrst205") ||
    m.includes("could not find the table")
  );
}

/** Hotel / mixed / other: use `hotel_customers`; retail / restaurant use `retail_customers`. */
/** When true, invoice "customer" picker uses `hotel_customers`; otherwise `retail_customers`. */
function invoiceUsesPropertyCustomersTable(businessType: BusinessType | null | undefined): boolean {
  if (businessType === "retail" || businessType === "restaurant") return false;
  return true;
}

type GuestRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
};

function guestDisplayName(g: GuestRow): string {
  return `${g.first_name} ${g.last_name}`.trim() || "Guest";
}

type PaymentRow = {
  id: string;
  transaction_id: string | null;
  paid_at: string;
  amount: number;
  payment_method: "cash" | "card" | "bank_transfer" | "mtn_mobile_money" | "airtel_money";
  payment_status: "pending" | "completed" | "failed" | "refunded";
};

type CreditInvoiceRow = {
  saleId: string;
  invoicePaidAt: string | null;
  amountDue: number;
  paymentMethod: string;
  paymentIds: string[];
};

type InvoiceStatus = "draft" | "sent" | "paid" | "void";

type DbInvoiceLine = {
  id: string;
  invoice_id: string;
  line_no: number;
  description: string;
  product_id: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
  /** When false, line is excluded from VAT base (requires migration `vat_applies` column). */
  vat_applies?: boolean | null;
};

type DbInvoice = {
  id: string;
  organization_id: string;
  invoice_number: string;
  customer_id?: string | null;
  property_customer_id?: string | null;
  customer_name: string;
  customer_email: string | null;
  customer_address: string | null;
  issue_date: string;
  due_date: string | null;
  status: InvoiceStatus;
  notes: string | null;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  lines?: DbInvoiceLine[];
};

type LineDraft = {
  tempId: string;
  description: string;
  product_id: string;
  quantity: string;
  unit_price: string;
  /** Include this line in VAT (invoice tax %). */
  vat_on: boolean;
};

type ProductOption = { id: string; name: string; sales_price: number | null };

function parseSaleId(transactionId: string | null) {
  if (!transactionId) return null;
  const reasonTag = "[REFUND_REASON:";
  const rawRef = String(transactionId);
  const base = rawRef.includes(reasonTag) ? rawRef.slice(0, rawRef.indexOf(reasonTag)).trim() : rawRef.trim();
  return base || null;
}

function formatMoney(amount: number) {
  return Number.isFinite(amount)
    ? amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00";
}

function newLineDraft(): LineDraft {
  return {
    tempId: crypto.randomUUID(),
    description: "",
    product_id: "",
    quantity: "1",
    unit_price: "0",
    vat_on: true,
  };
}

/** PostgREST returns 400 for empty string or invalid values on uuid columns — use null. */
function uuidOrNull(value: string | null | undefined): string | null {
  if (value == null || typeof value !== "string") return null;
  const t = value.trim();
  if (!t) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return null;
  return t;
}

export function RetailInvoicesPage({
  readOnly = false,
  onNavigate,
  invoiceTab,
  highlightSaleId,
}: {
  readOnly?: boolean;
  /** Navigate to another app page (e.g. Sales → Customers). */
  onNavigate?: (page: string, state?: Record<string, unknown>) => void;
  /** Deep-link from Credit Sales Report etc. */
  invoiceTab?: "invoices" | "credit";
  highlightSaleId?: string;
}) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const businessType = user?.business_type ?? null;
  const invoiceGuestMode = invoiceUsesPropertyCustomersTable(businessType);

  const [tab, setTab] = useState<"invoices" | "credit">("invoices");
  const [listLoading, setListLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [dbInvoices, setDbInvoices] = useState<DbInvoice[]>([]);
  /** Completed incoming payments allocated to invoices (from `payments.invoice_allocations`). */
  const [invoiceSettlement, setInvoiceSettlement] = useState<InvoiceSettlementMap>({});

  const [creditLoading, setCreditLoading] = useState(false);
  const [creditInvoices, setCreditInvoices] = useState<CreditInvoiceRow[]>([]);
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);

  const [products, setProducts] = useState<ProductOption[]>([]);
  const [customers, setCustomers] = useState<RetailCustomerRow[]>([]);
  const [propertyCustomersList, setPropertyCustomersList] = useState<GuestRow[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedPropertyCustomerId, setSelectedPropertyCustomerId] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<InvoiceStatus>("draft");
  const [notes, setNotes] = useState("");
  const [taxRate, setTaxRate] = useState("0");
  const [lines, setLines] = useState<LineDraft[]>([newLineDraft()]);

  const [previewInvoice, setPreviewInvoice] = useState<DbInvoice | null>(null);
  const [previewLines, setPreviewLines] = useState<DbInvoiceLine[]>([]);
  /** Authoritative org name from DB; local `hotel_name` in config is fallback for address lines only. */
  const [organizationName, setOrganizationName] = useState<string | null>(null);

  const loadProducts = useCallback(async () => {
    if (!orgId) return;
    const { data } = await supabase
      .from("products")
      .select("id, name, sales_price")
      .eq("active", true)
      .order("name");
    setProducts((data || []) as ProductOption[]);
  }, [orgId]);

  const loadCustomers = useCallback(async () => {
    if (!orgId) return;
    const { data, error } = await sb
      .from("retail_customers")
      .select("id, organization_id, name, email, phone, address, notes, created_at, updated_at")
      .eq("organization_id", orgId)
      .order("name");
    if (!error && data) setCustomers(data as RetailCustomerRow[]);
  }, [orgId]);

  const loadPropertyCustomers = useCallback(async () => {
    if (!orgId) return;
    const q = filterByOrganizationId(
      supabase.from("hotel_customers").select("id, first_name, last_name, email, phone, address").order("first_name"),
      orgId,
      !!user?.isSuperAdmin
    );
    const { data, error } = await q;
    if (!error && data) setPropertyCustomersList(data as GuestRow[]);
  }, [orgId, user?.isSuperAdmin]);

  const loadDbInvoices = useCallback(async () => {
    if (!orgId) {
      setDbInvoices([]);
      setInvoiceSettlement({});
      setListLoading(false);
      return;
    }
    setListLoading(true);
    setError(null);
    setNeedsMigration(false);
    const { data: invs, error: e1 } = await sb
      .from("retail_invoices")
      .select("*")
      .eq("organization_id", orgId)
      .order("issue_date", { ascending: false });

    if (e1) {
      if (isMissingRetailInvoicesSchemaError(e1.message)) {
        setNeedsMigration(true);
        setError(null);
      } else {
        setError(e1.message);
      }
      setDbInvoices([]);
      setInvoiceSettlement({});
      setListLoading(false);
      return;
    }

    const list = (invs || []) as DbInvoice[];
    const ids = list.map((i) => i.id);
    if (ids.length === 0) {
      setDbInvoices([]);
      setInvoiceSettlement({});
      setListLoading(false);
      return;
    }

    const { data: linesData, error: e2 } = await sb
      .from("retail_invoice_lines")
      .select("*")
      .in("invoice_id", ids)
      .order("line_no", { ascending: true });

    if (e2) {
      if (isMissingRetailInvoicesSchemaError(e2.message)) {
        setNeedsMigration(true);
        setError(null);
      } else {
        setError(e2.message);
      }
      setDbInvoices([]);
      setInvoiceSettlement({});
      setListLoading(false);
      return;
    }

    const byInv = new Map<string, DbInvoiceLine[]>();
    for (const l of (linesData || []) as DbInvoiceLine[]) {
      const arr = byInv.get(l.invoice_id) || [];
      arr.push(l);
      byInv.set(l.invoice_id, arr);
    }

    setDbInvoices(
      list.map((inv) => ({
        ...inv,
        lines: byInv.get(inv.id) || [],
      }))
    );

    const payQ = filterByOrganizationId(
      supabase.from("payments").select("id, paid_at, payment_status, invoice_allocations").order("paid_at", { ascending: false }),
      orgId ?? undefined,
      !!user?.isSuperAdmin
    );
    const { data: payData, error: payErr } = await payQ;
    if (payErr) {
      console.warn("[RetailInvoices] payments for settlement:", payErr.message);
      setInvoiceSettlement({});
    } else {
      setInvoiceSettlement(buildInvoiceSettlementMap(payData || []));
    }

    setListLoading(false);
  }, [orgId, user?.isSuperAdmin]);

  const loadCreditInvoices = useCallback(async () => {
    if (!orgId) {
      setCreditInvoices([]);
      setCreditLoading(false);
      return;
    }
    setCreditLoading(true);
    const { data, error } = await supabase
      .from("payments")
      .select("id, transaction_id, paid_at, amount, payment_method, payment_status")
      .eq("organization_id", orgId)
      .is("stay_id", null)
      .eq("payment_status", "pending")
      .order("paid_at", { ascending: false });

    if (error) {
      setCreditInvoices([]);
      setCreditLoading(false);
      return;
    }

    const rows = ((data || []) as PaymentRow[])
      .map((p) => {
        const saleId = parseSaleId(p.transaction_id);
        if (!saleId) return null;
        return { ...p, saleId };
      })
      .filter(Boolean) as Array<PaymentRow & { saleId: string }>;

    const map = new Map<string, CreditInvoiceRow>();
    for (const p of rows) {
      const existing = map.get(p.saleId);
      if (!existing) {
        map.set(p.saleId, {
          saleId: p.saleId,
          invoicePaidAt: p.paid_at ?? null,
          amountDue: Number(p.amount ?? 0),
          paymentMethod: p.payment_method,
          paymentIds: [p.id],
        });
      } else {
        existing.amountDue += Number(p.amount ?? 0);
        existing.paymentIds.push(p.id);
        if (p.paid_at && (!existing.invoicePaidAt || p.paid_at > existing.invoicePaidAt)) {
          existing.invoicePaidAt = p.paid_at;
        }
      }
    }

    setCreditInvoices(Array.from(map.values()).sort((a, b) => (b.invoicePaidAt || "").localeCompare(a.invoicePaidAt || "")));
    setCreditLoading(false);
  }, [orgId]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    if (invoiceGuestMode) void loadPropertyCustomers();
    else void loadCustomers();
  }, [invoiceGuestMode, loadPropertyCustomers, loadCustomers]);

  useEffect(() => {
    if (showModal && orgId) {
      if (invoiceGuestMode) void loadPropertyCustomers();
      else void loadCustomers();
    }
  }, [showModal, orgId, invoiceGuestMode, loadPropertyCustomers, loadCustomers]);

  useEffect(() => {
    loadDbInvoices();
  }, [loadDbInvoices]);

  useEffect(() => {
    if (tab === "credit") loadCreditInvoices();
  }, [tab, loadCreditInvoices]);

  useEffect(() => {
    if (highlightSaleId) {
      setTab("credit");
      setExpandedSaleId(highlightSaleId);
      return;
    }
    if (invoiceTab === "credit" || invoiceTab === "invoices") setTab(invoiceTab);
  }, [invoiceTab, highlightSaleId]);

  useEffect(() => {
    let cancelled = false;
    async function loadOrgName() {
      if (!orgId) {
        setOrganizationName(null);
        return;
      }
      const { data } = await supabase.from("organizations").select("name").eq("id", orgId).maybeSingle();
      if (!cancelled) setOrganizationName((data as { name?: string } | null)?.name ?? null);
    }
    void loadOrgName();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const suggestInvoiceNumber = async () => {
    if (!orgId) return `INV-${Date.now()}`;
    const prefix = `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
    const { count, error } = await sb
      .from("retail_invoices")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .ilike("invoice_number", `${prefix}%`);
    if (error) {
      if (isMissingRetailInvoicesSchemaError(error.message)) {
        return `${prefix}-0001`;
      }
      console.warn("[RetailInvoices] suggestInvoiceNumber count query failed:", error.message);
      // Avoid blocking new invoice if count/head/ilike returns 400 on some deployments
      return `${prefix}-${String(Date.now()).slice(-8)}`;
    }
    return `${prefix}-${String((count ?? 0) + 1).padStart(4, "0")}`;
  };

  const openNew = async () => {
    if (needsMigration) {
      alert("Run the database migration first — see the notice on this page, then click Retry.");
      return;
    }
    if (!orgId) {
      alert("No organization linked to your account.");
      return;
    }
    setEditingId(null);
    setInvoiceNumber(await suggestInvoiceNumber());
    setSelectedCustomerId("");
    setSelectedPropertyCustomerId("");
    setCustomerName("");
    setCustomerEmail("");
    setCustomerAddress("");
    setIssueDate(new Date().toISOString().slice(0, 10));
    setDueDate("");
    setStatus("draft");
    setNotes("");
    setTaxRate("0");
    setLines([newLineDraft()]);
    setShowModal(true);
  };

  const openEdit = (inv: DbInvoice) => {
    setEditingId(inv.id);
    setInvoiceNumber(inv.invoice_number);
    setSelectedCustomerId(inv.customer_id || "");
    setSelectedPropertyCustomerId(inv.property_customer_id || "");
    setCustomerName(inv.customer_name);
    setCustomerEmail(inv.customer_email || "");
    setCustomerAddress(inv.customer_address || "");
    setIssueDate(inv.issue_date?.slice(0, 10) || new Date().toISOString().slice(0, 10));
    setDueDate(inv.due_date?.slice(0, 10) || "");
    setStatus(inv.status);
    setNotes(inv.notes || "");
    setTaxRate(String(inv.tax_rate ?? 0));
    const L = inv.lines || [];
    setLines(
      L.length
        ? L.map((l) => ({
            tempId: l.id,
            description: l.description,
            product_id: l.product_id || "",
            quantity: String(l.quantity),
            unit_price: String(l.unit_price),
            vat_on: l.vat_applies !== false,
          }))
        : [newLineDraft()]
    );
    setShowModal(true);
  };

  const computed = useMemo(() => {
    let subtotal = 0;
    let vatBase = 0;
    for (const ln of lines) {
      const q = Number(ln.quantity) || 0;
      const u = Number(ln.unit_price) || 0;
      const lineNet = q * u;
      subtotal += lineNet;
      if (ln.vat_on) vatBase += lineNet;
    }
    const tr = Number(taxRate) || 0;
    const taxAmount = vatBase * (tr / 100);
    const total = subtotal + taxAmount;
    return { subtotal, taxAmount, total };
  }, [lines, taxRate]);

  const applyProduct = (tempId: string, productId: string) => {
    const p = products.find((x) => x.id === productId);
    setLines((prev) =>
      prev.map((ln) =>
        ln.tempId === tempId
          ? {
              ...ln,
              product_id: productId,
              description: p?.name || ln.description,
              unit_price: p != null && p.sales_price != null ? String(p.sales_price) : ln.unit_price,
            }
          : ln
      )
    );
  };

  const saveInvoice = async () => {
    if (!orgId || readOnly) return;
    const trimmedLines = lines.filter((l) => l.description.trim() || Number(l.quantity) > 0 || Number(l.unit_price) > 0);
    if (trimmedLines.length === 0) {
      alert("Add at least one line item.");
      return;
    }
    if (!invoiceNumber.trim()) {
      alert("Invoice number is required.");
      return;
    }

    setSaving(true);
    try {
      const { subtotal, taxAmount, total } = computed;
      const existingInv = editingId ? dbInvoices.find((i) => i.id === editingId) : undefined;

      let createdByStaffId: string | null = null;
      if (user?.id) {
        const { data: staffRow } = await supabase.from("staff").select("id").eq("id", user.id).maybeSingle();
        if (staffRow?.id) createdByStaffId = staffRow.id;
      }

      const customerIdResolved = invoiceGuestMode
        ? uuidOrNull(selectedPropertyCustomerId)
          ? null
          : uuidOrNull((existingInv?.customer_id as string | null | undefined) ?? null)
        : uuidOrNull(selectedCustomerId);
      const propertyCustomerIdResolved = invoiceGuestMode ? uuidOrNull(selectedPropertyCustomerId) : null;

      const common = {
        invoice_number: invoiceNumber.trim(),
        customer_id: customerIdResolved,
        property_customer_id: propertyCustomerIdResolved,
        customer_name: customerName.trim(),
        customer_email: customerEmail.trim() || null,
        customer_address: customerAddress.trim() || null,
        issue_date: issueDate,
        due_date: dueDate || null,
        status,
        notes: notes.trim() || null,
        subtotal,
        tax_rate: Number(taxRate) || 0,
        tax_amount: taxAmount,
        total,
      };

      if (editingId) {
        const { error: uErr } = await sb.from("retail_invoices").update(common).eq("id", editingId);
        if (uErr) throw uErr;
        const { error: dErr } = await sb.from("retail_invoice_lines").delete().eq("invoice_id", editingId);
        if (dErr) throw dErr;

        const lineRows = trimmedLines.map((l, i) => ({
          invoice_id: editingId,
          line_no: i + 1,
          description: l.description.trim() || "Item",
          product_id: uuidOrNull(l.product_id),
          quantity: Number(l.quantity) || 1,
          unit_price: Number(l.unit_price) || 0,
          line_total: (Number(l.quantity) || 0) * (Number(l.unit_price) || 0),
          vat_applies: l.vat_on,
        }));
        const { error: iErr } = await sb.from("retail_invoice_lines").insert(lineRows);
        if (iErr) throw iErr;
      } else {
        const { data: ins, error: insErr } = await sb
          .from("retail_invoices")
          .insert({
            ...common,
            organization_id: orgId,
            created_by: createdByStaffId,
          })
          .select("id")
          .single();
        if (insErr) throw insErr;
        const newId = (ins as { id: string }).id;
        const lineRows = trimmedLines.map((l, i) => ({
          invoice_id: newId,
          line_no: i + 1,
          description: l.description.trim() || "Item",
          product_id: uuidOrNull(l.product_id),
          quantity: Number(l.quantity) || 1,
          unit_price: Number(l.unit_price) || 0,
          line_total: (Number(l.quantity) || 0) * (Number(l.unit_price) || 0),
          vat_applies: l.vat_on,
        }));
        const { error: iErr } = await sb.from("retail_invoice_lines").insert(lineRows);
        if (iErr) throw iErr;
      }

      setShowModal(false);
      await loadDbInvoices();
    } catch (e: unknown) {
      const pe = e as { message?: string; details?: string; hint?: string; code?: string };
      const msg = [pe.message, pe.details, pe.hint].filter(Boolean).join(" — ") || (e instanceof Error ? e.message : String(e));
      if (isMissingRetailInvoicesSchemaError(msg)) {
        setNeedsMigration(true);
        alert("The invoices tables are missing on the server. Run the SQL migration in Supabase (see the notice on this page), then try again.");
      } else {
        console.error("Save invoice error:", e);
        alert(msg || "Failed to save invoice.");
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteInvoice = async (id: string) => {
    if (readOnly) return;
    if (!confirm("Delete this invoice?")) return;
    const { error } = await sb.from("retail_invoices").delete().eq("id", id);
    if (error) {
      alert(error.message);
      return;
    }
    await loadDbInvoices();
  };

  const openPreview = (inv: DbInvoice) => {
    setPreviewInvoice(inv);
    setPreviewLines(inv.lines || []);
  };

  const commitTab = (t: "invoices" | "credit") => {
    setTab(t);
    if (!onNavigate) return;
    if (t === "credit") {
      onNavigate("retail_credit_invoices", {
        invoiceTab: "credit",
        ...(highlightSaleId ? { highlightSaleId } : {}),
      });
    } else {
      onNavigate("retail_credit_invoices", { invoiceTab: "invoices" });
    }
  };

  const buildPdf = (
    inv: DbInvoice,
    invLines: DbInvoiceLine[],
    settlement?: { paid: number; payments: InvoiceSettlementPaymentLink[] }
  ) => {
    const cfg = loadHotelConfig(user?.organization_id ?? null);
    const displayName = (organizationName?.trim() || cfg.hotel_name || "Business").trim();
    const doc = new jsPDF();
    const margin = 14;
    const pageW = doc.internal.pageSize.getWidth();
    const contentW = pageW - margin * 2;
    let y = margin;

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(15, 118, 110);
    doc.text("INVOICE", margin, y);
    doc.setFontSize(11);
    doc.setTextColor(30, 41, 59);
    doc.text(`# ${inv.invoice_number}`, pageW - margin, y, { align: "right" });
    y += 8;

    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    doc.text(displayName, margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    if (cfg.address) {
      const addrLines = doc.splitTextToSize(cfg.address, contentW * 0.55);
      doc.text(addrLines, margin, y);
      y += addrLines.length * 4.5;
    }
    if (cfg.phone) {
      doc.text(cfg.phone, margin, y);
      y += 5;
    }
    if (cfg.email) {
      doc.text(cfg.email, margin, y);
      y += 5;
    }

    const metaX = pageW - margin;
    let metaY = margin + 8;
    doc.setFontSize(9);
    doc.text(`Issue: ${inv.issue_date}`, metaX, metaY, { align: "right" });
    metaY += 5;
    if (inv.due_date) {
      doc.text(`Due: ${inv.due_date}`, metaX, metaY, { align: "right" });
      metaY += 5;
    }
    doc.text(`Status: ${inv.status}`, metaX, metaY, { align: "right" });
    y = Math.max(y, metaY + 4);

    doc.line(margin, y, pageW - margin, y);
    y += 8;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text("BILL TO", margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(30, 41, 59);
    doc.text(inv.customer_name || "—", margin, y);
    y += 5;
    if (inv.customer_email) {
      doc.text(inv.customer_email, margin, y);
      y += 5;
    }
    if (inv.customer_address) {
      const parts = doc.splitTextToSize(inv.customer_address, contentW);
      doc.text(parts, margin, y);
      y += parts.length * 5;
    }

    y += 8;
    const tableLeft = margin;
    const colQty = pageW - margin - 52;
    const colPrice = pageW - margin - 34;
    const colTot = pageW - margin - 2;

    doc.setFillColor(241, 245, 249);
    doc.rect(tableLeft, y - 4, contentW, 8, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text("Description", tableLeft + 2, y);
    doc.text("Qty", colQty, y, { align: "right" });
    doc.text("Price", colPrice, y, { align: "right" });
    doc.text("Total", colTot, y, { align: "right" });
    y += 6;
    doc.line(tableLeft, y - 1, tableLeft + contentW, y - 1);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(30, 41, 59);
    const rowH = 6;
    for (const ln of invLines) {
      if (y > 265) {
        doc.addPage();
        y = margin;
      }
      const desc = doc.splitTextToSize(ln.description || "—", colQty - tableLeft - 8);
      const h = Math.max(rowH, desc.length * 4.5);
      doc.text(desc, tableLeft + 2, y);
      doc.text(String(ln.quantity), colQty, y, { align: "right" });
      doc.text(formatMoney(ln.unit_price), colPrice, y, { align: "right" });
      doc.text(formatMoney(ln.line_total), colTot, y, { align: "right" });
      y += h;
      doc.setDrawColor(241, 245, 249);
      doc.line(tableLeft, y, tableLeft + contentW, y);
    }

    y += 6;
    doc.setFontSize(9);
    const labelR = colTot - 42;
    doc.text("Total", labelR, y, { align: "right" });
    doc.text(formatMoney(inv.subtotal), colTot, y, { align: "right" });
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`VAT (${inv.tax_rate}%)`, labelR, y, { align: "right" });
    doc.text(formatMoney(inv.tax_amount), colTot, y, { align: "right" });
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(`Grand total (${cfg.currency || "USD"})`, labelR, y, { align: "right" });
    doc.text(formatMoney(inv.total), colTot, y, { align: "right" });
    y += 8;
    const paidPdf = settlement?.paid ?? 0;
    const balancePdf = Math.max(0, Math.round((Number(inv.total) - paidPdf) * 100) / 100);
    if (paidPdf > 0.001) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text("Amount paid", labelR, y, { align: "right" });
      doc.text(formatMoney(paidPdf), colTot, y, { align: "right" });
      y += 5;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.text("Balance outstanding", labelR, y, { align: "right" });
      doc.text(formatMoney(balancePdf), colTot, y, { align: "right" });
      y += 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      if (settlement?.payments?.length) {
        const line = settlement.payments
          .map((p) => `${formatMoney(p.amount)} · ${new Date(p.paid_at).toLocaleDateString()} · ref ${p.id.slice(0, 8)}…`)
          .join("   ");
        const parts = doc.splitTextToSize(`Payments: ${line}`, contentW);
        doc.text(parts, margin, y);
        y += parts.length * 4 + 2;
      }
      doc.setTextColor(30, 41, 59);
    } else {
      y += 2;
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    if (inv.notes) {
      doc.setTextColor(100, 116, 139);
      doc.text("Notes", margin, y);
      y += 5;
      doc.setTextColor(30, 41, 59);
      const noteLines = doc.splitTextToSize(inv.notes, contentW);
      doc.text(noteLines, margin, y);
    }

    doc.save(`invoice-${inv.invoice_number}.pdf`);
  };

  const printPreview = () => {
    window.print();
  };

  const downloadCsvCredit = () => {
    const header = ["Invoice", "Paid At", "Amount Due", "Payment Method", "Payment Count"].join(",");
    const linesCsv = creditInvoices.map((i) =>
      [i.saleId, i.invoicePaidAt ? new Date(i.invoicePaidAt).toISOString() : "", i.amountDue, i.paymentMethod, i.paymentIds.length]
        .map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [header, ...linesCsv].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `outstanding_pos_credit_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadCsvInvoices = () => {
    const header = ["Invoice #", "Customer", "Issue date", "Status", "Total", "Paid", "Balance outstanding"].join(",");
    const rows = dbInvoices.map((i) => {
      const paid = invoiceSettlement[i.id]?.paid ?? 0;
      const bal = invoiceBalanceDue(i, invoiceSettlement);
      return [i.invoice_number, i.customer_name, i.issue_date, i.status, i.total, paid, bal]
        .map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`)
        .join(",");
    });
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoices_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const config = loadHotelConfig(user?.organization_id ?? null);
  const businessDisplayName = (organizationName?.trim() || config.hotel_name || "Business").trim();

  if (!orgId) {
    return (
      <div className="p-6 md:p-8">
        <p className="text-slate-600">Link your staff account to an organization to use invoices.</p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 space-y-6">
      <style>{`
        @media print {
          @page {
            margin: 12mm;
            size: auto;
          }
          html,
          body {
            height: auto !important;
            overflow: visible !important;
          }
          /* Hide chrome; keep invoice subtree visible (fixed positioning escapes modal clipping). */
          body * {
            visibility: hidden !important;
          }
          #invoice-print-root,
          #invoice-print-root * {
            visibility: visible !important;
          }
          #invoice-print-root {
            position: fixed !important;
            inset: 0 !important;
            z-index: 2147483647 !important;
            width: 100% !important;
            max-width: none !important;
            min-height: 100vh !important;
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
            box-shadow: none !important;
            border: none !important;
            border-radius: 0 !important;
            color: #0f172a !important;
            font-size: 10pt !important;
            line-height: 1.45 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          #invoice-print-root .invoice-print-inner {
            max-width: 190mm;
            margin: 0 auto;
            padding: 0 2mm 8mm;
            box-sizing: border-box;
          }
          #invoice-print-root .invoice-print-table-wrap {
            overflow: visible !important;
            max-width: none !important;
          }
          #invoice-print-root table {
            table-layout: fixed !important;
            width: 100% !important;
            border-collapse: collapse !important;
          }
          #invoice-print-root thead {
            display: table-header-group !important;
          }
          #invoice-print-root tbody tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }
          #invoice-print-root th:first-child,
          #invoice-print-root td:first-child {
            width: 48%;
            min-width: 0 !important;
            word-wrap: break-word;
            overflow-wrap: anywhere;
            hyphens: auto;
          }
          #invoice-print-root th:nth-child(2),
          #invoice-print-root td:nth-child(2) {
            width: 12%;
          }
          #invoice-print-root th:nth-child(3),
          #invoice-print-root td:nth-child(3),
          #invoice-print-root th:nth-child(4),
          #invoice-print-root td:nth-child(4) {
            width: 20%;
          }
        }
      `}</style>

      {readOnly && <ReadOnlyNotice />}

      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">Invoices</h1>
            <PageNotes ariaLabel="Invoices help">
              <p>Create multi-line invoices, preview, print, or download PDF.</p>
            </PageNotes>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => commitTab("invoices")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              tab === "invoices" ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            Sales invoices
          </button>
          <button
            type="button"
            onClick={() => commitTab("credit")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              tab === "credit" ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            Outstanding POS credit
          </button>
        </div>
      </div>

      {error ? <p className="text-red-600 text-sm">{error}</p> : null}

      {needsMigration ? (
        <div className="app-alert-warning space-y-3">
          <p className="font-semibold text-amber-950">Database migration required</p>
          <p className="text-sm">
            Supabase cannot find <code className="rounded bg-amber-100/80 px-1 text-xs">public.retail_invoices</code> — the
            migration has not been applied to this project (or the API schema cache has not refreshed yet).
          </p>
          <ol className="list-decimal list-inside text-sm space-y-1 text-amber-950/90">
            <li>
              In the Supabase Dashboard, open <strong>SQL Editor</strong> for this project.
            </li>
            <li>
              Paste and run the <strong>entire</strong> script from{" "}
              <code className="rounded bg-amber-100/80 px-1 text-xs break-all">
                supabase/manual/apply_retail_invoices_complete.sql
              </code>{" "}
              in your BOAT repo (creates invoices, lines, retail customers, guest link, RLS, and reloads the API schema).
              Alternatively run the three migrations in order:{" "}
              <code className="rounded bg-amber-100/80 px-1 text-xs">20260326000000_retail_invoices.sql</code>,{" "}
              <code className="rounded bg-amber-100/80 px-1 text-xs">20260327000000_retail_customers.sql</code>,{" "}
              <code className="rounded bg-amber-100/80 px-1 text-xs">20260329000000_retail_invoices_guest_id.sql</code>,{" "}
              <code className="rounded bg-amber-100/80 px-1 text-xs">20260401000000_rename_guest_id_to_property_customer_id.sql</code>.
            </li>
            <li>Wait ~10–30 seconds, then click <strong>Retry</strong> or reload the app.</li>
          </ol>
          <button type="button" className="app-btn-secondary text-sm" onClick={() => void loadDbInvoices()}>
            Retry loading invoices
          </button>
        </div>
      ) : null}

      {tab === "invoices" && (
        <>
          {listLoading ? (
            <p className="text-slate-500 text-sm">Loading invoices…</p>
          ) : null}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex flex-wrap gap-3">
              <div className="app-card px-4 py-3">
                <p className="text-xs text-slate-500">Invoices</p>
                <p className="text-2xl font-bold text-slate-900">{dbInvoices.length}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={downloadCsvInvoices}
                className="app-btn-secondary text-sm"
                disabled={dbInvoices.length === 0}
              >
                <Download className="w-4 h-4" />
                Export CSV
              </button>
              <button
                type="button"
                onClick={openNew}
                disabled={readOnly || needsMigration}
                className="app-btn-primary text-sm"
                title={needsMigration ? "Run the SQL migration in Supabase first" : undefined}
              >
                <Plus className="w-4 h-4" />
                New invoice
              </button>
            </div>
          </div>

          <div className="app-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left p-3">Invoice #</th>
                  <th className="text-left p-3">Customer</th>
                  <th className="text-left p-3">Issue</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-right p-3">Total</th>
                  <th className="text-right p-3">Paid</th>
                  <th className="text-right p-3">Balance</th>
                  <th className="text-left p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {needsMigration ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-amber-900 text-sm">
                      Sales invoices will appear here after you run the migration (see the notice above).
                    </td>
                  </tr>
                ) : dbInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-500">
                      No invoices yet. Click &quot;New invoice&quot; to add one with multiple lines.
                    </td>
                  </tr>
                ) : (
                  dbInvoices.map((inv) => {
                    const paid = invoiceSettlement[inv.id]?.paid ?? 0;
                    const balance = invoiceBalanceDue(inv, invoiceSettlement);
                    return (
                    <tr key={inv.id} className="border-t border-slate-100">
                      <td className="p-3 font-mono text-xs font-medium">{inv.invoice_number}</td>
                      <td className="p-3 max-w-[220px]">
                        {inv.property_customer_id && onNavigate ? (
                          <button
                            type="button"
                            className="text-left text-brand-700 hover:underline font-medium truncate w-full"
                            onClick={() => onNavigate("hotel_customers", { highlightCustomerId: inv.property_customer_id })}
                            title="Open customer"
                          >
                            {inv.customer_name || "—"}
                          </button>
                        ) : inv.customer_id && onNavigate ? (
                          <button
                            type="button"
                            className="text-left text-brand-700 hover:underline font-medium truncate w-full"
                            onClick={() =>
                              onNavigate("retail_customers", { highlightCustomerId: inv.customer_id })
                            }
                            title="Open customer"
                          >
                            {inv.customer_name || "—"}
                          </button>
                        ) : (
                          <span className="text-slate-900">{inv.customer_name || "—"}</span>
                        )}
                      </td>
                      <td className="p-3">{inv.issue_date}</td>
                      <td className="p-3 capitalize">{inv.status}</td>
                      <td className="p-3 text-right">
                        <button
                          type="button"
                          className="font-semibold text-brand-700 hover:underline tabular-nums"
                          onClick={() => openPreview(inv)}
                          title="Open invoice preview"
                        >
                          {formatMoney(inv.total)}
                        </button>
                      </td>
                      <td className="p-3 text-right tabular-nums text-slate-700">{formatMoney(paid)}</td>
                      <td className="p-3 text-right tabular-nums font-semibold text-slate-900">{formatMoney(balance)}</td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            className="px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-xs inline-flex items-center gap-1"
                            onClick={() => openPreview(inv)}
                          >
                            <Eye className="w-3.5 h-3.5" />
                            Preview
                          </button>
                          <button
                            type="button"
                            className="px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-xs inline-flex items-center gap-1"
                            onClick={() => buildPdf(inv, inv.lines || [], invoiceSettlement[inv.id])}
                          >
                            <FileDown className="w-3.5 h-3.5" />
                            PDF
                          </button>
                          <button
                            type="button"
                            disabled={readOnly}
                            className="px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-xs inline-flex items-center gap-1 disabled:opacity-50"
                            onClick={() => openEdit(inv)}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={readOnly}
                            className="px-2 py-1 rounded-md text-red-700 bg-red-50 hover:bg-red-100 text-xs inline-flex items-center gap-1 disabled:opacity-50"
                            onClick={() => deleteInvoice(inv.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "credit" && (
        <>
          {creditLoading ? (
            <p className="text-slate-500">Loading…</p>
          ) : (
            <>
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <PageNotes ariaLabel="Outstanding POS credit help">
                  <p>
                    These rows come from Retail POS sales on account (pending payments). They are separate from manual invoices above.
                  </p>
                </PageNotes>
                <button
                  type="button"
                  onClick={downloadCsvCredit}
                  className="app-btn-secondary text-sm self-start"
                  disabled={creditInvoices.length === 0}
                >
                  <Download className="w-4 h-4" />
                  Export CSV
                </button>
              </div>
              <div className="app-card overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left p-3">Sale ref</th>
                      <th className="text-left p-3">Recorded</th>
                      <th className="text-right p-3">Amount due</th>
                      <th className="text-left p-3">Method</th>
                      <th className="text-left p-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {creditInvoices.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-8 text-center text-slate-500">
                          No outstanding POS credit sales.
                        </td>
                      </tr>
                    ) : (
                      creditInvoices.map((inv) => {
                        const isExpanded = expandedSaleId === inv.saleId;
                        return (
                          <tr
                            key={inv.saleId}
                            className={`border-t ${isExpanded ? "bg-brand-50/60" : ""}`}
                          >
                            <td className="p-3 font-mono text-xs">
                              <div className="flex items-center gap-2">
                                <FileText className="w-4 h-4 text-slate-600" />
                                <span className="truncate">{inv.saleId.slice(0, 12)}</span>
                              </div>
                            </td>
                            <td className="p-3">{inv.invoicePaidAt ? new Date(inv.invoicePaidAt).toLocaleString() : "—"}</td>
                            <td className="p-3 text-right">
                              <button
                                type="button"
                                className="font-semibold text-brand-700 hover:underline tabular-nums"
                                onClick={() => setExpandedSaleId(isExpanded ? null : inv.saleId)}
                                title="Show sale details"
                              >
                                {formatMoney(inv.amountDue)}
                              </button>
                            </td>
                            <td className="p-3 capitalize">{inv.paymentMethod}</td>
                            <td className="p-3">
                              <button
                                type="button"
                                className="px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs"
                                onClick={() => setExpandedSaleId(isExpanded ? null : inv.saleId)}
                              >
                                {isExpanded ? "Hide" : "View"}
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-bold text-slate-900">{editingId ? "Edit invoice" : "New invoice"}</h2>
              <button type="button" className="text-slate-500 hover:text-slate-800" onClick={() => setShowModal(false)}>
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block text-sm">
                <span className="text-slate-600">Invoice #</span>
                <input
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  disabled={readOnly}
                />
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">Status</span>
                <select
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as InvoiceStatus)}
                  disabled={readOnly}
                >
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                  <option value="paid">Paid</option>
                  <option value="void">Void</option>
                </select>
              </label>

              <div className="md:col-span-2 space-y-2">
                <span className="text-sm text-slate-600">Customer</span>
                <div className="flex flex-col sm:flex-row gap-2">
                  {invoiceGuestMode ? (
                    <select
                      className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
                      value={selectedPropertyCustomerId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setSelectedPropertyCustomerId(id);
                        setSelectedCustomerId("");
                        if (id) {
                          const g = propertyCustomersList.find((x) => x.id === id);
                          if (g) {
                            setCustomerName(guestDisplayName(g));
                            setCustomerEmail(g.email || "");
                            setCustomerAddress(g.address || "");
                          }
                        }
                      }}
                      disabled={readOnly}
                    >
                      <option value="">— Select a customer or enter billing details below —</option>
                      {propertyCustomersList.map((g) => (
                        <option key={g.id} value={g.id}>
                          {guestDisplayName(g)}
                          {g.email ? ` · ${g.email}` : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
                      value={selectedCustomerId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setSelectedCustomerId(id);
                        setSelectedPropertyCustomerId("");
                        if (id) {
                          const c = customers.find((x) => x.id === id);
                          if (c) {
                            setCustomerName(c.name);
                            setCustomerEmail(c.email || "");
                            setCustomerAddress(c.address || "");
                          }
                        }
                      }}
                      disabled={readOnly}
                    >
                      <option value="">— Select a saved customer or enter details below —</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.email ? ` · ${c.email}` : ""}
                        </option>
                      ))}
                    </select>
                  )}
                  {onNavigate ? (
                    <button
                      type="button"
                      className="app-btn-secondary text-sm shrink-0"
                      onClick={() =>
                        onNavigate(invoiceGuestMode ? "hotel_customers" : "retail_customers", invoiceGuestMode ? {} : undefined)
                      }
                    >
                      {invoiceGuestMode ? "Add / manage customers" : "Add / manage retail customers"}
                    </button>
                  ) : null}
                </div>
                <p className="text-xs text-slate-500">
                  {invoiceGuestMode
                    ? propertyCustomersList.length === 0
                      ? "No customers yet — use Sales → Customers (or Add / manage customers), or type billing details below."
                      : "Choosing a customer fills name, email, and address; you can still edit them for this invoice."
                    : customers.length === 0
                      ? "No customers in your list yet — use Add / manage customers, or type billing details below."
                      : "Choosing a customer fills name, email, and address; you can still edit them for this invoice."}
                </p>
              </div>

              <label className="block text-sm">
                <span className="text-slate-600">Billing name</span>
                <input
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  disabled={readOnly}
                />
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">Email</span>
                <input
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  disabled={readOnly}
                />
              </label>
              <label className="block text-sm md:col-span-2">
                <span className="text-slate-600">Address</span>
                <textarea
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  rows={2}
                  value={customerAddress}
                  onChange={(e) => setCustomerAddress(e.target.value)}
                  disabled={readOnly}
                />
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">Issue date</span>
                <input
                  type="date"
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  disabled={readOnly}
                />
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">Due date</span>
                <input
                  type="date"
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  disabled={readOnly}
                />
              </label>
              <label className="block text-sm">
                <span className="text-slate-600">VAT % (lines with VAT on)</span>
                <input
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  value={taxRate}
                  onChange={(e) => setTaxRate(e.target.value)}
                  disabled={readOnly}
                />
              </label>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-800">Line items</span>
                <button
                  type="button"
                  disabled={readOnly}
                  className="text-sm text-brand-700 font-medium hover:underline disabled:opacity-50"
                  onClick={() => setLines((prev) => [...prev, newLineDraft()])}
                >
                  + Add line
                </button>
              </div>
              <div className="border border-slate-200 rounded-lg overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left p-2 w-40">Product</th>
                      <th className="text-left p-2">Description</th>
                      <th className="text-right p-2 w-24">Qty</th>
                      <th className="text-right p-2 w-28">Unit price</th>
                      <th className="text-center p-2 w-16" title="Include in VAT base">
                        VAT
                      </th>
                      <th className="text-right p-2 w-28">Line</th>
                      <th className="p-2 w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((ln) => {
                      const lineTot = (Number(ln.quantity) || 0) * (Number(ln.unit_price) || 0);
                      return (
                        <tr key={ln.tempId} className="border-t border-slate-100">
                          <td className="p-2 align-top">
                            <select
                              className="w-full border border-slate-200 rounded px-2 py-1 text-xs"
                              value={ln.product_id}
                              onChange={(e) => applyProduct(ln.tempId, e.target.value)}
                              disabled={readOnly}
                            >
                              <option value="">—</option>
                              {products.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="p-2 align-top">
                            <input
                              className="w-full border border-slate-200 rounded px-2 py-1"
                              value={ln.description}
                              onChange={(e) =>
                                setLines((prev) =>
                                  prev.map((x) => (x.tempId === ln.tempId ? { ...x, description: e.target.value } : x))
                                )
                              }
                              placeholder="Description"
                              disabled={readOnly}
                            />
                          </td>
                          <td className="p-2 align-top">
                            <input
                              className="w-full border border-slate-200 rounded px-2 py-1 text-right"
                              value={ln.quantity}
                              onChange={(e) =>
                                setLines((prev) =>
                                  prev.map((x) => (x.tempId === ln.tempId ? { ...x, quantity: e.target.value } : x))
                                )
                              }
                              disabled={readOnly}
                            />
                          </td>
                          <td className="p-2 align-top">
                            <input
                              className="w-full border border-slate-200 rounded px-2 py-1 text-right"
                              value={ln.unit_price}
                              onChange={(e) =>
                                setLines((prev) =>
                                  prev.map((x) => (x.tempId === ln.tempId ? { ...x, unit_price: e.target.value } : x))
                                )
                              }
                              disabled={readOnly}
                            />
                          </td>
                          <td className="p-2 align-middle text-center">
                            <input
                              type="checkbox"
                              checked={ln.vat_on}
                              onChange={(e) =>
                                setLines((prev) =>
                                  prev.map((x) => (x.tempId === ln.tempId ? { ...x, vat_on: e.target.checked } : x))
                                )
                              }
                              disabled={readOnly}
                              className="h-4 w-4 rounded border-slate-300"
                              title="VAT on this line"
                              aria-label="VAT on this line"
                            />
                          </td>
                          <td className="p-2 align-top text-right font-medium">{formatMoney(lineTot)}</td>
                          <td className="p-2 align-top">
                            <button
                              type="button"
                              disabled={readOnly || lines.length <= 1}
                              className="p-1 text-red-600 hover:bg-red-50 rounded disabled:opacity-30"
                              onClick={() => setLines((prev) => prev.filter((x) => x.tempId !== ln.tempId))}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <label className="block text-sm">
              <span className="text-slate-600">Notes</span>
              <textarea
                className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={readOnly}
              />
            </label>

            <div className="flex justify-end gap-2 text-sm border-t border-slate-100 pt-4">
              <div className="mr-auto text-right space-y-1 text-slate-700">
                <div>
                  Total <strong className="tabular-nums">{formatMoney(computed.subtotal)}</strong>
                  <span className="text-slate-500 text-xs ml-2">(line items)</span>
                </div>
                <div>
                  VAT ({Number(taxRate) || 0}% on selected lines){" "}
                  <strong className="tabular-nums">{formatMoney(computed.taxAmount)}</strong>
                </div>
                <div className="text-base font-semibold text-slate-900 pt-1 border-t border-slate-200">
                  Grand total <strong className="tabular-nums">{formatMoney(computed.total)}</strong>
                </div>
              </div>
              <button type="button" className="app-btn-secondary" onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <button type="button" className="app-btn-primary" disabled={readOnly || saving} onClick={saveInvoice}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Save invoice
              </button>
            </div>
          </div>
        </div>
      )}

      {previewInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900">Preview</h2>
              <button type="button" className="text-slate-500" onClick={() => setPreviewInvoice(null)}>
                ✕
              </button>
            </div>
            <div
              id="invoice-print-root"
              className="border-2 border-slate-200 rounded-xl p-8 text-sm bg-white text-slate-900 shadow-sm"
            >
              <div className="invoice-print-inner">
              <div className="flex flex-wrap justify-between gap-6 border-b-2 border-slate-200 pb-5 mb-5">
                <div className="min-w-0 flex-1">
                  <p className="text-2xl font-bold tracking-tight text-brand-700 leading-none">INVOICE</p>
                  <p className="text-base font-semibold text-slate-900 mt-3">{businessDisplayName}</p>
                  {config.address ? <p className="text-slate-600 mt-1 whitespace-pre-wrap">{config.address}</p> : null}
                  {config.phone ? <p className="text-slate-600">{config.phone}</p> : null}
                  {config.email ? <p className="text-slate-600">{config.email}</p> : null}
                </div>
                <div className="text-right shrink-0">
                  <p className="font-mono text-lg font-bold text-slate-900">#{previewInvoice.invoice_number}</p>
                  <p className="text-slate-600 mt-2">Issue: {previewInvoice.issue_date}</p>
                  {previewInvoice.due_date ? <p className="text-slate-600">Due: {previewInvoice.due_date}</p> : null}
                  <p className="capitalize text-slate-600">Status: {previewInvoice.status}</p>
                </div>
              </div>
              <div className="mb-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bill to</p>
                <p className="font-semibold text-slate-900 mt-1">{previewInvoice.customer_name || "—"}</p>
                {previewInvoice.customer_email ? <p className="text-slate-700">{previewInvoice.customer_email}</p> : null}
                {previewInvoice.customer_address ? (
                  <p className="whitespace-pre-wrap text-slate-700 mt-1">{previewInvoice.customer_address}</p>
                ) : null}
              </div>
              <div className="invoice-print-table-wrap mb-5 overflow-x-auto rounded-lg border border-slate-300">
                <table className="w-full table-fixed text-sm border-collapse">
                  <colgroup>
                    <col className="min-w-0 w-[48%]" />
                    <col className="w-[12%]" />
                    <col className="w-[20%]" />
                    <col className="w-[20%]" />
                  </colgroup>
                  <thead>
                    <tr className="bg-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                      <th className="border-b border-slate-300 px-3 py-2.5">Description</th>
                      <th className="border-b border-slate-300 px-3 py-2.5 text-right">Qty</th>
                      <th className="border-b border-slate-300 px-3 py-2.5 text-right">Price</th>
                      <th className="border-b border-slate-300 px-3 py-2.5 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewLines.map((ln) => (
                      <tr key={ln.id} className="border-b border-slate-200 last:border-b-0">
                        <td className="min-w-0 px-3 py-2.5 align-top text-slate-900 break-words [overflow-wrap:anywhere]">
                          {ln.description}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums align-top">{ln.quantity}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums align-top">{formatMoney(ln.unit_price)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-medium align-top">{formatMoney(ln.line_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end">
                <div className="w-full max-w-xs space-y-1.5 text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-600">Total</span>
                    <span className="tabular-nums">{formatMoney(previewInvoice.subtotal)}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-600">VAT ({previewInvoice.tax_rate}%)</span>
                    <span className="tabular-nums">{formatMoney(previewInvoice.tax_amount)}</span>
                  </div>
                  <div className="flex justify-between gap-4 font-bold text-slate-900 border-t-2 border-slate-200 pt-2 mt-1">
                    <span>Grand total ({config.currency})</span>
                    <span className="tabular-nums">{formatMoney(previewInvoice.total)}</span>
                  </div>
                  {(invoiceSettlement[previewInvoice.id]?.paid ?? 0) > 0.001 ? (
                    <>
                      <div className="flex justify-between gap-4 text-slate-700 pt-1">
                        <span>Amount paid</span>
                        <span className="tabular-nums">{formatMoney(invoiceSettlement[previewInvoice.id]?.paid ?? 0)}</span>
                      </div>
                      <div className="flex justify-between gap-4 font-bold text-slate-900 border-t border-slate-200 pt-2 mt-1">
                        <span>Balance outstanding</span>
                        <span className="tabular-nums">{formatMoney(invoiceBalanceDue(previewInvoice, invoiceSettlement))}</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between gap-4 text-slate-600 pt-2 border-t border-dashed border-slate-200 mt-2">
                      <span>Balance outstanding</span>
                      <span className="tabular-nums font-semibold text-slate-900">
                        {formatMoney(invoiceBalanceDue(previewInvoice, invoiceSettlement))}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              {(invoiceSettlement[previewInvoice.id]?.payments ?? []).length > 0 ? (
                <div className="mt-5 pt-5 border-t border-slate-200">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payments received</p>
                  <ul className="mt-2 space-y-2">
                    {(invoiceSettlement[previewInvoice.id]?.payments ?? []).map((pm) => (
                      <li key={pm.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-slate-800">
                        <span className="tabular-nums font-medium">{formatMoney(pm.amount)}</span>
                        <span className="text-slate-500 text-xs">
                          {new Date(pm.paid_at).toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </span>
                        {onNavigate ? (
                          <button
                            type="button"
                            className="text-brand-700 hover:underline text-sm font-medium"
                            onClick={() => onNavigate("payments", { highlightPaymentId: pm.id })}
                          >
                            View payment
                          </button>
                        ) : (
                          <span className="text-slate-400 font-mono text-xs" title={pm.id}>
                            {pm.id.slice(0, 8)}…
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {previewInvoice.notes ? (
                <div className="mt-5 pt-5 border-t border-slate-200">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</p>
                  <p className="whitespace-pre-wrap text-slate-800 mt-1">{previewInvoice.notes}</p>
                </div>
              ) : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 justify-end print:hidden">
              <button type="button" className="app-btn-secondary" onClick={printPreview}>
                <Printer className="w-4 h-4" />
                Print
              </button>
              <button
                type="button"
                className="app-btn-primary"
                onClick={() => buildPdf(previewInvoice, previewLines, invoiceSettlement[previewInvoice.id])}
              >
                <FileDown className="w-4 h-4" />
                Download PDF
              </button>
              <button type="button" className="app-btn-secondary" onClick={() => setPreviewInvoice(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
