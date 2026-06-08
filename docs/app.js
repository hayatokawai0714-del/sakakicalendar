const STORAGE_KEYS = {
  entries: "sakaki_entries_v1",
  destinations: "sakaki_destinations_v1",
  standards: "sakaki_standards_v1",
  units: "sakaki_units_v1",
  recurringShipments: "sakaki_recurring_shipments_v1",
  recurringExceptions: "sakaki_recurring_exceptions_v1",
  thisWeekOpen: "sakaki_this_week_summary_open_v1",
  nextWeekOpen: "sakaki_nextweek_open_v1",
  apiUrl: "sakaki_api_url_v1",
  updatedBy: "sakaki_updated_by_v1",
  lastSeenUpdatedAt: "sakaki_last_seen_updated_at",
};

const LAST_DESTINATION_KEY = "sakaki_last_destination_id";

// Fallback API URL for iOS PWA cases where localStorage is wiped.
// Must be the GAS Web app /exec URL.
const DEFAULT_API_URL = "https://script.google.com/macros/s/AKfycbyDXMDE-UAyj66LCvNZ6Q43IaNAVRLxdFtUARDEbFWCmaKeKwQtlUf1o9X-1G3BrC4G/exec";

const DEFAULT_STANDARDS = ["40cm", "45cm", "作り榊"];
const DEFAULT_UNITS = ["kg", "束", "ケース", "箱", "本", "袋", "個"];

// Build info (for PWA cache debugging)
const APP_VERSION = "2026-06-08.1";
const BUILD_TIME = "2026-06-08 00:00";

function isDebugUiEnabled_() {
  const q = String(location.search || "");
  return q.includes("debug=1") || q.includes("debugOverflow=1");
}



const state = {
  entries: [], // spot shipments + events + memos
  recurringShipments: [],
  recurringExceptions: [],
  destinations: [],
  standards: [],
  units: [],
  apiUrl: "",
  updatedBy: "",
  isBusy: false,
  currentMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  selectedDate: formatDate(new Date()),
};

init();

function init() {
  stripGarbageTextNodes_();
  loadState();
  state._didInit = true;
  state._debugUiEnabled = isDebugUiEnabled_();
  console.log("[sakaki] init");
  bindGlobalErrorHandlers_();
  if (state._debugUiEnabled) {
    const bar = document.getElementById("appDebugBar");
    if (bar) bar.classList.remove("hidden");
    updateDebugBar_();
  }

  bindEvents();
  initWeekdayButtons();
  initReferenceItemSection();
  renderAll();

  // Always attempt auto sync on startup when API URL exists.
  void bootData();
  maybeEnableOverflowDebug_();

  // iOS PWA may restore from bfcache; pageshow is the most reliable hook.
  window.addEventListener("pageshow", () => void bootData());
  window.addEventListener("online", () => void bootData());
  window.addEventListener("focus", () => requestBackgroundSync_("focus"));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void bootData();
  });
}

function loadState() {
  state.entries = readLS(STORAGE_KEYS.entries, []);
  state.recurringShipments = readLS(STORAGE_KEYS.recurringShipments, []);
  state.recurringExceptions = readLS(STORAGE_KEYS.recurringExceptions, []).map((ex) => normalizeRecurringException_(ex));
  state.destinations = readLS(STORAGE_KEYS.destinations, []);
  state.standards = readLS(STORAGE_KEYS.standards, DEFAULT_STANDARDS);
  state.units = readLS(STORAGE_KEYS.units, DEFAULT_UNITS);
  state.apiUrl = String(localStorage.getItem(STORAGE_KEYS.apiUrl) || "").trim() || String(DEFAULT_API_URL || "").trim();
  console.log("[sakaki] loaded api url", state.apiUrl);
  state.updatedBy = String(localStorage.getItem(STORAGE_KEYS.updatedBy) || "").trim();

  // Backward compatibility: existing shipments are spot shipments.
  state.entries.forEach((e) => {
    if (e && e.type === "shipment" && !e.shipmentType) e.shipmentType = "spot";
  });
}

function saveState() {
  // localStorage is used as backup cache even in API mode
  writeLS(STORAGE_KEYS.entries, state.entries);
  writeLS(STORAGE_KEYS.recurringShipments, state.recurringShipments);
  writeLS(STORAGE_KEYS.recurringExceptions, state.recurringExceptions);
  writeLS(STORAGE_KEYS.destinations, state.destinations);
  writeLS(STORAGE_KEYS.standards, state.standards);
  writeLS(STORAGE_KEYS.units, state.units);
}

function getLastDestinationId() {
  try {
    return String(localStorage.getItem(LAST_DESTINATION_KEY) || "").trim();
  } catch {
    return "";
  }
}

function setLastDestinationId(destinationId) {
  const id = String(destinationId || "").trim();
  if (!id) return;
  try {
    localStorage.setItem(LAST_DESTINATION_KEY, id);
  } catch {}
}

function applyLastDestinationToForm() {
  const select = document.getElementById("shipmentDestination");
  if (!select || select.disabled) return;
  const last = getLastDestinationId();
  if (!last) return;
  const exists = Array.from(select.options).some((o) => String(o.value) === last);
  if (exists) select.value = last;
}

function isShipmentSpecFormEmpty() {
  const s1 = String((document.getElementById("shipmentStandard") || {}).value || "").trim();
  const u1 = String((document.getElementById("shipmentUnit") || {}).value || "").trim();
  const q1raw = String((document.getElementById("shipmentQuantity") || {}).value || "").trim();
  const hasQ1 = q1raw !== "" && Number(q1raw) !== 0;

  const s2 = String((document.getElementById("shipmentStandard2") || {}).value || "").trim();
  const u2 = String((document.getElementById("shipmentUnit2") || {}).value || "").trim();
  const q2raw = String((document.getElementById("shipmentQuantity2") || {}).value || "").trim();
  const hasQ2 = q2raw !== "" && Number(q2raw) !== 0;

  return !(s1 || u1 || hasQ1 || s2 || u2 || hasQ2);
}

function findLastShipmentTemplateByDestination(destinationId) {
  const destId = String(destinationId || "").trim();
  if (!destId) return null;

  const byUpdatedAtDesc = (a, b) => {
    const ta = String(a.updatedAt || "");
    const tb = String(b.updatedAt || "");
    if (ta && tb) return tb.localeCompare(ta);
    if (tb) return 1;
    if (ta) return -1;
    return 0;
  };

  const shipments = state.entries
    .filter((x) => x && x.type === "shipment" && String(x.destinationId || "") === destId)
    .slice()
    .sort(byUpdatedAtDesc);
  if (shipments.length) return shipments[0];

  const rules = state.recurringShipments
    .filter((r) => r && String(r.destinationId || "") === destId)
    .slice()
    .sort(byUpdatedAtDesc);
  if (rules.length) return rules[0];

  return null;
}

function applyShipmentTemplateToForm(tpl) {
  if (!tpl) return;
  const s1 = document.getElementById("shipmentStandard");
  const q1 = document.getElementById("shipmentQuantity");
  const u1 = document.getElementById("shipmentUnit");
  if (s1 && tpl.standard) s1.value = String(tpl.standard);
  if (q1) q1.value = String(tpl.quantity ?? "");
  if (u1 && tpl.unit) u1.value = String(tpl.unit);

  const has2 = String(tpl.standard2 || "").trim() && String(tpl.unit2 || "").trim();
  toggleShipmentSpec2(Boolean(has2));
  const s2 = document.getElementById("shipmentStandard2");
  const q2 = document.getElementById("shipmentQuantity2");
  const u2 = document.getElementById("shipmentUnit2");
  if (has2) {
    if (s2 && tpl.standard2) s2.value = String(tpl.standard2);
    if (q2) q2.value = String(tpl.quantity2 ?? "");
    if (u2 && tpl.unit2) u2.value = String(tpl.unit2);
  }
}

function handleDestinationChange(e) {
  const destId = String(e && e.target ? e.target.value : "").trim();
  if (!destId) return;
  setLastDestinationId(destId);

  // Only auto-fill when the user just changed destination and the shipment spec form is still empty.
  const editingId = String((document.getElementById("entryId") || {}).value || "").trim();
  if (editingId) return;
  if (!isShipmentSpecFormEmpty()) return;

  const tpl = findLastShipmentTemplateByDestination(destId);
  if (!tpl) return;
  applyShipmentTemplateToForm(tpl);
  showToast("前回の内容を入力しました", "info");
}



function bindEvents() {
  document.getElementById("syncForm").addEventListener("submit", saveSyncSettings);
  document.getElementById("syncTestBtn").addEventListener("click", () => void testApiConnectionUi());

  document.getElementById("entryType").addEventListener("change", switchEntryTypeFields);
  document.getElementById("shipmentKind").addEventListener("change", switchShipmentKindFields);
  document.getElementById("shipmentDestination").addEventListener("change", handleDestinationChange);
  document.getElementById("recurrenceType").addEventListener("change", switchRecurrenceTypeFields);

  document.getElementById("entryForm").addEventListener("submit", (e) => void submitEntryForm(e));
  document.getElementById("addSpec2Btn").addEventListener("click", () => toggleShipmentSpec2(true));
  document.getElementById("removeSpec2Btn").addEventListener("click", () => toggleShipmentSpec2(false));
  document.getElementById("cancelEditBtn").addEventListener("click", resetEntryForm);

  document.getElementById("destinationForm").addEventListener("submit", (e) => void submitDestinationForm(e));
  document.getElementById("cancelDestinationEditBtn").addEventListener("click", resetDestinationForm);

  document.getElementById("standardForm").addEventListener("submit", (e) => void addStandard(e));
  document.getElementById("unitForm").addEventListener("submit", (e) => void addUnit(e));

  document.getElementById("prevMonthBtn").addEventListener("click", () => {
    state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() - 1, 1);
    renderCalendar();
  });
  document.getElementById("nextMonthBtn").addEventListener("click", () => {
    state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() + 1, 1);
    renderCalendar();
  });
  const markSeenBtn = document.getElementById("markSeenBtn");
  if (markSeenBtn) markSeenBtn.addEventListener("click", () => {
    markAllAsSeen();
    renderAll();
  });
  bindAdminPanels();
  bindWeekSummaries();
}

function bindAdminPanels() {
  const buttons = Array.from(document.querySelectorAll(".admin-btn[data-panel]"));
  const backdrops = Array.from(document.querySelectorAll(".sheet-backdrop[data-sheet-backdrop]"));

  function closeAll() {
    backdrops.forEach((b) => b.classList.add("hidden"));
    buttons.forEach((btn) => btn.classList.remove("active"));
  }

  function openPanel(name) {
    closeAll();
    const btn = buttons.find((b) => b.dataset.panel === name);
    const backdrop = backdrops.find((b) => b.dataset.sheetBackdrop === name);
    if (btn) btn.classList.add("active");
    if (backdrop) backdrop.classList.remove("hidden");
  }

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.panel;
      const backdrop = backdrops.find((b) => b.dataset.sheetBackdrop === name);
      const isOpen = backdrop && !backdrop.classList.contains("hidden");
      if (isOpen) closeAll();
      else openPanel(name);
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAll();
  });

  backdrops.forEach((b) => {
    b.addEventListener("click", (e) => {
      if (e.target === b) closeAll();
    });
  });

  Array.from(document.querySelectorAll("[data-sheet-close]"))
    .forEach((btn) => btn.addEventListener("click", closeAll));

  // Expose for other handlers if needed.
  state._closeAdminPanels = closeAll;
}
async function bootData() {
  state._didBoot = true;
  updateDebugBar_();
  console.log("[sakaki] bootData start");
  const apiUrl = String(state.apiUrl || "").trim();
  state._bootApiBranch = Boolean(apiUrl);
  state._autoSyncStarted = false;
  state._autoSyncSucceeded = false;
  state._autoSyncFailed = false;
  updateDebugBar_();
  console.log("[sakaki] api url exists", Boolean(apiUrl));

  try {
    setSyncInputs();
    if (!apiUrl) return;

    setStatus("同期中...", "");
    console.log("[sakaki] auto sync start");
    state._autoSyncStarted = true;
    updateDebugBar_();
    state._lastAutoSyncOk = false;
    updateDebugBar_();

    // iOS PWA can start before network is ready; retry a couple of times.
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await loadAllDataFromApi();
        renderAll();
        state._lastAutoSyncOk = true;
        state._autoSyncSucceeded = true;
        updateDebugBar_();
        console.log("[sakaki] auto sync done", { attempt: attempt + 1, entries: state.entries.length, recurring: state.recurringShipments.length });
        setStatus("同期完了", "ok");
        return;
      } catch (e) {
        lastErr = e;
        console.warn("[sakaki] bootData retry", { attempt: attempt + 1 }, e);
        await sleep_(600 + attempt * 600);
      }
    }

    throw lastErr || new Error("bootData failed");
  } catch (err) {
    state._autoSyncFailed = true;
    updateDebugBar_();
    console.error("[sakaki] bootData failed", err);
    console.error("[sakaki] loadAllDataFromApi failed", err);
    setStatus(`読み込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`, "err");
    state._lastAutoSyncOk = false;
    updateDebugBar_();
    showToast("同期に失敗しました", "error");
  }
}

function renderAll() {
  setSyncInputs();
  switchEntryTypeFields();
  switchShipmentKindFields();
  switchRecurrenceTypeFields();
  toggleShipmentSpec2(false);
  fillMasterSelects();
  renderCalendar();
  renderThisWeekShipmentSummary();
  renderNextWeekShipmentSummary();
  renderSelectedDay();
  renderNewBadges();
  renderDestinationList();
  renderStandardList();
  renderUnitList();
}

function setFormDate(dateKey) {
  const key = normalizeDateKey(dateKey);
  if (!key) return;

  // Keep all date inputs in sync so the user can tap a day and immediately add items.
  const shipmentDate = document.getElementById("shipmentDate");
  const eventDate = document.getElementById("eventDate");
  const memoDate = document.getElementById("memoDate");
  const startDate = document.getElementById("startDate");

  if (shipmentDate) shipmentDate.value = key;
  if (eventDate) eventDate.value = key;
  if (memoDate) memoDate.value = key;
  // Recurring rule start date: helpful default when creating a new rule.
  if (startDate && !startDate.value) startDate.value = key;
}

function isApiEnabled() {
  return Boolean(state.apiUrl);
}

function setSyncInputs() {
  const apiEl = document.getElementById("apiUrlInput");
  const byEl = document.getElementById("updatedByInput");
  if (apiEl) {
    const v = state.apiUrl || String(DEFAULT_API_URL || "").trim();
    if (apiEl.value !== v) apiEl.value = v;
  }
  if (byEl && byEl.value !== state.updatedBy) byEl.value = state.updatedBy;
}

function setStatus(message, kind) {
  const el = document.getElementById("statusBar");
  if (!el) return;
  if (!message) {
    el.className = "status hidden";
    el.textContent = "";
    return;
  }
  el.className = `status ${kind || ""}`.trim();
  el.textContent = message;
}

function showToast(message, type = "info") {
  if (!message) return;
  let wrap = document.getElementById("toastWrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "toastWrap";
    wrap.className = "toast-wrap";
    document.body.appendChild(wrap);
  }

  const toast = document.createElement("div");
  toast.className = `toast ${type}`.trim();
  toast.textContent = message;
  wrap.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("show"));

  const ttl = type === "error" ? 2600 : 1800;
  window.setTimeout(() => {
    toast.classList.remove("show");
    window.setTimeout(() => toast.remove(), 200);
  }, ttl);
}

function setButtonLoading(button, loadingText) {
  if (!button) return;
  if (!button.dataset) return;
  if (!button.dataset.origText) button.dataset.origText = button.textContent || "";
  button.disabled = true;
  if (loadingText) button.textContent = loadingText;
}

function resetButtonLoading(button) {
  if (!button) return;
  if (button.dataset && button.dataset.origText !== undefined) {
    button.textContent = button.dataset.origText;
    delete button.dataset.origText;
  }
  button.disabled = false;
}

async function testApiConnectionUi() {
  const btn = document.getElementById("syncTestBtn");
  if (!isApiEnabled()) {
    setStatus("API URLが未設定です（localStorageモード）", "");
    showToast("API URLが未設定です", "info");
    return;
  }
  try {
    setButtonLoading(btn, "確認中...");
    setBusy(true, "接続テスト中…");
    const data = await apiGet("getAll");
    if (!data || typeof data !== "object") throw new Error("不正なレスポンス");
    setStatus("接続できました", "ok");
    showToast("接続できました", "success");
  } catch (err) {
    setStatus(`接続に失敗しました: ${err instanceof Error ? err.message : String(err)}`, "err");
    showToast("接続に失敗しました", "error");
  } finally {
    setBusy(false, "");
    resetButtonLoading(btn);
  }
}

function payloadPreview_(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const keys = [
    "id",
    "name",
    "active",
    "updatedAt",
    "updatedBy",
    "date",
    "title",
    "content",
    "destinationId",
    "destinationName",
  ];
  const out = {};
  keys.forEach((k) => {
    if (k in payload) out[k] = payload[k];
  });
  return out;
}

function formatErrorForUi(actionLabel, err, payload) {
  const msg = err instanceof Error ? err.message : String(err);
  const dbg = err && typeof err === "object" && err._debug ? err._debug : null;
  if (!dbg) return `${actionLabel}: ${msg}`;
  return [
    `${actionLabel}: ${msg}`,
    `action=${dbg.action}`,
    `status=${dbg.status}`,
    `error=${msg}`,
    `payload=${JSON.stringify(dbg.payloadPreview || payloadPreview_(payload))}`,
  ].join(" / ");
}

function setBusy(isBusy, message) {
  state.isBusy = isBusy;
  const entrySubmit = document.querySelector("#entryForm button[type='submit']");
  const syncSubmit = document.querySelector("#syncForm button[type='submit']");
  if (entrySubmit) entrySubmit.disabled = isBusy;
  if (syncSubmit) syncSubmit.disabled = isBusy;
  if (isBusy) setStatus(message || "読み込み中...", "");
}

function currentUpdatedBy() {
  return state.updatedBy || "未設定";
}

function getLastSeenUpdatedAt() {
  try {
    return String(localStorage.getItem(STORAGE_KEYS.lastSeenUpdatedAt) || "").trim();
  } catch {
    return "";
  }
}

function setLastSeenUpdatedAt(dateString) {
  const value = String(dateString || "").trim();
  try {
    localStorage.setItem(STORAGE_KEYS.lastSeenUpdatedAt, value);
  } catch {}
  renderNewBadges();
}

function isNewEntry(entry) {
  if (!entry) return false;
  const updatedAt = String(entry.updatedAt || "").trim();
  if (!updatedAt) return false;
  const lastSeen = getLastSeenUpdatedAt();
  const mine = String(entry.updatedBy || "").trim() && String(entry.updatedBy || "").trim() === currentUpdatedBy();
  const isAfterSeen = !lastSeen ? true : updatedAt > lastSeen;
  return isAfterSeen || !mine;
}

function markAllAsSeen() {
  setLastSeenUpdatedAt(new Date().toISOString());
}

function newBadgeHtml(entry) {
  return isNewEntry(entry) ? '<span class="new-badge">新着</span>' : "";
}

function renderNewBadges() {
  const btn = document.getElementById("markSeenBtn");
  if (!btn) return;
  const hasNew = [...state.entries, ...state.recurringShipments].some((entry) => isNewEntry(entry));
  btn.classList.toggle("hidden", !hasNew);
}

function saveSyncSettings(e) {
  e.preventDefault();
  const apiUrl = String(document.getElementById("apiUrlInput").value || "").trim();
  const updatedBy = String(document.getElementById("updatedByInput").value || "").trim();

  console.log("[sakaki] save api url", apiUrl);

  // Prevent accidental clearing: if input is empty but we already have a saved URL, keep it.
  const existing = String(localStorage.getItem(STORAGE_KEYS.apiUrl) || "").trim();
  const nextUrl = apiUrl || existing;

  state.apiUrl = nextUrl;
  state.updatedBy = updatedBy;

  localStorage.setItem(STORAGE_KEYS.apiUrl, nextUrl);
  localStorage.setItem(STORAGE_KEYS.updatedBy, updatedBy);

  console.log("[sakaki] localStorage saved api url", localStorage.getItem("sakaki_api_url_v1"));

  // Reflect to inputs immediately
  setSyncInputs();

  setStatus("設定を保存しました", "ok");
  void bootData();
}

async function testApiConnection() {
  // Backward compat: use the newer UI-aware connection test.
  await testApiConnectionUi();
}

async function apiGet(action) {
  const url = new URL(state.apiUrl);
  url.searchParams.set("action", action);
  return await apiRequest_("GET", action, url.toString(), null);
}

async function apiPost(action, payload) {
  // GAS Web app POST from GitHub Pages often hits CORS issues.
  // Use GET with an encoded JSON payload for write actions.
  const url = new URL(state.apiUrl);
  url.searchParams.set("action", action);
    // Important: URLSearchParams will handle encoding. Do not pre-encode here,
  // otherwise the payload becomes double-encoded and GAS may fail to parse it.
  url.searchParams.set("payload", JSON.stringify(payload || {}));
  return await apiRequest_("GET", action, url.toString(), payload || {});
}


function sleep_(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function apiPostWithRetry_(action, payload, opts) {
  const retries = opts && Number.isFinite(Number(opts.retries)) ? Number(opts.retries) : 1;
  const delayMs = opts && Number.isFinite(Number(opts.delayMs)) ? Number(opts.delayMs) : 250;
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await apiPost(action, payload);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep_(delayMs);
    }
  }
  throw lastErr;
}
async function apiRequest_(method, action, url, payload) {
  const opts =
    method === "GET"
      ? { method: "GET" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, payload }),
        };

  const res = await fetch(url, opts);
  const status = res.status;
  const text = await res.text();

  // GAS may return HTML on auth errors; keep raw text for debugging.
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const msg = json && json.error ? String(json.error) : (text || "").slice(0, 300);
    const err = new Error(`HTTP ${status}: ${msg}`);
    err._debug = { action, method, status, url, payloadPreview: payloadPreview_(payload), bodyPreview: (text || "").slice(0, 500) };
    throw err;
  }

  if (json && typeof json === "object" && json.ok === false) {
    const err = new Error(String(json.error || "API error"));
    err._debug = { action, method, status, url, payloadPreview: payloadPreview_(payload), bodyPreview: (text || "").slice(0, 500) };
    throw err;
  }

  if (!json || typeof json !== "object") {
    const err = new Error("Non-JSON response from API");
    err._debug = { action, method, status, url, payloadPreview: payloadPreview_(payload), bodyPreview: (text || "").slice(0, 500) };
    throw err;
  }

  return json;
}

async function loadAllDataFromApi() {
  console.log("[sakaki] loadAllDataFromApi start");
  try {
    setBusy(true, "読み込み中...");
    const all = await apiGet("getAll");
    const shipments = Array.isArray(all.shipments) ? all.shipments : [];
    const recurring = Array.isArray(all.recurring_shipments) ? all.recurring_shipments : [];
    const events = Array.isArray(all.events) ? all.events : [];
    const memos = Array.isArray(all.memos) ? all.memos : [];
    const recurringExceptions = Array.isArray(all.recurring_exceptions) ? all.recurring_exceptions : [];
    const destinations = Array.isArray(all.destinations) ? all.destinations : [];
    const settingsUnits = Array.isArray(all.settings_units) ? all.settings_units : [];

    state.entries = [
      ...shipments.map((s) => ({
        id: String(s.id),
        type: "shipment",
        shipmentType: String(s.shipmentType || "spot"),
        date: String(s.date || ""),
        destinationId: String(s.destinationId || ""),
        destinationName: String(s.destinationName || ""),
        destination: String(s.destinationName || ""),
        standard: String(s.standard || ""),
        quantity: Number(s.quantity || 0),
        unit: String(s.unit || ""),
        standard2: String(s.standard2 || ""),
        quantity2: Number(s.quantity2 || 0),
        unit2: String(s.unit2 || ""),
        memo: String(s.memo || ""),
        updatedAt: String(s.updatedAt || new Date().toISOString()),
        updatedBy: String(s.updatedBy || "未設定"),
        _ruleId: s.recurrenceRuleId ? String(s.recurrenceRuleId) : undefined,
      })),
      ...events.map((e) => ({
        id: String(e.id),
        type: "event",
        date: String(e.date || ""),
        time: String(e.time || ""),
        title: String(e.title || ""),
        memo: String(e.memo || ""),
        updatedAt: String(e.updatedAt || new Date().toISOString()),
        updatedBy: String(e.updatedBy || "未設定"),
      })),
      ...memos.map((m) => ({
        id: String(m.id),
        type: "memo",
        date: String(m.date || ""),
        content: String(m.content || ""),
        priority: String(m.priority || "medium"),
        updatedAt: String(m.updatedAt || new Date().toISOString()),
        updatedBy: String(m.updatedBy || "未設定"),
      })),
    ];
    state.recurringExceptions = recurringExceptions.map((ex) => normalizeRecurringException_(ex));

    // Debug: help diagnose "saved but not shown" cases (date format / filtering).
    try {
      console.log("[sakaki] api getAll loaded", {
        shipments: shipments.length,
        recurring: recurring.length,
        recurringExceptions: recurringExceptions.length,
        events: events.length,
        memos: memos.length,
        today: formatDate(new Date()),
        sampleEventDate: events[0] ? String(events[0].date) : "",
      });
    } catch {}

    state.recurringShipments = recurring.map((r) => ({
      id: String(r.id),
      shipmentType: "recurring",
      destinationId: String(r.destinationId || ""),
      destinationName: String(r.destinationName || ""),
      destination: String(r.destinationName || ""),
      standard: String(r.standard || ""),
      quantity: Number(r.quantity || 0),
      unit: String(r.unit || ""),
      standard2: String(r.standard2 || ""),
      quantity2: Number(r.quantity2 || 0),
      unit2: String(r.unit2 || ""),
      memo: String(r.memo || ""),
      recurrenceType: String(r.recurrenceType || "weekly"),
      startDate: String(r.startDate || ""),
      endDate: String(r.endDate || ""),
      weekdays: parseJsonArray(r.weekdays),
      intervalWeeks: Number(r.intervalWeeks || 1),
      monthDays: parseJsonArray(r.monthDays),
      referenceDay: Number(r.referenceDay || 0),
      referenceWeekdays: parseJsonArray(r.referenceWeekdays),
      candidateWeekdays: parseJsonArray(r.candidateWeekdays),
      shipOffsetDays: Number(r.shipOffsetDays || 0),
      referenceItems: parseReferenceItems(r.referenceItems),
      updatedAt: String(r.updatedAt || new Date().toISOString()),
      updatedBy: String(r.updatedBy || "未設定"),
    }));

    state.destinations = destinations.map((d) => ({
      id: String(d.id),
      name: String(d.name || ""),
      address: String(d.address || ""),
      phone: String(d.phone || ""),
      contactPerson: String(d.contactPerson || ""),
      email: String(d.email || ""),
      note: String(d.note || ""),
      active: String(d.active || "TRUE").toLowerCase() !== "false",
      sortOrder: d.sortOrder === undefined || d.sortOrder === null || String(d.sortOrder).trim() === "" ? null : Number(d.sortOrder),
      updatedAt: String(d.updatedAt || new Date().toISOString()),
      updatedBy: String(d.updatedBy || "未設定"),
    }));

    const specs = settingsUnits
      .filter((u) => String(u.type) === "standard" && String(u.active || "TRUE").toLowerCase() !== "false")
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
      .map((u) => String(u.name));
    const units = settingsUnits
      .filter((u) => String(u.type) === "unit" && String(u.active || "TRUE").toLowerCase() !== "false")
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
      .map((u) => String(u.name));
    if (specs.length) state.standards = specs;
    if (units.length) state.units = units;

    saveState();
    console.log("[sakaki] loadAllDataFromApi success");
    setStatus("読み込み完了", "ok");
  } catch (err) {
    console.error("[sakaki] loadAllDataFromApi failed", err);
    setStatus(`読み込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`, "err");
  } finally {
    setBusy(false, "");
  }
}

async function saveShipmentToApi(data) {
  const r = await apiPost("saveShipment", data);
  requestBackgroundSync_("saveShipment");
  return r;
}
async function saveRecurringShipmentToApi(data) {
  const r = await apiPost("saveRecurringShipment", data);
  requestBackgroundSync_("saveRecurringShipment");
  return r;
}
async function saveEventToApi(data) {
  const r = await apiPost("saveEvent", data);
  requestBackgroundSync_("saveEvent");
  return r;
}
async function saveMemoToApi(data) {
  const r = await apiPost("saveMemo", data);
  requestBackgroundSync_("saveMemo");
  return r;
}
async function saveDestinationToApi(data) {
  const r = await apiPost("saveDestination", data);
  requestBackgroundSync_("saveDestination");
  return r;
}
async function deleteItemFromApi(action, id) {
  const r = await apiPost(action, { id });
  requestBackgroundSync_(action);
  return r;
}

function getSpotShipments() {
  return state.entries.filter((e) => e && e.type === "shipment" && (e.shipmentType || "spot") === "spot");
}

function getRecurringShipments() {
  return state.recurringShipments;
}

function saveSpotShipment(spot) {
  spot.type = "shipment";
  spot.shipmentType = "spot";
  upsertById(state.entries, spot);
  saveState();
}

function saveRecurringShipment(rule) {
  rule.shipmentType = "recurring";
  upsertById(state.recurringShipments, rule);
  saveState();
}

function getRecurringExceptions() {
  return Array.isArray(state.recurringExceptions) ? state.recurringExceptions : [];
}

function recurringExceptionKey_(recurringId, date) {
  return `${String(recurringId || "").trim()}||${normalizeDateKey(date)}`;
}

function normalizeRecurringException_(raw) {
  const rec = raw && typeof raw === "object" ? raw : {};
  const shipment = rec.shipment && typeof rec.shipment === "object" ? rec.shipment : rec;
  const date = normalizeDateKey(rec.date || shipment.date || "");
  return {
    id: String(rec.id || createIdFrom(rec.recurringId || "recurring", date || "date")),
    recurringId: String(rec.recurringId || ""),
    date,
    action: String(rec.action || "override"),
    shipment: {
      destinationId: String(shipment.destinationId || ""),
      destinationName: String(shipment.destinationName || shipment.customer || ""),
      destination: String(shipment.destinationName || shipment.customer || ""),
      standard: String(shipment.standard || ""),
      quantity: shipment.quantity === undefined || shipment.quantity === null || shipment.quantity === "" ? "" : Number(shipment.quantity),
      unit: String(shipment.unit || ""),
      standard2: String(shipment.standard2 || ""),
      quantity2: shipment.quantity2 === undefined || shipment.quantity2 === null || shipment.quantity2 === "" ? "" : Number(shipment.quantity2),
      unit2: String(shipment.unit2 || ""),
      memo: String(shipment.memo || ""),
      shipOffsetDays: shipment.shipOffsetDays === undefined || shipment.shipOffsetDays === null ? 0 : Number(shipment.shipOffsetDays),
    },
    updatedAt: String(rec.updatedAt || new Date().toISOString()),
    updatedBy: String(rec.updatedBy || currentUpdatedBy()),
  };
}

function flattenRecurringExceptionForApi_(exception) {
  const rec = normalizeRecurringException_(exception);
  return {
    id: rec.id,
    recurringId: rec.recurringId,
    date: rec.date,
    action: rec.action,
    destinationId: rec.shipment.destinationId,
    destinationName: rec.shipment.destinationName,
    standard: rec.shipment.standard,
    quantity: rec.shipment.quantity,
    unit: rec.shipment.unit,
    standard2: rec.shipment.standard2,
    quantity2: rec.shipment.quantity2,
    unit2: rec.shipment.unit2,
    memo: rec.shipment.memo,
    shipOffsetDays: rec.shipment.shipOffsetDays,
    updatedAt: rec.updatedAt,
    updatedBy: rec.updatedBy,
  };
}

function saveRecurringException(exception) {
  const rec = normalizeRecurringException_(exception);
  upsertById(state.recurringExceptions, rec);
  saveState();
  return rec;
}

function deleteRecurringException(recurringId, date) {
  const key = recurringExceptionKey_(recurringId, date);
  state.recurringExceptions = getRecurringExceptions().filter((ex) => recurringExceptionKey_(ex.recurringId, ex.date) !== key);
  saveState();
}

function removeRecurringExceptionsForRule(recurringId) {
  const ruleId = String(recurringId || "").trim();
  if (!ruleId) return [];
  const removed = getRecurringExceptions().filter((ex) => String(ex.recurringId || "") === ruleId);
  state.recurringExceptions = getRecurringExceptions().filter((ex) => String(ex.recurringId || "") !== ruleId);
  saveState();
  return removed;
}

function findRecurringException_(recurringId, date) {
  const key = recurringExceptionKey_(recurringId, date);
  return getRecurringExceptions().find((ex) => recurringExceptionKey_(ex.recurringId, ex.date) === key) || null;
}

function buildRecurringExceptionShipment_(sourceEntry, exception) {
  const sh = exception.shipment || {};
  const destName = String(sh.destinationName || sh.destination || "").trim();
  return {
    ...sourceEntry,
    id: exception.id || sourceEntry.id,
    date: normalizeDateKey(exception.date || sourceEntry.date),
    destinationId: String(sh.destinationId || sourceEntry.destinationId || ""),
    destinationName: destName || String(sourceEntry.destinationName || sourceEntry.destination || ""),
    destination: destName || String(sourceEntry.destinationName || sourceEntry.destination || ""),
    standard: String(sh.standard || sourceEntry.standard || ""),
    quantity: sh.quantity === "" || sh.quantity === undefined || sh.quantity === null ? sourceEntry.quantity : Number(sh.quantity),
    unit: String(sh.unit || sourceEntry.unit || ""),
    standard2: String(sh.standard2 || sourceEntry.standard2 || ""),
    quantity2: sh.quantity2 === "" || sh.quantity2 === undefined || sh.quantity2 === null ? sourceEntry.quantity2 : Number(sh.quantity2),
    unit2: String(sh.unit2 || sourceEntry.unit2 || ""),
    memo: String(sh.memo || sourceEntry.memo || ""),
    shipOffsetDays: sh.shipOffsetDays === "" || sh.shipOffsetDays === undefined || sh.shipOffsetDays === null ? Number(sourceEntry.shipOffsetDays || 0) : Number(sh.shipOffsetDays),
    sourceType: "recurring",
    exceptionDate: normalizeDateKey(exception.date || sourceEntry.date),
    exceptionAction: "override",
    recurringId: exception.recurringId || sourceEntry.recurringId || sourceEntry._ruleId || "",
    _ruleId: exception.recurringId || sourceEntry._ruleId,
    updatedAt: String(exception.updatedAt || sourceEntry.updatedAt || new Date().toISOString()),
    updatedBy: String(exception.updatedBy || sourceEntry.updatedBy || currentUpdatedBy()),
  };
}

function applyRecurringExceptions_(entries) {
  const list = Array.isArray(entries) ? entries.slice() : [];
  if (!getRecurringExceptions().length) return list;
  const out = [];
  list.forEach((entry) => {
    if (!entry || entry.type !== "shipment" || (entry.shipmentType || "") !== "recurring") {
      out.push(entry);
      return;
    }
    const ex = findRecurringException_(entry.recurringId || entry._ruleId || entry.id, entry.date);
    if (!ex) {
      out.push(entry);
      return;
    }
    if (String(ex.action || "").trim() === "skip") return;
    if (String(ex.action || "").trim() === "override") {
      out.push(buildRecurringExceptionShipment_(entry, ex));
      return;
    }
    out.push(entry);
  });
  return out;
}

function renderToday() {
  // Today card was removed to save vertical space.
  return;
}


function generateRecurringShipmentsForMonth(year, monthIndex) {
  const end = new Date(year, monthIndex + 1, 0);
  const out = [];

  getRecurringShipments().forEach((rule) => {
    const referenceItems = Array.isArray(rule.referenceItems) ? rule.referenceItems.filter(Boolean) : [];
    if (referenceItems.length && ["monthlyByDate", "referenceDate", "beforeReferenceNearestWeekday"].includes(rule.recurrenceType)) {
      out.push(...generateRecurringShipmentsFromReferenceItemsForMonth(year, monthIndex, rule, referenceItems));
      return;
    }

    if (rule.recurrenceType === "beforeReferenceNearestWeekday") {
      const ship = generateBeforeReferenceNearestWeekdayShipmentForMonth(year, monthIndex, rule, end);
      if (ship) out.push(ship);
      return;
    }

    for (let d = 1; d <= end.getDate(); d += 1) {
      const date = new Date(year, monthIndex, d);
      if ((rule.recurrenceType === "weekly" || rule.recurrenceType === "monthlyByDate") && !isWithinRuleRange(date, rule)) continue;

      const dateKey = formatDate(date);
      const matches =
        rule.recurrenceType === "weekly"
          ? matchesWeeklyRule(date, rule)
          : rule.recurrenceType === "monthlyByDate"
            ? matchesMonthlyByDateRule(date, rule)
            : rule.recurrenceType === "referenceDate"
              ? matchesReferenceDateRule(date, rule)
              : false;
      if (!matches) continue;

      const shipOffsetDays = Number(rule.shipOffsetDays ?? 0);
      const shipDate = new Date(date);
      shipDate.setDate(shipDate.getDate() + shipOffsetDays);
      if (!isWithinRuleRange(shipDate, rule)) continue;
      const shipDateKey = formatDate(shipDate);

      out.push({
        id: createIdFrom(rule.id, shipDateKey),
        type: "shipment",
        shipmentType: "recurring",
        date: shipDateKey,
        destinationId: rule.destinationId || "",
        destinationName: rule.destinationName || rule.destination || "",
        destination: rule.destinationName || rule.destination || "",
        standard: rule.standard,
        quantity: rule.quantity,
        unit: rule.unit,
        memo: rule.memo,
        standard2: rule.standard2 || "",
        quantity2: rule.quantity2 || 0,
        unit2: rule.unit2 || "",
        updatedAt: rule.updatedAt,
        updatedBy: rule.updatedBy || currentUpdatedBy(),
        _ruleId: rule.id,
        sourceType: "recurring",
        recurringId: rule.id,
      });
    }
  });

  // Debug (requested)
  try {
    console.log("recurring rules count", getRecurringShipments().length);
    console.log("recurring exceptions count", getRecurringExceptions().length);
    console.log("generated recurring entries count", out.length);
    console.log("render month", { year, month: monthIndex + 1 });
  } catch {}

  return applyRecurringExceptions_(out);
}

function generateRecurringShipmentsFromReferenceItemsForMonth(year, monthIndex, rule, referenceItems) {
  const out = [];
  const monthLabel = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  const weekdays = parseNumberList(rule.candidateWeekdays || rule.referenceWeekdays || rule.weekdays);
  const baseOffset = Number(rule.shipOffsetDays ?? 0);

  referenceItems.forEach((rawItem, idx) => {
    const item = normalizeReferenceItem(rawItem, rule);
    const refDay = Number(item.referenceDay || 0);
    if (!Number.isFinite(refDay) || refDay < 1 || refDay > 31) return;
    const refDate = new Date(year, monthIndex, refDay);
    if (refDate.getMonth() !== monthIndex) return;

    const shipOffsetDays = Number(item.shipOffsetDays ?? baseOffset);

    if (rule.recurrenceType === "monthlyByDate") {
      const shipDate = new Date(refDate);
      shipDate.setDate(shipDate.getDate() + shipOffsetDays);
      const shipDateKey = formatDate(shipDate);
      out.push(buildRecurringShipmentEntry_(rule, item, shipDateKey, refDate, null, idx));
      return;
    }

    if (rule.recurrenceType === "beforeReferenceNearestWeekday") {
      const nearest = findNearestCandidateBeforeReference_(year, monthIndex, refDay, weekdays);
      if (!nearest) return;
      const shipDate = new Date(nearest);
      shipDate.setDate(shipDate.getDate() + shipOffsetDays);
      const shipDateKey = formatDate(shipDate);
      out.push(buildRecurringShipmentEntry_(rule, item, shipDateKey, refDate, nearest, idx));
      return;
    }

    if (rule.recurrenceType === "referenceDate") {
      for (let d = refDay - 1; d >= 1; d -= 1) {
        const candidate = new Date(year, monthIndex, d);
        if (!weekdays.length || !weekdays.includes(candidate.getDay())) continue;
        const shipDate = new Date(candidate);
        shipDate.setDate(shipDate.getDate() + shipOffsetDays);
        const shipDateKey = formatDate(shipDate);
        out.push(buildRecurringShipmentEntry_(rule, item, shipDateKey, refDate, candidate, idx));
      }
    }
  });

  return out.filter((entry) => normalizeDateKey(entry.date).startsWith(monthLabel));
}

function buildRecurringShipmentEntry_(rule, item, shipDateKey, referenceDate, nearestWeekdayDate, index) {
  const refDay = Number(item.referenceDay || rule.referenceDay || 0);
  const standard = String(item.standard || rule.standard || "");
  const quantity = Number(item.quantity ?? rule.quantity ?? 0);
  const unit = String(item.unit || rule.unit || "");
  const standard2 = String(item.standard2 || rule.standard2 || "");
  const quantity2 = Number(item.quantity2 ?? rule.quantity2 ?? 0);
  const unit2 = String(item.unit2 || rule.unit2 || "");

  return {
    id: createIdFrom(`${rule.id}__ref${refDay || "x"}__${index}`, shipDateKey),
    type: "shipment",
    shipmentType: "recurring",
    date: shipDateKey,
    destinationId: rule.destinationId || "",
    destinationName: rule.destinationName || rule.destination || "",
    destination: rule.destinationName || rule.destination || "",
    standard,
    quantity,
    unit,
    standard2,
    quantity2,
    unit2,
    memo: String(item.memo || rule.memo || ""),
    updatedAt: rule.updatedAt,
    updatedBy: rule.updatedBy || currentUpdatedBy(),
    _ruleId: rule.id,
    sourceType: "recurring",
    recurringId: rule.id,
    referenceDay: refDay,
    referenceDate: referenceDate ? formatDate(referenceDate) : "",
    nearestWeekdayDate: nearestWeekdayDate ? formatDate(nearestWeekdayDate) : "",
    referenceItemIndex: index,
  };
}

function findNearestCandidateBeforeReference_(year, monthIndex, refDay, weekdays) {
  const list = parseNumberList(weekdays);
  if (!list.length) return null;
  for (let d = refDay - 1; d >= 1; d -= 1) {
    const candidate = new Date(year, monthIndex, d);
    if (candidate.getMonth() !== monthIndex) continue;
    if (list.includes(candidate.getDay())) return candidate;
  }
  return null;
}

function matchesReferenceDateRule(date, rule) {
  if (rule.recurrenceType !== "referenceDate") return false;
  const refDay = Number(rule.referenceDay || 0);
  if (!Number.isFinite(refDay) || refDay < 1 || refDay > 31) return false;
  const weekdays = parseNumberList(rule.referenceWeekdays || rule.weekdays);
  if (!weekdays.length) return false;
  if (date.getDate() >= refDay) return false;
  return weekdays.includes(date.getDay());
}

function generateBeforeReferenceNearestWeekdayShipmentForMonth(year, monthIndex, rule, monthEnd) {
  if (rule.recurrenceType !== "beforeReferenceNearestWeekday") return null;
  const refDay = Number(rule.referenceDay || 0);
  if (!Number.isFinite(refDay) || refDay < 1 || refDay > monthEnd.getDate()) return null;

  const weekdays = parseNumberList(rule.candidateWeekdays || rule.referenceWeekdays || rule.weekdays);
  if (!weekdays.length) return null;

  const referenceDate = new Date(year, monthIndex, refDay);
  for (let d = refDay - 1; d >= 1; d -= 1) {
    const candidate = new Date(year, monthIndex, d);
    if (!weekdays.includes(candidate.getDay())) continue;

    const shipOffsetDays = Number(rule.shipOffsetDays ?? -1);
    const shipDate = new Date(candidate);
    shipDate.setDate(shipDate.getDate() + shipOffsetDays);
    if (!isWithinRuleRange(shipDate, rule)) continue;
    const shipDateKey = formatDate(shipDate);
    return {
      id: createIdFrom(rule.id, shipDateKey),
      type: "shipment",
      shipmentType: "recurring",
      date: shipDateKey,
      destinationId: rule.destinationId || "",
      destinationName: rule.destinationName || rule.destination || "",
      destination: rule.destinationName || rule.destination || "",
      standard: rule.standard,
      quantity: rule.quantity,
      unit: rule.unit,
      memo: rule.memo,
      standard2: rule.standard2 || "",
      quantity2: rule.quantity2 || 0,
      unit2: rule.unit2 || "",
      updatedAt: rule.updatedAt,
      updatedBy: rule.updatedBy || currentUpdatedBy(),
      _ruleId: rule.id,
      sourceType: "recurring",
      recurringId: rule.id,
      referenceDate: formatDate(referenceDate),
      nearestWeekdayDate: formatDate(candidate),
    };
  }
  return null;
}

function isWithinRuleRange(date, rule) {
  const start = parseDate(normalizeDateKey(rule.startDate));
  if (!start) return false;
  if (date < start) return false;
  if (rule.endDate) {
    const end = parseDate(normalizeDateKey(rule.endDate));
    if (end && date > end) return false;
  }
  return true;
}

function matchesWeeklyRule(date, rule) {
  const weekdays = parseNumberList(rule.weekdays);
  if (!weekdays.length) return false;
  const weekday = date.getDay();
  if (!weekdays.includes(weekday)) return false;

  const interval = Number(rule.intervalWeeks || 1);
  const start = parseDate(normalizeDateKey(rule.startDate));
  if (!start) return false;

  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor((stripTime(date).getTime() - stripTime(start).getTime()) / dayMs);
  if (diffDays < 0) return false;

  const diffWeeks = Math.floor(diffDays / 7);
  return diffWeeks % interval === 0;
}

function matchesMonthlyByDateRule(date, rule) {
  if (rule.recurrenceType !== "monthlyByDate") return false;
  const monthDays = parseNumberList(rule.monthDays);
  if (!monthDays.length) return false;
  const day = date.getDate();
  return monthDays.includes(day);
}

function renderCalendar() {
  document.getElementById("monthLabel").textContent = `${state.currentMonth.getFullYear()}年${state.currentMonth.getMonth() + 1}月`;

  const weekdayRow = document.getElementById("weekdayRow");
  weekdayRow.innerHTML = "";
  ["日", "月", "火", "水", "木", "金", "土"].forEach((d) => {
    const el = document.createElement("div");
    el.textContent = d;
    // weekend header coloring
    if (d === "日") el.classList.add("wk-sun");
    if (d === "土") el.classList.add("wk-sat");
    weekdayRow.appendChild(el);
  });

  const grid = document.getElementById("calendarGrid");
  grid.innerHTML = "";

  const year = state.currentMonth.getFullYear();
  const month = state.currentMonth.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(start.getDate() - first.getDay());

  const today = formatDate(new Date());
  const generated = generateRecurringShipmentsForMonth(year, month);

  // Debug (requested): confirm event entries and date keys used for comparison.
  try {
    const eventsCount = state.entries.filter((x) => x && x.type === "event").length;
    console.log("events count", eventsCount);
    console.log("today", today);
  } catch {}

  // Build by week; hide the trailing week when it contains only next-month days.
  for (let week = 0; week < 6; week += 1) {
    const weekStart = new Date(start);
    weekStart.setDate(start.getDate() + week * 7);

    const weekDays = [];
    for (let j = 0; j < 7; j += 1) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + j);
      weekDays.push(d);
    }

    const hasCurrentMonthDay = weekDays.some((d) => d.getMonth() === month);
    if (!hasCurrentMonthDay) {
      // Month-start week includes current month, so the only remaining no-current-month week is trailing next-month-only.
      break;
    }

    weekDays.forEach((day) => {
      const dateKey = formatDate(day);
      if (dateKey === today) {
        try {
          console.log("calendar date", dateKey);
        } catch {}
      }

      const eventMatches = state.entries.filter((x) => x && x.type === "event" && normalizeDateKey(x.date) === dateKey);
      if (eventMatches.length > 0 || dateKey === today) {
        try {
          console.log("[sakaki] cell events match", { dateKey, count: eventMatches.length });
        } catch {}
      }

      const dayEntries = entriesByDate(dateKey, { generatedRecurring: generated });

      // Debug (requested): how many events match this cell dateKey
      try {
        const eventCountForCell = state.entries.filter((x) => x && x.type === "event" && normalizeDateKey(x.date) === dateKey).length;
        if (eventCountForCell > 0 || dateKey === "2026-05-27") console.log("[sakaki] cell events", { dateKey, eventCountForCell });
      } catch {}

      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "day-cell";
      if (day.getMonth() !== month) cell.classList.add("outside");
      if (dateKey === today) cell.classList.add("today");
      if (dateKey === state.selectedDate) cell.classList.add("selected");

      const num = document.createElement("div");
      num.className = "day-num";
      if (dateKey === today && day.getMonth() === month) num.classList.add("is-today");
      if (day.getDay() === 0) num.classList.add("is-sun");
      if (day.getDay() === 6) num.classList.add("is-sat");
      if (day.getMonth() === month && isJapaneseHoliday(day)) num.classList.add("is-holiday");
      num.textContent = String(day.getDate());
      cell.appendChild(num);

      dayEntries.slice(0, 2).forEach((entry) => {
        const chip = document.createElement("div");
        chip.className = "entry-chip";
        chip.classList.add(`t-${entry.type}`);
        const badge = newBadgeHtml(entry);
        chip.innerHTML =
          entry.type === "shipment"
            ? `${badge}${calendarChipText(entry)}`
            : `${badge}<span class="tag">${chipTag(entry)}</span>${calendarChipText(entry)}`;
        cell.appendChild(chip);
      });

      if (dayEntries.length > 2) {
        const more = document.createElement("div");
        more.className = "entry-chip";
        more.textContent = `+${dayEntries.length - 2}件`;
        cell.appendChild(more);
      }

      cell.addEventListener("click", () => {
        state.selectedDate = dateKey;
        setFormDate(dateKey);
        renderCalendar();
        renderSelectedDay();
        scrollSelectedDayIntoView_();
      });

      grid.appendChild(cell);
    });
  }}

function renderSelectedDay() {
  const label = document.getElementById("selectedDateLabel");
  const list = document.getElementById("selectedDayList");
  label.textContent = state.selectedDate;

  const selectedDate = parseDate(state.selectedDate) || new Date();
  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();
  const generated = generateRecurringShipmentsForMonth(year, month);

  const items = entriesByDate(state.selectedDate, { generatedRecurring: generated });
  try {
    const sample = items.filter((x) => x && x.type === "shipment" && (x.shipmentType || "") === "recurring");
    console.log("[sakaki] recurring entries for 2026-05-26", entriesByDate("2026-05-26", { generatedRecurring: generated }).filter((x) => x && x.type === "shipment" && x.shipmentType === "recurring"));
    if (sample.length) console.log("[sakaki] selected day recurring count", sample.length);
  } catch {}
  renderEntryList(list, items, "この日の予定はありません");
}

function scrollSelectedDayIntoView_() {
  const card = document.getElementById("selectedDayCard");
  const title = document.getElementById("selectedDateLabel");
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  if (title) {
    title.classList.add("section-flash");
    window.setTimeout(() => title.classList.remove("section-flash"), 1200);
  }
}

function renderEntryList(ul, entries, emptyText) {
  ul.innerHTML = "";
  ul.classList.remove("is-empty");
  if (!entries.length) {
    const li = document.createElement("li");
    ul.classList.add("is-empty");
    li.textContent = emptyText;
    ul.appendChild(li);
    return;
  }

  entries
    .slice()
    .sort((a, b) => (a.time || "").localeCompare(b.time || "") || String(a.updatedAt).localeCompare(String(b.updatedAt)))
    .forEach((entry) => {
      const li = document.createElement("li");
      li.classList.add("entry-row");

      const main = document.createElement("div");
      main.className = "entry-main";

      const line1 = document.createElement("div");
      line1.className = "entry-line";

      const pill = document.createElement("span");
      pill.className = `pill pill--${entry.type}`;
      pill.textContent = chipTag(entry);
      line1.appendChild(pill);
      if (isNewEntry(entry)) {
        const badge = document.createElement("span");
        badge.className = "new-badge";
        badge.textContent = "新着";
        line1.appendChild(badge);
      }

      const content = document.createElement("div");
      content.className = "entry-content";

      if (entry.type === "event") {
        const t = normalizeTimeText(entry.time);
        if (t) {
          const timeEl = document.createElement("span");
          timeEl.className = "entry-time";
          timeEl.textContent = t;
          content.appendChild(timeEl);
        }
        const titleEl = document.createElement("span");
        titleEl.className = "entry-title";
        titleEl.textContent = String(entry.title || "");
        content.appendChild(titleEl);
      } else {
        const summary = document.createElement("span");
                summary.className = "entry-title";
        if (entry.type === "shipment") {
          // Shipment detail block: destination first, then specs (prevents 2nd spec floating above on mobile)
          li.classList.add("shipment-card");

          const wrap = document.createElement("div");
          wrap.className = "shipment-detail";

          const head = document.createElement("div");
          head.className = "shipment-head";

          const dest = document.createElement("span");
          dest.className = "shipment-destination";
          dest.textContent = String(entry.destinationName || entry.destination || "");

          if (isNewEntry(entry)) {
            const badge = document.createElement("span");
            badge.className = "new-badge";
            badge.textContent = "新着";
            head.append(badge);
          }

          if (entry.shipmentType === "recurring") {
            const recur = document.createElement("span");
            recur.className = "pill pill--recurring";
            recur.textContent = "定期";
            head.append(recur, dest);
          } else {
            head.append(dest);
          }

          const specs = document.createElement("div");
          specs.className = "shipment-specs";

          const mkSpec = (std, qty, unit) => {
            const s = String(std || "").trim();
            const q = String(qty ?? "").trim();
            const u = String(unit || "").trim();
            if (!s) return null;
            const row = document.createElement("div");
            row.className = "shipment-spec";
            const right = `${q}${u}`.trim();
            row.textContent = right ? `${s} ${right}` : s;
            return row;
          };

          const spec1 = mkSpec(entry.standard, entry.quantity, entry.unit);
          if (spec1) specs.appendChild(spec1);

          const spec2 = mkSpec(entry.standard2, entry.quantity2, entry.unit2);
          if (spec2) specs.appendChild(spec2);

          wrap.append(head, specs);
          main.appendChild(wrap);
        } else {
          summary.textContent = entrySummary(entry);
          content.appendChild(summary);
        }
      }

      if (!li.classList.contains("shipment-card")) {
      if (!line1.classList.contains("entry-line--shipment")) line1.appendChild(content);
      main.appendChild(line1);
    }

      // Detail lists (today/selected day) should show memo if present.
      const memoText = entry && (entry.type === "shipment" || entry.type === "event") ? String(entry.memo || "").trim() : "";
      if (memoText) {
        const memo = document.createElement("div");
        memo.className = "subline one-line";
        memo.textContent = `メモ：${memoText}`;
        main.appendChild(memo);
      }
      if (isNewEntry(entry) && String(entry.updatedBy || "").trim()) {
        const updated = document.createElement("div");
        updated.className = "subline one-line";
        updated.textContent = `更新：${String(entry.updatedBy)}`;
        main.appendChild(updated);
      }
      const actions = document.createElement("div");
      actions.className = "row-actions";

      const editBtn = document.createElement("button");
      editBtn.className = "text-btn";
      editBtn.textContent = "編集";
      editBtn.disabled = state.isBusy;
      editBtn.addEventListener("click", async () => {
        if (await setEntryToForm(entry)) scrollEntryFormIntoView_();
      });

      const delBtn = document.createElement("button");
      delBtn.className = "text-btn";
      delBtn.textContent = "削除";
      delBtn.disabled = state.isBusy;
      delBtn.addEventListener("click", () => void deleteEntry(entry));

      actions.append(editBtn, delBtn);
      li.append(main, actions);
      ul.appendChild(li);

      // Debug (only when ?debug=1): dump shipment HTML + computed styles
      if (entry.type === "shipment") appendShipmentDebug_(li, line1);
    });
}

async function deleteEntry(entry) {
  const isRecurringShipment = entry && entry.type === "shipment" && entry.shipmentType === "recurring";
  let deleteMode = "";
  if (isRecurringShipment) {
    deleteMode = await recurringChoice_("delete");
    if (!deleteMode) return;
  } else if (!confirm("削除しますか？")) {
    return;
  }
  try {
    setBusy(true, "削除中…");

    if (isApiEnabled()) {
      // Optimistic UI update: remove locally first, then sync delete to API.
      const snap = snapshotLocalState_();
      if (isRecurringShipment) {
        if (deleteMode === "day") {
          const exception = buildRecurringSkipException_(entry);
          saveRecurringException(exception);
          refreshViewFast();
          syncSave("saveRecurringException", flattenRecurringExceptionForApi_(exception), snap, "削除しました");
        } else {
          state.recurringShipments = state.recurringShipments.filter((r) => r.id !== (entry._ruleId || entry.id));
          const removedExceptions = removeRecurringExceptionsForRule(entry._ruleId || entry.id);
          saveState();
          refreshViewFast();
          await deleteItemFromApi("deleteRecurringShipment", entry._ruleId || entry.id);
          for (const ex of removedExceptions) {
            await deleteItemFromApi("deleteRecurringException", ex.id);
          }
        }
      } else {
        state.entries = state.entries.filter((x) => x.id !== entry.id);
        saveState();
        refreshViewFast();
        if (entry.type === "shipment") {
          await deleteItemFromApi("deleteShipment", entry.id);
        } else if (entry.type === "event") {
          await deleteItemFromApi("deleteEvent", entry.id);
        } else if (entry.type === "memo") {
          await deleteItemFromApi("deleteMemo", entry.id);
        }
      }
      // loadAllDataFromApi() removed for performance (optimistic update).
    } else {
      if (isRecurringShipment) {
        if (deleteMode === "day") {
          saveRecurringException(buildRecurringSkipException_(entry));
        } else {
          state.recurringShipments = state.recurringShipments.filter((r) => r.id !== (entry._ruleId || entry.id));
          const removedExceptions = removeRecurringExceptionsForRule(entry._ruleId || entry.id);
          saveState();
          for (const ex of removedExceptions) {
            deleteRecurringException(ex.recurringId, ex.date);
          }
        }
      } else {
        state.entries = state.entries.filter((x) => x.id !== entry.id);
        saveState();
      }
    }

    setStatus("削除しました", "ok");
    showToast("削除しました", "success");
    resetEntryForm();
    renderAll();
  } catch (err) {
    setStatus(`削除に失敗しました: ${err instanceof Error ? err.message : String(err)}`, "err");
    showToast("削除に失敗しました", "error");
  } finally {
    setBusy(false, "");
  }
}

function chipTag(entry) {
  if (entry.type === "shipment") return "出荷";
  if (entry.type === "event") return "予定";
  return "メモ";
}

function calendarChipText(entry) {
  if (entry.type === "shipment") {
    const dest = entry.destinationName || entry.destination || "";
    const qty = `${entry.quantity ?? ""}${entry.unit || ""}`;
    const has2 = String(entry.standard2 || "").trim() && String(entry.unit2 || "").trim();
    const qty2 = has2 ? `+${entry.quantity2 ? String(entry.quantity2) : ""}${entry.unit2 || ""}` : "";
    // Calendar stays compact: destination + qty1 (+ qty2)
    return `${dest} ${qty}${qty2 ? ` ${qty2}` : ""}`.trim();
  }
  return entrySummary(entry);
}

function switchEntryTypeFields() {
  const type = document.getElementById("entryType").value;

  document.getElementById("shipmentFields").classList.toggle("hidden", type !== "shipment");
  document.getElementById("eventFields").classList.toggle("hidden", type !== "event");
  document.getElementById("memoFields").classList.toggle("hidden", type !== "memo");

  // Compact form top-row switching (keep IDs; just hide/show the right controls)
  const shipmentKindRow = document.getElementById("shipmentKindRow");
  const spotDateRow = document.getElementById("spotDateRow");
  const eventDateRow = document.getElementById("eventDateRow");
  const eventTimeRow = document.getElementById("eventTimeRow");
  const memoDateRow = document.getElementById("memoDateRow");
  const memoPriorityRow = document.getElementById("memoPriorityRow");
  const recurringOverrideFields = document.getElementById("recurringOverrideFields");

  if (shipmentKindRow) shipmentKindRow.classList.toggle("hidden", type !== "shipment");
  if (spotDateRow) spotDateRow.classList.toggle("hidden", type !== "shipment" || document.getElementById("shipmentKind").value !== "spot");
  if (eventDateRow) eventDateRow.classList.toggle("hidden", type !== "event");
  if (eventTimeRow) eventTimeRow.classList.toggle("hidden", type !== "event");
  if (memoDateRow) memoDateRow.classList.toggle("hidden", type !== "memo");
  if (memoPriorityRow) memoPriorityRow.classList.toggle("hidden", type !== "memo");
  if (recurringOverrideFields) recurringOverrideFields.classList.toggle("hidden", type !== "shipment" || String(document.getElementById("entryMode")?.value || "") !== "recurring_override");
}

function switchShipmentKindFields() {
  const kind = document.getElementById("shipmentKind").value;
  const isShipment = document.getElementById("entryType").value === "shipment";
  document.getElementById("spotDateRow").classList.toggle("hidden", !isShipment || kind !== "spot");
  document.getElementById("recurringFields").classList.toggle("hidden", kind !== "recurring");
}

function switchRecurrenceTypeFields() {
  const value = document.getElementById("recurrenceType").value;
  const monthly = value === "monthlyByDate";
  const reference = value === "referenceDate" || value === "beforeReferenceNearestWeekday";
  const referenceItemsSection = document.getElementById("referenceItemsSection");
  document.getElementById("weekdayPicker").classList.toggle("hidden", monthly);
  document.getElementById("monthDayPicker").classList.toggle("hidden", !monthly);
  document.getElementById("referenceRuleFields").classList.toggle("hidden", !reference);
  if (referenceItemsSection) referenceItemsSection.classList.toggle("hidden", value === "weekly_1" || value === "weekly_2");
  const weekdayLabel = document.getElementById("weekdayPickerLabel");
  if (weekdayLabel) {
    weekdayLabel.textContent =
      value === "beforeReferenceNearestWeekday" ? "候補曜日（複数可）" : reference ? "対象曜日（複数可）" : "曜日（複数可）";
  }
  if (referenceItemsSection && !referenceItemsSection.classList.contains("hidden") && getReferenceItemRows().length === 0) {
    addReferenceItemRow();
  }
}

function toggleShipmentSpec2(show) {
  const box = document.getElementById("shipmentSpec2");
  if (!box) return;
  box.classList.toggle("hidden", !show);
  const addBtn = document.getElementById("addSpec2Btn");
  if (addBtn) addBtn.classList.toggle("hidden", show);

  if (!show) {
    // Clear values when removing the 2nd spec so it will not be saved.
    const s2 = document.getElementById("shipmentStandard2");
    const q2 = document.getElementById("shipmentQuantity2");
    const u2 = document.getElementById("shipmentUnit2");
    if (s2) s2.value = "";
    if (q2) q2.value = "";
    if (u2) u2.value = "";
  }
}

function initWeekdayButtons() {
  const container = document.getElementById("weekdayButtons");
  container.innerHTML = "";
  const labels = ["日", "月", "火", "水", "木", "金", "土"];
  labels.forEach((label, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "weekday-btn";
    btn.textContent = label;
    btn.dataset.value = String(i);
    btn.addEventListener("click", () => {
      btn.classList.toggle("on");
    });
    container.appendChild(btn);
  });
}

function initReferenceItemSection() {
  const btn = document.getElementById("addReferenceItemBtn");
  if (btn) {
    btn.addEventListener("click", () => addReferenceItemRow());
  }
  const list = document.getElementById("referenceItemsList");
  if (list && !list.children.length) {
    // Start empty; a row is added when the relevant recurrence type is selected.
    list.innerHTML = "";
  }
}

function getReferenceItemRows() {
  return Array.from(document.querySelectorAll("#referenceItemsList .reference-item-row"));
}

function createReferenceItemRow(item = {}) {
  const row = document.createElement("div");
  row.className = "reference-item-row";

  const currentStandard = String(document.getElementById("shipmentStandard").value || "");
  const currentStandard2 = String(document.getElementById("shipmentStandard2").value || "");

  row.innerHTML = `
    <label>基準日<input type="number" class="ref-day" min="1" max="31" inputmode="numeric" placeholder="5" /></label>
    <label>数量<input type="number" class="ref-qty" min="0" step="0.01" inputmode="decimal" placeholder="10" /></label>
    <label>単位<input type="text" class="ref-unit" placeholder="kg" /></label>
    <button type="button" class="text-btn reference-item-remove">削除</button>
  `;

  const dayInput = row.querySelector(".ref-day");
  const qtyInput = row.querySelector(".ref-qty");
  const unitInput = row.querySelector(".ref-unit");
  const removeBtn = row.querySelector(".reference-item-remove");

  if (dayInput) dayInput.value = String(item.referenceDay ?? "");
  if (qtyInput) qtyInput.value = String(item.quantity ?? "");
  if (unitInput) unitInput.value = String(item.unit || "");

  row.dataset.standard = String(item.standard || currentStandard || "");
  row.dataset.standard2 = String(item.standard2 || currentStandard2 || "");
  row.dataset.quantity2 = String(item.quantity2 ?? "");
  row.dataset.unit2 = String(item.unit2 || "");
  row.dataset.memo = String(item.memo || "");

  if (removeBtn) {
    removeBtn.addEventListener("click", () => {
      row.remove();
    });
  }

  return row;
}

function addReferenceItemRow(item = {}) {
  const list = document.getElementById("referenceItemsList");
  if (!list) return null;
  const row = createReferenceItemRow(item);
  list.appendChild(row);
  return row;
}

function clearReferenceItemRows() {
  const list = document.getElementById("referenceItemsList");
  if (list) list.innerHTML = "";
}

function setReferenceItemsToForm(items, fallbackRule = null) {
  clearReferenceItemRows();
  const arr = Array.isArray(items) ? items : [];
  if (!arr.length) return;
  arr.forEach((item) => addReferenceItemRow(normalizeReferenceItem(item, fallbackRule || {})));
}

function getReferenceItemsFromForm() {
  const baseStandard = String(document.getElementById("shipmentStandard").value || "").trim();
  const baseStandard2 = String(document.getElementById("shipmentStandard2").value || "").trim();
  const baseUnit2 = String(document.getElementById("shipmentUnit2").value || "").trim();
  const baseMemo = String(document.getElementById("shipmentMemo").value || "").trim();
  return getReferenceItemRows()
    .map((row) => {
      const day = Number(row.querySelector(".ref-day")?.value || 0);
      if (!Number.isFinite(day) || day < 1 || day > 31) return null;
      const qty = Number(row.querySelector(".ref-qty")?.value || 0);
      const unit = String(row.querySelector(".ref-unit")?.value || "").trim();
      const standard = baseStandard || String(row.dataset.standard || "").trim();
      const standard2 = baseStandard2 || String(row.dataset.standard2 || "").trim();
      const quantity2 = Number(row.dataset.quantity2 || document.getElementById("shipmentQuantity2").value || 0);
      const unit2 = baseUnit2 || String(row.dataset.unit2 || "").trim();
      const memo = baseMemo || String(row.dataset.memo || "").trim();
      return {
        referenceDay: day,
        standard,
        quantity: qty,
        unit,
        standard2,
        quantity2,
        unit2,
        memo,
      };
    })
    .filter(Boolean);
}

function getSelectedWeekdays(containerId = "weekdayButtons") {
  return Array.from(document.querySelectorAll(`#${containerId} .weekday-btn.on`)).map((b) => Number(b.dataset.value));
}

function setSelectedWeekdays(weekdays, containerId = "weekdayButtons") {
  document.querySelectorAll(`#${containerId} .weekday-btn`).forEach((b) => {
    const v = Number(b.dataset.value);
    b.classList.toggle("on", Array.isArray(weekdays) && weekdays.includes(v));
  });
}

function snapshotLocalState_() {
  return {
    entries: state.entries.slice(),
    recurringShipments: state.recurringShipments.slice(),
    recurringExceptions: state.recurringExceptions.slice(),
    destinations: state.destinations.slice(),
  };
}

function restoreLocalState_(snap) {
  if (!snap) return;
  state.entries = Array.isArray(snap.entries) ? snap.entries : [];
  state.recurringShipments = Array.isArray(snap.recurringShipments) ? snap.recurringShipments : [];
  state.recurringExceptions = Array.isArray(snap.recurringExceptions) ? snap.recurringExceptions : [];
  state.destinations = Array.isArray(snap.destinations) ? snap.destinations : [];
  saveState();
}

function refreshViewFast() {
  // Keep this minimal and synchronous for snappy UI.
  fillMasterSelects();
  renderCalendar();
  renderSelectedDay();
  renderDestinationList();
}

function scrollEntryFormIntoView_() {
  const card = document.getElementById("entryCard");
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "start" });
  card.classList.add("form-highlight");
  window.setTimeout(() => card.classList.remove("form-highlight"), 1200);
}

function openChoiceModal_(kind) {
  const backdrop = document.getElementById("choiceModalBackdrop");
  const titleEl = document.getElementById("choiceModalTitle");
  const textEl = document.getElementById("choiceModalText");
  const actionsEl = document.getElementById("choiceModalActions");
  if (!backdrop || !titleEl || !textEl || !actionsEl) return Promise.resolve("");

  const config = kind === "edit"
    ? {
        title: "定期出荷の編集",
        text: "編集方法を選んでください。",
        buttons: [
          { label: "この日だけ編集", value: "day", primary: true },
          { label: "定期ルール編集", value: "rule" },
          { label: "キャンセル", value: "" },
        ],
      }
    : {
        title: "定期出荷の削除",
        text: "削除方法を選んでください。",
        buttons: [
          { label: "この日だけ削除", value: "day", primary: true },
          { label: "定期ルール削除", value: "rule" },
          { label: "キャンセル", value: "" },
        ],
      };

  titleEl.textContent = config.title;
  textEl.textContent = config.text;
  actionsEl.innerHTML = "";

  return new Promise((resolve) => {
    let settled = false;
    const close = (result = "") => {
      if (settled) return;
      settled = true;
      backdrop.classList.add("hidden");
      backdrop.setAttribute("aria-hidden", "true");
      document.removeEventListener("keydown", onKeyDown);
      resolve(result);
    };
    const onKeyDown = (ev) => {
      if (ev.key === "Escape") close("");
    };

    config.buttons.forEach((btnCfg) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = btnCfg.primary ? "btn" : "btn secondary";
      btn.textContent = btnCfg.label;
      btn.style.minHeight = "48px";
      btn.addEventListener("click", () => close(btnCfg.value));
      actionsEl.appendChild(btn);
    });

    backdrop.classList.remove("hidden");
    backdrop.setAttribute("aria-hidden", "false");
    document.addEventListener("keydown", onKeyDown);
    backdrop.onclick = (ev) => {
      if (ev.target === backdrop) close("");
    };
    const firstBtn = actionsEl.querySelector("button");
    if (firstBtn) firstBtn.focus();
  });
}

async function recurringChoice_(kind) {
  const result = await openChoiceModal_(kind);
  if (result === "day") return "day";
  if (result === "rule") return "rule";
  return "";
}

function buildRecurringSkipException_(entry) {
  const recurringId = String(entry._ruleId || entry.recurringId || entry.id || "").trim();
  const date = normalizeDateKey(entry.date);
  return {
    id: createIdFrom(`${recurringId}__skip`, date),
    recurringId,
    date,
    action: "skip",
    shipment: {},
    updatedAt: new Date().toISOString(),
    updatedBy: currentUpdatedBy(),
  };
}

function buildRecurringOverrideExceptionFromForm_() {
  const recurringId = String(document.getElementById("exceptionRecurringId").value || "").trim();
  const date = requiredValue("shipmentDate", "出荷日");
  const destId = String(document.getElementById("shipmentDestination").value || "");
  const destName = destId ? state.destinations.find((d) => String(d.id) === destId)?.name || "" : "";
  const shipment = {
    destinationId: destId,
    destinationName: destName,
    destination: destName,
    standard: requiredValue("shipmentStandard", "規格"),
    quantity: Number(document.getElementById("shipmentQuantity").value || 0),
    unit: requiredValue("shipmentUnit", "単位"),
    standard2: String(document.getElementById("shipmentStandard2").value || "").trim(),
    quantity2: Number(document.getElementById("shipmentQuantity2").value || 0),
    unit2: String(document.getElementById("shipmentUnit2").value || "").trim(),
    memo: String(document.getElementById("shipmentMemo").value || "").trim(),
    shipOffsetDays: Number(document.getElementById("exceptionShipOffsetDays").value || 0),
  };
  return {
    id: createIdFrom(`${recurringId}__override`, date),
    recurringId,
    date,
    action: "override",
    shipment,
    updatedAt: new Date().toISOString(),
    updatedBy: currentUpdatedBy(),
  };
}

function syncSave(action, payload, snap, label) {
  if (!isApiEnabled()) return;
  (async () => {
    try {
      await apiPost(action, payload);
      if (label) showToast(label, "success");
    } catch (err) {
      console.error("[sakaki] sync save failed", { action, payload, err });
      restoreLocalState_(snap);
      refreshViewFast();
      showToast(`同期に失敗しました: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  })();
}

function syncDelete(action, id, snap) {
  if (!isApiEnabled()) return;
  (async () => {
    try {
      await deleteItemFromApi(action, id);
      showToast("削除しました", "success");
    } catch (err) {
      console.error("[sakaki] sync delete failed", { action, id, err });
      restoreLocalState_(snap);
      refreshViewFast();
      showToast(`同期に失敗しました: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  })();
}

async function submitEntryForm(e) {
  e.preventDefault();
  if (state.isBusy) return;

  const submitBtn = e.submitter || document.querySelector("#entryForm button[type='submit']");
  const type = document.getElementById("entryType").value;
  const entryMode = String(document.getElementById("entryMode")?.value || "");

  try {
    setButtonLoading(submitBtn, "保存中...");
    setBusy(true, "保存中...");

    if (type === "shipment" && entryMode === "recurring_override") {
      const exception = buildRecurringOverrideExceptionFromForm_();
      const payload = {
        id: exception.id,
        recurringId: exception.recurringId,
        date: exception.date,
        action: exception.action,
        shipment: exception.shipment,
        updatedAt: exception.updatedAt,
        updatedBy: exception.updatedBy,
      };

      if (isApiEnabled()) {
        const snap = snapshotLocalState_();
        saveRecurringException(exception);
        refreshViewFast();
        syncSave("saveRecurringException", flattenRecurringExceptionForApi_(payload), snap, "保存しました");
      } else {
        saveRecurringException(exception);
      }

      state.selectedDate = exception.date;
      setStatus("保存しました", "ok");
      showToast("保存しました", "success");
      resetEntryForm();
      renderAll();
      return;
    }

    if (type === "shipment") {
      const kind = document.getElementById("shipmentKind").value;
      const destId = String(document.getElementById("shipmentDestination").value || "");
      setLastDestinationId(destId);
      const destName = destId ? state.destinations.find((d) => String(d.id) === destId)?.name || "" : "";

      if (kind === "spot") {
        const entry = {
          id: document.getElementById("entryId").value || createId(),
          type: "shipment",
          shipmentType: "spot",
          date: requiredValue("shipmentDate", "出荷日"),
          destinationId: destId,
          destinationName: destName,
          destination: destName,
          standard: requiredValue("shipmentStandard", "規格"),
          quantity: Number(document.getElementById("shipmentQuantity").value || 0),
          unit: requiredValue("shipmentUnit", "単位"),
          standard2: String(document.getElementById("shipmentStandard2").value || "").trim(),
          quantity2: Number(document.getElementById("shipmentQuantity2").value || 0),
          unit2: String(document.getElementById("shipmentUnit2").value || "").trim(),
          memo: document.getElementById("shipmentMemo").value.trim(),
          updatedAt: new Date().toISOString(),
          updatedBy: currentUpdatedBy(),
        };

        if (isApiEnabled()) {
          const snap = snapshotLocalState_();
          // Optimistic UI update: reflect immediately, then sync to API (no full reload).
          saveSpotShipment(entry);
          refreshViewFast();
          syncSave("saveShipment", {
            id: entry.id,
            shipmentType: "spot",
            date: entry.date,
            destinationId: entry.destinationId,
            destinationName: entry.destinationName,
            standard: entry.standard,
            quantity: entry.quantity,
            unit: entry.unit,
            standard2: entry.standard2 || "",
            quantity2: entry.quantity2 || 0,
            unit2: entry.unit2 || "",
            memo: entry.memo,
            recurrenceRuleId: "",
            updatedAt: entry.updatedAt,
            updatedBy: entry.updatedBy,
          }, snap, "保存しました");
          // loadAllDataFromApi() removed for performance (optimistic update).
        } else {
          saveSpotShipment(entry);
        }

        state.selectedDate = entry.date;
        setStatus("保存しました", "ok");
        showToast("保存しました", "success");
        resetEntryForm();
        renderAll();
        return;
      }

      const recurrenceRaw = document.getElementById("recurrenceType").value;
      const intervalWeeks = recurrenceRaw === "weekly_2" ? 2 : 1;
      const recurrenceType =
        recurrenceRaw === "monthlyByDate" ||
        recurrenceRaw === "referenceDate" ||
        recurrenceRaw === "beforeReferenceNearestWeekday"
          ? recurrenceRaw
          : "weekly";

      const referenceDay = Number(document.getElementById("referenceDay").value || 0);
      const shipOffsetDays = Number(document.getElementById("shipOffsetDays").value || 0);
      const selectedRecurringWeekdays = getSelectedWeekdays();

      const rule = {
        id: document.getElementById("recurringId").value || createId(),
        shipmentType: "recurring",
        destinationId: destId,
        destinationName: destName,
        destination: destName,
        standard: requiredValue("shipmentStandard", "規格"),
        quantity: Number(document.getElementById("shipmentQuantity").value || 0),
        unit: requiredValue("shipmentUnit", "単位"),
          standard2: String(document.getElementById("shipmentStandard2").value || "").trim(),
          quantity2: Number(document.getElementById("shipmentQuantity2").value || 0),
          unit2: String(document.getElementById("shipmentUnit2").value || "").trim(),
        memo: document.getElementById("shipmentMemo").value.trim(),
        recurrenceType,
        startDate: requiredValue("startDate", "開始日"),
        endDate: document.getElementById("endDate").value,
        weekdays: recurrenceType === "weekly" ? selectedRecurringWeekdays : [],
        intervalWeeks,
        monthDays: recurrenceType === "monthlyByDate" ? parseMonthDays(document.getElementById("monthDays").value) : [],
        referenceDay,
        referenceWeekdays: recurrenceType === "referenceDate" ? selectedRecurringWeekdays : [],
        candidateWeekdays: recurrenceType === "beforeReferenceNearestWeekday" ? selectedRecurringWeekdays : [],
        shipOffsetDays: recurrenceType === "referenceDate" || recurrenceType === "beforeReferenceNearestWeekday" ? shipOffsetDays : 0,
        referenceItems: [],
        updatedAt: new Date().toISOString(),
        updatedBy: currentUpdatedBy(),
      };

      const referenceItems = getReferenceItemsFromForm();
      if (referenceItems.length) {
        rule.referenceItems = referenceItems.map((item) => normalizeReferenceItem(item, rule));
      }

      if (recurrenceType === "weekly" && rule.weekdays.length === 0) throw new Error("曜日を1つ以上選択してください");
      if (recurrenceType === "monthlyByDate" && rule.monthDays.length === 0) throw new Error("日付を1つ以上指定してください");
      if ((recurrenceType === "referenceDate" || recurrenceType === "beforeReferenceNearestWeekday") && !Number.isInteger(referenceDay)) {
        throw new Error("基準日を入力してください");
      }
      if ((recurrenceType === "referenceDate" || recurrenceType === "beforeReferenceNearestWeekday") && (referenceDay < 1 || referenceDay > 31)) {
        throw new Error("基準日を入力してください");
      }
      if ((recurrenceType === "referenceDate" || recurrenceType === "beforeReferenceNearestWeekday") && selectedRecurringWeekdays.length === 0) {
        throw new Error("曜日を1つ以上選択してください");
      }

      if (isApiEnabled()) {
        const snap = snapshotLocalState_();
        // Optimistic UI update: reflect immediately, then sync to API (no full reload).
        saveRecurringShipment(rule);
        refreshViewFast();
        syncSave("saveRecurringShipment", {
          id: rule.id,
          destinationId: rule.destinationId,
          destinationName: rule.destinationName,
          standard: rule.standard,
          quantity: rule.quantity,
          unit: rule.unit,
          memo: rule.memo,
          standard2: rule.standard2 || "",
          quantity2: rule.quantity2 || 0,
          unit2: rule.unit2 || "",
          recurrenceType: rule.recurrenceType,
          startDate: rule.startDate,
          endDate: rule.endDate,
          weekdays: JSON.stringify(rule.weekdays),
          intervalWeeks: rule.intervalWeeks,
          monthDays: JSON.stringify(rule.monthDays),
          referenceDay: rule.referenceDay,
          referenceWeekdays: JSON.stringify(rule.referenceWeekdays || []),
          candidateWeekdays: JSON.stringify(rule.candidateWeekdays || []),
          shipOffsetDays: rule.shipOffsetDays || 0,
          referenceItems: JSON.stringify(rule.referenceItems || []),
          updatedAt: rule.updatedAt,
          updatedBy: rule.updatedBy,
        }, snap, "保存しました");
        // loadAllDataFromApi() removed for performance (optimistic update).
      } else {
        saveRecurringShipment(rule);
      }

      state.selectedDate = rule.startDate;
      setStatus("保存しました", "ok");
      showToast("保存しました", "success");
      resetEntryForm();
      renderAll();
      return;
    }

    if (type === "event") {
      const entry = {
        id: document.getElementById("entryId").value || createId(),
        type: "event",
        date: requiredValue("eventDate", "予定日"),
        time: document.getElementById("eventTime").value,
        title: requiredValue("eventTitle", "予定名"),
        memo: document.getElementById("eventMemo").value.trim(),
        updatedAt: new Date().toISOString(),
        updatedBy: currentUpdatedBy(),
      };

      if (isApiEnabled()) {
      // Optimistic UI update: reflect immediately, then sync to API (no full reload).
      upsertById(state.entries, entry);
      saveState();
      refreshViewFast();
        await apiPost("saveEvent", entry);
        // loadAllDataFromApi() removed for performance (optimistic update).
      } else {
        upsertById(state.entries, entry);
        saveState();
      }

      state.selectedDate = entry.date;
      setStatus("保存しました", "ok");
      showToast("保存しました", "success");
      resetEntryForm();
      renderAll();
      return;
    }

    const entry = {
      id: document.getElementById("entryId").value || createId(),
      type: "memo",
      date: requiredValue("memoDate", "メモ日"),
      content: requiredValue("memoContent", "メモ内容"),
      priority: document.getElementById("memoPriority").value,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUpdatedBy(),
    };

    if (isApiEnabled()) {
    // Optimistic UI update: reflect immediately, then sync to API (no full reload).
    upsertById(state.entries, entry);
    saveState();
    refreshViewFast();
      await apiPost("saveMemo", entry);
      // loadAllDataFromApi() removed for performance (optimistic update).
    } else {
      upsertById(state.entries, entry);
      saveState();
    }

    state.selectedDate = entry.date;
    setStatus("保存しました", "ok");
    showToast("保存しました", "success");
    resetEntryForm();
    renderAll();
  } catch (err) {
    setStatus(`保存に失敗しました: ${err instanceof Error ? err.message : String(err)}`, "err");
    showToast(`保存に失敗しました: ${err instanceof Error ? err.message : String(err)}`, "error");
  } finally {
    setBusy(false, "");
    resetButtonLoading(submitBtn);
  }
}

async function setEntryToForm(entry) {
  resetEntryForm();

  if (entry.type === "shipment" && entry.shipmentType === "recurring") {
    const choice = await recurringChoice_("edit");
    if (!choice) return false;

    if (choice === "day") {
      document.getElementById("entryMode").value = "recurring_override";
      document.getElementById("exceptionRecurringId").value = String(entry._ruleId || entry.recurringId || entry.id || "");
      document.getElementById("exceptionDate").value = String(entry.date || "");
      document.getElementById("entryId").value = String(entry.id || createId());

      document.getElementById("entryType").value = "shipment";
      switchEntryTypeFields();

      document.getElementById("shipmentKind").value = "spot";
      switchShipmentKindFields();

      document.getElementById("shipmentDate").value = entry.date;
      document.getElementById("shipmentDestination").value = String(entry.destinationId || "");
      document.getElementById("shipmentStandard").value = entry.standard;
      document.getElementById("shipmentQuantity").value = String(entry.quantity ?? 0);
      document.getElementById("shipmentUnit").value = entry.unit;
      document.getElementById("shipmentStandard2").value = String(entry.standard2 || "");
      document.getElementById("shipmentQuantity2").value = String(entry.quantity2 ?? 0);
      document.getElementById("shipmentUnit2").value = String(entry.unit2 || "");
      toggleShipmentSpec2(Boolean(String(entry.standard2 || "").trim()));
      document.getElementById("shipmentMemo").value = entry.memo || "";

      const overrideBox = document.getElementById("recurringOverrideFields");
      if (overrideBox) overrideBox.classList.remove("hidden");
      const offsetInput = document.getElementById("exceptionShipOffsetDays");
      if (offsetInput) offsetInput.value = String(entry.shipOffsetDays ?? 0);
      return true;
    }

    const rule = state.recurringShipments.find((r) => r.id === (entry._ruleId || entry.id)) || state.recurringShipments.find((r) => r.id === entry.id);
    if (!rule) return false;

    document.getElementById("entryType").value = "shipment";
    switchEntryTypeFields();

    document.getElementById("shipmentKind").value = "recurring";
    switchShipmentKindFields();

    document.getElementById("recurringId").value = rule.id;
    document.getElementById("shipmentDestination").value = String(rule.destinationId || "");
    document.getElementById("shipmentStandard").value = rule.standard;
    document.getElementById("shipmentQuantity").value = String(rule.quantity ?? 0);
    document.getElementById("shipmentUnit").value = rule.unit;
    document.getElementById("shipmentStandard2").value = String(rule.standard2 || "");
    document.getElementById("shipmentQuantity2").value = String(rule.quantity2 ?? 0);
    document.getElementById("shipmentUnit2").value = String(rule.unit2 || "");
    toggleShipmentSpec2(Boolean(String(rule.standard2 || "").trim()));
    document.getElementById("shipmentMemo").value = rule.memo || "";
    setReferenceItemsToForm(rule.referenceItems || [], rule);

    if (rule.recurrenceType === "monthlyByDate") {
      document.getElementById("recurrenceType").value = "monthlyByDate";
      document.getElementById("monthDays").value = (rule.monthDays || []).join(",");
    } else if (rule.recurrenceType === "referenceDate") {
      document.getElementById("recurrenceType").value = "referenceDate";
      document.getElementById("referenceDay").value = String(rule.referenceDay || "");
      document.getElementById("shipOffsetDays").value = String(rule.shipOffsetDays ?? -1);
      setSelectedWeekdays(rule.referenceWeekdays || rule.weekdays || []);
    } else if (rule.recurrenceType === "beforeReferenceNearestWeekday") {
      document.getElementById("recurrenceType").value = "beforeReferenceNearestWeekday";
      document.getElementById("referenceDay").value = String(rule.referenceDay || "");
      document.getElementById("shipOffsetDays").value = String(rule.shipOffsetDays ?? -1);
      setSelectedWeekdays(rule.candidateWeekdays || rule.referenceWeekdays || rule.weekdays || []);
    } else {
      document.getElementById("recurrenceType").value = Number(rule.intervalWeeks) === 2 ? "weekly_2" : "weekly_1";
      setSelectedWeekdays(rule.weekdays || []);
    }
    switchRecurrenceTypeFields();

    document.getElementById("startDate").value = rule.startDate || "";
    document.getElementById("endDate").value = rule.endDate || "";
    return true;
  }

  if (entry.type === "shipment") {
    document.getElementById("entryId").value = entry.id;
    document.getElementById("entryType").value = "shipment";
    switchEntryTypeFields();

    document.getElementById("shipmentKind").value = "spot";
    switchShipmentKindFields();

    document.getElementById("shipmentDate").value = entry.date;
    document.getElementById("shipmentDestination").value = String(entry.destinationId || "");
    document.getElementById("shipmentStandard").value = entry.standard;
    document.getElementById("shipmentQuantity").value = String(entry.quantity ?? 0);
    document.getElementById("shipmentUnit").value = entry.unit;
    document.getElementById("shipmentStandard2").value = String(entry.standard2 || "");
    document.getElementById("shipmentQuantity2").value = String(entry.quantity2 ?? 0);
    document.getElementById("shipmentUnit2").value = String(entry.unit2 || "");
    toggleShipmentSpec2(Boolean(String(entry.standard2 || "").trim()));
    document.getElementById("shipmentMemo").value = entry.memo || "";
    return true;
  }

  if (entry.type === "event") {
    document.getElementById("entryId").value = entry.id;
    document.getElementById("entryType").value = "event";
    switchEntryTypeFields();

    document.getElementById("eventDate").value = entry.date;
    document.getElementById("eventTime").value = entry.time || "";
    document.getElementById("eventTitle").value = entry.title || "";
    document.getElementById("eventMemo").value = entry.memo || "";
    return true;
  }

  document.getElementById("entryId").value = entry.id;
  document.getElementById("entryType").value = "memo";
  switchEntryTypeFields();

  document.getElementById("memoDate").value = entry.date;
  document.getElementById("memoContent").value = entry.content || "";
  document.getElementById("memoPriority").value = entry.priority || "medium";
  return true;
}

function resetEntryForm() {
  document.getElementById("entryForm").reset();
  document.getElementById("entryId").value = "";
  const entryMode = document.getElementById("entryMode");
  if (entryMode) entryMode.value = "";
  const exceptionRecurringId = document.getElementById("exceptionRecurringId");
  if (exceptionRecurringId) exceptionRecurringId.value = "";
  const exceptionDate = document.getElementById("exceptionDate");
  if (exceptionDate) exceptionDate.value = "";
  const exceptionShipOffsetDays = document.getElementById("exceptionShipOffsetDays");
  if (exceptionShipOffsetDays) exceptionShipOffsetDays.value = "0";
  const overrideBox = document.getElementById("recurringOverrideFields");
  if (overrideBox) overrideBox.classList.add("hidden");
  document.getElementById("recurringId").value = "";
  document.getElementById("shipmentKind").value = "spot";
  document.getElementById("entryType").value = "shipment";

  setFormDate(state.selectedDate);
  document.getElementById("startDate").value = state.selectedDate;
  document.getElementById("endDate").value = "";

    document.getElementById("recurrenceType").value = "weekly_1";
    setSelectedWeekdays([new Date(state.selectedDate).getDay()]);
    document.getElementById("monthDays").value = "";
    document.getElementById("referenceDay").value = "";
    document.getElementById("shipOffsetDays").value = "-1";
    clearReferenceItemRows();

    switchEntryTypeFields();
    switchShipmentKindFields();
    switchRecurrenceTypeFields();
  }

async function submitDestinationForm(e) {
  e.preventDefault();
  if (state.isBusy) return;

  const id = document.getElementById("destinationId").value || createId();
  const dest = {
    id,
    name: requiredValue("destinationName", "出荷先名"),
    address: document.getElementById("destinationAddress").value.trim(),
    phone: document.getElementById("destinationPhone").value.trim(),
    contactPerson: document.getElementById("destinationContact").value.trim(),
    email: document.getElementById("destinationEmail").value.trim(),
    note: document.getElementById("destinationNote").value.trim(),
    active: document.getElementById("destinationActive").checked,
    sortOrder: (function(){
      const existing = state.destinations.find((x) => String(x.id) === String(id));
      if (existing && existing.sortOrder !== undefined && existing.sortOrder !== null) return existing.sortOrder;
      const max = state.destinations.reduce((m, x) => {
        const v = x && x.sortOrder !== undefined && x.sortOrder !== null ? Number(x.sortOrder) : NaN;
        return Number.isFinite(v) ? Math.max(m, v) : m;
      }, 0);
      return max + 1;
    })(),
    updatedAt: new Date().toISOString(),
    updatedBy: currentUpdatedBy(),
  };

  try {
    setBusy(true, "保存中...");
    if (isApiEnabled()) {
    // Optimistic UI update: reflect immediately, then sync to API (no full reload).
    upsertById(state.destinations, dest);
    saveState();
    fillMasterSelects();
    renderDestinationList();
      await saveDestinationToApi(dest);
      // loadAllDataFromApi() removed for performance (optimistic update).
    } else {
      upsertById(state.destinations, dest);
      saveState();
    }
    setStatus("保存しました", "ok");
    showToast("保存しました", "success");
    resetDestinationForm();
    fillMasterSelects();
    renderDestinationList();
  } catch (err) {
    setStatus(formatErrorForUi("出荷先の保存に失敗しました", err, dest), "err");
  } finally {
    setBusy(false, "");
  }
}

function getDestinationUsageStats() {
  // usage: shipments (spot) + recurring shipment rules
  const stats = new Map();

  function inc(destId, whenValue) {
    const id = String(destId || "").trim();
    if (!id) return;
    const cur = stats.get(id) || { count: 0, lastUsed: "" };
    cur.count += 1;
    const when = pickNewestDateKey_(whenValue);
    if (when && (!cur.lastUsed || when > cur.lastUsed)) cur.lastUsed = when;
    stats.set(id, cur);
  }

  (state.entries || []).forEach((e) => {
    if (!e || e.type !== "shipment") return;
    inc(e.destinationId, e.updatedAt || e.date);
  });

  (state.recurringShipments || []).forEach((r) => {
    if (!r) return;
    inc(r.destinationId, r.updatedAt || r.startDate || r.date);
  });

  return stats;
}

function sortDestinationsByUsage(destinations) {
  const list = (destinations || []).slice();
  const stats = getDestinationUsageStats();

  return list.sort((a, b) => {
    const ida = String((a && a.id) || "");
    const idb = String((b && b.id) || "");
    const sa = stats.get(ida) || { count: 0, lastUsed: "" };
    const sb = stats.get(idb) || { count: 0, lastUsed: "" };

    if (sb.count !== sa.count) return sb.count - sa.count;
    if (sb.lastUsed !== sa.lastUsed) return String(sb.lastUsed).localeCompare(String(sa.lastUsed));
    return String(a && a.name ? a.name : "").localeCompare(String(b && b.name ? b.name : ""));
  });
}

function getSortedDestinations() {
  return sortDestinationsByUsage(state.destinations || []);
}

function pickNewestDateKey_(value) {
  // Normalize to YYYY-MM-DD for stable string comparison.
  if (!value) return "";
  const v = String(value).trim();
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sortDestinations_(list) {
  // Backward compat: existing callers use sortDestinations_.
  return sortDestinationsByUsage(list);
}
function renderDestinationList() {
  const ul = document.getElementById("destinationList");
  ul.innerHTML = "";
  if (!state.destinations.length) {
    const li = document.createElement("li");
    li.textContent = "出荷先が未登録です";
    ul.appendChild(li);
    return;
  }

  const sorted = getSortedDestinations();
  sorted.forEach((d, idx) => {
    const li = document.createElement("li");
    const name = document.createElement("div");
    name.className = "one-line";
    name.textContent = `${d.name} ${d.active ? "" : "(無効)"}`;

    const actions = document.createElement("div");
    actions.className = "row-actions";

      const editBtn = document.createElement("button");
    editBtn.className = "text-btn";
    editBtn.textContent = "編集";
    editBtn.disabled = state.isBusy;
    editBtn.addEventListener("click", () => setDestinationToForm(d));

    const delBtn = document.createElement("button");
    delBtn.className = "text-btn";
    delBtn.textContent = "削除";
    delBtn.disabled = state.isBusy;
    delBtn.addEventListener("click", () => void deleteDestination(d));

    actions.append(editBtn, delBtn);
    li.append(name, actions);
    ul.appendChild(li);

    });
}

async function deleteDestination(d) {
  if (!confirm("削除しますか？")) return;
  try {
    setBusy(true, "削除中…");
    if (isApiEnabled()) {
      // Optimistic UI update: remove locally first, then sync delete to API.
      const snap = snapshotLocalState_();
      state.destinations = state.destinations.filter((x) => x.id !== d.id);
      saveState();
      fillMasterSelects();
      renderDestinationList();
      await deleteItemFromApi("deleteDestination", d.id);
      // loadAllDataFromApi() removed for performance (optimistic update).
    } else {
      state.destinations = state.destinations.filter((x) => x.id !== d.id);
      saveState();
    }
    setStatus("削除しました", "ok");
    showToast("削除しました", "success");
    fillMasterSelects();
    renderDestinationList();
  } catch (err) {
    setStatus(formatErrorForUi("出荷先の削除に失敗しました", err, { id: d && d.id }), "err");
    showToast("削除に失敗しました", "error");
  } finally {
    setBusy(false, "");
  }
}

function setDestinationToForm(d) {
  document.getElementById("destinationId").value = d.id;
  document.getElementById("destinationName").value = d.name || "";
  document.getElementById("destinationAddress").value = d.address || "";
  document.getElementById("destinationPhone").value = d.phone || "";
  document.getElementById("destinationContact").value = d.contactPerson || "";
  document.getElementById("destinationEmail").value = d.email || "";
  document.getElementById("destinationNote").value = d.note || "";
  document.getElementById("destinationActive").checked = Boolean(d.active);
}

function resetDestinationForm() {
  document.getElementById("destinationForm").reset();
  document.getElementById("destinationId").value = "";
  document.getElementById("destinationActive").checked = true;
}

async function addStandard(e) {
  e.preventDefault();
  const input = document.getElementById("standardInput");
  const value = input.value.trim();
  if (!value) return;
  if (!state.standards.includes(value)) state.standards.push(value);
  input.value = "";
  saveState();
  fillMasterSelects();
  renderStandardList();
}

async function addUnit(e) {
  e.preventDefault();
  const input = document.getElementById("unitInput");
  const value = input.value.trim();
  if (!value) return;
  if (!state.units.includes(value)) state.units.push(value);
  input.value = "";
  saveState();
  fillMasterSelects();
  renderUnitList();
}

function renderStandardList() {
  const ul = document.getElementById("standardList");
  ul.innerHTML = "";
  state.standards.forEach((s) => ul.appendChild(masterRow(s, "standard")));
}

function renderUnitList() {
  const ul = document.getElementById("unitList");
  ul.innerHTML = "";
  state.units.forEach((u) => ul.appendChild(masterRow(u, "unit")));
}

function masterRow(value, category) {
  const li = document.createElement("li");
  const text = document.createElement("div");
  text.className = "one-line";
  text.textContent = value;

  const actions = document.createElement("div");
  actions.className = "row-actions";

      const editBtn = document.createElement("button");
  editBtn.className = "text-btn";
  editBtn.textContent = "編集";
  editBtn.disabled = state.isBusy;
  editBtn.addEventListener("click", () => {
    const next = prompt("新しい値", value);
    if (!next || !next.trim()) return;
    const arr = category === "standard" ? state.standards : state.units;
    const idx = arr.indexOf(value);
    if (idx >= 0) arr[idx] = next.trim();
    saveState();
    fillMasterSelects();
    renderStandardList();
    renderUnitList();
  });

  const delBtn = document.createElement("button");
  delBtn.className = "text-btn";
  delBtn.textContent = "削除";
  delBtn.disabled = state.isBusy;
  delBtn.addEventListener("click", () => {
    const arr = category === "standard" ? state.standards : state.units;
    if (arr.length <= 1) {
      alert("最後の1件は削除できません");
      return;
    }
    if (!confirm("削除しますか？")) return;
    if (category === "standard") state.standards = state.standards.filter((x) => x !== value);
    if (category === "unit") state.units = state.units.filter((x) => x !== value);
    saveState();
    fillMasterSelects();
    renderStandardList();
    renderUnitList();
  });

  actions.append(editBtn, delBtn);
  li.append(text, actions);
  return li;
}

function fillMasterSelects() {
  fillDestinationSelect("shipmentDestination", state.destinations.filter((d) => d.active));
  applyLastDestinationToForm();
  fillSelect("shipmentStandard", state.standards, "規格を選択");
  fillSelect("shipmentStandard2", state.standards, "規格を選択");
  fillSelect("shipmentUnit", state.units, "単位を選択");
  fillSelect("shipmentUnit2", state.units, "単位を選択");
}

function fillDestinationSelect(id, destinations) {
  const select = document.getElementById(id);
  const prev = select.value;
  select.innerHTML = "";
  if (!destinations.length) {
    const opt = new Option("出荷先を先に登録してください", "");
    select.appendChild(opt);
    select.disabled = true;
    return;
  }
  select.disabled = false;
  sortDestinations_(destinations).forEach((d) => select.appendChild(new Option(d.name, d.id)));
  if (destinations.some((d) => String(d.id) === prev)) select.value = prev;
}

function fillSelect(id, items, placeholder) {
  const select = document.getElementById(id);
  const prev = select.value;
  select.innerHTML = "";

  // Always include a blank/placeholder option so optional selects can stay empty.
  select.appendChild(new Option(placeholder, ""));

  if (!items.length) {
    select.disabled = true;
    return;
  }
  select.disabled = false;
  items.forEach((v) => select.appendChild(new Option(v, v)));

  // Restore previous selection if still available; otherwise keep blank.
  if (items.includes(prev)) select.value = prev;
}

function entriesByDate(date, opts = {}) {
  const key = normalizeDateKey(date);
  const base = state.entries.filter((x) => normalizeDateKey(x.date) === key);
  const generated = applyRecurringExceptions_((opts.generatedRecurring || []).filter((x) => normalizeDateKey(x.date) === key));
  // Debug: helps diagnose date-format mismatches where events are "saved but not shown".
  if (key === formatDate(new Date())) {
    try {
      const eventsToday = base.filter((x) => x.type === "event").length;
      console.log("[sakaki] entriesByDate(today)", {
        today: key,
        eventsToday,
        baseTotal: base.length,
        generatedRecurring: generated.length,
      });
    } catch {}
  }
  return [...base, ...generated];
}

function entrySummary(entry) {
  if (entry.type === "shipment") {
    const dest = entry.destinationName || entry.destination || "";
    return `${dest} ${entry.standard} ${entry.quantity}${entry.unit}`;
  }
  // Show time first like "14:00 テスト予定
  if (entry.type === "event") {
    const t = normalizeTimeText(entry.time);
    return `${t ? `${t} ` : ""}${entry.title}`;
  }
  return entry.content;
}

function upsertById(arr, item) {
  const idx = arr.findIndex((x) => x.id === item.id);
  if (idx >= 0) arr[idx] = item;
  else arr.push(item);
}

function requiredValue(id, label) {
  const v = String(document.getElementById(id).value || "").trim();
  if (!v) throw new Error(`${label}を入力してください`);
  return v;
}

function parseMonthDays(raw) {
  const days = String(raw || "")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 31);
  return Array.from(new Set(days)).sort((a, b) => a - b);
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value.map((x) => Number(x)).filter((n) => Number.isFinite(n));
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    if (Array.isArray(parsed)) return parsed.map((x) => Number(x)).filter((n) => Number.isFinite(n));
  } catch {
    // fallthrough
  }
  return String(value)
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n));
}

function parseReferenceItems(value) {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : (() => {
    try {
      const parsed = JSON.parse(String(value));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();
  return raw.map((item) => normalizeReferenceItem(item, {})).filter((item) => Number.isFinite(item.referenceDay) && item.referenceDay >= 1 && item.referenceDay <= 31);
}

function normalizeReferenceItem(item, fallbackRule) {
  const refDay = Number(item && item.referenceDay != null ? item.referenceDay : fallbackRule.referenceDay || 0);
  return {
    referenceDay: Number.isFinite(refDay) ? refDay : 0,
    standard: String((item && item.standard) || fallbackRule.standard || ""),
    quantity: Number((item && item.quantity) != null ? item.quantity : fallbackRule.quantity || 0),
    unit: String((item && item.unit) || fallbackRule.unit || ""),
    standard2: String((item && item.standard2) || fallbackRule.standard2 || ""),
    quantity2: Number((item && item.quantity2) != null ? item.quantity2 : fallbackRule.quantity2 || 0),
    unit2: String((item && item.unit2) || fallbackRule.unit2 || ""),
    memo: String((item && item.memo) || fallbackRule.memo || ""),
    shipOffsetDays: Number((item && item.shipOffsetDays) != null ? item.shipOffsetDays : fallbackRule.shipOffsetDays || 0),
  };
}

function normalizeDateKey(value) {
  const s = String(value || "").trim();
  if (!s) return "";

  // If we got an ISO date-time (often from Sheets), convert to local date to avoid off-by-one (JST) issues.
  // Example: "2026-06-02T15:00:00.000Z" should be treated as 2026-06-03 in Asia/Tokyo.
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return formatDate(d);
  }

  // Accept "YYYY-MM-DD", "YYYY/MM/DD" and ISO strings like "YYYY-MM-DDTHH:mm:ss.sssZ".
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slash = s.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  if (slash) return `${slash[1]}-${slash[2]}-${slash[3]}`;
  return s;
}

function normalizeTimeText(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  // "14:00:00" -> "14:00"
  const hm = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (hm) return `${hm[1].padStart(2, "0")}:${hm[2]}`;

  // Sheets time cells can come back as ISO (1899-12-30...Z). Normalize to HH:mm.
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  return s;
}

function parseNumberList(value) {
  if (Array.isArray(value)) return value.map((x) => Number(x)).filter((n) => Number.isFinite(n));
  const s = String(value || "").trim();
  if (!s) return [];
  // JSON array "[2,4]"
  if (s.startsWith("[") && s.endsWith("]")) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map((x) => Number(x)).filter((n) => Number.isFinite(n));
    } catch {}
  }
  // CSV "5,20" or single "2"
  return s
    .split(",")
    .map((x) => Number(String(x).trim()))
    .filter((n) => Number.isFinite(n));
}

function createId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createIdFrom(ruleId, dateKey) {
  return `${ruleId}__${dateKey}`;
}

function stripTime(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDate(yyyyMMdd) {
  if (!yyyyMMdd) return null;
  const [y, m, d] = String(yyyyMMdd)
    .split("-")
    .map((x) => Number(x));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function isJapaneseHoliday(date) {
  // Minimal JP holiday calculation (sufficient for calendar coloring).
  // Covers fixed-date holidays, Happy Monday, equinoxes, substitute/citizens holidays.
  const d = stripTime(date);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();

  function nthMonday(month, nth) {
    const first = new Date(y, month - 1, 1);
    const firstDow = first.getDay();
    const offset = (8 - firstDow) % 7;
    return 1 + offset + (nth - 1) * 7;
  }

  function vernalEquinoxDay(year) {
    // Approx for 1900-2099
    return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }

  function autumnEquinoxDay(year) {
    return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }

  function isFixedHoliday(mm, dd) {
    const fixed = [
      [1, 1],
      [2, 11],
      [2, 23],
      [4, 29],
      [5, 3],
      [5, 4],
      [5, 5],
      [8, 11],
      [11, 3],
      [11, 23],
    ];
    return fixed.some(([fm, fd]) => fm === mm && fd === dd);
  }

  function isHappyMondayHoliday(mm, dd) {
    if (mm === 1 && dd === nthMonday(1, 2) && y >= 2000) return true;
    if (mm === 7 && dd === nthMonday(7, 3) && y >= 2003) return true;
    if (mm === 9 && dd === nthMonday(9, 3) && y >= 2003) return true;
    if (mm === 10 && dd === nthMonday(10, 2) && y >= 2000) return true;
    return false;
  }

  function isBaseHoliday(mm, dd) {
    if (isFixedHoliday(mm, dd)) return true;
    if (mm === 3 && dd === vernalEquinoxDay(y)) return true;
    if (mm === 9 && dd === autumnEquinoxDay(y)) return true;
    if (isHappyMondayHoliday(mm, dd)) return true;
    return false;
  }

  if (isBaseHoliday(m, day)) return true;

  // Substitute holiday (if a base holiday falls on Sunday, the next non-holiday weekday becomes a holiday).
  // Only treat this day as substitute when the days in-between are also base holidays (carry-over rule).
  if (d.getDay() >= 1 && d.getDay() <= 6 && !isBaseHoliday(m, day)) {
    for (let back = 1; back <= 7; back += 1) {
      const sunday = new Date(d);
      sunday.setDate(d.getDate() - back);
      if (!(isBaseHoliday(sunday.getMonth() + 1, sunday.getDate()) && sunday.getDay() === 0)) continue;

      let ok = true;
      for (let i = 1; i < back; i += 1) {
        const mid = new Date(d);
        mid.setDate(d.getDate() - i);
        if (!isBaseHoliday(mid.getMonth() + 1, mid.getDate())) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
  }

  // Citizen's holiday: weekday between two base holidays
  if (d.getDay() >= 1 && d.getDay() <= 5) {
    const prev = new Date(d);
    const next = new Date(d);
    prev.setDate(d.getDate() - 1);
    next.setDate(d.getDate() + 1);
    if (isBaseHoliday(prev.getMonth() + 1, prev.getDate()) && isBaseHoliday(next.getMonth() + 1, next.getDate())) return true;
  }

  return false;
}

function readLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeLS(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

window.addEventListener("error", (e) => {
  if (e.error instanceof Error) alert(e.error.message);
});

// TODO: 複数人共有（認証/権限）
// TODO: Googleスプレッドシート連携の強化（CORS回避のGET方式は暫定）
// TODO: FAX画像アップロード/OCR（将来拡張）
// TODO: iPhoneホーム画面ウィジェット風の『今日の予定』






function requestBackgroundSync_(reason) {
  if (!isApiEnabled()) return;
  // Throttle background sync to avoid hammering GAS.
  const now = Date.now();
  const last = Number(state._lastAutoSyncAt || 0);
  if (now - last < 8000) return;
  state._lastAutoSyncAt = now;

  // Fire-and-forget background refresh.
  (async () => {
    try {
      await loadAllDataFromApi();
      renderAll();
      console.log("[sakaki] auto sync ok", reason || "");
    } catch (e) {
      console.warn("[sakaki] auto sync failed", reason || "", e);
    }
  })();
}

function debugOverflowElements_() {
  const vw = document.documentElement.clientWidth;
  const els = Array.from(document.querySelectorAll("*"))
    .filter((el) => el && el.scrollWidth && el.scrollWidth > vw + 1);

  console.log("[sakaki] viewport width", vw);
  console.log("[sakaki] overflow elements", els);

  let panel = document.getElementById("overflowDebugPanel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "overflowDebugPanel";
    panel.className = "overflow-debug";
    document.body.appendChild(panel);
  }

  const rows = els
    .slice(0, 40)
    .map((el) => {
      const id = el.id ? `#${el.id}` : "";
      const cls = el.className ? `.${String(el.className).trim().replace(/\s+/g, ".")}` : "";
      return `<div class="overflow-debug__row"><div class="overflow-debug__k">${el.tagName}${id}${cls}</div><div class="overflow-debug__v">scrollW=${el.scrollWidth} clientW=${el.clientWidth} vw=${vw}</div></div>`;
    })
    .join("");

  panel.innerHTML = `<div class="overflow-debug__head">overflow elements (${els.length})</div>` + (rows || `<div class="overflow-debug__empty">none</div>`);
}

function maybeEnableOverflowDebug_() {
  if (!String(location.search || "").includes("debugOverflow=1")) return;
  window.setTimeout(debugOverflowElements_, 600);
  window.addEventListener("resize", () => window.setTimeout(debugOverflowElements_, 200));
}














function setDebugError_(label, err) {
  if (!state._debugUiEnabled) return;
  const el = document.getElementById("debugErrors");
  if (!el) return;
  const msg = err instanceof Error ? err.message : String(err);
  el.textContent = `${label}: ${msg}`;
  el.classList.remove("hidden");
}

function updateDebugBar_() {
  if (!state._debugUiEnabled) return;
  const v = document.getElementById("appVersion");
  const t = document.getElementById("buildTime");
  const f = document.getElementById("debugFlags");
  if (v) v.textContent = `v${APP_VERSION}`;
  if (t) t.textContent = BUILD_TIME;

  if (f) {
    const api = String(state.apiUrl || "").trim();
    const flags = [
      `init:${Boolean(state._didInit)}`,
      `boot:${Boolean(state._didBoot)}`,
      `apiUrl:${Boolean(api)}`,
      `autoSync:${String(state._lastAutoSyncOk)} / started:${Boolean(state._autoSyncStarted)} / ok:${Boolean(state._autoSyncSucceeded)} / fail:${Boolean(state._autoSyncFailed)} / branch:${Boolean(state._bootApiBranch)}`,
    ];
    f.textContent = flags.join(" / ");
  }
}

function bindGlobalErrorHandlers_() {
  window.addEventListener("error", (e) => {
    setDebugError_("JS ERROR", e && e.error ? e.error : (e && e.message ? e.message : String(e)));
  });
  window.addEventListener("unhandledrejection", (e) => {
    setDebugError_("PROMISE ERROR", e && e.reason ? e.reason : String(e));
  });
}





function stripGarbageTextNodes_() {
  // Old cached HTML sometimes contains literal '`r`n' sequences as text nodes.
  // Remove them so the UI stays clean even if the PWA uses a stale index.html.
  try {
    const bad = "`r`n";
    const nodes = Array.from(document.body.childNodes || []);
    nodes.forEach((n) => {
      if (n && n.nodeType === Node.TEXT_NODE) {
        const t = String(n.textContent || "");
        if (t.includes(bad) || t.includes('\\r\\n') || t.includes('\\n')) {
          // Remove only if it looks like the garbage sequence (mostly backticks and letters)
          if (/^[\s`rn\\]+$/.test(t)) n.remove();
        }
      }
    });
  } catch {}
}








function getDebugPre_() {
  let pre = document.getElementById("shipmentDebugPre");
  if (!pre) {
    pre = document.createElement("pre");
    pre.id = "shipmentDebugPre";
    pre.className = "shipment-debug-pre";
    pre.textContent = "";
    document.body.appendChild(pre);
  }
  return pre;
}

function appendShipmentDebug_(li, line1) {
  if (!state._debugUiEnabled) return;
  try {
    console.log("[shipment html]", li.outerHTML);

    const dest = line1.querySelector(".entry-destination");
    const std = line1.querySelector(".entry-standard");
    const qty = line1.querySelector(".entry-quantity");

    const csLine = getComputedStyle(line1);
    const csDest = dest ? getComputedStyle(dest) : null;
    const csStd = std ? getComputedStyle(std) : null;
    const csQty = qty ? getComputedStyle(qty) : null;

    console.log("[shipment style]", {
      line: { display: csLine.display, gridTemplateColumns: csLine.gridTemplateColumns },
      dest: csDest ? { display: csDest.display } : null,
      std: csStd ? { display: csStd.display } : null,
      qty: csQty ? { display: csQty.display } : null,
    });

    const pre = getDebugPre_();
    const parts = [];
    parts.push("--- shipment row ---");
    parts.push(`hasClass(entry-line--shipment)=${line1.classList.contains("entry-line--shipment")}`);
    parts.push(`display=${csLine.display}`);
    parts.push(`grid-template-columns=${csLine.gridTemplateColumns}`);
    parts.push(`dest/std/qty are separate nodes=${Boolean(dest)} / ${Boolean(std)} / ${Boolean(qty)}`);
    parts.push(li.outerHTML);
    pre.textContent = (pre.textContent ? pre.textContent + "\n" : "") + parts.join("\n") + "\n";
  } catch (e) {
    console.warn("[sakaki] shipment debug failed", e);
  }
}








function getWeekRange(offsetWeeks, today) {
  const base = stripTime(today || new Date());
  // Week is Monday..Sunday, with Monday as the first day.
  const dow = base.getDay(); // 0=Sun..6=Sat
  const diffToMon = (dow + 6) % 7; // Mon->0, Tue->1, ..., Sun->6
  const start = new Date(base);
  start.setDate(base.getDate() - diffToMon + (Number(offsetWeeks || 0) * 7));
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end, startKey: formatDate(start), endKey: formatDate(end) };
}

function getShipmentsForRange(startDate, endDate) {
  const startKey = formatDate(startDate);
  const endKey = formatDate(endDate);
  return (state.entries || []).filter((e) => {
    if (!e || e.type !== "shipment") return false;
    if (e.shipmentType && e.shipmentType !== "spot") return false;
    const key = normalizeDateKey(e.date);
    if (!key) return false;
    return key >= startKey && key <= endKey;
  });
}

function getGeneratedRecurringForRange(startDate, endDate) {
  const out = [];
  const seen = new Set();
  const start = stripTime(startDate);
  const end = stripTime(endDate);

  const monthKeys = new Set();
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    monthKeys.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  monthKeys.forEach((key) => {
    const [y, m] = key.split("-").map((n) => Number(n));
    generateRecurringShipmentsForMonth(y, m - 1).forEach((entry) => {
      const dateKey = normalizeDateKey(entry.date);
      if (dateKey < formatDate(start) || dateKey > formatDate(end)) return;
      if (seen.has(entry.id)) return;
      seen.add(entry.id);
      out.push(entry);
    });
  });

  out.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));
  return out;
}

function summarizeShipmentQuantities(shipments) {
  // Group by destination, then by (standard, unit) and sum numeric quantities.
  const destMap = new Map();

  function addLine(dest, std, qty, unit) {
    const d = String(dest || "").trim();
    const s = String(std || "").trim();
    const u = String(unit || "").trim();
    if (!d || !s || !u) return;

    const qtyNum = Number.parseFloat(String(qty ?? "").trim());
    const hasNum = Number.isFinite(qtyNum);

    const group = destMap.get(d) || new Map();
    const key = `${s}||${u}`;
    const cur = group.get(key) || { standard: s, unit: u, total: 0, nonNumeric: [] };
    if (hasNum) cur.total += qtyNum;
    else cur.nonNumeric.push(String(qty ?? "").trim());
    group.set(key, cur);
    destMap.set(d, group);
  }

  (shipments || []).forEach((sh) => {
    const dest = sh.destinationName || sh.destination;
    addLine(dest, sh.standard, sh.quantity, sh.unit);
    const s2 = String(sh.standard2 || "").trim();
    const u2 = String(sh.unit2 || "").trim();
    if (s2 && u2) addLine(dest, sh.standard2, sh.quantity2, sh.unit2);
  });

  const out = [];
  destMap.forEach((group, destinationName) => {
    const specs = Array.from(group.values()).map((x) => {
      const qtyText = x.nonNumeric.length ? null : String(trimTrailingZeros(x.total));
      return { ...x, qtyText };
    });

    // Sort specs: standard then unit
    specs.sort((a, b) => a.standard.localeCompare(b.standard) || a.unit.localeCompare(b.unit));

    // Destination sort weight: sum of numeric totals across specs (non-numeric treated as 0)
    const weight = specs.reduce((sum, x) => sum + (x.qtyText == null ? 0 : Number.parseFloat(x.qtyText)), 0);
    out.push({ destinationName, weight, specs });
  });

  // Destinations: highest weight first, then name
  out.sort((a, b) => (b.weight - a.weight) || a.destinationName.localeCompare(b.destinationName));
  return out;
}

function trimTrailingZeros(n) {
  const s = String(n);
  if (!s.includes(".")) return s;
  return s.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function renderShipmentWeekSummary(opts) {
  const title = String((opts && opts.title) || "");
  const detailsId = String((opts && opts.detailsId) || "");
  const rangeId = String((opts && opts.rangeId) || "");
  const listId = String((opts && opts.listId) || "");
  const offsetWeeks = Number((opts && opts.offsetWeeks) || 0);

  const details = document.getElementById(detailsId);
  const rangeEl = document.getElementById(rangeId);
  const listEl = document.getElementById(listId);
  if (!details || !rangeEl || !listEl) return;

  const { start, end, startKey, endKey } = getWeekRange(offsetWeeks, new Date());
  rangeEl.textContent = `${startKey.replace(/-/g, "/")}〜${endKey.replace(/-/g, "/")}`;

  const spots = getShipmentsForRange(start, end);
  const rec = getGeneratedRecurringForRange(start, end);
  const all = spots.concat(rec);

  // Group by dateKey -> destination -> (standard, unit) aggregate
  const byDate = new Map();

  function addAgg(dateKey, destName, standard, qty, unit, sourceEntry) {
    const d = String(dateKey || "").trim();
    const dest = String(destName || "").trim();
    const std = String(standard || "").trim();
    const u = String(unit || "").trim();
    if (!d || !dest || !std || !u) return;

    const dateMap = byDate.get(d) || new Map();
    const destMap = dateMap.get(dest) || new Map();
    const key = `${std}||${u}`;

    const cur = destMap.get(key) || { standard: std, unit: u, total: 0, nonNumeric: [], hasNew: false };
    const qtyNum = Number.parseFloat(String(qty ?? "").trim());
    if (Number.isFinite(qtyNum)) cur.total += qtyNum;
    else {
      const raw = String(qty ?? "").trim();
      if (raw) cur.nonNumeric.push(raw);
    }
    if (sourceEntry && isNewEntry(sourceEntry)) cur.hasNew = true;

    destMap.set(key, cur);
    dateMap.set(dest, destMap);
    byDate.set(d, dateMap);
  }

  (all || []).forEach((sh) => {
    const dateKey = normalizeDateKey(sh.date);
    const dest = sh.destinationName || sh.destination || "";
    addAgg(dateKey, dest, sh.standard, sh.quantity, sh.unit, sh);
    const s2 = String(sh.standard2 || "").trim();
    const u2 = String(sh.unit2 || "").trim();
    if (s2 && u2) addAgg(dateKey, dest, sh.standard2, sh.quantity2, sh.unit2, sh);
  });

  const dateKeys = Array.from(byDate.keys()).sort();
  listEl.innerHTML = "";

  if (!dateKeys.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = `${title}はありません`;
    listEl.appendChild(li);
    return;
  }

  const labels = ["日", "月", "火", "水", "木", "金", "土"];

  dateKeys.forEach((dateKey) => {
    const date = parseDate(dateKey);
    const mmdd = date ? `${date.getMonth() + 1}/${date.getDate()}` : dateKey;
    const dow = date ? labels[date.getDay()] : "";

    const li = document.createElement("li");
    li.className = "nextweek-day";

    const head = document.createElement("div");
    head.className = "nextweek-date";
    head.textContent = dow ? `${mmdd}(${dow})` : mmdd;

    const items = document.createElement("div");
    items.className = "nextweek-items";

    const dateMap = byDate.get(dateKey) || new Map();
    const destNames = Array.from(dateMap.keys()).sort((a, b) => a.localeCompare(b));

    destNames.forEach((destName) => {
      const destMap = dateMap.get(destName) || new Map();
      const specs = Array.from(destMap.values());
      specs.sort((a, b) => a.standard.localeCompare(b.standard) || a.unit.localeCompare(b.unit));

      const destBlock = document.createElement("div");
      destBlock.className = "nextweek-destblock";

      const destLine = document.createElement("div");
      destLine.className = "nextweek-dest";
      if (specs.some((sp) => sp.hasNew)) {
        const badge = document.createElement("span");
        badge.className = "new-badge";
        badge.textContent = "新着";
        destLine.appendChild(badge);
      }
      const nameSpan = document.createElement("span");
      nameSpan.textContent = `・${destName}`;
      destLine.appendChild(nameSpan);
      destBlock.appendChild(destLine);

      const specList = document.createElement("div");
      specList.className = "nextweek-speclist";

      specs.forEach((sp) => {
        const row = document.createElement("div");
        row.className = "nextweek-spec";
        const qtyText = sp.nonNumeric.length ? sp.unit : `${trimTrailingZeros(sp.total)}${sp.unit}`;
        row.textContent = `${sp.standard}　${qtyText}`.trim();
        specList.appendChild(row);
      });

      destBlock.appendChild(specList);
      items.appendChild(destBlock);
    });

    li.append(head, items);
    listEl.appendChild(li);
  });
}

function renderThisWeekShipmentSummary() {
  renderShipmentWeekSummary({
    title: "今週の出荷予定",
    detailsId: "thisWeekDetails",
    rangeId: "thisWeekRange",
    listId: "thisWeekList",
    offsetWeeks: 0,
  });
}

function renderNextWeekShipmentSummary() {
  renderShipmentWeekSummary({
    title: "来週の出荷予定",
    detailsId: "nextWeekDetails",
    rangeId: "nextWeekRange",
    listId: "nextWeekList",
    offsetWeeks: 1,
  });
}








function bindWeekDetails(detailsId, storageKey) {
  const details = document.getElementById(detailsId);
  if (!details) return;
  const saved = readLS(storageKey, false);
  details.open = Boolean(saved);
  details.addEventListener("toggle", () => {
    writeLS(storageKey, Boolean(details.open));
  });
}

function bindWeekSummaries() {
  bindWeekDetails("thisWeekDetails", STORAGE_KEYS.thisWeekOpen);
  bindWeekDetails("nextWeekDetails", STORAGE_KEYS.nextWeekOpen);
}








