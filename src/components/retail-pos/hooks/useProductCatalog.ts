import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { desktopApi } from "../../../lib/desktopApi";

/** Local SQLite rows often still reference this org id after `VITE_TENANT_ID` was pointed at cloud `organizations.id`. */
const LEGACY_LOCAL_DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";

/** Remote search (Supabase ilike) cap. */
const REMOTE_SEARCH_LIMIT = 200;
/** First page size when loading products from Supabase (online). */
const ONLINE_INITIAL_FETCH = 2000;
/** Subsequent pages for online catalog. */
const ONLINE_LOAD_MORE_CHUNK = 500;

interface ProductCatalogItem {
  id: string;
  name: string;
  sales_price: number | null;
  cost_price: number | null;
  track_inventory: boolean | null;
  department_id?: string | null;
  barcode?: string | null;
  sku?: string | null;
  code?: string | null;
  manufacturing_item_type?: string | null;
}

export function useProductCatalog<TProduct extends ProductCatalogItem>(useDesktopLocalMode: boolean, orgId?: string) {
  const [products, setProducts] = useState<TProduct[]>([]);
  const [productOffset, setProductOffset] = useState(0);
  const [hasMoreProducts, setHasMoreProducts] = useState(true);
  const [loading, setLoading] = useState(true);
  const [catalogLoadingMore, setCatalogLoadingMore] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [remoteSearchProducts, setRemoteSearchProducts] = useState<TProduct[] | null>(null);

  useEffect(() => {
    const loadProducts = async () => {
      setLoading(true);
      setProductsError(null);
      try {
        if (useDesktopLocalMode) {
          const [localStoreProducts, localPosProducts] = await Promise.all([
            desktopApi.localSelect({
              table: "products",
              orderBy: { column: "name", ascending: true },
              limit: 5000,
            }),
            desktopApi.listPosProducts(),
          ]);

          const allLocalRows = (localStoreProducts.rows || []) as Array<Record<string, unknown>>;
          const fromLocalStore = allLocalRows
            .map((row) => {
              const id = String(row.id || "").trim();
              const name = String(row.name || "").trim();
              if (!id || !name) return null;
              const isActive = row.active === false || row.active === 0 || row.active === "0" ? false : true;
              const isSaleable = row.saleable === false || row.saleable === 0 || row.saleable === "0" ? false : true;
              const rowOrgId = row.organization_id == null ? null : String(row.organization_id).trim();
              const sessionOrg = (orgId || "").trim();
              const inOrg =
                !sessionOrg ||
                !rowOrgId ||
                rowOrgId.toLowerCase() === sessionOrg.toLowerCase() ||
                rowOrgId === LEGACY_LOCAL_DEFAULT_ORG_ID;
              if (!isActive || !isSaleable || !inOrg) return null;
              return {
                id,
                name,
                sales_price: row.sales_price == null ? 0 : Number(row.sales_price),
                cost_price: row.cost_price == null ? null : Number(row.cost_price),
                track_inventory: row.track_inventory == null ? true : Boolean(row.track_inventory),
                department_id: row.department_id == null ? null : String(row.department_id),
                barcode: row.barcode == null ? null : String(row.barcode),
                sku: row.sku == null ? null : String(row.sku),
                code: row.code == null ? null : String(row.code),
                manufacturing_item_type: row.manufacturing_item_type == null ? null : String(row.manufacturing_item_type),
              } as TProduct;
            })
            .filter((row): row is TProduct => Boolean(row));

          if (fromLocalStore.length > 0) {
            const sorted = fromLocalStore.sort((a, b) => a.name.localeCompare(b.name));
            // Local SQLite already capped by localSelect limit; do not truncate —
            // a fixed first page hid everything after ~100 alphabetical names.
            setProducts(sorted);
            setHasMoreProducts(false);
            setProductOffset(sorted.length);
            setLoading(false);
            return;
          }

          // Legacy fallback only when local products table is truly empty.
          if (allLocalRows.length === 0) {
            const fromLegacyPos = (localPosProducts || [])
            .map((p) => {
              const id = String(p.id || "").trim();
              const name = String(p.name || "").trim();
              return {
                id,
                name,
                sales_price: Number(p.selling_price ?? 0),
                cost_price: null,
                track_inventory: true,
                department_id: null,
                barcode: null,
                sku: p.sku,
                code: null,
              } as TProduct;
            })
            .filter((p) => p.id && p.name);

            const sorted = fromLegacyPos.sort((a, b) => a.name.localeCompare(b.name));
            setProducts(sorted);
            setHasMoreProducts(false);
            setProductOffset(sorted.length);
          } else {
            setProducts([]);
            setHasMoreProducts(false);
            setProductOffset(0);
          }
          setLoading(false);
          return;
        }
        const rich = await supabase
          .from("products")
          .select("id,name,sales_price,cost_price,track_inventory,department_id,barcode,sku,code,manufacturing_item_type")
          .eq("active", true)
          .order("name")
          .range(0, ONLINE_INITIAL_FETCH - 1);

        if (!rich.error && rich.data) {
          const rows = rich.data as TProduct[];
          setProducts(rows);
          setHasMoreProducts(rows.length >= ONLINE_INITIAL_FETCH);
          setProductOffset(rows.length);
          localStorage.setItem("boat.retail.products.cache.v1", JSON.stringify(rows));
          return;
        }

        const fallback = await supabase
          .from("products")
          .select("id,name,sales_price,cost_price,track_inventory,department_id")
          .eq("active", true)
          .order("name")
          .range(0, ONLINE_INITIAL_FETCH - 1);

        if (fallback.error) {
          setProductsError(fallback.error.message);
          return;
        }

        const mapped = (fallback.data || []).map((p) => ({
          ...p,
          barcode: null,
          sku: null,
          code: null,
        })) as TProduct[];
        setProducts(mapped);
        setHasMoreProducts(mapped.length >= ONLINE_INITIAL_FETCH);
        setProductOffset(mapped.length);
        localStorage.setItem("boat.retail.products.cache.v1", JSON.stringify(mapped));
      } catch (error) {
        console.error("Retail products load error:", error);
        const cached = localStorage.getItem("boat.retail.products.cache.v1");
        if (cached) {
          try {
            setProducts(JSON.parse(cached) as TProduct[]);
            setHasMoreProducts(false);
            setProductsError("Loaded cached products (offline cache).");
            return;
          } catch {
            // ignore parse failure
          }
        }
        setProductsError("Failed to load retail products.");
      } finally {
        setLoading(false);
      }
    };
    void loadProducts();
  }, [useDesktopLocalMode, orgId]);

  const loadMoreProducts = async () => {
    if (!hasMoreProducts || loading || catalogLoadingMore) return;
    setCatalogLoadingMore(true);
    try {
      const { data, error } = await supabase
        .from("products")
        .select("id,name,sales_price,cost_price,track_inventory,department_id,barcode,sku,code,manufacturing_item_type")
        .eq("active", true)
        .order("name")
        .range(productOffset, productOffset + ONLINE_LOAD_MORE_CHUNK - 1);
      let rows: TProduct[];
      if (error) {
        const fallback = await supabase
          .from("products")
          .select("id,name,sales_price,cost_price,track_inventory,department_id")
          .eq("active", true)
          .order("name")
          .range(productOffset, productOffset + ONLINE_LOAD_MORE_CHUNK - 1);
        if (fallback.error) throw fallback.error;
        rows = (fallback.data || []).map((p) => ({ ...p, barcode: null, sku: null, code: null })) as TProduct[];
      } else {
        rows = (data || []) as TProduct[];
      }
      if (rows.length === 0) {
        setHasMoreProducts(false);
        return;
      }
      setProducts((prev) => [...prev, ...rows]);
      setProductOffset((prev) => prev + rows.length);
      if (rows.length < ONLINE_LOAD_MORE_CHUNK) setHasMoreProducts(false);
    } catch (error) {
      console.error("Failed to load more products:", error);
    } finally {
      setCatalogLoadingMore(false);
    }
  };

  useEffect(() => {
    const q = productSearch.trim();
    if (useDesktopLocalMode || q.length < 2) {
      setRemoteSearchProducts(null);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const rich = await supabase
          .from("products")
          .select("id,name,sales_price,cost_price,track_inventory,department_id,barcode,sku,code,manufacturing_item_type")
          .eq("active", true)
          .or(`name.ilike.%${q}%,barcode.ilike.%${q}%,sku.ilike.%${q}%,code.ilike.%${q}%`)
          .order("name")
          .limit(REMOTE_SEARCH_LIMIT);
        if (!rich.error) {
          setRemoteSearchProducts((rich.data || []) as TProduct[]);
          return;
        }
        const fallback = await supabase
          .from("products")
          .select("id,name,sales_price,cost_price,track_inventory,department_id")
          .eq("active", true)
          .ilike("name", `%${q}%`)
          .order("name")
          .limit(REMOTE_SEARCH_LIMIT);
        setRemoteSearchProducts(
          (fallback.data || []).map((p) => ({ ...p, barcode: null, sku: null, code: null })) as TProduct[]
        );
      } catch {
        setRemoteSearchProducts(null);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [productSearch, useDesktopLocalMode]);

  const filteredManualProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products;
    if (remoteSearchProducts && remoteSearchProducts.length > 0) return remoteSearchProducts;
    return products.filter((p) =>
      [p.name.toLowerCase(), (p.barcode || "").toLowerCase(), (p.sku || "").toLowerCase(), (p.code || "").toLowerCase()].some((v) => v.includes(q))
    );
  }, [products, productSearch, remoteSearchProducts]);

  return {
    products,
    setProducts,
    loading,
    catalogLoadingMore,
    productsError,
    hasMoreProducts,
    loadMoreProducts,
    productSearch,
    setProductSearch,
    filteredManualProducts,
  };
}
