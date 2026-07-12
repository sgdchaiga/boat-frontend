import { shouldUseMobileLite } from "@/lib/mobileLite";

export type HeavyFeatureReason = "report" | "document" | "bulk-data" | "administration" | "analytics";

export type HeavyFeature = {
  reason: HeavyFeatureReason;
  title: string;
  detail: string;
};

const exact: Record<string, HeavyFeature> = {
  admin: { reason: "administration", title: "Administration", detail: "This workspace contains large configuration forms and is easier to use on a computer." },
  data_migration: { reason: "bulk-data", title: "Data migration", detail: "Imports can transfer large files and should use a stable connection and a computer." },
  image_document_converter: { reason: "document", title: "Image and document converter", detail: "Document conversion can upload large images and use significant phone memory." },
  practice_annual_accounts: { reason: "document", title: "Annual accounts", detail: "Annual accounts contain wide financial statements and document exports." },
  sacco_bulk_import: { reason: "bulk-data", title: "SACCO bulk import", detail: "Bulk imports should use a stable connection and a computer." },
  ecosystem: { reason: "administration", title: "Ecosystem settings", detail: "Integration and API configuration is safer on a computer." },
  industry_intelligence: { reason: "analytics", title: "Industry intelligence", detail: "This workspace may load additional analytics and comparison data." },
  agent_hub: { reason: "analytics", title: "Agent Hub", detail: "This workspace may load broader operational and messaging data." },
};

export function heavyFeatureForPage(page: string): HeavyFeature | null {
  const normalized = page.trim().toLowerCase();
  if (exact[normalized]) return exact[normalized];
  if (normalized.startsWith("platform_")) return { reason: "administration", title: "Platform administration", detail: "Platform administration is designed for a larger screen and may load organization-wide data." };
  if (normalized.includes("bulk_import") || normalized.includes("data_import")) return { reason: "bulk-data", title: "Bulk data operation", detail: "Bulk data operations can transfer large files and should use a stable connection." };
  if (normalized.startsWith("reports_") || normalized.endsWith("_report") || normalized.includes("reports")) return { reason: "report", title: "Detailed report", detail: "Detailed reports may load many records, charts, PDF tools or spreadsheet exports." };
  if (normalized.includes("analytics") || normalized.includes("performance")) return { reason: "analytics", title: "Analytics workspace", detail: "Analytics may load charts and a larger date range." };
  return null;
}

const acknowledged = new Set<string>();

export function confirmHeavyMobileNavigation(page: string): boolean {
  if (!shouldUseMobileLite()) return true;
  const feature = heavyFeatureForPage(page);
  if (!feature || acknowledged.has(page)) return true;
  const proceed = window.confirm(`${feature.title} may use more mobile data\n\n${feature.detail}\n\nContinue on this phone?`);
  if (proceed) acknowledged.add(page);
  return proceed;
}

export function clearHeavyFeatureAcknowledgements() {
  acknowledged.clear();
}
