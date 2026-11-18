import { hasAdminSession } from "../lib/admin-auth.js";
import { getProspectSnapshot, hasRedis, saveProspectSnapshot } from "../lib/prospect-store.js";

const STATUSES = new Set(["Новый", "Оффер отправлен", "Ответил", "Есть интерес", "Клиент", "Отказ"]);
const GROUPS = new Set(["Новый сайт / первая квалификация", "Сайт есть / интеграция", "Уточнить профиль", "Точечная доработка", "Резерв текущего продукта"]);

class UserError extends Error {}
const text = (value, max = 500) => String(value ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, max);
const number = (value, min = 0, max = 1_000_000) => Math.min(max, Math.max(min, Number(value) || 0));
const date = (value) => Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : "";

function sameOrigin(req) {
  if (req.headers["x-requested-with"] !== "legche-admin") return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === String(req.headers.host); } catch { return false; }
}

function normalizeChannelMeta(source) {
  const result = {};
  for (const key of ["phone", "whatsapp", "telegram", "max", "vk", "email"]) {
    result[key] = { confirmed: Boolean(source?.[key]?.confirmed), used: Boolean(source?.[key]?.used) };
  }
  return result;
}

function normalizeLead(input) {
  const id = text(input.id, 80);
  if (!/^[A-Za-z0-9-]{2,80}$/.test(id)) throw new UserError("Некорректный ID лида");
  const name = text(input.name, 120);
  if (!name) throw new UserError("Не указано название компании");
  const now = new Date().toISOString();
  const history = Array.isArray(input.history) ? input.history.slice(-100).map((event) => ({
    id: text(event.id, 80), title: text(event.title, 160), detail: text(event.detail, 1000), at: date(event.at) || now, type: text(event.type, 30),
  })) : [];
  return {
    id,
    sourceFirmId: text(input.sourceFirmId, 120),
    name,
    city: text(input.city, 80),
    status: STATUSES.has(input.status) ? input.status : "Новый",
    offerGroup: GROUPS.has(input.offerGroup) ? input.offerGroup : "Уточнить профиль",
    offerGroupCode: text(input.offerGroupCode, 40),
    priority: Math.round(number(input.priority, 0, 1000)),
    priorityReason: text(input.priorityReason, 800),
    nextStep: text(input.nextStep, 1000),
    mainQuestion: text(input.mainQuestion, 1500),
    factBasis: text(input.factBasis, 2000),
    whatToOffer: text(input.whatToOffer, 2000),
    demoCondition: text(input.demoCondition, 2000),
    followUpAt: /^\d{4}-\d{2}-\d{2}$/.test(input.followUpAt || "") ? input.followUpAt : "",
    notes: text(input.notes, 8000),
    description: text(input.description, 2000),
    source: text(input.source, 300),
    sourceCardUrl: text(input.sourceCardUrl, 1000),
    otherLinks: Array.isArray(input.otherLinks) ? input.otherLinks.slice(0, 30).map((value) => text(value, 1000)).filter(Boolean) : [],
    address: text(input.address, 300),
    hours: text(input.hours, 160),
    createdAt: date(input.createdAt) || now,
    updatedAt: date(input.updatedAt) || now,
    lastActionAt: date(input.lastActionAt) || now,
    contactName: text(input.contactName, 120),
    phone: text(input.phone, 40),
    email: text(input.email, 160),
    whatsapp: text(input.whatsapp, 160),
    telegram: text(input.telegram, 300),
    max: text(input.max, 300),
    vk: text(input.vk, 1000),
    map2gis: text(input.map2gis, 1000),
    yandexMaps: text(input.yandexMaps, 1000),
    website: text(input.website, 1000),
    channelMeta: normalizeChannelMeta(input.channelMeta),
    demoUrl: text(input.demoUrl, 2000),
    demoCreatedAt: date(input.demoCreatedAt),
    demoViews: Math.round(number(input.demoViews, 0, 10_000_000)),
    demoLastViewAt: date(input.demoLastViewAt),
    demoApplications: Math.round(number(input.demoApplications, 0, 10_000_000)),
    demoLastApplicationAt: date(input.demoLastApplicationAt),
    demoColor: /^#[0-9a-f]{6}$/i.test(input.demoColor || "") ? input.demoColor.toLowerCase() : "#5b72ff",
    demoLogoText: text(input.demoLogoText, 80),
    demoModelName: text(input.demoModelName, 100),
    demoTariffs: text(input.demoTariffs, 2000),
    demoRates: {
      regular: Math.round(number(input.demoRates?.regular, 20, 1000)),
      deep: Math.round(number(input.demoRates?.deep, 20, 1000)),
      renovation: Math.round(number(input.demoRates?.renovation, 20, 1000)),
    },
    demoStatus: ["Не создано", "Черновик", "Готово", "Отправлено"].includes(input.demoStatus) ? input.demoStatus : "Не создано",
    message: text(input.message, 5000),
    messageTemplate: text(input.messageTemplate, 80),
    history,
    sourceRecord: {
      format: text(input.sourceRecord?.format, 80), group: text(input.sourceRecord?.group, 40), status: text(input.sourceRecord?.status, 40), sourceIndex: Math.round(number(input.sourceRecord?.sourceIndex, -1, 1_000_000)),
    },
  };
}

function bodyOf(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  return req.body ? JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString("utf8") : req.body) : {};
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ ok: false });
  if (!hasAdminSession(req)) return res.status(401).json({ ok: false, error: "Сессия закончилась" });
  if (!sameOrigin(req)) return res.status(403).json({ ok: false, error: "Запрос запрещён" });
  if (!hasRedis()) return res.status(503).json({ ok: false, error: "Подключите Upstash Redis" });

  try {
    if (req.method === "GET") {
      const snapshot = await getProspectSnapshot(Number(req.query?.revision ?? -1));
      return res.status(200).json({ ok: true, ...snapshot });
    }
    if (Number(req.headers["content-length"] || 0) > 3_000_000) return res.status(413).json({ ok: false, error: "База слишком большая" });
    const body = bodyOf(req);
    if (body.action !== "saveSnapshot" || !Array.isArray(body.items) || body.items.length > 500) throw new UserError("Некорректный формат базы");
    const ids = new Set();
    const items = body.items.map((item) => {
      const normalized = normalizeLead(item);
      if (ids.has(normalized.id)) throw new UserError(`Повторяющийся ID: ${normalized.id}`);
      ids.add(normalized.id);
      return normalized;
    });
    const result = await saveProspectSnapshot(items, Number(body.revision) || 0);
    if (!result.saved) return res.status(409).json({ ok: false, error: "База изменилась на другом устройстве", revision: result.revision });
    return res.status(200).json({ ok: true, revision: result.revision });
  } catch (error) {
    if (error instanceof UserError || error instanceof SyntaxError) return res.status(400).json({ ok: false, error: error.message });
    console.error("Admin lead sync failed", error.name || "Error");
    return res.status(500).json({ ok: false, error: "Не удалось синхронизировать базу" });
  }
}
