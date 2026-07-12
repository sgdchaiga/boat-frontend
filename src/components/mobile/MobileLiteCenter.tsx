import { useEffect, useMemo, useState } from "react";
import { Cloud, CloudOff, Download, Fingerprint, Gauge, Lock, LogOut, RefreshCw, Settings2, X } from "lucide-react";
import { readOfflineRetailQueue } from "@/lib/retailOfflineQueue";
import { readLocalSyncStatus } from "@/lib/localSyncStatus";
import { readMobilePerformance } from "@/lib/mobilePerformance";
import { confirmHeavyMobileNavigation, heavyFeatureForPage } from "@/lib/mobileHeavyFeatures";
import { enrollMobileBiometric, mobileBiometricAvailable, mobileBiometricEnrolled, removeMobileBiometric } from "@/lib/mobileBiometric";
import {
  defaultLiteShortcuts,
  loadLiteShortcuts,
  writePersonalLiteShortcuts,
  readLiteShortcuts,
  type LiteShortcut,
} from "@/lib/mobileLiteShortcuts";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

type Props = {
  open: boolean;
  onClose: () => void;
  onNavigate: (page: string) => void;
  onLock: () => void;
  organizationId: string | null;
  role: string | null;
  businessType: string | null;
  userId: string | null;
  onGlobalSignOut: () => void;
  cloudMode: boolean;
};

const QUEUE_KEYS = ["hotel-pos-offline-orders-v1", "boat_wallet_pending_tx", "boat.sacco.member.requests.v1"];

function storedArrayCount(key: string) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value.length : 0;
  } catch { return 0; }
}

export function MobileLiteCenter(props: Props) {
  const [online, setOnline] = useState(navigator.onLine);
  const [editing, setEditing] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [, setQueueVersion] = useState(0);
  const [shortcuts, setShortcuts] = useState(() => readLiteShortcuts(props.organizationId, props.role, props.businessType));
  const [biometricEnrolled, setBiometricEnrolled] = useState(() => Boolean(props.userId && mobileBiometricEnrolled(props.userId)));
  const [securityMessage, setSecurityMessage] = useState<string | null>(null);
  const candidates = useMemo(() => defaultLiteShortcuts(props.businessType), [props.businessType]);
  const retailQueue = readOfflineRetailQueue();
  const pending = retailQueue.length + QUEUE_KEYS.reduce((sum, key) => sum + storedArrayCount(key), 0);
  const failed = retailQueue.filter((row) => row.syncStatus === "failed").length;
  const sync = readLocalSyncStatus();
  const performance = readMobilePerformance();

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    const onInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent); };
    const onQueue = () => setQueueVersion((value) => value + 1);
    const onBiometric = () => setBiometricEnrolled(Boolean(props.userId && mobileBiometricEnrolled(props.userId)));
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("beforeinstallprompt", onInstall);
    window.addEventListener("boat:retail-offline-queue", onQueue);
    window.addEventListener("boat:biometric-changed", onBiometric);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("beforeinstallprompt", onInstall);
      window.removeEventListener("boat:retail-offline-queue", onQueue);
      window.removeEventListener("boat:biometric-changed", onBiometric);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void loadLiteShortcuts(props.organizationId, props.role, props.businessType).then((rows) => {
      if (active) setShortcuts(rows);
    });
    return () => { active = false; };
  }, [props.organizationId, props.role, props.businessType]);

  if (!props.open) return null;

  const navigate = (item: LiteShortcut) => {
    if (!confirmHeavyMobileNavigation(item.page)) return;
    props.onNavigate(item.page);
    props.onClose();
  };

  const toggleCandidate = (item: LiteShortcut) => {
    const exists = shortcuts.some((row) => row.page === item.page);
    const next = exists ? shortcuts.filter((row) => row.page !== item.page) : [...shortcuts, item].slice(0, 6);
    setShortcuts(next);
    // Personal edits apply immediately on this device. Organization-wide policies are managed in Admin.
    writePersonalLiteShortcuts(props.organizationId, props.role, next);
  };

  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/60 p-3 backdrop-blur-sm lg:hidden" role="dialog" aria-modal="true" aria-label="BOAT Lite centre">
      <div className="mx-auto flex h-full max-w-md flex-col overflow-hidden rounded-2xl bg-slate-50 shadow-2xl">
        <header className="flex items-center justify-between bg-slate-950 px-4 py-3 text-white">
          <div><h2 className="font-bold">BOAT Lite</h2><p className="text-xs text-slate-400">Daily work, connection and sync</p></div>
          <button type="button" onClick={props.onClose} className="min-h-11 min-w-11 rounded-lg" aria-label="Close"><X className="mx-auto h-5 w-5" /></button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <section className={`rounded-xl border p-3 ${online ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
            <div className="flex items-center gap-3">
              {online ? <Cloud className="h-5 w-5 text-emerald-700" /> : <CloudOff className="h-5 w-5 text-amber-700" />}
              <div className="flex-1"><p className="text-sm font-bold">{online ? "Online" : "Working offline"}</p><p className="text-xs text-slate-600">{pending} item{pending === 1 ? "" : "s"} waiting on this device{failed ? ` · ${failed} failed` : ""}</p></div>
              <button type="button" disabled={!online} onClick={() => window.dispatchEvent(new Event("online"))} className="min-h-10 rounded-lg border bg-white px-3 text-xs font-semibold disabled:opacity-40"><RefreshCw className="mr-1 inline h-4 w-4" /> Sync</button>
            </div>
            {sync.lastError && <p className="mt-2 text-xs text-red-700">Last sync issue: {sync.lastError}</p>}
            {failed > 0 && <div className="mt-2 rounded-lg border border-red-200 bg-white p-2 text-xs text-red-700"><p className="font-bold">{failed} retail sale{failed === 1 ? "" : "s"} need retry</p><p>The sales remain stored with the same transaction IDs, preventing duplicate posting during retry.</p></div>}
            {sync.lastSuccessAt && <p className="mt-2 text-xs text-slate-500">Last successful sync: {new Date(sync.lastSuccessAt).toLocaleString()}</p>}
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-bold text-slate-800">Quick actions</h3><button type="button" onClick={() => setEditing(!editing)} className="text-xs font-semibold text-brand-700"><Settings2 className="mr-1 inline h-4 w-4" />{editing ? "Done" : "Customize"}</button></div>
            {editing ? (
              <div className="space-y-2 rounded-xl border bg-white p-3">
                <p className="text-xs text-slate-500">Choose up to six actions for this organization and role.</p>
                {candidates.map((item) => <label key={item.page} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={shortcuts.some((row) => row.page === item.page)} onChange={() => toggleCandidate(item)} /> <span>{item.label}</span>{item.heavy && <span className="ml-auto text-[10px] text-amber-700">More data</span>}</label>)}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">{shortcuts.map((item) => { const heavy = item.heavy || Boolean(heavyFeatureForPage(item.page)); return <button key={item.page} type="button" onClick={() => navigate(item)} className="min-h-24 rounded-xl border bg-white p-3 text-left shadow-sm"><p className="text-sm font-bold text-slate-900">{item.label}</p><p className="mt-1 text-xs text-slate-500">{item.description}</p>{heavy && <p className="mt-2 text-[10px] font-semibold text-amber-700">More data · computer recommended</p>}</button>; })}</div>
            )}
          </section>

          <section className="grid grid-cols-2 gap-2">
            {installPrompt ? <button type="button" onClick={() => void installPrompt.prompt()} className="min-h-16 rounded-xl border bg-white p-3 text-left text-sm font-semibold"><Download className="mb-1 h-5 w-5 text-brand-700" />Install on phone</button> : <div className="min-h-16 rounded-xl border bg-white p-3 text-xs text-slate-600"><Download className="mb-1 h-5 w-5 text-brand-700" /><span className="font-semibold text-slate-800">Install BOAT</span><br />Use the browser menu, then “Add to Home screen”.</div>}
            <button type="button" disabled={props.cloudMode && !biometricEnrolled} onClick={props.onLock} className="min-h-16 rounded-xl border bg-white p-3 text-left text-sm font-semibold disabled:opacity-40"><Lock className="mb-1 h-5 w-5 text-slate-700" />Lock now{props.cloudMode && !biometricEnrolled && <span className="block text-[10px] font-normal">Enable biometrics first</span>}</button>
          </section>

          {props.cloudMode && props.userId && <section className="rounded-xl border bg-white p-3"><p className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-800"><Fingerprint className="h-5 w-5 text-brand-700" />Phone security</p><p className="text-xs text-slate-500">Biometrics protects the local privacy screen after five minutes or 30 seconds in the background. BOAT permissions still control transactions.</p><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" disabled={!mobileBiometricAvailable()} onClick={() => void (async () => { try { setSecurityMessage(null); if (biometricEnrolled) removeMobileBiometric(props.userId!); else await enrollMobileBiometric(props.userId!, "BOAT phone user"); } catch (reason) { setSecurityMessage(reason instanceof Error ? reason.message : "Biometric setup failed."); } })()} className="min-h-11 rounded-lg border px-2 text-xs font-semibold disabled:opacity-40">{biometricEnrolled ? "Remove biometrics" : "Enable biometrics"}</button><button type="button" onClick={() => { if (confirm("Sign out all BOAT cloud sessions for this account? Use this if a phone is lost.")) props.onGlobalSignOut(); }} className="min-h-11 rounded-lg border border-red-200 px-2 text-xs font-semibold text-red-700"><LogOut className="mr-1 inline h-4 w-4" />Sign out all devices</button></div>{securityMessage && <p className="mt-2 text-xs text-red-700">{securityMessage}</p>}</section>}

          <section className="rounded-xl border bg-white p-3 text-xs text-slate-600">
            <p className="mb-1 flex items-center gap-2 font-bold text-slate-800"><Gauge className="h-4 w-4" /> Device performance</p>
            <p>Last startup: {performance.lastStartupMs ? `${(performance.lastStartupMs / 1000).toFixed(1)}s` : "measuring"} · Average: {performance.averageStartupMs ? `${(performance.averageStartupMs / 1000).toFixed(1)}s` : "measuring"}</p>
            {performance.slowResources > 0 && <p className="mt-1 text-amber-700">{performance.slowResources} slow resource{performance.slowResources === 1 ? "" : "s"} detected.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
