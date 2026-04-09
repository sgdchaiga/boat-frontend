import { useMemo } from "react";
import { SearchableCombobox } from "./SearchableCombobox";

export type GlAccountOption = {
  id: string;
  account_code: string;
  account_name: string;
};

type GlAccountPickerProps = {
  value: string;
  onChange: (id: string) => void;
  options: GlAccountOption[];
  placeholder?: string;
  emptyOption?: { label: string };
  disabled?: boolean;
  className?: string;
};

function labelFor(a: GlAccountOption) {
  return `${a.account_code} — ${a.account_name}`;
}

/** GL account field with type-to-search (filters code and name). */
export function GlAccountPicker({
  value,
  onChange,
  options,
  placeholder = "Type to search…",
  emptyOption,
  disabled = false,
  className = "",
}: GlAccountPickerProps) {
  const comboboxOptions = useMemo(
    () => options.map((o) => ({ id: o.id, label: labelFor(o) })),
    [options]
  );

  return (
    <SearchableCombobox
      value={value}
      onChange={onChange}
      options={comboboxOptions}
      placeholder={placeholder}
      emptyOption={emptyOption}
      disabled={disabled}
      className={className}
      inputAriaLabel="Search GL account by code or name"
    />
  );
}
