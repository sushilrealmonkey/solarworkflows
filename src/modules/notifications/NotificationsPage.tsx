import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader";
import { PageLoader } from "../../components/PageLoader";
import { useAuth } from "../../app/AuthProvider";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeToNotifications,
} from "./notificationApi";
import { formatRelativeTime } from "./notificationUtils";
import type { InAppNotification } from "./types";

export function NotificationsPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<InAppNotification[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchNotifications({ limit: 20, unreadOnly });
      setItems(next);
      setHasMore(next.length === 20);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to load notifications.");
    } finally {
      setLoading(false);
    }
  }, [unreadOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!profile?.id) return undefined;

    try {
      return subscribeToNotifications(profile.id, () => void load());
    } catch (subscriptionError) {
      setError(
        subscriptionError instanceof Error
          ? subscriptionError.message
          : "Live notification updates are unavailable.",
      );
      return undefined;
    }
  }, [load, profile?.id]);

  async function loadMore() {
    const last = items.at(-1);
    if (!last) return;
    setLoadingMore(true);
    try {
      const next = await fetchNotifications({
        limit: 20,
        unreadOnly,
        cursor: { createdAt: last.created_at, id: last.receipt_id },
      });
      setItems((current) => [...current, ...next]);
      setHasMore(next.length === 20);
    } finally {
      setLoadingMore(false);
    }
  }

  async function openItem(item: InAppNotification) {
    if (!item.read_at) await markNotificationRead(item.receipt_id);
    navigate(item.destination_route || `/${item.module || "dashboard"}`);
  }

  async function markAll() {
    await markAllNotificationsRead();
    await load();
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Notifications" description="Workflow activity and status updates from across your workspace." />
      <section className="overflow-hidden rounded-xl border border-orange-100 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 p-4">
          <div className="flex rounded-lg bg-stone-100 p-1" role="tablist" aria-label="Notification filters">
            {([false, true] as const).map((value) => (
              <button className={`rounded-md px-4 py-2 text-sm font-semibold ${unreadOnly === value ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`} key={String(value)} onClick={() => setUnreadOnly(value)} role="tab" aria-selected={unreadOnly === value} type="button">
                {value ? "Unread" : "All"}
              </button>
            ))}
          </div>
          <button className="text-sm font-semibold text-orange-700" onClick={() => void markAll()} type="button">Mark all as read</button>
        </div>
        {loading ? <div className="p-4"><PageLoader label="Loading notifications…" /></div> : null}
        {error ? <p className="m-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700" role="alert">{error}</p> : null}
        {!loading && !error && !items.length ? <p className="p-12 text-center text-sm text-slate-500">No {unreadOnly ? "unread " : ""}notifications.</p> : null}
        {!loading ? items.map((item) => (
          <button className={`flex w-full gap-3 border-b border-stone-100 p-4 text-left transition hover:bg-orange-50 sm:px-6 ${item.read_at ? "bg-white" : "bg-orange-50/50"}`} key={item.receipt_id} onClick={() => void openItem(item)} type="button">
            <span className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${item.read_at ? "bg-stone-200" : "bg-orange-500"}`} />
            <span className="min-w-0 flex-1">
              <span className="flex flex-col justify-between gap-1 sm:flex-row">
                <span className="font-semibold text-slate-950">{item.title}</span>
                <span className="shrink-0 text-xs text-slate-400">{formatRelativeTime(item.created_at)}</span>
              </span>
              <span className="mt-1 block text-sm leading-6 text-slate-600">{item.message}</span>
              {item.old_value && item.new_value ? <span className="mt-2 inline-block rounded-full bg-stone-100 px-2.5 py-1 text-xs text-slate-600">{item.old_value.replace(/_/g, " ")} → {item.new_value.replace(/_/g, " ")}</span> : null}
            </span>
          </button>
        )) : null}
        {hasMore ? <div className="p-4 text-center"><button className="rounded-lg border border-orange-200 px-4 py-2 text-sm font-semibold text-orange-700 disabled:opacity-50" disabled={loadingMore} onClick={() => void loadMore()} type="button">{loadingMore ? "Loading…" : "Load more"}</button></div> : null}
      </section>
    </div>
  );
}
