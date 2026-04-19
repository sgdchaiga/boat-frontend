import { randomUUID } from "node:crypto";
import type { MessageChannel, MessagingProvider, SendMessageRequest, SendMessageResult } from "../types.js";

interface MetaWhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
}

function buildTemplateComponents(payload: SendMessageRequest) {
  const values = Object.values(payload.variables ?? {});
  if (values.length === 0) {
    return undefined;
  }

  return [
    {
      type: "body",
      parameters: values.map((value) => ({ type: "text", text: String(value) })),
    },
  ];
}

export class MetaWhatsAppProvider implements MessagingProvider {
  public readonly providerName = "meta-whatsapp";
  public readonly supportedChannels: MessageChannel[] = ["whatsapp"];

  public constructor(private readonly config: MetaWhatsAppConfig) {}

  public async send(payload: SendMessageRequest): Promise<SendMessageResult> {
    if (!payload.templateId) {
      throw new Error("WhatsApp templateId is required for Meta Cloud API sends");
    }

    const endpoint = `https://graph.facebook.com/v21.0/${this.config.phoneNumberId}/messages`;
    const templateComponents = buildTemplateComponents(payload);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: payload.to,
        type: "template",
        template: {
          name: payload.templateId,
          language: { code: "en_US" },
          ...(templateComponents ? { components: templateComponents } : {}),
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Meta WhatsApp send failed: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as {
      messages?: Array<{ id?: string }>;
    };

    return {
      providerMessageId: data.messages?.[0]?.id ?? randomUUID(),
      status: "queued",
      rawResponse: data,
    };
  }
}
