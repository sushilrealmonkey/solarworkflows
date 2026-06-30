import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  Modal,
  SelectInput,
  TextArea,
  TextInput,
} from "../crm/CrmComponents";
import { labelize } from "../crm/crmUtils";
import {
  paymentModeOptions,
  paymentStatusOptions,
} from "../payments/paymentUtils";
import { formatMoney } from "../quotations/quotationUtils";
import {
  draftLineTotal,
  emptyInvoiceItemForm,
  inventoryItemToInvoiceItemForm,
  invoiceInventoryItemLabel,
  invoiceStatusTone,
  projectInvoiceLabel,
} from "./invoiceUtils";
import type {
  InvoiceFormValues,
  InvoiceCreationMode,
  InvoiceItemFormValues,
  InvoiceLinkOptions,
  InvoicePaymentFormValues,
  InvoiceWithRelations,
} from "./types";

export function InvoiceStatusBadge({
  value,
}: {
  value: string | null | undefined;
}) {
  return <Badge tone={invoiceStatusTone(value)}>{labelize(value)}</Badge>;
}

export function InvoiceTotalsCard({
  invoice,
}: {
  invoice: InvoiceWithRelations;
}) {
  return (
    <aside className="xl:sticky xl:top-6 xl:self-start">
      <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Totals</h2>
        <dl className="mt-4 space-y-3 text-sm">
          <TotalRow label="Base Amount" value={invoice.base_amount} />
          <TotalRow label="GST Amount" value={invoice.gst_amount} />
          <TotalRow label="Total Amount" value={invoice.total_amount} />
          <TotalRow label="Amount Paid" value={invoice.amount_paid} />
          <div className="border-t border-stone-200 pt-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Balance Due
            </dt>
            <dd className="mt-1 text-2xl font-semibold text-slate-950">
              {formatMoney(invoice.balance_due)}
            </dd>
          </div>
        </dl>
      </section>
    </aside>
  );
}

function TotalRow({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-slate-600">{label}</dt>
      <dd className="font-semibold text-slate-950">{formatMoney(value)}</dd>
    </div>
  );
}

export function InvoiceFormModal({
  title,
  values,
  setValues,
  errors,
  options,
  includeItems,
  creationMode,
  onCreationModeChange,
  duplicateProjectInvoice,
  canAddItems = true,
  canRemoveItems = true,
  onProjectChange,
  onClose,
  onSubmit,
  saving,
}: {
  title: string;
  values: InvoiceFormValues;
  setValues: (values: InvoiceFormValues) => void;
  errors: Record<string, string>;
  options: InvoiceLinkOptions;
  includeItems: boolean;
  creationMode?: InvoiceCreationMode;
  onCreationModeChange?: (mode: InvoiceCreationMode) => void;
  duplicateProjectInvoice?: InvoiceWithRelations | null;
  canAddItems?: boolean;
  canRemoveItems?: boolean;
  onProjectChange?: (projectId: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  const isCreateFlow = Boolean(onCreationModeChange);
  const activeCreationMode = creationMode ?? values.creation_mode;
  const isProjectMode = activeCreationMode === "project";
  const hideItemGstPercent = isCreateFlow && isProjectMode;
  const selectedProject = options.projects.find(
    (project) => project.id === values.project_id,
  );
  const availableQuotations = selectedProject?.quotation
    ? [selectedProject.quotation]
    : options.quotations.filter(
        (quotation) => quotation.customer_id === values.customer_id,
      );

  const update = (key: keyof InvoiceFormValues, value: string) =>
    setValues({ ...values, [key]: value });

  function handleProjectChange(projectId: string) {
    if (onProjectChange) {
      onProjectChange(projectId);
      return;
    }

    const project = options.projects.find((option) => option.id === projectId);
    setValues({
      ...values,
      project_id: projectId,
      customer_id: project?.customer_id ?? values.customer_id,
      quotation_id: project?.quotation_id ?? "",
      discount_amount: "",
    });
  }

  function handleCustomerChange(customerId: string) {
    setValues({
      ...values,
      customer_id: customerId,
      project_id: "",
      quotation_id: "",
    });
  }

  function setItems(items: InvoiceItemFormValues[]) {
    setValues({ ...values, items });
  }

  const draftTotals = values.items.reduce(
    (totals, item) => {
      const line = draftLineTotal(item);
      return {
        base: totals.base + line.base,
        gst: totals.gst + line.gst,
        gross: totals.gross + line.gross,
      };
    },
    { base: 0, gst: 0, gross: 0 },
  );

  return (
    <Modal
      title={title}
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel="Save Invoice"
      submitting={saving}
    >
      {isCreateFlow ? (
        <div className="md:col-span-2">
          <div className="grid gap-2 rounded-lg border border-stone-200 bg-stone-50 p-1 sm:grid-cols-2">
            <button
              className={`min-h-10 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                isProjectMode
                  ? "bg-white text-slate-950 shadow-sm"
                  : "text-slate-600 hover:bg-white"
              }`}
              onClick={() => onCreationModeChange?.("project")}
              type="button"
            >
              Project invoice
            </button>
            <button
              className={`min-h-10 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                !isProjectMode
                  ? "bg-white text-slate-950 shadow-sm"
                  : "text-slate-600 hover:bg-white"
              }`}
              onClick={() => onCreationModeChange?.("manual")}
              type="button"
            >
              Manual item invoice
            </button>
          </div>
        </div>
      ) : null}

      {isCreateFlow && isProjectMode ? (
        <>
          <div className="md:col-span-2">
            <SelectInput
              label="Project"
              value={values.project_id}
              onChange={handleProjectChange}
              options={[
                { value: "", label: "Select project" },
                ...options.projects.map((project) => ({
                  value: project.id,
                  label: projectInvoiceLabel(project),
                })),
              ]}
            />
            {errors.project_id ? (
              <p className="mt-1 text-xs text-rose-700">{errors.project_id}</p>
            ) : null}
          </div>
          {duplicateProjectInvoice ? (
            <div className="md:col-span-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              An active invoice already exists for this project:{" "}
              <Link
                className="font-semibold underline"
                to={`/invoices/${duplicateProjectInvoice.id}`}
              >
                {duplicateProjectInvoice.invoice_code ?? "open invoice"}
              </Link>
              .
            </div>
          ) : null}
          <InvoiceContextPreview
            label="Customer"
            value={
              selectedProject?.customer?.full_name ??
              selectedProject?.customer?.phone ??
              "Select a project"
            }
          />
          <InvoiceContextPreview
            label="Quotation"
            value={selectedProject?.quotation?.quotation_code ?? "No linked quotation"}
          />
        </>
      ) : null}

      {isCreateFlow && !isProjectMode ? (
        <>
          <SelectInput
            label="Customer"
            value={values.customer_id}
            onChange={handleCustomerChange}
            options={[
              { value: "", label: "Select customer" },
              ...options.customers.map((customer) => ({
                value: customer.id,
                label: `${customer.customer_code ?? "Customer"} - ${
                  customer.full_name ?? customer.phone ?? ""
                }`,
              })),
            ]}
          />
          {errors.customer_id ? (
            <p className="-mt-3 text-xs text-rose-700">{errors.customer_id}</p>
          ) : null}
        </>
      ) : null}

      {!isCreateFlow ? (
        <>
          <SelectInput
            label="Customer"
            value={values.customer_id}
            onChange={handleCustomerChange}
            options={[
              { value: "", label: "Select customer" },
              ...options.customers.map((customer) => ({
                value: customer.id,
                label: `${customer.customer_code ?? "Customer"} - ${
                  customer.full_name ?? customer.phone ?? ""
                }`,
              })),
            ]}
          />
          {errors.customer_id ? (
            <p className="-mt-3 text-xs text-rose-700">{errors.customer_id}</p>
          ) : null}
          <SelectInput
            label="Project"
            value={values.project_id}
            onChange={handleProjectChange}
            options={[
              { value: "", label: "No linked project" },
              ...options.projects.map((project) => ({
                value: project.id,
                label: projectInvoiceLabel(project),
              })),
            ]}
          />
          <SelectInput
            label="Quotation"
            value={values.quotation_id}
            onChange={(quotation_id) => update("quotation_id", quotation_id)}
            options={[
              { value: "", label: "No linked quotation" },
              ...availableQuotations.map((quotation) => ({
                value: quotation.id,
                label: quotation.quotation_code ?? "Quotation",
              })),
            ]}
          />
        </>
      ) : null}

      <TextInput
        label="Invoice Date"
        value={values.invoice_date}
        onChange={(value) => update("invoice_date", value)}
        error={errors.invoice_date}
        required
        type="date"
      />
      <TextInput
        label="Due Date"
        value={values.due_date}
        onChange={(value) => update("due_date", value)}
        type="date"
      />
      <TextArea
        label="Notes"
        value={values.notes}
        onChange={(value) => update("notes", value)}
      />

      {includeItems ? (
        <div className="md:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-950">Invoice Items</h3>
            {canAddItems ? (
              <Button
                onClick={() => setItems([...values.items, emptyInvoiceItemForm()])}
                variant="secondary"
              >
                Add Item
              </Button>
            ) : null}
          </div>
          <div className="mt-3 space-y-3">
            {values.items.map((item, index) => (
              <InvoiceItemEditor
                key={index}
                index={index}
                item={item}
                inventoryItems={options.inventoryItems}
                errors={errors}
                hideGstPercent={hideItemGstPercent}
                canRemove={
                  values.items.length > 1 && (canRemoveItems || !item.id)
                }
                onChange={(nextItem) =>
                  setItems(
                    values.items.map((current, itemIndex) =>
                      itemIndex === index ? nextItem : current,
                    ),
                  )
                }
                onRemove={() =>
                  setItems(values.items.filter((_, itemIndex) => itemIndex !== index))
                }
              />
            ))}
          </div>
          <div className="mt-3 grid gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm sm:grid-cols-3">
            <DraftTotal label="Base" value={draftTotals.base} />
            <DraftTotal label="GST Amount" value={draftTotals.gst} />
            <DraftTotal
              label="Gross"
              value={draftTotals.gross}
            />
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

export function InvoicePaymentFormModal({
  values,
  setValues,
  errors,
  onClose,
  onSubmit,
  saving,
}: {
  values: InvoicePaymentFormValues;
  setValues: (values: InvoicePaymentFormValues) => void;
  errors: Record<string, string>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  const update = (key: keyof InvoicePaymentFormValues, value: string) =>
    setValues({ ...values, [key]: value });

  return (
    <Modal
      title="Add Invoice Payment"
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel="Save Payment"
      submitting={saving}
    >
      <TextInput
        label="Amount"
        value={values.amount}
        onChange={(value) => update("amount", value)}
        error={errors.amount}
        required
        type="number"
      />
      <TextInput
        label="Payment Date"
        value={values.payment_date}
        onChange={(value) => update("payment_date", value)}
        error={errors.payment_date}
        required
        type="date"
      />
      <SelectInput
        label="Payment Mode"
        value={values.payment_mode}
        onChange={(value) => update("payment_mode", value)}
        options={paymentModeOptions.map((value) => ({
          value,
          label: labelize(value),
        }))}
      />
      <TextInput
        label="Reference Number"
        value={values.reference_number}
        onChange={(value) => update("reference_number", value)}
      />
      <TextInput
        label="Bank Name"
        value={values.bank_name}
        onChange={(value) => update("bank_name", value)}
      />
      <SelectInput
        label="Status"
        value={values.status}
        onChange={(value) => update("status", value)}
        options={paymentStatusOptions.map((value) => ({
          value,
          label: labelize(value),
        }))}
      />
      <TextArea
        label="Notes"
        value={values.notes}
        onChange={(value) => update("notes", value)}
      />
    </Modal>
  );
}

function InvoiceContextPreview({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function InvoiceItemEditor({
  index,
  item,
  inventoryItems,
  errors,
  hideGstPercent,
  canRemove,
  onChange,
  onRemove,
}: {
  index: number;
  item: InvoiceItemFormValues;
  inventoryItems: InvoiceLinkOptions["inventoryItems"];
  errors: Record<string, string>;
  hideGstPercent?: boolean;
  canRemove: boolean;
  onChange: (item: InvoiceItemFormValues) => void;
  onRemove: () => void;
}) {
  const update = (key: keyof InvoiceItemFormValues, value: string) =>
    onChange({ ...item, [key]: value });
  const selectedInventoryItem = inventoryItems.find(
    (option) => option.id === item.inventory_item_id,
  );
  const selectedItemLabel =
    selectedInventoryItem ? invoiceInventoryItemLabel(selectedInventoryItem) : item.item_name;
  const line = draftLineTotal(item);

  return (
    <section className="rounded-lg border border-stone-200 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Item {index + 1}
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-950">
            {formatMoney(line.gross)}
          </p>
        </div>
        {canRemove ? (
          <Button onClick={onRemove} variant="ghost">
            Remove
          </Button>
        ) : null}
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <SelectInput
          label="Inventory Item"
          value={item.inventory_item_id}
          onChange={(inventoryItemId) => {
            const nextInventoryItem = inventoryItems.find(
              (option) => option.id === inventoryItemId,
            );
            onChange(
              nextInventoryItem
                ? inventoryItemToInvoiceItemForm(nextInventoryItem, item)
                : { ...item, inventory_item_id: "", item_name: "" },
            );
          }}
          options={[
            {
              value: "",
              label: selectedItemLabel || "Select inventory item",
            },
            ...inventoryItems.map((option) => ({
              value: option.id,
              label: invoiceInventoryItemLabel(option),
            })),
          ]}
        />
        {errors[`items.${index}.inventory_item_id`] ? (
          <p className="-mt-2 text-xs text-rose-700">
            {errors[`items.${index}.inventory_item_id`]}
          </p>
        ) : null}
        <TextInput
          label="Quantity"
          value={item.quantity}
          onChange={(value) => update("quantity", value)}
          error={errors[`items.${index}.quantity`]}
          type="number"
        />
        <TextInput
          label="Unit"
          value={item.unit}
          onChange={(value) => update("unit", value)}
        />
        <TextInput
          label="Unit Price"
          value={item.unit_price}
          onChange={(value) => update("unit_price", value)}
          error={errors[`items.${index}.unit_price`]}
          type="number"
        />
        {hideGstPercent ? null : (
          <TextInput
            label="GST Percent"
            value={item.gst_percent}
            onChange={(value) => update("gst_percent", value)}
            error={errors[`items.${index}.gst_percent`]}
            type="number"
          />
        )}
        <TextInput
          label="Description"
          value={item.description}
          onChange={(value) => update("description", value)}
        />
      </div>
    </section>
  );
}

function DraftTotal({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 font-semibold text-slate-950">{formatMoney(value)}</p>
    </div>
  );
}
