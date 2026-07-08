import type { BusinessType } from "@/contexts/AuthContext";

export type GuideStep = {
  id: string;
  title: string;
  note: string;
  page: string;
};

export type PageGuide = {
  title: string;
  duration: string;
  summary: string;
  steps: string[];
  faqs: { question: string; answer: string }[];
};

export type AssistantResult = {
  title: string;
  message: string;
  page?: string;
  checklistStep?: string;
};

function firstSetupPage(businessType: BusinessType | null | undefined): string {
  if (businessType === "manufacturing") return "manufacturing";
  if (businessType === "sacco") return "sacco_overview";
  if (businessType === "vsla") return "vsla_dashboard";
  if (businessType === "school") return "school_dashboard";
  if (businessType === "clinic") return "clinic_dashboard";
  if (businessType === "retail" || businessType === "restaurant" || businessType === "agriculture") return "retail_dashboard";
  return "dashboard";
}

function firstCustomerPage(businessType: BusinessType | null | undefined): string {
  if (businessType === "sacco") return "sacco_members";
  if (businessType === "vsla") return "vsla_members";
  if (businessType === "school") return "school_students";
  if (businessType === "clinic") return "clinic_patients";
  if (businessType === "hotel") return "hotel_customers";
  return "retail_customers";
}

function firstProductPage(businessType: BusinessType | null | undefined): string {
  if (businessType === "manufacturing") return "manufacturing_bom";
  if (businessType === "sacco") return "sacco_loan_settings";
  if (businessType === "vsla") return "vsla_controls";
  if (businessType === "school") return "school_fee_structures";
  return "Products";
}

function firstSalePage(businessType: BusinessType | null | undefined): string {
  if (businessType === "manufacturing") return "manufacturing_production_entries";
  if (businessType === "sacco") return "sacco_teller";
  if (businessType === "vsla") return "vsla_savings";
  if (businessType === "school") return "school_fee_payments";
  if (businessType === "clinic") return "clinic_pos";
  if (businessType === "hotel") return "checkin";
  return "retail_pos";
}

function reportPage(businessType: BusinessType | null | undefined): string {
  if (businessType === "school") return "reports_school_fee_collections";
  if (businessType === "manufacturing") return "reports_manufacturing_daily_production";
  if (businessType === "sacco") return "sacco_financial_summaries";
  if (businessType === "vsla") return "vsla_reports";
  return "reports";
}

export function guidedTourSteps(businessType: BusinessType | null | undefined): GuideStep[] {
  return [
    {
      id: "tour_choose_template",
      title: "Confirm workspace template",
      note: "Check that the selected business type, currency, and modules match the organization.",
      page: firstSetupPage(businessType),
    },
    {
      id: "tour_first_contact",
      title: "Create the first contact",
      note: "Add a customer, member, student, patient, or guest before recording transactions.",
      page: firstCustomerPage(businessType),
    },
    {
      id: "tour_first_item",
      title: "Create the first item",
      note: "Add the product, service, fee, loan product, recipe, or bill of materials used for the first transaction.",
      page: firstProductPage(businessType),
    },
    {
      id: "tour_first_purchase",
      title: "Record the first purchase",
      note: "Capture the first supplier bill, stock purchase, or operating expense.",
      page: "purchases_expenses",
    },
    {
      id: "tour_first_sale",
      title: "Record the first sale or activity",
      note: "Post the first receipt, sale, production entry, collection, or member transaction.",
      page: firstSalePage(businessType),
    },
    {
      id: "tour_first_report",
      title: "Review the first report",
      note: "Confirm the transaction appears in operational and accounting reports.",
      page: reportPage(businessType),
    },
  ];
}

const pageGuides: Record<string, PageGuide> = {
  dashboard: {
    title: "Dashboard guide",
    duration: "3 min",
    summary: "Use the dashboard to confirm today cash, sales, activity, and setup gaps before entering transactions.",
    steps: ["Review alerts first.", "Open any setup task that blocks posting.", "Use report links to investigate unusual balances."],
    faqs: [
      { question: "Why are some figures blank?", answer: "They appear after the first posted transaction or opening balance import." },
      { question: "Can I change the business type later?", answer: "A platform admin should review that change because it affects module defaults and account settings." },
    ],
  },
  data_migration: {
    title: "Data migration guide",
    duration: "5 min",
    summary: "Import master data, stock counts, Google Sheets data, and balanced opening entries before go-live.",
    steps: ["Download a template.", "Preview the file and fix flagged rows.", "Import master data first, then stock and opening balances."],
    faqs: [
      { question: "Can I import unbalanced opening balances?", answer: "No. Debit and credit totals must match before posting." },
      { question: "Should I import stock before products?", answer: "Products should exist first so stock quantities can link correctly." },
    ],
  },
  purchases_expenses: {
    title: "Purchase and expense guide",
    duration: "4 min",
    summary: "Record supplier bills, stock purchases, and operating expenses so payables, inventory, and expense accounts stay current.",
    steps: ["Choose the supplier or payee.", "Select the stock item or expense account.", "Confirm tax, department, and payment status before posting."],
    faqs: [
      { question: "Where does rent go?", answer: "Post rent to the rent expense account, then use cost allocation to share it across departments by floor area." },
      { question: "When should I use stock purchase?", answer: "Use it when quantities should increase in inventory." },
    ],
  },
  accounting_cost_allocation: {
    title: "Cost allocation guide",
    duration: "5 min",
    summary: "Set drivers by expense type, enter monthly actuals per cost centre, then approve journals for shared costs.",
    steps: ["Map each expense to a driver such as floor area or headcount.", "Enter actual driver values for each department.", "Disable cost centres that should not share that expense, then preview and post."],
    faqs: [
      { question: "What happens when a cost centre is off?", answer: "The remaining enabled cost centres share the full expense using their driver values." },
      { question: "Can manufacturing overhead go to batches?", answer: "Yes. Use production overhead allocation after the overhead pool is ready." },
    ],
  },
  manufacturing_production_entries: {
    title: "Production entry guide",
    duration: "5 min",
    summary: "Move materials, labour, and overhead through WIP, finished goods, and COGS using the manufacturing flow.",
    steps: ["Issue raw materials into WIP.", "Add direct labour and allocated factory overhead.", "Complete production into finished goods, then recognize COGS when sold."],
    faqs: [
      { question: "Why use WIP?", answer: "WIP holds production costs until the batch is completed." },
      { question: "When does finished goods reduce?", answer: "Finished goods reduce when cost of goods sold is recognized." },
    ],
  },
};

const defaultGuide: PageGuide = {
  title: "Page guide",
  duration: "3 min",
  summary: "Use this page to complete the related setup or transaction, then check reports for the accounting effect.",
  steps: ["Confirm required settings are complete.", "Enter the transaction details carefully.", "Save or post, then review the related report."],
  faqs: [
    { question: "What should I do first?", answer: "Start with the required master data, then record the transaction." },
    { question: "How do I correct a mistake?", answer: "Use the page's edit, reverse, or adjustment workflow where available instead of deleting posted accounting records." },
  ],
};

export function guidanceForPage(page: string, businessType: BusinessType | null | undefined): PageGuide {
  if (pageGuides[page]) return pageGuides[page];
  if (page === firstSetupPage(businessType)) {
    return {
      title: "Workspace setup guide",
      duration: "4 min",
      summary: "Verify the generated template so chart of accounts, roles, departments, and settings match the organization.",
      steps: ["Review the business type and enabled modules.", "Check chart of accounts and journal account settings.", "Open data migration when setup defaults are verified."],
      faqs: [
        { question: "Why are defaults already filled?", answer: "BOAT loads a standard setup for the selected business type to reduce mistakes and keep organizations uniform." },
        { question: "Can I edit the defaults?", answer: "Yes. Admins should verify and adjust them before go-live." },
      ],
    };
  }
  if (page === firstCustomerPage(businessType)) {
    return {
      title: "First contact guide",
      duration: "3 min",
      summary: "Create the person or organization used in transactions and statements.",
      steps: ["Enter the name and contact details.", "Add opening balance only if it was not imported.", "Save, then use this contact in the first sale or receipt."],
      faqs: [{ question: "Can I import contacts instead?", answer: "Yes. Use Data migration for bulk customer, supplier, member, student, or patient setup." }],
    };
  }
  if (page === firstProductPage(businessType)) {
    return {
      title: "First item guide",
      duration: "4 min",
      summary: "Create the item, service, fee, loan product, recipe, or bill of materials that drives daily transactions.",
      steps: ["Set the name and category.", "Confirm price, cost, tax, and stock behavior.", "Save before recording sales or purchases."],
      faqs: [{ question: "Why does account mapping matter?", answer: "It tells BOAT which sales, inventory, expense, WIP, or income accounts to post to." }],
    };
  }
  if (page === firstSalePage(businessType)) {
    return {
      title: "First transaction guide",
      duration: "5 min",
      summary: "Post the first sale, collection, production entry, or member transaction and confirm reports update.",
      steps: ["Select the customer or member.", "Choose the item or transaction type.", "Post and review the receipt, stock, cash, or accounting impact."],
      faqs: [{ question: "Where do I check the result?", answer: "Open reports after posting and compare cash, revenue, inventory, or member balances." }],
    };
  }
  if (page === reportPage(businessType)) {
    return {
      title: "Reports guide",
      duration: "3 min",
      summary: "Use reports to confirm setup quality and catch missing transactions early.",
      steps: ["Select the report period.", "Compare totals with source documents.", "Investigate blanks, negative balances, or unexpected account movements."],
      faqs: [{ question: "Why does a report show no data?", answer: "Check the date range, posting status, and whether opening balances or first transactions exist." }],
    };
  }
  return defaultGuide;
}

export function answerAssistantPrompt(prompt: string, businessType: BusinessType | null | undefined): AssistantResult {
  const text = prompt.toLowerCase();

  if (/\b(import|excel|csv|google sheet|opening balance|opening stock|migration)\b/.test(text)) {
    return {
      title: "Open Data migration",
      message: "Use Data migration to preview spreadsheets, import master records, load stock counts, and post balanced opening entries.",
      page: "data_migration",
      checklistStep: "import_data",
    };
  }
  if (/\b(buy|purchase|supplier|bill|expense|rent|sugar|stock)\b/.test(text)) {
    return {
      title: "Record a purchase or expense",
      message: "Start on Purchases and Expenses. For stock items, choose the product and quantity. For rent or utilities, choose the expense account and let cost allocation share it later.",
      page: "purchases_expenses",
      checklistStep: "first_purchase",
    };
  }
  if (/\b(cost allocation|allocate|overhead|floor area|headcount|machine hour|labour hour)\b/.test(text)) {
    return {
      title: "Open Cost allocation",
      message: "Set the driver on the expense rule, enter actual driver values by department, disable any excluded cost centre, then preview and post the allocation journal.",
      page: "accounting_cost_allocation",
    };
  }
  if (/\b(sell|sale|receipt|receive payment|pos|invoice|collect)\b/.test(text)) {
    return {
      title: "Record the first sale or receipt",
      message: "Open the transaction page, select the contact and item, then post. BOAT will update cash, income, stock, member, or production balances based on the business type.",
      page: firstSalePage(businessType),
      checklistStep: "first_sale",
    };
  }
  if (/\b(customer|member|patient|student|guest|client)\b/.test(text)) {
    return {
      title: "Create the first contact",
      message: "Create the contact before using them on sales, collections, loans, fees, clinic visits, or hotel check-ins.",
      page: firstCustomerPage(businessType),
      checklistStep: "first_contact",
    };
  }
  if (/\b(product|item|service|fee|recipe|bom|loan product)\b/.test(text)) {
    return {
      title: "Create the first item",
      message: "Create the item or service and verify account mapping before using it in transactions.",
      page: firstProductPage(businessType),
      checklistStep: "first_item",
    };
  }
  if (/\b(report|profit|loss|sales report|stock report|trial balance|balance sheet)\b/.test(text)) {
    return {
      title: "Open reports",
      message: "Choose the right period, then review the report for missing setup, unposted entries, or unexpected account balances.",
      page: reportPage(businessType),
      checklistStep: "first_report",
    };
  }
  if (/\b(journal|chart of accounts|coa|account setting|posting)\b/.test(text)) {
    return {
      title: "Review accounting settings",
      message: "Open administration or accounting settings to confirm chart of accounts and posting defaults before transactions go live.",
      page: "admin",
      checklistStep: "verify_defaults",
    };
  }

  return {
    title: "Suggested next step",
    message: "Start with the guided tour: confirm defaults, create a contact, create an item, record a purchase, post a sale or activity, then review reports.",
    page: firstSetupPage(businessType),
  };
}

