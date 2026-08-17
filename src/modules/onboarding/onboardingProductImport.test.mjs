import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import {
  buildProductImportTemplateCsv,
  importProductRows,
  matchProductImportCategory,
  matchProductImportUnit,
  parseProductImportCsv,
  parseProductImportFile,
  parseProductImportMatrix,
  productImportRowStatus,
  productImportTemplateExample,
  productImportTemplateHeaders,
  PRODUCT_IMPORT_MAX_FILE_BYTES,
  removeProductImportRow,
  updateProductImportRowValue,
  validateProductImportFile,
} from "./onboardingProductImport.ts";
import { runWithSubmissionLock } from "./onboardingProductEntry.ts";

const panelCategory = {
  id: "category-panel",
  tenant_id: "organization-1",
  name: "Solar Panels",
  category_type: "SOLAR_PANEL",
  display_order: 1,
  description: null,
  is_active: true,
  created_at: null,
  updated_at: null,
};

const inverterCategory = {
  ...panelCategory,
  id: "category-inverter",
  name: "Inverters",
  category_type: "INVERTER",
  display_order: 2,
};

const categories = [panelCategory, inverterCategory];
const headers = [...productImportTemplateHeaders];
const validRow = [
  "Solar Panels",
  "Waaree",
  "WS-550",
  "550W Mono PERC",
  "Nos",
  "85414300",
  "12",
];

test("the import template contains the seven requested columns and one example row", () => {
  const parsed = parseProductImportCsv(buildProductImportTemplateCsv());

  assert.deepEqual(parsed[0], [...productImportTemplateHeaders]);
  assert.deepEqual(parsed[1], [...productImportTemplateExample]);
  assert.equal(parsed.length, 2);
});

test("valid CSV parses into review state without importing", async () => {
  const csv = `${headers.join(",")}\n${validRow.join(",")}`;
  const rows = await parseProductImportFile(textFile("products.csv", csv), categories);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "draft");
  assert.equal(productImportRowStatus(rows[0]), "Ready");
  assert.equal(rows[0].createdProductId, null);
});

test("CSV quoted values can contain commas and escaped quotes", () => {
  const matrix = parseProductImportCsv('Category,Brand,Model / Product,Unit\nSolar Panels,"Brand, Inc.","WS-""550",Nos');

  assert.equal(matrix[1][1], "Brand, Inc.");
  assert.equal(matrix[1][2], 'WS-"550');
});

test("completely empty rows are ignored", () => {
  const rows = parseProductImportMatrix([headers, [], ["", "", ""], validRow], categories);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].sourceRowNumber, 4);
});

test("unsupported files are rejected", () => {
  assert.throws(
    () => validateProductImportFile({ name: "products.xls", size: 100 }),
    /Choose a \.csv or \.xlsx product list/,
  );
});

test("empty files are rejected", () => {
  assert.throws(
    () => validateProductImportFile({ name: "products.csv", size: 0 }),
    /file is empty/,
  );
});

test("files larger than five MB are rejected", () => {
  assert.throws(
    () => validateProductImportFile({ name: "products.csv", size: PRODUCT_IMPORT_MAX_FILE_BYTES + 1 }),
    /larger than 5 MB/,
  );
});

test("missing Category header produces a useful error", () => {
  assert.throws(
    () => parseProductImportMatrix([["Brand", "Model", "Unit"], ["Waaree", "WS-550", "Nos"]], categories),
    /couldn't identify the Category column/,
  );
});

test("missing Unit header produces a useful error", () => {
  assert.throws(
    () => parseProductImportMatrix([["Category", "Model"], ["Solar Panels", "WS-550"]], categories),
    /couldn't identify the Unit column/,
  );
});

test("at least one identifying-detail column must be recognizable", () => {
  assert.throws(
    () => parseProductImportMatrix([["Category", "Unit", "HSN"], ["Solar Panels", "Nos", "1234"]], categories),
    /Brand, Model \/ Product, or Specification column/,
  );
});

test("harmless header aliases are recognized", () => {
  const [row] = parseProductImportMatrix(
    [["Product Category", "Make", "Model", "Spec", "UOM", "HSN Code", "GST"], validRow],
    categories,
  );

  assert.equal(row.values.category_id, panelCategory.id);
  assert.equal(row.values.unit, "piece");
  assert.equal(row.values.gst_percent, "12");
});

test("category matching is case-insensitive and trims whitespace", () => {
  assert.equal(matchProductImportCategory("  solar panels ", categories)?.id, panelCategory.id);
});

test("inactive categories are not matched", () => {
  assert.equal(
    matchProductImportCategory("Solar Panels", [{ ...panelCategory, is_active: false }]),
    null,
  );
});

test("unknown category remains visible as a review error", () => {
  const [row] = parseProductImportMatrix([headers, ["Unknown", ...validRow.slice(1)]], categories);

  assert.equal(row.values.category_id, "");
  assert.match(row.errors.category_id, /Unknown/);
  assert.equal(productImportRowStatus(row), "Needs attention");
});

test("obvious unit aliases map to canonical Product Master units", () => {
  const examples = {
    Nos: "piece",
    Pieces: "piece",
    MTR: "meter",
    Kilograms: "kg",
    Sets: "set",
    kW: "kw",
  };

  for (const [source, expected] of Object.entries(examples)) {
    assert.equal(matchProductImportUnit(source), expected);
  }
});

test("unknown units remain visible as a review error", () => {
  const [row] = parseProductImportMatrix([headers, [...validRow.slice(0, 4), "Crate", ...validRow.slice(5)]], categories);

  assert.equal(row.values.unit, "");
  assert.match(row.errors.unit, /Crate/);
});

test("text HSN values preserve leading zeroes", () => {
  const [row] = parseProductImportMatrix([headers, [...validRow.slice(0, 5), "001234", "12"]], categories);

  assert.equal(row.values.hsn_code, "001234");
});

test("numeric HSN cells normalize to plain text", () => {
  const [row] = parseProductImportMatrix([headers, [...validRow.slice(0, 5), 85414300, 12]], categories);

  assert.equal(row.values.hsn_code, "85414300");
});

test("GST values with a percent suffix normalize safely", () => {
  const [row] = parseProductImportMatrix([headers, [...validRow.slice(0, 6), "18%"]], categories);

  assert.equal(row.values.gst_percent, "18");
  assert.equal(row.errors.gst_percent, undefined);
});

test("blank GST follows the Product Master zero default", () => {
  const [row] = parseProductImportMatrix([headers, [...validRow.slice(0, 6), ""]], categories);

  assert.equal(row.values.gst_percent, "0");
});

test("non-numeric and impossible GST values are rejected", () => {
  const [textRow, highRow] = parseProductImportMatrix(
    [headers, [...validRow.slice(0, 6), "GST"], [...validRow.slice(0, 6), "101"]],
    categories,
  );

  assert.match(textRow.errors.gst_percent, /valid number/);
  assert.match(highRow.errors.gst_percent, /greater than 100/);
});

test("review rows are editable and revalidated", () => {
  const [invalid] = parseProductImportMatrix([headers, ["Unknown", ...validRow.slice(1)]], categories);
  const corrected = updateProductImportRowValue(invalid, "category_id", panelCategory.id, categories);

  assert.equal(corrected.values.category_id, panelCategory.id);
  assert.equal(corrected.errors.category_id, undefined);
  assert.equal(productImportRowStatus(corrected), "Ready");
});

test("unimported rows can be removed", () => {
  const rows = parseProductImportMatrix([headers, validRow, ["Inverters", "Sungrow", "SG5", "", "Set", "", "18"]], categories);

  assert.deepEqual(removeProductImportRow(rows, rows[0].id).map((row) => row.id), [rows[1].id]);
});

test("invalid rows block the entire import before create calls", async () => {
  const rows = parseProductImportMatrix([headers, validRow, ["Unknown", "", "X", "", "Nos", "", "0"]], categories);
  let createCalls = 0;
  const result = await importProductRows(rows, categories, async () => {
    createCalls += 1;
    return { id: "unexpected" };
  });

  assert.equal(result.validationBlocked, true);
  assert.equal(createCalls, 0);
});

test("valid rows use the existing createProduct field contract", async () => {
  const rows = parseProductImportMatrix([headers, validRow], categories);
  const submitted = [];
  const result = await importProductRows(rows, categories, async (values) => {
    submitted.push(values);
    return { id: "product-1" };
  });

  assert.equal(result.allImported, true);
  assert.deepEqual(
    {
      category_id: submitted[0].category_id,
      product_name: submitted[0].product_name,
      brand: submitted[0].brand,
      model_number: submitted[0].model_number,
      specifications: submitted[0].specifications,
      unit: submitted[0].unit,
      hsn_code: submitted[0].hsn_code,
      gst_percent: submitted[0].gst_percent,
      status: submitted[0].status,
    },
    {
      category_id: panelCategory.id,
      product_name: "Waaree Solar Panels WS-550 550W Mono PERC",
      brand: "Waaree",
      model_number: "WS-550",
      specifications: "550W Mono PERC",
      unit: "piece",
      hsn_code: "85414300",
      gst_percent: "12",
      status: "active",
    },
  );
});

test("multiple products are imported sequentially with progress", async () => {
  const rows = parseProductImportMatrix([headers, validRow, ["Inverters", "Sungrow", "SG5", "", "Set", "", "18"]], categories);
  let active = 0;
  let maximumActive = 0;
  const progress = [];
  const result = await importProductRows(
    rows,
    categories,
    async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return { id: `product-${Math.random()}` };
    },
    undefined,
    (completed, total) => progress.push([completed, total]),
  );

  assert.equal(maximumActive, 1);
  assert.equal(result.importedCount, 2);
  assert.deepEqual(progress, [[1, 2], [2, 2]]);
});

test("the submission lock prevents a duplicate in-flight import", async () => {
  const lock = { current: false };
  let release;
  let calls = 0;
  const first = runWithSubmissionLock(lock, async () => {
    calls += 1;
    await new Promise((resolve) => { release = resolve; });
  });
  const duplicate = await runWithSubmissionLock(lock, async () => { calls += 1; });

  assert.deepEqual(duplicate, { started: false });
  assert.equal(calls, 1);
  release();
  await first;
});

test("partial failure preserves successes and retry never recreates them", async () => {
  const rows = parseProductImportMatrix([headers, validRow, ["Inverters", "Sungrow", "SG5", "", "Set", "", "18"]], categories);
  const calls = [];
  const first = await importProductRows(rows, categories, async (values) => {
    calls.push(values.model_number);
    if (values.model_number === "SG5") throw new Error("Duplicate product");
    return { id: "product-panel" };
  });

  assert.deepEqual(first.rows.map((row) => row.status), ["imported", "failed"]);
  assert.equal(first.rows[1].backendError, "Duplicate product");
  const retry = await importProductRows(first.rows, categories, async (values) => {
    calls.push(values.model_number);
    return { id: "product-inverter" };
  });

  assert.deepEqual(calls, ["WS-550", "SG5", "SG5"]);
  assert.equal(retry.attemptedCount, 1);
  assert.equal(retry.allImported, true);
});

test("failed rows can be corrected and retried", async () => {
  const [row] = parseProductImportMatrix([headers, validRow], categories);
  const failed = (await importProductRows([row], categories, async () => { throw new Error("Duplicate"); })).rows[0];
  const corrected = updateProductImportRowValue(failed, "model_number", "WS-550-B", categories);

  assert.equal(corrected.status, "draft");
  assert.equal(corrected.backendError, null);
  assert.equal((await importProductRows([corrected], categories, async () => ({ id: "new" }))).allImported, true);
});

test("imported rows are locked against editing and removal", async () => {
  const [row] = parseProductImportMatrix([headers, validRow], categories);
  const imported = (await importProductRows([row], categories, async () => ({ id: "saved" }))).rows[0];

  assert.equal(updateProductImportRowValue(imported, "brand", "Changed", categories).values.brand, "Waaree");
  assert.deepEqual(removeProductImportRow([imported], imported.id), [imported]);
});

test("valid XLSX parses the first relevant worksheet", async () => {
  const workbook = createXlsx([
    { name: "Notes", rows: [] },
    { name: "Products", rows: [headers, validRow] },
  ]);
  const rows = await parseProductImportFile(binaryFile("products.xlsx", workbook), categories);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].values.model_number, "WS-550");
  assert.equal(rows[0].values.hsn_code, "85414300");
});

function textFile(name, contents) {
  return {
    name,
    size: Buffer.byteLength(contents),
    text: async () => contents,
    arrayBuffer: async () => new TextEncoder().encode(contents).buffer,
  };
}

function binaryFile(name, bytes) {
  return {
    name,
    size: bytes.byteLength,
    text: async () => "",
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function createXlsx(sheets) {
  const files = {
    "[Content_Types].xml": xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
        <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
        ${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}
      </Types>`),
    "_rels/.rels": xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
      </Relationships>`),
    "xl/workbook.xml": xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets>${sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets>
      </workbook>`),
    "xl/_rels/workbook.xml.rels": xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        ${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}
        <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
      </Relationships>`),
    "xl/styles.xml": xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <numFmts count="0"/><cellXfs count="1"><xf numFmtId="0"/></cellXfs>
      </styleSheet>`),
  };

  sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
        ${sheet.rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => `<c r="${columnName(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t>${escapeXml(String(value))}</t></is></c>`).join("")}</row>`).join("")}
      </sheetData></worksheet>`);
  });

  return zipSync(files);
}

function xml(value) {
  return strToU8(value.replace(/>\s+</g, "><").trim());
}

function escapeXml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function columnName(index) {
  let name = "";
  let value = index + 1;
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}
