// GET /api/setup?secret=... — один раз регистрирует webhook бота и список команд.
import { tg } from './_lib.js'

export default async function handler(req, res) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!secret) return res.status(500).json({ error: 'Сначала задайте TELEGRAM_WEBHOOK_SECRET в Vercel' })
  if (req.query?.secret !== secret) return res.status(401).json({ error: 'Неверный secret' })

  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host
    const url = `https://${host}/api/telegram`
    await tg('setWebhook', {
      url,
      secret_token: secret,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true,
    })
    await tg('setMyCommands', {
      commands: [
        { command: 'leads', description: 'Открытые заявки' },
        { command: 'lead', description: 'Показать заявку по номеру' },
        { command: 'id', description: 'Узнать ID чата' },
      ],
    })
    const info = await tg('getWebhookInfo')
    return res.status(200).json({ ok: true, webhook: info.url, pending: info.pending_update_count })
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) })
  }
}
