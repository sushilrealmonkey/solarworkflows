import type { FormEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Badge,
  Button,
  Modal,
  SelectInput,
  TextArea,
  TextInput,
} from "../crm/CrmComponents";
import { labelize } from "../crm/crmUtils";
import { formatMoney } from "../quotations/quotationUtils";
import {
  applyCustomerSnapshotToSaleForm,
  availableStockQuantity,
  draftLineTotal,
  emptyB2BSaleItem,
  inventoryItemLabel,
  inventoryItemToSaleItem,
  saleStatusTone,
} from "./b2bSalesUtils";
import type {
  B2BPaymentFormValues,
  B2BSaleFormItem,
  B2BSaleFormValues,
  B2BSaleOptions,
  B2BSaleWithRelations,
} from "./types";

export function B2BSaleStatusBadge({
  value,
}: {
  value: string | null | undefined;
}) {
  return <Badge tone={saleStatusTone(value)}>{labelize(value)}</Badge>;
}

export function B2BSaleTotalsCard({
  sale,
}: {
  sale: B2BSaleWithRelations;
}) {
  return (
    <aside className="xl:sticky xl:top-6 xl:self-start">
      <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Totals</h2>
        <dl className="mt-4 space-y-3 text-sm">
          <TotalRow label="Base Amount" value={sale.base_amount} />
          <TotalRow label="GST Amount" value={sale.gst_amount} />
          <div className="border-t border-stone-200 pt-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Total Amount
            </dt>
            <dd className="mt-1 text-2xl font-semibold text-slate-950">
              {formatMoney(sale.total_amount)}
            </dd>
          </div>
          <TotalRow label="Invoice Paid" value={sale.invoice?.amount_paid} />
          <TotalRow label="Invoice Balance" value={sale.invoice?.balance_due} />
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

export function B2BSaleFormModal({
  title,
  values,
  setValues,
  errors,
  options,
  canRemoveItems,
  onCreateBusinessCustomer,
  onClose,
  onSubmit,
  saving,
  submitLabel = "Save Sales Order",
}: {
  title: string;
  values: B2BSaleFormValues;
  setValues: (values: B2BSaleFormValues) => void;
  errors: Record<string, string>;
  options: B2BSaleOptions;
  canRemoveItems: boolean;
  onCreateBusinessCustomer?: () => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
  submitLabel?: string;
}) {
  const update = (key: keyof B2BSaleFormValues, value: string) =>
    setValues({ ...values, [key]: value });

  function setItems(items: B2BSaleFormItem[]) {
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
      submitLabel={submitLabel}
      submitting={saving}
      maxWidthClass="sm:max-w-5xl"
    >
      <div>
        <SelectInput
          label="Business Customer"
          value={values.customer_id}
          onChange={(customerId) => {
            const customer = options.customers.find(
              (option) => option.id === customerId,
            );
            setValues(
              customer
                ? applyCustomerSnapshotToSaleForm(values, customer, {
                    overwrite: true,
                  })
                : { ...values, customer_id: customerId },
            );
          }}
          options={[
            { value: "", label: "Select business customer" },
            ...options.customers.map((customer) => ({
              value: customer.id,
              label: [
                customer.customer_code ?? "Customer",
                customer.business_name || customer.full_name,
                customer.phone,
              ]
                .filter(Boolean)
                .join(" - "),
            })),
          ]}
        />
        {onCreateBusinessCustomer ? (
          <button
            className="mt-2 text-sm font-semibold text-[#06173f] hover:text-orange-700"
            onClick={onCreateBusinessCustomer}
            type="button"
          >
            Create new business customer
          </button>
        ) : null}
      </div>
      {errors.customer_id ? (
        <p className="-mt-3 text-xs text-rose-700">{errors.customer_id}</p>
      ) : null}
      <TextArea
        label="Billing Address"
        value={values.billing_address}
        onChange={(value) => update("billing_address", value)}
        className="block"
      />
      <TextArea
        label="Delivery Address"
        value={values.delivery_address}
        onChange={(value) => update("delivery_address", value)}
        className="block"
      />
      <TextInput
        label="GST Number"
        value={values.gst_number}
        onChange={(value) => update("gst_number", value)}
      />
      <TextInput
        label="Sale Date"
        value={values.sale_date}
        onChange={(value) => update("sale_date", value)}
        error={errors.sale_date}
        required
        type="date"
      />
      <TextArea
        label="Notes"
        value={values.notes}
        onChange={(value) => update("notes", value)}
      />

      <div className="md:col-span-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-950">Sale Items</h3>
          <Button
            onClick={() => setItems([...values.items, emptyB2BSaleItem()])}
            variant="secondary"
          >
            Add Item
          </Button>
        </div>
        <div className="mt-3 space-y-3">
          {values.items.map((item, index) => (
            <B2BSaleItemEditor
              key={index}
              index={index}
              item={item}
              inventoryItems={options.inventoryItems}
              errors={errors}
              canRemove={values.items.length > 1 && (canRemoveItems || !item.id)}
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
        <div className="mt-3 grid gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm sm:grid-cols-4">
          <DraftTotal label="Base" value={draftTotals.base} />
          <DraftTotal
            label="Discount"
            value={values.items.reduce(
              (total, item) => total + draftLineTotal(item).discount,
              0,
            )}
          />
          <DraftTotal label="GST" value={draftTotals.gst} />
          <DraftTotal label="Gross" value={draftTotals.gross} />
        </div>
      </div>
    </Modal>
  );
}

function B2BSaleItemEditor({
  index,
  item,
  inventoryItems,
  errors,
  canRemove,
  onChange,
  onRemove,
}: {
  index: number;
  item: B2BSaleFormItem;
  inventoryItems: B2BSaleOptions["inventoryItems"];
  errors: Record<string, string>;
  canRemove: boolean;
  onChange: (item: B2BSaleFormItem) => void;
  onRemove: () => void;
}) {
  const update = (key: keyof B2BSaleFormItem, value: string) =>
    onChange({ ...item, [key]: value });
  const selectedInventoryItem = inventoryItems.find(
    (option) => option.id === item.inventory_item_id,
  );
  const selectedAvailableQty = availableStockQuantity(selectedInventoryItem);
  const orderedQty = Number(item.quantity || 0);
  const unitLabel = item.unit || selectedInventoryItem?.unit || "units";
  const stockWarning =
    selectedAvailableQty !== null &&
    Number.isFinite(orderedQty) &&
    orderedQty > selectedAvailableQty
      ? `Only ${selectedAvailableQty} ${unitLabel} available. Ordered quantity is ${orderedQty}.`
      : "";
  const selectedLabel =
    selectedInventoryItem ? inventoryItemLabel(selectedInventoryItem) : item.item_name;
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
        <div>
          <SelectInput
            label="Inventory Item"
            value={item.inventory_item_id}
            onChange={(inventoryItemId) => {
              const nextInventoryItem = inventoryItems.find(
                (option) => option.id === inventoryItemId,
              );
              onChange(
                nextInventoryItem
                  ? inventoryItemToSaleItem(nextInventoryItem, item)
                  : { ...item, inventory_item_id: "", item_name: "" },
              );
            }}
            options={[
              { value: "", label: selectedLabel || "Select inventory item" },
              ...inventoryItems.map((option) => ({
                value: option.id,
                label: inventoryItemLabel(option),
              })),
            ]}
          />
          {selectedInventoryItem ? (
            <p className="mt-1 text-xs font-medium text-slate-600">
              Available stock: {selectedAvailableQty ?? 0} {unitLabel}
            </p>
          ) : null}
        </div>
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
        <TextInput
          label="Discount Amount"
          value={item.discount_amount}
          onChange={(value) => update("discount_amount", value)}
          error={errors[`items.${index}.discount_amount`]}
          type="number"
        />
        <TextInput
          label="GST Percent"
          value={item.gst_percent}
          onChange={(value) => update("gst_percent", value)}
          error={errors[`items.${index}.gst_percent`]}
          type="number"
        />
        <TextInput
          label="Description"
          value={item.description}
          onChange={(value) => update("description", value)}
        />
      </div>
      {stockWarning ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
          {stockWarning}
        </p>
      ) : null}
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

export function B2BSaleReviewModal({
  values,
  options,
  onEdit,
  onClose,
  onSaveDraft,
  onGenerateProforma,
  saving,
  generating,
}: {
  values: B2BSaleFormValues;
  options: B2BSaleOptions;
  onEdit: () => void;
  onClose: () => void;
  onSaveDraft: () => void;
  onGenerateProforma: () => void;
  saving: boolean;
  generating: boolean;
}) {
  const customer = options.customers.find(
    (option) => option.id === values.customer_id,
  );
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
  const itemDiscount = values.items.reduce(
    (total, item) => total + draftLineTotal(item).discount,
    0,
  );

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4">
      <section className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-stone-200 bg-white p-4 shadow-xl sm:max-w-5xl sm:rounded-xl sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-normal text-slate-950">
              Review Sales Order
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              {customer?.business_name || customer?.full_name || "Business customer"}
            </p>
          </div>
          <Button onClick={onClose} variant="ghost" disabled={saving || generating}>
            Close
          </Button>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <ReviewBlock title="Customer">
            <ReviewRow label="Customer" value={customer?.business_name || customer?.full_name || "-"} />
            <ReviewRow label="Phone" value={customer?.phone ?? "-"} />
            <ReviewRow label="GST" value={values.gst_number || "-"} />
            <ReviewRow label="Sale Date" value={values.sale_date || "-"} />
          </ReviewBlock>
          <ReviewBlock title="Addresses">
            <ReviewRow label="Billing" value={values.billing_address || "-"} />
            <ReviewRow label="Delivery" value={values.delivery_address || "-"} />
          </ReviewBlock>
        </div>

        <div className="mt-5 overflow-x-auto rounded-xl border border-stone-200">
          <table className="w-full min-w-[680px] border-collapse text-left text-sm">
            <thead className="bg-stone-50 text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">Qty</th>
                <th className="px-3 py-2">Unit Price</th>
                <th className="px-3 py-2">Discount</th>
                <th className="px-3 py-2">GST</th>
                <th className="px-3 py-2">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {values.items.map((item, index) => {
                const line = draftLineTotal(item);

                return (
                  <tr key={index}>
                    <td className="px-3 py-2 font-medium text-slate-950">
                      {item.item_name || "-"}
                    </td>
                    <td className="px-3 py-2">{item.quantity || "0"} {item.unit}</td>
                    <td className="px-3 py-2">{formatMoney(Number(item.unit_price || 0))}</td>
                    <td className="px-3 py-2">{formatMoney(line.discount)}</td>
                    <td className="px-3 py-2">{item.gst_percent || "0"}%</td>
                    <td className="px-3 py-2 font-semibold text-slate-950">
                      {formatMoney(line.gross)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 grid gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm sm:grid-cols-4">
          <DraftTotal label="Base" value={draftTotals.base} />
          <DraftTotal label="GST" value={draftTotals.gst} />
          <DraftTotal label="Discount" value={itemDiscount} />
          <DraftTotal label="Payable" value={draftTotals.gross} />
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button onClick={onEdit} variant="secondary" disabled={saving || generating}>
            Edit
          </Button>
          <Button onClick={onSaveDraft} variant="secondary" disabled={saving || generating}>
            {saving ? "Saving..." : "Save as Draft"}
          </Button>
          <Button onClick={onGenerateProforma} disabled={saving || generating}>
            {generating ? "Generating..." : "Generate Proforma Invoice"}
          </Button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function ReviewBlock({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-stone-200 p-3">
      <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
      <dl className="mt-3 space-y-2 text-sm">{children}</dl>
    </section>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-slate-500">{label}</dt>
      <dd className="mt-1 whitespace-pre-line font-medium text-slate-900">{value}</dd>
    </div>
  );
}

export function B2BPaymentFormModal({
  values,
  setValues,
  errors,
  onClose,
  onSubmit,
  saving,
}: {
  values: B2BPaymentFormValues;
  setValues: (values: B2BPaymentFormValues) => void;
  errors: Record<string, string>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  const update = (key: keyof B2BPaymentFormValues, value: string) =>
    setValues({ ...values, [key]: value });

  return (
    <Modal
      title="Add Business Payment"
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
        options={[
          { value: "cash", label: "Cash" },
          { value: "upi", label: "UPI" },
          { value: "bank_transfer", label: "Bank Transfer" },
          { value: "cheque", label: "Cheque" },
          { value: "other", label: "Other" },
        ]}
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
        options={[
          { value: "received", label: "Received" },
          { value: "failed", label: "Failed" },
          { value: "cancelled", label: "Cancelled" },
        ]}
      />
      <TextArea
        label="Notes"
        value={values.notes}
        onChange={(value) => update("notes", value)}
      />
    </Modal>
  );
}
