export type PracticeMatchLine = {
  id: string; side: "cashbook" | "statement"; line_date: string;
  amount: number; reference: string | null; description: string;
  account_key: string | null; currency: string | null;
};
export type PracticeMatch = { ids: string[]; reason: string };
const normalize = (value: string | null) => (value || "").trim().replace(/\s+/g, " ").toUpperCase();
const reference = (value: string | null) => {
  const ref = normalize(value);
  return ["", "N/A", "NA", "NONE", "NULL", "-", "0"].includes(ref) ? "" : ref;
};
const cents = (value: number) => Math.round(value * 100);
const day = (value: string) => Date.parse(`${value}T00:00:00Z`);

/** Conservative proposals: never break ties using row order or net unrelated items. */
export function proposePracticeMatches(lines: PracticeMatchLine[]) {
  const valid = lines.filter(l => !!l.account_key?.trim() && /^[A-Z]{3}$/.test(l.currency || "") && Number.isFinite(l.amount) && l.amount !== 0 &&
    Number.isSafeInteger(cents(l.amount)) && Math.abs(l.amount * 100 - cents(l.amount)) < 0.0001 && Number.isFinite(day(l.line_date)));
  const scope = (l: PracticeMatchLine) => JSON.stringify([l.account_key, l.currency]);
  const fingerprint = (l: PracticeMatchLine) => JSON.stringify([scope(l), l.side, l.line_date, cents(l.amount), reference(l.reference), normalize(l.description)]);
  const occurrences = new Map<string, number>();
  valid.forEach(l => occurrences.set(fingerprint(l), (occurrences.get(fingerprint(l)) || 0) + 1));
  const duplicates = new Set(valid.filter(l => occurrences.get(fingerprint(l))! > 1).map(l => l.id));
  const groups: PracticeMatch[] = [];
  const used = new Set<string>();
  const byReference = new Map<string, PracticeMatchLine[]>();
  for (const line of valid) {
    const ref = reference(line.reference);
    const key = JSON.stringify([scope(line), ref]);
    if (ref) byReference.set(key, [...(byReference.get(key) || []), line]);
  }
  for (const members of byReference.values()) {
    const ref = reference(members[0].reference);
    if (members.some(l => duplicates.has(l.id))) continue;
    const cash = members.filter(l => l.side === "cashbook");
    const bank = members.filter(l => l.side === "statement");
    // Only one-to-one, one-to-many or many-to-one; repeated references on both sides need review.
    if (!cash.length || !bank.length || (cash.length > 1 && bank.length > 1)) continue;
    if (members.some(l => Math.sign(l.amount) !== Math.sign(members[0].amount))) continue;
    if (Math.max(...members.map(l => day(l.line_date))) - Math.min(...members.map(l => day(l.line_date))) > 3 * 86400000) continue;
    if (cash.reduce((s, l) => s + cents(l.amount), 0) !== bank.reduce((s, l) => s + cents(l.amount), 0)) continue;
    groups.push({ ids: members.map(l => l.id), reason: `Exact reference ${ref}; equal totals; within 3 days${members.length > 2 ? "; grouped settlement" : ""}` });
    members.forEach(l => used.add(l.id));
  }
  const remaining = valid.filter(l => !used.has(l.id) && !duplicates.has(l.id));
  const cash = remaining.filter(l => l.side === "cashbook");
  const bank = remaining.filter(l => l.side === "statement");
  const compatible = (a: PracticeMatchLine, b: PracticeMatchLine) =>
    scope(a) === scope(b) &&
    cents(a.amount) === cents(b.amount) && Math.abs(day(a.line_date) - day(b.line_date)) <= 3 * 86400000 &&
    !(reference(a.reference) && reference(b.reference) && reference(a.reference) !== reference(b.reference)) &&
    normalize(a.description).length >= 8 && normalize(a.description) === normalize(b.description);
  // Build the full graph before accepting anything, so ambiguity cannot disappear as matches are removed.
  const candidates = cash.map(a => ({ a, matches: bank.filter(b => compatible(a, b)) }));
  for (const { a, matches } of candidates) {
    if (matches.length !== 1 || candidates.filter(c => c.matches.some(b => b.id === matches[0].id)).length !== 1) continue;
    groups.push({ ids: [a.id, matches[0].id], reason: "Unique equal amount and exact description; within 3 days; no conflicting references" });
    used.add(a.id); used.add(matches[0].id);
  }
  return { groups, reviewIds: lines.filter(l => !used.has(l.id)).map(l => l.id) };
}
