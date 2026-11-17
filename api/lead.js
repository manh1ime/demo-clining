const SERVICE_NAMES = {
  regular: "Поддерживающая уборка",
  deep: "Генеральная уборка",
  renovation: "Уборка после ремонта",
};

const RATES = { regular: 70, deep: 130, renovation: 170 };
const EXTRA_PRICES = { Окна: 1200, Духовка: 700, Холодильник: 600, Балкон: 800 };

function text(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function escapeHtml(value) {
  return text(value, 2000)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function parseBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : req.body;
  return raw ? JSON.parse(raw) : {};
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Метод не поддерживается" });
  }

  if (Number(req.headers["content-length"] || 0) > 16_000) {
    return res.status(413).json({ ok: false, error: "Слишком большой запрос" });
  }

  let body;
  try {
    body = parseBody(req);
  } catch {
    return res.status(400).json({ ok: false, error: "Некорректный формат данных" });
  }

  // Honeypot fields receive a neutral response without contacting Telegram.
  if (text(body.website, 200)) return res.status(200).json({ ok: true });

  const name = text(body.name, 60);
  const phone = text(body.phone, 25);
  const phoneDigits = phone.replace(/\D/g, "");
  const service = SERVICE_NAMES[body.service] ? body.service : "regular";
  const area = Math.min(250, Math.max(20, Math.round(Number(body.area) || 0)));
  const address = text(body.address, 120);
  const comment = text(body.comment, 1000);
  const requestedDate = text(body.date, 10);
  const startedAt = Number(body.startedAt) || 0;
  const elapsed = Date.now() - startedAt;

  if (name.length < 2 || phoneDigits.length < 10 || phoneDigits.length > 15 || !Number.isFinite(area)) {
    return res.status(400).json({ ok: false, error: "Проверьте имя, телефон и площадь" });
  }

  if (startedAt && (elapsed < 1200 || elapsed > 7_200_000)) {
    return res.status(400).json({ ok: false, error: "Обновите страницу и повторите отправку" });
  }

  const extras = Array.isArray(body.extras)
    ? body.extras
      .map((item) => text(item?.title, 40))
      .filter((title, index, values) => EXTRA_PRICES[title] && values.indexOf(title) === index)
    : [];
  const calculatedTotal = Math.max(2500, area * RATES[service])
    + extras.reduce((sum, title) => sum + EXTRA_PRICES[title], 0);

  const lines = [
    "<b>Новая заявка с сайта «Легче»</b>",
    "",
    `<b>Имя:</b> ${escapeHtml(name)}`,
    `<b>Телефон:</b> <code>${escapeHtml(phone)}</code>`,
    `<b>Уборка:</b> ${escapeHtml(SERVICE_NAMES[service])}`,
    `<b>Площадь:</b> ${area} м²`,
    `<b>Расчёт:</b> ${new Intl.NumberFormat("ru-RU").format(calculatedTotal)} ₽`,
  ];

  if (extras.length) lines.push(`<b>Дополнительно:</b> ${extras.map(escapeHtml).join(", ")}`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) lines.push(`<b>Желаемая дата:</b> ${escapeHtml(requestedDate)}`);
  if (address) lines.push(`<b>Адрес или район:</b> ${escapeHtml(address)}`);
  if (comment) lines.push(`<b>Комментарий:</b> ${escapeHtml(comment)}`);
  lines.push("", `<i>Получено: ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Moscow" }).format(new Date())}</i>`);

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.error("Telegram environment variables are not configured");
    return res.status(503).json({ ok: false, error: "Приём заявок временно недоступен" });
  }

  const telegramBody = {
    chat_id: chatId,
    text: lines.join("\n"),
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (process.env.TELEGRAM_THREAD_ID) telegramBody.message_thread_id = process.env.TELEGRAM_THREAD_ID;

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(telegramBody),
      signal: AbortSignal.timeout(8000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      console.error("Telegram rejected the lead message", response.status, result.description || "Unknown error");
      return res.status(502).json({ ok: false, error: "Не удалось передать заявку менеджеру" });
    }
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Telegram request failed", error.name || "Error");
    return res.status(502).json({ ok: false, error: "Не удалось передать заявку менеджеру" });
  }
}
