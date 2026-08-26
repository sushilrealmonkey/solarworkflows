import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import { useToast } from "../../components/ui/ToastProvider";
import { Button } from "../crm/CrmComponents";
import { labelize } from "../crm/crmUtils";
import {
  createProductForOrganization,
  fetchProductCategoriesForOrganization,
} from "./productMasterApi";
import { productUnitOptions } from "./productMasterUtils";
import type {
  ProductCategory,
  ProductFormValues,
} from "./types";
import {
  buildProductImportTemplateCsv,
  importProductRows,
  parseProductImportFile,
  PRODUCT_IMPORT_ACCEPT,
  PRODUCT_IMPORT_TEMPLATE_FILENAME,
  productImportRowStatus,
  removeProductImportRow,
  updateProductImportRowValue,
  type ProductImportRow,
} from "../onboarding/onboardingProductImport";

type ImportProgress = { completed: number; total: number } | null;

export function ProductImportPanel({
  organizationId,
  onClose,
  onImported,
  workspaceLabel = "EPC workspace",
}: {
  organizationId: string;
  onClose: () => void;
  onImported?: () => void | Promise<void>;
  workspaceLabel?: string;
}) {
  const { showToast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<ProductImportRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadCategories() {
      try {
        setLoading(true);
        setLoadError(null);
        const nextCategories = await fetchProductCategoriesForOrganization(
          organizationId,
        );
        if (!active) return;
        setCategories(
          nextCategories.filter((category) => category.is_active !== false),
        );
      } catch (nextError) {
        if (active) {
          setLoadError(
            messageOf(nextError, "Product categories could not be loaded."),
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadCategories();
    return () => {
      active = false;
    };
  }, [organizationId]);

  const busy = parsing || submitting;
  const importedCount = rows.filter((row) => row.status === "imported").length;
  const readyCount = rows.filter(
    (row) =>
      row.status !== "imported" &&
      Object.values(row.errors).every((message) => !message),
  ).length;
  const attentionCount = rows.length - importedCount - readyCount;
  const hasImportedRows = importedCount > 0;

  async function readFile(file: File | null) {
    if (!file || busy || hasImportedRows) return;

    try {
      setParsing(true);
      setRows([]);
      setFileName(file.name);
      setError(null);
      setSummary(null);
      setRows(await parseProductImportFile(file, categories));
    } catch (nextError) {
      setFileName(null);
      setError(messageOf(nextError, "This product list could not be read."));
    } finally {
      setParsing(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    void readFile(event.target.files?.[0] ?? null);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
    void readFile(event.dataTransfer.files?.[0] ?? null);
  }

  function updateRow(id: string, key: keyof ProductFormValues, value: string) {
    if (busy) return;
    setRows((current) =>
      current.map((row) =>
        row.id === id
          ? updateProductImportRowValue(row, key, value, categories)
          : row,
      ),
    );
    setError(null);
    setSummary(null);
  }

  function removeRow(id: string) {
    if (busy) return;
    setRows((current) => removeProductImportRow(current, id));
    setError(null);
    setSummary(null);
  }

  function downloadTemplate() {
    const blob = new Blob([buildProductImportTemplateCsv()], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = PRODUCT_IMPORT_TEMPLATE_FILENAME;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function submitProducts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || rows.length === 0) return;

    try {
      setSubmitting(true);
      setError(null);
      setSummary(null);
      setProgress({
        completed: 0,
        total: rows.filter((row) => row.status !== "imported").length,
      });

      const result = await importProductRows(
        rows,
        categories,
        (values) => createProductForOrganization(organizationId, values),
        setRows,
        (completed, total) => setProgress({ completed, total }),
      );
      setRows(result.rows);

      if (result.validationBlocked) {
        setError("Check the products marked Needs attention before importing.");
      } else if (result.failedCount > 0) {
        setSummary(
          `${result.importedCount} product${result.importedCount === 1 ? "" : "s"} imported · ${result.failedCount} need attention.`,
        );
        setError("Review the failed rows, correct them, and retry.");
      } else if (result.allImported) {
        setSummary(
          `${result.importedCount} product${result.importedCount === 1 ? "" : "s"} added to this ${workspaceLabel}.`,
        );
        showToast("Product catalog imported.", "success");
        await onImported?.();
      }
    } catch (nextError) {
      setError(messageOf(nextError, "Products could not be imported."));
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  }

  return (
    <section className="mt-4 rounded-xl border border-orange-200 bg-orange-50/40 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-950">
            Upload product list
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
            Upload a CSV or XLSX file, review the rows, and add them to this {workspaceLabel}.
            Existing product categories are used to validate the file.
          </p>
        </div>
        <button
          className="self-start text-sm font-semibold text-slate-600 underline underline-offset-4 hover:text-slate-950"
          onClick={onClose}
          type="button"
        >
          Close
        </button>
      </div>

      {loading ? (
        <p className="mt-4 rounded-lg border border-stone-200 bg-white p-4 text-sm text-slate-600">
          Loading {workspaceLabel} product categories...
        </p>
      ) : loadError ? (
        <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {loadError}
        </p>
      ) : categories.length === 0 ? (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          This {workspaceLabel} has no active product categories. Add a category
          in the workspace before importing products.
        </p>
      ) : rows.length === 0 ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <p className="font-semibold text-slate-950">Use the import template</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Required columns are Category and Unit, plus at least one of Brand,
              Model / Product, or Specification.
            </p>
            <div className="mt-4">
              <Button onClick={downloadTemplate} variant="secondary">
                Download CSV template
              </Button>
            </div>
          </div>
          <label
            className={`flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-5 text-center transition ${
              dragActive
                ? "border-orange-500 bg-orange-100"
                : "border-orange-200 bg-white hover:border-orange-400"
            } ${busy ? "cursor-not-allowed opacity-60" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              if (!busy) setDragActive(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
          >
            <input
              accept={PRODUCT_IMPORT_ACCEPT}
              className="sr-only"
              disabled={busy}
              onChange={onFileChange}
              ref={fileInput}
              type="file"
            />
            <span className="font-semibold text-slate-950">
              Drop a product file here
            </span>
            <span className="mt-1 text-sm text-slate-600">
              or choose a CSV / XLSX file · maximum 5 MB
            </span>
            <span className="mt-3 rounded-lg bg-[#06173f] px-4 py-2 text-sm font-semibold text-white">
              Choose file
            </span>
          </label>
        </div>
      ) : (
        <form className="mt-5" noValidate onSubmit={submitProducts}>
          <input
            accept={PRODUCT_IMPORT_ACCEPT}
            className="sr-only"
            disabled={busy || hasImportedRows}
            onChange={onFileChange}
            ref={fileInput}
            type="file"
          />
          <div className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-950">{fileName}</p>
              <p className="mt-1 text-xs text-slate-500">
                {rows.length} rows · {readyCount} ready · {attentionCount} need attention
              </p>
            </div>
            <button
              className="text-left text-sm font-semibold text-[#06173f] underline underline-offset-4 disabled:cursor-not-allowed disabled:opacity-50 sm:text-right"
              disabled={busy || hasImportedRows}
              onClick={() => fileInput.current?.click()}
              type="button"
            >
              Choose another file
            </button>
          </div>

          <p className="mt-3 text-xs leading-5 text-slate-500">
            Review imported spreadsheet rows below. Rows marked Needs attention must
            be corrected before they can be added.
          </p>

          <div className="mt-4 hidden overflow-x-auto rounded-xl border border-stone-200 lg:block">
            <table className="w-full min-w-[75rem] border-collapse text-left text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  {[
                    "Status",
                    "Category",
                    "Brand",
                    "Model / Product",
                    "Specification",
                    "Unit",
                    "HSN",
                    "GST %",
                    "Action",
                  ].map((heading) => (
                    <th className="px-3 py-3 font-semibold" key={heading}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200">
                {rows.map((row) => (
                  <ProductImportTableRow
                    categories={categories}
                    disabled={busy}
                    key={row.id}
                    onRemove={removeRow}
                    onUpdate={updateRow}
                    row={row}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 space-y-3 lg:hidden">
            {rows.map((row) => (
              <ProductImportCard
                categories={categories}
                disabled={busy}
                key={row.id}
                onRemove={removeRow}
                onUpdate={updateRow}
                row={row}
              />
            ))}
          </div>

          {progress ? (
            <p className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900" role="status">
              Importing {Math.min(progress.completed + 1, progress.total)} of {progress.total} products…
            </p>
          ) : null}
          {summary ? (
            <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900" role="status">
              {summary}
            </p>
          ) : null}
          {error ? (
            <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm leading-6 text-rose-900" role="alert">
              {error}
            </p>
          ) : null}

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button onClick={onClose} type="button" variant="secondary">
              Cancel
            </Button>
            <Button
              disabled={busy || rows.length === 0 || attentionCount > 0}
              type="submit"
            >
              {submitting ? "Importing…" : `Import ${rows.length} products`}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

function ProductImportTableRow({
  categories,
  disabled,
  onRemove,
  onUpdate,
  row,
}: ImportRowProps) {
  const error = firstRowError(row);
  return (
    <tr className="align-top">
      <td className="px-3 py-3">
        <StatusPill row={row} />
        {error ? <p className="mt-1 max-w-40 text-xs text-rose-700">{error}</p> : null}
      </td>
      <td className="px-3 py-3"><ImportSelect ariaLabel="Category" disabled={disabled || row.status === "imported"} onChange={(value) => onUpdate(row.id, "category_id", value)} options={categories.map((category) => ({ label: category.name, value: category.id }))} value={row.values.category_id} /></td>
      <td className="px-3 py-3"><ImportInput ariaLabel="Brand" disabled={disabled || row.status === "imported"} onChange={(value) => onUpdate(row.id, "brand", value)} value={row.values.brand} /></td>
      <td className="px-3 py-3"><ImportInput ariaLabel="Model / Product" disabled={disabled || row.status === "imported"} onChange={(value) => onUpdate(row.id, "model_number", value)} value={row.values.model_number} /></td>
      <td className="px-3 py-3"><ImportInput ariaLabel="Specification" disabled={disabled || row.status === "imported"} onChange={(value) => onUpdate(row.id, "specifications", value)} value={row.values.specifications} /></td>
      <td className="px-3 py-3"><ImportSelect ariaLabel="Unit" disabled={disabled || row.status === "imported"} onChange={(value) => onUpdate(row.id, "unit", value)} options={productUnitOptions.map((unit) => ({ label: labelize(unit), value: unit }))} value={row.values.unit} /></td>
      <td className="px-3 py-3"><ImportInput ariaLabel="HSN" disabled={disabled || row.status === "imported"} onChange={(value) => onUpdate(row.id, "hsn_code", value)} value={row.values.hsn_code} /></td>
      <td className="px-3 py-3"><ImportInput ariaLabel="GST %" disabled={disabled || row.status === "imported"} onChange={(value) => onUpdate(row.id, "gst_percent", value)} value={row.values.gst_percent} /></td>
      <td className="px-3 py-3"><button className="text-xs font-semibold text-rose-700 underline underline-offset-4 disabled:cursor-not-allowed disabled:opacity-50" disabled={disabled || row.status === "imported"} onClick={() => onRemove(row.id)} type="button">Remove</button></td>
    </tr>
  );
}

function ProductImportCard({
  categories,
  disabled,
  onRemove,
  onUpdate,
  row,
}: ImportRowProps) {
  const fieldDisabled = disabled || row.status === "imported";
  return (
    <article className="rounded-xl border border-stone-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Spreadsheet row {row.sourceRowNumber}
          </p>
          <div className="mt-1"><StatusPill row={row} /></div>
        </div>
        <button className="text-xs font-semibold text-rose-700 underline underline-offset-4 disabled:cursor-not-allowed disabled:opacity-50" disabled={fieldDisabled} onClick={() => onRemove(row.id)} type="button">Remove</button>
      </div>
      {firstRowError(row) ? <p className="mt-2 rounded-lg bg-rose-50 px-2 py-1.5 text-xs leading-5 text-rose-800">{firstRowError(row)}</p> : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <ImportField label="Category"><ImportSelect ariaLabel="Category" disabled={fieldDisabled} onChange={(value) => onUpdate(row.id, "category_id", value)} options={categories.map((category) => ({ label: category.name, value: category.id }))} value={row.values.category_id} /></ImportField>
        <ImportField label="Unit"><ImportSelect ariaLabel="Unit" disabled={fieldDisabled} onChange={(value) => onUpdate(row.id, "unit", value)} options={productUnitOptions.map((unit) => ({ label: labelize(unit), value: unit }))} value={row.values.unit} /></ImportField>
        <ImportField label="Brand"><ImportInput ariaLabel="Brand" disabled={fieldDisabled} onChange={(value) => onUpdate(row.id, "brand", value)} value={row.values.brand} /></ImportField>
        <ImportField label="Model / Product"><ImportInput ariaLabel="Model / Product" disabled={fieldDisabled} onChange={(value) => onUpdate(row.id, "model_number", value)} value={row.values.model_number} /></ImportField>
        <ImportField label="Specification"><ImportInput ariaLabel="Specification" disabled={fieldDisabled} onChange={(value) => onUpdate(row.id, "specifications", value)} value={row.values.specifications} /></ImportField>
        <ImportField label="HSN"><ImportInput ariaLabel="HSN" disabled={fieldDisabled} onChange={(value) => onUpdate(row.id, "hsn_code", value)} value={row.values.hsn_code} /></ImportField>
        <ImportField label="GST %"><ImportInput ariaLabel="GST %" disabled={fieldDisabled} onChange={(value) => onUpdate(row.id, "gst_percent", value)} value={row.values.gst_percent} /></ImportField>
      </div>
    </article>
  );
}

type ImportRowProps = {
  categories: ProductCategory[];
  disabled: boolean;
  onRemove: (id: string) => void;
  onUpdate: (id: string, key: keyof ProductFormValues, value: string) => void;
  row: ProductImportRow;
};

function ImportField({ children, label }: { children: React.ReactNode; label: string }) {
  return <label className="block"><span className="text-xs font-medium text-slate-600">{label}</span><span className="mt-1 block">{children}</span></label>;
}

function ImportInput({ ariaLabel, disabled, onChange, value }: { ariaLabel: string; disabled: boolean; onChange: (value: string) => void; value: string }) {
  return <input aria-label={ariaLabel} className="w-full rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-sm text-slate-950 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-stone-50" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value} />;
}

function ImportSelect({ ariaLabel, disabled, onChange, options, value }: { ariaLabel: string; disabled: boolean; onChange: (value: string) => void; options: Array<{ label: string; value: string }>; value: string }) {
  return <select aria-label={ariaLabel} className="w-full rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-sm text-slate-950 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 disabled:bg-stone-50" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value}><option value="">Select</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
}

function StatusPill({ row }: { row: ProductImportRow }) {
  const status = productImportRowStatus(row);
  const styles = status === "Imported" ? "bg-emerald-100 text-emerald-800" : status === "Ready" ? "bg-blue-100 text-blue-800" : status === "Importing" ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800";
  return <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${styles}`}>{status}</span>;
}

function firstRowError(row: ProductImportRow) {
  return Object.values(row.errors).find((message) => Boolean(message)) ?? row.backendError;
}

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
