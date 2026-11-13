// POST /api/telegram — webhook бота: кнопки статусов и команды менеджера.
import { tg, hasRedis, redis, getLead, saveLead, renderLead, keyboard, isManagerChat, who, esc, money, fmtTime, STATUSES, LEAD_TITLE } from './_lib.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('ok')
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!secret) return res.status(503).send('not configured')
  if (req.headers['x-telegram-bot-api-secret-token'] !== secret) return res.status(401).send('unauthorized')

  const update = req.body || {}
  try {
    if (update.callback_query) await onCallback(update.callback_query)
    else if (update.message) await onMessage(update.message)
  } catch (e) {
    console.error(e)
  }
  // Всегда отвечаем 200, чтобы Telegram не повторял одно и то же обновление
  return res.status(200).json({ ok: true })
}

const answer = (q, text) => tg('answerCallbackQuery', { callback_query_id: q.id, text }).catch(() => {})

async function onCallback(q) {
  const m = /^st:([^:]+):(\w+)$/.exec(q.data || '')
  if (!m || !q.message) return answer(q)
  if (!isManagerChat(q.message.chat.id)) return answer(q, 'Нет доступа')
  const [, id, status] = m
  if (!STATUSES[status]) return answer(q)

  const by = who(q.from)
  const at = new Date().toISOString()
  const target = { chat_id: q.message.chat.id, message_id: q.message.message_id }

  if (hasRedis()) {
    const lead = await getLead(id)
    if (!lead) return answer(q, 'Заявка не найдена')
    if (lead.status === status) return answer(q, 'Уже в этом статусе')
    lead.status = status
    if (status === 'work' && !lead.assignee) lead.assignee = by
    lead.history.push({ at, status, by })
    await saveLead(lead)
    await tg('editMessageText', {
      ...target,
      text: renderLead(lead),
      parse_mode: 'HTML',
      reply_markup: keyboard(lead),
      link_preview_options: { is_disabled: true },
    })
  } else {
    // Без базы: меняем строку статуса прямо в тексте сообщения
    const lines = (q.message.text || '').split('\n')
    lines[0] = `${LEAD_TITLE} #${id} · ${STATUSES[status].label}`
    lines.push(`• ${fmtTime(at)} — ${STATUSES[status].label} (${by})`)
    await tg('editMessageText', { ...target, text: lines.join('\n'), reply_markup: keyboard({ id, status }) })
  }
  return answer(q, STATUSES[status].label)
}

const reply = (msg, text, extra = {}) =>
  tg('sendMessage', { chat_id: msg.chat.id, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra })

async function onMessage(msg) {
  const text = (msg.text || '').trim()
  const [rawCmd, arg] = text.split(/\s+/)
  const cmd = (rawCmd || '').split('@')[0].toLowerCase()

  if (cmd === '/start' || cmd === '/id') {
    const ok = isManagerChat(msg.chat.id)
    return reply(
      msg,
      `ID этого чата: <code>${msg.chat.id}</code>\n` +
        (ok
          ? 'Чат подключён ✅ Сюда приходят заявки.\n\n/leads — открытые заявки\n/lead 12 — показать заявку №12'
          : 'Чтобы заявки приходили сюда, укажите этот ID в переменной TELEGRAM_CHAT_ID в Vercel и сделайте Redeploy.')
    )
  }

  if (!isManagerChat(msg.chat.id)) return

  if (cmd === '/leads') {
    if (!hasRedis()) return reply(msg, 'Для списка заявок подключите базу Upstash Redis в Vercel.')
    const ids = (await redis('ZRANGE', 'leads:open', 0, 29)) || []
    if (!ids.length) return reply(msg, 'Открытых заявок нет 🎉')
    const leads = (await Promise.all(ids.map(getLead))).filter(Boolean)
    const lines = leads.map(
      (l) => `#${esc(l.id)} · ${STATUSES[l.status].label} · ${esc(l.name)} · ${esc(l.phone)}${l.total ? ' · ' + money(l.total) : ''}`
    )
    return reply(msg, `<b>Открытые заявки (${leads.length}):</b>\n\n${lines.join('\n')}\n\nПодробнее: /lead номер`)
  }

  if (cmd === '/lead') {
    if (!hasRedis()) return reply(msg, 'Для поиска заявок подключите базу Upstash Redis в Vercel.')
    const id = String(arg || '').replace(/\D/g, '')
    if (!id) return reply(msg, 'Укажите номер: /lead 12')
    const lead = await getLead(id)
    if (!lead) return reply(msg, `Заявка #${esc(id)} не найдена`)
    return reply(msg, renderLead(lead), { reply_markup: keyboard(lead) })
  }
}
