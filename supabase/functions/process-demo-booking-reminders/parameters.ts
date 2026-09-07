type ReminderDetails = {
  customer_name: string;
  booking_scheduled_for: string;
  meeting_timezone: string;
};

// Both approved reminder templates have exactly two positional body variables:
// customer name and demo time. The meeting link is static template content.
export function buildDemoReminderParameters(reminder: ReminderDetails): string[] {
  const date = new Date(reminder.booking_scheduled_for);
  if (Number.isNaN(date.getTime())) throw new Error("Booking time is invalid");
  let formatted: string;
  try {
    formatted = new Intl.DateTimeFormat("en-IN", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: reminder.meeting_timezone,
    }).format(date);
  } catch {
    throw new Error("Booking timezone is invalid");
  }
  return [reminder.customer_name.trim().split(/\s+/)[0] || "there", formatted];
}
