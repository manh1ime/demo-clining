function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

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

function reply(message, text) {
  const body = {
    chat_id: message.chat.id,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (message.message_thread_id) body.message_thread_id = message.message_thread_id;
  return telegram("sendMessage", body);
}

async function processMessage(message) {
  const raw = String(message.text || "").trim().split(/\s+/)[0];
  const command = raw.split("@")[0].toLowerCase();
  const botName = escapeHtml(message.chat.title || "этого чата");

  if (command === "/id") {
    const topic = message.message_thread_id ? `\nID темы: <code>${message.message_thread_id}</code>` : "";
    return reply(message, `<b>${botName}</b>\nID чата: <code>${message.chat.id}</code>${topic}\nВаш Telegram ID: <code>${message.from?.id || "не определён"}</code>`);
  }
  if (command === "/test") {
    return reply(message, "✅ Бот может отправлять сообщения в этот чат. Теперь укажите этот ID в <code>TELEGRAM_CHAT_ID</code>.");
  }
  if (command === "/start" || command === "/help") {
    return reply(message, "<b>Бот заявок подключён</b>\n\n/id — показать ID чата и темы\n/test — проверить отправку сообщений\n/help — показать команды");
  }
  if (command.startsWith("/")) return reply(message, "Команда не найдена. Используйте /id, /test или /help.");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ ok: false, error: "TELEGRAM_WEBHOOK_SECRET is not configured" });
  if (req.headers["x-telegram-bot-api-secret-token"] !== secret) return res.status(401).json({ ok: false });

  try {
    if (req.body?.message) await processMessage(req.body.message);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Telegram command failed", error.name || "Error");
    return res.status(503).json({ ok: false });
  }
}
