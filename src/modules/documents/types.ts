import type { SurveyCustomerSummary, SurveyLeadSummary } from "../site-surveys/types";

export type DocumentType =
  | "aadhaar"
  | "pan"
  | "electricity_bill"
  | "property_document"
  | "quotation_pdf"
  | "invoice_pdf"
  | "payment_receipt"
  | "site_photo"
  | "installation_photo"
  | "subsidy_document"
  | "bank_loan_document"
  | "agreement"
  | "other";

export type DocumentStatus = "pending" | "verified" | "rejected" | "expired";

export type DocumentProjectSummary = {
  id: string;
  project_code: string | null;
  project_name: string | null;
  customer_id: string;
  quotation_id: string | null;
};

export type DocumentQuotationSummary = {
  id: string;
  quotation_code: string | null;
  customer_id: string | null;
};

export type DocumentProfileSummary = {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
};

export type OrganizationDocument = {
  id: string;
  organization_id: string;
  customer_id: string | null;
  lead_id: string | null;
  project_id: string | null;
  quotation_id: string | null;
  invoice_id: string | null;
  document_type: DocumentType;
  document_name: string;
  file_url: string;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  expiry_date: string | null;
  notes: string | null;
  status: DocumentStatus | null;
  rejection_note: string | null;
  uploaded_by: string | null;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type OrganizationDocumentWithRelations = OrganizationDocument & {
  customer?: SurveyCustomerSummary | null;
  lead?: SurveyLeadSummary | null;
  project?: DocumentProjectSummary | null;
  quotation?: DocumentQuotationSummary | null;
  uploaded_by_profile?: DocumentProfileSummary | null;
  verified_by_profile?: DocumentProfileSummary | null;
  preview_url?: string | null;
};

export type DocumentUploadValues = {
  customer_id: string;
  lead_id: string;
  project_id: string;
  quotation_id: string;
  document_type: DocumentType;
  document_name: string;
  expiry_date: string;
  notes: string;
};

export type DocumentUploadPayload = DocumentUploadValues & {
  file: File;
};
