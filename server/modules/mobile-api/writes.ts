import type { MobileRequestContext } from "./auth.js";
import { requirePermission } from "./auth.js";
import { MobileApiError } from "./errors.js";

type JsonObject = Record<string, unknown>;
function requiredText(body: JsonObject, key: string, max: number) { const value = typeof body[key] === "string" ? body[key].trim() : ""; if (!value) throw new MobileApiError(422, "VALIDATION_FAILED", `${key} is required`); return value.slice(0, max); }
function optionalText(body: JsonObject, key: string, max: number) { const value = typeof body[key] === "string" ? body[key].trim() : ""; return value ? value.slice(0, max) : null; }
function phone(body: JsonObject) { const value = requiredText(body, "phone", 20).replace(/[\s()-]/g, ""); if (!/^\+?[0-9]{10,15}$/.test(value)) throw new MobileApiError(422, "VALIDATION_FAILED", "Enter a valid phone number"); return value; }

export async function createMobileRecord(context: MobileRequestContext, resource: string, raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new MobileApiError(422, "VALIDATION_FAILED", "A JSON object is required");
  const body = raw as JsonObject;
  if (resource === "customers") {
    await requirePermission(context, "customers", "create");
    const payload = { organization_id: context.profile.organization_id, created_by: context.profile.id, customer_segment: "project_based", full_name: requiredText(body, "fullName", 200), phone: phone(body), email: optionalText(body, "email", 320), city: optionalText(body, "city", 120), address_line_1: optionalText(body, "address", 500), customer_type: optionalText(body, "customerType", 40) ?? "residential", lead_source: optionalText(body, "leadSource", 120), status: "active", notes: optionalText(body, "notes", 2000) };
    const { data, error } = await context.client.from("customers").insert(payload).select("id,customer_code,full_name,phone,status,created_at").single();
    if (error) throw mapWriteError(error); return data;
  }
  if (resource === "enquiries") {
    await requirePermission(context, "leads", "create");
    const payload = { organization_id: context.profile.organization_id, created_by: context.profile.id, full_name: requiredText(body, "fullName", 200), phone: phone(body), email: optionalText(body, "email", 320), city: optionalText(body, "city", 120), address: optionalText(body, "address", 500), lead_source: optionalText(body, "leadSource", 120), requirement_type: optionalText(body, "requirementType", 120), status: "new", priority: "medium", notes: optionalText(body, "notes", 2000) };
    const { data, error } = await context.client.from("leads").insert(payload).select("id,lead_code,full_name,phone,status,created_at").single();
    if (error) throw mapWriteError(error); return data;
  }
  throw new MobileApiError(405, "FORBIDDEN", "Creation is not supported for this resource");
}

function mapWriteError(error: { code?: string; message: string }) {
  if (error.code === "23505") return new MobileApiError(409, "CONFLICT", "A matching record already exists");
  if (error.code?.startsWith("22") || error.code?.startsWith("23")) return new MobileApiError(422, "VALIDATION_FAILED", error.message);
  return error;
}
