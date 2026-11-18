import { timingSafeEqual } from "node:crypto";

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

async function telegram(method, body = {}) {
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

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!secret || !safeEqual(secret, supplied)) return res.status(401).json({ ok: false });

  try {
    const forwardedHost = req.headers["x-forwarded-host"] || req.headers.host;
    const configured = process.env.PUBLIC_SITE_URL || (forwardedHost ? `https://${forwardedHost}` : "");
    const origin = new URL(configured);
    if (origin.protocol !== "https:") throw new Error("PUBLIC_SITE_URL must use HTTPS");
    const webhookUrl = `${origin.origin}/api/telegram`;

    if (req.body?.action === "check") {
      const [bot, webhook] = await Promise.all([telegram("getMe"), telegram("getWebhookInfo")]);
      return res.status(200).json({ ok: true, botUsername: bot.username, webhook: webhook.url, expected: webhookUrl, matches: webhook.url === webhookUrl, lastError: webhook.last_error_message || null });
    }

    await telegram("setWebhook", {
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ["message", "callback_query", "my_chat_member"],
      drop_pending_updates: false,
    });
    await telegram("setMyCommands", {
      commands: [
        { command: "start", description: "Подключение и доступные команды" },
        { command: "leads", description: "Открытые заявки" },
        { command: "new", description: "Новые заявки" },
        { command: "mine", description: "Мои заявки" },
        { command: "lead", description: "Открыть заявку по номеру" },
        { command: "note", description: "Добавить заметку к заявке" },
        { command: "site", description: "Открыть сайт" },
        { command: "admin", description: "Открыть CRM" },
        { command: "id", description: "Показать ID чата и темы" },
        { command: "test", description: "Проверить отправку сообщений" },
        { command: "help", description: "Доступные команды" },
      ],
    });
    return res.status(200).json({ ok: true, webhook: webhookUrl });
  } catch (error) {
    console.error("Telegram setup failed", error.name || "Error");
    return res.status(502).json({ ok: false, error: "Не удалось настроить webhook" });
  }
}
