import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env";
import {
  fetchWithJwtFutureRetry,
  registerSupabaseSessionRefresh,
} from "./supabaseFetch";

const configuredSupabase =
  env.supabaseUrl && env.supabaseAnonKey
    ? createClient(env.supabaseUrl, env.supabaseAnonKey, {
        global: {
          fetch: fetchWithJwtFutureRetry,
        },
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
        },
      })
    : null;

if (configuredSupabase) {
  registerSupabaseSessionRefresh(async () => {
    const { data, error } = await configuredSupabase.auth.refreshSession();
    return error ? null : data.session?.access_token ?? null;
  });
}

export const supabase = configuredSupabase;
