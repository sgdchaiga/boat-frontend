export type MessageChannel = "sms" | "whatsapp";

export type MessageStatus = "queued" | "sent" | "delivered" | "failed" | "read";

export interface SendMessageRequest {
  channel: MessageChannel;
  to: string;
  templateId?: string;
  text?: string;
  variables?: Record<string, string | number | boolean>;
  organizationId?: string;
  fallbackToSms?: boolean;
}

export interface SendMessageResult {
  providerMessageId: string;
  status: MessageStatus;
  rawResponse?: unknown;
}

export interface MessageRecord {
  id: string;
  channel: MessageChannel;
  to: string;
  provider: string;
  providerMessageId: string;
  status: MessageStatus;
  templateId?: string;
  text?: string;
  variables?: Record<string, string | number | boolean>;
  organizationId?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface MessagingProvider {
  providerName: string;
  supportedChannels: MessageChannel[];
  send(payload: SendMessageRequest): Promise<SendMessageResult>;
}
