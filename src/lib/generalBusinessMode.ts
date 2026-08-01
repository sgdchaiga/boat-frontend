import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type GeneralBusinessMode = "modern" | "cashbook";

const EVENT_NAME = "boat-general-business-mode-change";

function key(userId?: string | null, organizationId?: string | null): string {
  return `boat.general_business.mode.${organizationId || "no-org"}.${userId || "anonymous"}`;
}

export function readGeneralBusinessMode(userId?: string | null, organizationId?: string | null): GeneralBusinessMode {
  if (typeof window === "undefined") return "modern";
  return window.localStorage.getItem(key(userId, organizationId)) === "cashbook" ? "cashbook" : "modern";
}

export function writeGeneralBusinessMode(mode: GeneralBusinessMode, userId?: string | null, organizationId?: string | null): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key(userId, organizationId), mode);
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { mode, userId, organizationId } }));
}

export function useGeneralBusinessMode(userId?: string | null, organizationId?: string | null) {
  const [mode, setModeState] = useState<GeneralBusinessMode>(() => readGeneralBusinessMode(userId, organizationId));

  useEffect(() => {
    setModeState(readGeneralBusinessMode(userId, organizationId));
    const sync = () => setModeState(readGeneralBusinessMode(userId, organizationId));
    window.addEventListener(EVENT_NAME, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT_NAME, sync);
      window.removeEventListener("storage", sync);
    };
  }, [organizationId, userId]);

  useEffect(() => {
    if (!userId || !organizationId || typeof navigator === "undefined" || !navigator.onLine) return;
    let cancelled = false;
    const localModeAtRequest = readGeneralBusinessMode(userId, organizationId);
    void (supabase as any).from("user_app_preferences").select("general_business_mode")
      .eq("user_id", userId).eq("organization_id", organizationId).maybeSingle()
      .then(({ data, error }: { data?: { general_business_mode?: string } | null; error?: unknown }) => {
        if (cancelled || error || !data) return;
        // A click made while this request was in flight is newer than the cloud value.
        if (readGeneralBusinessMode(userId, organizationId) !== localModeAtRequest) return;
        const cloudMode: GeneralBusinessMode = data.general_business_mode === "cashbook" ? "cashbook" : "modern";
        writeGeneralBusinessMode(cloudMode, userId, organizationId);
        setModeState(cloudMode);
      });
    return () => { cancelled = true; };
  }, [organizationId, userId]);

  const setMode = useCallback((next: GeneralBusinessMode) => {
    writeGeneralBusinessMode(next, userId, organizationId);
    setModeState(next);
    if (userId && organizationId && (typeof navigator === "undefined" || navigator.onLine)) {
      void (supabase as any).from("user_app_preferences").upsert({
        user_id: userId,
        organization_id: organizationId,
        general_business_mode: next,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,organization_id" });
    }
  }, [organizationId, userId]);

  return { mode, setMode };
}
