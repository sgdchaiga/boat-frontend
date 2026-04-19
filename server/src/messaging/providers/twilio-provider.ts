import { randomUUID } from "node:crypto";
import type { MessageChannel, MessagingProvider, SendMessageRequest, SendMessageResult } from "../types.js";

interface TwilioProviderConfig {
  accountSid: string;
  authToken: string;
  smsFromNumber?: string;
  whatsappFromNumber?: string;
}

function buildTwilioBody(payload: SendMessageRequest, config: TwilioProviderConfig): URLSearchParams {
  const body = new URLSearchParams();
  const text = payload.text ?? payload.templateId ?? "BOAT notification";

  if (payload.channel === "whatsapp") {
    if (!config.whatsappFromNumber) {
      throw new Error("TWILIO_WHATSAPP_FROM_NUMBER is missing");
    }
    body.set("From", `whatsapp:${config.whatsappFromNumber}`);
    body.set("To", `whatsapp:${payload.to}`);
    body.set("Body", text);
    return body;
  }

  if (!config.smsFromNumber) {
    throw new Error("TWILIO_SMS_FROM_NUMBER is missing");
  }
  body.set("From", config.smsFromNumber);
  body.set("To", payload.to);
  body.set("Body", text);
  return body;
}

export class TwilioProvider implements MessagingProvider {
  public readonly providerName = "twilio";
  public readonly supportedChannels: MessageChannel[] = ["sms", "whatsapp"];

  public constructor(private readonly config: TwilioProviderConfig) {}

  public async send(payload: SendMessageRequest): Promise<SendMessageResult> {
    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`;
    const auth = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString("base64");
    const body = buildTwilioBody(payload, this.config);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Twilio send failed: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as { sid?: string; status?: string };
    return {
      providerMessageId: data.sid ?? randomUUID(),
      status: data.status === "delivered" ? "delivered" : "queued",
      rawResponse: data,
    };
  }
}
