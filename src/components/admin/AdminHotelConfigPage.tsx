import { useEffect, useState } from "react";
import { Building2, Save, MapPin, Phone, Mail, DollarSign } from "lucide-react";
import {
  loadHotelConfig,
  saveHotelConfig,
  mergeHotelConfigWithOrg,
  type HotelConfig,
  DEFAULT_CONFIG,
} from "../../lib/hotelConfig";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";

type OrgRow = {
  id: string;
  name: string | null;
  slug: string | null;
  address: string | null;
};

export function AdminHotelConfigPage() {
  const { user } = useAuth();
  const organizationId = user?.organization_id ?? null;
  const [config, setConfig] = useState<HotelConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [organization, setOrganization] = useState<OrgRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const base = loadHotelConfig(organizationId);
      if (!organizationId) {
        if (!cancelled) {
          setConfig(base);
          setOrganization(null);
          setLoading(false);
        }
        return;
      }
      const { data, error } = await supabase
        .from("organizations")
        .select("id,name,slug,address")
        .eq("id", organizationId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error(error);
        setConfig(base);
        setOrganization(null);
        setLoading(false);
        return;
      }
      const row = data as OrgRow | null;
      setOrganization(row);
      setConfig(mergeHotelConfigWithOrg(base, row));
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const handleSave = () => {
    setSaving(true);
    try {
      saveHotelConfig(config, organizationId);
      alert("Business configuration saved.");
    } catch (e) {
      alert("Failed to save.");
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-slate-500 py-8">Loading…</div>;
  }

  const orgNameDisplay = organization?.name?.trim() || "—";
  const slugDisplay = organization?.slug?.trim();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-slate-900">Business Configuration</h2>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-brand-700 text-white px-4 py-2 rounded-lg hover:bg-brand-800 disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Business (organization record)</label>
          <input
            value={orgNameDisplay}
            readOnly
            className="border border-slate-300 rounded-lg px-3 py-2 w-full bg-slate-50 text-slate-700"
            title="Name from organizations table for your account’s organization_id"
          />
          {slugDisplay ? (
            <p className="text-xs text-slate-500 mt-1">
              Slug: <span className="font-mono">{slugDisplay}</span>
            </p>
          ) : null}
          <p className="text-xs text-slate-500 mt-1">
            This is the tenant name in the database for your login. Invoice display name below can differ and is stored in
            your browser for this organization.
          </p>
          {organizationId && organization?.name?.includes("Default property") && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
              Your staff user is linked to the seeded default organization. To use another business, a platform admin should
              assign your account to the correct organization (or update this organization’s name in the platform console).
            </p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Business type</label>
          <input
            value={String(user?.business_type || "other").replace("_", " ")}
            readOnly
            className="border border-slate-300 rounded-lg px-3 py-2 w-full bg-slate-50 text-slate-700 capitalize"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Display name (invoices &amp; PDFs)</label>
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-slate-400" />
            <input
              value={config.hotel_name}
              onChange={(e) => setConfig({ ...config, hotel_name: e.target.value })}
              className="border border-slate-300 rounded-lg px-3 py-2 flex-1"
              placeholder="Business name"
            />
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Initialized from your organization name when empty; saved locally per organization.
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Address</label>
          <div className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-slate-400" />
            <input
              value={config.address}
              onChange={(e) => setConfig({ ...config, address: e.target.value })}
              className="border border-slate-300 rounded-lg px-3 py-2 flex-1"
              placeholder="Street, city, country"
            />
          </div>
          {organization?.address?.trim() ? (
            <p className="text-xs text-slate-500 mt-1">
              Organization address on file: {organization.address}
            </p>
          ) : null}
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
          <div className="flex items-center gap-2">
            <Phone className="w-5 h-5 text-slate-400" />
            <input
              value={config.phone}
              onChange={(e) => setConfig({ ...config, phone: e.target.value })}
              className="border border-slate-300 rounded-lg px-3 py-2 flex-1"
              placeholder="+256 xxx xxxxxx"
            />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-slate-400" />
            <input
              type="email"
              value={config.email}
              onChange={(e) => setConfig({ ...config, email: e.target.value })}
              className="border border-slate-300 rounded-lg px-3 py-2 flex-1"
              placeholder="contact@hotel.com"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Currency</label>
            <div className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-slate-400" />
              <select
                value={config.currency}
                onChange={(e) => setConfig({ ...config, currency: e.target.value })}
                className="border border-slate-300 rounded-lg px-3 py-2 flex-1"
              >
                <option value="USD">USD</option>
                <option value="UGX">UGX</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Timezone</label>
            <select
              value={config.timezone}
              onChange={(e) => setConfig({ ...config, timezone: e.target.value })}
              className="border border-slate-300 rounded-lg px-3 py-2 w-full"
            >
              <option value="Africa/Kampala">Africa/Kampala (GMT+3)</option>
              <option value="Africa/Nairobi">Africa/Nairobi</option>
              <option value="UTC">UTC</option>
              <option value="America/New_York">America/New York</option>
            </select>
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Display, address, and currency settings are stored in your browser for this organization. Name and address are
        filled from the server when your local settings are still the generic default.
      </p>
    </div>
  );
}
