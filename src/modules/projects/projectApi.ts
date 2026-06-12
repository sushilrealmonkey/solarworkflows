import type { UserProfile } from "../../app/AuthProvider";
import { supabase } from "../../services/supabaseClient";
import type {
  SiteSurveyWithRelations,
  SurveyCustomerSummary,
  SurveyLeadSummary,
} from "../site-surveys/types";
import type { QuotationWithRelations } from "../quotations/types";
import type {
  Project,
  ProjectFormValues,
  ProjectStatus,
  ProjectWithRelations,
} from "./types";
import { parseTeamInput } from "./projectUtils";

function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase environment variables are not configured.");
  }

  return supabase;
}

function requireOrganization(profile: UserProfile | null) {
  if (!profile?.organization_id) {
    throw new Error("No organization is assigned to this user.");
  }

  return profile.organization_id;
}

function nullable(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function nullableNumber(value: string) {
  if (!value.trim()) {
    return null;
  }

  const nextValue = Number(value);
  return Number.isFinite(nextValue) ? nextValue : null;
}

function projectPayload(values: ProjectFormValues) {
  return {
    customer_id: values.customer_id,
    lead_id: nullable(values.lead_id),
    quotation_id: nullable(values.quotation_id),
    site_survey_id: nullable(values.site_survey_id),
    project_name: nullable(values.project_name),
    system_capacity_kw: nullableNumber(values.system_capacity_kw),
    project_type: values.project_type,
    installation_address: nullable(values.installation_address),
    city: nullable(values.city),
    district: nullable(values.district),
    state: nullable(values.state),
    pincode: nullable(values.pincode),
    project_status: values.project_status,
    priority: values.priority,
    start_date: nullable(values.start_date),
    expected_completion_date: nullable(values.expected_completion_date),
    assigned_project_manager: nullable(values.assigned_project_manager),
    assigned_installation_team: parseTeamInput(values.assigned_installation_team),
    notes: nullable(values.notes),
  };
}

const customerSelect =
  "id, customer_code, full_name, phone, alternate_phone, email, address_line_1, address_line_2, city, district, state, pincode, customer_type, assigned_to";
const leadSelect =
  "id, lead_code, customer_id, converted_customer_id, full_name, phone, alternate_phone, email, address, city, district, state, pincode, roof_type, estimated_load_kw, offered_price, assigned_to";
const staffSelect = "id, full_name, phone, email, status, organization_id";

const quotationSelect = `
  id,
  organization_id,
  quotation_code,
  customer_id,
  lead_id,
  site_survey_id,
  quotation_date,
  valid_until,
  system_capacity_kw,
  total_amount,
  subsidy_amount,
  net_payable_amount,
  status,
  created_by,
  created_at,
  customer:customers(${customerSelect}),
  lead:leads(${leadSelect})
`;

const surveySelect = `
  *,
  customer:customers(${customerSelect}),
  lead:leads(${leadSelect})
`;

const projectSelect = `
  *,
  customer:customers(${customerSelect}),
  lead:leads(${leadSelect}),
  quotation:quotations(${quotationSelect}),
  site_survey:site_surveys(${surveySelect}),
  project_manager:users_profile!projects_assigned_project_manager_fkey(${staffSelect})
`;

export async function fetchProjects(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("projects")
    .select(projectSelect)
    .order("created_at", { ascending: false });

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  } else if (profile.organization_id) {
    query = query.eq("organization_id", profile.organization_id);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as ProjectWithRelations[];
}

export async function fetchProject(profile: UserProfile | null, id: string) {
  const client = requireSupabase();
  let query = client.from("projects").select(projectSelect).eq("id", id);

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as ProjectWithRelations | null;
}

export async function fetchProjectByQuotation(
  profile: UserProfile | null,
  quotationId: string,
) {
  const client = requireSupabase();
  let query = client
    .from("projects")
    .select(projectSelect)
    .eq("quotation_id", quotationId);

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as ProjectWithRelations | null;
}

export async function createProject(
  profile: UserProfile | null,
  values: ProjectFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("projects")
    .insert({
      organization_id: requireOrganization(profile),
      created_by: profile?.id ?? null,
      ...projectPayload(values),
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Project;
}

export async function updateProject(id: string, values: ProjectFormValues) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("projects")
    .update(projectPayload(values))
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Project;
}

export async function deleteProject(id: string) {
  const client = requireSupabase();
  const { error } = await client.from("projects").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function updateProjectStatus(
  projectId: string,
  status: ProjectStatus,
) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("update_project_status", {
    target_project_id: projectId,
    new_status: status,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as Project;
}

export async function createProjectFromQuotation(quotationId: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("create_project_from_quotation", {
    target_quotation_id: quotationId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as Project;
}

export async function fetchProjectCustomers(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("customers")
    .select(customerSelect)
    .order("created_at", { ascending: false });

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  } else if (profile.organization_id) {
    query = query.eq("organization_id", profile.organization_id);
  }

  const { data, error } = await query;

  if (error) {
    return [] as SurveyCustomerSummary[];
  }

  return (data ?? []) as SurveyCustomerSummary[];
}

export async function fetchProjectLeads(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("leads")
    .select(leadSelect)
    .order("created_at", { ascending: false });

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  } else if (profile.organization_id) {
    query = query.eq("organization_id", profile.organization_id);
  }

  const { data, error } = await query;

  if (error) {
    return [] as SurveyLeadSummary[];
  }

  return (data ?? []) as SurveyLeadSummary[];
}

export async function fetchProjectQuotations(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("quotations")
    .select(quotationSelect)
    .order("created_at", { ascending: false });

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  } else if (profile.organization_id) {
    query = query.eq("organization_id", profile.organization_id);
  }

  const { data, error } = await query;

  if (error) {
    return [] as QuotationWithRelations[];
  }

  return (data ?? []) as unknown as QuotationWithRelations[];
}

export async function fetchProjectSiteSurveys(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("site_surveys")
    .select(surveySelect)
    .order("created_at", { ascending: false });

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  } else if (profile.organization_id) {
    query = query.eq("organization_id", profile.organization_id);
  }

  const { data, error } = await query;

  if (error) {
    return [] as SiteSurveyWithRelations[];
  }

  return (data ?? []) as SiteSurveyWithRelations[];
}
