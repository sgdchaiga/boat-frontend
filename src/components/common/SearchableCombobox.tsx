import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export type ComboboxOption = { id: string; label: string };

type SearchableComboboxProps = {
  value: string;
  onChange: (id: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  emptyOption?: { label: string };
  disabled?: boolean;
  className?: string;
  inputAriaLabel?: string;
};

export function SearchableCombobox({
  value,
  onChange,
  options,
  placeholder = "Type to search…",
  emptyOption,
  disabled = false,
  className = "",
  inputAriaLabel = "Search and select",
}: SearchableComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<{ top: number; left: number; width: number } | null>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = options.find((o) => o.id === value);
  const resolvedLabel =
    value && selected
      ? selected.label
      : value === "" && emptyOption
        ? emptyOption.label
        : "";

  useEffect(() => {
    if (!open) {
      setSearch(resolvedLabel);
    }
  }, [value, open, resolvedLabel, options]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    // Focus used to set search to emptyOption.label (e.g. "Choose…") which filtered out every real row.
    if (
      emptyOption &&
      value === "" &&
      search.trim().toLowerCase() === emptyOption.label.trim().toLowerCase()
    ) {
      return options;
    }
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, search, emptyOption, value]);

  const showEmptyRow =
    !!emptyOption &&
    (!search.trim() || emptyOption.label.toLowerCase().includes(search.trim().toLowerCase()));

  const inputDisplay = open ? search : resolvedLabel;

  const updatePosition = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPanel({
      top: r.bottom + 4,
      left: r.left,
      width: Math.max(r.width, 240),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPanel(null);
      return;
    }
    updatePosition();
  }, [open, filtered.length, search, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => updatePosition();
    const onResize = () => updatePosition();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Node;
      if (containerRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const pick = (id: string, label: string) => {
    onChange(id);
    setSearch(label);
    setOpen(false);
    inputRef.current?.blur();
  };

  const onInputFocus = () => {
    if (blurTimer.current) {
      clearTimeout(blurTimer.current);
      blurTimer.current = null;
    }
    setOpen(true);
    // Clear search so the full option list is visible. Seeding with the selected label (or a
    // placeholder like "Saved account missing from chart") filters `includes()` down to one row
    // and makes it impossible to pick another account without manually deleting the field.
    setSearch("");
  };

  const onInputBlur = () => {
    blurTimer.current = setTimeout(() => {
      setOpen(false);
      setSearch(resolvedLabel);
    }, 200);
  };

  const showPlaceholderStyle =
    (!value && !emptyOption) || (!!value && !selected && !(value === "" && emptyOption));

  const dropdown =
    open &&
    panel &&
    typeof document !== "undefined" &&
    createPortal(
      <ul
        ref={listRef}
        role="listbox"
        className="fixed rounded-lg border border-slate-200 bg-white py-1 shadow-lg max-h-60 overflow-y-auto text-sm text-left z-[9999]"
        style={{
          top: panel.top,
          left: panel.left,
          width: panel.width,
          minWidth: 240,
        }}
        onMouseDown={(e) => e.preventDefault()}
      >
        {showEmptyRow && emptyOption && (
          <li>
            <button
              type="button"
              role="option"
              className={`w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 ${
                value === "" ? "bg-slate-100" : ""
              }`}
              onClick={() => pick("", emptyOption.label)}
            >
              {value === "" ? <Check className="w-4 h-4 shrink-0 text-emerald-600" /> : <span className="w-4 shrink-0" />}
              <span className="text-slate-600">{emptyOption.label}</span>
            </button>
          </li>
        )}
        {filtered.length === 0 && !showEmptyRow && (
          <li className="px-3 py-2 text-slate-500 text-sm">No matches. Try another search.</li>
        )}
        {filtered.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              role="option"
              className={`w-full text-left px-3 py-2 hover:bg-slate-50 flex items-start gap-2 ${
                value === o.id ? "bg-slate-100" : ""
              }`}
              onClick={() => pick(o.id, o.label)}
            >
              {value === o.id ? <Check className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" /> : <span className="w-4 shrink-0" />}
              <span className="text-slate-800 break-words">{o.label}</span>
            </button>
          </li>
        ))}
      </ul>,
      document.body
    );

  return (
    <div
      ref={containerRef}
      className={`relative ${className}`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          disabled={disabled}
          value={inputDisplay}
          onChange={(e) => {
            setSearch(e.target.value);
            setOpen(true);
          }}
          onFocus={onInputFocus}
          onBlur={onInputBlur}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder={placeholder}
          aria-label={inputAriaLabel}
          autoComplete="off"
          spellCheck={false}
          className={`w-full border border-slate-300 rounded-lg pl-3 pr-9 py-2 text-sm bg-white hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed min-h-[42px] ${
            showPlaceholderStyle && !open ? "text-slate-400" : "text-slate-900"
          }`}
        />
        <ChevronDown
          className={`pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 transition ${open ? "rotate-180" : ""}`}
        />
      </div>
      {dropdown}
    </div>
  );
}
