/** Removes redundant integer-leading zeroes without changing valid decimals such as 0.25. */
export function normalizeNumericInputValue(value: string): string {
  if (!value) return value;
  const match = /^(-?)(0+)(\d+)(.*)$/.exec(value);
  if (!match) return value;
  const [, sign, , integerDigits, suffix] = match;
  return `${sign}${integerDigits}${suffix}`;
}

/**
 * Selects a default zero when a number input receives focus, allowing the
 * user's first keystroke to replace it. This deliberately avoids mutating
 * controlled inputs during the input event, which can fight React state and
 * cause visible layout jitter on dense entry screens such as Cashbook.
 */
export function installNumericInputConvenience(root: Document = document): () => void {
  const onFocus = (event: FocusEvent) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "number") return;
    if (/^-?0+(?:\.0+)?$/.test(input.value)) input.select();
  };
  root.addEventListener("focusin", onFocus);
  return () => {
    root.removeEventListener("focusin", onFocus);
  };
}
