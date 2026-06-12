import { supabase } from "../../services/supabaseClient";
import type { UserProfile } from "../../app/AuthProvider";
import { documentBucketName } from "./documentUtils";
import type { DocumentType, OrganizationDocument } from "./types";
import type { OrganizationSettings } from "../settings/types";

export type GeneratedDocumentPayload = {
  document_type: Extract<DocumentType, "quotation_pdf" | "invoice_pdf">;
  document_name: string;
  file_path: string;
  customer_id: string | null;
  project_id?: string | null;
  quotation_id?: string | null;
  invoice_id?: string | null;
  notes?: string | null;
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

export async function fetchGeneratedDocument(filePath: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc("get_generated_document", {
    target_file_path: filePath,
  });

  if (error) {
    if (error.message.toLowerCase().includes("permission")) {
      return null;
    }

    throw new Error(error.message);
  }

  return (data ?? null) as OrganizationDocument | null;
}

export async function fetchBusinessDocumentSettings() {
  const client = requireSupabase();
  const { data, error } = await client.rpc("get_business_document_settings");

  if (error) {
    throw new Error(error.message);
  }

  return data as OrganizationSettings;
}

export async function uploadGeneratedPdf(
  profile: UserProfile | null,
  payload: GeneratedDocumentPayload,
  pdfBlob: Blob,
) {
  const client = requireSupabase();
  requireOrganization(profile);

  const uploadResult = await client.storage
    .from(documentBucketName)
    .upload(payload.file_path, pdfBlob, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadResult.error) {
    throw new Error(
      `${uploadResult.error.message}. Make sure the private Supabase Storage bucket "${documentBucketName}" exists.`,
    );
  }

  const publicUrl = client.storage.from(documentBucketName).getPublicUrl(payload.file_path)
    .data.publicUrl;

  const { data, error } = await client.rpc("upsert_generated_document", {
    target_document_type: payload.document_type,
    target_document_name: payload.document_name,
    target_file_url: publicUrl || payload.file_path,
    target_file_path: payload.file_path,
    target_file_size: pdfBlob.size,
    target_mime_type: "application/pdf",
    target_customer_id: payload.customer_id,
    target_project_id: payload.project_id ?? null,
    target_quotation_id: payload.quotation_id ?? null,
    target_invoice_id: payload.invoice_id ?? null,
    target_notes: payload.notes ?? null,
  });

  if (error) {
    throw new Error(error.message);
  }

  return {
    document: data as OrganizationDocument,
    previewUrl: await createGeneratedPdfPreviewUrl(payload.file_path),
  };
}

export async function createGeneratedPdfPreviewUrl(filePath: string) {
  const client = requireSupabase();
  const { data, error } = await client.storage
    .from(documentBucketName)
    .createSignedUrl(filePath, 60 * 10);

  if (error) {
    throw new Error(error.message);
  }

  return data.signedUrl;
}

export function buildQuotationPdfPath(
  organizationId: string,
  quotationCode: string | null,
  prefix: string,
  fallbackId: string,
) {
  return `${organizationId}/quotations/${sanitizePdfName(quotationCode || `${prefix}-${fallbackId.slice(0, 8)}`)}.pdf`;
}

export function buildInvoicePdfPath(
  organizationId: string,
  invoiceCode: string | null,
  prefix: string,
  fallbackId: string,
) {
  return `${organizationId}/invoices/${sanitizePdfName(invoiceCode || `${prefix}-${fallbackId.slice(0, 8)}`)}.pdf`;
}

function sanitizePdfName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_") || "document";
}
