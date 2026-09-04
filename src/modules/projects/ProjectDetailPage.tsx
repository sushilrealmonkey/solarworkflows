import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { RecordTitle } from "../../components/RecordTitle";
import { TablePagination, useTablePagination } from "../../components/TablePagination";
import { useToast } from "../../components/ui/ToastProvider";
import {
  AccessDenied,
  AlertDialog,
  Button,
  ConfirmDialog,
  DetailItem,
  DetailSection,
  EmptyState,
  LoadingSkeleton,
  Modal,
  PlaceholderAction,
  SelectInput,
  TextArea,
  TextInput,
} from "../crm/CrmComponents";
import {
  formatDate,
  formatDateTime,
  hasPermission,
  labelize,
  requiredError,
} from "../crm/crmUtils";
import { fetchStaffOptions } from "../crm/crmApi";
import type { StaffOption } from "../crm/types";
import { fetchVendors } from "../vendors/vendorApi";
import type { Vendor } from "../vendors/types";
import {
  fetchProject,
  fetchProjectCustomers,
  fetchProjectPaymentMilestones,
  fetchProjectQuotations,
  fetchProjectSiteSurveys,
  replaceProjectPaymentMilestones,
  updateProject,
  updateProjectStatus,
} from "./projectApi";
import {
  filterInstallationVendors,
  formatKw,
  getProjectContact,
  projectToForm,
} from "./projectUtils";
import {
  PriorityBadge,
  ProjectFormModal,
  ProjectStatusSelect,
} from "./ProjectsPage";
import type {
  ProjectFormValues,
  ProjectPaymentMilestone,
  ProjectPaymentMilestoneFormValues,
  ProjectStatus,
  ProjectWithRelations,
} from "./types";
import type {
  SiteSurveyWithRelations,
  SurveyCustomerSummary,
} from "../site-surveys/types";
import type {
  QuotationInventoryReservation,
  QuotationWithRelations,
} from "../quotations/types";
import { fetchQuotation } from "../quotations/quotationApi";
import {
  createPayment,
  fetchPaymentDueItems,
  fetchProjectPaymentSummary,
} from "../payments/paymentApi";
import {
  PaymentFormModal,
  PaymentSummaryCards,
} from "../payments/PaymentComponents";
import {
  emptyPaymentForm,
  fallbackSummaryForProject,
  validatePaymentForm,
} from "../payments/paymentUtils";
import type {
  PaymentFormValues,
  PaymentDueItem,
  PaymentProjectOption,
  PaymentProjectSummary,
} from "../payments/types";
import { fetchDocuments, uploadDocument } from "../documents/documentApi";
import {
  DocumentsCollection,
  DocumentUploadModal,
} from "../documents/DocumentComponents";
import {
  emptyDocumentUploadForm,
  uploadPayload,
  validateDocumentUpload,
} from "../documents/documentUtils";
import type {
  DocumentUploadValues,
  OrganizationDocumentWithRelations,
} from "../documents/types";
import { RecordLifecyclePanel } from "../lifecycle/RecordLifecyclePanel";
import {
  fetchInventoryItems,
  fetchProjectInventoryReservations,
  fetchProjectInventoryTransactions,
  issueInventoryToProject,
} from "../inventory/inventoryApi";
import {
  formatStock,
  stockNumber,
} from "../inventory/inventoryUtils";
import {
  InventoryStockBadge,
  TransactionTypeBadge,
} from "../inventory/InventoryPage";
import type {
  InventoryItem,
  InventoryTransactionWithRelations,
} from "../inventory/types";
import { fetchProjectInvoices } from "../invoices/invoiceApi";
import { InvoiceStatusBadge } from "../invoices/InvoiceComponents";
import { fetchInvoicePdfPreviewUrl } from "../invoices/invoicePdfWorkflow";
import { isActiveInvoice } from "../invoices/invoiceUtils";
import type { InvoiceWithRelations } from "../invoices/types";
import { formatMoney } from "../quotations/quotationUtils";
import { ProjectFieldAssignments } from "./ProjectFieldAssignments";

type MaterialIssueFormValues = {
  item_id: string;
  quantity: string;
  notes: string;
};

export function ProjectDetailPage() {
  const { id } = useParams();
  const { profile, permissions } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectWithRelations | null>(null);
  const [linkedQuotation, setLinkedQuotation] =
    useState<QuotationWithRelations | null>(null);
  const [customers, setCustomers] = useState<SurveyCustomerSummary[]>([]);
  const [quotations, setQuotations] = useState<QuotationWithRelations[]>([]);
  const [siteSurveys, setSiteSurveys] = useState<SiteSurveyWithRelations[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [installationVendors, setInstallationVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ProjectFormValues | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [statusTarget, setStatusTarget] = useState<ProjectStatus | null>(null);
  const [stockOutAlert, setStockOutAlert] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [paymentSummary, setPaymentSummary] =
    useState<PaymentProjectSummary | null>(null);
  const [paymentDueItem, setPaymentDueItem] = useState<PaymentDueItem | null>(null);
  const [paymentForm, setPaymentForm] = useState<PaymentFormValues | null>(null);
  const [paymentFormErrors, setPaymentFormErrors] = useState<Record<string, string>>(
    {},
  );
  const [savingPayment, setSavingPayment] = useState(false);
  const [paymentMilestones, setPaymentMilestones] = useState<
    ProjectPaymentMilestone[]
  >([]);
  const [paymentScheduleForm, setPaymentScheduleForm] = useState<
    ProjectPaymentMilestoneFormValues[] | null
  >(null);
  const [paymentScheduleErrors, setPaymentScheduleErrors] = useState<
    Record<string, string>
  >({});
  const [savingPaymentSchedule, setSavingPaymentSchedule] = useState(false);
  const [documents, setDocuments] = useState<OrganizationDocumentWithRelations[]>(
    [],
  );
  const [invoices, setInvoices] = useState<InvoiceWithRelations[]>([]);
  const [invoicePdfUrls, setInvoicePdfUrls] = useState<Record<string, string>>({});
  const [documentForm, setDocumentForm] = useState<DocumentUploadValues | null>(
    null,
  );
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentErrors, setDocumentErrors] = useState<Record<string, string>>({});
  const [savingDocument, setSavingDocument] = useState(false);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [projectMaterials, setProjectMaterials] = useState<
    InventoryTransactionWithRelations[]
  >([]);
  const [projectReservations, setProjectReservations] = useState<
    QuotationInventoryReservation[]
  >([]);
  const [materialIssueForm, setMaterialIssueForm] =
    useState<MaterialIssueFormValues | null>(null);
  const [materialIssueErrors, setMaterialIssueErrors] = useState<
    Record<string, string>
  >({});
  const [issuingMaterial, setIssuingMaterial] = useState(false);

  const canView = hasPermission(profile, permissions, "projects", "view");
  const canUpdate = hasPermission(profile, permissions, "projects", "update");
  const canAssign = hasPermission(profile, permissions, "projects", "assign");
  const canDelete = hasPermission(profile, permissions, "projects", "delete");
  const canViewPayments = hasPermission(profile, permissions, "payments", "view");
  const canViewInvoices = hasPermission(profile, permissions, "invoices", "view");
  const canCreatePayment = hasPermission(
    profile,
    permissions,
    "payments",
    "create",
  );
  const canCreateInvoice = hasPermission(
    profile,
    permissions,
    "invoices",
    "create",
  );
  const canViewDocuments = hasPermission(profile, permissions, "documents", "view");
  const canCreateDocument = hasPermission(
    profile,
    permissions,
    "documents",
    "create",
  );
  const canDeleteDocument = hasPermission(
    profile,
    permissions,
    "documents",
    "delete",
  );
  const canUpdateDocument = hasPermission(
    profile,
    permissions,
    "documents",
    "update",
  );
  const canViewInventory = hasPermission(
    profile,
    permissions,
    "inventory",
    "view",
  );
  const canCreateInventory = hasPermission(
    profile,
    permissions,
    "inventory",
    "create",
  );

  async function loadProject() {
    if (!canView || !id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [
        nextProject,
        nextPaymentMilestones,
        nextCustomers,
        nextQuotations,
        nextSiteSurveys,
        nextStaff,
        nextInstallationVendors,
        nextInventoryItems,
        nextProjectMaterials,
        nextProjectReservations,
        nextInvoices,
      ] = await Promise.all([
        fetchProject(profile, id),
        fetchProjectPaymentMilestones(profile, id),
        fetchProjectCustomers(profile),
        fetchProjectQuotations(profile),
        fetchProjectSiteSurveys(profile),
        fetchStaffOptions(profile),
        fetchVendors(profile).then(filterInstallationVendors).catch(() => []),
        canViewInventory ? fetchInventoryItems(profile) : Promise.resolve([]),
        canViewInventory
          ? fetchProjectInventoryTransactions(profile, id)
          : Promise.resolve([]),
        canViewInventory
          ? fetchProjectInventoryReservations(profile, id)
          : Promise.resolve([]),
        canViewInvoices ? fetchProjectInvoices(profile, id) : Promise.resolve([]),
      ]);
      setProject(nextProject);
      setPaymentMilestones(nextPaymentMilestones);
      const nextLinkedQuotation = nextProject?.quotation_id
        ? await fetchQuotation(profile, nextProject.quotation_id).catch(() => null)
        : null;
      setLinkedQuotation(nextLinkedQuotation);
      setCustomers(nextCustomers);
      setQuotations(nextQuotations);
      setSiteSurveys(nextSiteSurveys);
      setStaff(nextStaff);
      setInstallationVendors(nextInstallationVendors);
      setInventoryItems(nextInventoryItems);
      setProjectMaterials(nextProjectMaterials);
      setProjectReservations(nextProjectReservations);
      setInvoices(nextInvoices);
      if (canCreateDocument && nextInvoices.length > 0) {
        const pdfEntries = await Promise.all(
          nextInvoices.map(async (invoice) => {
            try {
              return [invoice.id, await fetchInvoicePdfPreviewUrl(invoice)] as const;
            } catch {
              return [invoice.id, null] as const;
            }
          }),
        );
        setInvoicePdfUrls(
          Object.fromEntries(
            pdfEntries.filter(
              (entry): entry is readonly [string, string] => Boolean(entry[1]),
            ),
          ),
        );
      } else {
        setInvoicePdfUrls({});
      }
      if (nextProject && canViewPayments) {
        const [nextSummary, nextDueItems] = await Promise.all([
          fetchProjectPaymentSummary(profile, nextProject.id),
          fetchPaymentDueItems(profile, {
            sourceType: "project",
            sourceId: nextProject.id,
            limit: 1,
          }),
        ]);
        const paymentProject = projectToPaymentOption(nextProject);
        setPaymentSummary(nextSummary ?? fallbackSummaryForProject(paymentProject));
        setPaymentDueItem(nextDueItems[0] ?? null);
      } else {
        setPaymentSummary(null);
        setPaymentDueItem(null);
      }
      if (nextProject && canViewDocuments) {
        const nextDocuments = await fetchDocuments(profile, {
          projectId: nextProject.id,
        });
        setDocuments(
          nextDocuments.filter((document) => document.document_type !== "invoice_pdf"),
        );
      } else {
        setDocuments([]);
      }
      if (!canViewInvoices) {
        setInvoices([]);
      }
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Unable to load project.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProject();
    // loadProject closes over current route and permission/profile state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, canViewPayments, id, profile?.id]);

  if (!canView) {
    return (
      <AccessDenied
        title="Project details are not available"
        description="Your role needs projects:view access to open project details."
      />
    );
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!project || !editing) {
      return;
    }

    const nextErrors = {
      customer_id: requiredError(editing.customer_id, "Customer"),
      project_name: requiredError(editing.project_name, "Project name"),
    };
    setFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSaving(true);
      await updateProject(project.id, editing);
      setEditing(null);
      showToast("Project updated.", "success");
      await loadProject();
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Project update failed.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  async function confirmStatusUpdate() {
    if (!project || !statusTarget) {
      return;
    }

    try {
      setUpdatingStatus(true);
      await updateProjectStatus(project.id, statusTarget);
      showToast("Project status updated.", "success");
      setStatusTarget(null);
      await loadProject();
    } catch (nextError) {
      const message =
        nextError instanceof Error
          ? nextError.message
          : "Project status update failed.";

      if (statusTarget === "material_dispatched") {
        setStockOutAlert(message);
      } else {
        showToast(message, "error");
      }
    } finally {
      setUpdatingStatus(false);
    }
  }

  function openEditForm() {
    if (!project) {
      return;
    }

    setFormErrors({});
    setEditing(projectToForm(project));
  }

  function openPaymentForm() {
    if (!project) {
      return;
    }

    setPaymentFormErrors({});
    setPaymentForm(emptyPaymentForm(projectToPaymentOption(project)));
  }

  function openPaymentScheduleForm() {
    setPaymentScheduleErrors({});
    setPaymentScheduleForm(
      paymentMilestones.length > 0
        ? paymentMilestones.map(({ milestone, percentage, amount, due_date }) => ({
            milestone,
            percentage: percentage === null ? "" : String(percentage),
            amount: amount === null ? "" : String(amount),
            due_date,
          }))
        : (linkedQuotation?.quotation_payment_terms ?? []).map(
            ({ milestone, percentage, amount }) => ({
              milestone,
              percentage: percentage === null ? "" : String(percentage),
              amount: amount === null ? "" : String(amount),
              due_date: "",
            }),
          ),
    );
  }

  async function handlePaymentScheduleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!project || !paymentScheduleForm) {
      return;
    }

    const nextErrors: Record<string, string> = {};
    const selectedMilestones = new Set<string>();

    paymentScheduleForm.forEach((milestone, index) => {
      const milestoneKey = `milestone-${index}`;
      const dueDateKey = `due_date-${index}`;
      const milestoneName = milestone.milestone.trim();

      if (!milestoneName) {
        nextErrors[milestoneKey] = "Payment milestone is required.";
      } else if (selectedMilestones.has(milestoneName.toLowerCase())) {
        nextErrors[milestoneKey] = "Each payment milestone can only appear once.";
      } else {
        selectedMilestones.add(milestoneName.toLowerCase());
      }

      if (!milestone.due_date) {
        nextErrors[dueDateKey] = "Due date is required.";
      }

      if (
        milestone.percentage &&
        (!Number.isFinite(Number(milestone.percentage)) ||
          Number(milestone.percentage) < 0 ||
          Number(milestone.percentage) > 100)
      ) {
        nextErrors[`percentage-${index}`] = "Enter a percentage from 0 to 100.";
      }

      if (
        milestone.amount &&
        (!Number.isFinite(Number(milestone.amount)) || Number(milestone.amount) < 0)
      ) {
        nextErrors[`amount-${index}`] = "Enter an amount of zero or more.";
      }
    });

    setPaymentScheduleErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    try {
      setSavingPaymentSchedule(true);
      await replaceProjectPaymentMilestones(project.id, paymentScheduleForm);
      setPaymentScheduleForm(null);
      showToast("Project payment schedule updated.", "success");
      await loadProject();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Payment schedule could not be updated.",
        "error",
      );
    } finally {
      setSavingPaymentSchedule(false);
    }
  }

  function openProjectInvoiceForm() {
    if (!project) {
      return;
    }

    const existingInvoice = invoices.find(isActiveInvoice);
    if (existingInvoice) {
      showToast(
        `Invoice already exists for this project: ${
          existingInvoice.invoice_code ?? "open invoice"
        }.`,
        "error",
      );
      return;
    }

    navigate(`/invoices?projectId=${project.id}`);
  }

  function openMaterialInvoiceForm(material: InventoryTransactionWithRelations) {
    if (!project) {
      return;
    }

    const existingInvoice = invoices.find(isActiveInvoice);
    if (existingInvoice) {
      showToast(
        `Invoice already exists for this project: ${
          existingInvoice.invoice_code ?? "open invoice"
        }.`,
        "error",
      );
      return;
    }

    const params = new URLSearchParams({ projectId: project.id });
    params.set("inventoryItemId", material.item_id);
    if (material.quantity) {
      params.set("quantity", String(material.quantity));
    }

    navigate(`/invoices?${params.toString()}`);
  }

  async function handlePaymentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!paymentForm) {
      return;
    }

    const nextErrors = validatePaymentForm(paymentForm);
    setPaymentFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSavingPayment(true);
      await createPayment(profile, paymentForm);
      setPaymentForm(null);
      showToast("Payment added.", "success");
      await loadProject();
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Payment save failed.",
        "error",
      );
    } finally {
      setSavingPayment(false);
    }
  }

  function openDocumentForm() {
    if (!project) {
      return;
    }

    setDocumentErrors({});
    setDocumentFile(null);
    setDocumentForm(
      emptyDocumentUploadForm({
        customer_id: project.customer_id,
        project_id: project.id,
      }),
    );
  }

  async function handleDocumentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!documentForm) {
      return;
    }

    const nextErrors = validateDocumentUpload(documentForm, documentFile);
    setDocumentErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean) || !documentFile) {
      return;
    }

    try {
      setSavingDocument(true);
      await uploadDocument(profile, uploadPayload(documentForm, documentFile));
      setDocumentForm(null);
      setDocumentFile(null);
      showToast("Document uploaded.", "success");
      await loadProject();
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Document upload failed.",
        "error",
      );
    } finally {
      setSavingDocument(false);
    }
  }

  function openMaterialIssueForm() {
    setMaterialIssueErrors({});
    setMaterialIssueForm({
      item_id: "",
      quantity: "",
      notes: "",
    });
  }

  async function handleMaterialIssueSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!project || !materialIssueForm) {
      return;
    }

    const nextErrors = validateMaterialIssueForm(
      materialIssueForm,
      inventoryItems,
    );
    setMaterialIssueErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setIssuingMaterial(true);
      await issueInventoryToProject(
        project.id,
        materialIssueForm.item_id,
        materialIssueForm.quantity,
        materialIssueForm.notes,
      );
      setMaterialIssueForm(null);
      showToast("Material issued to project.", "success");
      await loadProject();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Material issue failed.",
        "error",
      );
    } finally {
      setIssuingMaterial(false);
    }
  }

  const contact = project ? getProjectContact(project) : null;
  const paymentProject = project ? projectToPaymentOption(project) : null;
  const hasActiveProjectInvoice = invoices.some(isActiveInvoice);

  return (
    <div className="space-y-6">
      <Link className="text-sm font-semibold text-[#06173f]" to="/projects">
        Back to projects
      </Link>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load project" description={error} /> : null}
      {!loading && !error && !project ? (
        <EmptyState
          title="Project not found"
          description="This project may have been deleted or is outside your organization access."
        />
      ) : null}

      {project && contact ? (
        <>
          <div className="border-b border-stone-200 pb-5">
            <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 space-y-3">
                <RecordTitle
                  recordType="Project"
                  name={project.project_name ?? contact.customerName ?? "Project"}
                  action={
                    canUpdate && !project.archived_at ? (
                      <button
                        aria-label="Edit project"
                        className="inline-flex size-9 items-center justify-center rounded-lg border border-stone-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-stone-50 hover:text-slate-950"
                        onClick={openEditForm}
                        title="Edit project"
                        type="button"
                      >
                        <PencilIcon />
                      </button>
                    ) : null
                  }
                  meta={[
                    project.project_code ?? "Project",
                    project.quotation?.quotation_code ??
                      project.site_survey?.survey_code ??
                      project.lead?.lead_code,
                  ]}
                />
                <div className="flex flex-wrap items-center gap-2">
                  {canUpdate && !project.archived_at ? (
                    <ProjectStatusSelect
                      disabled={updatingStatus}
                      value={project.project_status ?? "created"}
                      onChange={setStatusTarget}
                    />
                  ) : null}
                </div>
                {canAssign && !project.archived_at ? (
                  <ProjectFieldAssignments projectId={project.id} />
                ) : null}
              </div>
              <div className="lg:max-w-md lg:shrink-0">
                <NextStepSection
                  canCreateInvoice={canCreateInvoice && !hasActiveProjectInvoice}
                  canCreateDocument={canCreateDocument}
                  canCreateInventory={canCreateInventory}
                  onCreateInvoice={openProjectInvoiceForm}
                  onUploadDocument={openDocumentForm}
                  onAddMaterialIssue={openMaterialIssueForm}
                />
              </div>
            </header>
          </div>

          <ProjectPaymentScheduleSection
            milestones={paymentMilestones}
            quotation={linkedQuotation ?? project.quotation ?? null}
            canEdit={canUpdate && !project.archived_at}
            onEdit={openPaymentScheduleForm}
          />

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.85fr)]">
            <div className="space-y-6">
              <DetailSection compact title="Customer & Installation Details">
                <DetailItem
                  label="Customer Name"
                  value={project.customer?.full_name ?? contact.customerName}
                />
                <DetailItem label="Phone" value={contact.phone} />
                <DetailItem
                  label="Email"
                  value={project.customer?.email ?? project.lead?.email ?? "-"}
                />
                <DetailItem label="Lead" value={leadLink(project)} />
                <DetailItem
                  label="Address"
                  value={project.installation_address ?? contact.address ?? "-"}
                />
                <DetailItem label="City" value={project.city ?? "-"} />
                <DetailItem label="District" value={project.district ?? "-"} />
                <DetailItem label="State" value={project.state ?? "-"} />
                <DetailItem label="Pincode" value={project.pincode ?? "-"} />
              </DetailSection>

              <DetailSection compact title="Project & Workflow Details">
                <DetailItem
                  label="Priority"
                  value={<PriorityBadge value={project.priority} />}
                />
                <DetailItem label="Start Date" value={formatDate(project.start_date)} />
                <DetailItem
                  label="Expected Completion"
                  value={formatDate(project.expected_completion_date)}
                />
                <DetailItem
                  label="Completed At"
                  value={formatDateTime(project.completed_at)}
                />
                <DetailItem label="Created" value={formatDate(project.created_at)} />
                <DetailItem label="Notes" value={project.notes ?? "-"} />
                <DetailItem label="Quotation" value={quotationLink(project)} />
                <DetailItem label="Site Survey" value={surveyLink(project)} />
                <DetailItem
                  label="System Capacity"
                  value={formatKw(project.system_capacity_kw)}
                />
                <DetailItem label="Project Type" value={labelize(project.project_type)} />
              </DetailSection>
            </div>

            <aside className="space-y-6">
              {canViewPayments && paymentSummary ? (
                <section className="h-fit rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between xl:flex-col xl:items-stretch">
                    <h2 className="text-sm font-semibold text-slate-950">
                      Payment Details
                    </h2>
                    <div className="flex flex-wrap gap-2">
                      {canCreatePayment ? (
                        <Button onClick={openPaymentForm}>Add Payment</Button>
                      ) : null}
                      <Link
                        className="inline-flex min-h-10 items-center justify-center rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-stone-50"
                        to="/payments"
                      >
                        Open Payments
                      </Link>
                    </div>
                  </div>
                  <div className="mt-3">
                    <PaymentSummaryCards
                      compact
                      className="grid gap-2"
                      dueItem={paymentDueItem}
                      paymentDueOn={project.payment_due_on}
                      summary={paymentSummary}
                    />
                  </div>
                </section>
              ) : null}
            </aside>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.85fr)]">
            {canViewDocuments ? (
              <section className="h-fit rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-slate-950">
                      Documents
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      Project permits, site photos, agreements, subsidy files, and handover documents.
                    </p>
                  </div>
                  {canCreateDocument ? (
                    <Button onClick={openDocumentForm}>Upload Document</Button>
                  ) : null}
                </div>
                {documents.length > 0 ? (
                  <div className="mt-4">
                    <DocumentsCollection
                      compact
                      documents={documents}
                      canUpdate={canUpdateDocument}
                      canDelete={canDeleteDocument}
                      onLifecycleChanged={(document, action) => {
                        setDocuments((current) =>
                          current.filter((entry) => entry.id !== document.id),
                        );
                        showToast(
                          action === "delete" ? "Document permanently deleted." : "Document archived.",
                          "success",
                        );
                      }}
                    />
                  </div>
                ) : (
                  <div className="mt-4">
                    <EmptyState
                      title="No project documents uploaded"
                      description="Upload permits, site photos, agreements, subsidy files, and handover documents as they become available."
                    />
                  </div>
                )}
              </section>
            ) : null}

            {canViewInvoices ? (
              <ProjectInvoicesSection
                invoices={invoices}
                invoicePdfUrls={invoicePdfUrls}
                canCreate={canCreateInvoice && !hasActiveProjectInvoice}
                onCreate={openProjectInvoiceForm}
              />
            ) : null}
          </div>

          {canViewInventory ? (
            <ProjectMaterialsSection
              materials={projectMaterials}
              reservations={projectReservations}
              canCreate={canCreateInventory}
              canCreateInvoice={canCreateInvoice && !hasActiveProjectInvoice}
              onAdd={openMaterialIssueForm}
              onCreateInvoice={openMaterialInvoiceForm}
            />
          ) : null}

          <RecordLifecyclePanel
            archiveReason={project.archive_reason}
            archivedAt={project.archived_at}
            canDelete={canDelete}
            canUpdate={canUpdate}
            moduleKey="projects"
            onChanged={async (action) => {
              if (action === "delete") {
                showToast("Project permanently deleted.", "success");
                navigate("/projects");
                return;
              }
              showToast(action === "archive" ? "Project archived." : "Project restored.", "success");
              await loadProject();
            }}
            recordId={project.id}
            recordLabel={project.project_code || project.project_name || "Project"}
          />
        </>
      ) : null}

      {editing ? (
        <ProjectFormModal
          title="Edit Project"
          values={editing}
          setValues={setEditing}
          errors={formErrors}
          customers={customers}
          quotations={quotations}
          siteSurveys={siteSurveys}
          staff={staff}
          installationVendors={installationVendors}
          onClose={() => setEditing(null)}
          onSubmit={handleEditSubmit}
          saving={saving}
        />
      ) : null}

      {paymentForm && paymentProject ? (
        <PaymentFormModal
          title="Add Payment"
          values={paymentForm}
          setValues={setPaymentForm}
          errors={paymentFormErrors}
          projects={[paymentProject]}
          onClose={() => setPaymentForm(null)}
          onSubmit={handlePaymentSubmit}
          saving={savingPayment}
        />
      ) : null}

      {paymentScheduleForm ? (
        <ProjectPaymentScheduleModal
          values={paymentScheduleForm}
          setValues={setPaymentScheduleForm}
          errors={paymentScheduleErrors}
          onClose={() => setPaymentScheduleForm(null)}
          onSubmit={handlePaymentScheduleSubmit}
          saving={savingPaymentSchedule}
        />
      ) : null}

      {documentForm ? (
        <DocumentUploadModal
          title="Upload Document"
          values={documentForm}
          setValues={setDocumentForm}
          file={documentFile}
          setFile={setDocumentFile}
          errors={documentErrors}
          onClose={() => setDocumentForm(null)}
          onSubmit={handleDocumentSubmit}
          saving={savingDocument}
        />
      ) : null}

      {materialIssueForm ? (
        <MaterialIssueFormModal
          values={materialIssueForm}
          setValues={setMaterialIssueForm}
          errors={materialIssueErrors}
          items={inventoryItems}
          onClose={() => setMaterialIssueForm(null)}
          onSubmit={handleMaterialIssueSubmit}
          saving={issuingMaterial}
        />
      ) : null}

      {statusTarget && project ? (
        <ConfirmDialog
          title={
            statusTarget === "cancelled"
              ? "Cancel project?"
              : "Update project status?"
          }
          description={`Set ${project.project_code ?? "this project"} to ${labelize(statusTarget)}.`}
          confirming={updatingStatus}
          confirmLabel={
            statusTarget === "cancelled" ? "Cancel Project" : "Update Status"
          }
          confirmingLabel="Updating..."
          confirmVariant={statusTarget === "cancelled" ? "danger" : "primary"}
          onCancel={() => setStatusTarget(null)}
          onConfirm={confirmStatusUpdate}
        />
      ) : null}

      {stockOutAlert ? (
        <AlertDialog
          title="BOM stock out entry is not placed"
          description={stockOutAlert}
          onClose={() => setStockOutAlert(null)}
        />
      ) : null}
    </div>
  );
}

function PencilIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="M16.8 4.8 19.2 7.2M5 19l4.8-1 9.4-9.4a1.7 1.7 0 0 0 0-2.4l-1.4-1.4a1.7 1.7 0 0 0-2.4 0L6 14.2 5 19Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function NextStepSection({
  canCreateInvoice,
  canCreateDocument,
  canCreateInventory,
  onCreateInvoice,
  onUploadDocument,
  onAddMaterialIssue,
}: {
  canCreateInvoice: boolean;
  canCreateDocument: boolean;
  canCreateInventory: boolean;
  onCreateInvoice: () => void;
  onUploadDocument: () => void;
  onAddMaterialIssue: () => void;
}) {
  if (!canCreateInvoice && !canCreateDocument && !canCreateInventory) {
    return null;
  }

  return (
    <section className="h-fit rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-950">Next Step</h2>
      <div className="mt-4 grid gap-2">
        {canCreateInvoice ? (
          <button
            className="inline-flex min-h-10 w-full items-center justify-center rounded-lg border border-orange-600 bg-orange-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-700"
            onClick={onCreateInvoice}
            type="button"
          >
            Create Project Invoice
          </button>
        ) : null}
        {canCreateDocument ? (
          <button
            className="inline-flex min-h-10 w-full items-center justify-center rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-stone-50"
            onClick={onUploadDocument}
            type="button"
          >
            Upload Documents
          </button>
        ) : null}
        {canCreateInventory ? (
          <button
            className="inline-flex min-h-10 w-full items-center justify-center rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-stone-50"
            onClick={onAddMaterialIssue}
            type="button"
          >
            Additional Material Issue
          </button>
        ) : null}
      </div>
    </section>
  );
}

function ProjectInvoicesSection({
  invoices,
  invoicePdfUrls,
  canCreate,
  onCreate,
}: {
  invoices: InvoiceWithRelations[];
  invoicePdfUrls: Record<string, string>;
  canCreate: boolean;
  onCreate: () => void;
}) {
  const invoicePagination = useTablePagination(invoices);
  const paginatedInvoices = invoicePagination.pageItems;

  return (
    <section className="h-fit rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Tax Invoices</h2>
          <p className="mt-1 text-sm text-slate-600">
            Project billing records linked to this installation.
          </p>
        </div>
        {canCreate ? <Button onClick={onCreate}>Create Invoice</Button> : null}
      </div>

      {invoices.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No invoices linked"
            description="Project invoices will appear here after they are created."
            action={canCreate ? <Button onClick={onCreate}>Create Invoice</Button> : null}
          />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {paginatedInvoices.map((invoice) => (
            <article
              key={invoice.id}
              className="rounded-lg border border-stone-200 bg-stone-50/60 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {formatDate(invoice.invoice_date)}
                  </p>
                  <h3 className="mt-1 truncate text-sm font-semibold text-slate-950">
                    {invoice.invoice_code ?? "Invoice"}
                  </h3>
                </div>
                <InvoiceStatusBadge value={invoice.status} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <ProjectInvoiceCardItem label="Total" value={formatMoney(invoice.total_amount)} />
                <ProjectInvoiceCardItem label="Balance" value={formatMoney(invoice.balance_due)} />
                <ProjectInvoiceCardItem label="Paid" value={formatMoney(invoice.amount_paid)} />
                <ProjectInvoiceCardItem label="Due" value={formatDate(invoice.due_date)} />
              </dl>
              <div className="mt-4">
                <DownloadInvoiceAction url={invoicePdfUrls[invoice.id]} />
              </div>
            </article>
          ))}
          <TablePagination label="project invoices" pagination={invoicePagination} />
        </div>
      )}
    </section>
  );
}

function ProjectInvoiceCardItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function DownloadInvoiceAction({ url }: { url: string | undefined }) {
  if (!url) {
    return <PlaceholderAction>Download Invoice</PlaceholderAction>;
  }

  return (
    <a
      className="inline-flex min-h-10 items-center justify-center rounded-lg border border-orange-600 bg-orange-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-700"
      download
      href={url}
      rel="noreferrer"
      target="_blank"
    >
      Download Invoice
    </a>
  );
}

function canInvoiceMaterial(material: InventoryTransactionWithRelations) {
  return material.transaction_type === "project_issue";
}

function ProjectReservationSummary({
  reservations,
}: {
  reservations: QuotationInventoryReservation[];
}) {
  const summary = reservations.reduce(
    (totals, reservation) => {
      if (reservation.status === "active" || reservation.status === "partial") {
        totals.reserved += Number(reservation.reserved_qty ?? 0);
      }

      if (reservation.status === "partial" || reservation.status === "shortage") {
        totals.shortage += Number(reservation.shortage_qty ?? 0);
      }

      totals.required += Number(reservation.required_qty ?? 0);
      return totals;
    },
    { required: 0, reserved: 0, shortage: 0 },
  );

  return (
    <div className="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <ReservationMetric label="Required" value={formatStock(summary.required)} />
        <ReservationMetric label="Reserved" value={formatStock(summary.reserved)} />
        <ReservationMetric label="Shortage" value={formatStock(summary.shortage)} />
      </div>
      <div className="mt-3 grid gap-2">
        {reservations.map((reservation) => (
          <div
            key={reservation.id}
            className="grid gap-2 rounded-lg border border-stone-200 bg-white p-3 text-sm md:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,0.7fr))] md:items-center"
          >
            <div>
              <p className="font-semibold text-slate-950">
                {projectReservationItemLabel(reservation)}
              </p>
              {reservation.notes ? (
                <p className="mt-1 text-xs text-slate-500">{reservation.notes}</p>
              ) : null}
            </div>
            <ReservationLineQty label="Required" reservation={reservation} field="required_qty" />
            <ReservationLineQty label="Reserved" reservation={reservation} field="reserved_qty" />
            <ReservationLineQty label="Shortage" reservation={reservation} field="shortage_qty" />
            <ProjectReservationStatusChip value={reservation.status} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ReservationMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-3 py-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function ReservationLineQty({
  label,
  reservation,
  field,
}: {
  label: string;
  reservation: QuotationInventoryReservation;
  field: "required_qty" | "reserved_qty" | "shortage_qty";
}) {
  const unit = reservation.inventory_item?.unit || reservation.catalog_product?.unit;

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 font-semibold text-slate-950">
        {formatStock(reservation[field], unit)}
      </p>
    </div>
  );
}

function ProjectReservationStatusChip({
  value,
}: {
  value: QuotationInventoryReservation["status"];
}) {
  const classes =
    value === "active"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : value === "partial"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : value === "shortage"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-slate-200 bg-slate-50 text-slate-600";

  return (
    <span
      className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-xs font-semibold ${classes}`}
    >
      {labelize(value)}
    </span>
  );
}

function projectReservationItemLabel(reservation: QuotationInventoryReservation) {
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
    .join(" / ") || "Reservation item";
}

function ProjectMaterialsSection({
  materials,
  reservations,
  canCreate,
  canCreateInvoice,
  onAdd,
  onCreateInvoice,
}: {
  materials: InventoryTransactionWithRelations[];
  reservations: QuotationInventoryReservation[];
  canCreate: boolean;
  canCreateInvoice: boolean;
  onAdd: () => void;
  onCreateInvoice: (material: InventoryTransactionWithRelations) => void;
}) {
  const issuedMaterials = materials.filter(
    (material) =>
      material.transaction_type === "project_issue" ||
      material.transaction_type === "stock_out",
  );
  const materialPagination = useTablePagination(issuedMaterials);
  const paginatedIssuedMaterials = materialPagination.pageItems;
  const canShowInvoiceActions = canCreateInvoice &&
    issuedMaterials.some((material) => canInvoiceMaterial(material));

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold text-slate-950">
          Inventory / Materials
        </h2>
        {canCreate ? <Button onClick={onAdd}>Add Material Issue</Button> : null}
      </div>
      {reservations.length > 0 ? (
        <ProjectReservationSummary reservations={reservations} />
      ) : null}
      {issuedMaterials.length === 0 ? (
        <EmptyState
          title="No materials issued"
          description="Issued panels, inverters, structures, and consumables will appear here after a material issue is added."
          action={canCreate ? <Button onClick={onAdd}>Add Material Issue</Button> : null}
        />
      ) : (
        <>
          <div className="mt-4 hidden overflow-hidden rounded-lg border border-stone-200 lg:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Item</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Quantity</th>
                  <th className="px-4 py-3">Notes</th>
                  <th className="px-4 py-3">Created By</th>
                  {canShowInvoiceActions ? (
                    <th className="px-4 py-3">Actions</th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {paginatedIssuedMaterials.map((material) => (
                  <tr key={material.id}>
                    <td className="px-4 py-3">
                      {formatDate(material.transaction_date)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        className="font-semibold text-[#06173f]"
                        to={`/inventory/${material.item_id}`}
                      >
                        {material.item?.item_name ?? "Inventory item"}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {material.item?.item_code ?? ""}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <TransactionTypeBadge value={material.transaction_type} />
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {formatStock(material.quantity, material.item?.unit)}
                    </td>
                    <td className="px-4 py-3">{material.notes ?? "-"}</td>
                    <td className="px-4 py-3">
                      {material.creator?.full_name ??
                        material.creator?.email ??
                        material.creator?.phone ??
                        "-"}
                    </td>
                    {canShowInvoiceActions ? (
                      <td className="px-4 py-3">
                        {canInvoiceMaterial(material) ? (
                          <Button
                            onClick={() => onCreateInvoice(material)}
                            variant="secondary"
                          >
                            Create Invoice
                          </Button>
                        ) : (
                          "-"
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 grid gap-3 lg:hidden">
            {paginatedIssuedMaterials.map((material) => (
              <article
                key={material.id}
                className="rounded-lg border border-stone-200 bg-white p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {formatDate(material.transaction_date)}
                    </p>
                    <Link
                      className="mt-1 block text-sm font-semibold text-[#06173f]"
                      to={`/inventory/${material.item_id}`}
                    >
                      {material.item?.item_name ?? "Inventory item"}
                    </Link>
                  </div>
                  <TransactionTypeBadge value={material.transaction_type} />
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-950">
                  {formatStock(material.quantity, material.item?.unit)}
                </p>
                {material.notes ? (
                  <p className="mt-2 text-sm text-slate-600">{material.notes}</p>
                ) : null}
                {canCreateInvoice && canInvoiceMaterial(material) ? (
                  <div className="mt-3">
                    <Button
                      onClick={() => onCreateInvoice(material)}
                      variant="secondary"
                    >
                      Create Invoice
                    </Button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
          <TablePagination
            label="issued materials"
            pagination={materialPagination}
          />
        </>
      )}
    </section>
  );
}

function MaterialIssueFormModal({
  values,
  setValues,
  errors,
  items,
  onClose,
  onSubmit,
  saving,
}: {
  values: MaterialIssueFormValues;
  setValues: (values: MaterialIssueFormValues) => void;
  errors: Record<string, string>;
  items: InventoryItem[];
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  const selectedItem = items.find((item) => item.id === values.item_id);

  return (
    <Modal
      title="Add Material Issue"
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel="Issue Material"
      submitting={saving}
    >
      <SelectInput
        label="Item"
        value={values.item_id}
        onChange={(item_id) => setValues({ ...values, item_id })}
        options={[
          { value: "", label: "Select item" },
          ...items
            .filter((item) => item.status === "active")
            .map((item) => ({
              value: item.id,
              label: `${item.item_code ?? "Item"} - ${item.item_name}`,
            })),
        ]}
      />
      {errors.item_id ? (
        <p className="-mt-3 text-xs text-rose-700">{errors.item_id}</p>
      ) : null}
      <TextInput
        label="Quantity"
        type="number"
        value={values.quantity}
        onChange={(quantity) => setValues({ ...values, quantity })}
        error={errors.quantity}
        required
      />
      {selectedItem ? (
        <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-slate-700 md:col-span-2">
          Available stock: <InventoryStockBadge item={selectedItem} />
        </div>
      ) : null}
      <TextArea
        label="Notes"
        value={values.notes}
        onChange={(notes) => setValues({ ...values, notes })}
      />
    </Modal>
  );
}

function validateMaterialIssueForm(
  values: MaterialIssueFormValues,
  items: InventoryItem[],
) {
  const selectedItem = items.find((item) => item.id === values.item_id);
  const quantity = Number(values.quantity);
  const quantityError =
    !values.quantity.trim() || !Number.isFinite(quantity) || quantity <= 0
      ? "Quantity must be greater than zero."
      : selectedItem && quantity > stockNumber(selectedItem.current_stock)
        ? "Stock cannot go below zero for a project issue."
        : "";

  return {
    item_id: requiredError(values.item_id, "Item"),
    quantity: quantityError,
  };
}

function ProjectPaymentScheduleSection({
  milestones,
  quotation,
  canEdit,
  onEdit,
}: {
  milestones: ProjectPaymentMilestone[];
  quotation: QuotationWithRelations | null;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const rows =
    milestones.length > 0
      ? milestones.map((milestone) => ({
          id: milestone.id,
          milestone: milestone.milestone,
          percentage: milestone.percentage,
          amount: milestone.amount,
          due_date: milestone.due_date,
        }))
      : (quotation?.quotation_payment_terms ?? []).map((term) => ({
          id: term.id,
          milestone: term.milestone,
          percentage: term.percentage,
          amount: term.amount,
          due_date: null,
        }));

  return (
    <section className="rounded-xl border border-sky-200 bg-sky-50/40 p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Payment Schedule</h2>
        </div>
        {canEdit ? (
          milestones.length === 0 ? (
            <Button onClick={onEdit}>Create Schedule</Button>
          ) : (
            <button
              aria-label="Edit payment schedule"
              className="inline-flex size-10 items-center justify-center rounded-lg border border-orange-600 bg-orange-600 text-white shadow-sm transition-colors hover:bg-orange-700"
              onClick={onEdit}
              title="Edit payment schedule"
              type="button"
            >
              <PencilIcon />
            </button>
          )
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-sky-200 bg-white/80 p-3 text-sm text-slate-600">
          Set payment dates to track payment and receive in-time.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-sky-100 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-sky-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-3">Milestone</th>
                <th className="px-4 py-3">Share</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Payment Due Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sky-50">
              {rows.map((milestone) => (
                <tr key={milestone.id}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {milestone.milestone}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {milestone.percentage === null
                      ? "—"
                      : `${milestone.percentage}%`}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {milestone.amount === null
                      ? "—"
                      : formatMoney(milestone.amount)}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {milestone.due_date
                      ? formatDate(milestone.due_date)
                      : "Not set"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ProjectPaymentScheduleModal({
  values,
  setValues,
  errors,
  onClose,
  onSubmit,
  saving,
}: {
  values: ProjectPaymentMilestoneFormValues[];
  setValues: (values: ProjectPaymentMilestoneFormValues[]) => void;
  errors: Record<string, string>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  function updateMilestone(
    index: number,
    key: keyof ProjectPaymentMilestoneFormValues,
    value: string,
  ) {
    setValues(
      values.map((milestone, milestoneIndex) =>
        milestoneIndex === index ? { ...milestone, [key]: value } : milestone,
      ),
    );
  }

  return (
    <Modal
      title="Edit Project Payment Schedule"
      maxWidthClass="sm:max-w-4xl"
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel="Save payment schedule"
      submitting={saving}
    >
      <div className="rounded-lg border border-sky-100 bg-sky-50 p-3 text-sm leading-6 text-slate-700 md:col-span-2">
        Payment terms are pulled from the linked quotation. Set a project due date for each payment milestone to track it in Payment Dues.
      </div>
      <div className="space-y-3 md:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-900">Payment terms</p>
          <Button
            variant="secondary"
            onClick={() =>
              setValues([
                ...values,
                { milestone: "", percentage: "", amount: "", due_date: "" },
              ])
            }
          >
            Add milestone
          </Button>
        </div>
        {values.length === 0 ? (
          <p className="rounded-lg border border-dashed border-stone-200 p-3 text-sm text-slate-600">
            Add a payment milestone to create the project payment schedule.
          </p>
        ) : null}
        {values.map((milestone, index) => (
          <div
            className="grid gap-3 rounded-lg border border-stone-200 p-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.5fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_auto] md:items-end"
            key={`${milestone.milestone}-${index}`}
          >
            <TextInput
              label="Milestone"
              value={milestone.milestone}
              onChange={(value) => updateMilestone(index, "milestone", value)}
              error={errors[`milestone-${index}`]}
              required
            />
            <TextInput
              label="Share (%)"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={milestone.percentage}
              onChange={(value) => updateMilestone(index, "percentage", value)}
              error={errors[`percentage-${index}`]}
            />
            <TextInput
              label="Amount"
              type="number"
              min="0"
              step="0.01"
              value={milestone.amount}
              onChange={(value) => updateMilestone(index, "amount", value)}
              error={errors[`amount-${index}`]}
            />
            <TextInput
              label="Payment Due Date"
              type="date"
              value={milestone.due_date}
              onChange={(value) => updateMilestone(index, "due_date", value)}
              error={errors[`due_date-${index}`]}
              required
            />
            <Button
              variant="ghost"
              onClick={() =>
                setValues(
                  values.filter((_, milestoneIndex) => milestoneIndex !== index),
                )
              }
            >
              Remove
            </Button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function projectToPaymentOption(project: ProjectWithRelations): PaymentProjectOption {
  return {
    id: project.id,
    organization_id: project.organization_id,
    project_code: project.project_code,
    project_name: project.project_name,
    customer_id: project.customer_id,
    quotation_id: project.quotation_id,
    customer: project.customer ?? null,
    quotation: project.quotation
      ? {
          id: project.quotation.id,
          quotation_code: project.quotation.quotation_code,
          total_amount: project.quotation.total_amount,
          subsidy_amount: project.quotation.subsidy_amount,
          net_payable_amount: project.quotation.net_payable_amount,
        }
      : null,
  };
}

function leadLink(project: ProjectWithRelations) {
  if (!project.lead_id) {
    return "-";
  }

  return (
    <Link className="font-semibold text-[#06173f]" to={`/leads/${project.lead_id}`}>
      {project.lead?.lead_code ?? project.lead?.full_name ?? "Open lead"}
    </Link>
  );
}

function quotationLink(project: ProjectWithRelations) {
  if (!project.quotation_id) {
    return "-";
  }

  return (
    <Link
      className="font-semibold text-[#06173f]"
      to={`/quotations/${project.quotation_id}`}
    >
      {project.quotation?.quotation_code ?? "Open quotation"}
    </Link>
  );
}

function surveyLink(project: ProjectWithRelations) {
  if (!project.site_survey_id) {
    return "-";
  }

  return (
    <Link
      className="font-semibold text-[#06173f]"
      to={`/site-surveys/${project.site_survey_id}`}
    >
      {project.site_survey?.survey_code ?? "Open survey"}
    </Link>
  );
}
