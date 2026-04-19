import type { PrismaClient } from "@prisma/client";
import type { NotificationService } from "../messaging/notification-service.js";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
    notificationService: NotificationService;
  }

  interface FastifyRequest {
    /** Set by Meta webhook route `preParsing` for `X-Hub-Signature-256` verification. */
    rawBody?: Buffer;
  }
}
