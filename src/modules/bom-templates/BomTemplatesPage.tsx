import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { useToast } from "../../components/ui/ToastProvider";
import {
  AccessDenied,
  AlertDialog,
  Button,
  ConfirmDialog,
  EmptyState,
  LoadingSkeleton,
  SearchInput,
  SelectInput,
} from "../crm/CrmComponents";
import { formatDateTime, hasPermission, labelize } from "../crm/crmUtils";
import {
  createBomTemplate,
  deleteBomTemplate,
  fetchBomTemplates,
  updateBomTemplate,
  updateBomTemplateActiveState,
} from "./bomTemplateApi";
import {
  bomTemplateSortOptions,
  bomTemplateStatusOptions,
  bomTemplateToForm,
  bomTemplateTypeLabel,
  bomTemplateValidationSummary,
  emptyBomTemplateForm,
  validateBomTemplateForm,
} from "./bomTemplateUtils";
import {
  BomTemplateFormModal,
  BomTemplateStatusBadge,
  BomTemplateTypeBadge,
} from "./BomTemplateComponents";
import type {
  BomTemplate,
  BomTemplateFormValues,
  BomTemplateSortKey,
} from "./types";

type BomTemplateFilters = {
  search: string;
  status: string;
  sort: BomTemplateSortKey;
};

type BomTemplateFormState = {
  mode: "create" | "edit";
  template: BomTemplate | null;
  values: BomTemplateFormValues;
};

type ActiveStateAction = {
  template: BomTemplate;
  isActive: boolean;
};

export function BomTemplatesPage() {
  const { profile, permissions } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<BomTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<BomTemplateFilters>({
    search: "",
    status: "",
    sort: "display_order",
  });
  const [templateForm, setTemplateForm] =
    useState<BomTemplateFormState | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveAlert, setSaveAlert] = useState<{
    title: string;
    description: string;
  } | null>(null);
  const [activeStateAction, setActiveStateAction] =
    useState<ActiveStateAction | null>(null);
  const [updatingActiveState, setUpdatingActiveState] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BomTemplate | null>(null);
  const [deleting, setDeleting] = useState(false);

  const canView = hasPermission(profile, permissions, "product_master", "view");
  const canCreate = hasPermission(
    profile,
    permissions,
    "product_master",
    "create",
  );
  const canUpdate = hasPermission(
    profile,
    permissions,
    "product_master",
    "update",
  );
  const canDelete = hasPermission(
    profile,
    permissions,
    "product_master",
    "delete",
  );

  async function loadData() {
    if (!canView) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const nextTemplates = await fetchBomTemplates(profile);
      setTemplates(nextTemplates);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load BOM templates.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // loadData closes over current permission/profile state for this module.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, profile?.id]);

  const filteredTemplates = useMemo(() => {
    const search = filters.search.trim().toLowerCase();

    return templates
      .filter((template) => {
        const matchesSearch =
          !search ||
          [
            template.name,
            bomTemplateTypeLabel(template.template_type),
            template.description,
            String(template.display_order ?? 0),
          ]
            .filter(Boolean)
            .some((value) => value?.toLowerCase().includes(search));
        const status = template.is_active === false ? "inactive" : "active";
        const matchesStatus = !filters.status || status === filters.status;

        return matchesSearch && matchesStatus;
      })
      .sort((first, second) => compareTemplates(first, second, filters.sort));
  }, [filters, templates]);

  if (!canView) {
    return (
      <AccessDenied
        title="BOM templates are not available"
        description="Your role needs product_master:view access to open BOM Templates."
      />
    );
  }

  function openCreateForm() {
    setFormErrors({});
    setTemplateForm({
      mode: "create",
      template: null,
      values: emptyBomTemplateForm(nextDisplayOrder(templates)),
    });
  }

  function openEditForm(template: BomTemplate) {
    setFormErrors({});
    setTemplateForm({
      mode: "edit",
      template,
      values: bomTemplateToForm(template),
    });
  }

  function openTemplateDetail(templateId: string) {
    navigate(`/setup/bom-templates/${templateId}`);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!templateForm) {
      return;
    }

    const nextErrors = validateBomTemplateForm(templateForm.values);
    setFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      setSaveAlert({
        title: "BOM template details missing",
        description:
          bomTemplateValidationSummary(nextErrors) ||
          "Please complete the required BOM template details before saving.",
      });
      return;
    }

    try {
      setSaving(true);
      if (templateForm.mode === "create") {
        await createBomTemplate(profile, templateForm.values);
        showToast("BOM template added.", "success");
      } else if (templateForm.template) {
        await updateBomTemplate(
          profile,
          templateForm.template.id,
          templateForm.values,
        );
        showToast("BOM template updated.", "success");
      }

      setTemplateForm(null);
      await loadData();
    } catch (nextError) {
      const description =
        nextError instanceof Error
          ? nextError.message
          : "BOM template save failed.";
      setSaveAlert({
        title: "BOM template could not be saved",
        description,
      });
      showToast(description, "error");
    } finally {
      setSaving(false);
    }
  }

  async function confirmActiveStateAction() {
    if (!activeStateAction) {
      return;
    }

    try {
      setUpdatingActiveState(true);
      const updatedTemplate = await updateBomTemplateActiveState(
        profile,
        activeStateAction.template.id,
        activeStateAction.isActive,
      );
      setTemplates((current) =>
        current.map((template) =>
          template.id === updatedTemplate.id ? updatedTemplate : template,
        ),
      );
      showToast(
        `BOM template ${activeStateAction.isActive ? "activated" : "deactivated"}.`,
        "success",
      );
      setActiveStateAction(null);
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "BOM template status update failed.",
        "error",
      );
    } finally {
      setUpdatingActiveState(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) {
      return;
    }

    try {
      setDeleting(true);
      await deleteBomTemplate(profile, deleteTarget);
      setTemplates((current) =>
        current.filter((template) => template.id !== deleteTarget.id),
      );
      showToast("BOM template deleted.", "success");
      setDeleteTarget(null);
    } catch (nextError) {
      const description =
        nextError instanceof Error
          ? nextError.message
          : "BOM template delete failed.";
      setSaveAlert({
        title: "BOM template could not be deleted",
        description,
      });
      showToast(description, "error");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title="BOM Templates"
          description="Manage template headers used for future quotation BOM setup."
        />
        {canCreate ? (
          <Button onClick={openCreateForm}>Add BOM Template</Button>
        ) : null}
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <BomTemplateMetricCard label="Total Templates" value={templates.length} />
        <BomTemplateMetricCard
          label="Active Templates"
          value={
            templates.filter((template) => template.is_active !== false).length
          }
        />
        <BomTemplateMetricCard
          label="Inactive Templates"
          value={
            templates.filter((template) => template.is_active === false).length
          }
        />
      </section>

      <section className="grid gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm md:grid-cols-[minmax(220px,1.4fr)_minmax(150px,0.7fr)_minmax(170px,0.8fr)]">
        <SearchInput
          className="block"
          placeholder="Search template, type, description, or display number"
          value={filters.search}
          onChange={(search) =>
            setFilters((current) => ({ ...current, search }))
          }
        />
        <SelectInput
          label="Status"
          value={filters.status}
          onChange={(status) =>
            setFilters((current) => ({ ...current, status }))
          }
          options={[
            { value: "", label: "All statuses" },
            ...bomTemplateStatusOptions.map((status) => ({
              value: status,
              label: labelize(status),
            })),
          ]}
        />
        <SelectInput
          label="Sort"
          value={filters.sort}
          onChange={(sort) =>
            setFilters((current) => ({
              ...current,
              sort: sort as BomTemplateSortKey,
            }))
          }
          options={bomTemplateSortOptions}
        />
      </section>

      {loading ? <LoadingSkeleton /> : null}
      {error ? (
        <EmptyState title="Could not load BOM templates" description={error} />
      ) : null}
      {!loading && !error && filteredTemplates.length === 0 ? (
        <EmptyState
          title="No BOM templates found"
          description="Add template headers, or adjust the filters to see existing records."
          action={
            canCreate ? (
              <Button onClick={openCreateForm}>Add BOM Template</Button>
            ) : null
          }
        />
      ) : null}

      {!loading && !error && filteredTemplates.length > 0 ? (
        <>
          <div className="hidden rounded-xl border border-stone-200 bg-white shadow-sm lg:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Display Number</th>
                  <th className="px-4 py-3">Template Name</th>
                  <th className="px-4 py-3">Template Type</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Last Updated</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredTemplates.map((template) => (
                  <tr key={template.id}>
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {template.display_order ?? 0}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-950">
                        {template.name}
                      </div>
                      <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">
                        {template.description ?? "No description"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <BomTemplateTypeBadge value={template.template_type} />
                    </td>
                    <td className="px-4 py-3">
                      <BomTemplateStatusBadge value={template.is_active} />
                    </td>
                    <td className="px-4 py-3">
                      {formatDateTime(template.updated_at)}
                    </td>
                    <td className="px-4 py-3">
                      <BomTemplateActions
                        template={template}
                        canUpdate={canUpdate}
                        canDelete={canDelete}
                        onView={() => openTemplateDetail(template.id)}
                        onEdit={() => openEditForm(template)}
                        onActiveState={(isActive) =>
                          setActiveStateAction({ template, isActive })
                        }
                        onDelete={() => setDeleteTarget(template)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 lg:hidden">
            {filteredTemplates.map((template) => (
              <article
                key={template.id}
                className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Display {template.display_order ?? 0}
                    </p>
                    <h2 className="mt-1 text-base font-semibold text-slate-950">
                      {template.name}
                    </h2>
                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600">
                      {template.description ?? "No description"}
                    </p>
                  </div>
                  <BomTemplateStatusBadge value={template.is_active} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500">Template Type</dt>
                    <dd className="mt-1">
                      <BomTemplateTypeBadge value={template.template_type} />
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-xs text-slate-500">Last Updated</dt>
                    <dd className="font-medium text-slate-900">
                      {formatDateTime(template.updated_at)}
                    </dd>
                  </div>
                </dl>
                <div className="mt-4">
                  <BomTemplateActions
                    template={template}
                    canUpdate={canUpdate}
                    canDelete={canDelete}
                    onView={() => openTemplateDetail(template.id)}
                    onEdit={() => openEditForm(template)}
                    onActiveState={(isActive) =>
                      setActiveStateAction({ template, isActive })
                    }
                    onDelete={() => setDeleteTarget(template)}
                  />
                </div>
              </article>
            ))}
          </div>
        </>
      ) : null}

      {templateForm ? (
        <BomTemplateFormModal
          title={
            templateForm.mode === "create"
              ? "Add BOM Template"
              : "Edit BOM Template"
          }
          values={templateForm.values}
          setValues={(values) => setTemplateForm({ ...templateForm, values })}
          errors={formErrors}
          onClose={() => setTemplateForm(null)}
          onSubmit={handleSubmit}
          saving={saving}
        />
      ) : null}

      {activeStateAction ? (
        <ConfirmDialog
          title={`${activeStateAction.isActive ? "Activate" : "Deactivate"} BOM template?`}
          description={`This keeps ${activeStateAction.template.name} available for management without changing quotation logic.`}
          confirming={updatingActiveState}
          confirmLabel={activeStateAction.isActive ? "Activate" : "Deactivate"}
          confirmingLabel="Updating..."
          confirmVariant={activeStateAction.isActive ? "primary" : "danger"}
          onCancel={() => setActiveStateAction(null)}
          onConfirm={confirmActiveStateAction}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title="Delete BOM template?"
          description={`This safely deletes ${deleteTarget.name} only if it has no BOM rules.`}
          confirming={deleting}
          confirmLabel="Delete"
          confirmingLabel="Deleting..."
          confirmVariant="danger"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      ) : null}

      {saveAlert ? (
        <AlertDialog
          title={saveAlert.title}
          description={saveAlert.description}
          onClose={() => setSaveAlert(null)}
        />
      ) : null}
    </div>
  );
}

function BomTemplateMetricCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
    </section>
  );
}

function BomTemplateActions({
  template,
  canUpdate,
  canDelete,
  onView,
  onEdit,
  onActiveState,
  onDelete,
}: {
  template: BomTemplate;
  canUpdate: boolean;
  canDelete: boolean;
  onView: () => void;
  onEdit: () => void;
  onActiveState: (isActive: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={onView} variant="secondary">
        View
      </Button>
      {canUpdate ? (
        <>
          <Button onClick={onEdit} variant="secondary">
            Edit
          </Button>
          <Button
            onClick={() => onActiveState(template.is_active === false)}
            variant={template.is_active === false ? "secondary" : "ghost"}
          >
            {template.is_active === false ? "Activate" : "Deactivate"}
          </Button>
        </>
      ) : null}
      {canDelete ? (
        <Button onClick={onDelete} variant="danger">
          Delete
        </Button>
      ) : null}
    </div>
  );
}

function compareTemplates(
  first: BomTemplate,
  second: BomTemplate,
  sort: BomTemplateSortKey,
) {
  if (sort === "display_order") {
    return (
      Number(first.display_order ?? 0) - Number(second.display_order ?? 0) ||
      first.name.localeCompare(second.name)
    );
  }

  if (sort === "name") {
    return first.name.localeCompare(second.name);
  }

  if (sort === "template_type") {
    return bomTemplateTypeLabel(first.template_type).localeCompare(
      bomTemplateTypeLabel(second.template_type),
    );
  }

  if (sort === "status") {
    return Number(second.is_active !== false) - Number(first.is_active !== false);
  }

  return (
    new Date(second.updated_at ?? second.created_at ?? 0).getTime() -
    new Date(first.updated_at ?? first.created_at ?? 0).getTime()
  );
}

function nextDisplayOrder(templates: BomTemplate[]) {
  return (
    templates.reduce(
      (highest, template) =>
        Math.max(highest, Number(template.display_order ?? 0)),
      0,
    ) + 1
  );
}
