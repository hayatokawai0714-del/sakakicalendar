const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("docs/app.js", "utf8");

function extractFunction(name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} not found`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name} body not closed`);
}

const context = {
  console,
  URLSearchParams,
  state: { recurringExceptions: [] },
  createId: () => "test-id",
  createIdFrom: (prefix, date) => `${prefix}-${date}`,
  formatDate: (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
  parseJsonArray: (value) => Array.isArray(value) ? value : [],
  parseReferenceItems: (value) => Array.isArray(value) ? value : [],
};
vm.createContext(context);
vm.runInContext([
  "isEffectiveDateDiagnosticsEnabled_",
  "isEffectiveDateRepairEnabled_",
  "diagnosticFieldPresence_",
  "diagnosticDateValue_",
  "diagnosticRecurrenceType_",
  "diagnosticRuleSummary_",
  "diagnosticRuleSeriesKey_",
  "isEffectiveDateDiagnosticCandidate_",
  "chooseEffectiveDateDiagnosticSeries_",
  "diagnosticWeightLabel_",
  "analyzeEffectiveDateDiagnostic_",
  "simulateEffectiveDateRepair_",
  "buildEffectiveDateRepairAssessment_",
  "buildEffectiveDateRepairPatch_",
  "normalizeDateKey",
  "parseDate",
  "addDaysToDateKey_",
  "recurringSeriesId_",
  "normalizeRecurringRule_",
  "normalizeRecurringRules_",
  "isWithinRuleRange",
  "getRecurringExceptions",
  "applyRecurringExceptions_",
  "generateRecurringShipmentsForMonthBase_",
  "matchesWeeklyRule",
  "parseNumberList",
  "stripTime",
  "dedupeRecurringOccurrenceVersions_",
].map(extractFunction).join("\n"), context);

context.EFFECTIVE_DATE_REPAIR_FROM_ = "2026-09-08";

context.location = { search: "" };
assert.equal(context.isEffectiveDateDiagnosticsEnabled_(), false);
context.location.search = "?debugEffectiveDate=1";
assert.equal(context.isEffectiveDateDiagnosticsEnabled_(), true);
assert.equal(context.isEffectiveDateRepairEnabled_(), false);
context.location.search = "?debugEffectiveDate=1&allowEffectiveDateRepair=1";
assert.equal(context.isEffectiveDateRepairEnabled_(), true);
context.location.search = "?allowEffectiveDateRepair=1";
assert.equal(context.isEffectiveDateRepairEnabled_(), false);
context.location.search = "?debugEffectiveDate=1";
const safeDiagnostic = context.diagnosticRuleSummary_({
  id: "secret-record-id",
  destinationName: "secret-customer-name",
  standard: "40cm",
  quantity: 30,
  unit: "kg",
  startDate: "2026-01-01",
  effectiveFrom: "2026-09-08",
});
const safeDiagnosticText = JSON.stringify(safeDiagnostic);
assert.equal(safeDiagnostic.id, "present");
assert.equal(safeDiagnostic.series, "missing");
assert.equal(safeDiagnostic.effectiveFrom, "2026-09-08");
assert.equal(safeDiagnosticText.includes("secret-record-id"), false);
assert.equal(safeDiagnosticText.includes("secret-customer-name"), false);

const oldRule = {
  id: "series",
  recurringId: "series",
  startDate: "2026-01-01",
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-09-07",
  standard: "40cm",
  quantity: 20,
  unit: "kg",
  recurrenceType: "weekly",
  weekdays: [2],
};
const futureVersionWithoutBoundary = {
  id: "series__version__v1",
  recurringId: "series",
  startDate: "2026-01-01",
  effectiveFrom: "",
  effectiveTo: "",
  standard: "40cm",
  quantity: 30,
  unit: "kg",
  recurrenceType: "weekly",
  weekdays: [2],
};

const recovered = context.normalizeRecurringRules_([oldRule, {
  ...futureVersionWithoutBoundary,
  effectiveFrom: undefined,
}]);
assert.equal(recovered[1].effectiveFrom, "2026-09-08");
assert.equal(context.isWithinRuleRange(context.parseDate("2026-09-01"), recovered[0]), true);
assert.equal(context.isWithinRuleRange(context.parseDate("2026-09-01"), recovered[1]), false);
assert.equal(context.isWithinRuleRange(context.parseDate("2026-09-07"), recovered[1]), false);
assert.equal(context.isWithinRuleRange(context.parseDate("2026-09-08"), recovered[1]), true);

const repairAssessment = context.buildEffectiveDateRepairAssessment_([oldRule, futureVersionWithoutBoundary]);
assert.equal(repairAssessment.targetCount, 1);
assert.equal(repairAssessment.precondition, true);
assert.equal(JSON.stringify(repairAssessment.simulation), JSON.stringify({
  "2026-09-01": "20KG",
  "2026-09-07": "20KG",
  "2026-09-08": "30KG",
  "2026-09-15": "30KG",
  "2026-09-22": "30KG",
}));
const repairPatch = context.buildEffectiveDateRepairPatch_(repairAssessment.candidate);
assert.deepEqual(Object.keys(repairPatch).sort(), ["effectiveFrom", "id"]);
assert.equal(repairPatch.effectiveFrom, "2026-09-08");

assert.equal(context.buildEffectiveDateRepairAssessment_([oldRule]).precondition, false);
assert.equal(context.buildEffectiveDateRepairAssessment_([
  oldRule,
  futureVersionWithoutBoundary,
  { ...futureVersionWithoutBoundary, id: "series__version__v2", quantity: 30 },
]).precondition, false);
assert.equal(context.buildEffectiveDateRepairAssessment_([
  oldRule,
  { ...futureVersionWithoutBoundary, effectiveFrom: "2026-09-08" },
]).precondition, false);

function quantityFor(dateKey, rules) {
  const candidates = rules
    .filter((rule) => context.isWithinRuleRange(context.parseDate(dateKey), rule))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return candidates.length ? candidates[0].quantity : 0;
}
assert.deepEqual(
  ["2026-09-01", "2026-09-07", "2026-09-08", "2026-09-15", "2026-09-22"].map((date) => quantityFor(date, recovered)),
  [20, 20, 30, 30, 30],
);

const overlappingEntries = ["2026-09-15"].flatMap((date) => recovered.map((rule) => ({
  id: `${rule.id}__${date}`,
  type: "shipment",
  shipmentType: "recurring",
  date,
  recurringId: rule.recurringId,
  effectiveFrom: rule.effectiveFrom,
  effectiveTo: date,
  quantity: rule.quantity,
})));
assert.equal(context.dedupeRecurringOccurrenceVersions_(overlappingEntries).length, 1);
assert.equal(context.dedupeRecurringOccurrenceVersions_(overlappingEntries)[0].quantity, 30);

const noBoundary = context.normalizeRecurringRules_([{
  ...oldRule,
  effectiveTo: "",
}, futureVersionWithoutBoundary]);
assert.equal(noBoundary[1].effectiveFrom, "");
assert.equal(context.isWithinRuleRange(context.parseDate("2026-09-01"), noBoundary[1]), false);

const legacyRule = context.normalizeRecurringRule_({
  id: "legacy",
  startDate: "2026-09-01",
  effectiveFrom: "",
  quantity: 20,
  unit: "kg",
  recurrenceType: "weekly",
  weekdays: [2],
});
assert.equal(legacyRule.effectiveFrom, "2026-09-01");

console.log("recurring effective-date tests: ok");
