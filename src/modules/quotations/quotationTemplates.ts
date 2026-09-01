export const quotationTemplateIds = ["aurora", "meridian"] as const;

export type QuotationTemplateId = (typeof quotationTemplateIds)[number];

export type QuotationTemplateDefinition = {
  id: QuotationTemplateId;
  name: string;
  eyebrow: string;
  description: string;
  palette: string;
};

export const quotationTemplates: QuotationTemplateDefinition[] = [
  {
    id: "aurora",
    name: "Aurora",
    eyebrow: "Editorial proposal",
    description: "A light, spacious layout with a hero image and calm section cards.",
    palette: "Soft white · sage · forest",
  },
  {
    id: "meridian",
    name: "Meridian",
    eyebrow: "Executive solar brief",
    description: "A confident navy layout with structured tables and a high-contrast cover.",
    palette: "Navy · sky · amber",
  },
];

export function normalizeQuotationTemplate(value: unknown): QuotationTemplateId {
  return value === "meridian" ? "meridian" : "aurora";
}
