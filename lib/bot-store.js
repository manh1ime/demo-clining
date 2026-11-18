export const BOT_STATUSES = {
  new: "🆕 Новая",
  work: "🧹 В работе",
  called: "📞 Связались",
  interested: "💬 Есть интерес",
  client: "🤝 Клиент",
  done: "✅ Закрыта",
  rejected: "❌ Отказ",
};

const PREFIX = "legche:v2";
const redisUrl = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const redisToken = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export const hasRedis = () => Boolean(redisUrl() && redisToken());
const leadKey = (id) => `${PREFIX}:lead:${id}`;
const openKey = `${PREFIX}:leads:open`;
const sequenceKey = `${PREFIX}:leads:sequence`;
const closed = (status) => ["client", "done", "rejected"].includes(status);

export async function redis(...command) {
  if (!hasRedis()) throw new Error("Redis is not configured");
  const response = await fetch(redisUrl(), {
    method: "POST",
    headers: { Authorization: `Bearer ${redisToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(command.map(String)),
    signal: AbortSignal.timeout(8000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.error || !("result" in result)) throw new Error("Redis unavailable");
  return result.result;
}

export const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
export const managerName = (user) => user?.username ? `@${user.username}` : [user?.first_name, user?.last_name].filter(Boolean).join(" ") || "менеджер";

const SAVE_SCRIPT = `-- LEGECHE_SAVE_V2
redis.call('SET',KEYS[1],ARGV[1])
if ARGV[2]=='closed' then redis.call('ZREM',KEYS[2],ARGV[3]) else redis.call('ZADD',KEYS[2],ARGV[4],ARGV[3]) end
return 1`;
const CAS_SCRIPT = `-- LEGECHE_CAS_V2
if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET',KEYS[1],ARGV[2])
if ARGV[3]=='closed' then redis.call('ZREM',KEYS[2],ARGV[4]) else redis.call('ZADD',KEYS[2],ARGV[5],ARGV[4]) end
return 1`;

function storageArgs(lead) {
  return [JSON.stringify(lead), closed(lead.status) ? "closed" : "open", lead.id, Date.parse(lead.createdAt) || Date.now()];
}

export async function saveBotLead(lead) {
  await redis("EVAL", SAVE_SCRIPT, 2, leadKey(lead.id), openKey, ...storageArgs(lead));
  return lead;
}

export async function createBotLead(input) {
  const id = String(await redis("INCR", sequenceKey));
  const now = new Date().toISOString();
  const lead = {
    id,
    status: "new",
    createdAt: now,
    updatedAt: now,
    revision: 0,
    history: [{ at: now, status: "new", by: "сайт", detail: "Заявка создана" }],
    notes: [],
    ...input,
  };
  return saveBotLead(lead);
}

export async function getBotLead(id) {
  if (!/^\d{1,12}$/.test(String(id || ""))) return null;
  const raw = await redis("GET", leadKey(id));
  return raw ? JSON.parse(raw) : null;
}

export async function mutateBotLead(id, mutate) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const raw = await redis("GET", leadKey(id));
    if (!raw) throw new Error("Заявка не найдена");
    const lead = JSON.parse(raw);
    mutate(lead);
    lead.revision = Number(lead.revision || 0) + 1;
    lead.updatedAt = new Date().toISOString();
    const saved = await redis("EVAL", CAS_SCRIPT, 2, leadKey(id), openKey, raw, ...storageArgs(lead));
    if (Number(saved) === 1) return lead;
  }
  throw new Error("Заявку изменяет другой менеджер. Повторите действие.");
}

export async function listBotLeads(filter = "all", userId = "") {
  const ids = await redis("ZREVRANGE", openKey, 0, 99);
  if (!ids?.length) return [];
  const raws = await redis("MGET", ...ids.map(leadKey));
  return raws.filter(Boolean).map(JSON.parse).filter((lead) => {
    if (filter === "new") return lead.status === "new";
    if (filter === "mine") return String(lead.assigneeId || "") === String(userId);
    return true;
  });
}

export function botKeyboard(lead) {
  const id = lead.id;
  const action = (value, text) => ({ text, callback_data: `lead:${value}:${id}` });
  if (lead.status === "new") return { inline_keyboard: [[action("take", "🧹 Взять в работу")], [action("reject", "❌ Отказ")]] };
  if (["client", "done", "rejected"].includes(lead.status)) return { inline_keyboard: [[action("reopen", "↩️ Вернуть в работу")]] };
  const rows = [];
  if (lead.status === "work") rows.push([action("called", "📞 Связались")]);
  if (["work", "called"].includes(lead.status)) rows.push([action("interest", "💬 Есть интерес")]);
  if (["called", "interested"].includes(lead.status)) rows.push([action("client", "🤝 Стал клиентом")]);
  rows.push([action("done", "✅ Закрыть"), action("reject", "❌ Отказ")]);
  return { inline_keyboard: rows };
}

function formatTime(value) {
  return new Date(value).toLocaleString("ru-RU", { timeZone: process.env.DISPLAY_TZ || "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function renderBotLead(lead) {
  const lines = [
    `<b>${lead.demoBrand ? `Тестовая заявка из демо «${escapeHtml(lead.demoBrand)}»` : "Новая заявка с сайта «Легче»"} #${escapeHtml(lead.id)}</b>`,
    `<b>Статус:</b> ${BOT_STATUSES[lead.status] || lead.status}`,
    "",
    `<b>Имя:</b> ${escapeHtml(lead.name)}`,
    `<b>Телефон:</b> <code>${escapeHtml(lead.phone)}</code>`,
    `<b>Уборка:</b> ${escapeHtml(lead.service)}`,
    `<b>Площадь:</b> ${escapeHtml(lead.area)} м²`,
    `<b>Расчёт:</b> ${new Intl.NumberFormat("ru-RU").format(lead.total)} ₽`,
  ];
  if (lead.demoBrand) lines.push("<b>Режим:</b> предварительный показ сайта и Telegram-бота");
  if (lead.extras?.length) lines.push(`<b>Дополнительно:</b> ${escapeHtml(lead.extras.join(", "))}`);
  if (lead.date) lines.push(`<b>Желаемая дата:</b> ${escapeHtml(lead.date)}`);
  if (lead.address) lines.push(`<b>Адрес или район:</b> ${escapeHtml(lead.address)}`);
  if (lead.comment) lines.push(`<b>Комментарий:</b> ${escapeHtml(lead.comment)}`);
  lines.push("", `<i>Получено: ${formatTime(lead.createdAt)}</i>`);
  if (lead.assignee) lines.push(`<b>Ответственный:</b> ${escapeHtml(lead.assignee)}`);
  if (lead.notes?.length) lines.push(`<b>Заметка:</b> ${escapeHtml(lead.notes.at(-1).text)}`);
  const history = (lead.history || []).slice(-4);
  if (history.length > 1) {
    lines.push("", "<i>Последние действия:</i>");
    history.slice(1).forEach((event) => lines.push(`• ${formatTime(event.at)} · ${BOT_STATUSES[event.status] || event.status} · ${escapeHtml(event.by)}`));
  }
  return lines.join("\n");
}
