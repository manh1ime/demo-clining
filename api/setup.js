// POST /api/setup with Authorization: Bearer <TELEGRAM_WEBHOOK_SECRET>.
// Prefer running scripts/setup-telegram.mjs locally: secrets never enter a URL.
import { tg } from './_lib.js'
import crypto from 'node:crypto'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if(req.method !== 'POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Use POST'})}
  const secret=process.env.TELEGRAM_WEBHOOK_SECRET
  if (!secret) return res.status(503).json({error:'Webhook is not configured'})
  const supplied=String(req.headers.authorization || '').replace(/^Bearer /,'')
  const a=Buffer.from(secret),b=Buffer.from(supplied)
  if(a.length!==b.length || !crypto.timingSafeEqual(a,b))return res.status(401).json({error:'Unauthorized'})
  try {
    const origin=new URL(process.env.PUBLIC_SITE_URL || '')
    if(origin.protocol!=='https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname!=='/')return res.status(400).json({error:'Set PUBLIC_SITE_URL to an HTTPS origin'})
    await tg('setWebhook',{url:origin.origin+'/api/telegram',secret_token:secret,allowed_updates:['message','callback_query'],drop_pending_updates:false})
    await tg('setMyCommands',{commands:[{command:'leads',description:'Открытые заявки'},{command:'lead',description:'Заявка по номеру'},{command:'id',description:'ID чата'}]})
    const info=await tg('getWebhookInfo')
    return res.status(200).json({ok:true,webhook:info.url,pending:info.pending_update_count})
  }catch(e){console.error('Telegram setup failed');return res.status(502).json({error:'Не удалось настроить Telegram. Проверьте переменные окружения.'})}
}
