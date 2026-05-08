#!/usr/bin/env node
/**
 * Generate RSA key pair for desktop subscription renewal (no OpenSSL required).
 * Writes PEM files in the current working directory.
 *
 *   npm run subscription-renewal:generate-keys
 *
 * - subscription-renewal-private-pkcs8.pem → Supabase secret SUBSCRIPTION_RENEWAL_PRIVATE_KEY (keep secret)
 * - subscription-renewal-public.pem      → VITE_SUBSCRIPTION_TOKEN_PUBLIC_KEY in .env (desktop/web builds)
 */
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const outDir = process.cwd();
const privatePath = resolve(outDir, "subscription-renewal-private-pkcs8.pem");
const publicPath = resolve(outDir, "subscription-renewal-public.pem");

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

writeFileSync(privatePath, privateKey, "utf8");
writeFileSync(publicPath, publicKey, "utf8");

console.log(`Wrote:\n  ${privatePath}\n  ${publicPath}\n`);
console.log("Next steps:");
console.log("  1) Put the PRIVATE file contents into Supabase → SUBSCRIPTION_RENEWAL_PRIVATE_KEY (or supabase/secrets.local.env).");
console.log("  2) Put the PUBLIC file (one line with \\n) into .env as VITE_SUBSCRIPTION_TOKEN_PUBLIC_KEY=...");
console.log("  3) npm run supabase:secrets:subscription-renewal   (after link)");
console.log("  4) Rebuild desktop so the new public key is embedded. Do not commit the .pem files.");
