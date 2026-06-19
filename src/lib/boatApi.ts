import { desktopApi } from "@/lib/desktopApi";

type ApiOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
};

export function isDesktopApiDataMode(): boolean {
  const mode = (import.meta.env.VITE_DESKTOP_DATA_MODE || "").trim().toLowerCase();
  return mode === "api" || mode === "server" || mode === "postgres";
}

export function staticBoatApiBaseUrl(): string {
  return (import.meta.env.VITE_BOAT_API_URL || import.meta.env.VITE_API_URL || "").trim().replace(/\/+$/, "");
}

export async function getBoatApiBaseUrl(): Promise<string> {
  const envUrl = staticBoatApiBaseUrl();
  if (envUrl) return envUrl;
  if (!desktopApi.isAvailable()) return "";
  const settings = await desktopApi.getSettings();
  return settings.apiBaseUrl.replace(/\/+$/, "");
}

export async function boatApiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const baseUrl = await getBoatApiBaseUrl();
  if (!baseUrl) {
    throw new Error("BOAT API server URL is not configured.");
  }
  const res = await fetch(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body == null ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  const payload = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(payload?.message || payload?.error || `BOAT API request failed (${res.status}).`);
  }
  return payload as T;
}

export const boatApi = {
  health: () => boatApiFetch<{ ok: boolean; service: string; time: string }>("/health"),
  ready: () => boatApiFetch<{ ok: boolean; db: string }>("/ready"),
  school: {
    list<T = unknown>(resource: string, organizationId: string) {
      const qp = new URLSearchParams({ organization_id: organizationId });
      return boatApiFetch<{ data: T[] }>(`/api/v1/school/${resource}?${qp.toString()}`);
    },
    create<T = unknown>(resource: string, body: Record<string, unknown>) {
      return boatApiFetch<{ data: T }>(`/api/v1/school/${resource}`, {
        method: "POST",
        body,
      });
    },
    update<T = unknown>(resource: string, id: string, body: Record<string, unknown>) {
      return boatApiFetch<{ data: T }>(`/api/v1/school/${resource}/${id}`, {
        method: "PATCH",
        body,
      });
    },
    remove<T = unknown>(resource: string, id: string, organizationId: string) {
      const qp = new URLSearchParams({ organization_id: organizationId });
      return boatApiFetch<{ data: T }>(`/api/v1/school/${resource}/${id}?${qp.toString()}`, {
        method: "DELETE",
      });
    },
    recordPayment<T = unknown>(body: Record<string, unknown>) {
      return boatApiFetch<{ data: T }>(`/api/v1/school/payments/record`, {
        method: "POST",
        body,
      });
    },
  },
};
