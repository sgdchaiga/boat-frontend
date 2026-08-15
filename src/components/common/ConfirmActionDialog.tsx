import { useEffect, useRef } from "react";

export function ConfirmActionDialog({ open, title, message, confirmLabel = "Confirm", busy = false, destructive = false, onConfirm, onCancel }: { open: boolean; title: string; message: string; confirmLabel?: string; busy?: boolean; destructive?: boolean; onConfirm: () => void; onCancel: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const listener = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onCancel(); };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [busy, onCancel, open]);
  if (!open) return null;
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}><div role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-message" className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"><h2 id="confirm-dialog-title" className="text-lg font-semibold text-slate-900">{title}</h2><p id="confirm-dialog-message" className="mt-2 text-sm text-slate-600">{message}</p><div className="mt-5 flex justify-end gap-2"><button ref={cancelRef} type="button" onClick={onCancel} disabled={busy} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm disabled:opacity-50">Cancel</button><button type="button" onClick={onConfirm} disabled={busy} className={`rounded-lg px-4 py-2 text-sm text-white disabled:opacity-50 ${destructive ? "bg-rose-700" : "bg-indigo-700"}`}>{busy ? "Working..." : confirmLabel}</button></div></div></div>;
}
