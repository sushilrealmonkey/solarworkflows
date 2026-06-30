import type { OrganizationBranding, UserProfile } from "../../app/AuthProvider";
import { buildInvoicePdf } from "../documents/businessPdf";
import {
  buildInvoicePdfPath,
  createGeneratedPdfPreviewUrl,
  fetchBusinessDocumentSettings,
  fetchGeneratedDocument,
  uploadGeneratedPdf,
} from "../documents/generatedPdfApi";
import type { InvoiceItem, InvoiceWithRelations } from "./types";

export async function generateAndStoreInvoicePdf(
  profile: UserProfile | null,
  organization: OrganizationBranding,
  invoice: InvoiceWithRelations,
  items: InvoiceItem[],
) {
  const settings = await fetchBusinessDocumentSettings();
  const filePath = invoicePdfPath(invoice, settings.invoice_prefix ?? "INV");
  const pdfBlob = await buildInvoicePdf(invoice, items, organization, settings);

  return uploadGeneratedPdf(
    profile,
    {
      document_type: "invoice_pdf",
      document_name: `${invoice.invoice_code ?? "Invoice"} PDF`,
      file_path: filePath,
      customer_id: invoice.customer_id,
      project_id: invoice.project_id,
      quotation_id: invoice.quotation_id,
      invoice_id: invoice.id,
      notes: "Generated invoice PDF",
    },
    pdfBlob,
  );
}

export async function fetchInvoicePdfPreviewUrl(invoice: InvoiceWithRelations) {
  const settings = await fetchBusinessDocumentSettings();
  const filePath = invoicePdfPath(invoice, settings.invoice_prefix ?? "INV");
  const document = await fetchGeneratedDocument(filePath);

  if (!document) {
    return null;
  }

  return createGeneratedPdfPreviewUrl(document.file_path);
}

function invoicePdfPath(invoice: InvoiceWithRelations, invoicePrefix: string) {
  return buildInvoicePdfPath(
    invoice.organization_id,
    invoice.invoice_code,
    invoicePrefix,
    invoice.id,
  );
}
