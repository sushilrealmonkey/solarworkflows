import type { OrganizationBranding, UserProfile } from "../../app/AuthProvider";
import { buildProformaInvoicePdf } from "../documents/businessPdf";
import {
  buildProformaInvoicePdfPath,
  createGeneratedPdfPreviewUrl,
  fetchBusinessDocumentSettings,
  fetchGeneratedDocument,
  uploadGeneratedPdf,
} from "../documents/generatedPdfApi";
import type {
  ProformaInvoiceItem,
  ProformaInvoiceWithRelations,
} from "./types";

export async function generateAndStoreProformaInvoicePdf(
  profile: UserProfile | null,
  organization: OrganizationBranding,
  proformaInvoice: ProformaInvoiceWithRelations,
  items: ProformaInvoiceItem[],
) {
  const settings = await fetchBusinessDocumentSettings();
  const filePath = proformaInvoicePdfPath(proformaInvoice);
  const pdfBlob = await buildProformaInvoicePdf(
    proformaInvoice,
    items,
    organization,
    settings,
  );

  return uploadGeneratedPdf(
    profile,
    {
      document_type: "proforma_invoice_pdf",
      document_name: `${proformaInvoice.proforma_code ?? "Proforma Invoice"} PDF`,
      file_path: filePath,
      customer_id: proformaInvoice.customer_id,
      project_id: proformaInvoice.project_id,
      quotation_id: proformaInvoice.quotation_id,
      proforma_invoice_id: proformaInvoice.id,
      notes: "Generated proforma invoice PDF",
    },
    pdfBlob,
  );
}

export async function fetchProformaInvoicePdfPreviewUrl(
  proformaInvoice: ProformaInvoiceWithRelations,
) {
  const document = await fetchGeneratedDocument(proformaInvoicePdfPath(proformaInvoice));

  if (!document) {
    return null;
  }

  return createGeneratedPdfPreviewUrl(document.file_path);
}

function proformaInvoicePdfPath(proformaInvoice: ProformaInvoiceWithRelations) {
  return buildProformaInvoicePdfPath(
    proformaInvoice.organization_id,
    proformaInvoice.proforma_code,
    "PI",
    proformaInvoice.id,
  );
}
