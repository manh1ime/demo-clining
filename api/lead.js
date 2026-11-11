// POST /api/lead — принимает заявку с сайта и отправляет её менеджеру в Telegram.
import { tg, hasRedis, redis, saveLead, renderLead, keyboard } from './_lib.js'

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
const cleanText = (v, max) => String(v ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max)
const num = (v, min, max) => Math.min(Math.max(Math.round(Number(v) || 0), min), max)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let b = req.body
  if (typeof b === 'string') {
    try { b = JSON.parse(b) } catch { b = {} }
  }
  b = b || {}

  // Honeypot: невидимое поле, которое заполняют только боты
  if (b.website) return res.status(200).json({ ok: true, id: '—' })

  const name = clean(b.name, 60)
  const phone = clean(b.phone, 25)
  const digits = phone.replace(/\D/g, '')
  if (!name) return res.status(400).json({ error: 'Введите имя' })
  if (digits.length < 10 || digits.length > 15 || !/^[+\d\s()\-]+$/.test(phone))
    return res.status(400).json({ error: 'Введите телефон: от 10 до 15 цифр' })

  const lead = {
    id: null,
    status: 'new',
    name,
    phone,
    date: /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : '',
    comment: cleanText(b.comment, 1000),
    service: clean(b.service, 80) || 'Уборка',
    area: num(b.area, 0, 2000),
    extras: Array.isArray(b.extras) ? b.extras.slice(0, 15).map((x) => clean(x, 60)).filter(Boolean) : [],
    total: num(b.total, 0, 10_000_000),
    preview: /^[a-z0-9-]{2,60}$/.test(b.preview || '') ? b.preview : '',
    createdAt: new Date().toISOString(),
    assignee: null,
    history: [],
  }

  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!chatId || !process.env.TELEGRAM_BOT_TOKEN)
    return res.status(500).json({ error: 'Приём заявок ещё не настроен' })

  try {
    if (hasRedis()) {
      // Простой антиспам: не больше 5 заявок с одного IP за 10 минут
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown'
      const key = `rl:${ip}`
      const count = Number(await redis('INCR', key))
      if (count === 1) await redis('EXPIRE', key, 600)
      if (count > 5) return res.status(429).json({ error: 'Слишком много заявок. Попробуйте через несколько минут.' })
      lead.id = String(await redis('INCR', 'lead:seq'))
    } else {
      lead.id = Date.now().toString(36).toUpperCase()
    }

    const msg = await tg('sendMessage', {
      chat_id: chatId,
      text: renderLead(lead),
      parse_mode: 'HTML',
      reply_markup: keyboard(lead),
      link_preview_options: { is_disabled: true },
    })
    lead.messageId = msg.message_id
    if (hasRedis()) await saveLead(lead)
    if (hasRedis() && lead.preview) await redis('HINCRBY', 'pvleads', lead.preview, 1)

    return res.status(200).json({ ok: true, id: lead.id })
  } catch (e) {
    console.error(e)
    return res.status(502).json({ error: 'Не удалось отправить заявку. Попробуйте чуть позже.' })
  }
}
