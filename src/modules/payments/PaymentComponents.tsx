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
import {
  paymentModeOptions,
  paymentSourceOptions,
  paymentStatusOptions,
  paymentStatusTone,
  projectPaymentLabel,
  sourceDefaultMode,
} from "./paymentUtils";
import type {
  PaymentFormValues,
  PaymentProjectOption,
  PaymentProjectSummary,
  PaymentSource,
  PaymentStatus,
} from "./types";

export function PaymentStatusBadge({
  value,
}: {
  value: string | null | undefined;
}) {
  return <Badge tone={paymentStatusTone(value)}>{labelize(value)}</Badge>;
}

export function PaymentSummaryCards({
  summary,
  className = "grid gap-3 sm:grid-cols-2 xl:grid-cols-3",
}: {
  summary: PaymentProjectSummary;
  className?: string;
}) {
  const cards = [
    {
      label: "Total Project Amount",
      value: formatMoney(summary.total_project_amount),
    },
    {
      label: "Subsidy Amount",
      value: formatMoney(summary.subsidy_amount),
    },
    {
      label: "Company Receivable",
      value: formatMoney(summary.company_receivable_amount),
    },
    {
      label: "Amount Received",
      value: formatMoney(summary.amount_received),
    },
    {
      label: "Balance Due",
      value: formatMoney(summary.balance_due),
    },
    {
      label: "Payment Status",
      value: <PaymentStatusBadge value={summary.payment_status} />,
    },
  ];

  return (
    <div className={className}>
      {cards.map((card) => (
        <article
          key={card.label}
          className="rounded-lg border border-stone-200 bg-stone-50 p-4"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {card.label}
          </p>
          <div className="mt-2 text-lg font-semibold tracking-normal text-slate-950">
            {card.value}
          </div>
        </article>
      ))}
    </div>
  );
}

export function PaymentFormModal({
  title,
  values,
  setValues,
  errors,
  projects,
  onClose,
  onSubmit,
  saving,
}: {
  title: string;
  values: PaymentFormValues;
  setValues: (values: PaymentFormValues) => void;
  errors: Record<string, string>;
  projects: PaymentProjectOption[];
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  const selectedProject = projects.find((project) => project.id === values.project_id);
  const selectedCustomerName =
    selectedProject?.customer?.full_name ??
    selectedProject?.customer?.customer_code ??
    "Select a project";
  const selectedQuotation =
    selectedProject?.quotation?.quotation_code ??
    (values.quotation_id ? "Linked quotation" : "No quotation linked");

  const update = (key: keyof PaymentFormValues, value: string) =>
    setValues({ ...values, [key]: value });

  function handleProjectChange(projectId: string) {
    const project = projects.find((option) => option.id === projectId);
    setValues({
      ...values,
      project_id: projectId,
      customer_id: project?.customer_id ?? "",
      quotation_id: project?.quotation_id ?? "",
    });
  }

  function handleSourceChange(source: PaymentSource) {
    setValues({
      ...values,
      payment_source: source,
      payment_mode: sourceDefaultMode(source),
    });
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel="Save Payment"
      submitting={saving}
    >
      <SelectInput
        label="Project"
        value={values.project_id}
        onChange={handleProjectChange}
        options={[
          { value: "", label: "Select project" },
          ...projects.map((project) => ({
            value: project.id,
            label: projectPaymentLabel(project),
          })),
        ]}
      />
      {errors.project_id ? (
        <p className="-mt-3 text-xs text-rose-700">{errors.project_id}</p>
      ) : null}
      <ReadOnlyField label="Customer" value={selectedCustomerName} />
      <ReadOnlyField label="Quotation" value={selectedQuotation} />
      <SelectInput
        label="Payment Source"
        value={values.payment_source}
        onChange={(value) => handleSourceChange(value as PaymentSource)}
        options={paymentSourceOptions.map((value) => ({
          value,
          label: labelize(value),
        }))}
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
      <TextInput
        label="Loan Account Number"
        value={values.loan_account_number}
        onChange={(value) => update("loan_account_number", value)}
      />
      <TextInput
        label="Receipt URL"
        value={values.receipt_url}
        onChange={(value) => update("receipt_url", value)}
      />
      <SelectInput
        label="Status"
        value={values.status}
        onChange={(value) => update("status", value as PaymentStatus)}
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

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm font-medium text-slate-700">{label}</p>
      <div className="mt-1 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5 text-sm font-medium text-slate-800">
        {value}
      </div>
    </div>
  );
}
