/** Removes redundant integer-leading zeroes without changing valid decimals such as 0.25. */
export function normalizeNumericInputValue(value: string): string {
  if (!value) return value;
  const match = /^(-?)(0+)(\d+)(.*)$/.exec(value);
  if (!match) return value;
  const [, sign, , integerDigits, suffix] = match;
  return `${sign}${integerDigits}${suffix}`;
}

/** Improves native number inputs across both new and existing forms. */
export function installNumericInputConvenience(root: Document = document): () => void {
  const onFocus = (event: FocusEvent) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "number") return;
    if (/^-?0+(?:\.0+)?$/.test(input.value)) input.select();
  };
  const onInput = (event: Event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "number") return;
    const normalized = normalizeNumericInputValue(input.value);
    if (normalized !== input.value) input.value = normalized;
  };
  root.addEventListener("focusin", onFocus);
  root.addEventListener("input", onInput, true);
  return () => {
    root.removeEventListener("focusin", onFocus);
    root.removeEventListener("input", onInput, true);
  };
}
