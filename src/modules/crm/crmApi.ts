import { supabase } from "../../services/supabaseClient";
import type { UserProfile } from "../../app/AuthProvider";
import type {
  Customer,
  CustomerFormValues,
  Lead,
  LeadActionState,
  LeadFollowup,
  LeadFollowupFormValues,
  LeadFollowupWithLead,
  LeadFormValues,
  StaffOption,
} from "./types";

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

function nullableDate(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function requiredDate(value: string) {
  if (!value) {
    return new Date().toISOString();
  }

  return new Date(value).toISOString();
}

function combineDateAndTime(date: string, time: string) {
  if (!date) {
    return "";
  }

  return `${date}T${time || "00:00"}`;
}

function requiredFollowupDateTime(values: LeadFollowupFormValues) {
  return requiredDate(combineDateAndTime(values.followup_date, values.followup_time));
}

function nullableNextFollowupDateTime(values: LeadFollowupFormValues) {
  return nullableDate(
    combineDateAndTime(values.next_followup_date, values.next_followup_time),
  );
}

export async function fetchStaffOptions(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("users_profile")
    .select("id, full_name, phone, email, status, organization_id")
    .eq("status", "active")
    .order("full_name", { ascending: true });

  if (!profile?.is_super_admin) {
    const organizationId = requireOrganization(profile);
    query = query.eq("organization_id", organizationId);
  } else if (profile.organization_id) {
    query = query.eq("organization_id", profile.organization_id);
  }

  const { data, error } = await query;

  if (error) {
    if (profile) {
      return [
        {
          id: profile.id,
          full_name: profile.full_name,
          phone: profile.phone,
          email: null,
          status: profile.status,
          organization_id: profile.organization_id,
        },
      ] satisfies StaffOption[];
    }

    throw new Error(error.message);
  }

  return (data ?? []) as StaffOption[];
}

export async function fetchCustomers(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("customers")
    .select("*")
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

  return (data ?? []) as Customer[];
}

export async function fetchCustomer(profile: UserProfile | null, id: string) {
  const client = requireSupabase();
  let query = client.from("customers").select("*").eq("id", id);

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as Customer | null;
}

export async function createCustomer(
  profile: UserProfile | null,
  values: CustomerFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("customers")
    .insert({
      organization_id: requireOrganization(profile),
      created_by: profile?.id ?? null,
      full_name: values.full_name.trim(),
      phone: values.phone.trim(),
      alternate_phone: nullable(values.alternate_phone),
      email: nullable(values.email),
      address_line_1: nullable(values.address_line_1),
      address_line_2: nullable(values.address_line_2),
      city: nullable(values.city),
      district: nullable(values.district),
      state: nullable(values.state),
      pincode: nullable(values.pincode),
      customer_type: values.customer_type,
      lead_source: nullable(values.lead_source),
      status: values.status,
      assigned_to: nullable(values.assigned_to),
      notes: nullable(values.notes),
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Customer;
}

export async function updateCustomer(id: string, values: CustomerFormValues) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("customers")
    .update({
      full_name: values.full_name.trim(),
      phone: values.phone.trim(),
      alternate_phone: nullable(values.alternate_phone),
      email: nullable(values.email),
      address_line_1: nullable(values.address_line_1),
      address_line_2: nullable(values.address_line_2),
      city: nullable(values.city),
      district: nullable(values.district),
      state: nullable(values.state),
      pincode: nullable(values.pincode),
      customer_type: values.customer_type,
      lead_source: nullable(values.lead_source),
      status: values.status,
      assigned_to: nullable(values.assigned_to),
      notes: nullable(values.notes),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Customer;
}

export async function deleteCustomer(id: string) {
  const client = requireSupabase();
  const { error } = await client.from("customers").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function fetchLeads(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("leads")
    .select("*")
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

  return ((data ?? []) as Lead[]).filter((lead) => lead.status !== "converted");
}

export async function fetchLead(profile: UserProfile | null, id: string) {
  const client = requireSupabase();
  let query = client.from("leads").select("*").eq("id", id);

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as Lead | null;
}

export async function fetchLeadActionState(
  profile: UserProfile | null,
  leadId: string,
  options: {
    includeSiteSurvey?: boolean;
    includeQuotation?: boolean;
    includeQuotationBySurvey?: boolean;
  } = {},
): Promise<LeadActionState> {
  const client = requireSupabase();
  const includeSiteSurvey = options.includeSiteSurvey ?? true;
  const includeQuotation = options.includeQuotation ?? true;
  const includeQuotationBySurvey = options.includeQuotationBySurvey ?? true;
  let surveyIds: string[] = [];

  if (includeSiteSurvey || includeQuotationBySurvey) {
    let surveyQuery = client
      .from("site_surveys")
      .select("id")
      .eq("lead_id", leadId);

    if (!profile?.is_super_admin) {
      surveyQuery = surveyQuery.eq("organization_id", requireOrganization(profile));
    } else if (profile.organization_id) {
      surveyQuery = surveyQuery.eq("organization_id", profile.organization_id);
    }

    const { data: surveyRows, error: surveyError } = await surveyQuery;

    if (surveyError) {
      throw new Error(surveyError.message);
    }

    surveyIds = (surveyRows ?? []).map((survey) => survey.id);
  }

  if (!includeQuotation) {
    return {
      hasSiteSurvey: surveyIds.length > 0,
      hasQuotation: false,
    };
  }

  let directQuotationQuery = client
    .from("quotations")
    .select("id")
    .eq("lead_id", leadId)
    .limit(1);

  if (!profile?.is_super_admin) {
    directQuotationQuery = directQuotationQuery.eq(
      "organization_id",
      requireOrganization(profile),
    );
  } else if (profile.organization_id) {
    directQuotationQuery = directQuotationQuery.eq(
      "organization_id",
      profile.organization_id,
    );
  }

  const { data: directQuotationRows, error: directQuotationError } =
    await directQuotationQuery;

  if (directQuotationError) {
    throw new Error(directQuotationError.message);
  }

  if ((directQuotationRows ?? []).length > 0 || surveyIds.length === 0) {
    return {
      hasSiteSurvey: surveyIds.length > 0,
      hasQuotation: (directQuotationRows ?? []).length > 0,
    };
  }

  if (!includeQuotationBySurvey) {
    return {
      hasSiteSurvey: surveyIds.length > 0,
      hasQuotation: false,
    };
  }

  let surveyQuotationQuery = client
    .from("quotations")
    .select("id")
    .in("site_survey_id", surveyIds)
    .limit(1);

  if (!profile?.is_super_admin) {
    surveyQuotationQuery = surveyQuotationQuery.eq(
      "organization_id",
      requireOrganization(profile),
    );
  } else if (profile.organization_id) {
    surveyQuotationQuery = surveyQuotationQuery.eq(
      "organization_id",
      profile.organization_id,
    );
  }

  const { data: surveyQuotationRows, error: surveyQuotationError } =
    await surveyQuotationQuery;

  if (surveyQuotationError) {
    throw new Error(surveyQuotationError.message);
  }

  return {
    hasSiteSurvey: surveyIds.length > 0,
    hasQuotation: (surveyQuotationRows ?? []).length > 0,
  };
}

export async function createLead(profile: UserProfile | null, values: LeadFormValues) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("leads")
    .insert({
      organization_id: requireOrganization(profile),
      created_by: profile?.id ?? null,
      full_name: values.full_name.trim(),
      phone: values.phone.trim(),
      alternate_phone: nullable(values.alternate_phone),
      email: nullable(values.email),
      address: nullable(values.address),
      city: nullable(values.city),
      district: nullable(values.district),
      state: nullable(values.state),
      pincode: nullable(values.pincode),
      lead_source: nullable(values.lead_source),
      requirement_type: nullable(values.requirement_type),
      estimated_load_kw: nullableNumber(values.estimated_load_kw),
      electricity_bill_amount: nullableNumber(values.electricity_bill_amount),
      offered_price: nullableNumber(values.offered_price),
      property_type: nullable(values.property_type),
      roof_type: nullable(values.roof_type),
      status: values.status,
      priority: values.priority,
      assigned_to: nullable(values.assigned_to),
      notes: nullable(values.notes),
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Lead;
}

export async function updateLead(id: string, values: LeadFormValues) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("leads")
    .update({
      full_name: values.full_name.trim(),
      phone: values.phone.trim(),
      alternate_phone: nullable(values.alternate_phone),
      email: nullable(values.email),
      address: nullable(values.address),
      city: nullable(values.city),
      district: nullable(values.district),
      state: nullable(values.state),
      pincode: nullable(values.pincode),
      lead_source: nullable(values.lead_source),
      requirement_type: nullable(values.requirement_type),
      estimated_load_kw: nullableNumber(values.estimated_load_kw),
      electricity_bill_amount: nullableNumber(values.electricity_bill_amount),
      offered_price: nullableNumber(values.offered_price),
      property_type: nullable(values.property_type),
      roof_type: nullable(values.roof_type),
      status: values.status,
      priority: values.priority,
      assigned_to: nullable(values.assigned_to),
      notes: nullable(values.notes),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as Lead;
}

export async function deleteLead(id: string) {
  const client = requireSupabase();
  const { error } = await client.from("leads").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function convertLeadToCustomer(leadId: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("convert_lead_to_customer", {
    target_lead_id: leadId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as Customer;
}

export async function fetchLeadFollowups(
  profile: UserProfile | null,
  leadId: string,
) {
  const client = requireSupabase();
  let query = client
    .from("lead_followups")
    .select("*")
    .eq("lead_id", leadId)
    .order("followup_date", { ascending: false });

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as LeadFollowup[];
}

export async function fetchOrganizationFollowups(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("lead_followups")
    .select(
      `
      *,
      lead:leads(id, lead_code, full_name, phone, city)
    `,
    )
    .order("followup_date", { ascending: true });

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  } else if (profile.organization_id) {
    query = query.eq("organization_id", profile.organization_id);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as LeadFollowupWithLead[];
}

export async function createLeadFollowup(
  profile: UserProfile | null,
  leadId: string,
  values: LeadFollowupFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("lead_followups")
    .insert({
      organization_id: requireOrganization(profile),
      lead_id: leadId,
      followup_type: values.followup_type,
      followup_date: requiredFollowupDateTime(values),
      next_followup_date: nullableNextFollowupDateTime(values),
      status: values.status,
      notes: nullable(values.notes),
      created_by: profile?.id ?? null,
      assigned_to: nullable(values.assigned_to),
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as LeadFollowup;
}

export async function updateLeadFollowup(
  id: string,
  values: LeadFollowupFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("lead_followups")
    .update({
      followup_type: values.followup_type,
      followup_date: requiredFollowupDateTime(values),
      next_followup_date: nullableNextFollowupDateTime(values),
      status: values.status,
      notes: nullable(values.notes),
      assigned_to: nullable(values.assigned_to),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as LeadFollowup;
}

export async function markLeadFollowupCompleted(id: string) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("lead_followups")
    .update({ status: "completed" })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as LeadFollowup;
}
