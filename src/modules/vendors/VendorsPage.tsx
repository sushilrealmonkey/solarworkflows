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
import { useToast } from "../../components/ui/ToastProvider";
import {
  AccessDenied,
  Badge,
  Button,
  ConfirmDialog,
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
  createVendor,
  deleteVendor,
  fetchVendors,
  updateVendor,
} from "./vendorApi";
import {
  emptyVendorForm,
  validateVendorForm,
  vendorStatusOptions,
  vendorToForm,
  vendorTypeOptions,
} from "./vendorUtils";
import type { Vendor, VendorFormValues, VendorStatus } from "./types";

type VendorFilters = {
  search: string;
  type: string;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<VendorFilters>({
    search: "",
    type: "",
    status: "",
  });
  const [formState, setFormState] = useState<VendorFormState | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Vendor | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [openActionVendorId, setOpenActionVendorId] = useState<string | null>(
    null,
  );

  const canView = hasPermission(profile, permissions, "vendors", "view");
  const canCreate = hasPermission(profile, permissions, "vendors", "create");
  const canUpdate = hasPermission(profile, permissions, "vendors", "update");
  const canDelete = hasPermission(profile, permissions, "vendors", "delete");

  async function loadData() {
    if (!canView) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setVendors(await fetchVendors(profile));
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
  }, [canView, profile?.id]);

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
      const matchesType = !filters.type || vendor.vendor_type === filters.type;
      const matchesStatus = !filters.status || vendor.status === filters.status;

      return matchesSearch && matchesType && matchesStatus;
    });
  }, [vendors, filters]);

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

  async function confirmDelete() {
    if (!deleteTarget) {
      return;
    }

    try {
      setDeleting(true);
      await deleteVendor(deleteTarget.id);
      setVendors((current) =>
        current.filter((vendor) => vendor.id !== deleteTarget.id),
      );
      showToast("Vendor deleted.", "success");
      setDeleteTarget(null);
    } catch (nextError) {
      showToast(
        nextError instanceof Error ? nextError.message : "Vendor delete failed.",
        "error",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title="Vendors"
          description="Manage suppliers, installers, transporters, and service partners."
        />
        {canCreate ? <Button onClick={openCreateForm}>Add Vendor</Button> : null}
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <VendorMetricCard label="Total Vendors" value={vendors.length} />
        <VendorMetricCard
          label="Active"
          value={vendors.filter((vendor) => vendor.status === "active").length}
        />
        <VendorMetricCard
          label="Suppliers"
          value={
            vendors.filter((vendor) => vendor.vendor_type === "supplier").length
          }
        />
        <VendorMetricCard
          label="Contractors"
          value={
            vendors.filter((vendor) => vendor.vendor_type === "contractor").length
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
            label="Vendor Type"
            value={filters.type}
            onChange={(type) => setFilters((current) => ({ ...current, type }))}
            options={[
              { value: "", label: "All types" },
              ...vendorTypeOptions.map((value) => ({
                value,
                label: labelize(value),
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
          description="Add vendors to support purchasing and procurement tracking."
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
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="w-12 px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {filteredVendors.map((vendor) => (
                  <tr
                    key={vendor.id}
                    className="cursor-pointer hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
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
                    <td className="px-4 py-3">{labelize(vendor.vendor_type)}</td>
                    <td className="px-4 py-3">
                      <VendorStatusBadge value={vendor.status} />
                    </td>
                    <td
                      className="relative px-4 py-3 text-right"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <button
                        aria-label={`Actions for ${vendor.vendor_name}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-stone-200 bg-white text-lg font-semibold leading-none text-slate-600 shadow-sm hover:bg-stone-50"
                        onClick={() =>
                          setOpenActionVendorId((current) =>
                            current === vendor.id ? null : vendor.id,
                          )
                        }
                        type="button"
                      >
                        ⋮
                      </button>
                      {openActionVendorId === vendor.id ? (
                        <div className="absolute right-4 z-30 mt-2 w-36 rounded-lg border border-stone-200 bg-white p-1 text-left shadow-lg">
                          <button
                            className="block w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-stone-50"
                            onClick={() => {
                              setOpenActionVendorId(null);
                              openVendorDetail(vendor.id);
                            }}
                            type="button"
                          >
                            View
                          </button>
                          {canUpdate ? (
                          <button
                            className="block w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-stone-50"
                            onClick={() => {
                              setOpenActionVendorId(null);
                              openEditForm(vendor);
                            }}
                            type="button"
                          >
                            Edit
                          </button>
                        ) : null}
                          {canDelete ? (
                          <button
                            className="block w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-rose-700 hover:bg-rose-50"
                            onClick={() => {
                              setOpenActionVendorId(null);
                              setDeleteTarget(vendor);
                            }}
                            type="button"
                          >
                            Delete
                          </button>
                        ) : null}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 xl:hidden">
            {filteredVendors.map((vendor) => (
              <article
                key={vendor.id}
                className="cursor-pointer rounded-xl border border-stone-200 bg-white p-4 shadow-sm hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
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
                  <div
                    className="relative shrink-0"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <button
                      aria-label={`Actions for ${vendor.vendor_name}`}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-stone-200 bg-white text-lg font-semibold leading-none text-slate-600 shadow-sm hover:bg-stone-50"
                      onClick={() =>
                        setOpenActionVendorId((current) =>
                          current === vendor.id ? null : vendor.id,
                        )
                      }
                      type="button"
                    >
                      ⋮
                    </button>
                    {openActionVendorId === vendor.id ? (
                      <div className="absolute right-0 z-30 mt-2 w-36 rounded-lg border border-stone-200 bg-white p-1 text-left shadow-lg">
                        <button
                          className="block w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-stone-50"
                          onClick={() => {
                            setOpenActionVendorId(null);
                            openVendorDetail(vendor.id);
                          }}
                          type="button"
                        >
                          View
                        </button>
                        {canUpdate ? (
                          <button
                            className="block w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-stone-50"
                            onClick={() => {
                              setOpenActionVendorId(null);
                              openEditForm(vendor);
                            }}
                            type="button"
                          >
                            Edit
                          </button>
                        ) : null}
                        {canDelete ? (
                          <button
                            className="block w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-rose-700 hover:bg-rose-50"
                            onClick={() => {
                              setOpenActionVendorId(null);
                              setDeleteTarget(vendor);
                            }}
                            type="button"
                          >
                            Delete
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <VendorStatusBadge value={vendor.status} />
                  <Badge tone="blue">{labelize(vendor.vendor_type)}</Badge>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500">GST</dt>
                    <dd className="font-medium text-slate-900">
                      {vendor.gst_number ?? "-"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Type</dt>
                    <dd className="font-medium text-slate-900">
                      {labelize(vendor.vendor_type)}
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
              </article>
            ))}
          </div>
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
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title="Delete vendor?"
          description={`This will remove ${deleteTarget.vendor_name}. Vendors linked to purchase orders may be protected by the database.`}
          confirming={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
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
}: {
  title: string;
  values: VendorFormValues;
  setValues: (values: VendorFormValues) => void;
  errors: Record<string, string>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  const update = (key: keyof VendorFormValues, value: string) =>
    setValues({ ...values, [key]: value });

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
      />
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
        label="Vendor Type"
        value={values.vendor_type}
        onChange={(value) => update("vendor_type", value as VendorFormValues["vendor_type"])}
        options={vendorTypeOptions.map((value) => ({
          value,
          label: labelize(value),
        }))}
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

export function VendorStatusBadge({
  value,
}: {
  value: VendorStatus | null | undefined;
}) {
  const tone =
    value === "active" ? "green" : value === "blacklisted" ? "red" : "neutral";

  return <Badge tone={tone}>{labelize(value)}</Badge>;
}
