export type MobileLitePreference = "auto" | "on" | "off";

const STORAGE_KEY = "boat.mobile-lite";

type NetworkInformation = {
  saveData?: boolean;
  effectiveType?: string;
  addEventListener?: (type: "change", listener: () => void) => void;
  removeEventListener?: (type: "change", listener: () => void) => void;
};

export function readMobileLitePreference(): MobileLitePreference {
  if (typeof window === "undefined") return "auto";
  const value = window.localStorage.getItem(STORAGE_KEY);
  return value === "on" || value === "off" ? value : "auto";
}

export function writeMobileLitePreference(value: MobileLitePreference) {
  if (typeof window === "undefined") return;
  if (value === "auto") window.localStorage.removeItem(STORAGE_KEY);
  else window.localStorage.setItem(STORAGE_KEY, value);
  window.dispatchEvent(new CustomEvent("boat-mobile-lite-change"));
}

export function networkInformation(): NetworkInformation | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { connection?: NetworkInformation }).connection;
}

export function shouldUseMobileLite(preference = readMobileLitePreference()): boolean {
  if (preference === "on") return true;
  if (preference === "off" || typeof window === "undefined") return false;
  const connection = networkInformation();
  const constrained = connection?.saveData || ["slow-2g", "2g"].includes(connection?.effectiveType ?? "");
  return window.matchMedia("(max-width: 767px)").matches && Boolean(constrained);
}

export function isConstrainedConnection(): boolean {
  const connection = networkInformation();
  return shouldUseMobileLite() || Boolean(connection?.saveData || ["slow-2g", "2g"].includes(connection?.effectiveType ?? ""));
}
