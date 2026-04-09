/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** `true` | `1` | `yes` = skip requiring Supabase URL/key (use with local JWT API + placeholder client). */
  readonly VITE_LOCAL_AUTH?: string;
  readonly VITE_API_URL?: string;
  /** `online` (default) or `lan` (on-prem + optional cloud sync queue). */
  readonly VITE_DEPLOYMENT_MODE: string;
  /** Same uuid as `tenant_settings.cloud_tenant_id` on the LAN DB / cloud tenancy. */
  readonly VITE_TENANT_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}