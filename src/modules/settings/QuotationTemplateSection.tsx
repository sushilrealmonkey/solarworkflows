import { useState } from "react";
import type { OrganizationBranding } from "../../app/AuthProvider";
import { buildQuotationPdf } from "../documents/businessPdf";
import type { QuotationItem, QuotationWithRelations } from "../quotations/types";
import {
  quotationTemplates,
  type QuotationTemplateId,
} from "../quotations/quotationTemplates";
import type { OrganizationSettings, OrganizationSettingsFormValues } from "./types";

type QuotationTemplateSectionProps = {
  values: OrganizationSettingsFormValues;
  organization: OrganizationBranding;
  disabled?: boolean;
  onChange: (template: QuotationTemplateId) => void;
  showToast: (message: string, tone?: "success" | "error" | "info") => void;
};

export function QuotationTemplateSection({
  values,
  organization,
  disabled = false,
  onChange,
  showToast,
}: QuotationTemplateSectionProps) {
  const [downloading, setDownloading] = useState<QuotationTemplateId | null>(null);

  async function downloadSample(template: QuotationTemplateId) {
    try {
      setDownloading(template);
      const pdf = await buildQuotationPdf(
        sampleQuotation(organization.id),
        sampleItems(organization.id),
        organization,
        sampleSettings(values, organization, template),
      );
      const url = URL.createObjectURL(pdf);
      const link = document.createElement("a");
      link.href = url;
      link.download = `quotation-sample-${template}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      showToast(
        error instanceof Error
          ? `Sample quotation could not be created: ${error.message}`
          : "Sample quotation could not be created.",
        "error",
      );
    } finally {
      setDownloading(null);
    }
  }

  return (
    <section
      aria-labelledby="quotation-template-heading"
      className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3
            id="quotation-template-heading"
            className="text-sm font-semibold text-slate-950"
          >
            Quotation design
          </h3>
          <p className="mt-0.5 max-w-2xl text-xs leading-5 text-slate-500">
            Choose the visual layout used when your team downloads a quotation PDF. All
            designs use the same quotation content and company details.
          </p>
        </div>
        <span className="inline-flex w-fit items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
          Saved per organization
        </span>
      </div>

      <div
        aria-label="Quotation designs"
        className="mt-4 grid gap-4 lg:grid-cols-2"
        role="radiogroup"
      >
        {quotationTemplates.map((template) => {
          const selected = values.quotation_template === template.id;
          const isDownloading = downloading === template.id;

          return (
            <article
              key={template.id}
              className={`rounded-xl border p-2 transition-colors ${
                selected
                  ? "border-orange-500 bg-orange-50/50 ring-2 ring-orange-100"
                  : "border-stone-200 bg-stone-50/50 hover:border-slate-300"
              }`}
            >
              <button
                aria-checked={selected}
                className="block w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
                disabled={disabled}
                onClick={() => onChange(template.id)}
                role="radio"
                type="button"
              >
                <QuotationTemplateThumbnail template={template.id} />
                <div className="flex items-start justify-between gap-3 px-2 pb-1 pt-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">
                      {template.name}
                    </p>
                    <p className="mt-0.5 text-xs font-medium text-slate-500">
                      {template.eyebrow}
                    </p>
                  </div>
                  <span
                    className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                      selected
                        ? "border-orange-600 bg-orange-600 text-white"
                        : "border-stone-300 bg-white text-transparent"
                    }`}
                  >
                    <CheckIcon />
                  </span>
                </div>
                <p className="px-2 pb-2 text-xs leading-5 text-slate-600">
                  {template.description}
                </p>
              </button>
              <div className="flex items-center justify-between gap-3 border-t border-stone-200/80 px-2 pt-2">
                <span className="text-[11px] font-medium text-slate-400">
                  {template.palette}
                </span>
                <button
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-[#06173f] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isDownloading}
                  onClick={() => void downloadSample(template.id)}
                  type="button"
                >
                  <DownloadIcon />
                  {isDownloading ? "Preparing..." : "Download sample"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function QuotationTemplateThumbnail({ template }: { template: QuotationTemplateId }) {
  if (template === "meridian") {
    return (
      <div
        aria-hidden="true"
        className="relative aspect-[1/1.28] overflow-hidden rounded-lg bg-[#0b2c4d] text-white shadow-inner"
      >
        <div className="absolute inset-y-0 right-0 w-[31%] bg-[linear-gradient(150deg,#214d6a,#071c35)]" />
        <div className="absolute right-[8%] top-[7%] h-2 w-2 rounded-full border border-white/70" />
        <div className="absolute left-[9%] top-[8%] h-2.5 w-16 rounded-sm bg-white/90" />
        <div className="absolute left-[9%] top-[21%] text-[7px] font-semibold uppercase tracking-[0.24em] text-amber-300">
          Quotation · QUO-0018
        </div>
        <div className="absolute left-[9%] top-[28%] w-[59%] text-[18px] font-bold leading-[1.04]">
          3 kW rooftop solar PV system
        </div>
        <div className="absolute left-[9%] top-[45%] h-1 w-16 bg-amber-400" />
        <div className="absolute left-[9%] top-[53%] w-[58%] space-y-2 border-t border-white/20 pt-2 text-[7px] uppercase tracking-[0.17em] text-sky-200/80">
          <p className="flex justify-between border-b border-white/15 pb-1"><span>Client</span><span className="normal-case tracking-normal text-white">Sample Customer</span></p>
          <p className="flex justify-between border-b border-white/15 pb-1"><span>Site</span><span className="normal-case tracking-normal text-white">Jaipur</span></p>
          <p className="flex justify-between border-b border-white/15 pb-1"><span>Capacity</span><span className="normal-case tracking-normal text-white">3 kW AC</span></p>
        </div>
        <div className="absolute bottom-[8%] left-[9%] right-[36%] border-t border-white/20 pt-2 text-[8px] font-semibold text-white/90">
          Your Solar Company
        </div>
        <div className="absolute bottom-[10%] right-[5%] left-[73%] space-y-2 text-[7px]">
          <p className="border-b border-white/20 pb-2"><strong className="block text-[12px]">4,380 kWh</strong><span className="text-sky-100/70">Expected generation</span></p>
          <p><strong className="block text-[12px]">₹1,82,000</strong><span className="text-sky-100/70">Effective project cost</span></p>
        </div>
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      className="relative aspect-[1/1.28] overflow-hidden rounded-lg bg-[#f8fbf9] text-slate-900 shadow-inner"
    >
      <div className="absolute inset-x-0 top-0 h-[37%] bg-[linear-gradient(145deg,#315f55,#0a3e32)]" />
      <div className="absolute left-[9%] top-[7%] h-2.5 w-14 rounded-sm bg-white/90" />
      <div className="absolute left-[9%] top-[20%] text-[7px] font-semibold uppercase tracking-[0.22em] text-emerald-200">
        Solar proposal · QUO-0018
      </div>
      <div className="absolute left-[9%] top-[25%] w-[74%] text-[15px] font-bold leading-[1.04] text-white">
        A 3 kW rooftop system, sized for your home
      </div>
      <div className="absolute left-[9%] right-[9%] top-[34%] h-[13%] rounded-lg border border-white/30 bg-white/90 shadow-lg" />
      <div className="absolute left-[14%] right-[14%] top-[38%] flex justify-between text-[7px] font-semibold text-slate-800">
        <span>PREPARED FOR<br /><strong className="text-[9px]">Sample Customer</strong></span>
        <span>QUOTATION<br /><strong className="text-[9px]">QUO-0018</strong></span>
        <span>VALID UNTIL<br /><strong className="text-[9px]">19 AUG 2026</strong></span>
      </div>
      <div className="absolute left-[9%] right-[9%] top-[52%] grid grid-cols-3 gap-2">
        <div className="h-10 rounded border border-emerald-100 bg-white p-1.5"><strong className="block text-[11px]">4,380</strong><span className="text-[6px] text-emerald-600">kWh expected</span></div>
        <div className="h-10 rounded border border-emerald-100 bg-white p-1.5"><strong className="block text-[11px]">₹35,040</strong><span className="text-[6px] text-slate-500">Indicative saving</span></div>
        <div className="h-10 rounded bg-[#0a3e32] p-1.5 text-white"><strong className="block text-[11px]">₹1,82,000</strong><span className="text-[6px] text-emerald-100">Net payable</span></div>
      </div>
      <div className="absolute left-[9%] top-[70%] w-[54%] space-y-1.5 text-[7px] leading-[1.2] text-slate-500">
        <div className="h-1.5 w-24 rounded bg-emerald-600/80" />
        <p className="font-semibold text-slate-700">Before you read the numbers</p>
        <p>Clear scope, transparent pricing, and a turnkey installation plan.</p>
        <p className="h-1 w-28 rounded bg-slate-200" /><p className="h-1 w-20 rounded bg-slate-200" />
      </div>
      <div className="absolute bottom-[8%] left-[9%] right-[9%] border-t border-emerald-100 pt-2 text-[7px] font-semibold text-emerald-800">
        Your Solar Company · Turnkey solar solutions
      </div>
    </div>
  );
}

function sampleSettings(
  values: OrganizationSettingsFormValues,
  organization: OrganizationBranding,
  template: QuotationTemplateId,
) {
  return {
    ...values,
    id: null,
    organization_id: organization.id,
    quotation_template: template,
  } as unknown as OrganizationSettings;
}

function sampleQuotation(organizationId: string | null): QuotationWithRelations {
  return {
    id: "sample-quotation",
    organization_id: organizationId ?? "sample-organization",
    quotation_code: "QUO-0018",
    quotation_date: "2026-08-12",
    valid_until: "2026-08-19",
    system_capacity_kw: 3,
    installation_location: "RCC rooftop, Jaipur, Rajasthan",
    site_type: "Residential",
    expected_annual_generation_kwh: 4380,
    generation_notes: "Expected generation in year one, about 365 units a month.",
    summary_module_brand: "Sample Solar",
    summary_module_wattage: 540,
    summary_plant_size_kw: 3.24,
    summary_inverter_brand: "Sample Inverter",
    summary_total_turnkey_cost: 260000,
    summary_amount_in_words: "Rupees One Lakh Eighty-Two Thousand Only",
    panel_type: "Mono PERC",
    inverter_type: "Grid-connected",
    base_amount: 220339,
    gst_amount: 39661,
    discount_amount: 0,
    total_amount: 260000,
    subsidy_amount: 78000,
    net_payable_amount: 182000,
    payment_terms: "40% on order, 50% on installation, 10% after commissioning.",
    terms_and_conditions: "Prices are valid for seven days. Final design is subject to site verification.",
    notes: "Illustrative sample quotation. Replace with your customer and project details.",
    company_name: "Your Solar Company",
    company_gstin: null,
    company_mobile: null,
    tagline: "Turnkey solar solutions",
    certification_line: null,
    quotation_title: "A 3 kW rooftop system, sized for your home",
    system_type: "On-grid",
    module_category: "DCR modules",
    customer_type: "Residential",
    customer_city_village: "Jaipur",
    discom: "Sample DISCOM",
    work_description: "Design, engineering, supply, installation, testing and commissioning of an on-grid rooftop solar PV system.",
    pricing_total_rate: 260000,
    pricing_tax_included: true,
    pricing_remarks: "Turnkey contract value, inclusive of GST.",
    maintenance_duration: "5 years",
    maintenance_included: true,
    commercial_price_basis: "Turnkey system price based on the proposed system configuration.",
    commercial_gst_terms: "GST is included in the quoted turnkey value.",
    commercial_security_deposit_terms: "Any DISCOM security deposit is payable by the customer at actuals.",
    commercial_transit_insurance: "Covered until delivery at site.",
    commercial_site_storage_insurance: "Customer to provide safe storage after delivery.",
    commercial_project_initiation: "Project starts after order confirmation and advance payment.",
    commercial_warranty_applicability: "Applicable manufacturer and workmanship warranties are included.",
    proposal_important_considerations: "Generation is indicative and depends on site conditions, weather and grid availability.",
    proposal_client_responsibilities: "Provide roof access, approvals, meter documents and a safe work area.",
    proposal_exclusions: "Civil strengthening, unusual cable routes and statutory charges outside the stated scope.",
    proposal_included_scope: "Design, supply, installation, testing, commissioning and net-metering support.",
    bank_company_name: "Your Solar Company",
    bank_gst_number: null,
    bank_name: "Sample Bank",
    bank_ifsc_code: "SAMPLE0001",
    bank_account_number: "0000000000",
    bank_account_type: "Current",
    material_items: [
      { description: "Solar PV module", brand: "Sample Solar", specification: "540 Wp mono PERC module", make_specification: "540 Wp mono PERC module", quantity: "6", unit: "nos", inventory_item_id: "sample-module" },
      { description: "On-grid inverter", brand: "Sample Inverter", specification: "3 kW single-phase inverter", make_specification: "3 kW single-phase inverter", quantity: "1", unit: "no", inventory_item_id: "sample-inverter" },
      { description: "Module mounting structure", brand: "Your Solar Company", specification: "Hot-dip galvanised mounting structure", make_specification: "Hot-dip galvanised mounting structure", quantity: "1", unit: "set", inventory_item_id: "sample-structure" },
      { description: "Cabling and protection", brand: "Sample Make", specification: "DC/AC cabling with ACDB and DCDB", make_specification: "DC/AC cabling with ACDB and DCDB", quantity: "1", unit: "lot", inventory_item_id: "sample-cabling" },
    ],
    quotation_warranties: [
      { id: "sample-warranty-1", quotation_id: "sample-quotation", tenant_id: organizationId ?? "sample-organization", component: "PV modules", warranty_text: "Manufacturer warranty as applicable", sort_order: 1, created_at: null, updated_at: null },
      { id: "sample-warranty-2", quotation_id: "sample-quotation", tenant_id: organizationId ?? "sample-organization", component: "Workmanship", warranty_text: "5 years workmanship support", sort_order: 2, created_at: null, updated_at: null },
    ],
    quotation_payment_terms: [
      { id: "sample-payment-1", quotation_id: "sample-quotation", tenant_id: organizationId ?? "sample-organization", milestone: "Advance with order", percentage: 40, amount: 104000, sort_order: 1, created_at: null, updated_at: null },
      { id: "sample-payment-2", quotation_id: "sample-quotation", tenant_id: organizationId ?? "sample-organization", milestone: "Installation completion", percentage: 50, amount: 130000, sort_order: 2, created_at: null, updated_at: null },
      { id: "sample-payment-3", quotation_id: "sample-quotation", tenant_id: organizationId ?? "sample-organization", milestone: "Commissioning handover", percentage: 10, amount: 26000, sort_order: 3, created_at: null, updated_at: null },
    ],
  } as unknown as QuotationWithRelations;
}

function sampleItems(organizationId: string | null): QuotationItem[] {
  return [
    {
      id: "sample-item-1", organization_id: organizationId ?? "sample-organization", quotation_id: "sample-quotation", item_type: "material", item_name: "Solar PV module", description: "540 Wp mono PERC module", section_name: null, material: "Solar PV module", specification: "540 Wp", make: "Sample Solar", quantity: 6, unit: "nos", unit_price: 18000, gst_percent: 12, line_total: 108000, sort_order: 1, created_at: null, updated_at: null,
    },
    {
      id: "sample-item-2", organization_id: organizationId ?? "sample-organization", quotation_id: "sample-quotation", item_type: "service", item_name: "Installation and commissioning", description: "Turnkey installation, testing and handover", section_name: null, material: "Installation", specification: "Complete service", make: "Your Solar Company", quantity: 1, unit: "lot", unit_price: 65000, gst_percent: 18, line_total: 65000, sort_order: 2, created_at: null, updated_at: null,
    },
  ];
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
      <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
      <path d="M12 4v11m0 0 4-4m-4 4-4-4M5 20h14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}
