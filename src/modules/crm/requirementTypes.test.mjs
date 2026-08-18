import assert from "node:assert/strict";
import test from "node:test";
import {
  leadRequirementTypeOptions,
  mergeLeadRequirementTypes,
  normalizeRequirementTypeName,
  validateNewRequirementType,
} from "./requirementTypes.ts";

test("new enquiries expose only the three defaults before tenant additions", () => {
  assert.deepEqual([...leadRequirementTypeOptions], [
    "Residential",
    "Commercial",
    "Solar Pump",
  ]);
  assert.deepEqual(mergeLeadRequirementTypes([]), [...leadRequirementTypeOptions]);
});

test("tenant additions are normalized and merged without case-insensitive duplicates", () => {
  assert.equal(normalizeRequirementTypeName("  Industrial   Rooftop "), "Industrial Rooftop");
  assert.deepEqual(
    mergeLeadRequirementTypes(["Industrial Rooftop", " residential ", "Factory"]),
    ["Residential", "Commercial", "Solar Pump", "Industrial Rooftop", "Factory"],
  );
});

test("an existing legacy enquiry value remains selectable only while editing it", () => {
  assert.deepEqual(mergeLeadRequirementTypes([], "Hybrid System"), [
    "Residential",
    "Commercial",
    "Solar Pump",
    "Hybrid System",
  ]);
});

test("new requirement validation rejects empty, duplicate, and oversized values", () => {
  const existing = mergeLeadRequirementTypes(["Industrial"]);

  assert.equal(validateNewRequirementType("  ", existing), "Enter a requirement type.");
  assert.equal(
    validateNewRequirementType(" industrial ", existing),
    "This requirement type already exists.",
  );
  assert.match(validateNewRequirementType("x".repeat(81), existing), /80 characters/);
  assert.equal(validateNewRequirementType("Agricultural", existing), "");
});
