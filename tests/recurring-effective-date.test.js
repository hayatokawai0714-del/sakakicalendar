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
  createId: () => "test-id",
  formatDate: (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
  parseJsonArray: (value) => Array.isArray(value) ? value : [],
  parseReferenceItems: (value) => Array.isArray(value) ? value : [],
};
vm.createContext(context);
vm.runInContext([
  "normalizeDateKey",
  "parseDate",
  "addDaysToDateKey_",
  "recurringSeriesId_",
  "normalizeRecurringRule_",
  "normalizeRecurringRules_",
  "isWithinRuleRange",
  "dedupeRecurringOccurrenceVersions_",
].map(extractFunction).join("\n"), context);

const oldRule = {
  id: "series",
  recurringId: "series",
  startDate: "2026-01-01",
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-09-07",
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
