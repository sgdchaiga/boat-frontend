/** Env for the isolated Clearing Engine Supabase project (not VITE_SUPABASE_URL). */

export type ClearingSupabaseEnv = {
  url: string;
  serviceRoleKey: string;
  apiKey: string;
};

export function getClearingEnv(): ClearingSupabaseEnv | null {
  const url = process.env.CLEARING_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.CLEARING_SUPABASE_SERVICE_ROLE_KEY?.trim();
  const apiKey = process.env.CLEARING_API_KEY?.trim();

  if (!url || !serviceRoleKey || !apiKey) {
    return null;
  }

  return { url, serviceRoleKey, apiKey };
}
