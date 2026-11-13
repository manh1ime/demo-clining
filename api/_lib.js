// Общие помощники для серверных функций. Файлы с "_" в начале Vercel не публикует как отдельные эндпоинты.

export const STATUSES = {
  new: { label: '🆕 Новая' },
  work: { label: '🧹 В работе' },
  called: { label: '📞 Связались' },
  scheduled: { label: '📅 Согласована' },
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
  if (!r.ok || j.error || !Object.hasOwn(j, 'result')) throw new Error('Redis unavailable')
  return j.result
}

export async function getLead(id) {
  const raw = await redis('GET', `lead:${id}`)
  return raw ? JSON.parse(raw) : null
}

// Atomic record + open-list update. CAS prevents two managers overwriting one another.
const SAVE_LEAD = `-- SAVE_LEAD
redis.call('SET',KEYS[1],ARGV[1])
if ARGV[2]=='closed' then redis.call('ZREM',KEYS[2],ARGV[3]) else redis.call('ZADD',KEYS[2],ARGV[4],ARGV[3]) end
return 1`
const CAS_LEAD = `-- CAS_LEAD
if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET',KEYS[1],ARGV[2])
if ARGV[3]=='closed' then redis.call('ZREM',KEYS[2],ARGV[4]) else redis.call('ZADD',KEYS[2],ARGV[5],ARGV[4]) end
return 1`
const storageArgs = l => [JSON.stringify(l), ['done','cancel'].includes(l.status)?'closed':'open',l.id,Date.parse(l.createdAt)]
export async function saveLead(lead) {
  await redis('EVAL',SAVE_LEAD,2,`lead:${lead.id}`,'leads:open',...storageArgs(lead))
}
export async function mutateLead(id, change) {
  for(let attempt=0;attempt<4;attempt++) {
    const raw=await redis('GET',`lead:${id}`)
    if(!raw)throw new Error('Заявка не найдена')
    const lead=JSON.parse(raw)
    const changed=change(lead)
    if(changed===false)return lead
    lead.revision=Number(lead.revision||0)+1
    if(Number(await redis('EVAL',CAS_LEAD,2,`lead:${id}`,'leads:open',raw,...storageArgs(lead)))===1)return lead
  }
  throw new Error('Заявка меняется другим менеджером. Откройте её заново.')
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
    ...(lead.isTest ? ['🧪 ЖИВОЙ ТЕСТ — не настоящий заказ'] : []),
    '',
    `👤 ${esc(lead.name)}`,
    `📞 ${esc(lead.phone)}`,
    `🧹 ${esc(lead.service)}${lead.area ? `, ${lead.area} м²` : ''}`,
  ]
  if (lead.extras?.length) lines.push(`➕ ${esc(lead.extras.join(', '))}`)
  if (lead.total) lines.push(`💰 ${money(lead.total)} (предварительно)`)
  if (lead.date) lines.push(`📅 Удобная дата: ${fmtDay(lead.date)}`)
  if (lead.comment) lines.push(`💬 ${esc(lead.comment.slice(0,500))}`)
  if (lead.scheduledAt) lines.push(`📅 Согласовано: ${esc(lead.scheduledAt)} (${esc(DISPLAY_TZ)})`)
  if (lead.finalPrice != null) lines.push(`💳 Согласованная цена: ${money(lead.finalPrice)}`)
  if (lead.notes?.length) lines.push('📝 '+esc(lead.notes.slice(-2).map(n=>n.text).join(' / ')))
  if (lead.cancelReason) lines.push('Причина отмены: '+esc(lead.cancelReason))
  if (lead.preview) lines.push(`🔎 Тестовая заявка с примера сайта: /p/${esc(lead.preview)}`)
  lines.push('', `🕒 Создана ${fmtTime(lead.createdAt)}`)
  if (lead.assignee) lines.push(`👷 Ответственный: ${esc(lead.assignee)}`)
  const h = (lead.history || []).slice(-4)
  if (h.length) {
    lines.push('', '<i>История:</i>')
    for (const e of h) lines.push(`• ${fmtTime(e.at)} — ${STATUSES[e.status]?.label || e.status} (${esc(e.by)})${e.detail?' — '+esc(e.detail.slice(0,120)):''}`)
  }
  return lines.join('\n')
}

const btn = (id, status, text) => ({text,callback_data:`${['done','cancel'].includes(status)?'cf':'st'}:${id}:${status}`})
export function keyboard(lead) {
  const id=lead.id
  if(lead.status==='new')return {inline_keyboard:[[btn(id,'work','🧹 Взять в работу')],[btn(id,'cancel','❌ Отмена')]]}
  if(['done','cancel'].includes(lead.status))return {inline_keyboard:[[btn(id,'work','↩️ Вернуть в работу')]]}
  const rows=[]
  if(lead.status==='work')rows.push([btn(id,'called','📞 Связались')])
  rows.push([btn(id,'done','✅ Выполнена'),btn(id,'cancel','❌ Отмена')])
  return {inline_keyboard:rows}
}
