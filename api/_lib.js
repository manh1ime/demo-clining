// Общие помощники для серверных функций. Файлы с "_" в начале Vercel не публикует как отдельные эндпоинты.

export const STATUSES = {
  new: { label: '🆕 Новая' },
  work: { label: '🧹 В работе' },
  called: { label: '📞 Связались' },
  done: { label: '✅ Выполнена' },
  cancel: { label: '❌ Отменена' },
}

const DISPLAY_TZ = process.env.DISPLAY_TZ || 'Europe/Moscow'
// Заголовок сообщения о заявке в Telegram, например «🧽 Заявка» или «Новая заявка с сайта»
export const LEAD_TITLE = process.env.LEAD_TITLE || '🧽 Заявка'

// ---------- Telegram ----------
export async function tg(method, body = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set')
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description || r.status}`)
  return j.result
}

export const isManagerChat = (chatId) =>
  Boolean(process.env.TELEGRAM_CHAT_ID) && String(chatId) === String(process.env.TELEGRAM_CHAT_ID)

export const who = (u) =>
  !u ? 'менеджер' : u.username ? '@' + u.username : [u.first_name, u.last_name].filter(Boolean).join(' ') || 'менеджер'

// ---------- Upstash Redis (REST, без зависимостей) ----------
const redisUrl = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL
const redisToken = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
export const hasRedis = () => Boolean(redisUrl() && redisToken())

export async function redis(...cmd) {
  const r = await fetch(redisUrl(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${redisToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd.map(String)),
  })
  const j = await r.json().catch(() => ({}))
  if (j.error) throw new Error('Redis: ' + j.error)
  return j.result
}

export async function getLead(id) {
  const raw = await redis('GET', `lead:${id}`)
  return raw ? JSON.parse(raw) : null
}

export async function saveLead(lead) {
  await redis('SET', `lead:${lead.id}`, JSON.stringify(lead))
  if (lead.status === 'done' || lead.status === 'cancel') await redis('ZREM', 'leads:open', lead.id)
  else await redis('ZADD', 'leads:open', Date.parse(lead.createdAt), lead.id)
}

// ---------- Форматирование ----------
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export const money = (n) => new Intl.NumberFormat('ru-RU').format(n) + ' ₽'
export const fmtTime = (iso) =>
  new Date(iso).toLocaleString('ru-RU', { timeZone: DISPLAY_TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const fmtDay = (d) => (d ? d.split('-').reverse().join('.') : '')

export function renderLead(lead) {
  const s = STATUSES[lead.status] || STATUSES.new
  const lines = [
    `<b>${esc(LEAD_TITLE)} #${esc(lead.id)}</b> · ${s.label}`,
    '',
    `👤 ${esc(lead.name)}`,
    `📞 ${esc(lead.phone)}`,
    `🧹 ${esc(lead.service)}${lead.area ? `, ${lead.area} м²` : ''}`,
  ]
  if (lead.extras?.length) lines.push(`➕ ${esc(lead.extras.join(', '))}`)
  if (lead.total) lines.push(`💰 ${money(lead.total)} (предварительно)`)
  if (lead.date) lines.push(`📅 Удобная дата: ${fmtDay(lead.date)}`)
  if (lead.comment) lines.push(`💬 ${esc(lead.comment)}`)
  lines.push('', `🕒 Создана ${fmtTime(lead.createdAt)}`)
  if (lead.assignee) lines.push(`👷 Ответственный: ${esc(lead.assignee)}`)
  const h = (lead.history || []).slice(-6)
  if (h.length) {
    lines.push('', '<i>История:</i>')
    for (const e of h) lines.push(`• ${fmtTime(e.at)} — ${STATUSES[e.status]?.label || e.status} (${esc(e.by)})`)
  }
  return lines.join('\n')
}

const btn = (id, status, text) => ({ text, callback_data: `st:${id}:${status}` })

export function keyboard(lead) {
  const id = lead.id
  switch (lead.status) {
    case 'new':
      return { inline_keyboard: [[btn(id, 'work', '🧹 Взять в работу')], [btn(id, 'cancel', '❌ Отказ')]] }
    case 'work':
      return { inline_keyboard: [[btn(id, 'called', '📞 Связались'), btn(id, 'done', '✅ Выполнена')], [btn(id, 'cancel', '❌ Отмена')]] }
    case 'called':
      return { inline_keyboard: [[btn(id, 'done', '✅ Выполнена')], [btn(id, 'cancel', '❌ Отмена')]] }
    default:
      return { inline_keyboard: [[btn(id, 'work', '↩️ Вернуть в работу')]] }
  }
}
