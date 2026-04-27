import type { SubscriptionStatus } from "@/contexts/AuthContext";

const LOCAL_SUBSCRIPTION_PROFILE_KEY = "boat.local.subscription.profile.v1";
const LOCAL_SUBSCRIPTION_USED_TOKENS_KEY = "boat.local.subscription.used-tokens.v1";
const LOCAL_SUBSCRIPTION_CHANGED_EVENT = "boat.local.subscription.changed";

const ALLOWED_STATUSES: SubscriptionStatus[] = ["trial", "active", "past_due", "cancelled", "expired", "none"];

type RenewalTokenPayload = {
  iss?: string;
  jti?: string;
  org_id?: string;
  plan_code?: string;
  status?: SubscriptionStatus;
  period_start?: string;
  period_end?: string;
  issued_at?: string;
  not_before?: string;
  expires_at?: string;
};

export type LocalSubscriptionProfile = {
  organization_id: string;
  status: SubscriptionStatus;
  plan_code: string | null;
  period_start: string | null;
  period_end: string | null;
  updated_at: string;
  last_token_jti: string | null;
};

function emitChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LOCAL_SUBSCRIPTION_CHANGED_EVENT));
}

export function localSubscriptionChangedEventName(): string {
  return LOCAL_SUBSCRIPTION_CHANGED_EVENT;
}

export function readLocalSubscriptionProfile(organizationId: string): LocalSubscriptionProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_SUBSCRIPTION_PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, LocalSubscriptionProfile>;
    const row = parsed?.[organizationId];
    if (!row || !ALLOWED_STATUSES.includes(row.status)) return null;
    return row;
  } catch {
    return null;
  }
}

function writeLocalSubscriptionProfile(profile: LocalSubscriptionProfile): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(LOCAL_SUBSCRIPTION_PROFILE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, LocalSubscriptionProfile>) : {};
    parsed[profile.organization_id] = profile;
    window.localStorage.setItem(LOCAL_SUBSCRIPTION_PROFILE_KEY, JSON.stringify(parsed));
    emitChanged();
  } catch {
    // Ignore persistence errors.
  }
}

function readUsedTokens(organizationId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_SUBSCRIPTION_USED_TOKENS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    const list = parsed?.[organizationId];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeUsedToken(organizationId: string, jti: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(LOCAL_SUBSCRIPTION_USED_TOKENS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    const existing = Array.isArray(parsed[organizationId]) ? parsed[organizationId] : [];
    if (!existing.includes(jti)) parsed[organizationId] = [...existing, jti];
    window.localStorage.setItem(LOCAL_SUBSCRIPTION_USED_TOKENS_KEY, JSON.stringify(parsed));
  } catch {
    // Ignore persistence errors.
  }
}

function decodeBase64Url(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
  const base64 = normalized + "=".repeat(padLen);
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeBase64UrlText(input: string): string {
  return new TextDecoder().decode(decodeBase64Url(input));
}

function parsePemSpki(pem: string): ArrayBuffer {
  const cleaned = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(cleaned);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function verifyJwtRs256(token: string, publicKeyPem: string): Promise<RenewalTokenPayload> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid token format.");
  const [encodedHeader, encodedPayload, encodedSig] = parts;
  const header = JSON.parse(decodeBase64UrlText(encodedHeader)) as { alg?: string; typ?: string };
  if (header.alg !== "RS256") throw new Error("Unsupported token algorithm. Expected RS256.");
  const data = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const sig = decodeBase64Url(encodedSig);
  const key = await crypto.subtle.importKey(
    "spki",
    parsePemSpki(publicKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, data);
  if (!ok) throw new Error("Token signature is invalid.");
  return JSON.parse(decodeBase64UrlText(encodedPayload)) as RenewalTokenPayload;
}

function parseDateOrNull(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export async function applyLocalSubscriptionRenewalToken(params: {
  token: string;
  organizationId: string;
}): Promise<LocalSubscriptionProfile> {
  const token = params.token.trim();
  if (!token) throw new Error("Paste a renewal token first.");
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    throw new Error("Token verification is unavailable on this device.");
  }
  const publicKeyPem = (import.meta.env.VITE_SUBSCRIPTION_TOKEN_PUBLIC_KEY || "").trim();
  if (!publicKeyPem) {
    throw new Error("Missing VITE_SUBSCRIPTION_TOKEN_PUBLIC_KEY in this build.");
  }

  const payload = await verifyJwtRs256(token, publicKeyPem);
  const tokenOrgId = (payload.org_id || "").trim();
  const jti = (payload.jti || "").trim();
  if (!tokenOrgId || !jti) throw new Error("Token is missing org_id or jti.");
  if (tokenOrgId !== params.organizationId) {
    throw new Error("Token organization does not match this local organization.");
  }
  if (!payload.status || !ALLOWED_STATUSES.includes(payload.status)) {
    throw new Error("Token has invalid subscription status.");
  }

  const now = Date.now();
  const notBefore = parseDateOrNull(payload.not_before);
  if (notBefore !== null && now < notBefore) throw new Error("Token is not active yet.");
  const expiresAt = parseDateOrNull(payload.expires_at);
  if (expiresAt !== null && now > expiresAt) throw new Error("Token has expired.");

  if (readUsedTokens(params.organizationId).includes(jti)) {
    throw new Error("This renewal token was already used on this device.");
  }

  const startMs = parseDateOrNull(payload.period_start);
  const endMs = parseDateOrNull(payload.period_end);
  if (startMs !== null && endMs !== null && endMs < startMs) {
    throw new Error("Token period_end cannot be before period_start.");
  }

  const next: LocalSubscriptionProfile = {
    organization_id: params.organizationId,
    status: payload.status,
    plan_code: payload.plan_code || null,
    period_start: payload.period_start || null,
    period_end: payload.period_end || null,
    updated_at: new Date().toISOString(),
    last_token_jti: jti,
  };

  writeLocalSubscriptionProfile(next);
  writeUsedToken(params.organizationId, jti);
  return next;
}

