import type { OrganizationBranding } from "../../app/AuthProvider";
import type { TextOptionsLight } from "jspdf";
import trustSealImageUrl from "../../assets/govt-certified-vendor-seal.svg";
import quotationHeaderImageUrl from "../../assets/quotation-header-solar.jpg";
import type { OrganizationSettings } from "../settings/types";
import { formatCustomerAddress } from "../site-surveys/surveyUtils";
import type { InvoiceItem, InvoiceWithRelations } from "../invoices/types";
import type {
  ProformaInvoiceItem,
  ProformaInvoiceWithRelations,
} from "../proforma-invoices/types";
import type { PurchaseOrderWithRelations } from "../purchases/types";
import type {
  QuotationItem,
  QuotationMaterialItem,
  QuotationPaymentTerm,
  QuotationWarranty,
  QuotationWithRelations,
} from "../quotations/types";
import {
  calculateDiscountedTurnkeyTotals,
  calculateTurnkeyGstBreakdown,
  deriveQuotationMaterialSummary,
  formatIndianCurrencyInWords,
  hasTurnkeyGstAmount,
} from "../quotations/quotationUtils";

type PdfDocumentKind = "quotation" | "proforma_invoice" | "invoice" | "purchase_order";
type PdfDoc = InstanceType<typeof import("jspdf").jsPDF>;
type PdfImageData = {
  dataUrl: string;
  format: "PNG" | "JPEG";
};

type PdfLineItem = {
  name: string;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  gstPercent: number | null;
  lineTotal: number | null;
};

type Totals = {
  baseAmount: number | null;
  gstAmount: number | null;
  discountAmount: number | null;
  subsidyAmount?: number | null;
  totalAmount: number | null;
  amountPaid?: number | null;
  netPayableAmount: number | null;
};

type BusinessPdfInput = {
  kind: PdfDocumentKind;
  title: string;
  code: string;
  generatedTitle?: string | null;
  documentDate: string | null;
  dueDate?: string | null;
  organization: OrganizationBranding;
  settings: OrganizationSettings;
  customer: {
    name: string;
    code?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    extraLines?: string[];
  };
  partyTitle?: string;
  detailTitle?: string;
  details: Array<[string, string]>;
  projectSummaryLines?: string[];
  customerSummaryLines?: string[];
  items: PdfLineItem[];
  materialItems?: QuotationMaterialItem[];
  warrantyItems?: QuotationWarranty[];
  paymentTermItems?: QuotationPaymentTerm[];
  totals: Totals;
  companyName?: string | null;
  companyGstin?: string | null;
  companyMobile?: string | null;
  tagline?: string | null;
  certificationLine?: string | null;
  pricingLines?: string[];
  proposalScopeLines?: string[];
  commercialTermsLines?: string[];
  bankLines?: string[];
  paymentTerms?: string | null;
  termsAndConditions?: string | null;
  notes?: string | null;
};

const pageWidth = 210;
const pageHeight = 297;
const margin = 14;
const contentWidth = pageWidth - margin * 2;
const inrSymbol = "\u20b9";
const ptToMm = 0.3527777778;

export async function buildQuotationPdf(
  quotation: QuotationWithRelations,
  items: QuotationItem[],
  organization: OrganizationBranding,
  settings: OrganizationSettings,
) {
  return buildTechnicalCommercialProposalPdf(
    quotation,
    items,
    organization,
    settings,
  );
}

async function buildTechnicalCommercialProposalPdf(
  quotation: QuotationWithRelations,
  items: QuotationItem[],
  organization: OrganizationBranding,
  settings: OrganizationSettings,
) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const colors = {
    primary: normalizeHex(settings.primary_color, organization.primaryColor),
    accent: normalizeHex(settings.accent_color, organization.accentColor),
    text: "#17211f",
    muted: "#64748b",
    border: "#d7dedb",
    soft: "#f5f7f6",
  };
  const customer = quotation.customer;
  const customerName = customer?.full_name ?? quotation.lead?.full_name ?? "Customer";
  const customerPhone = customer?.phone ?? quotation.lead?.phone ?? "";
  const customerEmail = customer?.email ?? quotation.lead?.email ?? "";
  const siteLocation =
    quotation.installation_location ||
    (customer ? formatCustomerAddress(customer) : quotation.lead?.address) ||
    "";
  const totals = quotationPdfTotals(quotation);
  const companyName =
    settings.company_name || quotation.company_name || organization.name;
  const [logoDataUrl, headerImageDataUrl, trustSealDataUrl] = await Promise.all([
    fetchImageAsDataUrl(settings.company_logo_url),
    fetchCroppedImageAsDataUrl(quotationHeaderImageUrl, 1400, 560),
    fetchImageAsDataUrl(trustSealImageUrl),
  ]);

  drawTechnicalCoverPage(
    doc,
    quotation,
    {
      companyName,
      customerName,
      customerPhone,
      customerEmail,
      siteLocation,
      organization,
      settings,
      logoDataUrl,
      headerImageDataUrl,
      trustSealDataUrl,
    },
    colors,
  );

  doc.addPage();
  drawPageChrome(doc, colors.primary);
  let y = margin + 2;

  y = drawTechnicalProposalLetter(
    doc,
    quotation,
    {
      companyName,
      siteLocation,
      settings,
    },
    colors,
    y,
  );
  doc.addPage();
  drawPageChrome(doc, colors.primary);
  y = drawTechnicalQuotationSummary(
    doc,
    quotation,
    settings,
    colors,
    margin + 2,
  );
  y = drawTechnicalInstallationMaterial(
    doc,
    quotation.material_items ?? [],
    items,
    colors,
    y + 6,
  );
  y = drawTechnicalCommercialSummary(doc, totals, settings, colors, y + 6);
  y = drawTechnicalPaymentTerms(
    doc,
    quotation.quotation_payment_terms ?? [],
    settings,
    colors,
    y + 6,
  );
  y = drawTechnicalCommercialTerms(doc, quotation, colors, y + 6);
  y = drawTechnicalConsiderations(doc, quotation, colors, y + 6);
  y = drawTechnicalWarrantyTable(doc, quotation.quotation_warranties ?? [], colors, y + 6);
  y = moveToTechnicalSignaturePage(doc, colors.primary, y + 8);
  drawTechnicalSignature(doc, companyName, colors, y);

  return doc.output("blob");
}

export async function buildInvoicePdf(
  invoice: InvoiceWithRelations,
  items: InvoiceItem[],
  organization: OrganizationBranding,
  settings: OrganizationSettings,
) {
  const details: Array<[string, string]> = [
    [
      "Invoice Type",
      invoice.project_id
        ? "Project invoice"
        : invoice.b2b_sale_id
          ? "B2B sale invoice"
          : "Manual item invoice",
    ],
    ["Invoice Date", formatDate(invoice.invoice_date, settings.date_format)],
    ["Due Date", formatDate(invoice.due_date, settings.date_format)],
    ["Status", labelize(invoice.status)],
  ];

  if (invoice.project_id) {
    details.splice(
      3,
      0,
      ["Project", invoice.project?.project_code ?? invoice.project?.project_name ?? "-"],
      ["Quotation", invoice.quotation?.quotation_code ?? "-"],
    );
  } else if (invoice.b2b_sale_id) {
    details.splice(
      3,
      0,
      ["B2B Sale", invoice.b2b_sale?.sale_code ?? "-"],
    );
  }

  if (invoice.proforma_invoice_id) {
    details.splice(3, 0, [
      "Proforma Invoice",
      invoice.proforma_invoice?.proforma_code ?? "-",
    ]);
  }

  return buildBusinessPdf({
    kind: "invoice",
    title: "Invoice",
    code: invoice.invoice_code ?? "Invoice",
    documentDate: invoice.invoice_date,
    dueDate: invoice.due_date,
    organization,
    settings,
    customer: {
      name:
        invoice.customer?.business_name ||
        invoice.customer?.full_name ||
        "Customer",
      code: invoice.customer?.customer_code,
      phone: invoice.customer?.phone,
      email: invoice.customer?.email,
      address: invoice.customer ? formatCustomerAddress(invoice.customer) : null,
      extraLines: [
        invoice.customer?.contact_person_name
          ? `Contact: ${invoice.customer.contact_person_name}`
          : "",
        invoice.customer?.gst_number ? `GST: ${invoice.customer.gst_number}` : "",
      ].filter(Boolean),
    },
    details,
    items: items.map((item) => ({
      name: item.item_name,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unit_price,
      gstPercent: item.gst_percent,
      lineTotal: item.line_total,
    })),
    totals: {
      baseAmount: invoice.base_amount,
      gstAmount: invoice.gst_amount,
      discountAmount: invoice.discount_amount,
      totalAmount: invoice.total_amount,
      amountPaid: invoice.amount_paid,
      netPayableAmount: invoice.balance_due,
    },
    paymentTerms: "Pay by the due date mentioned on this invoice.",
    bankLines: settingsBankLines(settings),
    termsAndConditions:
      invoice.b2b_sale_id
        ? "This invoice is generated from SolarOS and is subject to the agreed B2B product sale terms."
        : "This invoice is generated from SolarOS and is subject to the agreed project terms.",
    notes: invoice.notes,
  });
}

export async function buildProformaInvoicePdf(
  proformaInvoice: ProformaInvoiceWithRelations,
  items: ProformaInvoiceItem[],
  organization: OrganizationBranding,
  settings: OrganizationSettings,
) {
  const details: Array<[string, string]> = [
    [
      "Proforma Type",
      proformaInvoice.project_id
        ? "Project proforma"
        : proformaInvoice.b2b_sale_id
          ? "B2B sale proforma"
          : "Manual proforma",
    ],
    ["PI Date", formatDate(proformaInvoice.proforma_date, settings.date_format)],
    ["Due Date", formatDate(proformaInvoice.due_date, settings.date_format)],
    ["Status", labelize(proformaInvoice.status)],
  ];

  if (proformaInvoice.project_id) {
    details.splice(
      3,
      0,
      [
        "Project",
        proformaInvoice.project?.project_code ??
          proformaInvoice.project?.project_name ??
          "-",
      ],
      ["Quotation", proformaInvoice.quotation?.quotation_code ?? "-"],
    );
  } else if (proformaInvoice.b2b_sale_id) {
    details.splice(
      3,
      0,
      ["B2B Sale", proformaInvoice.b2b_sale?.sale_code ?? "-"],
    );
  }

  return buildBusinessPdf({
    kind: "proforma_invoice",
    title: "Proforma Invoice",
    code: proformaInvoice.proforma_code ?? "Proforma Invoice",
    documentDate: proformaInvoice.proforma_date,
    dueDate: proformaInvoice.due_date,
    organization,
    settings,
    customer: {
      name:
        proformaInvoice.customer?.business_name ||
        proformaInvoice.customer?.full_name ||
        "Customer",
      code: proformaInvoice.customer?.customer_code,
      phone: proformaInvoice.customer?.phone,
      email: proformaInvoice.customer?.email,
      address: proformaInvoice.customer
        ? formatCustomerAddress(proformaInvoice.customer)
        : null,
      extraLines: [
        proformaInvoice.customer?.contact_person_name
          ? `Contact: ${proformaInvoice.customer.contact_person_name}`
          : "",
        proformaInvoice.customer?.gst_number
          ? `GST: ${proformaInvoice.customer.gst_number}`
          : "",
      ].filter(Boolean),
    },
    details,
    items: items.map((item) => ({
      name: item.item_name,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unit_price,
      gstPercent: item.gst_percent,
      lineTotal: item.line_total,
    })),
    totals: {
      baseAmount: proformaInvoice.base_amount,
      gstAmount: proformaInvoice.gst_amount,
      discountAmount: proformaInvoice.discount_amount,
      totalAmount: proformaInvoice.total_amount,
      amountPaid: proformaInvoice.amount_paid,
      netPayableAmount: proformaInvoice.balance_due,
    },
    paymentTerms: "Payment is requested against this proforma invoice before final invoice issuance.",
    bankLines: settingsBankLines(settings),
    termsAndConditions:
      "This proforma invoice is a payment request and is not the final tax invoice.",
    notes: proformaInvoice.notes,
  });
}

export async function buildPurchaseOrderPdf(
  order: PurchaseOrderWithRelations,
  organization: OrganizationBranding,
  settings: OrganizationSettings,
) {
  return buildBusinessPdf({
    kind: "purchase_order",
    title: "Purchase Order",
    code: order.purchase_code ?? "Purchase Order",
    documentDate: order.order_date,
    dueDate: order.expected_delivery_date,
    organization,
    settings,
    partyTitle: "Vendor Details",
    customer: {
      name: order.vendor?.vendor_name ?? "Vendor",
      code: order.vendor?.vendor_code,
      phone: order.vendor?.phone,
      email: order.vendor?.email,
      address: vendorAddress(order),
      extraLines: [
        order.vendor?.contact_person
          ? `Contact person: ${order.vendor.contact_person}`
          : "",
        order.vendor?.gst_number ? `GST: ${order.vendor.gst_number}` : "",
      ].filter(Boolean),
    },
    detailTitle: "Purchase Details",
    details: [
      ["Order Date", formatDate(order.order_date, settings.date_format)],
      [
        "Expected Delivery",
        formatDate(order.expected_delivery_date, settings.date_format),
      ],
      ["Status", labelize(order.status)],
      ["Created By", order.creator?.full_name ?? "-"],
    ],
    items: (order.items ?? []).map((item) => ({
      name: item.item?.item_name ?? "Inventory item",
      description:
        [item.item?.item_code, item.item?.brand, item.item?.model]
          .filter(Boolean)
          .join(" / ") || null,
      quantity: item.quantity,
      unit: item.item?.unit ?? null,
      unitPrice: item.unit_price,
      gstPercent: item.gst_percent,
      lineTotal: purchaseItemBaseAmount(item),
    })),
    totals: {
      baseAmount: order.subtotal,
      gstAmount: order.gst_amount,
      discountAmount: null,
      totalAmount: order.total_amount,
      netPayableAmount: order.total_amount,
    },
    termsAndConditions:
      "This purchase order is generated from SolarOS and is subject to the agreed vendor terms.",
    notes: order.notes,
  });
}

function drawTechnicalCoverPage(
  doc: PdfDoc,
  quotation: QuotationWithRelations,
  context: {
    companyName: string;
    customerName: string;
    customerPhone: string;
    customerEmail: string;
    siteLocation: string;
    organization: OrganizationBranding;
    settings: OrganizationSettings;
    logoDataUrl: PdfImageData | null;
    headerImageDataUrl: PdfImageData | null;
    trustSealDataUrl: PdfImageData | null;
  },
  colors: Record<string, string>,
) {
  drawPageChrome(doc, colors.primary);
  doc.setTextColor(colors.text);

  const mastheadY = margin - 2;
  if (context.logoDataUrl) {
    try {
      doc.addImage(
        context.logoDataUrl.dataUrl,
        context.logoDataUrl.format,
        margin,
        mastheadY,
        23,
        23,
      );
    } catch {
      drawLogoFallback(doc, context.organization.name, colors.primary, mastheadY);
    }
  } else {
    drawLogoFallback(doc, context.organization.name, colors.primary, mastheadY);
  }

  doc.setTextColor(colors.text);
  doc.setFont("helvetica", "bold");
  fitFontSize(doc, context.companyName, 130, 20, 14);
  doc.text(context.companyName, margin + 31, mastheadY + 8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.8);
  doc.setTextColor(colors.muted);
  drawWrappedLines(
    doc,
    companyHeaderLines(context.settings),
    margin + 31,
    mastheadY + 16,
    120,
    4.2,
  );
  drawTrustSeal(doc, context.trustSealDataUrl, pageWidth - margin - 24, mastheadY - 1, 24);

  const heroY = 42;
  const heroHeight = 132;
  if (context.headerImageDataUrl) {
    try {
      doc.addImage(
        context.headerImageDataUrl.dataUrl,
        context.headerImageDataUrl.format,
        0,
        heroY,
        pageWidth,
        heroHeight,
      );
    } catch {
      drawHeroImageFallback(doc, colors, heroY, heroHeight);
    }
  } else {
    drawHeroImageFallback(doc, colors, heroY, heroHeight);
  }
  const proposalTitle =
    technicalQuotationTitle(quotation) ||
    "Solar PV System";
  const proposalTitleLines = doc.splitTextToSize(proposalTitle, 170) as string[];
  const titleCardY = heroY + heroHeight - 58;
  const titleLineHeight = 7.2;
  const titleBlockHeight = Math.max(24, 15 + proposalTitleLines.length * titleLineHeight);
  const cardHeight = titleBlockHeight + 70;
  doc.setFillColor("#ffffff");
  doc.roundedRect(margin, titleCardY, contentWidth, cardHeight, 3, 3, "F");
  doc.setDrawColor(colors.border);
  doc.roundedRect(margin, titleCardY, contentWidth, cardHeight, 3, 3, "S");
  doc.setFillColor(colors.accent);
  doc.roundedRect(margin, titleCardY, 3.2, cardHeight, 2.5, 2.5, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(proposalTitleLines.length > 1 ? 16 : 18);
  doc.setTextColor(colors.primary);
  doc.text(
    proposalTitleLines,
    pageWidth / 2,
    titleCardY + 14,
    { align: "center", lineHeightFactor: 1.14 },
  );

  doc.setDrawColor(colors.border);
  doc.line(margin + 8, titleCardY + titleBlockHeight, pageWidth - margin - 8, titleCardY + titleBlockHeight);
  drawTechnicalClientHeaderCard(
    doc,
    quotation,
    context,
    colors,
    margin + 8,
    titleCardY + titleBlockHeight + 8,
    contentWidth - 16,
  );

  doc.setDrawColor(colors.accent);
  doc.setLineWidth(0.7);
  doc.line(72, 220, 138, 220);
  doc.setLineWidth(0.2);

  drawTechnicalCoverMetricStrip(doc, quotation, colors, 48, 233);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(colors.muted);
  doc.text(
    "This proposal is prepared for discussion and approval based on the available project information.",
    pageWidth / 2,
    pageHeight - 24,
    { align: "center" },
  );
}

function drawHeroImageFallback(
  doc: PdfDoc,
  colors: Record<string, string>,
  y: number,
  height: number,
) {
  doc.setFillColor(colors.soft);
  doc.rect(0, y, pageWidth, height, "F");
  doc.setFillColor(colors.primary);
  doc.rect(0, y + height - 3, pageWidth, 3, "F");
}

function drawTechnicalClientHeaderCard(
  doc: PdfDoc,
  quotation: QuotationWithRelations,
  context: {
    customerName: string;
    customerPhone: string;
    customerEmail: string;
    siteLocation: string;
    settings: OrganizationSettings;
  },
  colors: Record<string, string>,
  x: number,
  y: number,
  width: number,
) {
  const leftWidth = 104;
  const rightX = x + leftWidth + 16;
  const detailRows = compactRows([
    ["Quotation No.", quotation.quotation_code ?? ""],
    [
      "Date of Quotation",
      formatDate(quotation.quotation_date, context.settings.date_format),
    ],
    [
      "Valid Until",
      formatDate(
        oneMonthFromDate(quotation.quotation_date),
        context.settings.date_format,
      ),
    ],
  ]);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.8);
  doc.setTextColor(colors.accent);
  doc.text("Prepared for", x, y);
  doc.setFontSize(12);
  doc.setTextColor(colors.text);
  doc.text(doc.splitTextToSize(context.customerName, leftWidth) as string[], x, y + 8);

  const contactRows = compactRows([
    ["Contact", context.customerPhone],
    ["Email", context.customerEmail],
    ["Address", context.siteLocation],
  ]);
  let contactY = y + 20;
  contactRows.forEach(([label, value]) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(colors.muted);
    doc.text(label, x, contactY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(colors.text);
    const wrapped = doc.splitTextToSize(value, leftWidth - 28) as string[];
    doc.text(wrapped, x + 28, contactY, { lineHeightFactor: 1.16 });
    contactY += Math.max(5.2, wrapped.length * 3.8 + 1.4);
  });

  let rowY = y + 1.2;
  detailRows.forEach(([label, value]) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(colors.muted);
    doc.text(label, rightX, rowY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(colors.text);
    drawPdfText(doc, value, x + width, rowY, { align: "right" });
    rowY += 8;
  });
}

function drawTechnicalCoverMetricStrip(
  doc: PdfDoc,
  quotation: QuotationWithRelations,
  colors: Record<string, string>,
  x: number,
  y: number,
) {
  const metrics = compactRows([
    ["System Type", displayValue(quotation.system_type)],
    ["Panel Type", displayValue(quotation.module_category)],
    ["Site Type", displayValue(quotation.site_type)],
  ]).slice(0, 3);

  if (metrics.length === 0) {
    return;
  }

  const boxWidth = 38;
  const gap = 6;
  const totalWidth = metrics.length * boxWidth + (metrics.length - 1) * gap;
  let metricX = x + (contentWidth - (x - margin) * 2 - totalWidth) / 2;
  metrics.forEach(([label, value]) => {
    doc.setDrawColor(colors.border);
    doc.setFillColor("#ffffff");
    doc.roundedRect(metricX, y, boxWidth, 22, 2, 2, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.2);
    doc.setTextColor(colors.muted);
    doc.text(label, metricX + boxWidth / 2, y + 7, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.2);
    doc.setTextColor(colors.text);
    doc.text(
      doc.splitTextToSize(value, boxWidth - 6) as string[],
      metricX + boxWidth / 2,
      y + 14,
      { align: "center", lineHeightFactor: 1.1 },
    );
    metricX += boxWidth + gap;
  });
}

function drawTechnicalProposalLetter(
  doc: PdfDoc,
  quotation: QuotationWithRelations,
  context: {
    companyName: string;
    siteLocation: string;
    settings: OrganizationSettings;
  },
  colors: Record<string, string>,
  y: number,
) {
  y = ensureSpace(doc, y, 130, colors.primary);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(colors.primary);
  doc.text("Technical & Commercial Proposal", margin, y + 6);
  doc.setDrawColor(colors.border);
  doc.line(margin, y + 9, pageWidth - margin, y + 9);

  const offerLines = doc.splitTextToSize(
    "Thank you for giving us the opportunity to work with you. Following is our detailed offer for your requirements.",
    contentWidth,
  ) as string[];
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.6);
  doc.setTextColor(colors.text);
  doc.text(offerLines, margin, y + 22, { lineHeightFactor: 1.22 });

  y += 31 + offerLines.length * 4.2;
  y = drawTechnicalSectionHeading(doc, "Project Summary", colors, y);

  y = drawTechnicalTable(
    doc,
    ["Particulars", "Details"],
    [86, 100],
    [
      ["Proposed installation size", valueWithUnit(quotation.system_capacity_kw, "kW")],
      ["Customer Type", displayValue(quotation.customer_type)],
      ["System Type", displayValue(quotation.system_type)],
      ["Panel Category", displayValue(quotation.module_category)],
      ["Site Type", displayValue(quotation.site_type)],
      ["Expected Annual Generation", valueWithUnit(quotation.expected_annual_generation_kwh, "kWh")],
    ],
    colors,
    y,
  );

  const noteLines = [
    "The generation is mapped on an estimated basis considering site conditions, weather, grid availability,",
    "module efficiency, inverter loss, soiling loss, and other important project factors.",
    "We suggest a regular module cleaning cycle to achieve optimum output.",
  ];
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.6);
  doc.setTextColor(colors.text);
  doc.text(noteLines, margin + 3, y + 9, { lineHeightFactor: 1.35 });

  y += 23 + noteLines.length * 4.4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(`For ${context.companyName}`, margin, y);
  doc.setDrawColor(colors.border);
  doc.line(margin, y + 18, margin + 52, y + 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(colors.muted);
  doc.text("Authorised Signatory", margin, y + 25);

  return y + 33;
}

function drawTechnicalInstallationMaterial(
  doc: PdfDoc,
  materialItems: QuotationMaterialItem[],
  items: QuotationItem[],
  colors: Record<string, string>,
  y: number,
) {
  const materialRows = materialItems
    .filter(hasTechnicalMaterialRow)
    .map((item) => ({
      description: displayValue(item.description),
      makeSpecification:
        [item.brand, item.specification]
          .filter(isPresentText)
          .map(displayValue)
          .join(" / ") || displayValue(item.make_specification),
      quantity: displayValue(item.quantity),
      unit: displayValue(item.unit || "pcs"),
    }));
  const rows =
    materialRows.length > 0
      ? materialRows
      : items.map((item) => ({
          description: displayValue(item.material || item.item_name),
          makeSpecification: [item.specification || item.description, item.make]
            .filter(isPresentText)
            .map(displayValue)
            .join(" / "),
          quantity:
            item.quantity === null || item.quantity === undefined
              ? ""
              : String(item.quantity),
          unit: formatUnit(item.unit),
        }));
  const printableRows = rows.filter((item) =>
    [item.description, item.makeSpecification, item.quantity, item.unit].some(
      isPresentText,
    ),
  );

  if (printableRows.length === 0) {
    return y;
  }

  y = drawTechnicalSectionHeading(doc, "Installation Material", colors, y);
  return drawTechnicalTable(
    doc,
    ["Sr.", "Item Description", "Make / Specification", "Qty", "Unit"],
    [12, 54, 78, 22, 20],
    printableRows.map((row, index) => [
      String(index + 1),
      row.description,
      row.makeSpecification,
      row.quantity,
      row.unit,
    ]),
    colors,
    y,
  );
}

function hasTechnicalMaterialRow(item: QuotationMaterialItem) {
  return [
    item.description,
    item.brand,
    item.specification,
    item.make_specification,
    item.quantity,
    item.unit,
  ].some(isPresentText);
}

function drawTechnicalQuotationSummary(
  doc: PdfDoc,
  quotation: QuotationWithRelations,
  settings: OrganizationSettings,
  colors: Record<string, string>,
  y: number,
) {
  const materialSummary = deriveQuotationMaterialSummary(quotation.material_items);
  const totals = quotationPdfTotals(quotation);
  const moduleWattage =
    quotation.summary_module_wattage ??
    materialSummary.summary_module_wattage;
  const systemRows = compactRows([
    [
      "Panel Brand",
      quotation.summary_module_brand ?? materialSummary.summary_module_brand ?? "",
    ],
    ["Panel Wattage", valueWithUnit(moduleWattage, "W")],
    [
      "Inverter Brand",
      quotation.summary_inverter_brand ??
        materialSummary.summary_inverter_brand ??
        "",
    ],
    ["Total Turnkey Cost", quotation.summary_total_turnkey_cost === null || quotation.summary_total_turnkey_cost === undefined ? "" : formatAmount(quotation.summary_total_turnkey_cost, settings.currency)],
    [
      "Final Taxable Amount In Words",
      totals.baseAmount === null || totals.baseAmount === undefined
        ? ""
        : formatIndianCurrencyInWords(totals.baseAmount),
    ],
    ["Amount In Words", quotation.summary_amount_in_words ?? ""],
  ]);

  if (systemRows.length === 0) {
    return y;
  }

  y = drawTechnicalSectionHeading(doc, "Quotation Summary", colors, y);
  return drawTechnicalTable(
    doc,
    ["Particulars", "Details"],
    [86, 100],
    systemRows,
    colors,
    y,
  );
}

function drawTechnicalCommercialSummary(
  doc: PdfDoc,
  totals: Totals,
  settings: OrganizationSettings,
  colors: Record<string, string>,
  y: number,
) {
  const amountRows = compactRows([
    ["Base Amount", formatNonZeroOrPresent(totals.baseAmount, settings.currency)],
    ["GST Amount", formatNonZeroOrPresent(totals.gstAmount, settings.currency)],
    ["Discount", Number(totals.discountAmount ?? 0) > 0 ? formatAmount(totals.discountAmount, settings.currency) : ""],
    ["Total Amount", formatNonZeroOrPresent(totals.totalAmount, settings.currency)],
    ["Subsidy", Number(totals.subsidyAmount ?? 0) > 0 ? formatAmount(totals.subsidyAmount, settings.currency) : ""],
  ]);

  if (amountRows.length === 0) {
    return y;
  }

  y = drawTechnicalSectionHeading(doc, "Commercial Summary", colors, y);
  y = drawTechnicalTable(
    doc,
    ["Particulars", "Amount"],
    [106, 80],
    amountRows,
    colors,
    y,
  );

  const disclaimerLines = doc.splitTextToSize(
    "The subsidy amount will be credited to your bank account directly.",
    contentWidth,
  ) as string[];
  y = ensureSpace(doc, y + 6, disclaimerLines.length * 4.2 + 4, colors.primary);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.6);
  doc.setTextColor(colors.text);
  doc.text(disclaimerLines, margin, y, { lineHeightFactor: 1.2 });

  return y + disclaimerLines.length * 4.2;
}

function drawTechnicalCommercialTerms(
  doc: PdfDoc,
  quotation: QuotationWithRelations,
  colors: Record<string, string>,
  y: number,
) {
  const blocks = compactBlocks([
    ["Price Basis", quotation.commercial_price_basis],
    ["GST Terms", quotation.commercial_gst_terms],
    ["Security Deposit / DISCOM Charges Terms", quotation.commercial_security_deposit_terms],
    ["Transit Insurance", quotation.commercial_transit_insurance],
    ["Storage and Insurance at Site", quotation.commercial_site_storage_insurance],
    ["Project Initiation", quotation.commercial_project_initiation],
    ["Warranty Applicability", quotation.commercial_warranty_applicability],
  ]);

  return drawTechnicalTextBlocks(
    doc,
    "Terms and Conditions",
    blocks,
    colors,
    y,
  );
}

function drawTechnicalConsiderations(
  doc: PdfDoc,
  quotation: QuotationWithRelations,
  colors: Record<string, string>,
  y: number,
) {
  const blocks = compactBlocks([
    ["Included Scope", quotation.proposal_included_scope],
    ["Client Responsibilities", quotation.proposal_client_responsibilities],
    ["Important Considerations", quotation.proposal_important_considerations],
    ["Exclusions", quotation.proposal_exclusions],
  ]);

  return drawTechnicalTextBlocks(
    doc,
    "Important Considerations / Exclusions",
    blocks,
    colors,
    y,
  );
}

function drawTechnicalWarrantyTable(
  doc: PdfDoc,
  warranties: QuotationWarranty[],
  colors: Record<string, string>,
  y: number,
) {
  const rows = warranties
    .slice()
    .sort((first, second) => (first.sort_order ?? 0) - (second.sort_order ?? 0))
    .filter((warranty) =>
      [warranty.component, warranty.warranty_text].some(isPresentText),
    )
    .map((warranty, index) => [
      String(index + 1),
      warranty.component || "",
      warranty.warranty_text || "",
    ]);

  if (rows.length === 0) {
    return y;
  }

  y = drawTechnicalSectionHeading(doc, "Warranties", colors, y);
  return drawTechnicalTable(doc, ["Sr.", "Component", "Warranty"], [14, 58, 114], rows, colors, y);
}

function drawTechnicalPaymentTerms(
  doc: PdfDoc,
  paymentTerms: QuotationPaymentTerm[],
  settings: OrganizationSettings,
  colors: Record<string, string>,
  y: number,
) {
  const rows = paymentTerms
    .slice()
    .sort((first, second) => (first.sort_order ?? 0) - (second.sort_order ?? 0))
    .filter((paymentTerm) =>
      [paymentTerm.milestone, paymentTerm.percentage, paymentTerm.amount].some(
        isPresentText,
      ),
    )
    .map((paymentTerm, index) => [
      String(index + 1),
      paymentTerm.milestone || "",
      paymentTerm.percentage === null || paymentTerm.percentage === undefined
        ? ""
        : `${paymentTerm.percentage}%`,
      paymentTerm.amount === null || paymentTerm.amount === undefined
        ? ""
        : formatAmount(paymentTerm.amount, settings.currency),
    ]);

  if (rows.length === 0) {
    return y;
  }

  y = drawTechnicalSectionHeading(doc, "Payment Terms", colors, y);
  return drawTechnicalTable(doc, ["Sr.", "Milestone", "%", "Amount"], [14, 88, 28, 56], rows, colors, y) + 4;
}

function drawTechnicalSignature(
  doc: PdfDoc,
  companyName: string,
  colors: Record<string, string>,
  y: number,
) {
  const boxWidth = 82;
  const x = pageWidth - margin - boxWidth;
  y = ensureSpace(doc, y, 34, colors.primary);
  drawBox(doc, x, y, boxWidth, 30, "Authorized Sign & Seal", colors);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(colors.muted);
  doc.text(`For ${companyName}`, x + 4, y + 15);
  doc.setDrawColor(colors.border);
  doc.line(x + 4, y + 23, x + boxWidth - 4, y + 23);
  doc.text("Authorized Signatory", x + boxWidth - 4, y + 27, { align: "right" });
}

function moveToTechnicalSignaturePage(
  doc: PdfDoc,
  primary: string,
  fallbackY: number,
) {
  while (doc.getNumberOfPages() < 5) {
    doc.addPage();
    drawPageChrome(doc, primary);
  }

  return doc.getNumberOfPages() === 5 ? pageHeight - 60 : fallbackY;
}

function drawTechnicalSectionHeading(
  doc: PdfDoc,
  title: string,
  colors: Record<string, string>,
  y: number,
) {
  y = ensureSpace(doc, y, 14, colors.primary);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(colors.primary);
  doc.text(title, margin, y + 6);
  doc.setDrawColor(colors.border);
  doc.line(margin, y + 9, pageWidth - margin, y + 9);
  return y + 14;
}

function drawTechnicalTextBlocks(
  doc: PdfDoc,
  title: string,
  blocks: Array<[string, string]>,
  colors: Record<string, string>,
  y: number,
) {
  if (blocks.length === 0) {
    return y;
  }

  y = drawTechnicalSectionHeading(doc, title, colors, y);
  blocks.forEach(([label, value]) => {
    const wrapped = doc.splitTextToSize(value, contentWidth - 8) as string[];
    const height = Math.max(14, wrapped.length * 4.2 + 12);
    y = ensureSpace(doc, y, height + 4, colors.primary);
    drawBox(doc, margin, y, contentWidth, height, label, colors);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(colors.text);
    doc.text(wrapped, margin + 4, y + 13);
    y += height + 4;
  });

  return y;
}

function drawTechnicalTable(
  doc: PdfDoc,
  headers: string[],
  widths: number[],
  rows: string[][],
  colors: Record<string, string>,
  y: number,
) {
  if (rows.length === 0) {
    return y;
  }

  const printableRows = rows.filter((row) => row.some(isPresentText));
  if (printableRows.length === 0) {
    return y;
  }

  y = ensureSpace(doc, y, 24, colors.primary);
  doc.setFillColor(colors.primary);
  doc.roundedRect(margin, y, contentWidth, 8, 1.5, 1.5, "F");
  doc.setTextColor("#ffffff");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  let x = margin + 3;
  headers.forEach((header, index) => {
    doc.text(header, x, y + 5.3);
    x += widths[index];
  });

  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  printableRows.forEach((row) => {
    const wrappedCells = row.map((cell, index) =>
      doc.splitTextToSize(cell, widths[index] - 4) as string[],
    );
    const rowHeight = Math.max(
      8,
      Math.max(...wrappedCells.map((cell) => cell.length)) * 4 + 4,
    );
    y = ensureSpace(doc, y, rowHeight + 10, colors.primary);
    doc.setDrawColor(colors.border);
    doc.line(margin, y, pageWidth - margin, y);
    doc.setTextColor(colors.text);
    let cellX = margin + 3;
    wrappedCells.forEach((cell, index) => {
      drawPdfText(doc, cell, cellX, y + 5);
      cellX += widths[index];
    });
    y += rowHeight;
  });
  doc.line(margin, y, pageWidth - margin, y);
  return y;
}

async function buildBusinessPdf(input: BusinessPdfInput) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const colors = {
    primary: normalizeHex(input.settings.primary_color, input.organization.primaryColor),
    accent: normalizeHex(input.settings.accent_color, input.organization.accentColor),
    text: "#17211f",
    muted: "#64748b",
    border: "#d7dedb",
    soft: "#f5f7f6",
  };

  let y = margin;
  drawPageChrome(doc, colors.primary);

  const [logoDataUrl, trustSealDataUrl] = await Promise.all([
    fetchImageAsDataUrl(input.settings.company_logo_url),
    fetchImageAsDataUrl(trustSealImageUrl),
  ]);
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl.dataUrl, logoDataUrl.format, margin, y, 24, 24);
    } catch {
      drawLogoFallback(doc, input.organization.name, colors.primary, y);
    }
  } else {
    drawLogoFallback(doc, input.organization.name, colors.primary, y);
  }

  doc.setTextColor(colors.text);
  doc.setFont("helvetica", "bold");
  fitFontSize(doc, companyDisplayName(input), 94, 18, 13);
  doc.text(companyDisplayName(input), margin + 31, y + 7);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.8);
  const organizationLines = [
    input.tagline,
    input.certificationLine,
    input.settings.contact_person
      ? `Contact person: ${input.settings.contact_person}`
      : null,
    ...companyHeaderLines(input.settings, {
      phone: input.companyMobile,
      gstNumber: input.companyGstin,
    }),
  ]
    .map(cleanPdfText)
    .filter(isPresentText);
  y = drawWrappedLines(doc, organizationLines, margin + 31, y + 14, 94, 4.2);
  drawTrustSeal(doc, trustSealDataUrl, pageWidth - margin - 61, margin - 1, 25);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(colors.primary);
  doc.text(input.title, pageWidth - margin, margin + 7, { align: "right" });
  doc.setFontSize(10);
  doc.setTextColor(colors.text);
  doc.text(input.code, pageWidth - margin, margin + 15, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setTextColor(colors.muted);
  doc.text(
    formatDate(input.documentDate, input.settings.date_format),
    pageWidth - margin,
    margin + 21,
    { align: "right" },
  );

  y = Math.max(y + 8, 48);
  y = drawPartyAndDetails(doc, input, colors, y);
  if (input.kind === "quotation" && input.generatedTitle) {
    y = drawGeneratedTitle(doc, input.generatedTitle, colors, y + 6);
  }
  y = drawProjectSummary(doc, input, colors, y + 6);
  y = drawCustomerSummary(doc, input, colors, y + 6);
  y = drawWarrantyTable(doc, input, colors, y + 6);
  y = drawMaterialTable(doc, input, colors, y + 6);
  y = drawItemsTable(doc, input, colors, y + 6);
  y = drawPricingDetails(doc, input, colors, y + 6);
  y = drawProposalScope(doc, input, colors, y + 6);
  y = drawCommercialTerms(doc, input, colors, y + 6);
  y = drawTotals(doc, input, colors, y + 6);
  y = drawPaymentTermTable(doc, input, colors, y + 6);
  y = drawTerms(doc, input, colors, y + 6);
  y = ensureSpace(doc, y + 6, 40, colors.primary);
  drawSignature(doc, input, colors, y);

  return doc.output("blob");
}

function companyDisplayName(input: BusinessPdfInput) {
  return (
    input.settings.company_name ||
    input.companyName ||
    input.organization.name
  );
}

function companyHeaderLines(
  settings: OrganizationSettings,
  overrides: { phone?: string | null; gstNumber?: string | null } = {},
) {
  const address = cleanPdfText(settings.address);
  const phone = cleanPdfText(overrides.phone || settings.contact_phone);
  const email = cleanPdfText(settings.contact_email);
  const gstNumber = cleanPdfText(overrides.gstNumber || settings.gst_number);
  const details = cleanPdfText(settings.company_details);
  const contactParts = [
    phone ? `Contact - ${phone}` : "",
    email ? `Email - ${email}` : "",
  ].filter(Boolean);
  const hasCompanyHeaderDetails =
    details || address || phone || email || gstNumber;

  return [
    details,
    hasCompanyHeaderDetails ? `Address - ${address}` : "",
    contactParts.join(" | "),
    gstNumber ? `GST no. - ${gstNumber}` : "",
  ].filter(Boolean);
}

function settingsBankLines(
  settings: OrganizationSettings,
  legacy?: {
    accountHolderName?: string | null;
    gstNumber?: string | null;
    bankName?: string | null;
    ifscCode?: string | null;
    accountNumber?: string | null;
    accountType?: string | null;
  },
) {
  const accountHolderName =
    settings.bank_account_holder_name || legacy?.accountHolderName;
  const gstNumber = settings.gst_number || legacy?.gstNumber;
  const bankName = settings.bank_name || legacy?.bankName;
  const ifscCode = settings.bank_ifsc_code || legacy?.ifscCode;
  const accountNumber =
    settings.bank_account_number || legacy?.accountNumber;
  const accountType = settings.bank_account_type || legacy?.accountType;

  return [
    accountHolderName ? `Account holder: ${accountHolderName}` : "",
    gstNumber ? `GST: ${gstNumber}` : "",
    bankName ? `Bank: ${bankName}` : "",
    ifscCode ? `IFSC: ${ifscCode}` : "",
    accountNumber ? `Account: ${accountNumber}` : "",
    accountType ? `Type: ${accountType}` : "",
  ].filter(Boolean);
}

function drawPageChrome(doc: PdfDoc, primary: string) {
  doc.setFillColor(primary);
  doc.rect(0, 0, pageWidth, 4, "F");
}

function fitFontSize(
  doc: PdfDoc,
  text: string,
  maxWidth: number,
  preferredSize: number,
  minimumSize: number,
) {
  let size = preferredSize;
  doc.setFontSize(size);

  while (size > minimumSize && doc.getTextWidth(text) > maxWidth) {
    size -= 0.5;
    doc.setFontSize(size);
  }

  return size;
}

function drawTrustSeal(
  doc: PdfDoc,
  trustSealDataUrl: PdfImageData | null,
  x: number,
  y: number,
  size: number,
) {
  if (!trustSealDataUrl) {
    return;
  }

  try {
    doc.addImage(trustSealDataUrl.dataUrl, trustSealDataUrl.format, x, y, size, size);
  } catch {
    // Seal is decorative trust metadata; skip rather than blocking document export.
  }
}

function drawLogoFallback(doc: PdfDoc, organizationName: string, primary: string, y: number) {
  doc.setFillColor(primary);
  doc.roundedRect(margin, y, 24, 24, 2, 2, "F");
  doc.setTextColor("#ffffff");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(initials(organizationName), margin + 12, y + 15, { align: "center" });
}

function drawPartyAndDetails(
  doc: PdfDoc,
  input: BusinessPdfInput,
  colors: Record<string, string>,
  y: number,
) {
  const columnWidth = (contentWidth - 6) / 2;
  const boxHeight = Math.max(
    input.kind === "quotation" ? 50 : 42,
    18 + input.details.length * 4.6,
  );
  drawBox(doc, margin, y, columnWidth, boxHeight, input.partyTitle ?? "Customer Details", colors);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(colors.text);
  doc.text(input.customer.name, margin + 4, y + 13);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  drawWrappedLines(
    doc,
    [
      input.customer.code ? `Code: ${input.customer.code}` : "",
      input.customer.phone ? `Phone: ${input.customer.phone}` : "",
      input.customer.email ? `Email: ${input.customer.email}` : "",
      input.customer.address ?? "",
      ...(input.customer.extraLines ?? []),
    ].filter(Boolean),
    margin + 4,
    y + 19,
    columnWidth - 8,
    4,
  );

  const rightX = margin + columnWidth + 6;
  drawBox(doc, rightX, y, columnWidth, boxHeight, input.detailTitle ?? "Document Details", colors);
  let detailY = y + 13;
  input.details.forEach(([label, value]) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(colors.muted);
    doc.text(label, rightX + 4, detailY);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(colors.text);
    doc.text(value || "-", rightX + columnWidth - 4, detailY, { align: "right" });
    detailY += 4.6;
  });

  return y + boxHeight;
}

function drawProjectSummary(
  doc: PdfDoc,
  input: BusinessPdfInput,
  colors: Record<string, string>,
  y: number,
) {
  if (input.kind !== "quotation" || !input.projectSummaryLines?.length) {
    return y;
  }

  return drawTextCard(doc, "Project Summary", input.projectSummaryLines, colors, y);
}

function drawCustomerSummary(
  doc: PdfDoc,
  input: BusinessPdfInput,
  colors: Record<string, string>,
  y: number,
) {
  if (input.kind !== "quotation" || !input.customerSummaryLines?.length) {
    return y;
  }

  return drawTextCard(
    doc,
    "Customer Quotation Summary",
    input.customerSummaryLines,
    colors,
    y,
  );
}

function drawGeneratedTitle(
  doc: PdfDoc,
  title: string,
  colors: Record<string, string>,
  y: number,
) {
  y = ensureSpace(doc, y, 14, colors.primary);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(colors.primary);
  doc.text(title, pageWidth / 2, y + 7, { align: "center" });
  return y + 11;
}

function drawItemsTable(
  doc: PdfDoc,
  input: BusinessPdfInput,
  colors: Record<string, string>,
  y: number,
) {
  const items = input.items.filter(hasPrintableLineItem);
  if (items.length === 0) {
    return y;
  }

  const headers = ["Item", "Qty", "Rate", "GST", "Amount"];
  const widths = [76, 22, 30, 24, 34];
  y = ensureSpace(doc, y, 36, colors.primary);
  doc.setFillColor(colors.primary);
  doc.roundedRect(margin, y, contentWidth, 8, 1.5, 1.5, "F");
  doc.setTextColor("#ffffff");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);

  let x = margin + 3;
  headers.forEach((header, index) => {
    doc.text(header, x, y + 5.3, { align: index === 0 ? "left" : "right" });
    x += widths[index];
  });

  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);

  items.forEach((item) => {
    const descriptionLines = doc.splitTextToSize(
      [displayValue(item.name), displayValue(item.description)]
        .filter(isPresentText)
        .join(" - "),
      widths[0] - 4,
    ) as string[];
    const rowHeight = Math.max(8, descriptionLines.length * 4 + 4);
    y = ensureSpace(doc, y, rowHeight + 10, colors.primary);

    doc.setDrawColor(colors.border);
    doc.line(margin, y, pageWidth - margin, y);
    doc.setTextColor(colors.text);
    doc.text(descriptionLines, margin + 3, y + 5);
    doc.text(formatQuantity(item), margin + widths[0] + 22, y + 5, {
      align: "right",
    });
    drawPdfText(
      doc,
      formatOptionalAmount(item.unitPrice, input.settings.currency),
      margin + widths[0] + widths[1] + 30,
      y + 5,
      { align: "right" },
    );
    doc.text(
      item.gstPercent === null || item.gstPercent === undefined
        ? ""
        : `${Number(item.gstPercent)}%`,
      margin + widths[0] + widths[1] + widths[2] + 24,
      y + 5,
      { align: "right" },
    );
    drawPdfText(
      doc,
      formatOptionalAmount(lineGrossAmount(item), input.settings.currency),
      pageWidth - margin - 3,
      y + 5,
      { align: "right" },
    );
    y += rowHeight;
  });

  doc.line(margin, y, pageWidth - margin, y);
  return y;
}

function drawMaterialTable(
  doc: PdfDoc,
  input: BusinessPdfInput,
  colors: Record<string, string>,
  y: number,
) {
  const materials = (input.materialItems ?? []).filter((item) =>
    [
      item.description,
      item.brand,
      item.specification,
      item.make_specification,
      item.quantity,
      item.unit,
    ].some(isPresentText),
  );
  if (materials.length === 0) {
    return y;
  }

  y = ensureSpace(doc, y, 42, colors.primary);
  const headers = ["Sr.", "Item Description", "Brand", "Specification", "Qty", "Unit"];
  const widths = [12, 50, 38, 56, 16, 14];
  doc.setFillColor(colors.primary);
  doc.roundedRect(margin, y, contentWidth, 8, 1.5, 1.5, "F");
  doc.setTextColor("#ffffff");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);

  let x = margin + 3;
  headers.forEach((header, index) => {
    doc.text(header, x, y + 5.3);
    x += widths[index];
  });

  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  materials.forEach((item, index) => {
    const descriptionLines = doc.splitTextToSize(
      displayValue(item.description),
      widths[1] - 4,
    ) as string[];
    const brandLines = doc.splitTextToSize(
      displayValue(item.brand),
      widths[2] - 4,
    ) as string[];
    const specLines = doc.splitTextToSize(
      displayValue(item.specification || item.make_specification),
      widths[3] - 4,
    ) as string[];
    const rowHeight = Math.max(
      8,
      Math.max(descriptionLines.length, brandLines.length, specLines.length) * 4 + 4,
    );
    y = ensureSpace(doc, y, rowHeight + 10, colors.primary);
    doc.setDrawColor(colors.border);
    doc.line(margin, y, pageWidth - margin, y);
    doc.setTextColor(colors.text);
    doc.text(String(index + 1), margin + 3, y + 5);
    doc.text(descriptionLines, margin + widths[0] + 3, y + 5);
    doc.text(brandLines, margin + widths[0] + widths[1] + 3, y + 5);
    doc.text(specLines, margin + widths[0] + widths[1] + widths[2] + 3, y + 5);
    doc.text(item.quantity || "", margin + widths[0] + widths[1] + widths[2] + widths[3] + 3, y + 5);
    doc.text(item.quantity ? formatUnit(item.unit) : "", pageWidth - margin - widths[5] + 3, y + 5);
    y += rowHeight;
  });
  doc.line(margin, y, pageWidth - margin, y);
  return y;
}

function drawWarrantyTable(
  doc: PdfDoc,
  input: BusinessPdfInput,
  colors: Record<string, string>,
  y: number,
) {
  const warranties = input.warrantyItems ?? [];
  if (input.kind !== "quotation" || warranties.length === 0) {
    return y;
  }

  y = ensureSpace(doc, y, 36, colors.primary);
  const headers = ["Sr.", "Component", "Warranty"];
  const widths = [16, 58, 112];
  doc.setFillColor(colors.primary);
  doc.roundedRect(margin, y, contentWidth, 8, 1.5, 1.5, "F");
  doc.setTextColor("#ffffff");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);

  let x = margin + 3;
  headers.forEach((header, index) => {
    doc.text(header, x, y + 5.3);
    x += widths[index];
  });

  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  warranties.forEach((warranty, index) => {
    const componentLines = doc.splitTextToSize(
      warranty.component || "-",
      widths[1] - 4,
    ) as string[];
    const warrantyLines = doc.splitTextToSize(
      warranty.warranty_text || "-",
      widths[2] - 4,
    ) as string[];
    const rowHeight = Math.max(
      8,
      Math.max(componentLines.length, warrantyLines.length) * 4 + 4,
    );
    y = ensureSpace(doc, y, rowHeight + 10, colors.primary);
    doc.setDrawColor(colors.border);
    doc.line(margin, y, pageWidth - margin, y);
    doc.setTextColor(colors.text);
    doc.text(String(index + 1), margin + 3, y + 5);
    doc.text(componentLines, margin + widths[0] + 3, y + 5);
    doc.text(warrantyLines, margin + widths[0] + widths[1] + 3, y + 5);
    y += rowHeight;
  });
  doc.line(margin, y, pageWidth - margin, y);
  return y;
}

function drawPaymentTermTable(
  doc: PdfDoc,
  input: BusinessPdfInput,
  colors: Record<string, string>,
  y: number,
) {
  const paymentTerms = input.paymentTermItems ?? [];
  if (input.kind !== "quotation" || paymentTerms.length === 0) {
    return y;
  }

  y = ensureSpace(doc, y, 36, colors.primary);
  const headers = ["Sr.", "Milestone", "%", "Amount"];
  const widths = [16, 92, 24, 54];
  doc.setFillColor(colors.primary);
  doc.roundedRect(margin, y, contentWidth, 8, 1.5, 1.5, "F");
  doc.setTextColor("#ffffff");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);

  let x = margin + 3;
  headers.forEach((header, index) => {
    doc.text(header, x, y + 5.3, { align: index >= 2 ? "right" : "left" });
    x += widths[index];
  });

  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  paymentTerms.forEach((paymentTerm, index) => {
    const milestoneLines = doc.splitTextToSize(
      paymentTerm.milestone || "-",
      widths[1] - 4,
    ) as string[];
    const rowHeight = Math.max(8, milestoneLines.length * 4 + 4);
    y = ensureSpace(doc, y, rowHeight + 10, colors.primary);
    doc.setDrawColor(colors.border);
    doc.line(margin, y, pageWidth - margin, y);
    doc.setTextColor(colors.text);
    doc.text(String(index + 1), margin + 3, y + 5);
    doc.text(milestoneLines, margin + widths[0] + 3, y + 5);
    doc.text(
      paymentTerm.percentage === null || paymentTerm.percentage === undefined
        ? "-"
        : `${paymentTerm.percentage}%`,
      margin + widths[0] + widths[1] + widths[2] - 3,
      y + 5,
      { align: "right" },
    );
    drawPdfText(
      doc,
      paymentTerm.amount === null || paymentTerm.amount === undefined
        ? "-"
        : formatAmount(paymentTerm.amount, input.settings.currency),
      pageWidth - margin - 3,
      y + 5,
      { align: "right" },
    );
    y += rowHeight;
  });
  doc.line(margin, y, pageWidth - margin, y);
  return y;
}

function drawTotals(
  doc: PdfDoc,
  input: BusinessPdfInput,
  colors: Record<string, string>,
  y: number,
) {
  y = ensureSpace(doc, y, input.kind === "quotation" ? 76 : 66, colors.primary);
  const gstRows =
    input.kind === "invoice" || input.kind === "purchase_order"
      ? gstBreakdown(input.items)
      : [];
  const hasLeftPanel = input.kind === "quotation" || gstRows.length > 0;
  const leftWidth = 92;
  const rightX = hasLeftPanel ? margin + leftWidth + 12 : margin;
  const rightWidth = hasLeftPanel ? contentWidth - leftWidth - 12 : contentWidth;

  if (input.kind === "quotation") {
    drawBox(doc, margin, y, leftWidth, 58, "Bank & GST Details", colors);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(colors.text);
    drawWrappedLines(
      doc,
      input.bankLines && input.bankLines.length > 0
        ? input.bankLines
        : ["Bank details not configured."],
      margin + 4,
      y + 13,
      leftWidth - 8,
      4.2,
    );
  } else {
    if (gstRows.length > 0) {
      drawBox(doc, margin, y, leftWidth, 42, "GST Breakdown", colors);
      let rowY = y + 13;
      gstRows.forEach((row) => {
        doc.setTextColor(colors.text);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.text(`${row.percent}% GST`, margin + 4, rowY);
        drawPdfText(doc, formatAmount(row.gst, input.settings.currency), margin + leftWidth - 4, rowY, {
          align: "right",
        });
        rowY += 5;
      });
    }
  }

  drawBox(doc, rightX, y, rightWidth, 58, "Amount Summary", colors);
  let totalY = y + 13;
  totalY = totalRow(doc, "Base Amount", input.totals.baseAmount, input, rightX, rightWidth, totalY, colors);
  totalY = totalRow(doc, "GST Amount", input.totals.gstAmount, input, rightX, rightWidth, totalY, colors);
  if (Number(input.totals.discountAmount ?? 0) > 0) {
    totalY = totalRow(doc, "Discount", input.totals.discountAmount, input, rightX, rightWidth, totalY, colors);
  }
  totalY = totalRow(doc, "Total Amount", input.totals.totalAmount, input, rightX, rightWidth, totalY, colors);
  if (input.kind === "quotation") {
    totalY = totalRow(doc, "Subsidy", input.totals.subsidyAmount, input, rightX, rightWidth, totalY, colors);
  } else if (input.kind === "invoice") {
    totalY = totalRow(doc, "Amount Paid", input.totals.amountPaid, input, rightX, rightWidth, totalY, colors);
  }

  doc.setDrawColor(colors.border);
  doc.line(rightX + 4, totalY, rightX + rightWidth - 4, totalY);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(colors.primary);
  doc.setFontSize(11);
  doc.text(summaryTotalLabel(input), rightX + 4, totalY + 7);
  drawPdfText(
    doc,
    formatAmount(input.totals.netPayableAmount, input.settings.currency),
    rightX + rightWidth - 4,
    totalY + 7,
    { align: "right" },
  );

  return y + 60;
}

function drawPricingDetails(
  doc: PdfDoc,
  input: BusinessPdfInput,
  colors: Record<string, string>,
  y: number,
) {
  if (input.kind !== "quotation" || !input.pricingLines?.length) {
    return y;
  }

  return drawTextCard(doc, "Price Details", input.pricingLines, colors, y);
}

function drawProposalScope(
  doc: PdfDoc,
  input: BusinessPdfInput,
  colors: Record<string, string>,
  y: number,
) {
  if (input.kind !== "quotation" || !input.proposalScopeLines?.length) {
    return y;
  }

  return drawTextCard(doc, "Proposal Scope", input.proposalScopeLines, colors, y);
}

function drawCommercialTerms(
  doc: PdfDoc,
  input: BusinessPdfInput,
  colors: Record<string, string>,
  y: number,
) {
  if (input.kind !== "quotation" || !input.commercialTermsLines?.length) {
    return y;
  }

  return drawTextCard(doc, "Commercial Terms", input.commercialTermsLines, colors, y);
}

function drawTerms(
  doc: PdfDoc,
  input: BusinessPdfInput,
  colors: Record<string, string>,
  y: number,
) {
  if (input.kind === "quotation") {
    let nextY = y;
    if (input.paymentTerms) {
      nextY = drawTextCard(doc, "Payment Terms", [input.paymentTerms], colors, nextY);
      nextY += 6;
    }

    if (input.termsAndConditions) {
      nextY = drawTextCard(doc, "Terms & Conditions", [input.termsAndConditions], colors, nextY);
      nextY += 6;
    }

    if (input.notes) {
      nextY = drawTextCard(doc, "Notes", [input.notes], colors, nextY);
    }

    return nextY;
  }

  return drawTextCard(
    doc,
    input.kind === "purchase_order"
      ? "Terms And Conditions"
      : "Payment Terms And Conditions",
    [
      ...(input.pricingLines ?? []),
      input.paymentTerms ? `Payment terms: ${input.paymentTerms}` : "",
      ...(input.bankLines && input.bankLines.length > 0
        ? ["Bank details:", ...input.bankLines]
        : []),
      input.termsAndConditions ? `Terms: ${input.termsAndConditions}` : "",
      input.notes ? `Notes: ${input.notes}` : "",
    ].filter(Boolean),
    colors,
    y,
  );
}

function drawTextCard(
  doc: PdfDoc,
  title: string,
  lines: string[],
  colors: Record<string, string>,
  y: number,
) {
  const lineCount = lines.reduce((count, line) => {
    const wrapped = doc.splitTextToSize(line, contentWidth - 8) as string[];
    return count + Math.max(wrapped.length, 1);
  }, 0);
  const height = Math.max(28, 13 + lineCount * 4.2 + 5);
  y = ensureSpace(doc, y, height + 4, colors.primary);
  drawBox(doc, margin, y, contentWidth, height, title, colors);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(colors.text);
  drawWrappedLines(doc, lines, margin + 4, y + 13, contentWidth - 8, 4.2);
  return y + height;
}

function drawSignature(
  doc: PdfDoc,
  input: BusinessPdfInput,
  colors: Record<string, string>,
  y: number,
) {
  const width = 74;
  const x = pageWidth - margin - width;
  if (input.kind === "quotation") {
    drawBox(doc, x, y, width, 30, "Authorized Sign & Seal", colors);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(colors.muted);
    doc.text(`For ${companyDisplayName(input)}`, x + 4, y + 15);
    doc.setDrawColor(colors.border);
    doc.line(x + 4, y + 23, x + width - 4, y + 23);
    doc.text("Authorized Signatory", x + width - 4, y + 27, { align: "right" });
    return;
  }

  doc.setDrawColor(colors.border);
  doc.line(x + 16, y + 8, x + width, y + 8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(colors.muted);
  doc.text("Authorized Signature", x + width, y + 14, { align: "right" });
}

function summaryTotalLabel(input: BusinessPdfInput) {
  if (input.kind === "quotation") {
    return "Net Payable";
  }

  if (input.kind === "purchase_order") {
    return "Total Amount";
  }

  return "Balance Due";
}

function drawBox(
  doc: PdfDoc,
  x: number,
  y: number,
  width: number,
  height: number,
  title: string,
  colors: Record<string, string>,
) {
  doc.setDrawColor(colors.border);
  doc.setFillColor("#ffffff");
  doc.roundedRect(x, y, width, height, 2, 2, "FD");
  doc.setFillColor(colors.soft);
  doc.rect(x, y, width, 8, "F");
  doc.setTextColor(colors.primary);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text(title, x + 4, y + 5.5);
}

function drawPdfText(
  doc: PdfDoc,
  text: string | string[],
  x: number,
  y: number,
  options?: TextOptionsLight,
) {
  if (Array.isArray(text)) {
    const lineHeight =
      doc.getFontSize() * ptToMm * (options?.lineHeightFactor ?? 1.15);
    text.forEach((line, index) => {
      drawPdfText(doc, line, x, y + index * lineHeight, options);
    });
    return;
  }

  if (!text.startsWith(inrSymbol)) {
    doc.text(text, x, y, options);
    return;
  }

  const amount = text.slice(inrSymbol.length);
  const fontSizeMm = doc.getFontSize() * ptToMm;
  const glyphWidth = fontSizeMm * 0.52;
  const gap = fontSizeMm * 0.16;
  const amountWidth = doc.getTextWidth(amount);
  const totalWidth = glyphWidth + gap + amountWidth;
  const align = options?.align ?? "left";
  const startX =
    align === "right"
      ? x - totalWidth
      : align === "center"
        ? x - totalWidth / 2
        : x;

  drawRupeeGlyph(doc, startX, y, glyphWidth);
  doc.text(amount, startX + glyphWidth + gap, y, {
    ...options,
    align: "left",
  });
}

function drawRupeeGlyph(doc: PdfDoc, x: number, baselineY: number, width: number) {
  const height = width * 1.55;
  const top = baselineY - height * 0.86;
  const bottom = baselineY + height * 0.08;
  const previousDrawColor = doc.getDrawColor();
  const previousLineWidth = doc.getLineWidth();
  const strokeWidth = Math.max(0.18, width * 0.12);

  doc.setDrawColor(doc.getTextColor());
  doc.setLineWidth(strokeWidth);
  doc.line(x, top, x + width, top);
  doc.line(x, top + height * 0.24, x + width * 0.9, top + height * 0.24);
  doc.line(x + width * 0.18, top, x + width * 0.78, top + height * 0.34);
  doc.line(x + width * 0.2, top + height * 0.42, x + width * 0.82, bottom);
  doc.setDrawColor(previousDrawColor);
  doc.setLineWidth(previousLineWidth);
}

function totalRow(
  doc: PdfDoc,
  label: string,
  value: number | null | undefined,
  input: BusinessPdfInput,
  x: number,
  width: number,
  y: number,
  colors: Record<string, string>,
) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(colors.text);
  doc.text(label, x + 4, y);
  drawPdfText(doc, formatAmount(value, input.settings.currency), x + width - 4, y, {
    align: "right",
  });
  return y + 5.2;
}

function ensureSpace(doc: PdfDoc, y: number, neededHeight: number, primary: string) {
  if (y + neededHeight <= pageHeight - 24) {
    return y;
  }

  doc.addPage();
  drawPageChrome(doc, primary);
  return margin + 2;
}

function drawWrappedLines(
  doc: PdfDoc,
  lines: string[],
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) {
  let nextY = y;
  lines.forEach((line) => {
    const wrapped = doc.splitTextToSize(line, maxWidth) as string[];
    doc.text(wrapped, x, nextY);
    nextY += wrapped.length * lineHeight;
  });
  return nextY;
}

function compactRows(rows: Array<[string, string | null | undefined]>) {
  return rows
    .map(([label, value]) => [label, cleanPdfText(value)] as [string, string])
    .filter(([, value]) => isPresentText(value));
}

function compactBlocks(rows: Array<[string, string | null | undefined]>) {
  return compactRows(rows);
}

function cleanPdfText(value: unknown) {
  return String(value ?? "").trim();
}

function isPresentText(value: unknown) {
  const text = cleanPdfText(value);
  return text !== "" && text !== "-";
}

function displayValue(value: unknown) {
  const text = cleanPdfText(value);
  if (!isPresentText(text)) {
    return "";
  }

  const normalizedText = text.replace(/\s+/g, " ").trim();
  const looksLikeEnum =
    normalizedText.includes("_") ||
    /^[a-z0-9]+(?:[-\s][a-z0-9]+)*$/.test(normalizedText);

  if (!looksLikeEnum) {
    return normalizedText;
  }

  return titleCaseWithAcronyms(normalizedText);
}

function titleCaseWithAcronyms(value: string) {
  const normalized = value
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (["non-dcr", "non dcr"].includes(normalized.toLowerCase())) {
    return "Non-DCR";
  }

  return normalized
    .split(" ")
    .map((part) => {
      const lower = part.toLowerCase();
      if (
        [
          "ac",
          "acdb",
          "bom",
          "dc",
          "dcdb",
          "dcr",
          "discom",
          "gi",
          "gst",
          "ifsc",
          "pan",
          "pdf",
          "pv",
          "rcc",
        ].includes(lower)
      ) {
        return lower.toUpperCase();
      }
      return lower
        .split("-")
        .map((piece) => piece.charAt(0).toUpperCase() + piece.slice(1))
        .join("-");
    })
    .join(" ");
}

function formatUnit(unit: string | null | undefined) {
  const normalized = cleanPdfText(unit).toLowerCase().replace(/\./g, "");
  if (!normalized) {
    return "pcs";
  }

  if (["pc", "pcs", "piece", "pieces", "nos", "no", "number", "numbers"].includes(normalized)) {
    return "pcs";
  }

  return unitLabels[normalized] ?? normalized;
}

function hasPrintableLineItem(item: PdfLineItem) {
  return (
    [item.name, item.description].some(isPresentText) ||
    Number(item.quantity ?? 0) > 0 ||
    Number(item.unitPrice ?? 0) > 0 ||
    Number(item.lineTotal ?? 0) > 0
  );
}

function formatNonZeroOrPresent(
  value: number | null | undefined,
  currency: string | null,
) {
  return value === null || value === undefined ? "" : formatAmount(value, currency);
}

const unitLabels: Record<string, string> = {
  kw: "kW",
  w: "W",
  meter: "meter",
  meters: "meter",
  m: "meter",
  kg: "kg",
  lot: "lot",
  set: "set",
  job: "job",
  sqft: "sqft",
};

function gstBreakdown(items: PdfLineItem[]) {
  const rows = new Map<number, { percent: number; base: number; gst: number }>();
  items.filter(hasPrintableLineItem).forEach((item) => {
    const percent = Number(item.gstPercent ?? 0);
    const current = rows.get(percent) ?? { percent, base: 0, gst: 0 };
    const base = Number(item.lineTotal ?? 0);
    current.base += base;
    current.gst += base * percent / 100;
    rows.set(percent, current);
  });

  return Array.from(rows.values())
    .filter((row) => row.percent > 0 && row.gst > 0)
    .sort((a, b) => a.percent - b.percent);
}

function lineGrossAmount(item: PdfLineItem) {
  if (item.lineTotal === null || item.lineTotal === undefined) {
    return null;
  }

  const base = Number(item.lineTotal ?? 0);
  return base + base * Number(item.gstPercent ?? 0) / 100;
}

function purchaseItemBaseAmount(
  item: NonNullable<PurchaseOrderWithRelations["items"]>[number],
) {
  return Number(item.quantity ?? 0) * Number(item.unit_price ?? 0);
}

function formatQuantity(item: PdfLineItem) {
  if (item.quantity === null || item.quantity === undefined) {
    return "";
  }

  return `${Number(item.quantity)} ${formatUnit(item.unit)}`;
}

function quotationPdfTotals(quotation: QuotationWithRelations): Totals {
  const baseAmount = Number(quotation.base_amount ?? 0);
  const gstAmount = Number(quotation.gst_amount ?? 0);
  const discountAmount = Number(quotation.discount_amount ?? 0);
  const subsidyAmount = Number(quotation.subsidy_amount ?? 0);
  const turnkeyAmount =
    quotation.summary_total_turnkey_cost ?? quotation.pricing_total_rate;
  const hasTurnkeyAmount = hasTurnkeyGstAmount(turnkeyAmount);
  const hasCalculatedTotals = baseAmount + gstAmount > 0;

  if (hasCalculatedTotals && !hasTurnkeyAmount) {
    return {
      baseAmount: quotation.base_amount,
      gstAmount: quotation.gst_amount,
      discountAmount: quotation.discount_amount,
      subsidyAmount: quotation.subsidy_amount,
      totalAmount: quotation.total_amount,
      netPayableAmount: quotation.net_payable_amount,
    };
  }

  if (!hasTurnkeyAmount) {
    return {
      baseAmount: quotation.base_amount,
      gstAmount: quotation.gst_amount,
      discountAmount: quotation.discount_amount,
      subsidyAmount: quotation.subsidy_amount,
      totalAmount: quotation.total_amount,
      netPayableAmount: quotation.net_payable_amount,
    };
  }

  const discountedTotals = calculateDiscountedTurnkeyTotals(
    turnkeyAmount,
    discountAmount,
  );
  const totalAmount = discountedTotals.totalAmount;

  return {
    baseAmount: discountedTotals.taxableAmount,
    gstAmount: discountedTotals.gstAmount,
    discountAmount: quotation.discount_amount,
    subsidyAmount: quotation.subsidy_amount,
    totalAmount,
    netPayableAmount: Math.max(totalAmount - subsidyAmount, 0),
  };
}

function vendorAddress(order: PurchaseOrderWithRelations) {
  return [
    order.vendor?.address_line_1,
    order.vendor?.address_line_2,
    order.vendor?.city,
    order.vendor?.district,
    order.vendor?.state,
    order.vendor?.pincode,
  ]
    .filter(Boolean)
    .join(", ") || null;
}

function technicalQuotationTitle(quotation: QuotationWithRelations) {
  const savedTitle = cleanPdfText(quotation.quotation_title);
  const generatedTitle = quotationTitle(
    quotation.system_capacity_kw,
    quotation.module_category,
    quotation.customer_type,
  );
  const legacyGeneratedTitles = legacyQuotationTitles(quotation);

  if (!isPresentText(savedTitle)) {
    return generatedTitle;
  }

  if (
    generatedTitle &&
    legacyGeneratedTitles.some(
      (title) => normalizeTitleText(savedTitle) === normalizeTitleText(title),
    )
  ) {
    return generatedTitle;
  }

  return savedTitle;
}

function quotationTitle(
  capacity: number | null | undefined,
  moduleCategory: string | null | undefined,
  customerType: string | null | undefined,
) {
  const capacityText = quotationCapacityText(capacity);
  const capacityWithUnit = capacityText ? `${capacityText} kW` : "";
  const parts = [
    capacityWithUnit,
    displayValue(moduleCategory),
    displayValue(customerType),
    "Solar System",
  ].filter(Boolean);
  return parts.length > 1 ? `Quotation For ${parts.join(" ")}` : null;
}

function legacyQuotationTitles(quotation: QuotationWithRelations) {
  const capacity = quotation.system_capacity_kw;
  const moduleCategory = quotation.module_category;
  const customerType = quotation.customer_type;
  const capacityText = quotationCapacityText(capacity);
  const moduleText = displayValue(moduleCategory);
  const customerTypeText = displayValue(customerType);
  const legacyParts = [capacityText, moduleText, "Solar System"].filter(Boolean);
  const duplicatedCapacityParts = [
    capacityText,
    moduleText,
    "Solar System",
    capacityText ? `${capacityText}kW` : "",
  ].filter(Boolean);
  const currentParts = [
    capacityText ? `${capacityText} kW` : "",
    moduleText,
    customerTypeText,
    "Solar System",
  ].filter(Boolean);

  return [legacyParts, duplicatedCapacityParts, currentParts]
    .filter((parts) => parts.length > 1)
    .map((parts) => `Quotation For ${parts.join(" ")}`);
}

function quotationCapacityText(capacity: number | null | undefined) {
  return capacity === null || capacity === undefined
    ? ""
    : new Intl.NumberFormat("en-IN", {
        maximumFractionDigits: 2,
      }).format(capacity);
}

function normalizeTitleText(value: string | null | undefined) {
  return cleanPdfText(value).replace(/\s+/g, " ").toLowerCase();
}

function formatAmount(value: number | null | undefined, currency: string | null) {
  const currencyCode = (currency || "INR").toUpperCase();
  const amount = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));

  if (currencyCode === "INR") {
    return `${inrSymbol}${amount}`;
  }

  return `${currencyCode} ${amount}`;
}

function formatOptionalAmount(
  value: number | null | undefined,
  currency: string | null,
) {
  return value === null || value === undefined ? "" : formatAmount(value, currency);
}

function formatDate(value: string | null | undefined, dateFormat: string | null) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());

  if (dateFormat === "MM/DD/YYYY") {
    return `${month}/${day}/${year}`;
  }

  if (dateFormat === "YYYY-MM-DD") {
    return `${year}-${month}-${day}`;
  }

  return `${day}/${month}/${year}`;
}

function oneMonthFromDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = parsePdfDate(value);
  if (!date) {
    return null;
  }

  const originalDay = date.getDate();
  const nextDate = new Date(date);
  nextDate.setDate(1);
  nextDate.setMonth(nextDate.getMonth() + 1);
  const lastDayOfTargetMonth = new Date(
    nextDate.getFullYear(),
    nextDate.getMonth() + 1,
    0,
  ).getDate();
  nextDate.setDate(Math.min(originalDay, lastDayOfTargetMonth));

  return [
    String(nextDate.getFullYear()),
    String(nextDate.getMonth() + 1).padStart(2, "0"),
    String(nextDate.getDate()).padStart(2, "0"),
  ].join("-");
}

function parsePdfDate(value: string) {
  const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function valueWithUnit(value: number | string | null | undefined, unit: string) {
  return value === null || value === undefined ? "-" : `${value} ${unit}`;
}

function labelize(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  return titleCaseWithAcronyms(value);
}

function normalizeHex(value: string | null | undefined, fallback: string) {
  const candidate = value || fallback;
  return /^#[0-9a-fA-F]{6}$/.test(candidate) ? candidate : fallback;
}

function initials(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "SW";
}

async function fetchCroppedImageAsDataUrl(
  url: string | null | undefined,
  targetWidth: number,
  targetHeight: number,
): Promise<PdfImageData | null> {
  const imageData = await fetchImageAsDataUrl(url);
  if (!imageData || typeof document === "undefined") {
    return imageData;
  }

  try {
    const image = await loadImageElement(imageData.dataUrl);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      return imageData;
    }

    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    const sourceRatio = sourceWidth / sourceHeight;
    const targetRatio = targetWidth / targetHeight;
    let sx = 0;
    let sy = 0;
    let sw = sourceWidth;
    let sh = sourceHeight;

    if (sourceRatio > targetRatio) {
      sw = sourceHeight * targetRatio;
      sx = (sourceWidth - sw) / 2;
    } else {
      sh = sourceWidth / targetRatio;
      sy = (sourceHeight - sh) / 2;
    }

    context.drawImage(image, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight);

    return {
      dataUrl: canvas.toDataURL("image/jpeg", 0.86),
      format: "JPEG",
    };
  } catch {
    return imageData;
  }
}

function loadImageElement(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load PDF header image."));
    image.src = dataUrl;
  });
}

async function fetchImageAsDataUrl(
  url: string | null | undefined,
): Promise<PdfImageData | null> {
  if (!url) {
    return null;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    const blob = await response.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });

    if (blob.type.includes("svg")) {
      return rasterizeSvgDataUrl(dataUrl);
    }

    return {
      dataUrl,
      format: blob.type.includes("png") ? "PNG" : "JPEG",
    };
  } catch {
    return null;
  }
}

async function rasterizeSvgDataUrl(dataUrl: string): Promise<PdfImageData | null> {
  if (typeof document === "undefined") {
    return null;
  }

  try {
    const image = await loadImageElement(dataUrl);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      return null;
    }

    canvas.width = image.naturalWidth || image.width || 240;
    canvas.height = image.naturalHeight || image.height || 240;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    return {
      dataUrl: canvas.toDataURL("image/png"),
      format: "PNG",
    };
  } catch {
    return null;
  }
}
