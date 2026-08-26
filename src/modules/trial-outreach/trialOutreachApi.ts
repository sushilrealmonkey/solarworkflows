import { supabase } from "../../services/supabaseClient";
import type {
  TrialOutreachCompanyDetail,
  TrialOutreachDashboard,
  TrialOutreachStaff,
  TrialOutreachTouchpoint,
  TrialEngagementSnapshot,
} from "./types";

type ApiError = { error?: string };

async function apiRequest<T>(path: string, init: RequestInit = {}) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Your session has expired. Sign in again.");

  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => null) as T | ApiError | null;
  if (!response.ok) {
    throw new Error(payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : "Trial outreach request failed.");
  }
  return payload as T;
}

export async function fetchTrialOutreachQueue(filters: {
  search?: string;
  state?: string;
  status?: string;
  day?: number;
  due?: boolean;
} = {}) {
  const query = new URLSearchParams();
  if (filters.search) query.set("search", filters.search);
  if (filters.state) query.set("state", filters.state);
  if (filters.status) query.set("status", filters.status);
  if (filters.day) query.set("day", String(filters.day));
  if (filters.due) query.set("due", "true");
  const result = await apiRequest<{ companies: TrialEngagementSnapshot[]; staff: TrialOutreachStaff[] }>(
    `/api/trial-outreach/queue${query.toString() ? `?${query}` : ""}`,
  );
  return result;
}

export async function fetchTrialOutreachDashboard() {
  const result = await apiRequest<TrialOutreachDashboard | null>("/api/trial-outreach/dashboard");
  return result;
}

export async function fetchTrialOutreachCompany(companyId: string) {
  return apiRequest<TrialOutreachCompanyDetail>(`/api/trial-outreach/companies/${encodeURIComponent(companyId)}`);
}

export async function fetchTrialOutreachStaff() {
  const result = await apiRequest<TrialOutreachStaff[]>("/api/trial-outreach/staff");
  return result;
}

export async function claimTrialOutreachCall(touchpointId: string) {
  return apiRequest<TrialOutreachTouchpoint>(`/api/trial-outreach/touchpoints/${touchpointId}/claim`, {
    method: "POST",
    body: "{}",
  });
}

export async function recordTrialOutreachOutcome(
  touchpointId: string,
  input: { outcome: string; blocker?: string; notes?: string },
) {
  return apiRequest<{ ok: boolean }>(`/api/trial-outreach/touchpoints/${touchpointId}/outcome`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function rescheduleTrialOutreachTouchpoint(touchpointId: string, scheduledAt: string) {
  return apiRequest<TrialOutreachTouchpoint>(`/api/trial-outreach/touchpoints/${touchpointId}/reschedule`, {
    method: "POST",
    body: JSON.stringify({ scheduled_at: scheduledAt }),
  });
}

export async function updateTrialOutreachEnrollment(
  enrollmentId: string,
  action: "pause" | "resume" | "stop" | "complete",
) {
  return apiRequest<{ ok: boolean }>(`/api/trial-outreach/enrollments/${enrollmentId}/action`, {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}

export async function recordTrialOutreachBlocker(
  enrollmentId: string,
  input: { blocker: string; notes?: string },
) {
  return apiRequest<{ ok: boolean }>(`/api/trial-outreach/enrollments/${enrollmentId}/blocker`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
