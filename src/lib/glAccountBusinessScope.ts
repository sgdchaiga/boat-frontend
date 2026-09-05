type AccountLike = {
  account_code?: string | null;
  account_name?: string | null;
  category?: string | null;
  business_type?: string | null;
};

const INDUSTRY_PATTERNS: Record<string, RegExp> = {
  hotel: /\b(hotel|guest|room revenue|room charge|accommodation|housekeeping|sauna|bar pos|kitchen pos)\b/i,
  clinic: /\b(clinic|patient|consultation|laboratory|medical|pharmacy|dispensary)\b/i,
  school: /\b(school|student|tuition|bursary|school fees?|term fees?)\b/i,
  sacco: /\b(sacco|member savings|loan portfolio|teller vault)\b/i,
  vsla: /\b(vsla|member savings|share[- ]?out)\b/i,
  manufacturing: /\b(raw materials? inventory|raw materials?|manufacturing wip|work in progress|finished goods(?: production| inventory)?|factory overhead|production overhead|production clearing|cost of goods manufactured|scrap inventory)\b/i,
};

// Legacy standard setup stamped every template account with the tenant's type.
// Match other industries by name, not code: account codes overlap across charts.
const NON_MANUFACTURING_ACCOUNT_NAMES = /\b(hotel|guest|rooms? (?:revenue|charges?|income)|accommodation|housekeeping|sauna|(?:bar|kitchen|restaurant|food|beverage|food\s*(?:&|and)\s*beverage) (?:pos|sales|revenue|income|inventory|cost of sales|equipment)|inventory\s*[-–—]\s*(?:bar|kitchen)|conference\s*(?:&|and)\s*events income|laundry (?:income|revenue)|clinic|patient|consultation|laboratory|medical (?:service|revenue|fees|supplies|inventory)|pharmacy|dispensary|school|student|tuition|bursary|term fees?|sacco|vsla|microfinance|loan portfolio|loan principal receivable|borrower|member savings|share[- ]?out|teller vault)\b/i;

export function isUnrelatedManufacturingAccountName(name?: string | null): boolean {
  return NON_MANUFACTURING_ACCOUNT_NAMES.test(String(name || ""));
}

/**
 * Canonical school chart codes. This also covers the later regular-expense
 * additions. It lets older school databases keep their legitimate accounts
 * even before the migration that tags them with `business_type = school`.
 */
const SCHOOL_STANDARD_CODES = new Set([
  "1000", "1100", "1110", "1120", "1130", "1140", "1150", "1160", "1170", "1180",
  "1200", "1210", "1220", "1230", "1240", "1250", "1260", "1290",
  "2000", "2100", "2110", "2120", "2130", "2140", "2150", "2160", "2200", "2210",
  "3000", "3100", "3200", "3300",
  "4000", "4100", "4110", "4120", "4130", "4140", "4150", "4160", "4170", "4180", "4190", "4200", "4210",
  "5000", "5100", "5110", "5120", "5130", "5140", "5150", "5160", "5170", "5180", "5190",
  "6000", "6100", "6110", "6120", "6130", "6140", "6150", "6160", "6170",
  "6200", "6210", "6220", "6230", "6240", "6250", "6260", "6270", "6280",
  "6300", "6310", "6320", "6330", "6340", "6350", "6360", "6370", "6380", "6390",
  "6400", "6410", "6420", "6430", "6500", "6510", "6520", "6530",
  "6600", "6610", "6620", "6630", "6640", "6650", "6660", "6700", "6800", "6900", "6910", "6920",
]);

export function isGlAccountRelevantForBusinessType(account: AccountLike, businessType?: string | null): boolean {
  const selectedType = String(businessType || "").toLowerCase();
  if (!selectedType || selectedType === "mixed") return true;
  const accountType = String(account.business_type || "").trim().toLowerCase();
  // An explicit industry tag is authoritative. Untagged accounts remain eligible
  // so schools can keep administrator-created accounts and common accounting heads.
  if (accountType && accountType !== "mixed" && accountType !== selectedType) return false;
  const text = `${account.account_code || ""} ${account.account_name || ""} ${account.category || ""}`;
  const taggedIndustries = Object.entries(INDUSTRY_PATTERNS).filter(([, pattern]) => pattern.test(text)).map(([industry]) => industry);
  if (selectedType === "school") {
    // A legacy template may have been incorrectly relabelled as `school`.
    // Recognizable non-school industry names are stronger evidence than that
    // stale tag (for example, "Raw Materials Inventory").
    if (taggedIndustries.some((industry) => industry !== "school") && !taggedIndustries.includes("school")) return false;
    if (accountType === "school") return true;
    if (
      SCHOOL_STANDARD_CODES.has(String(account.account_code || "").trim()) &&
      (taggedIndustries.length === 0 || taggedIndustries.includes("school"))
    ) return true;
    // Retain clearly school-specific legacy/custom accounts, but do not allow
    // untagged hotel, retail, clinic, lending or manufacturing templates into
    // the school chart merely because their business_type was never populated.
    return taggedIndustries.includes("school");
  }
  if (taggedIndustries.length === 0) return true;
  if (selectedType === "general_business" || selectedType === "retail" || selectedType === "restaurant") return false;
  return taggedIndustries.includes(selectedType);
}

/** Keep a chart or picker aligned to the active business while retaining neutral custom accounts. */
export function filterGlAccountsForBusinessType<T extends AccountLike>(accounts: T[], businessType?: string | null): T[] {
  return accounts.filter((account) => isGlAccountRelevantForBusinessType(account, businessType));
}

/** Curate chart maintenance without changing the accounts included in historical reports. */
export function isGlAccountRelevantForChart(account: AccountLike, businessType?: string | null): boolean {
  if (String(businessType || "").trim().toLowerCase() === "manufacturing") {
    const tag = String(account.business_type || "").trim().toLowerCase();
    if (tag && tag !== "mixed" && tag !== "manufacturing") return false;
    return !isUnrelatedManufacturingAccountName(account.account_name);
  }
  return isGlAccountRelevantForBusinessType(account, businessType);
}
