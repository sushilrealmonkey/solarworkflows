import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env";
import { fetchWithJwtFutureRetry } from "./supabaseFetch";

export const supabase =
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
