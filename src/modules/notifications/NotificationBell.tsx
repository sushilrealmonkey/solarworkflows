import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeToNotifications,
} from "./notificationApi";
import type { InAppNotification } from "./types";
import { formatRelativeTime } from "./notificationUtils";

export function NotificationBell({ profileId }: { profileId: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InAppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [nextItems, nextUnread] = await Promise.all([
        fetchNotifications({ limit: 6 }),
        fetchUnreadCount(),
      ]);
      setItems(nextItems);
      setUnread(nextUnread);
    } catch {
      // The shell stays usable if notification loading is unavailable.
    }
  }, []);

  useEffect(() => {
    void refresh();
    return subscribeToNotifications(profileId, refresh);
  }, [profileId, refresh]);

  async function openNotification(item: InAppNotification) {
    if (!item.read_at) {
      await markNotificationRead(item.receipt_id);
    }
    setOpen(false);
    navigate(item.destination_route || `/${item.module || "dashboard"}`);
    void refresh();
  }

  async function markAll() {
    setLoading(true);
    try {
      await markAllNotificationsRead();
      await refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative">
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-orange-200 bg-white text-orange-700 shadow-sm transition hover:bg-orange-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <BellIcon />
        {unread > 0 ? (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-rose-600 px-1.5 py-0.5 text-center text-[10px] font-bold leading-4 text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          aria-label="Recent notifications"
          className="fixed inset-x-3 top-16 z-50 max-h-[min(36rem,75vh)] overflow-hidden rounded-xl border border-orange-100 bg-white shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-96"
          role="dialog"
        >
          <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
            <div>
              <p className="font-semibold text-slate-950">Notifications</p>
              <p className="text-xs text-slate-500">{unread} unread</p>
            </div>
            <button className="text-xs font-semibold text-orange-700 disabled:opacity-50" disabled={!unread || loading} onClick={() => void markAll()} type="button">
              Mark all read
            </button>
          </div>
          <div className="max-h-[55vh] overflow-y-auto">
            {items.length ? items.map((item) => (
              <button
                className={`block w-full border-b border-stone-100 px-4 py-3 text-left transition hover:bg-orange-50 ${item.read_at ? "bg-white" : "bg-orange-50/60"}`}
                key={item.receipt_id}
                onClick={() => void openNotification(item)}
                type="button"
              >
                <span className="flex gap-2">
                  {!item.read_at ? <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-orange-500" /> : <span className="w-2" />}
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-900">{item.title}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-slate-600">{item.message}</span>
                    <span className="mt-1 block text-[11px] text-slate-400">{formatRelativeTime(item.created_at)}</span>
                  </span>
                </span>
              </button>
            )) : (
              <p className="px-4 py-10 text-center text-sm text-slate-500">You’re all caught up.</p>
            )}
          </div>
          <Link className="block px-4 py-3 text-center text-sm font-semibold text-orange-700 hover:bg-orange-50" onClick={() => setOpen(false)} to="/notifications">
            View all notifications
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function BellIcon() {
  return <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 8h18c0-1-3-1-3-8ZM10 21h4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>;
}
