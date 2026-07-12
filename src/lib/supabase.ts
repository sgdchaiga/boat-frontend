import { createClient } from "@supabase/supabase-js";
import { desktopApi } from "@/lib/desktopApi";

function requireEnv(name: string, value: string | undefined): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `[BOAT] Missing ${name}. Add it to your environment (e.g. \`.env\`: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY). See .env.example.`
    );
  }
  return value.trim();
}

/** When migrating off Supabase Auth, set VITE_LOCAL_AUTH=true (or 1 / yes) and you may omit Supabase env vars. */
function localAuthEnvEnabled(): boolean {
  const v = import.meta.env.VITE_LOCAL_AUTH?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function desktopApiDataModeEnabled(): boolean {
  const v = import.meta.env.VITE_DESKTOP_DATA_MODE?.trim().toLowerCase();
  return v === "api" || v === "server" || v === "postgres";
}

const LOCAL_PLACEHOLDER_URL = "http://127.0.0.1:1";
const LOCAL_PLACEHOLDER_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJsb2NhbC1wbGFjZWhvbGRlciIsInJvbGUiOiJhbm9uIn0.local-auth-placeholder";

const envSupabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const envSupabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
const hasCloudEnv = Boolean(envSupabaseUrl) && Boolean(envSupabaseAnonKey);
const localAuthEnabled = localAuthEnvEnabled();
const desktopApiDataMode = desktopApiDataModeEnabled();
const supabaseUrl = localAuthEnvEnabled()
  ? hasCloudEnv
    ? (envSupabaseUrl as string)
    : LOCAL_PLACEHOLDER_URL
  : requireEnv("VITE_SUPABASE_URL", import.meta.env.VITE_SUPABASE_URL);
const supabaseAnonKey = localAuthEnvEnabled()
  ? hasCloudEnv
    ? (envSupabaseAnonKey as string)
    : LOCAL_PLACEHOLDER_ANON_KEY
  : requireEnv("VITE_SUPABASE_ANON_KEY", import.meta.env.VITE_SUPABASE_ANON_KEY);

const cloudDisabledFetch: typeof fetch = async (_input, _init) => {
  return new Response(
    JSON.stringify({
      error: "cloud_disabled_in_local_mode",
      message: "Cloud API is disabled in this local desktop build.",
    }),
    {
      status: 503,
      statusText: "Service Unavailable",
      headers: { "Content-Type": "application/json" },
    }
  );
};

const resilientFetch: typeof fetch = async (input, init) => {
  try {
    const response = await fetch(input, init);
    if (response.status >= 500 && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("boat:request-failed"));
    return response;
  } catch (error) {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("boat:request-failed"));
    return new Response(
      JSON.stringify({
        error: "network_offline_or_unreachable",
        message: error instanceof Error ? error.message : "Network request failed",
      }),
      {
        status: 503,
        statusText: "Service Unavailable",
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};

/**
 * In `vite` dev, optional same-origin proxy for Edge Functions (see vite.config.ts `/__sb_functions`).
 * Use when the browser shows net::ERR_FAILED to `*.supabase.co/functions/v1/...` (CORS, TLS inspection, etc.).
 */
function createFunctionsDevProxyFetch(inner: typeof fetch): typeof fetch {
  const enabled =
    import.meta.env.DEV &&
    String(import.meta.env.VITE_DEV_PROXY_SUPABASE_FUNCTIONS || "").toLowerCase() === "true";
  if (!enabled) return inner;

  return (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof window === "undefined") return inner(input, init);

    let urlStr: string;
    if (typeof input === "string") urlStr = input;
    else if (input instanceof URL) urlStr = input.href;
    else if (input instanceof Request) urlStr = input.url;
    else return inner(input, init);

    try {
      const u = new URL(urlStr);
      if (u.hostname.endsWith(".supabase.co") && u.pathname.startsWith("/functions/v1")) {
        const after = u.pathname.slice("/functions/v1".length) + u.search;
        const proxied = `${window.location.origin}/__sb_functions${after}`;
        if (input instanceof Request) {
          return inner(new Request(proxied, input));
        }
        return inner(proxied, init);
      }
    } catch {
      /* fall through */
    }
    return inner(input, init);
  };
}

type LocalFilter = { column: string; operator: string; value: unknown };
type LocalResult<T = unknown> = Promise<{ data: T; error: { message: string } | null; count?: number | null }>;

class LocalQueryBuilder implements PromiseLike<{ data: unknown; error: { message: string } | null; count?: number | null }> {
  private action: "select" | "insert" | "upsert" | "update" | "delete" = "select";
  private filters: LocalFilter[] = [];
  private orderBy?: { column: string; ascending?: boolean };
  private limitN?: number;
  private offsetN = 0;
  private singleMode: "none" | "single" | "maybeSingle" = "none";
  private head = false;
  private countRequested = false;
  private payloadRows: Record<string, unknown>[] = [];
  private patch: Record<string, unknown> = {};

  constructor(private table: string) {}

  select(_columns = "*", options?: { count?: string; head?: boolean }) {
    this.action = "select";
    this.head = options?.head === true;
    this.countRequested = options?.count === "exact";
    return this;
  }

  insert(values: Record<string, unknown> | Record<string, unknown>[]) {
    this.action = "insert";
    this.payloadRows = Array.isArray(values) ? values : [values];
    return this;
  }

  upsert(values: Record<string, unknown> | Record<string, unknown>[], _options?: { onConflict?: string }) {
    this.action = "upsert";
    this.payloadRows = Array.isArray(values) ? values : [values];
    return this;
  }

  update(values: Record<string, unknown>) {
    this.action = "update";
    this.patch = values;
    return this;
  }

  delete() {
    this.action = "delete";
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, operator: "eq", value });
    return this;
  }
  gt(column: string, value: unknown) {
    this.filters.push({ column, operator: "gt", value });
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push({ column, operator: "neq", value });
    return this;
  }
  gte(column: string, value: unknown) {
    this.filters.push({ column, operator: "gte", value });
    return this;
  }
  lt(column: string, value: unknown) {
    this.filters.push({ column, operator: "lt", value });
    return this;
  }
  lte(column: string, value: unknown) {
    this.filters.push({ column, operator: "lte", value });
    return this;
  }
  is(column: string, value: unknown) {
    this.filters.push({ column, operator: "is", value });
    return this;
  }
  /**
   * PostgREST-style negation used in a few queries.
   * - `.not("col", "is", null)` → IS NOT NULL
   * - `.not("id", "in", "(a,b)")` → NOT IN (used for room pickers)
   */
  not(column: string, operator: string, value: unknown) {
    if (operator === "is" && value === null) {
      this.filters.push({ column, operator: "is_not_null", value: true });
      return this;
    }
    if (operator === "in") {
      const raw = String(value ?? "").trim();
      const inner = raw.replace(/^\(/, "").replace(/\)$/, "");
      const ids = inner
        .split(",")
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
      this.filters.push({ column, operator: "not_in", value: ids });
      return this;
    }
    throw new Error(`[BOAT] LocalQueryBuilder: unsupported .not("${column}", "${String(operator)}", …)`);
  }
  in(column: string, value: unknown[]) {
    this.filters.push({ column, operator: "in", value });
    return this;
  }
  ilike(column: string, value: string) {
    this.filters.push({ column, operator: "ilike", value });
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: options?.ascending !== false };
    return this;
  }
  limit(value: number) {
    this.limitN = value;
    return this;
  }
  range(from: number, to: number) {
    this.offsetN = from;
    this.limitN = Math.max(0, to - from + 1);
    return this;
  }
  single() {
    this.singleMode = "single";
    return this;
  }
  maybeSingle() {
    this.singleMode = "maybeSingle";
    return this;
  }

  then<TResult1 = { data: unknown; error: { message: string } | null; count?: number | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: { message: string } | null; count?: number | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }

  private async execute(): LocalResult<unknown> {
    try {
      if (!desktopApi.isAvailable()) {
        return { data: null, error: { message: "Local desktop API is unavailable." }, count: null };
      }
      if (this.action === "insert" || this.action === "upsert") {
        const rows = await desktopApi.localUpsert({ table: this.table, rows: this.payloadRows });
        return this.pickSingle(rows);
      }
      if (this.action === "update") {
        const rows = await desktopApi.localUpdate({ table: this.table, filters: this.filters, patch: this.patch });
        return this.pickSingle(rows);
      }
      if (this.action === "delete") {
        const rows = await desktopApi.localDelete({ table: this.table, filters: this.filters });
        return this.pickSingle(rows);
      }
      const result = await desktopApi.localSelect({
        table: this.table,
        filters: this.filters,
        orderBy: this.orderBy,
        limit: this.limitN,
        offset: this.offsetN,
      });
      const count = this.countRequested ? result.count : null;
      if (this.head) {
        return { data: null, error: null, count };
      }
      const selected = this.pickSingle(result.rows);
      return { ...selected, count };
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : "Local query failed." }, count: null };
    }
  }

  private pickSingle(rows: unknown[]) {
    if (this.singleMode === "single") {
      if (!rows || rows.length !== 1) {
        return { data: null, error: { message: `Expected single row, got ${rows?.length ?? 0}.` } };
      }
      return { data: rows[0], error: null };
    }
    if (this.singleMode === "maybeSingle") {
      if (!rows || rows.length === 0) return { data: null, error: null };
      return { data: rows[0], error: null };
    }
    return { data: rows, error: null };
  }
}

function createLocalSupabaseClient() {
  return {
    from(table: string) {
      return new LocalQueryBuilder(table);
    },
    rpc(_fn: string, _args?: Record<string, unknown>) {
      return Promise.resolve({ data: null, error: { message: "RPC not available in local mode." } });
    },
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithPassword: async () => ({ data: null, error: { message: "Use local auth mode sign-in." } }),
      signUp: async () => ({ data: null, error: { message: "Use local auth mode sign-up." } }),
      signOut: async () => ({ error: null }),
      resetPasswordForEmail: async () => ({ data: null, error: { message: "Unavailable in local mode." } }),
      updateUser: async () => ({ data: null, error: { message: "Unavailable in local mode." } }),
    },
  };
}

/**
 * Client is untyped at the schema level: `database.types.ts` is partial vs the live DB.
 * Regenerate from Supabase (`supabase gen types`) when the schema changes, then you can
 * switch back to `createClient<Database>(...)`.
 */
const cloudOrResilientFetch =
  localAuthEnabled && !hasCloudEnv ? cloudDisabledFetch : resilientFetch;
const browserFetch = createFunctionsDevProxyFetch(cloudOrResilientFetch);

export const supabase: any =
  localAuthEnabled && desktopApi.isAvailable() && !desktopApiDataMode
    ? createLocalSupabaseClient()
    : createClient(supabaseUrl, supabaseAnonKey, {
        global: {
          // Prevent uncaught `TypeError: Failed to fetch` and return controlled errors instead.
          fetch: browserFetch,
        },
      });
