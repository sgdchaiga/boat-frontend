export type MatchableStudent = {
  id: string;
  admission_number: string;
  school_pay_number?: string | null;
  first_name: string;
  other_names?: string | null;
  last_name: string;
};

export type StudentMatch = {
  student?: MatchableStudent;
  basis: "schoolpay_and_name" | "schoolpay_code" | "admission_number" | "exact_name" | "ambiguous" | "unmatched" | "conflict";
  candidates: MatchableStudent[];
};

export function normalizeStudentName(value: string | null | undefined): string {
  return String(value || "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

function containsCode(description: string, code: string): boolean {
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(description)) return true;
  // Payment providers often append a SchoolPay code to an otherwise unbroken transaction ID.
  // Only allow that form for substantial codes, so short numeric values cannot match by accident.
  return code.length >= 6 && description.toLocaleLowerCase().includes(code.toLocaleLowerCase());
}

function fullName(student: MatchableStudent): string {
  return [student.first_name, student.other_names, student.last_name].filter(Boolean).join(" ");
}

function containsFullName(description: string, name: string): boolean {
  const descriptionTokens = new Set(normalizeStudentName(description).split(" ").filter(Boolean));
  const nameTokens = normalizeStudentName(name).split(" ").filter(Boolean);
  return nameTokens.length > 0 && nameTokens.every((token) => descriptionTokens.has(token));
}

/**
 * Deterministic student matcher for statement descriptions. A name match is deliberately
 * only a proposal: callers must get a staff member to confirm it before posting a payment.
 */
export function matchStudentStatement(
  description: string,
  students: MatchableStudent[],
  aliases: Array<{ student_id: string; alias: string }> = []
): StudentMatch {
  const text = String(description || "").trim();
  if (!text) return { basis: "unmatched", candidates: [] };

  const codeMatches = students.filter((student) => {
    const code = String(student.school_pay_number || "").trim();
    return code.length > 0 && containsCode(text, code);
  });
  const uniqueCodeMatches = [...new Map(codeMatches.map((student) => [student.id, student])).values()];
  const admissionMatches = students.filter((student) => {
    const admissionNumber = String(student.admission_number || "").trim();
    return admissionNumber.length > 0 && containsCode(text, admissionNumber);
  });
  const uniqueAdmissionMatches = [...new Map(admissionMatches.map((student) => [student.id, student])).values()];
  const exactNameMatches = students.filter((student) => containsFullName(text, fullName(student)));
  const aliasMatches = aliases
    .filter((alias) => containsFullName(text, alias.alias))
    .map((alias) => students.find((student) => student.id === alias.student_id))
    .filter((student): student is MatchableStudent => Boolean(student));
  const exactMatches = [...new Map([...exactNameMatches, ...aliasMatches].map((student) => [student.id, student])).values()];

  if (uniqueCodeMatches.length === 1) {
    const [student] = uniqueCodeMatches;
    if (exactMatches.some((match) => match.id === student.id)) {
      return { student, basis: "schoolpay_and_name", candidates: [student] };
    }
    return { student, basis: "schoolpay_code", candidates: [student] };
  }
  if (uniqueCodeMatches.length > 1) return { basis: "ambiguous", candidates: uniqueCodeMatches };
  if (uniqueAdmissionMatches.length === 1) return { student: uniqueAdmissionMatches[0], basis: "admission_number", candidates: uniqueAdmissionMatches };
  if (uniqueAdmissionMatches.length > 1) return { basis: "ambiguous", candidates: uniqueAdmissionMatches };
  if (exactMatches.length === 1) return { student: exactMatches[0], basis: "exact_name", candidates: exactMatches };
  if (exactMatches.length > 1) return { basis: "ambiguous", candidates: exactMatches };
  return { basis: "unmatched", candidates: [] };
}
