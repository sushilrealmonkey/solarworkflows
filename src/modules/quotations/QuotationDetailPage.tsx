import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { RecordTitle } from "../../components/RecordTitle";
import { useToast } from "../../components/ui/ToastProvider";
import {
  AccessDenied,
  ConfirmDialog,
  DetailItem,
  DetailSection,
  EmptyState,
  LoadingSkeleton,
  NextStepLabel,
  PlaceholderAction,
} from "../crm/CrmComponents";
import {
  formatDate,
  formatDateTime,
  hasPermission,
  labelize,
} from "../crm/crmUtils";
import {
  fetchQuotation,
  fetchQuotationItems,
  fetchQuotationReservations,
  updateQuotationStatus,
} from "./quotationApi";
import {
  amountInWordsFromTurnkeyCost,
  calculateDiscountedTurnkeyTotals,
  calculateTurnkeyGstBreakdown,
  deriveQuotationMaterialSummary,
  defaultCommercialTerms,
  defaultProposalScope,
  defaultQuotationWarranties,
  defaultTechnicalPaymentTerms,
  discountedTurnkeyAmount,
  formatKw,
  formatMoney,
  formatMoneyWithPaise,
  getQuotationContact,
  hasTurnkeyGstAmount,
  quotationStatusOptions,
  quotationValidUntilFromDateInput,
  quotationSnapshotFormValues,
} from "./quotationUtils";
import { RecordLifecyclePanel } from "../lifecycle/RecordLifecyclePanel";
import {
  QuotationWorkflowPill,
  QuotationStatusBadge,
} from "./QuotationsPage";
import type {
  QuotationFormValues,
  QuotationInventoryReservation,
  QuotationMaterialItem,
  QuotationItem,
  QuotationPaymentTerm,
  QuotationStatus,
  QuotationWithRelations,
  QuotationWarranty,
} from "./types";
import { fetchProjectByQuotation } from "../projects/projectApi";
import { formatStock } from "../inventory/inventoryUtils";
import type { ProjectWithRelations } from "../projects/types";
import {
  fetchQuotationPdfPreviewUrl,
  generateAndStoreQuotationPdf,
} from "./quotationPdfWorkflow";
import { quotationWorkflowState } from "../shared/quotationWorkflow";

export function QuotationDetailPage() {
  const { id } = useParams();
  const { profile, permissions, organization } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [quotation, setQuotation] = useState<QuotationWithRelations | null>(null);
  const [reservations, setReservations] = useState<
    QuotationInventoryReservation[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusTarget, setStatusTarget] = useState<QuotationStatus | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [existingProject, setExistingProject] =
    useState<ProjectWithRelations | null>(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [preparingPdf, setPreparingPdf] = useState(false);

  const canView = hasPermission(profile, permissions, "quotations", "view");
  const canUpdate = hasPermission(profile, permissions, "quotations", "update");
  const canDelete = hasPermission(profile, permissions, "quotations", "delete");
  const canViewProjects = hasPermission(profile, permissions, "projects", "view");
  const canCreateSurvey = hasPermission(
    profile,
    permissions,
    "site_surveys",
    "create",
  );
  const canCreateDocuments = hasPermission(
    profile,
    permissions,
    "documents",
    "create",
  );
  async function loadQuotation() {
    if (!canView || !id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [nextQuotation, nextItems, nextReservations] = await Promise.all([
        fetchQuotation(profile, id),
        fetchQuotationItems(profile, id),
        fetchQuotationReservations(profile, id),
      ]);
      setQuotation(nextQuotation);
      setReservations(nextReservations);
      if (nextQuotation && canViewProjects) {
        setExistingProject(await fetchProjectByQuotation(profile, nextQuotation.id));
      } else {
        setExistingProject(null);
      }
      if (nextQuotation) {
        await loadQuotationPdf(nextQuotation, nextItems);
      } else {
        setPdfPreviewUrl(null);
      }
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load quotation.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadQuotation();
    // loadQuotation closes over current route and permission/profile state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, id, profile?.id]);

  if (!canView) {
    return (
      <AccessDenied
        title="Quotation details are not available"
        description="Your role needs quotations:view access to open quotation details."
      />
    );
  }

  async function confirmStatusAction() {
    if (!quotation || !statusTarget) {
      return;
    }

    try {
      setUpdatingStatus(true);
      await updateQuotationStatus(quotation.id, statusTarget);
      showToast(
        statusTarget === "accepted"
          ? "Quotation accepted. Customer and project created."
          : "Quotation status updated.",
        "success",
      );
      setStatusTarget(null);
      await loadQuotation();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Quotation status update failed.",
        "error",
      );
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function loadQuotationPdf(
    targetQuotation: QuotationWithRelations,
    targetItems: QuotationItem[],
  ) {
    try {
      setPreparingPdf(true);
      const existingPreviewUrl = await fetchQuotationPdfPreviewUrl(targetQuotation);
      if (existingPreviewUrl) {
        setPdfPreviewUrl(existingPreviewUrl);
        return;
      }

      if (!canCreateDocuments) {
        setPdfPreviewUrl(null);
        return;
      }

      const result = await generateAndStoreQuotationPdf(
        profile,
        organization,
        targetQuotation,
        targetItems,
      );
      setPdfPreviewUrl(result.previewUrl);
    } catch {
      setPdfPreviewUrl(null);
    } finally {
      setPreparingPdf(false);
    }
  }

  const contact = quotation ? getQuotationContact(quotation) : null;
  const snapshotValues = quotation ? quotationSnapshotFormValues(quotation) : {};
  const materialItems = quotation
    ? detailMaterialItems(quotation, snapshotValues.material_items)
    : [];
  const warrantyRows = quotation
    ? detailWarrantyRows(quotation, snapshotValues.warranty_rows)
    : [];
  const paymentTermRows = quotation
    ? detailPaymentTermRows(quotation, snapshotValues.payment_term_rows)
    : [];
  const materialSummary = quotation
    ? deriveQuotationMaterialSummary(materialItems)
    : null;
  const validUntilDate =
    quotationValidUntilFromDateInput(quotation?.quotation_date) ||
    quotation?.valid_until ||
    snapshotValues.valid_until ||
    null;
  const estimatedGeneration =
    quotation?.expected_annual_generation_kwh ??
    quotation?.estimated_generation_units ??
    numberFromFormValue(
      snapshotValues.expected_annual_generation_kwh ||
        snapshotValues.estimated_generation_units,
    ) ??
    null;
  const customerType = labelize(
    quotation?.customer_type ||
      snapshotValues.customer_type ||
      quotation?.customer?.customer_type,
  );
  const customerCityVillage =
    quotation?.customer_city_village ||
    snapshotValues.customer_city_village ||
    quotation?.lead?.city ||
    quotation?.customer?.city ||
    "-";
  const discom = quotation?.discom || snapshotValues.discom || "-";
  const systemType = quotation?.system_type || snapshotValues.system_type || "-";
  const panelCategory =
    quotation?.module_category || snapshotValues.module_category || "-";
  const panelTechnology = quotation?.panel_type || snapshotValues.panel_type || "-";
  const inverterType = quotation?.inverter_type || snapshotValues.inverter_type || "-";
  const siteType =
    quotation?.site_type ||
    snapshotValues.site_type ||
    quotation?.lead?.roof_type ||
    quotation?.lead?.property_type ||
    "-";
  const moduleBrand =
    quotation?.summary_module_brand ||
    snapshotValues.summary_module_brand ||
    materialSummary?.summary_module_brand ||
    "-";
  const moduleWattage =
    quotation?.summary_module_wattage ??
    numberFromFormValue(snapshotValues.summary_module_wattage) ??
    materialSummary?.summary_module_wattage ??
    null;
  const inverterBrand =
    quotation?.summary_inverter_brand ||
    snapshotValues.summary_inverter_brand ||
    materialSummary?.summary_inverter_brand ||
    "-";
  const totalTurnkeyCost =
    quotation?.summary_total_turnkey_cost ??
    numberFromFormValue(snapshotValues.summary_total_turnkey_cost) ??
    quotation?.pricing_total_rate ??
    numberFromFormValue(snapshotValues.pricing_total_rate);
  const detailGstBreakdown = hasTurnkeyGstAmount(totalTurnkeyCost)
    ? calculateTurnkeyGstBreakdown(totalTurnkeyCost)
    : null;
  const detailDiscountedTotals = detailGstBreakdown
    ? calculateDiscountedTurnkeyTotals(
        totalTurnkeyCost,
        quotation?.discount_amount ??
          numberFromFormValue(snapshotValues.discount_amount) ??
          0,
      )
    : null;
  const detailDiscountAmount =
    quotation?.discount_amount ??
    numberFromFormValue(snapshotValues.discount_amount) ??
    0;
  const detailTotalAmount =
    detailDiscountedTotals?.totalAmount ??
    discountedTurnkeyAmount(totalTurnkeyCost, detailDiscountAmount);
  const amountInWords =
    amountInWordsFromTurnkeyCost(
      detailTotalAmount ?? totalTurnkeyCost,
      quotation?.summary_amount_in_words ||
        snapshotValues.summary_amount_in_words ||
        "-",
    );
  const workDescription =
    quotation?.work_description || snapshotValues.work_description || "-";
  const pricingRemarks =
    quotation?.pricing_remarks || snapshotValues.pricing_remarks || "-";
  const paymentTerms =
    quotation?.payment_terms || snapshotValues.payment_terms || "-";
  const maintenanceDuration =
    quotation?.maintenance_duration || snapshotValues.maintenance_duration || "-";
  const maintenanceIncluded =
    quotation?.maintenance_included ??
    snapshotValues.maintenance_included ??
    false;
  const pricingTaxIncluded =
    quotation?.pricing_tax_included ?? snapshotValues.pricing_tax_included ?? false;
  const scopeAndCommercial = {
    proposal_important_considerations:
      quotation?.proposal_important_considerations ||
      snapshotValues.proposal_important_considerations ||
      defaultProposalScope.proposal_important_considerations,
    proposal_client_responsibilities:
      quotation?.proposal_client_responsibilities ||
      snapshotValues.proposal_client_responsibilities ||
      defaultProposalScope.proposal_client_responsibilities,
    proposal_exclusions:
      quotation?.proposal_exclusions ||
      snapshotValues.proposal_exclusions ||
      defaultProposalScope.proposal_exclusions,
    proposal_included_scope:
      quotation?.proposal_included_scope ||
      snapshotValues.proposal_included_scope ||
      defaultProposalScope.proposal_included_scope,
    commercial_price_basis:
      quotation?.commercial_price_basis ||
      snapshotValues.commercial_price_basis ||
      defaultCommercialTerms.commercial_price_basis,
    commercial_gst_terms:
      quotation?.commercial_gst_terms ||
      snapshotValues.commercial_gst_terms ||
      defaultCommercialTerms.commercial_gst_terms,
    commercial_security_deposit_terms:
      quotation?.commercial_security_deposit_terms ||
      snapshotValues.commercial_security_deposit_terms ||
      defaultCommercialTerms.commercial_security_deposit_terms,
    commercial_transit_insurance:
      quotation?.commercial_transit_insurance ||
      snapshotValues.commercial_transit_insurance ||
      defaultCommercialTerms.commercial_transit_insurance,
    commercial_site_storage_insurance:
      quotation?.commercial_site_storage_insurance ||
      snapshotValues.commercial_site_storage_insurance ||
      defaultCommercialTerms.commercial_site_storage_insurance,
    commercial_project_initiation:
      quotation?.commercial_project_initiation ||
      snapshotValues.commercial_project_initiation ||
      defaultCommercialTerms.commercial_project_initiation,
    commercial_warranty_applicability:
      quotation?.commercial_warranty_applicability ||
      snapshotValues.commercial_warranty_applicability ||
      defaultCommercialTerms.commercial_warranty_applicability,
  };
  const reservationSummary = summarizeReservations(reservations);
  const relatedSiteSurveyId =
    quotation?.related_site_survey_id ?? quotation?.site_survey_id ?? null;
  const openProjectId = existingProject?.id ?? quotation?.project_id ?? null;
  const workflowState = quotationWorkflowState(
    quotation && relatedSiteSurveyId ? [{ status: quotation.status }] : [],
  );
  return (
    <div className="space-y-6">
      <Link className="text-sm font-semibold text-[#06173f]" to="/quotations">
        Back to quotations
      </Link>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load quotation" description={error} /> : null}
      {!loading && !error && !quotation ? (
        <EmptyState
          title="Quotation not found"
          description="This quotation may have been deleted or is outside your organization access."
        />
      ) : null}

      {quotation && contact ? (
        <>
          <div>
            <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-3">
                <RecordTitle
                  recordType="Quotation"
                  name={contact.customerName}
                  meta={[
                    quotation.quotation_code ?? "Quotation",
                    quotation.site_survey?.survey_code ??
                      quotation.lead?.lead_code ??
                      quotation.customer?.customer_code,
                    labelize(quotation.status),
                    contact.phone,
                  ]}
                  action={
                    canUpdate && quotation.status === "draft" && !quotation.archived_at ? (
                      <button
                        aria-label="Edit quotation"
                        className="inline-flex min-h-10 w-10 items-center justify-center rounded-lg border border-stone-200 bg-white text-slate-700 shadow-sm transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => navigate(`/quotations/${quotation.id}/edit`)}
                        title="Edit quotation"
                        type="button"
                      >
                        <PencilIcon />
                      </button>
                    ) : null
                  }
                />
                <QuotationStatusPill quotation={quotation} />
              </div>
              <div className="space-y-3 lg:max-w-md lg:shrink-0 lg:text-right">
                <div className="lg:flex lg:justify-end">
                  <NextStepLabel />
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  {pdfPreviewUrl ? (
                    <a
                      className="inline-flex min-h-10 items-center justify-center rounded-lg border border-orange-600 bg-orange-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-700"
                      download
                      href={pdfPreviewUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Download Quotation
                    </a>
                  ) : (
                    <PlaceholderAction>
                      {preparingPdf ? "Preparing Quotation" : "Download Quotation"}
                    </PlaceholderAction>
                  )}
                  {workflowState !== "none" && workflowState !== "accepted" ? (
                    <QuotationWorkflowPill state={workflowState} />
                  ) : openProjectId && canViewProjects && quotation.status === "accepted" ? (
                    <Link
                      className="inline-flex min-h-10 items-center justify-center rounded-lg border border-orange-600 bg-orange-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-700"
                      to={`/projects/${openProjectId}`}
                    >
                      Open Project
                    </Link>
                  ) : quotation.status === "accepted" ? (
                    <PlaceholderAction>Open Project</PlaceholderAction>
                  ) : !relatedSiteSurveyId && canCreateSurvey && quotation.lead_id ? (
                    <Link
                      className="inline-flex min-h-10 items-center justify-center rounded-lg border border-orange-600 bg-orange-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-700"
                      to={`/site-surveys?new=1&leadId=${quotation.lead_id}`}
                    >
                      Create Site Survey
                    </Link>
                  ) : !relatedSiteSurveyId ? (
                    <PlaceholderAction>Create Site Survey</PlaceholderAction>
                  ) : null}
                </div>
                {canUpdate && !quotation.archived_at ? (
                  <div className="flex flex-col gap-2 lg:items-end">
                    <p className="text-sm font-medium text-slate-600">
                      Update status of quotation with the latest updates.
                    </p>
                    <QuotationStatusSelect
                      disabled={updatingStatus}
                      value={quotation.status ?? "draft"}
                      onChange={setStatusTarget}
                    />
                  </div>
                ) : null}
              </div>
            </header>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-6">
              <DetailSection title="Project And Customer">
                <DetailItem
                  label="Quotation Number"
                  value={quotation.quotation_code ?? "-"}
                />
                <DetailItem
                  label="Quotation Date"
                  value={formatDate(quotation.quotation_date)}
                />
                <DetailItem
                  label="Valid Until"
                  value={formatDate(validUntilDate)}
                />
                <DetailItem
                  label="Quotation Title"
                  value={quotation.quotation_title ?? "-"}
                />
                <DetailItem label="Lead" value={leadLink(quotation)} />
                <DetailItem label="Site Survey" value={surveyLink(quotation)} />
                <DetailItem label="Customer" value={customerLink(quotation)} />
                <DetailItem label="Phone" value={contact.phone} />
                <DetailItem
                  label="Email"
                  value={quotation.customer?.email ?? quotation.lead?.email ?? "-"}
                />
                <DetailItem label="Customer Type" value={customerType} />
                <DetailItem label="Location / Address" value={contact.address || "-"} />
                <DetailItem label="City / Village" value={customerCityVillage} />
                <DetailItem label="DISCOM" value={discom} />
                <DetailItem
                  label="System Capacity (kW)"
                  value={formatKw(quotation.system_capacity_kw)}
                />
                <DetailItem label="System Type" value={systemType} />
                <DetailItem label="Panel Category" value={panelCategory} />
                <DetailItem
                  label="Panel Technology"
                  value={panelTechnology}
                />
                <DetailItem
                  label="Inverter Type"
                  value={inverterType}
                />
                <DetailItem label="Site Type" value={siteType} />
                <DetailItem
                  label="Expected Generation p.a. (kWh)"
                  value={
                    estimatedGeneration === null || estimatedGeneration === undefined
                      ? "-"
                      : `${estimatedGeneration} kWh`
                  }
                />
                <DetailItem
                  label="Panel Brand"
                  value={moduleBrand}
                />
                <DetailItem
                  label="Panel Wattage"
                  value={
                    moduleWattage === null ||
                    moduleWattage === undefined ||
                    moduleWattage === ""
                      ? "-"
                      : `${moduleWattage} W`
                  }
                />
                <DetailItem
                  label="Inverter Brand"
                  value={inverterBrand}
                />
              </DetailSection>

              <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
                <h2 className="text-base font-semibold text-slate-950">
                  Standard Bill Of Material
                </h2>
                {materialItems.length > 0 ? (
                  <div className="mt-4 overflow-hidden rounded-xl border border-stone-200">
                    <table className="w-full border-collapse text-left text-sm">
                      <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Sr.</th>
                          <th className="px-4 py-3">Material</th>
                          <th className="px-4 py-3">Brand</th>
                          <th className="px-4 py-3">Specifications</th>
                          <th className="px-4 py-3">Quantity</th>
                          <th className="px-4 py-3">Unit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {materialItems.map((item, index) => (
                          <tr key={`${item.description}-${index}`}>
                            <td className="px-4 py-3">{index + 1}</td>
                            <td className="px-4 py-3">{item.description || "-"}</td>
                            <td className="px-4 py-3">{item.brand || "-"}</td>
                            <td className="px-4 py-3">
                              {item.specification || item.make_specification || "-"}
                            </td>
                            <td className="px-4 py-3">{item.quantity || "-"}</td>
                            <td className="px-4 py-3">{item.unit || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">
                    No installation material rows added.
                  </p>
                )}
              </section>

              <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-base font-semibold text-slate-950">
                    Inventory Reservations
                  </h2>
                  <p className="text-sm text-slate-500">
                    {formatStock(reservationSummary.reservedQty)} reserved /{" "}
                    {formatStock(reservationSummary.shortageQty)} shortage
                  </p>
                </div>
                {reservations.length > 0 ? (
                  <div className="mt-4 overflow-hidden rounded-xl border border-stone-200">
                    <table className="w-full border-collapse text-left text-sm">
                      <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Item</th>
                          <th className="px-4 py-3">Required</th>
                          <th className="px-4 py-3">Reserved</th>
                          <th className="px-4 py-3">Shortage</th>
                          <th className="px-4 py-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {reservations.map((reservation) => (
                          <tr key={reservation.id}>
                            <td className="px-4 py-3">
                              <div className="font-semibold text-slate-950">
                                {reservationItemLabel(reservation)}
                              </div>
                              {reservation.notes ? (
                                <p className="mt-1 text-xs text-slate-500">
                                  {reservation.notes}
                                </p>
                              ) : null}
                            </td>
                            <td className="px-4 py-3">
                              {formatStock(
                                reservation.required_qty,
                                reservation.inventory_item?.unit ||
                                  reservation.catalog_product?.unit,
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {formatStock(
                                reservation.reserved_qty,
                                reservation.inventory_item?.unit ||
                                  reservation.catalog_product?.unit,
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {formatStock(
                                reservation.shortage_qty,
                                reservation.inventory_item?.unit ||
                                  reservation.catalog_product?.unit,
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <ReservationStatusPill value={reservation.status} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">
                    Reservations appear after this quotation is accepted.
                  </p>
                )}
              </section>

              <DetailSection title="Commercial Terms And Scope">
                <DetailItem
                  label="Total Turnkey Cost"
                  value={
                    totalTurnkeyCost
                      ? formatMoney(totalTurnkeyCost)
                      : "-"
                  }
                />
                <DetailItem
                  label="Discount Amount"
                  value={formatMoney(detailDiscountAmount)}
                />
                {detailTotalAmount !== null &&
                detailTotalAmount !== undefined &&
                detailDiscountAmount > 0 ? (
                  <DetailItem
                    label="Discounted Price"
                    value={formatMoneyWithPaise(detailTotalAmount)}
                  />
                ) : null}
                <DetailItem label="Total Amount In Words" value={amountInWords} />
                <DetailItem
                  label="Taxable Amount"
                  value={
                    detailDiscountedTotals
                      ? formatMoneyWithPaise(detailDiscountedTotals.taxableAmount)
                      : "-"
                  }
                />
                <DetailItem
                  label="CGST"
                  value={
                    detailDiscountedTotals
                      ? formatMoneyWithPaise(detailDiscountedTotals.cgstAmount)
                      : "-"
                  }
                />
                <DetailItem
                  label="SGST"
                  value={
                    detailDiscountedTotals
                      ? formatMoneyWithPaise(detailDiscountedTotals.sgstAmount)
                      : "-"
                  }
                />
                <DetailItem
                  label="Total GST"
                  value={
                    detailDiscountedTotals
                      ? formatMoneyWithPaise(detailDiscountedTotals.gstAmount)
                      : "-"
                  }
                />
                <DetailItem
                  label="Subsidy Amount"
                  value={formatMoney(quotation.subsidy_amount)}
                />
                <DetailItem
                  label="Price Basis"
                  value={scopeAndCommercial.commercial_price_basis}
                />
                <DetailItem
                  label="GST Terms"
                  value={scopeAndCommercial.commercial_gst_terms}
                />
                <DetailItem
                  label="Security Deposit / DISCOM Charges"
                  value={scopeAndCommercial.commercial_security_deposit_terms}
                />
                <DetailItem
                  label="Transit Insurance"
                  value={scopeAndCommercial.commercial_transit_insurance}
                />
                <DetailItem
                  label="Storage And Insurance At Site"
                  value={scopeAndCommercial.commercial_site_storage_insurance}
                />
                <DetailItem
                  label="Project Initiation"
                  value={scopeAndCommercial.commercial_project_initiation}
                />
                <DetailItem
                  label="Warranty Applicability"
                  value={scopeAndCommercial.commercial_warranty_applicability}
                />
                <DetailItem
                  label="Included Scope"
                  value={scopeAndCommercial.proposal_included_scope}
                />
                <DetailItem
                  label="Important Considerations"
                  value={scopeAndCommercial.proposal_important_considerations}
                />
                <DetailItem
                  label="Client Responsibilities"
                  value={scopeAndCommercial.proposal_client_responsibilities}
                />
                <DetailItem
                  label="Exclusions"
                  value={scopeAndCommercial.proposal_exclusions}
                />
              </DetailSection>

              <DetailSection title="Warranty And Payment Terms">
                <div className="sm:col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Warranty Table
                  </p>
                  {warrantyRows.length > 0 ? (
                    <div className="mt-2 overflow-hidden rounded-xl border border-stone-200">
                      <table className="w-full border-collapse text-left text-sm">
                        <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-4 py-3">Sr.</th>
                            <th className="px-4 py-3">Component</th>
                            <th className="px-4 py-3">Warranty</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100">
                          {warrantyRows
                            .slice()
                            .sort(
                              (first, second) =>
                                (first.sort_order ?? 0) - (second.sort_order ?? 0),
                            )
                            .map((warranty, index) => (
                              <tr key={warranty.id}>
                                <td className="px-4 py-3">{index + 1}</td>
                                <td className="px-4 py-3 font-medium text-slate-900">
                                  {warranty.component || "-"}
                                </td>
                                <td className="px-4 py-3">
                                  {warranty.warranty_text || "-"}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-slate-500">
                      No warranty rows added.
                    </p>
                  )}
                </div>
                <DetailItem label="Work Description" value={workDescription} />
                <DetailItem
                  label="Tax/GST"
                  value={pricingTaxIncluded ? "Included" : "Excluded"}
                />
                <DetailItem label="Pricing Remarks" value={pricingRemarks} />
                <DetailItem
                  label="Maintenance"
                  value={`${maintenanceDuration} ${
                    maintenanceIncluded ? "included" : "excluded"
                  }`}
                />
                <DetailItem label="Payment Terms" value={paymentTerms} />
                <div className="sm:col-span-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Payment Terms
                  </p>
                  {paymentTermRows.length > 0 ? (
                    <div className="mt-2 overflow-hidden rounded-xl border border-stone-200">
                      <table className="w-full border-collapse text-left text-sm">
                        <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-4 py-3">Sr.</th>
                            <th className="px-4 py-3">Milestone</th>
                            <th className="px-4 py-3">Percentage</th>
                            <th className="px-4 py-3">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100">
                          {paymentTermRows
                            .slice()
                            .sort(
                              (first, second) =>
                                (first.sort_order ?? 0) -
                                (second.sort_order ?? 0),
                            )
                            .map((paymentTerm, index) => (
                              <tr key={paymentTerm.id}>
                                <td className="px-4 py-3">{index + 1}</td>
                                <td className="px-4 py-3 font-medium text-slate-900">
                                  {paymentTerm.milestone || "-"}
                                </td>
                                <td className="px-4 py-3">
                                  {paymentTerm.percentage === null ||
                                  paymentTerm.percentage === undefined ||
                                  paymentTerm.percentage === ""
                                    ? "-"
                                    : `${paymentTerm.percentage}%`}
                                </td>
                                <td className="px-4 py-3">
                                  {formatPaymentTermAmount(
                                    paymentTerm.amount,
                                    paymentTerm.percentage,
                                    detailTotalAmount ?? totalTurnkeyCost,
                                  )}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-slate-500">
                      No payment milestones added.
                    </p>
                  )}
                </div>
              </DetailSection>

            </div>

            <TotalsCard quotation={quotation} snapshotValues={snapshotValues} />
          </div>

          <RecordLifecyclePanel
            archiveReason={quotation.archive_reason}
            archivedAt={quotation.archived_at}
            canDelete={canDelete}
            canUpdate={canUpdate}
            moduleKey="quotations"
            onChanged={async (action) => {
              if (action === "delete") {
                showToast("Quotation permanently deleted.", "success");
                navigate("/quotations");
                return;
              }
              showToast(action === "archive" ? "Quotation archived." : "Quotation restored.", "success");
              await loadQuotation();
            }}
            recordId={quotation.id}
            recordLabel={quotation.quotation_code || "Quotation"}
          />
        </>
      ) : null}

      {statusTarget && quotation ? (
        <ConfirmDialog
          title="Update quotation status?"
          description={`Set ${quotation.quotation_code ?? "this quotation"} to ${labelize(statusTarget)}.`}
          confirming={updatingStatus}
          confirmLabel={statusTarget === "rejected" ? "Reject" : "Update Status"}
          confirmingLabel="Updating..."
          confirmVariant={statusTarget === "rejected" ? "danger" : "primary"}
          onCancel={() => setStatusTarget(null)}
          onConfirm={confirmStatusAction}
        />
      ) : null}

    </div>
  );
}

function QuotationStatusPill({
  quotation,
}: {
  quotation: QuotationWithRelations;
}) {
  return (
    <div className="inline-flex w-fit flex-wrap items-center gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm">
      <span className="text-base font-semibold text-slate-950">Status</span>
      <QuotationStatusBadge value={quotation.status} />
      <span className="text-slate-400">/</span>
      <span>{formatDateTime(quotationStatusUpdatedAt(quotation))}</span>
    </div>
  );
}

function summarizeReservations(reservations: QuotationInventoryReservation[]) {
  return reservations.reduce(
    (summary, reservation) => {
      if (reservation.status === "active" || reservation.status === "partial") {
        summary.reservedQty += Number(reservation.reserved_qty ?? 0);
      }

      if (reservation.status === "partial" || reservation.status === "shortage") {
        summary.shortageQty += Number(reservation.shortage_qty ?? 0);
      }

      return summary;
    },
    { reservedQty: 0, shortageQty: 0 },
  );
}

function reservationItemLabel(reservation: QuotationInventoryReservation) {
  const inventoryLabel = [
    reservation.inventory_item?.item_code,
    reservation.inventory_item?.item_name,
    reservation.inventory_item?.brand,
    reservation.inventory_item?.model,
  ]
    .filter(Boolean)
    .join(" / ");

  if (inventoryLabel) {
    return inventoryLabel;
  }

  return [
    reservation.catalog_product?.product_code,
    reservation.catalog_product?.product_name,
    reservation.catalog_product?.brand,
    reservation.catalog_product?.model_number,
  ]
    .filter(Boolean)
    .join(" / ") || "Unmapped quotation item";
}

function ReservationStatusPill({
  value,
}: {
  value: QuotationInventoryReservation["status"];
}) {
  const tone =
    value === "active" || value === "converted"
      ? "border-emerald-200 bg-emerald-50 text-[#06173f]"
      : value === "partial"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : value === "shortage"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-stone-200 bg-stone-50 text-slate-600";

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {labelize(value)}
    </span>
  );
}

function QuotationStatusSelect({
  value,
  onChange,
  disabled,
}: {
  value: QuotationStatus;
  onChange: (status: QuotationStatus) => void;
  disabled: boolean;
}) {
  return (
    <label className="inline-flex">
      <span className="sr-only">Update quotation status</span>
      <select
        className="min-h-10 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm outline-none transition hover:bg-stone-50 focus:border-orange-600 focus:ring-2 focus:ring-orange-100 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        value={value}
        onChange={(event) => {
          const nextStatus = event.target.value as QuotationStatus;
          if (nextStatus !== value) {
            onChange(nextStatus);
          }
        }}
      >
        {quotationStatusOptions.map((status) => (
          <option key={status} value={status}>
            {labelize(status)}
          </option>
        ))}
      </select>
    </label>
  );
}

function PencilIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="m4 20 4.4-1.1L19.2 8.1a2.4 2.4 0 0 0 0-3.4 2.4 2.4 0 0 0-3.4 0L5 15.5 4 20Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="m14.5 6 3.5 3.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function quotationStatusUpdatedAt(quotation: QuotationWithRelations) {
  if (quotation.status === "accepted") {
    return quotation.accepted_at ?? quotation.updated_at;
  }

  if (quotation.status === "rejected") {
    return quotation.rejected_at ?? quotation.updated_at;
  }

  if (quotation.status === "sent") {
    return quotation.sent_at ?? quotation.updated_at;
  }

  return quotation.updated_at ?? quotation.created_at;
}

function TotalsCard({
  quotation,
  snapshotValues,
}: {
  quotation: QuotationWithRelations;
  snapshotValues: Partial<QuotationFormValues>;
}) {
  const turnkeyAmount =
    quotation.summary_total_turnkey_cost ??
    numberFromFormValue(snapshotValues.summary_total_turnkey_cost) ??
    quotation.pricing_total_rate ??
    numberFromFormValue(snapshotValues.pricing_total_rate);
  const gstBreakdown = hasTurnkeyGstAmount(turnkeyAmount)
    ? calculateTurnkeyGstBreakdown(turnkeyAmount)
    : null;
  const discountAmount = Number(
    quotation.discount_amount ??
      numberFromFormValue(snapshotValues.discount_amount) ??
      0,
  );
  const subsidyAmount = Number(
    quotation.subsidy_amount ??
      numberFromFormValue(snapshotValues.subsidy_amount) ??
      0,
  );
  const discountedTotals = gstBreakdown
    ? calculateDiscountedTurnkeyTotals(turnkeyAmount, discountAmount)
    : null;
  const totalAmount = discountedTotals
    ? discountedTotals.totalAmount
    : Number(quotation.total_amount ?? 0);
  return (
    <aside className="xl:sticky xl:top-24 xl:max-h-[calc(100vh-7rem)] xl:self-start xl:overflow-y-auto xl:pr-1">
      <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Totals</h2>
        <dl className="mt-4 space-y-3 text-sm">
          <TotalRow
            label="Base Amount"
            value={discountedTotals?.taxableAmount ?? quotation.base_amount}
            precise={Boolean(discountedTotals)}
          />
          <TotalRow
            label="GST Amount"
            value={discountedTotals?.gstAmount ?? quotation.gst_amount}
            precise={Boolean(discountedTotals)}
          />
          {discountedTotals ? (
            <>
              <TotalRow label="CGST" value={discountedTotals.cgstAmount} precise />
              <TotalRow label="SGST" value={discountedTotals.sgstAmount} precise />
            </>
          ) : null}
          <TotalRow label="Discount" value={discountAmount} />
          <TotalRow label="Total Amount" value={totalAmount} />
          <TotalRow label="Subsidy" value={subsidyAmount} />
          <div className="border-t border-stone-200 pt-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Total Amount
            </dt>
            <dd className="mt-1 text-2xl font-semibold text-slate-950">
              {formatMoney(totalAmount)}
            </dd>
          </div>
        </dl>
      </section>
    </aside>
  );
}

function TotalRow({
  label,
  value,
  precise = false,
}: {
  label: string;
  value: number | null | undefined;
  precise?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-slate-600">{label}</dt>
      <dd className="font-semibold text-slate-950">
        {precise ? formatMoneyWithPaise(value) : formatMoney(value)}
      </dd>
    </div>
  );
}

type DetailPaymentTermRow = Omit<
  QuotationPaymentTerm,
  "amount" | "percentage"
> & {
  amount: number | string | null;
  percentage: number | string | null;
};

function detailMaterialItems(
  quotation: QuotationWithRelations,
  snapshotRows: QuotationMaterialItem[] | undefined,
) {
  const storedRows = (quotation.material_items ?? []).filter(hasMaterialRow);
  if (storedRows.length > 0) {
    return storedRows;
  }

  return (snapshotRows ?? []).filter(hasMaterialRow);
}

function detailWarrantyRows(
  quotation: QuotationWithRelations,
  snapshotRows:
    | Array<{ component?: string; warranty_text?: string }>
    | undefined,
) {
  const storedRows = (quotation.quotation_warranties ?? []).filter((row) =>
    [row.component, row.warranty_text].some(hasDisplayText),
  );

  if (storedRows.length > 0) {
    return storedRows;
  }

  if (Array.isArray(snapshotRows)) {
    return snapshotRows
      .filter((row) =>
        [row.component, row.warranty_text].some(hasDisplayText),
      )
      .map<QuotationWarranty>((row, index) => ({
        id: `snapshot-warranty-${index}`,
        quotation_id: quotation.id,
        component: row.component ?? "",
        warranty_text: row.warranty_text ?? "",
        sort_order: index + 1,
        tenant_id: quotation.organization_id,
        created_at: null,
        updated_at: null,
      }));
  }

  return defaultQuotationWarranties.map<QuotationWarranty>((row, index) => ({
    id: `default-warranty-${index}`,
    quotation_id: quotation.id,
    component: row.component,
    warranty_text: row.warranty_text,
    sort_order: index + 1,
    tenant_id: quotation.organization_id,
    created_at: null,
    updated_at: null,
  }));
}

function detailPaymentTermRows(
  quotation: QuotationWithRelations,
  snapshotRows:
    | Array<{ milestone?: string; percentage?: string; amount?: string }>
    | undefined,
): DetailPaymentTermRow[] {
  const storedRows = (quotation.quotation_payment_terms ?? []).filter((row) =>
    [row.milestone, row.percentage, row.amount].some(hasDisplayText),
  );

  if (storedRows.length > 0) {
    return storedRows;
  }

  const sourceRows = Array.isArray(snapshotRows)
    ? snapshotRows
    : defaultTechnicalPaymentTerms;

  return sourceRows
    .filter((row) =>
      [row.milestone, row.percentage, row.amount].some(hasDisplayText),
    )
    .map<DetailPaymentTermRow>((row, index) => ({
      id: `${Array.isArray(snapshotRows) ? "snapshot" : "default"}-payment-${index}`,
      quotation_id: quotation.id,
      milestone: row.milestone ?? "",
      percentage: row.percentage ?? null,
      amount: row.amount ?? null,
      sort_order: index + 1,
      tenant_id: quotation.organization_id,
      created_at: null,
      updated_at: null,
    }));
}

function hasMaterialRow(item: QuotationMaterialItem) {
  return [
    item.description,
    item.brand,
    item.specification,
    item.make_specification,
    item.quantity,
    item.unit,
  ].some(hasDisplayText);
}

function hasDisplayText(value: unknown) {
  return String(value ?? "").trim() !== "";
}

function numberFromFormValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? numberValue : null;
}

function formatPaymentTermAmount(
  amount: number | string | null | undefined,
  percentage: number | string | null | undefined,
  totalAmount: number | string | null | undefined,
) {
  const percent = numberFromFormValue(percentage);
  const total = numberFromFormValue(totalAmount);

  if (percent !== null && total !== null && total > 0) {
    return formatMoney(total * percent / 100);
  }

  const savedAmount = numberFromFormValue(amount);

  return savedAmount === null ? "-" : formatMoney(savedAmount);
}


function customerLink(quotation: QuotationWithRelations) {
  if (!quotation.customer_id) {
    if (quotation.lead_id) {
      return (
        <Link
          className="font-semibold text-[#06173f]"
          to={`/leads/${quotation.lead_id}`}
        >
          {quotation.lead?.full_name ?? quotation.lead?.lead_code ?? "Open lead"}
        </Link>
      );
    }

    return quotation.lead?.full_name ?? "-";
  }

  return (
    <Link
      className="font-semibold text-[#06173f]"
      to={`/customers/${quotation.customer_id}`}
    >
      {quotation.customer?.customer_code ??
        quotation.customer?.full_name ??
        "Open customer"}
    </Link>
  );
}

function leadLink(quotation: QuotationWithRelations) {
  if (!quotation.lead_id) {
    return "-";
  }

  return (
    <Link className="font-semibold text-[#06173f]" to={`/leads/${quotation.lead_id}`}>
      {quotation.lead?.lead_code ?? quotation.lead?.full_name ?? "Open lead"}
    </Link>
  );
}

function surveyLink(quotation: QuotationWithRelations) {
  if (!quotation.site_survey_id) {
    return "-";
  }

  return (
    <Link
      className="font-semibold text-[#06173f]"
      to={`/site-surveys/${quotation.site_survey_id}`}
    >
      {quotation.site_survey?.survey_code ?? "Open survey"}
    </Link>
  );
}
