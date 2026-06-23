import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { useToast } from "../../components/ui/ToastProvider";
import {
  AccessDenied,
  Button,
  ConfirmDialog,
  DetailItem,
  DetailSection,
  EmptyState,
  LoadingSkeleton,
} from "../crm/CrmComponents";
import {
  formatDate,
  formatDateTime,
  hasPermission,
  labelize,
} from "../crm/crmUtils";
import {
  acceptQuotation,
  deleteQuotation,
  fetchQuotation,
  fetchQuotationItems,
  fetchQuotationReservations,
  markQuotationSent,
  rejectQuotation,
} from "./quotationApi";
import {
  calculateDiscountedTurnkeyTotals,
  calculateTurnkeyGstBreakdown,
  deriveQuotationMaterialSummary,
  defaultCommercialTerms,
  defaultProposalScope,
  defaultQuotationWarranties,
  defaultTechnicalPaymentTerms,
  formatKw,
  formatMoney,
  formatMoneyWithPaise,
  formatYesNo,
  getQuotationContact,
  hasTurnkeyGstAmount,
  quotationSnapshotFormValues,
} from "./quotationUtils";
import { QuotationStatusBadge } from "./QuotationsPage";
import type {
  QuotationFormValues,
  QuotationInventoryReservation,
  QuotationMaterialItem,
  QuotationItem,
  QuotationPaymentTerm,
  QuotationWithRelations,
  QuotationWarranty,
} from "./types";
import {
  createProjectFromQuotation,
  fetchProjectByQuotation,
} from "../projects/projectApi";
import { formatStock } from "../inventory/inventoryUtils";
import type { ProjectWithRelations } from "../projects/types";
import { buildQuotationPdf } from "../documents/businessPdf";
import {
  buildQuotationPdfPath,
  fetchBusinessDocumentSettings,
  uploadGeneratedPdf,
} from "../documents/generatedPdfApi";

type StatusAction = "sent" | "accepted" | "rejected";

export function QuotationDetailPage() {
  const { id } = useParams();
  const { profile, permissions, organization } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [quotation, setQuotation] = useState<QuotationWithRelations | null>(null);
  const [items, setItems] = useState<QuotationItem[]>([]);
  const [reservations, setReservations] = useState<
    QuotationInventoryReservation[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [statusTarget, setStatusTarget] = useState<StatusAction | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [existingProject, setExistingProject] =
    useState<ProjectWithRelations | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [localPdfPreviewUrl, setLocalPdfPreviewUrl] = useState<string | null>(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [previewingPdf, setPreviewingPdf] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);

  const canView = hasPermission(profile, permissions, "quotations", "view");
  const canUpdate = hasPermission(profile, permissions, "quotations", "update");
  const canDelete = hasPermission(profile, permissions, "quotations", "delete");
  const canViewProjects = hasPermission(profile, permissions, "projects", "view");
  const canCreateDocuments = hasPermission(
    profile,
    permissions,
    "documents",
    "create",
  );
  const canCreateProject = hasPermission(
    profile,
    permissions,
    "projects",
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
      setItems(nextItems);
      setReservations(nextReservations);
      if (nextQuotation && canViewProjects) {
        setExistingProject(await fetchProjectByQuotation(profile, nextQuotation.id));
      } else {
        setExistingProject(null);
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

  useEffect(
    () => () => {
      if (localPdfPreviewUrl) {
        URL.revokeObjectURL(localPdfPreviewUrl);
      }
    },
    [localPdfPreviewUrl],
  );

  useEffect(() => {
    function handleDocumentPointerDown(event: MouseEvent) {
      if (
        actionsMenuRef.current &&
        !actionsMenuRef.current.contains(event.target as Node)
      ) {
        setActionsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleDocumentPointerDown);
    return () => {
      document.removeEventListener("mousedown", handleDocumentPointerDown);
    };
  }, []);

  if (!canView) {
    return (
      <AccessDenied
        title="Quotation details are not available"
        description="Your role needs quotations:view access to open quotation details."
      />
    );
  }

  async function handleDelete() {
    if (!quotation) {
      return;
    }

    try {
      setDeleting(true);
      await deleteQuotation(quotation.id);
      showToast("Quotation deleted.", "success");
      navigate("/quotations");
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Quotation delete failed.",
        "error",
      );
    } finally {
      setDeleting(false);
    }
  }

  async function confirmStatusAction() {
    if (!quotation || !statusTarget) {
      return;
    }

    try {
      setUpdatingStatus(true);
      if (statusTarget === "sent") {
        await markQuotationSent(quotation.id);
      } else if (statusTarget === "accepted") {
        await acceptQuotation(quotation.id);
      } else {
        await rejectQuotation(quotation.id);
      }
      showToast("Quotation status updated.", "success");
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

  async function handleCreateProject() {
    if (!quotation) {
      return;
    }

    if (existingProject) {
      navigate(`/projects/${existingProject.id}`);
      return;
    }

    try {
      setCreatingProject(true);
      const project = await createProjectFromQuotation(quotation.id);
      showToast("Project created from accepted quotation.", "success");
      navigate(`/projects/${project.id}`);
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Project creation failed.",
        "error",
      );
      await loadQuotation();
    } finally {
      setCreatingProject(false);
    }
  }

  function validateQuotationPdfExport() {
    if (!quotation) {
      return ["Quotation could not be loaded."];
    }

    const errors: string[] = [];
    const hasBomRows =
      items.length > 0 ||
      (quotation.material_items ?? []).some(
        (item) =>
          item.description.trim() ||
          item.make_specification.trim() ||
          item.quantity.trim() ||
          item.unit.trim(),
      );
    const effectiveTotalAmount = Math.max(
      Number(quotation.total_amount ?? 0),
      Number(quotation.pricing_total_rate ?? 0),
    );

    if (!quotation.customer_id && !quotation.lead_id && !quotation.site_survey_id) {
      errors.push("Select a lead, customer, or site survey before generating the quotation PDF.");
    }

    if (
      quotation.system_capacity_kw === null ||
      quotation.system_capacity_kw === undefined ||
      Number(quotation.system_capacity_kw) <= 0
    ) {
      errors.push("Enter the system capacity before generating the PDF.");
    }

    if (!Number.isFinite(effectiveTotalAmount) || effectiveTotalAmount <= 0) {
      errors.push("Add a total amount greater than 0 before generating the PDF.");
    }

    if (!hasBomRows) {
      errors.push("Add at least one quotation item or BOM item before generating the PDF.");
    }

    return errors;
  }

  function showPdfValidationErrors(errors: string[]) {
    showToast(errors.join(" "), "error");
  }

  async function handlePreviewPdf() {
    if (!quotation) {
      return;
    }

    const validationErrors = validateQuotationPdfExport();
    if (validationErrors.length > 0) {
      showPdfValidationErrors(validationErrors);
      return;
    }

    try {
      setPreviewingPdf(true);
      const settings = await fetchBusinessDocumentSettings();
      const pdfBlob = await buildQuotationPdf(
        quotation,
        items,
        organization,
        settings,
      );
      const nextPreviewUrl = URL.createObjectURL(pdfBlob);

      setLocalPdfPreviewUrl((currentUrl) => {
        if (currentUrl) {
          URL.revokeObjectURL(currentUrl);
        }
        return nextPreviewUrl;
      });
      window.open(nextPreviewUrl, "_blank", "noopener,noreferrer");
      showToast("Quotation PDF preview generated.", "success");
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Quotation PDF preview failed.",
        "error",
      );
    } finally {
      setPreviewingPdf(false);
    }
  }

  async function handleGeneratePdf() {
    if (!quotation) {
      return;
    }

    const validationErrors = validateQuotationPdfExport();
    if (validationErrors.length > 0) {
      showPdfValidationErrors(validationErrors);
      return;
    }

    try {
      setGeneratingPdf(true);
      const settings = await fetchBusinessDocumentSettings();
      const filePath = buildQuotationPdfPath(
        quotation.organization_id,
        quotation.quotation_code,
        settings.quotation_prefix ?? "QUO",
        quotation.id,
      );

      const pdfBlob = await buildQuotationPdf(
        quotation,
        items,
        organization,
        settings,
      );
      if (canCreateDocuments) {
        await uploadGeneratedPdf(
          profile,
          {
            document_type: "quotation_pdf",
            document_name: `${quotation.quotation_code ?? "Quotation"} PDF`,
            file_path: filePath,
            customer_id: quotation.customer_id,
            quotation_id: quotation.id,
            notes: null,
          },
          pdfBlob,
        );
      }

      downloadBlob(pdfBlob, quotationPdfFileName(quotation));
      showToast("Quotation PDF generated and downloaded.", "success");
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Quotation PDF generation failed.",
        "error",
      );
    } finally {
      setGeneratingPdf(false);
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
    oneMonthFromDateValue(quotation?.quotation_date) ||
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
    quotation?.site_survey?.structure_type ||
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
  const structureType =
    quotation?.summary_structure_type ||
    quotation?.structure_type ||
    snapshotValues.summary_structure_type ||
    snapshotValues.structure_type ||
    materialSummary?.summary_structure_type ||
    "-";
  const dcdbIncluded =
    quotation?.summary_dcdb_included ??
    booleanFromFormValue(snapshotValues.summary_dcdb_included) ??
    materialSummary?.summary_dcdb_included;
  const acdbIncluded =
    quotation?.summary_acdb_included ??
    booleanFromFormValue(snapshotValues.summary_acdb_included) ??
    materialSummary?.summary_acdb_included;
  const earthingCount =
    quotation?.summary_earthing_count ??
    numberFromFormValue(snapshotValues.summary_earthing_count) ??
    materialSummary?.summary_earthing_count;
  const lightningArrestorIncluded =
    quotation?.summary_lightning_arrestor_included ??
    booleanFromFormValue(snapshotValues.summary_lightning_arrestor_included) ??
    materialSummary?.summary_lightning_arrestor_included;
  const remoteMonitoringIncluded =
    quotation?.summary_remote_monitoring_included ??
    booleanFromFormValue(snapshotValues.summary_remote_monitoring_included) ??
    materialSummary?.summary_remote_monitoring_included;
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
  const amountInWords =
    quotation?.summary_amount_in_words ||
    snapshotValues.summary_amount_in_words ||
    "-";
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
  return (
    <div className="space-y-6">
      <Link className="text-sm font-semibold text-brand-700" to="/quotations">
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
            <header className="space-y-3">
              <p className="text-sm font-medium text-brand-600">SolarOS</p>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <h1 className="text-2xl font-semibold tracking-normal text-slate-950 sm:text-3xl">
                  {quotation.quotation_title ?? quotation.quotation_code ?? "Quotation"}
                </h1>
                <div className="flex flex-wrap items-start gap-2 lg:justify-end">
                  {canUpdate ? (
                    <button
                      aria-label="Edit quotation"
                      className="inline-flex min-h-10 w-10 items-center justify-center rounded-lg border border-stone-200 bg-white text-slate-700 shadow-sm transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => navigate(`/quotations/${quotation.id}/edit`)}
                      title="Edit quotation"
                      type="button"
                    >
                      <PencilIcon />
                    </button>
                  ) : null}
                  <Button
                    onClick={() => void handlePreviewPdf()}
                    disabled={previewingPdf}
                    variant="secondary"
                  >
                    {previewingPdf ? "Preparing..." : "Preview PDF"}
                  </Button>
                  {localPdfPreviewUrl ? (
                    <a
                      className="inline-flex min-h-10 items-center justify-center rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-stone-50"
                      href={localPdfPreviewUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Open Preview
                    </a>
                  ) : null}
                  <Button
                    onClick={() => void handleGeneratePdf()}
                    disabled={generatingPdf || previewingPdf}
                    variant="secondary"
                  >
                    {generatingPdf ? "Generating..." : "Generate PDF"}
                  </Button>
                  <div className="relative" ref={actionsMenuRef}>
                    <button
                      aria-expanded={actionsOpen}
                      aria-haspopup="menu"
                      aria-label="Quotation actions"
                      className="inline-flex min-h-10 w-10 items-center justify-center rounded-lg border border-stone-200 bg-white text-slate-700 shadow-sm transition-colors hover:bg-stone-50"
                      onClick={() => setActionsOpen((current) => !current)}
                      title="Quotation actions"
                      type="button"
                    >
                      <VerticalDotsIcon />
                    </button>
                    {actionsOpen ? (
                      <div
                        className="absolute right-0 z-20 mt-2 w-52 overflow-hidden rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
                        role="menu"
                      >
                        {canUpdate ? (
                          <>
                            <ActionMenuButton
                              disabled={updatingStatus}
                              onClick={() => {
                                setStatusTarget("sent");
                                setActionsOpen(false);
                              }}
                            >
                              Mark Sent
                            </ActionMenuButton>
                            <ActionMenuButton
                              disabled={updatingStatus}
                              onClick={() => {
                                setStatusTarget("accepted");
                                setActionsOpen(false);
                              }}
                            >
                              Accept
                            </ActionMenuButton>
                            <ActionMenuButton
                              danger
                              disabled={updatingStatus}
                              onClick={() => {
                                setStatusTarget("rejected");
                                setActionsOpen(false);
                              }}
                            >
                              Reject
                            </ActionMenuButton>
                          </>
                        ) : null}
                        {existingProject && canViewProjects ? (
                          <Link
                            className="block w-full px-4 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-stone-50"
                            onClick={() => setActionsOpen(false)}
                            role="menuitem"
                            to={`/projects/${existingProject.id}`}
                          >
                            Open Project
                          </Link>
                        ) : null}
                        {!existingProject && canCreateProject ? (
                          <ActionMenuButton
                            disabled={creatingProject}
                            onClick={() => {
                              setActionsOpen(false);
                              void handleCreateProject();
                            }}
                          >
                            {creatingProject ? "Creating..." : "Create Project"}
                          </ActionMenuButton>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              <p className="max-w-3xl text-sm leading-6 text-slate-600 sm:text-base">
                {`${quotation.quotation_code ?? "Quotation"} / ${contact.customerName} / ${contact.phone}`}
              </p>
              <QuotationStatusPill quotation={quotation} />
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
                <DetailItem
                  label="Structure Type"
                  value={structureType}
                />
                <DetailItem
                  label="DCDB Included"
                  value={formatYesNo(dcdbIncluded)}
                />
                <DetailItem
                  label="ACDB Included"
                  value={formatYesNo(acdbIncluded)}
                />
                <DetailItem
                  label="Number Of Earthing"
                  value={
                    earthingCount === null ||
                    earthingCount === undefined
                      ? "-"
                      : String(earthingCount)
                  }
                />
                <DetailItem
                  label="Lightning Arrestor Included"
                  value={formatYesNo(lightningArrestorIncluded)}
                />
                <DetailItem
                  label="Remote Monitoring Included"
                  value={formatYesNo(remoteMonitoringIncluded)}
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
                  label="Discount Amount"
                  value={formatMoney(quotation.discount_amount)}
                />
                <DetailItem
                  label="Subsidy Amount"
                  value={formatMoney(quotation.subsidy_amount)}
                />
                <DetailItem label="Amount In Words" value={amountInWords} />
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
                                    totalTurnkeyCost,
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

          {canDelete ? (
            <section className="rounded-xl border border-rose-200 bg-rose-50 p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-rose-950">
                    Danger Zone
                  </h2>
                  <p className="mt-1 text-sm text-rose-800">
                    Delete this quotation and its itemized cost lines.
                  </p>
                </div>
                <Button onClick={() => setConfirmingDelete(true)} variant="danger">
                  Delete Quotation
                </Button>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {confirmingDelete ? (
        <ConfirmDialog
          title="Delete quotation?"
          description="This quotation and its itemized cost lines will be removed."
          confirming={deleting}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={handleDelete}
        />
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
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
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

function ActionMenuButton({
  children,
  danger = false,
  disabled = false,
  onClick,
}: {
  children: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`block w-full px-4 py-2 text-left text-sm font-semibold transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60 ${
        danger ? "text-rose-700" : "text-slate-700"
      }`}
      disabled={disabled}
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      {children}
    </button>
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

function VerticalDotsIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="currentColor"
      viewBox="0 0 24 24"
    >
      <circle cx="12" cy="5" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="12" cy="19" r="1.8" />
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

function quotationPdfFileName(quotation: QuotationWithRelations) {
  const code = (quotation.quotation_code ?? "quotation")
    .trim()
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "");

  return `${code || "quotation"}.pdf`;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
    <aside className="xl:sticky xl:top-6 xl:self-start">
      <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Totals</h2>
        <dl className="mt-4 space-y-3 text-sm">
          <TotalRow
            label="Base Amount"
            value={gstBreakdown?.taxableAmount ?? quotation.base_amount}
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

function booleanFromFormValue(value: unknown) {
  if (value === true || value === false) {
    return value;
  }

  if (value === "yes") {
    return true;
  }

  if (value === "no") {
    return false;
  }

  return null;
}

function formatPaymentTermAmount(
  amount: number | string | null | undefined,
  percentage: number | string | null | undefined,
  totalAmount: number | string | null | undefined,
) {
  const savedAmount = numberFromFormValue(amount);
  if (savedAmount !== null) {
    return formatMoney(savedAmount);
  }

  const percent = numberFromFormValue(percentage);
  const total = numberFromFormValue(totalAmount);

  if (percent === null || total === null || total <= 0) {
    return "-";
  }

  return formatMoney(total * percent / 100);
}

function oneMonthFromDateValue(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  const originalDay = Number(day);
  const nextDate = new Date(Number(year), Number(month) - 1, 1);
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

function customerLink(quotation: QuotationWithRelations) {
  if (!quotation.customer_id) {
    if (quotation.lead_id) {
      return (
        <Link
          className="font-semibold text-brand-700"
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
      className="font-semibold text-brand-700"
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
    <Link className="font-semibold text-brand-700" to={`/leads/${quotation.lead_id}`}>
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
      className="font-semibold text-brand-700"
      to={`/site-surveys/${quotation.site_survey_id}`}
    >
      {quotation.site_survey?.survey_code ?? "Open survey"}
    </Link>
  );
}
