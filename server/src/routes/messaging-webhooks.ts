import { createHmac, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";

function safeCompareUtf8(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function verifyMetaWebhookToken(mode: string, verifyToken: string): boolean {
  return mode === "subscribe" && verifyToken === process.env.WHATSAPP_VERIFY_TOKEN;
}

/**
 * Twilio signs: full webhook URL + concatenation of sorted param keys with values (as strings).
 * @see https://www.twilio.com/docs/usage/security#validating-requests
 */
function buildTwilioSignaturePayload(url: string, params: Record<string, unknown>): string {
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + String(params[key] ?? "");
  }
  return data;
}

function getTwilioWebhookPublicUrl(req: FastifyRequest): string {
  const explicit = process.env.TWILIO_WEBHOOK_SIGNATURE_URL;
  if (explicit) {
    return explicit;
  }
  const proto = String(req.headers["x-forwarded-proto"] ?? "https")
    .split(",")[0]
    .trim();
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost")
    .split(",")[0]
    .trim();
  const path = req.url.split("?")[0];
  return `${proto}://${host}${path}`;
}

function verifyTwilioWebhookSignature(
  req: FastifyRequest,
  body: Record<string, unknown>,
  signatureHeader: string | undefined
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    return true;
  }
  if (!signatureHeader) {
    return false;
  }

  const url = getTwilioWebhookPublicUrl(req);
  const payload = buildTwilioSignaturePayload(url, body);
  const expected = createHmac("sha1", authToken).update(payload, "utf8").digest("base64");
  return safeCompareUtf8(expected, signatureHeader);
}

function verifyMetaSignature256(secret: string, rawBody: Buffer, header: string | undefined): boolean {
  if (!header) {
    return false;
  }
  const expected =
    "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeCompareUtf8(expected, header);
}

export const messagingWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.post("/webhooks/twilio", async (req, reply) => {
    const signatureHeader = req.headers["x-twilio-signature"];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!verifyTwilioWebhookSignature(req, body, signature)) {
      return reply.status(401).send({ error: "Invalid Twilio signature" });
    }

    const sid = typeof body.MessageSid === "string" ? body.MessageSid : "";
    const status = typeof body.MessageStatus === "string" ? body.MessageStatus : "";
    if (!sid || !status) {
      return reply.status(400).send({ error: "Missing MessageSid or MessageStatus" });
    }

    const normalizedStatus =
      status === "delivered" ? "delivered" : status === "failed" ? "failed" : "sent";
    const updated = await app.notificationService.updateStatusByProviderMessageId(sid, normalizedStatus);
    return { ok: true, found: Boolean(updated), data: updated };
  });

  app.get("/webhooks/meta/whatsapp", async (req, reply) => {
    const query = req.query as Record<string, unknown>;
    const mode = typeof query["hub.mode"] === "string" ? query["hub.mode"] : "";
    const verifyToken = typeof query["hub.verify_token"] === "string" ? query["hub.verify_token"] : "";
    const challenge = typeof query["hub.challenge"] === "string" ? query["hub.challenge"] : "";

    if (!verifyMetaWebhookToken(mode, verifyToken)) {
      return reply.status(401).send({ error: "Meta webhook verification failed" });
    }

    return reply.status(200).send(challenge);
  });

  app.post(
    "/webhooks/meta/whatsapp",
    {
      preParsing: async (request, _reply, payload) => {
        const chunks: Buffer[] = [];
        for await (const chunk of payload as AsyncIterable<Buffer | string>) {
          chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
        }
        const raw = Buffer.concat(chunks);
        (request as FastifyRequest & { rawBody?: Buffer }).rawBody = raw;
        return Readable.from(raw);
      },
    },
    async (req, reply) => {
      const rawBody = (req as FastifyRequest & { rawBody?: Buffer }).rawBody;
      const secret = process.env.META_WEBHOOK_APP_SECRET;
      if (secret) {
        if (!rawBody?.length) {
          return reply.status(400).send({ error: "Missing raw body for signature verification" });
        }
        const sigHeader = req.headers["x-hub-signature-256"];
        const sig = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
        if (!verifyMetaSignature256(secret, rawBody, sig)) {
          return reply.status(401).send({ error: "Invalid Meta signature" });
        }
      }

      const body = (req.body ?? {}) as {
        entry?: Array<{
          changes?: Array<{
            value?: {
              statuses?: Array<{
                id?: string;
                status?: string;
                errors?: Array<{ title?: string }>;
              }>;
            };
          }>;
        }>;
      };

      const statusItems =
        body.entry?.flatMap((entry) => entry.changes?.flatMap((change) => change.value?.statuses ?? []) ?? []) ?? [];
      for (const item of statusItems) {
        if (!item.id || !item.status) {
          continue;
        }
        const mappedStatus =
          item.status === "read"
            ? "read"
            : item.status === "delivered"
              ? "delivered"
              : item.status === "failed"
                ? "failed"
                : "sent";
        const errorMessage = item.errors?.[0]?.title;
        await app.notificationService.updateStatusByProviderMessageId(item.id, mappedStatus, errorMessage);
      }

      return { ok: true };
    }
  );
};
