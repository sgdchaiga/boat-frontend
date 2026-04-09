import fp from "fastify-plugin";
import { PrismaClient } from "@prisma/client";

export default fp(
  async (fastify) => {
    const prisma = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
    });
    fastify.decorate("prisma", prisma);
    fastify.addHook("onClose", async (app) => {
      await app.prisma.$disconnect();
    });
  },
  { name: "prisma" }
);
