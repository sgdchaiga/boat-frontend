import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { getVslaOfflineDeviceId } from "@/lib/vslaOfflineQueue";

export function VslaV12SetupPage({ readOnly = false }: { readOnly?: boolean }) {
  const { user } = useAuth();
  const deviceId = getVslaOfflineDeviceId();
  const [share, setShare] = useState("2000");
  const [max, setMax] = useState("5");
  const [rate, setRate] = useState("10");
  const [term, setTerm] = useState("4");
  const [variance, setVariance] = useState("0");
  const [schedule, setSchedule] = useState("");
  const [deviceName, setDeviceName] = useState("Meeting device");
  const [offlineDeviceReady, setOfflineDeviceReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [designating, setDesignating] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!user?.organization_id) return;
      const [settings, controls, configuration, device] = await Promise.all([
        supabase.from("vsla_settings").select("share_value,max_shares_per_meeting").eq("organization_id", user.organization_id).maybeSingle(),
        (supabase as any).from("vsla_cash_reconciliation_controls").select("allowed_variance").eq("organization_id", user.organization_id).maybeSingle(),
        (supabase as any).from("vsla_v12_group_configuration").select("default_interest_rate,default_loan_term_meetings,meeting_schedule").eq("organization_id", user.organization_id).maybeSingle(),
        supabase.rpc("vsla_v12_is_offline_device_designated", { p_device_id: deviceId }),
      ]);
      if (settings.data) { setShare(String(settings.data.share_value)); setMax(String(settings.data.max_shares_per_meeting)); }
      if (controls.data) setVariance(String(controls.data.allowed_variance));
      if (configuration.data) { setRate(String(configuration.data.default_interest_rate)); setTerm(String(configuration.data.default_loan_term_meetings)); setSchedule(configuration.data.meeting_schedule ?? ""); }
      if (!device.error) setOfflineDeviceReady(device.data === true);
    })();
  }, [deviceId, user?.organization_id]);

  const save = async () => {
    setBusy(true); setError(null); setMessage(null);
    const { error: saveError } = await supabase.rpc("vsla_v12_update_configuration", { p_share_value: Number(share), p_max_shares: Number(max), p_interest_rate: Number(rate), p_loan_term: Number(term), p_allowed_variance: Number(variance), p_meeting_schedule: schedule });
    if (saveError) setError(saveError.message); else setMessage("v1.2 operating rules saved.");
    setBusy(false);
  };

  const designateOfflineDevice = async () => {
    setDesignating(true); setError(null); setMessage(null);
    const { error: designateError } = await supabase.rpc("vsla_v12_designate_offline_device", { p_device_id: deviceId, p_device_name: deviceName });
    if (designateError) setError(designateError.message);
    else { setOfflineDeviceReady(true); setMessage("This device is now the designated VSLA offline collection device. The previous device, if any, was revoked."); }
    setDesignating(false);
  };

  const numericFields: Array<{ label: string; value: string; setValue: (value: string) => void }> = [
    { label: "Share value", value: share, setValue: setShare },
    { label: "Maximum shares per meeting", value: max, setValue: setMax },
    { label: "Default loan interest %", value: rate, setValue: setRate },
    { label: "Default loan term (meetings)", value: term, setValue: setTerm },
    { label: "Allowed cash variance", value: variance, setValue: setVariance },
  ];

  return <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6 lg:p-8">
    <div><p className="text-xs font-bold uppercase tracking-wide text-indigo-700">VSLA v1.2 management</p><h1 className="text-2xl font-bold text-slate-900">Group setup</h1><p className="mt-1 text-sm text-slate-600">Set the operating rules before running a meeting.</p></div>
    {error && <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {message && <p className="rounded bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2">{numericFields.map((field) => <label key={field.label} className="text-sm text-slate-700">{field.label}<input type="number" min="0" value={field.value} onChange={(event) => field.setValue(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2" /></label>)}<label className="text-sm text-slate-700">Meeting schedule<input value={schedule} onChange={(event) => setSchedule(event.target.value)} placeholder="e.g. Every Saturday, 10:00" className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2" /></label></div>
    <button type="button" onClick={() => void save()} disabled={readOnly || busy} className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save operating rules"}</button>
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-5"><h2 className="font-semibold text-amber-950">Offline meeting device</h2><p className="mt-1 text-sm text-amber-900">For the first rollout, only one device per group can queue routine collections offline. Designating this device revokes the previous one.</p><label className="mt-4 block text-sm text-slate-700">Device name<input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} maxLength={80} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2" /></label><p className="mt-2 text-xs text-slate-600">Status: {offlineDeviceReady ? "This device is designated" : "Not designated"}</p><button type="button" onClick={() => void designateOfflineDevice()} disabled={readOnly || designating} className="mt-4 rounded-lg border border-amber-700 bg-white px-4 py-2 text-sm font-semibold text-amber-950 disabled:opacity-50">{designating ? "Designating…" : offlineDeviceReady ? "Re-designate this device" : "Designate this device"}</button></section>
  </div>;
}
