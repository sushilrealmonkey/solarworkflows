import type { UserProfile } from "../../app/AuthProvider";
import { supabase } from "../../services/supabaseClient";
import type {
  DocumentUploadPayload,
  OrganizationDocument,
  OrganizationDocumentWithRelations,
} from "./types";
import { buildDocumentFilePath, documentBucketName } from "./documentUtils";

type FetchDocumentsOptions = {
  customerId?: string;
  projectId?: string;
};

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

const customerSelect =
  "id, customer_code, full_name, phone, alternate_phone, email, address_line_1, address_line_2, city, district, state, pincode, assigned_to";
const leadSelect =
  "id, lead_code, customer_id, converted_customer_id, full_name, phone, alternate_phone, email, address, city, district, state, pincode, roof_type, estimated_load_kw, offered_price, assigned_to";
const profileSelect = "id, full_name, phone, email";
const quotationSelect = "id, quotation_code, customer_id";
const proformaInvoiceSelect = "id, proforma_code";
const purchaseOrderSelect = "id, purchase_code";
const projectSelect = "id, project_code, project_name, customer_id, quotation_id";

const documentSelect = `
  *,
  customer:customers(${customerSelect}),
  lead:leads(${leadSelect}),
  project:projects(${projectSelect}),
  quotation:quotations(${quotationSelect}),
  proforma_invoice:proforma_invoices(${proformaInvoiceSelect}),
  purchase_order:purchase_orders(${purchaseOrderSelect}),
  uploaded_by_profile:users_profile!documents_uploaded_by_fkey(${profileSelect}),
  verified_by_profile:users_profile!documents_verified_by_fkey(${profileSelect})
`;

export async function fetchDocuments(
  profile: UserProfile | null,
  options: FetchDocumentsOptions = {},
) {
  const client = requireSupabase();
  let query = client
    .from("documents")
    .select(documentSelect)
    .order("created_at", { ascending: false });

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  } else if (profile.organization_id) {
    query = query.eq("organization_id", profile.organization_id);
  }

  if (options.customerId) {
    query = query.eq("customer_id", options.customerId);
  }

  if (options.projectId) {
    query = query.eq("project_id", options.projectId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return addPreviewUrls((data ?? []) as unknown as OrganizationDocumentWithRelations[]);
}

export async function fetchDocument(profile: UserProfile | null, id: string) {
  const client = requireSupabase();
  let query = client.from("documents").select(documentSelect).eq("id", id);

  if (!profile?.is_super_admin) {
    query = query.eq("organization_id", requireOrganization(profile));
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const documents = await addPreviewUrls(
    data ? ([data] as unknown as OrganizationDocumentWithRelations[]) : [],
  );
  return documents[0] ?? null;
}

export async function uploadDocument(
  profile: UserProfile | null,
  payload: DocumentUploadPayload,
) {
  const client = requireSupabase();
  const organizationId = requireOrganization(profile);
  const filePath = buildDocumentFilePath(organizationId, payload, payload.file);
  const uploadResult = await client.storage
    .from(documentBucketName)
    .upload(filePath, payload.file, {
      contentType: payload.file.type || "application/octet-stream",
      upsert: false,
    });

  if (uploadResult.error) {
    throw new Error(
      `${uploadResult.error.message}. Make sure the private Supabase Storage bucket "${documentBucketName}" exists.`,
    );
  }

  const publicUrl = client.storage.from(documentBucketName).getPublicUrl(filePath)
    .data.publicUrl;

  const { data, error } = await client
    .from("documents")
    .insert({
      organization_id: organizationId,
      customer_id: nullable(payload.customer_id),
      lead_id: nullable(payload.lead_id),
      project_id: nullable(payload.project_id),
      quotation_id: nullable(payload.quotation_id),
      document_type: payload.document_type,
      document_name: payload.document_name.trim(),
      file_url: publicUrl || filePath,
      file_path: filePath,
      file_size: payload.file.size,
      mime_type: payload.file.type || null,
      expiry_date: nullable(payload.expiry_date),
      notes: nullable(payload.notes),
      uploaded_by: profile?.id ?? null,
      status: "pending",
    })
    .select("*")
    .single();

  if (error) {
    await client.storage.from(documentBucketName).remove([filePath]);
    throw new Error(error.message);
  }

  return data as OrganizationDocument;
}

export async function deleteDocument(document: OrganizationDocument) {
  const client = requireSupabase();
  const { error } = await client.from("documents").delete().eq("id", document.id);

  if (error) {
    throw new Error(error.message);
  }

  await client.storage.from(documentBucketName).remove([document.file_path]);
}

export async function verifyDocument(documentId: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("verify_document", {
    document_id: documentId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as OrganizationDocument;
}

export async function rejectDocument(documentId: string, rejectionNote: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("reject_document", {
    document_id: documentId,
    rejection_note: rejectionNote,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as OrganizationDocument;
}

async function addPreviewUrls(documents: OrganizationDocumentWithRelations[]) {
  const client = requireSupabase();

  return Promise.all(
    documents.map(async (document) => {
      const { data } = await client.storage
        .from(documentBucketName)
        .createSignedUrl(document.file_path, 60 * 10);

      return {
        ...document,
        preview_url: data?.signedUrl ?? null,
      };
    }),
  );
}
