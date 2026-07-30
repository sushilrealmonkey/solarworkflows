import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "../../app/AuthProvider";
import { useToast } from "../../components/ui/ToastProvider";
import { formatDateTime, labelize } from "../crm/crmUtils";
import {
  fetchNotificationSettings,
  saveNotificationSettings,
} from "./notificationApi";
import type {
  NotificationPreferenceKey,
  NotificationSettings,
} from "./notificationTypes";

const definitions: Array<{
  key: NotificationPreferenceKey;
  title: string;
  description: string;
  group: "account" | "summary" | "marketing";
}> = [
  {
    key: "trial_ending",
    title: "Trial ending",
    description: "Reminders before the Bizlee trial ends.",
    group: "account",
  },
  {
    key: "trial_expired",
    title: "Trial expired",
    description: "An update when trial access changes.",
    group: "account",
  },
  {
    key: "subscription_action_required",
    title: "Billing action required",
    description: "Payment failures and subscription issues.",
    group: "account",
  },
  {
    key: "new_signin_alert",
    title: "New sign-in alerts",
    description: "Important activity detected on your account.",
    group: "account",
  },
  {
    key: "account_change_notice",
    title: "Account change notices",
    description: "Updates to account access details.",
    group: "account",
  },
  {
    key: "requested_daily_summary",
    title: "Daily AI workspace summary",
    description: "A short aggregate summary of items requiring attention.",
    group: "summary",
  },
  {
    key: "product_tip",
    title: "Product tips",
    description: "Occasional guidance about useful Bizlee features.",
    group: "marketing",
  },
  {
    key: "plan_offer",
    title: "Plan offers",
    description: "Eligible subscription offers and promotions.",
    group: "marketing",
  },
  {
    key: "product_announcement",
    title: "Product announcements",
    description: "Updates about new Bizlee capabilities.",
    group: "marketing",
  },
];

export function NotificationPreferencesSection() {
  const { organization } = useAuth();
  const { showToast } = useToast();
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [dailyTime, setDailyTime] = useState("09:00");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const next = await fetchNotificationSettings();
      setSettings(next);
      setEnabled(Object.fromEntries(
        next.preferences.map((item) => [
          item.notification_type,
          item.is_enabled,
        ]),
      ));
      const daily = next.preferences.find(
        (item) => item.notification_type === "requested_daily_summary",
      );
      if (daily?.delivery_time) setDailyTime(daily.delivery_time.slice(0, 5));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to load notifications.");
    } finally {
      setLoading(false);
    }
  }

  const grouped = useMemo(() => ({
    account: definitions.filter((item) => item.group === "account"),
    summary: definitions.filter((item) => item.group === "summary"),
    marketing: definitions.filter((item) => item.group === "marketing"),
  }), []);

  async function save() {
    try {
      setSaving(true);
      setError(null);
      const next = await saveNotificationSettings(definitions.map((item) => ({
        notification_type: item.key,
        is_enabled: Boolean(enabled[item.key]),
        delivery_time: item.key === "requested_daily_summary"
          ? dailyTime
          : null,
        timezone: organization.timezone || "Asia/Kolkata",
      })));
      setSettings(next);
      showToast("WhatsApp notification preferences saved.", "success");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to save notifications.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950">
            WhatsApp notifications
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
            Choose which Bizlee updates are sent to your verified WhatsApp number.
          </p>
        </div>
        {settings?.recipient ? (
          <span className="w-fit rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            {settings.recipient.phone_e164} verified
          </span>
        ) : null}
      </div>

      {loading ? <p className="mt-5 text-sm text-slate-500">Loading preferences…</p> : null}
      {error ? (
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      {!loading && settings && !settings.recipient ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">
            A verified phone number is required
          </p>
          <p className="mt-1 text-sm leading-6 text-amber-800">
            {settings.profile_phone
              ? "Verify the phone number on your Bizlee account before enabling WhatsApp notifications."
              : "Add and verify a phone number on your Bizlee account first."}
          </p>
        </div>
      ) : null}

      {!loading && settings?.recipient ? (
        <>
          <PreferenceGroup title="Account and billing" items={grouped.account} enabled={enabled} setEnabled={setEnabled} />
          <PreferenceGroup title="Daily summary" items={grouped.summary} enabled={enabled} setEnabled={setEnabled}>
            <label className="mt-3 block max-w-xs text-sm font-medium text-slate-700">
              Delivery time
              <input
                className="mt-1 h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                onChange={(event) => setDailyTime(event.target.value)}
                type="time"
                value={dailyTime}
              />
            </label>
          </PreferenceGroup>
          <PreferenceGroup title="Offers and product updates" items={grouped.marketing} enabled={enabled} setEnabled={setEnabled} />

          <div className="mt-5 flex flex-col-reverse gap-3 border-t border-stone-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-slate-500">
              Turning a message off records an immediate opt-out. Carrier and Meta charges may apply to Bizlee.
            </p>
            <button
              className="inline-flex h-11 items-center justify-center rounded-lg bg-[#06173f] px-5 text-sm font-semibold text-white transition hover:bg-[#10275b] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={saving}
              onClick={() => void save()}
              type="button"
            >
              {saving ? "Saving…" : "Save preferences"}
            </button>
          </div>

          {settings.recent_deliveries.length ? (
            <div className="mt-6 border-t border-stone-100 pt-4">
              <h3 className="text-sm font-semibold text-slate-900">Recent delivery activity</h3>
              <div className="mt-3 grid gap-2">
                {settings.recent_deliveries.slice(0, 5).map((delivery) => (
                  <div className="flex items-center justify-between gap-3 rounded-lg bg-stone-50 px-3 py-2.5 text-sm" key={delivery.id}>
                    <span className="min-w-0 truncate text-slate-700">
                      {labelize(delivery.notification_events?.event_type)}
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-slate-500">
                      {labelize(delivery.status)} · {formatDateTime(delivery.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function PreferenceGroup({
  title,
  items,
  enabled,
  setEnabled,
  children,
}: {
  title: string;
  items: typeof definitions;
  enabled: Record<string, boolean>;
  setEnabled: (value: Record<string, boolean>) => void;
  children?: ReactNode;
}) {
  return (
    <div className="mt-5 border-t border-stone-100 pt-4 first:border-t-0">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <div className="mt-2 divide-y divide-stone-100">
        {items.map((item) => (
          <label className="flex min-h-16 cursor-pointer items-center justify-between gap-4 py-3" key={item.key}>
            <span>
              <span className="block text-sm font-medium text-slate-900">{item.title}</span>
              <span className="mt-0.5 block text-xs leading-5 text-slate-500">{item.description}</span>
            </span>
            <input
              checked={Boolean(enabled[item.key])}
              className="h-5 w-5 shrink-0 accent-orange-600"
              onChange={(event) => setEnabled({ ...enabled, [item.key]: event.target.checked })}
              type="checkbox"
            />
          </label>
        ))}
      </div>
      {children}
    </div>
  );
}
