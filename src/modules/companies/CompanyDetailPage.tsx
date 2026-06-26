import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ui/ToastProvider";
import {
  Badge,
  Button,
  ConfirmDialog,
  DetailItem,
  DetailSection,
  EmptyState,
  LoadingSkeleton,
  Modal,
  TextArea,
  TextInput,
} from "../crm/CrmComponents";
import { labelize } from "../crm/crmUtils";
import {
  fetchPlatformCompany,
  guardedDeletePlatformCompany,
  sendPlatformAdminSetupLink,
  updatePlatformAdminStatus,
  updatePlatformCompanyProfile,
  updatePlatformCompanyStatus,
} from "./companyApi";
import {
  adminSetupLabel,
  companyToUpdateForm,
  formatDateTime,
  slugify,
  validateUpdateCompanyForm,
} from "./companyUtils";
import type {
  PlatformCompany,
  PlatformCompanyActionResult,
  UpdatePlatformCompanyFormValues,
} from "./types";

type EditState = {
  values: UpdatePlatformCompanyFormValues;
  error: string | null;
};

type SetupLinkNotice = {
  email: string;
  emailSent: boolean;
  link: string;
};

export function CompanyDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [company, setCompany] = useState<PlatformCompany | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [setupLinkNotice, setSetupLinkNotice] =
    useState<SetupLinkNotice | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const loadCompany = useCallback(async () => {
    if (!id) {
      setError("EPC company id is missing.");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setCompany(await fetchPlatformCompany(id));
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load EPC company.",
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadCompany();
  }, [loadCompany]);

  async function runAction(
    actionKey: string,
    successMessage: string,
    action: () => Promise<unknown>,
  ) {
    try {
      setBusyAction(actionKey);
      setError(null);
      setSetupLinkNotice(null);
      await action();
      await loadCompany();
      showToast(successMessage, "success");
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : "Action failed.";
      setError(message);
      showToast(message, "error");
    } finally {
      setBusyAction(null);
    }
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!company || !editState) {
      return;
    }

    const validationError = validateUpdateCompanyForm(editState.values);

    if (validationError) {
      setEditState({ ...editState, error: validationError });
      return;
    }

    try {
      setBusyAction("edit");
      await updatePlatformCompanyProfile(company.id, editState.values);
      setEditState(null);
      await loadCompany();
      showToast("EPC company updated.", "success");
    } catch (nextError) {
      setEditState({
        ...editState,
        error:
          nextError instanceof Error
            ? nextError.message
            : "Unable to update EPC company.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function confirmDelete() {
    if (!company) {
      return;
    }

    try {
      setBusyAction("delete");
      await guardedDeletePlatformCompany(company.id);
      showToast("EPC company deleted.", "success");
      navigate("/companies", { replace: true });
    } catch (nextError) {
      const message =
        nextError instanceof Error
          ? nextError.message
          : "Unable to delete EPC company.";
      setError(message);
      showToast(message, "error");
      setDeleteOpen(false);
    } finally {
      setBusyAction(null);
    }
  }

  async function copySetupLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      showToast("Setup link copied.", "success");
    } catch {
      showToast("Unable to copy setup link.", "error");
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="EPC Company"
          description="Loading company profile, admin setup, and activity."
        />
        <LoadingSkeleton />
      </div>
    );
  }

  if (!company) {
    return (
      <EmptyState
        title="EPC company not found"
        description={error ?? "The selected EPC company could not be loaded."}
        action={<Button onClick={() => navigate("/companies")}>Back to list</Button>}
      />
    );
  }

  const nextCompanyStatus = company.status === "active" ? "inactive" : "active";
  const summary = company.activity_summary;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <PageHeader
          title={company.name}
          description={`${company.slug}${company.subdomain ? ` / ${company.subdomain}` : ""}`}
        />
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setEditState({ values: companyToUpdateForm(company), error: null })}>
            Edit
          </Button>
          <Button
            disabled={Boolean(busyAction)}
            onClick={() =>
              void runAction(
                `company-status:${nextCompanyStatus}`,
                `Workspace marked ${nextCompanyStatus}.`,
                () => updatePlatformCompanyStatus(company.id, nextCompanyStatus),
              )
            }
            variant="secondary"
          >
            Mark {nextCompanyStatus}
          </Button>
          <Button
            disabled={Boolean(busyAction) || !company.admin || company.admin.status === "inactive"}
            onClick={() =>
              company.admin
                ? void runAction("setup-link", "Admin setup link prepared.", async () => {
                    const result = await sendPlatformAdminSetupLink(
                      company.admin!.id,
                    );

                    if (hasSetupLink(result)) {
                      setSetupLinkNotice({
                        email: company.admin!.email ?? "the primary admin",
                        emailSent: result.email_sent !== false,
                        link: result.setup_link,
                      });
                    }

                    return result;
                  })
                : undefined
            }
            variant="secondary"
          >
            Send setup link
          </Button>
          <Button
            disabled={Boolean(busyAction)}
            onClick={() => setDeleteOpen(true)}
            variant="danger"
          >
            Delete
          </Button>
        </div>
      </div>

      {error ? (
        <section className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-900">
          {error}
        </section>
      ) : null}

      {setupLinkNotice ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="font-semibold">
                {setupLinkNotice.emailSent
                  ? "Email requested. Manual setup link is ready."
                  : "Manual setup link generated."}
              </p>
              <p className="mt-1 text-amber-900">
                Send this link to {setupLinkNotice.email} if the email still does
                not arrive.
              </p>
              <input
                className="mt-3 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-slate-900"
                readOnly
                value={setupLinkNotice.link}
              />
            </div>
            <Button
              onClick={() => void copySetupLink(setupLinkNotice.link)}
              variant="secondary"
            >
              Copy link
            </Button>
          </div>
        </section>
      ) : null}

      <section className="flex flex-wrap gap-2">
        <StatusBadge value={company.status} />
        <Badge tone={adminSetupLabel(company).includes("active") ? "green" : "amber"}>
          {adminSetupLabel(company)}
        </Badge>
        <Badge tone="blue">Created {formatDateTime(company.created_at)}</Badge>
        <Badge>Updated {formatDateTime(company.updated_at)}</Badge>
      </section>

      <DetailSection title="Company Profile">
        <DetailItem label="Company Name" value={company.name} />
        <DetailItem label="Workspace Slug" value={company.slug} />
        <DetailItem label="Default Subdomain" value={company.subdomain} />
        <DetailItem label="Custom Domain" value={company.custom_domain} />
        <DetailItem label="Logo URL" value={company.settings?.company_logo_url} />
        <DetailItem label="Address" value={company.settings?.address} />
        <DetailItem label="Contact Person" value={company.settings?.contact_person} />
        <DetailItem label="Contact Email" value={company.settings?.contact_email} />
        <DetailItem label="Contact Phone" value={company.settings?.contact_phone} />
        <DetailItem label="GST Number" value={company.settings?.gst_number} />
        <DetailItem label="Timezone" value={company.settings?.timezone} />
        <DetailItem label="Currency" value={company.settings?.currency} />
      </DetailSection>

      <DetailSection title="Primary EPC Admin">
        <DetailItem label="Full Name" value={company.admin?.full_name} />
        <DetailItem label="Email" value={company.admin?.email} />
        <DetailItem label="Phone" value={company.admin?.phone} />
        <DetailItem label="Profile Status" value={labelize(company.admin?.status)} />
        <DetailItem
          label="Auth Link"
          value={company.admin?.auth_user_id ? "Linked" : "Not linked"}
        />
        <DetailItem label="Invited At" value={formatDateTime(company.admin?.invited_at ?? null)} />
        <DetailItem
          label="Onboarded At"
          value={formatDateTime(company.admin?.onboarded_at ?? null)}
        />
        <DetailItem
          label="Last Login"
          value={formatDateTime(company.admin?.last_login_at ?? null)}
        />
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button
            disabled={Boolean(busyAction) || !company.admin || company.admin.status === "active"}
            onClick={() =>
              company.admin
                ? void runAction("admin-active", "Admin marked active.", () =>
                    updatePlatformAdminStatus(company.admin!.id, "active"),
                  )
                : undefined
            }
            variant="secondary"
          >
            Mark admin active
          </Button>
          <Button
            disabled={Boolean(busyAction) || !company.admin || company.admin.status === "inactive"}
            onClick={() =>
              company.admin
                ? void runAction("admin-inactive", "Admin marked inactive.", () =>
                    updatePlatformAdminStatus(company.admin!.id, "inactive"),
                  )
                : undefined
            }
            variant="secondary"
          >
            Mark admin inactive
          </Button>
        </div>
      </DetailSection>

      <DetailSection title="Access And Workspace Setup">
        <DetailItem label="Users" value={String(company.user_count)} />
        <DetailItem label="Roles" value={String(company.role_count)} />
        <DetailItem
          label="Admin Role"
          value={company.role_count > 0 ? "Created" : "Not created"}
        />
        <DetailItem
          label="Organization Settings"
          value={company.settings ? "Created" : "Not created"}
        />
        <DetailItem label="Setup State" value={adminSetupLabel(company)} />
        <DetailItem label="Invite Events" value={formatDateTime(company.admin?.invited_at ?? null)} />
      </DetailSection>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <DetailSection title="Activity Snapshot">
          <Metric label="Customers" value={summary?.total_customers ?? 0} />
          <Metric label="Enquiries" value={summary?.total_leads ?? 0} />
          <Metric label="Active Projects" value={summary?.active_projects ?? 0} />
          <Metric label="Completed Projects" value={summary?.completed_projects ?? 0} />
          <Metric label="Pending Surveys" value={summary?.pending_site_surveys ?? 0} />
          <Metric label="Quotations Sent" value={summary?.quotations_sent ?? 0} />
          <Metric label="Quotations Accepted" value={summary?.quotations_accepted ?? 0} />
          <Metric label="Pending Documents" value={summary?.pending_documents ?? 0} />
          <Metric label="Low Stock Items" value={summary?.low_stock_items ?? 0} />
        </DetailSection>

        <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">
            Recent Activity
          </h2>
          {company.recent_activity && company.recent_activity.length > 0 ? (
            <div className="mt-4 space-y-3">
              {company.recent_activity.map((activity) => (
                <article
                  className="rounded-lg border border-stone-100 bg-stone-50 p-3"
                  key={activity.id}
                >
                  <p className="text-sm font-semibold text-slate-950">
                    {labelize(activity.module)} / {labelize(activity.action)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {formatDateTime(activity.created_at)}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm leading-6 text-slate-600">
              No recent activity recorded for this EPC company.
            </p>
          )}
        </section>
      </section>

      <DetailSection title="Phase 2 Subscription And Financials">
        <DetailItem label="Subscription Status" value="Coming in Phase 2" />
        <DetailItem label="Current Plan" value="Coming in Phase 2" />
        <DetailItem label="Trial Dates" value="Coming in Phase 2" />
        <DetailItem label="Billing Cycle" value="Coming in Phase 2" />
        <DetailItem label="Outstanding Amount" value="Coming in Phase 2" />
        <DetailItem label="Last Invoice / Payment" value="Coming in Phase 2" />
      </DetailSection>

      <Link className="text-sm font-semibold text-[#06173f]" to="/companies">
        Back to EPC Companies
      </Link>

      {editState ? (
        <CompanyEditModal
          busy={busyAction === "edit"}
          editState={editState}
          onClose={() => setEditState(null)}
          onSubmit={submitEdit}
          setEditState={setEditState}
        />
      ) : null}

      {deleteOpen ? (
        <ConfirmDialog
          title="Delete EPC company?"
          description="This will permanently delete only setup-only EPC companies. If operational records exist, the action will be blocked and you should mark the company inactive instead."
          confirmLabel="Delete"
          confirming={busyAction === "delete"}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </div>
  );
}

function CompanyEditModal({
  busy,
  editState,
  onClose,
  onSubmit,
  setEditState,
}: {
  busy: boolean;
  editState: EditState;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  setEditState: (state: EditState) => void;
}) {
  const update = (key: keyof UpdatePlatformCompanyFormValues, value: string) => {
    setEditState({
      error: null,
      values: {
        ...editState.values,
        [key]: key === "organization_slug" ? slugify(value) : value,
      },
    });
  };

  return (
    <Modal
      maxWidthClass="sm:max-w-4xl"
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel="Save EPC company"
      submitting={busy}
      title="Edit EPC company"
    >
      {editState.error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 md:col-span-2">
          {editState.error}
        </div>
      ) : null}
      <TextInput
        label="Company Name"
        onChange={(value) => update("organization_name", value)}
        required
        value={editState.values.organization_name}
      />
      <TextInput
        label="Workspace Slug"
        onChange={(value) => update("organization_slug", value)}
        required
        value={editState.values.organization_slug}
      />
      <TextInput
        label="Default Subdomain"
        onChange={(value) => update("subdomain", value)}
        value={editState.values.subdomain}
      />
      <TextInput
        label="Custom Domain"
        onChange={(value) => update("custom_domain", value)}
        value={editState.values.custom_domain}
      />
      <TextInput
        label="Logo URL"
        onChange={(value) => update("company_logo_url", value)}
        value={editState.values.company_logo_url}
      />
      <TextArea
        label="Address"
        onChange={(value) => update("address", value)}
        value={editState.values.address}
      />
      <TextInput
        label="Contact Person"
        onChange={(value) => update("contact_person", value)}
        value={editState.values.contact_person}
      />
      <TextInput
        label="Contact Email"
        onChange={(value) => update("contact_email", value)}
        type="email"
        value={editState.values.contact_email}
      />
      <TextInput
        label="Contact Phone"
        onChange={(value) => update("contact_phone", value)}
        value={editState.values.contact_phone}
      />
      <TextInput
        label="GST Number"
        onChange={(value) => update("gst_number", value)}
        value={editState.values.gst_number}
      />
      <TextInput
        label="Timezone"
        onChange={(value) => update("timezone", value)}
        value={editState.values.timezone}
      />
      <TextInput
        label="Currency"
        onChange={(value) => update("currency", value)}
        value={editState.values.currency}
      />
      <TextInput
        label="Primary Admin Name"
        onChange={(value) => update("admin_full_name", value)}
        required
        value={editState.values.admin_full_name}
      />
      <TextInput
        label="Primary Admin Email"
        onChange={(value) => update("admin_email", value)}
        required
        type="email"
        value={editState.values.admin_email}
      />
      <TextInput
        label="Primary Admin Phone"
        onChange={(value) => update("admin_phone", value)}
        value={editState.values.admin_phone}
      />
    </Modal>
  );
}

function StatusBadge({ value }: { value: string | null | undefined }) {
  const tone = value === "active" ? "green" : value === "inactive" ? "red" : "amber";

  return <Badge tone={tone}>{labelize(value)}</Badge>;
}

function hasSetupLink(
  result: PlatformCompanyActionResult,
): result is PlatformCompanyActionResult & { setup_link: string } {
  return (
    typeof result.setup_link === "string" &&
    result.setup_link.trim().length > 0
  );
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-100 bg-stone-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-slate-950">{value}</p>
    </div>
  );
}
