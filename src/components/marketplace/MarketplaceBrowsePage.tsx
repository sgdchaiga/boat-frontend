import { useCallback, useEffect, useMemo, useState } from "react";
import { Minus, Plus, Search, ShoppingCart } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { MarketplaceCustomerActivityPanel } from "./MarketplaceCustomerActivityPanel";

const db = supabase as any;

type Category = { id: string; name: string };
type Merchant = { id: string; display_name: string; public_slug: string };
type Listing = {
  id: string;
  merchant_id: string;
  category_id: string | null;
  title: string;
  description: string | null;
  listing_type: string;
  price: number;
  currency: string;
  available_quantity: number | null;
  review_count?: number;
  average_rating?: number | null;
};
type ListingReviewSummary = { listing_id: string; review_count: number; average_rating: number | null };
type CartItem = Listing & { quantity: number };
type PlacedOrder = { id: string; orderNumber: string; amount: number; currency: string; paymentReference?: string; paid?: boolean };
type PaymentRequest = { payment_request_id: string; payment_reference: string; amount: number; currency: string; status: string };

const money = (amount: number, currency = "UGX") => `${currency} ${Number(amount || 0).toLocaleString()}`;

export function MarketplaceBrowsePage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { user } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [merchants, setMerchants] = useState<Record<string, Merchant>>({});
  const [listings, setListings] = useState<Listing[]>([]);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [merchantId, setMerchantId] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [placedOrder, setPlacedOrder] = useState<PlacedOrder | null>(null);
  const [paymentPhone, setPaymentPhone] = useState("");
  const [paymentNetwork, setPaymentNetwork] = useState<"mtn" | "airtel">("mtn");
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    const [categoryRes, merchantRes, listingRes, reviewSummaryRes] = await Promise.all([
      db.from("marketplace_categories").select("id,name").eq("is_active", true).order("sort_order"),
      db.from("marketplace_merchant_profiles").select("id,display_name,public_slug").eq("is_published", true).order("display_name"),
      db.from("marketplace_listings").select("id,merchant_id,category_id,title,description,listing_type,price,currency,available_quantity").eq("is_published", true).order("created_at", { ascending: false }),
      db.from("marketplace_listing_review_summary").select("listing_id,review_count,average_rating"),
    ]);
    if (categoryRes.error || merchantRes.error || listingRes.error || reviewSummaryRes.error) {
      setMessage((categoryRes.error || merchantRes.error || listingRes.error || reviewSummaryRes.error).message);
      return;
    }
    const merchantRows = (merchantRes.data || []) as Merchant[];
    setCategories((categoryRes.data || []) as Category[]);
    setMerchants(Object.fromEntries(merchantRows.map((merchant) => [merchant.id, merchant])));
    const reviewSummary = Object.fromEntries(((reviewSummaryRes.data || []) as ListingReviewSummary[]).map((summary) => [summary.listing_id, summary]));
    setListings(((listingRes.data || []) as Listing[])
      .filter((listing) => merchantRows.some((merchant) => merchant.id === listing.merchant_id))
      .map((listing) => ({ ...listing, ...reviewSummary[listing.id] })));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visibleListings = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return listings.filter((listing) => {
      const merchantName = merchants[listing.merchant_id]?.display_name || "";
      return (!categoryId || listing.category_id === categoryId)
        && (!merchantId || listing.merchant_id === merchantId)
        && (!term || `${listing.title} ${listing.description || ""} ${merchantName}`.toLocaleLowerCase().includes(term));
    });
  }, [categoryId, listings, merchantId, merchants, search]);

  const cartMerchant = cart[0] ? merchants[cart[0].merchant_id] : null;
  const cartTotal = cart.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);
  const connectedBusinesses = Object.values(merchants).sort((left, right) => left.display_name.localeCompare(right.display_name));
  const canManageMarketplace = Boolean(
    user?.isSuperAdmin || ["admin", "super_admin"].includes(String(user?.role ?? "").trim().toLowerCase())
  );

  const addToCart = (listing: Listing) => {
    if (listing.available_quantity !== null && Number(listing.available_quantity) <= 0) {
      setMessage("This product is currently out of stock.");
      return;
    }
    if (cart.length > 0 && cart[0].merchant_id !== listing.merchant_id) {
      setMessage("Place or clear the current order before adding products from another merchant.");
      return;
    }
    setCart((items) => {
      const existing = items.find((item) => item.id === listing.id);
      if (existing && listing.available_quantity !== null && existing.quantity >= Number(listing.available_quantity)) {
        setMessage(`Only ${listing.available_quantity} units are currently available.`);
        return items;
      }
      return existing
        ? items.map((item) => item.id === listing.id ? { ...item, quantity: item.quantity + 1 } : item)
        : [...items, { ...listing, quantity: 1 }];
    });
    setMessage(null);
  };

  const changeQuantity = (listingId: string, increment: number) => {
    setCart((items) => items.flatMap((item) => {
      if (item.id !== listingId) return [item];
      const quantity = item.quantity + increment;
      return quantity > 0 ? [{ ...item, quantity }] : [];
    }));
  };

  const checkout = async () => {
    if (!user || cart.length === 0 || !cartMerchant) return;
    setCheckingOut(true); setMessage(null);
    const customerRes = await db.from("marketplace_customers").upsert({
      user_id: user.id,
      full_name: user.full_name || user.email,
      email: user.email,
      phone: user.phone || null,
    }, { onConflict: "user_id" }).select("id").single();
    if (customerRes.error) { setCheckingOut(false); setMessage(customerRes.error.message); return; }
    const orderRes = await db.rpc("marketplace_checkout", {
      p_merchant_id: cartMerchant.id,
      p_lines: cart.map((item) => ({ listing_id: item.id, quantity: item.quantity })),
    });
    setCheckingOut(false);
    if (orderRes.error) { setMessage(orderRes.error.message); return; }
    const { data: placedOrderRow } = await db.from("marketplace_orders").select("id,order_number,gross_amount,currency").eq("id", orderRes.data).maybeSingle();
    setPlacedOrder({
      id: String(orderRes.data),
      orderNumber: placedOrderRow?.order_number || "BOAT Market order",
      amount: Number(placedOrderRow?.gross_amount ?? cartTotal),
      currency: placedOrderRow?.currency || cart[0].currency,
    });
    setPaymentPhone(user.phone || "");
    setCart([]);
    setMessage("Your order request was placed. Use BOAT Pay below to send a mobile money prompt.");
  };

  const payByMobileMoney = async () => {
    if (!placedOrder || !paymentPhone.trim()) { setMessage("Enter the mobile money number to pay from."); return; }
    setPaying(true); setMessage(null);
    const requestRes = await db.rpc("marketplace_create_payment_request", {
      p_order_id: placedOrder.id,
      p_phone_number: paymentPhone,
      p_network: paymentNetwork,
    });
    if (requestRes.error) { setPaying(false); setMessage(requestRes.error.message); return; }
    const paymentRequest = requestRes.data as PaymentRequest;
    const mobileRes = await db.functions.invoke("marketplace-mobile-money", { body: { payment_request_id: paymentRequest.payment_request_id } });
    setPaying(false);
    if (mobileRes.error) { setMessage(mobileRes.error.message); return; }
    const result = mobileRes.data as { ok?: boolean; status?: string; tx_ref?: string; message?: string };
    if (result.ok && result.status === "successful") {
      setPlacedOrder((order) => order ? { ...order, paid: true, paymentReference: result.tx_ref || paymentRequest.payment_reference } : order);
      setMessage(`Payment confirmed. Receipt ${result.tx_ref || paymentRequest.payment_reference}.`);
      return;
    }
    setMessage(result.message || "The mobile money payment was not completed.");
  };

  return <section className="mx-auto max-w-7xl space-y-5 p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold text-slate-900">BOAT Market</h1><p className="mt-1 text-sm text-slate-600">Discover products and services published by connected BOAT businesses.</p></div>{canManageMarketplace && <button type="button" onClick={() => onNavigate?.("marketplace_merchant")} className="app-btn-primary">Manage my market sales</button>}</div>
    {message && <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700" role="status">{message}</p>}
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold text-slate-900">Connected businesses</h2><p className="mt-1 text-sm text-slate-600">Businesses that have published their profile and listings to BOAT Market.</p></div>{merchantId && <button type="button" onClick={() => setMerchantId("")} className="text-sm font-medium text-indigo-700">Show all businesses</button>}</div>{connectedBusinesses.length > 0 ? <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{connectedBusinesses.map((merchant) => <article key={merchant.id} className={`rounded-lg border p-3 ${merchantId === merchant.id ? "border-indigo-400 bg-indigo-50" : "border-slate-200"}`}><h3 className="font-medium text-slate-900">{merchant.display_name}</h3><p className="mt-1 text-xs text-slate-500">BOAT business</p><button type="button" onClick={() => setMerchantId(merchant.id)} className="mt-3 text-sm font-medium text-indigo-700">View listings</button></article>)}</div> : <div className="mt-4 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600"><p>No businesses have been published to BOAT Market yet.</p>{canManageMarketplace && <button type="button" onClick={() => onNavigate?.("marketplace_merchant")} className="mt-2 font-medium text-indigo-700">Set up this business as a seller</button>}</div>}</section>
    <div className="grid gap-3 md:grid-cols-[1fr_220px_220px]"><label className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products, services or merchants" className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm" /></label><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><select value={merchantId} onChange={(event) => setMerchantId(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">All businesses</option>{connectedBusinesses.map((merchant) => <option key={merchant.id} value={merchant.id}>{merchant.display_name}</option>)}</select></div>
    <div className="grid items-start gap-5 lg:grid-cols-[1fr_320px]">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{visibleListings.map((listing) => <article key={listing.id} className="flex min-h-48 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs font-medium uppercase tracking-wide text-indigo-700">{listing.listing_type.replace("_", " ")}</p><h2 className="mt-2 font-semibold text-slate-900">{listing.title}</h2><p className="mt-1 text-sm text-slate-600">{merchants[listing.merchant_id]?.display_name || "BOAT merchant"}</p>{Number(listing.review_count || 0) > 0 && <p className="mt-1 text-xs font-medium text-amber-700">★ {Number(listing.average_rating || 0).toFixed(1)} ({listing.review_count} {Number(listing.review_count) === 1 ? "review" : "reviews"})</p>}{listing.available_quantity !== null && <p className={`mt-1 text-xs ${Number(listing.available_quantity) > 0 ? "text-emerald-700" : "text-rose-700"}`}>{Number(listing.available_quantity) > 0 ? `${listing.available_quantity} available` : "Out of stock"}</p>}{listing.description && <p className="mt-3 line-clamp-3 text-sm text-slate-600">{listing.description}</p>}<div className="mt-auto flex items-center justify-between gap-2 pt-4"><p className="font-semibold text-slate-900">{money(listing.price, listing.currency)}</p><button type="button" disabled={listing.available_quantity !== null && Number(listing.available_quantity) <= 0} onClick={() => addToCart(listing)} className="app-btn-secondary disabled:cursor-not-allowed disabled:opacity-50"><Plus className="h-4 w-4" /> {listing.available_quantity !== null && Number(listing.available_quantity) <= 0 ? "Sold out" : "Add"}</button></div></article>)}{visibleListings.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-600 sm:col-span-2 xl:col-span-3">No published listings match that search yet.</p>}</div>
      <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><ShoppingCart className="h-5 w-5 text-indigo-700" /><h2 className="font-semibold text-slate-900">Your order</h2></div>{cartMerchant && <p className="mt-1 text-sm text-slate-600">From {cartMerchant.display_name}</p>}<div className="mt-4 space-y-3">{cart.map((item) => <div key={item.id} className="border-b border-slate-100 pb-3"><p className="text-sm font-medium text-slate-900">{item.title}</p><div className="mt-2 flex items-center justify-between"><div className="flex items-center gap-2"><button type="button" onClick={() => changeQuantity(item.id, -1)} className="rounded border border-slate-300 p-1" aria-label={`Remove one ${item.title}`}><Minus className="h-3 w-3" /></button><span className="min-w-5 text-center text-sm">{item.quantity}</span><button type="button" onClick={() => changeQuantity(item.id, 1)} className="rounded border border-slate-300 p-1" aria-label={`Add one ${item.title}`}><Plus className="h-3 w-3" /></button></div><span className="text-sm">{money(Number(item.price) * item.quantity, item.currency)}</span></div></div>)}{cart.length === 0 && <p className="text-sm text-slate-500">Your order is empty.</p>}</div>{cart.length > 0 && <><div className="mt-4 flex justify-between border-t border-slate-200 pt-3 font-semibold"><span>Total</span><span>{money(cartTotal, cart[0].currency)}</span></div><button type="button" onClick={() => void checkout()} disabled={checkingOut} className="app-btn-primary mt-4 w-full">{checkingOut ? "Placing order…" : "Place order"}</button></>}</aside>
    </div>
    {placedOrder && <section className="rounded-xl border border-indigo-200 bg-indigo-50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold text-slate-900">{placedOrder.paid ? "BOAT Pay receipt" : "Pay with BOAT Pay"}</h2><p className="mt-1 text-sm text-slate-600">{placedOrder.orderNumber} · {money(placedOrder.amount, placedOrder.currency)}</p></div>{placedOrder.paid && <button type="button" onClick={() => window.print()} className="app-btn-secondary">Print receipt</button>}</div>
      {placedOrder.paid ? <div className="mt-4 rounded-lg border border-emerald-200 bg-white p-4 text-sm text-emerald-800"><p className="font-semibold">Payment confirmed</p><p className="mt-1">Reference: {placedOrder.paymentReference}</p><p>Amount: {money(placedOrder.amount, placedOrder.currency)}</p></div> : <div className="mt-4 grid gap-3 md:grid-cols-[180px_1fr_auto]"><select value={paymentNetwork} onChange={(event) => setPaymentNetwork(event.target.value as "mtn" | "airtel")} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="mtn">MTN Mobile Money</option><option value="airtel">Airtel Money</option></select><input value={paymentPhone} onChange={(event) => setPaymentPhone(event.target.value)} inputMode="tel" placeholder="Mobile money number" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><button type="button" onClick={() => void payByMobileMoney()} disabled={paying} className="app-btn-primary">{paying ? "Waiting for approval…" : "Send payment prompt"}</button></div>}
    </section>}
    <MarketplaceCustomerActivityPanel refreshKey={`${placedOrder?.id || ""}:${placedOrder?.paid ? "paid" : "unpaid"}`} />
  </section>;
}
