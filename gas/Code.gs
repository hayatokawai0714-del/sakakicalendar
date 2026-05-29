// Google Apps Script sample API for this repo.
// 1) Set SPREADSHEET_ID
// 2) Deploy as Web app
// 3) Use the Web app URL as API_URL in docs/app.js (sync settings)

// NOTE: This repo sample is now set to the user's sheet id for the current deployment.
const SPREADSHEET_ID = "1AIv_8LDY4zSWNYil-C4Ftuz5lYciISfdLR_X5oXeM4Y";

const SHEET_NAMES = {
  shipments: "shipments",
  recurring_shipments: "recurring_shipments",
  events: "events",
  memos: "memos",
  destinations: "destinations",
  settings_units: "settings_units",
};

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) ? String(e.parameter.action) : "getAll";
  try {
    ensureHeaders_();

    // For GitHub Pages compatibility, allow write actions via GET with an encoded JSON payload.
    // Frontend sends: ?action=saveDestination&payload=encodeURIComponent(JSON.stringify(payload))
    // Note: This is not ideal for large payloads. Consider Firebase/Supabase later.
    const payloadStr = e && e.parameter && e.parameter.payload ? String(e.parameter.payload) : "";
    const payload = payloadStr ? JSON.parse(decodeURIComponent(payloadStr)) : {};

    let result;
    switch (action) {
      case "getAll":
        result = getAllData_();
        break;
      case "getShipments":
        result = getSheetData_(SHEET_NAMES.shipments);
        break;
      case "getRecurringShipments":
        result = getSheetData_(SHEET_NAMES.recurring_shipments);
        break;
      case "getEvents":
        result = getSheetData_(SHEET_NAMES.events);
        break;
      case "getMemos":
        result = getSheetData_(SHEET_NAMES.memos);
        break;
      case "getDestinations":
        result = getSheetData_(SHEET_NAMES.destinations);
        break;
      case "getUnits":
        result = getSheetData_(SHEET_NAMES.settings_units);
        break;

      // Write actions via GET (workaround for CORS issues with POST fetch)
      case "saveShipment":
        result = saveRow_(SHEET_NAMES.shipments, payload);
        break;
      case "deleteShipment":
        result = deleteRow_(SHEET_NAMES.shipments, payload.id);
        break;
      case "saveRecurringShipment":
        result = saveRow_(SHEET_NAMES.recurring_shipments, payload);
        break;
      case "deleteRecurringShipment":
        result = deleteRow_(SHEET_NAMES.recurring_shipments, payload.id);
        break;
      case "saveEvent":
        result = saveRow_(SHEET_NAMES.events, payload);
        break;
      case "deleteEvent":
        result = deleteRow_(SHEET_NAMES.events, payload.id);
        break;
      case "saveMemo":
        result = saveRow_(SHEET_NAMES.memos, payload);
        break;
      case "deleteMemo":
        result = deleteRow_(SHEET_NAMES.memos, payload.id);
        break;
      case "saveDestination":
        result = saveRow_(SHEET_NAMES.destinations, payload);
        break;
      case "deleteDestination":
        result = deleteRow_(SHEET_NAMES.destinations, payload.id);
        break;
      case "saveUnit":
        result = saveRow_(SHEET_NAMES.settings_units, payload);
        break;
      case "deleteUnit":
        result = deleteRow_(SHEET_NAMES.settings_units, payload.id);
        break;

      default:
        throw new Error("Unknown action: " + action);
    }
    return jsonOutput_({ ok: true, ...wrapGetResult_(action, result) });
  } catch (err) {
    return jsonOutput_({
      ok: false,
      action: action,
      error: String(err && err.message ? err.message : err),
    });
  }
}

function doPost(e) {
  try {
    ensureHeaders_();
    const body = e && e.postData && e.postData.contents ? e.postData.contents : "";
    const parsed = body ? JSON.parse(body) : {};
    const action = String(parsed.action || "");
    const payload = parsed.payload || {};

    let out = null;
    switch (action) {
      case "saveShipment":
        out = saveRow_(SHEET_NAMES.shipments, payload);
        break;
      case "deleteShipment":
        out = deleteRow_(SHEET_NAMES.shipments, payload.id);
        break;
      case "saveRecurringShipment":
        out = saveRow_(SHEET_NAMES.recurring_shipments, payload);
        break;
      case "deleteRecurringShipment":
        out = deleteRow_(SHEET_NAMES.recurring_shipments, payload.id);
        break;
      case "saveEvent":
        out = saveRow_(SHEET_NAMES.events, payload);
        break;
      case "deleteEvent":
        out = deleteRow_(SHEET_NAMES.events, payload.id);
        break;
      case "saveMemo":
        out = saveRow_(SHEET_NAMES.memos, payload);
        break;
      case "deleteMemo":
        out = deleteRow_(SHEET_NAMES.memos, payload.id);
        break;
      case "saveDestination":
        out = saveRow_(SHEET_NAMES.destinations, payload);
        break;
      case "deleteDestination":
        out = deleteRow_(SHEET_NAMES.destinations, payload.id);
        break;
      case "saveUnit":
        out = saveRow_(SHEET_NAMES.settings_units, payload);
        break;
      case "deleteUnit":
        out = deleteRow_(SHEET_NAMES.settings_units, payload.id);
        break;
      default:
        throw new Error("Unknown action: " + action);
    }

    return jsonOutput_({ ok: true, result: out });
  } catch (err) {
    return jsonOutput_({
      ok: false,
      error: String(err && err.message ? err.message : err),
    });
  }
}

function wrapGetResult_(action, data) {
  // Frontend expects these keys for getAll:
  // { shipments, recurring_shipments, events, memos, destinations, settings_units }
  if (action === "getAll") return data;
  switch (action) {
    case "getShipments": return { shipments: data };
    case "getRecurringShipments": return { recurring_shipments: data };
    case "getEvents": return { events: data };
    case "getMemos": return { memos: data };
    case "getDestinations": return { destinations: data };
    case "getUnits": return { settings_units: data };
    default: return { data };
  }
}

function getAllData_() {
  return {
    shipments: getSheetData_(SHEET_NAMES.shipments),
    recurring_shipments: getSheetData_(SHEET_NAMES.recurring_shipments),
    events: getSheetData_(SHEET_NAMES.events),
    memos: getSheetData_(SHEET_NAMES.memos),
    destinations: getSheetData_(SHEET_NAMES.destinations),
    settings_units: getSheetData_(SHEET_NAMES.settings_units),
  };
}

function getSheetData_(sheetName) {
  const sheet = getOrCreateSheet_(sheetName);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0].map(String);
  const out = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const obj = {};
    let empty = true;
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      let v = row[c];
      // Normalize Dates so the frontend can reliably compare by YYYY-MM-DD strings.
      // Sheets often auto-convert "2026-05-27" into a Date cell.
      if (v instanceof Date) {
        if (key === "date" || key === "startDate" || key === "endDate") {
          v = Utilities.formatDate(v, "Asia/Tokyo", "yyyy-MM-dd");
        } else if (key === "time") {
          v = Utilities.formatDate(v, "Asia/Tokyo", "HH:mm");
        } else if (key === "updatedAt") {
          v = v.toISOString();
        }
      }
      if (v !== "" && v !== null && v !== undefined) empty = false;
      obj[key] = v;
    }
    if (!empty) out.push(obj);
  }
  return out;
}

function saveRow_(sheetName, data) {
  if (!data || !data.id) throw new Error("Missing id");
  const sheet = getOrCreateSheet_(sheetName);
  const range = sheet.getDataRange();
  const values = range.getValues();
  const headers = values[0].map(String);

  const idCol = headers.indexOf("id");
  if (idCol === -1) throw new Error("Missing header: id");

  // Find existing row by id
  let targetRow = -1;
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][idCol]) === String(data.id)) {
      targetRow = r + 1; // 1-based
      break;
    }
  }

  const rowValues = headers.map((h) => (h in data ? data[h] : ""));
  if (targetRow === -1) {
    sheet.appendRow(rowValues);
    return { created: true, id: data.id };
  }
  sheet.getRange(targetRow, 1, 1, headers.length).setValues([rowValues]);
  return { updated: true, id: data.id };
}

function deleteRow_(sheetName, id) {
  if (!id) throw new Error("Missing id");
  const sheet = getOrCreateSheet_(sheetName);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const idCol = headers.indexOf("id");
  if (idCol === -1) throw new Error("Missing header: id");

  for (let r = 1; r < values.length; r++) {
    if (String(values[r][idCol]) === String(id)) {
      sheet.deleteRow(r + 1);
      return { deleted: true, id: id };
    }
  }
  return { deleted: false, id: id };
}

function ensureHeaders_() {
  // Minimal headers for each sheet (match README / frontend expectations).
  ensureHeaderRow_(SHEET_NAMES.shipments, [
    "id",
    "shipmentType",
    "date",
    "destinationId",
    "destinationName",
    "standard",
    "quantity",
    "unit",
    "standard2",
    "quantity2",
    "unit2",
    "memo",
    "recurrenceRuleId",
    "updatedAt",
    "updatedBy",
  ]);
  ensureHeaderRow_(SHEET_NAMES.recurring_shipments, [
    "id",
    "destinationId",
    "destinationName",
    "standard",
    "quantity",
    "unit",
    "standard2",
    "quantity2",
    "unit2",
    "memo",
    "recurrenceType",
    "startDate",
    "endDate",
    "weekdays",
    "intervalWeeks",
    "monthDays",
    "updatedAt",
    "updatedBy",
  ]);
  ensureHeaderRow_(SHEET_NAMES.events, ["id", "date", "time", "title", "memo", "updatedAt", "updatedBy"]);
  ensureHeaderRow_(SHEET_NAMES.memos, ["id", "date", "content", "priority", "updatedAt", "updatedBy"]);
  ensureHeaderRow_(SHEET_NAMES.destinations, [
    "id", "name", "address", "phone", "contactPerson", "email", "note", "active", "updatedAt", "updatedBy",
  ]);
  ensureHeaderRow_(SHEET_NAMES.settings_units, ["id", "type", "name", "sortOrder", "active", "updatedAt"]);
}

function ensureHeaderRow_(sheetName, headers) {
  const sheet = getOrCreateSheet_(sheetName);
  const firstRow = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues();
  const existing = (firstRow[0] || []).map(String).filter((x) => x);
  if (existing.length === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return;
  }
  // If headers exist but are missing columns, append them to the end.
  const missing = headers.filter((h) => existing.indexOf(h) === -1);
  if (missing.length > 0) {
    sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }
}

function getOrCreateSheet_(sheetName) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  return sheet;
}

function jsonOutput_(obj) {
  // CORS: Apps Script does not allow setting arbitrary CORS headers in ContentService reliably.
  // In practice, deploying as a Web app and calling it from browsers usually works for simple JSON.
  // If your environment blocks it, consider using an IFrame proxy or same-origin hosting.
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
