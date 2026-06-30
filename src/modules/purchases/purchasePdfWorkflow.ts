import type { OrganizationBranding, UserProfile } from "../../app/AuthProvider";
import { buildPurchaseOrderPdf } from "../documents/businessPdf";
import {
  buildPurchaseOrderPdfPath,
  createGeneratedPdfPreviewUrl,
  fetchBusinessDocumentSettings,
  fetchGeneratedDocument,
  uploadGeneratedPdf,
} from "../documents/generatedPdfApi";
import type { PurchaseOrderWithRelations } from "./types";

export async function generateAndStorePurchaseOrderPdf(
  profile: UserProfile | null,
  organization: OrganizationBranding,
  order: PurchaseOrderWithRelations,
) {
  const settings = await fetchBusinessDocumentSettings();
  const filePath = purchaseOrderPdfPath(order);
  const pdfBlob = await buildPurchaseOrderPdf(order, organization, settings);

  return uploadGeneratedPdf(
    profile,
    {
      document_type: "purchase_order_pdf",
      document_name: `${order.purchase_code ?? "Purchase Order"} PDF`,
      file_path: filePath,
      customer_id: null,
      purchase_order_id: order.id,
      notes: "Generated purchase order PDF",
    },
    pdfBlob,
  );
}

export async function fetchPurchaseOrderPdfPreviewUrl(
  order: PurchaseOrderWithRelations,
) {
  const filePath = purchaseOrderPdfPath(order);
  const document = await fetchGeneratedDocument(filePath);

  if (!document) {
    return null;
  }

  return createGeneratedPdfPreviewUrl(document.file_path);
}

function purchaseOrderPdfPath(order: PurchaseOrderWithRelations) {
  return buildPurchaseOrderPdfPath(
    order.organization_id,
    order.purchase_code,
    "PO",
    order.id,
  );
}
