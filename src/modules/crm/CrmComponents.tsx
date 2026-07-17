import type { FormEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import type { StaffOption } from "./types";
import { labelize } from "./crmUtils";

type Option = {
  value: string;
  label: string;
};

export function AccessDenied({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm">
      <p className="text-sm font-semibold text-[#06173f]">Permission required</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-normal text-slate-950">
        {title}
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
        {description}
      </p>
    </section>
  );
}

export function Button({
  children,
  onClick,
  type = "button",
  variant = "primary",
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
}) {
  const variants = {
    primary: "border-orange-600 bg-orange-600 text-white hover:bg-orange-700",
    secondary: "border-stone-200 bg-white text-slate-700 hover:bg-stone-50",
    danger: "border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100",
    ghost: "border-transparent bg-transparent text-slate-600 hover:bg-stone-100",
  };

  return (
    <button
      className={`inline-flex min-h-10 items-center justify-center rounded-lg border px-3 py-2 text-sm font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]}`}
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  );
}

export function TextInput({
  label,
  value,
  onChange,
  error,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  type?: string;
  required?: boolean;
}) {
  function openTimePicker(input: HTMLInputElement) {
    if (type !== "time") {
      return;
    }

    try {
      input.showPicker?.();
    } catch {
      // Some browsers only allow showPicker from direct user interaction.
    }
  }

  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">
        {label}
        {required ? <span className="text-rose-600"> *</span> : null}
      </span>
      <input
        className={`mt-1 w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-orange-600 focus:ring-2 focus:ring-orange-100 ${
          error ? "border-rose-300" : "border-stone-200"
        }`}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onClick={(event) => openTimePicker(event.currentTarget)}
        onFocus={(event) => openTimePicker(event.currentTarget)}
      />
      {error ? <p className="mt-1 text-xs text-rose-700">{error}</p> : null}
    </label>
  );
}

export function SelectInput({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Option[];
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <select
        className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-orange-600 focus:ring-2 focus:ring-orange-100"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  className = "block md:col-span-2",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <label className={className}>
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <textarea
        className="mt-1 min-h-28 w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-orange-600 focus:ring-2 focus:ring-orange-100"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function StaffSelect({
  value,
  onChange,
  staff,
}: {
  value: string;
  onChange: (value: string) => void;
  staff: StaffOption[];
}) {
  return (
    <SelectInput
      label="Assigned To"
      value={value}
      onChange={onChange}
      options={[
        { value: "", label: "Unassigned" },
        ...staff.map((option) => ({
          value: option.id,
          label: option.full_name || option.email || option.phone || "Staff user",
        })),
      ]}
    />
  );
}

export function Modal({
  title,
  children,
  onClose,
  onSubmit,
  submitLabel,
  submitting,
  submitDisabled = false,
  hideSubmit = false,
  noValidate = false,
  maxWidthClass = "sm:max-w-3xl",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitLabel: string;
  submitting: boolean;
  submitDisabled?: boolean;
  hideSubmit?: boolean;
  noValidate?: boolean;
  maxWidthClass?: string;
}) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.stopPropagation();
    onSubmit(event);
  }

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4">
      <form
        className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-stone-200 bg-white p-4 shadow-xl sm:rounded-xl sm:p-6 ${maxWidthClass}`}
        noValidate={noValidate}
        onSubmit={handleSubmit}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-xl font-semibold tracking-normal text-slate-950">
            {title}
          </h2>
          <Button onClick={onClose} variant="ghost">
            Close
          </Button>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">{children}</div>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button onClick={onClose} variant="secondary" disabled={submitting}>
            Cancel
          </Button>
          {!hideSubmit ? (
            <Button type="submit" disabled={submitting || submitDisabled}>
              {submitting ? "Saving..." : submitLabel}
            </Button>
          ) : null}
        </div>
      </form>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  title,
  description,
  onCancel,
  onConfirm,
  confirming,
  confirmLabel = "Delete",
  confirmingLabel = "Deleting...",
  confirmVariant = "danger",
}: {
  title: string;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirming: boolean;
  confirmLabel?: string;
  confirmingLabel?: string;
  confirmVariant?: "primary" | "secondary" | "danger";
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <section className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button onClick={onCancel} variant="secondary" disabled={confirming}>
            Cancel
          </Button>
          <Button onClick={onConfirm} variant={confirmVariant} disabled={confirming}>
            {confirming ? confirmingLabel : confirmLabel}
          </Button>
        </div>
      </section>
    </div>
  );
}

export function AlertDialog({
  title,
  description,
  onClose,
  closeLabel = "OK",
}: {
  title: string;
  description: string;
  onClose: () => void;
  closeLabel?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <section className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-600">
          {description}
        </p>
        <div className="mt-5 flex justify-end">
          <Button onClick={onClose}>{closeLabel}</Button>
        </div>
      </section>
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "amber" | "red" | "blue";
}) {
  const tones = {
    neutral: "border-stone-200 bg-stone-50 text-slate-700",
    green: "border-emerald-200 bg-emerald-50 text-[#06173f]",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    red: "border-rose-200 bg-rose-50 text-rose-800",
    blue: "border-sky-200 bg-sky-50 text-sky-800",
  };

  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ value }: { value: string | null | undefined }) {
  const tone =
    value === "active" || value === "converted" || value === "qualified"
      ? "green"
      : value === "lost" || value === "inactive"
        ? "red"
        : value === "urgent" || value === "high"
          ? "amber"
          : value === "contacted" || value === "quotation_sent"
            ? "blue"
            : "neutral";

  return <Badge tone={tone}>{labelize(value)}</Badge>;
}

export function Toolbar({
  children,
  className = "md:grid-cols-4",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`grid gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm ${className}`}
    >
      {children}
    </section>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  label = "Search",
  className = "md:col-span-2",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label?: string;
  className?: string;
}) {
  return (
    <label className={className}>
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-orange-600 focus:ring-2 focus:ring-orange-100"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center">
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </section>
  );
}

export function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }, (_, index) => (
        <div
          key={index}
          className="h-20 animate-pulse rounded-xl border border-stone-200 bg-white"
        />
      ))}
    </div>
  );
}

export function DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-950">{title}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function DetailItem({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <div className="mt-1 text-sm font-medium text-slate-900">{value || "-"}</div>
    </div>
  );
}

export function PlaceholderAction({ children }: { children: ReactNode }) {
  return (
    <button
      className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-semibold text-slate-500"
      disabled
      type="button"
    >
      {children}
    </button>
  );
}

export function ViewLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      className="inline-flex min-h-9 items-center rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-stone-50"
      to={to}
    >
      {children}
    </Link>
  );
}

export function NextStepLabel() {
  return (
    <div className="flex items-center gap-2 text-base font-semibold text-slate-950">
      <ArrowRightIcon />
      <span>Next Step</span>
    </div>
  );
}

export function ArrowRightIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="M5 12h14"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="m13 6 6 6-6 6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

export function PencilIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path
        d="M4.5 19.5h4l10-10a2.1 2.1 0 0 0-3-3l-10 10-1 3Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
      />
      <path
        d="m14 8 2 2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
      />
    </svg>
  );
}
