import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ui/ToastProvider";
import {
  deleteCustomer,
  fetchCustomer,
  fetchStaffOptions,
  updateCustomer,
} from "./crmApi";
import {
  customerSegmentLabel,
  customerStatusOptions,
  customerToForm,
  customerTypeOptionsForSegment,
  formatDate,
  hasPermission,
  labelize,
  requiredError,
  staffName,
} from "./crmUtils";
import type { Customer, CustomerFormValues, StaffOption } from "./types";
import {
  AccessDenied,
  Button,
  ConfirmDialog,
  DetailItem,
  DetailSection,
  EmptyState,
  LoadingSkeleton,
  Modal,
  PlaceholderAction,
  SelectInput,
  StaffSelect,
  StatusBadge,
  TextArea,
  TextInput,
} from "./CrmComponents";
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

export function CustomerDetailPage() {
  const { id } = useParams();
  const { profile, permissions } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CustomerFormValues | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
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

  const canView = hasPermission(profile, permissions, "customers", "view");
  const canUpdate = hasPermission(profile, permissions, "customers", "update");
  const canDelete = hasPermission(profile, permissions, "customers", "delete");
  const canCreateB2BSale = hasPermission(profile, permissions, "b2b_sales", "create");
  const canViewB2BSales = hasPermission(profile, permissions, "b2b_sales", "view");
  const canViewInvoices = hasPermission(profile, permissions, "invoices", "view");
  const canViewPayments = hasPermission(profile, permissions, "payments", "view");
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

  async function loadCustomer() {
    if (!canView || !id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [nextCustomer, nextStaff, nextDocuments] =
        await Promise.all([
          fetchCustomer(profile, id),
          fetchStaffOptions(profile),
          canViewDocuments ? fetchDocuments(profile, { customerId: id }) : [],
        ]);
      setCustomer(nextCustomer);
      setStaff(nextStaff);
      setDocuments(nextDocuments);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load customer.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCustomer();
    // loadCustomer closes over the current route and permission/profile state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, canViewDocuments, id, profile?.id]);

  if (!canView) {
    return (
      <AccessDenied
        title="Customer profile is not available"
        description="Your role needs customers:view access to open customer details."
      />
    );
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!customer || !editing) {
      return;
    }

    const segment = editing.customer_segment;
    const nextErrors = {
      full_name:
        segment === "project_based"
          ? requiredError(editing.full_name, "Full name")
          : "",
      business_name:
        segment === "b2b_direct"
          ? requiredError(editing.business_name, "Business name")
          : "",
      contact_person_name:
        segment === "b2b_direct"
          ? requiredError(editing.contact_person_name, "Contact person")
          : "",
      phone: requiredError(editing.phone, "Phone"),
    };
    setFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSaving(true);
      const updatedCustomer = await updateCustomer(
        customer.id,
        normalizeCustomerSubmitValues(editing),
      );
      setCustomer(updatedCustomer);
      setEditing(null);
      showToast("Customer updated.", "success");
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Customer update failed.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!customer) {
      return;
    }

    try {
      setDeleting(true);
      await deleteCustomer(customer.id);
      showToast("Customer deleted.", "success");
      navigate("/customers");
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Customer delete failed.",
        "error",
      );
    } finally {
      setDeleting(false);
    }
  }

  function openDocumentForm() {
    if (!customer) {
      return;
    }

    setDocumentErrors({});
    setDocumentFile(null);
    setDocumentForm(
      emptyDocumentUploadForm({
        customer_id: customer.id,
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
      await loadCustomer();
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
      await loadCustomer();
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
      await loadCustomer();
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

  return (
    <div className="space-y-6">
      <Link className="text-sm font-semibold text-brand-700" to={customerListPath(customer)}>
        Back to {customerSegmentLabel(customer?.customer_segment)}
      </Link>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load customer" description={error} /> : null}
      {!loading && !error && !customer ? (
        <EmptyState title="Customer not found" description="This customer may have been deleted or is outside your organization access." />
      ) : null}

      {customer ? (
        <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <PageHeader
              title={
                customer.customer_segment === "b2b_direct"
                  ? customer.business_name || customer.full_name
                  : customer.full_name
              }
              description={`${customer.customer_code ?? "Customer"} / ${customer.phone}`}
            />
            <div className="flex flex-wrap gap-2">
              {customer.customer_segment === "b2b_direct" && canCreateB2BSale ? (
                <Link
                  className="inline-flex items-center justify-center rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-800"
                  to={`/b2b-sales?customerId=${customer.id}&new=1`}
                >
                  Create Sale
                </Link>
              ) : null}
              {canUpdate ? (
                <Button
                  onClick={() => {
                    setFormErrors({});
                    setEditing(customerToForm(customer));
                  }}
                  variant="secondary"
                >
                  Edit Customer
                </Button>
              ) : null}
              {canDelete ? (
                <Button onClick={() => setConfirmingDelete(true)} variant="danger">
                  Delete Customer
                </Button>
              ) : null}
            </div>
          </div>

          <DetailSection title="Basic Details">
            <DetailItem label="Customer Code" value={customer.customer_code ?? "-"} />
            <DetailItem label="Status" value={<StatusBadge value={customer.status} />} />
            <DetailItem label="Customer Segment" value={customerSegmentLabel(customer.customer_segment)} />
            <DetailItem label="Customer Subtype" value={labelize(customer.customer_type)} />
            {customer.customer_segment === "b2b_direct" ? (
              <>
                <DetailItem label="Business Name" value={customer.business_name ?? "-"} />
                <DetailItem label="GST Number" value={customer.gst_number ?? "-"} />
                <DetailItem
                  label="Contact Person"
                  value={customer.contact_person_name ?? "-"}
                />
              </>
            ) : null}
            <DetailItem label="Lead Source" value={customer.lead_source ?? "-"} />
            <DetailItem label="Phone" value={customer.phone} />
            <DetailItem label="Alternate Phone" value={customer.alternate_phone ?? "-"} />
            <DetailItem label="Email" value={customer.email ?? "-"} />
            <DetailItem label="Created" value={formatDate(customer.created_at)} />
          </DetailSection>

          <DetailSection title="Address">
            <DetailItem label="Address Line 1" value={customer.address_line_1 ?? "-"} />
            <DetailItem label="Address Line 2" value={customer.address_line_2 ?? "-"} />
            <DetailItem label="City" value={customer.city ?? "-"} />
            <DetailItem label="District" value={customer.district ?? "-"} />
            <DetailItem label="State" value={customer.state ?? "-"} />
            <DetailItem label="Pincode" value={customer.pincode ?? "-"} />
          </DetailSection>

          <DetailSection title="Notes and Ownership">
            <DetailItem label="Assigned Staff" value={staffName(staff, customer.assigned_to)} />
            <DetailItem label="Notes" value={customer.notes ?? "-"} />
          </DetailSection>

          {canViewDocuments ? (
            <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-base font-semibold text-slate-950">
                  Documents
                </h2>
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
                    title="No customer documents uploaded"
                    description="Upload identity, property, agreement, subsidy, and project documents for this customer."
                    action={
                      canCreateDocument ? (
                        <Button onClick={openDocumentForm}>Upload Document</Button>
                      ) : null
                    }
                  />
                </div>
              )}
            </section>
          ) : null}

          {customer.customer_segment === "b2b_direct" ? (
            <DetailSection title="B2B/Direct Workflow">
              <DetailItem label="Sales" value="Create and review project-free product sales." />
              <DetailItem label="Billing" value="Generate invoices and record direct payments from sale details." />
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                {canViewB2BSales ? (
                  <Link
                    className="inline-flex items-center justify-center rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-stone-50"
                    to={`/b2b-sales?customerId=${customer.id}`}
                  >
                    View Sales
                  </Link>
                ) : null}
                {canViewInvoices ? (
                  <Link
                    className="inline-flex items-center justify-center rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-stone-50"
                    to={`/invoices?customerId=${customer.id}`}
                  >
                    View Invoices
                  </Link>
                ) : null}
                {canViewPayments ? (
                  <Link
                    className="inline-flex items-center justify-center rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-stone-50"
                    to={`/payments?customerId=${customer.id}`}
                  >
                    View Payments
                  </Link>
                ) : null}
              </div>
            </DetailSection>
          ) : (
            <DetailSection title="Future Workflow">
              <DetailItem label="Related Leads" value="Placeholder for linked lead history." />
              <DetailItem label="Related Projects" value="Placeholder for customer project records." />
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <PlaceholderAction>Schedule Site Survey</PlaceholderAction>
                <PlaceholderAction>Create Quotation</PlaceholderAction>
                <PlaceholderAction>Create Project</PlaceholderAction>
              </div>
            </DetailSection>
          )}
        </>
      ) : null}

      {editing ? (
        <CustomerEditModal
          values={editing}
          setValues={setEditing}
          errors={formErrors}
          staff={staff}
          onClose={() => setEditing(null)}
          onSubmit={handleEditSubmit}
          saving={saving}
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
          title="Delete customer?"
          description="This customer record will be removed from the organization."
          confirming={deleting}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={handleDelete}
        />
      ) : null}
    </div>
  );
}

function CustomerEditModal({
  values,
  setValues,
  errors,
  staff,
  onClose,
  onSubmit,
  saving,
}: {
  values: CustomerFormValues;
  setValues: (values: CustomerFormValues) => void;
  errors: Record<string, string>;
  staff: StaffOption[];
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  const update = (key: keyof CustomerFormValues, value: string) =>
    setValues({ ...values, [key]: value });
  const segment = values.customer_segment;

  return (
    <Modal
      title="Edit Customer"
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel="Save Customer"
      submitting={saving}
    >
      {segment === "project_based" ? (
        <TextInput label="Full Name" value={values.full_name} onChange={(value) => update("full_name", value)} error={errors.full_name} required />
      ) : null}
      {segment === "b2b_direct" ? (
        <>
          <TextInput label="Business Name" value={values.business_name} onChange={(value) => update("business_name", value)} error={errors.business_name} required />
          <TextInput label="GST Number" value={values.gst_number} onChange={(value) => update("gst_number", value)} />
          <TextInput label="Contact Person" value={values.contact_person_name} onChange={(value) => update("contact_person_name", value)} error={errors.contact_person_name} required />
        </>
      ) : null}
      <TextInput label="Phone" value={values.phone} onChange={(value) => update("phone", value)} error={errors.phone} required />
      <TextInput label="Alternate Phone" value={values.alternate_phone} onChange={(value) => update("alternate_phone", value)} />
      <TextInput label="Email" value={values.email} onChange={(value) => update("email", value)} type="email" />
      <TextInput label="Address Line 1" value={values.address_line_1} onChange={(value) => update("address_line_1", value)} />
      <TextInput label="Address Line 2" value={values.address_line_2} onChange={(value) => update("address_line_2", value)} />
      <TextInput label="City" value={values.city} onChange={(value) => update("city", value)} />
      <TextInput label="District" value={values.district} onChange={(value) => update("district", value)} />
      <TextInput label="State" value={values.state} onChange={(value) => update("state", value)} />
      <TextInput label="Pincode" value={values.pincode} onChange={(value) => update("pincode", value)} />
      {segment === "project_based" ? (
        <SelectInput label="Customer Subtype" value={values.customer_type} onChange={(value) => update("customer_type", value)} options={customerTypeOptionsForSegment(segment).map((value) => ({ value, label: labelize(value) }))} />
      ) : null}
      {segment === "project_based" ? (
        <TextInput label="Lead Source" value={values.lead_source} onChange={(value) => update("lead_source", value)} />
      ) : null}
      {segment === "project_based" ? (
        <SelectInput label="Status" value={values.status} onChange={(value) => update("status", value)} options={customerStatusOptions.map((value) => ({ value, label: labelize(value) }))} />
      ) : null}
      {segment === "project_based" ? (
        <StaffSelect staff={staff} value={values.assigned_to} onChange={(value) => update("assigned_to", value)} />
      ) : null}
      <TextArea label="Notes" value={values.notes} onChange={(value) => update("notes", value)} />
    </Modal>
  );
}

function customerListPath(customer: Customer | null) {
  return customer?.customer_segment === "b2b_direct"
    ? "/customers/b2b-direct"
    : "/customers/project-based";
}

function normalizeCustomerSubmitValues(
  values: CustomerFormValues,
): CustomerFormValues {
  if (values.customer_segment === "project_based") {
    return {
      ...values,
      customer_segment: "project_based",
      business_name: "",
      gst_number: "",
      contact_person_name: "",
    };
  }

  return {
    ...values,
    customer_segment: "b2b_direct",
    customer_type: "b2b_installer",
    status: "active",
    full_name:
      values.contact_person_name.trim() ||
      values.full_name.trim() ||
      values.business_name.trim(),
    lead_source: "",
    assigned_to: "",
  };
}
