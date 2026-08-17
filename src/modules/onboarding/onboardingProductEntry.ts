import type { CompanyOnboardingProgress, OnboardingStep } from "./types";
import {
  buildGeneratedProductName,
  emptyProductForm,
  validateProductForm,
} from "../product-master/productFormCore.ts";
import type {
  ProductCategory,
  ProductFormValues,
} from "../product-master/types";
import { quotationQuickProductIdentificationError } from "../quotations/quotationQuickProduct.ts";

export type OnboardingProductDraftStatus =
  | "draft"
  | "saving"
  | "saved"
  | "error";

export type OnboardingProductDraftErrors = {
  category_id?: string;
  identifying_details?: string;
  product_name?: string;
  unit?: string;
};

export type OnboardingProductDraft = {
  id: string;
  values: ProductFormValues;
  errors: OnboardingProductDraftErrors;
  status: OnboardingProductDraftStatus;
  error: string | null;
  createdProductId: string | null;
};

export type ProductEntryExitAction = "complete" | "skip" | "back";

export function createOnboardingProductDraft(id: string): OnboardingProductDraft {
  return {
    id,
    values: emptyProductForm(),
    errors: {},
    status: "draft",
    error: null,
    createdProductId: null,
  };
}

export function appendOnboardingProductDraft(
  rows: OnboardingProductDraft[],
  nextRow: OnboardingProductDraft,
) {
  return [...rows, nextRow];
}

export function removeOnboardingProductDraft(
  rows: OnboardingProductDraft[],
  id: string,
  blankReplacement: OnboardingProductDraft,
) {
  const remaining = rows.filter((row) => row.id !== id);
  return remaining.length ? remaining : [blankReplacement];
}

export function updateOnboardingProductDraftValue(
  row: OnboardingProductDraft,
  key: keyof ProductFormValues,
  value: string,
): OnboardingProductDraft {
  if (row.status === "saved") return row;

  const clearsIdentificationError = [
    "brand",
    "model_number",
    "specifications",
  ].includes(key);

  return {
    ...row,
    values: { ...row.values, [key]: value },
    errors: {
      ...row.errors,
      [key]: undefined,
      ...(clearsIdentificationError
        ? { identifying_details: undefined }
        : {}),
    },
    status: "draft",
    error: null,
  };
}

export function isOnboardingProductDraftEmpty(row: OnboardingProductDraft) {
  return [
    row.values.category_id,
    row.values.brand,
    row.values.model_number,
    row.values.specifications,
  ].every((value) => !value.trim());
}

export function prepareOnboardingProductValues(
  row: OnboardingProductDraft,
  categories: ProductCategory[],
): ProductFormValues {
  const values = { ...row.values, status: "active" as const };

  return {
    ...values,
    product_name: buildGeneratedProductName(values, categories),
  };
}

export function validateOnboardingProductDraft(
  row: OnboardingProductDraft,
  categories: ProductCategory[],
) {
  const values = prepareOnboardingProductValues(row, categories);
  const productErrors = validateProductForm(values);
  const errors: OnboardingProductDraftErrors = {
    category_id: productErrors.category_id,
    product_name: productErrors.product_name,
    unit: productErrors.unit,
    identifying_details: quotationQuickProductIdentificationError(values),
  };

  return { values, errors };
}

type ProductCreateResult = { id: string };

export type SaveOnboardingProductDraftsResult = {
  rows: OnboardingProductDraft[];
  attemptedCount: number;
  savedCount: number;
  failedCount: number;
  validationBlocked: boolean;
  allSaved: boolean;
};

export async function saveOnboardingProductDrafts(
  rows: OnboardingProductDraft[],
  categories: ProductCategory[],
  createProductRecord: (
    values: ProductFormValues,
  ) => Promise<ProductCreateResult>,
  onRowsChange?: (rows: OnboardingProductDraft[]) => void,
): Promise<SaveOnboardingProductDraftsResult> {
  let nextRows = rows.map((row) => {
    if (row.status === "saved" || isOnboardingProductDraftEmpty(row)) {
      return row.status === "saved"
        ? row
        : { ...row, errors: {}, error: null, status: "draft" as const };
    }

    const { errors } = validateOnboardingProductDraft(row, categories);
    return { ...row, errors, error: null, status: "draft" as const };
  });

  const validationBlocked = nextRows.some(
    (row) =>
      row.status !== "saved" &&
      !isOnboardingProductDraftEmpty(row) &&
      Object.values(row.errors).some(Boolean),
  );

  if (validationBlocked) {
    onRowsChange?.(nextRows);
    return resultForRows(nextRows, 0, 0, 0, true);
  }

  let attemptedCount = 0;
  let savedCount = 0;
  let failedCount = 0;

  for (let index = 0; index < nextRows.length; index += 1) {
    const row = nextRows[index];
    if (row.status === "saved" || isOnboardingProductDraftEmpty(row)) continue;

    attemptedCount += 1;
    nextRows = replaceRow(nextRows, index, {
      ...row,
      status: "saving",
      error: null,
    });
    onRowsChange?.(nextRows);

    try {
      const values = prepareOnboardingProductValues(row, categories);
      const createdProduct = await createProductRecord(values);
      savedCount += 1;
      nextRows = replaceRow(nextRows, index, {
        ...nextRows[index],
        values,
        status: "saved",
        error: null,
        createdProductId: createdProduct.id,
      });
    } catch (error) {
      failedCount += 1;
      nextRows = replaceRow(nextRows, index, {
        ...nextRows[index],
        status: "error",
        error: errorMessage(error),
      });
    }

    onRowsChange?.(nextRows);
  }

  return resultForRows(
    nextRows,
    attemptedCount,
    savedCount,
    failedCount,
    false,
  );
}

export async function runWithSubmissionLock<T>(
  lock: { current: boolean },
  task: () => Promise<T>,
): Promise<{ started: false } | { started: true; value: T }> {
  if (lock.current) return { started: false };

  lock.current = true;
  try {
    return { started: true, value: await task() };
  } finally {
    lock.current = false;
  }
}

export function transitionForProductEntryAction(
  action: ProductEntryExitAction,
): { nextStep: OnboardingStep; route: string } {
  if (action === "back") {
    return { nextStep: "products", route: "/onboarding/products" };
  }

  return { nextStep: "team", route: "/onboarding/team" };
}

export async function runProductEntryTransition(
  action: ProductEntryExitAction,
  {
    persist,
    commit,
    navigate,
  }: {
    persist: (step: OnboardingStep) => Promise<CompanyOnboardingProgress>;
    commit: (progress: CompanyOnboardingProgress) => void;
    navigate: (route: string) => void;
  },
) {
  const transition = transitionForProductEntryAction(action);
  const progress = await persist(transition.nextStep);
  commit(progress);
  navigate(transition.route);
  return progress;
}

function replaceRow(
  rows: OnboardingProductDraft[],
  index: number,
  row: OnboardingProductDraft,
) {
  return rows.map((current, currentIndex) =>
    currentIndex === index ? row : current,
  );
}

function resultForRows(
  rows: OnboardingProductDraft[],
  attemptedCount: number,
  savedCount: number,
  failedCount: number,
  validationBlocked: boolean,
): SaveOnboardingProductDraftsResult {
  return {
    rows,
    attemptedCount,
    savedCount,
    failedCount,
    validationBlocked,
    allSaved: rows.every(
      (row) => row.status === "saved" || isOnboardingProductDraftEmpty(row),
    ),
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "This product could not be saved.";
}
