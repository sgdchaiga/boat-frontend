import {
  NotificationService,
  type ChannelProviderPreference,
  type NotificationServiceOptions,
} from "../messaging/notification-service.js";
import { AfricasTalkingProvider } from "../messaging/providers/africas-talking-provider.js";
import { MetaWhatsAppProvider } from "../messaging/providers/meta-whatsapp-provider.js";
import { TwilioProvider } from "../messaging/providers/twilio-provider.js";
import type { SendMessageRequest } from "../messaging/types.js";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";

function loadNotificationOptions(): NotificationServiceOptions | undefined {
  try {
    const defaultJson = process.env.MESSAGING_PROVIDER_DEFAULT;
    const orgsJson = process.env.MESSAGING_PROVIDER_ORGS;
    if (!defaultJson && !orgsJson) {
      return undefined;
    }
    return {
      providerPreferences: {
        ...(defaultJson ? { default: JSON.parse(defaultJson) as ChannelProviderPreference } : {}),
        ...(orgsJson
          ? {
              organizations: JSON.parse(orgsJson) as Record<string, ChannelProviderPreference>,
            }
          : {}),
      },
    };
  } catch {
    return undefined;
  }
}

function createNotificationService(app: FastifyInstance) {
  const service = new NotificationService(app.prisma, loadNotificationOptions());

  const atUser = process.env.AFRICAS_TALKING_USERNAME;
  const atKey = process.env.AFRICAS_TALKING_API_KEY;
  if (atUser && atKey) {
    service.registerProvider(
      new AfricasTalkingProvider({
        username: atUser,
        apiKey: atKey,
        senderId: process.env.AFRICAS_TALKING_SENDER_ID,
        sandbox:
          process.env.AFRICAS_TALKING_SANDBOX === "1" ||
          process.env.AFRICAS_TALKING_SANDBOX === "true" ||
          process.env.AFRICAS_TALKING_SANDBOX === "yes",
      })
    );
  }

  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  if (twilioSid && twilioToken) {
    service.registerProvider(
      new TwilioProvider({
        accountSid: twilioSid,
        authToken: twilioToken,
        smsFromNumber: process.env.TWILIO_SMS_FROM_NUMBER,
        whatsappFromNumber: process.env.TWILIO_WHATSAPP_FROM_NUMBER,
      })
    );
  }

  const metaToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const metaPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (metaToken && metaPhoneNumberId) {
    service.registerProvider(
      new MetaWhatsAppProvider({
        accessToken: metaToken,
        phoneNumberId: metaPhoneNumberId,
      })
    );
  }

  return service;
}

function isValidSendBody(body: unknown): body is SendMessageRequest {
  if (!body || typeof body !== "object") {
    return false;
  }
  const data = body as Record<string, unknown>;
  const hasValidChannel = data.channel === "sms" || data.channel === "whatsapp";
  const hasTo = typeof data.to === "string" && data.to.trim().length > 0;
  const hasMessage = typeof data.text === "string" || typeof data.templateId === "string";
  return hasValidChannel && hasTo && hasMessage;
}

export const notificationRoutes: FastifyPluginAsync = async (app) => {
  const service = createNotificationService(app);
  app.decorate("notificationService", service);

  app.post("/notifications/send", async (req, reply) => {
    if (!isValidSendBody(req.body)) {
      return reply.status(400).send({
        error: "Invalid payload",
        expected: {
          channel: "sms|whatsapp",
          to: "recipient phone",
          text: "optional plain text",
          templateId: "optional template",
          variables: { any: "value" },
          organizationId: "optional UUID",
          fallbackToSms: "optional boolean",
        },
      });
    }

    try {
      const record = await service.send(req.body);
      return reply.status(202).send({ data: record });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Send failed";
      if (message.includes("No provider configured")) {
        return reply.status(400).send({ error: message });
      }
      if (message.includes("notification_messages") || message.includes("Database table")) {
        return reply.status(503).send({ error: message });
      }
      req.log.error({ err: error }, "notifications/send failed");
      return reply.status(500).send({ error: message });
    }
  });

  app.get<{ Params: { id: string } }>("/notifications/:id/status", async (req, reply) => {
    const record = await service.getById(req.params.id);
    if (!record) {
      return reply.status(404).send({ error: "Notification not found" });
    }
    return { data: record };
  });
};
