import { useCallback, useEffect, useMemo, useState } from "react";
import { Globe2, Plus, Save } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { MarketplaceMerchantOrdersPanel } from "./MarketplaceMerchantOrdersPanel";
import { MarketplaceFinancePanel } from "./MarketplaceFinancePanel";
import { MarketplaceSchoolFeeConnector } from "./MarketplaceSchoolFeeConnector";
import { MarketplaceHotelRoomConnector } from "./MarketplaceHotelRoomConnector";
import { MarketplaceManualMomoSettingsPanel } from "./MarketplaceManualMomoSettingsPanel";
import { MarketplaceManualMomoVerificationPanel } from "./MarketplaceManualMomoVerificationPanel";
import { MarketplaceCommissionRegister } from "./MarketplaceCommissionRegister";
import { MarketplaceStoreLaunchChecklist } from "./MarketplaceStoreLaunchChecklist";
import { MarketplacePromotionsPanel } from "./MarketplacePromotionsPanel";

const db = supabase as any;
type Category = { id: string; name: string };
type Merchant = { id: string; display_name: string; public_slug: string; description: string | null; phone: string | null; is_published: boolean; logo_path: string | null; banner_path: string | null; accent_color: string | null; storefront_headline: string | null; storefront_policy: string | null };
type Listing = { id: string; title: string; listing_type: string; price: number; available_quantity: number | null; is_published: boolean; source_module: string | null; source_record_id: string | null; image_path: string | null; compare_at_price: number | null; is_featured: boolean; marketplace_categories: { name: string } | null };
type Product = { id: string; name: string; sales_price: number | null; active: boolean | null; saleable: boolean | null; track_inventory: boolean | null };

const slugify = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export function MarketplaceMerchantPanel() {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const isHotel = user?.business_type === "hotel" || user?.business_type === "mixed";
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [catalogueSearch, setCatalogueSearch] = useState("");
  const [selectedCatalogueProductIds, setSelectedCatalogueProductIds] = useState<string[]>([]);
  const [draft, setDraft] = useState({ display_name: "", public_slug: "", description: "", phone: "", is_published: false, accent_color: "#4f46e5", storefront_headline: "", storefront_policy: "" });
  const [listing, setListing] = useState({ title: "", category_id: "", listing_type: "product", price: "", is_published: false });
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    const [merchantRes, categoryRes, productRes] = await Promise.all([
      db.from("marketplace_merchant_profiles").select("id,display_name,public_slug,description,phone,is_published,logo_path,banner_path,accent_color,storefront_headline,storefront_policy").eq("organization_id", orgId).maybeSingle(),
      db.from("marketplace_categories").select("id,name").eq("is_active", true).order("sort_order"),
      db.from("products").select("id,name,sales_price,active,saleable,track_inventory").eq("organization_id", orgId).eq("active", true).order("name"),
    ]);
    if (merchantRes.error || categoryRes.error || productRes.error) { setMessage((merchantRes.error || categoryRes.error || productRes.error).message); return; }
    const current = merchantRes.data as Merchant | null;
    setMerchant(current); setCategories((categoryRes.data || []) as Category[]); setProducts(((productRes.data || []) as Product[]).filter((product) => product.saleable !== false));
    setDraft(current ? { display_name: current.display_name, public_slug: current.public_slug, description: current.description || "", phone: current.phone || "", is_published: current.is_published, accent_color: current.accent_color || "#4f46e5", storefront_headline: current.storefront_headline || "", storefront_policy: current.storefront_policy || "" } : { display_name: "", public_slug: "", description: "", phone: "", is_published: false, accent_color: "#4f46e5", storefront_headline: "", storefront_policy: "" });
    if (!current) { setListings([]); return; }
    const listingRes = await db.from("marketplace_listings").select("id,title,listing_type,price,available_quantity,is_published,source_module,source_record_id,image_path,compare_at_price,is_featured,marketplace_categories(name)").eq("merchant_id", current.id).order("created_at", { ascending: false });
    if (listingRes.error) setMessage(listingRes.error.message); else setListings((listingRes.data || []) as Listing[]);
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  const publishedProductIds = useMemo(() => new Set(
    listings.filter((row) => row.source_module === "retail_product" && row.source_record_id).map((row) => row.source_record_id as string)
  ), [listings]);
  const catalogueProducts = useMemo(() => {
    const search = catalogueSearch.trim().toLowerCase();
    return !search ? products : products.filter((product) => product.name.toLowerCase().includes(search));
  }, [catalogueSearch, products]);
  const canAdministerManualMomo = Boolean(
    user?.isSuperAdmin || ["admin", "super_admin"].includes(String(user?.role ?? "").trim().toLowerCase())
  );

  const saveMerchant = async () => {
    if (!orgId || !draft.display_name.trim()) { setMessage("Enter the public business name."); return; }
    const public_slug = slugify(draft.public_slug || draft.display_name);
    if (!public_slug) { setMessage("Enter a valid marketplace address."); return; }
    setSaving(true); setMessage(null);
    const uploadBrandImage = async (file: File | null, kind: "logo" | "banner") => {
      if (!file) return null;
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
      const path = `${orgId}/branding/${kind}-${crypto.randomUUID()}-${safeName}`;
      const upload = await supabase.storage.from("marketplace-storefront-media").upload(path, file, { contentType: file.type || undefined });
      if (upload.error) throw upload.error;
      return path;
    };
    let logoPath = merchant?.logo_path || null;
    let bannerPath = merchant?.banner_path || null;
    try { logoPath = (await uploadBrandImage(logoFile, "logo")) || logoPath; bannerPath = (await uploadBrandImage(bannerFile, "banner")) || bannerPath; } catch (error: any) { setSaving(false); setMessage(error.message || "Could not upload storefront image."); return; }
    const result = await db.from("marketplace_merchant_profiles").upsert({ organization_id: orgId, ...draft, public_slug, description: draft.description.trim() || null, phone: draft.phone.trim() || null, storefront_headline: draft.storefront_headline.trim() || null, storefront_policy: draft.storefront_policy.trim() || null, logo_path: logoPath, banner_path: bannerPath }, { onConflict: "organization_id" });
    setSaving(false);
    if (result.error) setMessage(result.error.message); else { setLogoFile(null); setBannerFile(null); setMessage("Marketplace profile saved."); await load(); }
  };

  const uploadListingImage = async (row: Listing, file: File | null) => {
    if (!file || !orgId) return;
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const path = `${orgId}/listings/${row.id}-${crypto.randomUUID()}-${safeName}`;
    setSaving(true); setMessage(null);
    const upload = await supabase.storage.from("marketplace-storefront-media").upload(path, file, { contentType: file.type || undefined });
    if (upload.error) { setSaving(false); setMessage(upload.error.message); return; }
    const result = await db.from("marketplace_listings").update({ image_path: path }).eq("id", row.id).eq("organization_id", orgId);
    setSaving(false);
    if (result.error) setMessage(result.error.message); else { setMessage(`${row.title} image updated.`); await load(); }
  };

  const createListing = async () => {
    if (!merchant || !listing.title.trim() || !(Number(listing.price) >= 0)) { setMessage("Save the profile, then enter a listing name and price."); return; }
    setSaving(true); setMessage(null);
    const result = await db.from("marketplace_listings").insert({ organization_id: orgId, merchant_id: merchant.id, title: listing.title.trim(), category_id: listing.category_id || null, listing_type: listing.listing_type, price: Number(listing.price), is_published: listing.is_published });
    setSaving(false);
    if (result.error) setMessage(result.error.message); else { setListing({ title: "", category_id: "", listing_type: "product", price: "", is_published: false }); setMessage("Listing created."); await load(); }
  };

  const publishCatalogueProducts = async (productIds: string[]) => {
    const selectedProducts = products.filter((product) => productIds.includes(product.id));
    if (!merchant || !selectedProducts.length || !orgId) { setMessage("Save the profile, then select one or more BOAT products to publish."); return; }
    setSaving(true); setMessage(null);
    const currentListings = new Map(listings.filter((row) => row.source_module === "retail_product" && row.source_record_id).map((row) => [row.source_record_id as string, row]));
    let errorMessage: string | null = null;
    for (const product of selectedProducts) {
      const listingData = { title: product.name, listing_type: "product", price: Number(product.sales_price || 0), is_published: true };
      const existing = currentListings.get(product.id);
      const result = existing
        ? await db.from("marketplace_listings").update(listingData).eq("id", existing.id).eq("organization_id", orgId)
        : await db.from("marketplace_listings").insert({ ...listingData, organization_id: orgId, merchant_id: merchant.id, source_module: "retail_product", source_record_id: product.id });
      if (result.error) { errorMessage = result.error.message; break; }
    }
    setSaving(false);
    if (errorMessage) { setMessage(errorMessage); return; }
    setSelectedCatalogueProductIds([]);
    setMessage(`${selectedProducts.length} ${selectedProducts.length === 1 ? "product is" : "products are"} now published from BOAT inventory.`);
    await load();
  };

  const toggleListing = async (row: Listing) => {
    const result = await db.from("marketplace_listings").update({ is_published: !row.is_published }).eq("id", row.id).eq("organization_id", orgId);
    if (result.error) setMessage(result.error.message); else await load();
  };

  const copyStorefrontLink = async () => {
    if (!merchant) return;
    const url = new URL(window.location.href);
    url.searchParams.set("page", "marketplace");
    url.searchParams.set("store", merchant.public_slug);
    try {
      await navigator.clipboard.writeText(url.toString());
      setMessage("Storefront link copied. Share it with BOAT Market buyers.");
    } catch {
      setMessage(`Storefront link: ${url.toString()}`);
    }
  };

  return <section className="space-y-4 rounded-xl border border-indigo-200 bg-indigo-50/40 p-5">
    <div><div className="flex items-center gap-2"><Globe2 className="h-5 w-5 text-indigo-700" /><h2 className="font-semibold text-slate-900">My BOAT Market sales</h2></div><p className="mt-1 text-sm text-slate-600">This is your native BOAT storefront: create the public business profile, publish your catalogue, share your storefront link, and manage marketplace orders. Shopify is not required.</p>{isHotel && <p className="mt-2 rounded-lg bg-white/80 px-3 py-2 text-sm text-indigo-900">For this hotel, publish room booking requests, restaurant offers, conference packages, or other hotel services. Use the <strong>Room</strong> listing type and state the nightly rate or package terms clearly; the hotel confirms the stay details after the buyer places the request.</p>}</div>
    {message && <p className="text-sm text-slate-700" role="status">{message}</p>}
    <div className="grid gap-3 md:grid-cols-2"><input value={draft.display_name} onChange={(e) => setDraft((v) => ({ ...v, display_name: e.target.value, public_slug: v.public_slug || slugify(e.target.value) }))} placeholder="Public business name" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><input value={draft.public_slug} onChange={(e) => setDraft((v) => ({ ...v, public_slug: e.target.value }))} placeholder="marketplace address e.g. lakeview-hotel" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><input value={draft.phone} onChange={(e) => setDraft((v) => ({ ...v, phone: e.target.value }))} placeholder="Public phone" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={draft.is_published} onChange={(e) => setDraft((v) => ({ ...v, is_published: e.target.checked }))} /> Publish merchant profile</label><textarea value={draft.description} onChange={(e) => setDraft((v) => ({ ...v, description: e.target.value }))} placeholder="Describe your business" className="min-h-20 rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2" /></div>
    <div className="mt-3 grid gap-3 md:grid-cols-2"><input value={draft.storefront_headline} onChange={(e) => setDraft((v) => ({ ...v, storefront_headline: e.target.value }))} placeholder="Storefront headline, e.g. Everyday value delivered" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><label className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm">Brand colour <input type="color" value={draft.accent_color} onChange={(e) => setDraft((v) => ({ ...v, accent_color: e.target.value }))} className="ml-auto h-7 w-10" /></label><label className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-700">Logo image <input type="file" accept="image/jpeg,image/png,image/webp" className="mt-1 block w-full text-xs" onChange={(e) => setLogoFile(e.target.files?.[0] || null)} /></label><label className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-700">Store banner image <input type="file" accept="image/jpeg,image/png,image/webp" className="mt-1 block w-full text-xs" onChange={(e) => setBannerFile(e.target.files?.[0] || null)} /></label><textarea value={draft.storefront_policy} onChange={(e) => setDraft((v) => ({ ...v, storefront_policy: e.target.value }))} placeholder="Customer policy: delivery, returns or collection information" className="min-h-16 rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2" /></div>
    <div className="flex flex-wrap gap-3"><button type="button" onClick={() => void saveMerchant()} disabled={saving} className="app-btn-primary"><Save className="h-4 w-4" /> Save profile</button>{merchant?.is_published && <button type="button" onClick={() => void copyStorefrontLink()} className="app-btn-secondary">Copy storefront link</button>}</div>
    {!merchant && <p className="rounded-lg border border-dashed border-indigo-300 bg-white/70 px-3 py-2 text-sm text-slate-700">Save the business profile first. BOAT will then show this organisation's launch checklist and catalogue tools.</p>}
    {merchant && <div className="border-t border-indigo-200 pt-4">
      {orgId && <MarketplaceStoreLaunchChecklist organizationId={orgId} merchantId={merchant.id} profilePublished={merchant.is_published} publishedListings={listings.filter((row) => row.is_published).length} inventoryProducts={products.length} canConfigurePayments={canAdministerManualMomo} />}
      <h3 className="font-semibold text-slate-900">Build your product catalogue</h3>
      <p className="mt-1 text-sm text-slate-600">Select one or many active BOAT inventory products to publish at once. Published products remain linked to their inventory record; publish them again after changing a name or price to refresh the storefront.</p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row"><input value={catalogueSearch} onChange={(event) => setCatalogueSearch(event.target.value)} placeholder="Filter your BOAT products" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" /><button type="button" onClick={() => void publishCatalogueProducts(catalogueProducts.map((product) => product.id))} disabled={saving || catalogueProducts.length === 0} className="app-btn-secondary shrink-0">Publish all matching</button></div>
      {catalogueProducts.length > 0 && <div className="mt-3 max-h-64 divide-y overflow-y-auto rounded-lg border border-slate-200 bg-white">{catalogueProducts.map((product) => { const selected = selectedCatalogueProductIds.includes(product.id); const published = publishedProductIds.has(product.id); return <label key={product.id} className="flex cursor-pointer items-center gap-3 p-3 text-sm"><input type="checkbox" checked={selected} onChange={() => setSelectedCatalogueProductIds((current) => current.includes(product.id) ? current.filter((id) => id !== product.id) : [...current, product.id])} /><span className="min-w-0 flex-1"><span className="block truncate font-medium text-slate-900">{product.name}</span><span className="text-xs text-slate-500">UGX {Number(product.sales_price || 0).toLocaleString()}{published ? " · Published" : ""}</span></span></label>; })}</div>}
      {selectedCatalogueProductIds.length > 0 && <button type="button" onClick={() => void publishCatalogueProducts(selectedCatalogueProductIds)} disabled={saving} className="app-btn-primary mt-3"><Globe2 className="h-4 w-4" /> Publish selected ({selectedCatalogueProductIds.length})</button>}
      {products.length === 0 && <p className="mt-2 text-sm text-slate-500">There are no active, saleable products in BOAT inventory yet.</p>}

      <h3 className="mt-5 font-semibold text-slate-900">New marketplace listing</h3>
      <div className="mt-3 grid gap-3 md:grid-cols-4"><input value={listing.title} onChange={(e) => setListing((v) => ({ ...v, title: e.target.value }))} placeholder="Product or service" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><select value={listing.category_id} onChange={(e) => setListing((v) => ({ ...v, category_id: e.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">Category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><select value={listing.listing_type} onChange={(e) => setListing((v) => ({ ...v, listing_type: e.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="product">Product</option><option value="service">Service</option><option value="room">Room</option><option value="insurance">Insurance</option><option value="school_item">School item</option></select><input type="number" min="0" value={listing.price} onChange={(e) => setListing((v) => ({ ...v, price: e.target.value }))} placeholder="Price UGX" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div><label className="mt-3 flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={listing.is_published} onChange={(e) => setListing((v) => ({ ...v, is_published: e.target.checked }))} /> Publish immediately</label><button type="button" onClick={() => void createListing()} disabled={saving} className="app-btn-secondary mt-3"><Plus className="h-4 w-4" /> Add listing</button>

      <h3 className="mt-5 font-semibold text-slate-900">Marketplace listings</h3>
      <div className="mt-3 divide-y rounded-lg border border-slate-200 bg-white">{listings.map((row) => <div key={row.id} className="flex items-center justify-between gap-3 p-3 text-sm"><div><p className="font-medium text-slate-900">{row.title}</p><p className="text-xs text-slate-500">{row.marketplace_categories?.name || "Uncategorized"} · {row.listing_type} · UGX {Number(row.price).toLocaleString()}{row.source_module === "retail_product" ? ` · ${row.available_quantity ?? 0} available · BOAT inventory` : ""}</p></div><button type="button" onClick={() => void toggleListing(row)} className={row.is_published ? "text-rose-700" : "text-emerald-700"}>{row.is_published ? "Remove from storefront" : "Publish to storefront"}</button></div>)}{listings.length === 0 && <p className="p-3 text-sm text-slate-500">No listings yet.</p>}</div>
      {listings.length > 0 && <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3"><p className="text-sm font-medium text-slate-900">Catalogue product images</p><p className="mt-1 text-xs text-slate-500">Add a JPEG, PNG or WebP image to make each storefront card more engaging.</p><div className="mt-3 space-y-2">{listings.map((row) => <label key={row.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-2 text-sm"><span className="font-medium text-slate-800">{row.title}{row.image_path ? " · Image added" : ""}</span><span className="text-indigo-700">Upload image<input type="file" accept="image/jpeg,image/png,image/webp" className="ml-2 text-xs text-slate-500" disabled={saving} onChange={(event) => void uploadListingImage(row, event.target.files?.[0] || null)} /></span></label>)}</div></div>}
      {canAdministerManualMomo && orgId && <MarketplaceManualMomoSettingsPanel organizationId={orgId} />}
      {canAdministerManualMomo && orgId && <MarketplaceManualMomoVerificationPanel merchantId={merchant.id} organizationId={orgId} />}
      {orgId && <MarketplaceCommissionRegister merchantId={merchant.id} />}
      {orgId && <MarketplacePromotionsPanel organizationId={orgId} merchantId={merchant.id} />}
      {orgId && <MarketplaceMerchantOrdersPanel merchantId={merchant.id} organizationId={orgId} />}
      {orgId && <MarketplaceFinancePanel merchantId={merchant.id} organizationId={orgId} />}
      {orgId && user?.business_type === "school" && <MarketplaceSchoolFeeConnector merchantId={merchant.id} organizationId={orgId} />}
      {orgId && isHotel && <MarketplaceHotelRoomConnector merchantId={merchant.id} organizationId={orgId} />}
    </div>}
  </section>;
}
