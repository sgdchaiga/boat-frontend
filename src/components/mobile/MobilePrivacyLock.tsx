import { useEffect, useState } from "react";
import { Fingerprint, Loader2, LogOut, ShieldCheck } from "lucide-react";
import { mobileBiometricEnrolled, verifyMobileBiometric } from "@/lib/mobileBiometric";

export function MobilePrivacyLock({ userId, onSignOut }: { userId: string; onSignOut: () => void }) {
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mobileBiometricEnrolled(userId) || !matchMedia("(max-width: 767px)").matches) return;
    let timer = window.setTimeout(() => setLocked(true), 5 * 60_000);
    let hiddenAt = 0;
    const activity = () => { window.clearTimeout(timer); timer = window.setTimeout(() => setLocked(true), 5 * 60_000); };
    const visibility = () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > 30_000) setLocked(true);
    };
    const manualLock = () => setLocked(true);
    ["pointerdown", "keydown", "touchstart"].forEach((name) => window.addEventListener(name, activity, { passive: true }));
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("boat:mobile-privacy-lock", manualLock);
    return () => { window.clearTimeout(timer); ["pointerdown", "keydown", "touchstart"].forEach((name) => window.removeEventListener(name, activity)); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("boat:mobile-privacy-lock", manualLock); };
  }, [userId]);

  if (!locked) return null;
  const unlock = async () => {
    setBusy(true); setError(null);
    try { await verifyMobileBiometric(userId); setLocked(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not verify biometrics."); }
    finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950 p-4 text-white"><div className="w-full max-w-sm text-center"><ShieldCheck className="mx-auto h-12 w-12 text-emerald-400" /><h2 className="mt-4 text-xl font-bold">BOAT is locked</h2><p className="mt-2 text-sm text-slate-300">Verify with this phone to continue. Financial approvals still require normal BOAT authorization.</p>{error && <p className="mt-3 rounded-lg bg-red-950 p-3 text-sm text-red-200">{error}</p>}<button type="button" onClick={() => void unlock()} disabled={busy} className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 font-bold text-slate-950">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Fingerprint className="h-5 w-5" />}Unlock with biometrics</button><button type="button" onClick={onSignOut} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-700 text-sm"><LogOut className="h-4 w-4" />Sign out</button></div></div>;
}
