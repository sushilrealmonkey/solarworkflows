import type { MobileRequestContext } from "./auth.js";
import { requirePermission } from "./auth.js";
import { MobileApiError } from "./errors.js";

type ResourceConfig = { table: string; module: string; select: string; code: string; title: string; subtitle?: string; status: string };
export const resources: Record<string, ResourceConfig> = {
  customers: { table: "customers", module: "customers", select: "id,customer_code,full_name,business_name,phone,city,customer_segment,status,updated_at,created_at", code: "customer_code", title: "full_name", subtitle: "business_name", status: "status" },
  enquiries: { table: "leads", module: "leads", select: "id,lead_code,full_name,phone,city,lead_source,status,updated_at,created_at", code: "lead_code", title: "full_name", subtitle: "phone", status: "status" },
  "site-surveys": { table: "site_surveys", module: "site_surveys", select: "id,survey_code,site_address,city,status,scheduled_at,updated_at,created_at", code: "survey_code", title: "site_address", subtitle: "city", status: "status" },
  quotations: { table: "quotations", module: "quotations", select: "id,quotation_code,customer_id,lead_id,system_capacity_kw,total_amount,net_payable_amount,status,updated_at,created_at", code: "quotation_code", title: "quotation_code", subtitle: "system_capacity_kw", status: "status" },
  projects: { table: "projects", module: "projects", select: "id,project_code,project_name,customer_id,system_capacity_kw,project_status,priority,updated_at,created_at", code: "project_code", title: "project_name", subtitle: "system_capacity_kw", status: "project_status" },
  documents: { table: "documents", module: "documents", select: "id,document_name,document_type,mime_type,file_size,status,updated_at,created_at", code: "document_type", title: "document_name", subtitle: "mime_type", status: "status" },
};

function decodeCursor(raw: string | null): string | null {
  if (!raw) return null;
  try { return new Date(Buffer.from(raw, "base64url").toString("utf8")).toISOString(); }
  catch { throw new MobileApiError(422, "VALIDATION_FAILED", "Invalid cursor"); }
}
export async function listResource(context: MobileRequestContext, resource: string, url: URL, requestId: string) {
  const config = resources[resource];
  if (!config) throw new MobileApiError(404, "NOT_FOUND", "Resource not found");
  await requirePermission(context, config.module, "view");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 20) || 20, 1), 50);
  let query = context.client.from(config.table).select(config.select).eq("organization_id", context.profile.organization_id).order("updated_at", { ascending: false }).limit(limit + 1);
  const before = decodeCursor(url.searchParams.get("cursor")); if (before) query = query.lt("updated_at", before);
  const search = url.searchParams.get("search")?.trim(); if (search) query = query.ilike(config.title, `%${search.replace(/[%_,()]/g, "")}%`);
  const status = url.searchParams.get("status")?.trim(); if (status) query = query.eq(config.status, status);
  const { data, error } = await query; if (error) throw error;
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>; const hasMore = rows.length > limit; const visible = rows.slice(0, limit); const last = visible.at(-1);
  return { data: visible.map((row) => ({ id: row.id, code: row[config.code] ?? null, title: String(row[config.title] ?? "Untitled"), subtitle: row[config.subtitle ?? ""] == null ? null : String(row[config.subtitle ?? ""]), status: row[config.status] == null ? null : String(row[config.status]), updatedAt: String(row.updated_at ?? row.created_at) })), page: { hasMore, nextCursor: hasMore && last ? Buffer.from(String(last.updated_at ?? last.created_at)).toString("base64url") : null }, meta: { requestId, fetchedAt: new Date().toISOString() } };
}
export async function getResource(context: MobileRequestContext, resource: string, id: string) {
  const config = resources[resource]; if (!config) throw new MobileApiError(404, "NOT_FOUND", "Resource not found");
  await requirePermission(context, config.module, "view");
  const { data, error } = await context.client.from(config.table).select(config.select).eq("id", id).eq("organization_id", context.profile.organization_id).maybeSingle();
  if (error) throw error; if (!data) throw new MobileApiError(404, "NOT_FOUND", "Record not found"); return data;
}
