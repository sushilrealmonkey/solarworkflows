import {
  buildGeneratedProductName,
  emptyProductForm,
  productUnitOptions,
  validateProductForm,
} from "../product-master/productFormCore.ts";
import type {
  ProductCategory,
  ProductFormValues,
  ProductUnit,
} from "../product-master/types.ts";
import { quotationQuickProductIdentificationError } from "../quotations/quotationQuickProduct.ts";

export const PRODUCT_IMPORT_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMPORT_MAX_ROWS = 2_000;
export const PRODUCT_IMPORT_ACCEPT = ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const PRODUCT_IMPORT_TEMPLATE_FILENAME = "bizlee-product-import-template.csv";

export const productImportTemplateHeaders = [
  "Category",
  "Brand",
  "Model / Product",
  "Specification",
  "Unit",
  "HSN",
  "GST %",
] as const;

export const productImportTemplateExample = [
  "Solar Panel",
  "Waaree",
  "WS-550",
  "550W Mono PERC",
  "Nos",
  "85414300",
  "12",
] as const;

export type ProductImportStatus =
  | "draft"
  | "importing"
  | "imported"
  | "failed";

export type ProductImportErrors = Partial<
  Record<
    | "category_id"
    | "brand"
    | "model_number"
    | "specifications"
    | "identifying_details"
    | "product_name"
    | "unit"
    | "hsn_code"
    | "gst_percent",
    string
  >
>;

export type ProductImportRow = {
  id: string;
  sourceRowNumber: number;
  sourceCategory: string;
  sourceUnit: string;
  values: ProductFormValues;
  errors: ProductImportErrors;
  status: ProductImportStatus;
  backendError: string | null;
  createdProductId: string | null;
};

type ImportFile = Pick<File, "name" | "size" | "text" | "arrayBuffer">;

type ProductCreateResult = { id: string };

export type ImportProductRowsResult = {
  rows: ProductImportRow[];
  attemptedCount: number;
  importedCount: number;
  failedCount: number;
  validationBlocked: boolean;
  allImported: boolean;
};

type ProductImportField =
  | "category"
  | "brand"
  | "model_number"
  | "specifications"
  | "unit"
  | "hsn_code"
  | "gst_percent";

const headerAliases: Record<ProductImportField, readonly string[]> = {
  category: ["category", "product category"],
  brand: ["brand", "make"],
  model_number: [
    "model product",
    "model",
    "product",
    "product name",
    "model number",
  ],
  specifications: ["specification", "specifications", "spec"],
  unit: ["unit", "uom", "unit of measure"],
  hsn_code: ["hsn", "hsn code"],
  gst_percent: ["gst", "gst percent", "gst rate"],
};

const unitAliases: Record<ProductUnit, readonly string[]> = {
  piece: [
    "piece",
    "pieces",
    "pc",
    "pcs",
    "no",
    "nos",
    "number",
    "numbers",
    "unit",
    "units",
  ],
  set: ["set", "sets"],
  roll: ["roll", "rolls"],
  meter: ["meter", "meters", "metre", "metres", "m", "mtr", "mtrs"],
  kg: ["kg", "kgs", "kilogram", "kilograms"],
  watt: ["watt", "watts", "w"],
  kw: ["kw", "kilowatt", "kilowatts"],
  lot: ["lot", "lots"],
};

export function buildProductImportTemplateCsv() {
  return `\uFEFF${[productImportTemplateHeaders, productImportTemplateExample]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n")}\r\n`;
}

export function parseProductImportCsv(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  const input = csv.replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  if (quoted) {
    throw new Error("This CSV has an unfinished quoted value. Update the file and try again.");
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

export async function parseProductImportFile(
  file: ImportFile,
  categories: ProductCategory[],
) {
  validateProductImportFile(file);
  const extension = file.name.toLowerCase().split(".").pop();

  try {
    if (extension === "csv") {
      return parseProductImportMatrix(
        parseProductImportCsv(await file.text()),
        categories,
      );
    }

    const { default: readWorkbook } = await import("read-excel-file/universal");
    const sheets = await readWorkbook(await file.arrayBuffer());
    const relevantSheet = sheets.find((sheet) => hasNonEmptyRow(sheet.data));

    if (!relevantSheet) {
      throw new Error("This workbook does not contain any usable rows.");
    }

    return parseProductImportMatrix(relevantSheet.data, categories);
  } catch (error) {
    if (error instanceof Error && isFriendlyImportError(error.message)) {
      throw error;
    }

    throw new Error(
      extension === "xlsx"
        ? "We couldn't read this workbook. Make sure it is a valid .xlsx file and try again."
        : "We couldn't read this CSV file. Check its structure and try again.",
    );
  }
}

export function validateProductImportFile(file: Pick<ImportFile, "name" | "size">) {
  const extension = file.name.toLowerCase().split(".").pop();

  if (extension !== "csv" && extension !== "xlsx") {
    throw new Error("Choose a .csv or .xlsx product list.");
  }

  if (file.size === 0) {
    throw new Error("This file is empty. Choose a product list with at least one row.");
  }

  if (file.size > PRODUCT_IMPORT_MAX_FILE_BYTES) {
    throw new Error("This file is larger than 5 MB. Split it into smaller product lists and try again.");
  }
}

export function parseProductImportMatrix(
  matrix: readonly (readonly unknown[])[],
  categories: ProductCategory[],
) {
  const normalizedRows = matrix
    .map((row, index) => ({
      sourceRowNumber: index + 1,
      cells: row.map(cellText),
    }))
    .filter(({ cells }) => cells.some((cell) => cell.trim()));

  if (normalizedRows.length === 0) {
    throw new Error("This file does not contain any usable rows.");
  }

  const headerRow = normalizedRows[0];
  const columns = detectColumns(headerRow.cells);
  assertRequiredColumns(columns);

  const dataRows = normalizedRows.slice(1);
  if (dataRows.length === 0) {
    throw new Error("No products were found below the header row.");
  }

  if (dataRows.length > PRODUCT_IMPORT_MAX_ROWS) {
    throw new Error(
      `This file contains more than ${PRODUCT_IMPORT_MAX_ROWS.toLocaleString()} products. Split it into smaller product lists and try again.`,
    );
  }

  return dataRows.map(({ cells, sourceRowNumber }, index) =>
    createProductImportRow(
      `product-import-${index + 1}`,
      sourceRowNumber,
      cells,
      columns,
      categories,
    ),
  );
}

export function validateProductImportRow(
  row: ProductImportRow,
  categories: ProductCategory[],
) {
  const values = prepareProductImportValues(row, categories);
  const productErrors = validateProductForm(values);
  const gstValue = values.gst_percent.trim() ? Number(values.gst_percent) : 0;
  const errors: ProductImportErrors = {
    category_id: row.sourceCategory && !values.category_id
      ? `Category "${row.sourceCategory}" does not match an available Product Master category.`
      : productErrors.category_id,
    identifying_details: quotationQuickProductIdentificationError(values),
    product_name: productErrors.product_name,
    unit: row.sourceUnit && !values.unit
      ? `Unit "${row.sourceUnit}" is not recognized. Choose an available unit.`
      : productErrors.unit,
    gst_percent: productErrors.gst_percent ||
      (Number.isFinite(gstValue) && gstValue > 100
        ? "GST percent cannot be greater than 100."
        : ""),
  };

  return { values, errors: withoutEmptyErrors(errors) };
}

export function prepareProductImportValues(
  row: ProductImportRow,
  categories: ProductCategory[],
) {
  const values = { ...row.values, status: "active" as const };
  return {
    ...values,
    hsn_code: values.hsn_code.trim(),
    gst_percent: values.gst_percent.trim() || "0",
    product_name: buildGeneratedProductName(values, categories),
  };
}

export function updateProductImportRowValue(
  row: ProductImportRow,
  key: keyof ProductFormValues,
  value: string,
  categories: ProductCategory[],
) {
  if (row.status === "imported" || row.status === "importing") return row;

  const nextRow: ProductImportRow = {
    ...row,
    sourceCategory:
      key === "category_id"
        ? categories.find((category) => category.id === value)?.name ?? ""
        : row.sourceCategory,
    sourceUnit: key === "unit" ? value : row.sourceUnit,
    values: { ...row.values, [key]: value },
    status: "draft",
    backendError: null,
  };
  const validation = validateProductImportRow(nextRow, categories);

  return { ...nextRow, ...validation };
}

export function removeProductImportRow(rows: ProductImportRow[], id: string) {
  return rows.filter((row) => row.id !== id || row.status === "imported");
}

export async function importProductRows(
  rows: ProductImportRow[],
  categories: ProductCategory[],
  createProductRecord: (
    values: ProductFormValues,
  ) => Promise<ProductCreateResult>,
  onRowsChange?: (rows: ProductImportRow[]) => void,
  onProgress?: (completed: number, total: number) => void,
): Promise<ImportProductRowsResult> {
  let nextRows = rows.map((row) => {
    if (row.status === "imported") return row;
    const validation = validateProductImportRow(row, categories);
    return { ...row, ...validation, status: "draft" as const, backendError: null };
  });
  const validationBlocked = nextRows.some(
    (row) => row.status !== "imported" && Object.values(row.errors).some(Boolean),
  );

  if (validationBlocked || nextRows.length === 0) {
    onRowsChange?.(nextRows);
    return importResult(nextRows, 0, validationBlocked);
  }

  const attemptTotal = nextRows.filter((row) => row.status !== "imported").length;
  let attemptedCount = 0;
  let completed = 0;

  for (let index = 0; index < nextRows.length; index += 1) {
    const row = nextRows[index];
    if (row.status === "imported") continue;

    attemptedCount += 1;
    nextRows = replaceRow(nextRows, index, {
      ...row,
      status: "importing",
      backendError: null,
    });
    onRowsChange?.(nextRows);

    try {
      const values = prepareProductImportValues(row, categories);
      const created = await createProductRecord(values);
      nextRows = replaceRow(nextRows, index, {
        ...nextRows[index],
        values,
        status: "imported",
        backendError: null,
        createdProductId: created.id,
      });
    } catch (error) {
      nextRows = replaceRow(nextRows, index, {
        ...nextRows[index],
        status: "failed",
        backendError: importErrorMessage(error),
      });
    }

    completed += 1;
    onRowsChange?.(nextRows);
    onProgress?.(completed, attemptTotal);
  }

  return importResult(nextRows, attemptedCount, false);
}

export function productImportRowStatus(row: ProductImportRow) {
  if (row.status === "imported") return "Imported";
  if (row.status === "failed") return "Failed";
  if (row.status === "importing") return "Importing";
  return Object.values(row.errors).some(Boolean) ? "Needs attention" : "Ready";
}

export function matchProductImportCategory(
  value: string,
  categories: ProductCategory[],
) {
  const target = normalizeComparison(value);
  return categories.find(
    (category) =>
      category.is_active !== false && normalizeComparison(category.name) === target,
  ) ?? null;
}

export function matchProductImportUnit(value: string): ProductUnit | "" {
  const target = normalizeComparison(value);
  return (
    productUnitOptions.find((unit) =>
      unitAliases[unit].some((alias) => normalizeComparison(alias) === target),
    ) ?? ""
  );
}

function createProductImportRow(
  id: string,
  sourceRowNumber: number,
  cells: string[],
  columns: Partial<Record<ProductImportField, number>>,
  categories: ProductCategory[],
) {
  const sourceCategory = columnValue(cells, columns.category);
  const sourceUnit = columnValue(cells, columns.unit);
  const category = matchProductImportCategory(sourceCategory, categories);
  const values: ProductFormValues = {
    ...emptyProductForm(),
    category_id: category?.id ?? "",
    brand: columnValue(cells, columns.brand),
    model_number: columnValue(cells, columns.model_number),
    specifications: columnValue(cells, columns.specifications),
    unit: matchProductImportUnit(sourceUnit),
    hsn_code: columnValue(cells, columns.hsn_code),
    gst_percent: normalizeGst(columnValue(cells, columns.gst_percent)),
  };
  const row: ProductImportRow = {
    id,
    sourceRowNumber,
    sourceCategory,
    sourceUnit,
    values,
    errors: {},
    status: "draft",
    backendError: null,
    createdProductId: null,
  };
  const validation = validateProductImportRow(row, categories);
  return { ...row, ...validation };
}

function detectColumns(headers: string[]) {
  const columns: Partial<Record<ProductImportField, number>> = {};

  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    for (const [field, aliases] of Object.entries(headerAliases) as Array<
      [ProductImportField, readonly string[]]
    >) {
      if (columns[field] === undefined && aliases.includes(normalized)) {
        columns[field] = index;
        break;
      }
    }
  });

  return columns;
}

function assertRequiredColumns(
  columns: Partial<Record<ProductImportField, number>>,
) {
  if (columns.category === undefined) {
    throw new Error(
      "We couldn't identify the Category column. Download the Bizlee template or update your file and try again.",
    );
  }
  if (columns.unit === undefined) {
    throw new Error(
      "We couldn't identify the Unit column. Download the Bizlee template or update your file and try again.",
    );
  }
  if (
    columns.brand === undefined &&
    columns.model_number === undefined &&
    columns.specifications === undefined
  ) {
    throw new Error(
      "We couldn't identify a Brand, Model / Product, or Specification column. Download the Bizlee template or update your file and try again.",
    );
  }
}

function normalizeGst(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "0";
  return trimmed.endsWith("%") ? trimmed.slice(0, -1).trim() : trimmed;
}

function normalizeHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/%/g, " percent ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^gst percent$/, "gst percent")
    .replace(/^model product$/, "model product");
}

function normalizeComparison(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function cellText(value: unknown) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") {
    return Number.isInteger(value) ? value.toFixed(0) : String(value);
  }
  return String(value).trim();
}

function columnValue(cells: string[], index: number | undefined) {
  return index === undefined ? "" : (cells[index] ?? "").trim();
}

function hasNonEmptyRow(matrix: readonly (readonly unknown[])[]) {
  return matrix.some((row) => row.some((cell) => cellText(cell).trim()));
}

function csvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function withoutEmptyErrors(errors: ProductImportErrors) {
  return Object.fromEntries(
    Object.entries(errors).filter(([, message]) => Boolean(message)),
  ) as ProductImportErrors;
}

function replaceRow(
  rows: ProductImportRow[],
  index: number,
  row: ProductImportRow,
) {
  return rows.map((current, currentIndex) =>
    currentIndex === index ? row : current,
  );
}

function importResult(
  rows: ProductImportRow[],
  attemptedCount: number,
  validationBlocked: boolean,
): ImportProductRowsResult {
  const importedCount = rows.filter((row) => row.status === "imported").length;
  const failedCount = rows.filter((row) => row.status === "failed").length;
  return {
    rows,
    attemptedCount,
    importedCount,
    failedCount,
    validationBlocked,
    allImported: rows.length > 0 && importedCount === rows.length,
  };
}

function importErrorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "This product could not be imported.";
}

function isFriendlyImportError(message: string) {
  return [
    "This file",
    "This CSV",
    "This workbook",
    "No products",
    "We couldn't identify",
  ].some((prefix) => message.startsWith(prefix));
}
