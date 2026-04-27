export interface PosProductLike {
  id: string;
  sales_price: number | null;
  cost_price: number | null;
}

export interface PriceContext {
  customerTier?: "standard" | "vip" | "wholesale";
  quantity?: number;
}

export function getProductPrice(product: PosProductLike, context?: PriceContext): number {
  const base = Number(product.sales_price ?? 0);
  const qty = Number(context?.quantity ?? 1);
  const tier = context?.customerTier ?? "standard";
  // Lightweight pricing intelligence hook: bulk + tier discounts.
  const bulkDiscount = qty >= 12 ? 0.07 : qty >= 6 ? 0.04 : 0;
  const tierDiscount = tier === "wholesale" ? 0.06 : tier === "vip" ? 0.03 : 0;
  const discount = Math.min(0.2, bulkDiscount + tierDiscount);
  return Math.round(base * (1 - discount) * 100) / 100;
}

export function getMarginPercent(product: PosProductLike, unitPrice: number): number {
  const cost = Number(product.cost_price ?? 0);
  if (unitPrice <= 0) return 0;
  return Math.round((((unitPrice - cost) / unitPrice) * 100) * 100) / 100;
}
