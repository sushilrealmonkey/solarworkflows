import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { AuthThemeCard, AuthThemeShell } from "../auth/AuthTheme";
import { Button } from "../crm/CrmComponents";
import { labelize } from "../crm/crmUtils";
import {
  createProduct,
  fetchProductCategories,
} from "../product-master/productMasterApi";
import { productUnitOptions } from "../product-master/productMasterUtils";
import type {
  ProductCategory,
  ProductFormValues,
} from "../product-master/types";
import { advanceCurrentCompanyOnboarding } from "./onboardingApi";
import {
  buildProductImportTemplateCsv,
  importProductRows,
  parseProductImportFile,
  PRODUCT_IMPORT_ACCEPT,
  PRODUCT_IMPORT_MAX_ROWS,
  PRODUCT_IMPORT_TEMPLATE_FILENAME,
  productImportRowStatus,
  removeProductImportRow,
  updateProductImportRowValue,
  type ProductImportRow,
} from "./onboardingProductImport";
import {
  runProductEntryTransition,
  runWithSubmissionLock,
  type ProductEntryExitAction,
} from "./onboardingProductEntry";
import { useOnboarding } from "./OnboardingGate";

type PageAction = "import" | "skip" | "back" | null;
type ImportProgress = { completed: number; total: number } | null;

export function OnboardingProductImportPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { setProgress } = useOnboarding();
  const submissionLock = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [rows, setRows] = useState<ProductImportRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [action, setAction] = useState<PageAction>(null);
  const [progress, setImportProgress] = useState<ImportProgress>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadCategories() {
      try {
        setLoading(true);
        setLoadError(null);
        const nextCategories = await fetchProductCategories(profile);
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
  }, [loadVersion, profile]);

  async function readFile(file: File | null) {
    if (!file || parsing || action || hasImportedRows(rows)) return;

    try {
      setParsing(true);
      setRows([]);
      setFileName(file.name);
      setError(null);
      setSummary(null);
      const parsedRows = await parseProductImportFile(file, categories);
      setRows(parsedRows);
    } catch (nextError) {
      setFileName(null);
      setError(messageOf(nextError, "This product list could not be read."));
    } finally {
      setParsing(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    void readFile(event.target.files?.[0] ?? null);
  }

  function dropFile(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
    void readFile(event.dataTransfer.files?.[0] ?? null);
  }

  function updateRow(
    id: string,
    key: keyof ProductFormValues,
    value: string,
  ) {
    if (action || parsing) return;
    setRows((current) =>
      current.map((row) =>
        row.id === id
          ? updateProductImportRowValue(row, key, value, categories)
          : row,
      ),
    );
    setError(null);
  }

  function removeRow(id: string) {
    if (action || parsing) return;
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

  function chooseAnotherFile() {
    if (action || parsing || hasImportedRows(rows)) return;
    fileInput.current?.click();
  }

  async function submitProducts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runWithSubmissionLock(submissionLock, async () => {
      try {
        setAction("import");
        setError(null);
        setSummary(null);
        setImportProgress({ completed: 0, total: rows.filter((row) => row.status !== "imported").length });

        const result = await importProductRows(
          rows,
          categories,
          (values) => createProduct(profile, values),
          setRows,
          (completed, total) => setImportProgress({ completed, total }),
        );
        setRows(result.rows);

        if (result.validationBlocked) {
          setError("Check the products marked Needs attention before importing.");
          return;
        }

        if (result.failedCount > 0) {
          setSummary(
            `${result.importedCount} product${result.importedCount === 1 ? "" : "s"} imported · ${result.failedCount} need attention. Imported rows will not be created again.`,
          );
          setError("Review the failed rows, correct them if needed, and retry.");
          return;
        }

        if (result.allImported) {
          await exitWorkspace("complete");
        }
      } catch (nextError) {
        setError(
          messageOf(nextError, "Products could not be imported or continued."),
        );
      } finally {
        setAction(null);
        setImportProgress(null);
      }
    });
  }

  async function exitWorkspace(nextAction: ProductEntryExitAction) {
    await runProductEntryTransition(nextAction, {
      persist: advanceCurrentCompanyOnboarding,
      commit: setProgress,
      navigate: (route) => navigate(route, { replace: true }),
    });
  }

  async function leaveWorkspace(nextAction: "skip" | "back") {
    await runWithSubmissionLock(submissionLock, async () => {
      try {
        setAction(nextAction);
        setError(null);
        await exitWorkspace(nextAction);
      } catch (nextError) {
        setError(
          messageOf(nextError, "Onboarding progress could not be updated."),
        );
      } finally {
        setAction(null);
      }
    });
  }

  return (
    <OnboardingProductImportView
      action={action}
      categories={categories}
      dragActive={dragActive}
      error={error}
      fileInputRef={fileInput}
      fileName={fileName}
      loadError={loadError}
      loading={loading}
      onBack={() => void leaveWorkspace("back")}
      onChooseAnother={chooseAnotherFile}
      onDownloadTemplate={downloadTemplate}
      onDragActiveChange={setDragActive}
      onDrop={dropFile}
      onFileChange={chooseFile}
      onRemove={removeRow}
      onRetryLoad={() => setLoadVersion((version) => version + 1)}
      onSkip={() => void leaveWorkspace("skip")}
      onSubmit={(event) => void submitProducts(event)}
      onUpdate={updateRow}
      parsing={parsing}
      progress={progress}
      rows={rows}
      summary={summary}
    />
  );
}

type OnboardingProductImportViewProps = {
  action: PageAction;
  categories: ProductCategory[];
  dragActive: boolean;
  error: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  fileName: string | null;
  loadError: string | null;
  loading: boolean;
  onBack: () => void;
  onChooseAnother: () => void;
  onDownloadTemplate: () => void;
  onDragActiveChange: (active: boolean) => void;
  onDrop: (event: DragEvent<HTMLLabelElement>) => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: (id: string) => void;
  onRetryLoad: () => void;
  onSkip: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUpdate: (
    id: string,
    key: keyof ProductFormValues,
    value: string,
  ) => void;
  parsing: boolean;
  progress: ImportProgress;
  rows: ProductImportRow[];
  summary: string | null;
};

export function OnboardingProductImportView({
  action,
  categories,
  dragActive,
  error,
  fileInputRef,
  fileName,
  loadError,
  loading,
  onBack,
  onChooseAnother,
  onDownloadTemplate,
  onDragActiveChange,
  onDrop,
  onFileChange,
  onRemove,
  onRetryLoad,
  onSkip,
  onSubmit,
  onUpdate,
  parsing,
  progress,
  rows,
  summary,
}: OnboardingProductImportViewProps) {
  const busy = action !== null || parsing;
  const importedCount = rows.filter((row) => row.status === "imported").length;
  const readyCount = rows.filter(
    (row) =>
      row.status !== "imported" &&
      row.status !== "failed" &&
      Object.values(row.errors).every((message) => !message),
  ).length;
  const attentionCount = rows.length - importedCount - readyCount;
  const hasImported = importedCount > 0;
  const review = rows.length > 0;
  const hasFailed = rows.some((row) => row.status === "failed");
  const supportingCopy =
    "Upload your existing product list and review it before adding the products to Bizlee.";

  return (
    <AuthThemeShell
      badge="Step 3 of 5"
      contentMaxWidthClass="max-w-none"
      desktopDescription={supportingCopy}
      mobileDescription={supportingCopy}
      title="Import your products"
      workspaceLayout
    >
      <AuthThemeCard>
        <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <p className="text-sm font-semibold text-orange-200">Step 3 of 5</p>
          <span className="text-xs font-medium text-slate-400">
            Products · Import products
          </span>
        </div>
        <div aria-label="Onboarding progress" className="mt-3 flex gap-2">
          {Array.from({ length: 5 }).map((_, index) => (
            <span
              className={`h-1.5 flex-1 rounded-full ${index < 3 ? "bg-orange-400" : "bg-white/15"}`}
              key={index}
            />
          ))}
        </div>

        <div className="mt-6">
          <h2 className="text-xl font-semibold text-white">
            {review ? "Review products" : "Bring in your product list"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            {review
              ? "Correct anything marked Needs attention, then import the reviewed products."
              : "Download the Bizlee template or upload an existing CSV or Excel file."}
          </p>
        </div>

        {loading ? (
          <ImportLoading />
        ) : loadError ? (
          <ImportLoadError message={loadError} onRetry={onRetryLoad} />
        ) : review ? (
          <form className="mt-6" noValidate onSubmit={onSubmit}>
            <input
              accept={PRODUCT_IMPORT_ACCEPT}
              aria-label="Choose another product list"
              className="sr-only"
              disabled={busy || hasImported}
              onChange={onFileChange}
              ref={fileInputRef}
              type="file"
            />
            <ReviewSummary
              attentionCount={attentionCount}
              fileName={fileName}
              importedCount={importedCount}
              readyCount={readyCount}
              total={rows.length}
            />

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-5 text-slate-400">
                Spreadsheet row numbers are shown to make corrections easier.
              </p>
              <button
                className="min-h-10 rounded-lg px-3 text-sm font-semibold text-orange-200 outline-none transition hover:bg-orange-300/10 focus-visible:ring-2 focus-visible:ring-orange-300 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={busy || hasImported}
                onClick={onChooseAnother}
                type="button"
              >
                Choose Another File
              </button>
            </div>
            {hasImported ? (
              <p className="mt-2 text-xs leading-5 text-slate-400">
                File replacement is unavailable because imported rows must remain protected from duplicate retries.
              </p>
            ) : null}

            <div className="mt-4 hidden overflow-x-auto rounded-2xl border border-white/15 lg:block">
              <table className="w-full min-w-[74rem] border-collapse text-left">
                <thead className="bg-white/[0.07] text-xs uppercase tracking-wide text-slate-300">
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
                      <th className="px-3 py-3 font-semibold" key={heading} scope="col">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {rows.map((row, index) => (
                    <DesktopReviewRow
                      categories={categories}
                      disabled={busy}
                      index={index}
                      key={row.id}
                      onRemove={onRemove}
                      onUpdate={onUpdate}
                      row={row}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 space-y-4 lg:hidden">
              {rows.map((row, index) => (
                <MobileReviewCard
                  categories={categories}
                  disabled={busy}
                  index={index}
                  key={row.id}
                  onRemove={onRemove}
                  onUpdate={onUpdate}
                  row={row}
                />
              ))}
            </div>

            {progress ? (
              <div
                aria-live="polite"
                className="mt-5 rounded-xl border border-orange-300/25 bg-orange-300/10 px-4 py-3 text-sm text-orange-100"
                role="status"
              >
                Importing {Math.min(progress.completed + 1, progress.total)} of {progress.total} products…
              </div>
            ) : null}
            {summary ? (
              <p
                className="mt-5 rounded-xl border border-emerald-300/25 bg-emerald-300/10 px-4 py-3 text-sm leading-6 text-emerald-100"
                role="status"
              >
                {summary}
              </p>
            ) : null}
            {error ? <ImportAlert message={error} /> : null}

            <WorkspaceActions
              action={action}
              busy={busy}
              hasFailed={hasFailed}
              hasImported={hasImported}
              importDisabled={rows.length === 0 || categories.length === 0}
              onBack={onBack}
              onSkip={onSkip}
            />
          </form>
        ) : (
          <div className="mt-6">
            <div className="grid gap-4 md:grid-cols-[0.85fr_1.15fr]">
              <section className="rounded-2xl border border-white/15 bg-white/[0.045] p-5">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-300/15 text-orange-200">
                  <DownloadIcon />
                </span>
                <h3 className="mt-4 font-semibold text-white">Download Template</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Use our template to make sure your product data imports correctly. Replace the example row with your products.
                </p>
                <button
                  className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-orange-300/45 px-4 py-2 text-sm font-semibold text-orange-100 outline-none transition hover:border-orange-300 hover:bg-orange-300/10 focus-visible:ring-2 focus-visible:ring-orange-300 disabled:opacity-50 sm:w-auto"
                  disabled={busy}
                  onClick={onDownloadTemplate}
                  type="button"
                >
                  Download Template
                </button>
              </section>

              <label
                className={`flex min-h-64 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 text-center outline-none transition focus-within:ring-2 focus-within:ring-orange-300 ${
                  dragActive
                    ? "border-orange-300 bg-orange-300/15"
                    : "border-white/25 bg-white/[0.045] hover:border-orange-300/65 hover:bg-white/[0.07]"
                } ${busy || categories.length === 0 ? "cursor-not-allowed opacity-55" : ""}`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  if (!busy) onDragActiveChange(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  onDragActiveChange(false);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={onDrop}
              >
                <input
                  accept={PRODUCT_IMPORT_ACCEPT}
                  aria-label="Upload product list"
                  className="sr-only"
                  disabled={busy || categories.length === 0}
                  onChange={onFileChange}
                  ref={fileInputRef}
                  type="file"
                />
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-orange-200">
                  <UploadIcon />
                </span>
                <span className="mt-4 text-base font-semibold text-white">
                  {parsing ? "Reading your product list…" : "Drop your Excel or CSV file here"}
                </span>
                {!parsing ? (
                  <span className="mt-2 text-sm text-orange-200">or choose a file</span>
                ) : null}
                <span className="mt-3 text-xs leading-5 text-slate-400">
                  .xlsx or .csv · Up to 5 MB and {PRODUCT_IMPORT_MAX_ROWS.toLocaleString()} products
                </span>
              </label>
            </div>

            {categories.length === 0 ? (
              <ImportAlert message="No active Product Master categories are available. Add a category before importing products." />
            ) : null}
            {error ? <ImportAlert message={error} /> : null}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row [&>button]:w-full sm:[&>button]:w-auto [&>button]:!text-slate-200 [&>button:hover]:!bg-white/10">
              <Button disabled={busy} onClick={onBack} variant="ghost">
                {action === "back" ? "Going back..." : "Back"}
              </Button>
              <Button disabled={busy} onClick={onSkip} variant="ghost">
                {action === "skip" ? "Skipping..." : "Skip for Now"}
              </Button>
            </div>
          </div>
        )}
      </AuthThemeCard>
    </AuthThemeShell>
  );
}

type ReviewRowProps = {
  categories: ProductCategory[];
  disabled: boolean;
  index: number;
  onRemove: (id: string) => void;
  onUpdate: (
    id: string,
    key: keyof ProductFormValues,
    value: string,
  ) => void;
  row: ProductImportRow;
};

function DesktopReviewRow(props: ReviewRowProps) {
  const { row, index, disabled, onRemove } = props;
  const locked = disabled || row.status === "imported";
  const status = productImportRowStatus(row);

  return (
    <tr className="align-top bg-white/[0.025]">
      <td className="w-28 px-3 py-3">
        <StatusPill status={status} />
        <span className="mt-1 block text-[0.68rem] text-slate-500">Row {row.sourceRowNumber}</span>
      </td>
      <ReviewCells {...props} idSuffix="desktop" locked={locked} />
      <td className="w-20 px-3 py-3">
        {row.status === "imported" ? null : (
          <button
            aria-label={`Remove product ${index + 1}`}
            className="min-h-10 rounded-lg px-2 text-xs font-semibold text-slate-300 outline-none transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-orange-300 disabled:opacity-50"
            disabled={locked}
            onClick={() => onRemove(row.id)}
            type="button"
          >
            Remove
          </button>
        )}
        <RowWideErrors row={row} />
      </td>
    </tr>
  );
}

function MobileReviewCard(props: ReviewRowProps) {
  const { row, index, disabled, onRemove } = props;
  const locked = disabled || row.status === "imported";
  const status = productImportRowStatus(row);

  return (
    <fieldset className="min-w-0 rounded-2xl border border-white/15 bg-white/[0.05] p-4">
      <div className="flex items-center justify-between gap-3">
        <legend className="text-sm font-semibold text-white">Product {index + 1}</legend>
        <StatusPill status={status} />
      </div>
      <p className="mt-1 text-xs text-slate-500">Spreadsheet row {row.sourceRowNumber}</p>
      <div className="mt-4 grid min-w-0 gap-4">
        <ReviewFields {...props} idSuffix="mobile" locked={locked} showLabels />
      </div>
      <RowWideErrors row={row} />
      {row.status !== "imported" ? (
        <button
          aria-label={`Remove product ${index + 1}`}
          className="mt-4 min-h-11 rounded-lg px-3 text-sm font-semibold text-slate-300 outline-none transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-orange-300 disabled:opacity-50"
          disabled={locked}
          onClick={() => onRemove(row.id)}
          type="button"
        >
          Remove
        </button>
      ) : null}
    </fieldset>
  );
}

function ReviewCells(props: ReviewRowProps & { idSuffix: string; locked: boolean }) {
  return <ReviewFields {...props} showLabels={false} />;
}

function ReviewFields({
  categories,
  idSuffix,
  locked,
  onUpdate,
  row,
  showLabels,
}: ReviewRowProps & {
  idSuffix: string;
  locked: boolean;
  showLabels: boolean;
}) {
  const fields = (
    <>
      <ReviewSelect
        disabled={locked}
        error={row.errors.category_id}
        id={`${row.id}-${idSuffix}-category`}
        label="Category"
        onChange={(value) => onUpdate(row.id, "category_id", value)}
        options={[
          { value: "", label: "Select category" },
          ...categories.map((category) => ({
            value: category.id,
            label: category.name,
          })),
        ]}
        showLabel={showLabels}
        value={row.values.category_id}
      />
      <ReviewInput
        disabled={locked}
        id={`${row.id}-${idSuffix}-brand`}
        label="Brand"
        onChange={(value) => onUpdate(row.id, "brand", value)}
        showLabel={showLabels}
        value={row.values.brand}
      />
      <ReviewInput
        disabled={locked}
        id={`${row.id}-${idSuffix}-model`}
        label="Model / Product"
        onChange={(value) => onUpdate(row.id, "model_number", value)}
        showLabel={showLabels}
        value={row.values.model_number}
      />
      <ReviewInput
        disabled={locked}
        id={`${row.id}-${idSuffix}-specification`}
        label="Specification"
        onChange={(value) => onUpdate(row.id, "specifications", value)}
        showLabel={showLabels}
        value={row.values.specifications}
      />
      <ReviewSelect
        disabled={locked}
        error={row.errors.unit}
        id={`${row.id}-${idSuffix}-unit`}
        label="Unit"
        onChange={(value) => onUpdate(row.id, "unit", value)}
        options={[
          { value: "", label: "Select unit" },
          ...productUnitOptions.map((unit) => ({
            value: unit,
            label: unit === "piece" ? "Piece (Nos.)" : unit === "kg" ? "KG" : labelize(unit),
          })),
        ]}
        showLabel={showLabels}
        value={row.values.unit}
      />
      <ReviewInput
        disabled={locked}
        id={`${row.id}-${idSuffix}-hsn`}
        inputMode="numeric"
        label="HSN"
        onChange={(value) => onUpdate(row.id, "hsn_code", value)}
        showLabel={showLabels}
        value={row.values.hsn_code}
      />
      <ReviewInput
        disabled={locked}
        error={row.errors.gst_percent}
        id={`${row.id}-${idSuffix}-gst`}
        inputMode="decimal"
        label="GST %"
        onChange={(value) => onUpdate(row.id, "gst_percent", value)}
        showLabel={showLabels}
        value={row.values.gst_percent}
      />
    </>
  );

  if (showLabels) return fields;
  return (
    <>
      {Array.from({ length: 7 }, (_, index) => {
        const children = Array.isArray(fields.props.children)
          ? fields.props.children[index]
          : null;
        return <td className="min-w-32 px-2 py-3" key={index}>{children}</td>;
      })}
    </>
  );
}

function ReviewInput({
  disabled,
  error,
  id,
  inputMode,
  label,
  onChange,
  showLabel,
  value,
}: {
  disabled: boolean;
  error?: string;
  id: string;
  inputMode?: "numeric" | "decimal";
  label: string;
  onChange: (value: string) => void;
  showLabel: boolean;
  value: string;
}) {
  const errorId = `${id}-error`;
  return (
    <label className="block min-w-0" htmlFor={id}>
      <span className={showLabel ? "text-sm font-medium text-slate-200" : "sr-only"}>{label}</span>
      <input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        className={`${reviewControlClass} ${showLabel ? "mt-1.5" : ""} ${error ? "border-red-300/70" : ""}`}
        disabled={disabled}
        id={id}
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
      {error ? <span className="mt-1 block text-xs leading-4 text-red-200" id={errorId} role="alert">{error}</span> : null}
    </label>
  );
}

function ReviewSelect({
  disabled,
  error,
  id,
  label,
  onChange,
  options,
  showLabel,
  value,
}: {
  disabled: boolean;
  error?: string;
  id: string;
  label: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  showLabel: boolean;
  value: string;
}) {
  const errorId = `${id}-error`;
  return (
    <label className="block min-w-0" htmlFor={id}>
      <span className={showLabel ? "text-sm font-medium text-slate-200" : "sr-only"}>{label}</span>
      <select
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        className={`${reviewControlClass} ${showLabel ? "mt-1.5" : ""} ${error ? "border-red-300/70" : ""}`}
        disabled={disabled}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      {error ? <span className="mt-1 block text-xs leading-4 text-red-200" id={errorId} role="alert">{error}</span> : null}
    </label>
  );
}

function RowWideErrors({ row }: { row: ProductImportRow }) {
  return (
    <>
      {row.errors.identifying_details ? (
        <p className="mt-2 min-w-40 text-xs leading-4 text-red-200" role="alert">
          {row.errors.identifying_details}
        </p>
      ) : null}
      {row.errors.product_name && !row.errors.identifying_details ? (
        <p className="mt-2 min-w-40 text-xs leading-4 text-red-200" role="alert">
          {row.errors.product_name}
        </p>
      ) : null}
      {row.backendError ? (
        <p className="mt-2 min-w-44 rounded-lg border border-red-300/20 bg-red-500/10 px-2 py-1.5 text-xs leading-4 text-red-100" role="alert">
          {row.backendError}
        </p>
      ) : null}
    </>
  );
}

function ReviewSummary({
  attentionCount,
  fileName,
  importedCount,
  readyCount,
  total,
}: {
  attentionCount: number;
  fileName: string | null;
  importedCount: number;
  readyCount: number;
  total: number;
}) {
  return (
    <section className="rounded-2xl border border-white/15 bg-white/[0.055] p-4" aria-live="polite">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-base font-semibold text-white">
            {total} product{total === 1 ? "" : "s"} found
          </p>
          <p className="mt-1 break-all text-xs text-slate-400">{fileName}</p>
        </div>
        <p className="text-sm font-medium text-slate-200">
          {importedCount > 0 ? `${importedCount} imported · ` : ""}
          {readyCount} ready{attentionCount > 0 ? ` · ${attentionCount} need attention` : ""}
        </p>
      </div>
    </section>
  );
}

function WorkspaceActions({
  action,
  busy,
  hasFailed,
  hasImported,
  importDisabled,
  onBack,
  onSkip,
}: {
  action: PageAction;
  busy: boolean;
  hasFailed: boolean;
  hasImported: boolean;
  importDisabled: boolean;
  onBack: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row [&>button]:w-full sm:[&>button]:w-auto [&>button]:!text-slate-200 [&>button:hover]:!bg-white/10">
          <Button disabled={busy} onClick={onBack} variant="ghost">
            {action === "back" ? "Going back..." : "Back"}
          </Button>
          <Button disabled={busy} onClick={onSkip} variant="ghost">
            {action === "skip" ? "Skipping..." : "Skip for Now"}
          </Button>
        </div>
        {hasImported ? (
          <p className="mt-2 max-w-sm text-xs leading-5 text-slate-400">
            Back or Skip keeps products that were already imported.
          </p>
        ) : null}
      </div>
      <div className="[&>button]:w-full sm:[&>button]:w-auto">
        <Button disabled={busy || importDisabled} type="submit">
          {action === "import"
            ? "Importing products..."
            : hasFailed
              ? "Retry Failed Products"
              : "Import Products & Continue"}
        </Button>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "Imported"
      ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
      : status === "Ready"
        ? "border-sky-300/25 bg-sky-300/10 text-sky-100"
        : status === "Importing"
          ? "border-orange-300/25 bg-orange-300/10 text-orange-100"
          : "border-red-300/25 bg-red-500/10 text-red-100";
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold ${tone}`}>
      {status}
    </span>
  );
}

function ImportLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="mt-6 space-y-3">
      <div className="h-24 animate-pulse rounded-2xl bg-white/[0.08]" />
      <span className="sr-only">Loading product categories</span>
    </div>
  );
}

function ImportLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mt-6 rounded-2xl border border-red-300/20 bg-red-500/10 p-5">
      <h3 className="font-semibold text-white">Product categories unavailable</h3>
      <p className="mt-2 text-sm leading-6 text-red-100" role="alert">{message}</p>
      <div className="mt-4 [&>button]:w-full sm:[&>button]:w-auto">
        <Button onClick={onRetry}>Try again</Button>
      </div>
    </div>
  );
}

function ImportAlert({ message }: { message: string }) {
  return (
    <p
      className="mt-5 rounded-xl border border-red-300/25 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-100"
      role="alert"
    >
      {message}
    </p>
  );
}

function DownloadIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path d="M12 3v12m0 0-4-4m4 4 4-4M5 19h14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24">
      <path d="M12 16V4m0 0-4 4m4-4 4 4M5 15v4h14v-4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

const reviewControlClass =
  "min-h-11 w-full min-w-0 rounded-xl border border-white/15 bg-[#132750] px-3 py-2.5 text-sm text-white outline-none transition focus:border-orange-300 focus:ring-2 focus:ring-orange-300/20 disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-slate-400";

function hasImportedRows(rows: ProductImportRow[]) {
  return rows.some((row) => row.status === "imported");
}

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
