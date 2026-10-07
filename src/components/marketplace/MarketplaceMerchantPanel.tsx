import { useCallback, useEffect, useState } from "react";
import { Globe2, Plus, Save } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { MarketplaceMerchantOrdersPanel } from "./MarketplaceMerchantOrdersPanel";
import { MarketplaceFinancePanel } from "./MarketplaceFinancePanel";
import { MarketplaceSchoolFeeConnector } from "./MarketplaceSchoolFeeConnector";

const db = supabase as any;
type Category = { id: string; name: string };
type Merchant = { id: string; display_name: string; public_slug: string; description: string | null; phone: string | null; is_published: boolean };
type Listing = { id: string; title: string; listing_type: string; price: number; available_quantity: number | null; is_published: boolean; source_module: string | null; source_record_id: string | null; marketplace_categories: { name: string } | null };
type Product = { id: string; name: string; sales_price: number | null; active: boolean | null; saleable: boolean | null; track_inventory: boolean | null };

const slugify = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export function MarketplaceMerchantPanel() {
  const { user } = useAuth();
  const orgId = user?.organization_id;
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [draft, setDraft] = useState({ display_name: "", public_slug: "", description: "", phone: "", is_published: false });
  const [listing, setListing] = useState({ title: "", category_id: "", listing_type: "product", price: "", is_published: false });
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    const [merchantRes, categoryRes, productRes] = await Promise.all([
      db.from("marketplace_merchant_profiles").select("id,display_name,public_slug,description,phone,is_published").eq("organization_id", orgId).maybeSingle(),
      db.from("marketplace_categories").select("id,name").eq("is_active", true).order("sort_order"),
      db.from("products").select("id,name,sales_price,active,saleable,track_inventory").eq("organization_id", orgId).eq("active", true).order("name").limit(250),
    ]);
    if (merchantRes.error || categoryRes.error || productRes.error) { setMessage((merchantRes.error || categoryRes.error || productRes.error).message); return; }
    const current = merchantRes.data as Merchant | null;
    setMerchant(current); setCategories((categoryRes.data || []) as Category[]); setProducts(((productRes.data || []) as Product[]).filter((product) => product.saleable !== false));
    setDraft(current ? { display_name: current.display_name, public_slug: current.public_slug, description: current.description || "", phone: current.phone || "", is_published: current.is_published } : { display_name: "", public_slug: "", description: "", phone: "", is_published: false });
    if (!current) { setListings([]); return; }
    const listingRes = await db.from("marketplace_listings").select("id,title,listing_type,price,available_quantity,is_published,source_module,source_record_id,marketplace_categories(name)").eq("merchant_id", current.id).order("created_at", { ascending: false });
    if (listingRes.error) setMessage(listingRes.error.message); else setListings((listingRes.data || []) as Listing[]);
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  const saveMerchant = async () => {
    if (!orgId || !draft.display_name.trim()) { setMessage("Enter the public business name."); return; }
    const public_slug = slugify(draft.public_slug || draft.display_name);
    if (!public_slug) { setMessage("Enter a valid marketplace address."); return; }
    setSaving(true); setMessage(null);
    const result = await db.from("marketplace_merchant_profiles").upsert({ organization_id: orgId, ...draft, public_slug, description: draft.description.trim() || null, phone: draft.phone.trim() || null }, { onConflict: "organization_id" });
    setSaving(false);
    if (result.error) setMessage(result.error.message); else { setMessage("Marketplace profile saved."); await load(); }
  };

  const createListing = async () => {
    if (!merchant || !listing.title.trim() || !(Number(listing.price) >= 0)) { setMessage("Save the profile, then enter a listing name and price."); return; }
    setSaving(true); setMessage(null);
    const result = await db.from("marketplace_listings").insert({ organization_id: orgId, merchant_id: merchant.id, title: listing.title.trim(), category_id: listing.category_id || null, listing_type: listing.listing_type, price: Number(listing.price), is_published: listing.is_published });
    setSaving(false);
    if (result.error) setMessage(result.error.message); else { setListing({ title: "", category_id: "", listing_type: "product", price: "", is_published: false }); setMessage("Listing created."); await load(); }
  };

  const publishExistingProduct = async () => {
    const product = products.find((row) => row.id === selectedProductId);
    if (!merchant || !product || !orgId) { setMessage("Save the profile, then choose a BOAT product to publish."); return; }
    setSaving(true); setMessage(null);
    const existing = await db.from("marketplace_listings").select("id").eq("merchant_id", merchant.id).eq("source_module", "retail_product").eq("source_record_id", product.id).maybeSingle();
    if (existing.error) { setSaving(false); setMessage(existing.error.message); return; }
    const listingData = { title: product.name, listing_type: "product", price: Number(product.sales_price || 0), is_published: true };
    const result = existing.data
      ? await db.from("marketplace_listings").update(listingData).eq("id", existing.data.id).eq("organization_id", orgId)
      : await db.from("marketplace_listings").insert({ ...listingData, organization_id: orgId, merchant_id: merchant.id, source_module: "retail_product", source_record_id: product.id });
    setSaving(false);
    if (result.error) setMessage(result.error.message); else { setSelectedProductId(""); setMessage(`${product.name} is now published from BOAT inventory.`); await load(); }
  };

  const toggleListing = async (row: Listing) => {
    const result = await db.from("marketplace_listings").update({ is_published: !row.is_published }).eq("id", row.id).eq("organization_id", orgId);
    if (result.error) setMessage(result.error.message); else await load();
  };

  return <section className="space-y-4 rounded-xl border border-indigo-200 bg-indigo-50/40 p-5">
    <div><div className="flex items-center gap-2"><Globe2 className="h-5 w-5 text-indigo-700" /><h2 className="font-semibold text-slate-900">BOAT Market merchant profile</h2></div><p className="mt-1 text-sm text-slate-600">Create the business profile and publish products or services to the shared marketplace. Retail products can be published from existing BOAT inventory without re-entering their name or price.</p></div>
    {message && <p className="text-sm text-slate-700" role="status">{message}</p>}
    <div className="grid gap-3 md:grid-cols-2"><input value={draft.display_name} onChange={(e) => setDraft((v) => ({ ...v, display_name: e.target.value, public_slug: v.public_slug || slugify(e.target.value) }))} placeholder="Public business name" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><input value={draft.public_slug} onChange={(e) => setDraft((v) => ({ ...v, public_slug: e.target.value }))} placeholder="marketplace address e.g. lakeview-hotel" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><input value={draft.phone} onChange={(e) => setDraft((v) => ({ ...v, phone: e.target.value }))} placeholder="Public phone" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={draft.is_published} onChange={(e) => setDraft((v) => ({ ...v, is_published: e.target.checked }))} /> Publish merchant profile</label><textarea value={draft.description} onChange={(e) => setDraft((v) => ({ ...v, description: e.target.value }))} placeholder="Describe your business" className="min-h-20 rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2" /></div>
    <button type="button" onClick={() => void saveMerchant()} disabled={saving} className="app-btn-primary"><Save className="h-4 w-4" /> Save profile</button>
    {merchant && <div className="border-t border-indigo-200 pt-4">
      <h3 className="font-semibold text-slate-900">Publish BOAT inventory</h3>
      <p className="mt-1 text-sm text-slate-600">Choose an active, saleable product. The listing stays linked to that inventory record; publish it again after changing its name or price to refresh the marketplace copy.</p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <select value={selectedProductId} onChange={(e) => setSelectedProductId(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="">Choose a BOAT product</option>
          {products.map((product) => <option key={product.id} value={product.id}>{product.name} — UGX {Number(product.sales_price || 0).toLocaleString()}</option>)}
        </select>
        <button type="button" onClick={() => void publishExistingProduct()} disabled={saving || !selectedProductId} className="app-btn-secondary shrink-0"><Globe2 className="h-4 w-4" /> Publish product</button>
      </div>
      {products.length === 0 && <p className="mt-2 text-sm text-slate-500">There are no active, saleable products in BOAT inventory yet.</p>}

      <h3 className="mt-5 font-semibold text-slate-900">New marketplace listing</h3>
      <div className="mt-3 grid gap-3 md:grid-cols-4"><input value={listing.title} onChange={(e) => setListing((v) => ({ ...v, title: e.target.value }))} placeholder="Product or service" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /><select value={listing.category_id} onChange={(e) => setListing((v) => ({ ...v, category_id: e.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="">Category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><select value={listing.listing_type} onChange={(e) => setListing((v) => ({ ...v, listing_type: e.target.value }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm"><option value="product">Product</option><option value="service">Service</option><option value="room">Room</option><option value="insurance">Insurance</option><option value="school_item">School item</option></select><input type="number" min="0" value={listing.price} onChange={(e) => setListing((v) => ({ ...v, price: e.target.value }))} placeholder="Price UGX" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" /></div><label className="mt-3 flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={listing.is_published} onChange={(e) => setListing((v) => ({ ...v, is_published: e.target.checked }))} /> Publish immediately</label><button type="button" onClick={() => void createListing()} disabled={saving} className="app-btn-secondary mt-3"><Plus className="h-4 w-4" /> Add listing</button>

      <h3 className="mt-5 font-semibold text-slate-900">Marketplace listings</h3>
      <div className="mt-3 divide-y rounded-lg border border-slate-200 bg-white">{listings.map((row) => <div key={row.id} className="flex items-center justify-between gap-3 p-3 text-sm"><div><p className="font-medium text-slate-900">{row.title}</p><p className="text-xs text-slate-500">{row.marketplace_categories?.name || "Uncategorized"} · {row.listing_type} · UGX {Number(row.price).toLocaleString()}{row.source_module === "retail_product" ? ` · ${row.available_quantity ?? 0} available · BOAT inventory` : ""}</p></div><button type="button" onClick={() => void toggleListing(row)} className={row.is_published ? "text-emerald-700" : "text-slate-600"}>{row.is_published ? "Published" : "Draft"}</button></div>)}{listings.length === 0 && <p className="p-3 text-sm text-slate-500">No listings yet.</p>}</div>
      {orgId && <MarketplaceMerchantOrdersPanel merchantId={merchant.id} organizationId={orgId} />}
      {orgId && <MarketplaceFinancePanel merchantId={merchant.id} organizationId={orgId} />}
      {orgId && user?.business_type === "school" && <MarketplaceSchoolFeeConnector merchantId={merchant.id} organizationId={orgId} />}
    </div>}
  </section>;
}
