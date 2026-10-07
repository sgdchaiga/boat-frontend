import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, Minus, Plus, Search, ShoppingCart } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { MarketplaceCustomerActivityPanel } from "./MarketplaceCustomerActivityPanel";

const db = supabase as any;

type Category = { id: string; name: string };
type Merchant = { id: string; display_name: string; public_slug: string; description: string | null; phone: string | null; logo_path: string | null; banner_path: string | null; accent_color: string | null; storefront_headline: string | null; storefront_policy: string | null };
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
  image_path: string | null;
  compare_at_price: number | null;
  is_featured: boolean;
  review_count?: number;
  average_rating?: number | null;
};
type ListingReviewSummary = { listing_id: string; review_count: number; average_rating: number | null };
type CartItem = Listing & { quantity: number };
type PlacedOrder = { id: string; orderNumber: string; amount: number; currency: string };
type ManualMomoPayment = {
  payment_request_id: string;
  order_reference: string;
  payment_reference: string;
  amount: number;
  currency: string;
  status: "awaiting_submission" | "submitted";
  recipient_name: string;
  recipient_phone: string;
  recipient_network: "mtn" | "airtel";
  payment_instructions: string | null;
};
type StoredManualOrder = { userId: string; order: PlacedOrder };

const money = (amount: number, currency = "UGX") => `${currency} ${Number(amount || 0).toLocaleString()}`;
const manualOrderStorageKey = "boat.marketplace.manual_momo_order";
const mediaUrl = (path: string | null | undefined) => path ? supabase.storage.from("marketplace-storefront-media").getPublicUrl(path).data.publicUrl : null;

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
  const [manualPayment, setManualPayment] = useState<ManualMomoPayment | null>(null);
  const [paymentTransactionId, setPaymentTransactionId] = useState("");
  const [preparingPayment, setPreparingPayment] = useState(false);
  const [submittingTransaction, setSubmittingTransaction] = useState(false);
  const [hiddenListingIds, setHiddenListingIds] = useState<Set<string>>(new Set());
  const [showHiddenListings, setShowHiddenListings] = useState(false);
  const [deliveryMethod, setDeliveryMethod] = useState<"pickup" | "delivery">("pickup");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryPhone, setDeliveryPhone] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");
  const [promotionCode, setPromotionCode] = useState("");

  const load = useCallback(async () => {
    const [categoryRes, merchantRes, listingRes, reviewSummaryRes] = await Promise.all([
      db.from("marketplace_categories").select("id,name").eq("is_active", true).order("sort_order"),
      db.from("marketplace_merchant_profiles").select("id,display_name,public_slug,description,phone,logo_path,banner_path,accent_color,storefront_headline,storefront_policy").eq("is_published", true).order("display_name"),
      db.from("marketplace_listings").select("id,merchant_id,category_id,title,description,listing_type,price,currency,available_quantity,image_path,compare_at_price,is_featured").eq("is_published", true).order("is_featured", { ascending: false }).order("created_at", { ascending: false }),
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
    if (user?.id) {
      const customerRes = await db.from("marketplace_customers").select("id").eq("user_id", user.id).maybeSingle();
      if (customerRes.error) {
        setMessage(customerRes.error.message);
        return;
      }
      if (customerRes.data?.id) {
        const preferenceRes = await db.from("marketplace_customer_listing_preferences").select("listing_id").eq("customer_id", customerRes.data.id);
        if (preferenceRes.error) {
          setMessage(preferenceRes.error.message);
          return;
        }
        setHiddenListingIds(new Set((preferenceRes.data || []).map((preference: { listing_id: string }) => preference.listing_id)));
      } else {
        setHiddenListingIds(new Set());
      }
    }
  }, [user?.id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const storeSlug = new URLSearchParams(window.location.search).get("store");
    if (!storeSlug || merchantId) return;
    const merchant = Object.values(merchants).find((row) => row.public_slug === storeSlug);
    if (merchant) setMerchantId(merchant.id);
  }, [merchantId, merchants]);

  useEffect(() => {
    if (!user?.id || placedOrder) return;
    try {
      const stored = JSON.parse(window.sessionStorage.getItem(manualOrderStorageKey) || "null") as StoredManualOrder | null;
      if (stored?.userId === user.id && stored.order?.id && stored.order?.orderNumber) {
        setPlacedOrder(stored.order);
        setPaymentPhone(user.phone || "");
      }
    } catch {
      window.sessionStorage.removeItem(manualOrderStorageKey);
    }
  }, [placedOrder, user?.id, user?.phone]);

  const visibleListings = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return listings.filter((listing) => {
      const merchantName = merchants[listing.merchant_id]?.display_name || "";
      return (!categoryId || listing.category_id === categoryId)
        && (!merchantId || listing.merchant_id === merchantId)
        && (showHiddenListings || !hiddenListingIds.has(listing.id))
        && (!term || `${listing.title} ${listing.description || ""} ${merchantName}`.toLocaleLowerCase().includes(term));
    });
  }, [categoryId, hiddenListingIds, listings, merchantId, merchants, search, showHiddenListings]);

  const cartMerchant = cart[0] ? merchants[cart[0].merchant_id] : null;
  const cartTotal = cart.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);
  const connectedBusinesses = Object.values(merchants).sort((left, right) => left.display_name.localeCompare(right.display_name));
  const selectedMerchant = merchantId ? merchants[merchantId] : null;
  const canManageMarketplace = Boolean(
    user?.isSuperAdmin || ["admin", "super_admin", "manager"].includes(String(user?.role ?? "").trim().toLowerCase())
  );

  const selectMerchant = (id: string) => {
    setMerchantId(id);
    const url = new URL(window.location.href);
    const merchant = id ? merchants[id] : null;
    if (merchant) url.searchParams.set("store", merchant.public_slug); else url.searchParams.delete("store");
    window.history.replaceState({}, "", url);
  };

  const copyStorefrontLink = async () => {
    if (!selectedMerchant) return;
    const url = new URL(window.location.href);
    url.searchParams.set("page", "storefront");
    url.searchParams.set("store", selectedMerchant.public_slug);
    try {
      await navigator.clipboard.writeText(url.toString());
      setMessage("Public storefront link copied. Anyone can browse it; BOAT sign-in is required to order.");
    } catch {
      setMessage(`Storefront link: ${url.toString()}`);
    }
  };

  const ensureMarketplaceCustomer = async () => {
    if (!user) return { id: null as string | null, error: "Sign in before using BOAT Market." };
    const result = await db.from("marketplace_customers").upsert({
      user_id: user.id,
      full_name: user.full_name || user.email,
      email: user.email,
      phone: user.phone || null,
    }, { onConflict: "user_id" }).select("id").single();
    return { id: result.data?.id as string | undefined || null, error: result.error?.message || null };
  };

  const hideListing = async (listing: Listing) => {
    const customer = await ensureMarketplaceCustomer();
    if (!customer.id) { setMessage(customer.error || "Could not save this preference."); return; }
    const result = await db.from("marketplace_customer_listing_preferences").upsert({ customer_id: customer.id, listing_id: listing.id }, { onConflict: "customer_id,listing_id" });
    if (result.error) { setMessage(result.error.message); return; }
    setHiddenListingIds((current) => new Set([...current, listing.id]));
    setCart((items) => items.filter((item) => item.id !== listing.id));
    setMessage(`${listing.title} will no longer appear in your marketplace list.`);
  };

  const restoreListing = async (listing: Listing) => {
    const customer = await ensureMarketplaceCustomer();
    if (!customer.id) { setMessage(customer.error || "Could not restore this listing."); return; }
    const result = await db.from("marketplace_customer_listing_preferences").delete().eq("customer_id", customer.id).eq("listing_id", listing.id);
    if (result.error) { setMessage(result.error.message); return; }
    setHiddenListingIds((current) => {
      const next = new Set(current);
      next.delete(listing.id);
      return next;
    });
    setMessage(`${listing.title} is visible in your marketplace list again.`);
  };

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

  // A public storefront can hand one selected item into the secure BOAT cart.
  // Remove the hint immediately so reloads never add the item more than once.
  useEffect(() => {
    const listingId = new URLSearchParams(window.location.search).get("add");
    if (!listingId) return;
    const listing = listings.find((row) => row.id === listingId);
    if (!listing) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("add");
    window.history.replaceState({}, "", url.toString());
    addToCart(listing);
    setMessage(`${listing.title} was added to your order.`);
    // Listing data is the trigger. `addToCart` intentionally reads the current cart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listings]);

  const changeQuantity = (listingId: string, increment: number) => {
    setCart((items) => items.flatMap((item) => {
      if (item.id !== listingId) return [item];
      const quantity = item.quantity + increment;
      return quantity > 0 ? [{ ...item, quantity }] : [];
    }));
  };

  const checkout = async () => {
    if (!user || cart.length === 0 || !cartMerchant) return;
    if (deliveryMethod === "delivery" && (!deliveryAddress.trim() || !deliveryPhone.trim())) { setMessage("Enter a delivery address and phone number, or choose pickup."); return; }
    setCheckingOut(true); setMessage(null);
    const customer = await ensureMarketplaceCustomer();
    if (!customer.id) { setCheckingOut(false); setMessage(customer.error || "Could not create the marketplace customer profile."); return; }
    const orderRes = await db.rpc("marketplace_checkout", {
      p_merchant_id: cartMerchant.id,
      p_lines: cart.map((item) => ({ listing_id: item.id, quantity: item.quantity })),
    });
    setCheckingOut(false);
    if (orderRes.error) { setMessage(orderRes.error.message); return; }
    const { data: placedOrderRow } = await db.from("marketplace_orders").select("id,order_number,gross_amount,currency").eq("id", orderRes.data).maybeSingle();
    const nextOrder = {
      id: String(orderRes.data),
      orderNumber: placedOrderRow?.order_number || "BOAT Market order",
      amount: Number(placedOrderRow?.gross_amount ?? cartTotal),
      currency: placedOrderRow?.currency || cart[0].currency,
    };
    const deliveryRes = await db.rpc("marketplace_set_order_delivery", {
      p_order_id: nextOrder.id,
      p_delivery_method: deliveryMethod,
      p_delivery_address: deliveryAddress || null,
      p_delivery_phone: deliveryPhone || null,
      p_delivery_note: deliveryNote || null,
    });
    if (deliveryRes.error) { setCheckingOut(false); setMessage(`Order placed, but delivery details need attention: ${deliveryRes.error.message}`); return; }
    if (promotionCode.trim()) {
      const promotionRes = await db.rpc("marketplace_apply_promotion_code", { p_order_id: nextOrder.id, p_code: promotionCode });
      if (promotionRes.error) {
        setCheckingOut(false);
        setMessage(`Order placed, but the promotion was not applied: ${promotionRes.error.message}`);
        return;
      }
      nextOrder.amount = Number(promotionRes.data?.gross_amount ?? nextOrder.amount);
    }
    setPlacedOrder(nextOrder);
    window.sessionStorage.setItem(manualOrderStorageKey, JSON.stringify({ userId: user.id, order: nextOrder } satisfies StoredManualOrder));
    setPaymentPhone(user.phone || "");
    setManualPayment(null);
    setPaymentTransactionId("");
    setCart([]);
    setPromotionCode("");
    setMessage("Your order was placed. Complete the manual Mobile Money steps below, then submit the transaction ID for verification.");
  };

  const startManualMomoPayment = async () => {
    if (!placedOrder || !paymentPhone.trim()) { setMessage("Enter the mobile money number to pay from."); return; }
    setPreparingPayment(true); setMessage(null);
    const requestRes = await db.rpc("marketplace_start_manual_momo_payment", {
      p_order_id: placedOrder.id,
      p_phone_number: paymentPhone,
      p_network: paymentNetwork,
    });
    setPreparingPayment(false);
    if (requestRes.error) { setMessage(requestRes.error.message); return; }
    const payment = requestRes.data as ManualMomoPayment;
    setManualPayment(payment);
    setMessage(payment.status === "submitted" ? "This payment is already awaiting administrator verification." : "Pay the exact amount, then submit the Mobile Money transaction ID below.");
  };

  const submitManualTransaction = async () => {
    if (!manualPayment || !paymentTransactionId.trim()) {
      setMessage("Enter the Mobile Money transaction ID from your payment confirmation message.");
      return;
    }
    setSubmittingTransaction(true); setMessage(null);
    const result = await db.rpc("marketplace_submit_manual_momo_transaction", {
      p_payment_request_id: manualPayment.payment_request_id,
      p_transaction_id: paymentTransactionId,
    });
    setSubmittingTransaction(false);
    if (result.error) { setMessage(result.error.message); return; }
    setManualPayment((current) => current ? { ...current, status: "submitted" } : current);
    setMessage("Transaction ID submitted. A marketplace administrator will verify it before the order is marked paid.");
  };

  return <section className="mx-auto max-w-7xl space-y-5 p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold text-slate-900">BOAT Market</h1><p className="mt-1 text-sm text-slate-600">Discover products and services published by connected BOAT businesses.</p></div>
      {canManageMarketplace && <button type="button" onClick={() => onNavigate?.("marketplace_merchant")} className="app-btn-primary">Manage my market sales</button>}
    </div>
    {message && <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700" role="status">{message}</p>}
    {selectedMerchant ? <section className="overflow-hidden rounded-xl border border-indigo-200 bg-white shadow-sm"><div className="min-h-40 bg-indigo-50 bg-cover bg-center p-5" style={mediaUrl(selectedMerchant.banner_path) ? { backgroundImage: `linear-gradient(90deg, rgba(15,23,42,.8), rgba(15,23,42,.3)), url(${mediaUrl(selectedMerchant.banner_path)})` } : { backgroundColor: selectedMerchant.accent_color || "#4f46e5" }}><div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-start gap-3 text-white">{mediaUrl(selectedMerchant.logo_path) && <img src={mediaUrl(selectedMerchant.logo_path) || ""} alt="" className="h-14 w-14 rounded-full border-2 border-white object-cover" />}<div><p className="text-xs font-semibold uppercase tracking-wide text-white/80">BOAT storefront</p><h2 className="mt-1 text-2xl font-semibold">{selectedMerchant.display_name}</h2><p className="mt-1 text-sm text-white/90">{selectedMerchant.storefront_headline || selectedMerchant.description || "Shop this BOAT business."}</p>{selectedMerchant.phone && <p className="mt-2 text-sm text-white/80">Contact: {selectedMerchant.phone}</p>}</div></div><div className="flex gap-3"><button type="button" onClick={() => void copyStorefrontLink()} className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-900">Copy storefront link</button><button type="button" onClick={() => selectMerchant("")} className="text-sm font-medium text-white">All businesses</button></div></div></div>{selectedMerchant.storefront_policy && <p className="border-t border-slate-100 px-5 py-3 text-sm text-slate-600">{selectedMerchant.storefront_policy}</p>}</section> : <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div><h2 className="font-semibold text-slate-900">Connected businesses</h2><p className="mt-1 text-sm text-slate-600">Businesses that have published their profile and listings to BOAT Market.</p></div>{connectedBusinesses.length > 0 ? <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{connectedBusinesses.map((merchant) => <article key={merchant.id} className="rounded-lg border border-slate-200 p-3"><h3 className="font-medium text-slate-900">{merchant.display_name}</h3><p className="mt-1 text-xs text-slate-500">BOAT business</p><button type="button" onClick={() => selectMerchant(merchant.id)} className="mt-3 text-sm font-medium text-indigo-700">Visit storefront</button></article>)}</div> : <div className="mt-4 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600"><p>No businesses have been published to BOAT Market yet.</p>{canManageMarketplace && <button type="button" onClick={() => onNavigate?.("marketplace_merchant")} className="mt-2 font-medium text-indigo-700">Set up this business as a seller</button>}</div>}</section>}
    <div className="grid gap-3 md:grid-cols-[1fr_220px_220px]"><label className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products, services or merchants" className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm" /></label><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><select value={merchantId} onChange={(event) => selectMerchant(event.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">All businesses</option>{connectedBusinesses.map((merchant) => <option key={merchant.id} value={merchant.id}>{merchant.display_name}</option>)}</select></div>
    {hiddenListingIds.size > 0 && <div className="flex justify-end"><button type="button" onClick={() => setShowHiddenListings((current) => !current)} className="inline-flex items-center gap-2 text-sm font-medium text-slate-600">{showHiddenListings ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{showHiddenListings ? "Hide removed listings" : `Show removed listings (${hiddenListingIds.size})`}</button></div>}
    {cart.length > 0 && <div className="ml-auto max-w-sm rounded-lg border border-slate-200 bg-white p-3"><label className="text-xs font-medium text-slate-700">Promotion code</label><input value={promotionCode} onChange={(event) => setPromotionCode(event.target.value.toUpperCase())} placeholder="Optional code" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div>}
    <div className="grid items-start gap-5 lg:grid-cols-[1fr_320px]">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{visibleListings.map((listing) => { const isHidden = hiddenListingIds.has(listing.id); const image = mediaUrl(listing.image_path); return <article key={listing.id} className={`flex min-h-48 flex-col overflow-hidden rounded-xl border bg-white shadow-sm ${isHidden ? "border-slate-300 opacity-70" : "border-slate-200"}`}>{image && <img src={image} alt="" className="h-40 w-full object-cover" />}<div className="flex flex-1 flex-col p-4"><p className="text-xs font-medium uppercase tracking-wide text-indigo-700">{listing.is_featured ? "Featured · " : ""}{listing.listing_type.replace("_", " ")}</p><h2 className="mt-2 font-semibold text-slate-900">{listing.title}</h2><p className="mt-1 text-sm text-slate-600">{merchants[listing.merchant_id]?.display_name || "BOAT merchant"}</p>{Number(listing.review_count || 0) > 0 && <p className="mt-1 text-xs font-medium text-amber-700">★ {Number(listing.average_rating || 0).toFixed(1)} ({listing.review_count} {Number(listing.review_count) === 1 ? "review" : "reviews"})</p>}{listing.available_quantity !== null && <p className={`mt-1 text-xs ${Number(listing.available_quantity) > 0 ? "text-emerald-700" : "text-rose-700"}`}>{Number(listing.available_quantity) > 0 ? `${listing.available_quantity} available` : "Out of stock"}</p>}{listing.description && <p className="mt-3 line-clamp-3 text-sm text-slate-600">{listing.description}</p>}<div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4"><div><p className="font-semibold text-slate-900">{money(listing.price, listing.currency)}</p>{listing.compare_at_price && <p className="text-xs text-slate-400 line-through">{money(listing.compare_at_price, listing.currency)}</p>}</div><div className="flex items-center gap-2">{isHidden ? <button type="button" onClick={() => void restoreListing(listing)} className="text-xs font-medium text-indigo-700">Restore</button> : <button type="button" onClick={() => void hideListing(listing)} className="text-xs font-medium text-slate-600">Not interested</button>}<button type="button" disabled={isHidden || (listing.available_quantity !== null && Number(listing.available_quantity) <= 0)} onClick={() => addToCart(listing)} className="app-btn-secondary disabled:cursor-not-allowed disabled:opacity-50"><Plus className="h-4 w-4" /> {listing.available_quantity !== null && Number(listing.available_quantity) <= 0 ? "Sold out" : "Add"}</button></div></div></div></article>; })}{visibleListings.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-600 sm:col-span-2 xl:col-span-3">{hiddenListingIds.size > 0 && !showHiddenListings ? "No listings match. You can show listings you removed above." : "No published listings match that search yet."}</p>}</div>
      <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><ShoppingCart className="h-5 w-5 text-indigo-700" /><h2 className="font-semibold text-slate-900">Your order</h2></div>{cartMerchant && <p className="mt-1 text-sm text-slate-600">From {cartMerchant.display_name}</p>}<div className="mt-4 space-y-3">{cart.map((item) => <div key={item.id} className="border-b border-slate-100 pb-3"><p className="text-sm font-medium text-slate-900">{item.title}</p><div className="mt-2 flex items-center justify-between"><div className="flex items-center gap-2"><button type="button" onClick={() => changeQuantity(item.id, -1)} className="rounded border border-slate-300 p-1" aria-label={`Remove one ${item.title}`}><Minus className="h-3 w-3" /></button><span className="min-w-5 text-center text-sm">{item.quantity}</span><button type="button" onClick={() => changeQuantity(item.id, 1)} className="rounded border border-slate-300 p-1" aria-label={`Add one ${item.title}`}><Plus className="h-3 w-3" /></button></div><span className="text-sm">{money(Number(item.price) * item.quantity, item.currency)}</span></div></div>)}{cart.length === 0 && <p className="text-sm text-slate-500">Your order is empty.</p>}</div>{cart.length > 0 && <><div className="mt-4 border-t border-slate-200 pt-3"><label className="text-xs font-medium text-slate-700">How should you receive the order?</label><select value={deliveryMethod} onChange={(event) => setDeliveryMethod(event.target.value as "pickup" | "delivery")} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="pickup">Collect / pickup</option><option value="delivery">Delivery</option></select>{deliveryMethod === "delivery" && <div className="mt-2 space-y-2"><input value={deliveryPhone} onChange={(event) => setDeliveryPhone(event.target.value)} inputMode="tel" placeholder="Delivery phone number" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /><textarea value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} placeholder="Delivery address, area and directions" className="min-h-16 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div>}<input value={deliveryNote} onChange={(event) => setDeliveryNote(event.target.value)} placeholder="Order note for the merchant (optional)" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div><div className="mt-4 flex justify-between border-t border-slate-200 pt-3 font-semibold"><span>Total</span><span>{money(cartTotal, cart[0].currency)}</span></div><button type="button" onClick={() => void checkout()} disabled={checkingOut} className="app-btn-primary mt-4 w-full">{checkingOut ? "Placing order…" : "Place order"}</button></>}</aside>
    </div>
    {placedOrder && <section className="rounded-xl border border-indigo-200 bg-indigo-50 p-5">
      <div><h2 className="font-semibold text-slate-900">Manual Mobile Money checkout</h2><p className="mt-1 text-sm text-slate-600">Order reference: <span className="font-semibold">{placedOrder.orderNumber}</span> · {money(placedOrder.amount, placedOrder.currency)}</p></div>
      {!manualPayment ? <div className="mt-4 grid gap-3 md:grid-cols-[180px_1fr_auto]"><select value={paymentNetwork} onChange={(event) => setPaymentNetwork(event.target.value as "mtn" | "airtel")} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="mtn">Paying from MTN Mobile Money</option><option value="airtel">Paying from Airtel Money</option></select><input value={paymentPhone} onChange={(event) => setPaymentPhone(event.target.value)} inputMode="tel" placeholder="Mobile money number you are paying from" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><button type="button" onClick={() => void startManualMomoPayment()} disabled={preparingPayment} className="app-btn-primary">{preparingPayment ? "Preparing…" : "Show payment instructions"}</button></div> : <div className="mt-4 rounded-lg border border-indigo-200 bg-white p-4"><div className="grid gap-3 text-sm md:grid-cols-2"><p><span className="font-medium text-slate-700">Pay to:</span> {manualPayment.recipient_name}</p><p><span className="font-medium text-slate-700">Receiving number:</span> {manualPayment.recipient_phone} ({manualPayment.recipient_network.toUpperCase()})</p><p><span className="font-medium text-slate-700">Amount:</span> {money(manualPayment.amount, manualPayment.currency)}</p><p><span className="font-medium text-slate-700">Payment reference:</span> <span className="font-mono">{manualPayment.payment_reference}</span></p></div>{manualPayment.payment_instructions && <p className="mt-3 rounded bg-slate-50 p-3 text-sm text-slate-700">{manualPayment.payment_instructions}</p>}{manualPayment.status === "submitted" ? <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p className="font-semibold">Transaction submitted for verification</p><p className="mt-1">The order will be marked paid only after an administrator verifies the transaction in the MoMo statement.</p></div> : <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]"><input value={paymentTransactionId} onChange={(event) => setPaymentTransactionId(event.target.value)} placeholder="Mobile Money transaction ID from your confirmation message" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><button type="button" onClick={() => void submitManualTransaction()} disabled={submittingTransaction} className="app-btn-primary">{submittingTransaction ? "Submitting…" : "Submit transaction ID"}</button></div>}</div>}
    </section>}
    <MarketplaceCustomerActivityPanel refreshKey={`${placedOrder?.id || ""}:${manualPayment?.status || ""}`} />
  </section>;
}
