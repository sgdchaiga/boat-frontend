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
  const tier = context?.customerTier ?? "standard";
  /** Tier-only discounts. Quantity-based bulk tiers were removed: they re-priced the whole line at thresholds (e.g. qty 6) and made POS totals look wrong. */
  const tierDiscount = tier === "wholesale" ? 0.06 : tier === "vip" ? 0.03 : 0;
  const discount = Math.min(0.2, tierDiscount);
  return Math.round(base * (1 - discount) * 100) / 100;
}

export function getMarginPercent(product: PosProductLike, unitPrice: number): number {
  const cost = Number(product.cost_price ?? 0);
  if (unitPrice <= 0) return 0;
  return Math.round((((unitPrice - cost) / unitPrice) * 100) * 100) / 100;
}
