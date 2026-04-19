import { useState } from "react";
import { MessageSquare, MessagesSquare, Smartphone } from "lucide-react";
import { MessagingComposerDialog } from "./MessagingComposerDialog";

type NavigateFn = (page: string, state?: Record<string, unknown>) => void;

function btnClass(compact?: boolean) {
  return compact
    ? "inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-xs text-slate-800"
    : "inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-sm text-slate-800";
}

/** Opens SMS composer (Twilio / configured provider via boat-server). */
export function SendSmsButton({
  phone,
  defaultMessage,
  label = "Send SMS",
  compact,
}: {
  phone?: string;
  defaultMessage?: string;
  label?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={btnClass(compact)} onClick={() => setOpen(true)} title="Send SMS">
        <Smartphone className={compact ? "w-3.5 h-3.5" : "w-4 h-4"} />
        {label}
      </button>
      <MessagingComposerDialog
        open={open}
        onClose={() => setOpen(false)}
        channel="sms"
        defaultTo={phone ?? ""}
        defaultMessage={defaultMessage ?? ""}
      />
    </>
  );
}

/** Opens WhatsApp composer (Meta / Twilio via boat-server). */
export function SendWhatsAppButton({
  phone,
  defaultMessage,
  templateId,
  label = "Send WhatsApp",
  compact,
}: {
  phone?: string;
  defaultMessage?: string;
  templateId?: string;
  label?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={btnClass(compact)} onClick={() => setOpen(true)} title="Send WhatsApp">
        <MessagesSquare className={compact ? "w-3.5 h-3.5" : "w-4 h-4 text-emerald-700"} />
        {label}
      </button>
      <MessagingComposerDialog
        open={open}
        onClose={() => setOpen(false)}
        channel="whatsapp"
        defaultTo={phone ?? ""}
        defaultMessage={defaultMessage ?? ""}
        templateId={templateId}
      />
    </>
  );
}

/** Navigate to Communications → Internal Chat (future); optional context string in URL. */
export function CommentChatButton({
  onNavigate,
  contextLabel,
  label = "Comment / Chat",
  compact,
}: {
  onNavigate: NavigateFn;
  contextLabel?: string;
  label?: string;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      className={btnClass(compact)}
      title="Open internal chat (coming soon)"
      onClick={() =>
        onNavigate("communications", {
          communicationsTab: "internal",
          ...(contextLabel ? { communicationsContext: contextLabel } : {}),
        })
      }
    >
      <MessageSquare className={compact ? "w-3.5 h-3.5" : "w-4 h-4"} />
      {label}
    </button>
  );
}

/** Row of three actions for detail screens. */
export function ModuleMessagingToolbar({
  onNavigate,
  phone,
  defaultMessage,
  whatsappTemplateId,
  contextLabel,
  compact,
}: {
  onNavigate: NavigateFn;
  phone?: string;
  defaultMessage?: string;
  whatsappTemplateId?: string;
  contextLabel?: string;
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-wrap gap-1 ${compact ? "" : "gap-2"}`}>
      <SendSmsButton phone={phone} defaultMessage={defaultMessage} compact={compact ?? true} />
      <SendWhatsAppButton phone={phone} defaultMessage={defaultMessage} templateId={whatsappTemplateId} compact={compact ?? true} />
      <CommentChatButton onNavigate={onNavigate} contextLabel={contextLabel} compact={compact ?? true} />
    </div>
  );
}
