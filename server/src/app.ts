import Fastify from "fastify";
import cors from "@fastify/cors";
import prismaPlugin from "./plugins/prisma.js";
import { healthRoutes } from "./routes/health.js";
import { organizationRoutes } from "./routes/organizations.js";
import { notificationRoutes } from "./routes/notifications.js";
import { messagingWebhookRoutes } from "./routes/messaging-webhooks.js";

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  // Browser "Failed to fetch" from the Vite app (e.g. :5173 → :3001) is usually CORS.
  // Reflect any localhost / 127.0.0.1 origin in dev; use CORS_ORIGIN in production.
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) {
        cb(null, true);
        return;
      }
      try {
        const host = new URL(origin).hostname;
        const isLoopback =
          host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
        if (isLoopback) {
          cb(null, true);
          return;
        }
      } catch {
        cb(null, false);
        return;
      }
      const raw = process.env.CORS_ORIGIN?.trim();
      if (!raw || raw === "*") {
        cb(null, true);
        return;
      }
      const allowed = raw.split(",").map((s) => s.trim());
      cb(null, allowed.includes(origin));
    },
    credentials: false,
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    strictPreflight: false,
  });

  await app.register(prismaPlugin);

  app.get("/", async () => ({
    service: "boat-server",
    endpoints: {
      health: "/health",
      ready: "/ready",
      organizations: "/api/v1/organizations",
      notifications: "/api/v1/notifications/send",
      webhooks: {
        twilio: "/api/v1/webhooks/twilio",
        metaWhatsapp: "/api/v1/webhooks/meta/whatsapp",
      },
    },
  }));

  await app.register(healthRoutes);
  await app.register(organizationRoutes, { prefix: "/api/v1" });
  await app.register(notificationRoutes, { prefix: "/api/v1" });
  await app.register(messagingWebhookRoutes, { prefix: "/api/v1" });

  return app;
}
