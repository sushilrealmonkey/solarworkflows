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
import {
  TablePagination,
  useTablePagination,
} from "../../components/TablePagination";
import { useToast } from "../../components/ui/ToastProvider";
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
  createSupplier,
  fetchSuppliers,
  updateSupplier,
} from "./supplierApi";
import {
  emptySupplierForm,
  supplierStatusOptions,
  supplierToForm,
  validateSupplierForm,
} from "./supplierUtils";
import type {
  Supplier,
  SupplierFormValues,
  SupplierStatus,
} from "./types";

type SupplierFormState = {
  mode: "create" | "edit";
  supplier: Supplier | null;
  values: SupplierFormValues;
};

export function SuppliersPage() {
  const { profile, permissions } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [formState, setFormState] = useState<SupplierFormState | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const canView = hasPermission(profile, permissions, "vendors", "view");
  const canCreate = hasPermission(profile, permissions, "vendors", "create");
  const canUpdate = hasPermission(profile, permissions, "vendors", "update");

  async function loadSuppliers() {
    if (!canView) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setSuppliers(await fetchSuppliers(profile));
    } catch (value) {
      setError(value instanceof Error ? value.message : "Unable to load suppliers.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSuppliers();
    // loadSuppliers closes over the current tenant and permission state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, profile?.id]);

  const filteredSuppliers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return suppliers.filter((supplier) => {
      const matchesSearch =
        !term ||
        [
          supplier.supplier_code,
          supplier.supplier_name,
          supplier.contact_person,
          supplier.phone,
          supplier.gst_number,
        ]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(term));
      return matchesSearch && (!status || supplier.status === status);
    });
  }, [search, status, suppliers]);

  const pagination = useTablePagination(filteredSuppliers);

  if (!canView) {
    return (
      <AccessDenied
        title="Suppliers are not available"
        description="Your role needs supplier directory access to open this module."
      />
    );
  }

  function openCreate() {
    setFormErrors({});
    setFormState({ mode: "create", supplier: null, values: emptySupplierForm() });
  }

  function openEdit(supplier: Supplier) {
    setFormErrors({});
    setFormState({ mode: "edit", supplier, values: supplierToForm(supplier) });
  }

  function openDetail(id: string) {
    navigate(`/suppliers/${id}`);
  }

  function handleRowKeyDown(
    event: KeyboardEvent<HTMLTableRowElement | HTMLElement>,
    id: string,
  ) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDetail(id);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formState) return;

    const nextErrors = validateSupplierForm(formState.values);
    setFormErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;

    try {
      setSaving(true);
      if (formState.mode === "create") {
        await createSupplier(profile, formState.values);
        showToast("Supplier created.", "success");
      } else if (formState.supplier) {
        await updateSupplier(formState.supplier.id, formState.values);
        showToast("Supplier updated.", "success");
      }
      setFormState(null);
      await loadSuppliers();
    } catch (value) {
      showToast(value instanceof Error ? value.message : "Supplier save failed.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title="Suppliers"
          description="Manage procurement partners used in purchase orders and stock receipts."
        />
        {canCreate ? <Button onClick={openCreate}>Add Supplier</Button> : null}
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Suppliers" value={suppliers.length} />
        <MetricCard
          label="Active"
          value={suppliers.filter((supplier) => supplier.status === "active").length}
        />
        <MetricCard
          label="GST Registered"
          value={suppliers.filter((supplier) => supplier.gst_number).length}
        />
        <MetricCard
          label="Payment Terms Set"
          value={suppliers.filter((supplier) => supplier.payment_terms_days != null).length}
        />
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <SearchInput
          className="block"
          placeholder="Search supplier, contact, phone, or GST"
          value={search}
          onChange={setSearch}
        />
        <div className="mt-3 max-w-md">
          <SelectInput
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "", label: "All statuses" },
              ...supplierStatusOptions.map((value) => ({ value, label: labelize(value) })),
            ]}
          />
        </div>
      </section>

      {loading ? <LoadingSkeleton /> : null}
      {error ? <EmptyState title="Could not load suppliers" description={error} /> : null}
      {!loading && !error && filteredSuppliers.length === 0 ? (
        <EmptyState
          title="No suppliers found"
          description="Add a supplier to use it in purchase orders and stock receipts."
          action={canCreate ? <Button onClick={openCreate}>Add Supplier</Button> : null}
        />
      ) : null}

      {!loading && !error && filteredSuppliers.length > 0 ? (
        <>
          <div className="hidden rounded-xl border border-stone-200 bg-white shadow-sm xl:block">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-stone-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">GST</th>
                  <th className="px-4 py-3">Payment Terms</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {pagination.pageItems.map((supplier) => (
                  <tr
                    key={supplier.id}
                    className="cursor-pointer hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600"
                    onClick={() => openDetail(supplier.id)}
                    onKeyDown={(event) => handleRowKeyDown(event, supplier.id)}
                    role="link"
                    tabIndex={0}
                  >
                    <td className="px-4 py-3 font-semibold text-slate-950">
                      {supplier.supplier_code ?? "-"}
                    </td>
                    <td className="px-4 py-3">{supplier.supplier_name}</td>
                    <td className="px-4 py-3">{supplier.contact_person ?? "-"}</td>
                    <td className="px-4 py-3">{supplier.phone ?? "-"}</td>
                    <td className="px-4 py-3">{supplier.gst_number ?? "-"}</td>
                    <td className="px-4 py-3">
                      {supplier.payment_terms_days == null
                        ? "-"
                        : `${supplier.payment_terms_days} days`}
                    </td>
                    <td className="px-4 py-3">
                      <SupplierStatusBadge value={supplier.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 xl:hidden">
            {pagination.pageItems.map((supplier) => (
              <article
                key={supplier.id}
                className="cursor-pointer rounded-xl border border-stone-200 bg-white p-4 shadow-sm hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600"
                onClick={() => openDetail(supplier.id)}
                onKeyDown={(event) => handleRowKeyDown(event, supplier.id)}
                role="link"
                tabIndex={0}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {supplier.supplier_code ?? "Supplier"}
                    </p>
                    <h2 className="mt-1 text-base font-semibold text-slate-950">
                      {supplier.supplier_name}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      {supplier.contact_person ?? "No contact"} / {supplier.phone ?? "-"}
                    </p>
                  </div>
                  <SupplierStatusBadge value={supplier.status} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-xs text-slate-500">GST</dt><dd className="font-medium text-slate-900">{supplier.gst_number ?? "-"}</dd></div>
                  <div><dt className="text-xs text-slate-500">Terms</dt><dd className="font-medium text-slate-900">{supplier.payment_terms_days == null ? "-" : `${supplier.payment_terms_days} days`}</dd></div>
                  <div><dt className="text-xs text-slate-500">Email</dt><dd className="font-medium text-slate-900">{supplier.email ?? "-"}</dd></div>
                  <div><dt className="text-xs text-slate-500">City</dt><dd className="font-medium text-slate-900">{supplier.city ?? "-"}</dd></div>
                </dl>
                <div
                  className="mt-4 flex flex-wrap gap-2"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <Button onClick={() => openDetail(supplier.id)} variant="secondary">View</Button>
                  {canUpdate ? <Button onClick={() => openEdit(supplier)} variant="secondary">Edit</Button> : null}
                </div>
              </article>
            ))}
          </div>
          <TablePagination label="suppliers" pagination={pagination} />
        </>
      ) : null}

      {formState ? (
        <SupplierFormModal
          title={formState.mode === "create" ? "Add Supplier" : "Edit Supplier"}
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
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
    </section>
  );
}

export function SupplierFormModal({
  title,
  values,
  setValues,
  errors,
  onClose,
  onSubmit,
  saving,
}: {
  title: string;
  values: SupplierFormValues;
  setValues: (values: SupplierFormValues) => void;
  errors: Record<string, string>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  function update<Key extends keyof SupplierFormValues>(
    key: Key,
    value: SupplierFormValues[Key],
  ) {
    setValues({ ...values, [key]: value });
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel={saving ? "Saving..." : "Save Supplier"}
      submitting={saving}
      maxWidthClass="sm:max-w-4xl"
    >
      <TextInput label="Supplier Name" value={values.supplier_name} onChange={(value) => update("supplier_name", value)} error={errors.supplier_name} required />
      <TextInput label="Contact Person" value={values.contact_person} onChange={(value) => update("contact_person", value)} />
      <TextInput label="Mobile" value={values.phone} onChange={(value) => update("phone", value)} />
      <TextInput label="Email" value={values.email} onChange={(value) => update("email", value)} error={errors.email} type="email" />
      <TextInput label="GST Number" value={values.gst_number} onChange={(value) => update("gst_number", value)} />
      <TextInput label="PAN Number" value={values.pan_number} onChange={(value) => update("pan_number", value)} />
      <SelectInput label="Status" value={values.status} onChange={(value) => update("status", value as SupplierStatus)} options={supplierStatusOptions.map((value) => ({ value, label: labelize(value) }))} />
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
      <TextInput label="Payment Terms (Days)" value={values.payment_terms_days} onChange={(value) => update("payment_terms_days", value)} error={errors.payment_terms_days} type="number" min={0} max={365} step={1} />
      <TextInput label="City" value={values.city} onChange={(value) => update("city", value)} />
      <TextArea label="Full Address" value={values.address_line_1} onChange={(value) => update("address_line_1", value)} />
    </Modal>
  );
}

export function SupplierStatusBadge({ value }: { value: SupplierStatus }) {
  const tone = value === "active" ? "green" : value === "blacklisted" ? "red" : "neutral";
  return <Badge tone={tone}>{labelize(value)}</Badge>;
}
