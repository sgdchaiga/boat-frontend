import { useState } from "react";

export interface CashierSessionLike {
  id: string;
  opened_at: string;
  opening_float: number;
  status: "open" | "closed";
}

export function useSession<T extends CashierSessionLike>() {
  const [activeSession, setActiveSession] = useState<T | null>(null);
  const [posMode, setPosMode] = useState<"cashier" | "manager">("cashier");
  const [openingFloatDraft, setOpeningFloatDraft] = useState("0");
  const [closingCashDraft, setClosingCashDraft] = useState("");
  const [sessionBusy, setSessionBusy] = useState(false);

  return {
    activeSession,
    setActiveSession,
    posMode,
    setPosMode,
    openingFloatDraft,
    setOpeningFloatDraft,
    closingCashDraft,
    setClosingCashDraft,
    sessionBusy,
    setSessionBusy,
  };
}
