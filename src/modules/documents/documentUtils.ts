import { requiredError } from "../crm/crmUtils";
import type {
  DocumentStatus,
  DocumentType,
  DocumentUploadPayload,
  DocumentUploadValues,
  OrganizationDocumentWithRelations,
} from "./types";

export const documentBucketName = "organization-documents";

export const documentTypeOptions: DocumentType[] = [
  "aadhaar",
  "pan",
  "electricity_bill",
  "property_document",
  "quotation_pdf",
  "proforma_invoice_pdf",
  "purchase_order_pdf",
  "payment_receipt",
  "site_photo",
  "installation_photo",
  "subsidy_document",
  "bank_loan_document",
  "agreement",
  "other",
];

export const documentStatusOptions: DocumentStatus[] = [
  "pending",
  "verified",
  "rejected",
  "expired",
];

export function emptyDocumentUploadForm(
  defaults: Partial<DocumentUploadValues> = {},
): DocumentUploadValues {
  return {
    customer_id: defaults.customer_id ?? "",
    lead_id: defaults.lead_id ?? "",
    project_id: defaults.project_id ?? "",
    quotation_id: defaults.quotation_id ?? "",
    document_type: defaults.document_type ?? "other",
    document_name: defaults.document_name ?? "",
    expiry_date: defaults.expiry_date ?? "",
    notes: defaults.notes ?? "",
  };
}

export function validateDocumentUpload(values: DocumentUploadValues, file: File | null) {
  return {
    document_name: requiredError(values.document_name, "Document name"),
    document_type: requiredError(values.document_type, "Document type"),
    file: file ? "" : "File is required.",
  };
}

export function documentStatusTone(value: string | null | undefined) {
  if (value === "verified") {
    return "green" as const;
  }

  if (value === "rejected" || value === "expired") {
    return "red" as const;
  }

  return "amber" as const;
}

export function documentRelatedLabel(document: OrganizationDocumentWithRelations) {
  if (document.project) {
    return document.project.project_code ?? document.project.project_name ?? "Project";
  }

  if (document.customer) {
    return document.customer.full_name ?? document.customer.customer_code ?? "Customer";
  }

  if (document.lead) {
    return document.lead.full_name ?? document.lead.lead_code ?? "Lead";
  }

  if (document.quotation) {
    return document.quotation.quotation_code ?? "Quotation";
  }

  if (document.proforma_invoice) {
    return document.proforma_invoice.proforma_code ?? "Proforma Invoice";
  }

  if (document.purchase_order) {
    return document.purchase_order.purchase_code ?? "Purchase Order";
  }

  return "General";
}

export function buildDocumentFilePath(
  organizationId: string,
  values: DocumentUploadValues,
  file: File,
) {
  const scope = values.project_id || "general";
  const safeType = sanitizePathSegment(values.document_type || "other");
  const safeName = sanitizeFileName(file.name);
  return `${organizationId}/${scope}/${safeType}/${Date.now()}-${safeName}`;
}

export function fileSizeLabel(size: number | null | undefined) {
  if (!size) {
    return "-";
  }

  if (size < 1024 * 1024) {
    return `${Math.max(size / 1024, 1).toFixed(0)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function uploadPayload(
  values: DocumentUploadValues,
  file: File,
): DocumentUploadPayload {
  return {
    ...values,
    file,
  };
}

function sanitizePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
}

function sanitizeFileName(value: string) {
  const sanitized = value.replace(/[^a-zA-Z0-9._-]/g, "_");
  return sanitized || "document";
}
