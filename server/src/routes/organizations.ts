import type { FastifyPluginAsync } from "fastify";

/**
 * Example read API — replace with auth + org scoping before production.
 */
export const organizationRoutes: FastifyPluginAsync = async (app) => {
  app.get("/organizations", async () => {
    const rows = await app.prisma.organization.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        businessType: true,
        createdAt: true,
      },
    });
    return { data: rows };
  });
};
