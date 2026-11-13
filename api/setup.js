// POST /api/setup with Authorization: Bearer <TELEGRAM_WEBHOOK_SECRET>.
// Prefer running scripts/setup-telegram.mjs locally: secrets never enter a URL.
import { tg, hasRedis, redis } from './_lib.js'
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
    if(req.body?.action==='check'){
      const bot=await tg('getMe');const info=await tg('getWebhookInfo')
      let database=false,managerChat=false
      if(hasRedis()){await redis('GET','__readiness__');database=true}
      if(process.env.TELEGRAM_CHAT_ID){await tg('getChat',{chat_id:process.env.TELEGRAM_CHAT_ID});managerChat=true}
      const expected=origin.origin+'/api/telegram'
      return res.status(200).json({ok:true,botUsername:bot.username||null,database,managerChat,webhookMatches:info.url===expected,webhookHasError:!!info.last_error_message,pending:info.pending_update_count||0,liveTestEnabled:process.env.LIVE_TEST_MODE==='true',adminEnabled:!!process.env.ADMIN_PASSWORD})
    }
    await tg('setWebhook' ,{url:origin.origin+'/api/telegram',secret_token:secret,allowed_updates:['message','callback_query'],drop_pending_updates:false})
    await tg('setMyCommands',{commands:[{command:'leads',description:'Открытые заявки'},{command:'lead',description:'Заявка по номеру'},{command:'new',description:'Новые заявки'},{command:'mine',description:'Мои заявки'},{command:'note',description:'Заметка к заявке'},{command:'price',description:'Согласованная цена'},{command:'schedule',description:'Дата и время уборки'},{command:'cancel',description:'Отмена с причиной'},{command:'help',description:'Команды и порядок работы'},{command:'id',description:'ID чата и менеджера'}]})
    const info=await tg('getWebhookInfo')
    return res.status(200).json({ok:true,webhook:info.url,pending:info.pending_update_count})
  }catch(e){console.error('Telegram setup failed');return res.status(502).json({error:'Не удалось настроить Telegram. Проверьте переменные окружения.'})}
}
