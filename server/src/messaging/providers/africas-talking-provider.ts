import { randomUUID } from "node:crypto";
import type { MessageChannel, MessagingProvider, SendMessageRequest, SendMessageResult } from "../types.js";

/**
 * Africa's Talking — SMS only (standard Messaging API).
 * @see https://developers.africastalking.com/docs/sms/sending
 */
export interface AfricasTalkingProviderConfig {
  /** App username (use `sandbox` in the sandbox environment). */
  username: string;
  apiKey: string;
  /** Shortcode / alphanumeric sender ID (required on many production accounts). */
  senderId?: string;
  /** When true, uses api.sandbox.africastalking.com */
  sandbox?: boolean;
}

type AfricasTalkingApiResponse = {
  SMSMessageData?: {
    Message?: string;
    Recipients?: Array<{
      number?: string;
      status?: string;
      messageId?: string;
      statusCode?: number;
    }>;
  };
};

function messagingEndpoint(sandbox: boolean): string {
  const host = sandbox ? "api.sandbox.africastalking.com" : "api.africastalking.com";
  return `https://${host}/version1/messaging`;
}

export class AfricasTalkingProvider implements MessagingProvider {
  public readonly providerName = "africas-talking";
  public readonly supportedChannels: MessageChannel[] = ["sms"];

  public constructor(private readonly config: AfricasTalkingProviderConfig) {}

  public async send(payload: SendMessageRequest): Promise<SendMessageResult> {
    if (payload.channel !== "sms") {
      throw new Error("Africa's Talking provider only supports channel: sms");
    }

    const message = (payload.text ?? payload.templateId ?? "BOAT notification").trim();
    if (!message) {
      throw new Error("Message text is empty");
    }

    const body = new URLSearchParams();
    body.set("username", this.config.username);
    body.set("to", payload.to.trim());
    body.set("message", message);
    if (this.config.senderId?.trim()) {
      body.set("from", this.config.senderId.trim());
    }

    const endpoint = messagingEndpoint(this.config.sandbox === true);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        /** Africa's Talking expects this exact header name (see official SDKs). */
        Apikey: this.config.apiKey,
      },
      body: body.toString(),
    });

    const rawText = await response.text();
    let data: AfricasTalkingApiResponse = {};
    try {
      data = rawText ? (JSON.parse(rawText) as AfricasTalkingApiResponse) : {};
    } catch {
      throw new Error(`Africa's Talking: invalid JSON response (${response.status}): ${rawText.slice(0, 300)}`);
    }

    if (!response.ok) {
      throw new Error(`Africa's Talking HTTP ${response.status}: ${rawText.slice(0, 500)}`);
    }

    const recipients = data.SMSMessageData?.Recipients ?? [];
    const first = recipients[0];
    const topMessage = data.SMSMessageData?.Message ?? "";

    if (first?.status && first.status !== "Success") {
      throw new Error(
        `Africa's Talking send failed: ${first.status}${first.number ? ` (${first.number})` : ""}. ${topMessage}`.trim()
      );
    }

    const providerMessageId = first?.messageId ?? randomUUID();
    return {
      providerMessageId,
      status: "queued",
      rawResponse: data,
    };
  }
}
