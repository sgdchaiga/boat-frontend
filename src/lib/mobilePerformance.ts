export type MobilePerformanceSummary = {
  sessions: number;
  lastStartupMs: number | null;
  averageStartupMs: number | null;
  slowResources: number;
  failedRequests: number;
};

type MetricType = "startup" | "slow_resource" | "request_failed" | "app_error" | "offline" | "sync_failed";
type QueuedMetric = { event_type: MetricType; duration_ms?: number; page?: string; network_type?: string; device_class: string; metadata: Record<string, string | number | boolean>; created_at: string };

const KEY = "boat.mobile.performance.v1";
const QUEUE_KEY = "boat.mobile.performance.queue.v1";
const SESSION_ID = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-0000-4000-8000-000000000000`;
let organizationId: string | null = null;
let flushing = false;

function emptySummary(): MobilePerformanceSummary { return { sessions: 0, lastStartupMs: null, averageStartupMs: null, slowResources: 0, failedRequests: 0 }; }
function read(): MobilePerformanceSummary { try { return JSON.parse(localStorage.getItem(KEY) || "null") || emptySummary(); } catch { return emptySummary(); } }
function readQueue(): QueuedMetric[] { try { const rows = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); return Array.isArray(rows) ? rows : []; } catch { return []; } }
function writeQueue(rows: QueuedMetric[]) { localStorage.setItem(QUEUE_KEY, JSON.stringify(rows.slice(-100))); }
function safePage() { return new URL(location.href).searchParams.get("page")?.slice(0, 80) || "home"; }
function networkType() { return (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType || (navigator.onLine ? "online" : "offline"); }

export function readMobilePerformance(): MobilePerformanceSummary { return read(); }

export function recordMobileMetric(event_type: MetricType, input: Partial<Omit<QueuedMetric, "event_type" | "device_class" | "created_at">> = {}) {
  if (typeof window === "undefined" || !matchMedia("(max-width: 767px)").matches) return;
  const metric: QueuedMetric = { event_type, duration_ms: input.duration_ms, page: input.page || safePage(), network_type: networkType(), device_class: innerWidth <= 480 ? "small_phone" : "phone", metadata: input.metadata || {}, created_at: new Date().toISOString() };
  writeQueue([...readQueue(), metric]);
  if (navigator.onLine) void flushMobileMetrics();
}

export async function flushMobileMetrics() {
  if (flushing || !organizationId || !navigator.onLine) return;
  const queue = readQueue();
  if (!queue.length) return;
  flushing = true;
  try {
    const { supabase } = await import("@/lib/supabase");
    const batch = queue.slice(0, 20).map((row) => ({ ...row, organization_id: organizationId, session_id: SESSION_ID }));
    const { error } = await supabase.from("mobile_performance_events").insert(batch);
    if (!error) writeQueue(queue.slice(batch.length));
  } catch { /* keep the bounded queue for the next online session */ }
  finally { flushing = false; }
}

export function setMobileTelemetryOrganization(nextOrganizationId: string | null) {
  organizationId = nextOrganizationId;
  if (organizationId) void flushMobileMetrics();
}

export function startMobilePerformanceTracking() {
  if (typeof window === "undefined" || !matchMedia("(max-width: 767px)").matches) return;
  window.addEventListener("load", () => {
    const current = read();
    const startup = Math.round(performance.now());
    const sessions = current.sessions + 1;
    const averageStartupMs = Math.round((((current.averageStartupMs || 0) * current.sessions) + startup) / sessions);
    const slow = performance.getEntriesByType("resource").filter((entry) => entry.duration > 1500);
    localStorage.setItem(KEY, JSON.stringify({ ...current, sessions, lastStartupMs: startup, averageStartupMs, slowResources: current.slowResources + slow.length }));
    recordMobileMetric("startup", { duration_ms: startup });
    slow.slice(0, 10).forEach((entry) => recordMobileMetric("slow_resource", { duration_ms: Math.round(entry.duration), metadata: { resource_type: (entry as PerformanceResourceTiming).initiatorType || "unknown" } }));
  }, { once: true });
  window.addEventListener("error", (event) => recordMobileMetric("app_error", { metadata: { kind: event instanceof ErrorEvent ? "javascript" : "resource" } }), true);
  window.addEventListener("unhandledrejection", () => recordMobileMetric("app_error", { metadata: { kind: "unhandled_promise" } }));
  window.addEventListener("offline", () => recordMobileMetric("offline"));
  window.addEventListener("online", () => void flushMobileMetrics());
  window.addEventListener("boat:request-failed", () => {
    const current = read();
    localStorage.setItem(KEY, JSON.stringify({ ...current, failedRequests: current.failedRequests + 1 }));
    recordMobileMetric("request_failed");
  });
}
