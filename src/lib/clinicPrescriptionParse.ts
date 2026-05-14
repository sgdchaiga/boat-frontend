/** Split free-text prescription / notes into display tokens (for patient history). */
export function extractPrescriptionTokens(texts: string[]): string[] {
  const map = new Map<string, string>();
  for (const raw of texts) {
    const t = String(raw || "").trim();
    if (!t) continue;
    for (const part of t.split(/[\n\r,;•·|]+/)) {
      let p = part.replace(/^[-*]\s*/, "").trim();
      if (p.length < 2) continue;
      const k = p.toLowerCase();
      if (!map.has(k)) map.set(k, p);
    }
  }
  return [...map.values()];
}
