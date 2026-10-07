import { useCallback, useEffect, useState } from "react";
import { Save, Smartphone } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

const db = supabase as any;

type ManualMomoSettings = {
  recipient_name: string;
  recipient_phone: string;
  recipient_network: "mtn" | "airtel";
  payment_instructions: string;
  is_active: boolean;
};

const emptySettings: ManualMomoSettings = {
  recipient_name: "",
  recipient_phone: "",
  recipient_network: "mtn",
  payment_instructions: "",
  is_active: false,
};

export function MarketplaceManualMomoSettingsPanel({ organizationId }: { organizationId: string }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState<ManualMomoSettings>(emptySettings);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const result = await db
      .from("marketplace_manual_momo_settings")
      .select("recipient_name,recipient_phone,recipient_network,payment_instructions,is_active")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (result.error) {
      setMessage(result.error.message);
      return;
    }
    setSettings({ ...emptySettings, ...(result.data || {}) });
  }, [organizationId]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!settings.recipient_name.trim() || !settings.recipient_phone.trim()) {
      setMessage("Enter the Mobile Money account name and number.");
      return;
    }
    setSaving(true);
    setMessage(null);
    const result = await db.from("marketplace_manual_momo_settings").upsert({
      organization_id: organizationId,
      recipient_name: settings.recipient_name.trim(),
      recipient_phone: settings.recipient_phone.trim(),
      recipient_network: settings.recipient_network,
      payment_instructions: settings.payment_instructions.trim() || null,
      is_active: settings.is_active,
      updated_by: user?.id || null,
    }, { onConflict: "organization_id" });
    setSaving(false);
    if (result.error) {
      setMessage(result.error.message);
      return;
    }
    setMessage(settings.is_active ? "Manual MoMo checkout is active." : "Manual MoMo details saved but checkout remains off.");
  };

  return <section className="mt-6 border-t border-indigo-200 pt-5">
    <div className="flex items-center gap-2"><Smartphone className="h-5 w-5 text-indigo-700" /><h3 className="font-semibold text-slate-900">Manual Mobile Money checkout</h3></div>
    <p className="mt-1 text-sm text-slate-600">Customers pay to this number, then submit the transaction ID for an administrator to verify. No payment is treated as received before verification.</p>
    {message && <p className="mt-3 text-sm text-slate-700" role="status">{message}</p>}
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      <input value={settings.recipient_name} onChange={(event) => setSettings((current) => ({ ...current, recipient_name: event.target.value }))} placeholder="Registered MoMo account name" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      <input value={settings.recipient_phone} onChange={(event) => setSettings((current) => ({ ...current, recipient_phone: event.target.value }))} inputMode="tel" placeholder="MoMo receiving number" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      <select value={settings.recipient_network} onChange={(event) => setSettings((current) => ({ ...current, recipient_network: event.target.value as "mtn" | "airtel" }))} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
        <option value="mtn">MTN Mobile Money</option>
        <option value="airtel">Airtel Money</option>
      </select>
      <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={settings.is_active} onChange={(event) => setSettings((current) => ({ ...current, is_active: event.target.checked }))} /> Enable manual MoMo checkout</label>
      <textarea value={settings.payment_instructions} onChange={(event) => setSettings((current) => ({ ...current, payment_instructions: event.target.value }))} maxLength={500} placeholder="Optional instructions, e.g. use the order reference in your payment narration." className="min-h-20 rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-2" />
    </div>
    <button type="button" onClick={() => void save()} disabled={saving} className="app-btn-primary mt-3"><Save className="h-4 w-4" /> {saving ? "Saving…" : "Save manual MoMo details"}</button>
  </section>;
}
