import { createClient } from "@supabase/supabase-js";

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

const LOCAL_PLACEHOLDER_URL = "http://127.0.0.1:1";
const LOCAL_PLACEHOLDER_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJsb2NhbC1wbGFjZWhvbGRlciIsInJvbGUiOiJhbm9uIn0.local-auth-placeholder";

const supabaseUrl = localAuthEnvEnabled()
  ? LOCAL_PLACEHOLDER_URL
  : requireEnv("VITE_SUPABASE_URL", import.meta.env.VITE_SUPABASE_URL);
const supabaseAnonKey = localAuthEnvEnabled()
  ? LOCAL_PLACEHOLDER_ANON_KEY
  : requireEnv("VITE_SUPABASE_ANON_KEY", import.meta.env.VITE_SUPABASE_ANON_KEY);

/**
 * Client is untyped at the schema level: `database.types.ts` is partial vs the live DB.
 * Regenerate from Supabase (`supabase gen types`) when the schema changes, then you can
 * switch back to `createClient<Database>(...)`.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
