import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../../lib/supabase";
import { desktopApi } from "../../../lib/desktopApi";

const PRODUCT_PAGE_SIZE = 100;

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
}

export function useProductCatalog<TProduct extends ProductCatalogItem>(useDesktopLocalMode: boolean, orgId?: string) {
  const [products, setProducts] = useState<TProduct[]>([]);
  const [productOffset, setProductOffset] = useState(0);
  const [hasMoreProducts, setHasMoreProducts] = useState(true);
  const [loading, setLoading] = useState(true);
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
              const rowOrgId = row.organization_id == null ? null : String(row.organization_id);
              const inOrg = !orgId || !rowOrgId || rowOrgId === orgId;
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
              } as TProduct;
            })
            .filter((row): row is TProduct => Boolean(row));

          if (fromLocalStore.length > 0) {
            const sorted = fromLocalStore.sort((a, b) => a.name.localeCompare(b.name));
            setProducts(sorted.slice(0, PRODUCT_PAGE_SIZE));
            setHasMoreProducts(sorted.length > PRODUCT_PAGE_SIZE);
            setProductOffset(PRODUCT_PAGE_SIZE);
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
            setProducts(sorted.slice(0, PRODUCT_PAGE_SIZE));
            setHasMoreProducts(sorted.length > PRODUCT_PAGE_SIZE);
            setProductOffset(PRODUCT_PAGE_SIZE);
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
          .select("id,name,sales_price,cost_price,track_inventory,department_id,barcode,sku,code")
          .eq("active", true)
          .order("name")
          .range(0, PRODUCT_PAGE_SIZE - 1);

        if (!rich.error && rich.data) {
          const rows = rich.data as TProduct[];
          setProducts(rows);
          setHasMoreProducts(rows.length >= PRODUCT_PAGE_SIZE);
          setProductOffset(rows.length);
          localStorage.setItem("boat.retail.products.cache.v1", JSON.stringify(rows));
          return;
        }

        const fallback = await supabase
          .from("products")
          .select("id,name,sales_price,cost_price,track_inventory")
          .eq("active", true)
          .order("name")
          .range(0, PRODUCT_PAGE_SIZE - 1);

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
        setHasMoreProducts(mapped.length >= PRODUCT_PAGE_SIZE);
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
    if (useDesktopLocalMode || !hasMoreProducts || loading) return;
    try {
      const { data, error } = await supabase
        .from("products")
        .select("id,name,sales_price,cost_price,track_inventory,department_id,barcode,sku,code")
        .eq("active", true)
        .order("name")
        .range(productOffset, productOffset + PRODUCT_PAGE_SIZE - 1);
      if (error) throw error;
      const rows = (data || []) as TProduct[];
      if (rows.length === 0) {
        setHasMoreProducts(false);
        return;
      }
      setProducts((prev) => [...prev, ...rows]);
      setProductOffset((prev) => prev + rows.length);
      if (rows.length < PRODUCT_PAGE_SIZE) setHasMoreProducts(false);
    } catch (error) {
      console.error("Failed to load more products:", error);
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
        const { data } = await supabase
          .from("products")
          .select("id,name,sales_price,cost_price,track_inventory,department_id,barcode,sku,code")
          .eq("active", true)
          .or(`name.ilike.%${q}%,barcode.ilike.%${q}%,sku.ilike.%${q}%,code.ilike.%${q}%`)
          .order("name")
          .limit(PRODUCT_PAGE_SIZE);
        setRemoteSearchProducts((data || []) as TProduct[]);
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
    productsError,
    hasMoreProducts,
    loadMoreProducts,
    productSearch,
    setProductSearch,
    filteredManualProducts,
  };
}
