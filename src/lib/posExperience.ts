/** POS copy for standalone retail vs clinic / pharmacy tenants (same `retail_*` routes and data). */
export type PosExperience = "retail" | "pharmacy";

export interface PosLabels {
  receiptTitle: string;
  receiptReprintTitle: string;
  posHeading: string;
  posHelpAria: string;
  posHelpBlurb: string;
  patientOrCustomerTab: string;
  walkIn: string;
  receiptAttributionLabel: string;
  saleCompletedToast: string;
  checkoutFailLogPrefix: string;
  mobilePhoneHint: string;
  defaultPayerName: string;
  managerVatHelp: string;
  receiptPreviewSubtitleWhenOrgNamed: string;
  receiptPreviewFallbackHeading: string;
  customerSaveFailedTitle: string;
  customerSaveFailedBody: string;
  customerNameRequiredTitle: string;
  customerNameRequiredDesc: string;
  customerSavedTitle: string;
  saveWithoutOrgDescription: string;
  ordersPageTitle: string;
  ordersPageHelpAria: string;
  editOrderTitle: string;
  linkedAccountLabel: string;
  customerNameOnReceiptLabel: string;
  noLinkedAccountOption: string;
  settleModalTitle: string;
  retailCustomersListPageTitle: string;
  retailCustomersListHelpAria: string;
  retailCustomersListBlurb: string;
  addPayerAccountButton: string;
  /** Clinic / pharmacy-only workspace (separate POS UI). */
  dispensingWorkspaceHeading: string;
  dispensingWorkspaceBlurb: string;
  paymentPanelTitle: string;
  medicineScanPlaceholder: string;
  medicineScanButton: string;
  medicineSearchPlaceholder: string;
  medicineSearchResultsHeading: string;
  noMatchingMedicines: string;
  loadMoreMedicines: string;
  emptyDispensing: string;
  dispensingCartSummary: string;
  medicineNotFoundTitle: string;
  medicineNotFoundDescription: string;
  offlineDispensingQueuedTitle: string;
  offlineDispensingQueuedBody: string;
}

export function getPosLabels(exp: PosExperience): PosLabels {
  const p = exp === "pharmacy";
  return {
    receiptTitle: p ? "Pharmacy Receipt" : "Retail Receipt",
    receiptReprintTitle: p ? "Pharmacy Receipt (Reprint)" : "Retail Receipt (Reprint)",
    posHeading: p ? "Pharmacy POS" : "Retail POS",
    dispensingWorkspaceHeading: p ? "Pharmacy dispensing" : "Retail POS",
    dispensingWorkspaceBlurb: p
      ? "Search patients and consultations on the left; add medicines, then collect payment and print a pharmacy receipt."
      : "Scan items, total updates instantly, take payment, print receipt in seconds.",
    posHelpAria: p ? "Pharmacy POS help" : "Retail POS help",
    posHelpBlurb: p
      ? "Scan items, total updates instantly, take payment, print pharmacy receipt."
      : "Scan items, total updates instantly, take payment, print receipt in seconds.",
    paymentPanelTitle: p ? "Collect payment" : "Payment",
    medicineScanPlaceholder: p ? "Scan medicine barcode / SKU" : "Scan barcode / SKU",
    medicineScanButton: p ? "Scan medicine" : "Scan Item",
    medicineSearchPlaceholder: p ? "Search medicines" : "Search products",
    medicineSearchResultsHeading: p ? "Medicine matches" : "Search results",
    noMatchingMedicines: p ? "No matching medicines" : "No matching products",
    loadMoreMedicines: p ? "Load more medicines" : "Load more products",
    emptyDispensing: p ? "No medicines in this dispensing yet." : "No items yet. Start scanning.",
    dispensingCartSummary: p ? "Current dispensing" : "Cart",
    medicineNotFoundTitle: p ? "Medicine not found" : "Item not found",
    medicineNotFoundDescription: p ? "No medicine matched the scanned code." : "No product matched the scanned code.",
    offlineDispensingQueuedTitle: p ? "Offline" : "Offline mode",
    offlineDispensingQueuedBody: p
      ? "Dispensing queued offline and will sync automatically."
      : "Sale queued offline and will sync automatically.",
    patientOrCustomerTab: p ? "Patient" : "Customer",
    walkIn: p ? "Walk-in patient" : "Walk-in customer",
    receiptAttributionLabel: p ? "Patient" : "Customer",
    saleCompletedToast: p ? "Dispensing completed" : "Retail sale completed",
    checkoutFailLogPrefix: p ? "Pharmacy checkout failed" : "Retail checkout failed",
    mobilePhoneHint: p
      ? "Enter patient phone to proceed with mobile payment."
      : "Enter customer phone to proceed with mobile payment.",
    defaultPayerName: p ? "Walk-in patient" : "Retail customer",
    managerVatHelp: p ? "Enable VAT in pharmacy checkout" : "Enable VAT in retail checkout",
    receiptPreviewSubtitleWhenOrgNamed: p ? "Pharmacy Receipt" : "Retail Receipt",
    receiptPreviewFallbackHeading: p ? "Pharmacy Receipt" : "Retail Receipt",
    customerSaveFailedTitle: p ? "Patient save failed" : "Customer save failed",
    customerSaveFailedBody: p
      ? "Continuing sale without saving patient profile."
      : "Continuing sale without saving customer profile.",
    customerNameRequiredTitle: p ? "Patient name required" : "Customer name required",
    customerNameRequiredDesc: p ? "Enter patient name before saving." : "Enter customer name before saving.",
    customerSavedTitle: p ? "Patient saved" : "Customer saved",
    saveWithoutOrgDescription: p
      ? "Cannot save patient without organization context."
      : "Cannot save customer without organization context.",
    ordersPageTitle: p ? "Pharmacy POS Orders" : "Retail POS Orders",
    ordersPageHelpAria: p ? "Pharmacy POS orders help" : "Retail POS orders help",
    editOrderTitle: p ? "Edit pharmacy POS order" : "Edit Retail POS Order",
    linkedAccountLabel: p ? "Linked patient (POS account)" : "Retail customer",
    customerNameOnReceiptLabel: p ? "Patient name on receipt" : "Customer name on receipt",
    noLinkedAccountOption: p ? "Walk-in / no linked patient" : "Walk-in / no linked customer",
    settleModalTitle: p ? "Settle pharmacy POS order" : "Settle Retail POS Order",
    retailCustomersListPageTitle: p ? "Patient accounts (POS)" : "Customers",
    retailCustomersListHelpAria: p ? "Patient accounts (POS) help" : "Retail customers help",
    retailCustomersListBlurb: p
      ? "Patient accounts for pharmacy POS walk-ins. For the clinic register and invoices, use Clinic → Patients."
      : "Sales customers used when creating invoices.",
    addPayerAccountButton: p ? "Add patient account" : "Add customer",
  };
}

/** Labels for the dedicated clinic POS left rail (always pharmacy wording). */
export const CLINIC_POS_LEFT_SECTIONS = {
  patientSearch: "Patient search",
  consultationNotes: "Consultation notes",
  prescriptionSearch: "Prescription search",
  medicineSearch: "Medicine search",
  quickAddMedicines: "Quick add medicines",
  /** Unit sales price for a cart line (editable in dispensing). */
  lineSalesPriceEach: "Each",
} as const;
