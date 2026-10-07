import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, ExternalLink, Loader2, Search, ShoppingBag } from "lucide-react";
import { supabase } from "@/lib/supabase";

const db = supabase as any;

type Merchant = {
  id: string;
  display_name: string;
  public_slug: string;
  description: string | null;
  phone: string | null;
  logo_path: string | null;
  banner_path: string | null;
  accent_color: string | null;
  storefront_headline: string | null;
  storefront_policy: string | null;
};

type Listing = {
  id: string;
  title: string;
  description: string | null;
  listing_type: string;
  price: number;
  currency: string;
  available_quantity: number | null;
  image_path: string | null;
  compare_at_price: number | null;
  is_featured: boolean;
};

const money = (amount: number, currency = "UGX") => `${currency} ${Number(amount || 0).toLocaleString()}`;
const mediaUrl = (path: string | null | undefined) => path
  ? supabase.storage.from("marketplace-storefront-media").getPublicUrl(path).data.publicUrl
  : null;

/** A shareable, no-login catalogue. Ordering deliberately moves into the authenticated BOAT flow. */
export function PublicStorefrontPage() {
  const storeSlug = useMemo(() => new URLSearchParams(window.location.search).get("store")?.trim().toLowerCase() || "", []);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!storeSlug) {
      setLoading(false);
      setError("This storefront link is incomplete.");
      return;
    }

    setLoading(true);
    setError(null);
    const merchantRes = await db
      .from("marketplace_merchant_profiles")
      .select("id,display_name,public_slug,description,phone,logo_path,banner_path,accent_color,storefront_headline,storefront_policy")
      .eq("public_slug", storeSlug)
      .eq("is_published", true)
      .maybeSingle();

    if (merchantRes.error) {
      setError(merchantRes.error.message);
      setLoading(false);
      return;
    }
    if (!merchantRes.data) {
      setError("This store is not available. It may not be published yet.");
      setLoading(false);
      return;
    }

    const nextMerchant = merchantRes.data as Merchant;
    const listingRes = await db
      .from("marketplace_listings")
      .select("id,title,description,listing_type,price,currency,available_quantity,image_path,compare_at_price,is_featured")
      .eq("merchant_id", nextMerchant.id)
      .eq("is_published", true)
      .order("is_featured", { ascending: false })
      .order("created_at", { ascending: false });

    if (listingRes.error) {
      setError(listingRes.error.message);
      setLoading(false);
      return;
    }

    setMerchant(nextMerchant);
    setListings((listingRes.data || []) as Listing[]);
    setLoading(false);
  }, [storeSlug]);

  useEffect(() => { void load(); }, [load]);

  const visibleListings = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return listings;
    return listings.filter((listing) => `${listing.title} ${listing.description || ""} ${listing.listing_type}`.toLocaleLowerCase().includes(term));
  }, [listings, search]);

  const openSecureCheckout = (listingId?: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("page", "marketplace");
    if (merchant) url.searchParams.set("store", merchant.public_slug);
    if (listingId) url.searchParams.set("add", listingId); else url.searchParams.delete("add");
    window.location.assign(url.toString());
  };

  if (loading) {
    return <main className="min-h-screen bg-slate-50 p-6"><div className="mx-auto flex min-h-[50vh] max-w-6xl items-center justify-center gap-2 text-sm text-slate-600"><Loader2 className="h-5 w-5 animate-spin" /> Loading storefront…</div></main>;
  }

  if (!merchant || error) {
    return <main className="min-h-screen bg-slate-50 p-6"><section className="mx-auto mt-16 max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm"><Building2 className="mx-auto h-10 w-10 text-indigo-600" /><h1 className="mt-4 text-xl font-semibold text-slate-900">Storefront unavailable</h1><p className="mt-2 text-sm text-slate-600">{error || "This BOAT store could not be found."}</p><button type="button" onClick={() => window.location.assign(`${window.location.pathname}?page=marketplace`)} className="app-btn-primary mt-6"><ArrowLeft className="h-4 w-4" /> Browse BOAT Market</button></section></main>;
  }

  const banner = mediaUrl(merchant.banner_path);
  const logo = mediaUrl(merchant.logo_path);

  return <main className="min-h-screen bg-slate-50 text-slate-900">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4"><button type="button" onClick={() => window.location.assign(`${window.location.pathname}?page=marketplace`)} className="inline-flex items-center gap-2 font-semibold text-slate-900"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500 text-sm font-bold text-white">B</span> BOAT Market</button><button type="button" onClick={openSecureCheckout} className="app-btn-secondary"><ShoppingBag className="h-4 w-4" /> Sign in to order</button></div></header>
    <section className="mx-auto max-w-6xl px-5 py-6">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="min-h-56 bg-cover bg-center p-6 sm:p-8" style={banner ? { backgroundImage: `linear-gradient(90deg, rgba(15,23,42,.86), rgba(15,23,42,.34)), url(${banner})` } : { backgroundColor: merchant.accent_color || "#4f46e5" }}>
          <div className="flex min-h-40 flex-wrap items-end justify-between gap-5 text-white">
            <div className="flex max-w-2xl items-start gap-4">{logo ? <img src={logo} alt={`${merchant.display_name} logo`} className="h-16 w-16 rounded-full border-2 border-white object-cover shadow" /> : <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-white bg-white/20 text-xl font-bold">{merchant.display_name.slice(0, 1).toUpperCase()}</span>}<div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/75">BOAT verified storefront</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">{merchant.display_name}</h1><p className="mt-2 text-sm leading-6 text-white/90">{merchant.storefront_headline || merchant.description || "Browse products and services from this BOAT business."}</p>{merchant.phone && <p className="mt-3 text-sm text-white/80">Contact: {merchant.phone}</p>}</div></div>
            <button type="button" onClick={openSecureCheckout} className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 shadow-sm"><ShoppingBag className="h-4 w-4" /> Shop securely</button>
          </div>
        </div>
        {merchant.storefront_policy && <p className="border-t border-slate-100 px-6 py-3 text-sm text-slate-600">{merchant.storefront_policy}</p>}
      </div>

      <div className="mt-8 flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-xl font-semibold">Shop catalogue</h2><p className="mt-1 text-sm text-slate-600">Select an item, then sign in to BOAT for secure ordering and payment verification.</p></div><label className="relative w-full sm:w-80"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search this store" className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm shadow-sm" /></label></div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{visibleListings.map((listing) => { const image = mediaUrl(listing.image_path); const soldOut = listing.available_quantity !== null && Number(listing.available_quantity) <= 0; return <article key={listing.id} className="flex min-h-72 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">{image ? <img src={image} alt={listing.title} className="h-44 w-full object-cover" /> : <div className="flex h-44 items-center justify-center bg-slate-100 text-sm text-slate-400"><ShoppingBag className="mr-2 h-5 w-5" /> {listing.listing_type.replace("_", " ")}</div>}<div className="flex flex-1 flex-col p-4"><p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">{listing.is_featured ? "Featured · " : ""}{listing.listing_type.replace("_", " ")}</p><h3 className="mt-2 font-semibold text-slate-900">{listing.title}</h3>{listing.description && <p className="mt-2 line-clamp-3 text-sm text-slate-600">{listing.description}</p>}{listing.available_quantity !== null && <p className={`mt-2 text-xs font-medium ${soldOut ? "text-rose-700" : "text-emerald-700"}`}>{soldOut ? "Currently unavailable" : `${listing.available_quantity} available`}</p>}<div className="mt-auto flex items-end justify-between gap-3 pt-5"><div><p className="font-semibold text-slate-900">{money(listing.price, listing.currency)}</p>{listing.compare_at_price && <p className="text-xs text-slate-400 line-through">{money(listing.compare_at_price, listing.currency)}</p>}</div><button type="button" onClick={() => openSecureCheckout(listing.id)} disabled={soldOut} className="app-btn-primary disabled:cursor-not-allowed disabled:opacity-50">{soldOut ? "Unavailable" : "Order"}</button></div></div></article>; })}</div>
      {visibleListings.length === 0 && <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">{search ? "No products match that search." : "This store has no published products yet."}</div>}
      <section className="mt-8 rounded-xl border border-indigo-200 bg-indigo-50 p-5 text-center"><h2 className="font-semibold text-slate-900">Ready to order?</h2><p className="mt-1 text-sm text-slate-600">Sign in or create a BOAT account to place your order, choose delivery, pay by Mobile Money, and track verification.</p><button type="button" onClick={openSecureCheckout} className="app-btn-primary mt-4"><ExternalLink className="h-4 w-4" /> Continue to secure checkout</button></section>
    </section>
  </main>;
}
