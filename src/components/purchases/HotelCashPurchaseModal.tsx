import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";
import { randomUuid } from "../../lib/randomUuid";
import { createJournalForBill, createJournalForVendorPayment, deleteJournalEntryByReference, getDefaultGlAccounts } from "../../lib/journal";
import { postStockInFromPurchaseOrderForBill } from "../../lib/poGrnStock";
import { syncBillStatusInDb } from "../../lib/billStatus";
import { queueApprovedBillForTreasury } from "../../lib/treasuryWorkflow";

type Product = { id: string; name: string; unit_of_measure?: string | null; cost_price?: number | null };
type Vendor = { id: string; name: string };
type Line = { id: string; productId: string; quantity: string; rate: string };

export function HotelCashPurchaseModal({ open, onClose, onComplete }: { open: boolean; onClose: () => void; onComplete: () => void | Promise<void> }) {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("Cash stock purchase");
  const [reference, setReference] = useState("");
  const [payNow, setPayNow] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [lines, setLines] = useState<Line[]>([{ id: randomUuid(), productId: "", quantity: "", rate: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !orgId) return;
    void Promise.all([
      supabase.from("vendors").select("id,name").eq("organization_id", orgId).order("name"),
      supabase.from("products").select("id,name,unit_of_measure,cost_price").eq("organization_id", orgId).or("track_inventory.is.null,track_inventory.eq.true").order("name"),
    ]).then(([vendorResult, productResult]) => {
      if (vendorResult.error || productResult.error) {
        setError(vendorResult.error?.message || productResult.error?.message || "Could not load purchase options.");
        return;
      }
      setVendors((vendorResult.data || []) as Vendor[]);
      setProducts((productResult.data || []) as Product[]);
    });
  }, [open, orgId]);

  const total = useMemo(() => lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.rate || 0), 0), [lines]);
  const updateLine = (id: string, patch: Partial<Line>) => setLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line));
  const resetAndClose = () => {
    setVendorId(""); setDescription("Cash stock purchase"); setReference(""); setPayNow(true); setPaymentMethod("cash");
    setLines([{ id: randomUuid(), productId: "", quantity: "", rate: "" }]); setError(null); onClose();
  };

  const sourceFundsAccount = async () => {
    const accounts = await getDefaultGlAccounts();
    if (paymentMethod === "bank_transfer" || paymentMethod === "card") return accounts.posBank || accounts.cash;
    if (paymentMethod === "airtel_money") return accounts.posAirtelMoney || accounts.posMtnMobileMoney || accounts.cash;
    if (paymentMethod === "mtn_mobile_money" || paymentMethod === "mobile_money") return accounts.posMtnMobileMoney || accounts.posAirtelMoney || accounts.cash;
    return accounts.cash;
  };

  const save = async () => {
    if (!orgId || !user?.id) return setError("Your staff account is not linked to an organization.");
    if (!vendorId) return setError("Select a supplier.");
    const prepared = lines.map((line) => {
      const product = products.find((item) => item.id === line.productId);
      const quantity = Number(line.quantity); const rate = Number(line.rate);
      if (!product || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(rate) || rate < 0) throw new Error("Select each stock item and enter a valid quantity and rate.");
      return { product, quantity, rate, amount: quantity * rate };
    });
    if (!prepared.length || total <= 0) return setError("Add at least one stock item with an amount greater than zero.");

    setSaving(true); setError(null);
    const purchaseOrderId=randomUuid(), billId=randomUuid(), paymentId=randomUuid();
    let billJournal=false, paymentJournal=false;
    try {
      const approvedAt=new Date().toISOString();
      const { error: poError }=await supabase.from("purchase_orders").insert({ id:purchaseOrderId,organization_id:orgId,vendor_id:vendorId,order_date:date,status:"approved",total_amount:total,approved_at:approvedAt });
      if (poError) throw poError;
      const { error: itemError }=await supabase.from("purchase_order_items").insert(prepared.map(({ product,quantity,rate })=>({ purchase_order_id:purchaseOrderId,organization_id:orgId,product_id:product.id,description:product.name,quantity,cost_price:rate })));
      if (itemError) throw itemError;
      const { error: billError }=await supabase.from("bills").insert({ id:billId,organization_id:orgId,vendor_id:vendorId,purchase_order_id:purchaseOrderId,bill_date:date,due_date:date,amount:total,description:description.trim()||"Cash stock purchase",status:"approved",approved_at:approvedAt,approved_by:user.id });
      if (billError) throw billError;
      const postedBill=await createJournalForBill(billId,total,description.trim()||"Cash stock purchase",date,user.id,purchaseOrderId);
      if (!postedBill.ok) throw new Error(postedBill.error||"Purchase journal could not be posted.");
      billJournal=true;
      const stock=await postStockInFromPurchaseOrderForBill(billId,purchaseOrderId,date);
      if (stock.unmatchedDescriptions.length) throw new Error(`Stock items were not matched: ${stock.unmatchedDescriptions.join(", ")}`);
      const vendor=vendors.find((item)=>item.id===vendorId);
      if (payNow) {
        const { error: paymentError }=await supabase.from("vendor_payments").insert({ id:paymentId,organization_id:orgId,vendor_id:vendorId,bill_id:billId,amount:total,payment_date:date,payment_method:paymentMethod,reference:reference.trim()||`Cash stock purchase ${billId.slice(0,8)}`,bill_allocations:[] });
        if (paymentError) throw paymentError;
        const payment=await createJournalForVendorPayment(paymentId,total,date,user.id,{ payableAmount:total,unearnedExcessAmount:0,sourceFundsGlAccountId:await sourceFundsAccount() });
        if (!payment.ok) throw new Error(payment.error||"Supplier payment journal could not be posted.");
        paymentJournal=true; await syncBillStatusInDb(billId);
      } else {
        await queueApprovedBillForTreasury({ organizationId:orgId,sourceId:billId,amount:total,purpose:description.trim()||"Stock purchase",requestedBy:user.id,vendorId,payeeName:vendor?.name });
      }
      resetAndClose(); await onComplete();
    } catch (caught) {
      if (paymentJournal) await deleteJournalEntryByReference("vendor_payment",paymentId,orgId);
      if (billJournal) await deleteJournalEntryByReference("bill",billId,orgId);
      await supabase.from("product_stock_movements").delete().eq("source_type","bill").eq("source_id",billId);
      await supabase.from("vendor_payments").delete().eq("id",paymentId);
      await supabase.from("bills").delete().eq("id",billId);
      await supabase.from("purchase_order_items").delete().eq("purchase_order_id",purchaseOrderId);
      await supabase.from("purchase_orders").delete().eq("id",purchaseOrderId);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally { setSaving(false); }
  };

  if (!open) return null;
  return <div className="fixed inset-0 z-[80] flex justify-end bg-slate-950/40" onMouseDown={(event)=>{if(event.target===event.currentTarget&&!saving) resetAndClose();}}>
    <aside className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label="Cash stock purchase">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-5 py-4"><div><p className="text-xs font-bold uppercase tracking-wide text-emerald-700">BOAT inventory</p><h2 className="text-xl font-bold">Cash stock purchase</h2></div><button onClick={resetAndClose} disabled={saving} className="rounded-lg p-2 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
      <div className="space-y-5 p-5">
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Supplier *<select value={vendorId} onChange={(e)=>setVendorId(e.target.value)} className="mt-1 w-full rounded-lg border p-2"><option value="">Select supplier</option>{vendors.map((v)=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label><label className="text-sm font-medium">Purchase date<input type="date" value={date} onChange={(e)=>setDate(e.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label></div>
        <div><div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">Stock items</h3><button type="button" onClick={()=>setLines((current)=>[...current,{id:randomUuid(),productId:"",quantity:"",rate:""}])} className="app-btn-secondary"><Plus className="h-4 w-4" /> Add item</button></div>
          <div className="space-y-3">{lines.map((line)=><div key={line.id} className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[1fr_100px_130px_130px_40px]">
            <select value={line.productId} onChange={(e)=>{const product=products.find((p)=>p.id===e.target.value);updateLine(line.id,{productId:e.target.value,rate:product?.cost_price!=null?String(product.cost_price):line.rate});}} className="rounded-lg border p-2"><option value="">Select stock item</option>{products.map((p)=><option key={p.id} value={p.id}>{p.name} ({p.unit_of_measure||"unit"})</option>)}</select>
            <input aria-label="Quantity" type="number" min="0" step="0.001" placeholder="Qty" value={line.quantity} onChange={(e)=>updateLine(line.id,{quantity:e.target.value})} className="rounded-lg border p-2 text-right" />
            <input aria-label="Rate" type="number" min="0" step="0.01" placeholder="Rate" value={line.rate} onChange={(e)=>updateLine(line.id,{rate:e.target.value})} className="rounded-lg border p-2 text-right" />
            <div className="rounded-lg bg-slate-50 p-2 text-right font-semibold">{(Number(line.quantity||0)*Number(line.rate||0)).toLocaleString(undefined,{maximumFractionDigits:2})}</div>
            <button type="button" disabled={lines.length===1} onClick={()=>setLines((current)=>current.filter((item)=>item.id!==line.id))} className="rounded p-2 text-rose-600 hover:bg-rose-50 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
          </div>)}</div>
          <p className="mt-3 text-right text-lg font-bold">Total: {total.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</p>
        </div>
        <label className="block text-sm font-medium">Description<input value={description} onChange={(e)=>setDescription(e.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label>
        <label className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 font-medium text-emerald-900"><input type="checkbox" checked={payNow} onChange={(e)=>setPayNow(e.target.checked)} /> Pay supplier straight away</label>
        {payNow&&<div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Payment method<select value={paymentMethod} onChange={(e)=>setPaymentMethod(e.target.value)} className="mt-1 w-full rounded-lg border p-2"><option value="cash">Cash</option><option value="mtn_mobile_money">MTN Mobile Money</option><option value="airtel_money">Airtel Money</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option></select></label><label className="text-sm font-medium">Payment reference<input value={reference} onChange={(e)=>setReference(e.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label></div>}
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">Saving creates the supplier bill, receives every selected item into inventory, and {payNow?"records the payment immediately":"sends the approved bill to Treasury for payment"}.</div>
        {error&&<p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      </div>
      <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-white px-5 py-4"><button onClick={resetAndClose} disabled={saving} className="app-btn-secondary">Cancel</button><button onClick={()=>void save()} disabled={saving} className="app-btn-primary disabled:opacity-50">{saving?"Posting…":payNow?"Receive stock & pay":"Receive stock"}</button></div>
    </aside>
  </div>;
}
