import { FormEvent, useState } from "react";
import { KeyRound, Loader2, Lock, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

export function TerminalLockOverlay() {
  const {
    user,
    accessSession,
    terminalLocked,
    pinChangeRequired,
    unlockWithPin,
    changePin,
    switchUser,
    clockOut,
  } = useAuth();
  const [pin, setPin] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user || (!terminalLocked && !pinChangeRequired)) return null;

  const submitUnlock = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await unlockWithPin(pin);
    if (res.error) setError(res.error.message);
    else setPin("");
    setBusy(false);
  };

  const submitPinChange = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (newPin !== confirmPin) {
      setError("PINs do not match.");
      return;
    }
    setBusy(true);
    const res = await changePin(currentPin, newPin);
    if (res.error) setError(res.error.message);
    else {
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-[120] bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-900 text-white p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500 flex items-center justify-center">
              {pinChangeRequired ? <KeyRound className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="font-semibold">{pinChangeRequired ? "Change PIN" : "Terminal locked"}</h2>
              <p className="text-xs text-slate-300">{accessSession?.terminal_used || "Local terminal"}</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-slate-300">
            {pinChangeRequired
              ? "Your PIN is due for renewal before you continue."
              : `Locked as ${user.full_name || user.email}. Enter PIN to continue.`}
          </p>
        </div>

        {error && (
          <div className="mx-5 mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {pinChangeRequired ? (
          <form onSubmit={submitPinChange} className="p-5 space-y-3">
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              value={currentPin}
              onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Current PIN"
              autoFocus
            />
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              minLength={4}
              maxLength={6}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="New PIN, 4-6 digits"
            />
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              minLength={4}
              maxLength={6}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Confirm new PIN"
            />
            <button type="submit" disabled={busy} className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white">
              {busy ? <Loader2 className="mx-auto w-4 h-4 animate-spin" /> : "Update PIN"}
            </button>
          </form>
        ) : (
          <form onSubmit={submitUnlock} className="p-5 space-y-3">
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              minLength={4}
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-center text-lg tracking-[0.35em]"
              placeholder="PIN"
              autoFocus
            />
            <button type="submit" disabled={busy} className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white">
              {busy ? <Loader2 className="mx-auto w-4 h-4 animate-spin" /> : "Unlock"}
            </button>
          </form>
        )}

        <div className="px-5 pb-5 flex gap-2">
          <button type="button" onClick={switchUser} className="flex-1 rounded-lg border border-slate-300 py-2 text-sm text-slate-700">
            Switch User
          </button>
          <button type="button" onClick={clockOut} className="flex-1 rounded-lg border border-red-200 py-2 text-sm text-red-700 flex items-center justify-center gap-1.5">
            <LogOut className="w-4 h-4" /> Clock Out
          </button>
        </div>
      </div>
    </div>
  );
}
