import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../app/AuthProvider";
import { useToast } from "../../components/ui/ToastProvider";
import {
  requestCurrentUserPhoneVerification,
  resendCurrentUserPhoneVerification,
  verifyCurrentUserPhone,
} from "../../services/authAccess";
import {
  fetchNotificationSettings,
  saveNotificationSettings,
} from "./notificationApi";
import type {
  NotificationPreferenceKey,
  NotificationSettings,
} from "./notificationTypes";

const dailySummaryKey: NotificationPreferenceKey = "requested_daily_summary";

export function NotificationPreferencesSection({ readOnly = false }: { readOnly?: boolean }) {
  const { organization, refresh } = useAuth();
  const { showToast } = useToast();
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [dailyTime, setDailyTime] = useState("09:00");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [requestingCode, setRequestingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [resendingCode, setResendingCode] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const next = await fetchNotificationSettings();
      setSettings(next);
      setPhone((current) => current || next.profile_phone || "");
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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function requestVerificationCode() {
    try {
      setRequestingCode(true);
      setError(null);
      const normalizedPhone = await requestCurrentUserPhoneVerification(phone);
      setPendingPhone(normalizedPhone);
      setPhone(normalizedPhone);
      setVerificationCode("");
      showToast("Verification code sent to your mobile number.", "success");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to send the verification code.");
    } finally {
      setRequestingCode(false);
    }
  }

  async function verifyPhone() {
    if (!pendingPhone) return;

    try {
      setVerifyingCode(true);
      setError(null);
      await verifyCurrentUserPhone(pendingPhone, verificationCode);
      await refresh();
      setPendingPhone(null);
      setVerificationCode("");
      await load();
      showToast("Phone number verified for WhatsApp notifications.", "success");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to verify the phone number.");
    } finally {
      setVerifyingCode(false);
    }
  }

  async function resendVerificationCode() {
    if (!pendingPhone) return;

    try {
      setResendingCode(true);
      setError(null);
      await resendCurrentUserPhoneVerification(pendingPhone);
      showToast("A new verification code was sent.", "success");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to resend the verification code.");
    } finally {
      setResendingCode(false);
    }
  }

  async function save() {
    try {
      setSaving(true);
      setError(null);
      const next = await saveNotificationSettings([{
        notification_type: dailySummaryKey,
        is_enabled: Boolean(enabled[dailySummaryKey]),
        delivery_time: dailyTime,
        timezone: organization.timezone || "Asia/Kolkata",
      }]);
      setSettings(next);
      showToast("Daily summary schedule saved.", "success");
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
          <h2 className="text-base font-semibold text-slate-950">WhatsApp daily summary</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
            Schedule a daily AI summary of workspace items requiring attention.
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
              ? "Verify the phone number on your Bizlee account before enabling the daily WhatsApp summary."
              : "Add and verify a phone number on your Bizlee account first."}
          </p>
          {readOnly ? null : !pendingPhone ? (
            <div className="mt-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="block w-full text-sm font-medium text-amber-950 sm:max-w-sm">
                  Mobile number
                  <input
                    autoComplete="tel"
                    className="mt-1 h-11 w-full rounded-lg border border-amber-300 bg-white px-3 text-slate-900 outline-none placeholder:text-slate-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                    disabled={requestingCode}
                    inputMode="tel"
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="+91 98765 43210"
                    type="tel"
                    value={phone}
                  />
                </label>
                <button
                  className="inline-flex h-11 w-full shrink-0 items-center justify-center rounded-lg bg-orange-600 px-5 text-sm font-semibold text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                  disabled={requestingCode || !phone.trim()}
                  onClick={() => void requestVerificationCode()}
                  type="button"
                >
                  {requestingCode ? "Sending…" : "Send verification code"}
                </button>
              </div>
              <p className="mt-1.5 text-xs leading-5 text-amber-800">
                Include the country code. We will send a one-time verification code.
              </p>
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-amber-200 bg-white p-3 sm:p-4">
              <p className="text-sm font-medium text-slate-900">
                Enter the code sent to {pendingPhone}
              </p>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="block min-w-0 flex-1 text-sm font-medium text-slate-700">
                  6-digit verification code
                  <input
                    autoComplete="one-time-code"
                    className="mt-1 h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-slate-900 outline-none placeholder:text-slate-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                    disabled={verifyingCode}
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="123456"
                    type="text"
                    value={verificationCode}
                  />
                </label>
                <button
                  className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg bg-orange-600 px-5 text-sm font-semibold text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={verifyingCode || verificationCode.length !== 6}
                  onClick={() => void verifyPhone()}
                  type="button"
                >
                  {verifyingCode ? "Verifying…" : "Verify number"}
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <button
                  className="text-sm font-semibold text-orange-700 hover:text-orange-800 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={resendingCode || verifyingCode}
                  onClick={() => void resendVerificationCode()}
                  type="button"
                >
                  {resendingCode ? "Resending…" : "Resend code"}
                </button>
                <button
                  className="text-sm font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-60"
                  disabled={verifyingCode}
                  onClick={() => {
                    setPendingPhone(null);
                    setVerificationCode("");
                  }}
                  type="button"
                >
                  Use a different number
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {!loading && settings?.recipient ? (
        <>
          <div className="mt-5 border-t border-stone-100 pt-4">
            <div className="flex min-h-16 items-center justify-between gap-4">
              <span>
                <span className="block text-sm font-semibold text-slate-900">
                  Daily AI workspace summary
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-slate-500">
                  Receive a WhatsApp summary of workspace items requiring attention.
                </span>
              </span>
              <input
                aria-label="Enable daily AI workspace summary"
                checked={Boolean(enabled[dailySummaryKey])}
                className="h-5 w-5 shrink-0 accent-orange-600"
                disabled={readOnly}
                onChange={(event) => setEnabled({
                  ...enabled,
                  [dailySummaryKey]: event.target.checked,
                })}
                type="checkbox"
              />
            </div>
            <label className="mt-3 block max-w-xs text-sm font-medium text-slate-700">
              Delivery time
              <input
                className="mt-1 h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-slate-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
                disabled={readOnly || !enabled[dailySummaryKey]}
                onChange={(event) => setDailyTime(event.target.value)}
                type="time"
                value={dailyTime}
              />
            </label>
            <p className="mt-1.5 text-xs leading-5 text-slate-500">
              The summary will use your workspace timezone ({organization.timezone || "Asia/Kolkata"}).
            </p>
          </div>

          {!readOnly ? <div className="mt-5 flex justify-end border-t border-stone-100 pt-4">
            <button
              className="inline-flex h-11 items-center justify-center rounded-lg bg-[#06173f] px-5 text-sm font-semibold text-white transition hover:bg-[#10275b] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={saving}
              onClick={() => void save()}
              type="button"
            >
              {saving ? "Saving…" : "Save daily summary"}
            </button>
          </div> : null}
        </>
      ) : null}
    </section>
  );
}
