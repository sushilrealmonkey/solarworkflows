import type { FormEvent } from "react";
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
          <TotalRow label="Discount" value={sale.discount_amount} />
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
  onClose,
  onSubmit,
  saving,
}: {
  title: string;
  values: B2BSaleFormValues;
  setValues: (values: B2BSaleFormValues) => void;
  errors: Record<string, string>;
  options: B2BSaleOptions;
  canRemoveItems: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
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
      submitLabel="Save B2B/Direct Sale"
      submitting={saving}
      maxWidthClass="sm:max-w-5xl"
    >
      <SelectInput
        label="B2B/Direct Customer"
        value={values.customer_id}
        onChange={(customer_id) => update("customer_id", customer_id)}
        options={[
          { value: "", label: "Select B2B/Direct customer" },
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
      {errors.customer_id ? (
        <p className="-mt-3 text-xs text-rose-700">{errors.customer_id}</p>
      ) : null}
      <TextInput
        label="Sale Date"
        value={values.sale_date}
        onChange={(value) => update("sale_date", value)}
        error={errors.sale_date}
        required
        type="date"
      />
      <TextInput
        label="Discount Amount"
        value={values.discount_amount}
        onChange={(value) => update("discount_amount", value)}
        error={errors.discount_amount}
        type="number"
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
        <div className="mt-3 grid gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm sm:grid-cols-3">
          <DraftTotal label="Base" value={draftTotals.base} />
          <DraftTotal label="GST" value={draftTotals.gst} />
          <DraftTotal
            label="Gross"
            value={Math.max(
              draftTotals.gross - Number(values.discount_amount || 0),
              0,
            )}
          />
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
      title="Add B2B/Direct Payment"
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
