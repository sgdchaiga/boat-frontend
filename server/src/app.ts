import Fastify from "fastify";
import cors from "@fastify/cors";
import { createClient } from "@supabase/supabase-js";
import prismaPlugin from "./plugins/prisma.js";
import clearingPlugin from "./plugins/clearing.js";
import { ClearingEngine } from "./clearing/clearingEngine.js";
import { getClearingEnv } from "./clearing/env.js";
import { healthRoutes } from "./routes/health.js";
import { organizationRoutes } from "./routes/organizations.js";
import { notificationRoutes } from "./routes/notifications.js";
import { messagingWebhookRoutes } from "./routes/messaging-webhooks.js";
import { clearingRoutes } from "./routes/clearing.js";

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

  const clearingEnv = getClearingEnv();
  if (clearingEnv) {
    const clearingClient = createClient(clearingEnv.url, clearingEnv.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const clearingEngine = new ClearingEngine(clearingClient);
    await app.register(clearingPlugin, { engine: clearingEngine });
    await app.register(clearingRoutes, { prefix: "/api/v1/clearing" });
    app.log.info("SACCO clearing engine enabled (isolated Supabase project).");
  } else {
    app.log.warn(
      "SACCO clearing engine disabled: set CLEARING_SUPABASE_URL, CLEARING_SUPABASE_SERVICE_ROLE_KEY, and CLEARING_API_KEY."
    );
  }

  app.get("/", async (_req, reply) => {
    const base = {
      health: "/health",
      ready: "/ready",
      organizations: "/api/v1/organizations",
      notifications: "/api/v1/notifications/send",
      webhooks: {
        twilio: "/api/v1/webhooks/twilio",
        metaWhatsapp: "/api/v1/webhooks/meta/whatsapp",
      },
    };
    const withClearing =
      clearingEnv ?
        {
          ...base,
          clearing: {
            transfersPost: "/api/v1/clearing/transfers",
            topUpsPost: "/api/v1/clearing/top-ups",
            saccosPost: "/api/v1/clearing/saccos",
            ensureOrgPost: "/api/v1/clearing/orgs/:organizationId/ensure-account",
            activationPost: "/api/v1/clearing/orgs/:organizationId/activation",
            syncEligiblePost: "/api/v1/clearing/orgs/sync-eligible",
            settlementGet: "/api/v1/clearing/saccos/:saccoId/settlement",
          },
        }
      : base;
    return reply.send({ service: "boat-server", endpoints: withClearing });
  });

  await app.register(healthRoutes);
  await app.register(organizationRoutes, { prefix: "/api/v1" });
  await app.register(notificationRoutes, { prefix: "/api/v1" });
  await app.register(messagingWebhookRoutes, { prefix: "/api/v1" });

  return app;
}
