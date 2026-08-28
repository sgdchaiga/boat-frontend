export function nextSchoolAdmissionNumber(
  admissionNumbers: Array<string | null | undefined>,
  year = new Date().getFullYear()
): string {
  const prefix = String(year);
  let highest = 0;

  for (const value of admissionNumbers) {
    const admissionNumber = String(value ?? "").trim();
    if (!new RegExp(`^${prefix}\\d{4}$`).test(admissionNumber)) continue;
    highest = Math.max(highest, Number(admissionNumber.slice(4)));
  }

  const next = highest + 1;
  if (next > 9999) throw new Error(`Admission numbers for ${year} have been exhausted.`);
  return `${prefix}${String(next).padStart(4, "0")}`;
}
