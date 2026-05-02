/** Product name shown in UI, PDFs, and browser title. */
export const APP_NAME = "Business operations automation technologies (BOAT)";

/** Short label for nav, compact headers, and tab title. */
export const APP_SHORT_NAME = "BOAT";

/** Cover line on outbound assessment PDFs (“your logo” / reseller brand). Override with VITE_ASSESSMENT_REPORT_BRAND. */
export const ASSESSMENT_REPORT_BRAND_LINE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_ASSESSMENT_REPORT_BRAND)?.trim?.() || "Charrk";
