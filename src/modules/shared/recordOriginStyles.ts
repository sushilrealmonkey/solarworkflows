export type RecordOrigin = "project" | "b2b" | "neutral";
export type RecordPalette = "projectFlow" | "b2bFlow" | "neutral";

type OriginLinkedRecord = {
  project_id?: string | null;
  b2b_sale_id?: string | null;
};

export function recordOriginFromLinks(record: OriginLinkedRecord): RecordOrigin {
  if (record.b2b_sale_id) {
    return "b2b";
  }

  if (record.project_id) {
    return "project";
  }

  return "neutral";
}

export function recordOriginTableRowClassName(origin: RecordOrigin) {
  return recordPaletteTableRowClassName(originToPalette(origin));
}

export function recordOriginCardClassName(origin: RecordOrigin) {
  return recordPaletteCardClassName(originToPalette(origin));
}

export function recordPaletteTableRowClassName(palette: RecordPalette) {
  switch (palette) {
    case "projectFlow":
      return "bg-sky-50 hover:bg-sky-100";
    case "b2bFlow":
      return "bg-[#e2d2bd] hover:bg-[#d8c4a7]";
    default:
      return "bg-white hover:bg-stone-50";
  }
}

export function recordPaletteCardClassName(palette: RecordPalette) {
  switch (palette) {
    case "projectFlow":
      return "border-sky-200 bg-sky-50 hover:bg-sky-100";
    case "b2bFlow":
      return "border-[#cbb493] bg-[#e2d2bd] hover:bg-[#d8c4a7]";
    default:
      return "border-stone-200 bg-white hover:bg-stone-50";
  }
}

function originToPalette(origin: RecordOrigin): RecordPalette {
  switch (origin) {
    case "project":
      return "projectFlow";
    case "b2b":
      return "b2bFlow";
    default:
      return "neutral";
  }
}
