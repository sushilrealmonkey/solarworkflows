import { supabase } from "../../services/supabaseClient";
import type { InAppNotification, NotificationCursor } from "./types";

function client() {
  if (!supabase) throw new Error("Supabase environment variables are not configured.");
  return supabase;
}

export async function fetchNotifications(options: {
  limit?: number;
  unreadOnly?: boolean;
  cursor?: NotificationCursor | null;
} = {}) {
  const { data, error } = await client().rpc("list_my_in_app_notifications", {
    p_limit: options.limit ?? 20,
    p_unread_only: options.unreadOnly ?? false,
    p_before_created_at: options.cursor?.createdAt ?? null,
    p_before_id: options.cursor?.id ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as InAppNotification[];
}

export async function fetchUnreadCount() {
  const { data, error } = await client().rpc("my_in_app_notification_unread_count");
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export async function markNotificationRead(receiptId: string) {
  const { error } = await client().rpc("mark_in_app_notification_read", {
    p_receipt_id: receiptId,
  });
  if (error) throw new Error(error.message);
}

export async function markAllNotificationsRead() {
  const { error } = await client().rpc("mark_all_in_app_notifications_read");
  if (error) throw new Error(error.message);
}

export function subscribeToNotifications(profileId: string, onChange: () => void) {
  const subscriptionId = globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const channel = client()
    .channel(`in-app-notifications:${profileId}:${subscriptionId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "in_app_notification_receipts",
        filter: `recipient_user_profile_id=eq.${profileId}`,
      },
      onChange,
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") onChange();
    });

  return () => {
    void client().removeChannel(channel);
  };
}
