const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("gas/Code.gs", "utf8");

function extractFunction(name) {
  const functionStart = source.indexOf(`function ${name}`);
  assert.notEqual(functionStart, -1, `${name} not found`);
  const lineStart = source.lastIndexOf("\n", functionStart) + 1;
  const asyncStart = source.lastIndexOf("async ", functionStart);
  const start = asyncStart >= lineStart ? asyncStart : functionStart;
  const bodyStart = source.indexOf("{", source.indexOf(")", start));
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let i = bodyStart; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name} body not closed`);
}

const context = {
  Error,
  Object,
  JSON,
  console: { error() {} },
  SHEET_NAMES: {
    shipments: "shipments",
    recurring_shipments: "recurring_shipments",
    recurring_exceptions: "recurring_exceptions",
    events: "events",
    memos: "memos",
    destinations: "destinations",
    settings_units: "settings_units",
    shipment_terms: "shipment_terms",
    shipment_actuals: "shipment_actuals",
    monthly_settlements: "monthly_settlements",
  },
  PropertiesService: {
    getScriptProperties: () => ({ getProperty: () => "redacted-spreadsheet-id" }),
  },
  SpreadsheetApp: { openById: () => ({}) },
};
vm.createContext(context);
vm.runInContext([
  "function getSpreadsheetId_() { return String(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '').trim(); }",
  extractFunction("safeApiErrorCode_"),
  extractFunction("isKnownSheetName_"),
  extractFunction("spreadsheetErrorCategory_"),
  extractFunction("spreadsheetDiagnosticError_"),
  extractFunction("apiErrorResponse_"),
  extractFunction("getOrCreateSheet_"),
  extractFunction("ensureHeaderRow_"),
].join("\n"), context);

function thrownFrom(call) {
  try {
    call();
  } catch (error) {
    return error;
  }
  throw new Error("expected diagnostic error");
}

context.SpreadsheetApp.openById = () => {
  throw new Error("permission denied for spreadsheet redacted-spreadsheet-id");
};
let error = thrownFrom(() => context.getOrCreateSheet_("monthly_settlements"));
assert.equal(error.diagnosticStage, "OPEN_SPREADSHEET");
assert.equal(error.diagnosticSheet, "");

context.SpreadsheetApp.openById = () => ({
  getSheetByName: () => {
    throw new Error("sheet access denied");
  },
});
error = thrownFrom(() => context.getOrCreateSheet_("monthly_settlements"));
assert.equal(error.diagnosticStage, "GET_SHEET");
assert.equal(error.diagnosticSheet, "monthly_settlements");

context.SpreadsheetApp.openById = () => ({
  getSheetByName: () => null,
  insertSheet: () => {
    throw new Error("sheet create denied");
  },
});
error = thrownFrom(() => context.getOrCreateSheet_("monthly_settlements"));
assert.equal(error.diagnosticStage, "CREATE_SHEET");
assert.equal(error.diagnosticSheet, "monthly_settlements");

const failingRangeSheet = {
  getSheetByName: () => ({
    getLastColumn: () => 1,
    getRange: () => {
      throw new Error("header range denied");
    },
  }),
};
context.SpreadsheetApp.openById = () => failingRangeSheet;
error = thrownFrom(() => context.ensureHeaderRow_("monthly_settlements", ["id"]));
assert.equal(error.diagnosticStage, "READ_HEADERS");
assert.equal(error.diagnosticSheet, "monthly_settlements");

const failingWriteSheet = {
  getSheetByName: () => ({
    getLastColumn: () => 1,
    getRange: () => ({
      getValues: () => [["id"]],
      setValues: () => {
        throw new Error("header write denied");
      },
    }),
  }),
};
context.SpreadsheetApp.openById = () => failingWriteSheet;
error = thrownFrom(() => context.ensureHeaderRow_("monthly_settlements", ["id", "effectiveFrom"]));
assert.equal(error.diagnosticStage, "WRITE_HEADERS");
assert.equal(error.diagnosticSheet, "monthly_settlements");

const response = context.apiErrorResponse_("getAll", error);
assert.deepEqual(JSON.parse(JSON.stringify(response)), {
  ok: false,
  action: "getAll",
  error: "SPREADSHEET_ERROR",
  diagnosticCode: "SPREADSHEET_WRITE_HEADERS_FAILED",
  diagnosticStage: "WRITE_HEADERS",
  diagnosticSheet: "monthly_settlements",
});
assert.equal(JSON.stringify(response).includes("denied"), false);
assert.equal(JSON.stringify(response).includes("redacted"), false);
assert.equal(context.safeApiErrorCode_(new Error("Unauthorized")), "AUTH_FAILED");
assert.equal(context.safeApiErrorCode_(new Error("Unknown action")), "UNKNOWN_ACTION");
console.log("GAS spreadsheet diagnostics tests: ok");
