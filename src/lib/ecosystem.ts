import type { BusinessType } from "@/contexts/AuthContext";

export type MarketplaceModule = {
  id: string;
  title: string;
  category: "Operations" | "Finance" | "Customer" | "Compliance" | "Mobile";
  summary: string;
  businessTypes: Array<BusinessType | "all">;
  status: "available" | "planned";
};

export type EcosystemConnector = {
  id: string;
  title: string;
  summary: string;
  type: "Accounting" | "Payments" | "Messaging" | "Data" | "Banking";
};

export type ApiClient = {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
};

export type WebhookEndpoint = {
  id: string;
  event: string;
  url: string;
  createdAt: string;
};

export type MobileChannels = {
  pwa?: boolean;
  offline_pos?: boolean;
  member_app?: boolean;
  customer_portal?: boolean;
  staff_field_app?: boolean;
};

export const marketplaceModules: MarketplaceModule[] = [
  {
    id: "hotel_loyalty",
    title: "Hotel loyalty",
    category: "Customer",
    summary: "Guest rewards, repeat-stay tracking, and loyalty statements.",
    businessTypes: ["hotel", "mixed"],
    status: "planned",
  },
  {
    id: "room_service",
    title: "Room service",
    category: "Operations",
    summary: "Mobile room orders routed to kitchen, bar, billing, and guest folios.",
    businessTypes: ["hotel", "mixed"],
    status: "available",
  },
  {
    id: "production_planning",
    title: "Production planning",
    category: "Operations",
    summary: "Plan material requirements, work orders, capacity, and production calendars.",
    businessTypes: ["manufacturing"],
    status: "available",
  },
  {
    id: "quality_control",
    title: "Quality control",
    category: "Compliance",
    summary: "Inspection checkpoints, batch holds, non-conformance notes, and release approvals.",
    businessTypes: ["manufacturing", "agriculture"],
    status: "available",
  },
  {
    id: "school_transport",
    title: "School transport",
    category: "Operations",
    summary: "Routes, transport billing, attendance, and vehicle assignment.",
    businessTypes: ["school"],
    status: "planned",
  },
  {
    id: "school_library",
    title: "School library",
    category: "Operations",
    summary: "Catalog books, issue returns, fines, and student borrowing history.",
    businessTypes: ["school"],
    status: "planned",
  },
  {
    id: "sacco_mobile_member_app",
    title: "SACCO member mobile app",
    category: "Mobile",
    summary: "Member balances, statements, loan requests, QR payments, and notifications.",
    businessTypes: ["sacco"],
    status: "available",
  },
  {
    id: "clinic_patient_portal",
    title: "Clinic patient portal",
    category: "Mobile",
    summary: "Patient registration, invoices, lab results, payment links, and visit history.",
    businessTypes: ["clinic"],
    status: "planned",
  },
  {
    id: "advanced_budgeting",
    title: "Advanced budgeting",
    category: "Finance",
    summary: "Budget approvals, rolling forecasts, variance packs, and departmental targets.",
    businessTypes: ["all"],
    status: "available",
  },
  {
    id: "open_api_pack",
    title: "Open API pack",
    category: "Finance",
    summary: "API clients, webhooks, and integration logs for external systems.",
    businessTypes: ["all"],
    status: "available",
  },
];

export const ecosystemConnectors: EcosystemConnector[] = [
  { id: "google_sheets", title: "Google Sheets", type: "Data", summary: "Sync shared sheets through BOAT Connect mapping." },
  { id: "csv_excel", title: "CSV / Excel", type: "Data", summary: "File imports for data migration and repeat synchronization." },
  { id: "mobile_money", title: "Mobile money gateways", type: "Payments", summary: "MTN, Airtel, Flutterwave, and DPO payment flows." },
  { id: "sms_whatsapp", title: "SMS and WhatsApp", type: "Messaging", summary: "Notifications, statements, reminders, and campaign messages." },
  { id: "bank_feeds", title: "Bank feeds", type: "Banking", summary: "Statement import, reconciliation lines, and cash control feeds." },
  { id: "external_accounting", title: "External accounting APIs", type: "Accounting", summary: "REST/JSON endpoints for journals, invoices, payments, and reports." },
];

export function modulesForBusinessType(businessType: BusinessType | null | undefined) {
  return marketplaceModules.filter((module) => module.businessTypes.includes("all") || (businessType ? module.businessTypes.includes(businessType) : false));
}

export function defaultMobileChannels(businessType: BusinessType | null | undefined): MobileChannels {
  return {
    pwa: true,
    offline_pos: ["retail", "restaurant", "hotel", "mixed", "clinic"].includes(String(businessType)),
    member_app: businessType === "sacco" || businessType === "vsla",
    customer_portal: ["hotel", "clinic", "school", "retail"].includes(String(businessType)),
    staff_field_app: ["agriculture", "manufacturing", "school"].includes(String(businessType)),
  };
}

