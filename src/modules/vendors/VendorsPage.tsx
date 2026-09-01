import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { PageHeader } from "../../components/PageHeader";
import { TablePagination, useTablePagination } from "../../components/TablePagination";
import { useToast } from "../../components/ui/ToastProvider";
import { ArchiveScopeFilter } from "../lifecycle/ArchiveScopeFilter";
import type { ArchiveScope } from "../lifecycle/types";
import {
  AccessDenied,
  Badge,
  Button,
  EmptyState,
  LoadingSkeleton,
  Modal,
  SearchInput,
  SelectInput,
  TextArea,
  TextInput,
} from "../crm/CrmComponents";
import { hasPermission, labelize } from "../crm/crmUtils";
import {
  createVendorCategory,
  createVendor,
  fetchVendorCategories,
  fetchVendors,
  updateVendorCategory,
  updateVendor,
} from "./vendorApi";
import {
  emptyVendorForm,
  validateVendorForm,
  vendorStatusOptions,
  vendorToForm,
} from "./vendorUtils";
import type {
  Vendor,
  VendorCategory,
  VendorFormValues,
  VendorStatus,
} from "./types";

type VendorFilters = {
  search: string;
  category: string;
  status: string;
};

type VendorFormState = {
  mode: "create" | "edit";
  vendor: Vendor | null;
  values: VendorFormValues;
};

export function VendorsPage() {
  const { profile, permissions } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [categories, setCategories] = useState<VendorCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [archiveScope, setArchiveScope] = useState<ArchiveScope>("active");
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<VendorFilters>({
    search: "",
    category: "",
    status: "",
  });
  const [formState, setFormState] = useState<VendorFormState | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);

  const canView = hasPermission(profile, permissions, "vendors", "view");
  const canCreate = hasPermission(profile, permissions, "vendors", "create");
  const canUpdate = hasPermission(profile, permissions, "vendors", "update");

  async function loadData() {
    if (!canView) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [nextVendors, nextCategories] = await Promise.all([
        fetchVendors(profile, archiveScope),
        fetchVendorCategories(profile),
      ]);
      setVendors(nextVendors);
      setCategories(nextCategories);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Unable to load vendors.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // loadData closes over current permission/profile state for this module.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archiveScope, canView, profile?.id]);

  const filteredVendors = useMemo(() => {
    const search = filters.search.trim().toLowerCase();

    return vendors.filter((vendor) => {
      const matchesSearch =
        !search ||
        [
          vendor.vendor_code,
          vendor.vendor_name,
          vendor.contact_person,
          vendor.phone,
          vendor.gst_number,
        ]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(search));
      const matchesCategory =
        !filters.category || vendor.category_id === filters.category;
      const matchesStatus = !filters.status || vendor.status === filters.status;

      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [vendors, filters]);

  const vendorPagination = useTablePagination(filteredVendors);
  const paginatedVendors = vendorPagination.pageItems;

  if (!canView) {
    return (
      <AccessDenied
        title="Vendors are not available"
        description="Your role needs vendors:view access to open this module."
      />
    );
  }

  function openCreateForm() {
    setFormErrors({});
    setFormState({
      mode: "create",
      vendor: null,
      values: emptyVendorForm(),
    });
  }

  function openEditForm(vendor: Vendor) {
    setFormErrors({});
    setFormState({
      mode: "edit",
      vendor,
      values: vendorToForm(vendor),
    });
  }

  function openVendorDetail(vendorId: string) {
    navigate(`/vendors/${vendorId}`);
  }

  function handleVendorRowKeyDown(
    event: KeyboardEvent<HTMLTableRowElement | HTMLElement>,
    vendorId: string,
  ) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openVendorDetail(vendorId);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!formState) {
      return;
    }

    const nextErrors = validateVendorForm(formState.values);
    setFormErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      setSaving(true);
      if (formState.mode === "create") {
        await createVendor(profile, formState.values);
        showToast("Vendor created.", "success");
      } else if (formState.vendor) {
        await updateVendor(formState.vendor.id, formState.values);
        showToast("Vendor updated.", "success");
      }
      setFormState(null);
      await loadData();
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Vendor save failed.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title="Vendors"
          description="Manage day-to-day service partners, contractors, and expense payees."
        />
        <div className="flex flex-wrap gap-2">
          {canUpdate ? (
            <Button onClick={() => setCategoryManagerOpen(true)} variant="secondary">
              Manage Categories
            </Button>
          ) : null}
          {canCreate ? <Button onClick={openCreateForm}>Add Vendor</Button> : null}
        </div>
      </div>

      <ArchiveScopeFilter value={archiveScope} onChange={setArchiveScope} />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <VendorMetricCard
          label="Total Vendors"
          value={vendors.length}
        />
        <VendorMetricCard
          label="Active"
          value={vendors.filter((vendor) => vendor.status === "active").length}
        />
        <VendorMetricCard
          label="Categories"
          value={categories.filter((category) => category.is_active).length}
        />
        <VendorMetricCard
          label="Due Terms Set"
          value={
            vendors.filter((vendor) => vendor.payment_terms_days != null).length
          }
        />
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <SearchInput
          className="block"
          placeholder="Search vendor, contact, phone, or GST"
          value={filters.search}
          onChange={(search) => setFilters((current) => ({ ...current, search }))}
        />
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <SelectInput
            label="Vendor Category"
            value={filters.category}
            onChange={(category) =>
              setFilters((current) => ({ ...current, category }))
            }
            options={[
              { value: "", label: "All categories" },
              ...categories.map((category) => ({
                value: category.id,
                label: category.name,
              })),
            ]}
          />
          <SelectInput
            label="Status"
            value={filters.status}
            onChange={(status) => setFilters((current) => ({ ...current, status }))}
            options={[
              { value: "", label: "All statuses" },
              ...vendorStatusOptions.map((value) => ({
                value,
                label: labelize(value),
              })),
            ]}
          />
        </div>
      </section>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load vendors" description={error} /> : null}
      {!loading && !error && filteredVendors.length === 0 ? (
        <EmptyState
          title="No vendors found"
          description="Add vendors to start tracking day-to-day expenses and purchasing contacts."
          action={canCreate ? <Button onClick={openCreateForm}>Add Vendor</Button> : null}
        />
      ) : null}

      {!loading && !error && filteredVendors.length > 0 ? (
        <>
          <div className="hidden rounded-xl border border-stone-200 bg-white shadow-sm xl:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Vendor</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">GST</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {paginatedVendors.map((vendor) => (
                  <tr
                    key={vendor.id}
                    className="cursor-pointer hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600"
                    onClick={() => openVendorDetail(vendor.id)}
                    onKeyDown={(event) => handleVendorRowKeyDown(event, vendor.id)}
                    role="link"
                    tabIndex={0}
                  >
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {vendor.vendor_code ?? "-"}
                    </td>
                    <td className="px-4 py-3">{vendor.vendor_name}</td>
                    <td className="px-4 py-3">{vendor.contact_person ?? "-"}</td>
                    <td className="px-4 py-3">{vendor.phone ?? "-"}</td>
                    <td className="px-4 py-3">{vendor.gst_number ?? "-"}</td>
                    <td className="px-4 py-3">{vendor.category?.name ?? "-"}</td>
                    <td className="px-4 py-3">
                      <VendorStatusBadge value={vendor.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 xl:hidden">
            {paginatedVendors.map((vendor) => (
              <article
                key={vendor.id}
                className="cursor-pointer rounded-xl border border-stone-200 bg-white p-4 shadow-sm hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600"
                onClick={() => openVendorDetail(vendor.id)}
                onKeyDown={(event) => handleVendorRowKeyDown(event, vendor.id)}
                role="link"
                tabIndex={0}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {vendor.vendor_code ?? "Vendor"}
                    </p>
                    <h2 className="mt-1 text-base font-semibold text-slate-950">
                      {vendor.vendor_name}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      {vendor.contact_person ?? "No contact"} / {vendor.phone ?? "-"}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <VendorStatusBadge value={vendor.status} />
                  <Badge tone="blue">{vendor.category?.name ?? "Uncategorized"}</Badge>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500">GST</dt>
                    <dd className="font-medium text-slate-900">
                      {vendor.gst_number ?? "-"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Category</dt>
                    <dd className="font-medium text-slate-900">
                      {vendor.category?.name ?? "-"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Email</dt>
                    <dd className="font-medium text-slate-900">
                      {vendor.email ?? "-"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">City</dt>
                    <dd className="font-medium text-slate-900">
                      {vendor.city ?? "-"}
                    </dd>
                  </div>
                </dl>
                <div
                  className="mt-4 flex flex-wrap gap-2"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <Button
                    onClick={() => openVendorDetail(vendor.id)}
                    variant="secondary"
                  >
                    View
                  </Button>
                  {canUpdate ? (
                    <Button onClick={() => openEditForm(vendor)} variant="secondary">
                      Edit
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
          <TablePagination label="vendors" pagination={vendorPagination} />
        </>
      ) : null}

      {formState ? (
        <VendorFormModal
          title={formState.mode === "create" ? "Add Vendor" : "Edit Vendor"}
          values={formState.values}
          setValues={(values) =>
            setFormState((current) => (current ? { ...current, values } : current))
          }
          errors={formErrors}
          onClose={() => setFormState(null)}
          onSubmit={handleSubmit}
          saving={saving}
          categories={categories}
          onCreateCategory={async (name) => {
            const category = await createVendorCategory(profile, name);
            setCategories((current) =>
              [...current, category].sort((a, b) => a.name.localeCompare(b.name)),
            );
            return category;
          }}
        />
      ) : null}

      {categoryManagerOpen ? (
        <CategoryManagerModal
          categories={categories}
          onClose={() => setCategoryManagerOpen(false)}
          onCreate={async (name) => {
            const category = await createVendorCategory(profile, name);
            setCategories((current) =>
              [...current, category].sort((a, b) => a.name.localeCompare(b.name)),
            );
            showToast("Vendor category added.", "success");
          }}
          onUpdate={async (category, values) => {
            const updated = await updateVendorCategory(category.id, values);
            setCategories((current) =>
              current
                .map((item) => (item.id === updated.id ? updated : item))
                .sort((a, b) => a.name.localeCompare(b.name)),
            );
            showToast("Vendor category updated.", "success");
          }}
        />
      ) : null}

    </div>
  );
}

function VendorMetricCard({
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

export function VendorFormModal({
  title,
  values,
  setValues,
  errors,
  onClose,
  onSubmit,
  saving,
  categories,
  onCreateCategory,
}: {
  title: string;
  values: VendorFormValues;
  setValues: (values: VendorFormValues) => void;
  errors: Record<string, string>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
  categories: VendorCategory[];
  onCreateCategory: (name: string) => Promise<VendorCategory>;
}) {
  const [addingCategory, setAddingCategory] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categorySaving, setCategorySaving] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const update = (key: keyof VendorFormValues, value: string) =>
    setValues({ ...values, [key]: value });

  async function handleCreateCategory() {
    if (!categoryName.trim()) {
      setCategoryError("Enter a category name.");
      return;
    }

    try {
      setCategorySaving(true);
      setCategoryError(null);
      const category = await onCreateCategory(categoryName);
      update("category_id", category.id);
      setCategoryName("");
      setAddingCategory(false);
    } catch (error) {
      setCategoryError(
        error instanceof Error ? error.message : "Category could not be added.",
      );
    } finally {
      setCategorySaving(false);
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel="Save Vendor"
      submitting={saving}
    >
      <TextInput
        label="Vendor Name"
        value={values.vendor_name}
        onChange={(value) => update("vendor_name", value)}
        error={errors.vendor_name}
        required
      />
      <TextInput
        label="Contact Person"
        value={values.contact_person}
        onChange={(value) => update("contact_person", value)}
      />
      <TextInput
        label="Phone"
        value={values.phone}
        onChange={(value) => update("phone", value)}
      />
      <TextInput
        label="Alternate Phone"
        value={values.alternate_phone}
        onChange={(value) => update("alternate_phone", value)}
      />
      <TextInput
        label="Email"
        value={values.email}
        onChange={(value) => update("email", value)}
        error={errors.email}
        inputMode="email"
        type="email"
      />
      <div>
        <SelectInput
          label="Vendor Category"
          value={values.category_id}
          onChange={(value) => {
            if (value === "__add_category__") {
              setAddingCategory(true);
              return;
            }
            update("category_id", value);
          }}
          options={[
            { value: "", label: "Select category" },
            ...categories
              .filter(
                (category) => category.is_active || category.id === values.category_id,
              )
              .map((category) => ({ value: category.id, label: category.name })),
            { value: "__add_category__", label: "+ Add new category" },
          ]}
        />
        {errors.category_id ? (
          <p className="mt-1 text-xs text-rose-700">{errors.category_id}</p>
        ) : null}
        {addingCategory ? (
          <div className="mt-3 rounded-lg border border-orange-100 bg-orange-50 p-3">
            <TextInput
              label="New Category Name"
              value={categoryName}
              onChange={setCategoryName}
              error={categoryError ?? undefined}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => void handleCreateCategory()} disabled={categorySaving}>
                {categorySaving ? "Adding..." : "Add Category"}
              </Button>
              <Button
                onClick={() => {
                  setAddingCategory(false);
                  setCategoryError(null);
                }}
                variant="secondary"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      <TextInput
        label="GST Number"
        value={values.gst_number}
        onChange={(value) => update("gst_number", value)}
      />
      <TextInput
        label="PAN Number"
        value={values.pan_number}
        onChange={(value) => update("pan_number", value)}
      />
      <SelectInput
        label="Status"
        value={values.status}
        onChange={(value) => update("status", value as VendorFormValues["status"])}
        options={vendorStatusOptions.map((value) => ({
          value,
          label: labelize(value),
        }))}
      />
      <SelectInput
        label="Preferred Payment Method"
        value={values.preferred_payment_method}
        onChange={(value) => update("preferred_payment_method", value)}
        options={[
          { value: "", label: "Not specified" },
          { value: "cash", label: "Cash" },
          { value: "upi", label: "UPI" },
          { value: "bank_transfer", label: "Bank Transfer" },
          { value: "cheque", label: "Cheque" },
          { value: "card", label: "Card" },
          { value: "other", label: "Other" },
        ]}
      />
      <TextInput
        label="Payment Terms (Days)"
        value={values.payment_terms_days}
        onChange={(value) => update("payment_terms_days", value)}
        error={errors.payment_terms_days}
        type="number"
        min={0}
        max={365}
        step={1}
      />
      <TextInput
        label="City"
        value={values.city}
        onChange={(value) => update("city", value)}
      />
      <TextInput
        label="District"
        value={values.district}
        onChange={(value) => update("district", value)}
      />
      <TextInput
        label="State"
        value={values.state}
        onChange={(value) => update("state", value)}
      />
      <TextInput
        label="Pincode"
        value={values.pincode}
        onChange={(value) => update("pincode", value)}
      />
      <TextArea
        label="Address Line 1"
        value={values.address_line_1}
        onChange={(value) => update("address_line_1", value)}
      />
      <TextArea
        label="Address Line 2"
        value={values.address_line_2}
        onChange={(value) => update("address_line_2", value)}
      />
      <TextArea
        label="Notes"
        value={values.notes}
        onChange={(value) => update("notes", value)}
      />
    </Modal>
  );
}

function CategoryManagerModal({
  categories,
  onClose,
  onCreate,
  onUpdate,
}: {
  categories: VendorCategory[];
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
  onUpdate: (
    category: VendorCategory,
    values: { name: string; is_active: boolean },
  ) => Promise<void>;
}) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function createCategory() {
    if (!newName.trim()) {
      setError("Enter a category name.");
      return;
    }
    try {
      setBusyId("new");
      setError(null);
      await onCreate(newName);
      setNewName("");
    } catch (value) {
      setError(value instanceof Error ? value.message : "Category could not be added.");
    } finally {
      setBusyId(null);
    }
  }

  async function saveCategory(category: VendorCategory, isActive = category.is_active) {
    const nextName = editingId === category.id ? editingName : category.name;
    if (!nextName.trim()) {
      setError("Category name is required.");
      return;
    }
    try {
      setBusyId(category.id);
      setError(null);
      await onUpdate(category, { name: nextName, is_active: isActive });
      setEditingId(null);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Category could not be updated.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal
      title="Manage Vendor Categories"
      onClose={onClose}
      onSubmit={(event) => event.preventDefault()}
      submitLabel="Done"
      submitting={false}
      hideSubmit
      maxWidthClass="sm:max-w-2xl"
    >
      <div className="md:col-span-2 rounded-lg border border-stone-200 bg-stone-50 p-4">
        <TextInput label="New Category" value={newName} onChange={setNewName} />
        <div className="mt-3">
          <Button onClick={() => void createCategory()} disabled={busyId === "new"}>
            {busyId === "new" ? "Adding..." : "Add Category"}
          </Button>
        </div>
      </div>
      {error ? (
        <p className="md:col-span-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      <div className="md:col-span-2 divide-y divide-stone-100 rounded-lg border border-stone-200">
        {categories.map((category) => (
          <div key={category.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              {editingId === category.id ? (
                <TextInput label="Category Name" value={editingName} onChange={setEditingName} />
              ) : (
                <div>
                  <p className="font-medium text-slate-950">{category.name}</p>
                  <p className="text-xs text-slate-500">
                    {category.is_active ? "Available in forms" : "Inactive"}
                  </p>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {editingId === category.id ? (
                <>
                  <Button
                    onClick={() => void saveCategory(category)}
                    disabled={busyId === category.id}
                  >
                    Save
                  </Button>
                  <Button onClick={() => setEditingId(null)} variant="secondary">
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    onClick={() => {
                      setEditingId(category.id);
                      setEditingName(category.name);
                    }}
                    variant="secondary"
                  >
                    Rename
                  </Button>
                  <Button
                    onClick={() => void saveCategory(category, !category.is_active)}
                    variant="secondary"
                    disabled={busyId === category.id}
                  >
                    {category.is_active ? "Deactivate" : "Activate"}
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function VendorStatusBadge({
  value,
}: {
  value: VendorStatus | null | undefined;
}) {
  const tone =
    value === "active" ? "green" : value === "blacklisted" ? "red" : "neutral";

  return <Badge tone={tone}>{labelize(value)}</Badge>;
}
