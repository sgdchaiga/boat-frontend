import { useEffect, useState } from "react";
import { Inbox, MessageSquare, MessagesSquare, Smartphone, Users } from "lucide-react";
import { PageNotes } from "@/components/common/PageNotes";
import { getBoatApiBase, getBoatApiRoot } from "@/lib/communicationsApi";
import { MessagingComposerDialog } from "./MessagingComposerDialog";

export type CommunicationsTabId = "inbox" | "sms" | "whatsapp" | "internal";

const TABS: { id: CommunicationsTabId; label: string; icon: typeof Inbox }[] = [
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "sms", label: "SMS", icon: Smartphone },
  { id: "whatsapp", label: "WhatsApp", icon: MessagesSquare },
  { id: "internal", label: "Internal Chat", icon: Users },
];

export function CommunicationsPage({
  initialTab,
  contextNote,
  onNavigate,
}: {
  initialTab?: CommunicationsTabId;
  contextNote?: string;
  onNavigate?: (page: string, state?: Record<string, unknown>) => void;
}) {
  const [tab, setTab] = useState<CommunicationsTabId>(initialTab ?? "inbox");
  const [smsOpen, setSmsOpen] = useState(false);
  const [waOpen, setWaOpen] = useState(false);

  useEffect(() => {
    if (initialTab && TABS.some((t) => t.id === initialTab)) {
      setTab(initialTab);
    }
  }, [initialTab]);

  const apiRoot = getBoatApiRoot();
  const apiEnv = getBoatApiBase();

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold text-slate-900">Communications</h1>
            <PageNotes ariaLabel="Communications overview">
              <p>
                SMS and WhatsApp send through boat-server when <code className="text-xs">VITE_BOAT_API_URL</code> is set.
                Inbox aggregates delivery status when that API is connected.
              </p>
            </PageNotes>
          </div>
          <p className="text-slate-600 text-sm mt-1">Messaging hub for your organization</p>
        </div>
        {contextNote ? (
          <div className="text-sm bg-sky-50 border border-sky-200 text-sky-900 rounded-lg px-3 py-2 max-w-md">
            <span className="font-medium">Context: </span>
            {contextNote}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                onNavigate?.("communications", { communicationsTab: t.id });
              }}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
                active ? "bg-brand-700 text-white shadow-sm" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "inbox" && (
        <div className="app-card p-6 space-y-3">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Inbox className="w-5 h-5 text-brand-600" />
            All messages
          </h2>
          <p className="text-sm text-slate-600">
            Unified inbox will list SMS, WhatsApp, and internal threads. Connect boat-server and extend the API to load
            <code className="mx-1 text-xs">notification_messages</code> here.
          </p>
          {!apiRoot ? (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
              Set <code className="text-xs">VITE_BOAT_API_URL</code> for production. In dev, the app uses the <code className="text-xs">/boat-api</code> proxy if the env is unset.
            </p>
          ) : (
            <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              API base: <code className="text-xs">{apiEnv || (import.meta.env.DEV ? "/boat-api (Vite proxy)" : "")}</code>
              . Next step: add a list endpoint and bind rows here.
            </p>
          )}
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/80 p-8 text-center text-slate-500 text-sm">
            No messages yet (placeholder)
          </div>
        </div>
      )}

      {tab === "sms" && (
        <div className="app-card p-6 space-y-4">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-slate-700" />
            SMS
          </h2>
          <p className="text-sm text-slate-600">Send a one-off SMS via your configured provider (e.g. Twilio).</p>
          <button type="button" className="app-btn-primary text-sm" onClick={() => setSmsOpen(true)}>
            Compose SMS
          </button>
          <MessagingComposerDialog open={smsOpen} onClose={() => setSmsOpen(false)} channel="sms" />
        </div>
      )}

      {tab === "whatsapp" && (
        <div className="app-card p-6 space-y-4">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <MessagesSquare className="w-5 h-5 text-emerald-700" />
            WhatsApp
          </h2>
          <p className="text-sm text-slate-600">
            Uses Meta Cloud API or Twilio WhatsApp templates as configured on the server.
          </p>
          <button type="button" className="app-btn-primary text-sm" onClick={() => setWaOpen(true)}>
            Compose WhatsApp
          </button>
          <MessagingComposerDialog open={waOpen} onClose={() => setWaOpen(false)} channel="whatsapp" />
        </div>
      )}

      {tab === "internal" && (
        <div className="app-card p-6 space-y-4">
          <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-violet-600" />
            Internal Chat
          </h2>
          <p className="text-sm text-slate-600">
            Teams-like channels and DMs for staff will live here. This tab is reserved for a future release.
          </p>
          <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-violet-50/40 p-10 text-center">
            <Users className="w-12 h-12 text-violet-400 mx-auto mb-3" />
            <p className="text-slate-700 font-medium">Coming soon</p>
            <p className="text-sm text-slate-500 mt-1">Comment threads from invoices and loans will link into this space.</p>
          </div>
        </div>
      )}
    </div>
  );
}
