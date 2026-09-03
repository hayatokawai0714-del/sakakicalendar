const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("docs/app.js", "utf8");

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

const diagnostics = [
  "syncDiagnosticHost_",
  "syncDiagnosticContentType_",
  "syncDiagnosticBodyType_",
  "syncDiagnosticErrorCode_",
  "buildSyncDiagnostic_",
];
const context = { URL, console };
vm.createContext(context);
vm.runInContext(diagnostics.map(extractFunction).join("\n"), context);

assert.equal(context.syncDiagnosticHost_("https://script.google.com/macros/s/redacted/exec"), "script.google.com");
assert.equal(context.syncDiagnosticBodyType_("{\"ok\":true}", "application/json; charset=utf-8"), "json");
assert.equal(context.syncDiagnosticBodyType_("<html>error</html>", "text/html"), "html");
assert.equal(context.syncDiagnosticBodyType_("failed", "text/plain"), "plain-text");
assert.equal(context.syncDiagnosticBodyType_("", ""), "empty");
assert.equal(context.syncDiagnosticErrorCode_({ error: "Unauthorized" }), "AUTH_FAILED");
assert.equal(context.syncDiagnosticErrorCode_({ error: "Spreadsheet unavailable" }), "SPREADSHEET_ERROR");
assert.equal(context.syncDiagnosticErrorCode_({ error: "Unknown action" }), "UNKNOWN_ACTION");
assert.equal(context.syncDiagnosticErrorCode_({ error: "secret customer details" }), "API_ERROR");

const okJson = context.buildSyncDiagnostic_({
  status: 200,
  ok: true,
  redirected: false,
  url: "https://script.google.com/macros/s/redacted/exec",
  contentType: "application/json; charset=utf-8",
  text: '{"ok":true}',
  json: { ok: true },
  jsonParse: "success",
});
assert.deepEqual({
  status: okJson.status,
  bodyType: okJson.bodyType,
  jsonParse: okJson.jsonParse,
  responseKind: okJson.responseKind,
}, { status: 200, bodyType: "json", jsonParse: "success", responseKind: "ok-json" });

const cases = [
  { status: 200, ok: true, contentType: "text/html", text: "<html>login</html>", json: null, jsonParse: "failed", kind: "non-json-response" },
  { status: 403, ok: false, contentType: "text/html", text: "forbidden", json: null, jsonParse: "failed", kind: "http-auth" },
  { status: 500, ok: false, contentType: "application/json", text: '{"ok":false,"error":"Spreadsheet unavailable"}', json: { ok: false, error: "Spreadsheet unavailable" }, jsonParse: "success", kind: "http-server" },
  { status: 200, ok: true, contentType: "application/json", text: '{"ok":false,"error":"Unauthorized"}', json: { ok: false, error: "Unauthorized" }, jsonParse: "success", kind: "json-error" },
];
for (const item of cases) {
  const result = context.buildSyncDiagnostic_({ ...item, url: "https://script.google.com/macros/s/redacted/exec" });
  assert.equal(result.responseKind, item.kind);
}

const network = context.buildSyncDiagnostic_({ networkError: true, errorName: "TypeError" });
assert.equal(network.status, "network-error");
assert.equal(network.responseKind, "network-error");
const aborted = context.buildSyncDiagnostic_({ networkError: true, errorName: "AbortError" });
assert.equal(aborted.responseKind, "timeout-or-abort");

const safeText = JSON.stringify(okJson);
assert.equal(safeText.includes("redacted"), false);
assert.equal(safeText.includes("script.google.com"), true);
assert.equal(safeText.includes("customer"), false);

const requestContext = {
  URL,
  console,
  state: { apiKey: "redacted-key" },
  fetch: null,
  lastDiagnostic: null,
  setSyncDiagnostic: null,
  setSyncDiagnostic_(diagnostic) { this.lastDiagnostic = diagnostic; },
  logSyncDiagnostic_() {},
  logApiFailure_() {},
};
vm.createContext(requestContext);
vm.runInContext([
  ...diagnostics.map(extractFunction),
  extractFunction("apiRequest_"),
].join("\n"), requestContext);

function fakeResponse(status, contentType, body, ok = status >= 200 && status < 300) {
  return {
    status,
    ok,
    redirected: false,
    url: "https://script.google.com/macros/s/redacted/exec",
    headers: { get: () => contentType },
    text: async () => body,
  };
}

async function runRequest(responseOrError) {
  requestContext.lastDiagnostic = null;
  requestContext.fetch = async () => {
    if (responseOrError instanceof Error) throw responseOrError;
    return responseOrError;
  };
  try {
    await requestContext.apiRequest_("GET", "getAll", "https://script.google.com/redacted", null);
    return { rejected: false, diagnostic: requestContext.lastDiagnostic };
  } catch (error) {
    return { rejected: true, diagnostic: error._debug && error._debug.diagnostic };
  }
}

(async () => {
  let requestResult = await runRequest(fakeResponse(200, "application/json", '{"ok":true}'));
  assert.equal(requestResult.rejected, false);
  assert.equal(requestContext.lastDiagnostic, null);
  requestResult = await runRequest(fakeResponse(200, "text/html", "<html>login</html>"));
  assert.equal(requestResult.diagnostic.bodyType, "html");
  assert.equal(requestResult.diagnostic.jsonParse, "failed");
  requestResult = await runRequest(fakeResponse(403, "text/html", "forbidden", false));
  assert.equal(requestResult.diagnostic.responseKind, "http-auth");
  requestResult = await runRequest(fakeResponse(500, "application/json", '{"ok":false,"error":"Spreadsheet unavailable"}', false));
  assert.equal(requestResult.diagnostic.responseKind, "http-server");
  assert.equal(requestResult.diagnostic.errorCode, "SPREADSHEET_ERROR");
  requestResult = await runRequest(fakeResponse(200, "application/json", '{"ok":false,"error":"Unauthorized"}'));
  assert.equal(requestResult.diagnostic.responseKind, "json-error");
  assert.equal(requestResult.diagnostic.errorCode, "AUTH_FAILED");
  requestResult = await runRequest(new TypeError("Failed to fetch"));
  assert.equal(requestResult.diagnostic.responseKind, "network-error");
  assert.equal(requestResult.diagnostic.errorName, "TypeError");
  requestResult = await runRequest(Object.assign(new Error("aborted"), { name: "AbortError" }));
  assert.equal(requestResult.diagnostic.responseKind, "timeout-or-abort");
  console.log("sync diagnostics tests: ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
