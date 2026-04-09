import { useState, useRef, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BookOpen, HelpCircle, MessageCircle } from "lucide-react";

export type PageNotesProps = {
  children: ReactNode;
  /** Accessible name for the trigger and panel */
  ariaLabel?: string;
  /** "help" = ?, "comment" = message, "guide" = book (longer module guides) */
  variant?: "help" | "comment" | "guide";
  className?: string;
};

/**
 * Hides help / notes behind a small icon; opens a floating panel on click (Escape or click outside to close).
 * Use variant "guide" for longer module guides (e.g. payroll).
 */
export function PageNotes({ children, ariaLabel = "Page notes", variant = "help", className = "" }: PageNotesProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const updatePos = () => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const w = Math.min(360, window.innerWidth - 16);
    let left = r.left;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - 8 - w;
    if (left < 8) left = 8;
    setPos({ top: r.bottom + 8, left, width: w });
  };

  useEffect(() => {
    if (!open) return;
    updatePos();
    const onScroll = () => updatePos();
    const onResize = () => updatePos();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const Icon = variant === "comment" ? MessageCircle : variant === "guide" ? BookOpen : HelpCircle;

  return (
    <>
      <div className={`relative inline-flex items-center ${className}`} ref={wrapRef}>
        <button
          type="button"
          aria-label={ariaLabel}
          title={variant === "guide" ? "Open guide" : variant === "help" ? "Help" : "Notes"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="rounded-full p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-800 transition shrink-0"
        >
          <Icon className="w-4 h-4" strokeWidth={2} />
        </button>
      </div>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={ariaLabel}
            className="fixed z-[100] rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700 shadow-lg max-h-[min(70vh,420px)] overflow-y-auto"
            style={{ top: pos.top, left: pos.left, width: pos.width }}
          >
            <div className="text-slate-600 space-y-2 [&_p]:text-sm [&_ul]:text-sm [&_ol]:text-sm [&_li]:my-0.5">{children}</div>
          </div>,
          document.body
        )}
    </>
  );
}
