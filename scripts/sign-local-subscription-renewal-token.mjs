#!/usr/bin/env node
/**
 * Mint an RS256 JWT for **Admin → Subscription renewal** on local / desktop BOAT builds.
 * The app verifies it with `VITE_SUBSCRIPTION_TOKEN_PUBLIC_KEY` (see `.env.example`).
 *
 * ## One-time key setup
 *
 * ```bash
 * openssl genrsa -out subscription-renewal-private.pem 2048
 * openssl rsa -in subscription-renewal-private.pem -pubout -out subscription-renewal-public.pem
 * ```
 *
 * Put the **public** PEM into `VITE_SUBSCRIPTION_TOKEN_PUBLIC_KEY` when you run `vite build`
 * / `npm run build:desktop:local` (escape newlines as `\n` in `.env` if needed).
 * Keep **subscription-renewal-private.pem** secret; only operators run this script.
 * Platform superusers can mint the same JWT from Organizations → key icon (Edge Function `subscription-renewal-token`;
 * deploy with secret `SUBSCRIPTION_RENEWAL_PRIVATE_KEY` as PKCS#8 PEM).
 *
 * ## Example
 *
 * ```bash
 * node scripts/sign-local-subscription-renewal-token.mjs \
 *   --private-key ./subscription-renewal-private.pem \
 *   --org-id 00000000-0000-0000-0000-000000000001 \
 *   --status active \
 *   --plan-code desktop-local \
 *   --period-start 2026-01-01T00:00:00.000Z \
 *   --period-end 2027-01-01T00:00:00.000Z
 * ```
 *
 * Claims in the JWT body (see `src/lib/localSubscriptionLicense.ts`):
 * - `org_id` (required) — must match the organization ID shown on the renewal page.
 * - `jti` (required) — unique id per token; reuse is rejected after first apply.
 * - `status` (required) — trial | active | past_due | cancelled | expired | none
 * - `plan_code` (optional)
 * - `period_start` / `period_end` (optional, ISO 8601)
 * - `not_before` / `expires_at` (optional) — envelope for when the **JWT** may be applied
 */

import { createSign, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ALLOWED = new Set(["trial", "active", "past_due", "cancelled", "expired", "none"]);

function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      out.help = "1";
      continue;
    }
    if (!a.startsWith("--")) continue;
    const key = a.slice(2).replace(/-/g, "_");
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

function b64urlJson(obj) {
  return Buffer.from(JSON.stringify(obj), "utf8")
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlBuf(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

const args = parseArgs(process.argv);

if (args.help) {
  console.log(`Usage:
  node scripts/sign-local-subscription-renewal-token.mjs \\
    --private-key <path-to-pem> \\
    --org-id <uuid> \\
    --status <trial|active|past_due|cancelled|expired|none> \\
    [--plan-code <string>] \\
    [--period-start <iso>] [--period-end <iso>] \\
    [--jti <uuid>] \\
    [--not-before <iso>] [--expires-at <iso>]

Environment:
  SUBSCRIPTION_RENEWAL_PRIVATE_KEY   PEM string instead of --private-key file
`);
  process.exit(0);
}

const pemFromEnv = (process.env.SUBSCRIPTION_RENEWAL_PRIVATE_KEY || "").trim();
const keyPath = (args.private_key || "").trim();
const privatePem = pemFromEnv || (keyPath ? readFileSync(resolve(keyPath), "utf8") : "");

if (!privatePem.includes("PRIVATE KEY")) {
  console.error("Provide --private-key <file.pem> or SUBSCRIPTION_RENEWAL_PRIVATE_KEY with PEM contents.");
  process.exit(1);
}

const orgId = (args.org_id || "").trim();
const status = (args.status || "active").trim().toLowerCase();
if (!orgId) {
  console.error("Missing --org-id (must match Admin → Subscription renewal page).");
  process.exit(1);
}
if (!ALLOWED.has(status)) {
  console.error(`Invalid --status. Allowed: ${[...ALLOWED].join(", ")}`);
  process.exit(1);
}

const jti = (args.jti || "").trim() || randomUUID();
const planCode = (args.plan_code || "desktop-local").trim() || null;

/** @type {Record<string, unknown>} */
const body = {
  jti,
  org_id: orgId,
  status,
  plan_code: planCode,
};
if (args.period_start) body.period_start = args.period_start;
if (args.period_end) body.period_end = args.period_end;
if (args.not_before) body.not_before = args.not_before;
if (args.expires_at) body.expires_at = args.expires_at;
body.issued_at = new Date().toISOString();

const header = { alg: "RS256", typ: "JWT" };
const encodedHeader = b64urlJson(header);
const encodedPayload = b64urlJson(body);
const signingInput = `${encodedHeader}.${encodedPayload}`;

const sign = createSign("RSA-SHA256");
sign.update(signingInput);
sign.end();
const sig = sign.sign(privatePem);
const token = `${signingInput}.${b64urlBuf(sig)}`;

console.log(token);
