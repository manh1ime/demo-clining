import { BOT_STATUSES, botKeyboard, escapeHtml, getBotLead, hasRedis, listBotLeads, managerName, mutateBotLead, renderBotLead } from "../lib/bot-store.js";

class UserError extends Error {}

async function telegram(method, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.description || `Telegram ${response.status}`);
  return result.result;
}

function reply(message, text, extra = {}) {
  const body = { chat_id: message.chat.id, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra };
  if (message.message_thread_id) body.message_thread_id = message.message_thread_id;
  return telegram("sendMessage", body);
}

const answer = (query, text = "") => telegram("answerCallbackQuery", { callback_query_id: query.id, text }).catch(() => {});
const managerChat = (chatId) => Boolean(process.env.TELEGRAM_CHAT_ID) && String(chatId) === String(process.env.TELEGRAM_CHAT_ID);
function managerAllowed(user) {
  const ids = String(process.env.TELEGRAM_MANAGER_IDS || "").split(",").map((value) => value.trim()).filter(Boolean);
  return !ids.length || ids.includes(String(user?.id));
}
const allowed = (chatId, user) => managerChat(chatId) && managerAllowed(user);

const HELP = `<b>Управление заявками</b>

/leads — открытые заявки
/new — только новые
/mine — мои заявки
/lead 12 — открыть заявку
/note 12 текст — добавить заметку
/id — ID чата и темы
/test — проверка бота
/help — список команд

Статусы меняются кнопками под заявкой. Открытие карточки или чата само по себе не меняет статус.`;

const BOT_COMMANDS = [
  { command: "start", description: "Подключение и доступные команды" },
  { command: "leads", description: "Открытые заявки" },
  { command: "new", description: "Новые заявки" },
  { command: "mine", description: "Мои заявки" },
  { command: "lead", description: "Открыть заявку по номеру" },
  { command: "note", description: "Добавить заметку" },
  { command: "id", description: "ID чата и темы" },
  { command: "test", description: "Проверить бота" },
  { command: "help", description: "Доступные команды" },
];

async function refreshBotConfiguration() {
  await telegram("setMyCommands", { commands: BOT_COMMANDS });
  const origin = String(process.env.PUBLIC_SITE_URL || "").replace(/\/$/, "");
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (origin && secret) await telegram("setWebhook", { url: `${origin}/api/telegram`, secret_token: secret, allowed_updates: ["message", "callback_query", "my_chat_member"], drop_pending_updates: false });
}

function requireRedis() {
  if (!hasRedis()) throw new UserError("Для управления заявками подключите Upstash Redis в Vercel. Уведомления продолжат приходить без базы.");
}

function requireOwner(lead, user) {
  if (!lead.assigneeId) throw new UserError("Сначала нажмите «Взять в работу».");
  if (String(lead.assigneeId) !== String(user.id)) throw new UserError(`Заявку уже ведёт ${lead.assignee || "другой менеджер"}.`);
}

function addHistory(lead, user, detail) {
  lead.history ||= [];
  lead.history.push({ at: new Date().toISOString(), status: lead.status, by: managerName(user), detail });
  lead.history = lead.history.slice(-40);
}

async function changeLead(id, user, action, note = "") {
  return mutateBotLead(id, (lead) => {
    if (action === "take" || action === "reopen") {
      if (lead.assigneeId && String(lead.assigneeId) !== String(user.id) && !["client", "done", "rejected"].includes(lead.status)) requireOwner(lead, user);
      lead.status = "work";
      lead.assigneeId = String(user.id);
      lead.assignee = managerName(user);
      addHistory(lead, user, action === "reopen" ? "Возвращена в работу" : "Взята в работу");
      return;
    }
    requireOwner(lead, user);
    if (action === "called") { lead.status = "called"; addHistory(lead, user, "Связались с клиентом"); return; }
    if (action === "interest") { lead.status = "interested"; addHistory(lead, user, "Клиент проявил интерес"); return; }
    if (action === "client") { lead.status = "client"; addHistory(lead, user, "Переведена в клиенты"); return; }
    if (action === "done") { lead.status = "done"; addHistory(lead, user, "Заявка закрыта"); return; }
    if (action === "reject") { lead.status = "rejected"; addHistory(lead, user, "Получен отказ"); return; }
    if (action === "note") {
      lead.notes ||= [];
      lead.notes.push({ text: note.slice(0, 300), at: new Date().toISOString(), by: managerName(user) });
      lead.notes = lead.notes.slice(-30);
      addHistory(lead, user, "Добавлена заметка");
      return;
    }
    throw new UserError("Неизвестное действие.");
  });
}

async function editCard(query, lead) {
  return telegram("editMessageText", {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    text: renderBotLead(lead),
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: botKeyboard(lead),
  }).catch((error) => {
    if (!String(error.message).includes("message is not modified")) throw error;
  });
}

async function editCardById(chatId, messageId, lead) {
  return telegram("editMessageText", { chat_id: chatId, message_id: Number(messageId), text: renderBotLead(lead), parse_mode: "HTML", disable_web_page_preview: true, reply_markup: botKeyboard(lead) });
}

async function processCallback(query) {
  if (!query.message || !allowed(query.message.chat.id, query.from)) return answer(query, "Нет доступа");
  requireRedis();
  const [prefix, action, id, originalMessageId] = String(query.data || "").split(":");
  if (prefix !== "lead" || !/^\d{1,12}$/.test(id || "")) return answer(query, "Кнопка устарела");

  if (["done", "reject"].includes(action)) {
    return reply(query.message, action === "done" ? `Закрыть заявку #${id}?` : `Отметить отказ по заявке #${id}?`, {
      reply_markup: { inline_keyboard: [[{ text: "Подтвердить", callback_data: `lead:confirm_${action}:${id}:${query.message.message_id}` }], [{ text: "Отмена", callback_data: `lead:cancel:${id}` }]] },
    }).then(() => answer(query, "Нужно подтверждение"));
  }
  if (action === "cancel") {
    await telegram("editMessageText", { chat_id: query.message.chat.id, message_id: query.message.message_id, text: "Без изменений." }).catch(() => {});
    return answer(query, "Без изменений");
  }
  const finalAction = action.startsWith("confirm_") ? action.slice(8) : action;
  const updated = await changeLead(id, query.from, finalAction);
  if (action.startsWith("confirm_") && originalMessageId) {
    await editCardById(query.message.chat.id, originalMessageId, updated);
    await telegram("editMessageText", { chat_id: query.message.chat.id, message_id: query.message.message_id, text: `${BOT_STATUSES[updated.status]} · заявка #${id}` }).catch(() => {});
  }
  else if (!action.startsWith("confirm_")) await editCard(query, updated);
  await answer(query, BOT_STATUSES[updated.status] || "Готово");
}

async function listLeads(message, user, filter) {
  const leads = await listBotLeads(filter, user.id);
  const title = filter === "new" ? "Новые заявки" : filter === "mine" ? "Мои заявки" : "Открытые заявки";
  const rows = leads.slice(0, 20).map((lead) => `#${escapeHtml(lead.id)} · ${BOT_STATUSES[lead.status]} · ${escapeHtml(lead.name)}\n/lead ${escapeHtml(lead.id)}`);
  return reply(message, `<b>${title}</b> · ${leads.length}\n\n${rows.join("\n\n") || "Заявок нет."}`);
}

async function processMessage(message) {
  const text = String(message.text || "").trim();
  const [raw, id, ...rest] = text.split(/\s+/);
  const command = String(raw || "").split("@")[0].toLowerCase();
  const chatTitle = escapeHtml(message.chat.title || "этого чата");

  if (command === "/id") {
    const topic = message.message_thread_id ? `\nID темы: <code>${message.message_thread_id}</code>` : "";
    return reply(message, `<b>${chatTitle}</b>\nID чата: <code>${message.chat.id}</code>${topic}\nВаш Telegram ID: <code>${message.from?.id || "не определён"}</code>`);
  }
  if (command === "/test") return reply(message, "✅ Бот может отправлять сообщения в этот чат.");
  if (command === "/start") {
    await refreshBotConfiguration().catch((error) => console.error("Bot command refresh failed", error.name || "Error"));
    return reply(message, allowed(message.chat.id, message.from) ? HELP : "<b>Бот заявок подключён</b>\n\n/id — показать ID чата и темы\n/test — проверить отправку\n/help — показать команды");
  }
  if (command === "/help") return reply(message, allowed(message.chat.id, message.from) ? HELP : "<b>Бот заявок подключён</b>\n\n/id — показать ID чата и темы\n/test — проверить отправку\n/help — показать команды");
  if (!command.startsWith("/")) return;
  if (!allowed(message.chat.id, message.from)) return reply(message, "Управление заявками доступно только в настроенной группе менеджеров.");
  requireRedis();
  if (command === "/leads") return listLeads(message, message.from, "all");
  if (command === "/new") return listLeads(message, message.from, "new");
  if (command === "/mine") return listLeads(message, message.from, "mine");
  if (!/^\d{1,12}$/.test(id || "")) throw new UserError("Укажите номер заявки, например /lead 12.");
  if (command === "/lead") {
    const lead = await getBotLead(id);
    if (!lead) throw new UserError("Заявка не найдена.");
    return reply(message, renderBotLead(lead), { reply_markup: botKeyboard(lead) });
  }
  if (command === "/note") {
    const note = rest.join(" ").trim();
    if (!note) throw new UserError("Добавьте текст заметки: /note 12 перезвонить завтра.");
    const lead = await changeLead(id, message.from, "note", note);
    return reply(message, `Заметка добавлена в заявку #${lead.id}.`);
  }
  return reply(message, "Команда не найдена. Используйте /help.");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ ok: false, error: "TELEGRAM_WEBHOOK_SECRET is not configured" });
  if (req.headers["x-telegram-bot-api-secret-token"] !== secret) return res.status(401).json({ ok: false });
  try {
    if (req.body?.callback_query) await processCallback(req.body.callback_query);
    else if (req.body?.message) await processMessage(req.body.message);
    return res.status(200).json({ ok: true });
  } catch (error) {
    if (error instanceof UserError) {
      if (req.body?.callback_query) await answer(req.body.callback_query, error.message);
      else if (req.body?.message) await reply(req.body.message, escapeHtml(error.message));
      return res.status(200).json({ ok: true });
    }
    console.error("Telegram command failed", error.name || "Error");
    return res.status(503).json({ ok: false });
  }
}
