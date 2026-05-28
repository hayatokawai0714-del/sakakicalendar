const STORAGE_KEYS = {
  entries: "sakaki_entries_v1",
  destinations: "sakaki_destinations_v1",
  standards: "sakaki_standards_v1",
  units: "sakaki_units_v1",
  recurringShipments: "sakaki_recurring_shipments_v1",
  apiUrl: "sakaki_api_url_v1",
  updatedBy: "sakaki_updated_by_v1",
};

const DEFAULT_STANDARDS = ["40cm", "45cm", "作り榊"];
const DEFAULT_UNITS = ["kg", "束", "ケース", "箱", "本", "袋", "個"];

const state = {
  entries: [], // spot shipments + events + memos
  recurringShipments: [],
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
  loadState();
  bindEvents();
  initWeekdayButtons();
  renderAll();
  void bootData();
}

function loadState() {
  state.entries = readLS(STORAGE_KEYS.entries, []);
  state.recurringShipments = readLS(STORAGE_KEYS.recurringShipments, []);
  state.destinations = readLS(STORAGE_KEYS.destinations, []);
  state.standards = readLS(STORAGE_KEYS.standards, DEFAULT_STANDARDS);
  state.units = readLS(STORAGE_KEYS.units, DEFAULT_UNITS);
  state.apiUrl = String(localStorage.getItem(STORAGE_KEYS.apiUrl) || "").trim();
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
  writeLS(STORAGE_KEYS.destinations, state.destinations);
  writeLS(STORAGE_KEYS.standards, state.standards);
  writeLS(STORAGE_KEYS.units, state.units);
}

function bindEvents() {
  document.getElementById("syncForm").addEventListener("submit", saveSyncSettings);
  document.getElementById("syncTestBtn").addEventListener("click", () => void testApiConnectionUi());

  document.getElementById("entryType").addEventListener("change", switchEntryTypeFields);
  document.getElementById("shipmentKind").addEventListener("change", switchShipmentKindFields);
  document.getElementById("recurrenceType").addEventListener("change", switchRecurrenceTypeFields);

  document.getElementById("entryForm").addEventListener("submit", (e) => void submitEntryForm(e));
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
  bindAdminPanels();
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
  setSyncInputs();
  if (!isApiEnabled()) return;
  await loadAllDataFromApi();
  renderAll();
}

function renderAll() {
  setSyncInputs();
  switchEntryTypeFields();
  switchShipmentKindFields();
  switchRecurrenceTypeFields();
  fillMasterSelects();
  renderToday();
  renderCalendar();
  renderSelectedDay();
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
  if (apiEl && apiEl.value !== state.apiUrl) apiEl.value = state.apiUrl;
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

function saveSyncSettings(e) {
  e.preventDefault();
  const apiUrl = String(document.getElementById("apiUrlInput").value || "").trim();
  const updatedBy = String(document.getElementById("updatedByInput").value || "").trim();
  state.apiUrl = apiUrl;
  state.updatedBy = updatedBy;
  localStorage.setItem(STORAGE_KEYS.apiUrl, apiUrl);
  localStorage.setItem(STORAGE_KEYS.updatedBy, updatedBy);
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
  url.searchParams.set("payload", encodeURIComponent(JSON.stringify(payload || {})));
  return await apiRequest_("GET", action, url.toString(), payload || {});
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
  try {
    setBusy(true, "読み込み中...");
    const all = await apiGet("getAll");
    const shipments = Array.isArray(all.shipments) ? all.shipments : [];
    const recurring = Array.isArray(all.recurring_shipments) ? all.recurring_shipments : [];
    const events = Array.isArray(all.events) ? all.events : [];
    const memos = Array.isArray(all.memos) ? all.memos : [];
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

    // Debug: help diagnose "saved but not shown" cases (date format / filtering).
    try {
      console.log("[sakaki] api getAll loaded", {
        shipments: shipments.length,
        recurring: recurring.length,
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
      memo: String(r.memo || ""),
      recurrenceType: String(r.recurrenceType || "weekly"),
      startDate: String(r.startDate || ""),
      endDate: String(r.endDate || ""),
      weekdays: parseJsonArray(r.weekdays),
      intervalWeeks: Number(r.intervalWeeks || 1),
      monthDays: parseJsonArray(r.monthDays),
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
    setStatus("読み込み完了", "ok");
  } catch (err) {
    setStatus(`読み込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`, "err");
  } finally {
    setBusy(false, "");
  }
}

async function saveShipmentToApi(data) {
  return await apiPost("saveShipment", data);
}
async function saveRecurringShipmentToApi(data) {
  return await apiPost("saveRecurringShipment", data);
}
async function saveEventToApi(data) {
  return await apiPost("saveEvent", data);
}
async function saveMemoToApi(data) {
  return await apiPost("saveMemo", data);
}
async function saveDestinationToApi(data) {
  return await apiPost("saveDestination", data);
}
async function deleteItemFromApi(action, id) {
  return await apiPost(action, { id });
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

function renderToday() {
  const today = formatDate(new Date());
  const list = document.getElementById("todayList");
  const generated = generateRecurringShipmentsForMonth(new Date().getFullYear(), new Date().getMonth());
  const items = entriesByDate(today, { generatedRecurring: generated });
  renderEntryList(list, items, "今日の予定はありません");
}

function generateRecurringShipmentsForMonth(year, monthIndex) {
  const end = new Date(year, monthIndex + 1, 0);
  const out = [];

  getRecurringShipments().forEach((rule) => {
    for (let d = 1; d <= end.getDate(); d += 1) {
      const date = new Date(year, monthIndex, d);
      if (!isWithinRuleRange(date, rule)) continue;

      const dateKey = formatDate(date);
      const matches = rule.recurrenceType === "weekly" ? matchesWeeklyRule(date, rule) : matchesMonthlyByDateRule(date, rule);
      if (!matches) continue;

      out.push({
        id: createIdFrom(rule.id, dateKey),
        type: "shipment",
        shipmentType: "recurring",
        date: dateKey,
        destinationId: rule.destinationId || "",
        destinationName: rule.destinationName || rule.destination || "",
        destination: rule.destinationName || rule.destination || "",
        standard: rule.standard,
        quantity: rule.quantity,
        unit: rule.unit,
        memo: rule.memo,
        updatedAt: rule.updatedAt,
        updatedBy: rule.updatedBy || currentUpdatedBy(),
        _ruleId: rule.id,
      });
    }
  });

  // Debug (requested)
  try {
    console.log("recurring rules count", getRecurringShipments().length);
    console.log("generated recurring entries count", out.length);
    console.log("render month", { year, month: monthIndex + 1 });
  } catch {}

  return out;
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

  for (let i = 0; i < 42; i += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
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
    num.textContent = String(day.getDate());
    cell.appendChild(num);

    dayEntries.slice(0, 3).forEach((entry) => {
      const chip = document.createElement("div");
      chip.className = "entry-chip";
      chip.innerHTML = entry.type === "shipment" ? calendarChipText(entry) : `<span class="tag">${chipTag(entry)}</span>${calendarChipText(entry)}`;
      cell.appendChild(chip);
    });

    if (dayEntries.length > 3) {
      const more = document.createElement("div");
      more.className = "entry-chip";
      more.textContent = `他${dayEntries.length - 3}件`;
      cell.appendChild(more);
    }

    cell.addEventListener("click", () => {
      state.selectedDate = dateKey;
      setFormDate(dateKey);
      renderCalendar();
      renderSelectedDay();
    });

    grid.appendChild(cell);
  }
}

function renderSelectedDay() {
  const label = document.getElementById("selectedDateLabel");
  const list = document.getElementById("selectedDayList");
  label.textContent = state.selectedDate;

  const year = state.currentMonth.getFullYear();
  const month = state.currentMonth.getMonth();
  const generated = generateRecurringShipmentsForMonth(year, month);

  const items = entriesByDate(state.selectedDate, { generatedRecurring: generated });
  try {
    const sample = items.filter((x) => x && x.type === "shipment" && (x.shipmentType || "") === "recurring");
    console.log("[sakaki] recurring entries for 2026-05-26", entriesByDate("2026-05-26", { generatedRecurring: generated }).filter((x) => x && x.type === "shipment" && x.shipmentType === "recurring"));
    if (sample.length) console.log("[sakaki] selected day recurring count", sample.length);
  } catch {}
  renderEntryList(list, items, "この日の予定はありません");
}

function renderEntryList(ul, entries, emptyText) {
  ul.innerHTML = "";
  if (!entries.length) {
    const li = document.createElement("li");
    li.textContent = emptyText;
    ul.appendChild(li);
    return;
  }

  entries
    .slice()
    .sort((a, b) => (a.time || "").localeCompare(b.time || "") || String(a.updatedAt).localeCompare(String(b.updatedAt)))
    .forEach((entry) => {
      const li = document.createElement("li");
      const text = document.createElement("div");
      text.className = "one-line";
      text.textContent = `${chipTag(entry)}  ${entrySummary(entry)}`;

      const actions = document.createElement("div");
      actions.className = "row-actions";

      const editBtn = document.createElement("button");
      editBtn.className = "text-btn";
      editBtn.textContent = "編集";
      editBtn.disabled = state.isBusy;
      editBtn.addEventListener("click", () => setEntryToForm(entry));

      const delBtn = document.createElement("button");
      delBtn.className = "text-btn";
      delBtn.textContent = "削除";
      delBtn.disabled = state.isBusy;
      delBtn.addEventListener("click", () => void deleteEntry(entry));

      actions.append(editBtn, delBtn);
      li.append(text, actions);
      ul.appendChild(li);
    });
}

async function deleteEntry(entry) {
  if (!confirm("削除しますか？")) return;
  try {
    setBusy(true, "削除中…");

    if (isApiEnabled()) {
      if (entry.type === "shipment" && entry.shipmentType === "recurring") {
        await deleteItemFromApi("deleteRecurringShipment", entry._ruleId || entry.id);
      } else if (entry.type === "shipment") {
        await deleteItemFromApi("deleteShipment", entry.id);
      } else if (entry.type === "event") {
        await deleteItemFromApi("deleteEvent", entry.id);
      } else if (entry.type === "memo") {
        await deleteItemFromApi("deleteMemo", entry.id);
      }
      await loadAllDataFromApi();
    } else {
      if (entry.type === "shipment" && entry.shipmentType === "recurring") {
        state.recurringShipments = state.recurringShipments.filter((r) => r.id !== (entry._ruleId || entry.id));
      } else {
        state.entries = state.entries.filter((x) => x.id !== entry.id);
      }
      saveState();
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
    // Spot/Recurring are displayed the same in the calendar (no label/spec).
    return `${dest} ${qty}`.trim();
  }
  return entrySummary(entry);
}

function switchEntryTypeFields() {
  const type = document.getElementById("entryType").value;
  document.getElementById("shipmentFields").classList.toggle("hidden", type !== "shipment");
  document.getElementById("eventFields").classList.toggle("hidden", type !== "event");
  document.getElementById("memoFields").classList.toggle("hidden", type !== "memo");
}

function switchShipmentKindFields() {
  const kind = document.getElementById("shipmentKind").value;
  document.getElementById("spotDateRow").classList.toggle("hidden", kind !== "spot");
  document.getElementById("recurringFields").classList.toggle("hidden", kind !== "recurring");
}

function switchRecurrenceTypeFields() {
  const value = document.getElementById("recurrenceType").value;
  const monthly = value === "monthlyByDate";
  document.getElementById("weekdayPicker").classList.toggle("hidden", monthly);
  document.getElementById("monthDayPicker").classList.toggle("hidden", !monthly);
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

function getSelectedWeekdays() {
  return Array.from(document.querySelectorAll("#weekdayButtons .weekday-btn.on")).map((b) => Number(b.dataset.value));
}

function setSelectedWeekdays(weekdays) {
  document.querySelectorAll("#weekdayButtons .weekday-btn").forEach((b) => {
    const v = Number(b.dataset.value);
    b.classList.toggle("on", Array.isArray(weekdays) && weekdays.includes(v));
  });
}

async function submitEntryForm(e) {
  e.preventDefault();
  if (state.isBusy) return;

  const submitBtn = e.submitter || document.querySelector("#entryForm button[type='submit']");
  const type = document.getElementById("entryType").value;

  try {
    setButtonLoading(submitBtn, "保存中...");
    setBusy(true, "保存中...");

    if (type === "shipment") {
      const kind = document.getElementById("shipmentKind").value;
      const destId = String(document.getElementById("shipmentDestination").value || "");
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
          memo: document.getElementById("shipmentMemo").value.trim(),
          updatedAt: new Date().toISOString(),
          updatedBy: currentUpdatedBy(),
        };

        if (isApiEnabled()) {
          await saveShipmentToApi({
            id: entry.id,
            shipmentType: "spot",
            date: entry.date,
            destinationId: entry.destinationId,
            destinationName: entry.destinationName,
            standard: entry.standard,
            quantity: entry.quantity,
            unit: entry.unit,
            memo: entry.memo,
            recurrenceRuleId: "",
            updatedAt: entry.updatedAt,
            updatedBy: entry.updatedBy,
          });
          await loadAllDataFromApi();
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
      const recurrenceType = recurrenceRaw === "monthlyByDate" ? "monthlyByDate" : "weekly";

      const rule = {
        id: document.getElementById("recurringId").value || createId(),
        shipmentType: "recurring",
        destinationId: destId,
        destinationName: destName,
        destination: destName,
        standard: requiredValue("shipmentStandard", "規格"),
        quantity: Number(document.getElementById("shipmentQuantity").value || 0),
        unit: requiredValue("shipmentUnit", "単位"),
        memo: document.getElementById("shipmentMemo").value.trim(),
        recurrenceType,
        startDate: requiredValue("startDate", "開始日"),
        endDate: document.getElementById("endDate").value,
        weekdays: recurrenceType === "weekly" ? getSelectedWeekdays() : [],
        intervalWeeks,
        monthDays: recurrenceType === "monthlyByDate" ? parseMonthDays(document.getElementById("monthDays").value) : [],
        updatedAt: new Date().toISOString(),
        updatedBy: currentUpdatedBy(),
      };

      if (recurrenceType === "weekly" && rule.weekdays.length === 0) throw new Error("曜日を1つ以上選択してください");
      if (recurrenceType === "monthlyByDate" && rule.monthDays.length === 0) throw new Error("日付を1つ以上指定してください");

      if (isApiEnabled()) {
        await saveRecurringShipmentToApi({
          id: rule.id,
          destinationId: rule.destinationId,
          destinationName: rule.destinationName,
          standard: rule.standard,
          quantity: rule.quantity,
          unit: rule.unit,
          memo: rule.memo,
          recurrenceType: rule.recurrenceType,
          startDate: rule.startDate,
          endDate: rule.endDate,
          weekdays: JSON.stringify(rule.weekdays),
          intervalWeeks: rule.intervalWeeks,
          monthDays: JSON.stringify(rule.monthDays),
          updatedAt: rule.updatedAt,
          updatedBy: rule.updatedBy,
        });
        await loadAllDataFromApi();
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
        await apiPost("saveEvent", entry);
        await loadAllDataFromApi();
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
      await apiPost("saveMemo", entry);
      await loadAllDataFromApi();
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
    showToast("保存に失敗しました", "error");
  } finally {
    setBusy(false, "");
    resetButtonLoading(submitBtn);
  }
}

function setEntryToForm(entry) {
  resetEntryForm();

  if (entry.type === "shipment" && entry.shipmentType === "recurring") {
    const rule = state.recurringShipments.find((r) => r.id === (entry._ruleId || entry.id)) || state.recurringShipments.find((r) => r.id === entry.id);
    if (!rule) return;

    document.getElementById("entryType").value = "shipment";
    switchEntryTypeFields();

    document.getElementById("shipmentKind").value = "recurring";
    switchShipmentKindFields();

    document.getElementById("recurringId").value = rule.id;
    document.getElementById("shipmentDestination").value = String(rule.destinationId || "");
    document.getElementById("shipmentStandard").value = rule.standard;
    document.getElementById("shipmentQuantity").value = String(rule.quantity ?? 0);
    document.getElementById("shipmentUnit").value = rule.unit;
    document.getElementById("shipmentMemo").value = rule.memo || "";

    if (rule.recurrenceType === "monthlyByDate") {
      document.getElementById("recurrenceType").value = "monthlyByDate";
      document.getElementById("monthDays").value = (rule.monthDays || []).join(",");
    } else {
      document.getElementById("recurrenceType").value = Number(rule.intervalWeeks) === 2 ? "weekly_2" : "weekly_1";
      setSelectedWeekdays(rule.weekdays || []);
    }
    switchRecurrenceTypeFields();

    document.getElementById("startDate").value = rule.startDate || "";
    document.getElementById("endDate").value = rule.endDate || "";
    return;
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
    document.getElementById("shipmentMemo").value = entry.memo || "";
    return;
  }

  if (entry.type === "event") {
    document.getElementById("entryId").value = entry.id;
    document.getElementById("entryType").value = "event";
    switchEntryTypeFields();

    document.getElementById("eventDate").value = entry.date;
    document.getElementById("eventTime").value = entry.time || "";
    document.getElementById("eventTitle").value = entry.title || "";
    document.getElementById("eventMemo").value = entry.memo || "";
    return;
  }

  document.getElementById("entryId").value = entry.id;
  document.getElementById("entryType").value = "memo";
  switchEntryTypeFields();

  document.getElementById("memoDate").value = entry.date;
  document.getElementById("memoContent").value = entry.content || "";
  document.getElementById("memoPriority").value = entry.priority || "medium";
}

function resetEntryForm() {
  document.getElementById("entryForm").reset();
  document.getElementById("entryId").value = "";
  document.getElementById("recurringId").value = "";
  document.getElementById("shipmentKind").value = "spot";
  document.getElementById("entryType").value = "shipment";

  setFormDate(state.selectedDate);
  document.getElementById("startDate").value = state.selectedDate;
  document.getElementById("endDate").value = "";

  document.getElementById("recurrenceType").value = "weekly_1";
  setSelectedWeekdays([new Date(state.selectedDate).getDay()]);
  document.getElementById("monthDays").value = "";

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
    updatedAt: new Date().toISOString(),
    updatedBy: currentUpdatedBy(),
  };

  try {
    setBusy(true, "保存中...");
    if (isApiEnabled()) {
      await saveDestinationToApi(dest);
      await loadAllDataFromApi();
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

function renderDestinationList() {
  const ul = document.getElementById("destinationList");
  ul.innerHTML = "";
  if (!state.destinations.length) {
    const li = document.createElement("li");
    li.textContent = "出荷先が未登録です";
    ul.appendChild(li);
    return;
  }

  state.destinations.forEach((d) => {
    const li = document.createElement("li");
    const name = document.createElement("div");
    name.className = "one-line";
    name.textContent = `${d.name} ${d.active ? "" : "(辟｡蜉ｹ)"}`;

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
      await deleteItemFromApi("deleteDestination", d.id);
      await loadAllDataFromApi();
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
  fillSelect("shipmentStandard", state.standards, "規格を選択");
  fillSelect("shipmentUnit", state.units, "単位を選択");
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
  destinations.forEach((d) => select.appendChild(new Option(d.name, d.id)));
  if (destinations.some((d) => String(d.id) === prev)) select.value = prev;
}

function fillSelect(id, items, placeholder) {
  const select = document.getElementById(id);
  const prev = select.value;
  select.innerHTML = "";
  if (!items.length) {
    const opt = new Option(`${placeholder}（未登録）`, "");
    select.appendChild(opt);
    select.disabled = true;
    return;
  }
  select.disabled = false;
  items.forEach((v) => select.appendChild(new Option(v, v)));
  if (items.includes(prev)) select.value = prev;
}

function entriesByDate(date, opts = {}) {
  const key = normalizeDateKey(date);
  const base = state.entries.filter((x) => normalizeDateKey(x.date) === key);
  const generated = (opts.generatedRecurring || []).filter((x) => normalizeDateKey(x.date) === key);
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

function normalizeDateKey(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  // Accept "YYYY-MM-DD", "YYYY/MM/DD", and ISO strings like "YYYY-MM-DDTHH:mm:ss.sssZ".
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




