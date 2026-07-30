export type NotificationPreferenceKey =
  | "trial_ending"
  | "trial_expired"
  | "subscription_action_required"
  | "requested_daily_summary"
  | "new_signin_alert"
  | "account_change_notice"
  | "product_tip"
  | "plan_offer"
  | "product_announcement";

export type NotificationPreference = {
  notification_type: NotificationPreferenceKey;
  is_enabled: boolean;
  delivery_time: string | null;
  timezone: string | null;
  consent_status: string;
};

export type NotificationDelivery = {
  id: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failure_message: string | null;
  notification_events: { event_type: string } | null;
};

export type NotificationSettings = {
  recipient: {
    id: string;
    phone_e164: string;
    verification_status: string;
  } | null;
  profile_phone: string | null;
  profile_phone_verified: boolean;
  preferences: NotificationPreference[];
  recent_deliveries: NotificationDelivery[];
};
