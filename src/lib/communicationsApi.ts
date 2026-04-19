/** Raw env value only (for docs / optional explicit URL). */
export function getBoatApiBase(): string {
  return import.meta.env.VITE_BOAT_API_URL?.trim() || "";
}

/**
 * Resolved API root for fetch (no trailing slash).
 * - If `VITE_BOAT_API_URL` is set → use it (e.g. `http://localhost:3001`).
 * - In dev with no env → `/boat-api` (Vite proxy to boat-server; avoids CORS).
 * - Production build with no env → empty (set `VITE_BOAT_API_URL` in hosting).
 */
export function getBoatApiRoot(): string {
  const fromEnv = getBoatApiBase();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (import.meta.env.DEV) return "/boat-api";
  return "";
}

export type BoatMessageChannel = "sms" | "whatsapp";

export async function sendBoatMessage(payload: {
  channel: BoatMessageChannel;
  to: string;
  text?: string;
  templateId?: string;
  organizationId?: string;
  fallbackToSms?: boolean;
}): Promise<{ ok: boolean; error?: string; data?: unknown }> {
  const origin = getBoatApiRoot();
  if (!origin) {
    return {
      ok: false,
      error:
        "Set VITE_BOAT_API_URL (e.g. http://localhost:3001 or /boat-api for the Vite proxy) or run the app in dev with the default /boat-api proxy.",
    };
  }
  try {
    const res = await fetch(`${origin}/api/v1/notifications/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const raw = await res.text();
    let parsed: { error?: string; data?: unknown } = {};
    try {
      parsed = raw ? (JSON.parse(raw) as { error?: string; data?: unknown }) : {};
    } catch {
      parsed = {};
    }
    if (!res.ok) {
      const detail = parsed.error || (raw && raw.length < 400 ? raw : "") || res.statusText || "Request failed";
      return { ok: false, error: detail };
    }
    return { ok: true, data: parsed.data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Network error";
    return { ok: false, error: msg };
  }
}
