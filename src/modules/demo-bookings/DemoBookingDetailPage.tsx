import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ui/ToastProvider";
import { formatDisplayDateTime } from "../../utils/dateFormat";
import {
  AccessDenied,
  Badge,
  Button,
  DetailItem,
  DetailSection,
  EmptyState,
  LoadingSkeleton,
} from "../crm/CrmComponents";
import {
  fetchDemoBooking,
  updateDemoBookingStatus,
} from "./demoBookingsApi";
import {
  DEMO_BOOKING_STATUSES,
  type DemoBooking,
  type DemoBookingStatus,
} from "./types";

export function DemoBookingDetailPage() {
  const { profile } = useAuth();
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [booking, setBooking] = useState<DemoBooking | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<DemoBookingStatus>("scheduled");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBooking = useCallback(async () => {
    if (!id) {
      setError("Demo booking id is missing.");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const nextBooking = await fetchDemoBooking(id);
      setBooking(nextBooking);
      if (nextBooking && isDemoBookingStatus(nextBooking.status)) {
        setSelectedStatus(nextBooking.status);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to load demo booking.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (profile?.is_super_admin) void loadBooking();
  }, [loadBooking, profile?.is_super_admin]);

  async function saveStatus() {
    if (!booking) return;

    try {
      setSaving(true);
      setError(null);
      const updated = await updateDemoBookingStatus(booking.id, selectedStatus);
      setBooking((current) => current ? { ...current, status: updated.status, updated_at: updated.updated_at } : current);
      showToast("Demo booking status updated.", "success");
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Unable to update demo booking status.";
      setError(message);
      showToast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  if (!profile?.is_super_admin) {
    return <AccessDenied title="Demo bookings are not available" description="Only Super Admins can review and update demo booking submissions." />;
  }

  if (loading) {
    return <div className="space-y-6"><PageHeader title="Demo Booking" description="Loading booking details." /><LoadingSkeleton /></div>;
  }

  if (!booking) {
    return <EmptyState title="Demo booking not found" description={error ?? "The selected demo booking could not be loaded."} action={<Button onClick={() => navigate("/demo-bookings")}>Back to Demo Bookings</Button>} />;
  }

  return (
    <div className="space-y-6">
      <Button onClick={() => navigate("/demo-bookings")} variant="secondary">Back to Demo Bookings</Button>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <PageHeader title={displayValue(booking.name)} description={displayValue(booking.company)} />
        <StatusBadge status={booking.status} />
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div> : null}

      <section className="rounded-xl border border-orange-200 bg-orange-50 p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <label className="block max-w-sm flex-1">
            <span className="text-sm font-semibold text-slate-800">Update status</span>
            <select
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-base outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
              disabled={saving}
              onChange={(event) => setSelectedStatus(event.target.value as DemoBookingStatus)}
              value={selectedStatus}
            >
              {DEMO_BOOKING_STATUSES.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
            </select>
          </label>
          <Button disabled={saving || selectedStatus === booking.status} onClick={() => void saveStatus()}>
            {saving ? "Saving..." : "Save Status"}
          </Button>
        </div>
        <p className="mt-3 text-xs text-slate-600">Use No Show when the lead does not attend the scheduled meeting.</p>
      </section>

      <DetailSection title="Contact details">
        <DetailItem label="Name" value={booking.name} />
        <DetailItem label="Company" value={booking.company} />
        <DetailItem label="Mobile" value={booking.mobile} />
        <DetailItem label="Company ID" value={booking.company_id} />
      </DetailSection>

      <DetailSection title="Demo schedule">
        <DetailItem label="Demo slot" value={booking.demo_slot_label} />
        <DetailItem label="Scheduled for" value={formatDisplayDateTime(booking.scheduled_for)} />
        <DetailItem label="Meeting timezone" value={booking.meeting_timezone} />
        <DetailItem label="Event ID" value={booking.event_id} />
        <DetailItem label="Meeting URL" value={booking.meeting_url} />
      </DetailSection>

      <DetailSection title="Qualification details">
        <DetailItem label="Current workflow" value={booking.current_workflow} />
        <DetailItem label="Primary priority" value={booking.primary_priority} />
        <DetailItem label="Current software" value={booking.current_software} />
        <DetailItem label="Purchase timeline" value={booking.purchase_timeline} />
      </DetailSection>

      <DetailSection title="Submission details">
        <DetailItem label="Status" value={statusLabel(booking.status)} />
        <DetailItem label="Submitted" value={formatDisplayDateTime(booking.created_at)} />
        <DetailItem label="Last updated" value={formatDisplayDateTime(booking.updated_at)} />
        <DetailItem label="Source URL" value={booking.source_url} />
        <DetailItem label="WhatsApp opt-in" value={formatDisplayDateTime(booking.whatsapp_opt_in_at)} />
        <DetailItem label="Opt-in source" value={booking.whatsapp_opt_in_source} />
      </DetailSection>
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const normalized = status?.trim().toLowerCase() ?? "unknown";
  const tone = normalized === "scheduled" || normalized === "contacted" || normalized === "completed"
    ? "green"
    : normalized === "cancelled" || normalized === "no_show"
      ? "red"
      : normalized === "unknown" ? "neutral" : "amber";
  return <Badge tone={tone}>{statusLabel(status)}</Badge>;
}

function isDemoBookingStatus(value: string | null): value is DemoBookingStatus {
  return DEMO_BOOKING_STATUSES.includes(value as DemoBookingStatus);
}

function statusLabel(status: string | null | undefined) {
  if (status === "no_show") return "No Show";
  if (!status) return "Unknown";
  return status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayValue(value: string | null | undefined) {
  return value?.trim() || "-";
}
