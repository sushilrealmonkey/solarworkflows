import type { OrganizationBranding, UserProfile } from "../../app/AuthProvider";
import { buildQuotationPdf } from "../documents/businessPdf";
import {
  buildQuotationPdfPath,
  createGeneratedPdfPreviewUrl,
  fetchBusinessDocumentSettings,
  fetchGeneratedDocument,
  uploadGeneratedPdf,
} from "../documents/generatedPdfApi";
import type { QuotationItem, QuotationWithRelations } from "./types";

export async function generateAndStoreQuotationPdf(
  profile: UserProfile | null,
  organization: OrganizationBranding,
  quotation: QuotationWithRelations,
  items: QuotationItem[],
) {
  const settings = await fetchBusinessDocumentSettings();
  const filePath = quotationPdfPath(
    quotation,
    settings.quotation_prefix ?? "QUO",
  );
  const pdfBlob = await buildQuotationPdf(quotation, items, organization, settings);

  return uploadGeneratedPdf(
    profile,
    {
      document_type: "quotation_pdf",
      document_name: `${quotation.quotation_code ?? "Quotation"} PDF`,
      file_path: filePath,
      customer_id: quotation.customer_id,
      quotation_id: quotation.id,
      notes: "Generated quotation PDF",
    },
    pdfBlob,
  );
}

export async function fetchQuotationPdfPreviewUrl(
  quotation: QuotationWithRelations,
) {
  const settings = await fetchBusinessDocumentSettings();
  const filePath = quotationPdfPath(
    quotation,
    settings.quotation_prefix ?? "QUO",
  );
  const document = await fetchGeneratedDocument(filePath);

  if (!document) {
    return null;
  }

  return createGeneratedPdfPreviewUrl(document.file_path);
}

function quotationPdfPath(
  quotation: QuotationWithRelations,
  quotationPrefix: string,
) {
  return buildQuotationPdfPath(
    quotation.organization_id,
    quotation.quotation_code,
    quotationPrefix,
    quotation.id,
  );
}
