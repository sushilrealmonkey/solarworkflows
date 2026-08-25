export const DEMO_BOOKING_STATUSES = [
  "scheduled",
  "contacted",
  "completed",
  "rescheduled",
  "cancelled",
  "no_show",
] as const;

export type DemoBookingStatus = (typeof DEMO_BOOKING_STATUSES)[number];

export type DemoBooking = {
  id: string;
  company_id: string | null;
  name: string | null;
  company: string | null;
  mobile: string | null;
  current_workflow: string | null;
  primary_priority: string | null;
  current_software: string | null;
  purchase_timeline: string | null;
  scheduled_for: string | null;
  demo_slot_label: string | null;
  event_id: string | null;
  source_url: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
  whatsapp_opt_in_at: string | null;
  whatsapp_opt_in_source: string | null;
  whatsapp_opt_in_text_version: string | null;
  meeting_timezone: string | null;
  meeting_url: string | null;
};
