export const leadRequirementTypeOptions = [
  "Residential",
  "Commercial",
  "Solar Pump",
] as const;

export const addRequirementTypeOptionValue = "__add_requirement_type__";
export const maximumRequirementTypeLength = 80;

export function normalizeRequirementTypeName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function requirementTypeKey(value: string) {
  return normalizeRequirementTypeName(value).toLowerCase();
}

export function mergeLeadRequirementTypes(
  customTypes: readonly string[],
  currentValue = "",
) {
  const options: string[] = [];
  const seen = new Set<string>();

  for (const value of [
    ...leadRequirementTypeOptions,
    ...customTypes,
    currentValue,
  ]) {
    const normalized = normalizeRequirementTypeName(value);
    const key = requirementTypeKey(normalized);

    if (!normalized || seen.has(key)) {
      continue;
    }

    seen.add(key);
    options.push(normalized);
  }

  return options;
}

export function validateNewRequirementType(
  value: string,
  existingTypes: readonly string[],
) {
  const normalized = normalizeRequirementTypeName(value);

  if (!normalized) {
    return "Enter a requirement type.";
  }

  if (normalized.length > maximumRequirementTypeLength) {
    return `Requirement type must be ${maximumRequirementTypeLength} characters or fewer.`;
  }

  const normalizedKey = requirementTypeKey(normalized);
  if (existingTypes.some((type) => requirementTypeKey(type) === normalizedKey)) {
    return "This requirement type already exists.";
  }

  return "";
}
