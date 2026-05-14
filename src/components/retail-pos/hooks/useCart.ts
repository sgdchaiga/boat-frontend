import { useMemo, useRef, useState } from "react";
import { toast } from "../../ui/use-toast";

export interface CartProduct {
  id: string;
}

export interface CartItem<TProduct extends CartProduct> {
  product: TProduct;
  quantity: number;
  lineTotal: number;
  /** When set, used as unit price for this line (overrides catalog / tier pricing). */
  unitPriceOverride?: number | null;
}

export function useCart<TProduct extends CartProduct>(getUnitPrice: (product: TProduct, quantity?: number) => number) {
  const [cartByProductId, setCartByProductId] = useState<Record<string, CartItem<TProduct>>>({});
  const cart = useMemo(() => Object.values(cartByProductId), [cartByProductId]);
  const total = useMemo(() => cart.reduce((sum, i) => sum + i.lineTotal, 0), [cart]);
  const [qtyPadProductId, setQtyPadProductId] = useState<string | null>(null);
  const [qtyPadValue, setQtyPadValue] = useState("1");
  /** After opening the pad, first digit replaces the seeded value (avoids "1"+"6" → "16"). */
  const qtyPadReplaceNextRef = useRef(false);

  const lineUnitPrice = (item: CartItem<TProduct>, quantity: number) =>
    item.unitPriceOverride != null && Number.isFinite(item.unitPriceOverride)
      ? item.unitPriceOverride
      : getUnitPrice(item.product, quantity);

  const addToCart = (product: TProduct) => {
    setCartByProductId((prev) => {
      const existing = prev[product.id];
      if (existing) {
        const nextQty = Number(existing.quantity) + 1;
        const unit = lineUnitPrice(existing, nextQty);
        return { ...prev, [product.id]: { ...existing, quantity: nextQty, lineTotal: unit * nextQty } };
      }
      const unit = getUnitPrice(product, 1);
      return { ...prev, [product.id]: { product, quantity: 1, lineTotal: unit } };
    });
  };

  const updateQty = (productId: string, nextQty: number) => {
    if (nextQty <= 0) {
      setCartByProductId((prev) => {
        const next = { ...prev };
        delete next[productId];
        return next;
      });
      return;
    }
    setCartByProductId((prev) => {
      const item = prev[productId];
      if (!item) return prev;
      const unit = lineUnitPrice(item, nextQty);
      return { ...prev, [productId]: { ...item, quantity: nextQty, lineTotal: unit * nextQty } };
    });
  };

  const setLineUnitPrice = (productId: string, nextUnitRaw: number) => {
    const nextUnit = Number(nextUnitRaw);
    if (!Number.isFinite(nextUnit) || nextUnit < 0) {
      toast({ title: "Invalid price", description: "Enter a valid zero or positive amount." });
      return;
    }
    const rounded = Math.round(nextUnit * 100) / 100;
    setCartByProductId((prev) => {
      const item = prev[productId];
      if (!item) return prev;
      return {
        ...prev,
        [productId]: {
          ...item,
          unitPriceOverride: rounded,
          lineTotal: rounded * item.quantity,
        },
      };
    });
  };

  const openQtyPad = (productId: string, quantity: number) => {
    setQtyPadProductId(productId);
    setQtyPadValue(String(quantity));
    qtyPadReplaceNextRef.current = true;
  };
  const closeQtyPad = () => {
    setQtyPadProductId(null);
    setQtyPadValue("1");
    qtyPadReplaceNextRef.current = false;
  };
  const applyQtyPad = () => {
    if (!qtyPadProductId) return;
    const parsed = Number(qtyPadValue);
    if (!Number.isFinite(parsed)) {
      toast({ title: "Invalid quantity", description: "Enter a valid whole number." });
      return;
    }
    updateQty(qtyPadProductId, Math.max(0, Math.floor(parsed)));
    closeQtyPad();
  };
  const qtyPadAppend = (digit: string) => {
    setQtyPadValue((prev) => {
      if (qtyPadReplaceNextRef.current) {
        qtyPadReplaceNextRef.current = false;
        return digit.slice(0, 6);
      }
      if (prev === "0" || prev === "") return digit.slice(0, 6);
      return `${prev}${digit}`.slice(0, 6);
    });
  };
  const qtyPadBackspace = () => {
    setQtyPadValue((prev) => (prev.length <= 1 ? "0" : prev.slice(0, -1)));
  };

  const clearCart = () => {
    setCartByProductId({});
  };

  return {
    cartByProductId,
    setCartByProductId,
    cart,
    total,
    addToCart,
    updateQty,
    setLineUnitPrice,
    clearCart,
    qtyPadProductId,
    qtyPadValue,
    setQtyPadValue,
    openQtyPad,
    closeQtyPad,
    applyQtyPad,
    qtyPadAppend,
    qtyPadBackspace,
  };
}
