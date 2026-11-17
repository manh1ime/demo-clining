import { createCleaningScene } from "./scene.js";

let CRM_PROSPECTS = [];
let CRM_SOURCE_META = { format: "Локальный импорт", generatedAt: "" };
if (import.meta.env.DEV || import.meta.env.MODE === "internal") {
  try {
    const response = await fetch(import.meta.env.MODE === "internal" ? "/crm100.json" : "/leads-data.local.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const source = await response.json();
    CRM_PROSPECTS = Array.isArray(source.prospects) ? source.prospects : [];
    CRM_SOURCE_META = { ...CRM_SOURCE_META, ...(source.meta || {}) };
  } catch (error) {
    console.warn("Локальная база лидов не загружена. Используйте безопасный импорт JSON.", error);
  }
}

const STORAGE_KEY = "legche-leads-crm100-v1";
const FILTERS_KEY = "legche-lead-filters-v2";
const TEMPLATES_KEY = "legche-lead-templates-v1";
const THEME_KEY = "legche-leads-theme";
const BASE_DATE = new Date("2026-11-17T10:00:00+03:00");

const STATUSES = ["Новый", "Оффер отправлен", "Ответил", "Есть интерес", "Клиент", "Отказ"];
const OFFER_GROUPS = [
  "Новый сайт / первая квалификация",
  "Сайт есть / интеграция",
  "Уточнить профиль",
  "Точечная доработка",
  "Резерв текущего продукта",
];
const PRIORITIES = Array.from({ length: 101 }, (_, value) => value);
const SOURCE_STATUS = {
  new: "Новый",
  offer_sent: "Оффер отправлен",
  replied: "Ответил",
  interested: "Есть интерес",
  client: "Клиент",
  refused: "Отказ",
};
const STATUS_TO_SOURCE = {
  "Новый": "new",
  "Оффер отправлен": "offer_sent",
  "Ответил": "replied",
  "Есть интерес": "interested",
  "Клиент": "client",
  "Отказ": "refused",
};
const GROUP_FROM_SOURCE = {
  new_site: "Новый сайт / первая квалификация",
  existing_site: "Сайт есть / интеграция",
  qualify: "Уточнить профиль",
  fix: "Точечная доработка",
  reserve: "Резерв текущего продукта",
};
const GROUP_GUIDANCE = {
  "Новый сайт / первая квалификация": "Узнать ответственного за сайт и поток заявок, затем решать, уместно ли демо.",
  "Сайт есть / интеграция": "Понять текущую обработку заявок и предложить конкретную интеграцию с Telegram.",
  "Уточнить профиль": "Подтвердить профиль, регион и аудиторию до отправки оффера.",
  "Точечная доработка": "Найти одну конкретную проблему и предложить понятное исправление.",
  "Резерв текущего продукта": "Не ставить в основную очередь и не отправлять массовое сообщение без проверки.",
};
const STATUS_CLASS = {
  "Новый": "status-new",
  "Оффер отправлен": "status-sent",
  "Ответил": "status-answered",
  "Есть интерес": "status-interest",
  "Клиент": "status-client",
  "Отказ": "status-refused",
};
const DEFAULT_TEMPLATES = [
  {
    id: "first",
    name: "Первое предложение",
    text: "Здравствуйте! Подготовили для компании «{компания}» вариант обновления сайта с учётом вашей работы в городе {город}. Демо можно посмотреть здесь: {ссылка}. Если идея вам подходит, расскажу, что можно запустить первым этапом.",
  },
  {
    id: "followup",
    name: "Повторный контакт",
    text: "Здравствуйте, {имя}! Возвращаюсь к предложению для «{компания}». Получилось посмотреть демо {ссылка}? Могу коротко пояснить логику и адаптировать решение под ваши текущие задачи.",
  },
  {
    id: "interest",
    name: "После проявленного интереса",
    text: "{имя}, добрый день! Для следующего шага по «{компания}» предлагаю уточнить приоритетные услуги и способ приёма заявок. После этого зафиксируем точный состав работ и сроки.",
  },
];

const DEFAULT_FILTERS = {
  view: "all",
  query: "",
  status: "",
  group: "",
  city: "",
  firstQueue: false,
  demo: false,
  reply: false,
  phone: false,
  channel: "",
  priority: "",
  actionDate: "",
  addedDate: "",
  applications: false,
  sort: "priority",
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const clone = (value) => JSON.parse(JSON.stringify(value));
const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
const norm = (value) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const leadKey = (lead) => `${norm(lead.name)} · ${norm(lead.city)}`;
const toIso = (date) => new Date(date).toISOString();
const dayOffset = (days) => toIso(BASE_DATE.getTime() - days * 86_400_000);
const plusDays = (days) => new Date(BASE_DATE.getTime() + days * 86_400_000).toISOString().slice(0, 10);
const uid = () => crypto.randomUUID?.() || `lead-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const isFirstQueue = (lead) => Number(lead.priority) > 0;

function formatDate(value, withTime = false) {
  if (!value) return "Не указано";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Не указано";
  return new Intl.DateTimeFormat("ru-RU", withTime
    ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }
    : { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function relativeDate(value) {
  if (!value) return "Нет действий";
  const diff = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000));
  if (diff === 0) return "Сегодня";
  if (diff === 1) return "Вчера";
  if (diff < 7) return `${diff} дн. назад`;
  return formatDate(value);
}

function actionTiming(lead) {
  if (!String(lead.nextStep || "").trim()) return { label: "Нет следующего шага", tone: "missing" };
  if (!lead.followUpAt) return { label: "Дата не назначена", tone: "muted" };
  const today = new Date().toISOString().slice(0, 10);
  if (lead.followUpAt < today) return { label: `Просрочено · ${formatDate(lead.followUpAt)}`, tone: "overdue" };
  if (lead.followUpAt === today) return { label: "Сделать сегодня", tone: "today" };
  return { label: `До ${formatDate(lead.followUpAt)}`, tone: "scheduled" };
}

function phoneDigits(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "8") digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  return digits.length >= 10 ? digits : "";
}

function safeExternalUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value, window.location.origin);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function nextStepFor(status, callLater) {
  if (callLater) return "Позвонить и уточнить решение";
  if (status === "Новый") return "Проверить контакты и подготовить предложение";
  if (status === "Оффер отправлен") return "Уточнить, посмотрели ли демо-сайт";
  if (status === "Ответил") return "Разобрать ответ и задать уточняющий вопрос";
  if (status === "Есть интерес") return "Согласовать состав первого этапа";
  if (status === "Клиент") return "Поддерживать контакт и фиксировать задачи";
  return "Закрыть карточку или вернуться позже";
}

function historyEvent(title, detail, at, type = "note") {
  return { id: uid(), title, detail, at: at || new Date().toISOString(), type };
}

function noteValue(notes, label) {
  const line = String(notes || "").split("\n").find((item) => item.trim().startsWith(`${label}:`));
  return line ? line.trim().slice(label.length + 1).trim() : "";
}

function splitLinks(value) {
  return String(value || "").split(/\n+/).map((item) => item.trim()).filter((item) => safeExternalUrl(item));
}

function groupQuestion(group) {
  if (group === "new_site") return "Кто отвечает за сайт и есть ли стабильный поток заявок?";
  if (group === "existing_site") return "Куда сейчас поступают заявки с сайта и кто их обрабатывает?";
  if (group === "qualify") return "Какой профиль, регион и целевая аудитория компании подтверждены?";
  if (group === "fix") return "Какая конкретная проблема сайта мешает получать или обрабатывать заявки?";
  return "Есть ли отдельная задача, для которой подходит текущий продукт?";
}

function sourceToLead(record, index, customId) {
  const links = splitLinks(record.links);
  const map2gis = links.find((link) => link.includes("2gis.")) || "";
  const website = links.find((link) => !link.includes("2gis.") && !link.includes("t.me/") && !link.includes("vk.")) || "";
  const status = SOURCE_STATUS[record.status] || (STATUSES.includes(record.status) ? record.status : "Новый");
  const priority = Math.max(0, Math.round(Number(record.priority) || 0));
  const createdAt = `${CRM_SOURCE_META.generatedAt || "2026-11-16"}T12:00:00+03:00`;
  const importedAt = new Date().toISOString();
  const channelMeta = Object.fromEntries(["phone", "whatsapp", "telegram", "max", "vk", "email"].map((channel) => [channel, { confirmed: false, used: false }]));
  return {
    id: customId || `2gis-${record.sourceFirmId || uid()}`,
    sourceFirmId: String(record.sourceFirmId || ""),
    name: String(record.name || "Без названия"),
    city: String(record.city || "Не указан"),
    status,
    offerGroup: GROUP_FROM_SOURCE[record.group] || OFFER_GROUPS[2],
    offerGroupCode: record.group || "qualify",
    priority,
    priorityReason: priority > 0 ? `Позиция ${priority} в первой очереди исходной базы.` : "Обычный лид вне первой очереди.",
    nextStep: String(record.nextAction || nextStepFor(status, false)),
    mainQuestion: groupQuestion(record.group),
    factBasis: noteValue(record.notes, "Факт"),
    whatToOffer: String(record.offer || ""),
    demoCondition: noteValue(record.notes, "Условие демо"),
    followUpAt: priority > 0 ? "2026-11-17" : "",
    notes: String(record.notes || ""),
    description: noteValue(record.notes, "Факт") || "Описание компании пока не подтверждено.",
    source: "2ГИС · база 100 компаний",
    sourceCardUrl: map2gis,
    otherLinks: links,
    address: "",
    hours: "",
    createdAt,
    updatedAt: importedAt,
    lastActionAt: importedAt,
    contactName: "",
    phone: String(record.phone || ""),
    email: "",
    whatsapp: String(record.wa || ""),
    telegram: String(record.tg || ""),
    max: String(record.max || ""),
    vk: String(record.vk || ""),
    map2gis,
    yandexMaps: "",
    website,
    channelMeta,
    demoUrl: "",
    demoCreatedAt: "",
    demoViews: 0,
    demoLastViewAt: "",
    demoApplications: 0,
    demoLastApplicationAt: "",
    demoColor: "#5b72ff",
    demoLogoText: String(record.name || ""),
    demoModelName: String(record.name || ""),
    demoTariffs: "",
    demoRates: { regular: 70, deep: 130, renovation: 170 },
    demoStatus: "Не создано",
    message: String(record.firstMessage || ""),
    messageTemplate: "first",
    history: [
      historyEvent("Импортирован лид", `Источник: ${CRM_SOURCE_META.format}; ID ${record.sourceFirmId || "не указан"}`, importedAt, "import"),
      historyEvent("Лид создан", "Добавлен в исходную базу 100 компаний", createdAt, "created"),
    ],
    sourceRecord: {
      format: CRM_SOURCE_META.format,
      group: record.group,
      status: record.status,
      sourceIndex: index,
    },
  };
}

function normalizeLead(record, index) {
  const source = CRM_PROSPECTS.find((item) => item.sourceFirmId && item.sourceFirmId === record.sourceFirmId) || record;
  const baseline = sourceToLead(source, index, record.id || uid());
  return {
    ...baseline,
    ...record,
    history: Array.isArray(record.history) ? record.history : baseline.history,
    channelMeta: { ...baseline.channelMeta, ...(record.channelMeta || {}) },
    sourceRecord: { ...baseline.sourceRecord, ...(record.sourceRecord || {}) },
  };
}

let loadError = "";
function loadLeads() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (Array.isArray(stored)) return stored.map(normalizeLead);
  } catch (error) {
    loadError = "Сохранённая база повреждена. Загружена резервная тестовая версия.";
    console.warn(error);
  }

  return CRM_PROSPECTS.map((record, index) => sourceToLead(record, index));
}

function loadFilters() {
  try {
    return { ...DEFAULT_FILTERS, ...JSON.parse(localStorage.getItem(FILTERS_KEY) || "{}") };
  } catch {
    return { ...DEFAULT_FILTERS };
  }
}

function loadTemplates() {
  try {
    const stored = JSON.parse(localStorage.getItem(TEMPLATES_KEY) || "null");
    return Array.isArray(stored) && stored.length ? stored : clone(DEFAULT_TEMPLATES);
  } catch {
    return clone(DEFAULT_TEMPLATES);
  }
}

let highlightedId = null;
try { highlightedId = sessionStorage.getItem("legche-highlighted-lead"); } catch {}

const state = {
  leads: loadLeads(),
  filters: loadFilters(),
  templates: loadTemplates(),
  selectedId: null,
  highlightedId,
  draft: null,
  dirty: false,
  activeTab: "overview",
  listScroll: 0,
  scene: null,
  lastOpenedChannel: "",
};

const elements = {
  sidebar: $("#crmSidebar"),
  listView: $("#listView"),
  detail: $("#leadDetail"),
  rows: $("#leadRows"),
  empty: $("#emptyState"),
  search: $("#globalSearch"),
  status: $("#statusFilter"),
  group: $("#groupFilter"),
  city: $("#cityFilter"),
  sort: $("#sortSelect"),
  drawer: $("#filterDrawer"),
  detailBody: $("#detailBody"),
  toast: $("#crmToast"),
};

let toastTimer;
function showToast(message, error = false) {
  elements.toast.textContent = message;
  elements.toast.classList.toggle("is-error", error);
  elements.toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 2800);
}

function saveLeads() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.leads));
    $("#storageSummary").textContent = `${state.leads.length} лидов в текущем браузере`;
    return true;
  } catch (error) {
    console.error(error);
    showToast("Не удалось сохранить изменения. Проверьте доступное место браузера.", true);
    return false;
  }
}

function saveFilters() {
  try { localStorage.setItem(FILTERS_KEY, JSON.stringify(state.filters)); } catch (error) { console.warn(error); }
}

function counts() {
  return {
    all: state.leads.length,
    new: state.leads.filter((lead) => lead.status === "Новый").length,
    priority: state.leads.filter((lead) => isFirstQueue(lead) && lead.status !== "Отказ").length,
    sent: state.leads.filter((lead) => lead.status === "Оффер отправлен").length,
    answered: state.leads.filter((lead) => lead.status === "Ответил").length,
    interest: state.leads.filter((lead) => lead.status === "Есть интерес").length,
    clients: state.leads.filter((lead) => lead.status === "Клиент").length,
    refused: state.leads.filter((lead) => lead.status === "Отказ").length,
    demos: state.leads.filter((lead) => lead.demoViews > 0).length,
    applications: state.leads.filter((lead) => lead.demoApplications > 0).length,
  };
}

function matchesView(lead) {
  const view = state.filters.view;
  if (["all", "templates", "settings"].includes(view)) return true;
  if (view === "new") return lead.status === "Новый";
  if (view === "priority") return isFirstQueue(lead) && lead.status !== "Отказ";
  if (view === "sent") return lead.status === "Оффер отправлен";
  if (view === "answered") return lead.status === "Ответил";
  if (view === "interest") return lead.status === "Есть интерес";
  if (view === "clients") return lead.status === "Клиент";
  if (view === "refused") return lead.status === "Отказ";
  if (view === "demos") return lead.demoViews > 0 || Boolean(lead.demoUrl);
  return true;
}

function matchesSearch(lead) {
  const query = norm(state.filters.query);
  if (!query) return true;
  return [
    lead.name, lead.city, lead.phone, lead.contactName, lead.notes, lead.address,
    lead.website, lead.demoUrl, lead.email, lead.nextStep, lead.description,
    lead.sourceFirmId, lead.sourceCardUrl, lead.mainQuestion, lead.factBasis,
    ...(lead.otherLinks || []),
  ].some((value) => norm(value).includes(query));
}

function hasChannel(lead, channel) {
  if (!channel) return true;
  if (channel === "phone") return Boolean(phoneDigits(lead.phone));
  return Boolean(lead[channel]);
}

function filteredLeads() {
  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
  const matchesPriority = (lead) => {
    const value = Number(lead.priority) || 0;
    if (!state.filters.priority) return true;
    if (state.filters.priority === "first") return value > 0;
    if (state.filters.priority === "1-3") return value >= 1 && value <= 3;
    if (state.filters.priority === "4-8") return value >= 4 && value <= 8;
    if (state.filters.priority === "9+") return value >= 9;
    return value === 0;
  };
  const matchesActionDate = (lead) => {
    if (!state.filters.actionDate) return true;
    if (state.filters.actionDate === "no-step") return !String(lead.nextStep || "").trim();
    if (state.filters.actionDate === "today") return lead.followUpAt === today;
    if (state.filters.actionDate === "overdue") return Boolean(lead.followUpAt && lead.followUpAt < today);
    return Boolean(lead.followUpAt && lead.followUpAt > today);
  };
  const matchesAddedDate = (lead) => {
    if (!state.filters.addedDate) return true;
    const created = new Date(lead.createdAt);
    if (state.filters.addedDate === "today") return created.toISOString().slice(0, 10) === today;
    if (state.filters.addedDate === "7d") return created >= sevenDaysAgo;
    return created >= thirtyDaysAgo;
  };
  return state.leads.filter((lead) => matchesView(lead)
    && matchesSearch(lead)
    && (!state.filters.status || lead.status === state.filters.status)
    && (!state.filters.group || lead.offerGroup === state.filters.group)
    && (!state.filters.city || lead.city === state.filters.city)
    && (!state.filters.firstQueue || isFirstQueue(lead))
    && (!state.filters.demo || lead.demoViews > 0)
    && (!state.filters.applications || lead.demoApplications > 0)
    && (!state.filters.reply || ["Ответил", "Есть интерес", "Клиент"].includes(lead.status))
    && (!state.filters.phone || Boolean(phoneDigits(lead.phone)))
    && hasChannel(lead, state.filters.channel)
    && matchesPriority(lead)
    && matchesActionDate(lead)
    && matchesAddedDate(lead))
    .sort((a, b) => {
      if (state.filters.sort === "updatedAt") return new Date(b.updatedAt) - new Date(a.updatedAt);
      if (state.filters.sort === "demoViews") return b.demoViews - a.demoViews;
      if (state.filters.sort === "applications") return b.demoApplications - a.demoApplications;
      if (state.filters.sort === "createdAt") return new Date(b.createdAt) - new Date(a.createdAt);
      if (state.filters.sort === "nextAction") return (a.followUpAt || "9999-12-31").localeCompare(b.followUpAt || "9999-12-31");
      const aPriority = Number(a.priority) > 0 ? Number(a.priority) : Number.MAX_SAFE_INTEGER;
      const bPriority = Number(b.priority) > 0 ? Number(b.priority) : Number.MAX_SAFE_INTEGER;
      return aPriority - bPriority
        || (a.followUpAt || "9999-12-31").localeCompare(b.followUpAt || "9999-12-31")
        || new Date(b.updatedAt) - new Date(a.updatedAt);
    });
}

function channelDots(lead) {
  const channels = [
    ["Т", phoneDigits(lead.phone)],
    ["W", lead.whatsapp],
    ["TG", lead.telegram],
    ["M", lead.max],
    ["VK", lead.vk],
  ];
  return channels.map(([label, value]) => {
    const key = label === "Т" ? "phone" : label === "W" ? "whatsapp" : label === "TG" ? "telegram" : label === "M" ? "max" : "vk";
    const meta = lead.channelMeta?.[key] || {};
    const title = !value ? "Нет данных" : meta.confirmed ? "Контакт подтверждён" : meta.used ? "Канал уже использовался" : "Контакт не подтверждён";
    return `<span class="channel-dot${value ? " is-filled" : ""}${meta.used ? " is-used" : ""}" title="${esc(title)}">${label}</span>`;
  }).join("");
}

function renderRows(list) {
  elements.rows.innerHTML = list.map((lead) => {
    const timing = actionTiming(lead);
    return `
    <article class="lead-row${state.highlightedId === lead.id ? " is-selected" : ""}" role="listitem" tabindex="0" data-lead-id="${esc(lead.id)}">
      <div class="company-cell"><strong>${esc(lead.name)}</strong><small>${esc(lead.city)}${lead.contactName ? ` · ${esc(lead.contactName)}` : " · контакт не указан"}</small></div>
      <select class="inline-status ${STATUS_CLASS[lead.status] || "status-new"}" data-list-status data-lead-status-id="${esc(lead.id)}" aria-label="Статус ${esc(lead.name)}">${options(STATUSES, lead.status)}</select>
      <span class="offer-group">${esc(lead.offerGroup)}</span>
      <span class="priority priority-${Number(lead.priority) > 0 && Number(lead.priority) <= 4 ? "high" : Number(lead.priority) > 0 && Number(lead.priority) <= 8 ? "medium" : "low"}">${Number(lead.priority) > 0 ? `№${Number(lead.priority)}` : "Обычный"}</span>
      <span class="next-step${lead.nextStep ? "" : " is-missing"}"><b>${esc(lead.nextStep || "Следующий шаг не указан")}</b><small class="timing-${timing.tone}">${esc(timing.label)}</small></span>
      <span class="last-action"><b>${esc(relativeDate(lead.lastActionAt))}</b><small>${esc(formatDate(lead.lastActionAt, true))}</small></span>
      <span class="demo-cell"><strong>${Number(lead.demoViews) || 0}</strong><small>просмотров</small></span>
      <span class="channel-dots">${channelDots(lead)}</span>
      <span class="application-dot${lead.demoApplications ? " is-active" : ""}" title="${lead.demoApplications ? "Есть заявка с демо-сайта" : "Заявок с демо-сайта нет"}"></span>
      <span class="row-arrow">›</span>
      <span class="mobile-row-meta">${lead.demoViews || 0} просм. <b>›</b></span>
    </article>`;
  }).join("");
}

function activeFilterEntries() {
  const result = [];
  if (state.filters.status) result.push(["status", `Статус: ${state.filters.status}`]);
  if (state.filters.group) result.push(["group", state.filters.group]);
  if (state.filters.city) result.push(["city", state.filters.city]);
  if (state.filters.firstQueue) result.push(["firstQueue", "Первая очередь"]);
  if (state.filters.demo) result.push(["demo", "Открывали демо"]);
  if (state.filters.reply) result.push(["reply", "Есть ответ"]);
  if (state.filters.phone) result.push(["phone", "Есть телефон"]);
  if (state.filters.channel) result.push(["channel", `Канал: ${state.filters.channel}`]);
  if (state.filters.priority) result.push(["priority", `Приоритет: ${state.filters.priority}`]);
  if (state.filters.actionDate) result.push(["actionDate", `Действие: ${state.filters.actionDate}`]);
  if (state.filters.addedDate) result.push(["addedDate", `Добавлен: ${state.filters.addedDate}`]);
  if (state.filters.applications) result.push(["applications", "Есть заявки"]);
  return result;
}

function populateSelect(select, values, current) {
  const first = select.options[0]?.outerHTML || "";
  select.innerHTML = `${first}${values.map((value) => `<option value="${esc(value)}">${esc(value)}</option>`).join("")}`;
  select.value = current || "";
}

function syncFilterControls() {
  const cities = [...new Set(state.leads.map((lead) => lead.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
  populateSelect(elements.status, STATUSES, state.filters.status);
  populateSelect(elements.group, OFFER_GROUPS, state.filters.group);
  populateSelect(elements.city, cities, state.filters.city);
  populateSelect($("#drawerStatus"), STATUSES, state.filters.status);
  populateSelect($("#drawerGroup"), OFFER_GROUPS, state.filters.group);
  populateSelect($("#drawerCity"), cities, state.filters.city);
  $("#channelFilter").value = state.filters.channel;
  $("#firstQueueFilter").checked = state.filters.firstQueue;
  $("#demoFilter").checked = state.filters.demo;
  $("#replyFilter").checked = state.filters.reply;
  $("#phoneFilter").checked = state.filters.phone;
  $("#applicationsFilter").checked = state.filters.applications;
  $("#priorityFilter").value = state.filters.priority;
  $("#actionDateFilter").value = state.filters.actionDate;
  $("#addedDateFilter").value = state.filters.addedDate;
  elements.sort.value = state.filters.sort;
  elements.search.value = state.filters.query;
}

function renderCounts() {
  const values = counts();
  Object.entries(values).forEach(([key, value]) => {
    $$(`[data-count="${key}"], [data-stat-value="${key}"]`).forEach((element) => { element.textContent = value; });
  });
  $("#storageSummary").textContent = `${state.leads.length} лидов в текущем браузере`;
}

const VIEW_LABELS = {
  all: ["Все лиды", "Компании, с которыми нужно работать сегодня"],
  new: ["Новые лиды", "Карточки, которые ещё нужно квалифицировать"],
  priority: ["Первая очередь", "Лиды, требующие внимания в первую очередь"],
  sent: ["Оффер отправлен", "Компании, которым уже отправили предложение"],
  answered: ["Есть ответ", "Лиды, от которых получен ответ"],
  interest: ["Есть интерес", "Компании, готовые обсуждать следующий шаг"],
  clients: ["Клиенты", "Компании, перешедшие в работу"],
  refused: ["Отказы", "Закрытые и отложенные предложения"],
  demos: ["Демо-сайты", "Лиды с созданным или открытым демо-сайтом"],
  templates: ["Шаблоны сообщений", "Рабочие тексты для контакта с лидами"],
  settings: ["Настройки", "Локальная база, импорт и резервные копии"],
};

function renderActiveFilters() {
  const filters = activeFilterEntries();
  const host = $("#activeFilters");
  host.hidden = !filters.length;
  host.innerHTML = filters.map(([key, label]) => `<button type="button" data-clear-filter="${key}">${esc(label)} <i>×</i></button>`).join("");
  const count = filters.length;
  [$("#activeFilterCount"), $("#mobileFilterCount")].forEach((element) => {
    element.hidden = !count;
    element.textContent = count;
  });
}

function renderTemplatesView() {
  const host = $("#templatesView");
  host.innerHTML = `
    <div class="special-heading"><div><h2>Шаблоны сообщений</h2><p>Переменные: {компания}, {город}, {имя}, {ссылка}, {источник}.</p></div><button class="secondary-button" type="button" data-special-action="restore-templates">Вернуть исходные</button></div>
    <div class="template-grid">${state.templates.map((template) => `
      <article class="template-card" data-template-card="${esc(template.id)}"><header><h3>${esc(template.name)}</h3><span class="badge status-new">Шаблон</span></header><textarea maxlength="3000">${esc(template.text)}</textarea><footer><button class="secondary-button" type="button" data-special-action="save-template" data-template-id="${esc(template.id)}">Сохранить</button></footer></article>
    `).join("")}</div>`;
}

function renderSettingsView() {
  $("#settingsView").innerHTML = `
    <div class="special-heading"><div><h2>Настройки локальной базы</h2><p>CRM работает только в этом браузере и не входит в публичную сборку сайта.</p></div></div>
    <div class="settings-grid">
      <article class="setting-card"><header><h3>Резервная копия</h3></header><p>JSON сохраняет полную карточку, историю и каналы. CSV подходит для таблиц и совместимого обмена.</p><div class="setting-actions"><button class="secondary-button" type="button" data-special-action="backup">Скачать JSON</button><button class="secondary-button" type="button" data-special-action="export">Скачать CSV</button><button class="secondary-button" type="button" data-special-action="import">Импортировать</button></div></article>
      <article class="setting-card"><header><h3>Исходная база</h3></header><p>Восстановление вернёт ровно 100 компаний из CRM_100_компаний_группы_контакты.json. Перед заменой текущая база сохраняется локально.</p><div class="setting-actions"><button class="secondary-button" type="button" data-special-action="reset">Восстановить 100 лидов</button></div></article>
      <article class="setting-card"><header><h3>Тема интерфейса</h3></header><p>Светлая и тёмная темы сохраняются для следующего открытия панели.</p><div class="setting-actions"><button class="secondary-button" type="button" data-special-action="theme">Сменить тему</button></div></article>
      <article class="setting-card"><header><h3>Источник</h3></header><p>${esc(CRM_SOURCE_META.format)} · сформирован ${esc(CRM_SOURCE_META.generatedAt)}. Файл источника не входит в публичную сборку.</p></article>
    </div>`;
}

function renderList() {
  const special = ["templates", "settings"].includes(state.filters.view);
  const [title, subtitle] = VIEW_LABELS[state.filters.view] || VIEW_LABELS.all;
  $("#viewTitle").textContent = title;
  $("#listHeading").textContent = title;
  $("#listSubtitle").textContent = subtitle;
  $$(".crm-nav [data-view]").forEach((button) => button.classList.toggle("is-active", button.dataset.view === state.filters.view));
  $(".lead-list-card").hidden = special;
  $("#statStrip").hidden = special;
  $("#templatesView").hidden = state.filters.view !== "templates";
  $("#settingsView").hidden = state.filters.view !== "settings";
  if (state.filters.view === "templates") renderTemplatesView();
  if (state.filters.view === "settings") renderSettingsView();
  if (!special) {
    const list = filteredLeads();
    renderRows(list);
    $("#visibleCount").textContent = list.length;
    elements.empty.hidden = list.length > 0;
    elements.rows.hidden = !list.length;
  }
  renderCounts();
  renderActiveFilters();
  syncFilterControls();
  saveFilters();
}

function setView(view) {
  state.filters.view = view;
  elements.sidebar.classList.remove("is-open");
  renderList();
}

function resetFilters(keepView = true) {
  const view = keepView ? state.filters.view : "all";
  state.filters = { ...DEFAULT_FILTERS, view };
  renderList();
}

function options(values, selected) {
  return values.map((value) => `<option value="${esc(value)}"${value === selected ? " selected" : ""}>${esc(value)}</option>`).join("");
}

function contactCard(code, label, value, channel, lead) {
  const filled = Boolean(value);
  const meta = lead.channelMeta?.[channel] || {};
  const stateLabel = !filled ? "Не заполнен" : meta.confirmed ? "Контакт подтверждён" : meta.used ? "Канал использовался, контакт не подтверждён" : "Контакт не подтверждён";
  return `
    <article class="contact-card${filled ? "" : " is-empty"}">
      <span class="contact-icon">${esc(code)}</span>
      <div><strong>${esc(label)}</strong><small>${filled ? esc(value) : "Не заполнен"}</small><span class="contact-check">${meta.confirmed ? "✓" : "○"} ${esc(stateLabel)}</span></div>
      <button type="button" data-contact-action="${esc(channel)}"${filled ? "" : " disabled"} aria-label="Открыть ${esc(label)}">↗</button>
    </article>`;
}

function historyHtml(history) {
  if (!history?.length) return `<div class="no-demo"><span>○</span><h3>История пока пуста</h3><p>Действия с лидом появятся здесь автоматически.</p></div>`;
  const icons = { created: "+", import: "⇩", status: "↗", priority: "↑", message: "✉", demo: "◫", application: "●", note: "·", contact: "↗" };
  return [...history].sort((a, b) => new Date(b.at) - new Date(a.at)).map((event) => `
    <div class="history-item"><span class="history-icon">${icons[event.type] || "·"}</span><div><strong>${esc(event.title)}</strong><p>${esc(event.detail || "")}</p></div><time>${esc(formatDate(event.at, true))}</time></div>
  `).join("");
}

function templateText(templateId, lead) {
  const template = state.templates.find((item) => item.id === templateId) || state.templates[0];
  const demo = lead.demoUrl ? new URL(lead.demoUrl, window.location.origin).href : "ссылка ещё не создана";
  return template.text
    .replaceAll("{компания}", lead.name || "компания")
    .replaceAll("{город}", lead.city || "вашем городе")
    .replaceAll("{имя}", lead.contactName || "добрый день")
    .replaceAll("{ссылка}", demo)
    .replaceAll("{источник}", lead.source || "текущая база")
    .replaceAll("{company}", lead.name || "компания")
    .replaceAll("{city}", lead.city || "вашем городе")
    .replaceAll("{contact}", lead.contactName || "добрый день")
    .replaceAll("{demo}", demo)
    .replaceAll("{source}", lead.source || "текущая база");
}

function detailPanel(id, title, caption, content, panel = "overview", active = false) {
  return `<section class="detail-panel${active ? " is-active" : ""}" data-panel="${panel}" id="${id}"><header class="panel-title"><div><span>${esc(caption)}</span><h2>${esc(title)}</h2></div></header><div class="panel-content">${content}</div></section>`;
}

function renderOverview(lead) {
  return `
    <div class="overview-grid">
      <div class="info-item"><span>Описание</span><strong>${esc(lead.description || "Описание пока не заполнено")}</strong></div>
      <div class="info-item"><span>Источник</span><strong>${esc(lead.source || "Не указан")}</strong></div>
      <div class="info-item"><span>ID исходной карточки</span><strong>${esc(lead.sourceFirmId || "Не указан")}</strong></div>
      <div class="info-item"><span>Телефон</span><strong>${esc(lead.phone || "Не указан")}</strong></div>
      <div class="info-item"><span>Контактное лицо</span><strong>${esc(lead.contactName || "Не указано")}</strong></div>
      <div class="info-item"><span>Исходная карточка</span>${lead.sourceCardUrl ? `<a href="${esc(lead.sourceCardUrl)}" target="_blank" rel="noopener">Открыть источник ↗</a>` : "<strong>Не указана</strong>"}</div>
      <div class="info-item"><span>Адрес</span><strong>${esc(lead.address || "Не указан")}</strong></div>
      <div class="info-item"><span>Часы работы</span><strong>${esc(lead.hours || "Не указаны")}</strong></div>
      <div class="info-item"><span>Добавлен</span><strong>${esc(formatDate(lead.createdAt, true))}</strong></div>
      <div class="info-item"><span>Последнее изменение</span><strong>${esc(formatDate(lead.updatedAt, true))}</strong></div>
      <div class="info-item"><span>Просмотры демо</span><strong>${Number(lead.demoViews) || 0}</strong></div>
      <div class="info-item"><span>Заявки с сайта</span><strong>${Number(lead.demoApplications) || 0}</strong></div>
      <div class="detail-description"><p>Статус сделки, группа предложения, приоритет и следующий шаг хранятся отдельно. Это помогает не смешивать этап продажи и содержание оффера.</p></div>
    </div>`;
}

function renderContacts(lead) {
  return `
    <div class="contact-grid">
      ${contactCard("Т", "Телефон", lead.phone, "phone", lead)}
      ${contactCard("W", "WhatsApp", lead.whatsapp, "whatsapp", lead)}
      ${contactCard("TG", "Telegram", lead.telegram, "telegram", lead)}
      ${contactCard("M", "MAX", lead.max, "max", lead)}
      ${contactCard("VK", "ВКонтакте", lead.vk, "vk", lead)}
      ${contactCard("@", "Email", lead.email, "email", lead)}
    </div>
    <div class="legacy-flags" style="margin-top:12px">
      <label><input data-field="channelMeta.phone.confirmed" type="checkbox"${lead.channelMeta?.phone?.confirmed ? " checked" : ""}>Телефон подтверждён</label>
      <label><input data-field="channelMeta.whatsapp.confirmed" type="checkbox"${lead.channelMeta?.whatsapp?.confirmed ? " checked" : ""}>WhatsApp подтверждён</label>
      <label><input data-field="channelMeta.telegram.confirmed" type="checkbox"${lead.channelMeta?.telegram?.confirmed ? " checked" : ""}>Telegram подтверждён</label>
      <label><input data-field="channelMeta.max.confirmed" type="checkbox"${lead.channelMeta?.max?.confirmed ? " checked" : ""}>MAX подтверждён</label>
      <label><input data-field="channelMeta.vk.confirmed" type="checkbox"${lead.channelMeta?.vk?.confirmed ? " checked" : ""}>VK подтверждён</label>
    </div>
    <div class="work-grid" style="margin-top:16px">
      <label class="detail-field"><span>Контактное лицо</span><input data-field="contactName" value="${esc(lead.contactName)}" placeholder="Имя и должность"></label>
      <label class="detail-field"><span>Телефон</span><input data-field="phone" value="${esc(lead.phone)}" placeholder="+7 900 000-00-00"></label>
      <label class="detail-field"><span>Email</span><input data-field="email" type="email" value="${esc(lead.email)}" placeholder="name@company.ru"></label>
      <label class="detail-field"><span>WhatsApp</span><input data-field="whatsapp" value="${esc(lead.whatsapp)}" placeholder="Номер телефона"></label>
      <label class="detail-field"><span>Telegram</span><input data-field="telegram" value="${esc(lead.telegram)}" placeholder="@username"></label>
      <label class="detail-field"><span>MAX</span><input data-field="max" value="${esc(lead.max)}" placeholder="Номер телефона"></label>
      <label class="detail-field"><span>ВКонтакте</span><input data-field="vk" value="${esc(lead.vk)}" placeholder="https://vk.com/..."></label>
      <label class="detail-field"><span>Сайт</span><input data-field="website" value="${esc(lead.website)}" placeholder="https://..."></label>
      <label class="detail-field"><span>2ГИС</span><input data-field="map2gis" value="${esc(lead.map2gis)}" placeholder="Ссылка на карточку"></label>
      <label class="detail-field"><span>Яндекс Карты</span><input data-field="yandexMaps" value="${esc(lead.yandexMaps)}" placeholder="Ссылка на карточку"></label>
      <label class="detail-field full"><span>Адрес</span><input data-field="address" value="${esc(lead.address)}" placeholder="Адрес компании"></label>
    </div>`;
}

function renderWork(lead) {
  return `
    <div class="work-grid">
      <p class="message-note full">${esc(GROUP_GUIDANCE[lead.offerGroup] || "Сценарий группы не определён.")}</p>
      <label class="detail-field"><span>Группа предложения</span><select data-field="offerGroup">${options(OFFER_GROUPS, lead.offerGroup)}</select></label>
      <label class="detail-field"><span>Числовой приоритет</span><input data-field="priority" type="number" min="0" max="999" value="${Number(lead.priority) || 0}"></label>
      <label class="detail-field"><span>Срок следующего контакта</span><input data-field="followUpAt" type="date" value="${esc(lead.followUpAt)}"></label>
      <label class="detail-field"><span>Почему такой приоритет</span><input data-field="priorityReason" value="${esc(lead.priorityReason || "")}" maxlength="500"></label>
      <label class="detail-field full"><span>Следующий шаг</span><input data-field="nextStep" value="${esc(lead.nextStep)}" maxlength="300"></label>
      <label class="detail-field full"><span>Главный вопрос к компании</span><textarea data-field="mainQuestion" rows="3" maxlength="1500">${esc(lead.mainQuestion)}</textarea></label>
      <label class="detail-field full"><span>Факт, на котором основано предложение</span><textarea data-field="factBasis" rows="3" maxlength="1500">${esc(lead.factBasis)}</textarea></label>
      <label class="detail-field full"><span>Оффер при проявлении интереса</span><textarea data-field="whatToOffer" rows="3" maxlength="1500">${esc(lead.whatToOffer)}</textarea></label>
      <label class="detail-field full"><span>Условие показа демо</span><textarea data-field="demoCondition" rows="3" maxlength="1500">${esc(lead.demoCondition)}</textarea></label>
      <label class="detail-field full"><span>Заметки менеджера</span><textarea data-field="notes" rows="5" maxlength="4000">${esc(lead.notes)}</textarea></label>
    </div>`;
}

function renderMessage(lead) {
  const message = lead.message || templateText(lead.messageTemplate || "first", lead);
  return `
    <div class="message-tools"><label class="message-field"><span>Шаблон</span><select id="messageTemplate">${state.templates.map((template) => `<option value="${esc(template.id)}"${template.id === lead.messageTemplate ? " selected" : ""}>${esc(template.name)}</option>`).join("")}</select></label><button class="secondary-button" type="button" data-detail-action="apply-template">Подставить заново</button></div>
    <label class="message-field"><span>Текст сообщения</span><textarea id="leadMessage" data-field="message" maxlength="4000">${esc(message)}</textarea><small class="char-count"><span id="messageCount">${message.length}</span> / 4000</small></label>
    <div class="message-actions">
      <button class="channel-button" type="button" data-message-channel="whatsapp"${lead.whatsapp ? "" : " disabled"}>WhatsApp ↗</button>
      <button class="channel-button" type="button" data-message-channel="telegram"${lead.telegram ? "" : " disabled"}>Telegram ↗</button>
      <button class="channel-button" type="button" data-message-channel="max"${lead.max ? "" : " disabled"}>MAX ↗</button>
      <button class="channel-button" type="button" data-message-channel="vk"${lead.vk ? "" : " disabled"}>ВКонтакте ↗</button>
      <button class="channel-button" type="button" data-detail-action="copy-message">Копировать текст</button>
      <button class="channel-button confirm" type="button" data-detail-action="confirm-sent">Подтвердить отправку</button>
    </div>
    <p class="message-note">Открытие мессенджера не считается отправкой. После реальной отправки вернитесь в карточку и нажмите «Подтвердить отправку».</p>`;
}

function demoBuilderFields(lead) {
  const rates = { regular: 70, deep: 130, renovation: 170, ...(lead.demoRates || {}) };
  return `<div class="work-grid demo-builder"><label class="detail-field"><span>Статус готовности</span><select data-field="demoStatus">${options(["Не создано", "Черновик", "Готово", "Отправлено"], lead.demoStatus)}</select></label><label class="detail-field"><span>Дата создания</span><input data-field="demoCreatedAt" type="date" value="${esc(String(lead.demoCreatedAt || "").slice(0,10))}"></label><label class="detail-field"><span>Цветовая схема</span><input data-field="demoColor" type="color" value="${esc(lead.demoColor || "#5b72ff")}"></label><label class="detail-field"><span>Текст логотипа</span><input data-field="demoLogoText" value="${esc(lead.demoLogoText || lead.name)}"></label><label class="detail-field full"><span>Название на 3D-модели</span><input data-field="demoModelName" value="${esc(lead.demoModelName || lead.name)}"></label><label class="detail-field"><span>Поддерживающая, ₽/м²</span><input data-field="demoRates.regular" type="number" min="20" max="1000" value="${Number(rates.regular) || 70}"></label><label class="detail-field"><span>Генеральная, ₽/м²</span><input data-field="demoRates.deep" type="number" min="20" max="1000" value="${Number(rates.deep) || 130}"></label><label class="detail-field"><span>После ремонта, ₽/м²</span><input data-field="demoRates.renovation" type="number" min="20" max="1000" value="${Number(rates.renovation) || 170}"></label><label class="detail-field full"><span>Комментарий к тарифам</span><textarea data-field="demoTariffs" rows="3" placeholder="Например: минимальный заказ 2 500 ₽">${esc(Array.isArray(lead.demoTariffs) ? lead.demoTariffs.join("\n") : lead.demoTariffs || "")}</textarea></label></div>`;
}

function renderDemo(lead) {
  if (!lead.demoUrl) {
    return `<div class="no-demo"><span>▱</span><h3>Демо-сайт ещё не создан</h3><p>Настройте бренд, цвет и тарифы, затем создайте персональную ссылку. Никакие контакты или заметки в неё не попадут.</p></div>${demoBuilderFields(lead)}<div class="demo-buttons"><button class="primary-button" type="button" data-detail-action="create-demo">Создать демо-сайт</button></div>`;
  }
  const fullUrl = new URL(lead.demoUrl, window.location.origin).href;
  return `
    <div class="demo-preview" id="leadModel"><img src="/assets/model-fallback.png" alt="Предпросмотр концепции сайта"><div class="model-loading"><span></span>Загрузка предпросмотра</div></div>
    <div class="demo-details"><div class="demo-link"><span>Ссылка на демо</span><a href="${esc(fullUrl)}" target="_blank" rel="noopener">${esc(fullUrl)}</a></div><div class="demo-stat"><span>Просмотры</span><strong>${Number(lead.demoViews) || 0}</strong></div><div class="demo-stat"><span>Последний</span><strong>${lead.demoLastViewAt ? esc(formatDate(lead.demoLastViewAt)) : "-"}</strong></div><div class="demo-stat"><span>Заявки</span><strong>${Number(lead.demoApplications) || 0}</strong></div></div>
    ${demoBuilderFields(lead)}
    <div class="demo-buttons"><button class="secondary-button" type="button" data-detail-action="open-demo">Открыть сайт ↗</button><button class="secondary-button" type="button" data-detail-action="copy-demo">Копировать ссылку</button></div>`;
}

function renderDetailBody() {
  const lead = state.draft;
  if (!lead) return;
  const nextCard = `
    <aside class="next-action-card" data-panel="work"><span>Следующее действие</span><h2>${esc(lead.nextStep || "Следующий шаг не указан")}</h2><p>${esc(lead.priorityReason || (isFirstQueue(lead) ? "Лид находится в первой очереди." : "Обычный лид вне первой очереди."))}</p><footer><span>Срок контакта</span><strong>${lead.followUpAt ? esc(formatDate(lead.followUpAt)) : "Не назначен"}</strong></footer></aside>`;
  elements.detailBody.innerHTML = `
    <div class="detail-column">
      ${detailPanel("overviewPanel", "Обзор компании", "Основные сведения", renderOverview(lead), "overview", true)}
      ${detailPanel("contactsPanel", "Контакты и каналы", "Связь", renderContacts(lead), "contacts")}
      ${detailPanel("workPanel", "Работа с лидом", "Продажа", renderWork(lead), "work")}
      ${detailPanel("historyPanel", "История действий", "Хронология", `<div class="history-list">${historyHtml(lead.history)}</div>`, "history")}
    </div>
    <div class="detail-column">
      ${nextCard}
      ${detailPanel("messagePanel", "Подготовка сообщения", "Коммуникация", renderMessage(lead), "message")}
      ${detailPanel("demoPanel", "Демо-сайт", "Предпросмотр", renderDemo(lead), "demo")}
    </div>`;
  applyActiveTab();
  requestAnimationFrame(setupDetailScene);
}

function applyActiveTab() {
  $$("#detailTabs [data-tab]").forEach((button) => button.classList.toggle("is-active", button.dataset.tab === state.activeTab));
  $$("#detailBody [data-panel]").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.panel === state.activeTab));
}

function setupDetailScene() {
  state.scene?.dispose();
  state.scene = null;
  const host = $("#leadModel");
  if (!host || window.matchMedia("(max-width: 900px)").matches) return;
  state.scene = createCleaningScene(host, { mode: "admin", isPaused: () => document.hidden });
}

function draftStorageKey(id) {
  return `legche-lead-draft:${id}`;
}

function saveDraft() {
  if (!state.draft) return;
  try { sessionStorage.setItem(draftStorageKey(state.draft.id), JSON.stringify(state.draft)); } catch (error) { console.warn(error); }
}

function markDirty() {
  state.dirty = true;
  $("#unsavedMark").hidden = false;
  saveDraft();
}

function setPath(target, path, value) {
  const parts = path.split(".");
  let current = target;
  parts.slice(0, -1).forEach((part) => {
    if (!current[part] || typeof current[part] !== "object") current[part] = {};
    current = current[part];
  });
  current[parts.at(-1)] = value;
}

function openLead(id) {
  const lead = state.leads.find((item) => item.id === id);
  if (!lead) {
    showToast("Карточка лида не найдена.", true);
    return;
  }
  state.listScroll = window.scrollY;
  state.selectedId = id;
  state.highlightedId = id;
  try { sessionStorage.setItem("legche-highlighted-lead", id); } catch {}
  try { sessionStorage.setItem("legche-selected-lead", id); } catch {}
  state.activeTab = "overview";
  state.lastOpenedChannel = "";
  let savedDraft = null;
  try { savedDraft = JSON.parse(sessionStorage.getItem(draftStorageKey(id)) || "null"); } catch { savedDraft = null; }
  state.draft = savedDraft?.id === id ? normalizeLead(savedDraft, 0) : clone(lead);
  state.dirty = Boolean(savedDraft);
  elements.listView.hidden = true;
  elements.detail.hidden = false;
  $("#detailTitle").textContent = state.draft.name;
  $("#detailCity").textContent = state.draft.city;
  $("#mobileDetailStatus").textContent = state.draft.status;
  $("#mobileDetailPriority").textContent = Number(state.draft.priority) > 0 ? `Приоритет №${state.draft.priority}` : "Вне первой очереди";
  $("#detailStatus").innerHTML = options(STATUSES, state.draft.status);
  $("#detailGroup").innerHTML = options(OFFER_GROUPS, state.draft.offerGroup);
  $("#detailPriority").innerHTML = options(PRIORITIES, state.draft.priority);
  $("#unsavedMark").hidden = !state.dirty;
  renderDetailBody();
  window.scrollTo({ top: 0, behavior: "auto" });
}

function closeLead() {
  state.scene?.dispose();
  state.scene = null;
  if (state.dirty) saveDraft();
  state.selectedId = null;
  try { sessionStorage.removeItem("legche-selected-lead"); } catch {}
  state.draft = null;
  state.dirty = false;
  elements.detail.hidden = true;
  elements.listView.hidden = false;
  renderList();
  requestAnimationFrame(() => window.scrollTo({ top: state.listScroll, behavior: "auto" }));
}

function addDraftHistory(title, detail, type = "note") {
  state.draft.history = Array.isArray(state.draft.history) ? state.draft.history : [];
  state.draft.history.unshift(historyEvent(title, detail, new Date().toISOString(), type));
  state.draft.lastActionAt = new Date().toISOString();
}

function saveCurrentLead(silent = false) {
  if (!state.draft) return false;
  const index = state.leads.findIndex((lead) => lead.id === state.draft.id);
  if (index < 0) return false;
  const previous = state.leads[index];
  if (previous.status !== state.draft.status) addDraftHistory("Статус изменён", `${previous.status} → ${state.draft.status}`, "status");
  if (Number(previous.priority) !== Number(state.draft.priority)) addDraftHistory("Приоритет изменён", `${Number(previous.priority) || 0} → ${Number(state.draft.priority) || 0}`, "priority");
  if (previous.notes !== state.draft.notes) addDraftHistory("Добавлена заметка", "Заметки менеджера обновлены", "note");
  state.draft.updatedAt = new Date().toISOString();
  state.draft.lastActionAt = state.draft.updatedAt;
  state.draft.sourceRecord = { ...state.draft.sourceRecord, status: STATUS_TO_SOURCE[state.draft.status] || "new" };
  state.leads[index] = clone(state.draft);
  if (!saveLeads()) return false;
  try { sessionStorage.removeItem(draftStorageKey(state.draft.id)); } catch {}
  state.dirty = false;
  $("#unsavedMark").hidden = true;
  renderCounts();
  if (!silent) showToast("Карточка сохранена.");
  return true;
}

function deleteCurrentLead() {
  if (!state.draft) return;
  if (!window.confirm(`Удалить «${state.draft.name}»? Восстановить карточку можно будет только из резервной копии.`)) return;
  state.leads = state.leads.filter((lead) => lead.id !== state.draft.id);
  try { sessionStorage.removeItem(draftStorageKey(state.draft.id)); } catch {}
  saveLeads();
  closeLead();
  showToast("Лид удалён.");
}

function persistAction(title, detail, type = "note") {
  if (!state.draft) return;
  const event = historyEvent(title, detail, new Date().toISOString(), type);
  state.draft.history = Array.isArray(state.draft.history) ? state.draft.history : [];
  state.draft.history.unshift(event);
  state.draft.lastActionAt = event.at;
  const lead = state.leads.find((item) => item.id === state.draft.id);
  if (lead) {
    lead.history = Array.isArray(lead.history) ? lead.history : [];
    lead.history.unshift(clone(event));
    lead.lastActionAt = event.at;
    lead.updatedAt = event.at;
    saveLeads();
  }
  const historyHost = $("#historyPanel .history-list");
  if (historyHost) historyHost.innerHTML = historyHtml(state.draft.history);
  saveDraft();
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }
}

function currentMessage() {
  const textarea = $("#leadMessage");
  return textarea?.value.trim() || state.draft?.message || templateText(state.draft?.messageTemplate || "first", state.draft);
}

async function openContactChannel(channel, includeMessage = false) {
  const lead = state.draft;
  if (!lead) return;
  const message = currentMessage();
  let url = "";

  if (channel === "phone") url = phoneDigits(lead.phone) ? `tel:+${phoneDigits(lead.phone)}` : "";
  if (channel === "email") url = lead.email ? `mailto:${encodeURIComponent(lead.email)}${includeMessage ? `?body=${encodeURIComponent(message)}` : ""}` : "";
  if (channel === "whatsapp") url = phoneDigits(lead.whatsapp) ? `https://wa.me/${phoneDigits(lead.whatsapp)}${includeMessage ? `?text=${encodeURIComponent(message)}` : ""}` : "";
  if (channel === "telegram") {
    const raw = String(lead.telegram || "").trim();
    const username = raw.replace(/^@/, "");
    url = safeExternalUrl(raw) || (username ? `https://t.me/${username}` : "");
  }
  if (channel === "max") url = safeExternalUrl(lead.max) || (lead.max ? "https://web.max.ru/" : "");
  if (channel === "vk") url = safeExternalUrl(lead.vk);

  if (!url) {
    showToast("Канал не заполнен или ссылка имеет некорректный формат.", true);
    return;
  }

  if (includeMessage && ["telegram", "max", "vk"].includes(channel)) await copyText(message);
  window.open(url, "_blank", "noopener,noreferrer");
  state.lastOpenedChannel = channel;
  state.draft.channelMeta = state.draft.channelMeta || {};
  state.draft.channelMeta[channel] = { ...(state.draft.channelMeta[channel] || {}), used: true };
  const storedLead = state.leads.find((item) => item.id === state.draft.id);
  if (storedLead) {
    storedLead.channelMeta = storedLead.channelMeta || {};
    storedLead.channelMeta[channel] = { ...(storedLead.channelMeta[channel] || {}), used: true };
  }
  const labels = { phone: "телефон", email: "email", whatsapp: "WhatsApp", telegram: "Telegram", max: "MAX", vk: "ВКонтакте" };
  persistAction("Открыт канал связи", `Открыт ${labels[channel]}. Отправка сообщения не подтверждена.`, "contact");
  showToast("Канал открыт. После отправки подтвердите действие отдельно.");
}

function applyMessageTemplate() {
  const select = $("#messageTemplate");
  if (!select || !state.draft) return;
  state.draft.messageTemplate = select.value;
  state.draft.message = templateText(select.value, state.draft);
  $("#leadMessage").value = state.draft.message;
  $("#messageCount").textContent = state.draft.message.length;
  addDraftHistory("Подготовлено сообщение", `Выбран шаблон «${state.templates.find((item) => item.id === select.value)?.name || "Сообщение"}»`, "message");
  markDirty();
}

async function confirmMessageSent() {
  if (!state.draft) return;
  if (!window.confirm("Подтвердить, что сообщение действительно отправлено? Открытие чата само по себе отправкой не считается.")) return;
  const channel = state.lastOpenedChannel || "вручную";
  state.draft.channelMeta = state.draft.channelMeta || {};
  if (channel !== "вручную") state.draft.channelMeta[channel] = { ...(state.draft.channelMeta[channel] || {}), used: true };
  if (state.draft.status === "Новый") state.draft.status = "Оффер отправлен";
  addDraftHistory("Подтверждена отправка", `Канал: ${channel}`, "message");
  saveCurrentLead(true);
  $("#detailStatus").value = state.draft.status;
  renderDetailBody();
  showToast("Отправка подтверждена и добавлена в историю.");
}

function buildDemoUrl(lead) {
  const url = new URL("/index.html", window.location.origin);
  const rates = { regular: 70, deep: 130, renovation: 170, ...(lead.demoRates || {}) };
  url.searchParams.set("demo", "1");
  url.searchParams.set("brand", String(lead.demoLogoText || lead.name).slice(0, 50));
  url.searchParams.set("model", String(lead.demoModelName || lead.name).slice(0, 70));
  url.searchParams.set("accent", String(lead.demoColor || "#5b72ff").replace("#", ""));
  url.searchParams.set("regular", String(Math.max(20, Math.round(Number(rates.regular) || 70))));
  url.searchParams.set("deep", String(Math.max(20, Math.round(Number(rates.deep) || 130))));
  url.searchParams.set("renovation", String(Math.max(20, Math.round(Number(rates.renovation) || 170))));
  return `${url.pathname}${url.search}`;
}

function createDemoForLead() {
  if (!state.draft) return;
  state.draft.demoUrl = buildDemoUrl(state.draft);
  state.draft.demoCreatedAt = new Date().toISOString();
  state.draft.demoStatus = "Черновик";
  state.draft.demoViews = 0;
  state.draft.demoApplications = 0;
  addDraftHistory("Создана ссылка на демо", "Локальная ссылка подготовлена для сообщения", "demo");
  markDirty();
  renderDetailBody();
  showToast("Тестовая ссылка создана. Сохраните карточку.");
}

async function demoAction(action) {
  if (!state.draft?.demoUrl) return;
  const url = new URL(state.draft.demoUrl, window.location.origin).href;
  if (action === "open-demo") {
    window.open(url, "_blank", "noopener,noreferrer");
    persistAction("Открыт демо-сайт", "Менеджер открыл ссылку из карточки", "demo");
  } else {
    await copyText(url);
    persistAction("Скопирована ссылка на демо", "Ссылка подготовлена для отправки", "demo");
    showToast("Ссылка скопирована.");
  }
}

function handleDraftField(target) {
  if (!state.draft || !target.dataset.field) return;
  const field = target.dataset.field;
  const value = target.type === "checkbox" ? target.checked : target.type === "number" ? Math.max(0, Math.round(Number(target.value) || 0)) : target.value;
  setPath(state.draft, field, value);
  if (field.startsWith("demo") && field !== "demoUrl" && state.draft.demoUrl) state.draft.demoUrl = buildDemoUrl(state.draft);
  if (field === "message") $("#messageCount").textContent = target.value.length;
  markDirty();
}

function createLeadFromInput(record) {
  const groupCode = Object.entries(GROUP_FROM_SOURCE).find(([, label]) => label === record.offerGroup)?.[0] || "new_site";
  const lead = sourceToLead({
    name: record.name,
    city: record.city,
    phone: record.phone,
    sourceFirmId: record.sourceFirmId || "",
    links: record.links || "",
    notes: record.notes || "",
    group: groupCode,
    priority: Number(record.priority) || 0,
    nextAction: record.nextStep || "Найти контактное лицо",
    offer: record.whatToOffer || "",
    firstMessage: record.message || "",
    status: "new",
    wa: record.whatsapp || "",
    tg: record.telegram || "",
    max: record.max || "",
    vk: record.vk || "",
  }, state.leads.length, uid());
  const now = new Date().toISOString();
  return {
    ...lead,
    status: "Новый",
    offerGroup: OFFER_GROUPS.includes(record.offerGroup) ? record.offerGroup : OFFER_GROUPS[0],
    priority: Math.max(0, Math.round(Number(record.priority) || 0)),
    notes: record.notes || "",
    createdAt: now,
    updatedAt: now,
    lastActionAt: now,
    demoUrl: "",
    demoViews: 0,
    demoLastViewAt: "",
    demoApplications: 0,
    history: [historyEvent("Лид создан", "Добавлен менеджером", now, "created")],
    sourceRecord: { format: "manual", group: groupCode, status: "new", sourceIndex: -1 },
  };
}

function duplicateLead(record) {
  const sourceId = String(record.sourceFirmId || "").trim();
  if (sourceId) {
    const byId = state.leads.find((lead) => lead.sourceFirmId === sourceId);
    if (byId) return byId;
  }
  const digits = phoneDigits(record.phone);
  if (digits) {
    const byPhone = state.leads.find((lead) => phoneDigits(lead.phone) === digits);
    if (byPhone) return byPhone;
  }
  const key = leadKey(record);
  return state.leads.find((lead) => leadKey(lead) === key);
}

function openNewLeadModal() {
  $("#newLeadModal").hidden = false;
  document.body.style.overflow = "hidden";
  setTimeout(() => $('#newLeadForm [name="name"]').focus(), 20);
}

function closeNewLeadModal() {
  $("#newLeadModal").hidden = true;
  document.body.style.overflow = "";
}

function parseBulkLine(line) {
  const clean = line.replace(/^\s*\d+[.)]\s*/, "").replace(/[\u2010-\u2015]/g, "-").trim();
  const match = clean.match(/(\+?\d[\d\s()\-]{6,})$/);
  const phone = match ? match[1].replace(/\s+/g, " ").trim() : "";
  const name = (match ? clean.slice(0, match.index) : clean).replace(/[,;|]+$/, "").trim();
  return { name, phone };
}

const csvCell = (value) => {
  let safe = String(value ?? "");
  if (/^[=+\-@]/.test(safe)) safe = `'${safe}`;
  return `"${safe.replace(/"/g, '""')}"`;
};
function exportCsv() {
  const header = ["ID источника", "Название", "Город", "Адрес", "Контактное лицо", "Телефон", "Email", "Статус", "Группа", "Приоритет", "Следующий шаг", "Дата контакта", "WhatsApp", "Telegram", "MAX", "VK", "Сайт", "Заметки"];
  const rows = state.leads.map((lead) => [
    lead.sourceFirmId, lead.name, lead.city, lead.address, lead.contactName, lead.phone, lead.email,
    lead.status, lead.offerGroup, lead.priority, lead.nextStep, lead.followUpAt, lead.whatsapp,
    lead.telegram, lead.max, lead.vk, lead.website, lead.notes,
  ].map(csvCell).join(","));
  const blob = new Blob([`\ufeff${[header.join(","), ...rows].join("\n")}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("CSV-файл подготовлен.");
}

function downloadBackup() {
  const body = JSON.stringify({ format: "legche-leads-backup-v2", createdAt: new Date().toISOString(), leads: state.leads }, null, 2);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([body], { type: "application/json;charset=utf-8" }));
  link.download = `leads-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("Полная резервная копия скачана.");
}

function parseCsv(text) {
  const rows = [];
  let cell = "";
  let row = [];
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(cell); cell = ""; }
    else if (character === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (character !== "\r") cell += character;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

let pendingImport = null;

function importRecordFromCsv(row, headers) {
  const value = (name) => {
    const index = headers.findIndex((header) => norm(header) === norm(name));
    return index >= 0 ? String(row[index] || "").replace(/^'(?=[=+\-@])/, "").trim() : "";
  };
  return {
    sourceFirmId: value("ID источника"), name: value("Название"), city: value("Город"), address: value("Адрес"),
    contactName: value("Контактное лицо"), phone: value("Телефон"), email: value("Email"),
    status: value("Статус"), offerGroup: value("Группа"), priority: Number(value("Приоритет")) || 0,
    nextStep: value("Следующий шаг"), followUpAt: value("Дата контакта"), whatsapp: value("WhatsApp"),
    telegram: value("Telegram"), max: value("MAX"), vk: value("VK"), website: value("Сайт"), notes: value("Заметки"),
  };
}

function validateImportRecord(record) {
  const errors = [];
  if (!String(record.name || "").trim()) errors.push("Не указано название компании");
  if (record.phone && !phoneDigits(record.phone)) errors.push("Некорректный телефон");
  [record.website, record.vk, record.telegram].filter(Boolean).forEach((url) => {
    if ((String(url).startsWith("http://") || String(url).startsWith("https://")) && !safeExternalUrl(url)) errors.push(`Некорректная ссылка: ${url}`);
  });
  return errors;
}

function findImportMatches(record) {
  const byId = record.sourceFirmId ? state.leads.filter((lead) => lead.sourceFirmId === String(record.sourceFirmId)) : [];
  if (byId.length) return { reason: "ID источника", matches: byId };
  const digits = phoneDigits(record.phone);
  const byPhone = digits ? state.leads.filter((lead) => phoneDigits(lead.phone) === digits) : [];
  if (byPhone.length) return { reason: "телефон", matches: byPhone };
  const key = leadKey(record);
  const byName = state.leads.filter((lead) => leadKey(lead) === key);
  return { reason: "название и город", matches: byName };
}

function normalizeImportRecord(record, index) {
  if (record.sourceRecord || record.history) return normalizeLead(record, index);
  if (record.group && GROUP_FROM_SOURCE[record.group]) return sourceToLead(record, index, uid());
  return createLeadFromInput({ ...record, status: "Новый", offerGroup: OFFER_GROUPS.includes(record.offerGroup) ? record.offerGroup : OFFER_GROUPS[0] });
}

function buildImportPlan(records) {
  const seen = new Set();
  const items = records.map((raw, index) => {
    const candidate = normalizeImportRecord(raw, index);
    candidate.status = "Новый";
    const errors = validateImportRecord(candidate);
    const importKey = candidate.sourceFirmId || phoneDigits(candidate.phone) || leadKey(candidate);
    if (seen.has(importKey)) errors.push("Дубликат внутри импортируемого файла");
    seen.add(importKey);
    if (errors.length) return { action: "error", candidate, errors };
    const match = findImportMatches(candidate);
    if (match.matches.length > 1) return { action: "conflict", candidate, errors: [`Неоднозначное совпадение по полю: ${match.reason}`], matches: match.matches.map((lead) => lead.id) };
    if (match.matches.length === 1) return { action: "update", candidate, matchId: match.matches[0].id, errors: [] };
    return { action: "add", candidate, errors: [] };
  });
  return {
    items,
    counts: {
      total: records.length,
      add: items.filter((item) => item.action === "add").length,
      update: items.filter((item) => item.action === "update").length,
      conflict: items.filter((item) => item.action === "conflict").length,
      error: items.filter((item) => item.action === "error").length,
      skip: items.filter((item) => ["conflict", "error"].includes(item.action)).length,
    },
  };
}

function renderImportPlan(plan) {
  const problems = plan.items.filter((item) => ["conflict", "error"].includes(item.action));
  $("#importBody").innerHTML = `
    <div class="import-summary"><div><span>Компаний</span><strong>${plan.counts.total}</strong></div><div><span>Добавить</span><strong>${plan.counts.add}</strong></div><div><span>Обновить</span><strong>${plan.counts.update}</strong></div><div><span>Пропустить</span><strong>${plan.counts.skip}</strong></div><div><span>Конфликты</span><strong>${plan.counts.conflict}</strong></div><div><span>Ошибки</span><strong>${plan.counts.error}</strong></div></div>
    <div class="import-problems">${problems.length ? problems.slice(0, 30).map((item) => `<div class="import-problem is-error"><strong>${esc(item.candidate.name || "Без названия")}</strong><br>${esc(item.errors.join("; "))}</div>`).join("") : '<div class="import-problem">Файл прошёл проверку. Совпадения будут обновлены без изменения статуса, заметок и истории.</div>'}</div>`;
}

async function prepareImport(file) {
  if (!file) return;
  if (file.size > 5_000_000) { showToast("Файл больше 5 МБ. Разделите его на части.", true); return; }
  try {
    const text = (await file.text()).replace(/^\ufeff/, "");
    let records;
    if (file.name.toLowerCase().endsWith(".json")) {
      const data = JSON.parse(text);
      if (data.format && !["cleaning-crm-prospects-v1", "legche-leads-backup-v2"].includes(data.format)) throw new Error(`Формат ${data.format} не поддерживается`);
      records = Array.isArray(data) ? data : data.prospects || data.leads;
    } else {
      const rows = parseCsv(text);
      const headers = rows[0] || [];
      records = rows.slice(1).filter((row) => row.some(Boolean)).map((row) => importRecordFromCsv(row, headers));
    }
    if (!Array.isArray(records)) throw new Error("В файле не найден массив лидов");
    pendingImport = buildImportPlan(records);
    renderImportPlan(pendingImport);
    $("#importModal").hidden = false;
    $("#importBackupConfirmed").checked = false;
    $("#confirmImport").disabled = true;
    document.body.style.overflow = "hidden";
  } catch (error) {
    showToast(`Ошибка импорта: ${error.message}`, true);
  }
}

function mergeImportedLead(existing, candidate) {
  const preserve = new Set(["id", "status", "notes", "history", "createdAt"]);
  Object.entries(candidate).forEach(([key, value]) => {
    if (preserve.has(key) || value === "" || value == null || (Array.isArray(value) && !value.length)) return;
    if (key === "channelMeta") {
      existing.channelMeta = { ...(existing.channelMeta || {}), ...value };
      return;
    }
    if (existing[key] === "" || existing[key] == null || (Array.isArray(existing[key]) && !existing[key].length)) existing[key] = clone(value);
  });
  existing.updatedAt = new Date().toISOString();
  existing.history.unshift(historyEvent("Данные дополнены импортом", "Пустые поля заполнены без изменения статуса, заметок и истории", existing.updatedAt, "import"));
}

function applyImport() {
  if (!pendingImport || !$("#importBackupConfirmed").checked) return;
  let added = 0;
  let updated = 0;
  pendingImport.items.forEach((item) => {
    if (item.action === "add") {
      item.candidate.status = "Новый";
      item.candidate.history.unshift(historyEvent("Импортирован лид", "Добавлен после предварительной проверки", new Date().toISOString(), "import"));
      state.leads.push(item.candidate);
      added += 1;
    }
    if (item.action === "update") {
      const existing = state.leads.find((lead) => lead.id === item.matchId);
      if (existing) { mergeImportedLead(existing, item.candidate); updated += 1; }
    }
  });
  saveLeads();
  renderList();
  closeImportModal();
  const skipped = pendingImport.counts.conflict + pendingImport.counts.error;
  showToast(`Импорт завершён: добавлено ${added}, обновлено ${updated}, пропущено ${skipped}.`, false);
  pendingImport = null;
}

function closeImportModal() {
  $("#importModal").hidden = true;
  document.body.style.overflow = "";
}

function resetTestData() {
  if (!window.confirm("Восстановить ровно 100 лидов из CRM_100_компаний_группы_контакты.json? Текущая база будет сохранена в резервном ключе браузера.")) return;
  try { localStorage.setItem(`${STORAGE_KEY}:backup:${Date.now()}`, JSON.stringify(state.leads)); } catch (error) { console.warn(error); }
  state.leads = CRM_PROSPECTS.map((record, index) => sourceToLead(record, index));
  saveLeads();
  resetFilters(false);
  showToast("Тестовая база восстановлена.");
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch {}
}

function runDataAction(action) {
  if (action === "backup") downloadBackup();
  if (action === "export") exportCsv();
  if (action === "import") $("#csvInput").click();
  if (action === "reset") resetTestData();
  if (action === "theme") toggleTheme();
  $("#actionMenu").hidden = true;
}

function openFilters() {
  syncFilterControls();
  elements.drawer.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeFilters() {
  elements.drawer.hidden = true;
  document.body.style.overflow = "";
}

function applyDrawerFilters() {
  state.filters.status = $("#drawerStatus").value;
  state.filters.group = $("#drawerGroup").value;
  state.filters.city = $("#drawerCity").value;
  state.filters.channel = $("#channelFilter").value;
  state.filters.firstQueue = $("#firstQueueFilter").checked;
  state.filters.demo = $("#demoFilter").checked;
  state.filters.reply = $("#replyFilter").checked;
  state.filters.phone = $("#phoneFilter").checked;
  state.filters.applications = $("#applicationsFilter").checked;
  state.filters.priority = $("#priorityFilter").value;
  state.filters.actionDate = $("#actionDateFilter").value;
  state.filters.addedDate = $("#addedDateFilter").value;
  closeFilters();
  renderList();
}

$$('.crm-nav [data-view]').forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
$$('[data-stat]').forEach((button) => button.addEventListener("click", () => setView(button.dataset.stat)));

elements.rows.addEventListener("click", (event) => {
  if (event.target.closest("[data-list-status]")) return;
  const row = event.target.closest("[data-lead-id]");
  if (row) openLead(row.dataset.leadId);
});
elements.rows.addEventListener("change", (event) => {
  const select = event.target.closest("[data-list-status]");
  if (!select) return;
  const lead = state.leads.find((item) => item.id === select.dataset.leadStatusId);
  if (!lead || lead.status === select.value) return;
  const previous = lead.status;
  lead.status = select.value;
  lead.updatedAt = new Date().toISOString();
  lead.lastActionAt = lead.updatedAt;
  lead.history.unshift(historyEvent("Статус изменён", `${previous} → ${lead.status}`, lead.updatedAt, "status"));
  saveLeads();
  renderList();
  showToast("Статус обновлён.");
});
elements.rows.addEventListener("keydown", (event) => {
  if (!["Enter", " "].includes(event.key)) return;
  const row = event.target.closest("[data-lead-id]");
  if (row) { event.preventDefault(); openLead(row.dataset.leadId); }
});

elements.search.addEventListener("input", () => {
  state.filters.query = elements.search.value;
  renderList();
});
elements.status.addEventListener("change", () => { state.filters.status = elements.status.value; renderList(); });
elements.group.addEventListener("change", () => { state.filters.group = elements.group.value; renderList(); });
elements.city.addEventListener("change", () => { state.filters.city = elements.city.value; renderList(); });
elements.sort.addEventListener("change", () => { state.filters.sort = elements.sort.value; renderList(); });

$("#activeFilters").addEventListener("click", (event) => {
  const button = event.target.closest("[data-clear-filter]");
  if (!button) return;
  const key = button.dataset.clearFilter;
  state.filters[key] = typeof state.filters[key] === "boolean" ? false : "";
  renderList();
});
$("#advancedFilters").addEventListener("click", openFilters);
$("#mobileFilters").addEventListener("click", openFilters);
$$('[data-close-filters]').forEach((button) => button.addEventListener("click", closeFilters));
$("#applyFilters").addEventListener("click", applyDrawerFilters);
$("#resetFilters").addEventListener("click", () => { resetFilters(true); closeFilters(); });
$("#emptyReset").addEventListener("click", () => resetFilters(false));

$("#mobileMenu").addEventListener("click", () => elements.sidebar.classList.add("is-open"));
$("#sidebarClose").addEventListener("click", () => elements.sidebar.classList.remove("is-open"));
$("#themeToggle").addEventListener("click", toggleTheme);
$("#newLeadButton").addEventListener("click", openNewLeadModal);
$$('[data-top-action]').forEach((button) => button.addEventListener("click", () => runDataAction(button.dataset.topAction)));

$("#actionMenuButton").addEventListener("click", (event) => {
  event.stopPropagation();
  $("#actionMenu").hidden = !$("#actionMenu").hidden;
});
$("#actionMenu").addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (button) runDataAction(button.dataset.action);
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".action-menu-wrap")) $("#actionMenu").hidden = true;
});

$("#templatesView").addEventListener("click", (event) => {
  const button = event.target.closest("[data-special-action]");
  if (!button) return;
  if (button.dataset.specialAction === "save-template") {
    const card = button.closest("[data-template-card]");
    const template = state.templates.find((item) => item.id === button.dataset.templateId);
    if (template) template.text = $("textarea", card).value.trim();
    try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(state.templates)); } catch {}
    showToast("Шаблон сохранён.");
  }
  if (button.dataset.specialAction === "restore-templates" && window.confirm("Вернуть исходные тексты шаблонов?")) {
    state.templates = clone(DEFAULT_TEMPLATES);
    try { localStorage.setItem(TEMPLATES_KEY, JSON.stringify(state.templates)); } catch {}
    renderTemplatesView();
    showToast("Исходные шаблоны восстановлены.");
  }
});

$("#settingsView").addEventListener("click", (event) => {
  const action = event.target.closest("[data-special-action]")?.dataset.specialAction;
  if (action) runDataAction(action);
});

$("#backToLeads").addEventListener("click", closeLead);
$("#saveLead").addEventListener("click", () => saveCurrentLead());
$("#deleteLead").addEventListener("click", deleteCurrentLead);
$("#detailStatus").addEventListener("change", (event) => { if (state.draft) { state.draft.status = event.target.value; $("#mobileDetailStatus").textContent = event.target.value; markDirty(); } });
$("#detailGroup").addEventListener("change", (event) => { if (state.draft) { state.draft.offerGroup = event.target.value; markDirty(); } });
$("#detailPriority").addEventListener("change", (event) => { if (state.draft) { state.draft.priority = Number(event.target.value) || 0; $("#mobileDetailPriority").textContent = state.draft.priority > 0 ? `Приоритет №${state.draft.priority}` : "Вне первой очереди"; markDirty(); } });

$("#detailTabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-tab]");
  if (!button) return;
  state.activeTab = button.dataset.tab;
  applyActiveTab();
  window.scrollTo({ top: 105, behavior: "smooth" });
});

elements.detailBody.addEventListener("input", (event) => {
  if (event.target.matches("input[data-field], textarea[data-field]")) handleDraftField(event.target);
});
elements.detailBody.addEventListener("change", (event) => {
  if (event.target.matches("select[data-field], input[type=checkbox][data-field]")) handleDraftField(event.target);
  if (event.target.id === "messageTemplate") {
    state.draft.messageTemplate = event.target.value;
    applyMessageTemplate();
  }
});
elements.detailBody.addEventListener("click", async (event) => {
  const contact = event.target.closest("[data-contact-action]");
  if (contact && !contact.disabled) await openContactChannel(contact.dataset.contactAction, false);
  const channel = event.target.closest("[data-message-channel]");
  if (channel && !channel.disabled) await openContactChannel(channel.dataset.messageChannel, true);
  const action = event.target.closest("[data-detail-action]")?.dataset.detailAction;
  if (!action) return;
  if (action === "apply-template") applyMessageTemplate();
  if (action === "copy-message") {
    await copyText(currentMessage());
    persistAction("Скопирован текст сообщения", "Текст подготовлен для ручной отправки", "message");
    showToast("Текст скопирован.");
  }
  if (action === "confirm-sent") await confirmMessageSent();
  if (action === "create-demo") createDemoForLead();
  if (["open-demo", "copy-demo"].includes(action)) await demoAction(action);
});

$$('[data-close-modal]').forEach((button) => button.addEventListener("click", closeNewLeadModal));
$$('[data-create-tab]').forEach((button) => button.addEventListener("click", () => {
  $$('[data-create-tab]').forEach((item) => item.classList.toggle("is-active", item === button));
  $$('[data-create-panel]').forEach((panel) => { panel.hidden = panel.dataset.createPanel !== button.dataset.createTab; });
}));

$("#newLeadForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const record = {
    name: String(data.get("name") || "").trim(),
    city: String(data.get("city") || "").trim(),
    phone: String(data.get("phone") || "").trim(),
    status: String(data.get("status") || "Новый"),
    offerGroup: String(data.get("offerGroup") || OFFER_GROUPS[0]),
    sourceFirmId: String(data.get("sourceFirmId") || "").trim(),
    priority: Number(data.get("priority")) || 0,
    notes: String(data.get("notes") || "").trim(),
  };
  if (!record.name || !record.city) return;
  const duplicate = duplicateLead(record);
  if (duplicate) { showToast(`«${duplicate.name}» из города ${duplicate.city} уже есть в базе.`, true); return; }
  const lead = createLeadFromInput(record);
  state.leads.unshift(lead);
  saveLeads();
  closeNewLeadModal();
  event.currentTarget.reset();
  $('#newLeadForm [name="city"]').value = "Санкт-Петербург";
  renderList();
  showToast("Лид добавлен.");
  openLead(lead.id);
});

$("#bulkCreate").addEventListener("click", () => {
  const city = $('#newLeadForm [name="bulkCity"]').value.trim();
  const lines = $('#newLeadForm [name="bulkText"]').value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (!city || !lines.length) { showToast("Укажите город и добавьте список компаний.", true); return; }
  downloadBackup();
  if (!window.confirm(`Резервная копия скачана. Добавить ${lines.length} компаний из списка?`)) return;
  let added = 0;
  let skipped = 0;
  lines.forEach((line) => {
    const parsed = parseBulkLine(line);
    const record = { ...parsed, city, status: "Новый", offerGroup: OFFER_GROUPS[0], priority: 0, notes: "" };
    if (!record.name || duplicateLead(record)) { skipped += 1; return; }
    state.leads.unshift(createLeadFromInput(record));
    added += 1;
  });
  saveLeads();
  renderList();
  if (added) $('#newLeadForm [name="bulkText"]').value = "";
  showToast(`Добавлено: ${added}. Пропущено: ${skipped}.`, !added);
});

$("#csvInput").addEventListener("change", async (event) => {
  await prepareImport(event.target.files?.[0]);
  event.target.value = "";
});

$$('[data-close-import]').forEach((button) => button.addEventListener("click", closeImportModal));
$("#importBackup").addEventListener("click", () => { downloadBackup(); $("#importBackupConfirmed").checked = true; $("#confirmImport").disabled = false; });
$("#importBackupConfirmed").addEventListener("change", (event) => { $("#confirmImport").disabled = !event.target.checked; });
$("#confirmImport").addEventListener("click", applyImport);

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    elements.search.focus();
    elements.search.select();
  }
  if (event.key === "Escape") {
    if (!$("#newLeadModal").hidden) closeNewLeadModal();
    else if (!$("#importModal").hidden) closeImportModal();
    else if (!elements.drawer.hidden) closeFilters();
    else elements.sidebar.classList.remove("is-open");
  }
});

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!elements.detail.hidden && state.draft?.demoUrl) setupDetailScene();
  }, 180);
});

window.addEventListener("storage", (event) => {
  if (event.key !== STORAGE_KEY || state.dirty) return;
  try {
    const next = JSON.parse(event.newValue || "[]");
    if (Array.isArray(next)) { state.leads = next.map(normalizeLead); renderList(); }
  } catch (error) { console.warn(error); }
});

window.addEventListener("crm:session-expired", () => { $("#sessionExpired").hidden = false; document.body.style.overflow = "hidden"; });
$("#reloadSession").addEventListener("click", () => window.location.reload());
if (new URLSearchParams(window.location.search).get("state") === "session-expired") window.dispatchEvent(new Event("crm:session-expired"));

$("#todayLabel").textContent = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date());
$('#newLeadForm [name="status"]').innerHTML = options(STATUSES, "Новый");
$('#newLeadForm [name="offerGroup"]').innerHTML = options(OFFER_GROUPS, OFFER_GROUPS[0]);
if (!localStorage.getItem(STORAGE_KEY)) saveLeads();
renderList();

if (loadError) setTimeout(() => showToast(loadError, true), 250);
try {
  const selected = sessionStorage.getItem("legche-selected-lead");
  if (selected && state.leads.some((lead) => lead.id === selected)) openLead(selected);
} catch {}
