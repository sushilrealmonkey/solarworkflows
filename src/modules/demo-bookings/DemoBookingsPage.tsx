import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { PageLoader } from "../../components/PageLoader";
import { TablePagination, useTablePagination } from "../../components/TablePagination";
import { formatDisplayDateTime } from "../../utils/dateFormat";
import { AccessDenied, Badge } from "../crm/CrmComponents";
import { fetchDemoBookings } from "./demoBookingsApi";
import { DEMO_BOOKING_STATUSES, type DemoBooking } from "./types";

type FilterValue = "all" | string;

export function DemoBookingsPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [bookings, setBookings] = useState<DemoBooking[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<FilterValue>("all");
  const [workflow, setWorkflow] = useState<FilterValue>("all");
  const [timeline, setTimeline] = useState<FilterValue>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile?.is_super_admin) {
      setLoading(false);
      return;
    }

    let active = true;
    void fetchDemoBookings()
      .then((nextBookings) => {
        if (active) setBookings(nextBookings);
      })
      .catch((nextError: unknown) => {
        if (active) {
          setError(nextError instanceof Error ? nextError.message : "Unable to load demo bookings.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [profile?.is_super_admin]);

  const options = useMemo(
    () => ({
      statuses: unique([...DEMO_BOOKING_STATUSES, ...bookings.map((booking) => booking.status)]),
      workflows: unique(bookings.map((booking) => booking.current_workflow)),
      timelines: unique(bookings.map((booking) => booking.purchase_timeline)),
    }),
    [bookings],
  );

  const filteredBookings = useMemo(() => {
    const query = search.trim().toLowerCase();

    return bookings.filter((booking) => {
      const searchable = [
        booking.name,
        booking.company,
        booking.mobile,
        booking.current_workflow,
        booking.primary_priority,
        booking.current_software,
        booking.purchase_timeline,
        booking.demo_slot_label,
        booking.event_id,
        booking.source_url,
        booking.status,
      ];
      const matchesSearch = !query || searchable.some((value) => value?.toLowerCase().includes(query));

      return (
        matchesSearch && matches(booking.status, status) &&
        matches(booking.current_workflow, workflow) &&
        matches(booking.purchase_timeline, timeline)
      );
    });
  }, [bookings, search, status, timeline, workflow]);

  const pagination = useTablePagination(filteredBookings);

  if (!profile?.is_super_admin) {
    return <AccessDenied title="Demo bookings are not available" description="Only Super Admins can review demo booking submissions." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Demo Bookings" description="Review demo requests submitted through the Bizlee booking flow." />

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Total bookings" value={bookings.length} />
        <Metric label="Visible results" value={filteredBookings.length} />
        <Metric label="Scheduled" value={bookings.filter((booking) => booking.status === "scheduled").length} />
      </div>

      <section className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
        <div className="border-b border-stone-200 p-4 sm:p-5">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_12rem_15rem_15rem]">
            <input
              aria-label="Search demo bookings"
              className="w-full rounded-lg border border-stone-300 px-3 py-2.5 text-base outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, company, mobile, software..."
              type="search"
              value={search}
            />
            <FilterSelect ariaLabel="Filter by status" label="Status" onChange={setStatus} options={options.statuses} value={status} />
            <FilterSelect ariaLabel="Filter by workflow" label="Current workflow" onChange={setWorkflow} options={options.workflows} value={workflow} />
            <FilterSelect ariaLabel="Filter by purchase timeline" label="Purchase timeline" onChange={setTimeline} options={options.timelines} value={timeline} />
          </div>
          <p className="mt-3 text-sm text-slate-500">{filteredBookings.length} booking{filteredBookings.length === 1 ? "" : "s"} match the current search and filters.</p>
        </div>

        {loading ? <PageLoader label="Loading demo bookings..." /> : null}
        {!loading && error ? <div className="p-5 text-sm text-rose-700">Could not load demo bookings: {error}</div> : null}
        {!loading && !error && filteredBookings.length === 0 ? <div className="p-5 text-sm text-slate-500">No demo bookings match the current search and filters.</div> : null}

        {!loading && !error && filteredBookings.length > 0 ? (
          <>
            <div className="md:hidden divide-y divide-stone-200">
              {pagination.pageItems.map((booking) => <MobileBookingCard booking={booking} key={booking.id} onClick={() => navigate(`/demo-bookings/${booking.id}`)} />)}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-[980px] w-full text-left text-sm">
                <thead className="border-b border-stone-200 bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Contact</th>
                    <th className="px-5 py-3">Mobile</th>
                    <th className="px-5 py-3">Demo slot</th>
                    <th className="px-5 py-3">Purchase timeline</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Submitted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200">
                  {pagination.pageItems.map((booking) => <DesktopBookingRow booking={booking} key={booking.id} onClick={() => navigate(`/demo-bookings/${booking.id}`)} />)}
                </tbody>
              </table>
            </div>
            <div className="border-t border-stone-200 p-4"><TablePagination label="demo bookings" pagination={pagination} /></div>
          </>
        ) : null}
      </section>
    </div>
  );
}

function DesktopBookingRow({ booking, onClick }: { booking: DemoBooking; onClick: () => void }) {
  return (
    <tr
      aria-label={`Open demo booking for ${value(booking.name)}`}
      className="cursor-pointer align-top text-slate-700 transition-colors hover:bg-orange-50 focus:bg-orange-50 focus:outline-none"
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      role="link"
      tabIndex={0}
    >
      <td className="px-5 py-4"><p className="font-semibold text-slate-950">{value(booking.name)}</p><p className="mt-1 text-xs text-slate-500">{value(booking.company)}</p></td>
      <td className="whitespace-nowrap px-5 py-4">{value(booking.mobile)}</td>
      <td className="px-5 py-4"><p>{value(booking.demo_slot_label)}</p><p className="mt-1 text-xs text-slate-500">{formatDisplayDateTime(booking.scheduled_for)}</p></td>
      <td className="max-w-56 px-5 py-4">{value(booking.purchase_timeline)}</td>
      <td className="px-5 py-4"><StatusBadge status={booking.status} /></td>
      <td className="whitespace-nowrap px-5 py-4 text-xs text-slate-600">{formatDisplayDateTime(booking.created_at)}</td>
    </tr>
  );
}

function MobileBookingCard({ booking, onClick }: { booking: DemoBooking; onClick: () => void }) {
  return (
    <button className="block w-full space-y-4 p-4 text-left transition-colors hover:bg-orange-50 focus:bg-orange-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-orange-400" onClick={onClick} type="button">
      <div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-slate-950">{value(booking.name)}</h2><p className="mt-1 text-sm text-slate-600">{value(booking.company)}</p><p className="mt-1 text-sm text-slate-500">{value(booking.mobile)}</p></div><StatusBadge status={booking.status} /></div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <Detail label="Current workflow" value={booking.current_workflow} /><Detail label="Primary priority" value={booking.primary_priority} />
        <Detail label="Current software" value={booking.current_software} /><Detail label="Purchase timeline" value={booking.purchase_timeline} />
        <Detail label="Demo slot" value={booking.demo_slot_label} /><Detail label="Scheduled for" value={formatDisplayDateTime(booking.scheduled_for)} />
        <Detail label="Submitted" value={formatDisplayDateTime(booking.created_at)} /><Detail label="Source" value={booking.source_url} />
      </dl>
    </button>
  );
}

function Detail({ label, value: detailValue }: { label: string; value: string | null }) {
  return <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 break-words text-slate-800">{value(detailValue)}</dd></div>;
}

function FilterSelect({ ariaLabel, label, onChange, options, value: selectedValue }: { ariaLabel: string; label: string; onChange: (value: string) => void; options: string[]; value: string }) {
  return <select aria-label={ariaLabel} className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-base outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100" onChange={(event) => onChange(event.target.value)} value={selectedValue}><option value="all">All {label.toLowerCase()}</option>{options.map((option) => <option key={option} value={option}>{label === "Status" ? statusLabel(option) : option}</option>)}</select>;
}

function Metric({ label, value: metricValue }: { label: string; value: number }) {
  return <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold text-slate-950">{metricValue}</p></section>;
}

function StatusBadge({ status }: { status: string | null }) {
  const normalized = status?.trim().toLowerCase() ?? "unknown";
  const tone = normalized === "scheduled" || normalized === "contacted" || normalized === "completed" ? "green" : normalized === "cancelled" || normalized === "no_show" ? "red" : normalized === "unknown" ? "neutral" : "amber";
  return <Badge tone={tone}>{statusLabel(status)}</Badge>;
}

function unique(values: Array<string | null>) {
  return [...new Set(values.filter((item): item is string => Boolean(item?.trim())))].sort((a, b) => a.localeCompare(b));
}

function matches(item: string | null, selectedValue: FilterValue) {
  return selectedValue === "all" || item === selectedValue;
}

function value(item: string | null | undefined) {
  return item?.trim() || "-";
}

function statusLabel(status: string | null | undefined) {
  if (status === "no_show") return "No Show";
  if (!status) return "Unknown";
  return status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
