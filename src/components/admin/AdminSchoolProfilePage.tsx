import { useEffect, useState } from "react";
import { Building2, DollarSign, ImageUp, MapPin, Save } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { DEFAULT_SCHOOL_PAYMENT_METHODS, SCHOOL_PAYMENT_METHODS, normalizeSchoolPaymentMethods, type SchoolPaymentMethod } from "@/lib/schoolPaymentMethods";
import { desktopApi } from "@/lib/desktopApi";
import { hydrateHotelConfig, loadHotelConfig, saveHotelConfig, saveHotelConfigToCloud } from "@/lib/hotelConfig";

const LOCAL_AUTH_ON = ["true", "1", "yes"].includes((import.meta.env.VITE_LOCAL_AUTH || "").trim().toLowerCase());
const USE_LOCAL_SQLITE = LOCAL_AUTH_ON && desktopApi.isAvailable();

type Profile = { name: string; address: string; logoUrl: string };

export function AdminSchoolProfilePage() {
  const { user, refreshUserFlags } = useAuth();
  const orgId = user?.organization_id;
  const [profile, setProfile] = useState<Profile>({ name: "", address: "", logoUrl: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<SchoolPaymentMethod[]>(DEFAULT_SCHOOL_PAYMENT_METHODS);
  const [savingMethods, setSavingMethods] = useState(false);
  const [credentialMonths, setCredentialMonths] = useState({ password: 3, pin: 3 });
  const [savingSecurity, setSavingSecurity] = useState(false);
  const [currency, setCurrency] = useState("UGX");
  const [savingCurrency, setSavingCurrency] = useState(false);
  const [purchasesRequirePoApproval, setPurchasesRequirePoApproval] = useState(true);
  const [purchasesRequireBillApproval, setPurchasesRequireBillApproval] = useState(true);
  const [treasurySpendMoneyApprovalEnabled, setTreasurySpendMoneyApprovalEnabled] = useState(true);
  const [savingWorkflow, setSavingWorkflow] = useState(false);

  useEffect(() => {
    if (!orgId) return void setLoading(false);
    void supabase.from("organizations").select("name,address,logo_url,school_payment_methods,password_expiry_months,pin_expiry_months,purchases_require_po_approval,purchases_require_bill_approval").eq("id", orgId).maybeSingle().then(async ({ data, error: loadError }) => {
      if (loadError) setError(loadError.message);
      const row = data as { name?: string | null; address?: string | null; logo_url?: string | null; school_payment_methods?: string[] | null; password_expiry_months?: number | null; pin_expiry_months?: number | null; purchases_require_po_approval?: boolean | null; purchases_require_bill_approval?: boolean | null } | null;
      setProfile({ name: row?.name || "", address: row?.address || "", logoUrl: row?.logo_url || "" });
      setPaymentMethods(normalizeSchoolPaymentMethods(row?.school_payment_methods));
      setCredentialMonths({ password: row?.password_expiry_months || 3, pin: row?.pin_expiry_months || 3 });
      setPurchasesRequirePoApproval(row?.purchases_require_po_approval !== false);
      setPurchasesRequireBillApproval(row?.purchases_require_bill_approval !== false);
      const [{ data: treasuryWorkflow }, businessConfig] = await Promise.all([
        supabase.from("organization_permissions").select("allowed").eq("organization_id", orgId).eq("role_key", "__org__").eq("permission_key", "treasury_spend_money_approval_enabled").maybeSingle(),
        USE_LOCAL_SQLITE ? Promise.resolve(loadHotelConfig(orgId)) : hydrateHotelConfig(orgId),
      ]);
      setTreasurySpendMoneyApprovalEnabled(treasuryWorkflow?.allowed !== false);
      setCurrency(businessConfig.currency || "UGX");
      setLoading(false);
    });
  }, [orgId]);

  const uploadLogo = async (file: File) => {
    if (!orgId) return;
    if (!file.type.startsWith("image/")) return void setError("Choose an image file.");
    if (file.size > 3 * 1024 * 1024) return void setError("Logo must be 3 MB or smaller.");
    setUploading(true); setError(null); setMessage(null);
    const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${orgId}/logo.${ext}`;
    const { error: uploadError } = await supabase.storage.from("organization-branding").upload(path, file, { upsert: true, contentType: file.type });
    if (uploadError) setError(uploadError.message);
    else {
      const { data } = supabase.storage.from("organization-branding").getPublicUrl(path);
      setProfile((p) => ({ ...p, logoUrl: `${data.publicUrl}?v=${Date.now()}` }));
      setMessage("Logo uploaded. Click Save profile to apply it to documents.");
    }
    setUploading(false);
  };

  const savePaymentMethods = async () => {
    if (!paymentMethods.length) return void setError("Enable at least one payment method.");
    setSavingMethods(true); setError(null); setMessage(null);
    const { error: methodError } = await supabase.rpc("save_school_payment_methods", { p_methods: paymentMethods });
    if (methodError) setError(methodError.message); else setMessage("Payment methods saved for this school.");
    setSavingMethods(false);
  };

  const save = async () => {
    if (!profile.name.trim()) return void setError("School name is required.");
    if (!orgId) return;
    setSaving(true); setError(null); setMessage(null);
    const { error: saveError } = await supabase.rpc("save_school_organization_profile", {
      p_name: profile.name.trim(), p_address: profile.address.trim(), p_logo_url: profile.logoUrl.trim(),
    });
    if (saveError) setError(saveError.message);
    else {
      setMessage("School profile saved. New documents will use these details.");
      await refreshUserFlags?.();
    }
    setSaving(false);
  };

  const saveSecurity = async () => {
    setSavingSecurity(true); setError(null); setMessage(null);
    const { error: securityError } = await supabase.rpc("save_credential_expiry_policy", { p_password_months: credentialMonths.password, p_pin_months: credentialMonths.pin });
    if (securityError) setError(securityError.message); else setMessage("Credential expiry policy saved.");
    setSavingSecurity(false);
  };

  const saveCurrency = async () => {
    if (!orgId) return;
    setSavingCurrency(true); setError(null); setMessage(null);
    try {
      const current = USE_LOCAL_SQLITE ? loadHotelConfig(orgId) : await hydrateHotelConfig(orgId);
      const next = { ...current, currency };
      if (USE_LOCAL_SQLITE) saveHotelConfig(next, orgId); else await saveHotelConfigToCloud(next, orgId);
      setMessage(`School currency changed to ${currency}. Purchase orders, bills, expenses and reports will use it.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the school currency.");
    } finally {
      setSavingCurrency(false);
    }
  };

  const savePurchaseWorkflow = async () => {
    if (!orgId) return;
    setSavingWorkflow(true); setError(null); setMessage(null);
    try {
      if (USE_LOCAL_SQLITE) {
        const updated = await desktopApi.localUpdate({ table: "organizations", filters: [{ column: "id", operator: "eq", value: orgId }], patch: { purchases_require_po_approval: purchasesRequirePoApproval, purchases_require_bill_approval: purchasesRequireBillApproval } });
        if (!updated.length) throw new Error("No organization record was found in local data. Import or seed the school organization, then try again.");
      } else {
        const { error: workflowError } = await supabase.rpc("update_organization_purchase_workflow", { p_require_po_approval: purchasesRequirePoApproval, p_require_bill_approval: purchasesRequireBillApproval });
        if (workflowError) throw workflowError;
        const { error: treasuryError } = await supabase.from("organization_permissions").upsert({ organization_id: orgId, role_key: "__org__", permission_key: "treasury_spend_money_approval_enabled", allowed: treasurySpendMoneyApprovalEnabled }, { onConflict: "organization_id,role_key,permission_key" });
        if (treasuryError) throw treasuryError;
      }
      await refreshUserFlags?.();
      setMessage("Purchase workflow settings saved for this school.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the purchase workflow. Only administrators and managers can change it.");
    } finally {
      setSavingWorkflow(false);
    }
  };

  if (loading) return <p className="p-6 text-sm text-slate-500">Loading school profile…</p>;
  return (
    <div className="max-w-3xl space-y-6">
      <div><h2 className="text-xl font-bold text-slate-900">School organization profile</h2><p className="mt-1 text-sm text-slate-600">Used on invoices, statements, demand notes and receipts.</p></div>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {message && <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{message}</p>}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-5">
        <div className="flex flex-col sm:flex-row gap-5 items-start">
          <div className="h-32 w-32 shrink-0 rounded-xl border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center overflow-hidden">
            {profile.logoUrl ? <img src={profile.logoUrl} alt="School logo preview" className="h-full w-full object-contain p-2" /> : <Building2 className="h-12 w-12 text-slate-300" />}
          </div>
          <div className="space-y-2"><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-800">
            <ImageUp className="h-4 w-4" />{uploading ? "Uploading…" : "Upload school logo"}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" disabled={uploading} onChange={(e) => { const f=e.target.files?.[0]; if(f) void uploadLogo(f); e.currentTarget.value=""; }} className="hidden" />
          </label><p className="text-xs text-slate-500">PNG, JPEG, WebP or SVG; maximum 3 MB.</p></div>
        </div>
        <label className="block"><span className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-700"><Building2 className="h-4 w-4" />Correct school name</span><input value={profile.name} onChange={(e)=>setProfile(p=>({...p,name:e.target.value}))} className="w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="School name" /></label>
        <label className="block"><span className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-700"><MapPin className="h-4 w-4" />School address</span><textarea value={profile.address} onChange={(e)=>setProfile(p=>({...p,address:e.target.value}))} className="min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Postal and physical address" /></label>
        <button type="button" disabled={saving || uploading} onClick={()=>void save()} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />{saving ? "Saving…" : "Save profile"}</button>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div><h3 className="font-semibold text-slate-900">Currency</h3><p className="mt-1 text-sm text-slate-600">Used across school purchases, supplier bills, expenses and financial reports.</p></div>
        <label className="block max-w-xs"><span className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-700"><DollarSign className="h-4 w-4" />Organization currency</span><select value={currency} onChange={(e)=>setCurrency(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2"><option value="UGX">UGX — Ugandan shilling</option><option value="USD">USD — US dollar</option><option value="KES">KES — Kenyan shilling</option><option value="TZS">TZS — Tanzanian shilling</option><option value="RWF">RWF — Rwandan franc</option><option value="EUR">EUR — Euro</option><option value="GBP">GBP — British pound</option></select></label>
        <button type="button" disabled={savingCurrency} onClick={()=>void saveCurrency()} className="inline-flex items-center gap-2 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />{savingCurrency ? "Saving…" : "Save currency"}</button>
      </div>
      {user?.school_enable_purchases === true && orgId && <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div><h3 className="font-semibold text-slate-900">Purchase workflow</h3><p className="mt-1 text-sm text-slate-600">Choose which approval gates staff must complete from purchase request through supplier payment.</p></div>
        <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm text-slate-800"><input type="checkbox" checked={purchasesRequirePoApproval} onChange={(e)=>setPurchasesRequirePoApproval(e.target.checked)} className="mt-1 h-4 w-4"/><span><strong>Require purchase-order approval</strong><span className="mt-0.5 block text-xs text-slate-500">When off, staff can convert a pending order directly into a goods-received note or bill.</span></span></label>
        <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm text-slate-800"><input type="checkbox" checked={purchasesRequireBillApproval} onChange={(e)=>setPurchasesRequireBillApproval(e.target.checked)} className="mt-1 h-4 w-4"/><span><strong>Require GRN/bill approval</strong><span className="mt-0.5 block text-xs text-slate-500">When off, converted bills post stock and accounting entries immediately.</span></span></label>
        <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm text-slate-800"><input type="checkbox" checked={treasurySpendMoneyApprovalEnabled} onChange={(e)=>setTreasurySpendMoneyApprovalEnabled(e.target.checked)} className="mt-1 h-4 w-4"/><span><strong>Require Treasury approval for Spend Money</strong><span className="mt-0.5 block text-xs text-slate-500">When off, new day-to-day expenses post immediately. Existing pending entries still require approval.</span></span></label>
        <button type="button" disabled={savingWorkflow} onClick={()=>void savePurchaseWorkflow()} className="inline-flex items-center gap-2 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />{savingWorkflow ? "Saving…" : "Save purchase workflow"}</button>
      </div>}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div><h3 className="font-semibold text-slate-900">Accepted school-fee payment methods</h3><p className="mt-1 text-sm text-slate-600">Disabled methods are removed from the payment form and rejected by the database.</p></div>
        <div className="grid gap-3 sm:grid-cols-2">
          {SCHOOL_PAYMENT_METHODS.map((method) => <label key={method.code} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm font-medium text-slate-700">
            {method.label}<input type="checkbox" checked={paymentMethods.includes(method.code)} onChange={(e)=>setPaymentMethods(current => e.target.checked ? [...current, method.code] : current.filter(code => code !== method.code))} className="h-4 w-4 rounded border-slate-300" />
          </label>)}
        </div>
        <button type="button" disabled={savingMethods} onClick={()=>void savePaymentMethods()} className="inline-flex items-center gap-2 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />{savingMethods ? "Saving…" : "Save payment methods"}</button>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div><h3 className="font-semibold text-slate-900">PIN and password rotation</h3><p className="mt-1 text-sm text-slate-600">Require staff to replace credentials after the selected number of months.</p></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">Passwords expire every (months)<input type="number" min={1} max={24} value={credentialMonths.password} onChange={(e)=>setCredentialMonths(p=>({...p,password:Number(e.target.value)}))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
          <label className="text-sm font-medium text-slate-700">PINs expire every (months)<input type="number" min={1} max={24} value={credentialMonths.pin} onChange={(e)=>setCredentialMonths(p=>({...p,pin:Number(e.target.value)}))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
        </div>
        <button type="button" disabled={savingSecurity} onClick={()=>void saveSecurity()} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />{savingSecurity ? "Saving…" : "Save security policy"}</button>
      </div>
    </div>
  );
}
