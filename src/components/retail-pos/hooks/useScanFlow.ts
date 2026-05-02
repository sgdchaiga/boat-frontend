import { useEffect, useState } from "react";

interface ScanProduct {
  id: string;
  name: string;
  barcode?: string | null;
  sku?: string | null;
  code?: string | null;
}

interface UseScanFlowArgs<TProduct extends ScanProduct> {
  products: TProduct[];
  onExactMatch: (product: TProduct) => void;
}

export function useScanFlow<TProduct extends ScanProduct>({ products, onExactMatch }: UseScanFlowArgs<TProduct>) {
  const [scanCode, setScanCode] = useState("");
  const [debouncedScanQuery, setDebouncedScanQuery] = useState("");
  const [scanSuggestions, setScanSuggestions] = useState<TProduct[]>([]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedScanQuery(scanCode.trim().toLowerCase());
    }, 150);
    return () => window.clearTimeout(timer);
  }, [scanCode]);

  useEffect(() => {
    if (!debouncedScanQuery) {
      setScanSuggestions([]);
      return;
    }
    const exact =
      products.find((p) => (p.barcode || "").toLowerCase() === debouncedScanQuery) ||
      products.find((p) => (p.sku || "").toLowerCase() === debouncedScanQuery) ||
      products.find((p) => (p.code || "").toLowerCase() === debouncedScanQuery);
    if (exact) {
      onExactMatch(exact);
      setScanCode("");
      setScanSuggestions([]);
      return;
    }
    const top = products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(debouncedScanQuery) ||
          (p.barcode || "").toLowerCase().includes(debouncedScanQuery) ||
          (p.sku || "").toLowerCase().includes(debouncedScanQuery) ||
          (p.code || "").toLowerCase().includes(debouncedScanQuery)
      )
      .slice(0, 6);
    setScanSuggestions(top);
  }, [debouncedScanQuery, products, onExactMatch]);

  return {
    scanCode,
    setScanCode,
    scanSuggestions,
    setScanSuggestions,
  };
}
