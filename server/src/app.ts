import Fastify from "fastify";
import cors from "@fastify/cors";
import prismaPlugin from "./plugins/prisma.js";
import { healthRoutes } from "./routes/health.js";
import { organizationRoutes } from "./routes/organizations.js";

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN === "*" || !process.env.CORS_ORIGIN ? true : process.env.CORS_ORIGIN.split(","),
    credentials: true,
  });

  await app.register(prismaPlugin);

  app.get("/", async () => ({
    service: "boat-server",
    endpoints: {
      health: "/health",
      ready: "/ready",
      organizations: "/api/v1/organizations",
    },
  }));

  await app.register(healthRoutes);
  await app.register(organizationRoutes, { prefix: "/api/v1" });

  return app;
}
