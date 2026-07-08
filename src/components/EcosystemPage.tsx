import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Code2,
  ExternalLink,
  Globe2,
  KeyRound,
  Link2,
  Loader2,
  PackagePlus,
  Plug,
  Save,
  Smartphone,
  Webhook,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
  defaultMobileChannels,
  ecosystemConnectors,
  modulesForBusinessType,
  type ApiClient,
  type MobileChannels,
  type WebhookEndpoint,
} from "@/lib/ecosystem";

type EcosystemRow = {
  installed_modules: string[] | null;
  enabled_connectors: string[] | null;
  api_clients: ApiClient[] | null;
  webhooks: WebhookEndpoint[] | null;
  mobile_channels: MobileChannels | null;
};

type Tab = "marketplace" | "connectors" | "api" | "mobile";

function randomId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function EcosystemPage({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { user } = useAuth();
  const orgId = user?.organization_id ?? null;
  const businessType = user?.business_type ?? null;
  const [tab, setTab] = useState<Tab>("marketplace");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [installedModules, setInstalledModules] = useState<string[]>([]);
  const [enabledConnectors, setEnabledConnectors] = useState<string[]>([]);
  const [apiClients, setApiClients] = useState<ApiClient[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [mobileChannels, setMobileChannels] = useState<MobileChannels>(defaultMobileChannels(businessType));
  const [clientName, setClientName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEvent, setWebhookEvent] = useState("payment.completed");

  const modules = useMemo(() => modulesForBusinessType(businessType), [businessType]);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("organization_ecosystem_settings")
        .select("installed_modules,enabled_connectors,api_clients,webhooks,mobile_channels")
        .eq("organization_id", orgId)
        .maybeSingle();
      if (cancelled) return;
      const row = data as EcosystemRow | null;
      setInstalledModules(row?.installed_modules ?? []);
      setEnabledConnectors(row?.enabled_connectors ?? []);
      setApiClients(row?.api_clients ?? []);
      setWebhooks(row?.webhooks ?? []);
      setMobileChannels({ ...defaultMobileChannels(businessType), ...(row?.mobile_channels ?? {}) });
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [orgId, businessType]);

  const save = async (next?: Partial<EcosystemRow>) => {
    if (!orgId) return;
    setSaving(true);
    const payload = {
      installed_modules: next?.installed_modules ?? installedModules,
      enabled_connectors: next?.enabled_connectors ?? enabledConnectors,
      api_clients: next?.api_clients ?? apiClients,
      webhooks: next?.webhooks ?? webhooks,
      mobile_channels: next?.mobile_channels ?? mobileChannels,
    };
    const { data } = await supabase.rpc("update_organization_ecosystem_settings", {
      p_organization_id: orgId,
      p_installed_modules: payload.installed_modules,
      p_enabled_connectors: payload.enabled_connectors,
      p_api_clients: payload.api_clients,
      p_webhooks: payload.webhooks,
      p_mobile_channels: payload.mobile_channels,
    });
    const row = data as EcosystemRow | null;
    if (row) {
      setInstalledModules(row.installed_modules ?? []);
      setEnabledConnectors(row.enabled_connectors ?? []);
      setApiClients(row.api_clients ?? []);
      setWebhooks(row.webhooks ?? []);
      setMobileChannels({ ...defaultMobileChannels(businessType), ...(row.mobile_channels ?? {}) });
    }
    setSaving(false);
  };

  const toggleModule = (id: string) => {
    const next = installedModules.includes(id) ? installedModules.filter((item) => item !== id) : [...installedModules, id];
    setInstalledModules(next);
    void save({ installed_modules: next });
  };

  const toggleConnector = (id: string) => {
    const next = enabledConnectors.includes(id) ? enabledConnectors.filter((item) => item !== id) : [...enabledConnectors, id];
    setEnabledConnectors(next);
    void save({ enabled_connectors: next });
  };

  const createApiClient = () => {
    const name = clientName.trim();
    if (!name) return;
    const next = [
      ...apiClients,
      {
        id: randomId("boat_client"),
        name,
        scopes: ["read:reports", "write:transactions"],
        createdAt: new Date().toISOString(),
      },
    ];
    setApiClients(next);
    setClientName("");
    void save({ api_clients: next });
  };

  const addWebhook = () => {
    const url = webhookUrl.trim();
    if (!url) return;
    const next = [...webhooks, { id: randomId("wh"), event: webhookEvent, url, createdAt: new Date().toISOString() }];
    setWebhooks(next);
    setWebhookUrl("");
    void save({ webhooks: next });
  };

  const updateMobile = (key: keyof MobileChannels, value: boolean) => {
    const next = { ...mobileChannels, [key]: value };
    setMobileChannels(next);
    void save({ mobile_channels: next });
  };

  if (loading) {
    return <div className="p-6"><div className="h-40 animate-pulse rounded-lg bg-slate-200" /></div>;
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-950">Ecosystem</h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
              Install optional modules, prepare API clients, register webhooks, enable connectors, and turn on mobile channels for this organization.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void save()}
            className="inline-flex min-h-10 items-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-800"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </button>
        </header>

        <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-white p-1 md:grid-cols-4">
          {[
            { id: "marketplace" as const, label: "Marketplace", icon: PackagePlus },
            { id: "connectors" as const, label: "Connectors", icon: Plug },
            { id: "api" as const, label: "APIs", icon: Code2 },
            { id: "mobile" as const, label: "Mobile", icon: Smartphone },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md text-sm font-semibold ${
                  tab === item.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </div>

        {tab === "marketplace" ? (
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {modules.map((module) => {
              const installed = installedModules.includes(module.id);
              return (
                <article key={module.id} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-slate-950">{module.title}</p>
                      <p className="mt-1 text-sm leading-5 text-slate-600">{module.summary}</p>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-xs font-bold ${module.status === "available" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                      {module.status}
                    </span>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase text-slate-500">{module.category}</span>
                    <button
                      type="button"
                      disabled={module.status !== "available"}
                      onClick={() => toggleModule(module.id)}
                      className={`inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold ${
                        installed ? "bg-emerald-700 text-white" : "border border-slate-200 text-slate-700 hover:bg-slate-50"
                      } disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      {installed ? <CheckCircle2 className="h-4 w-4" /> : <PackagePlus className="h-4 w-4" />}
                      {installed ? "Installed" : "Install"}
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        ) : null}

        {tab === "connectors" ? (
          <section className="grid gap-3 md:grid-cols-2">
            {ecosystemConnectors.map((connector) => {
              const enabled = enabledConnectors.includes(connector.id);
              return (
                <article key={connector.id} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-start gap-3">
                    <div className="rounded-md bg-slate-100 p-2"><Link2 className="h-5 w-5 text-slate-700" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-950">{connector.title}</p>
                      <p className="mt-1 text-sm leading-5 text-slate-600">{connector.summary}</p>
                      <p className="mt-2 text-xs font-semibold uppercase text-slate-500">{connector.type}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleConnector(connector.id)}
                      className={`rounded-md px-3 py-2 text-sm font-semibold ${enabled ? "bg-emerald-700 text-white" : "border border-slate-200 text-slate-700 hover:bg-slate-50"}`}
                    >
                      {enabled ? "Enabled" : "Enable"}
                    </button>
                  </div>
                </article>
              );
            })}
            <button type="button" onClick={() => onNavigate("boat_connect")} className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-left text-sm font-semibold text-indigo-800 hover:bg-indigo-100">
              Open BOAT Connect <ExternalLink className="ml-1 inline h-4 w-4" />
            </button>
          </section>
        ) : null}

        {tab === "api" ? (
          <section className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-slate-700" /><h2 className="font-bold text-slate-950">API clients</h2></div>
              <div className="mt-4 flex gap-2">
                <input value={clientName} onChange={(event) => setClientName(event.target.value)} placeholder="Client name" className="min-h-10 min-w-0 flex-1 rounded-md border border-slate-300 px-3 text-sm" />
                <button type="button" onClick={createApiClient} className="rounded-md bg-slate-900 px-3 text-sm font-semibold text-white">Create</button>
              </div>
              <div className="mt-4 space-y-2">
                {apiClients.map((client) => (
                  <div key={client.id} className="rounded-md border border-slate-200 p-3">
                    <p className="text-sm font-bold text-slate-900">{client.name}</p>
                    <p className="text-xs text-slate-500">{client.id} · {client.scopes.join(", ")}</p>
                  </div>
                ))}
                {apiClients.length === 0 ? <p className="text-sm text-slate-500">No API clients yet.</p> : null}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2"><Webhook className="h-5 w-5 text-slate-700" /><h2 className="font-bold text-slate-950">Webhooks</h2></div>
              <div className="mt-4 grid gap-2">
                <select value={webhookEvent} onChange={(event) => setWebhookEvent(event.target.value)} className="min-h-10 rounded-md border border-slate-300 px-3 text-sm">
                  <option value="payment.completed">payment.completed</option>
                  <option value="invoice.created">invoice.created</option>
                  <option value="stock.low">stock.low</option>
                  <option value="member.created">member.created</option>
                  <option value="production.completed">production.completed</option>
                </select>
                <div className="flex gap-2">
                  <input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://example.com/webhook" className="min-h-10 min-w-0 flex-1 rounded-md border border-slate-300 px-3 text-sm" />
                  <button type="button" onClick={addWebhook} className="rounded-md bg-slate-900 px-3 text-sm font-semibold text-white">Add</button>
                </div>
              </div>
              <div className="mt-4 space-y-2">
                {webhooks.map((hook) => (
                  <div key={hook.id} className="rounded-md border border-slate-200 p-3">
                    <p className="text-sm font-bold text-slate-900">{hook.event}</p>
                    <p className="break-all text-xs text-slate-500">{hook.url}</p>
                  </div>
                ))}
                {webhooks.length === 0 ? <p className="text-sm text-slate-500">No webhooks yet.</p> : null}
              </div>
            </div>
          </section>
        ) : null}

        {tab === "mobile" ? (
          <section className="grid gap-3 md:grid-cols-2">
            {[
              ["pwa", "Progressive web app", "Installable browser app for staff and owners."],
              ["offline_pos", "Offline POS", "Cashier workflow can continue during connectivity gaps."],
              ["member_app", "Member app", "SACCO or VSLA member self-service channel."],
              ["customer_portal", "Customer portal", "Customer, patient, guest, or parent self-service."],
              ["staff_field_app", "Staff field app", "Field operations, stock counts, production, or school workflows."],
            ].map(([key, title, desc]) => (
              <label key={key} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-4">
                <input
                  type="checkbox"
                  checked={Boolean(mobileChannels[key as keyof MobileChannels])}
                  onChange={(event) => updateMobile(key as keyof MobileChannels, event.target.checked)}
                  className="mt-1 h-4 w-4"
                />
                <span>
                  <span className="block text-sm font-bold text-slate-950">{title}</span>
                  <span className="mt-1 block text-sm leading-5 text-slate-600">{desc}</span>
                </span>
              </label>
            ))}
            <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
              <Globe2 className="mb-2 h-5 w-5" />
              Mobile channels are readiness flags for deployment and support planning. Native app builds and signed API secrets should be issued through the deployment pipeline.
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

