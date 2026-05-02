import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { getClearingEnv } from "../clearing/env.js";

type OrgRow = {
  id: string;
  name: string;
  business_type: string | null;
  clearing_enabled: boolean;
  clearing_status: string | null;
  clearing_org_sacco_id: string | null;
  clearing_default_payer_sacco_id: string | null;
  clearing_merchant_sacco_id: string | null;
};

function parseBearer(authHeader: string | undefined): string | null {
  const raw = authHeader?.trim();
  if (!raw?.toLowerCase().startsWith("bearer ")) return null;
  const token = raw.slice(7).trim();
  return token.length ? token : null;
}

function isClearingEligibleBusinessType(value: string | null | undefined): boolean {
  return value === "sacco" || value === "vsla";
}

const clearingRoutesImpl: FastifyPluginAsync = async (app) => {
  const env = getClearingEnv();
  if (!env) {
    throw new Error("[clearing] Clearing routes registered without CLEARING_* env — misconfigured server bootstrap.");
  }

  const loadOrganization = async (organizationId: string): Promise<OrgRow | null> => {
    const rows = await app.prisma.$queryRaw<OrgRow[]>`
      SELECT
        id::text AS id,
        name,
        business_type,
        COALESCE(clearing_enabled, false) AS clearing_enabled,
        clearing_status,
        clearing_org_sacco_id::text AS clearing_org_sacco_id,
        clearing_default_payer_sacco_id::text AS clearing_default_payer_sacco_id,
        clearing_merchant_sacco_id::text AS clearing_merchant_sacco_id
      FROM public.organizations
      WHERE id = ${organizationId}::uuid
      LIMIT 1
    `;
    return rows[0] ?? null;
  };

  const assertClearingOrgColumnsReady = async () => {
    const rows = await app.prisma.$queryRaw<Array<{ ok: boolean }>>`
      SELECT (
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'organizations'
            AND column_name = 'clearing_enabled'
        )
        AND EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'organizations'
            AND column_name = 'clearing_status'
        )
        AND EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'organizations'
            AND column_name = 'clearing_org_sacco_id'
        )
      ) AS ok
    `;
    return Boolean(rows[0]?.ok);
  };

  const ensureOrgClearingAccount = async (organizationId: string, activate: boolean) => {
    const org = await loadOrganization(organizationId);
    if (!org) return { ok: false as const, code: 404, error: "organization_not_found" };
    if (!isClearingEligibleBusinessType(org.business_type)) {
      return {
        ok: true as const,
        skipped: true as const,
        reason: "business_type_not_eligible",
        business_type: org.business_type,
      };
    }
    const engine = app.clearing;
    if (!engine) return { ok: false as const, code: 503, error: "clearing_unavailable" };

    let clearingSaccoId = org.clearing_org_sacco_id ?? org.clearing_default_payer_sacco_id ?? org.clearing_merchant_sacco_id;
    if (!clearingSaccoId) {
      const created = await engine.createSacco({
        name: `${org.name} (${org.business_type?.toUpperCase() ?? "ORG"})`,
        status: "active",
        shareholding: {
          organization_id: org.id,
          business_type: org.business_type,
          provisioned_by: "boat_server_auto_sync",
        },
      });
      clearingSaccoId = created.id;
    }

    await app.prisma.$executeRaw`
      UPDATE public.organizations
      SET
        clearing_org_sacco_id = ${clearingSaccoId}::uuid,
        clearing_default_payer_sacco_id = COALESCE(clearing_default_payer_sacco_id, ${clearingSaccoId}::uuid),
        clearing_merchant_sacco_id = COALESCE(clearing_merchant_sacco_id, ${clearingSaccoId}::uuid),
        clearing_enabled = CASE WHEN ${activate} THEN true ELSE clearing_enabled END,
        clearing_status = CASE
          WHEN ${activate} THEN 'active'
          WHEN COALESCE(clearing_enabled, false) THEN 'active'
          ELSE COALESCE(clearing_status, 'inactive')
        END,
        clearing_synced_at = now(),
        updated_at = now()
      WHERE id = ${organizationId}::uuid
    `;

    const next = await loadOrganization(organizationId);
    return {
      ok: true as const,
      data: next,
      provisioned: org.clearing_org_sacco_id == null && org.clearing_default_payer_sacco_id == null && org.clearing_merchant_sacco_id == null,
    };
  };

  app.addHook("preHandler", async (req, reply) => {
    const token = parseBearer(req.headers.authorization);
    if (!token || token !== env.apiKey) {
      reply.code(401).send({ error: "unauthorized", message: "Invalid or missing Bearer token for clearing API." });
      return reply;
    }
  });

  app.post("/transfers", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const from_sacco_id = String(body.from_sacco_id ?? "").trim();
    const to_sacco_id = String(body.to_sacco_id ?? "").trim();
    const amount = Number(body.amount);
    const type = String(body.type ?? "").trim();
    const reference = String(body.reference ?? "").trim();
    const idempotency_key = body.idempotency_key != null ? String(body.idempotency_key).trim() : "";

    if (!from_sacco_id || !to_sacco_id) {
      return reply.code(400).send({ error: "validation_error", message: "from_sacco_id and to_sacco_id are required." });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return reply.code(400).send({ error: "validation_error", message: "amount must be a positive number." });
    }
    if (!type || !reference) {
      return reply.code(400).send({ error: "validation_error", message: "type and reference are required." });
    }

    const metadata =
      body.metadata && typeof body.metadata === "object" && body.metadata !== null && !Array.isArray(body.metadata)
        ? (body.metadata as Record<string, unknown>)
        : {};

    try {
      const engine = app.clearing;
      if (!engine) {
        return reply.code(503).send({ error: "clearing_unavailable" });
      }
      const result = await engine.executeInterSaccoTransfer({
        fromSaccoId: from_sacco_id,
        toSaccoId: to_sacco_id,
        amount,
        type,
        reference,
        idempotencyKey: idempotency_key || null,
        metadata: { source: "boat_api", ...metadata },
      });
      return { data: result };
    } catch (err) {
      app.log.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      const code = msg.includes("liquidity_blocked") ? 409 : msg.includes("already exists") ? 409 : 400;
      return reply.code(code).send({ error: "clearing_transfer_failed", message: msg });
    }
  });

  app.post("/top-ups", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const to_sacco_id = String(body.to_sacco_id ?? "").trim();
    const amount = Number(body.amount);
    const type = String(body.type ?? "bank_deposit").trim();
    const reference = String(body.reference ?? "").trim();
    const idempotency_key = body.idempotency_key != null ? String(body.idempotency_key).trim() : "";

    if (!to_sacco_id) {
      return reply.code(400).send({ error: "validation_error", message: "to_sacco_id is required." });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return reply.code(400).send({ error: "validation_error", message: "amount must be a positive number." });
    }
    if (!reference) {
      return reply.code(400).send({ error: "validation_error", message: "reference is required." });
    }

    const metadata =
      body.metadata && typeof body.metadata === "object" && body.metadata !== null && !Array.isArray(body.metadata)
        ? (body.metadata as Record<string, unknown>)
        : {};

    try {
      const engine = app.clearing;
      if (!engine) {
        return reply.code(503).send({ error: "clearing_unavailable" });
      }
      const result = await engine.creditFromPool({
        toSaccoId: to_sacco_id,
        amount,
        type,
        reference,
        idempotencyKey: idempotency_key || null,
        metadata: { source: "boat_api", ...metadata },
      });
      return { data: result };
    } catch (err) {
      app.log.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      const code = msg.includes("already exists") ? 409 : 400;
      return reply.code(code).send({ error: "clearing_topup_failed", message: msg });
    }
  });

  app.post("/saccos", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const name = String(body.name ?? "").trim();
    if (!name) {
      return reply.code(400).send({ error: "validation_error", message: "name is required." });
    }
    const statusRaw = body.status != null ? String(body.status).trim() : "";
    const status = statusRaw || "active";

    let shareholding: Record<string, unknown> = {};
    if (body.shareholding && typeof body.shareholding === "object" && !Array.isArray(body.shareholding)) {
      shareholding = body.shareholding as Record<string, unknown>;
    }

    try {
      const engine = app.clearing;
      if (!engine) {
        return reply.code(503).send({ error: "clearing_unavailable" });
      }
      const row = await engine.createSacco({ name, status, shareholding });
      return { data: row };
    } catch (err) {
      app.log.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: "clearing_create_sacco_failed", message: msg });
    }
  });

  app.post("/orgs/:organizationId/ensure-account", async (req, reply) => {
    const organizationId = String((req.params as { organizationId?: string }).organizationId ?? "").trim();
    if (!organizationId) {
      return reply.code(400).send({ error: "validation_error", message: "organizationId is required." });
    }
    const activate = Boolean((req.body as { activate?: boolean } | null)?.activate);
    try {
      const ready = await assertClearingOrgColumnsReady();
      if (!ready) {
        return reply.code(412).send({
          error: "clearing_org_columns_missing",
          message:
            "Apply BOAT migration `20260625150000_organizations_clearing_activation.sql` before using clearing activation.",
        });
      }
      const result = await ensureOrgClearingAccount(organizationId, activate);
      if (!result.ok) return reply.code(result.code).send({ error: result.error });
      return { data: result };
    } catch (err) {
      app.log.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: "clearing_ensure_account_failed", message: msg });
    }
  });

  app.post("/orgs/:organizationId/activation", async (req, reply) => {
    const organizationId = String((req.params as { organizationId?: string }).organizationId ?? "").trim();
    const enabled = Boolean((req.body as { enabled?: boolean } | null)?.enabled);
    if (!organizationId) {
      return reply.code(400).send({ error: "validation_error", message: "organizationId is required." });
    }
    try {
      const ready = await assertClearingOrgColumnsReady();
      if (!ready) {
        return reply.code(412).send({
          error: "clearing_org_columns_missing",
          message:
            "Apply BOAT migration `20260625150000_organizations_clearing_activation.sql` before using clearing activation.",
        });
      }
      if (enabled) {
        const ensured = await ensureOrgClearingAccount(organizationId, true);
        if (!ensured.ok) return reply.code(ensured.code).send({ error: ensured.error });
      } else {
        await app.prisma.$executeRaw`
          UPDATE public.organizations
          SET clearing_enabled = false, clearing_status = 'inactive', updated_at = now()
          WHERE id = ${organizationId}::uuid
        `;
      }
      const row = await loadOrganization(organizationId);
      return { data: row };
    } catch (err) {
      app.log.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: "clearing_activation_update_failed", message: msg });
    }
  });

  app.post("/orgs/sync-eligible", async (req, reply) => {
    const limitRaw = Number((req.body as { limit?: number } | null)?.limit ?? 200);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(1000, Math.floor(limitRaw))) : 200;
    try {
      const ready = await assertClearingOrgColumnsReady();
      if (!ready) {
        return reply.code(412).send({
          error: "clearing_org_columns_missing",
          message:
            "Apply BOAT migration `20260625150000_organizations_clearing_activation.sql` before using org clearing sync.",
        });
      }
      const rows = await app.prisma.$queryRaw<OrgRow[]>`
        SELECT
          id::text AS id,
          name,
          business_type,
          COALESCE(clearing_enabled, false) AS clearing_enabled,
          clearing_status,
          clearing_org_sacco_id::text AS clearing_org_sacco_id,
          clearing_default_payer_sacco_id::text AS clearing_default_payer_sacco_id,
          clearing_merchant_sacco_id::text AS clearing_merchant_sacco_id
        FROM public.organizations
        WHERE business_type IN ('sacco', 'vsla')
          AND (
            clearing_org_sacco_id IS NULL
            OR clearing_default_payer_sacco_id IS NULL
            OR clearing_merchant_sacco_id IS NULL
          )
        ORDER BY created_at ASC
        LIMIT ${limit}
      `;

      const results: Array<Record<string, unknown>> = [];
      for (const org of rows) {
        const ensured = await ensureOrgClearingAccount(org.id, false);
        results.push({ organization_id: org.id, ...ensured });
      }
      return { data: { total: results.length, results } };
    } catch (err) {
      app.log.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: "clearing_sync_failed", message: msg });
    }
  });

  app.get("/saccos/:saccoId/settlement", async (req, reply) => {
    const saccoId = (req.params as { saccoId: string }).saccoId;
    try {
      const engine = app.clearing;
      if (!engine) {
        return reply.code(503).send({ error: "clearing_unavailable" });
      }
      const settlement = await engine.getSettlementAccount(saccoId);
      const shares = await engine.getShares(saccoId);
      return { data: { settlement, shares } };
    } catch (err) {
      app.log.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: "clearing_fetch_failed", message: msg });
    }
  });
};

export const clearingRoutes = fp(clearingRoutesImpl, { name: "boat-clearing-routes" });
