import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => ({
    ok: true,
    service: "boat-server",
    time: new Date().toISOString(),
  }));

  app.get("/ready", async (_req, reply) => {
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      return { ok: true, db: "up" };
    } catch {
      return reply.status(503).send({ ok: false, db: "down" });
    }
  });
};
