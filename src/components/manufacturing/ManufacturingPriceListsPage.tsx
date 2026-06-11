import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";
import { ReadOnlyNotice } from "../common/ReadOnlyNotice";

// These tables are introduced by the manufacturing price-list migration.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

type CustomerType = { id: string; name: string };
type Product = { id: string; name: string; sales_price: number | null; unit_of_measure?: string | null };
type PriceRow = {
  id: string;
  product_id: string;
  customer_type_id: string;
  min_qty: number;
  price: number;
};

export function ManufacturingPriceListsPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const [types, setTypes] = useState<CustomerType[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [typeName, setTypeName] = useState("");
  const [draft, setDraft] = useState({ product_id: "", customer_type_id: "", min_qty: "1", price: "" });
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ product_id: "", customer_type_id: "", min_qty: "1", price: "" });
  const [loading, setLoading] = useState(true);
  const [savingType, setSavingType] = useState(false);
  const [savingPrice, setSavingPrice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    const [typeRes, productRes, priceRes] = await Promise.all([
      sb.from("manufacturing_customer_types").select("id,name").eq("organization_id", orgId).order("name"),
      sb
        .from("products")
        .select("id,name,sales_price,unit_of_measure,manufacturing_item_type")
        .eq("organization_id", orgId)
        .eq("active", true)
        .order("name"),
      sb.from("manufacturing_price_list").select("id,product_id,customer_type_id,min_qty,price").eq("organization_id", orgId),
    ]);
    const firstError = typeRes.error || productRes.error || priceRes.error;
    if (firstError) setError(firstError.message);
    setTypes(typeRes.data || []);
    const allProducts = productRes.data || [];
    const finished = allProducts.filter((p: { manufacturing_item_type?: string | null }) => p.manufacturing_item_type === "finished_product");
    setProducts(finished.length > 0 ? finished : allProducts);
    setPrices(priceRes.data || []);
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const addType = async () => {
    const name = typeName.trim();
    setError(null);
    setMessage(null);
    if (!orgId) return setError("Your account is not linked to an organization.");
    if (readOnly) return setError("Customer types cannot be added in read-only mode.");
    if (!name) return setError("Enter a customer type name.");
    if (types.some((type) => type.name.toLowerCase() === name.toLowerCase())) {
      return setError(`Customer type "${name}" already exists.`);
    }
    setSavingType(true);
    try {
      const { error: saveError } = await sb.rpc("create_manufacturing_customer_type", { p_name: name });
      if (saveError) throw saveError;
      setTypeName("");
      setMessage(`Customer type "${name}" added.`);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSavingType(false);
    }
  };

  const addPrice = async () => {
    const minQty = Number(draft.min_qty);
    const price = Number(draft.price);
    if (!orgId || readOnly || !draft.product_id || !draft.customer_type_id || !(minQty > 0) || price < 0) {
      setError("Select a product and customer type, then enter a valid minimum quantity and price.");
      return;
    }
    setError(null);
    setMessage(null);
    setSavingPrice(true);
    try {
      const { error: saveError } = await sb.from("manufacturing_price_list").upsert(
        {
          organization_id: orgId,
          product_id: draft.product_id,
          customer_type_id: draft.customer_type_id,
          min_qty: minQty,
          price,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,product_id,customer_type_id,min_qty" }
      );
      if (saveError) throw saveError;
      setDraft({ product_id: "", customer_type_id: "", min_qty: "1", price: "" });
      setMessage("Price added.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSavingPrice(false);
    }
  };

  const beginEditPrice = (row: PriceRow) => {
    setEditingPriceId(row.id);
    setEditDraft({
      product_id: row.product_id,
      customer_type_id: row.customer_type_id,
      min_qty: String(row.min_qty),
      price: String(row.price),
    });
    setError(null);
    setMessage(null);
  };

  const saveEditedPrice = async () => {
    if (!editingPriceId || readOnly) return;
    const minQty = Number(editDraft.min_qty);
    const price = Number(editDraft.price);
    if (!editDraft.product_id || !editDraft.customer_type_id || !(minQty > 0) || !Number.isFinite(price) || price < 0) {
      setError("Select a product and customer type, then enter a valid minimum quantity and price.");
      return;
    }
    setSavingPrice(true);
    setError(null);
    setMessage(null);
    try {
      const { error: saveError } = await sb
        .from("manufacturing_price_list")
        .update({
          product_id: editDraft.product_id,
          customer_type_id: editDraft.customer_type_id,
          min_qty: minQty,
          price,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editingPriceId);
      if (saveError) throw saveError;
      setEditingPriceId(null);
      setMessage("Price updated.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSavingPrice(false);
    }
  };

  const remove = async (table: "manufacturing_customer_types" | "manufacturing_price_list", id: string) => {
    if (readOnly) return;
    const { error: removeError } = await sb.from(table).delete().eq("id", id);
    if (removeError) return setError(removeError.message);
    await load();
  };

  const productName = (id: string) => products.find((p) => p.id === id)?.name || "Unknown product";
  const typeLabel = (id: string) => types.find((type) => type.id === id)?.name || "Unknown type";

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Customer Types & Price Lists</h1>
        <p className="text-sm text-slate-600 mt-1">
          Set quantity-based prices for retail, dealer, distributor, or other customer types.
        </p>
      </div>
      {readOnly ? <ReadOnlyNotice /> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

      <section className="app-card p-5 space-y-4">
        <h2 className="font-semibold text-slate-900">Customer types</h2>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            className="border border-slate-300 rounded-lg px-3 py-2 flex-1"
            placeholder="e.g. Dealer"
            value={typeName}
            onChange={(e) => setTypeName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addType();
            }}
          />
          <button className="app-btn-primary" disabled={readOnly || savingType} onClick={() => void addType()}>
            {savingType ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add type
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {types.map((type) => (
            <span key={type.id} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm">
              {type.name}
              <button
                type="button"
                aria-label={`Delete ${type.name}`}
                disabled={readOnly}
                onClick={() => void remove("manufacturing_customer_types", type.id)}
                className="text-red-600 disabled:opacity-40"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </span>
          ))}
        </div>
      </section>

      <section className="app-card p-5 space-y-4 overflow-x-auto">
        <h2 className="font-semibold text-slate-900">Price list</h2>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 min-w-[760px]">
          <select className="border border-slate-300 rounded-lg px-3 py-2" value={draft.product_id} onChange={(e) => setDraft({ ...draft, product_id: e.target.value })}>
            <option value="">Product</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
          </select>
          <select className="border border-slate-300 rounded-lg px-3 py-2" value={draft.customer_type_id} onChange={(e) => setDraft({ ...draft, customer_type_id: e.target.value })}>
            <option value="">Customer type</option>
            {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
          </select>
          <input type="number" min="0.001" step="0.001" className="border border-slate-300 rounded-lg px-3 py-2" placeholder="Min Qty" value={draft.min_qty} onChange={(e) => setDraft({ ...draft, min_qty: e.target.value })} />
          <input type="number" min="0" step="0.01" className="border border-slate-300 rounded-lg px-3 py-2" placeholder="Price" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
          <button className="app-btn-primary" disabled={readOnly || savingPrice} onClick={() => void addPrice()}>
            {savingPrice ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Add price
          </button>
        </div>

        {loading ? <p className="text-slate-500">Loading...</p> : (
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left p-3">Product</th>
                <th className="text-left p-3">Customer Type</th>
                <th className="text-right p-3">Min Qty</th>
                <th className="text-right p-3">Price</th>
                <th className="p-3 w-28">Actions</th>
              </tr>
            </thead>
            <tbody>
              {prices
                .slice()
                .sort((a, b) => productName(a.product_id).localeCompare(productName(b.product_id)) || a.min_qty - b.min_qty)
                .map((row) => (
                  <tr key={row.id} className="border-t border-slate-100">
                    <td className="p-3 font-medium">
                      {editingPriceId === row.id ? (
                        <select className="w-full border border-slate-300 rounded px-2 py-1" value={editDraft.product_id} onChange={(e) => setEditDraft({ ...editDraft, product_id: e.target.value })}>
                          {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                        </select>
                      ) : productName(row.product_id)}
                    </td>
                    <td className="p-3">
                      {editingPriceId === row.id ? (
                        <select className="w-full border border-slate-300 rounded px-2 py-1" value={editDraft.customer_type_id} onChange={(e) => setEditDraft({ ...editDraft, customer_type_id: e.target.value })}>
                          {types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                        </select>
                      ) : typeLabel(row.customer_type_id)}
                    </td>
                    <td className="p-3 text-right">
                      {editingPriceId === row.id ? (
                        <input type="number" min="0.001" step="0.001" className="w-28 border border-slate-300 rounded px-2 py-1 text-right" value={editDraft.min_qty} onChange={(e) => setEditDraft({ ...editDraft, min_qty: e.target.value })} />
                      ) : Number(row.min_qty).toLocaleString()}
                    </td>
                    <td className="p-3 text-right">
                      {editingPriceId === row.id ? (
                        <input type="number" min="0" step="0.01" className="w-32 border border-slate-300 rounded px-2 py-1 text-right" value={editDraft.price} onChange={(e) => setEditDraft({ ...editDraft, price: e.target.value })} />
                      ) : Number(row.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-3">
                      <div className="flex gap-2">
                        {editingPriceId === row.id ? (
                          <>
                            <button type="button" title="Save price" disabled={savingPrice} onClick={() => void saveEditedPrice()} className="text-emerald-700 disabled:opacity-40"><Check className="w-4 h-4" /></button>
                            <button type="button" title="Cancel edit" disabled={savingPrice} onClick={() => setEditingPriceId(null)} className="text-slate-600 disabled:opacity-40"><X className="w-4 h-4" /></button>
                          </>
                        ) : (
                          <>
                            <button type="button" title="Edit price" disabled={readOnly} onClick={() => beginEditPrice(row)} className="text-sky-700 disabled:opacity-40"><Pencil className="w-4 h-4" /></button>
                            <button type="button" title="Delete price" disabled={readOnly} onClick={() => void remove("manufacturing_price_list", row.id)} className="text-red-600 disabled:opacity-40"><Trash2 className="w-4 h-4" /></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
