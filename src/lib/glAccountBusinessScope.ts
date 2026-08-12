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

export function isGlAccountRelevantForBusinessType(account: AccountLike, businessType?: string | null): boolean {
  const selectedType = String(businessType || "").toLowerCase();
  if (!selectedType || selectedType === "mixed") return true;
  const accountType = String(account.business_type || "").trim().toLowerCase();
  // An explicit industry tag is authoritative. Untagged accounts remain eligible
  // so schools can keep administrator-created accounts and common accounting heads.
  if (accountType && accountType !== "mixed" && accountType !== selectedType) return false;
  const text = `${account.account_code || ""} ${account.account_name || ""} ${account.category || ""}`;
  const taggedIndustries = Object.entries(INDUSTRY_PATTERNS).filter(([, pattern]) => pattern.test(text)).map(([industry]) => industry);
  if (taggedIndustries.length === 0) return true;
  if (selectedType === "general_business" || selectedType === "retail" || selectedType === "restaurant") return false;
  return taggedIndustries.includes(selectedType);
}

/** Keep a chart or picker aligned to the active business while retaining neutral custom accounts. */
export function filterGlAccountsForBusinessType<T extends AccountLike>(accounts: T[], businessType?: string | null): T[] {
  return accounts.filter((account) => isGlAccountRelevantForBusinessType(account, businessType));
}
