import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { FileText, Plus, X, CheckCircle, Pencil, ExternalLink, Printer, CreditCard, Ban, Trash2 } from "lucide-react";
import { jsPDF } from "jspdf";
import { supabase } from "../../lib/supabase";
import { loadHotelConfig } from "../../lib/hotelConfig";
import { useAuth } from "../../contexts/AuthContext";
import { canApprove } from "../../lib/approvalRights";
import { createJournalForBill } from "../../lib/journal";
import { businessTodayISO } from "../../lib/timezone";
import {
  getTotalPaidForBill,
  isBillApproved,
  parseBillAllocationsJson,
  syncBillStatusInDb,
  syncBillStatusesForOrganization,
} from "../../lib/billStatus";
import { postStockInFromPurchaseOrderForBill } from "../../lib/poGrnStock";
import { deleteJournalEntryByReference } from "../../lib/journal";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";
import { PageNotes } from "../common/PageNotes";

interface Bill {
  id: string;
  vendor_id?: string | null;
  bill_date?: string | null;
  due_date?: string | null;
  amount?: number | null;
  status?: string | null;
  description?: string | null;
  purchase_order_id?: string | null;
  approved_at?: string | null;
  approved_by?: string | null;
  created_at?: string;
  vendors?: { name: string } | null;
  approver?: { full_name: string } | null;
}

interface BillsPageProps {
  highlightBillId?: string;
  onNavigate?: (page: string, state?: Record<string, unknown>) => void;
  readOnly?: boolean;
}

function formatBillStatusLabel(status: string | null | undefined): string {
  const s = (status || "").toLowerCase();
  if (s === "pending_approval" || s === "pending") return "Pending approval";
  if (s === "rejected") return "Rejected";
  if (s === "cancelled") return "Cancelled";
  if (s === "approved") return "Approved";
  if (s === "partially_paid") return "Partially paid";
  if (s === "overdue") return "Overdue";
  if (s === "paid") return "Paid";
  return status || "—";
}

function isRejectedBill(b: Bill): boolean {
  return (b.status || "").toLowerCase() === "rejected";
}

export function BillsPage({ highlightBillId, onNavigate, readOnly = false }: BillsPageProps = {}) {
  const { user } = useAuth();
  const highlightRef = useRef<HTMLTableRowElement | null>(null);
  const canApproveBills = canApprove("bills", user?.role);
  const [bills, setBills] = useState<Bill[]>([]);
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);
  const [staff, setStaff] = useState<{ id: string; full_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingBill, setEditingBill] = useState<Bill | null>(null);
  const [detailBill, setDetailBill] = useState<Bill | null>(null);
  const [detailItems, setDetailItems] = useState<{ description: string; cost_price: number; quantity: number }[]>([]);
  const [detailPayments, setDetailPayments] = useState<
    { id: string; amount: number; payment_date: string; bulk?: boolean }[]
  >([]);
  const [detailCredits, setDetailCredits] = useState<{ id: string; amount: number; credit_date: string }[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const detailPaidTotal = useMemo(() => {
    if (!detailBill) return 0;
    return detailPayments.reduce((s, p) => s + Number(p.amount || 0), 0);
  }, [detailBill, detailPayments]);

  const detailBalance = useMemo(() => {
    if (!detailBill) return 0;
    return Number(detailBill.amount || 0) - detailPaidTotal;
  }, [detailBill, detailPaidTotal]);

  const showRecordPayment = useMemo(() => {
    if (!detailBill) return false;
    return (
      isBillApproved(detailBill) &&
      detailBill.status !== "paid" &&
      detailBalance > 0.001
    );
  }, [detailBill, detailBalance]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const orgId = user?.organization_id ?? undefined;
      if (orgId) {
        await syncBillStatusesForOrganization(orgId);
      }
      const [billRes, venRes, staffRes] = await Promise.all([
        orgId
          ? supabase.from("bills").select("*, vendors(name)").eq("organization_id", orgId).order("bill_date", { ascending: false })
          : supabase.from("bills").select("*, vendors(name)").order("bill_date", { ascending: false }),
        supabase.from("vendors").select("id, name").order("name"),
        supabase.from("staff").select("id, full_name").order("full_name"),
      ]);
      if (billRes.error) throw billRes.error;
      setBills((billRes.data || []) as Bill[]);
      setVendors(venRes.data || []);
      setStaff((staffRes.data || []) as { id: string; full_name: string }[]);
    } catch (e) {
      console.error("Error fetching bills:", e);
      setBills([]);
    } finally {
      setLoading(false);
    }
  }, [user?.organization_id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (highlightBillId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightBillId, bills]);

  const handleApprove = async (bill: Bill) => {
    if (readOnly) return;
    if (bill.status === "paid") return;
    if (isBillApproved(bill)) return;
    setApprovingId(bill.id);
    try {
      const { data: staffRow } = await supabase
        .from("staff")
        .select("id")
        .eq("id", user?.id)
        .maybeSingle();

      const approvedAt = new Date().toISOString();
      const payload: Record<string, unknown> = {
        approved_at: approvedAt,
      };
      if (staffRow?.id) payload.approved_by = staffRow.id;
      let { error } = await supabase.from("bills").update(payload).eq("id", bill.id);

      // Schema-tolerant fallbacks for installations missing optional approval columns.
      if (error) {
        const msg = String(error.message || "").toLowerCase();
        if (msg.includes("approved_at")) {
          const retryNoApprovedAt = await supabase
            .from("bills")
            .update({
              status: "partially_paid",
              ...(payload.approved_by ? { approved_by: payload.approved_by } : {}),
            })
            .eq("id", bill.id);
          error = retryNoApprovedAt.error;
        }
      }
      if (error) {
        const msg = String(error.message || "").toLowerCase();
        if (msg.includes("approved_by")) {
          const retryNoApprover = await supabase.from("bills").update({ status: "partially_paid" }).eq("id", bill.id);
          error = retryNoApprover.error;
        }
      }
      if (error) throw error;

      await syncBillStatusInDb(bill.id);

      // Ensure AP/expense journal exists (idempotent if already posted on create). PO-created bills may have had no journal until now.
      const billAmt = Number(bill.amount || 0);
      if (billAmt > 0) {
        const jr = await createJournalForBill(
          bill.id,
          billAmt,
          bill.description || null,
          bill.bill_date || businessTodayISO(),
          user?.id ?? null
        );
        if (!jr.ok) {
          alert(`Bill approved but journal was not posted: ${jr.error}`);
        }
      }

      if (bill.purchase_order_id) {
        const { unmatchedDescriptions } = await postStockInFromPurchaseOrderForBill(bill.id, bill.purchase_order_id);
        if (unmatchedDescriptions.length > 0) {
          const list = unmatchedDescriptions.join("\n- ");
          alert(
            `Bill approved, but some PO item descriptions were not matched to products.\n` +
              `These lines were skipped for stock-in posting:\n- ${list}\n\n` +
              `Tip: Rename PO item descriptions to exactly match product names, or update products accordingly.`
          );
        }
      }

      fetchData();
      if (detailBill?.id === bill.id) {
        const { data: upd } = await supabase.from("bills").select("*, vendors(name)").eq("id", bill.id).maybeSingle();
        if (upd) setDetailBill(upd as Bill);
      }
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.message
          : e && typeof e === "object" && "message" in e
            ? String((e as { message?: string }).message)
            : e && typeof e === "object" && "details" in e
              ? String((e as { details?: string }).details)
              : e && typeof e === "object" && "hint" in e
                ? String((e as { hint?: string }).hint)
                : JSON.stringify(e);
      alert("Failed to approve: " + msg);
      console.error("Bill approve failed:", e);
    } finally {
      setApprovingId(null);
    }
  };

  const ensureCanRejectOrDelete = async (bill: Bill): Promise<string | null> => {
    if (isBillApproved(bill)) {
      return "Approved GRN/bills cannot be rejected or deleted. Use vendor credits or accounting adjustments if you need to reverse one.";
    }
    const paid = await getTotalPaidForBill(bill.id);
    if (paid > 0.009) {
      return `This bill has payments recorded (${paid.toFixed(2)}). Remove or reassign those payments first.`;
    }
    return null;
  };

  const handleReject = async (bill: Bill) => {
    if (readOnly) return;
    if (isRejectedBill(bill)) return;
    const block = await ensureCanRejectOrDelete(bill);
    if (block) {
      alert(block);
      return;
    }
    if (!confirm("Reject this GRN/bill? It will be marked rejected and taken out of the approval queue.")) return;
    setRejectingId(bill.id);
    try {
      const jr = await deleteJournalEntryByReference("bill", bill.id);
      if (!jr.ok) console.warn("[bills] remove journal on reject:", jr.error);
      let { error } = await supabase
        .from("bills")
        .update({
          status: "rejected",
          approved_at: null,
          approved_by: null,
        })
        .eq("id", bill.id);
      if (error) {
        const msg = String(error.message || "").toLowerCase();
        if (msg.includes("approved_at") || msg.includes("approved_by")) {
          ({ error } = await supabase.from("bills").update({ status: "rejected" }).eq("id", bill.id));
        }
      }
      if (error) throw error;
      fetchData();
      if (detailBill?.id === bill.id) {
        const { data: upd } = await supabase.from("bills").select("*, vendors(name)").eq("id", bill.id).maybeSingle();
        if (upd) setDetailBill(upd as Bill);
      }
    } catch (e) {
      alert("Failed to reject: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setRejectingId(null);
    }
  };

  const handleDelete = async (bill: Bill) => {
    if (readOnly) return;
    const block = await ensureCanRejectOrDelete(bill);
    if (block) {
      alert(block);
      return;
    }
    if (!confirm("Permanently delete this GRN/bill? This cannot be undone.")) return;
    setDeletingId(bill.id);
    try {
      const jr = await deleteJournalEntryByReference("bill", bill.id);
      if (!jr.ok) console.warn("[bills] remove journal on delete:", jr.error);
      await supabase.from("product_stock_movements").delete().eq("source_type", "bill").eq("source_id", bill.id);
      const { error } = await supabase.from("bills").delete().eq("id", bill.id);
      if (error) throw error;
      if (detailBill?.id === bill.id) setDetailBill(null);
      fetchData();
    } catch (e) {
      alert("Failed to delete: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setDeletingId(null);
    }
  };

  const openEdit = (bill: Bill) => {
    setEditingBill(bill);
    setVendorId(bill.vendor_id || "");
    const bDate = bill.bill_date || new Date().toISOString().slice(0, 10);
    setBillDate(bDate);
    setDueDate(bill.due_date || bDate);
    setAmount(String(bill.amount ?? ""));
    setDescription(bill.description || "");
    setShowModal(true);
  };

  const openDetail = async (bill: Bill) => {
    setDetailBill(bill);
    setDetailItems([]);
    const queries: Promise<unknown>[] = [
      (async () => {
        const direct = await supabase
          .from("vendor_payments")
          .select("id, amount, payment_date")
          .eq("bill_id", bill.id)
          .order("payment_date", { ascending: false });
        const fromDirect = (direct.data || []).map((d: { id: string; amount: number; payment_date: string }) => ({
          ...d,
          bulk: false,
        }));

        const fromJsonBulk: { id: string; amount: number; payment_date: string; bulk: boolean }[] = [];
        if (bill.vendor_id) {
          const vpJson = await supabase
            .from("vendor_payments")
            .select("id, amount, payment_date, bill_allocations")
            .eq("vendor_id", bill.vendor_id)
            .not("bill_allocations", "is", null);
          if (!vpJson.error && vpJson.data) {
            for (const row of vpJson.data) {
              const r = row as { id: string; amount: number; payment_date: string; bill_allocations?: unknown };
              const slice = parseBillAllocationsJson(r.bill_allocations).find((s) => s.bill_id === bill.id);
              if (slice) {
                fromJsonBulk.push({
                  id: r.id,
                  amount: slice.amount,
                  payment_date: r.payment_date,
                  bulk: true,
                });
              }
            }
          }
        }

        const allocs = await supabase
          .from("vendor_payment_bill_allocations")
          .select("id, amount, vendor_payment_id")
          .eq("bill_id", bill.id);
        const allocRows = (allocs.error ? [] : (allocs.data || [])) as {
          id: string;
          amount: number;
          vendor_payment_id: string;
        }[];
        const parentIds = [...new Set(allocRows.map((r) => r.vendor_payment_id))];
        let parentDates = new Map<string, string>();
        if (parentIds.length > 0) {
          const { data: parents } = await supabase.from("vendor_payments").select("id, payment_date").in("id", parentIds);
          parentDates = new Map((parents || []).map((p) => [p.id, p.payment_date as string]));
        }
        const fromAllocTable = allocRows.map((a) => ({
          id: a.id,
          amount: a.amount,
          payment_date: parentDates.get(a.vendor_payment_id) || "",
          bulk: true,
        }));

        const merged = [...fromDirect, ...fromJsonBulk, ...fromAllocTable].sort(
          (a, b) =>
            new Date(b.payment_date || 0).getTime() - new Date(a.payment_date || 0).getTime()
        );
        return { data: merged };
      })(),
      bill.vendor_id
        ? Promise.resolve(
            supabase
              .from("vendor_credits")
              .select("id, amount, credit_date")
              .eq("vendor_id", bill.vendor_id)
              .order("credit_date", { ascending: false })
          )
        : Promise.resolve({ data: [] }),
    ];
    if (bill.purchase_order_id) {
      queries.push(
        Promise.resolve(
          supabase
            .from("purchase_order_items")
            .select("description, cost_price, quantity")
            .eq("purchase_order_id", bill.purchase_order_id)
            .order("id")
        )
      );
    }
    const results = await Promise.all(queries);
    const payRes = results[0] as { data?: { id: string; amount: number; payment_date: string }[] };
    const credRes = results[1] as { data?: { id: string; amount: number; credit_date: string }[] };
    setDetailPayments(payRes.data || []);
    setDetailCredits(credRes.data || []);
    if (bill.purchase_order_id && results[2]) {
      const itemsRes = results[2] as { data?: { description: string; cost_price: number; quantity: number }[] };
      setDetailItems(itemsRes.data || []);
    }
  };

  const getBillPdfBlob = (): Blob | null => {
    if (!detailBill) return null;
    const config = loadHotelConfig(user?.organization_id ?? null);
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    const contentWidth = pageWidth - margin * 2;

    // Colors (slate/emerald theme)
    const headerBg: [number, number, number] = [30, 41, 59];     // slate-800 - softer than pure black
    const headerAccent: [number, number, number] = [16, 185, 129]; // emerald-500 accent line
    const accent: [number, number, number] = [16, 185, 129];
    const textDark: [number, number, number] = [30, 41, 59];
    const textMuted: [number, number, number] = [100, 116, 139];
    const tableHeadBg: [number, number, number] = [248, 250, 252];
    const borderColor: [number, number, number] = [226, 232, 240];
    const white: [number, number, number] = [255, 255, 255];

    let y = 0;

    // ----- Header: main block (softer dark) -----
    const headerHeight = 46;
    doc.setFillColor(...headerBg);
    doc.rect(0, 0, pageWidth, headerHeight, "F");

    // Thin emerald accent line at bottom of header
    doc.setFillColor(...headerAccent);
    doc.rect(0, headerHeight - 3, pageWidth, 3, "F");

    // Logo: white circle with emerald border
    const logoX = margin + 14;
    const logoY = 22;
    const logoR = 11;
    doc.setDrawColor(...headerAccent);
    doc.setLineWidth(0.8);
    doc.circle(logoX, logoY, logoR, "S");
    doc.setFillColor(...white);
    doc.circle(logoX, logoY, logoR - 0.5, "F");
    const initials = (config.hotel_name || "G")
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
    doc.setTextColor(...headerBg);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(initials, logoX, logoY + 1.2, { align: "center" });

    // Organization name (white, bold)
    doc.setTextColor(...white);
    doc.setFontSize(17);
    doc.setFont("helvetica", "bold");
    doc.text(config.hotel_name || "BOAT", margin + 52, 18);

    // Tagline or address block (slightly muted white)
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(226, 232, 240); // slate-200 for contrast on dark
    let lineY = 25;
    if (config.address) {
      doc.text(config.address, margin + 52, lineY);
      lineY += 4;
    }
    if (config.phone) {
      doc.text(config.phone, margin + 52, lineY);
      lineY += 4;
    }
    if (config.email) {
      doc.text(config.email, margin + 52, lineY);
    }

    y = 56;

    // ----- Bill title -----
    doc.setTextColor(...accent);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("GRN/BILL", margin, y);
    y += 8;

    // ----- Bill info and Bill To in two columns -----
    doc.setDrawColor(...borderColor);
    doc.setLineWidth(0.3);
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;

    const vendorName = detailBill.vendors?.name || "—";
    const billDateStr = detailBill.bill_date ? new Date(detailBill.bill_date).toLocaleDateString() : "—";
    const dueDateStr = detailBill.due_date ? new Date(detailBill.due_date).toLocaleDateString() : "—";

    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...textDark);
    doc.text("Bill to", margin, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...textMuted);
    doc.text(vendorName, margin, y + 5);
    y += 12;

    doc.setFont("helvetica", "normal");
    doc.text(`Bill date: ${billDateStr}`, margin, y);
    doc.text(`Due date: ${dueDateStr}`, margin, y + 5);
    if (detailBill.description) doc.text(`Ref: ${detailBill.description}`, margin, y + 10);
    y += (detailBill.description ? 18 : 12);

    // ----- Items table -----
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...textDark);
    doc.text("Items", margin, y);
    y += 6;

    const colWidths = [88, 22, 24, 32];

    // Table header
    doc.setFillColor(...tableHeadBg);
    doc.rect(margin, y - 4, contentWidth, 8, "F");
    doc.setDrawColor(...borderColor);
    doc.rect(margin, y - 4, contentWidth, 8, "S");
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...textDark);
    doc.text("Description", margin + 2, y + 1);
    doc.text("Qty", margin + colWidths[0] + 2, y + 1);
    doc.text("Unit", margin + colWidths[0] + colWidths[1] + 2, y + 1);
    doc.text("Amount", margin + colWidths[0] + colWidths[1] + colWidths[2] + 2, y + 1);
    y += 8;

    doc.setFont("helvetica", "normal");
    doc.setTextColor(...textMuted);

    if (detailItems.length > 0) {
      detailItems.forEach((row, i) => {
        const qty = Number(row.quantity || 1);
        const unit = Number(row.cost_price || 0);
        const lineTotal = qty * unit;
        const rowH = 7;
        if (i % 2 === 1) {
          doc.setFillColor(248, 250, 252);
          doc.rect(margin, y - 4, contentWidth, rowH, "F");
        }
        doc.setDrawColor(...borderColor);
        doc.rect(margin, y - 4, contentWidth, rowH, "S");
        doc.text((row.description || "—").slice(0, 45), margin + 2, y + 1);
        doc.text(String(qty), margin + colWidths[0] + 2, y + 1);
        doc.text(unit.toFixed(2), margin + colWidths[0] + colWidths[1] + 2, y + 1);
        doc.text(lineTotal.toFixed(2), margin + colWidths[0] + colWidths[1] + colWidths[2] + 2, y + 1);
        y += rowH;
      });
    } else {
      const rowH = 7;
      doc.setDrawColor(...borderColor);
      doc.rect(margin, y - 4, contentWidth, rowH, "S");
      doc.text("Total", margin + 2, y + 1);
      doc.text(Number(detailBill.amount || 0).toFixed(2), margin + colWidths[0] + colWidths[1] + colWidths[2] + 2, y + 1);
      y += rowH;
    }

    // Total row
    y += 4;
    doc.setFillColor(...tableHeadBg);
    doc.rect(margin + colWidths[0] + colWidths[1], y - 4, colWidths[2] + colWidths[3], 8, "F");
    doc.setDrawColor(...borderColor);
    doc.rect(margin + colWidths[0] + colWidths[1], y - 4, colWidths[2] + colWidths[3], 8, "S");
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...textDark);
    doc.text("Total", margin + colWidths[0] + colWidths[1] + 2, y + 1);
    doc.text(Number(detailBill.amount || 0).toFixed(2), margin + colWidths[0] + colWidths[1] + colWidths[2] + 2, y + 1);
    y += 14;

    // ----- Footer -----
    doc.setDrawColor(...borderColor);
    doc.setLineWidth(0.3);
    doc.line(margin, pageHeight - 22, pageWidth - margin, pageHeight - 22);
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...textMuted);
    doc.text(config.hotel_name || "BOAT", margin, pageHeight - 14);
    doc.text("Thank you for your business.", margin, pageHeight - 8);
    doc.text(`Generated ${new Date().toLocaleDateString()}`, pageWidth - margin, pageHeight - 8, { align: "right" });

    return doc.output("blob");
  };

  const viewBillPdf = () => {
    const blob = getBillPdfBlob();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const printBillPdf = () => {
    const blob = getBillPdfBlob();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "none";
    iframe.src = url;
    document.body.appendChild(iframe);
    iframe.onload = () => {
      try {
        iframe.contentWindow?.print();
      } finally {
        setTimeout(() => {
          document.body.removeChild(iframe);
          URL.revokeObjectURL(url);
        }, 500);
      }
    };
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingBill(null);
    const today = new Date().toISOString().slice(0, 10);
    setVendorId("");
    setBillDate(today);
    setDueDate(today);
    setAmount("");
    setDescription("");
  };

  const handleSave = async () => {
    if (readOnly) return;
    if (!vendorId) {
      alert("Select a vendor.");
      return;
    }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      alert("Enter a valid amount.");
      return;
    }
    setSaving(true);
    try {
      const billDateVal = billDate || new Date().toISOString().slice(0, 10);
      const payload = {
        vendor_id: vendorId,
        bill_date: billDateVal,
        due_date: dueDate || billDateVal,
        amount: amt,
        description: description.trim() || null,
      };
      if (editingBill) {
        const { error } = await supabase.from("bills").update(payload).eq("id", editingBill.id);
        if (error) throw error;
      } else {
        const { data: inserted, error } = await supabase.from("bills").insert({ ...payload, status: "pending_approval" }).select("id, bill_date").single();
        if (error) throw error;
        if (inserted) {
          const jr = await createJournalForBill(
            (inserted as { id: string }).id,
            amt,
            payload.description,
            (inserted as { bill_date: string }).bill_date ?? billDateVal,
            user?.id ?? null
          );
          if (!jr.ok) {
            alert(`Bill saved but journal was not posted: ${jr.error}`);
          }
        }
      }
      closeModal();
      fetchData();
    } catch (e) {
      console.error("Error saving bill:", e);
      alert("Failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 md:p-8">
      {readOnly && (
        <ReadOnlyNotice />
      )}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">Receive stock</h1>
            <PageNotes ariaLabel="GRN and bills help">
              <p>Manage GRN/Bills and payables. Reject or delete bills that are still pending (no approval, no payments).</p>
            </PageNotes>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditingBill(null);
            const today = new Date().toISOString().slice(0, 10);
            setBillDate(today);
            setDueDate(today);
            setShowModal(true);
          }}
          disabled={readOnly}
          className="app-btn-primary disabled:cursor-not-allowed"
        >
          <Plus className="w-5 h-5" /> Add GRN/Bill
        </button>
      </div>

      {loading ? (
        <p className="text-slate-500 py-4">Loading…</p>
      ) : (
        <div className="app-card overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left p-3">Date</th>
                <th className="text-left p-3">Vendor</th>
                <th className="text-left p-3">Description</th>
                <th className="text-left p-3">Due Date</th>
                <th className="text-left p-3">Status</th>
                <th className="text-right p-3">Amount</th>
                <th className="text-right p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => (
                <tr
                  key={b.id}
                  ref={b.id === highlightBillId ? highlightRef : undefined}
                  className={`border-t ${b.id === highlightBillId ? "bg-blue-50 ring-1 ring-blue-200" : ""}`}
                >
                  <td className="p-3">{b.bill_date ? new Date(b.bill_date).toLocaleDateString() : "—"}</td>
                  <td className="p-3">{b.vendors?.name || "—"}</td>
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => openDetail(b)}
                      className="text-left text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {b.description || "—"}
                    </button>
                  </td>
                  <td className="p-3">{b.due_date ? new Date(b.due_date).toLocaleDateString() : "—"}</td>
                  <td className="p-3">
                    <span className="inline-flex items-center gap-2 flex-wrap">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          b.status === "paid"
                            ? "bg-green-100 text-green-800"
                            : b.status === "overdue"
                              ? "bg-red-100 text-red-800"
                              : b.status === "partially_paid"
                                ? "bg-violet-100 text-violet-800"
                                : b.status === "approved"
                                  ? "bg-sky-100 text-sky-800"
                                  : (b.status || "").toLowerCase() === "rejected"
                                    ? "bg-rose-100 text-rose-800"
                                    : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {formatBillStatusLabel(b.status)}
                      </span>
                    </span>
                  </td>
                  <td className="p-3 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => openDetail(b)}
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {Number(b.amount || 0).toFixed(2)}
                    </button>
                  </td>
                  <td className="p-3 text-right">
                    <span className="inline-flex items-center gap-1 flex-wrap justify-end">
                      {!isBillApproved(b) && !isRejectedBill(b) && (
                        <button
                          type="button"
                          onClick={() => openEdit(b)}
                          disabled={readOnly}
                          className="p-1.5 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                          title="Edit GRN/Bill"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      {!isBillApproved(b) && !isRejectedBill(b) ? (
                        <button
                          type="button"
                          onClick={() => canApproveBills && !readOnly && handleApprove(b)}
                          disabled={approvingId === b.id || !canApproveBills || readOnly}
                          className={`px-2 py-1 rounded border text-sm font-medium inline-flex items-center gap-1 ${
                            canApproveBills
                              ? "border-emerald-600 text-emerald-700 bg-white hover:bg-emerald-50"
                              : "border-slate-300 text-slate-400 bg-slate-100 cursor-not-allowed"
                          }`}
                          title={readOnly ? "Read-only mode" : canApproveBills ? "Approve GRN/Bill" : "You do not have bill approval rights"}
                        >
                          <CheckCircle className="w-4 h-4" />
                          {approvingId === b.id ? "…" : "Approve"}
                        </button>
                      ) : null}
                      {!isBillApproved(b) && !isRejectedBill(b) && canApproveBills && !readOnly && (
                        <button
                          type="button"
                          onClick={() => void handleReject(b)}
                          disabled={rejectingId === b.id}
                          className="px-2 py-1 rounded border border-rose-200 text-sm font-medium inline-flex items-center gap-1 text-rose-700 bg-white hover:bg-rose-50"
                          title="Reject GRN/Bill"
                        >
                          <Ban className="w-4 h-4" />
                          {rejectingId === b.id ? "…" : "Reject"}
                        </button>
                      )}
                      {!isBillApproved(b) && canApproveBills && !readOnly && (
                        <button
                          type="button"
                          onClick={() => void handleDelete(b)}
                          disabled={deletingId === b.id}
                          className="p-1.5 rounded text-slate-500 hover:text-red-700 hover:bg-red-50"
                          title={isRejectedBill(b) ? "Delete GRN/Bill" : "Delete GRN/Bill"}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {bills.length === 0 && <p className="p-8 text-center text-slate-500">No GRN/Bills yet.</p>}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => !saving && closeModal()}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">{editingBill ? "Edit Bill" : "Add Bill"}</h2>
              <button type="button" onClick={() => !saving && closeModal()}><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Vendor *</label>
                <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="w-full border rounded-lg px-3 py-2">
                  <option value="">Select vendor</option>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Amount *</label>
                <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full border rounded-lg px-3 py-2" placeholder="0.00" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">GRN/Bill Date</label>
                <input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} className="w-full border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Due Date</label>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <input value={description} onChange={(e) => setDescription(e.target.value)} className="w-full border rounded-lg px-3 py-2" placeholder="e.g. Invoice #1234" />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button type="button" onClick={handleSave} disabled={saving} className="app-btn-primary flex-1 py-2">{saving ? "Saving…" : "Save"}</button>
              <button type="button" onClick={() => !saving && closeModal()} className="px-4 py-2 border rounded-lg hover:bg-slate-50">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {detailBill && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setDetailBill(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-6">
              <h2 className="text-xl font-bold">GRN/Bill details</h2>
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={viewBillPdf}
                  className="app-btn-primary px-3 py-1.5 text-sm gap-1"
                >
                  <FileText className="w-4 h-4" /> View GRN/Bill (PDF)
                </button>
                <button
                  type="button"
                  onClick={printBillPdf}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-medium"
                >
                  <Printer className="w-4 h-4" /> Print
                </button>
                <button type="button" onClick={() => setDetailBill(null)}><X className="w-5 h-5" /></button>
              </span>
            </div>
            <p className="text-xs text-slate-500 mb-4">View the GRN/Bill as PDF first, then print or save from the browser.</p>
            {showRecordPayment && (
              <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50/80 p-4">
                <p className="text-sm text-slate-700 mb-2">
                  Outstanding balance: <span className="font-semibold tabular-nums">{detailBalance.toFixed(2)}</span>
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onNavigate?.("purchases_payments", { payBillId: detailBill.id, payVendorId: detailBill.vendor_id ?? undefined });
                    setDetailBill(null);
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 font-medium text-sm"
                >
                  <CreditCard className="w-4 h-4" /> Record payment
                </button>
                <p className="text-xs text-slate-500 mt-1">Opens Payments made to apply a payment to this GRN/Bill.</p>
              </div>
            )}
            <div className="space-y-3 text-sm mb-4">
              <p><span className="font-medium text-slate-500">Vendor:</span> {detailBill.vendors?.name || "—"}</p>
              <p><span className="font-medium text-slate-500">Date:</span> {detailBill.bill_date ? new Date(detailBill.bill_date).toLocaleDateString() : "—"}</p>
              <p><span className="font-medium text-slate-500">Due date:</span> {detailBill.due_date ? new Date(detailBill.due_date).toLocaleDateString() : "—"}</p>
              <p><span className="font-medium text-slate-500">Status:</span> {formatBillStatusLabel(detailBill.status)}</p>
              {isBillApproved(detailBill) && (detailBill.approved_at || detailBill.approved_by) && (
                <p><span className="font-medium text-slate-500">Approved by:</span> {detailBill.approver?.full_name || staff.find((s) => s.id === detailBill.approved_by)?.full_name || "—"} {detailBill.approved_at ? `on ${new Date(detailBill.approved_at).toLocaleDateString()}` : ""}</p>
              )}
              {!isBillApproved(detailBill) && detailBill.status !== "paid" && !isRejectedBill(detailBill) && (
                <div className="pt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => canApproveBills && !readOnly && handleApprove(detailBill)}
                    disabled={approvingId === detailBill.id || !canApproveBills || readOnly}
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border font-medium text-sm disabled:opacity-50 ${
                      canApproveBills
                        ? "border-emerald-600 text-emerald-700 bg-white hover:bg-emerald-50"
                        : "border-slate-300 text-slate-400 bg-slate-100 cursor-not-allowed"
                    }`}
                    title={canApproveBills ? "Approve GRN/Bill" : "You do not have bill approval rights"}
                  >
                    <CheckCircle className="w-4 h-4" />
                    {approvingId === detailBill.id ? "Approving…" : "Approve GRN/Bill"}
                  </button>
                  {canApproveBills && !readOnly && (
                    <button
                      type="button"
                      onClick={() => void handleReject(detailBill)}
                      disabled={rejectingId === detailBill.id}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-rose-200 font-medium text-sm text-rose-700 bg-white hover:bg-rose-50 disabled:opacity-50"
                    >
                      <Ban className="w-4 h-4" />
                      {rejectingId === detailBill.id ? "Rejecting…" : "Reject"}
                    </button>
                  )}
                </div>
              )}
              {!isBillApproved(detailBill) && canApproveBills && !readOnly && (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => void handleDelete(detailBill)}
                    disabled={deletingId === detailBill.id}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-red-50 hover:text-red-800 hover:border-red-200 text-sm font-medium disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" />
                    {deletingId === detailBill.id ? "Deleting…" : "Delete permanently"}
                  </button>
                </div>
              )}
              {detailBill.description && <p><span className="font-medium text-slate-500">Description:</span> {detailBill.description}</p>}
            </div>
            <div className="border-t pt-4 mb-4">
              <h3 className="font-semibold text-slate-700 mb-2">Items on GRN/Bill</h3>
              <div className="rounded-lg border overflow-hidden">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left p-2 font-medium">Description</th>
                      <th className="text-right p-2 font-medium">Qty</th>
                      <th className="text-right p-2 font-medium">Unit price</th>
                      <th className="text-right p-2 font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailItems.length > 0 ? (
                      detailItems.map((row, i) => {
                        const qty = Number(row.quantity || 1);
                        const unit = Number(row.cost_price || 0);
                        const lineTotal = qty * unit;
                        return (
                          <tr key={i} className="border-t">
                            <td className="p-2">{row.description || "—"}</td>
                            <td className="p-2 text-right">{qty}</td>
                            <td className="p-2 text-right">{unit.toFixed(2)}</td>
                            <td className="p-2 text-right">{lineTotal.toFixed(2)}</td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr className="border-t">
                        <td className="p-2">Total</td>
                        <td className="p-2 text-right">—</td>
                        <td className="p-2 text-right">—</td>
                        <td className="p-2 text-right font-medium">{Number(detailBill.amount || 0).toFixed(2)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {detailItems.length > 0 && (
                <p className="text-right font-semibold mt-2">Total: {Number(detailBill.amount || 0).toFixed(2)}</p>
              )}
            </div>
            <div className="border-t pt-4 space-y-3">
              <h3 className="font-semibold text-slate-700">Related</h3>
              {detailBill.purchase_order_id && (
                <p>
                  <button
                    type="button"
                    onClick={() => { onNavigate?.("purchases_orders"); setDetailBill(null); }}
                    className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    <ExternalLink className="w-4 h-4" /> View recorded purchase
                  </button>
                </p>
              )}
              <p>
                <button
                  type="button"
                  onClick={() => { onNavigate?.("purchases_payments"); setDetailBill(null); }}
                  className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline"
                >
                  <ExternalLink className="w-4 h-4" /> Payments made ({detailPayments.length})
                </button>
              </p>
              <p>
                <button
                  type="button"
                  onClick={() => { onNavigate?.("purchases_credits"); setDetailBill(null); }}
                  className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline"
                >
                  <ExternalLink className="w-4 h-4" /> Vendor credits ({detailCredits.length})
                </button>
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
