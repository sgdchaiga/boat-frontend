/** Consistent display/storage casing for student, class, stream and guardian names. */
export function toSchoolTitleCase(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .replace(/(^|[\s'’-])\p{L}/gu, (match) => match.toLocaleUpperCase());
}
