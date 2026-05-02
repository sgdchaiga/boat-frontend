/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** `true` | `1` | `yes` = skip requiring Supabase URL/key (use with local JWT API + placeholder client). */
  readonly VITE_LOCAL_AUTH?: string;
  readonly VITE_API_URL?: string;
  /** boat-server base URL for SMS/WhatsApp (e.g. http://localhost:3001). */
  readonly VITE_BOAT_API_URL?: string;
  /** When `true`, completed retail POS sales invoke Edge Function `clearing-retail-settlement` → boat-server clearing API. */
  readonly VITE_CLEARING_RETAIL_SETTLEMENT?: string;
  /** `online` (default) or `lan` (on-prem + optional cloud sync queue). */
  readonly VITE_DEPLOYMENT_MODE: string;
  /** Same uuid as `tenant_settings.cloud_tenant_id` on the LAN DB / cloud tenancy. */
  readonly VITE_TENANT_ID: string;
  /** Optional local-auth profile business type (e.g. retail, hotel, school). */
  readonly VITE_LOCAL_BUSINESS_TYPE?: string;
  /** Optional local-auth org UUID; must be valid UUID format for DB filters. */
  readonly VITE_LOCAL_ORGANIZATION_ID?: string;
  /** Comma-separated emails that should act as superuser in local mode. */
  readonly VITE_LOCAL_SUPERADMIN_EMAILS?: string;
  readonly VITE_LOCAL_ENABLE_COMMUNICATIONS?: string;
  readonly VITE_LOCAL_ENABLE_WALLET?: string;
  readonly VITE_LOCAL_ENABLE_PAYROLL?: string;
  readonly VITE_LOCAL_ENABLE_BUDGET?: string;
  readonly VITE_LOCAL_ENABLE_REPORTS?: string;
  readonly VITE_LOCAL_ENABLE_ACCOUNTING?: string;
  readonly VITE_LOCAL_ENABLE_INVENTORY?: string;
  readonly VITE_LOCAL_ENABLE_PURCHASES?: string;
  readonly VITE_LOCAL_ENABLE_FIXED_ASSETS?: string;
  /** PEM-encoded RSA public key used to verify offline subscription renewal tokens (RS256). */
  readonly VITE_SUBSCRIPTION_TOKEN_PUBLIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  boatDesktop?: import("./types/desktop-api").BoatDesktopApi;
}