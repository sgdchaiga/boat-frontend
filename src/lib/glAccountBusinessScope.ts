type AccountLike = { account_code?: string | null; account_name?: string | null; category?: string | null };

const INDUSTRY_PATTERNS: Record<string, RegExp> = {
  hotel: /\b(hotel|guest|room revenue|room charge|accommodation|housekeeping|sauna|bar pos|kitchen pos)\b/i,
  clinic: /\b(clinic|patient|consultation|laboratory|medical|pharmacy|dispensary)\b/i,
  school: /\b(school|student|tuition|bursary|school fees?|term fees?)\b/i,
  sacco: /\b(sacco|member savings|loan portfolio|teller vault)\b/i,
  vsla: /\b(vsla|member savings|share[- ]?out)\b/i,
  manufacturing: /\b(manufacturing wip|work in progress|finished goods production|production overhead|scrap inventory)\b/i,
};

export function isGlAccountRelevantForBusinessType(account: AccountLike, businessType?: string | null): boolean {
  const selectedType = String(businessType || "").toLowerCase();
  if (!selectedType || selectedType === "mixed") return true;
  const text = `${account.account_code || ""} ${account.account_name || ""} ${account.category || ""}`;
  const taggedIndustries = Object.entries(INDUSTRY_PATTERNS).filter(([, pattern]) => pattern.test(text)).map(([industry]) => industry);
  if (taggedIndustries.length === 0) return true;
  if (selectedType === "general_business" || selectedType === "retail" || selectedType === "restaurant") return false;
  return taggedIndustries.includes(selectedType);
}
