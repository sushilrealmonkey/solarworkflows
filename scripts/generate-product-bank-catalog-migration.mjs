import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const sourceDirectory = process.argv[2];
const outputDirectory = process.argv[3];

if (!sourceDirectory || !outputDirectory) {
  throw new Error(
    "Usage: node scripts/generate-product-bank-catalog-migration.mjs <csv-directory> <output-migrations-directory>",
  );
}

const categoryTypes = {
  "AC Cable": "AC_CABLE",
  "Connectors & Cable Accessories": "ACCESSORY",
  "DC Cable": "DC_CABLE",
  "Electrical Protection & Switchgear": "PROTECTION_DEVICE",
  "Metering & Monitoring": "MONITORING_DEVICE",
  "Solar Batteries & Energy Storage": "BATTERY",
  "Solar Inverter": "INVERTER",
  "Solar Panel": "SOLAR_PANEL",
};

const units = {
  nos: "piece",
  meter: "meter",
  roll: "roll",
};

const requiredColumns = [
  "Category",
  "Brand",
  "Model / Product",
  "Specification",
  "Unit",
  "HSN",
  "GST %",
];

function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("CSV has an unterminated quoted field.");
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows;
}

function normalize(value) {
  const text = value?.trim() ?? "";
  return text || null;
}

const names = (await readdir(resolve(sourceDirectory)))
  .filter((name) => /^bizlee-.*-product-bank\.csv$/i.test(name))
  .sort();

if (names.length !== Object.keys(categoryTypes).length) {
  throw new Error(`Expected ${Object.keys(categoryTypes).length} Product Bank CSV files, found ${names.length}.`);
}

const products = [];
const productKeys = new Set();

for (const name of names) {
  const source = await readFile(resolve(sourceDirectory, name), "utf8");
  const [headerRow, ...dataRows] = parseCsv(source.replace(/^\uFEFF/, ""));

  if (!headerRow || requiredColumns.some((column) => !headerRow.includes(column))) {
    throw new Error(`${name} does not have the required Product Bank columns.`);
  }

  const columnIndex = new Map(headerRow.map((column, index) => [column, index]));

  for (const [rowNumber, row] of dataRows.entries()) {
    if (row.every((value) => value.trim() === "")) continue;

    const category = normalize(row[columnIndex.get("Category")]);
    const categoryType = category ? categoryTypes[category] : undefined;
    const productName = normalize(row[columnIndex.get("Model / Product")]);
    const unit = units[(normalize(row[columnIndex.get("Unit")]) ?? "").toLowerCase()];
    const gstPercent = Number(normalize(row[columnIndex.get("GST %")]));

    if (!categoryType || !productName || !unit || !Number.isFinite(gstPercent) || gstPercent < 0) {
      throw new Error(`${name}, row ${rowNumber + 2} has an unsupported category, unit, or GST value.`);
    }

    const product = {
      category_type: categoryType,
      product_name: productName,
      brand: normalize(row[columnIndex.get("Brand")]),
      specifications: normalize(row[columnIndex.get("Specification")]),
      unit,
      hsn_code: normalize(row[columnIndex.get("HSN")]),
      gst_percent: gstPercent,
    };
    const key = JSON.stringify(product);

    if (productKeys.has(key)) {
      throw new Error(`${name}, row ${rowNumber + 2} duplicates another Product Bank item.`);
    }

    productKeys.add(key);
    products.push(product);
  }
}

const categoryTypeList = Object.values(categoryTypes).map((value) => `'${value}'`).join(", ");
const maxPayloadBytes = 400_000;
const productBatches = [];
let batch = [];
let batchLength = 2;

for (const product of products) {
  const item = JSON.stringify(product);
  const separatorLength = batch.length === 0 ? 0 : 1;

  if (batch.length > 0 && batchLength + separatorLength + item.length > maxPayloadBytes) {
    productBatches.push(batch);
    batch = [];
    batchLength = 2;
  }

  batch.push(product);
  batchLength += (batch.length === 1 ? 0 : 1) + item.length;
}

if (batch.length > 0) productBatches.push(batch);

function buildSql(payload, batchNumber) {
  return `-- Seeds Product Bank catalog items from the reviewed Bizlee CSVs, part ${batchNumber} of ${productBatches.length}.
-- The owner is resolved from the active platform administrator so no company is hard-coded.

do $$
begin
  if not exists (
    select 1
    from public.users_profile
    where is_super_admin = true
      and status = 'active'
      and company_id is not null
  ) then
    raise exception 'An active platform administrator with a company is required to seed Product Bank items';
  end if;

  if (
    select count(*)
    from public.catalog_library_categories
    where category_type::text in (${categoryTypeList})
  ) <> ${Object.keys(categoryTypes).length} then
    raise exception 'The required Product Bank categories are not configured';
  end if;
end;
$$;

with platform_owner as (
  select company_id
  from public.users_profile
  where is_super_admin = true
    and status = 'active'
    and company_id is not null
  order by created_at, id
  limit 1
), catalog_input as (
  select *
  from jsonb_to_recordset($product_bank_catalog$${payload}$product_bank_catalog$::jsonb)
    as source(
      category_type text,
      product_name text,
      brand text,
      specifications text,
      unit text,
      hsn_code text,
      gst_percent numeric
    )
)
insert into public.catalog_library_products (
  company_id,
  category_id,
  product_name,
  brand,
  specifications,
  unit,
  hsn_code,
  gst_percent,
  publication_status
)
select
  platform_owner.company_id,
  category.id,
  catalog_input.product_name,
  catalog_input.brand,
  catalog_input.specifications,
  catalog_input.unit,
  catalog_input.hsn_code,
  catalog_input.gst_percent,
  'published'
from catalog_input
join public.catalog_library_categories category
  on category.category_type::text = catalog_input.category_type
cross join platform_owner
where not exists (
  select 1
  from public.catalog_library_products existing
  where existing.company_id = platform_owner.company_id
    and existing.category_id = category.id
    and existing.product_name = catalog_input.product_name
    and existing.brand is not distinct from catalog_input.brand
    and existing.specifications is not distinct from catalog_input.specifications
    and existing.unit = catalog_input.unit
    and existing.hsn_code is not distinct from catalog_input.hsn_code
    and existing.gst_percent = catalog_input.gst_percent
);

notify pgrst, 'reload schema';
`;
}

await mkdir(resolve(outputDirectory), { recursive: true });

for (const [index, productBatch] of productBatches.entries()) {
  const version = `202609080915${String(index + 1).padStart(2, "0")}`;
  const outputPath = resolve(outputDirectory, `${version}_seed_product_bank_catalog_part_${String(index + 1).padStart(2, "0")}.sql`);
  await writeFile(outputPath, buildSql(JSON.stringify(productBatch), index + 1), "utf8");
}

console.log(`Generated ${products.length} Product Bank items across ${productBatches.length} migrations.`);
