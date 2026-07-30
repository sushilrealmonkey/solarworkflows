import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "../../services/supabaseClient";
import type {
  NotificationPreference,
  NotificationSettings,
} from "./notificationTypes";

async function invoke(body: Record<string, unknown>) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.functions.invoke(
    "notification-settings",
    { body },
  );
  if (error) {
    if (error instanceof FunctionsHttpError) {
      try {
        const payload = await error.context.json() as { error?: string };
        if (payload.error) throw new Error(payload.error);
      } catch (nextError) {
        if (nextError instanceof Error && nextError !== error) throw nextError;
      }
    }
    throw new Error(error.message);
  }
  return data as NotificationSettings;
}

export function fetchNotificationSettings() {
  return invoke({ action: "get" });
}

export function saveNotificationSettings(
  preferences: Array<
    Pick<
      NotificationPreference,
      "notification_type" | "is_enabled" | "delivery_time" | "timezone"
    >
  >,
) {
  return invoke({ action: "save", preferences });
}
