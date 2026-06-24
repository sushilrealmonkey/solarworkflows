import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
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
  staffName,
} from "../crm/crmUtils";
import { fetchStaffOptions } from "../crm/crmApi";
import type { StaffOption } from "../crm/types";
import { fetchVendors } from "../vendors/vendorApi";
import type { Vendor } from "../vendors/types";
import {
  deleteProject,
  fetchProject,
  fetchProjectCustomers,
  fetchProjectQuotations,
  fetchProjectSiteSurveys,
  updateProject,
  updateProjectStatus,
} from "./projectApi";
import {
  filterInstallationVendors,
  formatKw,
  formatTeamDisplay,
  getProjectContact,
  projectToForm,
} from "./projectUtils";
import {
  PriorityBadge,
  ProjectFormModal,
  ProjectStatusBadge,
  ProjectStatusSelect,
} from "./ProjectsPage";
import type {
  ProjectFormValues,
  ProjectStatus,
  ProjectWithRelations,
} from "./types";
import type {
  SiteSurveyWithRelations,
  SurveyCustomerSummary,
} from "../site-surveys/types";
import type { QuotationWithRelations } from "../quotations/types";
import {
  createPayment,
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
  PaymentProjectOption,
  PaymentProjectSummary,
} from "../payments/types";
import {
  deleteDocument,
  fetchDocuments,
  rejectDocument,
  uploadDocument,
  verifyDocument,
} from "../documents/documentApi";
import {
  DocumentsCollection,
  DocumentUploadModal,
  RejectDocumentDialog,
} from "../documents/DocumentComponents";
import {
  documentRelatedLabel,
  emptyDocumentUploadForm,
  uploadPayload,
  validateDocumentUpload,
} from "../documents/documentUtils";
import type {
  DocumentUploadValues,
  OrganizationDocumentWithRelations,
} from "../documents/types";
import {
  fetchInventoryItems,
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [statusTarget, setStatusTarget] = useState<ProjectStatus | null>(null);
  const [stockOutAlert, setStockOutAlert] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [paymentSummary, setPaymentSummary] =
    useState<PaymentProjectSummary | null>(null);
  const [paymentForm, setPaymentForm] = useState<PaymentFormValues | null>(null);
  const [paymentFormErrors, setPaymentFormErrors] = useState<Record<string, string>>(
    {},
  );
  const [savingPayment, setSavingPayment] = useState(false);
  const [documents, setDocuments] = useState<OrganizationDocumentWithRelations[]>(
    [],
  );
  const [documentForm, setDocumentForm] = useState<DocumentUploadValues | null>(
    null,
  );
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentErrors, setDocumentErrors] = useState<Record<string, string>>({});
  const [savingDocument, setSavingDocument] = useState(false);
  const [documentDeleteTarget, setDocumentDeleteTarget] =
    useState<OrganizationDocumentWithRelations | null>(null);
  const [deletingDocument, setDeletingDocument] = useState(false);
  const [documentRejectTarget, setDocumentRejectTarget] =
    useState<OrganizationDocumentWithRelations | null>(null);
  const [documentRejectNote, setDocumentRejectNote] = useState("");
  const [rejectingDocument, setRejectingDocument] = useState(false);
  const [verifyingDocumentId, setVerifyingDocumentId] = useState<string | null>(
    null,
  );
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [projectMaterials, setProjectMaterials] = useState<
    InventoryTransactionWithRelations[]
  >([]);
  const [materialIssueForm, setMaterialIssueForm] =
    useState<MaterialIssueFormValues | null>(null);
  const [materialIssueErrors, setMaterialIssueErrors] = useState<
    Record<string, string>
  >({});
  const [issuingMaterial, setIssuingMaterial] = useState(false);

  const canView = hasPermission(profile, permissions, "projects", "view");
  const canUpdate = hasPermission(profile, permissions, "projects", "update");
  const canDelete = hasPermission(profile, permissions, "projects", "delete");
  const canViewPayments = hasPermission(profile, permissions, "payments", "view");
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
  const canUpdateDocument = hasPermission(
    profile,
    permissions,
    "documents",
    "update",
  );
  const canDeleteDocument = hasPermission(
    profile,
    permissions,
    "documents",
    "delete",
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
        nextCustomers,
        nextQuotations,
        nextSiteSurveys,
        nextStaff,
        nextInstallationVendors,
        nextInventoryItems,
        nextProjectMaterials,
      ] = await Promise.all([
        fetchProject(profile, id),
        fetchProjectCustomers(profile),
        fetchProjectQuotations(profile),
        fetchProjectSiteSurveys(profile),
        fetchStaffOptions(profile),
        fetchVendors(profile).then(filterInstallationVendors).catch(() => []),
        canViewInventory ? fetchInventoryItems(profile) : Promise.resolve([]),
        canViewInventory
          ? fetchProjectInventoryTransactions(profile, id)
          : Promise.resolve([]),
      ]);
      setProject(nextProject);
      setCustomers(nextCustomers);
      setQuotations(nextQuotations);
      setSiteSurveys(nextSiteSurveys);
      setStaff(nextStaff);
      setInstallationVendors(nextInstallationVendors);
      setInventoryItems(nextInventoryItems);
      setProjectMaterials(nextProjectMaterials);
      if (nextProject && canViewPayments) {
        const nextSummary = await fetchProjectPaymentSummary(profile, nextProject.id);
        const paymentProject = projectToPaymentOption(nextProject);
        setPaymentSummary(nextSummary ?? fallbackSummaryForProject(paymentProject));
      } else {
        setPaymentSummary(null);
      }
      if (nextProject && canViewDocuments) {
        const nextDocuments = await fetchDocuments(profile, {
          projectId: nextProject.id,
        });
        setDocuments(nextDocuments);
      } else {
        setDocuments([]);
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
  }, [canView, id, profile?.id]);

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

  async function handleDelete() {
    if (!project) {
      return;
    }

    try {
      setDeleting(true);
      await deleteProject(project.id);
      showToast("Project deleted.", "success");
      navigate("/projects");
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Project delete failed.",
        "error",
      );
    } finally {
      setDeleting(false);
    }
  }

  function openPaymentForm() {
    if (!project) {
      return;
    }

    setPaymentFormErrors({});
    setPaymentForm(emptyPaymentForm(projectToPaymentOption(project)));
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

  async function handleDocumentVerify(document: OrganizationDocumentWithRelations) {
    try {
      setVerifyingDocumentId(document.id);
      await verifyDocument(document.id);
      showToast("Document verified.", "success");
      await loadProject();
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "Document verification failed.",
        "error",
      );
    } finally {
      setVerifyingDocumentId(null);
    }
  }

  async function confirmDocumentReject() {
    if (!documentRejectTarget) {
      return;
    }

    try {
      setRejectingDocument(true);
      await rejectDocument(documentRejectTarget.id, documentRejectNote);
      setDocumentRejectTarget(null);
      setDocumentRejectNote("");
      showToast("Document rejected.", "success");
      await loadProject();
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Document reject failed.",
        "error",
      );
    } finally {
      setRejectingDocument(false);
    }
  }

  async function confirmDocumentDelete() {
    if (!documentDeleteTarget) {
      return;
    }

    try {
      setDeletingDocument(true);
      await deleteDocument(documentDeleteTarget);
      setDocuments((current) =>
        current.filter((document) => document.id !== documentDeleteTarget.id),
      );
      setDocumentDeleteTarget(null);
      showToast("Document deleted.", "success");
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Document delete failed.",
        "error",
      );
    } finally {
      setDeletingDocument(false);
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
          <div className="flex flex-col gap-4 border-b border-stone-200 pb-5 lg:flex-row lg:items-start lg:justify-between">
            <header className="min-w-0 space-y-3">
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="min-w-0 text-2xl font-semibold tracking-normal text-slate-950 sm:text-3xl">
                  {project.project_name ?? project.project_code ?? "Project"}
                </h1>
                {canUpdate ? (
                  <button
                    aria-label="Edit project"
                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-white text-slate-700 shadow-sm transition-colors hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600"
                    onClick={() => {
                      setFormErrors({});
                      setEditing(projectToForm(project));
                    }}
                    title="Edit project"
                    type="button"
                  >
                    <svg
                      aria-hidden="true"
                      className="size-4"
                      fill="none"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                    >
                      <path d="M12 20h9" />
                      <path d="m16.5 3.5 4 4L7 21H3v-4L16.5 3.5z" />
                    </svg>
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <span className="font-semibold text-slate-900">
                  {project.project_code ?? "Project"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ProjectStatusBadge value={project.project_status} />
                {canUpdate ? (
                  <ProjectStatusSelect
                    disabled={updatingStatus}
                    value={project.project_status ?? "created"}
                    onChange={setStatusTarget}
                  />
                ) : null}
              </div>
            </header>
            <div className="flex flex-wrap gap-2">
              {canCreateDocument ? (
                <Button onClick={openDocumentForm} variant="secondary">
                  Upload Document
                </Button>
              ) : null}
              {canCreateInventory ? (
                <Button onClick={openMaterialIssueForm} variant="secondary">
                  Add Material Issue
                </Button>
              ) : null}
              {canCreateInvoice ? (
                <Button
                  onClick={() => navigate(`/invoices?projectId=${project.id}`)}
                  variant="secondary"
                >
                  Create Project Invoice
                </Button>
              ) : null}
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.85fr)]">
            <div className="space-y-6">
              <DetailSection title="Customer Details">
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
              </DetailSection>

              <DetailSection title="Project Details">
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
              </DetailSection>

              <DetailSection title="Installation Address">
                <DetailItem
                  label="Address"
                  value={project.installation_address ?? contact.address ?? "-"}
                />
                <DetailItem label="City" value={project.city ?? "-"} />
                <DetailItem label="District" value={project.district ?? "-"} />
                <DetailItem label="State" value={project.state ?? "-"} />
                <DetailItem label="Pincode" value={project.pincode ?? "-"} />
              </DetailSection>

              <DetailSection title="Assigned Team">
                <DetailItem
                  label="Project Manager"
                  value={staffName(staff, project.assigned_project_manager)}
                />
                <DetailItem
                  label="Installation Team"
                  value={formatTeamDisplay(project.assigned_installation_team)}
                />
              </DetailSection>

              <DetailSection title="Linked Workflow">
                <DetailItem label="Quotation" value={quotationLink(project)} />
                <DetailItem label="Site Survey" value={surveyLink(project)} />
                <DetailItem
                  label="System Capacity"
                  value={formatKw(project.system_capacity_kw)}
                />
                <DetailItem label="Project Type" value={labelize(project.project_type)} />
              </DetailSection>
            </div>

            {canViewPayments && paymentSummary ? (
              <aside className="h-fit rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between xl:flex-col xl:items-stretch">
                  <h2 className="text-base font-semibold text-slate-950">
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
                <div className="mt-4">
                  <PaymentSummaryCards className="grid gap-3" summary={paymentSummary} />
                </div>
              </aside>
            ) : null}
          </div>

          {canViewDocuments ? (
            <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
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
                    canUpdate={canUpdateDocument && !verifyingDocumentId}
                    canDelete={canDeleteDocument}
                    onVerify={handleDocumentVerify}
                    onReject={(document) => {
                      setDocumentRejectTarget(document);
                      setDocumentRejectNote("");
                    }}
                    onDelete={setDocumentDeleteTarget}
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

          {canViewInventory ? (
            <ProjectMaterialsSection
              materials={projectMaterials}
              canCreate={canCreateInventory}
              onAdd={openMaterialIssueForm}
            />
          ) : null}

          {canDelete ? (
            <section className="rounded-xl border border-rose-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-rose-900">
                    Danger Zone
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    Delete this project record from the installation workflow.
                  </p>
                </div>
                <Button onClick={() => setConfirmingDelete(true)} variant="danger">
                  Delete Project
                </Button>
              </div>
            </section>
          ) : null}
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

      {documentDeleteTarget ? (
        <ConfirmDialog
          title="Delete document?"
          description={`This will remove ${documentDeleteTarget.document_name} from ${documentRelatedLabel(documentDeleteTarget)}.`}
          confirming={deletingDocument}
          onCancel={() => setDocumentDeleteTarget(null)}
          onConfirm={confirmDocumentDelete}
        />
      ) : null}

      {documentRejectTarget ? (
        <RejectDocumentDialog
          document={documentRejectTarget}
          note={documentRejectNote}
          setNote={setDocumentRejectNote}
          confirming={rejectingDocument}
          onCancel={() => setDocumentRejectTarget(null)}
          onConfirm={confirmDocumentReject}
        />
      ) : null}

      {confirmingDelete ? (
        <ConfirmDialog
          title="Delete project?"
          description="This project record will be removed from the installation workflow."
          confirming={deleting}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={handleDelete}
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

function ProjectMaterialsSection({
  materials,
  canCreate,
  onAdd,
}: {
  materials: InventoryTransactionWithRelations[];
  canCreate: boolean;
  onAdd: () => void;
}) {
  const issuedMaterials = materials.filter(
    (material) =>
      material.transaction_type === "project_issue" ||
      material.transaction_type === "stock_out",
  );

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold text-slate-950">
          Inventory / Materials
        </h2>
        {canCreate ? <Button onClick={onAdd}>Add Material Issue</Button> : null}
      </div>
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
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {issuedMaterials.map((material) => (
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 grid gap-3 lg:hidden">
            {issuedMaterials.map((material) => (
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
              </article>
            ))}
          </div>
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
