import type { FormEvent } from "react";
import {
  Badge,
  Modal,
  SelectInput,
  TextArea,
  TextInput,
} from "../crm/CrmComponents";
import { labelize } from "../crm/crmUtils";
import { formatMoney } from "../quotations/quotationUtils";
import { PaymentStatusBadge } from "../payments/PaymentComponents";
import {
  proformaInvoiceStatusTone,
  proformaPaymentModeOptions,
  proformaPaymentStatusOptions,
} from "./proformaInvoiceUtils";
import type {
  ProformaInvoiceWithRelations,
  ProformaPaymentFormValues,
} from "./types";

export function ProformaInvoiceStatusBadge({
  value,
}: {
  value: string | null | undefined;
}) {
  return <Badge tone={proformaInvoiceStatusTone(value)}>{labelize(value)}</Badge>;
}

export function ProformaInvoiceTotalsCard({
  proformaInvoice,
}: {
  proformaInvoice: ProformaInvoiceWithRelations;
}) {
  return (
    <aside className="xl:sticky xl:top-6 xl:self-start">
      <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Totals</h2>
        <dl className="mt-4 space-y-3 text-sm">
          <TotalRow label="Base Amount" value={proformaInvoice.base_amount} />
          <TotalRow label="GST Amount" value={proformaInvoice.gst_amount} />
          <TotalRow label="Discount" value={proformaInvoice.discount_amount} />
          <TotalRow label="Total Amount" value={proformaInvoice.total_amount} />
          <TotalRow label="Amount Paid" value={proformaInvoice.amount_paid} />
          <div className="border-t border-stone-200 pt-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Balance Due
            </dt>
            <dd className="mt-1 text-2xl font-semibold text-slate-950">
              {formatMoney(proformaInvoice.balance_due)}
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

export function ProformaPaymentFormModal({
  values,
  setValues,
  errors,
  onClose,
  onSubmit,
  saving,
}: {
  values: ProformaPaymentFormValues;
  setValues: (values: ProformaPaymentFormValues) => void;
  errors: Record<string, string>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  const update = (key: keyof ProformaPaymentFormValues, value: string) =>
    setValues({ ...values, [key]: value });

  return (
    <Modal
      title="Record Proforma Payment"
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
        options={proformaPaymentModeOptions.map((value) => ({
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
        options={proformaPaymentStatusOptions.map((value) => ({
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

export { PaymentStatusBadge };
