const STORAGE_KEYS = {
  entries: "sakaki_entries_v1",
  destinations: "sakaki_destinations_v1",
  standards: "sakaki_standards_v1",
  units: "sakaki_units_v1",
  recurringShipments: "sakaki_recurring_shipments_v1",
  recurringExceptions: "sakaki_recurring_exceptions_v1",
  thisWeekOpen: "sakaki_this_week_summary_open_v1",
  nextWeekOpen: "sakaki_nextweek_open_v1",
  weeklyScheduleView: "sakaki_weekly_schedule_view_v1",
  apiUrl: "sakaki_api_url_v1",
  apiKey: "sakaki_api_key_v1",
  updatedBy: "sakaki_updated_by_v1",
  lastSeenUpdatedAt: "sakaki_last_seen_updated_at",
};

const LAST_DESTINATION_KEY = "sakaki_last_destination_id";

const DEFAULT_API_URL = "";

const DEFAULT_STANDARDS = ["40cm", "45cm", "作り榊"];
const DEFAULT_UNITS = ["kg", "束", "ケース", "箱", "本", "袋", "個"];
const ROADSIDE_STATIONS = [
  { id: "roadside-aguriparu", name: "アグリパル", active: true, sortOrder: 10001 },
  { id: "roadside-meijinomori", name: "明治の森", active: true, sortOrder: 10002 },
];

const QUALITY_LIKE_STANDARDS_FOR_SUMMARY = new Set(["優", "良", "秀"]);
const CROP_LIKE_STANDARDS_FOR_SUMMARY = new Set(["ヒサカキ", "八丈榊", "シキミ"]);

// Build info (for PWA cache debugging)
const APP_VERSION = "2026-07-10.1";
const BUILD_TIME = "2026-07-10 00:00";

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
  apiKey: "",
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
  state.apiUrl = String(localStorage.getItem(STORAGE_KEYS.apiUrl) || "").trim();
  state.apiKey = String(localStorage.getItem(STORAGE_KEYS.apiKey) || "").trim();
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

  const history = getShipmentTemplateHistoryByDestination(destId);
  return history.length ? normalizeShipmentTemplateForSuggestion_(history[0]) : null;
}

function shipmentTemplateDateKey_(entry) {
  return pickNewestDateKey_(
    (entry && (entry.date || entry.startDate || entry.endDate || entry.updatedAt)) || "",
  );
}

function getShipmentTemplateHistoryByDestination(destinationId) {
  const destId = String(destinationId || "").trim();
  if (!destId) return [];

  const shipments = (state.entries || []).filter((x) => x && x.type === "shipment" && String(x.destinationId || "") === destId);
  const rules = (state.recurringShipments || []).filter((r) => r && String(r.destinationId || "") === destId);

  return shipments
    .concat(rules)
    .slice()
    .sort((a, b) => {
      const da = shipmentTemplateDateKey_(a);
      const db = shipmentTemplateDateKey_(b);
      if (db !== da) return String(db).localeCompare(String(da));
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    });
}

function normalizeTemplateQuantity_(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const n = Number(raw);
  return Number.isFinite(n) ? String(trimTrailingZeros(n)) : raw;
}

function hasShipmentTemplateSecondLine_(tpl) {
  const s2 = String(tpl.standard2 || "").trim();
  const u2 = String(tpl.unit2 || "").trim();
  const q2 = normalizeTemplateQuantity_(tpl.quantity2);
  return Boolean(s2 || u2 || (q2 && q2 !== "0"));
}

function shipmentTemplateKey_(tpl) {
  const has2 = hasShipmentTemplateSecondLine_(tpl);
  return [
    String(tpl.standard || "").trim(),
    normalizeTemplateQuantity_(tpl.quantity),
    String(tpl.unit || "").trim(),
    has2 ? String(tpl.standard2 || "").trim() : "",
    has2 ? normalizeTemplateQuantity_(tpl.quantity2) : "",
    has2 ? String(tpl.unit2 || "").trim() : "",
  ].join("||");
}

function normalizeShipmentTemplateForSuggestion_(tpl) {
  const line1 = normalizeSummaryShipmentLine_(tpl.standard, tpl.unit);
  const s2 = String(tpl.standard2 || "").trim();
  const u2 = String(tpl.unit2 || "").trim();
  const line2 = s2 || u2 ? normalizeSummaryShipmentLine_(tpl.standard2, tpl.unit2) : { standard: s2, unit: u2 };
  return {
    ...tpl,
    standard: line1.standard,
    unit: line1.unit,
    standard2: line2.standard,
    unit2: line2.unit,
  };
}

function getShipmentTemplateCandidates(destinationId) {
  const groups = new Map();
  getShipmentTemplateHistoryByDestination(destinationId).forEach((tpl) => {
    const normalizedTpl = normalizeShipmentTemplateForSuggestion_(tpl);
    const key = shipmentTemplateKey_(normalizedTpl);
    if (!key.replace(/\|/g, "")) return;
    const dateKey = shipmentTemplateDateKey_(tpl);
    const cur = groups.get(key) || { key, count: 0, lastUsed: "", template: normalizedTpl };
    cur.count += 1;
    if (!cur.lastUsed || dateKey > cur.lastUsed) {
      cur.lastUsed = dateKey;
      cur.template = normalizedTpl;
    }
    groups.set(key, cur);
  });

  return Array.from(groups.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (b.lastUsed !== a.lastUsed) return String(b.lastUsed).localeCompare(String(a.lastUsed));
    return formatShipmentTemplateLabel_(a.template).localeCompare(formatShipmentTemplateLabel_(b.template));
  });
}

function formatShipmentTemplateLabel_(tpl) {
  const line1 = `${String(tpl.standard || "").trim()} ${normalizeTemplateQuantity_(tpl.quantity)}${String(tpl.unit || "").trim()}`.trim();
  if (!hasShipmentTemplateSecondLine_(tpl)) return line1;
  const s2 = String(tpl.standard2 || "").trim();
  const u2 = String(tpl.unit2 || "").trim();
  const q2 = normalizeTemplateQuantity_(tpl.quantity2);
  const line2 = `${s2} ${q2}${u2}`.trim();
  return `${line1} / ${line2}`;
}

function ensureSelectOption_(select, value) {
  if (!select) return;
  const v = String(value || "").trim();
  if (!v) return;
  if (!Array.from(select.options || []).some((o) => String(o.value) === v)) {
    select.appendChild(new Option(v, v));
  }
}

function applyShipmentTemplateToForm(tpl) {
  if (!tpl) return;
  const s1 = document.getElementById("shipmentStandard");
  const q1 = document.getElementById("shipmentQuantity");
  const u1 = document.getElementById("shipmentUnit");
  ensureSelectOption_(s1, tpl.standard);
  ensureSelectOption_(u1, tpl.unit);
  if (s1 && tpl.standard) s1.value = String(tpl.standard);
  if (q1) q1.value = String(tpl.quantity ?? "");
  if (u1 && tpl.unit) u1.value = String(tpl.unit);

  const has2 = String(tpl.standard2 || "").trim() && String(tpl.unit2 || "").trim();
  toggleShipmentSpec2(Boolean(has2));
  const s2 = document.getElementById("shipmentStandard2");
  const q2 = document.getElementById("shipmentQuantity2");
  const u2 = document.getElementById("shipmentUnit2");
  if (has2) {
    ensureSelectOption_(s2, tpl.standard2);
    ensureSelectOption_(u2, tpl.unit2);
    if (s2 && tpl.standard2) s2.value = String(tpl.standard2);
    if (q2) q2.value = String(tpl.quantity2 ?? "");
    if (u2 && tpl.unit2) u2.value = String(tpl.unit2);
  }
}

function ensureShipmentTemplateSuggestions_() {
  let box = document.getElementById("shipmentTemplateSuggestions");
  if (box) return box;

  const anchor = document.querySelector("#shipmentFields .form-destination-row");
  if (!anchor || !anchor.parentNode) return null;

  box = document.createElement("div");
  box.id = "shipmentTemplateSuggestions";
  box.className = "shipment-template-suggestions hidden";

  const list = document.createElement("div");
  list.className = "shipment-template-suggestion-list";

  box.appendChild(list);
  anchor.parentNode.insertBefore(box, anchor.nextSibling);
  return box;
}

function hideShipmentTemplateSuggestions_() {
  const box = document.getElementById("shipmentTemplateSuggestions");
  if (!box) return;
  const list = box.querySelector(".shipment-template-suggestion-list");
  if (list) list.innerHTML = "";
  box.classList.add("hidden");
}

function renderShipmentTemplateSuggestions(destinationId) {
  const box = ensureShipmentTemplateSuggestions_();
  if (!box) return;

  const list = box.querySelector(".shipment-template-suggestion-list");
  if (!list) return;
  list.innerHTML = "";

  const candidates = getShipmentTemplateCandidates(destinationId).slice(0, 6);
  box.classList.toggle("hidden", !candidates.length);
  if (!candidates.length) return;

  candidates.forEach((candidate) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "shipment-template-suggestion";
    btn.textContent = formatShipmentTemplateLabel_(candidate.template);
    btn.title = `${candidate.count}回 / 最終 ${candidate.lastUsed || "-"}`;
    btn.addEventListener("click", () => {
      applyShipmentTemplateToForm(candidate.template);
      showToast("過去履歴から入力しました", "info");
    });
    list.appendChild(btn);
  });
}

function handleDestinationChange(e) {
  const destId = String(e && e.target ? e.target.value : "").trim();
  renderShipmentTemplateSuggestions(destId);
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
  document.getElementById("roadsideShipmentForm").addEventListener("submit", (e) => void submitRoadsideShipmentForm(e));
  document.getElementById("roadsideShipmentDate").value = state.selectedDate;
  document.getElementById("addSpec2Btn").addEventListener("click", () => toggleShipmentSpec2(true));
  document.getElementById("removeSpec2Btn").addEventListener("click", () => toggleShipmentSpec2(false));
  document.getElementById("cancelEditBtn").addEventListener("click", resetEntryForm);
  document.getElementById("openEntryFormBtn").addEventListener("click", openNewEntryForm_);
  document.getElementById("closeEntryFormBtn").addEventListener("click", resetEntryForm);

  document.getElementById("destinationForm").addEventListener("submit", (e) => void submitDestinationForm(e));
  document.getElementById("cancelDestinationEditBtn").addEventListener("click", resetDestinationForm);

  document.getElementById("standardForm").addEventListener("submit", (e) => void addStandard(e));
  document.getElementById("unitForm").addEventListener("submit", (e) => void addUnit(e));
  const yearlySummaryYear = document.getElementById("customerYearlySummaryYear");
  const yearlySummaryDestination = document.getElementById("customerYearlySummaryDestination");
  if (yearlySummaryYear) yearlySummaryYear.addEventListener("change", renderCustomerYearlyShipmentSummary);
  if (yearlySummaryDestination) yearlySummaryDestination.addEventListener("change", renderCustomerYearlyShipmentSummary);

  document.getElementById("prevMonthBtn").addEventListener("click", () => {
    state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() - 1, 1);
    renderCalendar();
    renderMonthlyShipmentSummary();
  });
  document.getElementById("nextMonthBtn").addEventListener("click", () => {
    state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() + 1, 1);
    renderCalendar();
    renderMonthlyShipmentSummary();
  });
  document.getElementById("currentMonthBtn").addEventListener("click", () => {
    const today = new Date();
    state.currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    renderCalendar();
    renderMonthlyShipmentSummary();
  });
  const markSeenBtn = document.getElementById("markSeenBtn");
  if (markSeenBtn) markSeenBtn.addEventListener("click", () => {
    markAllAsSeen();
    renderAll();
  });
  const addEntryForSelectedBtn = document.getElementById("addEntryForSelectedBtn");
  if (addEntryForSelectedBtn) addEntryForSelectedBtn.addEventListener("click", openNewEntryForm_);
  bindEntryControlSegments_();
  bindMobileNavigation_();
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
  state._openAdminPanel = openPanel;
}

function bindMobileNavigation_() {
  const scrollTo = (selector) => {
    const target = document.querySelector(selector);
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  document.getElementById("mobileCalendarBtn")?.addEventListener("click", () => scrollTo(".calendar-card"));
  document.getElementById("mobileAddBtn")?.addEventListener("click", openNewEntryForm_);
  document.getElementById("mobileSummaryBtn")?.addEventListener("click", () => scrollTo("#monthlyShipmentCard"));
  document.getElementById("mobileSettingsBtn")?.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    const settings = document.querySelector(".settings-menu");
    if (settings) settings.open = true;
  });
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
    if (!state.apiKey) {
      promptForApiKey_("同期には共有キーが必要です。共有キーを入力して保存してください。");
      return;
    }

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
  renderMonthlyShipmentSummary();
  renderCustomerYearlyShipmentSummary();
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
  return Boolean(state.apiUrl && state.apiKey);
}

function promptForApiKey_(message) {
  setStatus(message || "同期には共有キーが必要です。", "err");
  showToast("共有キーを入力してください", "info");
  if (typeof state._openAdminPanel === "function") state._openAdminPanel("sync");
  window.setTimeout(() => {
    const keyEl = document.getElementById("apiKeyInput");
    if (keyEl) keyEl.focus();
  }, 0);
}

function requireApiKeyForSync_() {
  if (state.apiKey) return true;
  promptForApiKey_("同期には共有キーが必要です。共有キーを入力して保存してください。");
  throw new Error("API key required");
}

function setSyncInputs() {
  const apiEl = document.getElementById("apiUrlInput");
  const keyEl = document.getElementById("apiKeyInput");
  const byEl = document.getElementById("updatedByInput");
  if (apiEl) {
    const v = state.apiUrl;
    if (apiEl.value !== v) apiEl.value = v;
  }
  if (keyEl && keyEl.value !== state.apiKey) keyEl.value = state.apiKey;
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
  if (!state.apiUrl) {
    setStatus("API URLが未設定です（localStorageモード）", "");
    showToast("API URLが未設定です", "info");
    return;
  }
  if (!state.apiKey) {
    promptForApiKey_("接続テストには共有キーが必要です。共有キーを入力して保存してください。");
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

function getLatestUpdatedAt_(entries) {
  return (Array.isArray(entries) ? entries : []).reduce((latest, entry) => {
    const updatedAt = String(entry && entry.updatedAt ? entry.updatedAt : "").trim();
    if (!updatedAt) return latest;
    return !latest || updatedAt > latest ? updatedAt : latest;
  }, "");
}

function isNewEntry(entry) {
  if (!entry) return false;
  const updatedAt = String(entry.updatedAt || "").trim();
  if (!updatedAt) return false;
  const lastSeen = getLastSeenUpdatedAt();
  if (!lastSeen) return false;
  return updatedAt > lastSeen;
}

function markAllAsSeen() {
  setLastSeenUpdatedAt(getLatestUpdatedAt_([...(state.entries || []), ...(state.recurringShipments || [])]) || new Date().toISOString());
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
  const apiKey = String(document.getElementById("apiKeyInput").value || "").trim();
  const updatedBy = String(document.getElementById("updatedByInput").value || "").trim();

  console.log("[sakaki] save api url", apiUrl);

  state.apiUrl = apiUrl;
  state.apiKey = apiKey;
  state.updatedBy = updatedBy;

  localStorage.setItem(STORAGE_KEYS.apiUrl, apiUrl);
  localStorage.setItem(STORAGE_KEYS.apiKey, apiKey);
  localStorage.setItem(STORAGE_KEYS.updatedBy, updatedBy);

  console.log("[sakaki] localStorage saved api url", localStorage.getItem("sakaki_api_url_v1"));

  // Reflect to inputs immediately
  setSyncInputs();

  setStatus("設定を保存しました", "ok");
  if (state.apiUrl && !state.apiKey) {
    promptForApiKey_("API URLを使うには共有キーが必要です。共有キーを入力して保存してください。");
    return;
  }
  void bootData();
}

async function testApiConnection() {
  // Backward compat: use the newer UI-aware connection test.
  await testApiConnectionUi();
}

async function apiGet(action) {
  requireApiKeyForSync_();
  const url = new URL(state.apiUrl);
  url.searchParams.set("action", action);
  url.searchParams.set("appKey", state.apiKey || "");
  return await apiRequest_("GET", action, url.toString(), null);
}

async function apiPost(action, payload) {
  requireApiKeyForSync_();
  // GAS Web app POST from GitHub Pages often hits CORS issues.
  // Use GET with an encoded JSON payload for write actions.
  const url = new URL(state.apiUrl);
  url.searchParams.set("action", action);
  url.searchParams.set("appKey", state.apiKey || "");
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
          body: JSON.stringify({ action, appKey: state.apiKey || "", payload }),
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

      if (dayEntries.length) {
        const markers = document.createElement("div");
        markers.className = "day-markers";
        dayEntries.slice(0, 3).forEach((entry) => {
          const dot = document.createElement("span");
          dot.className = `day-marker day-marker--${entry.type}`;
          dot.setAttribute("aria-hidden", "true");
          markers.appendChild(dot);
        });
        if (dayEntries.length > 3) {
          const more = document.createElement("span");
          more.className = "day-marker-more";
          more.textContent = `+${dayEntries.length - 3}`;
          markers.appendChild(more);
        }
        cell.appendChild(markers);
      }

      cell.addEventListener("click", () => {
        state.selectedDate = dateKey;
        setFormDate(dateKey);
        renderCalendar();
        renderSelectedDay();
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            scrollSelectedDayIntoView_();
          });
        });
      });

      grid.appendChild(cell);
    });
  }}

function renderSelectedDay() {
  const label = document.getElementById("selectedDateLabel");
  const list = document.getElementById("selectedDayList");

  const selectedDate = parseDate(state.selectedDate) || new Date();
  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][selectedDate.getDay()];
  label.textContent = `${year}年${month + 1}月${selectedDate.getDate()}日（${weekday}）の予定`;
  const generated = generateRecurringShipmentsForMonth(year, month);

  const items = entriesByDate(state.selectedDate, { generatedRecurring: generated });
  try {
    const sample = items.filter((x) => x && x.type === "shipment" && (x.shipmentType || "") === "recurring");
    console.log("[sakaki] recurring entries for 2026-05-26", entriesByDate("2026-05-26", { generatedRecurring: generated }).filter((x) => x && x.type === "shipment" && x.shipmentType === "recurring"));
    if (sample.length) console.log("[sakaki] selected day recurring count", sample.length);
  } catch {}
  renderEntryList(list, items, "この日の予定はありません");
  const updatedEl = document.getElementById("selectedDayLastUpdated");
  if (updatedEl) {
    const latest = getLatestUpdatedAt_(items);
    const latestDate = latest ? new Date(latest) : null;
    updatedEl.textContent = latestDate && Number.isFinite(latestDate.getTime())
      ? `最終更新 ${String(latestDate.getMonth() + 1).padStart(2, "0")}/${String(latestDate.getDate()).padStart(2, "0")} ${String(latestDate.getHours()).padStart(2, "0")}:${String(latestDate.getMinutes()).padStart(2, "0")}`
      : "";
  }
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
      li.classList.add("entry-row", `entry-type-${entry.type}`);

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
  if (String(document.getElementById("entryMode")?.value || "") === "recurring_override") {
    const advanced = document.getElementById("entryAdvancedDetails");
    if (advanced) advanced.open = true;
  }
  syncEntryControlSegments_();
}

function switchShipmentKindFields() {
  const kind = document.getElementById("shipmentKind").value;
  const isShipment = document.getElementById("entryType").value === "shipment";
  document.getElementById("spotDateRow").classList.toggle("hidden", !isShipment || kind !== "spot");
  document.getElementById("recurringFields").classList.toggle("hidden", kind !== "recurring");
  if (kind === "recurring") {
    const advanced = document.getElementById("entryAdvancedDetails");
    if (advanced) advanced.open = true;
  }
  syncEntryControlSegments_();
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
  if (show) {
    const details = document.getElementById("entrySpec2Details");
    if (details) details.open = true;
  }

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
  renderMonthlyShipmentSummary();
  renderSelectedDay();
  renderDestinationList();
}

function syncEntryControlSegments_() {
  const type = String(document.getElementById("entryType")?.value || "shipment");
  const kind = String(document.getElementById("shipmentKind")?.value || "spot");
  document.querySelectorAll("[data-entry-type]").forEach((button) => {
    const active = button.dataset.entryType === type;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-shipment-kind]").forEach((button) => {
    const active = button.dataset.shipmentKind === kind;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function bindEntryControlSegments_() {
  document.querySelectorAll("[data-entry-type]").forEach((button) => {
    button.addEventListener("click", () => {
      document.getElementById("entryType").value = button.dataset.entryType;
      switchEntryTypeFields();
      switchShipmentKindFields();
    });
  });
  document.querySelectorAll("[data-shipment-kind]").forEach((button) => {
    button.addEventListener("click", () => {
      document.getElementById("shipmentKind").value = button.dataset.shipmentKind;
      switchShipmentKindFields();
      switchEntryTypeFields();
    });
  });
  syncEntryControlSegments_();
}

function setEntryFormOpen_(open) {
  const card = document.getElementById("entryCard");
  const launcher = document.getElementById("entryLauncher");
  const panel = document.getElementById("entryPanel");
  const openButton = document.getElementById("openEntryFormBtn");
  if (!card || !launcher || !panel) return;
  card.classList.toggle("is-collapsed", !open);
  launcher.classList.toggle("hidden", open);
  panel.classList.toggle("hidden", !open);
  if (openButton) openButton.setAttribute("aria-expanded", String(open));
  if (open) {
    const isEditing = Boolean(
      String(document.getElementById("entryId")?.value || "") ||
      String(document.getElementById("recurringId")?.value || "") ||
      String(document.getElementById("entryMode")?.value || "")
    );
    const title = document.getElementById("entryFormTitle");
    if (title) title.textContent = isEditing ? "予定を編集" : "予定を追加";
  }
}

function openNewEntryForm_() {
  const selected = normalizeDateKey(state.selectedDate) || formatDate(new Date());
  state.selectedDate = selected;
  resetEntryForm();
  setFormDate(selected);
  document.getElementById("startDate").value = selected;
  setEntryFormOpen_(true);
  scrollEntryFormIntoView_();
}

function scrollEntryFormIntoView_() {
  const card = document.getElementById("entryCard");
  if (!card) return;
  setEntryFormOpen_(true);
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

function resetRoadsideShipmentForm_() {
  const form = document.getElementById("roadsideShipmentForm");
  if (form) form.reset();
  const dateInput = document.getElementById("roadsideShipmentDate");
  if (dateInput) dateInput.value = state.selectedDate;
}

async function submitRoadsideShipmentForm(e) {
  e.preventDefault();
  if (state.isBusy) return;

  const submitBtn = e.submitter || document.querySelector("#roadsideShipmentForm button[type='submit']");
  try {
    setButtonLoading(submitBtn, "保存中...");
    setBusy(true, "保存中...");

    const stationId = requiredValue("roadsideShipmentDestination", "道の駅名");
    const station = ROADSIDE_STATIONS.find((item) => item.id === stationId);
    if (!station) throw new Error("道の駅名を選択してください");

    const quantity = Number(requiredValue("roadsideShipmentQuantity", "作り榊の数量"));
    if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("数量は1以上の整数で入力してください");

    const entry = {
      id: createId(),
      type: "shipment",
      shipmentType: "spot",
      date: requiredValue("roadsideShipmentDate", "日付"),
      destinationId: station.id,
      destinationName: station.name,
      destination: station.name,
      standard: "作り榊",
      quantity,
      unit: "束",
      standard2: "",
      quantity2: 0,
      unit2: "",
      memo: String(document.getElementById("roadsideShipmentMemo").value || "").trim(),
      updatedAt: new Date().toISOString(),
      updatedBy: currentUpdatedBy(),
    };

    if (isApiEnabled()) {
      const snap = snapshotLocalState_();
      saveSpotShipment(entry);
      refreshViewFast();
      syncSave("saveShipment", {
        id: entry.id,
        shipmentType: entry.shipmentType,
        date: entry.date,
        destinationId: entry.destinationId,
        destinationName: entry.destinationName,
        standard: entry.standard,
        quantity: entry.quantity,
        unit: entry.unit,
        standard2: "",
        quantity2: 0,
        unit2: "",
        memo: entry.memo,
        recurrenceRuleId: "",
        updatedAt: entry.updatedAt,
        updatedBy: entry.updatedBy,
      }, snap, "保存しました");
    } else {
      saveSpotShipment(entry);
    }

    state.selectedDate = entry.date;
    const savedDate = parseDate(entry.date);
    if (savedDate) state.currentMonth = new Date(savedDate.getFullYear(), savedDate.getMonth(), 1);
    setStatus("保存しました", "ok");
    showToast("保存しました", "success");
    resetRoadsideShipmentForm_();
    renderAll();
    if (typeof state._closeAdminPanels === "function") state._closeAdminPanels();
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
  hideShipmentTemplateSuggestions_();
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

    const advancedDetails = document.getElementById("entryAdvancedDetails");
    if (advancedDetails) advancedDetails.open = false;
    const spec2Details = document.getElementById("entrySpec2Details");
    if (spec2Details) spec2Details.open = false;
    toggleShipmentSpec2(false);

    switchEntryTypeFields();
    switchShipmentKindFields();
    switchRecurrenceTypeFields();
    setEntryFormOpen_(false);
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
    inc(e.destinationId, e.date || e.updatedAt);
  });

  (state.recurringShipments || []).forEach((r) => {
    if (!r) return;
    inc(r.destinationId, r.startDate || r.date || r.updatedAt);
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

function getShipmentHistoryValues_(fields) {
  const values = [];
  const add = (item) => {
    if (!item) return;
    fields.forEach((field) => {
      const value = String(item[field] || "").trim();
      if (value) values.push(value);
    });
  };
  (state.entries || []).forEach((entry) => {
    if (entry && entry.type === "shipment") add(entry);
  });
  (state.recurringShipments || []).forEach(add);
  return values;
}

function mergeMasterValues_(base, extra) {
  const seen = new Set();
  const out = [];
  (base || []).concat(extra || []).forEach((value) => {
    const v = String(value || "").trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    out.push(v);
  });
  return out;
}

function fillMasterSelects() {
  const activeDestinations = state.destinations.filter((d) => d.active);
  const roadsideDestinations = ROADSIDE_STATIONS.filter(
    (station) => !activeDestinations.some((destination) => String(destination.id) === station.id),
  );
  fillDestinationSelect("shipmentDestination", activeDestinations.concat(roadsideDestinations));
  applyLastDestinationToForm();
  const standardOptions = mergeMasterValues_(state.standards, getShipmentHistoryValues_(["standard", "standard2"]));
  const unitOptions = mergeMasterValues_(state.units, getShipmentHistoryValues_(["unit", "unit2"]));
  fillSelect("shipmentStandard", standardOptions, "規格を選択");
  fillSelect("shipmentStandard2", standardOptions, "規格を選択");
  fillSelect("shipmentUnit", unitOptions, "単位を選択");
  fillSelect("shipmentUnit2", unitOptions, "単位を選択");
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

function normalizeSummaryText_(value) {
  return String(value || "").trim().normalize("NFKC");
}

function isQualityLikeStandardForSummary_(standard) {
  const value = normalizeSummaryText_(standard);
  return QUALITY_LIKE_STANDARDS_FOR_SUMMARY.has(value) || CROP_LIKE_STANDARDS_FOR_SUMMARY.has(value);
}

function normalizeSummaryUnit_(unit) {
  const value = normalizeSummaryText_(unit);
  if (!value) return "";
  if (/kg/i.test(value)) return "kg";
  if (value.includes("束")) return "束";
  if (value.includes("本")) return "本";
  return String(unit || "").trim();
}

function inferSummaryStandardFromUnit_(unit) {
  const value = normalizeSummaryText_(unit);
  if (!value) return "";
  if (/40\s*cm/i.test(value)) return "40cm";
  if (/45\s*cm/i.test(value)) return "45cm";
  if (/80\s*cm/i.test(value)) return "80cm";
  if (value.includes("束")) return "作り榊";
  if (value.includes("本")) return "大枝";
  if (/^kg$/i.test(value)) return "40cm";
  return "";
}

function normalizeSummaryShipmentLine_(std, unit) {
  const standard = String(std || "").trim();
  const unitName = normalizeSummaryUnit_(unit);
  if (!isQualityLikeStandardForSummary_(standard)) {
    return { standard, unit: unitName };
  }

  return {
    standard: inferSummaryStandardFromUnit_(unit) || "規格未設定",
    unit: unitName,
  };
}

function summarizeShipmentQuantities(shipments) {
  // Group by display standard and unit, while retaining destination totals for drill-down.
  const specMap = new Map();

  function addLine(dest, std, qty, unit) {
    const destinationName = String(dest || "").trim();
    const summaryLine = normalizeSummaryShipmentLine_(std, unit);
    const standard = summaryLine.standard;
    const unitName = summaryLine.unit;
    const rawQty = String(qty ?? "").trim();
    const quantity = Number(rawQty);
    if (!destinationName || !standard || !unitName || !rawQty || !Number.isFinite(quantity) || quantity === 0) return;

    const key = `${standard}||${unitName}`;
    const spec = specMap.get(key) || { standard, unit: unitName, total: 0, destinations: new Map() };
    spec.total += quantity;
    spec.destinations.set(destinationName, (spec.destinations.get(destinationName) || 0) + quantity);
    specMap.set(key, spec);
  }

  (shipments || []).forEach((sh) => {
    const dest = sh.destinationName || sh.destination;
    addLine(dest, sh.standard, sh.quantity, sh.unit);
    const s2 = String(sh.standard2 || "").trim();
    const u2 = String(sh.unit2 || "").trim();
    if (s2 && u2) addLine(dest, sh.standard2, sh.quantity2, sh.unit2);
  });

  return Array.from(specMap.values())
    .map((spec) => ({
      standard: spec.standard,
      unit: spec.unit,
      total: spec.total,
      qtyText: String(trimTrailingZeros(spec.total)),
      destinations: Array.from(spec.destinations, ([destinationName, total]) => ({
        destinationName,
        total,
        qtyText: String(trimTrailingZeros(total)),
      })).sort((a, b) => (b.total - a.total) || a.destinationName.localeCompare(b.destinationName)),
    }))
    .sort((a, b) => a.standard.localeCompare(b.standard) || a.unit.localeCompare(b.unit));
}

function getMonthlySummaryMonth_() {
  const raw = state.currentMonth;
  const date = raw instanceof Date ? raw : new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  }
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function cloneSummaryContent_(source, target) {
  if (!source || !target) return;
  target.innerHTML = "";
  const clone = source.cloneNode(true);
  clone.removeAttribute("id");
  clone.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
  while (clone.firstChild) target.appendChild(clone.firstChild);
}

function syncCompactDashboardCards_() {
  const monthSource = document.getElementById("monthlyShipmentSummary");
  const monthTarget = document.getElementById("compactMonthlySummary");
  const monthLabel = document.getElementById("monthlyShipmentMonth");
  const compactMonthLabel = document.getElementById("compactMonthlyMonth");
  cloneSummaryContent_(monthSource, monthTarget);
  if (compactMonthLabel) compactMonthLabel.textContent = monthLabel?.textContent || "";

  const yearlySource = document.getElementById("customerYearlySummary");
  const yearlyTarget = document.getElementById("compactYearlySummary");
  const yearSelect = document.getElementById("customerYearlySummaryYear");
  const destinationSelect = document.getElementById("customerYearlySummaryDestination");
  const yearlyContext = document.getElementById("compactYearlyContext");
  cloneSummaryContent_(yearlySource, yearlyTarget);
  if (yearlyContext) {
    const year = yearSelect?.selectedOptions?.[0]?.textContent || "";
    const destination = destinationSelect?.selectedOptions?.[0]?.textContent || "";
    yearlyContext.textContent = [year, destination].filter(Boolean).join("・");
  }
}

function renderMonthlyShipmentSummary() {
  window.requestAnimationFrame(syncCompactDashboardCards_);
  const monthEl = document.getElementById("monthlyShipmentMonth");
  const summaryEl = document.getElementById("monthlyShipmentSummary");
  if (!monthEl || !summaryEl) return;

  const summaryMonth = getMonthlySummaryMonth_();
  const year = summaryMonth.getFullYear();
  const month = summaryMonth.getMonth();
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  const shipments = getShipmentsForRange(start, end).concat(getGeneratedRecurringForRange(start, end));
  const groups = summarizeShipmentQuantities(shipments);

  monthEl.textContent = `${year}年${month + 1}月`;
  summaryEl.innerHTML = "";

  if (!groups.length) {
    const empty = document.createElement("p");
    empty.className = "muted monthly-shipment-empty";
    empty.textContent = "この月の出荷はありません";
    summaryEl.appendChild(empty);
    return;
  }

  groups.forEach((group) => {
    const details = document.createElement("details");
    details.className = "monthly-shipment-spec";

    const summary = document.createElement("summary");
    summary.className = "monthly-shipment-spec-summary";
    const standard = document.createElement("span");
    standard.className = "monthly-shipment-standard";
    standard.textContent = group.standard;
    const quantity = document.createElement("strong");
    quantity.className = "monthly-shipment-quantity";
    quantity.textContent = `${group.qtyText}${group.unit}`;
    const toggle = document.createElement("span");
    toggle.className = "monthly-shipment-toggle";
    toggle.textContent = "内訳";
    summary.append(standard, quantity, toggle);
    details.appendChild(summary);

    const list = document.createElement("ul");
    list.className = "monthly-shipment-breakdown";
    group.destinations.forEach((destination) => {
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = destination.destinationName;
      const destinationQuantity = document.createElement("strong");
      destinationQuantity.textContent = `${destination.qtyText}${group.unit}`;
      item.append(name, destinationQuantity);
      list.appendChild(item);
    });
    details.appendChild(list);
    summaryEl.appendChild(details);
  });
}

function getCustomerYearlyAvailableYears_() {
  const years = new Set();
  const addYear = (value) => {
    if (value instanceof Date) {
      if (Number.isFinite(value.getTime())) years.add(value.getFullYear());
      return;
    }
    const key = normalizeDateKey(value);
    const year = Number(String(key || "").slice(0, 4));
    if (Number.isInteger(year) && year >= 2000 && year <= 2100) years.add(year);
  };

  (state.entries || []).forEach((entry) => {
    if (entry && entry.type === "shipment") addYear(entry.date);
  });
  (state.recurringShipments || []).forEach((rule) => {
    addYear(rule && rule.startDate);
    addYear(rule && rule.endDate);
  });
  getRecurringExceptions().forEach((ex) => addYear(ex.date));
  addYear(state.currentMonth);
  addYear(new Date());

  if (!years.size) return [];
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const filledYears = [];
  for (let year = maxYear; year >= minYear; year -= 1) filledYears.push(year);
  return filledYears;
}

function getCustomerYearlyYear_() {
  const select = document.getElementById("customerYearlySummaryYear");
  const selected = Number(select && select.value);
  if (Number.isInteger(selected) && selected >= 2000) return selected;
  const month = getMonthlySummaryMonth_();
  return month.getFullYear();
}

function getCustomerYearlyShipmentsForYear_(year) {
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  return getShipmentsForRange(start, end).concat(getGeneratedRecurringForRange(start, end));
}

function shipmentMatchesDestination_(shipment, destinationId, destinationName) {
  const selectedId = String(destinationId || "").trim();
  const selectedName = String(destinationName || "").trim();
  if (!shipment) return false;
  if (selectedId && String(shipment.destinationId || "").trim() === selectedId) return true;
  const name = String(shipment.destinationName || shipment.destination || "").trim();
  return Boolean(selectedName && name === selectedName);
}

function getCustomerYearlyDestinationOptions_(year) {
  const byKey = new Map();
  const add = (id, name, active, sortOrder) => {
    const cleanName = String(name || "").trim();
    if (!cleanName) return;
    const cleanId = String(id || "").trim();
    const key = cleanId || `name:${cleanName}`;
    if (byKey.has(key)) return;
    byKey.set(key, {
      id: cleanId,
      name: cleanName,
      active: active !== false,
      sortOrder: sortOrder === undefined ? null : sortOrder,
    });
  };

  (state.destinations || []).forEach((destination) => {
    if (!destination || destination.active === false) return;
    add(destination.id, destination.name, destination.active, destination.sortOrder);
  });

  getCustomerYearlyShipmentsForYear_(year).forEach((shipment) => {
    add(shipment.destinationId, shipment.destinationName || shipment.destination, true, null);
  });

  return sortDestinationsByUsage(Array.from(byKey.values()));
}

function syncCustomerYearlySummaryControls_() {
  const yearSelect = document.getElementById("customerYearlySummaryYear");
  const destinationSelect = document.getElementById("customerYearlySummaryDestination");
  if (!yearSelect || !destinationSelect) return null;

  const years = getCustomerYearlyAvailableYears_();
  const previousYear = String(yearSelect.value || "");
  const defaultYear = String(getMonthlySummaryMonth_().getFullYear());
  yearSelect.innerHTML = "";
  years.forEach((year) => yearSelect.appendChild(new Option(String(year), String(year))));
  if (years.some((year) => String(year) === previousYear)) yearSelect.value = previousYear;
  else if (years.some((year) => String(year) === defaultYear)) yearSelect.value = defaultYear;
  else if (years.length) yearSelect.value = String(years[0]);

  const year = getCustomerYearlyYear_();
  const previousDestination = String(destinationSelect.value || "");
  const destinations = getCustomerYearlyDestinationOptions_(year);
  destinationSelect.innerHTML = "";
  if (!destinations.length) {
    destinationSelect.appendChild(new Option("出荷先なし", ""));
    destinationSelect.disabled = true;
    return { year, destinationId: "", destinationName: "" };
  }

  destinationSelect.disabled = false;
  destinations.forEach((destination) => destinationSelect.appendChild(new Option(destination.name, destination.id || `name:${destination.name}`)));
  if (destinations.some((destination) => (destination.id || `name:${destination.name}`) === previousDestination)) {
    destinationSelect.value = previousDestination;
  }

  const selected = destinations.find((destination) => (destination.id || `name:${destination.name}`) === destinationSelect.value) || destinations[0];
  destinationSelect.value = selected.id || `name:${selected.name}`;
  return { year, destinationId: selected.id, destinationName: selected.name };
}

function customerYearlyGroupKey_(group) {
  return `${String(group.standard || "").trim()}||${String(group.unit || "").trim()}`;
}

function formatCustomerYearlyGroup_(group) {
  return `${group.standard} ${group.qtyText}${group.unit}`;
}

function formatCustomerYearlyDelta_(group, previousGroup, monthIndex) {
  if (monthIndex <= 0) return "";
  const previous = previousGroup ? Number(previousGroup.total || 0) : 0;
  const delta = Number(group.total || 0) - previous;
  if (!Number.isFinite(delta)) return "";
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "±";
  const value = String(trimTrailingZeros(Math.abs(delta)));
  return `前月 ${sign}${value}${group.unit}`;
}

function renderCustomerYearlyShipmentSummary() {
  window.requestAnimationFrame(syncCompactDashboardCards_);
  const summaryEl = document.getElementById("customerYearlySummary");
  if (!summaryEl) return;

  const controls = syncCustomerYearlySummaryControls_();
  summaryEl.innerHTML = "";
  if (!controls || !controls.destinationName) {
    const empty = document.createElement("p");
    empty.className = "muted customer-yearly-empty";
    empty.textContent = "出荷先を選択してください";
    summaryEl.appendChild(empty);
    return;
  }

  const monthlyGroups = [];
  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const start = new Date(controls.year, monthIndex, 1);
    const end = new Date(controls.year, monthIndex + 1, 0);
    const shipments = getShipmentsForRange(start, end)
      .concat(getGeneratedRecurringForRange(start, end))
      .filter((shipment) => shipmentMatchesDestination_(shipment, controls.destinationId, controls.destinationName));
    monthlyGroups.push(summarizeShipmentQuantities(shipments));
  }

  monthlyGroups.forEach((groups, monthIndex) => {
    const details = document.createElement("details");
    details.className = "customer-yearly-month";

    const summary = document.createElement("summary");
    summary.className = "customer-yearly-month-summary";

    const label = document.createElement("span");
    label.className = "customer-yearly-month-label";
    label.textContent = `${monthIndex + 1}月`;

    const preview = document.createElement("span");
    preview.className = "customer-yearly-month-preview";
    preview.textContent = groups.length ? groups.map(formatCustomerYearlyGroup_).join(" / ") : "出荷なし";

    summary.append(label, preview);
    details.appendChild(summary);

    if (groups.length) {
      const previousMap = new Map((monthlyGroups[monthIndex - 1] || []).map((group) => [customerYearlyGroupKey_(group), group]));
      const list = document.createElement("ul");
      list.className = "customer-yearly-breakdown";
      groups.forEach((group) => {
        const item = document.createElement("li");
        const spec = document.createElement("span");
        spec.className = "customer-yearly-spec";
        spec.textContent = group.standard;

        const qty = document.createElement("strong");
        qty.textContent = `${group.qtyText}${group.unit}`;

        const deltaText = formatCustomerYearlyDelta_(group, previousMap.get(customerYearlyGroupKey_(group)), monthIndex);
        if (deltaText) {
          const delta = document.createElement("span");
          delta.className = "customer-yearly-delta";
          delta.textContent = `（${deltaText}）`;
          item.append(spec, qty, delta);
        } else {
          item.append(spec, qty);
        }
        list.appendChild(item);
      });
      details.appendChild(list);
    }

    summaryEl.appendChild(details);
  });
}

function trimTrailingZeros(n) {
  const s = String(n);
  if (!s.includes(".")) return s;
  return s.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function renderShipmentWeekSummary(opts) {
  const title = String((opts && opts.title) || "");
  const panelId = String((opts && opts.panelId) || "");
  const rangeId = String((opts && opts.rangeId) || "");
  const listId = String((opts && opts.listId) || "");
  const offsetWeeks = Number((opts && opts.offsetWeeks) || 0);

  const panel = document.getElementById(panelId);
  const rangeEl = document.getElementById(rangeId);
  const listEl = document.getElementById(listId);
  if (!panel || !rangeEl || !listEl) return;

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
    const dateText = document.createElement("span");
    dateText.className = "weekly-date-main";
    dateText.textContent = mmdd;
    head.appendChild(dateText);
    if (dow) {
      const weekdayText = document.createElement("span");
      weekdayText.className = "weekly-weekday";
      weekdayText.textContent = dow;
      head.appendChild(weekdayText);
    }

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
      nameSpan.className = "weekly-destination-name";
      nameSpan.textContent = destName;
      destLine.appendChild(nameSpan);
      destBlock.appendChild(destLine);

      const specList = document.createElement("div");
      specList.className = "nextweek-speclist";

      const specTexts = specs.map((sp) => {
        const qtyText = sp.nonNumeric.length ? sp.unit : `${trimTrailingZeros(sp.total)}${sp.unit}`;
        return `${sp.standard} ${qtyText}`.trim();
      });
      const row = document.createElement("div");
      row.className = "nextweek-spec";
      row.textContent = specTexts.join("・");
      specList.appendChild(row);

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
    panelId: "thisWeekDetails",
    rangeId: "thisWeekRange",
    listId: "thisWeekList",
    offsetWeeks: 0,
  });
}

function renderNextWeekShipmentSummary() {
  renderShipmentWeekSummary({
    title: "来週の出荷予定",
    panelId: "nextWeekDetails",
    rangeId: "nextWeekRange",
    listId: "nextWeekList",
    offsetWeeks: 1,
  });
}








function bindWeekSummaries() {
  const tabs = Array.from(document.querySelectorAll(".weekly-segment[data-week-view]"));
  const panels = {
    thisWeek: document.getElementById("thisWeekDetails"),
    nextWeek: document.getElementById("nextWeekDetails"),
  };
  if (tabs.length !== 2 || !panels.thisWeek || !panels.nextWeek) return;

  function selectWeek(view, persist) {
    const selected = view === "nextWeek" ? "nextWeek" : "thisWeek";
    tabs.forEach((tab) => {
      const active = tab.dataset.weekView === selected;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    Object.entries(panels).forEach(([name, panel]) => {
      panel.classList.toggle("hidden", name !== selected);
    });
    if (persist) writeLS(STORAGE_KEYS.weeklyScheduleView, selected);
  }

  const saved = readLS(STORAGE_KEYS.weeklyScheduleView, "thisWeek");
  selectWeek(saved, false);
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => selectWeek(tab.dataset.weekView, true));
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const nextView = tab.dataset.weekView === "thisWeek" ? "nextWeek" : "thisWeek";
      selectWeek(nextView, true);
      const nextTab = tabs.find((candidate) => candidate.dataset.weekView === nextView);
      if (nextTab) nextTab.focus();
    });
  });
}








