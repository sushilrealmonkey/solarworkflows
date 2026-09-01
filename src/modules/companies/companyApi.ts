import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "../../services/supabaseClient";
import { slugify } from "./companyUtils";
import type {
  CreatePlatformCompanyFormValues,
  CreatePlatformCompanyResult,
  PlatformCompany,
  PlatformCompanyActionResult,
  UpdatePlatformCompanyFormValues,
} from "./types";

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase environment variables are not configured.");
  }

  return supabase;
}

function nullable(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function nullablePhone(value: string) {
  const trimmed = value.trim();
  return trimmed && trimmed !== "+91" ? trimmed : null;
}

export async function fetchPlatformCompanies() {
  const client = requireSupabase();
  const { data, error } = await client.rpc("platform_epc_company_directory");

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as Array<{ company: PlatformCompany }>).map(
    (row) => row.company,
  );
}

export async function fetchPlatformCompany(organizationId: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("platform_epc_company_detail", {
    p_organization_id: organizationId,
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new Error("EPC company not found.");
  }

  return data as PlatformCompany;
}

export async function createPlatformCompany(
  values: CreatePlatformCompanyFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke(
    "invite-epc-company-admin",
    {
      body: {
        organization_name: values.organization_name.trim(),
        organization_slug: slugify(values.organization_name),
        admin_full_name: values.admin_full_name.trim(),
        admin_phone: nullablePhone(values.admin_phone),
        admin_email: nullable(values.admin_email),
      },
    },
  );

  if (error) {
    throw new Error(await getFunctionErrorMessage(error));
  }

  return data as CreatePlatformCompanyResult;
}

export async function sendPlatformAdminSetupLink(adminProfileId: string) {
  return invokeCompanyAction({
    action: "send_admin_setup_link",
    admin_profile_id: adminProfileId,
  });
}

export async function updatePlatformCompanyStatus(
  organizationId: string,
  status: "active" | "inactive",
) {
  return invokeCompanyAction({
    action: "update_company_status",
    organization_id: organizationId,
    status,
  });
}

export async function updatePlatformAdminStatus(
  adminProfileId: string,
  status: "invited" | "active" | "inactive",
) {
  return invokeCompanyAction({
    action: "update_admin_status",
    admin_profile_id: adminProfileId,
    status,
  });
}

export async function updatePlatformCompanyProfile(
  organizationId: string,
  values: UpdatePlatformCompanyFormValues,
) {
  return invokeCompanyAction({
    action: "update_company_profile",
    organization_id: organizationId,
    organization_name: values.organization_name.trim(),
    organization_slug: values.organization_slug.trim(),
    subdomain: nullable(values.subdomain),
    custom_domain: nullable(values.custom_domain),
    company_logo_url: nullable(values.company_logo_url),
    address: nullable(values.address),
    contact_person: nullable(values.contact_person),
    contact_email: nullable(values.contact_email),
    contact_phone: nullable(values.contact_phone),
    gst_number: nullable(values.gst_number),
    timezone: nullable(values.timezone),
    currency: nullable(values.currency),
    admin_full_name: values.admin_full_name.trim(),
    admin_email: nullable(values.admin_email),
    admin_phone: nullable(values.admin_phone),
  });
}

export async function guardedDeletePlatformCompany(organizationId: string) {
  return invokeCompanyAction({
    action: "guarded_delete_company",
    organization_id: organizationId,
  });
}

export async function extendExpiredPlatformTrial(
  organizationId: string,
  extensionDays: number,
) {
  return invokeCompanyAction({
    action: "extend_expired_trial",
    organization_id: organizationId,
    trial_extension_days: extensionDays,
  });
}

async function invokeCompanyAction(body: Record<string, unknown>) {
  const client = requireSupabase();
  const { data, error } = await client.functions.invoke(
    "invite-epc-company-admin",
    { body },
  );

  if (error) {
    throw new Error(await getFunctionErrorMessage(error));
  }

  return data as PlatformCompanyActionResult;
}

async function getFunctionErrorMessage(error: unknown) {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await error.context.json()) as unknown;

      if (isErrorBody(body)) {
        return body.error;
      }
    } catch {
      return error.message;
    }
  }

  return error instanceof Error ? error.message : "Action failed.";
}

function isErrorBody(value: unknown): value is { error: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string" &&
    value.error.trim().length > 0
  );
}
