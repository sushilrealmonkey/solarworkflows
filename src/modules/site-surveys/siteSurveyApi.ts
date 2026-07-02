import type { UserProfile } from "../../app/AuthProvider";
import { supabase } from "../../services/supabaseClient";
import type { Lead } from "../crm/types";
import type {
  SiteSurvey,
  SiteSurveyFile,
  SiteSurveyFormValues,
  SiteSurveyQuotationSummary,
  SiteSurveyStatus,
  SiteSurveyWithRelations,
  SurveyCustomerSummary,
  SurveyLeadSummary,
} from "./types";

const siteSurveyUploadBucket = "organization-documents";

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

function surveyPayload(values: SiteSurveyFormValues) {
  return {
    lead_id: nullable(values.lead_id),
    customer_id: nullable(values.customer_id),
    scheduled_date: nullable(values.scheduled_date),
    scheduled_time: nullable(values.scheduled_time),
    assigned_to: nullable(values.assigned_to),
    roof_type: nullable(values.roof_type),
    roof_area_sqft: nullableNumber(values.roof_area_sqft),
    shadow_free_area_sqft: nullableNumber(values.shadow_free_area_sqft),
    latitude: nullableNumber(values.latitude),
    longitude: nullableNumber(values.longitude),
    address_notes: nullable(values.address_notes),
    recommended_capacity_kw: nullableNumber(values.recommended_capacity_kw),
    sanctioned_load_kw: nullableNumber(values.sanctioned_load_kw),
    phase_type: nullable(values.phase_type),
    remarks: nullable(values.remarks),
  };
}

const surveySelect = `
  *,
  lead:leads(
    id,
    lead_code,
    customer_id,
    converted_customer_id,
    full_name,
    phone,
    alternate_phone,
    email,
    address,
    city,
    district,
    state,
    pincode,
    lead_source,
    requirement_type,
    electricity_bill_amount,
    property_type,
    roof_type,
    estimated_load_kw,
    priority,
    assigned_to,
    notes
  ),
  customer:customers(
    id,
    customer_code,
    full_name,
    phone,
    alternate_phone,
    email,
    address_line_1,
    address_line_2,
    city,
    district,
    state,
    pincode,
    assigned_to
  ),
  quotations:quotations!quotations_site_survey_id_fkey(
    id,
    quotation_code,
    status
  )
`;

export async function fetchSiteSurveys(profile: UserProfile | null) {
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
    throw new Error(error.message);
  }

  const surveysWithQuotations = await attachSurveyQuotationSummaries(
    profile,
    (data ?? []) as SiteSurveyWithRelations[],
  );
  const surveys = await attachSurveyProjectIds(profile, surveysWithQuotations);
  return addSurveyFileUrls(surveys);
}

export async function fetchSiteSurvey(profile: UserProfile | null, id: string) {
  const client = requireSupabase();
  let query = client.from("site_surveys").select(surveySelect).eq("id", id);

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const surveysWithQuotations = await attachSurveyQuotationSummaries(
    profile,
    data ? ([data] as SiteSurveyWithRelations[]) : [],
  );
  const surveys = await attachSurveyProjectIds(profile, surveysWithQuotations);
  const [survey] = await addSurveyFileUrls(surveys);
  return survey ?? null;
}

export async function createSiteSurvey(
  profile: UserProfile | null,
  values: SiteSurveyFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("site_surveys")
    .insert({
      organization_id: requireOrganization(profile),
      created_by: profile?.id ?? null,
      survey_status: "scheduled",
      ...surveyPayload(values),
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as SiteSurvey;
}

export async function updateSiteSurvey(
  id: string,
  values: SiteSurveyFormValues,
) {
  const client = requireSupabase();
  const { data, error } = await client
    .from("site_surveys")
    .update(surveyPayload(values))
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as SiteSurvey;
}

export async function updateSiteSurveyStatus(
  id: string,
  status: SiteSurveyStatus,
) {
  const client = requireSupabase();

  if (status === "completed") {
    const { data, error } = await client.rpc("complete_site_survey", {
      survey_id: id,
    });

    if (error) {
      throw new Error(error.message);
    }

    return data as SiteSurvey;
  }

  const { data, error } = await client
    .from("site_surveys")
    .update({ survey_status: status })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as SiteSurvey;
}

export async function uploadSiteSurveyPhoto(
  profile: UserProfile | null,
  survey: SiteSurveyWithRelations,
  file: File,
) {
  const uploadedFile = await uploadSiteSurveyFile(
    profile,
    survey,
    file,
    "photos",
  );
  const photos = Array.isArray(survey.site_photos) ? survey.site_photos : [];
  const { data, error } = await requireSupabase()
    .from("site_surveys")
    .update({ site_photos: [...photos, uploadedFile] })
    .eq("id", survey.id)
    .select(surveySelect)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  const [nextSurvey] = await addSurveyFileUrls([data as SiteSurveyWithRelations]);
  return nextSurvey;
}

export async function uploadSiteSurveyDocument(
  profile: UserProfile | null,
  survey: SiteSurveyWithRelations,
  file: File,
) {
  const uploadedFile = await uploadSiteSurveyFile(
    profile,
    survey,
    file,
    "documents",
  );
  const { data, error } = await requireSupabase()
    .from("site_surveys")
    .update({ electricity_bill_url: uploadedFile.file_path ?? uploadedFile.url })
    .eq("id", survey.id)
    .select(surveySelect)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  const [nextSurvey] = await addSurveyFileUrls([data as SiteSurveyWithRelations]);
  return nextSurvey;
}

export async function deleteSiteSurvey(id: string) {
  const client = requireSupabase();
  const { error } = await client.from("site_surveys").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

async function uploadSiteSurveyFile(
  profile: UserProfile | null,
  survey: SiteSurveyWithRelations,
  file: File,
  folder: "photos" | "documents",
) {
  const client = requireSupabase();
  const organizationId = survey.organization_id || requireOrganization(profile);
  const filePath = [
    organizationId,
    "site-surveys",
    survey.id,
    folder,
    `${Date.now()}-${sanitizeFileName(file.name)}`,
  ].join("/");
  const uploadResult = await client.storage
    .from(siteSurveyUploadBucket)
    .upload(filePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadResult.error) {
    throw new Error(
      `${uploadResult.error.message}. Make sure the Supabase Storage bucket "${siteSurveyUploadBucket}" exists.`,
    );
  }

  const publicUrl = client.storage.from(siteSurveyUploadBucket).getPublicUrl(filePath)
    .data.publicUrl;

  return {
    name: file.name,
    url: publicUrl || filePath,
    file_path: filePath,
    size: file.size,
    mime_type: file.type || undefined,
    uploaded_at: new Date().toISOString(),
  } satisfies SiteSurveyFile;
}

async function addSurveyFileUrls(surveys: SiteSurveyWithRelations[]) {
  const client = requireSupabase();

  return Promise.all(
    surveys.map(async (survey) => {
      const sitePhotos = await Promise.all(
        (survey.site_photos ?? []).map(async (photo) => {
          const filePath = photo.file_path ?? storagePathFromUrl(photo.url);
          if (!filePath) {
            return photo;
          }

          const { data } = await client.storage
            .from(siteSurveyUploadBucket)
            .createSignedUrl(filePath, 60 * 10);

          return {
            ...photo,
            file_path: filePath,
            url: data?.signedUrl ?? photo.url,
          };
        }),
      );
      const documentPath = storagePathFromUrl(survey.electricity_bill_url);
      let electricityBillUrl = survey.electricity_bill_url;

      if (documentPath) {
        const { data } = await client.storage
          .from(siteSurveyUploadBucket)
          .createSignedUrl(documentPath, 60 * 10);
        electricityBillUrl = data?.signedUrl ?? survey.electricity_bill_url;
      }

      return {
        ...survey,
        site_photos: sitePhotos,
        electricity_bill_url: electricityBillUrl,
      };
    }),
  );
}

async function attachSurveyProjectIds(
  profile: UserProfile | null,
  surveys: SiteSurveyWithRelations[],
) {
  if (surveys.length === 0) {
    return surveys;
  }

  const client = requireSupabase();
  const surveyIds = surveys.map((survey) => survey.id);
  const quotationIds = surveys.flatMap((survey) =>
    (survey.quotations ?? []).map((quotation) => quotation.id),
  );
  const filters = [`site_survey_id.in.(${surveyIds.join(",")})`];

  if (quotationIds.length > 0) {
    filters.push(`quotation_id.in.(${quotationIds.join(",")})`);
  }

  let query = client
    .from("projects")
    .select("id, site_survey_id, quotation_id")
    .or(filters.join(","));

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  } else if (profile.organization_id) {
    query = query.eq("organization_id", profile.organization_id);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  const projectIdsBySurvey = new Map<string, string>();
  const surveyIdByQuotation = new Map<string, string>();

  surveys.forEach((survey) => {
    (survey.quotations ?? []).forEach((quotation) => {
      surveyIdByQuotation.set(quotation.id, survey.id);
    });
  });

  (data ?? []).forEach((project) => {
    const surveyId = project.site_survey_id
      ? project.site_survey_id
      : project.quotation_id
        ? surveyIdByQuotation.get(project.quotation_id)
        : null;

    if (surveyId && !projectIdsBySurvey.has(surveyId)) {
      projectIdsBySurvey.set(surveyId, project.id);
    }
  });

  return surveys.map((survey) => ({
    ...survey,
    project_id: projectIdsBySurvey.get(survey.id) ?? null,
  }));
}

type SurveyQuotationLookupRow = SiteSurveyQuotationSummary & {
  site_survey_id: string | null;
  lead_id: string | null;
};

async function attachSurveyQuotationSummaries(
  profile: UserProfile | null,
  surveys: SiteSurveyWithRelations[],
) {
  if (surveys.length === 0) {
    return surveys;
  }

  const client = requireSupabase();
  const surveyIds = surveys.map((survey) => survey.id);
  const leadIds = [
    ...new Set(
      surveys
        .map((survey) => survey.lead_id)
        .filter((leadId): leadId is string => Boolean(leadId)),
    ),
  ];
  const filters = [`site_survey_id.in.(${surveyIds.join(",")})`];

  if (leadIds.length > 0) {
    filters.push(`lead_id.in.(${leadIds.join(",")})`);
  }

  let query = client
    .from("quotations")
    .select("id, quotation_code, status, site_survey_id, lead_id")
    .or(filters.join(","));

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  } else if (profile.organization_id) {
    query = query.eq("organization_id", profile.organization_id);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  const quotations = (data ?? []) as SurveyQuotationLookupRow[];
  const quotationsBySurvey = new Map<string, Map<string, SiteSurveyQuotationSummary>>();
  const surveyIdsByLead = new Map<string, string[]>();

  surveys.forEach((survey) => {
    const quoteMap = new Map<string, SiteSurveyQuotationSummary>();
    (survey.quotations ?? []).forEach((quotation) => {
      quoteMap.set(quotation.id, quotation);
    });
    quotationsBySurvey.set(survey.id, quoteMap);

    if (survey.lead_id) {
      const relatedSurveyIds = surveyIdsByLead.get(survey.lead_id) ?? [];
      relatedSurveyIds.push(survey.id);
      surveyIdsByLead.set(survey.lead_id, relatedSurveyIds);
    }
  });

  quotations.forEach((quotation) => {
    const relatedSurveyIds = new Set<string>();

    if (quotation.site_survey_id) {
      relatedSurveyIds.add(quotation.site_survey_id);
    }

    if (quotation.lead_id) {
      (surveyIdsByLead.get(quotation.lead_id) ?? []).forEach((surveyId) =>
        relatedSurveyIds.add(surveyId),
      );
    }

    relatedSurveyIds.forEach((surveyId) => {
      const quoteMap = quotationsBySurvey.get(surveyId);
      if (!quoteMap) {
        return;
      }

      quoteMap.set(quotation.id, {
        id: quotation.id,
        quotation_code: quotation.quotation_code,
        status: quotation.status,
      });
    });
  });

  return surveys.map((survey) => ({
    ...survey,
    quotations: Array.from(quotationsBySurvey.get(survey.id)?.values() ?? []),
  }));
}

function storagePathFromUrl(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  const marker = `/object/public/${siteSurveyUploadBucket}/`;
  const markerIndex = value.indexOf(marker);
  if (markerIndex >= 0) {
    return decodeURIComponent(value.slice(markerIndex + marker.length));
  }

  const signedMarker = `/object/sign/${siteSurveyUploadBucket}/`;
  const signedMarkerIndex = value.indexOf(signedMarker);
  if (signedMarkerIndex >= 0) {
    return decodeURIComponent(
      value.slice(signedMarkerIndex + signedMarker.length).split("?")[0] ?? "",
    );
  }

  if (value.startsWith("http://") || value.startsWith("https://")) {
    return "";
  }

  return value;
}

function sanitizeFileName(value: string) {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]/g, "_");
  return sanitized || "site-survey-file";
}

export async function fetchSurveyLeadOptions(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("leads")
    .select(
      "id, lead_code, customer_id, converted_customer_id, full_name, phone, alternate_phone, email, address, city, district, state, pincode, lead_source, requirement_type, electricity_bill_amount, offered_price, property_type, roof_type, estimated_load_kw, priority, assigned_to, notes",
    )
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

export async function fetchSurveyCustomerOptions(profile: UserProfile | null) {
  const client = requireSupabase();
  let query = client
    .from("customers")
    .select(
      "id, customer_code, full_name, phone, alternate_phone, email, address_line_1, address_line_2, city, district, state, pincode, assigned_to",
    )
    .eq("customer_segment", "project_based")
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

export async function fetchSurveyLead(profile: UserProfile | null, id: string) {
  const client = requireSupabase();
  let query = client
    .from("leads")
    .select(
      "id, organization_id, lead_code, customer_id, converted_customer_id, full_name, phone, alternate_phone, email, address, city, district, state, pincode, lead_source, requirement_type, estimated_load_kw, electricity_bill_amount, offered_price, offered_price_updated_at, property_type, roof_type, status, priority, assigned_to, notes, created_by, converted_at, created_at, updated_at",
    )
    .eq("id", id);

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as Lead | null;
}
