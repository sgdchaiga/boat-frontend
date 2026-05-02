import { MessageSquare, Settings, Smartphone, Wallet } from "lucide-react";

export function IntegrationsHubPage({ onNavigate }: { onNavigate: (page: string) => void }) {
  const links = [
    {
      title: "Communications",
      desc: "SMS, WhatsApp, and messaging workflows.",
      page: "communications",
      icon: MessageSquare,
    },
    {
      title: "Agent Hub",
      desc: "Mobile money agent counter and float.",
      page: "agent_hub",
      icon: Smartphone,
    },
    {
      title: "Wallet",
      desc: "Customer wallet liabilities and top-ups.",
      page: "wallet",
      icon: Wallet,
    },
    {
      title: "Advanced settings",
      desc: "Organisation-wide configuration inside Admin.",
      page: "admin",
      icon: Settings,
    },
  ] as const;

  return (
    <div className="max-w-3xl mx-auto p-6 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Integrations &amp; connected services</h1>
        <p className="text-slate-600 mt-2 text-sm leading-relaxed">
          Hook BOAT into channels and devices your property already uses. Deeper ERP or bank APIs can be layered here as
          you scale.
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {links.map((L) => {
          const Ico = L.icon;
          return (
            <li key={L.page}>
              <button
                type="button"
                onClick={() => onNavigate(L.page)}
                className="w-full text-left rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-indigo-200 hover:bg-indigo-50/40 transition flex gap-3"
              >
                <div className="rounded-xl bg-slate-100 p-2.5 shrink-0">
                  <Ico className="w-5 h-5 text-slate-700" />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900">{L.title}</div>
                  <div className="text-sm text-slate-600 mt-0.5">{L.desc}</div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
