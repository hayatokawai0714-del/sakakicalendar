// Google Apps Script sample API for this repo.
// 1) Set SPREADSHEET_ID
// 2) Deploy as Web app
// 3) Use the Web app URL as API_URL in docs/app.js (sync settings)
// Script Properties required: APP_SECRET, SPREADSHEET_ID, ADMIN_SECRET

function getSpreadsheetId_() {
  const id = String(PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID") || "").trim();
  if (!id) throw new Error("SPREADSHEET_ID is not configured");
  return id;
}

const SHEET_NAMES = {
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
};

function getAppSecret_() {
  return String(PropertiesService.getScriptProperties().getProperty("APP_SECRET") || "").trim();
}

function getAdminSecret_() {
  return String(PropertiesService.getScriptProperties().getProperty("ADMIN_SECRET") || "").trim();
}

function requireAppKey_(appKey) {
  const expected = getAppSecret_();
  const actual = String(appKey || "").trim();
  if (!expected || actual !== expected) {
    throw new Error("Unauthorized");
  }
}

function requireAdminKey_(adminKey) {
  const expected = getAdminSecret_();
  const actual = String(adminKey || "").trim();
  if (!expected || actual !== expected) {
    throw new Error("Unauthorized");
  }
}

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) ? String(e.parameter.action) : "getAll";
  try {
    requireAppKey_(e && e.parameter ? e.parameter.appKey : "");

    ensureHeaders_();

    // For GitHub Pages compatibility, allow write actions via GET with an encoded JSON payload.
    // Frontend sends: ?action=saveDestination&payload=<json>
    // Note: Apps Script already URL-decodes query parameters. Avoid decodeURIComponent() here,
    // because payload may contain '%' which would throw "URI malformed".
    // Note: This is not ideal for large payloads. Consider Firebase/Supabase later.
    const payloadStr = e && e.parameter && e.parameter.payload ? String(e.parameter.payload) : "";
    const payload = payloadStr ? parsePayload_(payloadStr) : {};

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

      case "getRecurringExceptions":

        result = getSheetData_(SHEET_NAMES.recurring_exceptions);

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
      case "getShipmentTerms":
        result = getSheetData_(SHEET_NAMES.shipment_terms);
        break;
      case "getCustomerSettlement":
        result = getCustomerSettlement_(payload);
        break;
      case "getApplicableShipmentTerm":
        result = getApplicableShipmentTerm_(payload);
        break;
      case "getSalesDashboardData":
        // Dashboard data must not be requested through GET: ADMIN_SECRET must never be sent in a URL.
        throw new Error("Unsupported request");
      case "getMonthlySettlements":
      case "saveMonthlySettlement":
      case "voidMonthlySettlement":
        // Monthly settlement data is admin-only and must never be sent through a URL.
        throw new Error("Unsupported request");

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

        out = deleteRow_(SHEET_NAMES.recurring_shipments, payload.id);

        break;

      case "saveRecurringException":

        out = saveRow_(SHEET_NAMES.recurring_exceptions, payload);

        break;

      case "deleteRecurringException":

        out = deleteRow_(SHEET_NAMES.recurring_exceptions, payload.id);

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
      case "saveShipmentTerm":
        result = saveShipmentTerm_(payload);
        break;
      case "saveCustomerSettlement":
        result = saveCustomerSettlement_(payload);
        break;
      case "saveShipmentActual":
        result = saveShipmentActual_(payload);
        break;
      case "voidShipmentActual":
        result = voidShipmentActual_(payload);
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
    const body = e && e.postData && e.postData.contents ? e.postData.contents : "";
    const parsed = body ? JSON.parse(body) : {};
    const action = String(parsed.action || "");
    requireAppKey_(parsed.appKey || "");

    ensureHeaders_();

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

      case "saveRecurringException":

        out = saveRow_(SHEET_NAMES.recurring_exceptions, payload);

        break;

      case "deleteRecurringException":

        out = deleteRow_(SHEET_NAMES.recurring_exceptions, payload.id);

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
      case "saveShipmentTerm":
        out = saveShipmentTerm_(payload);
        break;
      case "saveCustomerSettlement":
        out = saveCustomerSettlement_(payload);
        break;
      case "saveShipmentActual":
        out = saveShipmentActual_(payload);
        break;
      case "voidShipmentActual":
        out = voidShipmentActual_(payload);
        break;
      case "getSalesDashboardData":
        requireAdminKey_(parsed.adminKey || "");
        out = getSalesDashboardData_();
        break;
      case "getMonthlySettlements":
        requireAdminKey_(parsed.adminKey || "");
        out = getMonthlySettlements_();
        break;
      case "saveMonthlySettlement":
        requireAdminKey_(parsed.adminKey || "");
        out = saveMonthlySettlement_(payload);
        break;
      case "voidMonthlySettlement":
        requireAdminKey_(parsed.adminKey || "");
        out = voidMonthlySettlement_(payload);
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
  // { shipments, recurring_shipments, recurring_exceptions, events, memos, destinations, settings_units, shipment_terms, shipment_actual_statuses }
  if (action === "getAll") return data;
  switch (action) {
    case "getShipments": return { shipments: data };
    case "getRecurringShipments": return { recurring_shipments: data };

    case "getRecurringExceptions": return { recurring_exceptions: data };
    case "getEvents": return { events: data };
    case "getMemos": return { memos: data };
    case "getDestinations": return { destinations: data };
    case "getUnits": return { settings_units: data };
    case "getShipmentTerms": return { shipment_terms: data };
    case "getCustomerSettlement": return { settlement: data };
    case "getApplicableShipmentTerm": return { shipment_term: data };
    case "getSalesDashboardData": return data;
    default: return { data };
  }
}

function getAllData_() {
  return {
    shipments: getSheetData_(SHEET_NAMES.shipments),
    recurring_shipments: getSheetData_(SHEET_NAMES.recurring_shipments),

    recurring_exceptions: getSheetData_(SHEET_NAMES.recurring_exceptions),

    events: getSheetData_(SHEET_NAMES.events),
    memos: getSheetData_(SHEET_NAMES.memos),
    destinations: getSheetData_(SHEET_NAMES.destinations),
    settings_units: getSheetData_(SHEET_NAMES.settings_units),
    shipment_terms: getSheetData_(SHEET_NAMES.shipment_terms),
    // Normal users may see shipment completion state, but never actual money or price snapshots.
    shipment_actual_statuses: getShipmentActualStatuses_(),
  };
}

function normalizeSettlementType_(value) {
  const normalized = String(value || "").trim();
  if (["", "direct", "monthly_statement", "consignment"].indexOf(normalized) === -1) {
    throw new Error("精算方式が不正です");
  }
  return normalized;
}

function getCustomerSettlement_(data) {
  const customerId = String(data && (data.customerId || data.id) || "").trim();
  if (!customerId) throw new Error("取引先が未指定です");
  const customer = getSheetData_(SHEET_NAMES.destinations).find((item) => String(item.id || "") === customerId);
  if (!customer) throw new Error("出荷先が見つかりません");
  return {
    customerId,
    settlementType: normalizeSettlementType_(customer.settlementType),
    updatedAt: String(customer.updatedAt || ""),
  };
}

function saveCustomerSettlement_(data) {
  const customerId = String(data && (data.customerId || data.id) || "").trim();
  if (!customerId) throw new Error("取引先が未指定です");
  const customer = getSheetData_(SHEET_NAMES.destinations).find((item) => String(item.id || "") === customerId);
  if (!customer) throw new Error("出荷先が見つかりません");
  const settlementType = normalizeSettlementType_(data.settlementType);
  const updatedAt = new Date().toISOString();
  const updatedBy = String(data.updatedBy || "未設定").trim() || "未設定";
  saveRow_(SHEET_NAMES.destinations, { id: customerId, settlementType, updatedAt, updatedBy });
  return { customerId, settlementType, updatedAt, updatedBy };
}

function getShipmentActualStatuses_() {
  return getSheetData_(SHEET_NAMES.shipment_actuals).map((actual) => {
    let lineItems = [];
    try {
      lineItems = normalizeActualLineItems_(actual.lineItemsJson || actual.lineItems);
    } catch (err) {
      lineItems = [];
    }
    lineItems = lineItems.map((line) => ({
      standard: line.standard,
      unit: line.unit,
      actualQuantity: line.actualQuantity,
    }));
    return {
      id: String(actual.id || ""),
      sourceShipmentId: String(actual.sourceShipmentId || ""),
      occurrenceDate: normalizeDateKey_(actual.occurrenceDate),
      shipmentDate: normalizeDateKey_(actual.shipmentDate),
      status: String(actual.status || "active"),
      lineItemsJson: JSON.stringify(lineItems),
    };
  });
}

function getSalesDashboardData_() {
  return {
    actuals: getSheetData_(SHEET_NAMES.shipment_actuals),
    monthlySettlements: getSheetData_(SHEET_NAMES.monthly_settlements),
    settlementTypes: getSheetData_(SHEET_NAMES.destinations).map((destination) => {
      const rawType = String(destination.settlementType || "").trim();
      return {
        customerId: String(destination.id || ""),
        settlementType: ["", "direct", "monthly_statement", "consignment"].indexOf(rawType) >= 0 ? rawType : "",
      };
    }),
  };
}

function getMonthlySettlements_() {
  return getSheetData_(SHEET_NAMES.monthly_settlements);
}

function normalizeSettlementYear_(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new Error("対象年が不正です");
  return year;
}

function normalizeSettlementMonth_(value) {
  const month = Number(value);
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error("対象月が不正です");
  return month;
}

function isVoidedSettlement_(value) {
  return value === true || String(value || "").toLowerCase() === "true";
}

function normalizeConsignmentItems_(raw) {
  let items = raw;
  if (typeof items === "string") {
    try {
      items = items ? JSON.parse(items) : [];
    } catch (err) {
      throw new Error("委託販売明細が不正です");
    }
  }
  if (items === undefined || items === null) items = [];
  if (!Array.isArray(items)) throw new Error("委託販売明細が不正です");
  return items.map((item) => {
    const standard = String(item && item.standard || "").trim();
    const unit = String(item && item.unit || "").trim();
    if (!standard || !unit) throw new Error("委託販売明細の規格・単位は必須です");
    return {
      standard,
      unit,
      soldQuantity: normalizeNonNegativeNumber_(item.soldQuantity, "販売数量"),
      salesAmount: normalizeNonNegativeNumber_(item.salesAmount, "商品売上"),
    };
  });
}

function saveMonthlySettlement_(data) {
  if (!data || !data.id) throw new Error("Missing id");
  const customerId = String(data.customerId || "").trim();
  if (!customerId) throw new Error("取引先が未指定です");
  const customer = getSheetData_(SHEET_NAMES.destinations).find((item) => String(item.id || "") === customerId);
  if (!customer) throw new Error("出荷先が見つかりません");
  const settlementType = String(data.settlementType || "").trim();
  if (["monthly_statement", "consignment"].indexOf(settlementType) === -1) {
    throw new Error("月次精算の方式が不正です");
  }
  const targetYear = normalizeSettlementYear_(data.targetYear);
  const targetMonth = normalizeSettlementMonth_(data.targetMonth);
  let grossSales = normalizeNonNegativeNumber_(data.grossSales, "売上");
  const freightCost = normalizeNonNegativeNumber_(data.freightCost, "送料");
  const commissionCost = normalizeNonNegativeNumber_(data.commissionCost, "手数料");
  const otherDeductions = normalizeNonNegativeNumber_(data.otherDeductions, "その他控除");
  const consignmentItems = normalizeConsignmentItems_(data.consignmentItemsJson || data.consignmentItems);
  if (settlementType === "consignment" && !consignmentItems.length) {
    throw new Error("委託販売明細を1件以上入力してください");
  }
  if (settlementType === "consignment") {
    grossSales = Math.round(consignmentItems.reduce((sum, item) => sum + item.salesAmount, 0));
  }

  const now = new Date().toISOString();
  const existing = getSheetData_(SHEET_NAMES.monthly_settlements);
  const sameId = existing.find((item) => String(item.id || "") === String(data.id));
  if (sameId && isVoidedSettlement_(sameId.voided)) throw new Error("取消済みの月次精算は更新できません");
  const duplicate = existing.find((item) =>
    String(item.id || "") !== String(data.id)
    && !isVoidedSettlement_(item.voided)
    && String(item.customerId || "") === customerId
    && Number(item.targetYear) === targetYear
    && Number(item.targetMonth) === targetMonth
  );
  if (duplicate) throw new Error("同じ取引先・対象年月の月次精算が既にあります");

  const normalized = {
    id: String(data.id),
    customerId,
    customerNameSnapshot: String(customer.name || data.customerNameSnapshot || customerId).trim(),
    settlementType,
    targetYear,
    targetMonth,
    grossSales,
    freightCost,
    commissionCost,
    otherDeductions,
    netSales: Math.round(grossSales - freightCost - commissionCost - otherDeductions),
    memo: String(data.memo || ""),
    consignmentItemsJson: JSON.stringify(consignmentItems),
    createdAt: sameId ? String(sameId.createdAt || now) : now,
    updatedAt: now,
    voided: false,
  };
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    // Recheck under the lock so two admin tabs cannot create the same active period.
    const lockedExisting = getSheetData_(SHEET_NAMES.monthly_settlements);
    const lockedDuplicate = lockedExisting.find((item) =>
      String(item.id || "") !== normalized.id
      && !isVoidedSettlement_(item.voided)
      && String(item.customerId || "") === normalized.customerId
      && Number(item.targetYear) === normalized.targetYear
      && Number(item.targetMonth) === normalized.targetMonth
    );
    if (lockedDuplicate) throw new Error("同じ取引先・対象年月の月次精算が既にあります");
    saveRow_(SHEET_NAMES.monthly_settlements, normalized);
    return { created: !sameId, updated: Boolean(sameId), record: normalized };
  } finally {
    lock.releaseLock();
  }
}

function voidMonthlySettlement_(data) {
  const id = String(data && data.id || "").trim();
  if (!id) throw new Error("Missing id");
  const existing = getSheetData_(SHEET_NAMES.monthly_settlements).find((item) => String(item.id || "") === id);
  if (!existing) throw new Error("月次精算が見つかりません");
  if (isVoidedSettlement_(existing.voided)) return { updated: false, record: { ...existing, voided: true } };
  const updatedAt = new Date().toISOString();
  saveRow_(SHEET_NAMES.monthly_settlements, { id, voided: true, updatedAt });
  return { updated: true, record: { ...existing, voided: true, updatedAt } };
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
        if (key === "date" || key === "startDate" || key === "endDate" || key === "effectiveFrom" || key === "occurrenceDate" || key === "shipmentDate") {
          v = Utilities.formatDate(v, "Asia/Tokyo", "yyyy-MM-dd");
        } else if (key === "time") {
          v = Utilities.formatDate(v, "Asia/Tokyo", "HH:mm");
        } else if (key === "updatedAt" || key === "createdAt" || key === "shippedAt" || key === "voidedAt") {
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

  const existingRow = targetRow === -1 ? null : values[targetRow - 1];
  const rowValues = headers.map((h, idx) => {
    if (h in data) return data[h];
    // On update, keep existing cell values when a field is omitted (partial update).
    if (existingRow) return existingRow[idx];
    return "";
  });
  if (targetRow === -1) {
    sheet.appendRow(rowValues);
    return { created: true, id: data.id };
  }
  sheet.getRange(targetRow, 1, 1, headers.length).setValues([rowValues]);
  return { updated: true, id: data.id };
}

function saveShipmentTerm_(data) {
  if (!data || !data.id) throw new Error("Missing id");

  const customerId = String(data.customerId || "").trim();
  const customerName = String(data.customerName || "").trim();
  const standard = String(data.standard || "").trim();
  const unit = String(data.unit || "").trim();
  const effectiveFrom = normalizeDateKey_(data.effectiveFrom);
  if (!customerId || !customerName || !standard || !unit) {
    throw new Error("取引先・規格・単位は必須です");
  }
  if (!effectiveFrom) throw new Error("適用開始日は必須です");

  const unitPrice = normalizeNonNegativeNumber_(data.unitPrice, "単価");
  const freightType = normalizeChoice_(data.freightType, ["none", "fixed"], "送料区分");
  const freightValue = freightType === "none" ? 0 : normalizeNonNegativeNumber_(data.freightValue, "送料");
  const commissionType = normalizeChoice_(data.commissionType, ["none", "percent", "fixed"], "手数料区分");
  const commissionValue = commissionType === "none" ? 0 : normalizeNonNegativeNumber_(data.commissionValue, "手数料");
  if (commissionType === "percent" && commissionValue > 100) {
    throw new Error("手数料%は0〜100で入力してください");
  }

  const normalized = {
    id: String(data.id),
    customerId,
    customerName,
    standard,
    unit,
    unitPrice,
    effectiveFrom,
    freightType,
    freightValue,
    commissionType,
    commissionValue,
    updatedAt: new Date().toISOString(),
  };

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const existing = getSheetData_(SHEET_NAMES.shipment_terms);
    const duplicate = existing.some((term) =>
      String(term.id) !== normalized.id
      && String(term.customerId || "").trim() === normalized.customerId
      && String(term.standard || "").trim() === normalized.standard
      && String(term.unit || "").trim() === normalized.unit
      && normalizeDateKey_(term.effectiveFrom) === normalized.effectiveFrom
    );
    if (duplicate) throw new Error("同じ取引先・規格・単位・適用開始日の条件が既にあります");
    return saveRow_(SHEET_NAMES.shipment_terms, normalized);
  } finally {
    lock.releaseLock();
  }
}

function getApplicableShipmentTerm_(payload) {
  const customerId = String(payload && payload.customerId || "").trim();
  const standard = String(payload && payload.standard || "").trim();
  const unit = String(payload && payload.unit || "").trim();
  const shipmentDate = normalizeDateKey_(payload && payload.shipmentDate);
  if (!customerId || !standard || !unit || !shipmentDate) return null;

  const candidates = getSheetData_(SHEET_NAMES.shipment_terms)
    .filter((term) => String(term.customerId || "").trim() === customerId)
    .filter((term) => String(term.standard || "").trim() === standard)
    .filter((term) => String(term.unit || "").trim() === unit)
    .map((term) => ({ term, effectiveFrom: normalizeDateKey_(term.effectiveFrom) }))
    .filter((item) => item.effectiveFrom && item.effectiveFrom <= shipmentDate)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return candidates.length ? candidates[0].term : null;
}

function saveShipmentActual_(data) {
  if (!data || !data.id) throw new Error("Missing id");
  const sourceShipmentId = String(data.sourceShipmentId || "").trim();
  const occurrenceDate = normalizeDateKey_(data.occurrenceDate);
  const shipmentDate = normalizeDateKey_(data.shipmentDate);
  const customerId = String(data.customerId || "").trim();
  const customerNameSnapshot = String(data.customerNameSnapshot || "").trim();
  const shippedBy = String(data.shippedBy || "未設定").trim() || "未設定";
  if (!sourceShipmentId || !occurrenceDate || !shipmentDate || !customerId || !customerNameSnapshot) {
    throw new Error("出荷実績の必須項目が不足しています");
  }

  const lineItems = normalizeActualLineItems_(data.lineItemsJson || data.lineItems);
  if (!lineItems.length) throw new Error("出荷実績の明細がありません");
  const totals = calculateActualTotals_(lineItems);
  const now = new Date().toISOString();

  const normalized = {
    id: String(data.id),
    sourceShipmentId,
    occurrenceDate,
    shipmentDate,
    customerId,
    customerNameSnapshot,
    shippedBy,
    shippedAt: now,
    grossSales: totals.grossSales,
    freightCost: totals.freightCost,
    commissionCost: totals.commissionCost,
    netSales: totals.netSales,
    createdAt: now,
    updatedAt: now,
    status: "active",
    lineItemsJson: JSON.stringify(lineItems),
  };

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const existing = getSheetData_(SHEET_NAMES.shipment_actuals);
    const sameId = existing.find((actual) => String(actual.id) === normalized.id);
    if (sameId && String(sameId.status || "active") !== "voided") {
      return { ok: true, duplicate: true, actual: actualStatusPayload_(sameId) };
    }
    const duplicate = existing.some((actual) =>
      String(actual.status || "active") !== "voided"
      && String(actual.sourceShipmentId || "") === normalized.sourceShipmentId
    );
    if (duplicate) throw new Error("この出荷は既に出荷済みです");
    saveRow_(SHEET_NAMES.shipment_actuals, normalized);
    return { created: true, actual: actualStatusPayload_(normalized) };
  } finally {
    lock.releaseLock();
  }
}

function actualStatusPayload_(actual) {
  const lineItems = normalizeActualLineItems_(actual.lineItemsJson || actual.lineItems).map((line) => ({
    standard: line.standard,
    unit: line.unit,
    actualQuantity: line.actualQuantity,
  }));
  return {
    id: String(actual.id || ""),
    sourceShipmentId: String(actual.sourceShipmentId || ""),
    occurrenceDate: normalizeDateKey_(actual.occurrenceDate),
    shipmentDate: normalizeDateKey_(actual.shipmentDate),
    status: String(actual.status || "active"),
    lineItemsJson: JSON.stringify(lineItems),
  };
}

function voidShipmentActual_(data) {
  const id = String(data && data.id || "").trim();
  if (!id) throw new Error("Missing id");
  const existing = getSheetData_(SHEET_NAMES.shipment_actuals).find((actual) => String(actual.id) === id);
  if (!existing) throw new Error("出荷実績が見つかりません");
  if (String(existing.status || "active") === "voided") return actualStatusPayload_(existing);
  const now = new Date().toISOString();
  saveRow_(SHEET_NAMES.shipment_actuals, {
    id,
    status: "voided",
    voidedAt: now,
    voidedBy: String(data.voidedBy || "未設定").trim() || "未設定",
    updatedAt: now,
  });
  return actualStatusPayload_({ ...existing, status: "voided", voidedAt: now, updatedAt: now });
}

function normalizeActualLineItems_(raw) {
  let parsed = raw;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch (err) {
      throw new Error("出荷実績の明細が不正です");
    }
  }
  if (!Array.isArray(parsed)) throw new Error("出荷実績の明細が不正です");
  return parsed.map((line) => {
    const standard = String(line && line.standard || "").trim();
    const unit = String(line && line.unit || "").trim();
    if (!standard || !unit) throw new Error("出荷実績の規格・単位が不足しています");
    const actualQuantity = normalizeNonNegativeNumber_(line.actualQuantity, "実績数量");
    const unitPriceSnapshot = normalizeNonNegativeNumber_(line.unitPriceSnapshot, "単価");
    const freightType = normalizeChoice_(line.freightType, ["none", "fixed"], "送料区分");
    const freightValue = freightType === "none" ? 0 : normalizeNonNegativeNumber_(line.freightValue, "送料");
    const commissionType = normalizeChoice_(line.commissionType, ["none", "percent", "fixed"], "手数料区分");
    const commissionValue = commissionType === "none" ? 0 : normalizeNonNegativeNumber_(line.commissionValue, "手数料");
    if (commissionType === "percent" && commissionValue > 100) throw new Error("手数料%は0〜100で入力してください");
    return {
      standard,
      unit,
      actualQuantity,
      unitPriceSnapshot,
      lineSales: roundMoney_(actualQuantity * unitPriceSnapshot),
      freightType,
      freightValue,
      commissionType,
      commissionValue,
    };
  });
}

function calculateActualTotals_(lineItems) {
  const grossSales = roundMoney_(lineItems.reduce((sum, line) => sum + line.lineSales, 0));
  const freightCost = roundMoney_(lineItems.reduce((sum, line) => sum + (line.freightType === "fixed" ? line.freightValue : 0), 0));
  const commissionCost = roundMoney_(lineItems.reduce((sum, line) => {
    if (line.commissionType === "percent") return sum + line.lineSales * line.commissionValue / 100;
    if (line.commissionType === "fixed") return sum + line.commissionValue;
    return sum;
  }, 0));
  return {
    grossSales,
    freightCost,
    commissionCost,
    netSales: roundMoney_(grossSales - freightCost - commissionCost),
  };
}

function roundMoney_(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number);
}

function normalizeChoice_(value, choices, label) {
  const normalized = String(value || "").trim();
  if (choices.indexOf(normalized) === -1) throw new Error(label + "が不正です");
  return normalized;
}

function normalizeNonNegativeNumber_(value, label) {
  if (value === null || value === undefined || String(value).trim() === "") {
    throw new Error(label + "は0以上で入力してください");
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(label + "は0以上で入力してください");
  return number;
}

function normalizeDateKey_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, "Asia/Tokyo", "yyyy-MM-dd");
  }
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\D|$)/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return [year, String(month).padStart(2, "0"), String(day).padStart(2, "0")].join("-");
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
    "referenceDay",
    "referenceWeekdays",
    "candidateWeekdays",
    "shipOffsetDays",
    "updatedAt",
    "updatedBy",
  ]);
  ensureHeaderRow_(SHEET_NAMES.recurring_exceptions, [
    "id",
    "recurringId",
    "date",
    "action",
    "destinationId",
    "destinationName",
    "standard",
    "quantity",
    "unit",
    "standard2",
    "quantity2",
    "unit2",
    "memo",
    "shipOffsetDays",
    "updatedAt",
    "updatedBy",
  ]);
  ensureHeaderRow_(SHEET_NAMES.events, ["id", "date", "time", "title", "memo", "updatedAt", "updatedBy"]);
  ensureHeaderRow_(SHEET_NAMES.memos, ["id", "date", "content", "priority", "updatedAt", "updatedBy"]);
  ensureHeaderRow_(SHEET_NAMES.destinations, [
    "id", "name", "address", "phone", "contactPerson", "email", "note", "active", "sortOrder", "settlementType", "updatedAt", "updatedBy",
  ]);
  ensureHeaderRow_(SHEET_NAMES.settings_units, ["id", "type", "name", "sortOrder", "active", "updatedAt"]);
  ensureHeaderRow_(SHEET_NAMES.shipment_terms, [
    "id", "customerId", "customerName", "standard", "unit", "unitPrice", "effectiveFrom",
    "freightType", "freightValue", "commissionType", "commissionValue", "updatedAt",
  ]);
  ensureHeaderRow_(SHEET_NAMES.shipment_actuals, [
    "id", "sourceShipmentId", "occurrenceDate", "shipmentDate", "customerId", "customerNameSnapshot",
    "shippedBy", "shippedAt", "grossSales", "freightCost", "commissionCost", "netSales", "createdAt", "updatedAt",
    "status", "voidedAt", "voidedBy", "lineItemsJson",
  ]);
  ensureHeaderRow_(SHEET_NAMES.monthly_settlements, [
    "id", "customerId", "customerNameSnapshot", "settlementType", "targetYear", "targetMonth",
    "grossSales", "freightCost", "commissionCost", "otherDeductions", "netSales", "memo",
    "consignmentItemsJson", "createdAt", "updatedAt", "voided",
  ]);
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
  const ss = SpreadsheetApp.openById(getSpreadsheetId_());
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
function parsePayload_(payloadStr) {
  // Backward compatible payload parsing.
  // - Newer frontend: payload is plain JSON string (already URL-decoded by GAS).
  // - Older frontend: payload was encodeURIComponent(JSON.stringify(payload)).
  try {
    return JSON.parse(payloadStr);
  } catch (e) {
    return JSON.parse(decodeURIComponent(payloadStr));
  }
}
