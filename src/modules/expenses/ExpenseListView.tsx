import { useMemo, useState } from "react";
import { TablePagination, useTablePagination } from "../../components/TablePagination";
import {
  Badge,
  Button,
  EmptyState,
  LoadingSkeleton,
  SearchInput,
  SelectInput,
  TextInput,
} from "../crm/CrmComponents";
import { formatDate, labelize } from "../crm/crmUtils";
import type { Vendor, VendorCategory } from "../vendors/types";
import {
  expenseProjectLabel,
  formatExpenseCurrency,
  todayInputValue,
} from "./expenseUtils";
import type { VendorExpenseWithRelations } from "./types";

type ExpenseFilters = {
  search: string;
  vendorId: string;
  categoryId: string;
  status: string;
  dateFrom: string;
  dateTo: string;
};

const defaultFilters: ExpenseFilters = {
  search: "",
  vendorId: "",
  categoryId: "",
  status: "",
  dateFrom: "",
  dateTo: "",
};

type ExpenseListViewProps = {
  expenses: VendorExpenseWithRelations[];
  vendors: Vendor[];
  categories: VendorCategory[];
  currency: string;
  loading: boolean;
  error: string | null;
  canCreate: boolean;
  canUpdate: boolean;
  onAdd: () => void;
  onEdit: (expense: VendorExpenseWithRelations) => void;
  onMarkPaid: (expense: VendorExpenseWithRelations) => void;
  onViewReceipt: (expense: VendorExpenseWithRelations) => void;
};

export function ExpenseListView({
  expenses,
  vendors,
  categories,
  currency,
  loading,
  error,
  canCreate,
  canUpdate,
  onAdd,
  onEdit,
  onMarkPaid,
  onViewReceipt,
}: ExpenseListViewProps) {
  const [filters, setFilters] = useState<ExpenseFilters>(defaultFilters);

  const filteredExpenses = useMemo(() => {
    const search = filters.search.trim().toLowerCase();

    return expenses.filter((expense) => {
      const matchesSearch =
        !search ||
        [
          expense.vendor?.vendor_name,
          expense.vendor?.vendor_code,
          expense.description,
          expense.invoice_number,
          expense.category?.name,
        ]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(search));
      const matchesStatus =
        !filters.status ||
        (filters.status === "overdue"
          ? expenseIsOverdue(expense)
          : expense.payment_status === filters.status);

      return (
        matchesSearch &&
        matchesStatus &&
        (!filters.vendorId || expense.vendor_id === filters.vendorId) &&
        (!filters.categoryId || expense.category_id === filters.categoryId) &&
        (!filters.dateFrom || expense.expense_date >= filters.dateFrom) &&
        (!filters.dateTo || expense.expense_date <= filters.dateTo)
      );
    });
  }, [expenses, filters]);

  const pagination = useTablePagination(filteredExpenses);
  const totals = useMemo(
    () =>
      expenses.reduce(
        (summary, expense) => {
          const amount = Number(expense.amount) || 0;
          summary.total += amount;
          if (expense.payment_status === "paid") summary.paid += amount;
          else summary.due += amount;
          return summary;
        },
        { total: 0, paid: 0, due: 0 },
      ),
    [expenses],
  );
  const statusCounts = useMemo(
    () => ({
      all: expenses.length,
      paid: expenses.filter((expense) => expense.payment_status === "paid").length,
      due: expenses.filter((expense) => expense.payment_status === "due").length,
      overdue: expenses.filter(expenseIsOverdue).length,
    }),
    [expenses],
  );
  const activeFilterCount = [
    filters.vendorId,
    filters.categoryId,
    filters.dateFrom,
    filters.dateTo,
  ].filter(Boolean).length;
  const paidPercent = totals.total > 0 ? Math.round((totals.paid / totals.total) * 100) : 0;

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-2xl border border-orange-100 bg-white p-5 shadow-sm sm:p-6">
        <div className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-orange-100/70 blur-2xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-600">
              Expense Management
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
              Expenses
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Record day-to-day vendor costs, follow outstanding payments, and keep bills linked to projects.
            </p>
          </div>
          {canCreate ? (
            <button
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-orange-600/20 transition hover:bg-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2 sm:w-auto"
              onClick={onAdd}
              type="button"
            >
              <ExpenseIcon id="plus" />
              Add Expense
            </button>
          ) : null}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          icon="wallet"
          label="Total expenses"
          value={formatExpenseCurrency(totals.total, currency)}
          detail={`${expenses.length} ${expenses.length === 1 ? "entry" : "entries"}`}
          tone="navy"
        />
        <SummaryCard
          icon="check"
          label="Paid"
          value={formatExpenseCurrency(totals.paid, currency)}
          detail={`${paidPercent}% of total settled`}
          tone="green"
        />
        <SummaryCard
          icon="clock"
          label="Outstanding"
          value={formatExpenseCurrency(totals.due, currency)}
          detail={`${statusCounts.due} due ${statusCounts.due === 1 ? "entry" : "entries"}`}
          tone="orange"
        />
        <SummaryCard
          icon="alert"
          label="Overdue"
          value={String(statusCounts.overdue)}
          detail="Needs payment follow-up"
          tone="red"
        />
      </section>

      <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
        <div className="border-b border-stone-100 p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <SearchInput
              className="block w-full lg:max-w-xl"
              label="Search expenses"
              placeholder="Vendor, purpose, or invoice"
              value={filters.search}
              onChange={(search) => setFilters((current) => ({ ...current, search }))}
            />
            <div className="flex items-center justify-between gap-3 lg:justify-end">
              <p className="text-sm text-slate-500">
                <span className="font-semibold text-slate-950">{filteredExpenses.length}</span> results
              </p>
              {activeFilterCount > 0 || filters.search ? (
                <button
                  className="rounded-lg px-3 py-2 text-sm font-semibold text-orange-700 transition hover:bg-orange-50"
                  onClick={() => setFilters(defaultFilters)}
                  type="button"
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          </div>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            <StatusFilter
              active={!filters.status}
              count={statusCounts.all}
              label="All"
              onClick={() => setFilters((current) => ({ ...current, status: "" }))}
            />
            <StatusFilter
              active={filters.status === "due"}
              count={statusCounts.due}
              label="Due"
              onClick={() => setFilters((current) => ({ ...current, status: "due" }))}
            />
            <StatusFilter
              active={filters.status === "paid"}
              count={statusCounts.paid}
              label="Paid"
              onClick={() => setFilters((current) => ({ ...current, status: "paid" }))}
            />
            <StatusFilter
              active={filters.status === "overdue"}
              count={statusCounts.overdue}
              label="Overdue"
              onClick={() => setFilters((current) => ({ ...current, status: "overdue" }))}
            />
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SelectInput
              label="Vendor"
              value={filters.vendorId}
              onChange={(vendorId) => setFilters((current) => ({ ...current, vendorId }))}
              options={[
                { value: "", label: "All vendors" },
                ...vendors.map((vendor) => ({ value: vendor.id, label: vendor.vendor_name })),
              ]}
            />
            <SelectInput
              label="Category"
              value={filters.categoryId}
              onChange={(categoryId) => setFilters((current) => ({ ...current, categoryId }))}
              options={[
                { value: "", label: "All categories" },
                ...categories.map((category) => ({ value: category.id, label: category.name })),
              ]}
            />
            <TextInput
              label="From date"
              type="date"
              value={filters.dateFrom}
              onChange={(dateFrom) => setFilters((current) => ({ ...current, dateFrom }))}
            />
            <TextInput
              label="To date"
              type="date"
              value={filters.dateTo}
              onChange={(dateTo) => setFilters((current) => ({ ...current, dateTo }))}
            />
          </div>
        </div>

        {loading ? <div className="p-4 sm:p-5"><LoadingSkeleton /></div> : null}
        {error ? (
          <div className="p-4 sm:p-5">
            <EmptyState title="Could not load expenses" description={error} />
          </div>
        ) : null}
        {!loading && !error && filteredExpenses.length === 0 ? (
          <div className="p-4 sm:p-6">
            <EmptyState
              title={expenses.length === 0 ? "No expenses recorded yet" : "No matching expenses"}
              description={
                expenses.length === 0
                  ? "Add the first vendor expense to start tracking paid amounts and outstanding dues."
                  : "Try clearing a filter or searching with another vendor or invoice."
              }
              action={expenses.length === 0 && canCreate ? <Button onClick={onAdd}>Add Expense</Button> : undefined}
            />
          </div>
        ) : null}

        {!loading && !error && filteredExpenses.length > 0 ? (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                  <tr>
                    <th className="px-5 py-3.5">Expense</th>
                    <th className="px-5 py-3.5">Vendor</th>
                    <th className="px-5 py-3.5">Category</th>
                    <th className="px-5 py-3.5">Date</th>
                    <th className="px-5 py-3.5">Payment</th>
                    <th className="px-5 py-3.5 text-right">Amount</th>
                    <th className="px-5 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {pagination.pageItems.map((expense) => (
                    <tr key={expense.id} className="group transition-colors hover:bg-orange-50/40">
                      <td className="max-w-72 px-5 py-4">
                        <p className="truncate font-semibold text-slate-950">{expense.description}</p>
                        <p className="mt-1 truncate text-xs text-slate-500">
                          {expense.invoice_number ? `Bill ${expense.invoice_number}` : "No bill number"}
                          {expense.project ? ` · ${expenseProjectLabel(expense.project)}` : ""}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#06173f] text-xs font-bold text-white">
                            {vendorInitials(expense.vendor?.vendor_name)}
                          </span>
                          <div className="min-w-0">
                            <p className="max-w-44 truncate font-semibold text-slate-800">{expense.vendor?.vendor_name ?? "Vendor"}</p>
                            <p className="text-xs text-slate-500">{expense.vendor?.vendor_code ?? "No vendor code"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-slate-600">{expense.category?.name ?? "Uncategorized"}</td>
                      <td className="whitespace-nowrap px-5 py-4">
                        <p className="font-medium text-slate-800">{formatDate(expense.expense_date)}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {expense.payment_status === "paid" ? "Paid" : "Due"} {formatDate(expense.payment_status === "paid" ? expense.paid_date : expense.due_date)}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <ExpenseStatusBadge expense={expense} />
                        <p className="mt-1.5 text-xs text-slate-500">{labelize(expense.payment_method)}</p>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-right text-base font-bold text-slate-950">
                        {formatExpenseCurrency(expense.amount, currency)}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-1">
                          {expense.receipt_file_path ? (
                            <ActionButton label="Receipt" onClick={() => onViewReceipt(expense)} />
                          ) : null}
                          {canUpdate && expense.payment_status === "due" ? (
                            <ActionButton emphasis label="Mark paid" onClick={() => onMarkPaid(expense)} />
                          ) : null}
                          {canUpdate ? <ActionButton label="Edit" onClick={() => onEdit(expense)} /> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-stone-100 lg:hidden">
              {pagination.pageItems.map((expense) => (
                <article key={expense.id} className="p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#06173f] text-xs font-bold text-white">
                        {vendorInitials(expense.vendor?.vendor_name)}
                      </span>
                      <div className="min-w-0">
                        <h2 className="truncate font-semibold text-slate-950">{expense.vendor?.vendor_name ?? "Vendor"}</h2>
                        <p className="mt-0.5 text-xs text-slate-500">{formatDate(expense.expense_date)} · {expense.category?.name ?? "Uncategorized"}</p>
                      </div>
                    </div>
                    <ExpenseStatusBadge expense={expense} />
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-700">{expense.description}</p>
                      <p className="mt-1 truncate text-xs text-slate-500">
                        {expense.invoice_number ? `Bill ${expense.invoice_number}` : "No bill number"}
                        {expense.project ? ` · ${expenseProjectLabel(expense.project)}` : ""}
                      </p>
                    </div>
                    <p className="shrink-0 text-lg font-bold text-slate-950">{formatExpenseCurrency(expense.amount, currency)}</p>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-sm">
                    <div>
                      <p className="text-xs text-slate-500">{expense.payment_status === "paid" ? "Paid on" : "Due on"}</p>
                      <p className="mt-1 font-semibold text-slate-800">{formatDate(expense.payment_status === "paid" ? expense.paid_date : expense.due_date)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Payment method</p>
                      <p className="mt-1 font-semibold text-slate-800">{labelize(expense.payment_method)}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {expense.receipt_file_path ? <Button onClick={() => onViewReceipt(expense)} variant="ghost">Receipt</Button> : null}
                    {canUpdate && expense.payment_status === "due" ? <Button onClick={() => onMarkPaid(expense)} variant="secondary">Mark Paid</Button> : null}
                    {canUpdate ? <Button onClick={() => onEdit(expense)} variant="secondary">Edit</Button> : null}
                  </div>
                </article>
              ))}
            </div>

            <div className="border-t border-stone-100 px-4 py-3 sm:px-5">
              <TablePagination label="expenses" pagination={pagination} />
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: "wallet" | "check" | "clock" | "alert";
  label: string;
  value: string;
  detail: string;
  tone: "navy" | "green" | "orange" | "red";
}) {
  const tones = {
    navy: "bg-[#06173f] text-white",
    green: "bg-emerald-100 text-emerald-700",
    orange: "bg-orange-100 text-orange-700",
    red: "bg-rose-100 text-rose-700",
  };

  return (
    <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
          <p className="mt-2 text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">{value}</p>
        </div>
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}>
          <ExpenseIcon id={icon} />
        </span>
      </div>
      <p className="mt-3 text-xs text-slate-500">{detail}</p>
    </article>
  );
}

function StatusFilter({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`inline-flex min-h-9 shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
        active
          ? "border-[#06173f] bg-[#06173f] text-white"
          : "border-stone-200 bg-white text-slate-600 hover:border-orange-200 hover:bg-orange-50"
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${active ? "bg-white/15" : "bg-stone-100 text-slate-500"}`}>{count}</span>
    </button>
  );
}

function ActionButton({
  label,
  onClick,
  emphasis = false,
}: {
  label: string;
  onClick: () => void;
  emphasis?: boolean;
}) {
  return (
    <button
      className={`rounded-lg px-2.5 py-2 text-xs font-semibold transition ${
        emphasis
          ? "bg-orange-50 text-orange-700 hover:bg-orange-100"
          : "text-slate-600 hover:bg-stone-100 hover:text-slate-950"
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function ExpenseStatusBadge({ expense }: { expense: VendorExpenseWithRelations }) {
  const overdue = expenseIsOverdue(expense);
  return (
    <Badge tone={expense.payment_status === "paid" ? "green" : overdue ? "red" : "amber"}>
      {overdue ? "Overdue" : labelize(expense.payment_status)}
    </Badge>
  );
}

function expenseIsOverdue(expense: VendorExpenseWithRelations) {
  return expense.payment_status === "due" && Boolean(expense.due_date && expense.due_date < todayInputValue());
}

function vendorInitials(name: string | null | undefined) {
  const parts = (name ?? "V")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "V";
}

function ExpenseIcon({ id }: { id: "plus" | "wallet" | "check" | "clock" | "alert" }) {
  const common = {
    className: "size-5",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.9,
    viewBox: "0 0 24 24",
  };

  if (id === "plus") {
    return <svg aria-hidden="true" {...common}><path d="M12 5v14M5 12h14" /></svg>;
  }
  if (id === "wallet") {
    return <svg aria-hidden="true" {...common}><path d="M4 7.5h15a1 1 0 0 1 1 1v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-11A1.5 1.5 0 0 1 5.5 5H17" /><path d="M15 12h5v4h-5a2 2 0 1 1 0-4Z" /></svg>;
  }
  if (id === "check") {
    return <svg aria-hidden="true" {...common}><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12 2.2 2.2 4.8-5" /></svg>;
  }
  if (id === "clock") {
    return <svg aria-hidden="true" {...common}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>;
  }
  return <svg aria-hidden="true" {...common}><path d="M10.6 4.3 3.4 17a1.4 1.4 0 0 0 1.2 2.1h14.8a1.4 1.4 0 0 0 1.2-2.1L13.4 4.3a1.6 1.6 0 0 0-2.8 0Z" /><path d="M12 9v4M12 16.5h.01" /></svg>;
}
