import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { TablePagination, useTablePagination } from "../../components/TablePagination";
import { useToast } from "../../components/ui/ToastProvider";
import {
  AccessDenied,
  AlertDialog,
  Badge,
  Button,
  ConfirmDialog,
  DetailItem,
  EmptyState,
  LoadingSkeleton,
} from "../crm/CrmComponents";
import { formatDateTime, hasPermission } from "../crm/crmUtils";
import { fetchProductCategories } from "../product-master/productMasterApi";
import type { ProductCategory } from "../product-master/types";
import {
  createBomTemplateRule,
  deleteBomTemplateRule,
  fetchBomTemplate,
  fetchBomTemplateRules,
  reorderBomTemplateRules,
  updateBomTemplateRule,
} from "./bomTemplateApi";
import {
  bomCalculationTypeLabel,
  bomTemplateRuleQuantityLabel,
  bomTemplateRuleToForm,
  bomTemplateValidationSummary,
  emptyBomTemplateRuleForm,
  validateBomTemplateRuleForm,
} from "./bomTemplateUtils";
import {
  BomTemplateRuleFormModal,
  BomTemplateStatusBadge,
  BomTemplateTypeBadge,
} from "./BomTemplateComponents";
import type {
  BomTemplate,
  BomTemplateRule,
  BomTemplateRuleFormValues,
} from "./types";

type RuleFormState = {
  mode: "create" | "edit";
  rule: BomTemplateRule | null;
  values: BomTemplateRuleFormValues;
};

export function BomTemplateDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile, permissions } = useAuth();
  const { showToast } = useToast();
  const [template, setTemplate] = useState<BomTemplate | null>(null);
  const [rules, setRules] = useState<BomTemplateRule[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState<RuleFormState | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BomTemplateRule | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [saveAlert, setSaveAlert] = useState<{
    title: string;
    description: string;
  } | null>(null);

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

  const sortedRules = useMemo(
    () =>
      [...rules].sort(
        (first, second) =>
          Number(first.display_order ?? 0) - Number(second.display_order ?? 0),
      ),
    [rules],
  );
  const rulePagination = useTablePagination(sortedRules);
  const paginatedRules = rulePagination.pageItems;

  async function loadData() {
    if (!canView || !id) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const nextTemplate = await fetchBomTemplate(profile, id);

      if (!nextTemplate) {
        setTemplate(null);
        setRules([]);
        setCategories([]);
        setError("BOM template was not found.");
        return;
      }

      const [nextRules, nextCategories] = await Promise.all([
        fetchBomTemplateRules(profile, nextTemplate),
        fetchProductCategories(profile),
      ]);
      setTemplate(nextTemplate);
      setRules(hydrateRulesWithCategories(nextRules, nextCategories));
      setCategories(nextCategories);
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Unable to load BOM template details.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // loadData closes over current permission/profile state for this module.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, id, profile?.id]);

  if (!canView) {
    return (
      <AccessDenied
        title="BOM templates are not available"
        description="Your role needs product_master:view access to open BOM Templates."
      />
    );
  }

  function openCreateRuleForm() {
    setFormErrors({});
    setRuleForm({
      mode: "create",
      rule: null,
      values: emptyBomTemplateRuleForm(nextRuleDisplayOrder(rules)),
    });
  }

  function openEditRuleForm(rule: BomTemplateRule) {
    setFormErrors({});
    setRuleForm({
      mode: "edit",
      rule,
      values: bomTemplateRuleToForm(rule),
    });
  }

  async function handleRuleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!template || !ruleForm) {
      return;
    }

    const nextErrors = validateBomTemplateRuleForm(ruleForm.values);
    setFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      setSaveAlert({
        title: "BOM rule details missing",
        description:
          bomTemplateValidationSummary(nextErrors) ||
          "Please complete the required BOM rule details before saving.",
      });
      return;
    }

    try {
      setSaving(true);
      if (ruleForm.mode === "create") {
        await createBomTemplateRule(profile, template, ruleForm.values);
        showToast("BOM rule added.", "success");
      } else if (ruleForm.rule) {
        await updateBomTemplateRule(profile, ruleForm.rule, ruleForm.values);
        showToast("BOM rule updated.", "success");
      }

      setRuleForm(null);
      await loadData();
    } catch (nextError) {
      const description =
        nextError instanceof Error ? nextError.message : "BOM rule save failed.";
      setSaveAlert({
        title: "BOM rule could not be saved",
        description,
      });
      showToast(description, "error");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteRule() {
    if (!deleteTarget) {
      return;
    }

    try {
      setDeleting(true);
      await deleteBomTemplateRule(profile, deleteTarget);
      setRules((current) =>
        current.filter((rule) => rule.id !== deleteTarget.id),
      );
      showToast("BOM rule deleted.", "success");
      setDeleteTarget(null);
    } catch (nextError) {
      const description =
        nextError instanceof Error
          ? nextError.message
          : "BOM rule delete failed.";
      setSaveAlert({
        title: "BOM rule could not be deleted",
        description,
      });
      showToast(description, "error");
    } finally {
      setDeleting(false);
    }
  }

  async function moveRule(rule: BomTemplateRule, direction: "up" | "down") {
    const currentIndex = sortedRules.findIndex(
      (currentRule) => currentRule.id === rule.id,
    );
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= sortedRules.length) {
      return;
    }

    const reorderedRules = [...sortedRules];
    const movedRule = reorderedRules[currentIndex];
    reorderedRules[currentIndex] = reorderedRules[targetIndex];
    reorderedRules[targetIndex] = movedRule;

    try {
      setReordering(true);
      await reorderBomTemplateRules(profile, reorderedRules);
      await loadData();
      showToast("BOM rules reordered.", "success");
    } catch (nextError) {
      showToast(
        nextError instanceof Error
          ? nextError.message
          : "BOM rule reorder failed.",
        "error",
      );
    } finally {
      setReordering(false);
    }
  }

  return (
    <div className="space-y-6">
      <button
        className="text-sm font-semibold text-[#06173f] hover:text-[#06173f]"
        onClick={() => navigate("/setup/bom-templates")}
        type="button"
      >
        Back to BOM Templates
      </button>

      {loading ? <LoadingSkeleton /> : null}
      {error ? (
        <EmptyState title="Could not load BOM template" description={error} />
      ) : null}

      {!loading && !error && template ? (
        <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <PageHeader
              title={template.name}
              description="Manage the template header and category-based BOM rules."
            />
            <BomTemplateStatusBadge value={template.is_active} />
          </div>

          <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-950">
              Template Header
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <DetailItem
                label="Display Number"
                value={template.display_order ?? 0}
              />
              <DetailItem
                label="Template Type"
                value={<BomTemplateTypeBadge value={template.template_type} />}
              />
              <DetailItem
                label="Status"
                value={<BomTemplateStatusBadge value={template.is_active} />}
              />
              <DetailItem
                label="Last Updated"
                value={formatDateTime(template.updated_at)}
              />
              <DetailItem
                label="Description"
                value={template.description ?? "-"}
              />
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">
                  BOM Rules
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Rules define required material categories. Products are selected later during quotation BOM generation.
                </p>
              </div>
              {canCreate ? (
                <Button onClick={openCreateRuleForm}>Add Rule</Button>
              ) : null}
            </div>

            {sortedRules.length === 0 ? (
              <EmptyState
                title="No BOM rules found"
                description="Add category-based rules to this template without generating BOMs or connecting quotations yet."
                action={
                  canCreate ? (
                    <Button onClick={openCreateRuleForm}>Add Rule</Button>
                  ) : null
                }
              />
            ) : (
              <>
                <div className="hidden rounded-xl border border-stone-200 bg-white shadow-sm xl:block">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3">Display Number</th>
                        <th className="px-4 py-3">Material Category</th>
                        <th className="px-4 py-3">Calculation Type</th>
                        <th className="px-4 py-3">
                          Quantity Formula/Fixed Quantity
                        </th>
                        <th className="px-4 py-3">Required</th>
                        <th className="px-4 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {paginatedRules.map((rule) => (
                        <tr key={rule.id}>
                          <td className="px-4 py-3 font-semibold text-slate-950">
                            {rule.display_order}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-950">
                              {rule.category?.name ?? "-"}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {bomCalculationTypeLabel(rule.calculation_type)}
                          </td>
                          <td className="px-4 py-3">
                            {bomTemplateRuleQuantityLabel(rule)}
                          </td>
                          <td className="px-4 py-3">
                            <Badge tone={rule.is_required === false ? "amber" : "green"}>
                              {rule.is_required === false ? "No" : "Yes"}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <RuleActions
                              canDelete={canDelete}
                              canUpdate={canUpdate}
                              disableMoveDown={
                                reordering ||
                                sortedRules.findIndex((item) => item.id === rule.id) ===
                                  sortedRules.length - 1
                              }
                              disableMoveUp={
                                reordering ||
                                sortedRules.findIndex((item) => item.id === rule.id) === 0
                              }
                              onDelete={() => setDeleteTarget(rule)}
                              onEdit={() => openEditRuleForm(rule)}
                              onMoveDown={() => moveRule(rule, "down")}
                              onMoveUp={() => moveRule(rule, "up")}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="grid gap-3 xl:hidden">
                  {paginatedRules.map((rule) => (
                    <article
                      key={rule.id}
                      className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Display {rule.display_order}
                          </p>
                          <h3 className="mt-1 text-base font-semibold text-slate-950">
                            {rule.category?.name ?? "-"}
                          </h3>
                        </div>
                        <Badge tone={rule.is_required === false ? "amber" : "green"}>
                          {rule.is_required === false ? "Optional" : "Required"}
                        </Badge>
                      </div>
                      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                        <DetailText
                          label="Calculation Type"
                          value={bomCalculationTypeLabel(rule.calculation_type)}
                        />
                        <DetailText
                          label="Quantity Formula/Fixed Quantity"
                          value={bomTemplateRuleQuantityLabel(rule)}
                        />
                      </dl>
                      <div className="mt-4">
                        <RuleActions
                          canDelete={canDelete}
                          canUpdate={canUpdate}
                          disableMoveDown={
                            reordering ||
                            sortedRules.findIndex((item) => item.id === rule.id) ===
                              sortedRules.length - 1
                          }
                          disableMoveUp={
                            reordering ||
                            sortedRules.findIndex((item) => item.id === rule.id) === 0
                          }
                          onDelete={() => setDeleteTarget(rule)}
                          onEdit={() => openEditRuleForm(rule)}
                          onMoveDown={() => moveRule(rule, "down")}
                          onMoveUp={() => moveRule(rule, "up")}
                        />
                      </div>
                    </article>
                  ))}
                </div>
                <TablePagination label="BOM rules" pagination={rulePagination} />
              </>
            )}
          </section>
        </>
      ) : null}

      {ruleForm ? (
        <BomTemplateRuleFormModal
          title={ruleForm.mode === "create" ? "Add Rule" : "Edit Rule"}
          values={ruleForm.values}
          setValues={(values) => setRuleForm({ ...ruleForm, values })}
          categories={categories}
          errors={formErrors}
          onClose={() => setRuleForm(null)}
          onSubmit={handleRuleSubmit}
          saving={saving}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title="Delete BOM rule?"
          description={`This removes ${deleteTarget.category?.name ?? "this rule"} from ${template?.name ?? "the template"}.`}
          confirming={deleting}
          confirmLabel="Delete"
          confirmingLabel="Deleting..."
          confirmVariant="danger"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDeleteRule}
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

function RuleActions({
  canUpdate,
  canDelete,
  disableMoveUp,
  disableMoveDown,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  canUpdate: boolean;
  canDelete: boolean;
  disableMoveUp: boolean;
  disableMoveDown: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {canUpdate ? (
        <>
          <Button onClick={onEdit} variant="secondary">
            Edit
          </Button>
          <Button onClick={onMoveUp} variant="ghost" disabled={disableMoveUp}>
            Up
          </Button>
          <Button onClick={onMoveDown} variant="ghost" disabled={disableMoveDown}>
            Down
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

function DetailText({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function nextRuleDisplayOrder(rules: BomTemplateRule[]) {
  return (
    rules.reduce(
      (highest, rule) => Math.max(highest, Number(rule.display_order ?? 0)),
      0,
    ) + 1
  );
}

function hydrateRulesWithCategories(
  rules: BomTemplateRule[],
  categories: ProductCategory[],
) {
  const categoriesById = new Map(
    categories.map((category) => [category.id, category]),
  );

  return rules.map((rule) => ({
    ...rule,
    category: categoriesById.get(rule.product_category_id) ?? null,
  }));
}
