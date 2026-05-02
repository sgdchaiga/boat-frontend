import type { PrismaClient } from "@prisma/client";
import type { NotificationService } from "../messaging/notification-service.js";
import type { ClearingEngine } from "../clearing/clearingEngine.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    notificationService: NotificationService;
    /** Present when CLEARING_* env is configured at boot. */
    clearing?: ClearingEngine;
  }

  interface FastifyRequest {
    /** Set by Meta webhook route `preParsing` for `X-Hub-Signature-256` verification. */
    rawBody?: Buffer;
  }
}
