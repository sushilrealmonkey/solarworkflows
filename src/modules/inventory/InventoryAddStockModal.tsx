import { useMemo, type FormEvent } from "react";
import {
  Modal,
  SelectInput,
  TextArea,
  TextInput,
} from "../crm/CrmComponents";
import {
  availableStockNumber,
  formatStock,
  inventoryItemTitle,
} from "./inventoryUtils";
import type {
  InventoryAddStockFormValues,
  InventoryItem,
  InventoryMasterOption,
} from "./types";

export function InventoryAddStockModal({
  values,
  setValues,
  errors,
  items,
  vendors,
  canEditPricing,
  onClose,
  onSubmit,
  saving,
}: {
  values: InventoryAddStockFormValues;
  setValues: (values: InventoryAddStockFormValues) => void;
  errors: Record<string, string>;
  items: InventoryItem[];
  vendors: InventoryMasterOption[];
  canEditPricing: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  const selectedItem = items.find((item) => item.id === values.item_id);
  const selectableItems = useMemo(
    () =>
      items.filter(
        (item) =>
          item.status === "active" &&
          item.catalog_product?.status === "active" &&
          !item.archived_at,
      ),
    [items],
  );
  const update = (key: keyof InventoryAddStockFormValues, value: string) =>
    setValues({ ...values, [key]: value });

  const currentStock = Number(selectedItem?.current_stock ?? 0);
  const addedQuantity = Number(values.quantity);
  const hasValidQuantity = Number.isFinite(addedQuantity) && addedQuantity > 0;
  const nextStock = currentStock + (hasValidQuantity ? addedQuantity : 0);
  const nextAvailableStock = selectedItem
    ? availableStockNumber(selectedItem) +
      (hasValidQuantity ? addedQuantity : 0)
    : 0;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Modal
      title="Add Stock"
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel="Add Stock"
      submitting={saving}
      maxWidthClass="sm:max-w-2xl"
    >
      <section className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900 md:col-span-2">
        Use this for stock received without a Purchase Order. For PO-linked
        stock, use Material Received from the Purchases module.
      </section>

      <div>
        <SelectInput
          label="Product / Material"
          value={values.item_id}
          onChange={(value) => update("item_id", value)}
          options={[
            { value: "", label: "Select product or material" },
            ...selectableItems.map((item) => ({
              value: item.id,
              label: `${item.item_code ?? "Item"} - ${inventoryItemTitle(item) || item.item_name}`,
            })),
          ]}
        />
        {errors.item_id ? (
          <p className="mt-1 text-xs text-rose-700">{errors.item_id}</p>
        ) : null}
      </div>

      <TextInput
        label={`Quantity${selectedItem?.unit ? ` (${selectedItem.unit})` : ""}`}
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={values.quantity}
        onChange={(value) => update("quantity", value)}
        error={errors.quantity}
        required
      />
      <TextInput
        label="Received Date"
        type="date"
        value={values.stock_date}
        onChange={(value) => update("stock_date", value)}
        error={errors.stock_date}
        max={today}
        required
      />

      {selectedItem ? (
        <section className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm text-slate-700 md:col-span-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>
              Current physical stock: {formatStock(currentStock, selectedItem.unit)}
            </span>
            <span className="font-semibold text-slate-950">
              After addition: {formatStock(nextStock, selectedItem.unit)}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Available stock after addition: {formatStock(nextAvailableStock, selectedItem.unit)}
          </p>
        </section>
      ) : null}

      <section className="rounded-lg border border-stone-200 bg-stone-50 p-3 md:col-span-2">
        <h3 className="text-sm font-semibold text-slate-950">Optional details</h3>
        <p className="mt-1 text-xs text-slate-500">
          Supplier and bill details help keep the stock history traceable.
        </p>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <SelectInput
            label="Supplier"
            value={values.vendor_id}
            onChange={(value) => update("vendor_id", value)}
            options={[
              { value: "", label: "No supplier" },
              ...vendors.map((vendor) => ({
                value: vendor.id,
                label: vendor.name,
              })),
            ]}
          />
          <TextInput
            label="Bill / Invoice Number"
            value={values.bill_no}
            onChange={(value) => update("bill_no", value)}
          />
          {canEditPricing ? (
            <>
              <TextInput
                label="Unit Purchase Cost"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                value={values.unit_purchase_price}
                onChange={(value) => update("unit_purchase_price", value)}
                error={errors.unit_purchase_price}
              />
              <TextInput
                label="GST %"
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step="0.01"
                value={values.gst_percent}
                onChange={(value) => update("gst_percent", value)}
                error={errors.gst_percent}
              />
            </>
          ) : null}
          <TextArea
            label="Additional Notes"
            value={values.notes}
            onChange={(value) => update("notes", value)}
            className="block md:col-span-2"
          />
        </div>
      </section>
    </Modal>
  );
}
