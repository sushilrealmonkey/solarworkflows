import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../app/AuthProvider";
import { AuthThemeCard, AuthThemeShell } from "../auth/AuthTheme";
import { Button } from "../crm/CrmComponents";
import { labelize } from "../crm/crmUtils";
import {
  createProduct,
  fetchProductBrandSuggestions,
  fetchProductCategories,
} from "../product-master/productMasterApi";
import { productUnitOptions } from "../product-master/productMasterUtils";
import type {
  ProductCategory,
  ProductFormValues,
} from "../product-master/types";
import { advanceCurrentCompanyOnboarding } from "./onboardingApi";
import {
  appendOnboardingProductDraft,
  createOnboardingProductDraft,
  removeOnboardingProductDraft,
  runProductEntryTransition,
  runWithSubmissionLock,
  saveOnboardingProductDrafts,
  updateOnboardingProductDraftValue,
  type OnboardingProductDraft,
  type ProductEntryExitAction,
} from "./onboardingProductEntry";
import { useOnboarding } from "./OnboardingGate";

type PageAction = "save" | "skip" | "back" | null;

export function OnboardingProductEntryPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { setProgress } = useOnboarding();
  const draftNumber = useRef(2);
  const submissionLock = useRef(false);
  const [rows, setRows] = useState<OnboardingProductDraft[]>(() => [
    createOnboardingProductDraft("onboarding-product-1"),
  ]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [brandOptions, setBrandOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [action, setAction] = useState<PageAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadProductOptions() {
      try {
        setLoading(true);
        setLoadError(null);
        const [nextCategories, nextBrands] = await Promise.all([
          fetchProductCategories(profile),
          fetchProductBrandSuggestions(profile),
        ]);
        if (!active) return;

        setCategories(
          nextCategories.filter((category) => category.is_active !== false),
        );
        setBrandOptions(nextBrands);
      } catch (nextError) {
        if (active) {
          setLoadError(
            errorMessage(nextError, "Product options could not be loaded."),
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadProductOptions();
    return () => {
      active = false;
    };
  }, [loadVersion, profile]);

  function nextBlankRow() {
    const id = `onboarding-product-${draftNumber.current}`;
    draftNumber.current += 1;
    return createOnboardingProductDraft(id);
  }

  function addRow() {
    if (action) return;
    setRows((current) =>
      appendOnboardingProductDraft(current, nextBlankRow()),
    );
    setError(null);
    setSummary(null);
  }

  function removeRow(id: string) {
    if (action) return;
    setRows((current) =>
      removeOnboardingProductDraft(current, id, nextBlankRow()),
    );
    setError(null);
    setSummary(null);
  }

  function updateRow(
    id: string,
    key: keyof ProductFormValues,
    value: string,
  ) {
    setRows((current) =>
      current.map((row) =>
        row.id === id
          ? updateOnboardingProductDraftValue(row, key, value)
          : row,
      ),
    );
    setError(null);
    setSummary(null);
  }

  async function submitProducts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    await runWithSubmissionLock(submissionLock, async () => {
      try {
        setAction("save");
        setError(null);
        setSummary(null);

        const result = await saveOnboardingProductDrafts(
          rows,
          categories,
          (values) => createProduct(profile, values),
          setRows,
        );

        setRows(result.rows);

        if (result.validationBlocked) {
          setError("Check the highlighted product fields before saving.");
          return;
        }

        if (result.failedCount > 0) {
          const totalSaved = result.rows.filter(
            (row) => row.status === "saved",
          ).length;
          setError(
            `${result.failedCount} product${result.failedCount === 1 ? "" : "s"} could not be saved. Review the row errors and retry.`,
          );
          setSummary(
            `${totalSaved} product${totalSaved === 1 ? "" : "s"} saved. Saved rows will not be created again.`,
          );
          return;
        }

        if (result.allSaved) {
          await exitWorkspace("complete");
        }
      } catch (nextError) {
        setError(
          errorMessage(nextError, "Products could not be saved or continued."),
        );
      } finally {
        setAction(null);
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
        setSummary(null);
        await exitWorkspace(nextAction);
      } catch (nextError) {
        setError(
          errorMessage(nextError, "Onboarding progress could not be updated."),
        );
      } finally {
        setAction(null);
      }
    });
  }

  return (
    <OnboardingProductEntryView
      action={action}
      brandOptions={brandOptions}
      categories={categories}
      error={error}
      loadError={loadError}
      loading={loading}
      onAdd={addRow}
      onBack={() => void leaveWorkspace("back")}
      onRemove={removeRow}
      onRetryLoad={() => setLoadVersion((version) => version + 1)}
      onSkip={() => void leaveWorkspace("skip")}
      onSubmit={(event) => void submitProducts(event)}
      onUpdate={updateRow}
      rows={rows}
      summary={summary}
    />
  );
}

type OnboardingProductEntryViewProps = {
  action: PageAction;
  brandOptions: string[];
  categories: ProductCategory[];
  error: string | null;
  loadError: string | null;
  loading: boolean;
  onAdd: () => void;
  onBack: () => void;
  onRemove: (id: string) => void;
  onRetryLoad: () => void;
  onSkip: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUpdate: (
    id: string,
    key: keyof ProductFormValues,
    value: string,
  ) => void;
  rows: OnboardingProductDraft[];
  summary: string | null;
};

export function OnboardingProductEntryView({
  action,
  brandOptions,
  categories,
  error,
  loadError,
  loading,
  onAdd,
  onBack,
  onRemove,
  onRetryLoad,
  onSkip,
  onSubmit,
  onUpdate,
  rows,
  summary,
}: OnboardingProductEntryViewProps) {
  const brandListId = useId();
  const busy = action !== null;
  const hasFailedRows = rows.some((row) => row.status === "error");
  const supportingCopy =
    "Add the products you regularly use in quotations, BOMs, purchases and inventory.";

  return (
    <AuthThemeShell
      badge="Step 3 of 5"
      contentMaxWidthClass="max-w-none"
      desktopDescription={supportingCopy}
      mobileDescription={supportingCopy}
      title="Add your products"
      workspaceLayout
    >
      <AuthThemeCard>
        <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <p className="text-sm font-semibold text-orange-200">Step 3 of 5</p>
          <span className="text-xs font-medium text-slate-400">
            Products · Add products
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
          <h2 className="text-xl font-semibold text-white">Product workspace</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Add several products at once. You can add more details later from Product Master.
          </p>
        </div>

        {loading ? (
          <ProductEntryLoading />
        ) : loadError ? (
          <ProductEntryLoadError message={loadError} onRetry={onRetryLoad} />
        ) : (
          <form className="mt-6" noValidate onSubmit={onSubmit}>
            {categories.length === 0 ? (
              <p
                className="rounded-xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm leading-6 text-amber-100"
                role="alert"
              >
                No active product categories are available. Add a category from Product Master before saving products.
              </p>
            ) : null}

            <datalist id={brandListId}>
              {brandOptions.map((brand) => (
                <option key={brand} value={brand} />
              ))}
            </datalist>

            <div className="hidden lg:block">
              <div className="grid grid-cols-[minmax(8.5rem,1.1fr)_minmax(7.5rem,0.9fr)_minmax(9.5rem,1.15fr)_minmax(9.5rem,1.2fr)_minmax(6rem,0.65fr)_3rem] gap-3 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <span>Category</span>
                <span>Brand</span>
                <span>Model / Product</span>
                <span>Specification</span>
                <span>Unit</span>
                <span className="sr-only">Action</span>
              </div>
              <div className="mt-2 space-y-3">
                {rows.map((row, index) => (
                  <DesktopProductRow
                    brandListId={brandListId}
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
            </div>

            <div className="space-y-4 lg:hidden">
              {rows.map((row, index) => (
                <MobileProductCard
                  brandListId={brandListId}
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

            <button
              className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-dashed border-orange-300/45 px-4 py-2.5 text-sm font-semibold text-orange-200 outline-none transition hover:border-orange-300 hover:bg-orange-300/10 focus-visible:ring-2 focus-visible:ring-orange-300 disabled:cursor-not-allowed disabled:opacity-55"
              disabled={busy}
              onClick={onAdd}
              type="button"
            >
              <span aria-hidden="true" className="text-lg leading-none">+</span>
              Add Another Product
            </button>

            {summary ? (
              <p
                className="mt-5 rounded-xl border border-emerald-300/25 bg-emerald-300/10 px-4 py-3 text-sm leading-6 text-emerald-100"
                role="status"
              >
                {summary}
              </p>
            ) : null}
            {error ? (
              <p
                className="mt-5 rounded-xl border border-red-300/25 bg-red-500/10 px-4 py-3 text-sm leading-6 text-red-100"
                role="alert"
              >
                {error}
              </p>
            ) : null}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col-reverse gap-2 sm:flex-row [&>button]:w-full sm:[&>button]:w-auto [&>button]:!text-slate-200 [&>button:hover]:!bg-white/10">
                <Button disabled={busy} onClick={onBack} variant="ghost">
                  {action === "back" ? "Going back..." : "Back"}
                </Button>
                <Button disabled={busy} onClick={onSkip} variant="ghost">
                  {action === "skip" ? "Skipping..." : "Skip for Now"}
                </Button>
              </div>
              <div className="[&>button]:w-full sm:[&>button]:w-auto">
                <Button disabled={busy || categories.length === 0} type="submit">
                  {action === "save" ? (
                    <span className="inline-flex items-center gap-2">
                      <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      Saving products...
                    </span>
                  ) : hasFailedRows ? "Retry Failed Products" : "Save Products & Continue"}
                </Button>
              </div>
            </div>
          </form>
        )}
      </AuthThemeCard>
    </AuthThemeShell>
  );
}

type ProductRowProps = {
  brandListId: string;
  categories: ProductCategory[];
  disabled: boolean;
  index: number;
  onRemove: (id: string) => void;
  onUpdate: (
    id: string,
    key: keyof ProductFormValues,
    value: string,
  ) => void;
  row: OnboardingProductDraft;
};

function DesktopProductRow(props: ProductRowProps) {
  const { row, index, disabled, onRemove } = props;
  const locked = disabled || row.status === "saved";

  return (
    <fieldset className="rounded-2xl border border-white/12 bg-white/[0.045] p-3">
      <legend className="sr-only">Product {index + 1}</legend>
      <div className="grid grid-cols-[minmax(8.5rem,1.1fr)_minmax(7.5rem,0.9fr)_minmax(9.5rem,1.15fr)_minmax(9.5rem,1.2fr)_minmax(6rem,0.65fr)_3rem] items-start gap-3">
        <ProductFields {...props} idSuffix="desktop" labels="hidden" />
        <RowAction
          disabled={locked}
          index={index}
          onRemove={() => onRemove(row.id)}
          saved={row.status === "saved"}
        />
      </div>
      <RowMessages idSuffix="desktop" row={row} />
    </fieldset>
  );
}

function MobileProductCard(props: ProductRowProps) {
  const { row, index, disabled, onRemove } = props;
  const locked = disabled || row.status === "saved";

  return (
    <fieldset className="rounded-2xl border border-white/15 bg-white/[0.055] p-4">
      <div className="flex items-center justify-between gap-3">
        <legend className="text-sm font-semibold text-white">Product {index + 1}</legend>
        {row.status === "saved" ? <SavedBadge /> : null}
      </div>
      <div className="mt-4 grid min-w-0 gap-4">
        <ProductFields {...props} idSuffix="mobile" labels="visible" />
      </div>
      <RowMessages idSuffix="mobile" row={row} />
      {row.status !== "saved" ? (
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

function ProductFields({
  brandListId,
  categories,
  disabled,
  idSuffix,
  labels,
  row,
  onUpdate,
}: ProductRowProps & {
  idSuffix: string;
  labels: "visible" | "hidden";
}) {
  const locked = disabled || row.status === "saved";
  const identificationErrorId = `${row.id}-${idSuffix}-identification-error`;

  return (
    <>
      <EntrySelect
        disabled={locked}
        error={row.errors.category_id}
        id={`${row.id}-${idSuffix}-category`}
        label="Category"
        labelStyle={labels}
        onChange={(value) => onUpdate(row.id, "category_id", value)}
        options={[
          { value: "", label: "Select category" },
          ...categories.map((category) => ({
            value: category.id,
            label: category.name,
          })),
        ]}
        value={row.values.category_id}
      />
      <EntryInput
        describedBy={row.errors.identifying_details ? identificationErrorId : undefined}
        disabled={locked}
        id={`${row.id}-${idSuffix}-brand`}
        label="Brand"
        labelStyle={labels}
        list={brandListId}
        onChange={(value) => onUpdate(row.id, "brand", value)}
        placeholder="e.g. Waaree"
        value={row.values.brand}
      />
      <EntryInput
        describedBy={row.errors.identifying_details ? identificationErrorId : undefined}
        disabled={locked}
        id={`${row.id}-${idSuffix}-model`}
        label="Model / Product"
        labelStyle={labels}
        onChange={(value) => onUpdate(row.id, "model_number", value)}
        placeholder="e.g. WS-550"
        value={row.values.model_number}
      />
      <EntryInput
        describedBy={row.errors.identifying_details ? identificationErrorId : undefined}
        disabled={locked}
        id={`${row.id}-${idSuffix}-specification`}
        label="Specification"
        labelStyle={labels}
        onChange={(value) => onUpdate(row.id, "specifications", value)}
        placeholder="e.g. 550W Mono PERC"
        value={row.values.specifications}
      />
      <EntrySelect
        disabled={locked}
        error={row.errors.unit}
        id={`${row.id}-${idSuffix}-unit`}
        label="Unit"
        labelStyle={labels}
        onChange={(value) => onUpdate(row.id, "unit", value)}
        options={productUnitOptions.map((unit) => ({
          value: unit,
          label: unit === "piece" ? "Piece (Nos.)" : unit === "kg" ? "KG" : labelize(unit),
        }))}
        value={row.values.unit}
      />
    </>
  );
}

function EntryInput({
  describedBy,
  disabled,
  id,
  label,
  labelStyle,
  list,
  onChange,
  placeholder,
  value,
}: {
  describedBy?: string;
  disabled: boolean;
  id: string;
  label: string;
  labelStyle: "visible" | "hidden";
  list?: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="block min-w-0" htmlFor={id}>
      <span className={labelStyle === "visible" ? "text-sm font-medium text-slate-200" : "sr-only"}>
        {label}
      </span>
      <input
        aria-describedby={describedBy}
        className={`${entryControlClass} ${labelStyle === "visible" ? "mt-1.5" : ""}`}
        disabled={disabled}
        id={id}
        list={list}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

function EntrySelect({
  disabled,
  error,
  id,
  label,
  labelStyle,
  onChange,
  options,
  value,
}: {
  disabled: boolean;
  error?: string;
  id: string;
  label: string;
  labelStyle: "visible" | "hidden";
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  value: string;
}) {
  const errorId = `${id}-error`;

  return (
    <label className="block min-w-0" htmlFor={id}>
      <span className={labelStyle === "visible" ? "text-sm font-medium text-slate-200" : "sr-only"}>
        {label}
      </span>
      <select
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        className={`${entryControlClass} ${labelStyle === "visible" ? "mt-1.5" : ""} ${error ? "border-red-300/70" : ""}`}
        disabled={disabled}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      {error ? <span className="mt-1 block text-xs text-red-200" id={errorId}>{error}</span> : null}
    </label>
  );
}

function RowAction({
  disabled,
  index,
  onRemove,
  saved,
}: {
  disabled: boolean;
  index: number;
  onRemove: () => void;
  saved: boolean;
}) {
  if (saved) return <SavedBadge compact />;

  return (
    <button
      aria-label={`Remove product ${index + 1}`}
      className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 outline-none transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-orange-300 disabled:opacity-50"
      disabled={disabled}
      onClick={onRemove}
      title={`Remove product ${index + 1}`}
      type="button"
    >
      <TrashIcon />
    </button>
  );
}

function RowMessages({
  idSuffix,
  row,
}: {
  idSuffix: string;
  row: OnboardingProductDraft;
}) {
  const identificationErrorId = `${row.id}-${idSuffix}-identification-error`;

  return (
    <>
      {row.errors.identifying_details ? (
        <p className="mt-2 text-xs font-medium text-red-200" id={identificationErrorId} role="alert">
          {row.errors.identifying_details}
        </p>
      ) : null}
      {row.error ? (
        <p className="mt-2 rounded-lg border border-red-300/20 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-100" role="alert">
          {row.error}
        </p>
      ) : null}
      {row.status === "saving" ? (
        <p className="mt-2 text-xs text-orange-200" role="status">Saving this product...</p>
      ) : null}
    </>
  );
}

function SavedBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`inline-flex items-center justify-center rounded-full border border-emerald-300/25 bg-emerald-300/10 font-semibold text-emerald-100 ${compact ? "h-8 px-2 text-[0.65rem]" : "px-2.5 py-1 text-xs"}`}>
      Saved
    </span>
  );
}

function ProductEntryLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="mt-6 space-y-3">
      <div className="h-4 w-48 animate-pulse rounded bg-white/15" />
      {Array.from({ length: 2 }).map((_, index) => (
        <div className="h-28 animate-pulse rounded-2xl bg-white/[0.08]" key={index} />
      ))}
      <span className="sr-only">Loading product categories and suggestions</span>
    </div>
  );
}

function ProductEntryLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mt-6 rounded-2xl border border-red-300/20 bg-red-500/10 p-5">
      <h3 className="font-semibold text-white">Product options unavailable</h3>
      <p className="mt-2 text-sm leading-6 text-red-100" role="alert">{message}</p>
      <div className="mt-4 [&>button]:w-full sm:[&>button]:w-auto">
        <Button onClick={onRetry}>Try again</Button>
      </div>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

const entryControlClass =
  "min-h-11 w-full min-w-0 rounded-xl border border-white/15 bg-[#132750] px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-orange-300 focus:ring-2 focus:ring-orange-300/20 disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-slate-400";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
