import type { RefObject } from "react";

interface ProductLike {
  id: string;
  name: string;
}

interface CartItemLike<TProduct extends ProductLike> {
  product: TProduct;
  quantity: number;
  lineTotal: number;
}

interface CashierCartPanelProps<TProduct extends ProductLike> {
  scanCode: string;
  setScanCode: (value: string) => void;
  handleScan: () => void;
  quickPickProducts: TProduct[];
  addToCart: (product: TProduct) => void;
  getUnitPrice: (product: TProduct, quantity?: number) => number;
  productSearch: string;
  setProductSearch: (value: string) => void;
  filteredManualProducts: TProduct[];
  cart: CartItemLike<TProduct>[];
  updateQty: (productId: string, qty: number) => void;
  scanInputRef?: RefObject<HTMLInputElement | null>;
}

export function CashierCartPanel<TProduct extends ProductLike>({
  scanCode,
  setScanCode,
  handleScan,
  quickPickProducts,
  addToCart,
  getUnitPrice,
  productSearch,
  setProductSearch,
  filteredManualProducts,
  cart,
  updateQty,
  scanInputRef,
}: CashierCartPanelProps<TProduct>) {
  const showSearchResults = productSearch.trim().length > 0;
  const searchResultRows = filteredManualProducts.slice(0, 8);

  return (
    <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-3 h-full min-h-0 overflow-y-auto">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
        <input
          ref={scanInputRef}
          value={scanCode}
          onChange={(e) => setScanCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleScan();
          }}
          placeholder="Scan barcode / SKU"
          className="md:col-span-2 border border-slate-300 rounded-lg px-4 py-3 text-base font-semibold"
        />
        <button
          type="button"
          onClick={handleScan}
          className="app-btn-primary text-base hover:bg-brand-900"
        >
          Scan Item
        </button>
      </div>

      <div className="mb-3">
        <p className="text-sm font-semibold text-slate-700 mb-2">Quick Picks</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {quickPickProducts.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => addToCart(p)}
              className="text-sm border border-slate-300 rounded-lg px-3 py-2 hover:bg-slate-50 text-left truncate"
            >
              <span className="block truncate">{p.name}</span>
              <span className="block text-[11px] text-slate-500">{getUnitPrice(p).toFixed(0)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2 mb-3">
        <input
          value={productSearch}
          onChange={(e) => setProductSearch(e.target.value)}
          placeholder="Search products"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
        />
        {showSearchResults && (
          <div className="rounded-lg border border-slate-300 bg-white">
            <p className="px-3 py-2 text-xs font-semibold text-slate-600 border-b border-slate-100">Search results</p>
            <div className="max-h-52 overflow-y-auto">
              {searchResultRows.length === 0 ? (
                <p className="px-3 py-2 text-sm text-slate-500">No matching products</p>
              ) : (
                searchResultRows.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addToCart(p)}
                    className="w-full px-3 py-2 text-left text-sm border-b last:border-b-0 border-slate-100 hover:bg-slate-50 flex items-center justify-between"
                  >
                    <span className="truncate pr-3">{p.name}</span>
                    <span className="text-xs text-slate-500">{getUnitPrice(p).toFixed(0)}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold text-slate-800">Cart</p>
        <span className="text-xs text-slate-500">{cart.length} item{cart.length === 1 ? "" : "s"}</span>
      </div>

      <div className="rounded-lg border border-slate-200 min-h-[220px] max-h-[42vh] lg:max-h-[50vh] overflow-y-auto">
        {cart.length === 0 ? (
          <p className="text-sm text-slate-500 p-3">No items yet. Start scanning.</p>
        ) : (
          cart.map((item) => (
            <div key={item.product.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-3 py-2 border-b last:border-b-0">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">
                  {item.product.name} x{item.quantity}
                </p>
              </div>
              <span className="text-sm font-bold text-slate-900">{item.lineTotal.toFixed(0)}</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => updateQty(item.product.id, item.quantity - 1)}
                  className="h-7 w-7 rounded border border-slate-300 text-sm font-bold text-slate-800 hover:bg-slate-100"
                  aria-label={`Decrease ${item.product.name}`}
                >
                  -
                </button>
                <button
                  type="button"
                  onClick={() => updateQty(item.product.id, item.quantity + 1)}
                  className="h-7 w-7 rounded border border-slate-300 text-sm font-bold text-slate-800 hover:bg-slate-100"
                  aria-label={`Increase ${item.product.name}`}
                >
                  +
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
