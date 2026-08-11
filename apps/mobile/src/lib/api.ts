import type { ApiErrorBody, CursorPage, MobileActionKey, MobileModuleKey, MobileRecordSummary, MobileResource, SessionContext } from "@bizlee/contracts";
import { supabase } from "./supabase";
const root = process.env.EXPO_PUBLIC_API_URL;
if (!root) throw new Error("Configure EXPO_PUBLIC_API_URL");
export class ApiError extends Error { constructor(readonly status: number, readonly code: string, message: string, readonly requestId?: string) { super(message); } }
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession(); const token = data.session?.access_token;
  const response = await fetch(`${root}${path}`, { ...init, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers } });
  const body = await response.json() as T | ApiErrorBody;
  if (!response.ok) { const failure = body as ApiErrorBody; throw new ApiError(response.status, failure.error?.code ?? "UNKNOWN", failure.error?.message ?? "Request failed", failure.error?.requestId); }
  return body as T;
}
export const mobileApi = {
  session: () => api<SessionContext>("/session/context"),
  dashboard: () => api<{ data: { openEnquiries: number; activeProjects: number; dueFollowups: number; recentActivity: unknown[] }; meta: { fetchedAt: string } }>("/dashboard"),
  brief: () => api<{ brief: { headline: string; cards: Array<{ severity: string; title: string; body: string }> }; brief_date: string; cached: boolean }>("/assistant/brief", { method: "POST", body: JSON.stringify({ local_date: new Date().toISOString().slice(0, 10), force: false }) }),
  list: (resource: MobileResource, search = "") => api<CursorPage<MobileRecordSummary>>(`/${resource}?limit=30${search ? `&search=${encodeURIComponent(search)}` : ""}`),
  detail: (resource: MobileResource, id: string) => api<{ data: Record<string, unknown>; meta: { requestId: string; fetchedAt: string } }>(`/${resource}/${encodeURIComponent(id)}`),
  createRecord: (resource: "customers" | "enquiries", input: { fullName: string; phone: string; email?: string; city?: string; address?: string; leadSource?: string; requirementType?: string; customerType?: string; notes?: string }) => api<{ data: { id: string } }>(`/${resource}`, { method: "POST", body: JSON.stringify(input) }),
  notifications: () => api<{ data: Array<{ receipt_id: string; title: string; message: string; destination_route: string; read_at: string | null; created_at: string }> }>("/notifications"),
  markNotificationRead: (id: string) => api(`/${"notifications"}/${id}/read`, { method: "POST", body: "{}" }),
  markAllNotificationsRead: () => api("/notifications/read-all", { method: "POST", body: "{}" }),
  registerDevice: (input: { expoPushToken: string; platform: "android" | "ios"; deviceId: string; appVersion: string; locale: string }) => api("/devices", { method: "POST", body: JSON.stringify(input) }),
  revokeDevice: (deviceId: string) => api(`/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE", body: "{}" }),
  enroll: (input: { organizationName: string; fullName: string; phone?: string }) => api("/enrollment", { method: "POST", body: JSON.stringify(input) }),
  fieldSurveys: () => api<{ data: Array<Record<string, unknown>> }>("/field/site-surveys"),
  fieldSurvey: (id: string) => api<{ data: Record<string, unknown> | null }>(`/field/site-surveys/${encodeURIComponent(id)}`),
  updateFieldSurveyTechnical: (id: string, patch: Record<string, unknown>) => api(`/field/site-surveys/${encodeURIComponent(id)}/technical`, { method: "PATCH", body: JSON.stringify(patch) }),
  updateFieldSurveyStatus: (id: string, status: "in_progress" | "completed") => api(`/field/site-surveys/${encodeURIComponent(id)}/status`, { method: "POST", body: JSON.stringify({ status }) }),
  registerFieldSurveyEvidence: (id: string, kind: "photo" | "document", evidence: Record<string, unknown>) => api(`/field/site-surveys/${encodeURIComponent(id)}/evidence`, { method: "POST", body: JSON.stringify({ kind, evidence }) }),
  fieldProjects: () => api<{ data: Array<Record<string, unknown>> }>("/field/projects"),
  fieldProject: (id: string) => api<{ data: Record<string, unknown> | null }>(`/field/projects/${encodeURIComponent(id)}`),
  updateFieldProjectStatus: (id: string, status: "installation_in_progress" | "installation_completed") => api(`/field/projects/${encodeURIComponent(id)}/status`, { method: "POST", body: JSON.stringify({ status }) }),
};

export function hasMobilePermission(context: SessionContext | null, module: MobileModuleKey, action: MobileActionKey = "view") {
  return context?.permissions.some((permission) => permission.module === module && permission.actions.includes(action)) ?? false;
}
