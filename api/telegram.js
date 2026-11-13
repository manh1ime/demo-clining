// Manager bot: no client auto-messages, payments or automatic slot booking.
import {tg,hasRedis,redis,getLead,mutateLead,renderLead,keyboard,isManagerChat,who,esc,STATUSES} from './_lib.js'

class UserError extends Error {}
const allowedUser = user => {
  const ids=String(process.env.TELEGRAM_MANAGER_IDS||'').split(',').map(x=>x.trim()).filter(Boolean)
  return !ids.length || ids.includes(String(user?.id))
}
const allowed = (chat,user) => isManagerChat(chat) && allowedUser(user)
const HELP='<b>Управление заявками</b>\n\n/leads — открытые, по 10 на страницу\n/new — новые\n/mine — мои открытые\n/lead 12 — карточка №12\n/note 12 текст — заметка\n/price 12 11600 — согласованная цена, ₽\n/schedule 12 2026-12-01 10:00 — согласованное время\n/cancel 12 причина — отмена с подтверждением\n/id — ID чата\n/help — помощь\n\nСначала возьмите заявку в работу кнопкой. Расчёт предварительный; время и цену подтверждает менеджер. Кнопки не звонят клиенту и не отправляют ему сообщения.'
const answer=(q,text)=>tg('answerCallbackQuery',{callback_query_id:q.id,text}).catch(()=>{})
const reply=(msg,text,extra={})=>tg('sendMessage',{chat_id:msg.chat.id,text,parse_mode:'HTML',link_preview_options:{is_disabled:true},...extra})
const eventId=u=>Number.isSafeInteger(u.update_id)?'u:'+u.update_id:u.callback_query?'c:'+u.callback_query.id:'m:'+u.message?.chat?.id+':'+u.message?.message_id
const idPattern=/^[A-Za-z0-9-]{1,40}$/
function own(lead,user){if(lead.assigneeId && String(lead.assigneeId)!==String(user.id))throw new UserError('Заявку уже ведёт другой менеджер.')}
function active(lead){if(['done','cancel'].includes(lead.status))throw new UserError('Заявка закрыта. Сначала верните её в работу.')}
function requireClaim(lead,user){own(lead,user);active(lead);if(!lead.assigneeId)throw new UserError('Сначала нажмите «Взять в работу».')}
async function change(id,user,event,mutate){
 if(!idPattern.test(id))throw new UserError('Некорректный номер заявки')
 if(!await getLead(id))throw new UserError('Заявка не найдена')
 return mutateLead(id,lead=>{
  lead.recentActions ||= []
  if(lead.recentActions.includes(event))return false
  const detail=mutate(lead)
  lead.history ||= []
  lead.history.push({at:new Date().toISOString(),status:lead.status,by:who(user),detail})
  lead.recentActions=[...lead.recentActions,event].slice(-40)
 })
}
async function card(msg,lead){return reply(msg,renderLead(lead),{reply_markup:keyboard(lead)})}
async function redraw(q,lead){
 const original=q.message.message_id
 // Keep the original notification current even when a confirmation lives in another message.
 const ids=[...new Set([lead.messageId,original].filter(Boolean))]
 for(const id of ids){
  try{await tg('editMessageText',{chat_id:q.message.chat.id,message_id:id,text:renderLead(lead),parse_mode:'HTML',reply_markup:keyboard(lead),link_preview_options:{is_disabled:true}})}
  catch(e){if(!/message is not modified/.test(e.message))throw e}
 }
}
function confirmMarkup(lead,status){return {inline_keyboard:[[{text:status==='done'?'✅ Да, выполнена':'❌ Да, отменить',callback_data:`ok:${lead.id}:${status}:${lead.revision||0}`}],[{text:'Оставить без изменений',callback_data:`back:${lead.id}`}]]}}
async function confirmation(msg,lead,status,reason){
 return reply(msg,`<b>${status==='done'?'Закрыть как выполненную':'Отменить'} заявку #${esc(lead.id)}?</b>\n${reason?'Причина: '+esc(reason):'Статус изменится только после подтверждения.'}`,{reply_markup:confirmMarkup(lead,status)})
}
function validSchedule(day,time){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))return false
 const d=new Date(day+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==day)return false
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:process.env.DISPLAY_TZ||'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(p=>[p.type,p.value]))
 return day+' '+time >= `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
}
async function onCallback(q,event){
 if(!q.message||!allowed(q.message.chat.id,q.from))return answer(q,'Нет доступа')
 if(!hasRedis())return answer(q,'Подключите Redis для управления заявками')
 if(q.data?.startsWith('list:')){const [,filter,page]=q.data.split(':');await list(q.message,q.from,filter,Number(page));return answer(q)}
 const [kind,id,status,revision]=String(q.data||'').split(':')
 if(!idPattern.test(id||''))return answer(q,'Некорректная кнопка')
 const current=await getLead(id);if(!current)return answer(q,'Заявка не найдена')
 own(current,q.from)
 if(kind==='back'){await redraw(q,current);return answer(q,'Без изменений')}
 if(kind==='cf'&&['done','cancel'].includes(status)){
  active(current);if(status==='done')requireClaim(current,q.from)
  await confirmation(q.message,current,status);return answer(q,'Подтвердите действие')
 }
 if(!['st','ok'].includes(kind))return answer(q,'Откройте карточку заново')
 if(kind==='st'&&!['work','called'].includes(status))return answer(q,'Требуется подтверждение действия')
 if(kind==='ok'&&!['done','cancel'].includes(status))return answer(q,'Некорректное подтверждение')
 const updated=await change(id,q.from,event,lead=>{
  own(lead,q.from)
  if(kind==='ok'){
   if(Number(revision)!==Number(lead.revision||0))throw new UserError('Карточка изменилась. Откройте её и подтвердите ещё раз.')
   active(lead);if(status==='done')requireClaim(lead,q.from)
   lead.status=status
   if(status==='cancel')lead.cancelReason=lead.pendingCancel?.revision===Number(revision)&&lead.pendingCancel?.by===String(q.from.id)?lead.pendingCancel.reason:'Отменено менеджером'
   delete lead.pendingCancel
   return status==='cancel'?'Причина: '+lead.cancelReason:'Закрыта после подтверждения'
  }
  if(status==='work'){
   if(!['new','done','cancel'].includes(lead.status))throw new UserError('Заявка уже в работе')
   lead.status='work';lead.assigneeId=String(q.from.id);lead.assignee=who(q.from);delete lead.cancelReason;delete lead.pendingCancel;return 'Назначен ответственный'
  }
  requireClaim(lead,q.from)
  if(lead.status!=='work')throw new UserError('Связь уже отмечена или время согласовано')
  lead.status='called';return 'Менеджер связался с клиентом'
 })
 await redraw(q,updated);return answer(q,STATUSES[updated.status].label)
}
async function list(msg,user,filter='all',page=0){
 if(!['all','new','mine'].includes(filter)||!Number.isInteger(page)||page<0||page>10000)throw new UserError('Некорректная страница')
 // Scan the open index in bounded chunks; never silently stop at the first 30 records.
 const matches=[];let offset=0;const target=(page+1)*10+1
 while(matches.length<target){
  const ids=await redis('ZRANGE','leads:open',offset,offset+99);if(!ids?.length)break
  const batch=await redis('MGET',...ids.map(id=>'lead:'+id))
  for(const raw of batch){if(!raw)continue;const l=JSON.parse(raw);if(!['done','cancel'].includes(l.status)&&(filter!=='new'||l.status==='new')&&(filter!=='mine'||String(l.assigneeId)===String(user.id)))matches.push(l)}
  offset+=ids.length;if(ids.length<100)break
 }
 const selected=matches.slice(page*10,page*10+10)
 const rows=selected.map(l=>`#${esc(l.id)} · ${STATUSES[l.status]?.label||'—'}${l.isTest?' · 🧪 ТЕСТ':''} · ${esc(l.name)}\n/lead ${esc(l.id)}`)
 const buttons=[];if(page>0)buttons.push({text:'← Назад',callback_data:`list:${filter}:${page-1}`});if(matches.length>(page+1)*10)buttons.push({text:'Далее →',callback_data:`list:${filter}:${page+1}`})
 return reply(msg,`<b>${{all:'Открытые заявки',new:'Новые заявки',mine:'Мои заявки'}[filter]}</b> · стр. ${page+1}\n\n`+(rows.join('\n\n')||'Заявок нет.'),buttons.length?{reply_markup:{inline_keyboard:[buttons]}}:{})
}
async function onMessage(msg,event){
 const text=String(msg.text||'').trim();const [rawCmd,id,...rest]=text.split(/\s+/);const cmd=(rawCmd||'').split('@')[0].toLowerCase()
 if(cmd==='/id')return reply(msg,`ID этого чата: <code>${msg.chat.id}</code>\nВаш Telegram ID: <code>${msg.from?.id||'—'}</code>\n`+(allowed(msg.chat.id,msg.from)?'Доступ менеджера подтверждён.':'Доступ к заявкам не предоставлен.'))
 if(!allowed(msg.chat.id,msg.from)){if(cmd==='/start')return reply(msg,'Это служебный бот менеджеров. Для настройки используйте /id.');return}
 if(cmd==='/help'||cmd==='/start')return reply(msg,HELP)
 if(!hasRedis())return reply(msg,'Подключите Redis: история и управление заявками требуют базы данных.')
 if(['/leads','/new','/mine'].includes(cmd))return list(msg,msg.from,{'/leads':'all','/new':'new','/mine':'mine'}[cmd])
 if(!['/lead','/note','/price','/schedule','/cancel'].includes(cmd))return reply(msg,'Неизвестная команда. /help — список команд.')
 if(!idPattern.test(id||''))throw new UserError('Укажите номер заявки. Например: /lead 12')
 const lead=await getLead(id);if(!lead)throw new UserError('Заявка не найдена')
 if(cmd==='/lead')return card(msg,lead)
 const body=rest.join(' ')
 if(cmd==='/cancel'){
  own(lead,msg.from);active(lead);if(!body||body.length>200)throw new UserError('Укажите причину до 200 символов: /cancel 12 клиент передумал')
  const changed=await change(id,msg.from,event,l=>{own(l,msg.from);active(l);l.pendingCancel={by:String(msg.from.id),reason:body,revision:Number(l.revision||0)+1};return 'Запрошена отмена'})
  return confirmation(msg,changed,'cancel',body)
 }
 const changed=await change(id,msg.from,event,l=>{
  requireClaim(l,msg.from)
  if(cmd==='/note'){
   if(!body||body.length>200)throw new UserError('Заметка: от 1 до 200 символов')
   l.notes ||= [];l.notes.push({text:body,at:new Date().toISOString(),by:who(msg.from)});l.notes=l.notes.slice(-30);return 'Добавлена заметка'
  }
  if(cmd==='/price'){
   if(!/^\d{1,8}$/.test(body)||Number(body)<1||Number(body)>10000000)throw new UserError('Цена: целое число от 1 до 10000000 ₽. Например: /price 12 11600')
   l.finalPrice=Number(body);return 'Согласована цена: '+body+' ₽'
  }
  if(rest.length!==2||!validSchedule(rest[0],rest[1]))throw new UserError('Укажите будущие дату и время: /schedule 12 ГГГГ-ММ-ДД ЧЧ:ММ')
  l.scheduledAt=rest.join(' ');l.status='scheduled';return 'Согласовано время: '+l.scheduledAt
 })
 // Send the current card; original notification is refreshed too.
 if(changed.messageId)await redraw({message:{chat:{id:msg.chat.id},message_id:changed.messageId}},changed)
 return card(msg,changed)
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store')
 if(req.method!=='POST')return res.status(405).send('Use POST')
 const secret=process.env.TELEGRAM_WEBHOOK_SECRET
 if(!secret)return res.status(503).send('not configured')
 if(req.headers['x-telegram-bot-api-secret-token']!==secret)return res.status(401).send('unauthorized')
 const u=req.body||{};const event=eventId(u);const key='tg:done:'+event
 try{
  if(hasRedis()&&await redis('GET',key))return res.status(200).json({ok:true})
  if(u.callback_query)await onCallback(u.callback_query,event)
  else if(u.message)await onMessage(u.message,event)
  if(hasRedis()){await redis('SET',key,'1');await redis('EXPIRE',key,86400)}
  return res.status(200).json({ok:true})
 }catch(e){
  if(e instanceof UserError){
   if(u.callback_query)await answer(u.callback_query,e.message)
   else if(u.message)await reply(u.message,esc(e.message))
   return res.status(200).json({ok:true})
  }
  console.error('Telegram processing failed')
  return res.status(503).json({error:'Temporary processing failure'})
 }
}
