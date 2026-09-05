import { useEffect, useMemo, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../contexts/AuthContext";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";
import { hasUsableBom, preferredBom, validateBom, type ManufacturingBom } from "../../lib/manufacturingBom";

type Product = { id: string; name: string; unit_of_measure?: string | null; manufacturing_item_type?: string | null; active?: boolean };
const inputClass = "w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:bg-slate-100 disabled:text-slate-500";
const errorMessage = (err: unknown) => err instanceof Error ? err.message : String((err as { message?: string })?.message || err);

function BomProductRow({ product, boms, materialProducts, readOnly, hidden, onSave, onRecost }: {
  product: Product; boms: ManufacturingBom[]; materialProducts: Product[]; readOnly: boolean; hidden: boolean;
  onSave: (bom: ManufacturingBom) => Promise<ManufacturingBom>;
  onRecost: (productId: string) => Promise<number>;
}) {
  const initial = (): ManufacturingBom => preferredBom(boms) ?? {
    id: "", product_id: product.id, product_name: product.name, version: "v1", output_qty: 1,
    output_unit: product.unit_of_measure || "unit", status: "Draft", materials: [], expected_scrap_qty: 0,
  };
  const [draft, setDraft] = useState<ManufacturingBom>(initial);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const missing = !hasUsableBom(boms);
  const locked = readOnly || busy;
  const patch = (change: Partial<ManufacturingBom>) => { setDraft((current) => ({ ...current, ...change })); setDirty(true); setError(""); setMessage(""); };
  const save = async () => {
    if (locked) return;
    const validation = validateBom(draft);
    if (validation) { setError(validation); return; }
    if (draft.materials.some((m) => !materialProducts.some((p) => p.id === m.item_id))) { setError("Select materials belonging to this organization."); return; }
    setBusy(true); setError(""); setMessage("");
    try { setDraft(await onSave(draft)); setDirty(false); setMessage("Saved"); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };
  const recost = async () => {
    if (locked || dirty) return;
    if (!window.confirm(`Recalculate existing production material costing for ${product.name} using its current Active or Draft BOM?`)) return;
    setBusy(true); setError("");
    try { setMessage(`Recalculated ${await onRecost(product.id)} production entries.`); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };
  return <tr hidden={hidden} className={`border-t align-top ${missing ? "bg-amber-50/60" : "bg-white"}`}>
    <td className="p-3">
      <p className="font-semibold text-slate-900">{product.name}</p>
      <p className="mt-1 text-xs text-slate-500">Ref {product.id.slice(0, 8)} · {product.unit_of_measure || "unit"}{product.active === false ? " · Inactive" : ""}</p>
      <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${missing ? "bg-amber-100 text-amber-900" : "bg-emerald-50 text-emerald-800"}`}>{missing ? "Missing BOM" : "BOM available"}</span>
      {dirty && <p className="mt-2 text-xs text-blue-700">Unsaved changes</p>}
    </td>
    <td className="p-3">
      {boms.length > 1 && <select aria-label={`BOM version for ${product.name}`} className={`${inputClass} mb-2`} value={draft.id} disabled={locked || dirty} onChange={(e) => { const bom = boms.find((b) => b.id === e.target.value); if (bom) { setDraft(bom); setError(""); setMessage(""); } }}>{boms.map((b) => <option key={b.id} value={b.id}>{b.version} · {b.status} · {b.id.slice(0, 8)}</option>)}</select>}
      <label className="block text-xs text-slate-500">Version<input aria-label={`Version for ${product.name}`} className={`${inputClass} mt-1`} value={draft.version} disabled={locked} onChange={(e) => patch({ version: e.target.value })} /></label>
      <select aria-label={`Status for ${product.name}`} className={`${inputClass} mt-2`} value={draft.status} disabled={locked} onChange={(e) => patch({ status: e.target.value as ManufacturingBom["status"] })}><option>Draft</option><option>Active</option><option>Archived</option></select>
    </td>
    <td className="p-3">
      <label className="block text-xs text-slate-500">Quantity<input aria-label={`Output quantity for ${product.name}`} type="number" min="0.001" step="any" className={`${inputClass} mt-1`} value={draft.output_qty} disabled={locked} onChange={(e) => patch({ output_qty: Number(e.target.value) })} /></label>
      <label className="mt-2 block text-xs text-slate-500">Unit<input aria-label={`Output unit for ${product.name}`} className={`${inputClass} mt-1`} value={draft.output_unit} disabled={locked} onChange={(e) => patch({ output_unit: e.target.value })} /></label>
    </td>
    <td className="p-3">
      {!draft.materials.length && <p className="mb-2 text-xs text-amber-800">No materials set</p>}
      {draft.materials.map((material, index) => <div key={index} className="mb-2 grid grid-cols-[minmax(160px,1fr)_75px_65px_28px] gap-1.5">
        <select aria-label={`Material ${index + 1} for ${product.name}`} className={inputClass} disabled={locked} value={material.item_id} onChange={(e) => { const p = materialProducts.find((m) => m.id === e.target.value); patch({ materials: draft.materials.map((m, i) => i === index ? { ...m, item_id: e.target.value, item_name: p?.name || "", unit: p?.unit_of_measure || "unit" } : m) }); }}>
          <option value="">Select material…</option>
          {!materialProducts.some((m) => m.id === material.item_id) && material.item_id && <option value={material.item_id}>{material.item_name || "Unavailable material"}</option>}
          {materialProducts.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.unit_of_measure || "unit"} · {p.id.slice(0, 8)}</option>)}
        </select>
        <input aria-label={`Material ${index + 1} quantity for ${product.name}`} type="number" min="0.001" step="any" className={inputClass} disabled={locked} value={material.qty} onChange={(e) => patch({ materials: draft.materials.map((m, i) => i === index ? { ...m, qty: Number(e.target.value) } : m) })} />
        <input aria-label={`Material ${index + 1} unit for ${product.name}`} className={inputClass} disabled={locked} value={material.unit} onChange={(e) => patch({ materials: draft.materials.map((m, i) => i === index ? { ...m, unit: e.target.value } : m) })} />
        <button type="button" aria-label={`Remove material ${index + 1} for ${product.name}`} disabled={locked} className="text-rose-600 disabled:opacity-40" onClick={() => patch({ materials: draft.materials.filter((_, i) => i !== index) })}><Trash2 className="h-4 w-4" /></button>
      </div>)}
      <button type="button" disabled={locked} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 disabled:opacity-40" onClick={() => patch({ materials: [...draft.materials, { item_id: "", item_name: "", qty: 1, unit: "unit" }] })}><Plus className="h-3.5 w-3.5" />Add material</button>
    </td>
    <td className="p-3"><label className="block text-xs text-slate-500">Quantity<input aria-label={`Expected scrap for ${product.name}`} type="number" min="0" step="any" className={`${inputClass} mt-1`} disabled={locked} value={draft.expected_scrap_qty ?? 0} onChange={(e) => patch({ expected_scrap_qty: Number(e.target.value) })} /></label><p className="mt-2 text-xs text-slate-500">Per output batch, in your scrap stock unit.</p></td>
    <td className="p-3">
      <button type="button" disabled={locked || (!dirty && !!draft.id)} onClick={() => void save()} className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"><Save className="h-4 w-4" />{busy ? "Working…" : "Save"}</button>
      {dirty && <button type="button" disabled={locked} className="mt-2 block text-xs text-slate-600" onClick={() => { setDraft(boms.find((b) => b.id === draft.id) || initial()); setDirty(false); setError(""); setMessage(""); }}>Discard changes</button>}
      {!!draft.id && !missing && <button type="button" disabled={locked || dirty} onClick={() => void recost()} className="mt-3 block text-left text-xs text-blue-700 disabled:opacity-40">Recalculate past production</button>}
      {error && <p role="alert" className="mt-2 max-w-44 text-xs text-rose-700">{error}</p>}
      {message && <p role="status" className="mt-2 max-w-44 text-xs text-emerald-700">{message}</p>}
    </td>
  </tr>;
}

export function ManufacturingBomPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const [products, setProducts] = useState<Product[]>([]);
  const [boms, setBoms] = useState<ManufacturingBom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [missingOnly, setMissingOnly] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setProducts([]); setBoms([]); setLoading(true); setError("");
    if (!orgId) { setLoading(false); setError("Select an organization to manage its BOMs."); return; }
    void (async () => {
      try {
        const [p, b] = await Promise.all([
          supabase.from("products").select("id,name,unit_of_measure,manufacturing_item_type,active").eq("organization_id", orgId).order("name"),
          supabase.from("manufacturing_boms").select("*").eq("organization_id", orgId).order("updated_at", { ascending: false }),
        ]);
        if (p.error) throw p.error;
        if (b.error) throw b.error;
        if (!cancelled) { setProducts((p.data || []) as Product[]); setBoms((b.data || []).map((bom) => ({ ...bom, materials: bom.materials || [] })) as ManufacturingBom[]); }
      } catch (err) { if (!cancelled) setError(errorMessage(err)); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [orgId]);
  const finished = products.filter((p) => p.manufacturing_item_type === "finished_product");
  const materialProducts = products.filter((p) => p.manufacturing_item_type === "raw_material" || p.manufacturing_item_type === "consumable");
  const byProduct = useMemo(() => {
    const map = new Map<string, ManufacturingBom[]>();
    for (const bom of boms) map.set(bom.product_id, [...(map.get(bom.product_id) || []), bom]);
    return map;
  }, [boms]);
  const missingCount = finished.filter((p) => !hasUsableBom(byProduct.get(p.id) || [])).length;
  const saveBom = async (draft: ManufacturingBom) => {
    if (readOnly || !orgId) throw new Error("You cannot save BOMs in this workspace.");
    const validation = validateBom(draft);
    if (validation) throw new Error(validation);
    const payload = {
      product_id: draft.product_id, product_name: products.find((p) => p.id === draft.product_id)?.name || draft.product_name,
      version: draft.version.trim(), output_qty: draft.output_qty, output_unit: draft.output_unit.trim(), status: draft.status,
      materials: draft.materials, materials_count: draft.materials.length, organization_id: orgId, expected_scrap_qty: draft.expected_scrap_qty || 0,
    };
    const query = draft.id ? supabase.from("manufacturing_boms").update(payload).eq("id", draft.id).eq("organization_id", orgId) : supabase.from("manufacturing_boms").insert(payload);
    const { data, error: saveError } = await query.select("*").single();
    if (saveError) throw new Error(saveError.message);
    const saved = data as ManufacturingBom;
    setBoms((current) => [...current.filter((b) => b.id !== saved.id), saved]);
    return saved;
  };
  const recost = async (productId: string) => {
    if (readOnly || !orgId) throw new Error("You cannot recalculate production in this workspace.");
    const { data, error: recostError } = await supabase.from("manufacturing_production_entries").update({ product_id: productId }).eq("product_id", productId).eq("organization_id", orgId).select("id");
    if (recostError) throw new Error(recostError.message);
    return data?.length || 0;
  };
  const q = search.trim().toLowerCase();
  const matches = (p: Product) => (p.name.toLowerCase().includes(q) || p.id.includes(q)) && (!missingOnly || !hasUsableBom(byProduct.get(p.id) || []));
  return <div className="p-4 md:p-6">
    {readOnly && <ReadOnlyNotice />}
    <h1 className="text-2xl font-bold text-slate-900">Finished product BOMs</h1>
    <p className="mt-1 text-sm text-slate-600">Set materials and expected scrap for each output batch. Save each product row when ready.</p>
    <div className="my-5 flex flex-wrap gap-3">
      <div className="rounded-lg border bg-white px-4 py-3"><span className="text-2xl font-bold">{finished.length}</span><span className="ml-2 text-sm text-slate-600">Finished products</span></div>
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"><span className="text-2xl font-bold text-amber-900">{missingCount}</span><span className="ml-2 text-sm text-amber-900">Missing BOM</span></div>
      <div className="rounded-lg border bg-white px-4 py-3"><span className="text-2xl font-bold text-emerald-700">{finished.length - missingCount}</span><span className="ml-2 text-sm text-slate-600">With Active / Draft BOM</span></div>
    </div>
    <div className="mb-3 flex flex-wrap items-center gap-4">
      <input aria-label="Search finished products" placeholder="Search product name or reference…" value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputClass} max-w-md`} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} />Missing BOM only</label>
    </div>
    {error && <p role="alert" className="mb-3 rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[1150px] text-left text-sm"><thead className="bg-slate-100 text-xs text-slate-600"><tr><th className="w-56 p-3">Finished product</th><th className="w-36 p-3">BOM / status</th><th className="w-28 p-3">Output batch</th><th className="min-w-96 p-3">Materials · quantity · unit</th><th className="w-32 p-3">Expected scrap</th><th className="w-40 p-3">Actions</th></tr></thead>
        <tbody>
          {loading && <tr><td colSpan={6} className="p-8 text-center text-slate-500">Loading products and BOMs…</td></tr>}
          {!loading && finished.map((product) => <BomProductRow key={`${orgId}:${product.id}`} hidden={!matches(product)} product={product} boms={byProduct.get(product.id) || []} materialProducts={materialProducts} readOnly={readOnly} onSave={saveBom} onRecost={recost} />)}
          {!loading && !finished.some(matches) && <tr><td colSpan={6} className="p-8 text-center text-slate-500">{finished.length ? "No products match this filter." : "No finished products found. Classify products as finished products to list them here."}</td></tr>}
        </tbody>
      </table>
    </div>
    <p className="mt-3 text-xs text-slate-500">Missing BOM means no Active or Draft recipe is linked to that product. Product references distinguish duplicate names. Saving a BOM does not recalculate past production automatically.</p>
  </div>;
}
