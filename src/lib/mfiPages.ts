export const MFI_PAGE = {
  dashboard: "mfi_dashboard",
  borrowers: "mfi_borrowers",
  products: "mfi_products",
  applications: "mfi_applications",
  approvals: "mfi_approvals_disbursements",
  collections: "mfi_collections",
  risk: "mfi_portfolio_risk",
  followups: "mfi_collection_followups",
  servicing: "mfi_loan_servicing",
  provisioning: "mfi_provisioning",
  restructures: "mfi_restructures",
  writeoffs: "mfi_writeoffs",
  integration: "mfi_integration",
  reports: "mfi_reports",
} as const;

export const MFI_HOME_PAGE = MFI_PAGE.dashboard;
