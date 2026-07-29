import * as XLSX from "xlsx";

const sheets: Record<string, (string | number)[][]> = {
  Instructions: [
    ["BOAT MICROFINANCE CONNECT WORKBOOK"],
    ["Import order", "1 Borrowers -> 2 Guarantors/Collateral -> 3 Applications -> 4 Opening Loans -> 5 Repayments -> 6 Follow-ups"],
    ["Identifiers", "external_reference must be unique and must never be reused."],
    ["Safety", "Posted transactions cannot be overwritten. Deleted spreadsheet rows never delete BOAT records."],
    ["Google Sheets", "Upload this workbook to Google Sheets without changing the header row."],
  ],
  Borrowers: [
    ["external_reference","borrower_type","full_name","gender","date_of_birth","national_id","registration_number","phone","alternative_phone","email","physical_address","occupation","employer","business_activity","estimated_income","branch","group_or_centre","status","notes"],
    ["BRW-EXT-001","individual","Example Borrower","","1990-01-01","CM00000001","","+256700000000","","borrower@example.com","Kampala","Trader","","Retail",1500000,"Main","","active",""],
  ],
  Applications: [
    ["external_reference","borrower_external_reference","product_code","amount_requested","proposed_term","repayment_frequency","purpose","proposed_first_repayment_date","monthly_income","monthly_expenses","existing_debt","application_date","notes"],
    ["APP-EXT-001","BRW-EXT-001","SME01",1000000,12,"monthly","Working capital","2026-08-23",1500000,600000,100000,"2026-07-23",""],
  ],
  Opening_Loans: [
    ["external_reference","loan_number","borrower_external_reference","product_code","principal","outstanding_principal","outstanding_interest","outstanding_fees","outstanding_penalties","interest_rate","term","repayment_frequency","first_repayment_date","disbursement_date","days_past_due","status"],
    ["LOAN-EXT-001","LN-OLD-001","BRW-EXT-001","SME01",1000000,750000,50000,0,0,3,12,"monthly","2026-01-31","2025-12-31",0,"active"],
  ],
  Repayments: [
    ["external_reference","loan_number","payment_date","amount","payment_method","receipt_number"],
    ["PAY-EXT-001","LN-OLD-001","2026-07-23",100000,"mobile_money","RCT-001"],
  ],
  Guarantors: [
    ["external_reference","borrower_external_reference","full_name","national_id","phone","address","relationship","estimated_income"],
    ["GUA-EXT-001","BRW-EXT-001","Example Guarantor","CM00000002","+256700000001","Kampala","Business partner",2000000],
  ],
  Collateral: [
    ["external_reference","borrower_external_reference","collateral_type","description","estimated_value","ownership_details","status"],
    ["COL-EXT-001","BRW-EXT-001","vehicle","Motor vehicle registration UXX 000X",2500000,"Registered to borrower","proposed"],
  ],
  Followups: [
    ["external_reference","loan_number","contact_date","contact_method","borrower_response","promise_to_pay_amount","promise_date","followup_date","field_visit_notes","outcome","next_action"],
    ["FUP-EXT-001","LN-OLD-001","2026-07-23","phone","Will pay on Friday",100000,"2026-07-25","2026-07-26","","Promise received","Confirm payment"],
  ],
};

export function downloadMfiConnectWorkbook() {
  const workbook = XLSX.utils.book_new();
  Object.entries(sheets).forEach(([name, rows]) => {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet["!cols"] = rows[0].map((header) => ({ wch: Math.max(16, String(header).length + 2) }));
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  });
  XLSX.writeFile(workbook, "BOAT_Microfinance_Connect_Templates.xlsx");
}

