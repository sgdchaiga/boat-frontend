import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ChevronDown, Landmark, PiggyBank, Plus, UserPlus, Wallet } from "lucide-react";
import { SACCOPRO_PAGE } from "@/lib/saccoproPages";

type NavigateFn = (page: string, state?: Record<string, unknown>) => void;

interface SaccoNewTransactionFabProps {
  onNavigate: NavigateFn;
}

export function SaccoNewTransactionFab({ onNavigate }: SaccoNewTransactionFabProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const rows: { label: string; icon: LucideIcon; nav: () => void }[] = [
    {
      label: "Receive money",
      icon: Landmark,
      nav: () => onNavigate(SACCOPRO_PAGE.teller, { tellerDesk: "receive" }),
    },
    {
      label: "Give loan (disburse)",
      icon: PiggyBank,
      nav: () => onNavigate(SACCOPRO_PAGE.loanDisbursement),
    },
    {
      label: "Deposit savings",
      icon: Wallet,
      nav: () => onNavigate(SACCOPRO_PAGE.teller, { tellerDesk: "receive", tellerTask: "deposit" }),
    },
    {
      label: "Register member",
      icon: UserPlus,
      nav: () =>
        onNavigate(SACCOPRO_PAGE.members, {
          memberRegister: true,
        }),
    },
  ];

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-900/20 hover:bg-emerald-700 transition min-h-[44px]"
      >
        <Plus className="w-5 h-5 shrink-0" strokeWidth={2.5} />
        <span>New transaction</span>
        <ChevronDown className={`w-4 h-4 shrink-0 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-[min(100vw-2rem,20rem)] rounded-xl border border-slate-200 bg-white py-1 shadow-lg z-[100]">
          <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-100">
            Quick start
          </p>
          <ul className="p-1">
            {rows.map((r) => {
              const Ic = r.icon;
              return (
                <li key={r.label}>
                  <button
                    type="button"
                    className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-800 hover:bg-emerald-50"
                    onClick={() => {
                      setOpen(false);
                      r.nav();
                    }}
                  >
                    <Ic className="w-4 h-4 text-emerald-700 shrink-0" />
                    {r.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
