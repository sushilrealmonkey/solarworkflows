import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../../app/AuthProvider";
import { useToast } from "../../components/ui/ToastProvider";
import {
  AccessDenied,
  Button,
  Modal,
  SelectInput,
  TextArea,
  TextInput,
} from "../crm/CrmComponents";
import { hasPermission, labelize } from "../crm/crmUtils";
import type { Vendor, VendorCategory } from "../vendors/types";
import { emptyVendorForm } from "../vendors/vendorUtils";
import {
  createVendor,
  createVendorCategory,
  fetchVendorCategories,
} from "../vendors/vendorApi";
import {
  createExpense,
  createExpenseReceiptUrl,
  fetchExpenseProjects,
  fetchExpenses,
  fetchExpenseVendors,
  updateExpense,
} from "./expenseApi";
import { ExpenseListView } from "./ExpenseListView";
import {
  dueDateForVendor,
  emptyExpenseForm,
  expensePaymentMethods,
  expenseProjectLabel,
  expenseToForm,
  todayInputValue,
  validateExpenseForm,
  validateExpenseReceipt,
} from "./expenseUtils";
import type {
  ExpenseFormValues,
  ExpenseProjectOption,
  VendorExpenseWithRelations,
} from "./types";

type ExpenseFormState = {
  mode: "create" | "edit";
  expense: VendorExpenseWithRelations | null;
  values: ExpenseFormValues;
};

export function ExpensesPage() {
  const { profile, permissions, organization } = useAuth();
  const { showToast } = useToast();
  const [expenses, setExpenses] = useState<VendorExpenseWithRelations[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [categories, setCategories] = useState<VendorCategory[]>([]);
  const [projects, setProjects] = useState<ExpenseProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formState, setFormState] = useState<ExpenseFormState | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<File | null>(null);
  const [receiptError, setReceiptError] = useState("");
  const [saving, setSaving] = useState(false);

  const canView = hasPermission(profile, permissions, "expenses", "view");
  const canCreate = hasPermission(profile, permissions, "expenses", "create");
  const canUpdate = hasPermission(profile, permissions, "expenses", "update");
  const canCreateVendor = hasPermission(profile, permissions, "vendors", "create");

  async function loadData() {
    if (!canView) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [nextExpenses, nextVendors, nextCategories, nextProjects] =
        await Promise.all([
          fetchExpenses(profile),
          fetchExpenseVendors(profile),
          fetchVendorCategories(profile),
          fetchExpenseProjects(profile),
        ]);
      setExpenses(nextExpenses);
      setVendors(nextVendors);
      setCategories(nextCategories);
      setProjects(nextProjects);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Unable to load expenses.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // loadData closes over the current tenant and expense permission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, profile?.id]);

  if (!canView) {
    return (
      <AccessDenied
        title="Expenses are not available"
        description="Your role needs expenses:view access to open this module."
      />
    );
  }

  function openCreateForm() {
    setFormErrors({});
    setReceipt(null);
    setReceiptError("");
    setFormState({ mode: "create", expense: null, values: emptyExpenseForm() });
  }

  function openEditForm(expense: VendorExpenseWithRelations, markPaid = false) {
    const values = expenseToForm(expense);
    setFormErrors({});
    setReceipt(null);
    setReceiptError("");
    setFormState({
      mode: "edit",
      expense,
      values: markPaid
        ? {
            ...values,
            payment_status: "paid",
            paid_date: values.paid_date || todayInputValue(),
            payment_method:
              values.payment_method ||
              (expense.vendor?.preferred_payment_method as ExpenseFormValues["payment_method"]) ||
              "",
          }
        : values,
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formState) return;

    const nextErrors = validateExpenseForm(formState.values);
    const nextReceiptError = validateExpenseReceipt(receipt);
    setFormErrors(nextErrors);
    setReceiptError(nextReceiptError);
    if (Object.values(nextErrors).some(Boolean) || nextReceiptError) return;

    try {
      setSaving(true);
      if (formState.mode === "create") {
        await createExpense(profile, formState.values, receipt);
        showToast("Expense recorded.", "success");
      } else if (formState.expense) {
        await updateExpense(profile, formState.expense, formState.values, receipt);
        showToast("Expense updated.", "success");
      }
      setFormState(null);
      setReceipt(null);
      await loadData();
    } catch (value) {
      showToast(value instanceof Error ? value.message : "Expense save failed.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function viewReceipt(expense: VendorExpenseWithRelations) {
    if (!expense.receipt_file_path) return;
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;

    try {
      const signedUrl = await createExpenseReceiptUrl(expense.receipt_file_path);
      if (popup) popup.location.href = signedUrl;
      else window.location.assign(signedUrl);
    } catch (value) {
      popup?.close();
      showToast(value instanceof Error ? value.message : "Receipt could not be opened.", "error");
    }
  }

  return (
    <div className="space-y-6">
      <ExpenseListView
        canCreate={canCreate}
        canUpdate={canUpdate}
        categories={categories}
        currency={organization.currency}
        error={error}
        expenses={expenses}
        loading={loading}
        onAdd={openCreateForm}
        onEdit={(expense) => openEditForm(expense)}
        onMarkPaid={(expense) => openEditForm(expense, true)}
        onViewReceipt={(expense) => void viewReceipt(expense)}
        vendors={vendors}
      />

      {formState ? (
        <ExpenseFormModal
          title={formState.mode === "create" ? "Add Expense" : "Edit Expense"}
          values={formState.values}
          setValues={(values) =>
            setFormState((current) => (current ? { ...current, values } : current))
          }
          errors={formErrors}
          vendors={vendors}
          categories={categories}
          projects={projects}
          canCreateVendor={canCreateVendor}
          existingReceiptName={formState.expense?.receipt_file_name ?? null}
          receipt={receipt}
          receiptError={receiptError}
          onReceiptChange={(file) => {
            setReceipt(file);
            setReceiptError(validateExpenseReceipt(file));
          }}
          onClose={() => setFormState(null)}
          onSubmit={handleSubmit}
          saving={saving}
          onCreateCategory={async (name) => {
            const category = await createVendorCategory(profile, name);
            setCategories((current) =>
              [...current, category].sort((a, b) => a.name.localeCompare(b.name)),
            );
            return category;
          }}
          onCreateVendor={async (name, categoryId) => {
            const vendor = await createVendor(profile, {
              ...emptyVendorForm(),
              vendor_name: name.trim(),
              category_id: categoryId,
            });
            setVendors((current) =>
              [...current, vendor].sort((a, b) => a.vendor_name.localeCompare(b.vendor_name)),
            );
            return vendor;
          }}
        />
      ) : null}
    </div>
  );
}

function ExpenseFormModal({
  title,
  values,
  setValues,
  errors,
  vendors,
  categories,
  projects,
  canCreateVendor,
  existingReceiptName,
  receipt,
  receiptError,
  onReceiptChange,
  onClose,
  onSubmit,
  saving,
  onCreateCategory,
  onCreateVendor,
}: {
  title: string;
  values: ExpenseFormValues;
  setValues: (values: ExpenseFormValues) => void;
  errors: Record<string, string>;
  vendors: Vendor[];
  categories: VendorCategory[];
  projects: ExpenseProjectOption[];
  canCreateVendor: boolean;
  existingReceiptName: string | null;
  receipt: File | null;
  receiptError: string;
  onReceiptChange: (file: File | null) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
  onCreateCategory: (name: string) => Promise<VendorCategory>;
  onCreateVendor: (name: string, categoryId: string) => Promise<Vendor>;
}) {
  const [addingVendor, setAddingVendor] = useState(false);
  const [vendorName, setVendorName] = useState("");
  const [vendorSaving, setVendorSaving] = useState(false);
  const [vendorError, setVendorError] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categorySaving, setCategorySaving] = useState(false);
  const [categoryError, setCategoryError] = useState("");

  function selectVendor(vendorId: string) {
    const vendor = vendors.find((item) => item.id === vendorId);
    setValues({
      ...values,
      vendor_id: vendorId,
      category_id: vendor?.category_id ?? "",
      due_date: dueDateForVendor(values.expense_date, vendor),
      payment_method:
        values.payment_status === "paid"
          ? ((vendor?.preferred_payment_method as ExpenseFormValues["payment_method"]) ??
            values.payment_method)
          : values.payment_method,
    });
  }

  function selectNewVendor(vendor: Vendor) {
    setValues({
      ...values,
      vendor_id: vendor.id,
      category_id: vendor.category_id ?? values.category_id,
      due_date: dueDateForVendor(values.expense_date, vendor),
      payment_method:
        values.payment_status === "paid"
          ? ((vendor.preferred_payment_method as ExpenseFormValues["payment_method"]) ??
            values.payment_method)
          : values.payment_method,
    });
  }

  async function handleCreateCategory() {
    if (!categoryName.trim()) {
      setCategoryError("Enter a category name.");
      return;
    }

    try {
      setCategorySaving(true);
      setCategoryError("");
      const category = await onCreateCategory(categoryName);
      setValues({ ...values, category_id: category.id });
      setCategoryName("");
      setAddingCategory(false);
    } catch (error) {
      setCategoryError(error instanceof Error ? error.message : "Category could not be added.");
    } finally {
      setCategorySaving(false);
    }
  }

  async function handleCreateVendor() {
    if (!vendorName.trim()) {
      setVendorError("Enter a vendor name.");
      return;
    }
    if (!values.category_id) {
      setVendorError("Select or add an expense category first.");
      return;
    }

    try {
      setVendorSaving(true);
      setVendorError("");
      const vendor = await onCreateVendor(vendorName, values.category_id);
      selectNewVendor(vendor);
      setVendorName("");
      setAddingVendor(false);
    } catch (error) {
      setVendorError(error instanceof Error ? error.message : "Vendor could not be added.");
    } finally {
      setVendorSaving(false);
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel="Save Expense"
      submitting={saving}
      maxWidthClass="sm:max-w-4xl"
    >
      <div>
        <SelectInput
          label="Vendor"
          value={values.vendor_id}
          onChange={(vendorId) => {
            if (vendorId === "__add_vendor__") {
              setAddingVendor(true);
              return;
            }
            selectVendor(vendorId);
          }}
          options={[
            { value: "", label: "Select vendor" },
            ...vendors.map((vendor) => ({ value: vendor.id, label: vendor.vendor_name })),
            ...(canCreateVendor ? [{ value: "__add_vendor__", label: "+ Add new vendor" }] : []),
          ]}
        />
        {errors.vendor_id ? <p className="mt-1 text-xs text-rose-700">{errors.vendor_id}</p> : null}
        {addingVendor ? (
          <div className="mt-3 rounded-lg border border-orange-100 bg-orange-50 p-3">
            <TextInput
              label="New Vendor Name"
              value={vendorName}
              onChange={setVendorName}
              error={vendorError || undefined}
              required
            />
            <p className="mt-2 text-xs text-slate-600">
              The selected expense category will be assigned to this vendor.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => void handleCreateVendor()} disabled={vendorSaving}>
                {vendorSaving ? "Adding..." : "Add Vendor"}
              </Button>
              <Button
                onClick={() => {
                  setAddingVendor(false);
                  setVendorError("");
                }}
                variant="secondary"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      <div>
        <SelectInput
          label="Expense Category"
          value={values.category_id}
          onChange={(categoryId) => {
            if (categoryId === "__add_category__") {
              setAddingCategory(true);
              return;
            }
            setValues({ ...values, category_id: categoryId });
          }}
          options={[
            { value: "", label: "Select category" },
            ...categories
              .filter((category) => category.is_active || category.id === values.category_id)
              .map((category) => ({ value: category.id, label: category.name })),
            ...(canCreateVendor ? [{ value: "__add_category__", label: "+ Add new category" }] : []),
          ]}
        />
        {errors.category_id ? <p className="mt-1 text-xs text-rose-700">{errors.category_id}</p> : null}
        {addingCategory ? (
          <div className="mt-3 rounded-lg border border-orange-100 bg-orange-50 p-3">
            <TextInput
              label="New Category Name"
              value={categoryName}
              onChange={setCategoryName}
              error={categoryError || undefined}
              required
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={() => void handleCreateCategory()} disabled={categorySaving}>
                {categorySaving ? "Adding..." : "Add Category"}
              </Button>
              <Button
                onClick={() => {
                  setAddingCategory(false);
                  setCategoryError("");
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
        label="Amount"
        type="number"
        inputMode="decimal"
        min="0.01"
        step="0.01"
        value={values.amount}
        onChange={(amount) => setValues({ ...values, amount })}
        error={errors.amount}
        required
      />
      <TextInput
        label="Expense Date"
        type="date"
        value={values.expense_date}
        onChange={(expense_date) => setValues({ ...values, expense_date })}
        error={errors.expense_date}
        required
      />
      <SelectInput
        label="Payment Status"
        value={values.payment_status}
        onChange={(payment_status) =>
          setValues({
            ...values,
            payment_status: payment_status as ExpenseFormValues["payment_status"],
            paid_date: payment_status === "paid" ? values.paid_date || todayInputValue() : "",
            payment_method: payment_status === "paid" ? values.payment_method : "",
          })
        }
        options={[
          { value: "due", label: "Due" },
          { value: "paid", label: "Paid" },
        ]}
      />
      <TextInput
        label="Due Date"
        type="date"
        value={values.due_date}
        onChange={(due_date) => setValues({ ...values, due_date })}
        error={errors.due_date}
      />
      {values.payment_status === "paid" ? (
        <TextInput
          label="Paid Date"
          type="date"
          value={values.paid_date}
          onChange={(paid_date) => setValues({ ...values, paid_date })}
          error={errors.paid_date}
          required
        />
      ) : null}
      {values.payment_status === "paid" ? (
        <div>
          <SelectInput
            label="Payment Method"
            value={values.payment_method}
            onChange={(payment_method) =>
              setValues({
                ...values,
                payment_method: payment_method as ExpenseFormValues["payment_method"],
              })
            }
            options={[
              { value: "", label: "Select method" },
              ...expensePaymentMethods.map((method) => ({ value: method, label: labelize(method) })),
            ]}
          />
          {errors.payment_method ? <p className="mt-1 text-xs text-rose-700">{errors.payment_method}</p> : null}
        </div>
      ) : null}
      <TextInput
        label="Invoice / Bill Number"
        value={values.invoice_number}
        onChange={(invoice_number) => setValues({ ...values, invoice_number })}
      />
      <SelectInput
        label="Project / Site (Optional)"
        value={values.project_id}
        onChange={(project_id) => setValues({ ...values, project_id })}
        options={[
          { value: "", label: "General company expense" },
          ...projects.map((project) => ({ value: project.id, label: expenseProjectLabel(project) })),
        ]}
      />
      <div>
        <TextArea
          className="block"
          label="Purpose / Description"
          value={values.description}
          onChange={(description) => setValues({ ...values, description })}
        />
        {errors.description ? <p className="mt-1 text-xs text-rose-700">{errors.description}</p> : null}
      </div>
      <label className="block">
        <span className="text-sm font-medium text-slate-700">Receipt Upload</span>
        <input
          className="mt-1 block w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm"
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          onChange={(event) => onReceiptChange(event.target.files?.[0] ?? null)}
        />
        <p className="mt-1 text-xs text-slate-500">
          PDF, JPG, PNG, or WebP up to 10 MB.
          {existingReceiptName && !receipt ? ` Current: ${existingReceiptName}` : ""}
        </p>
        {receiptError ? <p className="mt-1 text-xs text-rose-700">{receiptError}</p> : null}
      </label>
    </Modal>
  );
}
