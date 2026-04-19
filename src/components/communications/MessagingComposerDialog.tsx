import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getBoatApiRoot, sendBoatMessage, type BoatMessageChannel } from "@/lib/communicationsApi";

export type MessagingComposerDialogProps = {
  open: boolean;
  onClose: () => void;
  channel: BoatMessageChannel;
  /** E.164 or local digits; user can edit */
  defaultTo?: string;
  defaultMessage?: string;
  /** WhatsApp template name when using Meta Cloud API */
  templateId?: string;
  title?: string;
};

export function MessagingComposerDialog({
  open,
  onClose,
  channel,
  defaultTo = "",
  defaultMessage = "",
  templateId,
  title,
}: MessagingComposerDialogProps) {
  const { user } = useAuth();
  const [to, setTo] = useState(defaultTo);
  const [text, setText] = useState(defaultMessage);
  const [tpl, setTpl] = useState(templateId ?? "");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTo(defaultTo);
      setText(defaultMessage);
      setTpl(templateId ?? "");
      setResult(null);
    }
  }, [open, defaultTo, defaultMessage, templateId]);

  if (!open) return null;

  const apiConfigured = Boolean(getBoatApiRoot());
  const heading = title ?? (channel === "whatsapp" ? "Send WhatsApp" : "Send SMS");

  const handleSend = async () => {
    setResult(null);
    const trimmed = to.trim();
    if (!trimmed) {
      setResult("Enter a phone number.");
      return;
    }
    setSending(true);
    try {
      const payload =
        channel === "whatsapp"
          ? {
              channel: "whatsapp" as const,
              to: trimmed,
              ...(tpl.trim()
                ? { templateId: tpl.trim(), text: text.trim() || undefined }
                : { text: text.trim() || "Message from BOAT" }),
              organizationId: user?.organization_id ?? undefined,
              fallbackToSms: true,
            }
          : {
              channel: "sms",
              to: trimmed,
              text: text.trim() || "Message from BOAT",
              organizationId: user?.organization_id ?? undefined,
            };
      const r = await sendBoatMessage(payload);
      if (r.ok) {
        setResult("Queued successfully.");
        onClose();
      } else {
        setResult(r.error ?? "Failed");
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl max-w-md w-full p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">{heading}</h2>
          <button type="button" className="p-1 rounded-lg hover:bg-slate-100 text-slate-500" onClick={onClose} aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {!apiConfigured ? (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
            Set <code className="text-xs">VITE_BOAT_API_URL</code> for production, or run <code className="text-xs">vite</code> dev (uses <code className="text-xs">/boat-api</code> proxy). Start boat-server on port 3001.
          </p>
        ) : null}

        <div className="space-y-2">
          <label className="block text-xs font-medium text-slate-600">To (phone)</label>
          <input
            type="tel"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="+256…"
            autoComplete="tel"
          />
        </div>

        {channel === "whatsapp" ? (
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-600">Template ID (Meta) — optional if using session message</label>
            <input
              type="text"
              value={tpl}
              onChange={(e) => setTpl(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
              placeholder="approved_template_name"
            />
          </div>
        ) : null}

        <div className="space-y-2">
          <label className="block text-xs font-medium text-slate-600">Message</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="Your message…"
          />
        </div>

        {result ? <p className="text-sm text-slate-700">{result}</p> : null}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="app-btn-secondary text-sm" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="app-btn-primary text-sm inline-flex items-center gap-2" disabled={sending} onClick={() => void handleSend()}>
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
